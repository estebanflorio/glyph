// middleware/support.js
// Atención al usuario: formulario de soporte, bandeja del admin,
// baja de cuenta (botón de baja) y páginas de ayuda / términos / privacidad.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const TYPES    = ['consulta', 'pago', 'operacion', 'arrepentimiento', 'baja', 'otro'];
const STATUSES = ['new', 'answered', 'closed'];

// Limitador simple en memoria: máx. N envíos por ventana, por IP
const hits = new Map();
function tooMany(key, max = 5, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = hits.get(key) || { n: 0, start: now };
  if (now - rec.start > windowMs) { rec.n = 0; rec.start = now; }
  rec.n++;
  hits.set(key, rec);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  return rec.n > max;
}

const clean = (s, max) =>
  String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

const clientIp = req => req.headers['cf-connecting-ip'] || req.ip || 'unknown';

async function deleteWhere(db, collection, field, value) {
  const snap = await db.collection(collection).where(field, '==', value).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

export function registerSupportRoutes(app, { db, auth, FieldValue, requireAuth, requireAdmin }) {

  // ── Páginas públicas ────────────────────────────────────────
  app.get('/ayuda',      (req, res) => res.sendFile(path.join(PUBLIC, 'ayuda.html')));
  app.get('/terminos',   (req, res) => res.sendFile(path.join(PUBLIC, 'terminos.html')));
  app.get('/privacidad', (req, res) => res.sendFile(path.join(PUBLIC, 'privacidad.html')));

  // ── Enviar consulta (no requiere cuenta) ────────────────────
  app.post('/api/support', async (req, res) => {
    try {
      const b = req.body || {};

      // Honeypot: los bots completan este campo oculto
      if (b.website) return res.json({ success: true, ticket: 'T-000000' });

      if (tooMany('support:' + clientIp(req))) {
        return res.status(429).json({ success: false, error: 'Enviaste varios mensajes seguidos. Esperá unos minutos y probá de nuevo.' });
      }

      const type    = TYPES.includes(b.type) ? b.type : 'consulta';
      const email   = clean(b.email, 254).toLowerCase();
      const name    = clean(b.name, 100);
      const extra   = clean(b.extra, 200);
      const message = clean(b.message, 3000);

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: 'Ingresá un email válido para poder responderte.' });
      }
      if (message.length < 10) {
        return res.status(400).json({ success: false, error: 'El mensaje es muy corto.' });
      }

      // Si viene con sesión, vinculamos la consulta a la cuenta (opcional)
      let uid = null;
      let context = null;
      const token = req.headers.authorization?.split('Bearer ')[1];
      if (token) {
        try {
          const decoded = await auth.verifyIdToken(token);
          uid = decoded.uid;
          const userSnap = await db.collection('users').doc(uid).get();
          const u = userSnap.exists ? userSnap.data() : {};
          const txSnap = await db.collection('transactions').where('uid', '==', uid).get();
          const last = txSnap.docs
            .map(d => d.data())
            .sort((a, c) => (c.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0))[0];
          context = {
            accountEmail: decoded.email || '',
            credits: u.isAdmin ? 'ilimitados' : (u.credits ?? 0),
            lastPurchase: last
              ? { plan: last.plan || '', amount: last.amount || 0, paymentId: String(last.paymentId || ''), createdAt: last.createdAt || null }
              : null,
          };
        } catch { /* token inválido: se trata como consulta anónima */ }
      }

      const ref = await db.collection('support_tickets').add({
        type, email, name, extra, message,
        uid, context,
        status: 'new',
        createdAt: FieldValue.serverTimestamp(),
      });

      res.json({ success: true, ticket: 'T-' + ref.id.slice(0, 6).toUpperCase() });
    } catch (err) {
      console.error('[support]', err.message);
      res.status(500).json({ success: false, error: 'No pudimos enviar tu mensaje. Probá de nuevo en unos minutos.' });
    }
  });

  // ── Bandeja del admin ───────────────────────────────────────
  app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
    try {
      const snap = await db.collection('support_tickets').orderBy('createdAt', 'desc').limit(200).get();
      const tickets = snap.docs.map(d => ({ id: d.id, ticket: 'T-' + d.id.slice(0, 6).toUpperCase(), ...d.data() }));
      res.json({ success: true, tickets });
    } catch (err) {
      console.error('[admin/tickets]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/admin/tickets/status', requireAdmin, async (req, res) => {
    try {
      const { id, status } = req.body || {};
      if (!id || !STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Datos inválidos.' });
      await db.collection('support_tickets').doc(String(id)).update({ status, updatedAt: FieldValue.serverTimestamp() });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Botón de baja: eliminar la propia cuenta ────────────────
  app.post('/api/account/delete', requireAuth, async (req, res) => {
    try {
      if (req.body?.confirm !== 'ELIMINAR') {
        return res.status(400).json({ success: false, error: 'Falta la confirmación.' });
      }

      const uid     = req.user.uid;
      const userRef = db.collection('users').doc(uid);
      const snap    = await userRef.get();

      if (snap.exists && snap.data().isAdmin) {
        return res.status(403).json({ success: false, error: 'Las cuentas de administrador no se pueden eliminar desde acá.' });
      }

      // Constancia de la baja (sin datos personales)
      await db.collection('account_deletions').add({ uid, createdAt: FieldValue.serverTimestamp() });

      // Borramos datos de la cuenta. Los pagos (transactions) se conservan por obligación fiscal/contable.
      await db.recursiveDelete(userRef);
      await deleteWhere(db, 'operations', 'uid', uid);
      await auth.deleteUser(uid);

      console.log('[account] baja de cuenta', uid);
      res.json({ success: true });
    } catch (err) {
      console.error('[account/delete]', err.message);
      res.status(500).json({ success: false, error: 'No pudimos eliminar tu cuenta. Escribinos desde Ayuda y lo hacemos nosotros.' });
    }
  });
}
