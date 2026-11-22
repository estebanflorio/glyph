const { createService } = require('./lib/service');
const { createStorage } = require('./lib/storage');
const { createFirestoreStorage } = require('./lib/storage-firestore');
const { createPublicRouter } = require('./routes/public');
const { createAdminRouter } = require('./routes/admin');

/**
 * Monta el blog en una app Express.
 *
 * opts:
 *  admin          (obligatorio) instancia de firebase-admin ya inicializada
 *  requireAdmin   (obligatorio) middleware de autenticación admin
 *  siteUrl        'https://glyph.com.ar' (recomendado, para canonical y sitemap)
 *  siteName       'Glyph'
 *  basePath       '/blog'
 *  adminPath      '/admin/blog'
 *  storageBucket  nombre del bucket si no está en initializeApp
 *  adminShellGuard middleware solo para cargar la página del editor (útil si requireAdmin usa Bearer token)
 *  layout         ({head, body, title}) => html   para usar el header/footer de tu sitio
 *  ctaUrl / ctaText / ctaTitle   llamada a la acción al final de cada artículo
 *  defaultOgImage URL https de imagen por defecto para compartir
 */
function mountBlog(app, opts = {}) {
  if (!opts.admin) throw new Error('[blog] Falta opts.admin (firebase-admin inicializado)');
  if (typeof opts.requireAdmin !== 'function') throw new Error('[blog] Falta opts.requireAdmin (middleware)');

  const config = {
    siteUrl: (opts.siteUrl || '').replace(/\/$/, ''),
    siteName: opts.siteName || 'Glyph',
    basePath: opts.basePath || '/blog',
    adminPath: opts.adminPath || '/admin/blog',
    collection: opts.collection || 'blog_posts',
    storageFolder: opts.storageFolder || 'blog',
    blogDescription: opts.blogDescription || 'Guías, tutoriales y novedades sobre diseño y edición de imágenes.',
    defaultOgImage: opts.defaultOgImage || '',
    ctaUrl: opts.ctaUrl || '',
    ctaTitle: opts.ctaTitle || '¿Querés probarlo vos mismo?',
    ctaText: opts.ctaText || 'Probar gratis',
    layout: typeof opts.layout === 'function' ? opts.layout : null,
    adminShellGuard: opts.adminShellGuard,
  };

  const db = opts.admin.firestore();
  const service = createService(db, config.collection);

  // imageStore: 'firestore' (por defecto, sin costo ni plan Blaze) o 'firebase' (Firebase Storage)
  let storage;
  if ((opts.imageStore || 'firestore') === 'firebase') {
    storage = createStorage(opts.admin, { folder: config.storageFolder, bucketName: opts.storageBucket });
  } else {
    const fsStore = createFirestoreStorage(db, { collection: opts.imagesCollection || 'blog_images', siteUrl: config.siteUrl, basePath: config.basePath });
    storage = fsStore.storage;
    app.use(`${config.basePath}/img`, fsStore.router);
  }

  app.use(config.adminPath, createAdminRouter(service, storage, config, opts.requireAdmin));
  app.use(config.basePath, createPublicRouter(service, config));
  console.log(`[blog] montado en ${config.basePath} (editor en ${config.adminPath})`);
  return { service, config };
}

module.exports = { mountBlog };
