/* Worker: corre el motor fuera del hilo de la interfaz */
importScripts('halftone-engine.js');

const engine = new HalftoneEngine((w, h) => new OffscreenCanvas(w, h));

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'source') {
      engine.setSource(m.bitmap);
      self.postMessage({ type: 'done', id: m.id });
    } else if (m.type === 'render') {
      const out = engine.render(m.params);
      if (m.export) {
        const blob = await out.canvas.convertToBlob({ type: 'image/png' });
        self.postMessage({ type: 'done', id: m.id, blob, info: out.info });
      } else {
        const bitmap = out.canvas.transferToImageBitmap();
        self.postMessage({ type: 'done', id: m.id, bitmap, info: out.info }, [bitmap]);
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
