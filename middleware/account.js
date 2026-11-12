// middleware/account.js
// Registro de operaciones + API de "Mi cuenta" + actividad para el admin.
// No modifica las rutas existentes de remove-bg / upscale: las observa.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '/api/remove-bg': 'remove-bg',
  '/api/upscale':   'upscale',
};

// ─── Registro de operaciones ─────────────────────────────────────
// Se monta con app.use() ANTES de las rutas /api/remove-bg y /api/upscale.
// Cuando la respuesta termina, guarda un registro en Firestore.
export function operationLogger({ db, FieldValue, COSTS }) {
  return (req, res, next) => {
    const type = req.method === 'POST' ? TYPES[req.path] : null;
    if (!type) return next();

    let body = null;
    const originalJson = res.json.bind(res);
    res.json = (b) => { body = b; return originalJson(b); };

    res.on('finish', async () => {
      try {
        const ok = res.statusCode < 400 && body?.success === true;
        // Solo registramos operaciones que llegaron a procesarse:
        // las exitosas y las que fallaron del lado de la IA (5xx).
        if (!ok && res.statusCode < 500) return;

        const guest = !req.user;
        const admin = body?.credits === 999999;

        const entry = {
          uid:       guest ? null : req.user.uid,
          email:     guest ? 'invitado' : (req.user.email || ''),
          type,
          status:    ok ? 'ok' : 'error',
          credits:   ok && !guest && !admin ? (COSTS[type] || 0) : 0,
          guest,
          admin,
          createdAt: FieldValue.serverTimestamp(),
        };

        const writes = [db.collection('operations').add(entry)];
        if (!guest) {
          const userRef = db.collection('users').doc(req.user.uid);
          writes.push(userRef.collection('operations').add(entry));
          if (ok) writes.push(userRef.set({ opsCount: FieldValue.increment(1) }, { merge: true }));
        }
        await Promise.all(writes);
      } catch (err) {
        console.error('[operationLogger]', err.message);
      }
    });

    next();
  };
}

// ─── Rutas ───────────────────────────────────────────────────────
export function registerAccountRoutes(app, { db, requireAuth, requireAdmin }) {

  // Página "Mi cuenta"
  app.get('/cuenta', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'cuenta.html'));
  });

  // Datos de la cuenta del usuario logueado
  app.get('/api/account', requireAuth, async (req, res) => {
    try {
      const uid     = req.user.uid;
      const userRef = db.collection('users').doc(uid);

      const [userSnap, txSnap, opsSnap] = await Promise.all([
        userRef.get(),
        // Sin orderBy para no requerir índice compuesto: se ordena abajo.
        db.collection('transactions').where('uid', '==', uid).get(),
        userRef.collection('operations').orderBy('createdAt', 'desc').limit(50).get(),
      ]);

      const u = userSnap.exists ? userSnap.data() : {};

      const transactions = txSnap.docs
        .map(d => d.data())
        .sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0))
        .map(t => ({
          plan:      t.plan || '',
          credits:   t.credits || 0,
          amount:    t.amount || 0,
          createdAt: t.createdAt || null,
        }));

      const operations = opsSnap.docs.map(d => {
        const o = d.data();
        return {
          type:      o.type,
          status:    o.status,
          credits:   o.credits || 0,
          admin:     !!o.admin,
          createdAt: o.createdAt || null,
        };
      });

      res.json({
        success:    true,
        email:      req.user.email,
        isAdmin:    !!u.isAdmin,
        credits:    u.isAdmin ? null : (u.credits ?? 0),
        createdAt:  u.createdAt || null,
        opsCount:   u.opsCount || 0,
        totalSpent: transactions.reduce((a, t) => a + t.amount, 0),
        transactions,
        operations,
      });
    } catch (err) {
      console.error('[account]', err.message);
      res.status(500).json({ success: false, error: 'No se pudo cargar tu cuenta.' });
    }
  });

  // Actividad reciente para el panel admin
  app.get('/api/admin/operations', requireAdmin, async (req, res) => {
    try {
      const snap = await db.collection('operations')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
      res.json({ success: true, operations: snap.docs.map(d => d.data()) });
    } catch (err) {
      console.error('[admin/operations]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
