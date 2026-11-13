// Widget global de GLYPH: botón de WhatsApp + barra legal (ayuda, términos,
// privacidad, botón de arrepentimiento, botón de baja, Defensa del Consumidor)
// y relleno de datos [data-cfg]. Se incluye en cada página con un <script>.
(function () {
  if (window.__glyphWidget) return;
  window.__glyphWidget = true;

  var C = window.GLYPH_CONFIG || {};
  var DEFENSA = 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario';

  function waUrl() {
    var txt = 'Hola GLYPH, necesito ayuda con: ';
    return 'https://wa.me/' + String(C.whatsapp).replace(/\D/g, '') + '?text=' + encodeURIComponent(txt);
  }

  var css = '' +
    '.gl-fab{position:fixed;right:16px;bottom:16px;z-index:900;display:flex;align-items:center;gap:8px;' +
    'padding:12px 16px;border-radius:999px;background:#25d366;color:#0a0a0b;text-decoration:none;' +
    'font:600 12px "DM Mono",monospace;letter-spacing:.5px;box-shadow:0 6px 24px rgba(0,0,0,.45);transition:transform .2s}' +
    '.gl-fab:hover{transform:translateY(-2px)}' +
    '.gl-fab svg{width:20px;height:20px;flex-shrink:0}' +
    '.gl-legal{position:relative;z-index:1;margin-top:48px;padding:28px 20px 32px;border-top:1px solid #2a2a32;' +
    'background:#0a0a0b;text-align:center;font-family:"DM Mono",monospace}' +
    '.gl-legal.gl-pad{padding-bottom:84px}' +
    '.gl-links{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;margin-bottom:14px}' +
    '.gl-links a{color:#8888a0;text-decoration:none;font-size:11px;letter-spacing:.5px;transition:color .2s}' +
    '.gl-links a:hover{color:#e8e8ec}' +
    '.gl-links a.gl-btn{padding:6px 12px;border:1px solid #2a2a32;border-radius:6px;color:#c8f135}' +
    '.gl-links a.gl-btn:hover{border-color:#c8f135;color:#c8f135}' +
    '.gl-copy{font-size:10px;color:#444458;letter-spacing:1px}' +
    '@media(max-width:560px){.gl-fab span{display:none}.gl-fab{padding:14px}}';

  function init() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var hasWa = !!String(C.whatsapp || '').replace(/\D/g, '');

    if (hasWa) {
      var fab = document.createElement('a');
      fab.className = 'gl-fab';
      fab.href = waUrl();
      fab.target = '_blank';
      fab.rel = 'noopener';
      fab.setAttribute('aria-label', 'Escribinos por WhatsApp');
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg><span>WhatsApp</span>';
      document.body.appendChild(fab);
    }

    var bar = document.createElement('div');
    bar.className = 'gl-legal' + (hasWa ? ' gl-pad' : '');
    bar.setAttribute('role', 'contentinfo');
    bar.innerHTML =
      '<div class="gl-links">' +
        '<a href="/ayuda">Ayuda y contacto</a>' +
        '<a href="/terminos">Términos y condiciones</a>' +
        '<a href="/privacidad">Privacidad</a>' +
        '<a class="gl-btn" href="/ayuda#arrepentimiento">Botón de arrepentimiento</a>' +
        '<a class="gl-btn" href="/ayuda#baja">Botón de baja</a>' +
        '<a href="' + DEFENSA + '" target="_blank" rel="noopener">Defensa del Consumidor</a>' +
      '</div>' +
      '<div class="gl-copy">GLYPH · glyph.com.ar · Hecho en Argentina</div>';
    document.body.appendChild(bar);

    // Relleno de datos de configuración
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      var k = el.getAttribute('data-cfg');
      if (C[k]) el.textContent = C[k];
      if (k === 'email' && el.tagName === 'A') el.href = 'mailto:' + C.email;
    });
    document.querySelectorAll('[data-wa]').forEach(function (el) {
      if (hasWa) { el.href = waUrl(); el.target = '_blank'; el.rel = 'noopener'; el.style.display = ''; }
      else el.style.display = 'none';
    });
    document.querySelectorAll('[data-mail]').forEach(function (el) {
      if (C.email) el.href = 'mailto:' + C.email;
    });
    document.querySelectorAll('[data-defensa]').forEach(function (el) {
      el.href = DEFENSA; el.target = '_blank'; el.rel = 'noopener';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
