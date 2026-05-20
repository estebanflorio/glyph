// ============================================================
// PARCHE PARA public/app.html
// Instrucciones: reemplazá los bloques indicados en app.html
// ============================================================

// ── 1. Agregá esto en el <head> de app.html, antes del </head> ──
// (carga FingerprintJS desde CDN, sin npm)
/*
<script>
  // FingerprintJS — identifica el dispositivo sin cookies
  !function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define([],t):"object"==typeof exports?exports.FingerprintJS=t():e.FingerprintJS=t()}(this,(function(){...}));
</script>
*/
// En realidad cargalo desde CDN así:
// <script src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4/dist/fp.min.js"></script>


// ── 2. Reemplazá la función callServer existente por esta ──

let _fingerprint = null;

// Inicializar fingerprint al cargar (va junto con initFirebase al final)
async function initFingerprint() {
  try {
    const FP = await FingerprintJS.load();
    const result = await FP.get();
    _fingerprint = result.visitorId;
    console.log('[FP] fingerprint listo:', _fingerprint.slice(0, 8) + '...');
  } catch (err) {
    console.warn('[FP] No se pudo obtener fingerprint:', err.message);
    _fingerprint = 'unknown';
  }
}

async function callServer(endpoint, file, extraFields = {}) {
  const token = currentUser ? await currentUser.getIdToken(true) : null;

  // Si no está logueado y no hay fingerprint todavía, esperamos
  if (!token && !_fingerprint) {
    throw new Error('Iniciá sesión para usar esta función.');
  }

  const form = new FormData();
  form.append('image', file);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, String(v));

  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (_fingerprint) headers['x-fingerprint'] = _fingerprint;

  const res = await fetch(SERVER + endpoint, {
    method: 'POST',
    headers,
    body: form
  });

  const data = await res.json().catch(() => ({ success: false, error: `Error ${res.status}` }));

  // Si el servidor dice que se agotó el free trial
  if (!data.success && data.error === 'free_limit_reached') {
    showFreeTrialEnded();
    throw new Error(data.message || 'Límite gratuito alcanzado.');
  }

  if (!data.success) throw new Error(data.error || 'Error en el servidor');

  // Actualizar créditos en el badge
  if (typeof data.credits === 'number') updateCreditsDisplay(data.credits);

  // Si era free trial y funcionó, mostrar cartel de registro
  if (data.freeUsed) {
    showFreeTrialSuccess(data.message);
  }

  return data.url;
}

// ── 3. Agregá estas funciones nuevas junto al resto de las funciones ──

function showFreeTrialEnded() {
  // Muestra un toast con botón para ir al login
  const el = document.getElementById('toast');
  el.innerHTML = `
    ⚡ Usaste tu prueba gratuita.
    <a href="/login" style="color:var(--accent);margin-left:8px;text-decoration:underline;">
      Creá una cuenta →
    </a>`;
  el.className = 'toast info show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 8000);
}

function showFreeTrialSuccess(message) {
  // Banner que aparece debajo del resultado invitando a registrarse
  let banner = document.getElementById('freeTrialBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'freeTrialBanner';
    banner.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: rgba(200,241,53,0.1); border: 1px solid rgba(200,241,53,0.4);
      border-radius: 12px; padding: 16px 24px; z-index: 1000;
      font-family: 'DM Mono', monospace; font-size: 12px;
      color: var(--text); text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      max-width: 420px; width: 90%;
    `;
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <div style="margin-bottom:10px;font-size:14px;">✨ ${message || '¡Tu prueba gratuita funcionó!'}</div>
    <div style="color:var(--text2);margin-bottom:14px;">Creá una cuenta y empezá con 10 créditos gratis.</div>
    <a href="/login" style="
      display:inline-block;padding:10px 24px;
      background:var(--accent);color:#0a0a0b;
      border-radius:8px;text-decoration:none;
      font-weight:600;letter-spacing:1px;font-size:11px;
    ">CREAR CUENTA GRATIS →</a>
    <button onclick="this.parentElement.remove()" style="
      margin-left:12px;background:none;border:none;
      color:var(--text3);cursor:pointer;font-size:18px;vertical-align:middle;
    ">✕</button>
  `;
  banner.style.display = 'block';
}


// ── 4. En la función initFirebase(), al final del bloque onAuthStateChanged,
//       y también fuera del if(!user), agregá la llamada a initFingerprint:

/*
  Reemplazá la línea al final del archivo que dice:
  
    initFirebase().then(checkPaymentReturn);
  
  por:
  
    Promise.all([initFirebase(), initFingerprint()]).then(checkPaymentReturn);
*/
