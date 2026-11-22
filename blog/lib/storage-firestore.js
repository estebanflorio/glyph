// Almacenamiento de imágenes en Firestore (alternativa sin Firebase Storage / sin plan Blaze).
// Cada imagen se guarda como un documento (máx. ~900 KB: el editor las comprime antes de subirlas)
// y se sirve desde  <basePath>/img/<id>.<ext>  con caché larga.
const crypto = require('crypto');
const express = require('express');
const { httpError } = require('./errors');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_BYTES = 900 * 1024;               // el límite de un documento de Firestore es 1 MiB

function looksLikeImage(buf, mime) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.slice(0, 4).toString('hex') === '89504e47';
  if (mime === 'image/gif') return buf.slice(0, 4).toString('ascii') === 'GIF8';
  if (mime === 'image/webp') return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function createFirestoreStorage(db, { collection = 'blog_images', siteUrl = '', basePath = '/blog' } = {}) {
  const col = db.collection(collection);

  const storage = {
    async upload(file) {
      const ext = EXT[file.mimetype];
      if (!ext || !looksLikeImage(file.buffer, file.mimetype)) {
        throw httpError(400, 'Formato no permitido (usá JPG, PNG, WEBP o GIF)');
      }
      if (file.buffer.length > MAX_BYTES) {
        throw httpError(413, 'La imagen pesa demasiado (máx. 900 KB). El editor la comprime sola; probá con otra o con menos resolución.');
      }
      const id = crypto.randomBytes(10).toString('hex');
      await col.doc(id).set({ mime: file.mimetype, data: file.buffer, size: file.buffer.length, createdAt: Date.now() });
      return `${siteUrl}${basePath}/img/${id}.${ext}`;
    },
  };

  // Router público que entrega las imágenes (Cloudflare las cachea por la extensión del archivo)
  const router = express.Router();
  router.get('/:file', async (req, res, next) => {
    try {
      const m = /^([a-f0-9]{20})\.(jpg|png|webp|gif)$/.exec(req.params.file);
      if (!m) return res.status(404).end();
      const doc = await col.doc(m[1]).get();
      if (!doc.exists) return res.status(404).end();
      const d = doc.data();
      if (MIME[m[2]] !== d.mime) return res.status(404).end();
      res.set({
        'Content-Type': d.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(Buffer.isBuffer(d.data) ? d.data : Buffer.from(d.data));
    } catch (e) { next(e); }
  });

  return { storage, router };
}

module.exports = { createFirestoreStorage };
