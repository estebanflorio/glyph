// Tema navideño de GLYPH: luces, gorro de Papá Noel, nieve y mensaje.
// Lo carga site-widget.js solo cuando el tema está activo.
// GlyphXmas.off() lo quita en caliente.
(function () {
  if (window.GlyphXmas) return;

  var root = document.documentElement;
  var els = [];            // elementos que agregamos, para poder quitarlos
  var raf = null, canvas = null, ctx = null, flakes = [], W = 0, H = 0;
  var COLORS = ['#e63946', '#f4c95d', '#2ecc71', '#4cc9f0'];
  var ARC = 90;            // ancho de cada arco de cable (igual al del CSS)
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function add(el, parent) { (parent || document.body).appendChild(el); els.push(el); return el; }

  // ── Luces ──
  var lights = null, resizeT = null;
  function buildLights() {
    if (!lights) { lights = document.createElement('div'); lights.className = 'xmas-lights'; add(lights); }
    lights.innerHTML = '';
    var arcs = Math.ceil(window.innerWidth / ARC) + 1;
    // posiciones sobre la curva (t = .25, .5, .75) → y calculada de la curva cuadrática
    var pts = [[22.5, 8], [45, 10], [67.5, 8]];
    var n = 0;
    for (var a = 0; a < arcs; a++) {
      for (var p = 0; p < pts.length; p++) {
        var b = document.createElement('span');
        b.className = 'xmas-bulb';
        b.style.left = (a * ARC + pts[p][0]) + 'px';
        b.style.top = pts[p][1] + 'px';
        b.style.setProperty('--c', COLORS[n % COLORS.length]);
        b.style.animationDelay = ((n * 0.37) % 1.9).toFixed(2) + 's';
        lights.appendChild(b);
        n++;
      }
    }
  }

  // ── Gorro sobre el logo ──
  function buildHats() {
    var logos = document.querySelectorAll('.logo, .nav-logo, .brand');
    for (var i = 0; i < logos.length; i++) {
      if (logos[i].querySelector('.xmas-hat')) continue;
      var s = document.createElement('span');
      s.className = 'xmas-hat';
      s.innerHTML = '<svg viewBox="0 0 40 33" width="27" height="22" aria-hidden="true">' +
        '<path d="M5 26 Q7 9 26 4 Q23 14 33 26 Z" fill="#e63946"/>' +
        '<path d="M8 25 Q10 14 22 8 Q21 16 27 25 Z" fill="#ff6b78" opacity=".35"/>' +
        '<rect x="3" y="23.5" width="34" height="7.5" rx="3.75" fill="#fff"/>' +
        '<circle cx="27" cy="4.5" r="4.5" fill="#fff"/></svg>';
      logos[i].appendChild(s);
      els.push(s);
    }
  }

  // ── Mensaje en la barra legal ──
  function buildMsg() {
    var copy = document.querySelector('.gl-copy');
    if (!copy || copy.querySelector('.xmas-msg')) return;
    var m = document.createElement('span');
    m.className = 'xmas-msg';
    m.textContent = ' · 🎄 ¡Felices fiestas!';
    copy.appendChild(m);
    els.push(m);
  }

  // ── Nieve ──
  function snowEnabled() { try { return localStorage.getItem('glyph_nieve') !== 'off'; } catch (e) { return true; } }

  function makeFlake(init) {
    return { x: Math.random() * W, y: init ? Math.random() * H : -8, r: Math.random() * 2.2 + 0.8,
             vy: Math.random() * 0.7 + 0.35, sway: Math.random() * 0.8 + 0.2, ph: Math.random() * 6.28 };
  }
  function sizeSnow() {
    W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
    var n = Math.min(80, Math.floor(W / 16));
    while (flakes.length < n) flakes.push(makeFlake(true));
    flakes.length = n;
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.ph += 0.012; f.y += f.vy; f.x += Math.sin(f.ph) * f.sway;
      if (f.y > H + 8) flakes[i] = makeFlake(false);
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832); ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  }
  function startSnow() {
    if (reduced || raf) return;
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.className = 'xmas-snow';
      ctx = canvas.getContext('2d'); add(canvas); sizeSnow();
    }
    canvas.style.display = '';
    raf = requestAnimationFrame(tick);
  }
  function stopSnow() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (canvas) canvas.style.display = 'none';
  }

  var toggle = null;
  function buildToggle() {
    if (reduced) return;
    toggle = document.createElement('button');
    toggle.className = 'xmas-toggle'; toggle.type = 'button';
    toggle.textContent = '❄';
    function paint() { var on = snowEnabled(); toggle.classList.toggle('off', !on); toggle.title = on ? 'Pausar la nieve' : 'Activar la nieve'; }
    toggle.onclick = function () {
      var on = snowEnabled();
      try { localStorage.setItem('glyph_nieve', on ? 'off' : 'on'); } catch (e) {}
      on ? stopSnow() : startSnow();
      paint();
    };
    paint(); add(toggle);
  }

  function onResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { buildLights(); if (canvas) sizeSnow(); }, 150);
  }
  function onVisibility() {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (snowEnabled()) startSnow();
  }

  function on() {
    root.setAttribute('data-tema', 'navidad');
    buildLights(); buildHats(); buildMsg(); buildToggle();
    if (snowEnabled()) startSnow();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function off() {
    stopSnow();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    els.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    els = []; lights = null; canvas = null; toggle = null; flakes = [];
    root.removeAttribute('data-tema');
    window.GlyphXmas = null;
  }

  window.GlyphXmas = { off: off };
  on();
})();
