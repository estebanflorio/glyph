/* Motor de semitonos DTF. Sin DOM: funciona en Web Worker (OffscreenCanvas) o en el hilo principal. */
(function (root) {
  'use strict';

  const SRGB_TO_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function sharpen(data, w, h, amount) {
    const s = new Uint8ClampedArray(data);
    const w4 = w * 4, k = 1 + 4 * amount;
    for (let y = 1; y < h - 1; y++) {
      let i = (y * w + 1) * 4;
      for (let x = 1; x < w - 1; x++, i += 4) {
        for (let c = 0; c < 3; c++) {
          const j = i + c;
          data[j] = s[j] * k - amount * (s[j - 4] + s[j + 4] + s[j - w4] + s[j + w4]);
        }
      }
    }
  }

  class HalftoneEngine {
    constructor(makeCanvas) {
      this.makeCanvas = makeCanvas;
      this.src = null;
      this.sample = null;
      this.sampleKey = '';
    }

    setSource(bitmap) {
      if (this.src && this.src.close) this.src.close();
      this.src = bitmap;
      this.sample = null;
      this.sampleKey = '';
    }

    // Muestra de la imagen a la resolución pedida (nunca más que el original), con cache de 1 entrada.
    getSample(sampleW, sharp) {
      const w = Math.max(1, Math.min(sampleW, this.src.width));
      const key = w + '|' + sharp;
      if (this.sample && this.sampleKey === key) return this.sample;
      const h = Math.max(1, Math.round((w * this.src.height) / this.src.width));
      const c = this.makeCanvas(w, h);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.src, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      if (sharp > 0) sharpen(id.data, w, h, (sharp / 100) * 0.8);
      this.sample = { data: id.data, w, h };
      this.sampleKey = key;
      return this.sample;
    }

    /* p.mode: 'fit' (vista completa reducida) | 'region' (recorte 1:1) | 'full' (exportación) */
    render(p) {
      const t0 = now();
      if (!this.src) throw new Error('No hay imagen cargada');
      const aspect = this.src.height / this.src.width;
      const heightCm = p.widthCm * aspect;
      const fullW = Math.round((p.widthCm / 2.54) * 300);
      const fullH = Math.round((heightCm / 2.54) * 300);

      const scale = p.mode === 'fit' ? Math.min(fullW, 950) / fullW : 1;
      const W = Math.max(1, Math.round(fullW * scale));
      const H = Math.max(1, Math.round(fullH * scale));

      let region = { x: 0, y: 0, w: W, h: H };
      if (p.mode === 'region' && p.region) {
        const rw = Math.min(Math.round(p.region.w), W), rh = Math.min(Math.round(p.region.h), H);
        region = {
          x: clamp(Math.round(p.region.x), 0, W - rw),
          y: clamp(Math.round(p.region.y), 0, H - rh),
          w: rw, h: rh
        };
      }

      const sample = this.getSample(p.mode === 'fit' ? 1600 : Math.min(fullW, 4096), p.sharpness);
      const d = sample.data, sw = sample.w, sh = sample.h;
      const ratio = sw / W;

      const cell = (300 / p.lpi) * scale;
      const halfCell = cell / 2;
      const boxS = cell * ratio;                         // lado de la celda en px de muestra
      const step = Math.max(1, Math.floor(boxS / 6));    // máx ~6x6 lecturas por celda

      const angleRad = (p.angle * Math.PI) / 180;
      const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
      const maxScale = p.maxDot / 100;
      const minThresh = p.minThresh / 100;
      const shape = p.shape;
      const mono = p.mono;
      const cFactor = (259 * (p.contrast + 255)) / (255 * (259 - p.contrast));
      const minRadius = Math.max(0.4, p.minDotPx * scale);
      const minHalfThick = Math.max(0.25, p.minDotPx * scale * 0.5);
      const gamma = p.toneGamma;

      const rw = region.w, rh = region.h;
      const canvas = this.makeCanvas(rw, rh);
      const ctx = canvas.getContext('2d');

      // hardEdges (DTF): rasterizador directo sobre píxeles, sin pasar por paths del canvas (mucho más rápido)
      const raster = !!p.hardEdges;
      let imgData = null, buf32 = null;
      const shapeId = shape === 'circle' ? 0 : shape === 'square' ? 1 : shape === 'diamond' ? 2 : 3;
      const dRot = angleRad + 0.785398;
      const dCos = Math.cos(dRot), dSin = Math.sin(dRot);
      let inkPacked = 0;
      if (raster) {
        imgData = ctx.createImageData(rw, rh);
        buf32 = new Uint32Array(imgData.data.buffer);
        const hx = String(p.inkHex || '#ffffff').replace('#', '');
        const ir = parseInt(hx.slice(0, 2), 16) || 0, ig = parseInt(hx.slice(2, 4), 16) || 0, ib = parseInt(hx.slice(4, 6), 16) || 0;
        inkPacked = (0xff000000 | (ib << 16) | (ig << 8) | ir) >>> 0;
      } else {
        ctx.setTransform(1, 0, 0, 1, -region.x, -region.y);
      }

      // Rango de la grilla rotada que cubre la región (anclada al centro de la imagen)
      const cx = W / 2, cy = H / 2;
      let minGx = Infinity, maxGx = -Infinity, minGy = Infinity, maxGy = -Infinity;
      [[region.x, region.y], [region.x + rw, region.y],
       [region.x, region.y + rh], [region.x + rw, region.y + rh]].forEach(([x, y]) => {
        const dx = x - cx, dy = y - cy;
        const gx = dx * cos + dy * sin, gy = -dx * sin + dy * cos;
        if (gx < minGx) minGx = gx; if (gx > maxGx) maxGx = gx;
        if (gy < minGy) minGy = gy; if (gy > maxGy) maxGy = gy;
      });
      const i0 = Math.floor(minGx / cell) - 1, i1 = Math.ceil(maxGx / cell) + 1;
      const j0 = Math.floor(minGy / cell) - 1, j1 = Math.ceil(maxGy / cell) + 1;

      if (!raster && mono) { ctx.fillStyle = p.inkHex; ctx.beginPath(); }

      for (let j = j0; j <= j1; j++) {
        const gy = j * cell;
        for (let i = i0; i <= i1; i++) {
          const gx = i * cell;
          const px = cx + gx * cos - gy * sin;
          const py = cy + gx * sin + gy * cos;
          if (px < region.x - cell || px >= region.x + rw + cell ||
              py < region.y - cell || py >= region.y + rh + cell) continue;

          // Promedio de área de la celda (ponderado por alfa)
          const sxc = px * ratio, syc = py * ratio;
          let x0 = Math.floor(sxc - boxS / 2), x1 = Math.ceil(sxc + boxS / 2) - 1; if (x1 < x0) x1 = x0;
          let y0 = Math.floor(syc - boxS / 2), y1 = Math.ceil(syc + boxS / 2) - 1; if (y1 < y0) y1 = y0;
          if (x1 < 0 || y1 < 0 || x0 >= sw || y0 >= sh) continue;
          if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= sw) x1 = sw - 1; if (y1 >= sh) y1 = sh - 1;

          let sA = 0, sR = 0, sG = 0, sB = 0, n = 0;
          for (let y = y0; y <= y1; y += step) {
            let idx = (y * sw + x0) << 2;
            for (let x = x0; x <= x1; x += step) {
              const a = d[idx + 3];
              sA += a; sR += d[idx] * a; sG += d[idx + 1] * a; sB += d[idx + 2] * a;
              n++; idx += step << 2;
            }
          }
          if (n === 0 || sA <= 0) continue;
          const avgA = sA / (n * 255);
          if (avgA < 0.1) continue;

          let r = cFactor * (sR / sA - 128) + 128;
          let g = cFactor * (sG / sA - 128) + 128;
          let b = cFactor * (sB / sA - 128) + 128;
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;

          const lum = p.linearLum
            ? 0.2126 * SRGB_TO_LIN[r | 0] + 0.7152 * SRGB_TO_LIN[g | 0] + 0.0722 * SRGB_TO_LIN[b | 0]
            : (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          let intensity = p.invert ? lum * avgA : (1 - lum) * avgA;
          if (gamma !== 1) intensity = Math.pow(intensity, gamma);
          if (intensity < minThresh) continue;

          const radius = halfCell * Math.sqrt(intensity) * maxScale;
          if (radius < minRadius) continue;

          if (raster) {
            const col = mono ? inkPacked : ((0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0);
            const bx = px - region.x, by = py - region.y;
            let ext, hs = 0, ht = 0;
            if (shapeId === 0) ext = radius;
            else if (shapeId === 1) { hs = radius * 0.88; ext = hs * 1.4143; }
            else if (shapeId === 2) { hs = radius * 1.15; ext = hs * 1.4143; }
            else {
              ht = cell * intensity * maxScale * 0.5;
              if (ht < minHalfThick) continue;
              hs = halfCell + 0.5;
              ext = Math.sqrt(hs * hs + ht * ht);
            }
            const yA = Math.max(0, Math.floor(by - ext)), yB = Math.min(rh - 1, Math.ceil(by + ext));
            const xA = Math.max(0, Math.floor(bx - ext)), xB = Math.min(rw - 1, Math.ceil(bx + ext));
            const r2 = radius * radius;
            for (let yy = yA; yy <= yB; yy++) {
              const dy = yy + 0.5 - by, row = yy * rw;
              for (let xx = xA; xx <= xB; xx++) {
                const dx = xx + 0.5 - bx;
                let inside;
                if (shapeId === 0) inside = dx * dx + dy * dy <= r2;
                else if (shapeId === 2) {
                  const u = dx * dCos + dy * dSin, v = dy * dCos - dx * dSin;
                  inside = Math.abs(u) <= hs && Math.abs(v) <= hs;
                } else {
                  const u = dx * cos + dy * sin, v = dy * cos - dx * sin;
                  inside = shapeId === 1 ? (Math.abs(u) <= hs && Math.abs(v) <= hs)
                                         : (Math.abs(u) <= hs && Math.abs(v) <= ht);
                }
                if (inside) buf32[row + xx] = col;
              }
            }
            continue;
          }

          // Camino con antialiasing (solo si "Bordes duros" está apagado)
          if (!mono) {
            ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
            ctx.beginPath();
          }
          if (shape === 'circle') {
            ctx.moveTo(px + radius, py);
            ctx.arc(px, py, radius, 0, 6.2831853);
          } else if (shape === 'line') {
            const halfThick = cell * intensity * maxScale * 0.5;
            if (halfThick >= minHalfThick) {
              const wl = halfCell + 0.5;
              ctx.moveTo(px - wl * cos + halfThick * sin, py - wl * sin - halfThick * cos);
              ctx.lineTo(px + wl * cos + halfThick * sin, py + wl * sin - halfThick * cos);
              ctx.lineTo(px + wl * cos - halfThick * sin, py + wl * sin + halfThick * cos);
              ctx.lineTo(px - wl * cos - halfThick * sin, py - wl * sin + halfThick * cos);
              ctx.closePath();
            }
          } else if (shape === 'square') {
            const h = radius * 0.88;
            ctx.moveTo(px - h * cos + h * sin, py - h * sin - h * cos);
            ctx.lineTo(px + h * cos + h * sin, py + h * sin - h * cos);
            ctx.lineTo(px + h * cos - h * sin, py + h * sin + h * cos);
            ctx.lineTo(px - h * cos - h * sin, py - h * sin + h * cos);
            ctx.closePath();
          } else if (shape === 'diamond') {
            const dr = radius * 1.15;
            ctx.moveTo(px - dr * dCos + dr * dSin, py - dr * dSin - dr * dCos);
            ctx.lineTo(px + dr * dCos + dr * dSin, py + dr * dSin - dr * dCos);
            ctx.lineTo(px + dr * dCos - dr * dSin, py + dr * dSin + dr * dCos);
            ctx.lineTo(px - dr * dCos - dr * dSin, py - dr * dSin + dr * dCos);
            ctx.closePath();
          }
          if (!mono) ctx.fill();
        }
      }

      if (raster) ctx.putImageData(imgData, 0, 0);
      else if (mono) ctx.fill();

      return { canvas, info: { fullW, fullH, heightCm, region, ms: Math.round(now() - t0) } };
    }
  }

  root.HalftoneEngine = HalftoneEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = HalftoneEngine;
})(typeof self !== 'undefined' ? self : this);
