/* Selector de herramientas de GLYPH. Uso: <span id="toolsMenu" data-current="calado"></span> + este script. */
(function () {
  var T = [
    { g: 'Preparar', id: 'bg', ic: '✂️', n: 'Quitar fondo', tag: 'IA · 2 créditos', app: 1 },
    { g: 'Preparar', id: 'calado', ic: '💧', n: 'Calado por color', tag: 'Gratis', free: 1, href: '/calado' },
    { g: 'Preparar', id: 'upscale', ic: '🔬', n: 'Mejorar calidad', tag: 'IA · 2 créditos', app: 1 },
    { g: 'Preparar', id: 'convert', ic: '🔄', n: 'Conversor', tag: 'Gratis', free: 1, app: 1 },
    { g: 'Producir', id: 'semitonos', ic: '✦', n: 'Semitonos DTF', tag: 'Pro', href: '/semitonos?abrir=1' },
    { g: 'Producir', id: 'pliegos', ic: '🧩', n: 'Armador de pliegos', tag: 'Gratis', free: 1, href: '/pliegos' }
  ];
  var css = '.tm{position:relative;display:inline-block}.tm-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #2a2a32;border-radius:10px;background:#18181c;color:#e8e8ec;font:500 12px "DM Mono",monospace;cursor:pointer;white-space:nowrap}.tm-btn:hover{border-color:#c8f135}.tm-ar{color:#8888a0}' +
    '.tm-bd{position:fixed;inset:0;z-index:900}.tm-pn{position:fixed;min-width:300px;background:#111113;border:1px solid #2a2a32;border-radius:12px;padding:8px;z-index:901;box-shadow:0 16px 40px rgba(0,0,0,.6)}' +
    '.tm-bd[hidden],.tm-pn[hidden]{display:none}.tm-g{font:600 10px "DM Mono",monospace;letter-spacing:1.5px;text-transform:uppercase;color:#8888a0;padding:10px 10px 4px}' +
    '.tm-it{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;color:#e8e8ec;text-decoration:none;font:13px "DM Mono",monospace}.tm-it:hover{background:#18181c}.tm-it.on{background:rgba(200,241,53,.1);color:#c8f135}' +
    '.tm-tag{margin-left:auto;font-size:10px;color:#8888a0;border:1px solid #2a2a32;border-radius:999px;padding:2px 8px;white-space:nowrap}.tm-tag.free{color:#c8f135;border-color:rgba(200,241,53,.35)}' +
    '@media(max-width:640px){.tm{display:block}.tm-btn{width:100%}.tm-ar{margin-left:auto}.tm-bd{background:rgba(0,0,0,.6)}.tm-pn{position:fixed;left:0;right:0;bottom:0;top:auto;min-width:0;border-radius:16px 16px 0 0;padding:10px 12px calc(14px + env(safe-area-inset-bottom));max-height:80vh;overflow:auto}.tm-it{padding:14px 10px}}';
  function find(id) { return T.filter(function (t) { return t.id === id; })[0]; }
  function init() {
    var h = document.getElementById('toolsMenu'); if (!h) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var html = '', g = '';
    T.forEach(function (t) {
      if (t.g !== g) { g = t.g; html += '<div class="tm-g">' + g + '</div>'; }
      html += '<a class="tm-it" data-id="' + t.id + '" href="' + (t.href || '/app#' + t.id) + '"><span>' + t.ic + '</span><span>' + t.n + '</span><span class="tm-tag' + (t.free ? ' free' : '') + '">' + t.tag + '</span></a>';
    });
    h.className = 'tm';
    h.innerHTML = '<button type="button" class="tm-btn" aria-haspopup="true" aria-expanded="false"><span class="tm-ic"></span><span class="tm-n"></span><span class="tm-ar">▾</span></button><div class="tm-bd" hidden></div><div class="tm-pn" hidden>' + html + '</div>';
    var btn = h.querySelector('.tm-btn'), bd = h.querySelector('.tm-bd'), pn = h.querySelector('.tm-pn');
    document.body.appendChild(bd); document.body.appendChild(pn); /* fuera del header: evita que un blur/transform lo desplace */
    function open(v) {
      pn.hidden = bd.hidden = !v; btn.setAttribute('aria-expanded', v);
      if (v) { if (innerWidth > 640) { var r = btn.getBoundingClientRect(); pn.style.top = (r.bottom + 8) + 'px'; pn.style.left = Math.max(8, Math.min(r.left, innerWidth - 316)) + 'px'; } else { pn.style.top = pn.style.left = ''; } }
    }
    function set(id) {
      var t = find(id); if (!t) return;
      h.querySelector('.tm-ic').textContent = t.ic; h.querySelector('.tm-n').textContent = t.n;
      [].forEach.call(pn.querySelectorAll('.tm-it'), function (a) { a.classList.toggle('on', a.getAttribute('data-id') === id); });
    }
    btn.onclick = function () { open(pn.hidden); }; bd.onclick = function () { open(false); };
    addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
    var inApp = typeof window.switchTab === 'function';
    if (inApp) {
      var orig = window.switchTab;
      window.switchTab = function (t) { try { orig.apply(this, arguments); } finally { set(t); } };
    }
    pn.onclick = function (e) {
      var a = e.target.closest('.tm-it'); if (!a) return;
      var t = find(a.getAttribute('data-id'));
      if (inApp && t.app) {
        e.preventDefault();
        var b = document.querySelector('.nav-tabs [onclick*="\'' + t.id + '\'"]');
        window.switchTab(t.id, b); open(false);
      }
    };
    set(h.getAttribute('data-current') || '');
    var hs = (location.hash || '').slice(1), t0 = find(hs);
    if (inApp && t0 && t0.app) window.switchTab(hs, document.querySelector('.nav-tabs [onclick*="\'' + hs + '\'"]'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
