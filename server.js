import 'dotenv/config';
import express from 'express';
import Replicate from 'replicate';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
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

// ════════════════════════════════════════════════════════════════
// SEGURIDAD — HEADERS HTTP
// ════════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  // Evita que el browser interprete archivos con MIME incorrecto
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Evita que la app se embeba en iframes de otros dominios
  res.setHeader('X-Frame-Options', 'DENY');
  // Fuerza HTTPS en producción
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Oculta que usás Express
  res.removeHeader('X-Powered-By');
  // ngrok dev
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// ════════════════════════════════════════════════════════════════
// SEGURIDAD — RATE LIMITING (sin dependencias extra)
// ════════════════════════════════════════════════════════════════
const rateLimitStore = new Map();

function rateLimit({ windowMs = 60_000, max = 20, keyFn = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const key  = keyFn(req);
    const now  = Date.now();
    const data = rateLimitStore.get(key) || { count: 0, start: now };

    // Resetear ventana si pasó el tiempo
    if (now - data.start > windowMs) {
      data.count = 0;
      data.start = now;
    }

    data.count++;
    rateLimitStore.set(key, data);

    // Limpiar entradas viejas cada 5 minutos para no llenar la memoria
    if (rateLimitStore.size > 10000) {
      for (const [k, v] of rateLimitStore) {
        if (now - v.start > windowMs) rateLimitStore.delete(k);
      }
    }

    if (data.count > max) {
      return res.status(429).json({
        success: false,
        error: 'Demasiadas solicitudes. Esperá un momento antes de reintentar.'
      });
    }

    next();
  };
}

// Límites por ruta
const limitGeneral  = rateLimit({ windowMs: 60_000,  max: 60  }); // 60 req/min general
const limitReplicate = rateLimit({ windowMs: 60_000, max: 10  }); // 10 operaciones IA/min por IP
const limitAuth     = rateLimit({ windowMs: 300_000, max: 10  }); // 10 intentos/5min en rutas sensibles
const limitWebhook  = rateLimit({ windowMs: 60_000,  max: 30  }); // 30 webhooks/min

app.use(limitGeneral);

// ─── FIREBASE CONFIG (enviada al frontend) ────────────────────
app.get('/api/firebase-config', limitAuth, (req, res) => {
  res.json({
    apiKey:     process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId:  process.env.FIREBASE_PROJECT_ID,
    appId:      process.env.FIREBASE_APP_ID,
  });
});

// El webhook necesita el body RAW para verificar la firma de MP
// Lo registramos ANTES de express.json()
app.post('/api/webhook-mp', limitWebhook, express.raw({ type: 'application/json' }), async (req, res) => {
  res.sendStatus(200);

  try {
    // ── Verificación de firma de MercadoPago ──────────────────
    // MP envía el header x-signature con la firma HMAC-SHA256
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];

    if (signature && process.env.MP_WEBHOOK_SECRET) {
      const [tsPart, vPart] = signature.split(',');
      const ts = tsPart?.split('=')?.[1];
      const v  = vPart?.split('=')?.[1];

      if (!ts || !v) {
        console.warn('[MP webhook] Firma malformada');
        return;
      }

      const body        = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
      const dataId      = JSON.parse(body)?.data?.id || '';
      const manifest    = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const expected    = crypto
        .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
        .update(manifest)
        .digest('hex');

      if (expected !== v) {
        console.warn('[MP webhook] Firma inválida — posible request falso');
        return;
      }
    }

    const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const { type, data } = body;
    if (type !== 'payment') return;

    const payment = await mpPayment.get({ id: data.id });
    if (payment.status !== 'approved') return;

    const { uid, plan, credits } = payment.metadata;
    if (!uid || !credits) return;

    // Verificar que el paymentId no fue procesado antes (idempotencia)
    const txRef = db.collection('transactions').where('paymentId', '==', String(payment.id));
    const txSnap = await txRef.get();
    if (!txSnap.empty) {
      console.log(`[MP webhook] Pago ${payment.id} ya procesado — ignorando`);
      return;
    }

    await db.collection('users').doc(uid).update({ credits: FieldValue.increment(Number(credits)) });
    await db.collection('transactions').add({
      uid, plan,
      credits:   Number(credits),
      amount:    payment.transaction_amount,
      paymentId: String(payment.id),
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`[MP] ✓ Pago aprobado — ${uid} · plan:${plan} · +${credits} créditos`);
  } catch (err) {
    console.error('[MP] webhook:', err.message);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── RUTAS DE PÁGINAS ─────────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/site.webmanifest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'assets', 'site.webmanifest'));
});

// ════════════════════════════════════════════════════════════════
// VALIDACIÓN DE ARCHIVOS — magic bytes reales
// ════════════════════════════════════════════════════════════════
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// Magic bytes de cada formato
const MAGIC = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png':  [[0x89, 0x50, 0x4E, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
};

function validateImageBytes(buffer, mimetype) {
  const signatures = MAGIC[mimetype];
  if (!signatures) return false;
  return signatures.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      return cb(new Error('Formato no permitido. Solo JPG, PNG o WEBP.'));
    }
    cb(null, true);
  }
});

// Middleware que valida magic bytes después de multer
function validateFileBytes(req, res, next) {
  if (!req.file) return next();
  if (!validateImageBytes(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'El archivo no es una imagen válida.'
    });
  }
  next();
}

const toDataUri = (buf, mime) =>
  `data:${mime};base64,${buf.toString('base64')}`;

// Costo en créditos por operación
const COSTS = { 'remove-bg': 2, 'upscale': 2 };

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────
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

// Middleware combinado: usuario logueado usa créditos, invitado usa freeLimit
async function authOrFree(req, res, next) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    try {
      req.user = await auth.verifyIdToken(token);
      return next();
    } catch {
      return res.status(401).json({ success: false, error: 'Token inválido.' });
    }
  }
  return freeLimit(req, res, next);
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
  const d = snap.data();
  res.json({
    success: true,
    uid:     req.user.uid,
    email:   req.user.email,
    credits: d.isAdmin ? 999999 : (d.credits ?? 0),
    isAdmin: d.isAdmin ?? false,
  });
});

// ════════════════════════════════════════════════════════════════
// RUTAS MERCADOPAGO
// ════════════════════════════════════════════════════════════════
const PLANES = {
  starter: { credits: 50,  price: 2000,  label: 'Starter — 50 créditos' },
  pro:     { credits: 200, price: 6000,  label: 'Pro — 200 créditos'    },
  studio:  { credits: 500, price: 12000, label: 'Studio — 500 créditos' },
};

app.post('/api/crear-preferencia', requireAuth, limitAuth, async (req, res) => {
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

// ════════════════════════════════════════════════════════════════
// RUTAS REPLICATE
// ════════════════════════════════════════════════════════════════
app.post('/api/remove-bg',
  authOrFree,
  limitReplicate,
  upload.single('image'),
  validateFileBytes,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });

    const isGuest = !req.user;
    console.log(`[remove-bg] ${isGuest ? 'invitado' : req.user.email} · ${(req.file.size/1024).toFixed(0)} KB`);

    let creditsAfter = null;
    if (!isGuest) {
      const cost = COSTS['remove-bg'];
      const ref  = db.collection('users').doc(req.user.uid);
      const snap = await ref.get();
      const data = snap.data() || {};

      if (data.isAdmin) {
        creditsAfter = 999999;
      } else {
        const credits = data.credits ?? 0;
        if (credits < cost) return res.status(402).json({
          success: false,
          error: `Créditos insuficientes. Necesitás ${cost}, tenés ${credits}.`,
          credits
        });
        await ref.update({ credits: FieldValue.increment(-cost) });
        creditsAfter = credits - cost;
      }
    }

    try {
      const output = await replicate.run(
        '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
        { input: { image: toDataUri(req.file.buffer, req.file.mimetype) } }
      );
      const url = Array.isArray(output) ? output[0] : String(output);
      console.log(`[remove-bg] ✓`);
      res.json({
        success:  true,
        url,
        credits:  creditsAfter,
        freeUsed: isGuest,
        message:  isGuest ? '¡Funcionó! Creá una cuenta y empezá con 10 créditos gratis.' : undefined
      });
    } catch (err) {
      if (!isGuest && req.user) {
        await db.collection('users').doc(req.user.uid)
          .update({ credits: FieldValue.increment(COSTS['remove-bg']) });
      }
      console.error('[remove-bg] ✗', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

app.post('/api/upscale',
  authOrFree,
  limitReplicate,
  upload.single('image'),
  validateFileBytes,
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen.' });

    const scale   = Math.min(8, Math.max(2, parseInt(req.body.scale) || 2));
    const isGuest = !req.user;
    console.log(`[upscale] ${isGuest ? 'invitado' : req.user.email} · ${scale}×`);

    let creditsAfter = null;
    if (!isGuest) {
      const cost = COSTS['upscale'];
      const ref  = db.collection('users').doc(req.user.uid);
      const snap = await ref.get();
      const data = snap.data() || {};

      if (data.isAdmin) {
        creditsAfter = 999999;
      } else {
        const credits = data.credits ?? 0;
        if (credits < cost) return res.status(402).json({
          success: false,
          error: `Créditos insuficientes. Necesitás ${cost}, tenés ${credits}.`,
          credits
        });
        await ref.update({ credits: FieldValue.increment(-cost) });
        creditsAfter = credits - cost;
      }
    }

    try {
      const output = await replicate.run(
        'prunaai/p-image-upscale',
        { input: { image: toDataUri(req.file.buffer, req.file.mimetype), mode: 'factor', scale_factor: scale, enhance_realism: true } }
      );
      const url = Array.isArray(output) ? output[0] : String(output);
      console.log(`[upscale] ✓`);
      res.json({
        success:  true,
        url,
        credits:  creditsAfter,
        freeUsed: isGuest,
        message:  isGuest ? '¡Funcionó! Creá una cuenta y empezá con 10 créditos gratis.' : undefined
      });
    } catch (err) {
      if (!isGuest && req.user) {
        await db.collection('users').doc(req.user.uid)
          .update({ credits: FieldValue.increment(COSTS['upscale']) });
      }
      console.error('[upscale] ✗', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ─── ERROR HANDLER GLOBAL ─────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message?.includes('Formato no permitido')) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: 'El archivo supera los 10MB.' });
  }
  console.error('[error]', err.message);
  res.status(500).json({ success: false, error: 'Error interno del servidor.' });
});

app.listen(port, () => {
  console.log(`
  ██████╗ ██╗   ██╗   ██╗██████╗ ██╗  ██╗
  ██╔════╝ ██║   ╚██╗ ██╔╝██╔══██╗██║  ██║
  ██║  ███╗██║    ╚████╔╝ ██████╔╝███████║
  ██║   ██║██║    ╚██╔╝  ██╔═══╝ ██╔══██║
  ╚██████╔╝███████╗██║   ██║     ██║  ██║
   ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝  ╚═╝

  http://localhost:${port}
  `);
});
