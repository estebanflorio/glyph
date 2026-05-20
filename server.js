// server.js — GLYPH v4.0
// Cambios vs v3:
//  · Rutas /api/remove-bg y /api/upscale aceptan usuarios anónimos (1 operación gratis)
//  · Middleware freeLimit protege con IP + fingerprint
//  · Webhook MP mejorado con retry-safe (idempotencia por paymentId)
//  · PUBLIC_URL actualizado para producción

import 'dotenv/config';
import express from 'express';
import Replicate from 'replicate';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { freeLimit } from './middleware/freeLimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const port = process.env.PORT || 3000;

// ─── FIREBASE ADMIN ───────────────────────────────────────────
initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
});
const auth = getAuth();
const db   = getFirestore();

// ─── MERCADOPAGO ──────────────────────────────────────────────
const mp           = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const mpPreference = new Preference(mp);
const mpPayment    = new Payment(mp);

// ─── REPLICATE ────────────────────────────────────────────────
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }
});

const toDataUri = (buf, mime) =>
  `data:${mime};base64,${buf.toString('base64')}`;

// Costo en créditos por operación
const COSTS = { 'remove-bg': 2, 'upscale': 2 };

// ─── FIREBASE CONFIG (enviada al frontend) ────────────────────
app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey:     process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId:  process.env.FIREBASE_PROJECT_ID,
    appId:      process.env.FIREBASE_APP_ID,
  });
});

// Rutas de páginas
app.get('/',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────
// optionalAuth: deja pasar siempre, pero setea req.user si hay token válido
async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) { req.user = null; return next(); }
  try {
    req.user = await auth.verifyIdToken(token);
  } catch {
    req.user = null;
  }
  next();
}

// requireAuth: rechaza si no hay token
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'No autenticado.' });
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token inválido o expirado.' });
  }
}

// ─── CREDITS MIDDLEWARE ───────────────────────────────────────
// Solo se llama cuando req.user existe (usuario logueado)
function requireCredits(operation) {
  return async (req, res, next) => {
    const cost = COSTS[operation];
    const ref  = db.collection('users').doc(req.user.uid);
    let snap   = await ref.get();

    if (!snap.exists) {
      await ref.set({ email: req.user.email, credits: 10, createdAt: FieldValue.serverTimestamp() });
      snap = await ref.get();
    }

    const credits = snap.data().credits ?? 0;
    if (credits < cost) {
      return res.status(402).json({
        success: false,
        error:   `Créditos insuficientes. Necesitás ${cost}, tenés ${credits}.`,
        credits
      });
    }

    await ref.update({ credits: FieldValue.increment(-cost) });
    req.creditsAfter = credits - cost;
    req.creditsCost  = cost;
    next();
  };
}

// ─── MIDDLEWARE COMBINADO: logueado + créditos ó anónimo + freeLimit ──
function authOrFree(operation) {
  return [
    optionalAuth,
    async (req, res, next) => {
      if (req.user) {
        // Usuario logueado → verificar créditos
        return requireCredits(operation)(req, res, next);
      } else {
        // Anónimo → verificar freeLimit (IP + fingerprint)
        return freeLimit(req, res, next);
      }
    }
  ];
}

// ════════════════════════════════════════════════════════════════
// RUTAS DE USUARIO
// ════════════════════════════════════════════════════════════════
app.get('/api/me', requireAuth, async (req, res) => {
  const ref  = db.collection('users').doc(req.user.uid);
  let snap   = await ref.get();
  if (!snap.exists) {
    await ref.set({ email: req.user.email, credits: 10, createdAt: FieldValue.serverTimestamp() });
    snap = await ref.get();
  }
  res.json({ success: true, uid: req.user.uid, email: req.user.email, credits: snap.data().credits ?? 0 });
});

// ════════════════════════════════════════════════════════════════
// RUTAS MERCADOPAGO
// ════════════════════════════════════════════════════════════════
const PLANES = {
  starter: { credits: 50,  price: 2000,  label: 'Starter — 50 créditos'  },
  pro:     { credits: 200, price: 6000,  label: 'Pro — 200 créditos'     },
  studio:  { credits: 500, price: 12000, label: 'Studio — 500 créditos'  },
};

app.post('/api/crear-preferencia', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const planData = PLANES[plan];
  if (!planData) return res.status(400).json({ success: false, error: 'Plan inválido.' });

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;

  try {
    const pref = await mpPreference.create({
      body: {
        items: [{
          id:          plan,
          title:       `GLYPH · ${planData.label}`,
          quantity:    1,
          unit_price:  planData.price,
          currency_id: 'ARS',
        }],
        payer:    { email: req.user.email },
        metadata: { uid: req.user.uid, plan, credits: planData.credits },
        back_urls: {
          success: `${baseUrl}/app?pago=ok&plan=${plan}`,
          failure: `${baseUrl}/app?pago=error`,
          pending: `${baseUrl}/app?pago=pendiente`,
        },
        auto_return:          'approved',
        notification_url:     `${baseUrl}/api/webhook-mp`,
        statement_descriptor: 'GLYPH TOOLKIT',
      }
    });
    res.json({ success: true, init_point: pref.init_point });
  } catch (err) {
    console.error('[MP] preferencia:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── WEBHOOK MP ───────────────────────────────────────────────
// Idempotente: verifica si el paymentId ya fue procesado
app.post('/api/webhook-mp', async (req, res) => {
  res.sendStatus(200); // Siempre respondemos 200 primero

  try {
    const { type, data } = req.body;
    if (type !== 'payment') return;

    const paymentId = String(data.id);

    // Idempotencia: si ya procesamos este pago, lo ignoramos
    const txRef  = db.collection('transactions').doc(paymentId);
    const txSnap = await txRef.get();
    if (txSnap.exists) {
      console.log(`[MP] ⚠ Pago ${paymentId} ya procesado — ignorando`);
      return;
    }

    const payment = await mpPayment.get({ id: paymentId });
    if (payment.status !== 'approved') return;

    const { uid, plan, credits } = payment.metadata;
    if (!uid || !credits) {
      console.error('[MP] Metadata incompleta:', payment.metadata);
      return;
    }

    // Acreditar créditos y registrar transacción en una sola operación
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), {
      credits: FieldValue.increment(Number(credits))
    });
    batch.set(txRef, {
      uid,
      plan,
      credits:   Number(credits),
      amount:    payment.transaction_amount,
      paymentId,
      status:    'approved',
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log(`[MP] ✓ Pago aprobado — ${uid} · plan:${plan} · +${credits} créditos`);
  } catch (err) {
    console.error('[MP] webhook error:', err.message);
  }
});

// ════════════════════════════════════════════════════════════════
// RUTAS REPLICATE — auth opcional: logueado usa créditos, anónimo usa free trial
// ════════════════════════════════════════════════════════════════

app.post('/api/remove-bg',
  ...authOrFree('remove-bg'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });

    const who = req.user ? req.user.email : `anon[${req.headers['x-fingerprint']?.slice(0,8)}]`;
    console.log(`[remove-bg] ${who} · ${req.file.originalname} · ${(req.file.size/1024).toFixed(0)} KB`);

    try {
      const output = await replicate.run(
        '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
        { input: { image: toDataUri(req.file.buffer, req.file.mimetype) } }
      );
      const url = Array.isArray(output) ? output[0] : String(output);

      const response = { success: true, url };
      if (req.user) {
        response.credits = req.creditsAfter;
        console.log(`[remove-bg] ✓ créditos restantes: ${req.creditsAfter}`);
      } else {
        response.freeUsed = true;
        response.message  = '¡Listo! Creá una cuenta para seguir usando GLYPH.';
      }
      res.json(response);
    } catch (err) {
      // Devolver créditos si falló (solo usuarios logueados)
      if (req.user) {
        await db.collection('users').doc(req.user.uid).update({ credits: FieldValue.increment(req.creditsCost) });
      }
      console.error('[remove-bg] ✗', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

app.post('/api/upscale',
  ...authOrFree('upscale'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });

    const scale = Math.min(8, Math.max(2, parseInt(req.body.scale) || 2));
    const who   = req.user ? req.user.email : `anon[${req.headers['x-fingerprint']?.slice(0,8)}]`;
    console.log(`[upscale] ${who} · ${req.file.originalname} · ${scale}×`);

    try {
      const output = await replicate.run(
        'prunaai/p-image-upscale',
        { input: { image: toDataUri(req.file.buffer, req.file.mimetype), mode: 'factor', scale_factor: scale, enhance_realism: true } }
      );
      const url = Array.isArray(output) ? output[0] : String(output);

      const response = { success: true, url };
      if (req.user) {
        response.credits = req.creditsAfter;
        console.log(`[upscale] ✓ créditos restantes: ${req.creditsAfter}`);
      } else {
        response.freeUsed = true;
        response.message  = '¡Listo! Creá una cuenta para seguir usando GLYPH.';
      }
      res.json(response);
    } catch (err) {
      if (req.user) {
        await db.collection('users').doc(req.user.uid).update({ credits: FieldValue.increment(req.creditsCost) });
      }
      console.error('[upscale] ✗', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

app.listen(port, () => {
  console.log(`
  ██████╗ ██╗   ██╗   ██╗██████╗ ██╗  ██╗
  ██╔════╝ ██║   ╚██╗ ██╔╝██╔══██╗██║  ██║
  ██║  ███╗██║    ╚████╔╝ ██████╔╝███████║
  ██║   ██║██║    ╚██╔╝  ██╔═══╝ ██╔══██║
  ╚██████╔╝███████╗██║   ██║     ██║  ██║
   ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝  ╚═╝

  http://localhost:${port}  ·  v4.0
  Auth Firebase · Créditos Firestore · Pagos MP · Free Trial IP+FP
  `);
});
