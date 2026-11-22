const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }) : '');

// Personalizá los colores con variables CSS (o pasá opts.layout para usar el header/footer de tu sitio)
const CSS = `
.blog{--blog-accent:#6c4cf1;--blog-text:#1a1a1a;--blog-muted:#6b7280;max-width:760px;margin:0 auto;padding:24px 16px 64px;font:17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--blog-text)}
.blog a{color:var(--blog-accent)}
.blog h1{font-size:2rem;line-height:1.2;margin:.4em 0}
.blog .meta{color:var(--blog-muted);font-size:.9rem;margin-bottom:1.2rem}
.blog .crumbs{font-size:.85rem;color:var(--blog-muted)}
.blog .cover{width:100%;height:auto;border-radius:12px;margin:0 0 1.5rem;display:block}
.blog-content h2{font-size:1.5rem;margin:1.8em 0 .5em}
.blog-content h3{font-size:1.2rem;margin:1.5em 0 .4em}
.blog-content img{max-width:100%;height:auto;border-radius:8px;margin:1rem 0}
.blog-content blockquote{border-left:4px solid var(--blog-accent);margin:1.2rem 0;padding:.2rem 1rem;color:var(--blog-muted)}
.blog-content pre{background:#111827;color:#e5e7eb;padding:14px;border-radius:8px;overflow:auto;font-size:.9rem}
.blog-content .ql-align-center{text-align:center}.blog-content .ql-align-right{text-align:right}.blog-content .ql-align-justify{text-align:justify}
.blog-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:1.5rem}
.blog-card{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;text-decoration:none!important;color:inherit!important;display:block}
.blog-card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.blog-card div{padding:14px}
.blog-card h2{font-size:1.1rem;margin:0 0 .4rem;line-height:1.3}
.blog-card p{margin:0;font-size:.9rem;color:var(--blog-muted);line-height:1.5}
.blog .tags span{display:inline-block;background:#f3f4f6;border-radius:999px;padding:2px 10px;font-size:.8rem;margin:0 6px 6px 0}
.blog .cta{background:#f5f3ff;border-radius:12px;padding:20px;margin:2.5rem 0;text-align:center}
.blog .cta a.btn{display:inline-block;background:var(--blog-accent);color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:.5rem}
`;

function page(config, o) {
  const head = [
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    `<link rel="canonical" href="${esc(o.canonical)}">`,
    o.noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow,max-image-preview:large">',
    `<meta property="og:type" content="${o.ogType || 'website'}">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`,
    `<meta property="og:site_name" content="${esc(config.siteName)}">`,
    '<meta property="og:locale" content="es_AR">',
    o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}">` : '',
    `<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
    `<style>${CSS}</style>`,
  ].filter(Boolean).join('\n');
  const body = `<div class="blog">${o.body}</div>`;
  if (config.layout) return config.layout({ head, body, title: o.title });
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${head}</head><body style="margin:0">${body}</body></html>`;
}

function cta(config) {
  if (!config.ctaUrl) return '';
  return `<div class="cta"><strong>${esc(config.ctaTitle)}</strong><br><a class="btn" href="${esc(config.ctaUrl)}">${esc(config.ctaText)}</a></div>`;
}

function listView(config, base, posts) {
  const cards = posts.map((p) => `
<a class="blog-card" href="${esc(config.basePath)}/${esc(p.slug)}">
  ${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="${esc(p.coverAlt || p.title)}" loading="lazy">` : ''}
  <div><h2>${esc(p.title)}</h2><p>${esc(p.excerpt)}</p></div>
</a>`).join('');
  const title = `Blog | ${config.siteName}`;
  const description = config.blogDescription;
  return page(config, {
    title, description, canonical: `${base}${config.basePath}`,
    ogImage: config.defaultOgImage,
    jsonLd: { '@context': 'https://schema.org', '@type': 'Blog', name: title, description, url: `${base}${config.basePath}` },
    body: `<h1>Blog</h1><p class="meta">${esc(description)}</p>
${posts.length ? `<div class="blog-grid">${cards}</div>` : '<p>Pronto publicaremos los primeros artículos.</p>'}`,
  });
}

function postView(config, base, p) {
  const url = `${base}${config.basePath}/${p.slug}`;
  const description = p.excerpt || `${p.title} - ${config.siteName}`;
  const image = p.coverUrl || config.defaultOgImage;
  return page(config, {
    title: `${p.seoTitle || p.title} | ${config.siteName}`,
    description, canonical: url, ogImage: image, ogType: 'article',
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: p.title, description,
      image: image ? [image] : undefined,
      datePublished: new Date(p.publishedAt || p.createdAt).toISOString(),
      dateModified: new Date(p.updatedAt || p.publishedAt).toISOString(),
      author: { '@type': 'Organization', name: config.siteName },
      publisher: { '@type': 'Organization', name: config.siteName },
      mainEntityOfPage: url,
      keywords: p.tags && p.tags.length ? p.tags.join(', ') : undefined,
    },
    body: `<article>
<p class="crumbs"><a href="${esc(config.basePath)}">Blog</a> › ${esc(p.title)}</p>
<h1>${esc(p.title)}</h1>
<p class="meta"><time datetime="${new Date(p.publishedAt || p.createdAt).toISOString()}">${fmtDate(p.publishedAt || p.createdAt)}</time> · ${p.minutes} min de lectura</p>
${p.coverUrl ? `<img class="cover" src="${esc(p.coverUrl)}" alt="${esc(p.coverAlt || p.title)}">` : ''}
<div class="blog-content">${p.content}</div>
${p.tags && p.tags.length ? `<p class="tags">${p.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
${cta(config)}
<p><a href="${esc(config.basePath)}">← Volver al blog</a></p>
</article>`,
  });
}

function notFoundView(config, base) {
  return page(config, {
    title: `No encontrado | ${config.siteName}`, description: 'Artículo no encontrado',
    canonical: `${base}${config.basePath}`, noindex: true,
    body: `<h1>Artículo no encontrado</h1><p><a href="${esc(config.basePath)}">Ir al blog</a></p>`,
  });
}

module.exports = { esc, listView, postView, notFoundView };
