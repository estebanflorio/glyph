// seed-blog.mjs — carga los artículos de blog-articles/ como BORRADORES en tu blog.
// Uso (desde la carpeta del proyecto, con tu .env):   node seed-blog.mjs
// Es seguro correrlo más de una vez: omite los artículos que ya existen.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { createService } = require('./blog/lib/service.js');

initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore();
const service = createService(db, 'blog_posts');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blog-articles');
const items = JSON.parse(fs.readFileSync(path.join(dir, 'articles.json'), 'utf8'));

const existing = await db.collection('blog_posts').get();
const slugs = new Set(existing.docs.map((d) => d.data().slug));

for (const a of items) {
  if (slugs.has(a.slug)) { console.log('  ya existe, se omite:', a.slug); continue; }
  const content = fs.readFileSync(path.join(dir, a.file), 'utf8');
  const { file, ...meta } = a;
  const r = await service.create({ ...meta, content, status: 'draft' });
  console.log('  ✓ borrador creado:', r.slug);
}

console.log('\nListo. Revisalos y publicalos desde https://glyph.com.ar/admin/blog\n');
process.exit(0);
