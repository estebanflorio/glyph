(() => {
  const ADMIN = document.body.dataset.admin;
  const PUBLIC = document.body.dataset.public;
  const $ = (s) => document.querySelector(s);
  let current = { id: null };

  // Si tu middleware usa Bearer token, definí window.BLOG_AUTH_HEADERS = () => ({ Authorization: 'Bearer ...' })
  const authHeaders = async () => (window.BLOG_AUTH_HEADERS ? await window.BLOG_AUTH_HEADERS() : {});

  async function api(path, opts = {}) {
    const res = await fetch(`${ADMIN}/api${path}`, {
      credentials: 'same-origin',
      ...opts,
      headers: { ...(await authHeaders()), ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  // Achica la imagen en el navegador (máx. 1600 px, WEBP) para que entre en el límite de 900 KB
  async function shrink(file) {
    if (file.type === 'image/gif') return file;            // los GIF animados no se tocan
    const bmp = await createImageBitmap(file);
    let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
      if (blob && blob.size <= 880 * 1024) return new File([blob], 'imagen.webp', { type: 'image/webp' });
      scale *= 0.8;
    }
    throw new Error('No se pudo achicar la imagen lo suficiente. Probá con una más chica.');
  }

  async function upload(file) {
    file = await shrink(file);
    const fd = new FormData();
    fd.append('image', file);
    const data = await api('/upload', { method: 'POST', body: fd });
    return data.url;
  }

  const setStatus = (t) => { $('#status').textContent = t || ''; };

  // ---------- Quill ----------
  function pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const alt = window.prompt('Texto alternativo de la imagen (describí la captura, ayuda al SEO):', '') || '';
      const range = quill.getSelection(true);
      try {
        setStatus('Subiendo imagen…');
        const url = await upload(file);
        quill.insertEmbed(range.index, 'image', url, 'user');
        const img = [...quill.root.querySelectorAll('img')].find((i) => i.getAttribute('src') === url);
        if (img) img.setAttribute('alt', alt);
        quill.setSelection(range.index + 1);
        setStatus('');
      } catch (e) {
        setStatus('');
        alert(e.message);
      }
    };
    input.click();
  }

  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Escribí tu artículo…',
    modules: {
      toolbar: {
        container: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block', 'link', 'image'],
          [{ align: [] }],
          ['clean'],
        ],
        handlers: { image: pickImage },
      },
    },
  });

  // ---------- Vistas ----------
  const show = (view) => {
    $('#listView').hidden = view !== 'list';
    $('#editView').hidden = view !== 'edit';
  };

  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('es-AR') : '');

  async function loadList() {
    const { posts } = await api('/posts');
    const tbody = $('#rows');
    tbody.innerHTML = '';
    $('#emptyMsg').hidden = posts.length > 0;
    posts.forEach((p) => {
      const tr = document.createElement('tr');
      const tdTitle = document.createElement('td'); tdTitle.textContent = p.title;
      const tdState = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge' + (p.status === 'published' ? ' pub' : '');
      badge.textContent = p.status === 'published' ? 'Publicado' : 'Borrador';
      tdState.appendChild(badge);
      const tdDate = document.createElement('td'); tdDate.textContent = fmt(p.updatedAt);
      const tdAct = document.createElement('td');
      const bEdit = document.createElement('button'); bEdit.className = 'btn'; bEdit.textContent = 'Editar';
      bEdit.onclick = () => openPost(p.id);
      const bDel = document.createElement('button'); bDel.className = 'btn danger'; bDel.textContent = 'Borrar';
      bDel.onclick = async () => {
        if (!confirm(`¿Borrar "${p.title}"? No se puede deshacer.`)) return;
        try { await api(`/posts/${p.id}`, { method: 'DELETE' }); loadList(); } catch (e) { alert(e.message); }
      };
      tdAct.append(bEdit, ' ', bDel);
      tr.append(tdTitle, tdState, tdDate, tdAct);
      tbody.appendChild(tr);
    });
  }

  function fillForm(p) {
    current = { id: p.id || null, slug: p.slug || '', coverUrl: p.coverUrl || '' };
    $('#title').value = p.title || '';
    $('#slug').value = p.slug || '';
    $('#excerpt').value = p.excerpt || '';
    $('#seoTitle').value = p.seoTitle || '';
    $('#coverAlt').value = p.coverAlt || '';
    $('#tags').value = (p.tags || []).join(', ');
    $('#statusSel').value = p.status || 'draft';
    $('#coverFile').value = '';
    const prev = $('#coverPreview');
    prev.hidden = !current.coverUrl;
    prev.src = current.coverUrl || '';
    quill.setContents([]);
    if (p.content) quill.clipboard.dangerouslyPasteHTML(0, p.content);
    updateCount();
    const v = $('#btnView');
    v.hidden = !(p.id && p.status === 'published');
    v.href = `${PUBLIC}/${p.slug || ''}`;
    setStatus('');
    show('edit');
  }

  async function openPost(id) {
    try { const { post } = await api(`/posts/${id}`); fillForm(post); } catch (e) { alert(e.message); }
  }

  function updateCount() { $('#excCount').textContent = `${$('#excerpt').value.length}/155 recomendado`; }
  $('#excerpt').addEventListener('input', updateCount);

  $('#coverFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setStatus('Subiendo portada…');
      current.coverUrl = await upload(file);
      $('#coverPreview').src = current.coverUrl;
      $('#coverPreview').hidden = false;
      setStatus('Portada subida (recordá guardar)');
    } catch (err) { setStatus(''); alert(err.message); }
  });

  $('#btnNew').onclick = () => fillForm({});
  $('#btnBack').onclick = () => { show('list'); loadList(); };

  $('#btnSave').onclick = async () => {
    const html = quill.root.innerHTML;
    const empty = quill.getText().trim().length === 0 && !quill.root.querySelector('img');
    const body = {
      title: $('#title').value,
      slug: $('#slug').value,
      excerpt: $('#excerpt').value,
      seoTitle: $('#seoTitle').value,
      coverUrl: current.coverUrl || '',
      coverAlt: $('#coverAlt').value,
      tags: $('#tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      status: $('#statusSel').value,
      content: empty ? '' : html,
    };
    if (body.status === 'published' && (!body.excerpt || !body.coverUrl)) {
      if (!confirm('Falta la descripción o la portada, que ayudan al SEO. ¿Publicar igual?')) return;
    }
    try {
      setStatus('Guardando…');
      const r = current.id
        ? await api(`/posts/${current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await api('/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      current.id = r.id;
      $('#slug').value = r.slug;
      const v = $('#btnView');
      v.hidden = body.status !== 'published';
      v.href = `${PUBLIC}/${r.slug}`;
      setStatus('Guardado ✓');
    } catch (e) { setStatus(''); alert(e.message); }
  };

  show('list');
  Promise.resolve(window.BLOG_READY).then(loadList).catch((e) => alert(e.message));
})();
