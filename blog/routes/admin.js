const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { httpError } = require('../lib/errors');

function createAdminRouter(service, storage, config, requireAdmin) {
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const shellGuard = config.adminShellGuard || requireAdmin;

  const shell = fs.readFileSync(path.join(__dirname, '../admin/editor.html'), 'utf8')
    .replace(/__ADMIN__/g, config.adminPath)
    .replace(/__BASE__/g, config.basePath);

  // Assets del editor (JS/CSS, sin datos sensibles)
  router.use('/assets', express.static(path.join(__dirname, '../admin/assets'), { maxAge: '1h' }));
  router.get('/', shellGuard, (req, res) => res.set('Cache-Control', 'no-store').type('html').send(shell));

  const api = express.Router();
  api.use(requireAdmin);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  const validId = (id) => /^[A-Za-z0-9_-]{5,40}$/.test(id);

  api.get('/posts', wrap(async (req, res) => res.json({ posts: await service.listAll() })));

  api.get('/posts/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) throw httpError(400, 'ID inválido');
    const post = await service.getById(req.params.id);
    if (!post) throw httpError(404, 'Artículo no encontrado');
    res.json({ post });
  }));

  api.post('/posts', express.json({ limit: '2mb' }), wrap(async (req, res) => res.status(201).json(await service.create(req.body))));

  api.put('/posts/:id', express.json({ limit: '2mb' }), wrap(async (req, res) => {
    if (!validId(req.params.id)) throw httpError(400, 'ID inválido');
    res.json(await service.update(req.params.id, req.body));
  }));

  api.delete('/posts/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) throw httpError(400, 'ID inválido');
    await service.remove(req.params.id);
    res.json({ ok: true });
  }));

  api.post('/upload',
    (req, res, next) => upload.single('image')(req, res, (err) => {
      if (!err) return next();
      next(err.code === 'LIMIT_FILE_SIZE' ? httpError(413, 'La imagen supera los 5 MB') : httpError(400, err.message));
    }),
    wrap(async (req, res) => {
      if (!req.file) throw httpError(400, 'No se recibió ninguna imagen');
      res.json({ url: await storage.upload(req.file) });
    }));

  api.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (!err.status) console.error('[blog] error admin:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
  });

  router.use('/api', api);
  return router;
}

module.exports = { createAdminRouter };
