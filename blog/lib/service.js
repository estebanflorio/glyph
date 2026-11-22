const sanitizeHtml = require('sanitize-html');
const { httpError } = require('./errors');

const SANITIZE_OPTIONS = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'strong', 'em', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'pre', 'code', 'hr'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    '*': ['class'],
  },
  allowedClasses: {
    '*': [/^ql-align-(center|right|justify)$/, /^ql-indent-[1-8]$/],
    pre: ['ql-syntax'],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  transformTags: {
    a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener noreferrer' } }),
    img: (tag, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy', alt: attribs.alt || '' } }),
  },
};

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '') || 'articulo';
}

const stripHtml = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });

function readingMinutes(html) {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const httpsOnly = (u) => (/^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

function cleanInput(i = {}) {
  const title = String(i.title || '').trim().slice(0, 140);
  if (!title) throw httpError(400, 'El título es obligatorio');
  return {
    title,
    slugInput: String(i.slug || '').trim(),
    excerpt: String(i.excerpt || '').trim().slice(0, 200),
    seoTitle: String(i.seoTitle || '').trim().slice(0, 70),
    content: sanitizeHtml(String(i.content || ''), SANITIZE_OPTIONS),
    coverUrl: httpsOnly(i.coverUrl),
    coverAlt: String(i.coverAlt || '').trim().slice(0, 140),
    tags: (Array.isArray(i.tags) ? i.tags : [])
      .map((t) => String(t).trim().toLowerCase().slice(0, 30))
      .filter(Boolean)
      .slice(0, 8),
    status: i.status === 'published' ? 'published' : 'draft',
  };
}

function createService(db, collection) {
  const col = db.collection(collection);
  const toPost = (doc) => ({ id: doc.id, ...doc.data() });

  // Caché en memoria de los artículos publicados (5 min). Se invalida al crear/editar/borrar.
  const TTL = 5 * 60 * 1000;
  let memo = null;
  const invalidate = () => { memo = null; };

  async function uniqueSlug(base, excludeId) {
    let candidate = base;
    let n = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await col.where('slug', '==', candidate).limit(1).get();
      if (snap.empty || snap.docs[0].id === excludeId) return candidate;
      candidate = `${base}-${n++}`;
    }
  }

  return {
    async listAll() {
      const snap = await col.get();
      return snap.docs
        .map((d) => { const { content, ...rest } = toPost(d); return rest; })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async listPublished() {
      if (memo && memo.exp > Date.now()) return memo.value;
      const snap = await col.where('status', '==', 'published').get();
      const value = snap.docs
        .map((d) => { const p = toPost(d); p.minutes = readingMinutes(p.content); return p; })
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
      memo = { value, exp: Date.now() + TTL };
      return value;
    },
    async getById(id) {
      const doc = await col.doc(id).get();
      return doc.exists ? toPost(doc) : null;
    },
    async getPublishedBySlug(slug) {
      const list = await this.listPublished();
      return list.find((p) => p.slug === slug) || null;
    },
    async create(input) {
      const { slugInput, ...data } = cleanInput(input);
      const now = Date.now();
      const slug = await uniqueSlug(slugify(slugInput || data.title));
      const ref = await col.add({
        ...data, slug, createdAt: now, updatedAt: now,
        publishedAt: data.status === 'published' ? now : null,
      });
      invalidate();
      return { id: ref.id, slug };
    },
    async update(id, input) {
      const existing = await this.getById(id);
      if (!existing) throw httpError(404, 'Artículo no encontrado');
      const { slugInput, ...data } = cleanInput(input);
      const now = Date.now();
      const slug = await uniqueSlug(slugify(slugInput || existing.slug || data.title), id);
      await col.doc(id).set({
        ...data, slug,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        publishedAt: existing.publishedAt || (data.status === 'published' ? now : null),
      });
      invalidate();
      return { id, slug };
    },
    async remove(id) {
      await col.doc(id).delete();
      invalidate();
    },
  };
}

module.exports = { createService, cleanInput, slugify, readingMinutes, stripHtml };
