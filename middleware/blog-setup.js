// middleware/blog-setup.js
// Puente entre tu server.js (ESM) y el módulo de blog (CommonJS en /blog).
// Monta: /blog (público, SEO), /blog/sitemap.xml y el editor en /admin/blog.

import { createRequire } from 'module';
import { getFirestore } from 'firebase-admin/firestore';

// El módulo pide "admin.firestore()". Lo resolvemos con la API moderna (la misma que usa tu server.js),
// así funciona igual en firebase-admin 12, 13 y 14.
const adminShim = { firestore: () => getFirestore() };

const require = createRequire(import.meta.url);
const { mountBlog } = require('../blog/index.js');

const SITE_URL = (process.env.PUBLIC_URL || 'https://glyph.com.ar').replace(/\/$/, '');

// Plantilla del sitio: header de GLYPH + tema oscuro + widget (legales, WhatsApp, temporada)
export const glyphLayout = ({ head, body, title }) => `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0a0a0b">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
${head}
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/blog-theme.css">
</head><body>
<header class="top">
  <a href="/" class="brand"><div class="dot"></div> GLYPH</a>
  <nav style="display:flex;gap:8px;flex-wrap:wrap">
    <a href="/blog" class="pill">Blog</a>
    <a href="/#precios" class="pill">Precios</a>
    <a href="/app" class="pill" style="color:#0a0a0b;background:#c8f135;border-color:#c8f135;font-weight:600">Abrir app →</a>
  </nav>
</header>
${body}
<script src="/assets/site-config.js"></script>
<script src="/assets/site-widget.js" defer></script>
</body></html>`;

export function mountGlyphBlog(app, { requireAdmin, adminSdk = adminShim } = {}) {
  return mountBlog(app, {
    admin: adminSdk,
    requireAdmin,                                   // el mismo middleware de tu panel (Bearer token)
    adminShellGuard: (req, res, next) => next(),    // la página del editor no tiene datos: la API sí está protegida
    siteUrl: SITE_URL,
    siteName: 'GLYPH',
    blogDescription: 'Guías y tutoriales para sublimación, DTF y diseño: cómo quitar fondos, mejorar la calidad de tus imágenes y preparar archivos para imprimir.',
    defaultOgImage: `${SITE_URL}/assets/og-image.png`,
    ctaUrl: '/login',
    ctaTitle: 'Probá GLYPH gratis',
    ctaText: 'Crear cuenta · 10 créditos gratis',
    layout: glyphLayout,
    imageStore: 'firestore',                        // imágenes en tu Firestore (sin Firebase Storage ni plan Blaze)
  });
}
