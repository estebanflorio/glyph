// middleware/semitonos.js
// Acceso restringido a la herramienta "Semitonos DTF":
//   · Pueden usarla: administradores y quienes compraron un paquete Pro o Studio.
//   · Un admin puede concederla o revocarla manualmente a cualquier usuario.
// Los archivos de la herramienta viven en /private/semitonos (NO en /public) y
// solo se entregan a quien tiene una cookie de sesión firmada y sigue habilitado.

import path from 'path';
import crypto from 'crypto';
import express from 'express';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.join(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, 'private', 'semitonos');

const PAID_PLANS  = ['pro', 'studio'];   // planes que desbloquean la herramienta
const COOKIE      = 'glyph_t';
const COOKIE_SECS = 8 * 60 * 60;         // la sesión de acceso dura 8 horas
const CACHE_MS    = 60 * 1000;           // la elegibilidad se cachea 1 minuto

// ── Firma de la cookie (HMAC). No hace falta una variable nueva: si no existe
//    SESSION_SECRET se deriva de la clave privada de Firebase (que solo vive en el servidor).
const secret = () => process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('glyph-session:' + (process.env.FIREBASE_PRIVATE_KEY || 'dev-only')).digest('hex');
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function makeToken(uid) {
  const p = Buffer.from(uid).toString('base64url') + '.' + (Math.floor(Date.now() / 1000) + COOKIE_SECS);
  return p + '.' + sign(p);
}
function readToken(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;
  const p = parts[0] + '.' + parts[1];
  const a = Buffer.from(sign(p)), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Math.floor(Date.now() / 1000)) return null;
  try { return Buffer.from(parts[0], 'base64url').toString(); } catch { return null; }
}
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function registerSemitonosRoutes(app, { db, FieldValue, requireAuth, requireAdmin }) {

  // ── ¿Este usuario puede usar Semitonos? ─────────────────────────
  const cache = new Map();
  async function eligible(uid) {
    const hit = cache.get(uid);
    if (hit && hit.exp > Date.now()) return hit.ok;

    const snap = await db.collection('users').doc(uid).get();
    const u = snap.exists ? snap.data() : {};
    let ok;
    if (u.blocked) ok = false;
    else if (u.isAdmin) ok = true;
    else if (u.features?.semitonos === false) ok = false;   // revocado a mano
    else if (u.features?.semitonos === true)  ok = true;    // concedido a mano
    else {
      const tx = await db.collection('transactions').where('uid', '==', uid).get();
      ok = tx.docs.some(d => PAID_PLANS.includes(d.data().plan) && !d.data().refunded);
    }
    cache.set(uid, { ok, exp: Date.now() + CACHE_MS });
    if (cache.size > 5000) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
    return ok;
  }

  const cookieOpts = req => ({ httpOnly: true, secure: !!req.secure, sameSite: 'lax', path: '/' });

  // ── Página pública (gate + información de la herramienta) ───
  app.get('/semitonos', (req, res) => res.sendFile(path.join(ROOT, 'public', 'semitonos.html')));

  // ── Abre la sesión de acceso (el navegador la llama con su token de Firebase) ──
  app.post('/api/session', requireAuth, async (req, res) => {
    try {
      const ok = await eligible(req.user.uid);
      res.setHeader('Cache-Control', 'no-store');
      if (ok) res.cookie(COOKIE, makeToken(req.user.uid), { ...cookieOpts(req), maxAge: COOKIE_SECS * 1000 });
      else res.clearCookie(COOKIE, cookieOpts(req));
      res.json({ success: true, semitonos: ok });
    } catch (err) {
      console.error('[session]', err.message);
      res.status(500).json({ success: false, error: 'No pudimos verificar tu acceso.' });
    }
  });

  // Cierra la sesión de acceso (se llama al cerrar sesión)
  app.post('/api/session/clear', (req, res) => {
    res.clearCookie(COOKIE, cookieOpts(req));
    res.json({ success: true });
  });

  // Para mostrar el candado en el menú de la app
  app.get('/api/features', requireAuth, async (req, res) => {
    try { res.json({ success: true, semitonos: await eligible(req.user.uid) }); }
    catch { res.status(500).json({ success: false }); }
  });

  // ── Control manual del admin: true = conceder, false = revocar, null = automático ──
  app.post('/api/admin/features', requireAdmin, async (req, res) => {
    try {
      const { uid, semitonos } = req.body || {};
      if (!uid || ![true, false, null].includes(semitonos)) {
        return res.status(400).json({ success: false, error: 'Datos inválidos.' });
      }
      await db.collection('users').doc(String(uid)).update({
        'features.semitonos': semitonos === null ? FieldValue.delete() : semitonos,
      });
      await db.collection('admin_logs').add({
        action: 'feature_semitonos', targetUid: String(uid), adminUid: req.user.uid,
        value: semitonos, createdAt: FieldValue.serverTimestamp(),
      });
      cache.delete(String(uid));
      res.json({ success: true });
    } catch (err) {
      console.error('[admin/features]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── La herramienta: solo para quien tiene sesión de acceso y sigue habilitado ──
  const gate = async (req, res, next) => {
    try {
      const uid = readToken(getCookie(req, COOKIE));
      if (!uid || !(await eligible(uid))) {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect('/semitonos');
      }
      next();
    } catch (err) {
      console.error('[semitonos gate]', err.message);
      res.status(500).send('Error verificando el acceso.');
    }
  };
  app.use('/herramientas/semitonos', gate, express.static(PRIVATE_DIR, {
    setHeaders: res => {
      res.setHeader('Cache-Control', 'private, no-store');   // que ni Cloudflare ni el navegador lo guarden
      res.setHeader('X-Robots-Tag', 'noindex');
    },
  }));
}
