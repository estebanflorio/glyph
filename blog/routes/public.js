const express = require('express');
const { esc, listView, postView, notFoundView } = require('../lib/views');

function createPublicRouter(service, config) {
  const router = express.Router();
  const base = (req) => config.siteUrl || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const cache = (res) => res.set('Cache-Control', 'public, max-age=300, s-maxage=600');

  router.get('/sitemap.xml', wrap(async (req, res) => {
    const posts = await service.listPublished();
    const b = base(req);
    const iso = (ms) => (ms ? `<lastmod>${new Date(ms).toISOString()}</lastmod>` : '');
    const urls = [
      `<url><loc>${esc(b + config.basePath)}</loc>${iso(posts[0] && posts[0].updatedAt)}</url>`,
      ...posts.map((p) => `<url><loc>${esc(`${b}${config.basePath}/${p.slug}`)}</loc>${iso(p.updatedAt)}</url>`),
    ];
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
  }));

  router.get('/', wrap(async (req, res) => {
    const posts = await service.listPublished();
    cache(res).type('html').send(listView(config, base(req), posts));
  }));

  router.get('/:slug', wrap(async (req, res) => {
    const post = await service.getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).type('html').send(notFoundView(config, base(req)));
    cache(res).type('html').send(postView(config, base(req), post));
  }));

  router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[blog] error público:', err);
    res.status(500).type('html').send('<h1>Error interno</h1>');
  });

  return router;
}

module.exports = { createPublicRouter };
