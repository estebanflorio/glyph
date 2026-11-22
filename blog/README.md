# Módulo Blog (Glyph)

Módulo Express autocontenido: blog público con SEO + editor visual (Quill) con subida de imágenes a Firebase Storage.

## Dependencias nuevas (modifican package.json)
npm install sanitize-html multer

## Conexión (en tu server.js, después de inicializar firebase-admin)
const { mountBlog } = require('./blog');

mountBlog(app, {
  admin,                                   // firebase-admin ya inicializado (con storageBucket)
  requireAdmin: tuMiddlewareAdmin,         // el que ya protege tu panel
  siteUrl: 'https://glyph.com.ar',
  siteName: 'Glyph',
  ctaUrl: '/',                             // opcional: botón al final de cada artículo
  // layout: ({ head, body, title }) => `...`  // opcional: usar el header/footer de tu sitio
});

Rutas: /blog, /blog/:slug, /blog/sitemap.xml y editor en /admin/blog.

## Checklist
1. firebase.initializeApp({ credential, storageBucket: 'TU-PROYECTO.appspot.com' }) (o pasar storageBucket a mountBlog).
2. Firestore rules: bloquear acceso cliente a la colección blog_posts (el módulo usa Admin SDK).
3. robots.txt: agregar  Sitemap: https://glyph.com.ar/blog/sitemap.xml
4. Si usás helmet con CSP: permitir https://cdn.jsdelivr.net (script y style) e imágenes de firebasestorage.googleapis.com.
5. Si requireAdmin usa Bearer token (no cookie/sesión): pasá adminShellGuard (para cargar la página del editor)
   y definí window.BLOG_AUTH_HEADERS en el editor para enviar el token a la API.
