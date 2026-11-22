const crypto = require('crypto');
const { httpError } = require('./errors');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function looksLikeImage(buf, mime) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.slice(0, 4).toString('hex') === '89504e47';
  if (mime === 'image/gif') return buf.slice(0, 4).toString('ascii') === 'GIF8';
  if (mime === 'image/webp') return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function createStorage(admin, { folder, bucketName }) {
  return {
    async upload(file) {
      const ext = EXT[file.mimetype];
      if (!ext || !looksLikeImage(file.buffer, file.mimetype)) {
        throw httpError(400, 'Formato no permitido (usá JPG, PNG, WEBP o GIF)');
      }
      let bucket;
      try {
        bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
      } catch (e) {
        throw httpError(500, 'Firebase Storage no está configurado (falta storageBucket)');
      }
      const token = crypto.randomUUID();
      const name = `${folder}/${new Date().getFullYear()}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
      await bucket.file(name).save(file.buffer, {
        resumable: false,
        metadata: {
          contentType: file.mimetype,
          cacheControl: 'public, max-age=31536000',
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(name)}?alt=media&token=${token}`;
    },
  };
}

module.exports = { createStorage };
