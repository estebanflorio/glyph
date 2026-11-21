(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const uploadTrigger = $('uploadTrigger'), fileInput = $('fileInput');
  const previewCanvas = $('previewCanvas'), previewCtx = previewCanvas.getContext('2d');
  const placeholder = $('placeholder'), downloadBtn = $('downloadBtn');
  const canvasWrapper = $('canvasWrapper'), infoText = $('infoText'), zoomMode = $('zoomMode');
  const compareMode = $('compareMode'), compareSlider = $('compareSlider'), compareHint = $('compareHint');
  const compareCanvas = $('compareCanvas'), compareLine = $('compareLine');
  const presetSelect = $('presetSelect'), presetSave = $('presetSave'), presetDelete = $('presetDelete');
  const sampleBtn = $('sampleBtn'), sampleSize = $('sampleSize');

  const controls = {
    printWidth: $('printWidth'), lpi: $('lpi'), contrast: $('contrast'), sharpness: $('sharpness'),
    dotShape: $('dotShape'), angle: $('angle'), maxDot: $('maxDot'), minThresh: $('minThresh'),
    colorMode: $('colorMode'), inkColor: $('inkColor'), invertMode: $('invertMode'), hardEdges: $('hardEdges'),
    toneGamma: $('toneGamma'), minDotPx: $('minDotPx'), linearLum: $('linearLum'),
  };
  const labels = [
    ['printWidth', 'printWidthVal', (v) => v + ' cm'], ['lpi', 'lpiVal', (v) => v + ' LPI'],
    ['contrast', 'contrastVal', (v) => v + '%'], ['sharpness', 'sharpVal', (v) => v + '%'],
    ['angle', 'angleVal', (v) => v + '°'], ['maxDot', 'maxDotVal', (v) => v + '%'],
    ['minThresh', 'minThreshVal', (v) => v + '%'],
    ['toneGamma', 'toneGammaVal', (v) => parseFloat(v).toFixed(2)],
    ['minDotPx', 'minDotPxVal', (v) => parseFloat(v).toFixed(1) + ' px'],
  ];

  const VIEW_W = 1000, VIEW_H = 800; // ventana del zoom 100%
  const MARGIN = 300, EDGE = 100;     // recuadro extra alrededor de la ventana (para arrastrar sin re-renderizar)
  let tile = null, tileDirty = true;
  let hasSource = false, srcAspect = 1, currentFile = null;
  let origBmp = null;            // copia del original para el comparador antes/después
  let currentBg = '#09090b';     // prenda elegida
  let zoom = { x: 0, y: 0 };

  /* ---------------- Backend: Worker con fallback al hilo principal ---------------- */
  let worker = null, engine = null, useWorker = false, reqId = 0;
  const pending = new Map();

  const makeDomCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  function callWorker(msg, transfer) {
    return new Promise((res, rej) => {
      const id = ++reqId;
      pending.set(id, { res, rej });
      worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  function onWorkerMessage(e) {
    const m = e.data, p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  }

  async function fallbackToMain() {
    if (worker) { worker.terminate(); worker = null; }
    useWorker = false;
    engine = new HalftoneEngine(makeDomCanvas);
    pending.forEach((p) => p.rej(new Error('worker-fallback')));
    pending.clear();
    if (currentFile) {
      try { await loadSource(currentFile); } catch (err) { showError(err); }
    }
  }

  function initBackend() {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        worker = new Worker('halftone-worker.js');
        worker.onmessage = onWorkerMessage;
        worker.onerror = (e) => { if (e.preventDefault) e.preventDefault(); fallbackToMain(); };
        useWorker = true;
        return;
      } catch (_) { /* cae al hilo principal */ }
    }
    engine = new HalftoneEngine(makeDomCanvas);
  }

  async function renderJob(params, exp) {
    if (useWorker) return callWorker({ type: 'render', params, export: exp });
    await new Promise((r) => setTimeout(r, 0)); // deja repintar la UI antes de bloquear
    const out = engine.render(params);
    if (exp) {
      const blob = await new Promise((r) => out.canvas.toBlob(r, 'image/png'));
      return { blob, info: out.info };
    }
    return { bitmap: out.canvas, info: out.info };
  }

  async function loadSource(file) {
    const bmp = await createImageBitmap(file);
    srcAspect = bmp.height / bmp.width;
    if (origBmp && origBmp.close) origBmp.close();
    origBmp = await createImageBitmap(file, bmp.width > 4096 ? { resizeWidth: 4096, resizeQuality: 'high' } : undefined);
    if (useWorker) await callWorker({ type: 'source', bitmap: bmp }, [bmp]);
    else engine.setSource(bmp);
    hasSource = true;
    dropTile();
    placeholder.style.display = 'none';
    previewCanvas.style.display = 'block';
    downloadBtn.disabled = false;
    sampleBtn.disabled = false;
    centerZoom();
    requestRender();
  }

  /* ---------------- Parámetros y zoom ---------------- */
  function outputDims() {
    const widthCm = parseFloat(controls.printWidth.value);
    return {
      widthCm,
      fullW: Math.round((widthCm / 2.54) * 300),
      fullH: Math.round(((widthCm * srcAspect) / 2.54) * 300),
    };
  }
  function centerZoom() {
    const { fullW, fullH } = outputDims();
    zoom.x = Math.round(Math.max(0, (fullW - VIEW_W) / 2));
    zoom.y = Math.round(Math.max(0, (fullH - VIEW_H) / 2));
  }
  function clampZoom() {
    const { fullW, fullH } = outputDims();
    zoom.x = Math.round(clamp(zoom.x, 0, Math.max(0, fullW - VIEW_W)));
    zoom.y = Math.round(clamp(zoom.y, 0, Math.max(0, fullH - VIEW_H)));
  }

  function readParams(mode) {
    return {
      mode,
      region: mode === 'region' ? { x: zoom.x - MARGIN, y: zoom.y - MARGIN, w: VIEW_W + 2 * MARGIN, h: VIEW_H + 2 * MARGIN } : null,
      widthCm: parseFloat(controls.printWidth.value),
      lpi: parseInt(controls.lpi.value, 10),
      contrast: parseInt(controls.contrast.value, 10),
      sharpness: parseInt(controls.sharpness.value, 10),
      shape: controls.dotShape.value,
      angle: parseFloat(controls.angle.value),
      maxDot: parseInt(controls.maxDot.value, 10),
      minThresh: parseInt(controls.minThresh.value, 10),
      mono: controls.colorMode.value === 'mono',
      inkHex: controls.inkColor.value,
      invert: controls.invertMode.checked,
      hardEdges: controls.hardEdges.checked,
      toneGamma: parseFloat(controls.toneGamma.value),
      linearLum: controls.linearLum.checked,
      minDotPx: parseFloat(controls.minDotPx.value),
    };
  }

  /* ---------------- Render de preview (último gana) ---------------- */
  let busy = false, dirty = false;

  function viewSize() {
    const { fullW, fullH } = outputDims();
    return { vw: Math.min(VIEW_W, fullW), vh: Math.min(VIEW_H, fullH), fullW, fullH };
  }
  function tileContainsView() {
    if (!tile) return false;
    const { vw, vh } = viewSize();
    return zoom.x >= tile.x && zoom.y >= tile.y &&
           zoom.x + vw <= tile.x + tile.w && zoom.y + vh <= tile.y + tile.h;
  }
  function needsTile() {
    if (!tile || tileDirty || !tileContainsView()) return true;
    const { vw, vh, fullW, fullH } = viewSize();
    if (tile.x > 0 && zoom.x < tile.x + EDGE) return true;
    if (tile.x + tile.w < fullW && zoom.x + vw > tile.x + tile.w - EDGE) return true;
    if (tile.y > 0 && zoom.y < tile.y + EDGE) return true;
    if (tile.y + tile.h < fullH && zoom.y + vh > tile.y + tile.h - EDGE) return true;
    return false;
  }
  function paintTile() {
    const { vw, vh } = viewSize();
    if (previewCanvas.width !== vw) previewCanvas.width = vw;
    if (previewCanvas.height !== vh) previewCanvas.height = vh;
    previewCtx.clearRect(0, 0, vw, vh);
    previewCtx.drawImage(tile.bmp, zoom.x - tile.x, zoom.y - tile.y, vw, vh, 0, 0, vw, vh);
    drawCompare();
  }
  function dropTile() {
    if (tile && tile.bmp && tile.bmp.close) tile.bmp.close();
    tile = null;
    tileDirty = true;
  }
  function setInfo(i, extra) {
    infoText.textContent =
      `Salida: ${controls.printWidth.value}×${i.heightCm.toFixed(1)} cm (${i.fullW}×${i.fullH}px @ 300 DPI) | ` +
      `Render: ${i.ms}ms ${useWorker ? '(worker)' : ''}${extra || ''}`;
  }

  async function renderOnce() {
    if (zoomMode.checked) {
      if (needsTile()) {
        const res = await renderJob(readParams('region'), false);
        if (tile && tile.bmp && tile.bmp.close) tile.bmp.close();
        tile = { bmp: res.bitmap, x: res.info.region.x, y: res.info.region.y, w: res.info.region.w, h: res.info.region.h };
        tileDirty = false;
        setInfo(res.info, ' | Zoom 100%');
      }
      if (!tileContainsView()) { dirty = true; return; } // el usuario se movió mientras renderizaba
      paintTile();
    } else {
      const res = await renderJob(readParams('fit'), false);
      const img = res.bitmap;
      previewCanvas.width = img.width;
      previewCanvas.height = img.height;
      previewCtx.drawImage(img, 0, 0);
      if (img.close) img.close();
      setInfo(res.info, '');
      drawCompare();
    }
  }

  function requestRender() {
    if (!hasSource) return;
    dirty = true;
    if (!busy) pump();
  }

  async function pump() {
    busy = true;
    while (dirty) {
      dirty = false;
      try {
        await renderOnce();
      } catch (err) {
        if (err.message !== 'worker-fallback') showError(err);
      }
    }
    busy = false;
  }

  function showError(err) {
    infoText.textContent = 'Error: ' + ((err && err.message) || err);
  }

  /* ---------------- UI ---------------- */
  function updateLabels() {
    labels.forEach(([ctl, out, fmt]) => { $(out).textContent = fmt(controls[ctl].value); });
    $('tintControl').style.visibility = controls.colorMode.value === 'mono' ? 'visible' : 'hidden';
  }

  Object.entries(controls).forEach(([name, el]) => {
    const handler = () => {
      tileDirty = true;
      updateLabels();
      if (name === 'printWidth' && hasSource) { centerZoom(); }
      saveLast();
      requestRender();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  zoomMode.addEventListener('change', () => {
    previewCanvas.style.cursor = zoomMode.checked ? 'grab' : 'default';
    previewCanvas.style.touchAction = zoomMode.checked ? 'none' : '';
    dropTile();
    if (hasSource) { centerZoom(); requestRender(); }
  });

  let drag = null;
  previewCanvas.addEventListener('pointerdown', (e) => {
    if (!zoomMode.checked) return;
    drag = { x: e.clientX, y: e.clientY };
    previewCanvas.setPointerCapture(e.pointerId);
    previewCanvas.style.cursor = 'grabbing';
  });
  previewCanvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = previewCanvas.clientWidth / previewCanvas.width || 1;
    zoom.x -= (e.clientX - drag.x) / k;
    zoom.y -= (e.clientY - drag.y) / k;
    drag = { x: e.clientX, y: e.clientY };
    clampZoom();
    if (!tileDirty && tileContainsView()) paintTile(); // instantáneo, sin re-renderizar
    if (needsTile()) requestRender();                   // solo si se acerca al borde del recuadro
  });
  const endDrag = () => { drag = null; if (zoomMode.checked) previewCanvas.style.cursor = 'grab'; };
  previewCanvas.addEventListener('pointerup', endDrag);
  previewCanvas.addEventListener('pointercancel', endDrag);

  document.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
      const bg = sw.dataset.bg;
      if (bg === 'checker') canvasWrapper.style.background = '';
      else { canvasWrapper.style.backgroundImage = 'none'; canvasWrapper.style.backgroundColor = bg; }
      currentBg = bg;
      saveLast();
      syncOverlay();
    });
  });

  uploadTrigger.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    currentFile = file;
    try {
      await loadSource(file);
    } catch (err) {
      if (err.message === 'worker-fallback') return;
      hasSource = false;
      placeholder.style.display = 'block';
      previewCanvas.style.display = 'none';
      placeholder.textContent = 'No se pudo leer este formato de imagen. Probá con PNG o JPG.';
    }
  });

  /* ---------------- Exportación PNG con 300 DPI (chunk pHYs) ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function setPngDpi(blob, dpi) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
    dv.setUint32(8, ppm);
    dv.setUint32(12, ppm);
    chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const at = 33; // firma (8) + IHDR (25)
    const out = new Uint8Array(buf.length + chunk.length);
    out.set(buf.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(buf.subarray(at), at + chunk.length);
    return new Blob([out], { type: 'image/png' });
  }

  downloadBtn.addEventListener('click', async () => {
    if (!hasSource) return;
    const { fullW, fullH } = outputDims();
    if (fullW * fullH > 16000000 &&
        !confirm(`La imagen final es de ${fullW}×${fullH}px (${(fullW * fullH / 1e6).toFixed(1)} Mpx). En algunos celulares puede fallar. ¿Continuar?`)) return;
    const label = downloadBtn.textContent;
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Generando PNG HD…';
    try {
      const res = await renderJob(readParams('full'), true);
      if (!res.blob) throw new Error('No se pudo generar el PNG (imagen demasiado grande).');
      const finalBlob = await setPngDpi(res.blob, 300);
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `semitono-dtf-${controls.printWidth.value}cm-${controls.lpi.value}lpi.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      alert('Error al exportar: ' + err.message + '\nProbá con menos ancho de impresión.');
    } finally {
      downloadBtn.textContent = label;
      downloadBtn.disabled = false;
    }
  });

  /* ---------------- Comparador antes / después ---------------- */
  function syncOverlay() {
    if (!compareMode.checked || !hasSource || previewCanvas.style.display === 'none') {
      compareCanvas.style.display = 'none';
      compareLine.style.display = 'none';
      return;
    }
    const pc = previewCanvas;
    const box = { left: pc.offsetLeft + 'px', top: pc.offsetTop + 'px', width: pc.clientWidth + 'px', height: pc.clientHeight + 'px', display: 'block' };
    Object.assign(compareCanvas.style, box);
    const cs = getComputedStyle(canvasWrapper); // el fondo del original replica la prenda elegida
    compareCanvas.style.backgroundColor = cs.backgroundColor;
    compareCanvas.style.backgroundImage = cs.backgroundImage;
    compareCanvas.style.backgroundSize = cs.backgroundSize;
    compareCanvas.style.backgroundPosition = cs.backgroundPosition;
    const v = parseInt(compareSlider.value, 10);
    compareCanvas.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    Object.assign(compareLine.style, {
      display: 'block', left: (pc.offsetLeft + (pc.clientWidth * v) / 100) + 'px',
      top: pc.offsetTop + 'px', height: pc.clientHeight + 'px',
    });
  }

  function drawCompare() {
    if (!compareMode.checked || !origBmp || !hasSource) { syncOverlay(); return; }
    const w = previewCanvas.width, h = previewCanvas.height;
    if (compareCanvas.width !== w) compareCanvas.width = w;
    if (compareCanvas.height !== h) compareCanvas.height = h;
    const ctx = compareCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (zoomMode.checked) {
      const { fullW, fullH } = outputDims();
      const kx = origBmp.width / fullW, ky = origBmp.height / fullH;
      ctx.drawImage(origBmp, zoom.x * kx, zoom.y * ky, w * kx, h * ky, 0, 0, w, h);
    } else {
      ctx.drawImage(origBmp, 0, 0, w, h);
    }
    syncOverlay();
  }

  compareMode.addEventListener('change', () => {
    compareSlider.style.display = compareMode.checked ? '' : 'none';
    compareHint.style.display = compareMode.checked ? '' : 'none';
    drawCompare();
  });
  compareSlider.addEventListener('input', syncOverlay);
  window.addEventListener('resize', syncOverlay);
  if (window.ResizeObserver) new ResizeObserver(() => syncOverlay()).observe(previewCanvas);

  /* ---------------- Recordar ajustes y presets (localStorage) ---------------- */
  const LS_LAST = 'glyph.semitonos.last.v1', LS_PRESETS = 'glyph.semitonos.presets.v1';
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* modo privado o sin espacio */ } };

  function collectSettings() {
    const o = {};
    Object.entries(controls).forEach(([k, el]) => { o[k] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  }
  function applySettings(o) {
    if (!o || typeof o !== 'object') return;
    Object.entries(controls).forEach(([k, el]) => {
      if (!(k in o)) return;
      if (el.type === 'checkbox') { el.checked = !!o[k]; return; }
      if (el.tagName === 'SELECT' && ![...el.options].some((op) => op.value === String(o[k]))) return;
      el.value = o[k];
    });
    updateLabels();
  }
  let saveTimer = null;
  function saveLast() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => lsSet(LS_LAST, { s: collectSettings(), bg: currentBg }), 250);
  }
  function afterSettingsChanged() {
    tileDirty = true;
    if (hasSource) { centerZoom(); requestRender(); }
    saveLast();
  }

  const DEFAULTS = collectSettings();
  const getPresets = () => { const p = lsGet(LS_PRESETS); return p && typeof p === 'object' ? p : {}; };

  function refreshPresetSelect(selected) {
    const presets = getPresets();
    presetSelect.innerHTML = '';
    const add = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; presetSelect.appendChild(o); };
    add('', '— Presets —');
    add('__default', 'Valores por defecto');
    Object.keys(presets).sort().forEach((n) => add('u:' + n, n));
    presetSelect.value = selected || '';
    presetDelete.disabled = !(presetSelect.value || '').startsWith('u:');
  }

  presetSelect.addEventListener('change', () => {
    const v = presetSelect.value;
    if (v === '__default') applySettings(DEFAULTS);
    else if (v.startsWith('u:')) applySettings(getPresets()[v.slice(2)]);
    presetDelete.disabled = !v.startsWith('u:');
    if (v) afterSettingsChanged();
  });

  presetSave.addEventListener('click', () => {
    let name = prompt('Nombre del preset (ej. "Remera negra · foto"):');
    if (!name) return;
    name = name.trim().slice(0, 40);
    if (!name) return;
    const presets = getPresets();
    if (presets[name] && !confirm(`Ya existe "${name}". ¿Lo reemplazo?`)) return;
    presets[name] = collectSettings();
    lsSet(LS_PRESETS, presets);
    refreshPresetSelect('u:' + name);
  });

  presetDelete.addEventListener('click', () => {
    const v = presetSelect.value;
    if (!v.startsWith('u:')) return;
    const name = v.slice(2);
    if (!confirm(`¿Borrar el preset "${name}"?`)) return;
    const presets = getPresets();
    delete presets[name];
    lsSet(LS_PRESETS, presets);
    refreshPresetSelect('');
  });

  /* ---------------- Muestra de prueba (recorte 1:1 a 300 DPI) ---------------- */
  sampleBtn.addEventListener('click', async () => {
    if (!hasSource) return;
    const cm = parseFloat(sampleSize.value);
    const px = Math.round((cm / 2.54) * 300);
    const { fullW, fullH } = outputDims();
    const { vw, vh } = viewSize();
    const cx = zoomMode.checked ? zoom.x + vw / 2 : fullW / 2;
    const cy = zoomMode.checked ? zoom.y + vh / 2 : fullH / 2;
    const params = readParams('region');
    params.region = { x: Math.round(cx - px / 2), y: Math.round(cy - px / 2), w: px, h: px };
    const label = sampleBtn.textContent;
    sampleBtn.disabled = true;
    sampleBtn.textContent = 'Generando…';
    try {
      const res = await renderJob(params, true);
      if (!res.blob) throw new Error('No se pudo generar la muestra.');
      const finalBlob = await setPngDpi(res.blob, 300);
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `muestra-${cm}cm-${controls.lpi.value}lpi.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      alert('Error al exportar la muestra: ' + err.message);
    } finally {
      sampleBtn.textContent = label;
      sampleBtn.disabled = false;
    }
  });

  initBackend();
  const last = lsGet(LS_LAST);
  if (last) {
    applySettings(last.s);
    const sw = [...document.querySelectorAll('.swatch')].find((x) => x.dataset.bg === last.bg);
    if (sw) sw.click();
  }
  refreshPresetSelect('');
  updateLabels();
})();
