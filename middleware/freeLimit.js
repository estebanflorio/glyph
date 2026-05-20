// middleware/freeLimit.js
// Protege el preview gratuito con IP + fingerprint
// Se usa SOLO cuando el usuario NO está logueado

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const FREE_LIMIT = 1; // 1 operación gratuita por dispositivo/IP

export async function freeLimit(req, res, next) {
  const db = getFirestore();

  const ip          = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
                        .split(',')[0].trim();
  const fingerprint = req.headers['x-fingerprint'];

  // Si no hay fingerprint, bloqueamos directo
  if (!fingerprint) {
    return res.status(403).json({
      success: false,
      error: 'free_limit_reached',
      message: 'Necesitás iniciar sesión para usar esta función.'
    });
  }

  try {
    const ipRef   = db.collection('freeUsage').doc(`ip_${ip.replace(/[.:]/g, '_')}`);
    const fpRef   = db.collection('freeUsage').doc(`fp_${fingerprint}`);

    const [ipSnap, fpSnap] = await Promise.all([ipRef.get(), fpRef.get()]);

    const ipCount = ipSnap.exists ? (ipSnap.data().count ?? 0) : 0;
    const fpCount = fpSnap.exists ? (fpSnap.data().count ?? 0) : 0;

    // Si alguno de los dos ya consumió el free trial → bloqueamos
    if (ipCount >= FREE_LIMIT || fpCount >= FREE_LIMIT) {
      return res.status(403).json({
        success: false,
        error: 'free_limit_reached',
        message: 'Ya usaste tu operación gratuita. Creá una cuenta para seguir usando GLYPH.'
      });
    }

    // Registramos el uso (upsert)
    const now = FieldValue.serverTimestamp();
    await Promise.all([
      ipRef.set({ ip, count: FieldValue.increment(1), lastUsed: now }, { merge: true }),
      fpRef.set({ fingerprint, count: FieldValue.increment(1), lastUsed: now }, { merge: true })
    ]);

    next();
  } catch (err) {
    console.error('[freeLimit] Error:', err.message);
    // Si falla Firestore, dejamos pasar (fail-open) para no romper la UX
    next();
  }
}
