/* KEVIN LIFE OS — frontend */
let S = null;          // estado global del servidor
let pieChart = null;
// Plugin: dibuja el % DENTRO de cada pedazo de la torta (con borde oscuro para que se lea sobre cualquier color)
const sliceLabels = {
  id: 'sliceLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const data = (chart.data.datasets[0] || {}).data || [];
    const total = data.reduce((a, b) => a + (b || 0), 0) || 1;
    // tamaño de fuente responsive según el radio real del gráfico (nunca se sale en móvil)
    const arc0 = meta.data[0];
    const outerR = arc0 ? arc0.getProps(['outerRadius'], true).outerRadius : 60;
    const innerR = arc0 ? arc0.getProps(['innerRadius'], true).innerRadius : 30;
    const fontPx = Math.max(9, Math.min(15, Math.round(outerR * 0.16)));
    meta.data.forEach((arc, i) => {
      const val = data[i] || 0;
      const pct = Math.round((val / total) * 100);
      if (pct < 1) return;                 // 0% real: nada que mostrar
      // SIEMPRE dentro del anillo: punto medio entre radio interno y externo, en el ángulo medio del arco
      const p = arc.getProps(['startAngle', 'endAngle', 'outerRadius', 'innerRadius', 'x', 'y'], true);
      const mid = (p.startAngle + p.endAngle) / 2;
      const r = (p.innerRadius + p.outerRadius) / 2;
      const pos = { x: p.x + Math.cos(mid) * r, y: p.y + Math.sin(mid) * r };
      ctx.save();
      ctx.font = `700 ${fontPx}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(19,16,34,.92)';
      ctx.strokeText(pct + '%', pos.x, pos.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(pct + '%', pos.x, pos.y);
      ctx.restore();
    });
  }
};
const $ = (q) => document.querySelector(q);
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');

// ¿el usuario pidió menos animación en su sistema? entonces no animamos (accesibilidad)
const _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Anima el texto de un elemento desde su número actual hasta `to`.
// wrap(n) formatea cada paso (por defecto, moneda). Guarda el último valor en dataset para el próximo tween.
function animateNumber(el, to, wrap = fmt, ms = 650) {
  if (!el) return;
  const from = (el.dataset.val != null) ? +el.dataset.val : to;
  el.dataset.val = to;
  if (_reduceMotion || from === to) { el.textContent = wrap(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / ms, 1);
    const eased = 1 - Math.pow(1 - p, 3);            // easeOutCubic
    el.textContent = wrap(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// Anima el ancho (%) de una barra con transición suave (sin romper si ya tiene transition CSS)
function animateWidth(el, pct) {
  if (!el) return;
  el.style.transition = _reduceMotion ? 'none' : 'width .8s cubic-bezier(.22,1,.36,1)';
  requestAnimationFrame(() => { el.style.width = Math.max(0, Math.min(100, pct)) + '%'; });
}
// lee un input quitando los puntos de miles (para money-live)
const numVal = (sel) => { const el = $(sel); return el ? +(el.value || '').replace(/\./g, '').replace(/[^0-9-]/g, '') || 0 : 0; };
// engancha formateo de miles en vivo a un input
function engancharMiles(el) {
  if (!el || el._milesOn) return;
  el._milesOn = true;
  el.addEventListener('input', () => {
    const limpio = el.value.replace(/\./g, '').replace(/[^0-9]/g, '');
    el.value = limpio ? Number(limpio).toLocaleString('es-CO') : '';
  });
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pct = (n) => (n * 100).toFixed(1) + '%';
/* --- compras a cuotas --- */
const planIndex = (d) => (d.getFullYear() - 2026) * 12 + d.getMonth() - 6;  // julio 2026 = 0
// Deudas que son tarjetas/créditos: se editan en el apartado de abajo, NO en las barras
const TARJETAS_CREDITO = ['Tarjeta DV — Jefe Final', 'ADDI', 'Crédito Nicole', 'Codensa', 'Banco de Bogotá', 'Tarjeta Nicole'];
const CRED_TO_DEBT = { 'Tarjeta DV': 'Tarjeta DV — Jefe Final', 'Joseph (cuota)': 'Joseph' };
const CRED_TO_GRUPO = { 'Joseph (cuota)': 'Joseph' };
// Opciones "¿en qué mes empieza la primera cuota?" para los modales de compra a cuotas.
// Evita que una compra de HOY se sume al mes que ya pagaste: tú eliges si arranca este mes o después.
const mesInicioOpts = () => (S.plan.months || [])
  .map((m, ix) => ({ v: String(ix), t: ix === MES ? `${m} (this month)` : m }))
  .slice(MES, MES + 12);
const cuotaDe = (c) => Math.round(c.valor / c.cuotas);
const compraActiva = (c, i) => i >= c.start && i < c.start + c.cuotas;
const extraCuota = (cred, i) => S.compras
  .filter(c => c.creditor === cred)
  .reduce((s, c) => {
    const cuotaBase = cuotaDe(c);
    if (cuotaBase <= 0) return s;
    const num = i - c.start + 1;                       // qué cuota corresponde al mes i
    if (num < 1 || num > c.cuotas) return s;           // fuera del plan
    const abonado = c.abonado || 0;
    const cubiertas = Math.floor(abonado / cuotaBase); // cuotas YA pagadas con abonos (las primeras)
    if (num <= cubiertas) return s;                    // esta cuota ya la pagaste -> no cobra este mes
    if (num === cubiertas + 1) {                       // cuota parcialmente abonada -> cobra solo el resto
      const parcial = abonado - cubiertas * cuotaBase;
      return s + Math.max(cuotaBase - parcial, 0);
    }
    return s + cuotaBase;
  }, 0);
const extraDebtCuota = (i) => (S.extra_debts || [])
  .filter(d => d.cuotas >= 1 && i >= d.start && i < d.start + d.cuotas)
  .reduce((s, d) => s + d.cuota, 0);
const compradoEn = (debtName) => S.compras
  .filter(c => (CRED_TO_DEBT[c.creditor] || c.creditor) === debtName)
  .reduce((s, c) => s + c.valor - (c.abonado || 0), 0);

// Suma de abonos hechos a líneas del DESGLOSE ORIGINAL (detalle_items) cuyo grupo es un jefe.
// Estas líneas ya están dentro del 'initial' del jefe, así que su abono = daño a ese jefe.
function abonoDetalleDeUnJefe(debtName) {
  let s = 0;
  for (const [g, items] of Object.entries(S.detalle || {})) {
    const jefe = CRED_TO_GRUPO[g] || g;
    if (jefe !== debtName && g !== debtName) continue;
    for (const it of items) {
      // formato: [nombre,cuota,pagadas,total,fijo,id,abonado_fijo,start_month]
      s += (it[6] || 0);
    }
  }
  return s;
}
function abonoDetalleDeJefes() {
  return S.debts.reduce((s, d) => s + abonoDetalleDeUnJefe(d.name), 0);
}

const monthKey = (i) => {                     // índice del plan -> 'AAAA-MM'
  const t = 6 + i;                            // mes 0 del plan = julio 2026
  return `${2026 + Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
};

/* ====== ASESOR 50/30/20 (Needs / Savings / Debt sobre el ingreso) ====== */
// Total de pagos de DEUDA de un mes del plan (mismo cálculo que Home):
// cuotas del plan + compras a cuotas + deudas registradas + deudas prometidas de ese mes.
function deudaDelMes(i) {
  const p = S.plan; let total = 0;
  for (const [n, arr] of Object.entries(p.creditors || {})) total += cuotaPlanMes(n, i) + extraCuota(n, i);
  for (const d of (S.extra_debts || [])) {
    if (d.cuotas >= 1) { if (i >= d.start && i < d.start + d.cuotas) total += d.cuota; }
    else if (d.due_date && mesDeFecha(d.due_date) === i) total += Math.max(d.total - (d.abonado || 0), 0);
  }
  return total;
}
// Cuota de un creditor en el mes i = SUMA REAL de los items de su desglose (detalle),
// igual que el apartado "Full debt breakdown". Así Inicio y el desglose nunca se
// desincronizan (antes Inicio usaba un número guardado que quedaba viejo al pagar/quitar cuotas).
// Si el creditor no tiene desglose, usa el número del plan como respaldo.
function cuotaPlanMes(creditorName, i) {
  if (creditorName === 'Tarjeta DV') return amortMontoMes(i);   // Davivienda: amortización real
  const grupo = CRED_TO_GRUPO[creditorName] || creditorName;
  const items = S.detalle && S.detalle[grupo];
  if (!items || !items.length) return ((S.plan.creditors[creditorName] || [])[i]) || 0;
  return items.reduce((s, it) => {
    const ci = calcItem(it, i);
    return s + (ci.done ? 0 : (ci.cuota || 0));
  }, 0);
}
// Cargos fijos del mes que SÍ se pagan pero NO bajan la deuda (seguro, cuota de manejo, etc.):
// en el desglole son los items "fijos" (sin número de cuotas). El jefe no debe contar esto.
function costoFijoMes(creditorName, i) {
  if (creditorName === 'Tarjeta DV') {   // Davivienda: seguro/manejo + cargos extra de los primeros meses
    const A = getAmortDav();
    const extras = (A.extras || []).reduce((s, e) => s + (i < (e.meses || 0) ? e.valor : 0), 0);
    return (A.seguro || 0) + extras;
  }
  const grupo = CRED_TO_GRUPO[creditorName] || creditorName;
  const items = (S.detalle && S.detalle[grupo]) || [];
  return items.reduce((s, it) => s + (it[3] == null ? (it[1] || 0) : 0), 0);  // it[3]=total null -> cargo fijo
}
// Si una cuota nueva deja la deuda del mes por encima del 50% del ingreso, pide
// confirmación mostrando el exceso EXACTO. Devuelve true si se puede continuar.
async function confirmarTopeDeuda(monthIdx, cuotaNueva) {
  const ing = ingresoDelMes(monthIdx);
  if (ing <= 0 || !(cuotaNueva > 0)) return true;
  const proyectada = deudaDelMes(monthIdx) + cuotaNueva;
  const tope = ing * 0.5;
  if (proyectada <= tope) return true;          // dentro del 50%: sin aviso
  const exceso = proyectada - tope;
  const pctv = Math.round((proyectada / ing) * 100);
  const mes = (S.plan.months || [])[monthIdx] || ('month ' + monthIdx);
  return await confirmModal('⚠ This crosses your 50% debt ceiling',
    `With this, <b>${esc(mes)}</b> would carry <b>${fmt(proyectada)}</b> in debt payments = ` +
    `<b style="color:var(--hp)">${pctv}%</b> of that month's income.<br><br>` +
    `That goes <b style="color:var(--hp)">${fmt(exceso)}</b> over your 50% ceiling.<br><br>` +
    `Register it anyway?`, true);
}
// Dibuja el panel asesor bajo la torta: barras sobre el ingreso, semáforo y veredicto.
function renderAdvisor(ingreso, needs, save, debt) {
  const cont = document.getElementById('regla502030');
  if (!cont) return;
  const ing = ingreso || 1;
  const frac = (v) => v / ing;
  const rows = [
    { icon: '🏠', name: 'Needs', sub: 'Life & services', val: needs, target: 0.5, dir: 'max' },
    { icon: '💰', name: 'Savings', sub: 'Company fund', val: save, target: 0.2, dir: 'min' },
    { icon: '⚔', name: 'Debt', sub: "This month's payments", val: debt, target: 0.5, dir: 'max' },
  ];
  const html = rows.map(r => {
    const f = frac(r.val), p = Math.round(f * 100), tgt = Math.round(r.target * 100);
    const over = r.dir === 'max' && f > r.target + 1e-9;
    const under = r.dir === 'min' && f < r.target - 1e-9;
    const state = over ? 'over' : under ? 'under' : 'ok';
    const margen = (r.target - f) * ing;          // + = margen/falta; - = exceso
    let note;
    if (r.dir === 'max')
      note = over ? `Over the ${tgt}% ceiling by <b>${fmt(Math.abs(margen))}</b>`
                  : `<b>${fmt(margen)}</b> of room left under ${tgt}%`;
    else
      note = under ? `<b>${fmt(margen)}</b> short of the ${tgt}% goal`
                   : `Goal met ✓ — <b>${fmt(Math.abs(margen))}</b> above ${tgt}%`;
    return `<div class="adv-row">
      <div class="adv-head">
        <span class="adv-name">${r.icon} ${r.name}<small>${r.sub}</small></span>
        <span class="adv-pct ${state}">${p}%</span>
      </div>
      <div class="adv-track">
        <i class="adv-fill-${state}" style="width:${Math.min(f * 100, 100)}%"></i>
        <span class="adv-tick" style="left:${Math.min(tgt, 100)}%"></span>
      </div>
      <div class="adv-note ${state}">${note}</div>
    </div>`;
  }).join('');
  const dF = frac(debt), nF = frac(needs), sF = frac(save);
  let vclass = '', verdict;
  if (dF > 0.5) { vclass = 'war'; verdict = `⚔ War mode: debt eats ${Math.round(dF * 100)}% of your income. It drops every month — hold the line.`; }
  else if (nF <= 0.5 && sF >= 0.2) { vclass = 'ok'; verdict = `👑 Healthy month: you're inside the 50/30/20. Room to enjoy or to save more.`; }
  else verdict = `🛡 Getting there: debt is under 50%. Nudge Needs and Savings toward their targets.`;
  cont.innerHTML = `<div class="adv-verdict ${vclass}">${verdict}</div>` + html;
}

/* ---------- tabs ---------- */
document.getElementById('tabs').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('tab-' + e.target.dataset.tab).classList.add('active');
});

const FRONT_V = 114;
let MES = 0;   // mes seleccionado en Inicio (0 = julio 2026)
let ANIME_FILTRO = 'todos';
// Medios de pago. isCard=true significa tarjeta de crédito -> suma a cuotas de esa deuda.
// Conexión Life -> Habits: qué hábito marca cada actividad de la rutina.
// Varias actividades pueden marcar el MISMO hábito (ej: ejercicio o gym -> Exercise).
const ACT_TO_HABIT = {
  ejercicio: ['Exercise'], gym: ['Exercise'],
  ingles: ['English'],
  estudio: ['Study and hard work', 'Mathematic / Data', 'Writing'],
  proyecto: ['Study and hard work'],
  leer: ['Read'],
  dormir: ['Sleep well'],
  skincare: ['Take care my face and body']
};
// Sub-tareas del bloque de inglés (para preguntar una por una al marcar la casilla).
// Devuelve el título del día y sus pasos: cada paso tiene .s (corto) y .how (cómo hacerlo bien).
function pasosInglesDelDia(wd) {
  const plan = INGLES_PLAN[wd] || INGLES_PLAN[0];
  return { titulo: plan.title, pasos: plan.steps };
}

const ENGLISH_TASKS = [
  { t: 'Talk 5 min', d: 'Warm-up: talk OUT LOUD about your day for 5 minutes. Record yourself.' },
  { t: 'Main activity', d: 'The day\'s core: book / shadowing / vocabulary / conversation (see the activity text).' },
  { t: 'Tell the AI', d: 'Close by telling the AI in English what you did/read/watched. The sacred speaking block.' }
];

const PAY_METHODS = [
  { id: 'Efectivo', label: 'Cash', logo: '💵', card: false },
  { id: 'Nequi', label: 'Nequi', logo: '🟣', card: false },
  { id: 'Daviplata', label: 'Daviplata', logo: '🔴', card: false },
  { id: 'NU', label: 'NU (debit)', logo: '🟪', card: false },
  { id: 'Bancolombia', label: 'Bancolombia (debit)', logo: '🟡', card: false },
  { id: 'Tarjeta Nicole', label: 'Nicole (credit)', logo: '💳', card: true },
  { id: 'Davivienda', label: 'Davivienda (credit)', logo: '🔻', card: true },
  { id: 'Codensa', label: 'Codensa (credit)', logo: '🟠', card: true },
  { id: 'Banco de Bogotá', label: 'Banco de Bogotá (credit)', logo: '🔵', card: true },
  { id: 'ADDI', label: 'ADDI (credit)', logo: '🟢', card: true }
];
const payMethod = (id) => PAY_METHODS.find(m => m.id === id) || PAY_METHODS[0];
// el ingreso del mes actual (editable) o el del plan por defecto
function ingresoDelMes(i) {
  const monthKey2 = S.plan.months[i];
  const mi = S.month_income || {};
  if (mi[monthKey2] != null) return mi[monthKey2];
  return S.plan.salario + (S.plan.extra[i] || 0);
}
// Fecha LOCAL del dispositivo (no UTC), en formato YYYY-MM-DD — evita el desfase de zona horaria
function localISO(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
function hoyLocal() { return localISO(new Date()); }   // debe coincidir con VERSION en app.py

const _inflightMutations = new Map();

async function api(path, opts = null) {
  const cfg = opts || {};
  const method = cfg.method || (opts ? 'POST' : 'GET');
  const isMutation = method !== 'GET' && method !== 'HEAD';
  const mutationKey = isMutation
    ? `${method}:${path}:${cfg.body ? JSON.stringify(cfg.body) : ''}`
    : '';

  // V114: dos clics idénticos mientras la primera petición sigue pendiente comparten
  // la misma promesa. No añade tráfico ni cambia las operaciones secuenciales normales.
  if (mutationKey && _inflightMutations.has(mutationKey)) {
    return _inflightMutations.get(mutationKey);
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeoutMs = cfg.timeout || 20000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(path, opts ? {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: cfg.body ? JSON.stringify(cfg.body) : undefined,
        signal: controller.signal
      } : { signal: controller.signal });
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      if (!cfg.quiet) toast(timedOut
        ? '⚠ El servidor tardó demasiado y no confirmó la operación. Intenta de nuevo.'
        : '⚠ No fue posible conectar con el servidor. Revisa tu conexión e intenta de nuevo.', 'err');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      let friendly = 'No fue posible guardar el cambio. Intenta nuevamente en un momento.';
      try {
        const body = await r.clone().json();
        if (body && body.error) friendly = String(body.error);
      } catch { /* respuesta sin JSON */ }
      if (!cfg.quiet) toast('⚠ ' + esc(friendly), 'err');
      throw new Error(r.status + ' en ' + path);
    }
    return r.json();
  })();

  if (mutationKey) _inflightMutations.set(mutationKey, request);
  try {
    return await request;
  } finally {
    if (mutationKey && _inflightMutations.get(mutationKey) === request) {
      _inflightMutations.delete(mutationKey);
    }
  }
}

// Evita envíos duplicados por doble clic mientras una operación sigue en curso.
async function withBusy(el, work) {
  if (!el || el.dataset.busy === '1') return;
  el.dataset.busy = '1';
  const wasDisabled = !!el.disabled;
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    el.disabled = wasDisabled;
    el.removeAttribute('aria-busy');
    delete el.dataset.busy;
  }
}

/* ====== MODALES Y TOASTS BONITOS ====== */
function safeToastHTML(value) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(value ?? '');
  const allowed = new Set(['B', 'STRONG', 'EM', 'I', 'BR', 'SPAN']);
  [...tpl.content.querySelectorAll('*')].forEach(el => {
    if (!allowed.has(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent || '')); return; }
    [...el.attributes].forEach(a => el.removeAttribute(a.name));
  });
  return tpl.innerHTML;
}
function toast(msg, tipo) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (tipo === 'err' ? ' err' : tipo === 'warn' ? ' warn' : '');
  t.innerHTML = safeToastHTML(msg);
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}

// ====== CONFETI + CELEBRACIÓN ÉPICA ======
function confetti(duration = 2600) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000';
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const colors = ['#f5b942', '#36c9a7', '#7c6ce0', '#ff5e7a', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
    r: 4 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
    vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, rot: Math.random() * 6.28,
    vr: -0.2 + Math.random() * 0.4
  }));
  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.5); ctx.restore();
    }
    if (el < duration) requestAnimationFrame(frame);
    else cv.remove();
  })(t0);
}

// Flash rápido de "DERROTADO" que cruza la pantalla un instante
function flashDerrota(nombre) {
  const f = document.createElement('div');
  f.className = 'defeat-flash';
  f.innerHTML = `<div class="defeat-slash"></div>
    <div class="defeat-text">☠ DEFEATED<span>${nombre}</span></div>`;
  document.body.appendChild(f);
  requestAnimationFrame(() => f.classList.add('go'));
  setTimeout(() => { f.classList.add('out'); setTimeout(() => f.remove(), 400); }, 1100);
}

function celebrate({ icon = '🎉', title = '', text = '', confettiOn = true }) {
  if (confettiOn) confetti();
  if (typeof petCelebrate === 'function') petCelebrate();   // la mascota también festeja
  const back = document.createElement('div');
  back.className = 'modal-back celebrate';
  back.innerHTML = `<div class="modal-card celebrate-card">
    <div class="celebrate-icon">${icon}</div>
    <h3>${title}</h3>${text ? `<p>${text}</p>` : ''}
    <div class="modal-btns"><button class="m-ok">¡Sigamos! / Let's go!</button></div>
  </div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 300); };
  back.querySelector('.m-ok').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
}

// Detecta enemigos recién derrotados comparando antes/después de un abono
let _deudasVivasAntes = null;
function snapshotDeudasVivas() {
  const set = new Set();
  for (const d of (S.debts || [])) {
    const tot = d.initial + compradoEn(d.name);
    if (tot - d.abonado > 0) set.add(d.name);
  }
  for (const d of (S.extra_debts || [])) {
    if ((d.total - (d.abonado || 0)) > 0) set.add(d.name);
  }
  return set;
}

function modal({ icon = '⚔', title = '', text = '', fields = [], okText = 'Confirmar', danger = false, extraBtn = null, cancelText = null }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'modal-back';
    const fieldsHtml = fields.map((f, i) => {
      const lab = f.label ? `<label class="mfield-lab">${f.label}</label>` : '';
      if (f.type === 'select')
        return lab + `<select data-i="${i}">${f.options.map(o => { const v = o.v ?? o; const t = o.t ?? o; const sel = (f.value != null && String(f.value) === String(v)) ? ' selected' : ''; return `<option value="${v}"${sel}>${t}</option>`; }).join('')}</select>`;
      if (f.type === 'money') {
        const initVal = f.value != null && f.value !== '' ? Number(f.value).toLocaleString('es-CO') : '';
        return lab + `<input data-i="${i}" data-money="1" type="text" inputmode="numeric" placeholder="${f.placeholder || ''}" value="${initVal}">`;
      }
      return lab + `<input data-i="${i}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" value="${f.value ?? ''}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`;
    }).join('');
    back.innerHTML = `<div class="modal-card">
      <div class="modal-icon">${icon}</div>
      <h3>${title}</h3>${text ? `<p>${text}</p>` : ''}
      ${fieldsHtml}
      <div class="modal-btns">
        ${fields.length || !danger || cancelText ? `<button class="m-cancel">${cancelText || 'Cancel'}</button>` : ''}
        ${extraBtn ? `<button class="m-extra danger">${extraBtn}</button>` : ''}
        <button class="m-ok ${danger ? 'danger' : ''}">${okText}</button>
      </div></div>`;
    document.body.appendChild(back);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => back.classList.add('show'));
    let closed = false;
    const close = (val) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown);
      back.classList.remove('show');
      setTimeout(() => {
        back.remove();
        if (!document.querySelector('.modal-back')) document.body.classList.remove('modal-open');
        if (previousFocus && previousFocus.focus) previousFocus.focus();
      }, 280);
      resolve(val);
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close(null); return; }
      if (ev.key !== 'Tab') return;
      const focusables = [...back.querySelectorAll('button,input,select,textarea,[href]')].filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const firstEl = focusables[0], lastEl = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === firstEl) { ev.preventDefault(); lastEl.focus(); }
      else if (!ev.shiftKey && document.activeElement === lastEl) { ev.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    back.querySelector('.m-ok').onclick = () => {
      if (fields.length) {
        const vals = [...back.querySelectorAll('[data-i]')].map(el =>
          el.dataset.money ? el.value.replace(/\./g, '').replace(/[^0-9-]/g, '') : el.value);
        close(vals);
      } else close(true);
    };
    const extra = back.querySelector('.m-extra');
    if (extra) extra.onclick = () => close('EXTRA');
    const cancel = back.querySelector('.m-cancel');
    if (cancel) cancel.onclick = () => close(null);
    back.onclick = (e) => { if (e.target === back) close(null); };
    // formateo de miles en vivo para campos money
    back.querySelectorAll('[data-money]').forEach(inp => {
      inp.addEventListener('input', () => {
        const limpio = inp.value.replace(/\./g, '').replace(/[^0-9]/g, '');
        inp.value = limpio ? Number(limpio).toLocaleString('es-CO') : '';
      });
    });
    const first = back.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 100);
  });
}
async function confirmModal(title, text, danger = true) {
  return await modal({ icon: danger ? '⚠' : '❓', title, text, okText: 'Yes, do it', danger }) === true;
}

function checkVersion() {
  if (S.version === FRONT_V) return;
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="background:#e0445c;color:#fff;padding:10px 16px;text-align:center;font-weight:700">' +
    '⚠ Archivos desparejados: servidor v' + (S.version || 1) + ' / navegador v' + FRONT_V +
    '. Reemplaza app.py y reinicia el servidor (Ctrl+C → python app.py), luego Ctrl+F5.</div>');
}

/* ---------- GYM & FITNESS ---------- */
const MEASURES = [
  { key: 'weight', label: 'Weight', unit: 'kg', good: 'down' },
  { key: 'waist',  label: 'Waist',  unit: 'cm', good: 'down' },
  { key: 'chest',  label: 'Chest',  unit: 'cm', good: 'flat' },
  { key: 'arm',    label: 'Arm (flexed)', unit: 'cm', good: 'flat' },
  { key: 'hip',    label: 'Hips',   unit: 'cm', good: 'down' },
  { key: 'thigh',  label: 'Thigh',  unit: 'cm', good: 'flat' }
];
function getGym() {
  try { return JSON.parse((S.profile || {}).gym_data || '{}'); } catch { return {}; }
}
async function saveGym(g) {
  await api('/api/profile', { body: { key: 'gym_data', value: JSON.stringify(g) } });
}
let gymChart = null;

const GYM_IMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const EXERCISE_DB = {
  bench:        { n: 'Bench Press',            m: 'Chest',         img: 'Barbell_Bench_Press_-_Medium_Grip', grp: 'chest',     eq: 'Barbell' },
  incline_db:   { n: 'Incline Dumbbell Press', m: 'Upper chest',   img: 'Incline_Dumbbell_Press',             grp: 'chest',     eq: 'Dumbbell' },
  flyes:        { n: 'Dumbbell Flyes',         m: 'Chest',         img: 'Dumbbell_Flyes',                     grp: 'chest',     eq: 'Dumbbell' },
  pushups:      { n: 'Push-ups',               m: 'Chest',         img: 'Pushups',                            grp: 'chest',     eq: 'Bodyweight' },
  dips_chest:   { n: 'Chest Dips',             m: 'Chest',         img: 'Dips_-_Chest_Version',               grp: 'chest',     eq: 'Dip bars' },
  tri_pushdown: { n: 'Triceps Pushdown',       m: 'Triceps',       img: 'Triceps_Pushdown',                   grp: 'triceps',   eq: 'Cable' },
  tri_ext:      { n: 'Overhead Triceps Ext.',  m: 'Triceps',       img: 'Standing_Dumbbell_Triceps_Extension', grp: 'triceps',  eq: 'Dumbbell' },
  dips_tri:     { n: 'Triceps Dips',           m: 'Triceps',       img: 'Dips_-_Triceps_Version',             grp: 'triceps',   eq: 'Dip bars' },
  pullups:      { n: 'Pull-ups',               m: 'Back / Lats',   img: 'Pullups',                            grp: 'back',      eq: 'Pull-up bar' },
  lat_pull:     { n: 'Lat Pulldown',           m: 'Back / Lats',   img: 'Wide-Grip_Lat_Pulldown',             grp: 'back',      eq: 'Cable machine' },
  bb_row:       { n: 'Barbell Row',            m: 'Back',          img: 'Bent_Over_Barbell_Row',              grp: 'back',      eq: 'Barbell' },
  cable_row:    { n: 'Seated Cable Row',       m: 'Back',          img: 'Seated_Cable_Rows',                  grp: 'back',      eq: 'Cable machine' },
  bb_curl:      { n: 'Barbell Curl',           m: 'Biceps',        img: 'Barbell_Curl',                       grp: 'biceps',    eq: 'Barbell' },
  db_curl:      { n: 'Dumbbell Curl',          m: 'Biceps',        img: 'Dumbbell_Bicep_Curl',                grp: 'biceps',    eq: 'Dumbbell' },
  hammer:       { n: 'Hammer Curls',           m: 'Biceps',        img: 'Hammer_Curls',                       grp: 'biceps',    eq: 'Dumbbell' },
  squat:        { n: 'Barbell Squat',          m: 'Quads / Legs',  img: 'Barbell_Squat',                      grp: 'quads',     eq: 'Barbell' },
  leg_press:    { n: 'Leg Press',              m: 'Quads / Legs',  img: 'Leg_Press',                          grp: 'quads',     eq: 'Machine' },
  rdl:          { n: 'Romanian Deadlift',      m: 'Hamstrings',    img: 'Romanian_Deadlift',                  grp: 'hamstrings', eq: 'Barbell' },
  leg_ext:      { n: 'Leg Extensions',         m: 'Quads',         img: 'Leg_Extensions',                     grp: 'quads',     eq: 'Machine' },
  leg_curl:     { n: 'Lying Leg Curl',         m: 'Hamstrings',    img: 'Lying_Leg_Curls',                    grp: 'hamstrings', eq: 'Machine' },
  calf:         { n: 'Calf Raises',            m: 'Calves',        img: 'Standing_Calf_Raises',               grp: 'calves',    eq: 'Machine / Bodyweight' },
  lunges:       { n: 'Dumbbell Lunges',        m: 'Legs / Glutes', img: 'Dumbbell_Lunges',                    grp: 'quads',     eq: 'Dumbbell' },
  db_press:     { n: 'DB Shoulder Press',      m: 'Shoulders',     img: 'Dumbbell_Shoulder_Press',            grp: 'shoulders', eq: 'Dumbbell' },
  lateral:      { n: 'Lateral Raise',          m: 'Side delts',    img: 'Side_Lateral_Raise',                 grp: 'shoulders', eq: 'Dumbbell' },
  face_pull:    { n: 'Face Pull',              m: 'Rear delts',    img: 'Face_Pull',                          grp: 'shoulders', eq: 'Cable' },
  crunch:       { n: 'Crunches',               m: 'Abs',           img: 'Crunches',                           grp: 'abs',       eq: 'Bodyweight' },
  plank:        { n: 'Plank',                  m: 'Core',          img: 'Plank',                              grp: 'abs',       eq: 'Bodyweight' },
  hanging:      { n: 'Hanging Leg Raise',      m: 'Abs',           img: 'Hanging_Leg_Raise',                  grp: 'abs',       eq: 'Pull-up bar' },
  // --- alternativas extra (más opciones para "Replace") ---
  cable_cross:  { n: 'Cable Crossover',        m: 'Chest',         img: 'Cable_Crossover',                    grp: 'chest',     eq: 'Cable' },
  machine_bench:{ n: 'Machine Bench Press',    m: 'Chest',         img: 'Machine_Bench_Press',                grp: 'chest',     eq: 'Machine' },
  db_bench:     { n: 'Dumbbell Bench Press',   m: 'Chest',         img: 'Dumbbell_Bench_Press',               grp: 'chest',     eq: 'Dumbbell' },
  close_grip:   { n: 'Close-Grip Bench Press', m: 'Triceps',       img: 'Close-Grip_Barbell_Bench_Press',     grp: 'triceps',   eq: 'Barbell' },
  bench_dips2:  { n: 'Bench Dips',             m: 'Triceps',       img: 'Bench_Dips',                         grp: 'triceps',   eq: 'Bodyweight' },
  cable_ext_1:  { n: '1-Arm Cable Extension',  m: 'Triceps',       img: 'Cable_One_Arm_Tricep_Extension',     grp: 'triceps',   eq: 'Cable' },
  tbar_row:     { n: 'T-Bar Row',              m: 'Back',          img: 'Lying_T-Bar_Row',                    grp: 'back',      eq: 'Machine' },
  one_arm_row:  { n: 'One-Arm Dumbbell Row',   m: 'Back',          img: 'One-Arm_Dumbbell_Row',               grp: 'back',      eq: 'Dumbbell' },
  deadlift:     { n: 'Barbell Deadlift',       m: 'Back / Posterior', img: 'Barbell_Deadlift',                grp: 'back',      eq: 'Barbell' },
  chinup:       { n: 'Chin-Up',                m: 'Back / Lats',   img: 'Chin-Up',                            grp: 'back',      eq: 'Pull-up bar' },
  concentration:{ n: 'Concentration Curl',     m: 'Biceps',        img: 'Concentration_Curls',                grp: 'biceps',    eq: 'Dumbbell' },
  preacher:     { n: 'Preacher Curl',          m: 'Biceps',        img: 'Preacher_Curl',                      grp: 'biceps',    eq: 'Barbell' },
  cable_curl2:  { n: 'Cable Curl',             m: 'Biceps',        img: 'High_Cable_Curls',                   grp: 'biceps',    eq: 'Cable' },
  front_squat:  { n: 'Front Squat',            m: 'Quads / Legs',  img: 'Front_Squat_Clean_Grip',             grp: 'quads',     eq: 'Barbell' },
  hack_squat:   { n: 'Hack Squat',             m: 'Quads / Legs',  img: 'Hack_Squat',                         grp: 'quads',     eq: 'Machine' },
  goblet:       { n: 'Goblet Squat',           m: 'Quads / Legs',  img: 'Goblet_Squat',                       grp: 'quads',     eq: 'Kettlebell' },
  stiff_db:     { n: 'Stiff-Leg DB Deadlift',  m: 'Hamstrings',    img: 'Stiff-Legged_Dumbbell_Deadlift',     grp: 'hamstrings', eq: 'Dumbbell' },
  good_morning: { n: 'Good Morning',           m: 'Hamstrings',    img: 'Good_Morning',                       grp: 'hamstrings', eq: 'Barbell' },
  seated_calf:  { n: 'Seated Calf Raise',      m: 'Calves',        img: 'Seated_Calf_Raise',                  grp: 'calves',    eq: 'Machine' },
  donkey_calf:  { n: 'Donkey Calf Raises',     m: 'Calves',        img: 'Donkey_Calf_Raises',                 grp: 'calves',    eq: 'Machine' },
  arnold:       { n: 'Arnold Press',           m: 'Shoulders',     img: 'Arnold_Dumbbell_Press',              grp: 'shoulders', eq: 'Dumbbell' },
  bb_press:     { n: 'Barbell Shoulder Press', m: 'Shoulders',     img: 'Barbell_Shoulder_Press',             grp: 'shoulders', eq: 'Barbell' },
  upright_row:  { n: 'Upright Row',            m: 'Shoulders',     img: 'Upright_Barbell_Row',                grp: 'shoulders', eq: 'Barbell' },
  rear_delt:    { n: 'Cable Rear Delt Fly',    m: 'Rear delts',    img: 'Cable_Rear_Delt_Fly',                grp: 'shoulders', eq: 'Cable' },
  cable_crunch: { n: 'Cable Crunch',           m: 'Abs',           img: 'Cable_Crunch',                       grp: 'abs',       eq: 'Cable' },
  russian_twist:{ n: 'Russian Twist',          m: 'Obliques',      img: 'Russian_Twist',                      grp: 'abs',       eq: 'Bodyweight' },
  ab_roller:    { n: 'Ab Roller',              m: 'Abs',           img: 'Ab_Roller',                          grp: 'abs',       eq: 'Ab wheel' },
  situp:        { n: 'Sit-Up',                 m: 'Abs',           img: 'Sit-Up',                             grp: 'abs',       eq: 'Bodyweight' },
  reverse_crunch:{ n: 'Reverse Crunch',        m: 'Abs',           img: 'Reverse_Crunch',                     grp: 'abs',       eq: 'Bodyweight' }
};
// list item = [exerciseId, sets, repsRange, restSeconds]
const WORKOUT_PLAN = {
  1: { title: '💪 Chest + Triceps', list: [['bench',4,'8-12',90],['incline_db',3,'10-12',75],['flyes',3,'12-15',60],['tri_pushdown',3,'10-12',60],['tri_ext',3,'12-15',60]] },
  2: { title: '🦾 Back + Biceps',   list: [['lat_pull',4,'8-12',90],['bb_row',4,'8-10',90],['cable_row',3,'10-12',75],['bb_curl',3,'8-12',60],['hammer',3,'10-12',60]] },
  3: { title: '🦵 Legs',            list: [['squat',4,'8-12',120],['leg_press',3,'10-12',90],['rdl',3,'10-12',90],['leg_curl',3,'12-15',60],['calf',4,'15-20',45]] },
  4: { title: '🎯 Shoulders + Abs', list: [['db_press',4,'8-12',90],['lateral',4,'12-15',60],['face_pull',3,'15-20',60],['hanging',3,'10-15',60],['plank',3,'30-60s',45]] },
  5: { title: '🔥 Full Body',       list: [['squat',3,'10',90],['bench',3,'10',90],['bb_row',3,'10',90],['db_press',3,'12',75],['plank',3,'45s',45]] },
  0: { rest: true, title: '🌿 Rest day' },
  6: { rest: true, title: '🌿 Rest day' }
};
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
let GYM_PLAN_SEL = null;   // null = today's plan

function gymSetsFor(exId, dateStr) {
  return (S.gym_sets || []).filter(s => s.exercise === exId && s.date === dateStr).sort((a, b) => a.id - b.id);
}
function gymLastSession(exId) {
  const today = hoyLocal();
  const dates = [...new Set((S.gym_sets || []).filter(s => s.exercise === exId && s.date < today).map(s => s.date))].sort();
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  return { date: last, sets: gymSetsFor(exId, last) };
}
function fmtSets(sets) {
  return sets.map(s => `${(+s.weight) || 0}${s.weight ? 'kg' : ''}×${s.reps}`).join(', ');
}
function gymSuggest(exId, repsRange) {
  const last = gymLastSession(exId);
  const parts = String(repsRange).replace(/[^0-9-]/g, '').split('-');
  const topRep = parseInt(parts[parts.length - 1], 10) || 10;
  const lowRep = parseInt(parts[0], 10) || topRep;
  if (!last || !last.sets.length) return { weight: '', reps: '', text: 'First time — pick a weight you can fully control for the whole rep range.' };
  const lastSet = last.sets[last.sets.length - 1];
  const allHitTop = last.sets.every(s => s.reps >= topRep);
  if (allHitTop && lastSet.weight > 0)
    return { weight: +(lastSet.weight + 2.5).toFixed(1), reps: lowRep, text: `You hit the top reps last time → go up to ${+(lastSet.weight + 2.5)} kg.` };
  return { weight: lastSet.weight || '', reps: (lastSet.reps + 1) || '', text: `Stay at ${lastSet.weight || '?'} kg and aim for 1 more rep than last time.` };
}
function gymProgression(exId) {
  const today = gymSetsFor(exId, hoyLocal());
  const last = gymLastSession(exId);
  if (!today.length || !last) return null;
  const best = arr => Math.max(...arr.map(s => (+s.weight || 0) * 1000 + (s.reps || 0)));
  const vol = arr => arr.reduce((a, s) => a + (+s.weight || 0) * (s.reps || 0), 0);
  const t = best(today), l = best(last.sets);
  if (t > l || vol(today) > vol(last.sets)) return { cls: 'ok', text: '⬆ Stronger than last session — progress!' };
  if (t === l && vol(today) === vol(last.sets)) return { cls: 'mut', text: '➡ Matched last session — solid.' };
  return { cls: 'bad', text: '⬇ A bit below last time — totally fine, rest & food matter too.' };
}

// ---- Preferencias de la rutina: reemplazos de ejercicio y # de series, por día de plan ----
function getGymPrefs() { try { return JSON.parse((S.profile || {}).gym_prefs || '{}'); } catch { return {}; } }
async function saveGymPrefs(p) {
  await api('/api/profile', { body: { key: 'gym_prefs', value: JSON.stringify(p) } });
  S.profile = S.profile || {};
  S.profile.gym_prefs = JSON.stringify(p);   // reflejar local YA, para que renderWorkout() lo vea sin esperar un reload
}
function slotKey(wd, origId) { return `${wd}_${origId}`; }
function effectiveExId(wd, origId) { const p = getGymPrefs(); return (p.swaps && p.swaps[slotKey(wd, origId)]) || origId; }
function effectiveSetCount(wd, origId, baseSets) {
  const p = getGymPrefs(); const v = p.setcount && p.setcount[slotKey(wd, origId)];
  return (v != null) ? v : baseSets;
}
function altsFor(origId) {
  const orig = EXERCISE_DB[origId]; if (!orig) return [];
  return Object.entries(EXERCISE_DB).filter(([k, v]) => k !== origId && v.grp === orig.grp).map(([k, v]) => ({ id: k, ...v }));
}
let GYM_CELEBRATED_DATE = null;

function renderWorkout() {
  const box = document.getElementById('workoutBox');
  if (!box) return;
  const sel = document.getElementById('workoutDay');
  const todayWd = new Date().getDay();
  if (sel && !sel.dataset.ready) {
    let opts = `<option value="today">Today · ${DAY_NAMES[todayWd]}</option>`;
    [1, 2, 3, 4, 5].forEach(w => { opts += `<option value="${w}">${WORKOUT_PLAN[w].title}</option>`; });
    opts += `<option value="rest">🌿 Rest day</option>`;
    sel.innerHTML = opts;
    sel.dataset.ready = '1';
    sel.addEventListener('change', () => { GYM_PLAN_SEL = sel.value; renderWorkout(); });
  }
  let wd;
  if (GYM_PLAN_SEL == null || GYM_PLAN_SEL === 'today') wd = todayWd;
  else if (GYM_PLAN_SEL === 'rest') wd = 0;
  else wd = +GYM_PLAN_SEL;
  const plan = WORKOUT_PLAN[wd] || WORKOUT_PLAN[0];
  const titleEl = document.getElementById('workoutTitle');
  if (titleEl) titleEl.textContent = (GYM_PLAN_SEL == null || GYM_PLAN_SEL === 'today') ? `🔥 Today · ${plan.title.replace(/^\S+\s/, '')}` : plan.title;

  if (plan.rest) {
    box.innerHTML = `<div class="rest-day"><div class="big">🌿</div>
      <p><b>Rest day.</b> Muscle grows while you recover, not while you train. Protect it like a payment.</p>
      <p class="hint">Optional light stuff: a 30–45 min walk toward your 10k steps, gentle stretching or mobility, foam rolling. No heavy lifting today.</p></div>`;
    return;
  }

  const offDay = (wd !== todayWd);
  const banner = offDay
    ? `<div class="workout-banner">📅 You're viewing <b>${plan.title.replace(/^\S+\s/, '')}</b>, but today is <b>${DAY_NAMES[todayWd]}</b>. Sets you log are saved to <b>today</b>. Switch the menu to <b>Today</b> for your scheduled workout.</div>`
    : '';
  let allDone = true;
  box.innerHTML = banner + plan.list.map(([origId, baseSets, reps, rest]) => {
    const origEx = EXERCISE_DB[origId]; if (!origEx) return '';
    const id = effectiveExId(wd, origId);             // ejercicio efectivo (puede estar reemplazado)
    const ex = EXERCISE_DB[id] || origEx;
    const sets = effectiveSetCount(wd, origId, baseSets);  // # de series efectivo (puede estar editado)
    const today = gymSetsFor(id, hoyLocal());
    const last = gymLastSession(id);
    const sug = gymSuggest(id, reps);
    const prog = gymProgression(id);
    const done = today.length >= sets;
    if (!done) allDone = false;
    const swapped = id !== origId;
    // sugerencia sutil de variación: 8+ sesiones distintas en el mismo ejercicio sin cambiarlo
    const sessionsCount = new Set((S.gym_sets || []).filter(s => s.exercise === id).map(s => s.date)).size;
    const suggestVariation = !swapped && sessionsCount >= 8 && altsFor(id).length > 0;

    // Mostrar TODAS las series: hechas (✓), la activa (inputs) y las que faltan (objetivo).
    const shown = Math.max(sets, today.length);
    let rowsHtml = '';
    for (let i = 0; i < shown; i++) {
      if (i < today.length) {                       // serie ya registrada
        const s = today[i];
        rowsHtml += `<div class="set-row set-done">
          <span class="set-n">Set ${i + 1}</span>
          <span class="set-val">${(+s.weight) || 0} kg × ${s.reps}</span>
          <button class="set-undo" data-undo="${s.id}" title="Undo set">✕</button></div>`;
      } else if (i === today.length) {              // serie activa (a registrar ahora)
        const wVal = today.length ? ((+today[today.length - 1].weight) || '') : (sug.weight || '');
        const rVal = today.length ? (today[today.length - 1].reps || '') : (sug.reps || '');
        rowsHtml += `<div class="set-row set-live">
          <span class="set-n">Set ${i + 1}</span>
          <input class="set-w" type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg" value="${wVal}">
          <span class="set-x">×</span>
          <input class="set-r" type="number" inputmode="numeric" min="0" placeholder="reps" value="${rVal}">
          <button class="set-log" data-log="${id}" title="Log this set">✓</button></div>`;
      } else {                                       // series que faltan (objetivo)
        rowsHtml += `<div class="set-row set-upcoming">
          <span class="set-n">Set ${i + 1}</span>
          <span class="set-val mut">target ${reps} reps</span></div>`;
      }
    }
    if (today.length >= shown) {                     // todo hecho: fila opcional para una serie extra
      rowsHtml += `<div class="set-row set-live set-extra">
        <span class="set-n">Extra</span>
        <input class="set-w" type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg" value="${(+today[today.length - 1].weight) || ''}">
        <span class="set-x">×</span>
        <input class="set-r" type="number" inputmode="numeric" min="0" placeholder="reps" value="">
        <button class="set-log" data-log="${id}" title="Log an extra set">✓</button></div>`;
    }
    // controles de # de series: quitar solo si hay filas "target" sin registrar aún
    const canRemoveSet = sets > Math.max(1, today.length);
    const setCtrl = `<div class="set-ctrl">
      ${canRemoveSet ? `<button class="set-adj" data-adj="-1" data-wd="${wd}" data-orig="${origId}" data-base="${baseSets}">− Remove a set</button>` : '<span></span>'}
      <button class="set-adj" data-adj="1" data-wd="${wd}" data-orig="${origId}" data-base="${baseSets}">+ Add a set</button>
    </div>`;

    return `<div class="ex-card ${done ? 'ex-done' : ''}" data-ex="${id}">
      <div class="ex-top">
        <img class="ex-img" loading="lazy" src="${GYM_IMG}${ex.img}/0.jpg" alt="" onerror="this.classList.add('noimg')">
        <div class="ex-head">
          <div class="ex-name">${ex.n} ${done ? '<span class="ex-check">✓ done</span>' : ''}</div>
          <div class="ex-mus">${ex.m}${swapped ? ' · <span class="swap-tag">🔄 replaced</span>' : ''}</div>
          <div class="ex-target">${sets} sets × ${reps} · rest ${rest}s</div>
        </div>
        <div class="ex-actions">
          <button class="replace-btn" data-replace="${origId}" data-wd="${wd}" title="Replace exercise">🔄 Replace</button>
          ${swapped ? `<button class="restore-btn" data-restore="${origId}" data-wd="${wd}" title="Restore original">↺ Original</button>` : ''}
        </div>
      </div>
      <div class="ex-coach">
        ${last ? `<div class="ex-last">📋 Last (${last.date.slice(5)}): ${fmtSets(last.sets)}</div>` : '<div class="ex-last mut">No history yet — today sets your baseline.</div>'}
        <div class="ex-suggest">🎯 ${sug.text}</div>
        ${prog ? `<div class="ex-prog ${prog.cls}">${prog.text}</div>` : ''}
        ${suggestVariation ? `<div class="ex-variation">🔄 You've done this ${sessionsCount} sessions — <button class="link-like" data-replace="${origId}" data-wd="${wd}">try a variation?</button></div>` : ''}
      </div>
      <div class="ex-sets">${rowsHtml}</div>
      ${setCtrl}
    </div>`;
  }).join('');

  // celebración al completar toda la rutina de HOY (una sola vez por fecha)
  if (allDone && (GYM_PLAN_SEL == null || GYM_PLAN_SEL === 'today') && wd === todayWd && GYM_CELEBRATED_DATE !== hoyLocal()) {
    GYM_CELEBRATED_DATE = hoyLocal();
    showWorkoutCelebration();
  }
}

function showWorkoutCelebration() {
  const back = document.createElement('div');
  back.className = 'modal-back celebrate-back';
  back.innerHTML = `<div class="modal-card celebrate-card">
    <div class="celebrate-icon">🎉</div>
    <h3>Great job!</h3>
    <p>Workout completed.<br>See you tomorrow.</p>
    <button class="m-ok">Nice!</button></div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 280); };
  back.querySelector('.m-ok').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  setTimeout(close, 4000);
}

function exercisePickerModal(origId, wd) {
  const alts = altsFor(origId);
  const html = alts.map(a => `<div class="alt-pick" data-pick="${a.id}">
      <img class="alt-img" loading="lazy" src="${GYM_IMG}${a.img}/0.jpg" alt="" onerror="this.classList.add('noimg')">
      <div class="alt-info"><b>${a.n}</b><small>${a.m} · ${a.eq}</small></div>
    </div>`).join('') || '<p class="hint">No alternatives found for this muscle group.</p>';
  const back = document.createElement('div');
  back.className = 'modal-back doc-back';
  back.innerHTML = `<div class="modal-card doc-card alt-card">
    <div class="doc-head"><h3>🔄 Replace exercise</h3><button class="doc-x" title="Close">✕</button></div>
    <div class="doc-body alt-body">${html}</div></div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 280); };
  back.querySelector('.doc-x').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', async () => {
    const p = getGymPrefs(); p.swaps = p.swaps || {};
    p.swaps[slotKey(wd, origId)] = el.dataset.pick;
    await saveGymPrefs(p);
    close();
    toast('🔄 Exercise replaced for this slot');
    renderWorkout();
  }));
}

document.getElementById('workoutBox')?.addEventListener('click', async (e) => {
  const replaceBtn = e.target.closest('[data-replace]');
  if (replaceBtn) { exercisePickerModal(replaceBtn.dataset.replace, replaceBtn.dataset.wd); return; }

  const restoreBtn = e.target.closest('[data-restore]');
  if (restoreBtn) {
    const p = getGymPrefs(); p.swaps = p.swaps || {};
    delete p.swaps[slotKey(restoreBtn.dataset.wd, restoreBtn.dataset.restore)];
    await saveGymPrefs(p);
    toast('↺ Original exercise restored');
    renderWorkout();
    return;
  }

  const adjBtn = e.target.closest('[data-adj]');
  if (adjBtn) {
    const wd = adjBtn.dataset.wd, orig = adjBtn.dataset.orig, base = +adjBtn.dataset.base, delta = +adjBtn.dataset.adj;
    const p = getGymPrefs(); p.setcount = p.setcount || {};
    const key = slotKey(wd, orig);
    const cur = p.setcount[key] != null ? p.setcount[key] : base;
    const today = gymSetsFor(effectiveExId(wd, orig), hoyLocal());
    const next = Math.max(Math.max(1, today.length), Math.min(10, cur + delta));
    if (delta < 0 && next >= cur) { toast('You already logged that many sets today'); return; }
    p.setcount[key] = next;
    await saveGymPrefs(p);
    renderWorkout();
    return;
  }

  const log = e.target.closest('[data-log]');
  if (log) {
    // si HOY es día de descanso, no se registra: mensaje amable (aunque estés viendo otro plan)
    const todayPlan = WORKOUT_PLAN[new Date().getDay()];
    if (todayPlan && todayPlan.rest) {
      toast('Today is your rest day 🌿 — there\'s no workout to log. Rest is part of the plan!');
      return;
    }
    const card = log.closest('.ex-card');
    const w = parseFloat(String(card.querySelector('.set-w').value).replace(',', '.')) || 0;
    const r = parseInt(card.querySelector('.set-r').value, 10) || 0;
    if (r <= 0) { toast('Type the reps first 💪'); return; }
    try {
      const res = await api('/api/gym/set', { quiet: true, body: { date: hoyLocal(), exercise: log.dataset.log, weight: w, reps: r } });
      S.gym_sets = S.gym_sets || [];
      S.gym_sets.push({ id: res.id, date: hoyLocal(), exercise: log.dataset.log, weight: w, reps: r });
      renderWorkout(); renderGym();
    } catch (err) {
      toast('Couldn\'t save that set right now — please try again in a moment.');
    }
    return;
  }
  const undo = e.target.closest('[data-undo]');
  if (undo) {
    const id = +undo.dataset.undo;
    try {
      await api('/api/gym/set/' + id, { method: 'DELETE', quiet: true });
      S.gym_sets = (S.gym_sets || []).filter(s => s.id != id);
      renderWorkout(); renderGym();
    } catch (err) {
      toast('Couldn\'t undo that set right now — please try again.');
    }
    return;
  }
});

// Recomendación inteligente de peso objetivo (basada sobre todo en el objetivo físico + estatura)
function recommendGoalWeight(g) {
  const h = g.height ? +g.height : null;           // cm
  if (!h || h < 120 || h > 230) return null;       // sin estatura razonable no se calcula
  const hm = h / 100;
  const txt = (g.goal || '').toLowerCase();
  let bmi = 23, why = 'an athletic, balanced build (BMI ≈ 23)';
  if (/(fat|grasa|abs|abdomin|lean|defin|cut|llant|delgad|marcar|perder|adelgaz)/.test(txt)) {
    bmi = 22; why = 'a lean, defined look so your abs show (BMI ≈ 22)';
  } else if (/(muscle|m[uú]sculo|masa|mass|volum|gain|ganar|grande|bulk|fuerza)/.test(txt)) {
    bmi = 24.5; why = 'building muscle mass (BMI ≈ 24.5)';
  }
  let kg = +(bmi * hm * hm).toFixed(1);
  const ents = (g.entries || []).filter(e => e.weight != null);
  const curW = ents.length ? ents[ents.length - 1].weight : null;
  if (curW != null && bmi <= 22 && kg >= curW) kg = +(curW - 1).toFixed(1);  // ya está magro: meta = mantener
  return { kg, why, bmi };
}
// Peso objetivo efectivo: manual si el usuario lo fijó, si no la recomendación automática
function effectiveGoal(g) {
  if (g.weightManual && g.weightGoal != null && g.weightGoal !== '')
    return { kg: +g.weightGoal, auto: false };
  const rec = recommendGoalWeight(g);
  return rec ? { kg: rec.kg, auto: true, why: rec.why } : null;
}

function renderGym() {
  const panel = document.getElementById('gymStats');
  if (!panel) return;
  renderWorkout();
  const g = getGym();
  const entries = (g.entries || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = g.baseline || entries[0] || null;               // punto de partida FIJO, no se sobreescribe
  const last = entries[entries.length - 1] || g.baseline || null;

  // resumen
  const startDate = g.start || (first && first.date) || null;
  const semanas = startDate ? Math.max(0, Math.floor((Date.now() - new Date(startDate + 'T00:00:00')) / (7 * 86400000))) : 0;
  const curW = last && last.weight != null ? last.weight : null;
  const eg = effectiveGoal(g);
  const goalW = eg ? eg.kg : null;
  const toGo = (curW != null && goalW != null) ? +(curW - goalW).toFixed(1) : null;
  const exHabit = (S.habits || []).find(h => h.name === 'Exercise');
  const exStreak = exHabit ? rachaHabito(exHabit.id, new Set(S.marks || []), [6]) : 0;
  const card = (label, val, sub) => `<div class="card gym-card"><label>${label}</label><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  panel.innerHTML =
    card('Current weight', curW != null ? curW + ' kg' : '—', curW == null ? 'log it when you have it' : '') +
    card('Goal weight', goalW != null ? goalW + ' kg' : '—', eg ? (eg.auto ? '✨ auto · tap Edit to override' : 'set by you') : 'add your height for auto') +
    card('To go', toGo != null ? (toGo > 0 ? toGo + ' kg' : '🎉 reached!') : '—', '') +
    card('Weeks in', semanas, startDate ? 'since ' + startDate : 'set a start date') +
    card('🔥 Training streak', exStreak + (exStreak === 1 ? ' day' : ' days'), 'from your Exercise habit');

  // objetivo
  const goalBox = document.getElementById('gymGoal');
  const goalWLine = goalW != null
    ? `${goalW} kg ${eg.auto ? '<span class="auto-tag">✨ auto</span>' : '<span class="auto-tag manual">manual</span>'}`
    : '— (add your height to get an auto recommendation)';
  goalBox.innerHTML =
    `<div class="gym-goal-row"><span>🏁 Start date</span><b>${g.start || '—'}</b></div>
     <div class="gym-goal-row"><span>📏 Height</span><b>${g.height ? g.height + ' cm' : '—'}</b></div>
     <div class="gym-goal-row"><span>⚖️ Goal weight</span><b>${goalWLine}</b></div>
     ${eg && eg.auto ? `<div class="gym-goal-why">✨ Recommended for ${eg.why}. You can override it in Edit. <span class="link-like" id="gymWhyLink">How is this calculated?</span></div>` : ''}
     <div class="gym-goal-row"><span>💪 Physical goal</span><b>${g.goal ? esc(g.goal) : 'Lower body fat · abs back · athletic, defined look'}</b></div>
     ${g.baseline ? `<div class="gym-goal-row"><span>📍 Starting point (fixed)</span><b>${MEASURES.map(m => g.baseline[m.key] != null ? `${g.baseline[m.key]}${m.unit}` : null).filter(Boolean).join(' · ')} <button class="link-like" id="gymBaselineEdit">✎</button></b></div>` : ''}`;

  // gráfica: el baseline (punto de partida fijo) va como primer punto de la línea,
  // así con UNA sola medida ya se ve la tendencia desde el inicio.
  let serie = entries.slice();
  if (g.baseline && g.baseline.date && !serie.some(e => e.date === g.baseline.date)) {
    serie = [g.baseline, ...serie].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  renderGymChart(serie);

  // medidas última vs inicio (el inicio SIEMPRE es el baseline fijo, nunca se sobreescribe)
  const mBox = document.getElementById('gymMeasures');
  if (!entries.length && !g.baseline) {
    mBox.innerHTML = '<p class="hint">No measurements yet. Tap “+ Log this week” to start — you don’t even need your weight yet, log what you can.</p>';
  } else {
    mBox.innerHTML = MEASURES.map(m => {
      const lv = last && last[m.key] != null ? last[m.key] : null;
      const fv = first && first[m.key] != null ? first[m.key] : null;
      if (lv == null) return '';
      let delta = '';
      if (fv != null && lv !== fv) {
        const d = +(lv - fv).toFixed(1);
        const arrow = d < 0 ? '▼' : (d > 0 ? '▲' : '–');
        const cls = (d === 0 || m.good === 'flat') ? 'mut' : (d < 0 ? 'ok' : 'bad');
        delta = `<small class="${cls}">${arrow} ${Math.abs(d)} ${m.unit} vs start</small>`;
      } else if (fv != null) {
        delta = `<small class="mut">– same as start</small>`;
      }
      return `<div class="card-box gym-measure"><label>${m.label}</label><strong>${lv} ${m.unit}</strong>${delta}</div>`;
    }).join('') || '<p class="hint">Log some measurements to see your changes here.</p>';
  }

  // historial
  const hBox = document.getElementById('gymHistory');
  if (!entries.length) {
    hBox.innerHTML = '<p class="hint">Your weekly entries will appear here.</p>';
  } else {
    hBox.innerHTML = `<table class="table"><thead><tr><th>Date</th>${MEASURES.map(m => `<th>${m.label}</th>`).join('')}<th></th></tr></thead><tbody>${
      entries.slice().reverse().map(e => `<tr><td>${e.date}</td>${MEASURES.map(m => `<td>${e[m.key] != null ? e[m.key] : '—'}</td>`).join('')}<td><button class="del-x" data-gym-del="${e.date}" title="Delete">✕</button></td></tr>`).join('')
    }</tbody></table>`;
  }

  // ayuda para medir
  document.getElementById('gymHelp').innerHTML =
    `<p class="hint">A simple <b>sewing tape (metro de costura)</b> is all you need. Measure in the morning before eating, relaxed (don’t suck in), tape snug but not tight, same day each week.</p>
     <ul class="gym-help-list">
       <li><b>Waist</b> — the key one. Around the navel, relaxed. Your #1 fat-loss signal.</li>
       <li><b>Chest</b> — across the nipples, arms down, normal breath.</li>
       <li><b>Arm</b> — flexed bicep, at its thickest point.</li>
       <li><b>Hips</b> — widest part of the glutes.</li>
       <li><b>Thigh</b> — highest point, just under the glute.</li>
       <li><b>Weight</b> — same scale, morning, after bathroom, before eating.</li>
     </ul>
     <p class="hint">Don’t panic over one bad week — food and water move the scale daily. The <b>2-week trend</b> is the truth.</p>`;
}

function renderGymChart(entries) {
  const cv = document.getElementById('gymChart');
  if (!cv || typeof Chart === 'undefined') return;
  const hint = document.getElementById('gymChartHint');
  if (entries.length < 2) {
    if (gymChart) { gymChart.destroy(); gymChart = null; }
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    if (hint) hint.textContent = entries.length === 1 ? 'Log at least 2 weeks to see your trend line.' : '';
    return;
  }
  const labels = entries.map(e => e.date.slice(5));
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#7c5cff';
  const gold = css.getPropertyValue('--gold').trim() || '#f5c542';
  const mut = css.getPropertyValue('--mut').trim() || '#9aa';
  const ds = [];
  if (entries.some(e => e.weight != null))
    ds.push({ label: 'Weight (kg)', data: entries.map(e => e.weight ?? null), borderColor: gold, backgroundColor: 'transparent', tension: .3, spanGaps: true, yAxisID: 'y' });
  if (entries.some(e => e.waist != null))
    ds.push({ label: 'Waist (cm)', data: entries.map(e => e.waist ?? null), borderColor: accent, backgroundColor: 'transparent', tension: .3, spanGaps: true, yAxisID: 'y1' });
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: mut } } },
    scales: {
      x: { ticks: { color: mut }, grid: { display: false } },
      y: { position: 'left', ticks: { color: gold }, grid: { color: 'rgba(255,255,255,.06)' } },
      y1: { position: 'right', ticks: { color: accent }, grid: { display: false } }
    }
  };
  if (gymChart) gymChart.destroy();
  gymChart = new Chart(cv, { type: 'line', data: { labels, datasets: ds }, options: opts });
  if (hint) hint.textContent = 'Gold = weight · Purple = waist. Both trending down = fat loss is working. 🎯';
}

document.getElementById('gymLogBtn')?.addEventListener('click', async () => {
  const g = getGym();
  const last = (g.entries || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0] || {};
  const r = await modal({ icon: '🏋️', title: 'Log this week',
    text: 'Morning, relaxed, same day each week. Leave blank what you didn’t measure.',
    fields: MEASURES.map(m => ({ type: 'number', min: 0, label: `${m.label} (${m.unit})`, placeholder: last[m.key] != null ? 'last: ' + last[m.key] : m.unit })),
    okText: 'Save week' });
  if (!r) return;
  const entry = { date: hoyLocal() };
  let any = false;
  MEASURES.forEach((m, i) => {
    const raw = String(r[i] ?? '').trim();
    if (raw !== '') { entry[m.key] = +raw.replace(/[^0-9.]/g, '') || 0; any = true; }
  });
  if (!any) { toast('Add at least one measure to save'); return; }
  g.entries = (g.entries || []).filter(e => e.date !== entry.date);
  g.entries.push(entry);
  if (!g.start) g.start = entry.date;
  await saveGym(g);
  toast('💪 Week logged!');
  load();
});

document.getElementById('gymEditBtn')?.addEventListener('click', async () => {
  const g = getGym();
  const r = await modal({ icon: '🎯', title: 'My goal',
    fields: [
      { type: 'text', label: 'Start date (YYYY-MM-DD)', value: g.start || hoyLocal(), placeholder: 'YYYY-MM-DD' },
      { type: 'number', min: 0, label: 'Height in cm', value: g.height ?? '', placeholder: 'e.g. 172' },
      { type: 'text', label: 'Physical goal', value: g.goal || '', placeholder: 'e.g. lose fat, get abs back' },
      { type: 'number', min: 0, label: 'Goal weight in kg — leave blank for smart auto', value: (g.weightManual ? g.weightGoal : '') ?? '', placeholder: 'auto' }
    ], okText: 'Save' });
  if (!r) return;
  g.start = String(r[0] || '').trim() || g.start;
  const h = String(r[1] ?? '').trim();
  g.height = h === '' ? null : (+h.replace(/[^0-9.]/g, '') || null);
  g.goal = String(r[2] || '').trim();
  const w = String(r[3] ?? '').trim();
  if (w === '') { g.weightManual = false; g.weightGoal = null; }    // auto
  else { g.weightManual = true; g.weightGoal = +w.replace(/[^0-9.]/g, '') || null; }
  await saveGym(g);
  toast('🎯 Goal updated');
  load();
});

// Modal de documentación (overlay con scroll y X, sin salir de la pantalla)
function docModal(title, html) {
  const back = document.createElement('div');
  back.className = 'modal-back doc-back';
  back.innerHTML = `<div class="modal-card doc-card">
    <div class="doc-head"><h3>${title}</h3><button class="doc-x" title="Close">✕</button></div>
    <div class="doc-body">${html}</div></div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 280); };
  back.querySelector('.doc-x').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
}
const GYM_MANUAL_HTML = `
  <div class="guide-block">
    <h2>🏋️ How to log a workout</h2>
    <p>The app shows <b>today's workout</b> automatically based on the day of the week. Each exercise is a card with its photo, target muscles, sets × reps and rest time.</p>
    <p>Every planned set is a row. The active row has two boxes — <b>weight (kg)</b> and <b>reps</b>. Type them and tap <b>✓</b>; the set is saved and the next one becomes active. When you finish all sets the exercise turns green (<b>✓ done</b>). You can add an <b>Extra</b> set, or undo any set with <b>✕</b>.</p>
    <p>Training a different muscle group today? Use the dropdown to pick another day's plan — sets always save to <b>today's date</b>.</p>
  </div>
  <div class="guide-block">
    <h2>🧠 Smart history &amp; targets</h2>
    <p>Each exercise remembers your <b>last session</b> and shows it (e.g. <i>20kg×10, 20kg×10, 22.5kg×8</i>) plus a <b>target for today</b>:</p>
    <ul>
      <li>If you hit the <b>top of the rep range on every set</b> last time → it suggests <b>+2.5 kg</b>.</li>
      <li>If not → it suggests the <b>same weight, +1 rep</b>.</li>
    </ul>
    <p>The boxes come <b>pre-filled</b> with that suggestion. This is the core of real progress: <b>progressive overload</b>.</p>
  </div>
  <div class="guide-block">
    <h2>📈 How progression works</h2>
    <ul>
      <li><b class="g-ok">⬆ Stronger</b> — more weight or more total volume (weight × reps).</li>
      <li><b class="g-mut">➡ Matched</b> — same performance. Still a win.</li>
      <li><b class="g-bad">⬇ Below</b> — a bit less. Normal after bad sleep or low food. The weekly trend is what counts.</li>
    </ul>
  </div>
  <div class="guide-block">
    <h2>⚖️ How the Goal Weight is recommended</h2>
    <p>Leave Goal Weight blank and the app recommends one from your <b>height</b> and <b>physical goal</b>, using BMI as a sensible anchor:</p>
    <ul>
      <li><b>Fat loss / abs / definition</b> → BMI ≈ 22 (lean, abs-visible).</li>
      <li><b>Muscle / mass / strength</b> → BMI ≈ 24.5.</li>
      <li>Otherwise (athletic/recomp) → BMI ≈ 23.</li>
    </ul>
    <p>Formula: <b>goal kg = target BMI × (height in m)²</b>. If you're already leaner than the fat-loss target it eases toward maintaining. It updates on its own as your goal, height or weight change — never fixed forever. You can override it in <b>Edit</b> anytime.</p>
    <p class="hint">BMI is a rough guide, not body-fat. The real proof is the mirror, the waist tape and how clothes fit.</p>
  </div>
  <div class="guide-block">
    <h2>📐 How to register measurements</h2>
    <p>Tap <b>+ Log this week</b>. Use a sewing tape, in the morning, before eating, relaxed, same day each week. Leave blank what you didn't measure.</p>
    <ul>
      <li><b>Waist</b> — around the navel. The #1 fat-loss signal.</li>
      <li><b>Chest</b> — across the nipples, arms down.</li>
      <li><b>Arm</b> — flexed bicep, thickest point.</li>
      <li><b>Hips</b> — widest part of the glutes.</li>
      <li><b>Thigh</b> — highest point, under the glute.</li>
      <li><b>Weight</b> — same scale, morning, after bathroom.</li>
    </ul>
  </div>
  <div class="guide-block">
    <h2>🔄 Replace an exercise</h2>
    <p>Machine taken? Tap <b>🔄 Replace</b> on any exercise to see alternatives that train the <b>same muscle group</b>, with image, name, muscle and equipment. Pick one and it swaps <b>only that exercise</b>, for that day's slot — the rest of the workout stays untouched. Tap <b>↺ Original</b> anytime to go back. History for each exercise is tracked separately, so switching doesn't erase progress on either one.</p>
  </div>
  <div class="guide-block">
    <h2>➕➖ Adjusting the number of sets</h2>
    <p>Couldn't finish all sets today? Tap <b>− Remove a set</b> to drop the last planned one — it won't nag you for a set you're not doing. Feeling strong? Tap <b>+ Add a set</b> anytime, even after finishing. The app always saves <b>exactly what you did</b>, never more, never less.</p>
  </div>
  <div class="guide-block">
    <h2>🎉 Finishing the day</h2>
    <p>Complete every exercise's sets and a small celebration pops up — <i>"Great job! Workout completed. See you tomorrow."</i> It closes on its own or with the button.</p>
  </div>
  <div class="guide-block">
    <h2>🧠 How "smart" is the routine, honestly?</h2>
    <p>The <b>weekly split</b> (which muscles on which day) is fixed and doesn't rewrite itself — you stay in control. What <b>does</b> adapt automatically: the <b>weight/rep suggestion</b> for every exercise, based on your last session (progressive overload). After <b>8+ sessions</b> on the same exercise without a swap, you'll see a subtle "try a variation?" nudge. Manual tools (Replace, +/− sets) give you flexibility meanwhile.</p>
  </div>
  <div class="guide-block">
    <h2>📉 How to read the charts</h2>
    <p>The chart plots <b>weight (gold)</b> and <b>waist (purple)</b> over the weeks. Both trending <b>down</b> = losing fat. The measurement cards show <b>latest vs start</b>, green when waist/weight drop.</p>
  </div>
  <div class="guide-block">
    <h2>❓ FAQ</h2>
    <p><b>Will lifting make me bulky instead of losing fat?</b> No. Fat loss comes from a calorie deficit (food); lifting keeps the muscle that gives you shape. Without lifting you'd just get "skinny-fat".</p>
    <p><b>When will I see changes?</b> 3–4 weeks to notice yourself, 6–8 weeks for others. One week shows nothing.</p>
    <p><b>The scale went up this week.</b> Water and food move it daily. Judge by the 2-week trend.</p>
    <p><b>Do I need my weight to start?</b> No. Log what you can; add weight when you have a scale.</p>
    <p><b>Does it cost anything?</b> No. Everything is free and stored in your own database.</p>
  </div>`;
function openGymManual() { docModal('📖 Gym Guide', GYM_MANUAL_HTML); }

document.getElementById('gymGuideBtn')?.addEventListener('click', openGymManual);
document.getElementById('gymGoal')?.addEventListener('click', async (e) => {
  if (e.target.id === 'gymWhyLink') { openGymManual(); return; }
  if (e.target.id === 'gymBaselineEdit') {
    const g = getGym();
    const b = g.baseline || {};
    const r = await modal({ icon: '📍', title: 'Starting measurements',
      text: 'This is your fixed reference point — every "vs start" comparison uses this. Only edit it to correct a mistake.',
      fields: MEASURES.map(m => ({ type: 'number', min: 0, label: `${m.label} (${m.unit})`, value: b[m.key] ?? '' })),
      okText: 'Save' });
    if (!r) return;
    const nb = { date: b.date || g.start || hoyLocal() };
    MEASURES.forEach((m, i) => { const raw = String(r[i] ?? '').trim(); if (raw !== '') nb[m.key] = +raw.replace(/[^0-9.]/g, '') || 0; });
    g.baseline = nb;
    await saveGym(g);
    toast('📍 Starting point updated');
    load();
  }
});

document.getElementById('gymHistory')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-gym-del]');
  if (!b) return;
  if (!await confirmModal('Delete entry', `Delete the measurements from <b>${b.dataset.gymDel}</b>?`)) return;
  const g = getGym();
  g.entries = (g.entries || []).filter(x => x.date !== b.dataset.gymDel);
  await saveGym(g);
  toast('Entry deleted');
  load();
});

// Convierte las tablas más densas en tarjetas legibles solo en móvil.
// Los datos, controles y eventos siguen siendo exactamente los mismos.
function enhanceResponsiveTables() {
  const selectors = ['#pagosTable', '#goalTable', '#animeTable', '#bookTable', '.fund-tbl', '#gymHistory .table'];
  document.querySelectorAll(selectors.join(',')).forEach(table => {
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!headers.length) return;
    table.classList.add('mobile-cards');
    table.querySelectorAll('tbody tr').forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName === 'TD') cell.dataset.label = headers[index] || '';
      });
    });
  });
}

let _loadPromise = null;
let _loadQueued = false;
let _loadQueuedAnimate = false;

async function load(animate) {
  // Varias acciones pueden pedir una recarga casi al mismo tiempo. Se ejecuta una sola
  // y, si hubo cambios mientras cargaba, se hace exactamente una recarga adicional.
  if (_loadPromise) {
    _loadQueued = true;
    _loadQueuedAnimate = _loadQueuedAnimate || !!animate;
    return _loadPromise;
  }

  _loadPromise = (async () => {
    const ym = hoyLocal().slice(0, 7);
    const nextState = await api('/api/state?month=' + ym);
    S = nextState;
    checkVersion();
    try { await syncCarreraIngles(); } catch (err) { console.error('[LifeOS] syncCarreraIngles failed', err); }
    const safeRender = (name, fn) => {
      try { fn(); }
      catch (err) { console.error(`[LifeOS] ${name} failed`, err); toast(`⚠ ${esc(name)} could not be drawn. The rest of the app is still available.`, 'warn'); }
    };
    safeRender('Freedom', renderFreedom);
    safeRender('Home', renderInicio);
    safeRender('Shopping', renderShopping);
    safeRender('To-do', renderTodos);
    safeRender('Debt Boss', () => renderBoss(animate));
    safeRender('Habits', renderHabitos);
    safeRender('Wishlist', renderSuenos);
    safeRender('Anime', renderAnime);
    safeRender('Books', renderLibros);
    safeRender('Goals', renderGoals);
    safeRender('Life', renderLife);
    safeRender('Gym', renderGym);
    safeRender('Haki', renderHaki);
    safeRender('Achievements', renderAchievements);
    safeRender('Responsive tables', enhanceResponsiveTables);
    document.querySelectorAll('.money-live').forEach(engancharMiles);
    setTimeout(avisosInteligentes, 1200);
    setTimeout(preguntaPagoDelDia, 2000);
  })();

  try {
    await _loadPromise;
  } finally {
    _loadPromise = null;
    if (_loadQueued) {
      const queuedAnimate = _loadQueuedAnimate;
      _loadQueued = false;
      _loadQueuedAnimate = false;
      return load(queuedAnimate);
    }
  }
}


let _avisosMostrados = false;
// Extrae el día del mes de un texto de payday ("22 de cada mes" -> 22)
function diaDePayday(txt) {
  if (!txt) return null;
  const m = String(txt).match(/(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}
// Días que faltan desde hoy hasta el próximo día N del mes
function diasHastaDia(diaObjetivo) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diaSeguro = Math.max(1, Math.min(31, Number(diaObjetivo) || 1));

  // Intentar primero en el mes actual. Si el mes no tiene ese día (ej. 31 en
  // febrero), se usa su último día real.
  const finActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  let objetivo = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(diaSeguro, finActual));

  // Si ya pasó, calcularlo con la duración REAL del mes siguiente.
  if (objetivo < hoy) {
    const finSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0).getDate();
    objetivo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, Math.min(diaSeguro, finSiguiente));
  }
  return Math.round((objetivo - hoy) / 86400000);
}
// Aviso de pagos próximos al abrir la app
function avisarPagosProximos() {
  const VENTANA = 5;   // avisar de pagos en los próximos 5 días
  const proximos = [];
  // servicios con día de pago
  for (const s of (S.servicios || [])) {
    const dia = diaDePayday(s.payday);
    if (dia == null) continue;
    const faltan = diasHastaDia(dia);
    if (faltan <= VENTANA) proximos.push({ name: s.name, faltan, monto: s.amount });
  }
  // deudas registradas con fecha prometida (due_date) cercana
  for (const d of (S.extra_debts || [])) {
    if (d.cuotas >= 1 || !d.due_date) continue;
    const due = new Date(d.due_date + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const faltan = Math.round((due - hoy) / 86400000);
    if (faltan >= 0 && faltan <= VENTANA) {
      const rest = d.total - (d.abonado || 0);
      if (rest > 0) proximos.push({ name: d.name + ' (promised)', faltan, monto: rest });
    }
  }
  if (!proximos.length) return;
  proximos.sort((a, b) => a.faltan - b.faltan);
  const cuando = (f) => f === 0 ? 'today' : f === 1 ? 'tomorrow' : `in ${f} days`;
  const lista = proximos.slice(0, 5).map(p =>
    `<div class="pay-soon-row"><span>${esc(p.name)}</span><span>${fmt(p.monto)} · <b>${cuando(p.faltan)}</b></span></div>`).join('');
  const extra = proximos.length > 5 ? `<p class="hint" style="margin-top:6px">+${proximos.length - 5} more</p>` : '';
  setTimeout(() => {
    modal({ icon: '🔔', title: `${proximos.length} payment${proximos.length > 1 ? 's' : ''} coming up`,
      text: `Heads up, Kevin — these are due soon:<div class="pay-soon">${lista}${extra}</div>`,
      okText: 'Got it 👑' });
  }, 500);
}

function avisosInteligentes() {
  if (_avisosMostrados) return;      // solo una vez por carga de página
  _avisosMostrados = true;
  const hoy = new Date();
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

  // 0. AVISO DE PAGOS PRÓXIMOS (servicios + deudas prometidas en los próximos 5 días)
  avisarPagosProximos();

  // 1. Fin de mes: recordar cerrar el mes, pero no insistir si ya fue cerrado.
  if (hoy.getDate() >= diasEnMes - 1) {
    const currentLabel = hoy.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const yaCerrado = (S.history || []).some(h =>
      String(h.label || '').trim().toLowerCase() === currentLabel.toLowerCase());
    if (!yaCerrado) toast('📅 Month is ending — close it in Habits to lock your Haki.');
  }
  // 2. Sueños ya comprables (ahorro >= valor y no marcados como comprados)
  const comprable = (S.dreams || []).find(d => d.value > 0 && d.saved >= d.value && !d.bought);
  if (comprable) {
    setTimeout(() => toast(`✨ You can buy <b>${comprable.name}</b> in cash now!`), 700);
  }
  // 3. Meta estancada: en proceso pero 0% (sin avance)
  const estancada = (S.goals || []).find(g => g.status === 'En proceso 🔥' && (g.pct || 0) === 0);
  if (estancada) {
    setTimeout(() => toast(`🎯 "${estancada.name}" is in progress but at 0% — what's the next small step?`), 1400);
  }
}

/* ---------- INICIO ---------- */
const shopForm = document.getElementById('shopNew');
if (shopForm) shopForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('shName').value.trim();
  const slots = +document.getElementById('shSlots').value || 1;
  if (!name) return;
  await api('/api/shopping/new', { body: { name, slots } });
  e.target.reset(); document.getElementById('shSlots').value = 1;
  toast('🛒 Added to your list'); load();
});
// 🛒 Abrir Shopping como modal desde el header de Home (ahorra espacio en la página)
function openShoppingModal() {
  const panel = document.getElementById('shoppingPanel');
  if (!panel) return;
  if (!document.getElementById('shopBackdrop')) {
    const bd = document.createElement('div');
    bd.id = 'shopBackdrop';
    bd.onclick = closeShoppingModal;
    document.body.appendChild(bd);
  }
  panel.classList.add('as-modal');
  panel.style.display = 'block';
  if (!panel.querySelector('.shop-modal-close')) {
    const x = document.createElement('button');
    x.className = 'shop-modal-close'; x.innerHTML = '✕'; x.title = 'Close';
    x.onclick = closeShoppingModal;
    panel.prepend(x);
  }
}
function closeShoppingModal() {
  const panel = document.getElementById('shoppingPanel');
  const bd = document.getElementById('shopBackdrop');
  if (panel) { panel.classList.remove('as-modal'); panel.style.display = 'none'; }
  if (bd) bd.remove();
}
document.getElementById('openShoppingBtn')?.addEventListener('click', openShoppingModal);

/* ====== TO-DO LIST (bloc de notas de actividades) ====== */
function openTodoModal() {
  const panel = document.getElementById('todoPanel');
  if (!panel) return;
  if (!document.getElementById('todoBackdrop')) {
    const bd = document.createElement('div');
    bd.id = 'todoBackdrop';
    bd.className = 'shop-backdrop-like';
    bd.onclick = closeTodoModal;
    document.body.appendChild(bd);
  }
  panel.classList.add('as-modal');
  panel.style.display = 'block';
  if (!panel.querySelector('.shop-modal-close')) {
    const x = document.createElement('button');
    x.className = 'shop-modal-close'; x.innerHTML = '✕'; x.title = 'Close';
    x.onclick = closeTodoModal;
    panel.prepend(x);
  }
}
function closeTodoModal() {
  const panel = document.getElementById('todoPanel');
  const bd = document.getElementById('todoBackdrop');
  if (panel) { panel.classList.remove('as-modal'); panel.style.display = 'none'; }
  if (bd) bd.remove();
}
document.getElementById('openTodoBtn')?.addEventListener('click', openTodoModal);

function renderTodos() {
  const cont = document.getElementById('todoList');
  const todos = S.todos || [];
  const pendientes = todos.filter(t => !t.done);
  // botón del header: se ilumina con el nº de pendientes (igual que Shopping)
  const btn = document.getElementById('openTodoBtn');
  if (btn) btn.innerHTML = '📝 To-do' + (pendientes.length ? ` <span class="shop-count">${pendientes.length}</span>` : '');
  if (!cont) return;
  if (!todos.length) {
    cont.innerHTML = '<p class="hint">Nothing pending. Write down anything you don\'t want to forget. 📝</p>';
    return;
  }
  cont.innerHTML = todos.map(t => `
    <div class="shop-item ${t.done ? 'shop-done' : ''}">
      <button class="todo-check" data-id="${t.id}" title="${t.done ? 'Mark as pending' : 'Mark as done'}">${t.done ? '✅' : '⬜'}</button>
      <span class="shop-name">${esc(t.texto)}</span>
      <button class="del-x" data-todo="${t.id}" title="Delete">✕</button>
    </div>`).join('');
}

document.getElementById('todoNew')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  await withBusy(submit || form, async () => {
    const inp = document.getElementById('tdText');
    const texto = (inp.value || '').trim();
    if (!texto) return;
    await api('/api/todo/new', { body: { texto } });
    inp.value = '';
    toast('📝 Added to your to-do list');
    await load();
  });
});

document.getElementById('todoClearBtn')?.addEventListener('click', async (e) => {
  const hechos = (S.todos || []).filter(t => t.done);
  if (!hechos.length) return;
  await withBusy(e.currentTarget, async () => {
    await api('/api/todo/clear_done', { body: {} });
    toast('🧹 Done items cleared');
    await load();
  });
});

document.addEventListener('click', async (e) => {
  const tchk = e.target.closest('.todo-check');
  if (tchk) {
    await api('/api/todo/toggle', { body: { id: +tchk.dataset.id } });
    load();
    return;
  }
  const tdel = e.target.closest('[data-todo]');
  if (tdel && tdel.classList.contains('del-x')) {
    await api('/api/todo/' + tdel.dataset.todo, { method: 'DELETE' });
    toast('✕ Removed');
    load();
    return;
  }
});

document.addEventListener('click', async (e) => {
  const chk = e.target.closest('.shop-check');
  if (chk) {
    const id = +chk.dataset.id;
    const it = (S.shopping || []).find(s => s.id === id);
    const slots = it ? (it.slots || 1) : 1;
    const done = it ? (it.done || 0) : 0;
    const completaAhora = it && (done + 1) === slots;   // este toque lo deja completo
    if (!completaAhora) {
      await api('/api/shopping/tick', { body: { id } });   // subtarea intermedia: solo suma una raya
      load();
      return;
    }
    // Se compró: pedir monto + método (idéntico a Life & Services), y registrar la compra.
    const r = await modal({ icon: '🛒', title: 'You bought it!',
      text: `<b>${esc(it.name)}</b> — how much did it cost and how did you pay? This moves it to your purchase history. (Leave amount blank to just mark it bought.)`,
      fields: [
        { type: 'money', label: 'Amount', placeholder: 'e.g. 25.000' },
        { type: 'select', label: 'Paid with', options: PAY_METHODS.map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) }
      ], okText: 'Mark as bought' });
    if (r === null) return;   // canceló: no lo marca (sigue en la lista)
    const amount = +String(r[0] || '').replace(/[^0-9]/g, '') || 0;
    const method = r[1] || 'Efectivo';
    const m = payMethod(method);
    // 1) marcar como comprado -> sale de la lista, entra al historial
    await api('/api/shopping/bought', { body: { id, cost: amount, method } });
    // 2) si pagó con tarjeta de crédito: MISMO flujo financiero que Services/Used a Card
    if (amount > 0 && m.card) {
      const rc = await modal({ icon: m.logo, title: 'Paid with ' + m.id,
        text: `<b>${esc(it.name)}</b> will be charged to <b>${m.id}</b>. How many installments, and which month does the FIRST one start? (Card purchases usually bill next month.)`,
        fields: [
          { type: 'number', placeholder: '# installments (1 = single)', min: 1, value: '1' },
          { type: 'select', label: 'First installment', options: mesInicioOpts() }
        ],
        okText: 'Add to card' });
      const cuotas = rc ? Math.max(1, +rc[0] || 1) : 1;
      const startM = rc && rc[1] != null && rc[1] !== '' ? +rc[1] : MES;
      await api('/api/compra', { body: { creditor: method, concepto: it.name, valor: amount, cuotas, start: startM } });
      await api('/api/expense/new', { body: { name: it.name, amount, method, kind: 'once', month: S.plan.months[MES] } });
      toast(`💳 ${esc(it.name)} → ${m.id} (${cuotas} ${cuotas === 1 ? 'installment' : 'installments'} from ${S.plan.months[startM]})`);
    } else if (amount > 0) {
      // efectivo/débito: solo gasto del mes, sin cuotas (igual que hoy)
      await api('/api/expense/new', { body: { name: it.name, amount, method, kind: 'once', month: S.plan.months[MES] } });
      toast(`🧾 ${fmt(amount)} logged in expenses`);
    } else {
      toast('✓ Marked as bought — moved to history.');
    }
    load();
    return;
  }
  if (e.target.id === 'clearDoneBtn') {
    await api('/api/shopping/clear_done', {});
    toast('🧹 Cleared checked items'); load();
    return;
  }
  const unbuy = e.target.closest('.shop-unbuy');
  if (unbuy) {
    await api('/api/shopping/unbuy', { body: { id: +unbuy.dataset.id } });
    toast('↩ Back on your list'); load();
    return;
  }
});

function renderShopping() {
  const cont = document.getElementById('shoppingList');
  if (!cont) return;
  const all = S.shopping || [];
  const activos = all.filter(it => !it.bought_at);          // pendientes: NO comprados
  const comprados = all.filter(it => it.bought_at)          // historial: comprados
    .sort((a, b) => (b.bought_at || '').localeCompare(a.bought_at || ''));
  // contador en el botón del header (ítems pendientes, sin abrir el modal)
  const btn = document.getElementById('openShoppingBtn');
  if (btn) btn.innerHTML = '🛒 Shopping' + (activos.length ? ` <span class="shop-count">${activos.length}</span>` : '');

  if (!activos.length) {
    cont.innerHTML = '<p class="hint">Nothing on the list. Add what you need above. 🛒</p>';
  } else {
    cont.innerHTML = activos.map(it => {
      const slots = it.slots || 1;
      const done = it.done || 0;
      const complete = slots > 0 && done >= slots;
      let rayas = '';
      if (slots > 1) {
        rayas = '<span class="shop-slots">' +
          Array.from({ length: slots }, (_, k) =>
            `<i class="slot ${k < done ? 'on' : ''}"></i>`).join('') + '</span>';
      }
      return `<div class="shop-item ${complete ? 'done' : ''}" data-id="${it.id}">
        <button class="shop-check ${complete ? 'on' : ''}" data-id="${it.id}" title="${slots > 1 ? 'Tap once per task (' + done + '/' + slots + ')' : 'Mark as bought'}">
          ${complete ? '✓' : (slots > 1 ? done : '')}
        </button>
        <span class="shop-name">${esc(it.name)}</span>
        ${rayas}
        <button class="del-x" data-type="shopping" data-id="${it.id}">✕</button>
      </div>`;
    }).join('');
  }

  // Historial de compras (solo lectura + opción de devolver a la lista o borrar)
  const hist = document.getElementById('shoppingHistory');
  if (hist) {
    if (!comprados.length) {
      hist.innerHTML = '';
    } else {
      hist.innerHTML = `<details class="shop-hist"><summary>🧾 Purchase history (${comprados.length})</summary>` +
        comprados.map(it => {
          const mLogo = (payMethod(it.method) || {}).logo || '';
          return `<div class="shop-hist-row">
            <span class="shop-hist-name">✓ ${esc(it.name)}</span>
            <span class="shop-hist-meta">${it.cost ? fmt(it.cost) : ''} ${mLogo} · ${it.bought_at || ''}</span>
            <button class="shop-unbuy" data-id="${it.id}" title="Return to list">↩</button>
            <button class="del-x" data-type="shopping" data-id="${it.id}" title="Remove from history">✕</button>
          </div>`;
        }).join('') + '</details>';
    }
  }
}

function renderFreedom() {
  const panel = document.getElementById('freedomPanel');
  if (!panel) return;
  const init = (S.debts || []).reduce((s, d) => s + d.initial + compradoEn(d.name), 0)
    + (S.extra_debts || []).reduce((s, d) => s + d.total, 0);
  const dmgPlan = (S.debts || []).reduce((s, d) => s + (d.abonado || 0), 0);
  const dmgExtras = (S.extra_debts || []).reduce((s, d) => s + Math.min(d.abonado || 0, d.total || 0), 0);
  const dmg = dmgPlan + dmgExtras;
  const pct = init ? Math.min((dmg / init) * 100, 100) : 0;
  const rest = Math.max(init - dmg, 0);

  // ritmo: total abonado / meses con actividad -> estimar meses restantes
  const abonos = S.abonos || [];
  let fechaLibre = '';
  if (abonos.length && rest > 0) {
    const meses = new Set(abonos.map(a => (a.fecha || '').slice(0, 7)));
    const ritmoMensual = dmg / Math.max(meses.size, 1);
    if (ritmoMensual > 0) {
      const mesesRestantes = Math.ceil(rest / ritmoMensual);
      const f = new Date();
      f.setMonth(f.getMonth() + mesesRestantes);
      fechaLibre = f.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  }

  const enemigosVivos = (S.debts || []).filter(d =>
    (d.initial + compradoEn(d.name) - (d.abonado || 0)) > 0).length
    + (S.extra_debts || []).filter(d =>
      ((d.total || 0) - (d.abonado || 0)) > 0).length;
  panel.innerHTML = `
    <div class="freedom-top">
      <div>
        <div class="freedom-label">🔓 Your road to freedom</div>
        <div class="freedom-sub">${enemigosVivos} ${enemigosVivos === 1 ? 'enemy' : 'enemies'} left · ${fmt(rest)} to go</div>
      </div>
      <div class="freedom-pct">${pct.toFixed(1)}%</div>
    </div>
    <div class="freedom-bar"><i style="width:0%" data-w="${pct}"></i></div>
    <div class="freedom-foot">
      <span>Paid: <b>${fmt(dmg)}</b> of ${fmt(init)}</span>
      ${fechaLibre ? `<span>At this pace: free by <b>${fechaLibre}</b> 🏁</span>` : '<span>Log payments to estimate your freedom date</span>'}
    </div>`;
  // animación: la barra crece desde 0
  requestAnimationFrame(() => {
    const bar = panel.querySelector('.freedom-bar i');
    if (bar) setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, 100);
  });
  syncDebtGoal(Math.round(pct));   // 🔓 Your road to freedom -> Goals: "Get out of debt" sube sola
}
// Enlaza el % de "Your road to freedom" con la meta de deudas en Goals (por palabras clave),
// igual que Career -> Goal: tu esfuerzo pagando deudas mueve la meta sola, sin tocar nada a mano.
let _debtGoalSync = Promise.resolve();
function syncDebtGoal(pct) {
  const re = /deuda|debt/i;
  const cand = (S.goals || []).filter(g => re.test(g.name || ''));
  if (cand.length !== 1) return;
  const g = cand[0];

  const updates = [];
  if ((g.pct || 0) !== pct) updates.push({ field: 'pct', value: pct });
  if (pct >= 100 && g.status !== 'Lograda 🏆') {
    updates.push({ field: 'status', value: 'Lograda 🏆' });
  } else if (pct > 0 && g.status === 'Pendiente') {
    updates.push({ field: 'status', value: 'En proceso 🔥' });
  }
  if (!updates.length) return;

  // Serializa esta sincronización automática: nunca deja peticiones sueltas ni silenciosas.
  _debtGoalSync = _debtGoalSync.then(async () => {
    for (const u of updates) {
      await api('/api/goal', {
        body: { id: g.id, field: u.field, value: u.value },
        quiet: true
      });
      g[u.field] = u.value;
    }
  }).catch((err) => {
    console.error('Debt goal sync failed', err);
    toast('⚠ Your debt progress was calculated, but the linked goal could not be updated. Try again.', 'err');
  });
}


function renderInicio() {
  const sel = $('#monthSel');
  if (!sel.options.length) {
    S.plan.months.forEach((m, i) => sel.add(new Option(m, i)));
    sel.value = String(Math.min(11, Math.max(0, planIndex(new Date()))));   // arranca en el mes real
    sel.onchange = renderInicio;
  }
  const i = +sel.value || 0;
  MES = i;
  const p = S.plan;
  const ingreso = ingresoDelMes(i);
  const deudas = Object.entries(p.creditors)
    .map(([n, arr]) => [n, cuotaPlanMes(n, i) + extraCuota(n, i), extraCuota(n, i)])
    .filter(d => d[1] > 0);
  (S.extra_debts || []).filter(d => d.cuotas >= 1 && i >= d.start && i < d.start + d.cuotas)
    .forEach(d => deudas.push([d.name + ' (registrada)', d.cuota, 0, 'extra:' + d.id]));
  // deudas libres con fecha de pago prometida que caen en el mes seleccionado
  const mesSel = p.months[i];
  (S.extra_debts || []).filter(d => !(d.cuotas >= 1) && d.due_date)
    .forEach(d => {
      // due_date guardado como 'YYYY-MM-DD' o como índice de mes; comparar por mes
      const mesDue = mesDeFecha(d.due_date);
      if (mesDue === i) {
        const restante = Math.max(d.total - (d.abonado || 0), 0);
        if (restante > 0) deudas.push([d.name + ' (promised)', restante, 0, 'extra:' + d.id]);
      }
    });
  const totalDeudas = deudas.reduce((s, d) => s + d[1], 0);
  // NEEDS = suma de "Life & services" (todo lo que agregues va aquí),
  //         EXCEPTO el aporte al fondo de empresa (método 'Fondo'), que cuenta como Savings.
  const needs = (S.servicios || [])
    .filter(s => s.method !== 'Fondo')
    .reduce((acc, x) => acc + (x.amount || 0), 0);
  // SAVINGS = aporte mensual del fondo de empresa (la suma de las "Quota" del fondo).
  //           Es editable: si algún mes lo subes a 220.000, la torta lo refleja solo.
  const ahorroFondo = (S.fund || []).reduce((acc, f) => acc + (f.quota || 0), 0);
  // gastos del mes actual que NO son a crédito (los de crédito ya cuentan como cuota)
  const mesKey = p.months[i];
  const gastosMes = (S.expenses || []).filter(x =>
    (x.kind === 'monthly' || x.month === mesKey) && !payMethod(x.method).card && x.method !== 'Ahorro')
    .reduce((s, x) => s + x.amount, 0);
  const egresos = needs + ahorroFondo + totalDeudas + gastosMes;
  const saldo = ingreso - egresos;

  $('#kpis').innerHTML = `
    <div class="card"><label>Monthly income</label><strong>${fmt(ingreso)}</strong></div>
    <div class="card red"><label>Debt this month</label><strong>${fmt(totalDeudas)}</strong></div>
    <div class="card"><label>Life + savings</label><strong>${fmt(needs + ahorroFondo)}</strong></div>
    <div class="card ${saldo >= 0 ? 'green' : 'red'}"><label>Expected balance</label><strong>${fmt(saldo)}</strong></div>` +
    (() => {
      const crecioCompras = deudas.reduce((s, d) => s + d[2], 0);
      const cuotasReg = extraDebtCuota(i);
      const sinCuotas = (S.extra_debts || []).filter(d => !(d.cuotas >= 1)).reduce((s, d) => s + d.total, 0);
      const crecio = crecioCompras + cuotasReg;
      let html = '';
      if (crecio > 0)
        html += `<div class="card red"><label>📈 Debt grew</label><strong>+${fmt(crecio)}</strong></div>`;
      if (sinCuotas > 0)
        html += `<div class="card red"><label>☠ Debts w/o installments</label><strong>${fmt(sinCuotas)}</strong></div>`;
      return html;
    })();

  $('#pagosTable').innerHTML =
    deudas.map(d => `<tr><td>${d[0]}${d[2] > 0 ? ` <small class="grew" title="incluye compra a cuotas">📈 +${fmt(d[2])}</small>` : ''}</td><td class="num">${fmt(d[1])}</td></tr>`).join('') +
    `<tr><th>Total debt</th><th class="num">${fmt(totalDeudas)}</th></tr>`;

  const dPct = totalDeudas / ingreso;
  $('#diagnostico').textContent =
    dPct > 0.5 ? '⚔ WAR MODE: debt eats more than half your income. Hold on, it drops every month.' :
    dPct > 0.3 ? '🛡 HOLDING: debt still weighs more than ideal. You\'re on the right track.' :
    '👑 50/30/20 ZONE: debt now fits the rule. Time to spend on wants and dreams.';

  const vals = [needs, ahorroFondo, totalDeudas];
  const sumaTotal = vals.reduce((a, b) => a + b, 0) || 1;
  const pctDe = (v) => Math.round((v / sumaTotal) * 100);
  const data = {
    labels: ['Needs', 'Savings', 'Debt'],
    datasets: [{
      data: vals,
      backgroundColor: ['#7c6ce0', '#f5b942', '#e0445c'],
      borderColor: '#1d1932', borderWidth: 3
    }]
  };
  const opts = {
    plugins: {
      legend: { labels: { color: '#ece9f7', font: { size: 12 } } },
      tooltip: { callbacks: { label: (ctx) => {
        const v = ctx.parsed; const pct = Math.round((v / sumaTotal) * 100);
        return `${ctx.label}: ${fmt(v)} (${pct}%)`;
      } } }
    }, cutout: '58%', responsive: true, maintainAspectRatio: true, aspectRatio: 1.4
  };
  if (pieChart) { pieChart.data = data; pieChart.options = opts; pieChart.update(); }
  else pieChart = new Chart($('#pieChart'), { type: 'doughnut', data, options: opts, plugins: [sliceLabels] });

  // panel asesor 50/30/20 (Needs/Savings/Debt sobre el ingreso) debajo de la torta
  renderAdvisor(ingreso, needs, ahorroFondo, totalDeudas);

  renderChecklist(i, deudas);
  renderExpenses(i);
  renderDesglose();   // el desglose sigue el filtro del mes (las cuotas avanzan al cambiar el mes)
  renderMyCards();    // las tarjetas también siguen el filtro del mes
}

/* ====== COMPANY FUND ====== */
function fmtFecha(iso) {
  if (!iso) return '—';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
}
function proximoAporteTxt() {
  const hoy = new Date();
  let y = hoy.getFullYear(), m = hoy.getMonth();
  // próximo día 30 (o último día si el mes no tiene 30)
  let dia = 30;
  const finMes = new Date(y, m + 1, 0).getDate();
  const diaEste = Math.min(30, finMes);
  let prox;
  if (hoy.getDate() < diaEste) prox = new Date(y, m, diaEste);
  else { const fin2 = new Date(y, m + 2, 0).getDate(); prox = new Date(y, m + 1, Math.min(30, fin2)); }
  const dias = Math.ceil((prox - hoy) / 86400000);
  return `next deposit in ${dias} ${dias === 1 ? 'day' : 'days'}`;
}
function renderFund() {
  const cont = document.getElementById('fundTable');
  if (!cont) return;
  const fund = S.fund || [];
  const totalQuota = fund.reduce((s, f) => s + (f.quota || 0), 0);
  const totalSaved = fund.reduce((s, f) => s + (f.saved || 0), 0);
  const rows = fund.map(f => `<tr>
    <td><input class="fund-edit wide" data-id="${f.id}" data-f="name" value="${esc(f.name)}"></td>
    <td><input class="fund-edit money-live" inputmode="numeric" data-id="${f.id}" data-f="quota" value="${Number(f.quota || 0).toLocaleString('es-CO')}" style="width:90px"></td>
    <td><input class="fund-edit" data-id="${f.id}" data-f="frequency" value="${esc(f.frequency || '')}" style="width:90px"></td>
    <td><input class="fund-edit" type="date" data-id="${f.id}" data-f="last_deposit" value="${f.last_deposit || ''}" style="width:140px"></td>
    <td><input class="fund-edit money-live" inputmode="numeric" data-id="${f.id}" data-f="saved" value="${Number(f.saved || 0).toLocaleString('es-CO')}" style="width:110px"></td>
    <td><button class="del-x" data-type="fund" data-id="${f.id}">✕</button></td>
  </tr>`).join('');
  cont.innerHTML = `
    <div class="fund-hero">
      <div><span class="fund-hlabel">Total saved in your fund</span>
        <span class="fund-hval">${fmt(totalSaved)}</span></div>
      <div class="fund-hsub">Growing ${fmt(totalQuota)} every month 🐷 · ${proximoAporteTxt()}</div>
    </div>
    <table class="table fund-tbl">
      <tr><th>Concept</th><th>Quota</th><th>Frequency</th><th>Last deposit</th><th>Saved</th><th></th></tr>
      ${rows}
      <tr class="fund-total"><td>TOTAL</td><td>${fmt(totalQuota)}</td><td></td><td></td><td>${fmt(totalSaved)}</td><td></td></tr>
    </table>`;
}
document.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('fund-edit')) return;
  await api('/api/fund', { body: { id: +e.target.dataset.id, field: e.target.dataset.f, value: e.target.value } });
  load();
});
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'addFundBtn') return;
  const r = await modal({ icon: '🏦', title: 'Add fund concept',
    text: 'Add a savings line to your company fund.',
    fields: [
      { type: 'text', placeholder: 'Concept (e.g. Permanent savings)' },
      { type: 'money', placeholder: 'Monthly quota' },
      { type: 'money', placeholder: 'Already saved' }
    ], okText: 'Add' });
  if (!r || !r[0].trim()) return;
  await api('/api/fund/new', { body: { name: r[0], quota: +r[1] || 0, saved: +r[2] || 0, frequency: 'Monthly', last_deposit: hoyLocal() } });
  toast('🏦 Fund concept added'); load();
});

/* ====== PIGGY BANKS (alcancías personales) ====== */
function renderPiggy() {
  const cont = document.getElementById('piggyList');
  if (!cont) return;
  const piggies = S.piggy || [];
  const moves = S.piggy_moves || [];
  if (!piggies.length) {
    cont.innerHTML = '<p class="hint">No piggy banks yet. Create one to start saving toward something.</p>';
    return;
  }
  cont.innerHTML = piggies.map(p => {
    const mine = moves.filter(m => m.piggy_id === p.id);
    const total = mine.reduce((s, m) => s + m.amount, 0);
    const goal = p.goal || 0;
    const hasGoal = goal > 0;
    const pct = hasGoal ? Math.min((total / goal) * 100, 100) : 0;
    const falta = Math.max(goal - total, 0);
    const done = hasGoal && total >= goal;

    const hist = mine.length
      ? mine.map(m => `<div class="pig-move">
          <span>${fmtFecha(m.day)}${m.note ? ' · ' + esc(m.note) : ''}</span>
          <span class="${m.amount < 0 ? 'nw-debt' : 'pig-plus'}">${m.amount < 0 ? '' : '+'}${fmt(m.amount)}
          <button class="del-x" data-type="piggy_move" data-id="${m.id}">✕</button></span>
        </div>`).join('')
      : '<p class="hint" style="margin:6px 0">No moves yet.</p>';

    // bloque de meta o de jar libre
    let progreso;
    if (hasGoal) {
      progreso = done
        ? `<div class="pig-done">🎉 Goal reached! You saved the ${fmt(goal)} you wanted. Congrats, Kevin!</div>`
        : `<div class="pig-goal-row">
             <span>Saved <b>${fmt(total)}</b> of <b>${fmt(goal)}</b></span>
             <span class="pig-left">${fmt(falta)} to go</span>
           </div>
           <div class="pig-bar"><i style="width:${pct}%"></i></div>`;
    } else {
      progreso = `<div class="pig-free">Free jar — <b>${fmt(total)}</b> saved so far</div>`;
    }

    return `<div class="piggy-card ${done ? 'pig-complete' : ''}">
      <div class="piggy-head">
        <div><span class="piggy-name">${p.icon || '🐷'} ${esc(p.name)}</span>
          <span class="piggy-kind">${hasGoal ? 'Goal' : 'Free jar'} · started ${fmtFecha(p.started)}</span></div>
        <div class="piggy-total">${fmt(total)}</div>
      </div>
      ${progreso}
      <div class="piggy-actions">
        <button class="btn-gold pig-add" data-id="${p.id}" data-name="${esc(p.name)}">+ Add money</button>
        <button class="del-x" data-type="piggy" data-id="${p.id}" title="Delete piggy">✕</button>
      </div>
      <details class="piggy-hist"><summary>History (${mine.length})</summary>${hist}</details>
    </div>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  // crear alcancía
  if (e.target.id === 'addPiggyBtn') {
    const r = await modal({ icon: '🎯', title: 'New savings goal',
      text: 'First: how much do you want to save? (leave the goal at 0 for a free jar with no target). Then name it.',
      fields: [
        { type: 'money', placeholder: 'Goal amount (0 = free jar)' },
        { type: 'text', placeholder: 'Name (e.g. Trip to the coast, New phone)' },
        { type: 'text', placeholder: 'Emoji (optional)', value: '🐷' }
      ], okText: 'Create' });
    if (!r || !r[1].trim()) return;
    const goal = +r[0] || 0;
    await api('/api/piggy/new', { body: { name: r[1], icon: r[2] || '🐷', goal, kind: goal > 0 ? 'goal' : 'free', started: hoyLocal() } });
    toast(goal > 0 ? `🎯 Goal created: save ${fmt(goal)}` : '🐷 Free jar created'); load();
    return;
  }
  // agregar plata a una alcancía
  const addBtn = e.target.closest('.pig-add');
  if (addBtn) {
    const r = await modal({ icon: '💰', title: 'Add to ' + addBtn.dataset.name,
      text: 'How much are you putting in? (use a negative number if you took money out)',
      fields: [
        { type: 'money', placeholder: 'Amount' },
        { type: 'text', placeholder: 'Note (optional)' }
      ], okText: 'Add' });
    if (!r || !r[0]) return;
    const pid = +addBtn.dataset.id;
    const p = (S.piggy || []).find(x => x.id === pid) || {};
    const antesTotal = (S.piggy_moves || []).filter(m => m.piggy_id === pid).reduce((s, m) => s + m.amount, 0);
    await api('/api/piggy/add', { body: { piggy_id: pid, amount: +r[0] || 0, note: r[1], day: hoyLocal() } });
    await load();
    const despues = antesTotal + (+r[0] || 0);
    if ((p.goal || 0) > 0 && antesTotal < p.goal && despues >= p.goal) {
      celebrate({ icon: '🎉', title: 'GOAL REACHED', text: `You saved the <b>${fmt(p.goal)}</b> for <b>${esc(p.name)}</b>. You did it, Kevin!` });
    } else {
      toast(+r[0] >= 0 ? '🐷 Money added!' : '↩ Withdrawal logged');
    }
    return;
  }
});

/* ====== EXPENSE TRACKER (Inicio) ====== */
function renderExpenses(i) {
  // llenar el select de medios de pago con logos (una vez)
  const ms = $('#exMethod');
  if (ms && !ms.options.length) {
    ms.innerHTML = PAY_METHODS.map(m => `<option value="${m.id}">${m.logo} ${m.label}</option>`).join('');
  }
  const mesKey = S.plan.months[i];
  // gastos visibles: recurrentes (todos los meses) + los de ESTE mes
  const visibles = (S.expenses || []).filter(x => x.kind === 'monthly' || x.month === mesKey);
  const totalMes = visibles.reduce((s, x) => s + x.amount, 0);
  const credito = visibles.filter(x => payMethod(x.method).card).reduce((s, x) => s + x.amount, 0);

  const sum = $('#expenseSummary');
  if (sum) sum.innerHTML = visibles.length
    ? `<div class="exp-summary">Spent in ${mesKey}: <b>${fmt(totalMes)}</b>${credito ? ` · on credit (adds to cards): <b class="nw-debt">${fmt(credito)}</b>` : ''}</div>`
    : '';

  const list = $('#expenseList');
  if (list) list.innerHTML = visibles.filter(x => x.method !== 'Ahorro').map(x => {
    const m = payMethod(x.method);
    return `<div class="exp-row">
      <span class="exp-name">${esc(x.name)} ${x.kind === 'monthly' ? '<small class="exp-tag">monthly</small>' : ''}</span>
      <span class="exp-method" title="${m.label}">${m.logo} ${m.id}${m.card ? ' 💳' : ''}</span>
      <span class="exp-amt">${fmt(x.amount)}</span>
      <button class="del-x" data-type="expense" data-id="${x.id}">✕</button>
    </div>`;
  }).join('') || '<p class="hint">No expenses logged for this month yet.</p>';

  // Ahorros del mes (method == 'Ahorro')
  const ahorros = visibles.filter(x => x.method === 'Ahorro');
  const totalAhorro = ahorros.reduce((s, x) => s + x.amount, 0);
  renderFund();
  renderPiggy();
  const sl = $('#saveList');
  if (sl) sl.innerHTML = (ahorros.length
    ? `<div class="save-total">Saved this month: <b>${fmt(totalAhorro)}</b> 🐷</div>` +
      ahorros.map(x => `<div class="exp-row">
        <span class="exp-name">${esc(x.name)}</span>
        <span class="exp-amt">${fmt(x.amount)}</span>
        <button class="del-x" data-type="expense" data-id="${x.id}">✕</button></div>`).join('')
    : '<p class="hint">No savings logged this month. Even a little counts.</p>');
}

$('#expenseNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#exName').value.trim();
  const amount = numVal('#exAmount');
  const method = $('#exMethod').value;
  const kind = $('#exKind').value;
  if (!name || amount <= 0) return;
  const mesKey = S.plan.months[MES];
  const m = payMethod(method);

  // Si es tarjeta de crédito: preguntar a cuántas cuotas, y en qué mes empieza la primera
  if (m.card) {
    const r = await modal({ icon: m.logo, title: 'Paid with ' + m.id,
      text: `This is a credit-card payment. How many installments, and which month does the FIRST one start? (Card purchases usually bill next month.)`,
      fields: [
        { type: 'number', placeholder: '# installments (1 = single)', min: 1, value: '1' },
        { type: 'select', label: 'First installment', options: mesInicioOpts() }
      ],
      okText: 'Add to card' });
    if (!r) return;
    const cuotas = Math.max(1, +r[0] || 1);
    const startM = r[1] != null && r[1] !== '' ? +r[1] : MES;
    await api('/api/compra', { body: { creditor: method, concepto: name, valor: amount, cuotas, start: startM } });
    // y registrar el gasto también (para el historial del mes)
    await api('/api/expense/new', { body: { name, amount, method, kind, month: kind === 'monthly' ? '' : mesKey } });
    toast(`💳 ${fmt(amount)} added to ${m.id} (${cuotas} ${cuotas === 1 ? 'installment' : 'installments'} from ${S.plan.months[startM]})`);
  } else {
    await api('/api/expense/new', { body: { name, amount, method, kind, month: kind === 'monthly' ? '' : mesKey } });
    toast(`${m.logo} Expense logged: ${fmt(amount)}`);
  }
  e.target.reset();
  load();
});

const PAYDAY_OPTS = [
  { v: '5', t: 'Monthly — the 5th' },
  { v: '30', t: 'Monthly — the 30th' },
  { v: '15,30', t: 'Twice a month — 15th & 30th' },
  { v: 'custom', t: 'Another day of the month' }
];
const setPaydayBtn = document.getElementById('setPaydayBtn');
if (setPaydayBtn) setPaydayBtn.addEventListener('click', async () => {
  const actual = (S.profile || {}).payday || '5';
  const r = await modal({ icon: '📆', title: 'When do you get paid?',
    text: 'This sets when the app asks if your pay arrived. You can change it anytime (new job, biweekly, etc.).',
    fields: [{ type: 'select', value: PAYDAY_OPTS.some(o => o.v === actual) ? actual : 'custom', options: PAYDAY_OPTS },
             { type: 'number', placeholder: 'If "another day": which day? (1-31)', min: 1, max: 31, value: /^\d+$/.test(actual) ? actual : '' }],
    okText: 'Save payday' });
  if (!r) return;
  let pd = r[0];
  if (pd === 'custom') pd = String(+r[1] || 5);
  await api('/api/profile', { body: { key: 'payday', value: pd } });
  toast('📆 Payday saved'); load();
});

// Pregunta inteligente del día de pago: "¿ya te llegó?"
function preguntaPagoDelDia() {
  const prof = S.profile || {};
  const payday = prof.payday || '5';
  const dias = payday.split(',').map(x => x.trim());
  const hoy = new Date();
  const diaHoy = String(hoy.getDate());
  if (!dias.includes(diaHoy)) return;          // hoy no es día de pago
  const mk = S.plan.months[MES];
  const yaRegistro = (S.month_income || {})[mk] != null;
  if (yaRegistro) return;                        // ya lo registró manual este mes
  // ¿ya preguntamos y dijo "no, todavía"? esperar 8h
  const key = 'askpay_' + mk;
  const snooze = prof[key];
  if (snooze) {
    const last = new Date(snooze);
    if ((Date.now() - last.getTime()) < 8 * 3600 * 1000) return;   // aún dentro de las 8h
  }
  setTimeout(async () => {
    const r = await modal({ icon: '💰', title: 'Payday!',
      text: `Today is a payday (${mk}). Did your salary arrive yet?`,
      okText: 'Yes, register it', extraBtn: 'Not yet' });
    if (r === 'EXTRA' || r === null) {
      // "todavía no" -> guardar timestamp para repreguntar en 8h
      await api('/api/profile', { body: { key, value: new Date().toISOString() } });
      if (r === 'EXTRA') toast('👍 I\'ll ask again in about 8 hours.');
      return;
    }
    // dijo que sí -> abrir el registro de ingreso
    document.getElementById('setIncomeBtn').click();
  }, 1500);
}

$('#setIncomeBtn').addEventListener('click', async () => {
  const mesKey = S.plan.months[MES];
  const actual = ingresoDelMes(MES);
  const r = await modal({ icon: '💰', title: `Income for ${mesKey}`,
    text: 'How much did you actually receive this month? (your payday is the 5th)',
    fields: [{ type: 'money', placeholder: 'Net income', value: actual }],
    okText: 'Save income' });
  if (!r) return;
  await api('/api/income', { body: { month: mesKey, income: +r[0] || 0 } });
  toast('💰 Income updated for ' + mesKey);
  load();
});

/* ---------- CHECKLIST DE PAGOS ---------- */
// Convierte una fecha YYYY-MM-DD al índice del mes en el plan (o -1 si no encaja)
function mesDeFecha(fecha) {
  if (!fecha) return -1;
  const m = fecha.slice(0, 7);   // 'YYYY-MM'
  // los meses del plan son nombres en español; mapear por año-mes real
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const [y, mm] = m.split('-').map(Number);
  const nombre = meses[mm - 1];
  if (!nombre) return -1;
  // buscar en los nombres del plan (ej: "Julio 2026") ignorando mayúsculas
  return (S.plan.months || []).findIndex(pm => {
    const low = pm.toLowerCase();
    return low.includes(nombre) && low.includes(String(y));
  });
}

function renderChecklist(i, deudas) {
  const mk = monthKey(i);
  const checks = new Set(S.checks);
  // fila de servicio (editable): objeto {id,name,amount,method,payday}
  const svcRow = (s) => {
    const m = payMethod(s.method);
    // Servicio pagado con TARJETA DE CRÉDITO: ya está en la deuda de la tarjeta.
    // Se muestra como "💳 en tarjeta" — cuenta como cubierto, no se marca a mano y NO toca el income.
    if (m.card) {
      return `<div class="check-item on-card" data-item="${s.name}" data-mk="${mk}" data-oncard="1">
        <div class="box card-box-mini" title="Paid on card — already in your card debt">💳</div>
        <div class="cmid">
          <span class="cname">${esc(s.name)} <button class="svc-edit" data-id="${s.id}" title="Edit">✎</button></span>
          <small>${m.logo} ${esc(s.method)} · on card <span class="oncard-tag">won't touch your salary</span></small>
        </div>
        <span class="cval">${fmt(s.amount)}</span></div>`;
    }
    const paid = checks.has(`${s.name}|${mk}`);
    return `<div class="check-item ${paid ? 'paid' : ''}" data-item="${s.name}" data-mk="${mk}">
      <div class="box">${paid ? '✓' : ''}</div>
      <div class="cmid">
        <span class="cname">${esc(s.name)} <button class="svc-edit" data-id="${s.id}" title="Edit">✎</button></span>
        <small>${m.logo} ${esc(s.method || '—')} · ${esc(s.payday || '')}</small>
      </div>
      <span class="cval">${fmt(s.amount)}</span></div>`;
  };
  // fila de deuda: lleva debt_id y valor para abonar de verdad
  const debtRow = (d) => {
    const [item, val, , extraTag] = d;
    const debtName = CRED_TO_DEBT[item] || item;
    const debt = S.debts.find(x => x.name === debtName);
    const paid = checks.has(`${item}|${mk}`);
    // extraTag tipo 'extra:ID' -> deuda registrada prometida (abona a esa deuda)
    const extraAttr = extraTag ? ` data-extra="${extraTag.split(':')[1]}"` : '';
    const hits = (debt || extraTag) ? ' · hits the boss' : '';
    // abono real al jefe = pago del mes − cargos fijos (seguro/manejo NO bajan la deuda)
    const abono = Math.max(val - (extraTag ? 0 : costoFijoMes(item, MES)), 0);
    return `<div class="check-item debt ${paid ? 'paid' : ''}" data-item="${item}" data-mk="${mk}"
            data-debt="${debt ? debt.id : ''}"${extraAttr} data-val="${val}" data-abono="${abono}">
      <div class="box">${paid ? '✓' : ''}</div>
      <div class="cmid">
        <span class="cname">${esc(item)}</span>
        <small>⚔ ${extraTag ? 'promised payment' : "this month's installment"}${hits}</small>
      </div>
      <span class="cval">${fmt(val)}</span></div>`;
  };
  // El aporte al fondo de empresa (método 'Fondo') NO se muestra aquí:
  // tiene su propia sección "Company fund". Se excluye de la lista y del conteo.
  const serviciosVisibles = (S.servicios || []).filter(s => s.method !== 'Fondo');
  $('#checkServicios').innerHTML = serviciosVisibles.map(svcRow).join('')
    + `<button class="btn-add-svc" id="addServiceBtn">+ Add service</button>`;
  $('#checkDeudas').innerHTML = deudas.map(debtRow).join('');
  const total = serviciosVisibles.length + deudas.length;
  // "pagados" = marcados con check + servicios en tarjeta (que cuentan como cubiertos solos)
  const marcados = [...checks].filter(c => c.endsWith('|' + mk)).length;
  const enTarjeta = serviciosVisibles.filter(s => payMethod(s.method).card && !checks.has(`${s.name}|${mk}`)).length;
  const done = marcados + enTarjeta;
  $('#checkCount').textContent = `${done} / ${total} paid`;

  // ===== Barra de ingreso: gastado vs disponible (opción C) =====
  renderIncomeBar(i, mk, deudas);
}

function renderIncomeBar(i, mk, deudas) {
  const cont = document.getElementById('incomeBar');
  if (!cont) return;
  const ingreso = ingresoDelMes(i);
  const checks = new Set(S.checks);
  // lo "pagado" del mes que SALE DEL SALARIO = servicios marcados pagados con débito/efectivo
  // (los pagados con tarjeta de crédito NO cuentan: esa plata se fue a la deuda de la tarjeta, no al salario)
  let pagado = 0;
  for (const s of (S.servicios || [])) {
    if (s.method === 'Fondo') continue;
    if (payMethod(s.method).card) continue;           // tarjeta de crédito: no toca el income
    if (checks.has(`${s.name}|${mk}`)) pagado += s.amount;
  }
  for (const d of deudas) if (checks.has(`${d[0]}|${mk}`)) pagado += d[1];
  // + gastos sueltos del mes que no son a crédito
  const mesKey = S.plan.months[i];
  for (const x of (S.expenses || []))
    if ((x.kind === 'monthly' || x.month === mesKey) && !payMethod(x.method).card && x.method !== 'Ahorro') pagado += x.amount;
  const disponible = ingreso - pagado;
  const pctGastado = ingreso > 0 ? Math.min((pagado / ingreso) * 100, 100) : 0;
  cont.innerHTML = `
    <div class="income-top">
      <span>💰 Income: <b>${fmt(ingreso)}</b></span>
      <span class="${disponible < 0 ? 'nw-debt' : ''}">Available: <b>${fmt(disponible)}</b></span>
    </div>
    <div class="income-track"><i style="width:${pctGastado}%"></i></div>
    <div class="income-foot">
      <span>Spent/paid: <b>${fmt(pagado)}</b></span>
      <span>${pctGastado.toFixed(0)}% of income used</span>
    </div>`;
}

document.addEventListener('click', async (e) => {
  // Editar servicio
  const ed = e.target.closest('.svc-edit');
  if (ed) {
    e.stopPropagation();
    const s = (S.servicios || []).find(x => x.id === +ed.dataset.id);
    if (!s) return;
    const r = await modal({ icon: '✎', title: 'Edit service',
      text: `Edit <b>${esc(s.name)}</b>. Change amount, payment method or payday.`,
      fields: [
        { type: 'text', placeholder: 'Name', value: s.name },
        { type: 'money', placeholder: 'Amount', value: s.amount },
        { type: 'select', value: s.method, options: PAY_METHODS.map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) },
        { type: 'text', placeholder: 'Payday (e.g. 5th of each month)', value: s.payday }
      ], okText: 'Save', danger: false, extraBtn: 'Delete' });
    if (r === null) return;
    if (r === 'EXTRA') {   // botón Delete
      if (await confirmModal('Delete service', `Remove <b>${esc(s.name)}</b> from your services?`)) {
        await api('/api/service/' + s.id, { method: 'DELETE' });
        toast('🗑 Service removed'); load();
      }
      return;
    }
    // guardar cambios campo por campo
    await api('/api/service', { body: { id: s.id, field: 'name', value: r[0] } });
    await api('/api/service', { body: { id: s.id, field: 'amount', value: +r[1] || 0 } });
    const oldMethod = s.method, newMethod = r[2];
    await api('/api/service', { body: { id: s.id, field: 'method', value: newMethod } });
    await api('/api/service', { body: { id: s.id, field: 'payday', value: r[3] } });
    // Si el método CAMBIÓ a una tarjeta de crédito: igual que "Used a Card" en Expenses,
    // preguntar cuotas y registrarlo en el desglose de esa tarjeta (DebtBoss).
    if (newMethod !== oldMethod) {
      const mNew = payMethod(newMethod);
      if (mNew.card) {
        const rc = await modal({ icon: mNew.logo, title: 'Paid with ' + mNew.id,
          text: `<b>${esc(r[0])}</b> will be charged to <b>${mNew.id}</b>. How many installments, and which month does the FIRST one start?`,
          fields: [
            { type: 'number', placeholder: '# installments (1 = single)', min: 1, value: '1' },
            { type: 'select', label: 'First installment', options: mesInicioOpts() }
          ],
          okText: 'Add to card' });
        if (rc) {
          const cuotas = Math.max(1, +rc[0] || 1);
          const startM = rc[1] != null && rc[1] !== '' ? +rc[1] : MES;
          await api('/api/compra', { body: { creditor: newMethod, concepto: r[0] || s.name, valor: +r[1] || s.amount, cuotas, start: startM } });
          toast(`💳 ${esc(r[0])} linked to ${mNew.id} (${cuotas} ${cuotas === 1 ? 'installment' : 'installments'} from ${S.plan.months[startM]})`);
        }
      }
    }
    toast('✓ Service updated'); load();
    return;
  }
  // Agregar servicio
  if (e.target.id === 'addServiceBtn') {
    const r = await modal({ icon: '➕', title: 'Add service',
      text: 'A recurring monthly expense (rent, gym, subscriptions...).',
      fields: [
        { type: 'text', placeholder: 'Name (e.g. Spotify)' },
        { type: 'number', placeholder: 'Amount' },
        { type: 'select', options: PAY_METHODS.map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) },
        { type: 'text', placeholder: 'Payday (e.g. 5th of each month)' }
      ], okText: 'Add service' });
    if (!r || !r[0].trim()) return;
    await api('/api/service/new', { body: { name: r[0], amount: +r[1] || 0, method: r[2], payday: r[3] } });
    toast('➕ Service added'); load();
    return;
  }
  // Marcar/desmarcar pago (servicio o deuda)
  const c = e.target.closest('.check-item');
  if (!c) return;
  if (c.dataset.oncard) {   // servicio en tarjeta: ya está cubierto por la deuda, no se marca a mano
    toast('💳 This one is on your card — it already counts in that card\'s debt.');
    return;
  }
  const estabaMarcado = c.classList.contains('paid');
  const body = { item: c.dataset.item, month: c.dataset.mk };
  // el jefe baja por el abono real (data-abono), no por el pago total con seguro/manejo
  const abonoReal = c.dataset.abono != null ? +c.dataset.abono : +c.dataset.val;
  if (c.dataset.debt) { body.debt_id = +c.dataset.debt; body.valor = abonoReal || 0; }
  if (c.dataset.extra) { body.extra_id = +c.dataset.extra; body.valor = +c.dataset.val || 0; }
  const vivasAntes = snapshotDeudasVivas();
  await api('/api/check', { body });
  await load();
  // feedback claro cuando el check de una deuda (jefe o registrada) abona de verdad
  if (!estabaMarcado && (c.dataset.debt || c.dataset.extra) && (body.valor > 0)) {
    toast(`💥 ${fmt(body.valor)} paid — debt reduced.`);
  }
  // si marcó una deuda (principal o prometida) y la derrotó, animar
  if ((c.dataset.debt || c.dataset.extra) && !estabaMarcado) {
    const dn = CRED_TO_DEBT[c.dataset.item] || c.dataset.item.replace(' (promised)', '').replace(' (registrada)', '');
    const vivasAhora = snapshotDeudasVivas();
    if (vivasAntes.has(dn) && !vivasAhora.has(dn)) {
      flashDerrota(dn);
      setTimeout(() => celebrate({ icon: '☠', title: 'ENEMY DEFEATED', text: `<b>${dn}</b> is down. Paid in full. 🔥` }), 700);
    }
  }
  return;
});

// Auto-actualización del día: si cambia la fecha local (pasó la medianoche) o el
// usuario vuelve a la pestaña, refresca la rutina al día correcto — sin recargar.
let _diaActual = hoyLocal();
function chequearCambioDeDia() {
  const hoy = hoyLocal();
  if (hoy !== _diaActual) {
    _diaActual = hoy;
    const pick = document.getElementById('dayPick');
    if (pick) pick.value = '';     // forzar volver a HOY
    if (typeof renderLife === 'function') renderLife();
    // limpiar compras completadas al cambiar el día (desaparecen al final del día)
    api('/api/shopping/clear_done', {}).then(() => load());
  }
}
setInterval(chequearCambioDeDia, 60000);                 // revisa cada minuto
document.addEventListener('visibilitychange', () => {     // y al volver a la pestaña
  if (!document.hidden) chequearCambioDeDia();
});

/* ---------- ALCANCÍA / BOSS ---------- */
// Solo TUS tarjetas propias (no préstamos personales, Nicole ni créditos).
// boss = nombre en la lista del jefe; creditor = nombre en el plan mensual.
const MIS_TARJETAS = [
  { key: 'Tarjeta DV', label: '💳 Davivienda', boss: 'Tarjeta DV — Jefe Final', creditor: 'Tarjeta DV' },
  { key: 'ADDI', label: '💳 ADDI', boss: 'ADDI', creditor: 'ADDI' },
  { key: 'Codensa', label: '💳 Codensa', boss: 'Codensa', creditor: 'Codensa' },
  { key: 'Banco de Bogotá', label: '💳 Banco de Bogotá', boss: 'Banco de Bogotá', creditor: 'Banco de Bogotá' }
];
// ===== DAVIVIENDA — TRACKER DE AMORTIZACIÓN REAL =====
// Se guarda en profile (clave amort_dav) como JSON. No toca la lógica del jefe ni el desglose.
function getAmortDav() {
  const raw = (S.profile || {})['amort_dav'];
  if (raw) { try { return JSON.parse(raw); } catch (e) { } }
  return {
    capital: 15961878, ea: 28.77, cuotas: 60, cuota: 473600, seguro: 57364,
    extras: [{ name: 'Rediferido de intereses', valor: 146535, meses: 2 },
             { name: 'Costo de manejo AD', valor: 54490, meses: 2 }],
    saldoCapital: 15961878, cuotasPagadas: 0, interesPagado: 0, abonosExtra: 0
  };
}
async function saveAmortDav(A) { await api('/api/profile', { body: { key: 'amort_dav', value: JSON.stringify(A) } }); }
function amortCuota(A) {   // cuota fija real del banco; si no está, la calcula amortizada
  if (A.cuota > 0) return A.cuota;
  const r = Math.pow(1 + A.ea / 100, 1 / 12) - 1;
  return Math.round(A.capital * r / (1 - Math.pow(1 + r, -A.cuotas)));
}
// Total a pagar de Davivienda en el mes i (avanza solo: jul/ago con extras, sept+ sin extras)
function amortMontoMes(i) {
  const A = getAmortDav();
  const extras = (A.extras || []).reduce((s, e) => s + (i < (e.meses || 0) ? e.valor : 0), 0);
  return amortCuota(A) + (A.seguro || 0) + extras;
}
// Estado REAL del crédito: las cuotas pagadas se cuentan desde los checks de Inicio
// (item "Tarjeta DV"), más los abonos extra a capital. Una sola fuente de verdad.
function amortState() {
  const A = getAmortDav();
  const r = Math.pow(1 + A.ea / 100, 1 / 12) - 1;
  const cuota = amortCuota(A);
  const pagadas = (S.checks || []).filter(c => c.startsWith('Tarjeta DV|')).length;
  let bal = A.capital, intPag = 0;
  for (let k = 0; k < pagadas && bal > 0; k++) { const it = bal * r; bal -= Math.min(cuota - it, bal); intPag += it; }
  bal = Math.max(bal - (A.abonosExtra || 0), 0);
  return { A, r, cuota, pagadas, saldoCapital: Math.round(bal), interesPagado: Math.round(intPag) };
}
// Filas del desglose para Davivienda en el mes i (avanzan con el filtro)
function amortRowsMes(i) {
  const A = getAmortDav();
  const r = Math.pow(1 + A.ea / 100, 1 / 12) - 1;
  const cuota = amortCuota(A);
  let bal = A.capital;
  for (let k = 0; k < i && bal > 0; k++) { const it = bal * r; bal -= Math.min(cuota - it, bal); }
  const rows = [];
  if (bal > 0) {
    const interes = Math.round(bal * r), capital = Math.max(Math.min(cuota - interes, bal), 0);
    rows.push({ label: `Crédito Davivienda · cuota ${i + 1}/${A.cuotas} (capital ${fmt(capital)} · interés ${fmt(interes)})`,
      cuota, saldo: Math.round(Math.max(bal - capital, 0)), done: false });
    if (A.seguro) rows.push({ label: 'Seguro + cuota de manejo (no baja deuda)', cuota: A.seguro, saldo: 0, done: false });
  }
  (A.extras || []).forEach(e => { if (i < (e.meses || 0)) rows.push({ label: `${e.name} · ${i + 1}/${e.meses}`, cuota: e.valor, saldo: 0, done: false }); });
  if (!rows.length) rows.push({ label: 'Crédito pagado 🎉', cuota: 0, saldo: 0, done: true });
  return rows;
}
function renderAmortDav() {
  const cont = document.getElementById('amortDav');
  if (!cont) return;
  const st = amortState();
  const A = st.A, r = st.r, cuota = st.cuota;
  const saldo = st.saldoCapital;
  const interesMes = Math.round(saldo * r);
  const capitalMes = Math.max(Math.min(cuota - interesMes, saldo), 0);
  const extrasMes = (A.extras || []).filter(e => st.pagadas < (e.meses || 0));
  const sumaExtras = extrasMes.reduce((s, e) => s + e.valor, 0);
  const totalMes = saldo > 0 ? cuota + A.seguro + sumaExtras : 0;
  // proyección de cuántas cuotas faltan e interés futuro con el saldo actual
  let b = saldo, meses = 0, intFut = 0, noAmortiza = false;
  while (b > 0 && meses < 1000) {
    const it = b * r, cap = Math.min(cuota - it, b);
    if (cap <= 0) { noAmortiza = true; break; }
    b -= cap; intFut += it; meses++;
  }
  const pct = A.capital ? Math.min((1 - saldo / A.capital) * 100, 100) : 0;
  const pagado = saldo <= 0;
  cont.innerHTML = `
    <div class="amort-cap">
      <div><label>Real capital you still owe (the boss)</label><strong class="owe">${fmt(saldo)}</strong></div>
      <div class="card-bar paid"><i style="width:${pct}%"></i></div>
      <small>${Math.round(pct)}% of the capital killed${A.abonosExtra ? ` · ${fmt(A.abonosExtra)} in extra payments` : ''}</small>
    </div>
    ${pagado ? `<p class="amort-done">🎉 Capital fully paid — Davivienda defeated!</p>` : `
    <div class="amort-grid">
      <div><label>You pay this month</label><b>${fmt(totalMes)}</b></div>
      <div><label>↳ goes to your debt (capital)</label><b class="paid">${fmt(capitalMes)}</b></div>
      <div><label>↳ interest (lost)</label><b class="owe">${fmt(interesMes)}</b></div>
      <div><label>↳ insurance + handling</label><b>${fmt(A.seguro)}</b></div>
      ${extrasMes.map(e => `<div><label>↳ ${esc(e.name)} (${e.meses - st.pagadas} left)</label><b>${fmt(e.valor)}</b></div>`).join('')}
    </div>
    <p class="amort-proj">${noAmortiza
        ? '⚠ With this installment the capital barely moves — check the numbers with ✎.'
        : `At this rate: <b>${meses}</b> installments left · about <b>${fmt(Math.round(intFut))}</b> more in interest. You've paid ${st.pagadas} of ${A.cuotas} (counted from your monthly check in Home).`}</p>
    <div class="amort-btns">
      <button class="btn-mini gold" id="amortExtra">💥 Extra payment to capital</button>
      <button class="btn-mini ghost" id="amortReset">↺ Reset extra payments</button>
    </div>
    <p class="hint" style="margin-top:8px">Each month you tick <b>Tarjeta DV</b> in Home's payment list, this advances by one installment. No separate button needed.</p>`}`;
}
function renderMyCards() {
  const cont = document.getElementById('myCards');
  if (!cont) return;
  const pf = S.profile || {};
  const nombreMes = (S.plan.months || [])[MES] || '';   // sigue el filtro de mes de Inicio
  cont.innerHTML = MIS_TARJETAS.map(t => {
    const bd = (S.debts || []).find(d => d.name === t.boss);
    const comprado = bd ? compradoEn(bd.name) : 0;
    const abonDet = bd ? abonoDetalleDeUnJefe(bd.name) : 0;   // abonos hechos en el desglose original
    let totalCard = bd ? bd.initial + comprado : 0;          // deuda total histórica
    let pagado = bd ? bd.abonado + abonDet : 0;              // pagado = abono al jefe + abonos del desglose
    let saldo = Math.max(totalCard - (bd ? bd.abonado : 0) - abonDet, 0);
    if (t.key === 'Tarjeta DV') {                          // Davivienda: capital real amortizado
      const st = amortState();
      totalCard = st.A.capital; saldo = st.saldoCapital; pagado = Math.max(totalCard - saldo, 0);
    }
    const cupo = +(pf['cupo_' + t.key] || 0);
    const disponible = cupo ? Math.max(cupo - saldo, 0) : 0;
    const usoPct = cupo ? Math.min((saldo / cupo) * 100, 100) : 0;
    const pagoPct = totalCard ? Math.min((pagado / totalCard) * 100, 100) : 0;
    const pagoMes = cuotaPlanMes(t.creditor, MES) + extraCuota(t.creditor, MES);
    // ¿la cuota de este mes ya está marcada como pagada en "Debt payments"?
    const mkCard = monthKey(MES);
    const checksSet = new Set(S.checks || []);
    const cuotaPagadaMes = checksSet.has(`${t.boss}|${mkCard}`) || checksSet.has(`${t.creditor}|${mkCard}`);
    return `<div class="card-box">
      <div class="row-between">
        <span class="card-name">${t.label}
          <button class="card-cupo-edit" data-key="${esc(t.key)}" data-cupo="${cupo}" title="Set / raise the limit">✎</button></span>
        <span class="card-cupo">${cupo ? 'Limit ' + fmt(cupo) : 'Set your limit ✎'}</span>
      </div>
      <div class="card-grid">
        <div><label>You owe now</label><b class="owe">${fmt(saldo)}</b></div>
        <div><label>Available</label><b class="avail">${cupo ? fmt(disponible) : '—'}</b></div>
        <div><label>Paid so far</label><b class="paid">${fmt(pagado)}</b></div>
        <div><label>${nombreMes || 'This month'}</label><b>${cuotaPagadaMes ? '<span class="paid-chip">✓ paid</span>' : (pagoMes ? fmt(pagoMes) : '—')}</b></div>
      </div>
      ${saldo > 0 ? `<button class="card-pay-btn" data-boss="${esc(t.boss)}" data-creditor="${esc(t.creditor)}" data-saldo="${saldo}">💵 Pay this card</button>` : '<div class="card-clear">✅ Fully paid</div>'}
      ${cupo
        ? `<div class="card-bar"><i style="width:${usoPct}%"></i></div><small>${Math.round(usoPct)}% of your limit used</small>`
        : `<div class="card-bar paid"><i style="width:${pagoPct}%"></i></div><small>${Math.round(pagoPct)}% paid off · set your limit to see available room</small>`}
    </div>`;
  }).join('');
}
function renderBoss(animate) {
  // init = deuda BRUTA original (sin restar abonos). Suma: base de cada jefe + compras brutas + extra brutos.
  const comprasBrutas = (S.compras || []).reduce((s, c) => {
    const dn = CRED_TO_DEBT[c.creditor] || c.creditor;
    return S.debts.some(d => d.name === dn) ? s + (c.valor || 0) : s;   // solo compras atadas a un jefe
  }, 0);
  const init = S.debts.reduce((s, d) => s + d.initial, 0)
    + comprasBrutas
    + (S.extra_debts || []).reduce((s, d) => s + (d.total || 0), 0);
  // dmg = TODO lo pagado: abono directo al jefe + abonos a compras + abonos a extra_debts
  //       + abonos hechos a líneas del DESGLOSE ORIGINAL (detalle_items) que pertenecen a un jefe.
  const abonoCompras = (S.compras || []).reduce((s, c) => {
    const dn = CRED_TO_DEBT[c.creditor] || c.creditor;
    return S.debts.some(d => d.name === dn) ? s + (c.abonado || 0) : s;
  }, 0);
  const abonoDetalle = abonoDetalleDeJefes();     // abonos a líneas del desglose atadas a un jefe
  const dmg = S.debts.reduce((s, d) => s + d.abonado, 0)
    + abonoCompras + abonoDetalle
    + (S.extra_debts || []).reduce((s, d) => s + (d.abonado || 0), 0);
  const rest = Math.max(init - dmg, 0);
  animateNumber($('#bossInit'), init);
  animateNumber($('#bossDmg'), dmg);
  animateNumber($('#bossRest'), rest);
  animateWidth($('#bossHp'), init ? (rest / init) * 100 : 0);

  const sel = $('#abonoDebt');
  const optsCore = S.debts
    .filter(d => d.initial + compradoEn(d.name) - d.abonado > 0)
    .map(d => `<option value="${d.id}">${d.name} (${fmt(d.initial + compradoEn(d.name) - d.abonado)})</option>`).join('');
  const optsExtra = (S.extra_debts || [])
    .filter(d => (d.total - (d.abonado || 0)) > 0)
    .map(d => `<option value="x:${d.id}">${d.name} (${fmt(d.total - (d.abonado || 0))})</option>`).join('');
  sel.innerHTML = optsCore + optsExtra;

  const extraBars = (S.extra_debts || [])
    .filter(d => (d.total - (d.abonado || 0)) > 0)   // las derrotadas desaparecen
    .map(d => {
      const ab = d.abonado || 0;
      const rest = Math.max(d.total - ab, 0);
      const w = d.total ? (rest / d.total) * 100 : 0;
      const cuotaTxt = d.cuotas >= 1
        ? `${d.cuotas} cuotas de ${fmt(d.cuota)} desde ${S.plan.months[d.start] || '—'}`
        : 'no installments (pay it down when you can)';
      const dueTxt = (!(d.cuotas >= 1) && d.due_date)
        ? ` · 📅 promised ${fmtFecha(d.due_date)}` : '';
      return `<div class="debt-item">
        <div class="row-between"><span>☠ ${d.name}
          <button class="ed-extra" data-id="${d.id}" title="Edit / set payment date">✎</button>
          <button class="del-x" data-type="debt_extra" data-id="${d.id}" title="Borrar deuda">✕</button></span>
          <strong>${fmt(rest)}</strong></div>
        <div class="mini-bar"><i style="width:${Math.max(w, 0)}%"></i></div>
        <small>${ab > 0 ? fmt(ab) + ' de daño · ' : ''}${cuotaTxt}${dueTxt}</small></div>`;
    }).join('');
  const coreBars = S.debts
    .filter(d => (d.initial + compradoEn(d.name) - d.abonado) > 0)   // las derrotadas desaparecen
    .map(d => {
      const tot = d.initial + compradoEn(d.name);
      const r = tot - d.abonado;
      const w = tot ? (r / tot) * 100 : 0;
      const esTarjeta = TARJETAS_CREDITO.includes(d.name);
      // las tarjetas/créditos se editan abajo (rediferir); los préstamos sí se editan/borran aquí
      const botones = esTarjeta ? '' :
        ` <button class="ed-core" data-id="${d.id}" title="Edit / adjust amount">✎</button>` +
        ` <button class="del-x" data-type="debt" data-id="${d.id}" title="Borrar deuda">✕</button>`;
      const banner = bossBanner(d.name);   // 🖼️ slot de imagen del jefe (si la subiste)
      // aura de haki: entre más cerca de derrotarlo (menos vida), más intensa el aura
      const hakiClass = w <= 15 ? 'haki-max' : (w <= 40 ? 'haki-mid' : '');
      return `<div class="debt-item boss-bar ${hakiClass}${banner ? ' has-boss-img' : ''}">
        ${banner}
        <div class="row-between"><span>${d.name}${botones}</span>
          <strong>${fmt(r)}</strong></div>
        <div class="mini-bar"><i style="width:${Math.max(w, 0)}%"></i></div>
        <small>${fmt(d.abonado)} de daño causado${esTarjeta ? ' · edit below ↓' : ''}</small></div>`;
    }).join('');
  // contar derrotadas (para mostrar el logro sin saturar la lista)
  const muertasCore = S.debts.filter(d => (d.initial + compradoEn(d.name) - d.abonado) <= 0).length;
  const muertasExtra = (S.extra_debts || []).filter(d => (d.total - (d.abonado || 0)) <= 0).length;
  const totalMuertas = muertasCore + muertasExtra;
  const trofeo = totalMuertas > 0
    ? `<div class="debt-trophy">🏆 ${totalMuertas} ${totalMuertas === 1 ? 'debt defeated' : 'debts defeated'} — keep going, Kevin!</div>`
    : '';
  const cuerpo = extraBars + coreBars;
  $('#debtList').innerHTML = trofeo + (cuerpo ||
    '<div class="debt-victory">👑 Every debt defeated. You won the war. Freedom achieved.</div>');

  $('#cpCred').innerHTML = Object.keys(S.plan.creditors)
    .map(c => `<option>${c}</option>`).join('');
  $('#cpStart').innerHTML = S.plan.months
    .map((m, ix) => `<option value="${ix}">1st installment: ${m}</option>`).join('');
  $('#ndStart').innerHTML = '<option value="0">1st installment: starting month</option>' + S.plan.months
    .map((m, ix) => `<option value="${ix}">1st installment: ${m}</option>`).join('');
  $('#compraList').innerHTML = S.compras.map(c =>
    `<li><span>${c.creditor} · ${c.concepto} · ${c.cuotas} x ${fmt(cuotaDe(c))} desde ${S.plan.months[c.start]}</span>
     <span>${fmt(c.valor)} <button class="del-x" data-type="compra" data-id="${c.id}">✕</button></span></li>`
  ).join('') || '<li>No new installment purchases. Keep it that way. 🙏</li>';

  renderDesglose();
  renderMyCards();
  renderAmortDav();

  $('#abonoList').innerHTML = S.abonos.map(a =>
    `<li><span>${a.fecha} · ${a.name}</span>
     <span>${fmt(a.valor)} <button class="del" data-id="${a.id}" title="Deshacer">✕</button></span></li>`
  ).join('') || '<li>No attacks yet. The first payment is the most important one.</li>';
}

// Editar una deuda registrada (nombre, total, fecha de pago prometida)
document.addEventListener('click', async (e) => {
  // editar deuda del PLAN (préstamos de personas)
  const edc = e.target.closest('.ed-core');
  if (edc) {
    const d = (S.debts || []).find(x => x.id === +edc.dataset.id);
    if (!d) return;
    const r = await modal({ icon: '✎', title: 'Edit debt',
      text: `Current amount: <b>${fmt(d.initial)}</b>.<br><br>• Change the <b>amount</b> directly, or<br>• Use <b>adjust</b> to add/subtract (e.g. <b>+50000</b> if they lent you more, <b>-20000</b> if you paid some).`,
      fields: [
        { type: 'text', placeholder: 'Name', value: d.name },
        { type: 'number', placeholder: 'Amount', value: d.initial },
        { type: 'text', placeholder: 'Adjust: +50000 or -20000 (optional)' }
      ], okText: 'Save' });
    if (!r) return;
    if (r[0] && r[0] !== d.name) await api('/api/debt/edit', { body: { id: d.id, field: 'name', value: r[0] } });
    let nuevoTotal = +r[1] || d.initial;
    const ajuste = (r[2] || '').trim();
    if (ajuste) {
      const delta = parseInt(ajuste.replace(/[^0-9+-]/g, ''), 10);
      if (!isNaN(delta)) nuevoTotal = Math.max(d.initial + delta, 0);
    }
    if (nuevoTotal !== d.initial) await api('/api/debt/edit', { body: { id: d.id, field: 'initial', value: nuevoTotal } });
    toast(ajuste ? `✓ Adjusted to ${fmt(nuevoTotal)}` : '✓ Debt updated');
    load();
    return;
  }
  const ed = e.target.closest('.ed-extra');
  if (!ed) return;
  const d = (S.extra_debts || []).find(x => x.id === +ed.dataset.id);
  if (!d) return;
  const r = await modal({ icon: '✎', title: 'Edit debt',
    text: `Current total: <b>${fmt(d.total)}</b>.<br><br>• Change the <b>total</b> directly, or<br>• Use <b>adjust</b> to add/subtract (e.g. <b>+50000</b> if they lent you more, <b>-20000</b> if you paid some).<br>• Set a <b>promised date</b> to make it show up in Home that month.`,
    fields: [
      { type: 'text', placeholder: 'Name', value: d.name },
      { type: 'number', placeholder: 'Total amount', value: d.total },
      { type: 'text', placeholder: 'Adjust: +50000 or -20000 (optional)' },
      { type: 'date', value: d.due_date || '' }
    ], okText: 'Save' });
  if (!r) return;
  // nombre
  if (r[0] && r[0] !== d.name) await api('/api/debt_extra/edit', { body: { id: d.id, field: 'name', value: r[0] } });
  // total: si hay ajuste (+/-), tiene prioridad; si no, usa el total directo
  let nuevoTotal = +r[1] || d.total;
  const ajuste = (r[2] || '').trim();
  if (ajuste) {
    const delta = parseInt(ajuste.replace(/[^0-9+-]/g, ''), 10);
    if (!isNaN(delta)) nuevoTotal = Math.max(d.total + delta, 0);
  }
  if (nuevoTotal !== d.total) await api('/api/debt_extra/edit', { body: { id: d.id, field: 'total', value: nuevoTotal } });
  // fecha
  await api('/api/debt_extra/edit', { body: { id: d.id, field: 'due_date', value: r[3] || '' } });
  const msg = ajuste ? `✓ Adjusted to ${fmt(nuevoTotal)}` : (r[3] ? '📅 Payment date set — it will appear in Home' : '✓ Debt updated');
  toast(msg);
  load();
});

$('#abonoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submit = e.submitter || e.currentTarget.querySelector('[type="submit"]');
  await withBusy(submit, async () => {
    const valor = numVal('#abonoValor');
    if (valor <= 0) { toast('Type an amount greater than 0', 'warn'); return; }
    const vivasAntes = snapshotDeudasVivas();
    const rawVal = $('#abonoDebt').value;
    let body, debtName;
    if (rawVal.startsWith('x:')) {
      const exId = +rawVal.slice(2);
      body = { extra_id: exId, valor };
      debtName = ((S.extra_debts || []).find(d => d.id === exId) || {}).name || '';
    } else {
      const debtId = +rawVal;
      body = { debt_id: debtId, valor };
      debtName = (S.debts.find(d => d.id === debtId) || {}).name || '';
    }
    const r = await api('/api/abono', { body });
    const aplicado = Number(r.aplicado || valor);
    toast('⚔ Hit of <b>' + fmt(aplicado) + '</b> to the boss!');
    const f = $('#dmgFloat');
    f.textContent = '−' + fmt(aplicado);
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
    $('#abonoValor').value = '';
    await load(true);
    const vivasAhora = snapshotDeudasVivas();
    if (debtName && vivasAntes.has(debtName) && !vivasAhora.has(debtName)) {
      flashDerrota(esc(debtName)); setTimeout(() => celebrate({ icon: '☠', title: 'ENEMY DEFEATED', text: `<b>${esc(debtName)}</b> is down. One less chain. 🔥` }), 700);
    } else if (vivasAhora.size === 0 && vivasAntes.size > 0) {
      celebrate({ icon: '👑', title: 'YOU ARE FREE', text: 'Every debt defeated. You won the war, Kevin.' });
    }
  });
});

$('#abonoList').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('del')) return;
  if (!await confirmModal('Deshacer abono', 'Undo this attack? The damage goes back to the boss.')) return;
  await api('/api/abono/' + e.target.dataset.id, { method: 'DELETE' });
  load();
});

// Editar / subir el cupo de una de TUS tarjetas
document.addEventListener('click', async (e) => {
  const ed = e.target.closest('.card-cupo-edit');
  if (!ed || ed.id === 'amortEdit') return;
  const key = ed.dataset.key;
  const actual = +ed.dataset.cupo || 0;
  const r = await modal({ icon: '💳', title: `Limit for ${key}`,
    text: 'Set the total credit limit (cupo) for this card. You can raise it anytime — for example, after paying it all off.',
    fields: [{ type: 'money', value: actual || '', placeholder: 'e.g. 1.500.000' }],
    okText: 'Save limit' });
  if (r === null) return;
  const val = +String(r[0] || '').replace(/[^0-9]/g, '') || 0;
  await api('/api/profile', { body: { key: 'cupo_' + key, value: String(val) } });
  toast('💳 Limit saved');
  load();
});

// 💵 Pagar/abonar a una tarjeta (reparte: primero compras, luego deuda base — como un banco)
document.addEventListener('click', async (e) => {
  const pb = e.target.closest('.card-pay-btn');
  if (!pb) return;
  const boss = pb.dataset.boss, creditor = pb.dataset.creditor, saldo = +pb.dataset.saldo || 0;
  if (boss === 'Tarjeta DV — Jefe Final') {
    toast('For Davivienda use the payoff tracker below (it uses real amortization).');
    return;
  }
  const r = await modal({ icon: '💵', title: 'Pay this card',
    text: `<b>${esc(boss)}</b> · balance ${fmt(saldo)}.<br><br>How much are you paying? It goes to your oldest installments first, then to the card's base debt — and shows up everywhere (card, boss, breakdown).`,
    fields: [{ type: 'money', placeholder: `Amount (max ${fmt(saldo)})`, value: '' }],
    okText: 'Pay it', extraBtn: `Pay full ${fmt(saldo)}` });
  if (r === null) return;
  let monto;
  if (r === 'EXTRA') monto = saldo;
  else monto = +String(r[0] || '').replace(/[^0-9]/g, '') || 0;
  if (monto <= 0) { toast('Enter an amount greater than 0, or use “Pay full”.'); return; }
  monto = Math.min(monto, saldo);
  await api('/api/card/pay', { body: { boss, creditor, monto } });
  toast(monto >= saldo ? `✅ ${esc(boss)} fully paid!` : `💵 Paid ${fmt(monto)} to ${esc(boss)} — balance is now ${fmt(saldo - monto)}.`);
  load();
});

// ===== Botones del tracker de Davivienda =====
document.addEventListener('click', async (e) => {
  if (e.target.id === 'amortExtra') {
    const A = getAmortDav();
    const res = await modal({ icon: '💥', title: 'Extra payment to capital',
      text: 'This goes 100% to your capital and kills Davivienda faster — it saves you future interest.',
      fields: [{ type: 'money', placeholder: 'Amount' }], okText: 'Apply' });
    if (!res || !res[0]) return;
    const val = +String(res[0]).replace(/[^0-9]/g, '') || 0;
    if (val <= 0) return;
    A.abonosExtra = (A.abonosExtra || 0) + val;
    await saveAmortDav(A);
    toast(`💥 ${fmt(val)} straight to capital`);
    load(); return;
  }
  if (e.target.id === 'amortEdit') {
    const A = getAmortDav();
    const res = await modal({ icon: '🏦', title: 'Davivienda — loan details',
      text: 'Match these to your Davivienda statement. Capital = what you refinanced; rate = E.A.; insurance + handling = the fixed monthly cost that does NOT lower your debt.',
      fields: [
        { type: 'money', value: A.capital, placeholder: 'Capital financed' },
        { type: 'text', value: String(A.ea), placeholder: 'Annual rate E.A. % (e.g. 28.77)' },
        { type: 'number', value: A.cuotas, placeholder: 'Number of installments (e.g. 60)' },
        { type: 'money', value: A.cuota, placeholder: 'Bank monthly installment (e.g. 473.600)' },
        { type: 'money', value: A.seguro, placeholder: 'Insurance + handling per month' }
      ], okText: 'Save' });
    if (!res) return;
    const cap = +String(res[0]).replace(/[^0-9]/g, '') || A.capital;
    A.ea = parseFloat(String(res[1]).replace(',', '.')) || A.ea;
    A.cuotas = +res[2] || A.cuotas;
    A.cuota = +String(res[3]).replace(/[^0-9]/g, '') || A.cuota;
    A.seguro = +String(res[4]).replace(/[^0-9]/g, '') || A.seguro;
    A.capital = cap;
    await saveAmortDav(A);
    toast('🏦 Updated'); load(); return;
  }
  if (e.target.id === 'amortReset') {
    if (!await confirmModal('Reset extra payments', 'This clears only your extra payments to capital. Your monthly progress comes from the checks in Home and stays.')) return;
    const A = getAmortDav();
    A.abonosExtra = 0;
    await saveAmortDav(A);
    toast('↺ Extra payments cleared'); load(); return;
  }
});

/* ---------- DESGLOSE ---------- */
function calcItem(it, i, opts = {}) {
  const [nombre, cuota, pagadas, total, fijo, detId, abonadoFijo, startMonth] = it;
  const esNomina = !!opts.esNomina;
  const pagados = opts.pagados || 0;   // cuántas cuotas de este grupo se han pagado con check
  if (total == null) {                       // cargo fijo o saldo libre
    const ab = abonadoFijo || 0;
    const saldo = Math.max((fijo || 0) - ab, 0);
    const done = (fijo || 0) > 0 && saldo <= 0;
    return { label: nombre, cuota, saldo, done,
             fijoPay: (fijo || 0) > 0 && detId ? { id: detId, saldo } : null };
  }
  // mes de inicio: si se redefinió para empezar en un mes futuro, aún no corre
  const sm = (startMonth != null && startMonth >= 0) ? startMonth : null;
  if (sm != null && i < sm) {
    return { label: `${nombre} · starts ${(S.plan && S.plan.months && S.plan.months[sm]) || 'later'}`, cuota: 0,
             saldo: cuota * total, done: false,
             redefer: detId ? { type: 'detalle', id: detId, cuotas: total } : null };
  }
  // ── CUÁNTAS CUOTAS YA "PASARON" ──
  // Nómina: avanza SOLA con el mes (se descuenta del sueldo sí o sí).
  // Todo lo demás: parte del progreso original (pagadas del seed) + lo que pagues con check.
  //                NO avanza solo por ver otro mes.
  const pagadasBase = pagadas || 0;            // cuotas que ya venían pagadas (punto de partida)
  const transcurridas = esNomina
    ? Math.max((sm != null ? (i - sm + 1) : (pagadasBase + i + 1)) - 1, 0)
    : Math.min(pagadasBase + pagados, total);
  const num = transcurridas + 1;             // la cuota "actual" a pagar
  if (transcurridas >= total) {
    return { label: nombre, cuota: 0, saldo: 0, done: true };
  }
  // abono parcial (en pesos) guardado en abonadoFijo: reduce el saldo como un banco
  const abon = abonadoFijo || 0;
  const saldoBruto = cuota * (total - transcurridas);
  const saldo = Math.max(saldoBruto - abon, 0);
  if (saldo <= 0) return { label: nombre, cuota: 0, saldo: 0, done: true };
  return { label: `${nombre} · installment ${num}/${total}`
             + (abon > 0 ? ` <small class="prepaid">💵 −${fmt(abon)}</small>` : ''),
           cuota: Math.min(cuota, saldo), saldo, done: false,
           redefer: detId ? { type: 'detalle', id: detId, cuotas: total } : null };
}

function renderDesglose() {
  const i = MES;
  const mkActual = monthKey(i);
  const checksMes = new Set(S.checks || []);
  // Grupos que SÍ pueden marcarse "paid this month": solo cuotas reales
  // (tarjetas, créditos del plan, y deudas registradas CON cuotas). Nunca deudas sin cuotas.
  const gruposConCuota = new Set();
  Object.keys((S.plan && S.plan.creditors) || {}).forEach(cn => gruposConCuota.add(cn));
  (S.extra_debts || []).forEach(d => { if (d.cuotas >= 1) gruposConCuota.add('☠ ' + d.name); gruposConCuota.add(d.name); });
  const grupoPagadoEsteMes = (g) => {
    // el grupo debe ser de cuotas, y su check del mes debe existir
    for (const key of checksMes) {
      const [item, mm] = key.split('|');
      if (mm !== mkActual) continue;
      const itemBase = item.replace(' (registrada)', '').replace(' (promised)', '');
      // coincidencia estricta: el check corresponde a este grupo de cuotas
      const coincide = (item === g) || (itemBase === g) ||
                       ((CRED_TO_GRUPO[itemBase] || itemBase) === g) ||
                       (g === '☠ ' + itemBase);
      if (coincide && (gruposConCuota.has(g) || gruposConCuota.has(itemBase))) return true;
    }
    return false;
  };
  const filas = {};
  // ¿cuántas cuotas de este grupo se han PAGADO con check? (cuenta todos los meses marcados)
  // El desglose avanza por PAGOS, no por el mes que se ve — salvo Nómina, que baja sola.
  const checksPagadosDeGrupo = (g) => {
    let n = 0;
    for (const key of (S.checks || [])) {
      const [item] = key.split('|');
      const itemBase = item.replace(' (registrada)', '').replace(' (promised)', '');
      if (item === g || itemBase === g || (CRED_TO_GRUPO[itemBase] || itemBase) === g || g === '☠ ' + itemBase) n++;
    }
    return n;
  };
  for (const [g, items] of Object.entries(S.detalle)) {
    const esNomina = g.startsWith('Nómina') || g.startsWith('Nomina');
    const pagados = checksPagadosDeGrupo(g);
    filas[g] = items.map(it => calcItem(it, i, { esNomina, pagados }));
  }
  if (filas['Tarjeta DV']) filas['Tarjeta DV'] = amortRowsMes(i);   // Davivienda = amortización (avanza sola)
  const grupoRedefer = {};   // grupo -> {type, id/name} para el botón de rediferir
  // deudas principales del plan (creditors): rediferibles por nombre
  const creditorNames = Object.keys((S.plan && S.plan.creditors) || {});
  for (const [g, items] of Object.entries(S.detalle)) {
    if (g === 'Tarjeta DV') continue;   // Davivienda usa amortización, no rediferir de creditor
    // ¿este grupo corresponde a un creditor con saldo vivo?
    const cred = creditorNames.find(cn => cn === g || g.includes(cn) || cn.includes(g));
    if (cred) {
      const arr = S.plan.creditors[cred];
      const saldoVivo = arr.slice(MES).reduce((s, v) => s + v, 0);
      if (saldoVivo > 0) grupoRedefer[g] = { type: 'creditor', name: cred };
    }
  }
  for (const d of (S.extra_debts || [])) {
    const g = '☠ ' + d.name;
    if (d.cuotas >= 1) {
      const abon = d.abonado || 0;
      // avanza SOLO por lo pagado (abonado), NO por el mes que se ve.
      // cuotas ya cubiertas = cuánto se ha abonado / valor de la cuota
      const cuotasPagadas = d.cuota > 0 ? Math.floor(abon / d.cuota) : 0;
      const num = Math.min(cuotasPagadas + 1, d.cuotas);   // la cuota actual a pagar
      const saldo = Math.max(d.total - abon, 0);
      const antesDeInicio = i < d.start;
      const activa = saldo > 0;
      const inicioLabel = (S.plan.months && S.plan.months[d.start]) || 'later';
      filas[g] = [{
        label: (antesDeInicio
          ? `Cuota ${num}/${d.cuotas} · starts ${inicioLabel}`
          : (activa ? `Cuota ${num}/${d.cuotas}` : `${d.cuotas} cuotas desde ${inicioLabel}`))
          + (abon > 0 ? ` <small class="prepaid">💵 −${fmt(abon)}</small>` : ''),
        cuota: activa && !antesDeInicio ? Math.min(d.cuota, saldo) : 0,
        saldo,
        done: saldo <= 0,
        redefer: saldo > 0 ? { type: 'extra_debt', id: d.id, cuotas: d.cuotas } : null
      }];
    } else {
      const restante = Math.max(d.total - (d.abonado || 0), 0);
      filas[g] = [{ label: 'Saldo (sin cuotas)', cuota: 0, saldo: restante, done: restante <= 0 }];
    }
  }
  for (const c of S.compras) {
    const g = CRED_TO_GRUPO[c.creditor] || c.creditor;
    const cuotaBase = cuotaDe(c);                              // cuota mensual original
    const abonado = c.abonado || 0;
    const antesDeInicio = i < c.start;
    const num = i - c.start + 1;                              // qué cuota toca en el mes elegido
    const transcurridas = Math.min(Math.max(num - 1, 0), c.cuotas);
    // cuotas cubiertas por el ABONO (pagos que hiciste), aparte de las del mes
    const cuotasAbonadas = cuotaBase > 0 ? Math.floor(abonado / cuotaBase) : 0;
    const saldo = Math.max(c.valor - abonado - cuotaBase * transcurridas, 0);
    if (saldo <= 0) continue;                                 // saldado: no aparece
    const cuotasQuedan = cuotaBase > 0 ? Math.ceil(saldo / cuotaBase) : 0;
    const pagadasTotal = transcurridas + cuotasAbonadas;      // cuotas ya cubiertas en total
    const totalOrig = c.cuotas;
    const activa = saldo > 0;
    const inicioLabel = (S.plan.months && S.plan.months[c.start]) || 'later';
    (filas[g] = filas[g] || []).push({
      label: `💳 ${c.concepto}`
        + (antesDeInicio
          ? ` · installment ${Math.min(cuotasAbonadas + 1, totalOrig)}/${totalOrig} · starts ${inicioLabel}`
          : (activa ? ` · installment ${Math.min(pagadasTotal + 1, totalOrig)}/${totalOrig}` : ''))
        + (cuotasAbonadas > 0 ? ` <small class="prepaid">✓ ${cuotasAbonadas} paid</small>` : ''),
      cuota: activa && !antesDeInicio ? Math.min(cuotaBase, saldo) : 0,
      saldo,
      done: saldo <= 0,
      redefer: saldo > 0 ? { type: 'compra', id: c.id, cuotas: c.cuotas } : null
    });
  }
  let total = 0;
  let html = `<p class="hint">Calculated for <b>${S.plan.months[i]}</b> — change it with the month selector in Home and watch installments advance on their own.</p>`;
  html += Object.entries(filas).map(([grupo, items]) => {
    // ocultar las filas ya terminadas (cuotas pagadas / deudas derrotadas)
    const vivos = items.filter(it => !it.done);
    const saldo = vivos.reduce((s, it) => s + it.saldo, 0);
    if (vivos.length === 0) return '';            // grupo completamente derrotado -> fuera
    if (!grupo.startsWith('Nómina')) total += saldo;
    // El check de "Debt payments" SOLO marca visualmente que la cuota del mes ya se pagó.
    // NO descuenta del saldo (el desglose ya avanza solo / el abono lo hace bajar).
    const pagadoEsteMes = grupoPagadoEsteMes(grupo);
    const paidTag = pagadoEsteMes ? ' <span class="paid-month">✓ paid this month</span>' : '';
    return `<details${pagadoEsteMes ? ' class="grp-paid"' : ''}><summary><span>${grupo}${paidTag}</span>
      <span class="sum-val">${saldo ? fmt(saldo) : 'cargos fijos'}</span></summary>
      <table class="table">
      <tr><th>Item</th><th>This month</th><th>Balance after paying</th></tr>` +
      vivos.map(it => {
        const filaPagada = pagadoEsteMes && it.cuota > 0;   // cuota del mes ya pagada (visual)
        return `<tr class="${filaPagada ? 'row-paid' : ''}"><td>${it.label}${it.redefer
            ? ` <button class="redefer-btn mini" data-type="${it.redefer.type}" data-id="${it.redefer.id}" data-cuotas="${it.redefer.cuotas}" title="Reschedule">🔄</button>`
              + ` <button class="cuota-btn" data-act="abonar" data-rtype="${it.redefer.type}" data-id="${it.redefer.id}" title="Pay installments in advance">💵</button>`
              + ` <button class="del-x" data-type="${it.redefer.type === 'extra_debt' ? 'debt_extra' : it.redefer.type}" data-id="${it.redefer.id}" title="Remove this line">✕</button>`
            : (it.fijoPay
              ? ` <button class="fijo-pay-btn" data-id="${it.fijoPay.id}" data-saldo="${it.fijoPay.saldo}" title="Pay this loan (full or partial)">💵 Pay</button>`
                + ` <button class="del-x" data-type="detalle" data-id="${it.fijoPay.id}" title="Remove this line">✕</button>`
              : '')}</td>
           <td class="num">${filaPagada ? '<span class="paid-chip">✓ paid</span>' : (it.cuota ? fmt(it.cuota) : '—')}</td>
           <td class="num">${it.saldo ? fmt(it.saldo) : '—'}</td></tr>`;
      }).join('') +
      '</table>' +
      (grupoRedefer[grupo] && grupoRedefer[grupo].type === 'creditor'
        ? `<button class="btn-ghost redefer-btn" data-type="creditor" data-name="${grupoRedefer[grupo].name}" style="margin:8px 0">🔄 Reschedule the whole ${grupo}</button>`
        : '') +
      '</details>';
  }).join('');
  html += `<div class="desglose-total"><span>TOTAL DEBT IN ${S.plan.months[i].toUpperCase()} (excl. payroll)</span>
    <span>${fmt(total)}</span></div>`;
  $('#desglose').innerHTML = html;
}

/* ---------- HÁBITOS ---------- */
// Calcula días consecutivos de un hábito hasta hoy (o hasta ayer si hoy aún no se marca)
function rachaHabito(habitId, marks, extraSkipDays = []) {
  let streak = 0;
  const d = new Date();
  // si hoy no está marcado, empezar a contar desde ayer (no rompe la racha aún)
  const hoyKey = `${habitId}|${localISO(d)}`;
  if (!marks.has(hoyKey)) d.setDate(d.getDate() - 1);
  for (let k = 0; k < 400; k++) {
    const dow = d.getDay();
    if (dow === 0 || extraSkipDays.includes(dow)) { d.setDate(d.getDate() - 1); continue; }   // domingo (todos) + días extra (ej. sábado para Exercise): no rompen ni cuentan la racha
    const key = `${habitId}|${localISO(d)}`;
    if (marks.has(key)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function renderHabitos() {
  const today = new Date();
  const ym = hoyLocal().slice(0, 7);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const elapsed = today.getDate();
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('#habitMonthTitle').textContent = 'Habits · ' + monthName;

  const marks = new Set(S.marks);
  let html = '<tr><th></th>';
  for (let d = 1; d <= daysInMonth; d++) html += `<th>${d}</th>`;
  html += '</tr>';
  S.habits.forEach(h => {
    const racha = rachaHabito(h.id, marks, h.name === 'Exercise' ? [6] : []);
    const fuego = racha > 0 ? ` <span class="streak" title="${racha} days in a row">🔥${racha}</span>` : '';
    html += `<tr><td class="hname">${h.name}${fuego} <button class="del-x" data-type="habit" data-id="${h.id}">✕</button></td>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = `${ym}-${String(d).padStart(2, '0')}`;
      const on = marks.has(`${h.id}|${day}`);
      html += `<td class="cell ${on ? 'on' : ''} ${d === elapsed ? 'today' : ''}"
               data-h="${h.id}" data-day="${day}">${on ? 'x' : ''}</td>`;
    }
    html += '</tr>';
  });
  $('#habitGrid').innerHTML = html;

  const done = S.marks.length;
  const globalPct = done / (S.habits.length * elapsed);
  $('#habitStats').innerHTML = `
    <div class="card green"><label>x marcadas este mes</label><strong>${done}</strong></div>
    <div class="card gold"><label>Month completion</label><strong>${pct(globalPct)}</strong></div>
    <div class="card"><label>Days elapsed</label><strong>${elapsed} / ${daysInMonth}</strong></div>`;
  $('#closeMonth').dataset.pct = globalPct;
  $('#closeMonth').dataset.label = monthName;
}

$('#habitGrid').addEventListener('click', async (e) => {
  const c = e.target.closest('.cell');
  if (!c) return;
  await api('/api/habit', { body: { habit_id: +c.dataset.h, day: c.dataset.day } });
  // parche local: togglear la marca sin re-pedir TODO el estado (acción muy frecuente)
  const key = `${c.dataset.h}|${c.dataset.day}`;
  S.marks = S.marks || [];
  const i = S.marks.indexOf(key);
  if (i >= 0) S.marks.splice(i, 1); else S.marks.push(key);
  renderHabitos();
  renderAchievements();
  if (typeof renderGym === 'function') renderGym();   // por si el hábito es Exercise: refresca la racha en Gym también
  // micro-rebote en la celda recién tocada (tras el re-render)
  const cell = document.querySelector(`#habitGrid .cell[data-h="${c.dataset.h}"][data-day="${c.dataset.day}"]`);
  if (cell) { cell.classList.remove('cell-pop'); void cell.offsetWidth; cell.classList.add('cell-pop'); }
});

$('#closeMonth').addEventListener('click', async (e) => {
  const { label, pct: p } = e.target.dataset;
  if (!await confirmModal('Cerrar el mes', `You're about to save <b>${label}</b> with <b>${(p * 100).toFixed(1)}%</b> in your Haki history. ${p >= 0.7 ? 'Month conquered! 👑' : 'Didn\'t reach 70%, but keep going.'}`, false)) return;
  await api('/api/close_month', { body: { label, pct: +p } });
  await load();
  if (+p >= 0.7) celebrate({ icon: '👑', title: 'MONTH CONQUERED', text: `<b>${label}</b> closed at <b>${(p * 100).toFixed(0)}%</b>. Your Haki grows stronger.` });
});


/* ====== DARK CONTINENT · EXPEDITIONS & SKILL TRAINING ====== */
const EXPEDITION_ZONES = [
  { name: 'Awakening', min: 0 },
  { name: 'Foundation', min: 20 },
  { name: 'Trial', min: 40 },
  { name: 'Mastery', min: 60 },
  { name: 'Conquest', min: 80 }
];
const HUNTER_RANKS = [
  { min: 0, rank: 'E' }, { min: 20, rank: 'D' }, { min: 40, rank: 'C' },
  { min: 60, rank: 'B' }, { min: 80, rank: 'A' }, { min: 100, rank: 'S' }
];
function hunterRankFor(pctValue, achieved=false) {
  if (achieved) return 'S';
  return [...HUNTER_RANKS].reverse().find(r => pctValue >= r.min)?.rank || 'E';
}
function expeditionMission(goal) {
  const next = String(goal.next_step || '').trim();
  if (next) return next;
  const p = Math.max(0, Math.min(100, +(goal.pct || 0)));
  if (goal.status === 'Lograda 🏆' || p >= 100) return 'Expedition completed. Preserve what you conquered.';
  if (p < 20) return 'Define the smallest action that proves you truly started.';
  if (p < 40) return 'Repeat the foundation until it feels controlled, not accidental.';
  if (p < 60) return 'Face one real-world test outside your comfort zone.';
  if (p < 80) return 'Correct your weakest point and repeat under pressure.';
  return 'Complete the final proof and claim the territory.';
}
function expeditionZoneIndex(pctValue, achieved=false) {
  if (achieved) return EXPEDITION_ZONES.length - 1;
  const p = Math.max(0, Math.min(99, +pctValue || 0));
  return Math.min(EXPEDITION_ZONES.length - 1, Math.floor(p / 20));
}
let activeExpeditionId = null;
function renderExpeditions() {
  const host = document.getElementById('expeditionPanel');
  if (!host) return;
  const goals = (S.goals || []).slice().sort((a,b) => {
    const aw = a.status === 'Lograda 🏆' ? 1 : 0, bw = b.status === 'Lograda 🏆' ? 1 : 0;
    return aw - bw || (b.pct || 0) - (a.pct || 0) || String(a.name).localeCompare(String(b.name));
  });
  if (!goals.length) {
    activeExpeditionId = null;
    host.innerHTML = '<div class="dc-empty">Create your first Goal to open an expedition route.</div>';
    return;
  }
  if (!goals.some(g => String(g.id) === String(activeExpeditionId))) activeExpeditionId = goals[0].id;
  const active = goals.find(g => String(g.id) === String(activeExpeditionId)) || goals[0];
  const p = Math.max(0, Math.min(100, +(active.pct || 0)));
  const achieved = active.status === 'Lograda 🏆' || p >= 100;
  const zoneIx = expeditionZoneIndex(p, achieved);
  const rank = hunterRankFor(p, achieved);
  const zones = EXPEDITION_ZONES.map((z, i) => {
    const conquered = achieved || i < zoneIx;
    const current = !achieved && i === zoneIx;
    const locked = !conquered && !current;
    return `<div class="dc-zone ${conquered ? 'conquered' : ''} ${current ? 'current' : ''} ${locked ? 'locked' : ''}">
      <span class="dc-zone-dot">${conquered ? '✓' : current ? '◆' : '◇'}</span>
      <small>${esc(z.name)}</small>
    </div>`;
  }).join('<span class="dc-route-line"></span>');
  const routes = goals.map((g, i) => {
    const gp = Math.max(0, Math.min(100, +(g.pct || 0)));
    const ga = g.status === 'Lograda 🏆' || gp >= 100;
    const gr = hunterRankFor(gp, ga);
    const selected = String(g.id) === String(active.id);
    return `<button type="button" class="dc-route-card ${selected ? 'active' : ''} ${ga ? 'completed' : ''}" data-expedition-select="${esc(String(g.id))}" aria-pressed="${selected}">
      <span class="dc-route-number">${String(i + 1).padStart(2,'0')}</span>
      <span class="dc-route-copy"><b>${esc(g.name)}</b><small>${gp}% · Rank ${gr}</small></span>
      <span class="dc-route-status">${ga ? '✓' : selected ? '◆' : '→'}</span>
    </button>`;
  }).join('');
  host.innerHTML = `<div class="dc-shell">
    <aside class="dc-route-selector" aria-label="Expedition routes">
      <div class="dc-selector-title"><span>AVAILABLE ROUTES</span><b>${goals.length}</b></div>
      <div class="dc-route-scroll">${routes}</div>
    </aside>
    <article class="dc-expedition-feature ${achieved ? 'completed' : ''}" data-goal-id="${active.id}">
      <div class="dc-map-art" aria-hidden="true"></div>
      <div class="dc-map-overlay"></div>
      <div class="dc-feature-content">
        <div class="dc-expedition-head">
          <div><span class="dc-eyebrow">ACTIVE EXPEDITION</span>
            <h2>${esc(active.name)}</h2><p>${esc(active.why || 'A territory worth conquering.')}</p></div>
          <div class="dc-rank rank-${rank}"><small>RANK</small><b>${rank}</b></div>
        </div>
        <div class="dc-feature-stats">
          <div><small>PROGRESS</small><strong>${p}%</strong></div>
          <div><small>CURRENT TERRITORY</small><strong>${esc(EXPEDITION_ZONES[zoneIx].name)}</strong></div>
          <div><small>STATUS</small><strong>${achieved ? 'Conquered' : 'In progress'}</strong></div>
        </div>
        <div class="dc-progress-row"><div class="dc-progress"><i style="width:${p}%"></i></div><strong>${p}%</strong></div>
        <div class="dc-map" aria-label="Expedition territories">${zones}</div>
        <div class="dc-critical"><span>CRITICAL MISSION</span><b>${esc(expeditionMission(active))}</b></div>
        ${achieved ? '<div class="dc-seal">EXPEDITION CONQUERED</div>' : ''}
      </div>
    </article>
  </div>`;
}

document.addEventListener('click', (event) => {
  const route = event.target.closest('[data-expedition-select]');
  if (!route) return;
  activeExpeditionId = route.dataset.expeditionSelect;
  renderExpeditions();
});

const ACADEMY_DOMAINS = [
  { key:"wisdom", name:"Wisdom", icon:"◈", skills:[
    ["wisdom-critical","Critical thinking","Separate facts, assumptions and persuasion before making a decision.",["Choose one claim you saw online and list what evidence would support it.", "Find one primary or official source about that claim.", "Write one alternative explanation that also fits the known facts.", "Identify one emotional word being used to influence you.", "Summarize the strongest opposing argument fairly.", "Write what evidence would make you change your mind.", "Make one small evidence-based decision and record the result."]],
    ["wisdom-memory","Active recall","Remember more by retrieving, connecting and spacing information.",["Close your notes and write five ideas from memory.", "Turn three facts into questions and answer without looking.", "Connect one new idea to something you already understand.", "Recall yesterday’s lesson before rereading it.", "Explain one concept aloud for two minutes.", "Give yourself a ten-question mini test.", "Recall the essentials after 24 hours and repair the gaps."]],
    ["wisdom-reading","Deep reading","Read to understand, question and apply—not merely to finish pages.",["Read for ten minutes without notifications and mark the central idea.", "Summarize one page in a single sentence.", "Write one question the text has not answered.", "Find a real example of one idea from the chapter.", "Explain the chapter without looking at it.", "Compare one claim with another reliable source.", "Write one action you can take from what you read."]],
    ["wisdom-writing","Clear writing","Organize thought so another person can understand it quickly.",["Write 100 words about one idea without editing.", "Cut the text by 25% without losing meaning.", "Rewrite the opening with one clear main point.", "Replace five vague words with concrete ones.", "Explain the idea for someone new to the subject.", "Read it aloud and fix anything that sounds awkward.", "Save a polished 150-word final version."]],
    ["wisdom-decisions","Decision making","Choose with explicit criteria and learn from outcomes.",["Define one pending decision and its deadline.", "Write the three criteria that matter most.", "Give each criterion a simple weight.", "Describe the worst reasonable outcome and how to reduce it.", "Identify which parts of the decision are reversible.", "Decide with available evidence instead of waiting for certainty.", "Review the outcome and extract one reusable rule."]],
    ["wisdom-culture","Useful general knowledge","Build context across history, science, economics and society.",["Learn the location, capital and one key fact about a country.", "Read a reliable summary of one historical event.", "Understand one economic concept you encounter in daily life.", "Learn how one system in the human body works.", "Research the origin of a technology you use.", "Compare one international story across two sources.", "Connect two topics from this week in a small mind map."]]
  ], tips:["Before trusting a number, ask who measured it and how.", "Trying to recall strengthens memory more than passive rereading.", "An idea you cannot explain simply is not yet mastered.", "Ten focused pages with notes can beat fifty distracted pages.", "Separate reversible decisions from irreversible ones.", "Writing exposes contradictions that silent thinking can hide.", "A strong argument states what evidence could prove it wrong.", "Read the source before reacting to a screenshot of the source.", "Understanding context reduces confident but shallow opinions.", "A useful note contains an idea, your interpretation and a next action.", "Test memory before reviewing; the struggle is part of learning.", "Good judgment improves when you record predictions and outcomes."] },
  { key:"body", name:"Body & Health", icon:"⬢", skills:[
    ["body-strength","Foundational strength","Build control in the squat, push, pull, hinge and carry patterns.",["Practice ten controlled bodyweight squats.", "Do three sets of incline push-ups with clean form.", "Practice a hip hinge using a wall as feedback.", "Carry two balanced objects for three short rounds.", "Hold a stable plank while breathing normally.", "Combine squat, push and carry in a short circuit.", "Record form and choose one technical detail to improve."]],
    ["body-mobility","Daily mobility","Keep joints usable through controlled range and regular movement.",["Move your neck and shoulders slowly through comfortable ranges.", "Practice ankle mobility against a wall for two minutes per side.", "Open the hips with a controlled 90/90 drill.", "Perform slow thoracic rotations on each side.", "Stretch the hip flexors without arching the lower back.", "Build a five-minute full-body mobility flow.", "Repeat the flow and note which movement improved."]],
    ["body-sleep","Sleep system","Protect energy with a repeatable evening and morning rhythm.",["Choose a consistent wake-up time for tomorrow.", "Place your alarm across the room before bed.", "Stop caffeine at least eight hours before sleep.", "Dim lights and screens during the final 30 minutes.", "Prepare clothes and your first morning action tonight.", "Keep the room cool, dark and quiet.", "Review what improved or harmed sleep this week."]],
    ["body-nutrition","Practical nutrition","Build meals around protein, plants, water and sustainable portions.",["Add one clear protein source to your next main meal.", "Drink water before choosing a sugary drink.", "Add one fruit or vegetable you actually enjoy.", "Read the serving size and protein on one food label.", "Prepare one simple meal instead of ordering impulsively.", "Eat one meal without a screen and notice fullness.", "Plan three repeatable meals for the coming week."]],
    ["body-posture","Posture and movement","Use alignment, breathing and strength instead of rigid posing.",["Adjust your screen so your eyes meet its upper third.", "Relax your shoulders and keep your chin neutral for one minute.", "Stand up and walk for two minutes after a long sitting block.", "Practice wall slides with slow control.", "Carry your bag without always loading the same side.", "Record yourself walking and correct one obvious habit.", "Create one environmental cue for a posture reset."]],
    ["body-firstaid","First-aid readiness","Know how to respond calmly while professional help is on the way.",["Save local emergency numbers in your phone.", "Learn how to describe location, danger and condition to dispatch.", "Check the contents and expiry dates of your first-aid kit.", "Learn the steps for controlling severe bleeding from an official source.", "Learn the recovery position from a certified provider.", "Identify where water, gas and electricity can be shut off at home.", "Book or locate a certified CPR and first-aid course."]]
  ], tips:["Consistent sleep and training outperform occasional extreme effort.", "Pain is not a badge of progress; sharp or worsening pain deserves attention.", "Protein supports recovery, but total diet and consistency still matter.", "Walking is useful exercise even when it does not feel dramatic.", "The best routine is one you can repeat without injuring yourself.", "Progressive overload can mean better form or more control, not only more weight.", "Hydration needs vary; thirst and urine color are practical signals.", "A five-minute mobility habit is more useful than an hour done once a month.", "First-aid advice should come from certified medical organizations.", "A stable wake time often anchors sleep better than chasing a perfect bedtime.", "Good posture is movement variety, not holding one rigid pose all day.", "For persistent symptoms, use a qualified clinician rather than social-media diagnosis."] },
  { key:"finance", name:"Finance", icon:"◆", skills:[
    ["finance-budget","Cash-flow control","Know where money must go before deciding what is available to spend.",["Write your expected income for the current month.", "List fixed obligations and their exact due dates.", "Review the last seven days of variable spending.", "Assign a realistic limit to one flexible category.", "Create one buffer line for irregular expenses.", "Compare planned and actual spending without judging yourself.", "Make one adjustment for the next week."]],
    ["finance-emergency","Emergency fund","Create cash protection so surprises do not become expensive debt.",["Choose a first emergency target you can reach.", "Separate emergency money from everyday spending.", "Automate one small transfer after income arrives.", "List three expenses that qualify as real emergencies.", "Find one nonessential expense to redirect this week.", "Review whether the fund is accessible but not too easy to spend.", "Record the new balance and next milestone."]],
    ["finance-debt","Debt strategy","Reduce expensive debt while protecting minimum payments and cash flow.",["List each debt with balance, rate, minimum and due date.", "Confirm that every minimum payment is covered.", "Choose avalanche or snowball and write why it fits you.", "Identify the debt receiving the next extra payment.", "Calculate the effect of one realistic extra payment.", "Remove one spending trigger that creates new card debt.", "Update balances after payments and choose the next move."]],
    ["finance-investing","Investment basics","Understand return, risk, fees, liquidity and diversification before investing.",["Write the goal and time horizon for money you might invest.", "Explain in one sentence how a potential investment earns money.", "List what could make it lose value.", "Check fees, liquidity and withdrawal restrictions.", "Distinguish diversification from owning many similar assets.", "Verify the provider or product with an official regulator.", "Decide whether you understand it well enough to continue researching."]],
    ["finance-buying","Intentional spending","Spend in line with priorities rather than urgency, mood or advertising.",["Use a 24-hour pause for one unplanned purchase.", "Write the total cost, not just the monthly payment.", "Compare the item with the goal that money would delay.", "Check whether you already own something that solves the need.", "Estimate cost per use for a durable item.", "Unsubscribe from one marketing trigger.", "Review the decision after the waiting period."]],
    ["finance-negotiation","Income negotiation","Prepare evidence and alternatives before asking for better compensation.",["List three measurable results you have produced.", "Research a realistic market range from credible sources.", "Write a clear compensation request.", "Practice stating the request without apologizing.", "Prepare responses to two likely objections.", "Identify acceptable alternatives such as training or flexibility.", "Schedule or rehearse the real conversation."]]
  ], tips:["A cheap purchase you do not need is still wasted money.", "An emergency fund buys decision time and protects you from expensive debt.", "Cover every minimum payment before sending extra money to one debt.", "The interest rate and total cost matter more than a comfortable-looking installment.", "A 24-hour pause reduces impulse spending without banning enjoyment.", "Before investing, explain how it earns money, what can make it lose value and when you can withdraw.", "Small automatic contributions are often more reliable than motivation.", "Review subscriptions as though you had to buy each one again today.", "A budget is an adjustable plan, not a moral scorecard.", "Higher expected returns normally require accepting more uncertainty or risk.", "Keep short-term expense money separate from long-term investment money.", "Before lending money, decide whether losing it would damage the relationship or your finances."] },
  { key:"communication", name:"Communication", icon:"◇", skills:[
    ["communication-listening","Active listening","Understand first, then respond with accuracy and calm.",["Put your phone away during one conversation.", "Ask one follow-up question before sharing your view.", "Paraphrase what the other person meant.", "Notice emotion without trying to solve it immediately.", "Wait two seconds before responding.", "Summarize the agreement and the unresolved point.", "Ask whether your summary was accurate."]],
    ["communication-diction","Clear speech","Speak with enough pace, volume and articulation to be understood.",["Read aloud slowly for two minutes.", "Record one minute of speech and notice rushed words.", "Practice opening your mouth more on difficult sounds.", "Pause at punctuation instead of filling space with “um.”", "Explain one topic using shorter sentences.", "Practice speaking one level louder without shouting.", "Record the same passage again and compare clarity."]],
    ["communication-conversation","Conversation skills","Create connection through curiosity, contribution and balanced attention.",["Open one conversation with a specific observation.", "Ask a question that cannot be answered with yes or no.", "Share a related detail without taking over the conversation.", "Notice one sign that the other person wants to continue or stop.", "Use the person’s name naturally once.", "End one conversation warmly instead of disappearing.", "Recall one detail and follow up later."]],
    ["communication-boundaries","Boundaries","Say yes, no and not now without aggression or excessive explanation.",["Identify one situation where you agreed resentfully.", "Write a one-sentence respectful refusal.", "Practice saying it aloud without adding excuses.", "Offer an alternative only if you genuinely want to.", "Repeat the boundary calmly if pressured.", "Accept that discomfort does not mean the boundary is wrong.", "Use the boundary once in a low-risk situation."]],
    ["communication-negotiation","Negotiation","Find interests, options and clear trade-offs instead of fighting positions.",["Define what you want and your minimum acceptable outcome.", "Write what the other side may care about.", "Prepare three questions before proposing solutions.", "Separate facts from assumptions about their position.", "Offer two workable options instead of one demand.", "Practice silence after making the request.", "Write the final agreement in concrete terms."]],
    ["communication-public","Public speaking","Deliver one useful idea with structure, presence and practice.",["Choose one message the audience should remember.", "Create a simple opening, three points and a close.", "Practice the opening without notes.", "Record yourself and remove one distracting habit.", "Replace dense wording with one example.", "Rehearse while standing and timing yourself.", "Deliver the talk to one person or camera."]]
  ], tips:["Listening is an active skill, not simply waiting for your turn.", "A short pause can make you sound more confident and precise.", "Clear boundaries need fewer explanations than anxious boundaries.", "Good questions reveal interests that arguments often miss.", "People remember how specifically you made them feel seen.", "Speaking more slowly is often clearer than speaking more loudly.", "Summarizing an agreement prevents different interpretations later.", "A difficult conversation improves when you prepare the desired outcome first.", "Negotiation is easier when you know your alternative before entering.", "Confidence in public speaking comes from repetitions, not positive thinking alone.", "Use examples when an abstract explanation is not landing.", "Respectful disagreement attacks the claim, not the person."] },
  { key:"independence", name:"Independence", icon:"⬡", skills:[
    ["independence-driving","Driving confidence","Build calm control through gradual, safe exposure and deliberate practice.",["Identify every main control while the parked car is off.", "Set seat, mirrors, steering position and seat belt correctly.", "Practice smooth starts and stops in a safe controlled area.", "Practice low-speed turns while looking where you want to go.", "Practice parking using fixed reference points.", "Drive a quiet familiar route with a qualified supervisor.", "Repeat the route and write which fear decreased and what still needs work."]],
    ["independence-cooking","Basic cooking","Prepare affordable meals safely without depending on delivery.",["Practice knife safety and prepare one vegetable.", "Cook eggs using one method with controlled heat.", "Prepare rice or another basic carbohydrate.", "Cook one protein and check doneness safely.", "Build a complete plate from simple ingredients.", "Cook enough for a second meal and store it correctly.", "Repeat the meal from memory and improve one detail."]],
    ["independence-home","Home maintenance","Handle basic household problems and know when to call a professional.",["Locate the water, electricity and gas shutoffs.", "Learn which breakers control the main areas of the home.", "Practice using a screwdriver and measuring tape safely.", "Tighten one loose handle or hinge.", "Learn how to unclog a simple drain without dangerous chemical mixing.", "Create a small tool and spare-parts kit.", "Write three repairs that require a qualified professional."]],
    ["independence-cleaning","Cleaning system","Keep your space functional through small repeatable resets.",["Clear and wipe one high-use surface.", "Sort laundry by care needs and run one correct load.", "Clean the bathroom sink and mirror.", "Sweep or vacuum one room thoroughly.", "Discard or relocate ten unnecessary items.", "Create a ten-minute evening reset.", "Write a weekly rotation that prevents buildup."]],
    ["independence-documents","Personal administration","Keep identity, health, work and financial documents easy to find and renew.",["List your essential documents and expiry dates.", "Create one secure physical or digital folder structure.", "Scan one important document and name it clearly.", "Add one renewal reminder to your calendar.", "Store emergency contact information in an accessible place.", "Review who can access sensitive documents.", "Complete one pending administrative task."]],
    ["independence-safety","Personal safety","Reduce avoidable risk through awareness, preparation and calm decisions.",["Choose two emergency contacts and confirm their numbers.", "Review the safest exits from home and work.", "Practice sharing your location for a planned trip when appropriate.", "Identify one common scam and its warning signs.", "Create a plan for losing your phone or wallet.", "Walk one familiar route while noticing exits and lighting.", "Review the plan and fix one weak point."]]
  ], tips:["Competence grows through controlled exposure, not waiting for fear to vanish.", "Know where your home’s water, gas and electricity shutoffs are before an emergency.", "Five reliable meals create more independence than saving fifty recipes.", "A clean space is easier to maintain with short resets than occasional marathons.", "Back up essential documents, but protect access with strong security.", "Do not mix household cleaning chemicals unless the label explicitly allows it.", "A basic tool kit is useful; electrical, gas and structural work may require professionals.", "Learning the route before driving it can reduce cognitive load.", "Check mirrors and blind spots with a deliberate routine, not memory alone.", "Scammers often create urgency to stop you from verifying.", "Keep emergency contacts available even when the phone is locked.", "Independence includes knowing when a task exceeds your training."] },
  { key:"profession", name:"Profession & Study", icon:"▣", skills:[
    ["profession-english","Practical English","Build usable comprehension and expression through daily retrieval and exposure.",["Learn five words connected to your real work or goals.", "Write one sentence for each word.", "Listen to three minutes and write what you understood.", "Shadow one short audio clip aloud.", "Explain your day in English for two minutes.", "Correct three recurring mistakes.", "Have or simulate a five-minute conversation."]],
    ["profession-focus","Focused study","Protect attention long enough to produce meaningful work.",["Define one visible result for a 25-minute block.", "Remove the phone from reach before starting.", "Close every tab not required for the task.", "Write distracting thoughts on paper instead of following them.", "Take a short movement break and begin a second block.", "Measure output instead of time alone.", "Review which distraction caused the most loss and redesign the environment."]],
    ["profession-notes","Effective notes","Turn information into questions, connections and usable outputs.",["Write the lesson objective at the top of the page.", "Capture ideas in your own words rather than copying.", "Mark one unclear point to investigate.", "Create five recall questions from the notes.", "Connect one idea to a previous topic.", "Write a three-line summary after the session.", "Use the notes to produce a small output or answer."]],
    ["profession-data","Data literacy","Ask clear questions, inspect data and communicate evidence responsibly.",["Write one question a dataset could answer.", "Identify the unit, source and time period of one dataset.", "Check for missing or impossible values.", "Calculate one meaningful summary such as median or rate.", "Create one simple chart with a clear title.", "Write one limitation of the analysis.", "Explain the result to a nontechnical person."]],
    ["profession-code","Programming practice","Solve small problems by planning, testing and reviewing code.",["Define the input, output and edge cases of one tiny problem.", "Write pseudocode before touching syntax.", "Implement the smallest working version.", "Test one normal case and two edge cases.", "Read the error message before changing code.", "Refactor one confusing name or repeated block.", "Save the solution with a short explanation."]],
    ["profession-portfolio","Portfolio building","Show evidence of ability through finished, explained and accessible work.",["Choose one project that matches the role you want.", "Define the problem and intended user.", "List the smallest features needed for a complete version.", "Build or improve one visible feature.", "Write what you personally contributed.", "Add screenshots, results or a short demonstration.", "Publish or update the project page and request feedback."]]
  ], tips:["A study session needs a concrete output, not only a duration.", "Retrieval practice reveals gaps that rereading can hide.", "A portfolio project should show decisions and results, not only tools used.", "The fastest way to improve code is to test small changes and read errors carefully.", "One finished small project is stronger evidence than five abandoned large ones.", "English improves faster when vocabulary is tied to real situations.", "Data without source, unit and timeframe can mislead.", "Put the phone physically out of reach during deep work.", "Explain what you learned to reveal whether you truly understand it.", "Clear file names and documentation are professional skills.", "Measure work by useful output when possible, not busy activity.", "Ask for specific feedback: what was clear, confusing and missing."] },
  { key:"presence", name:"Presence & Glow Up", icon:"✦", skills:[
    ["presence-grooming","Grooming system","Maintain clean, healthy basics with a simple repeatable routine.",["Inspect and trim nails neatly.", "Clean and organize grooming tools.", "Choose a consistent haircut or maintenance schedule.", "Review beard or shaving lines in natural light.", "Prepare a small daily hygiene checklist.", "Replace one expired or irritating product.", "Repeat the routine and remove any unnecessary step."]],
    ["presence-skin","Basic skin care","Protect the skin barrier with cleansing, moisturizing and sun protection.",["Identify whether your cleanser leaves skin comfortable or tight.", "Use a gentle cleanser at the end of the day.", "Apply a simple moisturizer to slightly damp skin.", "Use broad-spectrum sunscreen in the morning.", "Avoid adding multiple new products at once.", "Clean your pillowcase and phone screen.", "Review irritation and keep only what your skin tolerates."]],
    ["presence-style","Personal style","Build clean, well-fitting outfits that suit your life and proportions.",["Try on one outfit and check shoulder, waist and trouser fit.", "Clean or repair one pair of shoes.", "Choose two neutral colors that combine easily.", "Prepare tomorrow’s outfit tonight.", "Remove one item that is damaged or never worn.", "Photograph three reliable outfits for future reference.", "Identify one strategic gap before buying anything new."]],
    ["presence-bodylanguage","Body language","Communicate calm attention through posture, movement and eye contact.",["Enter one room with relaxed shoulders and neutral chin.", "Practice natural eye contact with brief breaks.", "Keep both hands visible and still during one conversation.", "Slow one nervous movement for 60 seconds.", "Greet someone with a clear voice and relaxed posture.", "Take the space you need without shrinking or dominating.", "Record yourself entering, greeting and sitting; correct one detail."]],
    ["presence-confidence","Evidence-based confidence","Trust yourself by keeping concrete promises and handling discomfort.",["Choose one small promise you can complete today.", "Finish it before making another promise.", "Write one difficult situation you have already overcome.", "Do one safe uncomfortable action for five minutes.", "Ask clearly for something without minimizing yourself.", "Acknowledge one mistake without insulting yourself.", "List seven pieces of evidence that you can rely on yourself."]],
    ["presence-social","Social presence","Become memorable through warmth, attention and consistency.",["Greet three people first.", "Give one specific sincere compliment.", "Keep the phone away during one interaction.", "Remember one detail and ask about it later.", "Introduce two people and say something positive about each.", "Thank someone for one precise action.", "Propose one simple plan with a date."]]
  ], tips:["Fit and cleanliness usually improve an outfit more than an expensive brand.", "Daily sunscreen and consistency are a stronger base than a ten-product routine.", "Confidence grows from evidence that you keep promises to yourself.", "Fragrance should be discovered nearby, not announced across the room.", "Relaxed shoulders and a neutral chin read as calmer than rigid posing.", "Clean shoes and cared-for clothes elevate simple outfits.", "Avoid picking skin lesions; it can increase irritation and marks.", "Natural eye contact includes brief breaks, not an unbroken stare.", "Preparing clothes the night before reduces decisions and improves consistency.", "A specific compliment feels more genuine than a generic one.", "Presence improves when you listen and remember details.", "You do not need to perform extroversion; communicate attention and calm."] }
];
const ACADEMY_TARGET = 7;
function academyAllSkills(){ return ACADEMY_DOMAINS.flatMap(d => d.skills.map(s => ({domain:d, id:s[0], name:s[1], summary:s[2], practices:s[3]}))); }
function academyReadState(){
  const raw=(S.profile||{}).hunter_academy_state;
  let st={activeSkillId:'',sessions:0,doneDates:[],mastered:[],startedOn:hoyLocal(),domain:'independence'};
  if(raw){ try{ st={...st,...JSON.parse(raw)}; }catch(_e){} }
  const all=academyAllSkills();
  if(!all.some(x=>x.id===st.activeSkillId)){
    const rec=academyRecommendationV2(); const first=all.find(x=>x.domain.key===rec.key)||all[0];
    st.activeSkillId=first.id; st.domain=first.domain.key; st.sessions=0; st.doneDates=[]; st.startedOn=hoyLocal();
  }
  st.mastered=Array.isArray(st.mastered)?st.mastered:[]; st.doneDates=Array.isArray(st.doneDates)?st.doneDates:[];
  return st;
}
async function academySaveState(st){
  S.profile=S.profile||{}; S.profile.hunter_academy_state=JSON.stringify(st);
  await api('/api/profile',{body:{key:'hunter_academy_state',value:S.profile.hunter_academy_state},quiet:true});
}
function academyRecommendationV2(){
  const habits=S.habits||[], goals=S.goals||[], books=S.books||[], courses=S.courses_done||[];
  const score={wisdom:books.length,body:habits.filter(h=>/exercise|gym|walk|run|entrena|ejercicio|sleep|sueño/i.test(h.name||'')).length,finance:goals.filter(g=>/debt|deuda|ahorro|finance|dinero|tarjeta/i.test((g.name||'')+' '+(g.description||''))).length,communication:habits.filter(h=>/speak|conversation|dicci|comunica/i.test(h.name||'')).length,independence:goals.filter(g=>/driv|licen|cook|cocina|independ|carro/i.test((g.name||'')+' '+(g.description||''))).length,profession:courses.length+goals.filter(g=>/english|ingl|career|program|data|profes|estudio/i.test((g.name||'')+' '+(g.description||''))).length,presence:habits.filter(h=>/groom|skin|posture|style|cuidado|disciplina/i.test(h.name||'')).length};
  return ACADEMY_DOMAINS.slice().sort((a,b)=>(score[a.key]||0)-(score[b.key]||0))[0]||ACADEMY_DOMAINS[0];
}
function academyDayNumber(){ const d=new Date(), start=new Date(d.getFullYear(),0,0); return Math.floor((d-start)/86400000); }
function academyDailyIntel(){ const flat=ACADEMY_DOMAINS.flatMap(d=>d.tips.map(t=>({domain:d.name,icon:d.icon,text:t}))); return flat[academyDayNumber()%flat.length]; }
function renderSkillAcademy(){
  const host=document.getElementById('skillAcademy'); if(!host)return;
  const st=academyReadState(), all=academyAllSkills(), active=all.find(x=>x.id===st.activeSkillId)||all[0];
  const today=hoyLocal(), doneToday=st.doneDates.includes(today), sessions=Math.min(Number(st.sessions)||0,ACADEMY_TARGET), progress=Math.round(sessions/ACADEMY_TARGET*100), intel=academyDailyIntel();
  const practice=active.practices[Math.min(sessions,active.practices.length-1)]||active.practices[0];
  const recommended=academyRecommendationV2();
  const domainTabs=ACADEMY_DOMAINS.map(d=>`<button class="academy-domain-tab ${d.key===st.domain?'active':''}" data-academy-domain="${d.key}"><span>${d.icon}</span>${esc(d.name)}</button>`).join('');
  const visible=all.filter(x=>x.domain.key===st.domain);
  const catalogue=visible.map(x=>{const mastered=st.mastered.includes(x.id), current=x.id===active.id; return `<button class="academy-skill-option ${current?'current':''} ${mastered?'mastered':''}" data-academy-skill="${x.id}"><span>${mastered?'✓':current?'◆':'◇'}</span><div><b>${esc(x.name)}</b><small>${mastered?'MASTERED':current?`${sessions}/${ACADEMY_TARGET} sessions`:esc(x.summary)}</small></div></button>`}).join('');
  host.innerHTML=`<section class="academy-command-card">
    <div class="academy-command-top"><div><span>DAILY HUNTER TRAINING</span><h3>${esc(active.name)}</h3><p>${esc(active.summary)}</p></div><div class="academy-rank-orb"><b>${sessions}</b><small>OF ${ACADEMY_TARGET}</small></div></div>
    <div class="academy-meta"><span>${active.domain.icon} ${esc(active.domain.name)}</span><span>Training day ${Math.min(sessions+1,ACADEMY_TARGET)} of ${ACADEMY_TARGET}</span><span>${st.mastered.length} skills mastered</span></div>
    <div class="academy-progress"><i style="width:${progress}%"></i></div>
    <div class="academy-practice"><span>TODAY'S PRACTICE</span><strong>${esc(practice)}</strong><p>Do it deliberately. One real session is worth more than saving twenty tips.</p></div>
    <button class="btn academy-complete-btn" data-academy-complete ${doneToday?'disabled':''}>${doneToday?'✓ PRACTICE LOGGED TODAY':sessions>=ACADEMY_TARGET?'CHOOSE THE NEXT SKILL':"LOG TODAY\'S PRACTICE"}</button>
  </section>
  <aside class="academy-intel"><div><span>${intel.icon} DAILY INTEL · ${esc(intel.domain)}</span><strong>${esc(intel.text)}</strong></div><small>A relevant field note for this domain. It does not award progress or duplicate your routine.</small></aside>
  <div class="academy-catalogue"><div class="academy-catalogue-head"><div><span>SKILL PATHS</span><b>Choose what you want to master</b></div><em>Recommended today: ${esc(recommended.name)}</em></div><div class="academy-domain-tabs">${domainTabs}</div><div class="academy-skill-list">${catalogue}</div></div>`;
}
document.addEventListener('click',async(e)=>{
  const domainBtn=e.target.closest('[data-academy-domain]');
  if(domainBtn){const st=academyReadState();st.domain=domainBtn.dataset.academyDomain;await academySaveState(st);renderSkillAcademy();return;}
  const skillBtn=e.target.closest('[data-academy-skill]');
  if(skillBtn){const st=academyReadState(), next=academyAllSkills().find(x=>x.id===skillBtn.dataset.academySkill);if(!next)return;st.activeSkillId=next.id;st.domain=next.domain.key;st.sessions=0;st.doneDates=[];st.startedOn=hoyLocal();await academySaveState(st);renderSkillAcademy();toast('New Hunter training selected');return;}
  const complete=e.target.closest('[data-academy-complete]');
  if(complete){const st=academyReadState(),today=hoyLocal();if(st.doneDates.includes(today))return;st.doneDates.push(today);st.sessions=Math.min((Number(st.sessions)||0)+1,ACADEMY_TARGET);if(st.sessions>=ACADEMY_TARGET&&!st.mastered.includes(st.activeSkillId)){st.mastered.push(st.activeSkillId);const masteredSkill=academyAllSkills().find(x=>x.id===st.activeSkillId);celebrate({icon:'◆',title:'SKILL MASTERED',text:`<b>${esc(masteredSkill?.name||'Hunter training')}</b> is now reliable. Choose your next training.`});}else toast('Practice registered');await academySaveState(st);renderSkillAcademy();return;}
});

function hunterLicenseState() {
  const months = (S.history || []).filter(h => h.pct >= 0.7).length;
  const goals = (S.goals || []).filter(g => g.status === 'Lograda 🏆' || (g.pct || 0) >= 100).length;
  const streak = Math.max(0, ...(S.habits || []).map(h => rachaHabito(h.id, new Set(S.marks || []), h.name === 'Exercise' ? [6] : [])));
  const courses = (S.courses_done || []).length;
  const books = (S.books || []).filter(b => b.status === 'Terminado').length;
  const requirements = [
    { label:'Conquer a major goal', done: goals >= 1, value:`${goals}/1` },
    { label:'Conquer two Haki months', done: months >= 2, value:`${months}/2` },
    { label:'Hold a 14-day discipline streak', done: streak >= 14, value:`${Math.min(streak,14)}/14` },
    { label:'Prove growth: course or 3 books', done: courses >= 1 || books >= 3, value:courses >= 1 ? `${courses} course` : `${books}/3 books` }
  ];
  return { unlocked: requirements.every(r => r.done), requirements, months, goals, streak, courses, books };
}
function renderHunterLicense() {
  const host = document.getElementById('hunterLicensePanel');
  if (!host) return;
  const st = hunterLicenseState();
  const unlockedOn = (S.profile || {}).hunter_license_unlocked_on || '';
  if (st.unlocked && !unlockedOn && !renderHunterLicense._saving) {
    renderHunterLicense._saving = true;
    const day = hoyLocal();
    api('/api/profile', { body:{ key:'hunter_license_unlocked_on', value:day }, quiet:true })
      .then(() => { S.profile = S.profile || {}; S.profile.hunter_license_unlocked_on = day; renderHunterLicense(); })
      .catch(() => {})
      .finally(() => { renderHunterLicense._saving = false; });
  }

  const doneCount = st.requirements.filter(r => r.done).length;
  const examPct = Math.round(doneCount / st.requirements.length * 100);
  const rank = st.unlocked ? 'S' : hunterRankFor(examPct);
  const dateText = unlockedOn || (st.unlocked ? hoyLocal() : 'PENDING');
  const serialDate = (unlockedOn || hoyLocal()).replaceAll('-', '');
  const licenseNo = `KLV-${serialDate}-${String(st.goals).padStart(2,'0')}`;
  const highlightedGoal = (S.goals || []).find(g => g.status === 'Lograda 🏆' || Number(g.pct || 0) >= 100);
  const expedition = highlightedGoal ? highlightedGoal.name : 'DARK CONTINENT CANDIDATE';

  host.innerHTML = `<section class="hunter-license-stage ${st.unlocked ? 'unlocked' : 'locked'}">
    <div class="hunter-license-card" role="img" aria-label="Hunter License ${st.unlocked ? 'unlocked' : 'in progress'}">
      <img src="/static/img/hunter_license_front.webp" alt="" class="hunter-license-art" loading="eager">
      <div class="hunter-license-data">
        <span class="hunter-license-overline">KEVIN LIFEOS</span>
        <strong class="hunter-license-title">${st.unlocked ? 'AUTHORIZED HUNTER' : 'LICENSE EXAM'}</strong>
        <div class="hunter-license-fields">
          <div><small>LICENSEE</small><b>KEVIN</b></div>
          <div><small>RANK</small><b>${esc(rank)}</b></div>
          <div><small>LICENSE NO.</small><b>${esc(licenseNo)}</b></div>
          <div><small>ISSUED</small><b>${esc(dateText)}</b></div>
        </div>
        <div class="hunter-license-expedition"><small>MAJOR EXPEDITION</small><b>${esc(expedition)}</b></div>
      </div>
      ${st.unlocked ? '<span class="hunter-license-authorized">AUTHORIZED</span>' : `<div class="hunter-license-lock"><span>◆</span><b>${examPct}%</b><small>EXAM IN PROGRESS</small></div>`}
    </div>
    <div class="hunter-license-progress">
      <div class="hunter-license-progress-head"><div><span>HUNTER LICENSE EXAM</span><strong>${st.unlocked ? 'License permanently unlocked' : `${doneCount} of ${st.requirements.length} trials completed`}</strong></div><b>${examPct}%</b></div>
      <div class="hunter-license-meter"><i style="width:${examPct}%"></i></div>
      <div class="hunter-license-reqs">${st.requirements.map(r => `<div class="${r.done ? 'done' : ''}"><span>${r.done ? '✓' : '◇'} ${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('')}</div>
    </div>
  </section>`;
}



/* ====== HUNTER RANK SYSTEM ====== */
const HUNTER_GLOBAL_RANKS = [
  { rank:'E', min:0,    title:'Applicant' },
  { rank:'D', min:100,  title:'Pathfinder' },
  { rank:'C', min:250,  title:'Field Hunter' },
  { rank:'B', min:450,  title:'Expedition Hunter' },
  { rank:'A', min:700,  title:'Elite Hunter' },
  { rank:'S', min:1000, title:'Dark Continent Hunter' }
];
function hunterGlobalRankState() {
  const goals = S.goals || [];
  const xp = Math.round(goals.reduce((sum, g) => sum + Math.max(0, Math.min(100, Number(g.pct || 0))), 0));
  let currentIndex = 0;
  HUNTER_GLOBAL_RANKS.forEach((r, i) => { if (xp >= r.min) currentIndex = i; });
  const current = HUNTER_GLOBAL_RANKS[currentIndex];
  const next = HUNTER_GLOBAL_RANKS[currentIndex + 1] || null;
  const intoRank = xp - current.min;
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.max(0, Math.min(100, Math.round(intoRank / span * 100))) : 100;
  return { xp, current, next, progress, goals: goals.length };
}
function renderHunterRankSystem() {
  const host = document.getElementById('hunterRankPanel');
  if (!host) return;
  const st = hunterGlobalRankState();
  host.innerHTML = `<section class="hunter-rank-system">
    <div class="hunter-rank-summary">
      <div class="hunter-rank-emblem rank-${st.current.rank}"><small>HUNTER RANK</small><b>${st.current.rank}</b></div>
      <div class="hunter-rank-copy">
        <span>GLOBAL EXPEDITION RANK</span>
        <h2>${esc(st.current.title)}</h2>
        <p>Your rank grows from the real progress of every Goal. Adding a new goal opens a route but never removes XP already earned.</p>
      </div>
      <div class="hunter-rank-xp"><small>EXPEDITION XP</small><strong>${st.xp}</strong><span>${st.goals} routes</span></div>
    </div>
    <div class="hunter-rank-meter-head"><span>${st.next ? `${st.current.rank} → ${st.next.rank}` : 'MAXIMUM RANK'}</span><b>${st.next ? `${st.xp} / ${st.next.min} XP` : `${st.xp} XP`}</b></div>
    <div class="hunter-rank-meter"><i style="width:${st.progress}%"></i></div>
    <div class="hunter-rank-ladder">${HUNTER_GLOBAL_RANKS.map((r, i) => {
      const state = i < HUNTER_GLOBAL_RANKS.indexOf(st.current) ? 'cleared' : i === HUNTER_GLOBAL_RANKS.indexOf(st.current) ? 'current' : 'locked';
      return `<div class="${state}"><span>${state === 'cleared' ? '✓' : state === 'current' ? '◆' : '◇'}</span><b>${r.rank}</b><small>${esc(r.title)}</small><em>${r.min} XP</em></div>`;
    }).join('')}</div>
  </section>`;
}

/* ====== ACHIEVEMENTS ====== */
function renderAchievements() {
  renderHunterLicense();
  renderHunterRankSystem();
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;
  const dmg = (S.debts || []).reduce((s, d) => s + d.abonado, 0);
  const enemigosMuertos = (S.debts || []).filter(d => (d.initial + compradoEn(d.name) - d.abonado) <= 0).length;
  const mesesGanados = (S.history || []).filter(h => h.pct >= 0.7).length;
  const metasLogradas = (S.goals || []).filter(g => g.status === 'Lograda 🏆').length;
  const abonos = (S.abonos || []).length;
  const cursosFin = (S.courses_done || []).length;
  const maxRacha = Math.max(0, ...(S.habits || []).map(h => rachaHabito(h.id, new Set(S.marks), h.name === 'Exercise' ? [6] : [])));
  const librosFin = (S.books || []).filter(b => b.status === 'Terminado').length;
  const ahorroTotal = (S.dreams || []).reduce((s, d) => s + (d.saved || 0), 0);
  const totalDebts = (S.debts || []).length;

  const LOGROS = [
    { icon: '⚔', name: 'First Blood', desc: 'Log your first payment', got: abonos >= 1 },
    { icon: '☠', name: 'Slayer', desc: 'Defeat your first debt', got: enemigosMuertos >= 1 },
    { icon: '💀', name: 'Hunter', desc: 'Defeat 3 debts', got: enemigosMuertos >= 3 },
    { icon: '⚔', name: 'Warlord', desc: 'Pay 10M in total damage', got: dmg >= 10000000 },
    { icon: '👑', name: 'Liberator', desc: 'Defeat ALL debts — total freedom', got: enemigosMuertos >= totalDebts && totalDebts > 0 },
    { icon: '🔥', name: 'On Fire', desc: '7-day habit streak', got: maxRacha >= 7 },
    { icon: '⚡', name: 'Unstoppable', desc: '30-day habit streak', got: maxRacha >= 30 },
    { icon: '🛡', name: 'Disciplined', desc: 'Conquer your first month (≥70%)', got: mesesGanados >= 1 },
    { icon: '👁', name: 'Haki Master', desc: 'Conquer 6 months', got: mesesGanados >= 6 },
    { icon: '🎓', name: 'Student', desc: 'Finish your first course', got: cursosFin >= 1 },
    { icon: '🎯', name: 'Achiever', desc: 'Complete a goal', got: metasLogradas >= 1 },
    { icon: '📚', name: 'Reader', desc: 'Finish your first book', got: librosFin >= 1 },
    { icon: '📖', name: 'Bookworm', desc: 'Finish 5 books', got: librosFin >= 5 },
    { icon: '🐷', name: 'Saver', desc: 'Save 500K toward your dreams', got: ahorroTotal >= 500000 },
    { icon: '💎', name: 'Big Saver', desc: 'Save 2M toward your dreams', got: ahorroTotal >= 2000000 }
  ];
  const got = LOGROS.filter(l => l.got).length;
  grid.innerHTML = `<div class="ach-count">${got} / ${LOGROS.length} unlocked</div>` +
    LOGROS.map(l => `<div class="ach-card ${l.got ? 'got' : 'locked'}">
      <div class="ach-icon">${l.got ? '<span class="hunter-medal-core">' + l.icon + '</span>' : '<span class="hunter-medal-lock">◇</span>'}</div>
      <div class="ach-name">${l.name}</div>
      <div class="ach-desc">${l.desc}</div>
    </div>`).join('');
}

const HAKI_LEVELS = [
  { min: 0, key: 'dormant', name: 'Dormant Haki', short: 'Dormant', img: '/static/img/haki_dormant.webp', need: 0, next: 'Conquer 1 month at 70% or more' },
  { min: 1, key: 'observation', name: 'Observation Haki', short: 'Observation', img: '/static/img/haki_observation.webp', need: 1, next: 'Conquer 2 months at 70% or more' },
  { min: 2, key: 'armament', name: 'Armament Haki', short: 'Armament', img: '/static/img/haki_armament.webp', need: 2, next: 'Conquer 4 months at 70% or more' },
  { min: 4, key: 'advanced', name: 'Advanced Haki', short: 'Advanced', img: '/static/img/haki_advanced.webp', need: 4, next: 'Conquer 6 months at 70% or more' },
  { min: 6, key: 'conqueror', name: "Conqueror's Haki", short: 'Conqueror', img: '/static/img/haki_conqueror.webp', need: 6, next: 'The throne is yours' }
];

function hakiLevelFor(wins) {
  return [...HAKI_LEVELS].reverse().find(level => wins >= level.min) || HAKI_LEVELS[0];
}

function renderHaki() {
  const wins = (S.history || []).filter(h => h.pct >= 0.7).length;
  const current = hakiLevelFor(wins);
  const currentIx = HAKI_LEVELS.findIndex(x => x.key === current.key);
  const next = HAKI_LEVELS[currentIx + 1] || null;

  const badge = $('#hakiBadge');
  if (badge) {
    badge.className = `haki-badge haki-badge-${current.key}`;
    badge.innerHTML = `<img src="${current.img}" alt="" onerror="this.style.display='none'">
      <span><b>${esc(current.name)}</b><small>${wins} ${wins === 1 ? 'month' : 'months'}</small></span>`;
  }

  const showcase = $('#hakiShowcase');
  if (showcase) {
    const progressStart = current.need;
    const progressEnd = next ? next.need : current.need;
    const progress = next && progressEnd > progressStart
      ? Math.max(0, Math.min(100, ((wins - progressStart) / (progressEnd - progressStart)) * 100))
      : 100;
    const nextText = next
      ? `<b>Next evolution:</b> ${esc(next.name)} · ${next.need - wins} conquered month${next.need - wins === 1 ? '' : 's'} remaining`
      : `<b>Maximum evolution reached.</b> The throne is yours.`;

    const gallery = HAKI_LEVELS.map(level => {
      const unlocked = wins >= level.need;
      const isCurrent = level.key === current.key;
      return `<div class="haki-evolution ${unlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}">
        <div class="haki-evolution-img">
          <img src="${level.img}" alt="${esc(level.name)}" loading="lazy">
          ${unlocked ? '' : '<span class="haki-lock">🔒</span>'}
          ${isCurrent ? '<span class="haki-current-tag">CURRENT</span>' : ''}
        </div>
        <b>${esc(level.short)}</b>
        <small>${level.need === 0 ? 'Starting state' : `${level.need}+ conquered months`}</small>
      </div>`;
    }).join('');

    showcase.innerHTML = `<div class="haki-hero haki-${current.key}">
      <div class="haki-hero-art"><img src="${current.img}" alt="${esc(current.name)}"></div>
      <div class="haki-hero-info">
        <span class="haki-rank">CURRENT HAKI</span>
        <h3>${esc(current.name)}</h3>
        <p>${wins} conquered ${wins === 1 ? 'month' : 'months'} at 70% or more.</p>
        <div class="haki-next">${nextText}</div>
        <div class="haki-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}">
          <i style="width:${progress}%"></i>
        </div>
      </div>
    </div>
    <div class="haki-evolution-grid">${gallery}</div>`;
  }

  $('#hakiHistory').innerHTML = (S.history || []).map(h =>
    `<span class="haki-month ${h.pct >= 0.7 ? 'win' : 'lose'}">
     ${esc(h.label)}: ${pct(h.pct)} ${h.pct >= 0.7 ? '✔' : '✘'}</span>`
  ).join('') || '<span class="hint">Close your first month to start earning Haki. The King demands 6 months ≥70%.</span>';
  renderHakiChart();
}

let hakiChart = null;
function renderHakiChart() {
  const cv = document.getElementById('hakiChart');
  if (!cv) return;
  const hist = S.history || [];
  if (hist.length < 2) { cv.style.display = 'none'; if (hakiChart) { hakiChart.destroy(); hakiChart = null; } return; }
  cv.style.display = '';
  const data = {
    labels: hist.map(h => h.label),
    datasets: [{
      label: '% completion',
      data: hist.map(h => Math.round(h.pct * 100)),
      borderColor: '#f5b942', backgroundColor: 'rgba(245,185,66,.15)',
      fill: true, tension: 0.3, pointRadius: 5,
      pointBackgroundColor: hist.map(h => h.pct >= 0.7 ? '#36c9a7' : '#ff5e7a')
    }]
  };
  const opts = { responsive: true, plugins: { legend: { display: false } },
    scales: { y: { min: 0, max: 100, ticks: { color: '#9a93b8' }, grid: { color: 'rgba(255,255,255,.06)' } },
              x: { ticks: { color: '#9a93b8' }, grid: { display: false } } } };
  if (hakiChart) { hakiChart.data = data; hakiChart.update(); }
  else hakiChart = new Chart(cv, { type: 'line', data, options: opts });
}

/* ---------- METAS ---------- */
function renderGoals() {
  const won = S.goals.filter(g => g.status === 'Lograda 🏆').length;
  const fuego = S.goals.filter(g => g.status === 'En proceso 🔥').length;
  $('#goalStats').innerHTML = `
    <div class="card gold"><label>Goals achieved</label><strong>${won} / ${S.goals.length}</strong></div>
    <div class="card"><label>In progress 🔥</label><strong>${fuego}</strong></div>`;
  const estados = ['Pendiente', 'En proceso 🔥', 'Lograda 🏆'];
  const estLbl = { 'Pendiente': 'Pending', 'En proceso 🔥': 'In progress 🔥', 'Lograda 🏆': 'Achieved 🏆' };
  $('#goalTable').innerHTML =
    '<tr><th>Goal</th><th>Why do you want it?</th><th>Date</th><th>Status</th><th>%</th><th>Progress</th><th>Next step</th><th></th></tr>' +
    S.goals.map(g => {
      const p = Math.min(Math.max(g.pct || 0, 0), 100);
      const bar = '█'.repeat(Math.round(p / 5)) + '░'.repeat(20 - Math.round(p / 5));
      return `<tr class="${g.status === 'Lograda 🏆' ? 'goal-won' : ''}">
        <td><input class="g-edit wide" data-id="${g.id}" data-f="name" value="${esc(g.name)}"></td>
        <td><input class="g-edit wide" data-id="${g.id}" data-f="why" value="${esc(g.why)}" placeholder="your reason in one line"></td>
        <td><input class="g-edit" data-id="${g.id}" data-f="target" value="${esc(g.target)}" style="width:84px"></td>
        <td><select class="g-edit" data-id="${g.id}" data-f="status">
          ${estados.map(s => `<option value="${s}" ${s === g.status ? 'selected' : ''}>${estLbl[s]}</option>`).join('')}</select></td>
        <td><input class="g-edit" type="number" min="0" max="100" data-id="${g.id}" data-f="pct" value="${p}" style="width:64px"></td>
        <td class="bar-cell">${bar}</td>
        <td><input class="g-edit wide" data-id="${g.id}" data-f="next_step" value="${esc(g.next_step)}" placeholder="next small action"></td>
        <td><button class="del-x" data-type="goal" data-id="${g.id}">✕</button></td></tr>`;
    }).join('');
  renderExpeditions();
}
$('#goalTable').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('g-edit')) return;
  const field = e.target.dataset.f, value = e.target.value;
  const g = S.goals.find(x => x.id === +e.target.dataset.id) || {};
  const eraLograda = g.status === 'Lograda 🏆';
  await api('/api/goal', { body: { id: +e.target.dataset.id, field, value } });
  await load();
  const ahora = S.goals.find(x => x.id === g.id) || {};
  if (!eraLograda && (ahora.status === 'Lograda 🏆' || (field === 'status' && value === 'Lograda 🏆'))) {
    celebrate({ icon: '🏆', title: 'GOAL ACHIEVED', text: `<b>${ahora.name || g.name}</b> — you earned it. On to the next.` });
  }
});

/* ====== PELDAÑOS DE CARRERA (Data / Ciber) ====== */
const PELDANOS = ['Fundamentals', 'Intermediate', 'Projects', 'Professional'];
const STEP_DESC = [
  'The basics: core concepts, tools and first courses. Your current course lives here.',
  'Going deeper: advanced topics, real practice, complex exercises.',
  'Building: 2-3 solid projects for your portfolio (GitHub, demos).',
  'The seal: a strong certificate + ready to work professionally.'
];
const PELDANO_DESC = [
  'The basics: SQL, Excel, Python intro, concepts. Your current course lives here.',
  'Going deeper: statistics, data cleaning, visualization, complex queries.',
  'Building: 2-3 real projects for your portfolio (GitHub, dashboards).',
  'The seal: a strong certificate + ready to work.'
];
const PELDANO_DESC_CIBER = [
  'The basics: networks, Linux, security concepts.',
  'Going deeper: TryHackMe rooms, crypto basics, vulnerability analysis.',
  'Practice: solved machines, writeups, an ethical-hacking mini-portfolio.',
  'The seal: strong certificate + ready to work.'
];
// progreso de la meta = (peldaños completos + avance del curso actual) / 4
function progresoCarrera(foco) {
  const pf = S.profile || {};
  const step = +(pf[foco === 'Ciber' ? 'ciber_step' : 'data_step'] || 0);   // 0..3
  const pct = +(pf[foco === 'Ciber' ? 'ciber_pct' : 'data_pct'] || 0);       // 0..100 del curso actual
  // cada peldaño vale 25%. Los anteriores ya están al 100%, el actual aporta su %.
  const total = step * 25 + (pct / 100) * 25;
  return Math.min(Math.round(total), 100);
}
function nombreMetaFoco(foco) {
  return (S.goals || []).find(g => {
    const n = (g.name || '').toLowerCase();
    return foco === 'Ciber' ? /ciber|cyber|security|seguridad/.test(n)
                            : /data|anal[íi]tic|datos/.test(n);
  });
}
// (La sincronización Career -> Goal ahora vive en el servidor: _sync_metas_carreras en app.py,
// que corre en cada /api/state y usa goal_id si existe, o lo busca y enlaza por nombre.)

/* ====== LIFE: generador de rutina inteligente ====== */
const SHIFTS = {
  '7-16': { label: '7am – 4pm', work: [7, 16] },
  '8-17': { label: '8am – 5pm', work: [8, 17] },
  '9-18': { label: '9am – 6pm', work: [9, 18] },
  '12-21': { label: '12pm – 9pm (viernes)', work: [12, 21] },
  'sabado': { label: 'Saturday 10am – 6pm', work: [10, 18] },
  'sabado11': { label: 'Saturday 11am – 7pm', work: [11, 19] },
  'libre': { label: 'Day off', work: null },
  'descanso': { label: 'Rest', work: null }
};
const DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// inglés A1-A2 → C1: qué tocar cada día de la semana
// SISTEMA REAL DE INGLÉS — output diario (lo que más cuesta = el centro).
// Cada día: hablar primero, luego un recurso distinto, y SIEMPRE cerrar hablando con la IA.
const INGLES_PLAN = [
  // Lunes — 🗣 SPEAKING (output / fluidez)
  { title: '🗣 Speaking day', steps: [
    { s: 'Free-talk 5 min and record it', how: "Open your phone recorder and talk out loud about your day, an opinion, anything. Do NOT stop to fix mistakes — keep the words flowing even if messy. Fluency is built by moving your mouth, not by being perfect." },
    { s: 'Listen back, pick 3 fixes', how: "Play one minute back. Write 3 specific things: a word you mispronounced, a sentence that froze, or something you couldn't say. Naming the problem is half of fixing it." },
    { s: '2-minute monologue, no stopping', how: "Choose ONE topic and talk for 2 full minutes without switching to Spanish. If a word is missing, describe it in English ('the thing you use to...'). This single drill is what breaks the fear of speaking." }
  ]},
  // Martes — 🎧 LISTENING (input real: escuchar de verdad)
  { title: '🎧 Listening day', steps: [
    { s: 'Active listen, NO subtitles (8–10 min)', how: "Pick audio/video where you understand about 85% (a podcast, YouTube, a series you know). Watch ONCE with no subtitles and just follow it. Then write 2–3 sentences of what you understood. The goal is to train your EAR, not to talk." },
    { s: 'Dictation: write exactly what you hear', how: "Take a 30–60 second clip. Play a sentence, pause, and write word-for-word what they said. Replay as needed, then check against the subtitles. Dictation forces you to catch the tiny words ('a', 'to', 'have') that get swallowed in real speech." },
    { s: 'Shadow one 60-sec segment', how: "Now turn subtitles ON for one short segment and shadow it: play a line, pause, repeat it copying the EXACT rhythm and accent. Shadowing is the bridge that turns listening into a better accent." }
  ]},
  // Miércoles — 📖 READING (input)
  { title: '📖 Reading day', steps: [
    { s: 'Extensive reading, just flow (12–15 min)', how: "Read something you enjoy at about 85% understanding (graded reader, article, an ASW unit). Do NOT stop at every unknown word — guess from context and keep going. Volume and enjoyment build reading speed; stopping constantly kills it." },
    { s: 'Intensive: mine 5 words', how: "Go back to ONE paragraph. Look up the 5 words you couldn't guess, write each in a full sentence of your own, and notice how the sentence is built. A word you can USE is yours; one you only recognize is borrowed." },
    { s: 'Retell the idea (out loud or written)', how: "Close the text and rebuild the main idea in your own words — don't copy sentences. If you can re-explain it, you truly understood it. Speaking or writing, your choice." }
  ]},
  // Jueves — ✍️ WRITING (output)
  { title: '✍️ Writing day', steps: [
    { s: 'Write 6–10 sentences', how: "Pick anything: your day, an opinion, a plan. Try to think DIRECTLY in English instead of translating from Spanish, even if it comes out simpler. Simple-and-correct beats complex-and-wrong." },
    { s: 'Read it out loud, self-edit', how: "Read your own paragraph aloud. Your ear catches what your eyes skip — fix whatever sounds off before sending it." },
    { s: 'AI corrects + explains 2 rules', how: "Send it to the AI: ask it to correct everything BUT explain only your 2 biggest mistakes with the rule behind them. Save those 2 rules where you'll re-read them. Learning the rule beats learning the single fix." }
  ]},
  // Viernes — 💬 CONVERSATION (output / fluidez)
  { title: '💬 Conversation day', steps: [
    { s: 'Real conversation 20–25 min', how: "Talk with the AI (voice if you can) about real things — work, anime, your goals. Jump straight in, no warm-up. Push through the awkward moments; that discomfort is exactly where fluency grows." },
    { s: 'Recycle 5 words from this week', how: "Before you finish, deliberately use 5 words you collected on reading/listening days. Using a new word in conversation is what moves it from 'I know it' to 'I own it'." },
    { s: 'Get your top 3 repeated mistakes', how: "Ask the AI which 3 mistakes you repeated most today. Write them down and watch for them next week. Fixing your most-frequent errors raises your level faster than anything else." }
  ]},
  // Sábado — 🎬 IMMERSION + INTEGRATE (listening + speaking)
  { title: '🎬 Immersion day', steps: [
    { s: 'Watch a scene: subs ON, then OFF', how: "Pick a 3–5 min scene. Watch it WITH subtitles (input), then immediately again WITHOUT. Notice how much more you catch the second time — that gap is your listening improving in real time." },
    { s: 'Shadow your 3 favorite lines', how: "Pick the 3 lines that sounded most natural and shadow each one 3 times, copying tone and rhythm. Repeating real, natural speech is how you stop sounding like a textbook." },
    { s: 'Retell the scene, recorded', how: "Retell what happened out loud and record it. Producing right after input is what turns 'I understood it' into 'I can say it'." }
  ]},
  // Domingo — 🌿 LIGHT IMMERSION + WEEKLY REVIEW
  { title: '🌿 Light immersion & review', steps: [
    { s: 'Enjoy English you love', how: "Watch, read or listen to something you genuinely love in English (subtitles fine). No drills — just live in the language. Note 5 phrases that sounded natural and say each 3 times out loud." },
    { s: 'Review the week (spaced repetition)', how: "Re-read this week's word list and your saved mistake-rules. Seeing them again days later is what locks them into long-term memory. Light days still count — consistency beats intensity." }
  ]}
];
// Etapas A1 → C1 cubriendo las 4 habilidades. 'level' = nivel que ALCANZAS al completar la etapa
// (se usa para el veredicto cuando metes el resultado de un test real).
const ENGLISH_TRIMESTERS = [
  { q: 'Stage 1 · A1 → A2', level: 'A2',
    goal: 'READ short simple texts · WRITE 5-6 sentences about yourself · UNDERSTAND slow, clear audio · SPEAK 2 min about your day (errors OK).',
    book: 'American School Way — Basic/Intermediate', subs: 'English subtitles always' },
  { q: 'Stage 2 · A2 → B1', level: 'B1',
    goal: 'READ a short article · WRITE a paragraph or simple email · FOLLOW a slow conversation · HOLD a 5-min chat on familiar topics.',
    book: 'American School Way — Upper-Intermediate', subs: 'Remove subs on scenes you know' },
  { q: 'Stage 3 · B1 → B2', level: 'B2',
    goal: 'READ news & opinion pieces · WRITE a clear 150-word text · UNDERSTAND a series with subtitles · ARGUE and tell stories for 10 min.',
    book: 'American School Way — Advanced', subs: 'No subtitles on familiar content' },
  { q: 'Stage 4 · B2 → C1', level: 'C1',
    goal: 'READ complex/abstract texts · WRITE a structured essay · UNDERSTAND natives at normal speed · DISCUSS abstract topics fluently.',
    book: 'Advanced / native materials', subs: 'Native content, no subtitles' }
];
// Orden de niveles CEFR para comparar resultados de test
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// Tests reales, gratuitos y verificados (miden sobre todo lectura y escucha)
const ENGLISH_TESTS = [
  { name: 'EF SET (free, A1–C2)', url: 'https://www.efset.org/', note: 'Most rigorous free one · ~50 min' },
  { name: 'Cambridge — Test your English', url: 'https://www.cambridgeenglish.org/test-your-english/', note: 'Quick, instant CEFR estimate' },
  { name: 'British Council level test', url: 'https://englishonline.britishcouncil.org/free-english-level-test-cefr-2/', note: '5-min placement' }
];

function renderLife() {
  const sh = S.shifts || {};
  const pf = S.profile || {};
  // 1. Grid de turnos
  $('#shiftGrid').innerHTML = DIAS.map((d, wd) =>
    `<div class="shift-day"><label>${d}</label>
      <select data-wd="${wd}">
        ${Object.entries(SHIFTS).map(([k, v]) =>
          `<option value="${k}" ${(sh[wd] || 'libre') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select></div>`).join('');
  // 2. Selector de día (próximos 7 días desde HOY, según la fecha local del navegador)
  const pick = $('#dayPick');
  const prev = pick.value;                 // conservar selección si el usuario eligió otro día
  const base = new Date();                 // ahora mismo, hora local del dispositivo
  base.setHours(12, 0, 0, 0);              // mediodía para evitar saltos por zona horaria
  let opts = '';
  for (let k = 0; k < 7; k++) {
    const d = new Date(base); d.setDate(base.getDate() + k);
    const iso = localISO(d);
    const wd = (d.getDay() + 6) % 7;
    opts += `<option value="${iso}|${wd}">${k === 0 ? 'TODAY · ' : ''}${DIAS[wd]} ${d.getDate()}/${d.getMonth() + 1}</option>`;
  }
  pick.innerHTML = opts;
  // si la selección previa sigue existiendo (mismo día), mantenerla; si no, default a HOY
  if (prev && [...pick.options].some(o => o.value === prev)) pick.value = prev;
  pick.onchange = renderRoutineDay;
  renderRoutineDay();

  // Panel de carreras personalizables
  renderCareer();
  renderEnglish();
  renderSkillAcademy();
  // sincronizar metas que coincidan por nombre con una carrera (emparejamiento robusto)
  for (const c of (S.careers || [])) {
    const prog = progresoCareer(c);
    const meta = metaDeCarrera(c);
    if (meta && (meta.pct || 0) !== prog) {
      api('/api/goal', { body: { id: meta.id, field: 'pct', value: prog } });
    }
  }

  // 3. Weekly advice based on the ACTIVE career
  const active = (S.careers || []).find(c => c.active) || (S.careers || [])[0];
  const studyDays = (S.rdone || []).filter(x => x.endsWith('|estudio') || x.endsWith('|proyecto')).length;
  const lvl = pf.eng_real_level || pf.ingles_nivel || 'A1-A2';
  let tip = `Your English is at ${lvl}: daily consistency beats marathons. 30 focused minutes EVERY day take you to C1 — not 3 hours once. `;
  if (active) {
    const pct = active.pct || 0;
    tip += `Focus: ${active.icon || ''} ${active.name} (${pct}% of your current course). `;
    tip += pct < 30 ? 'Lock down the fundamentals first; practice a little every day.'
      : pct < 70 ? 'Good momentum — start your first real project for your portfolio.'
      : 'Final stretch: push 2 projects to GitHub and aim for your certificate.';
  }
  tip += ` You have ${studyDays} study ${studyDays === 1 ? 'session' : 'sessions'} logged — every ✓ is real progress. A goal's 100% is never given: you earn it day by day, and YOU decide when you truly got there.`;
    $('#lifeTip').textContent = tip;
  renderAppointments();
}

// Lista de citas/eventos AGENDADOS desde el calendario (scheduled=1), ordenadas por fecha próxima
function renderAppointments() {
  const box = document.getElementById('apptList');
  if (!box) return;
  const hoy = hoyLocal();
  const items = (S.routine_extra || [])
    .filter(a => a.scheduled && a.day && a.day >= hoy)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.time || '').localeCompare(b.time || ''));
  if (!items.length) { box.innerHTML = ''; return; }
  const [hy, hm, hd] = hoy.split('-').map(Number);
  const hoyUTC = Date.UTC(hy, hm - 1, hd);
  box.innerHTML = '<div class="appt-title">📅 Scheduled</div>' + items.map(a => {
    const [yy, mm, dd] = a.day.split('-').map(Number);
    const diff = Math.round((Date.UTC(yy, mm - 1, dd) - hoyUTC) / 86400000);
    const when = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff} days`;
    const soon = diff <= 3 ? ' appt-soon' : '';
    return `<div class="appt-row${soon}">
      <div class="appt-info">
        <b>${esc(a.title)}</b>
        <small>${fmtFecha(a.day)}${a.time ? ' · ' + a.time : ''} · <span class="appt-when">${when}</span></small>
      </div>
      <button class="del-x" data-type="routine_extra" data-id="${a.id}" title="Cancel">✕</button>
    </div>`;
  }).join('');
}

// Cuenta cuántos días distintos completaste el bloque de inglés
function diasInglesHechos() {
  const dias = new Set();
  for (const x of (S.rdone || [])) {
    if (x.endsWith('|ingles')) dias.add(x.split('|')[0]);
  }
  return dias.size;
}
// Sincroniza la carrera "Inglés" con tu práctica real: 30 días = 1 peldaño (25%)
async function syncCarreraIngles() {
  const careers = S.careers || [];
  const eng = careers.find(c => /ingl|english/i.test(c.name || ''));
  if (!eng) return;
  const dias = diasInglesHechos();
  const DIAS_POR_PELDANO = 30;
  const step = Math.min(Math.floor(dias / DIAS_POR_PELDANO), 4);
  const pctDelPeldano = Math.round(((dias % DIAS_POR_PELDANO) / DIAS_POR_PELDANO) * 100);
  // solo actualizar si cambió, para no spamear el servidor (y reflejarlo local para el render)
  if (eng.step !== step) { await api('/api/career', { body: { id: eng.id, field: 'step', value: step } }); eng.step = step; }
  if ((eng.pct || 0) !== pctDelPeldano && step < 4) { await api('/api/career', { body: { id: eng.id, field: 'pct', value: pctDelPeldano } }); eng.pct = pctDelPeldano; }
  if (step >= 4 && (eng.pct || 0) !== 100) { await api('/api/career', { body: { id: eng.id, field: 'pct', value: 100 } }); eng.pct = 100; }
}

function renderEnglish() {
  const panel = document.getElementById('englishPanel');
  if (!panel) return;
  const pf = S.profile || {};
  const qIdx = Math.min(+(pf.eng_q || 0), ENGLISH_TRIMESTERS.length - 1);
  const t = ENGLISH_TRIMESTERS[qIdx];
  const startedQ = pf['eng_q_start_' + qIdx] || '';
  // días dentro del trimestre actual
  let diasEnQ = '';
  if (startedQ) {
    const d0 = new Date(startedQ), now = new Date();
    const dias = Math.floor((now - d0) / 86400000);
    diasEnQ = `${dias} ${dias === 1 ? 'day' : 'days'} into this quarter`;
  }
  const lastLevel = pf.eng_real_level || '';
  const lastPct = pf.eng_real_pct || '';
  const lastDate = pf.eng_real_date || '';
  panel.innerHTML = `
    <div class="eng-hero">
      <div class="eng-q">${t.q}</div>
      <div class="eng-goal">🎯 This stage — all 4 skills: <b>${t.goal}</b></div>
      <div class="eng-meta">📘 ${t.book} · 🎬 ${t.subs}</div>
      ${diasEnQ ? `<div class="eng-days">${diasEnQ}</div>` : ''}
    </div>
    <div class="eng-rule">⚖️ The balance rule: train <b>INPUT</b> (reading + listening) <b>and OUTPUT</b> (speaking + writing) every week. Most people only do input → they understand but can't produce. You train all four, A1 → C1.</div>
    <div class="eng-blocks">
      <div class="eng-block">🗣 <b>Speak</b><span>Mon & Fri</span></div>
      <div class="eng-block">🎧 <b>Listen</b><span>Tue & Sat</span></div>
      <div class="eng-block">📖 <b>Read</b><span>Wed</span></div>
      <div class="eng-block">✍️ <b>Write</b><span>Thu</span></div>
    </div>
    <div class="eng-test">
      <div class="eng-test-head">📊 Check your real level (free tests)</div>
      <p class="hint">These measure mostly <b>reading & listening</b> — speaking & writing you train here. Take one, then enter your result and I'll give you the verdict: advance or keep practicing.</p>
      <div class="eng-test-links">
        ${ENGLISH_TESTS.map(tst => `<a href="${tst.url}" target="_blank" rel="noopener" class="eng-test-link"><b>${tst.name}</b><small>${tst.note}</small></a>`).join('')}
      </div>
      ${lastLevel ? `<div class="eng-last">Your last test: <b>${lastLevel}</b>${lastPct ? ` (${lastPct}%)` : ''}${lastDate ? ` · ${fmtFecha(lastDate)}` : ''}</div>` : ''}
      <button class="btn-gold" id="engLevelBtn">I took a test → enter my result</button>
    </div>
    <div class="eng-actions">
      <button class="btn-ghost" id="engTalkBtn">💬 Practice with me now</button>
      ${qIdx < ENGLISH_TRIMESTERS.length - 1
        ? `<button class="btn-ghost" id="engNextBtn">Advance a stage manually</button>`
        : '<span class="eng-final">🏆 Final stage — reaching for C1!</span>'}
    </div>`;
}

document.addEventListener('click', async (e) => {
  if (e.target.id === 'engNextBtn') {
    const pf = S.profile || {};
    const qIdx = +(pf.eng_q || 0);
    const t = ENGLISH_TRIMESTERS[qIdx];
    const ok = await confirmModal('Advance quarter',
      `Be honest with yourself: did you reach the goal — <b>"${t.goal}"</b>? Only advance if you truly can do it. If not, it's totally fine to repeat the quarter.`, false);
    if (!ok) return;
    await api('/api/profile', { body: { key: 'eng_q', value: String(qIdx + 1) } });
    await api('/api/profile', { body: { key: 'eng_q_start_' + (qIdx + 1), value: hoyLocal() } });
    celebrate({ icon: '🚀', title: 'LEVEL UP', text: `You moved to <b>${ENGLISH_TRIMESTERS[qIdx + 1].q}</b>. Your English is really growing.` });
    load();
    return;
  }
  if (e.target.id === 'engLevelBtn') {
    const pf = S.profile || {};
    const qIdx = Math.min(+(pf.eng_q || 0), ENGLISH_TRIMESTERS.length - 1);
    const cur = ENGLISH_TRIMESTERS[qIdx];
    const r = await modal({ icon: '📊', title: 'Your real test result',
      text: 'Pick the level the test gave you (and the score % if it showed one). I\'ll tell you whether to advance or keep practicing.',
      fields: [
        { type: 'select', value: pf.eng_real_level || cur.level, options: CEFR_ORDER.map(l => ({ v: l, t: l })) },
        { type: 'number', placeholder: 'Score % (optional)', min: 0, max: 100 }
      ], okText: 'Get my verdict' });
    if (r === null) return;
    const measured = r[0];
    const pct = String(r[1] || '').replace(/[^0-9]/g, '');
    await api('/api/profile', { body: { key: 'eng_real_level', value: measured } });
    await api('/api/profile', { body: { key: 'eng_real_pct', value: pct } });
    await api('/api/profile', { body: { key: 'eng_real_date', value: hoyLocal() } });
    const mOrder = CEFR_ORDER.indexOf(measured);
    const targetOrder = CEFR_ORDER.indexOf(cur.level);
    // etapa que te corresponde: la primera cuyo objetivo está por encima de tu nivel medido
    let newIdx = ENGLISH_TRIMESTERS.findIndex(s => CEFR_ORDER.indexOf(s.level) > mOrder);
    if (newIdx === -1) newIdx = ENGLISH_TRIMESTERS.length - 1;     // C1/C2: última etapa
    const pctTxt = pct ? ` (${pct}%)` : '';
    if (mOrder >= targetOrder && newIdx > qIdx) {
      await api('/api/profile', { body: { key: 'eng_q', value: String(newIdx) } });
      await api('/api/profile', { body: { key: 'eng_q_start_' + newIdx, value: hoyLocal() } });
      celebrate({ icon: '🚀', title: 'LEVEL UP',
        text: `Your test says <b>${measured}</b>${pctTxt}. You reached this stage's target — moving you to <b>${ENGLISH_TRIMESTERS[newIdx].q}</b>. Keep going! 🔥` });
    } else if (mOrder >= targetOrder) {
      await modal({ icon: '🏆', title: `Verdict: ${measured}${pctTxt}`,
        text: `You're already at the top stage. Keep consolidating <b>${cur.level}</b> across all 4 skills. Remember: a free test barely measures speaking & writing, so keep training those here every week.`,
        okText: 'Got it' });
    } else {
      await modal({ icon: '🛡', title: `Verdict: stay at ${cur.q}`,
        text: `Your test says <b>${measured}</b>${pctTxt}, and this stage aims for <b>${cur.level}</b>. Keep practicing here a little longer — you're close. Put extra focus on the skills that felt hardest in the test.`,
        okText: 'Keep practicing' });
    }
    load();
    return;
  }
  if (e.target.id === 'engTalkBtn') {
    if (typeof sendPrompt === 'function')
      sendPrompt("Let's practice English. Talk to me only in English, ask me questions about my day, and gently correct my mistakes. Start now.");
    else
      toast('💬 Open a chat and tell me: "practice English with me"');
    return;
  }
  if (e.target.id === 'engHelpBtn') {
    await modal({ icon: '🔑', title: 'The real secrets',
      text: '1) Train all 4 skills: read, write, listen, speak — a full speaker does the four.<br>2) Output (speaking AND writing) is what cements input — after every input, produce something.<br>3) Comprehensible input: read/watch what you understand ~85%, not random hard content.<br>4) Depth &gt; breadth: one text or scene 5 times beats 5 different ones once.<br>5) Shadowing &amp; reading aloud build pronunciation and rhythm.<br>6) A little EVERY day beats a marathon once a week.<br><br>Duolingo and passive Netflix feel like progress but barely build real production. The discomfort of producing IS the learning.',
      okText: 'Got it' });
    return;
  }
});

// Empareja una carrera con su meta en Goals por palabras clave compartidas.
// "Data Analytics" <-> "Learn Data analysis" coinciden por la palabra "data".
function metaDeCarrera(c) {
  const stop = new Set(['learn', 'get', 'to', 'the', 'a', 'my', 'of', 'and', 'analytics', 'analysis']);
  const norm = (s) => (s || '').toLowerCase()
    .replace(/[^a-záéíóúñ ]/g, ' ')
    .split(/\s+/).filter(w => w && !stop.has(w));
  const cKeys = new Set(norm(c.name));
  // sinónimos manuales para casos como data analytics/analysis
  const cName = (c.name || '').toLowerCase();
  if (/data|anal[íi]t|analy/.test(cName)) cKeys.add('data');
  if (/cyber|ciber|secur/.test(cName)) cKeys.add('cyber');
  if (/ingl|english/.test(cName)) cKeys.add('english');
  let best = null, bestScore = 0;
  for (const g of (S.goals || [])) {
    const gKeys = norm(g.name);
    const gName = (g.name || '').toLowerCase();
    const extra = new Set(gKeys);
    if (/data|anal[íi]t|analy/.test(gName)) extra.add('data');
    if (/cyber|ciber|secur/.test(gName)) extra.add('cyber');
    if (/ingl|english/.test(gName)) extra.add('english');
    let score = 0;
    for (const k of extra) if (cKeys.has(k)) score++;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return bestScore > 0 ? best : null;
}

function progresoCareer(c) {
  // el progreso general = lo ya "banqueado" (cursos completados en niveles previos, nunca baja)
  // o el nivel actual + el % del curso activo (lo que sea mayor). Así, empezar un curso
  // nuevo dentro del MISMO nivel resetea el % del curso, pero NUNCA el % general ya ganado.
  const porNivel = (c.step || 0) * 25 + ((c.pct || 0) / 100) * 25;
  return Math.min(Math.round(Math.max(c.bank || 0, porNivel)), 100);
}
function renderCareer() {
  const wrap = document.getElementById('careerPanel');
  if (!wrap) return;
  const careers = S.careers || [];
  const done = S.courses_done || [];
  const card = (c) => {
    const prog = progresoCareer(c);
    const esIngles = /ingl|english/i.test(c.name || '');
    const diasIng = esIngles ? diasInglesHechos() : 0;
    const dots = PELDANOS.map((p, i) =>
      `<span class="peldano ${i < c.step ? 'done' : i === c.step ? 'now' : ''}">${i < c.step ? '✓' : i + 1}. ${p}</span>`).join('');
    const myCourses = done.filter(d => d.career === c.name);
    const coursesHtml = myCourses.length
      ? `<div class="courses-done">${myCourses.map(d =>
          `<span class="course-chip">✓ ${esc(d.title)} <button class="del-x" data-type="course" data-id="${d.id}">✕</button></span>`).join('')}</div>`
      : '<p class="hint" style="margin:4px 0">No finished courses yet.</p>';
    return `<div class="career-card ${c.active ? 'career-active' : ''}">
      <div class="career-head">
        <b>${c.icon || '🎯'} ${esc(c.name)}</b>
        <span class="career-prog">${prog}% to goal</span>
      </div>
      <div class="peldano-row">${dots}</div>
      <div class="mini-bar green" style="margin:8px 0"><i style="width:${prog}%"></i></div>
      <div class="abono-form" style="margin-top:8px">
        <select data-career="${c.id}" data-f="step" style="flex:2">
          ${PELDANOS.map((p, i) => `<option value="${i}" ${i === c.step ? 'selected' : ''}>Step ${i + 1}: ${p}</option>`).join('')}
        </select>
        <input data-career="${c.id}" data-f="course" placeholder="Current course" value="${esc(c.course || '')}" style="flex:2">
        <input data-career="${c.id}" data-f="pct" type="number" min="0" max="100" value="${c.pct || 0}" placeholder="% course" style="flex:1">
      </div>
      ${(c.pct || 0) >= 100 ? `<button class="bank-btn" data-bank="${c.id}" data-step="${c.step || 0}">🏁 Course complete — bank this 25% &amp; continue</button>` : ''}
      <p class="hint" style="margin:6px 0 8px">${STEP_DESC[c.step] || ''}</p>
      ${esIngles ? `<div class="eng-auto">🔥 <b>${diasIng} days</b> of English practice logged · this bar rises on its own as you complete your daily English block (≈30 days per step). Your effort moves it, not a manual number.</div>` : ''}
      <div class="career-foot">
        ${c.active ? '<span class="active-badge">★ Active focus</span>'
          : `<button class="set-active" data-career="${c.id}">Set as focus</button>`}
        <button class="add-course" data-career="${c.id}" data-name="${esc(c.name)}">+ Finished a course</button>
        <button class="del-x" data-type="career" data-id="${c.id}" title="Delete career">✕</button>
      </div>
      <div class="career-courses"><b class="mini-title">Finished courses</b>${coursesHtml}</div>
    </div>`;
  };
  wrap.innerHTML = careers.map(card).join('') +
    `<button class="btn-gold add-career-btn" id="addCareerBtn">+ Add a career to learn</button>`;
}

function actividadesDelDia(wd, shiftKey) {
  const sh = SHIFTS[shiftKey] || SHIFTS.libre;
  const active = (S.careers || []).find(c => c.active) || (S.careers || [])[0];
  const focoLabel = active ? `${active.icon || ''} ${active.name}` : 'Study';
  const _ingPlan = INGLES_PLAN[wd] || INGLES_PLAN[0];
  const ing = _ingPlan.title;                                   // ej: "🗣 Speaking day"
  const ingDesc = _ingPlan.steps.map((st, i) => `${i + 1}) ${st.s}`).join('  ');  // pasos cortos numerados
  const studyDesc = active
    ? `${active.course || active.name} (at ${active.pct || 0}%). Advance one module + take notes.`
    : 'Advance your active course + take notes.';

  if (shiftKey === 'descanso') {
    return { rest: true, msg: 'Rest Sunday 🌿', acts: [
      { t: '9:00', title: 'Wake up without an alarm', d: 'Rest for real. The body also trains by resting.', key: 'wake' },
      { t: '10:00', title: 'Skincare + something tasty', d: 'Take care of your skin, no rush.', key: 'skincare' },
      { t: 'Free', title: 'Light reading or anime', d: 'One book chapter or one episode. Enjoy guilt-free.', key: 'leer' },
      { t: 'Night', title: 'Plan the week', d: 'Check your schedule and adjust your shifts in this tab.', key: 'plan' }
    ]};
  }

  const acts = [];
  const esSabado = (shiftKey === 'sabado' || shiftKey === 'sabado11');
  if (!esSabado) {   // ejercicio matutino solo lunes a viernes (sábado y domingo son descanso de gym)
    acts.push({ t: '6:00', title: 'Abs + jump rope', d: '4 min abs + ~10 min jump rope (increase over time). Wake up the body. ⚡', key: 'ejercicio' });
  }
  acts.push({ t: '6:20', title: '💧 Water + gratitude', d: 'A big glass of water on waking, and name one thing you\'re grateful for. Tiny ritual, big day. 🙏', key: 'morning' });

  if (sh.work) {
    const [ini, fin] = sh.work;
    if (ini >= 9) {
      acts.push({ t: `6:40`, title: `English — ${ing}`, d: ingDesc, key: 'ingles' });
      if (ini >= 12) acts.push({ t: '8:30', title: `Study: ${focoLabel}`, d: studyDesc, key: 'estudio' });
    }
    acts.push({ t: `${ini}:00`, title: '💼 WORK (locked)', d: 'Work only — Softtek courses, or advance Coursera in free moments.', work: true, key: 'work' });
    let h = fin + 1;
    if (ini < 9) { acts.push({ t: `${h}:00`, title: `English — ${ing}`, d: ingDesc, key: 'ingles' }); h += 1; }
    acts.push({ t: `${h}:00`, title: `Study: ${focoLabel}`, d: studyDesc, key: 'estudio' }); h += 1;
    acts.push({ t: `${h}:00`, title: 'Gym 🏋️', d: 'Your iron hour. Don\'t negotiate it.', key: 'gym' }); h += 1;
    acts.push({ t: `${h}:30`, title: '📖 Read', d: 'Your pages for today. Advance the book you\'re reading. 📖', key: 'leer' });
    acts.push({ t: `${h}:45`, title: '🧴 Skincare PM', d: 'Night routine: cleanse, niacinamide serum, moisturizer. Close the day clean. 🧴', key: 'skincare' });
    acts.push({ t: 'Sleep', title: 'Off to bed', d: 'Sleeping well is a habit on your list. Protect it like a payment.', key: 'dormir' });
  } else if (shiftKey === 'sabado' || shiftKey === 'sabado11') {
    acts.push({ t: '8:00', title: `English — ${ing}`, d: ingDesc, key: 'ingles' });
    const [si] = sh.work || [10, 18];
    acts.push({ t: `${si}:00`, title: '💼 WORK Saturday (locked)', d: 'Saturday shift. Take the rest of the day easy.', work: true, key: 'work' });
    acts.push({ t: 'Night', title: '📖 Read', d: 'Calm close — advance your book.', key: 'leer' });
    acts.push({ t: 'Night', title: '🧴 Skincare PM', d: 'Night routine: cleanse + serum + moisturizer.', key: 'skincare' });
  } else {
    acts.push({ t: '6:40', title: `English — ${ing}`, d: ingDesc, key: 'ingles' });
    acts.push({ t: '8:00', title: `DEEP study: ${focoLabel}`, d: studyDesc + ' Take advantage: day off = long project session.', key: 'estudio' });
    acts.push({ t: '11:00', title: 'Gym 🏋️', d: 'Train calmly, you have time.', key: 'gym' });
    acts.push({ t: 'Afternoon', title: 'Project / portfolio', d: 'Advance your project or a practice room.', key: 'proyecto' });
    acts.push({ t: 'Night', title: '📖 Read', d: 'Advance your book. Close the day.', key: 'leer' });
    acts.push({ t: 'Night', title: '🧴 Skincare PM', d: 'Night routine: cleanse + serum + moisturizer.', key: 'skincare' });
  }
  return { rest: false, acts };
}

function bloqueEstudio(pf) {
  const active = (S.careers || []).find(c => c.active);
  return active ? `${active.course || active.name} (${active.pct || 0}%). Advance one module + take notes.`
    : 'Advance your active course + take notes.';
}

let CUR_WD = 0;
let _routineBusy = false;   // seguro: evita procesar dos veces el mismo toque en la rutina
// Convierte una etiqueta de hora a un número ordenable (minutos desde medianoche).
// "6:00"->360, "14:00"->840, "8:30"->510. Textos sin hora van al final en orden lógico.
function horaOrden(t) {
  const m = String(t).match(/^(\d{1,2}):?(\d{2})?/);
  if (m) return (+m[1]) * 60 + (+(m[2] || 0));
  const orden = { 'Morning': 7 * 60, 'Afternoon': 15 * 60, 'Tarde': 15 * 60,
    'Evening': 19 * 60, 'Night': 21 * 60, 'Noche': 21 * 60, 'Free': 22 * 60,
    'Sleep': 23 * 60, 'Dormir': 23 * 60 };
  return orden[t] != null ? orden[t] : 23 * 60 + 30;   // desconocidos, casi al final
}
// ---- Overrides de hora de actividades (solo hoy / esta semana / permanente) ----
function getTimeOv() { try { return JSON.parse((S.profile || {}).time_overrides || '{}'); } catch { return {}; } }
async function saveTimeOv(o) { await api('/api/profile', { body: { key: 'time_overrides', value: JSON.stringify(o) } }); }
function weekKeyOf(iso) {                       // id de semana = fecha del lunes de esa semana
  const d = new Date(iso + 'T00:00:00');
  const lun = (d.getDay() + 6) % 7;            // 0 = lunes
  d.setDate(d.getDate() - lun);
  return localISO(d);
}
function effTime(key, iso, def) {              // hora efectiva según overrides (día > semana > permanente > default)
  const o = getTimeOv();
  const dk = `${iso}|${key}`;
  if (o.day && o.day[dk] != null) return o.day[dk];
  const wk = weekKeyOf(iso);
  if (o.week && o.week[wk] && o.week[wk][key] != null) return o.week[wk][key];
  if (o.perm && o.perm[key] != null) return o.perm[key];
  return def;
}

function renderRoutineDay() {
  const val = $('#dayPick').value;
  if (!val) return;
  const [iso, wdStr] = val.split('|');
  const wd = +wdStr;
  CUR_WD = wd;
  const shiftKey = (S.shifts || {})[wd] || 'libre';
  const { rest, acts, msg } = actividadesDelDia(wd, shiftKey);
  // ocultar principales: por fecha exacta (puntual) o por weekday (recurrente)
  const hiddenWeek = new Set(S.routine_hidden || []);
  const hiddenDay = new Set(S.routine_hidden_day || []);
  let lista = acts.filter(a => !hiddenWeek.has(`${wd}|${a.key}`) && !hiddenDay.has(`${iso}|${a.key}`));
  // extras: por fecha exacta (day == iso), por weekday, o globales (weekday -1 y sin day)
  // Las Mon-Fri (-2) NO aparecen en día de descanso (respeta tu descanso).
  const esDescanso = (shiftKey === 'descanso');
  const extras = (S.routine_extra || []).filter(x =>
    (x.day && x.day === iso) ||
    (!x.day && (x.weekday === -1 ||
                (x.weekday === -2 && wd <= 4 && !esDescanso) ||
                x.weekday === wd)));
  for (const x of extras) {
    lista.push({ t: x.time || '—', title: x.title, d: x.descr || '', key: 'extra_' + x.id, extraId: x.id });
  }
  // RECORDATORIOS POR FECHA (definidos en código, recurren todos los meses)
  const [yy, mm, dd] = iso.split('-').map(Number);
  const lastDay = new Date(yy, mm, 0).getDate();   // último día del mes
  // 💈 Haircut: día 15 y fin de mes (30, o el último si el mes es más corto). Desde julio 2026.
  if (iso >= '2026-07-01' && (dd === 15 || dd === 30 || (lastDay < 30 && dd === lastDay))
      && !hiddenDay.has(`${iso}|haircut`)) {
    lista.push({ t: '14:00', title: '💈 Get a haircut', d: 'Reminder — every 2 weeks (15th & end of month).', key: 'haircut' });
  }
  // 🧺 Laundry: cada 9 días desde el 23 de junio 2026 (hoy)
  const diffDays = Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(2026, 5, 23)) / 86400000);
  if (diffDays >= 0 && diffDays % 9 === 0 && !hiddenDay.has(`${iso}|laundry`)) {
    lista.push({ t: '09:00', title: '🧺 Do the laundry', d: 'Reminder — every 9 days.', key: 'laundry' });
  }
  // 📏 Gym measurements: cada 7 días (semanal) desde tu fecha de inicio en el módulo Gym
  try {
    const gymData = JSON.parse((S.profile || {}).gym_data || '{}');
    const startG = gymData.start || (gymData.baseline && gymData.baseline.date);
    if (startG) {
      const [sy, sm, sd] = startG.split('-').map(Number);
      const diffG = Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(sy, sm - 1, sd)) / 86400000);
      if (diffG >= 0 && diffG % 7 === 0 && !hiddenDay.has(`${iso}|gymmeasure`)) {
        lista.push({ t: '08:00', title: '📏 Take your measurements', d: 'Weekly check-in — weight, waist, chest, arm, hip, thigh. Same time, same conditions as always. Log it in Gym → + Log this week.', key: 'gymmeasure' });
      }
    }
  } catch { /* sin datos de gym aún: no mostrar el recordatorio */ }
  // aplicar overrides de hora (la lista se reordena sola con la nueva hora)
  lista.forEach(a => { a.t = effTime(a.key, iso, a.t); });
  // ORDENAR TODO por hora real (los textos como Sleep/Afternoon/Night van al final en orden lógico)
  lista.sort((a, b) => horaOrden(a.t) - horaOrden(b.t));
  const done = new Set(S.rdone || []);
  let html = '';
  if (rest && msg) html += `<div class="rest-day"><div class="big">🌿</div><p>${msg}</p></div>`;
  html += lista.map(a => {
    const isDone = done.has(`${iso}|${a.key}`);
    // botón borrar: las extra se borran de la BD; las principales se ocultan para ese día
    const delBtn = a.extraId
      ? `<button class="del-x" data-type="routine_extra" data-id="${a.extraId}" title="Remove">✕</button>`
      : `<button class="hide-main" data-wd="${wd}" data-day="${iso}" data-key="${a.key}" title="Remove / replace">✕</button>`;
    return `<div class="routine-block ${a.work ? 'work' : ''} ${isDone ? 'done' : ''}">
      <span class="rb-time">${a.t}</span>
      <div class="rb-body"><div class="rb-title">${a.title} <button class="edit-time" data-key="${a.key}" data-day="${iso}" data-cur="${a.t}" title="Edit time">⏰</button> ${delBtn}</div><div class="rb-desc">${a.d}</div></div>
      <button class="rb-check ${isDone ? 'on' : ''}" data-day="${iso}" data-act="${a.key}">${isDone ? '✓' : ''}</button>
    </div>`;
  }).join('');
  $('#routineDay').innerHTML = html;

  // INTELIGENCIA: ¿dónde hay hueco para algo nuevo?
  const hint = $('#freeTimeHint');
  if (hint) {
    const sh = SHIFTS[shiftKey];
    if (!sh || !sh.work) {
      hint.innerHTML = '💡 This is a light/free day — you have plenty of room. Add anything you like.';
    } else {
      const [ini, fin] = sh.work;
      const huecos = [];
      if (ini >= 8) huecos.push(`early morning before work (around 6:00–${ini}:00)`);
      huecos.push(`evening after work (from ${fin + 1}:00 on)`);
      hint.innerHTML = `💡 Your free windows today: <b>${huecos.join('</b> and <b>')}</b>. Best time to add something new.`;
    }
  }
}

// listeners de Life
document.addEventListener('change', async (e) => {
  if (e.target.matches('#shiftGrid select')) {
    await api('/api/shift', { body: { weekday: +e.target.dataset.wd, shift: e.target.value } });
    toast('📅 Shift updated.');
    load();
  } else if (e.target.matches('[data-career]')) {
    await api('/api/career', { body: { id: +e.target.dataset.career, field: e.target.dataset.f, value: e.target.value } });
    load();
  }
});
// Carreras: set active, add career, add course
document.addEventListener('click', async (e) => {
  const setA = e.target.closest('.set-active');
  if (setA && setA.dataset.career) { await api('/api/career', { body: { id: +setA.dataset.career, field: 'active', value: 1 } }); toast('★ Focus updated'); load(); return; }

  if (e.target.id === 'addCareerBtn') {
    const r = await modal({ icon: '🚀', title: 'Add a career',
      text: 'What do you want to learn? (e.g. Web Development)',
      fields: [
        { type: 'text', placeholder: 'Career name' },
        { type: 'text', placeholder: 'Emoji (optional, e.g. 💻)', value: '🎯' }
      ], okText: 'Add career' });
    if (!r || !r[0].trim()) return;
    const careerName = r[0].trim();
    const icon = r[1] || '🎯';
    // ¿meta nueva o conectar a una existente?
    const goalOpts = [
      { v: '__new__', t: '✨ Create a NEW goal for this' },
      { v: '__none__', t: '— Don\'t link to any goal' }
    ].concat((S.goals || []).map(g => ({ v: String(g.id), t: '🎯 ' + g.name })));
    const g = await modal({ icon: '🎯', title: 'Link to a goal',
      text: `Is <b>${careerName}</b> a new goal, or does it connect to a goal you already have? Its progress will sync automatically.`,
      fields: [{ type: 'select', options: goalOpts }], okText: 'Continue' });
    if (g === null) return;
    const choice = g[0];
    const newCareer = await api('/api/career/new', { body: { name: careerName, icon } });
    const careerId = newCareer.id;
    if (choice === '__new__') {
      // crear la meta en Goals Y guardar el enlace explícito (career.goal_id) para que sincronice siempre
      const newGoal = await api('/api/goal/new', { body: { name: 'Learn ' + careerName } });
      if (careerId && newGoal.id) await api('/api/career', { body: { id: careerId, field: 'goal_id', value: newGoal.id } });
      toast('🚀 Career + goal created and linked');
    } else if (choice === '__none__') {
      toast('🚀 Career added (no goal linked)');
    } else {
      // meta existente elegida: guardar el enlace explícito (antes no se guardaba nada)
      if (careerId) await api('/api/career', { body: { id: careerId, field: 'goal_id', value: +choice } });
      toast('🚀 Career added, linked to your goal');
    }
    load();
    return;
  }

  const bankBtn = e.target.closest('[data-bank]');
  if (bankBtn) {
    const id = +bankBtn.dataset.bank;
    const c = (S.careers || []).find(x => x.id === id);
    if (!c) return;
    const stepName = PELDANOS[c.step || 0];
    // 1) registrar el curso terminado en el historial (si tiene nombre)
    if ((c.course || '').trim()) {
      await api('/api/course/done', { body: { career: c.name, title: c.course.trim() } });
    }
    // 2) banquear el 25% de este nivel (nunca baja, aunque el próximo curso empiece en 0%)
    const newBank = Math.min(100, ((c.step || 0) + 1) * 25);
    await api('/api/career', { body: { id, field: 'bank', value: newBank } });
    // 3) preguntar si continúa en el mismo nivel o avanza al siguiente (con botones Sí/No claros)
    const isLast = (c.step || 0) >= PELDANOS.length - 1;
    const nextName = isLast ? null : PELDANOS[(c.step || 0) + 1];
    const cont = await modal({ icon: '🎓', title: `Continue in ${stepName}?`,
      text: `You banked <b>${newBank}%</b> overall.<br><br>Do you want to keep studying more <b>${stepName}</b> courses, or move on to ${isLast ? 'finish here' : '<b>' + nextName + '</b>'}?`,
      okText: `Yes, more ${stepName}`,
      cancelText: isLast ? 'No, I\'m done' : `No, go to ${nextName}` }) === true;
    if (cont) {
      const r = await modal({ icon: '🎓', title: `Next course in ${stepName}`,
        fields: [{ type: 'text', placeholder: 'Course name' }], okText: 'Start course' });
      if (r && r[0].trim()) {
        await api('/api/career', { body: { id, field: 'course', value: r[0].trim() } });
        await api('/api/career', { body: { id, field: 'pct', value: 0 } });
      }
    } else if (!isLast) {
      await api('/api/career', { body: { id, field: 'step', value: (c.step || 0) + 1 } });
      await api('/api/career', { body: { id, field: 'course', value: '' } });
      await api('/api/career', { body: { id, field: 'pct', value: 0 } });
      toast(`🚀 Onward to ${PELDANOS[(c.step || 0) + 1]}!`);
    } else {
      toast('🎉 100%! You completed the whole career path!');
    }
    load();
    return;
  }

  const addC = e.target.closest('.add-course');
  if (addC) {
    const r = await modal({ icon: '🎓', title: 'Finished a course',
      text: `Add a finished course to <b>${addC.dataset.name}</b>. This is your record of what you complete.`,
      fields: [{ type: 'text', placeholder: 'Course name' }], okText: 'Save course' });
    if (!r || !r[0].trim()) return;
    await api('/api/course/done', { body: { career: addC.dataset.name, title: r[0] } });
    toast('🎓 Course logged!');
    load();
    return;
  }

  const etBtn = e.target.closest('.edit-time');
  if (etBtn) {
    const key = etBtn.dataset.key, iso = etBtn.dataset.day, cur = etBtn.dataset.cur;
    const r = await modal({ icon: '⏰', title: 'Edit time',
      text: 'Set a new time (24h format, e.g. 18:30). The activity moves and re-sorts itself.',
      fields: [
        { type: 'text', label: 'New time', value: cur, placeholder: 'HH:MM' },
        { type: 'select', label: 'Apply to', options: [
          { v: 'day', t: 'Only today' },
          { v: 'week', t: 'This week' },
          { v: 'perm', t: 'Permanently' }
        ] }
      ], okText: 'Save time' });
    if (!r) return;
    let nt = String(r[0] || '').trim();
    if (!nt) { toast('Type a time, e.g. 18:30'); return; }
    if (/^\d{1,2}$/.test(nt)) nt = nt.padStart(2, '0') + ':00';      // "18" -> "18:00"
    const scope = r[1] || 'day';
    const o = getTimeOv();
    if (scope === 'day') { o.day = o.day || {}; o.day[`${iso}|${key}`] = nt; }
    else if (scope === 'week') { const wk = weekKeyOf(iso); o.week = o.week || {}; o.week[wk] = o.week[wk] || {}; o.week[wk][key] = nt; }
    else { o.perm = o.perm || {}; o.perm[key] = nt; }
    await saveTimeOv(o);
    toast(scope === 'day' ? '⏰ Updated for today' : scope === 'week' ? '⏰ Updated for this week' : '⏰ Updated permanently');
    load();
    return;
  }

  const hideBtn = e.target.closest('.hide-main');
  if (hideBtn) {
    const wd = +hideBtn.dataset.wd, key = hideBtn.dataset.key, iso = hideBtn.dataset.day;
    const dayName = DIAS[wd];
    const r = await modal({ icon: '✏️', title: 'Remove or replace',
      text: `Remove this activity. Replace it? Type the new one (optional). Choose the scope below.`,
      fields: [
        { type: 'text', placeholder: 'New activity (optional)' },
        { type: 'text', placeholder: 'Time (e.g. 14:00, optional)' },
        { type: 'select', options: [
          { v: 'day', t: `Just this ${dayName} (${iso})` },
          { v: 'week', t: `Every ${dayName} (recurring)` },
          { v: 'mf', t: 'Monday to Friday (weekdays)' }
        ] }
      ], okText: 'Apply' });
    if (r === null) return;
    const scope = r[2] || 'day';
    // ocultar: si es mon-fri, ocultar en los 5 días laborales; si week, ese weekday; si no, solo el día
    if (scope === 'mf') {
      for (let d = 0; d <= 4; d++) await api('/api/routine_hide', { body: { akey: key, scope: 'week', weekday: d, day: iso } });
    } else {
      await api('/api/routine_hide', { body: { akey: key, scope, weekday: wd, day: iso } });
    }
    if (r[0] && r[0].trim()) {
      const body = { time: r[1] || '', title: r[0], descr: '' };
      if (scope === 'week') body.weekday = wd;
      else if (scope === 'mf') body.weekday = -2;
      else body.day = iso;
      await api('/api/routine_extra/new', { body });
      toast('✏️ Activity replaced');
    } else {
      toast(scope === 'week' ? `✕ Removed every ${dayName}` : scope === 'mf' ? '✕ Removed Monday to Friday' : '✕ Removed for this day only');
    }
    load();
    return;
  }

  if (e.target.id === 'scheduleApptBtn') {
    // 1) elegir la fecha (cualquier día: este mes, en 2 meses, lo que sea)
    const today = hoyLocal();
    const rf = await modal({ icon: '📅', title: 'Pick a date',
      text: 'Choose the day of your appointment, course or event. Your companion will remind you 3 days before, counting down to the day.',
      fields: [{ type: 'date', label: 'Date', value: '', min: today }],
      okText: 'Next' });
    if (!rf || !rf[0]) return;
    const fecha = rf[0];                 // 'YYYY-MM-DD'
    // 2) el MISMO modal de actividad, ya atado a esa fecha
    const habitOpts = [{ v: '', t: '— None' }]
      .concat((S.habits || []).map(h => ({ v: h.name, t: '🔥 ' + h.name })));
    const r = await modal({ icon: '🗓️', title: 'Schedule for ' + fmtFecha(fecha),
      text: "Add your appointment / course / event. You'll get reminders 3, 2 and 1 days before, and on the day.",
      fields: [
        { type: 'text', placeholder: 'Time (e.g. 15:00)' },
        { type: 'text', placeholder: 'Appointment / course name' },
        { type: 'text', placeholder: 'Short note (optional)' },
        { type: 'select', options: habitOpts }
      ], okText: 'Schedule it' });
    if (!r || !r[1].trim()) return;
    await api('/api/routine_extra/new', { body: {
      time: r[0], title: r[1], descr: r[2], habit: r[3] || '',
      day: fecha, scheduled: 1 } });
    toast('📅 Scheduled for ' + fmtFecha(fecha));
    load();
    return;
  }

  if (e.target.id === 'addRoutineBtn') {
    const sh = SHIFTS[(S.shifts || {})[CUR_WD] || 'libre'];
    const sugerencia = (!sh || !sh.work) ? 'Free day — any time works'
      : `Free after ${sh.work[1] + 1}:00`;
    const iso = ($('#dayPick').value || '').split('|')[0];
    const dayName = DIAS[CUR_WD];
    const habitOpts = [{ v: '', t: '— Free (no habit)' }]
      .concat((S.habits || []).map(h => ({ v: h.name, t: '🔥 ' + h.name })));
    const r = await modal({ icon: '➕', title: 'Add activity',
      text: `Add something. ${sugerencia}. Pick which habit it counts for (or Free), and the scope.`,
      fields: [
        { type: 'text', placeholder: 'Time (e.g. 20:00)' },
        { type: 'text', placeholder: 'Activity name' },
        { type: 'text', placeholder: 'Short note (optional)' },
        { type: 'select', options: habitOpts },
        { type: 'select', options: [
          { v: 'day', t: `Just this ${dayName} (${iso})` },
          { v: 'week', t: `Every ${dayName} (recurring)` },
          { v: 'mf', t: 'Monday to Friday (weekdays)' }
        ] }
      ], okText: 'Add' });
    if (!r || !r[1].trim()) return;
    const body = { time: r[0], title: r[1], descr: r[2], habit: r[3] || '' };
    const scopeAdd = r[4] || 'day';
    if (scopeAdd === 'week') body.weekday = CUR_WD;
    else if (scopeAdd === 'mf') body.weekday = -2;
    else body.day = iso;
    await api('/api/routine_extra/new', { body });
    toast(scopeAdd === 'week' ? `➕ Added every ${dayName}` : scopeAdd === 'mf' ? '➕ Added Monday to Friday' : '➕ Added for this day only');
    load();
    return;
  }

  const c = e.target.closest('.rb-check');
  if (!c) return;
  if (_routineBusy) return;                 // evita doble disparo del mismo toque (móvil)
  _routineBusy = true;
  try {
  const day = c.dataset.day, act = c.dataset.act;
  const marcando = !c.classList.contains('on');

  if (marcando) {
    // CASO ESPECIAL inglés: confirma los pasos del día EN ORDEN, guardando cada "sí".
    // Si dices "Not yet", el progreso queda guardado y la próxima vez RETOMA en ese paso.
    // La casilla solo se chulea completa cuando TODOS los pasos están confirmados.
    if (act === 'ingles') {
      const { titulo, pasos } = pasosInglesDelDia(CUR_WD);
      const hechos = new Set(S.rdone || []);
      for (let k = 0; k < pasos.length; k++) {
        if (hechos.has(`${day}|ingles#${k}`)) continue;     // paso ya confirmado antes: saltar
        const ultimo = k === pasos.length - 1;
        const r = await modal({ icon: '🗣', title: `${titulo} · step ${k + 1} of ${pasos.length}`,
          text: `<b>${k + 1}) ${pasos[k].s}</b><br><br><span style="color:var(--mut);font-size:.82rem">HOW TO DO IT WELL</span><br>${pasos[k].how}`,
          okText: ultimo ? 'Yes ✓ — finish English' : 'Yes ✓ — next step', extraBtn: 'Not yet' });
        if (r !== true) {                                   // "Not yet"/Cancel: guarda hasta aquí y sale
          toast('Progress saved 💪 — next time you continue from this step.');
          load();
          return;
        }
        await api('/api/routine', { body: { day, activity: `ingles#${k}` } });   // persiste el paso
      }
      // todos los pasos confirmados → abajo se marca el inglés completo
    }
    // CASO ESPECIAL estudio/curso: al chulear, pregunta el % del curso y lo lleva solo a la carrera activa.
    if (act === 'estudio') {
      const active = (S.careers || []).find(x => x.active) || (S.careers || [])[0];
      if (active) {
        const r = await modal({ icon: active.icon || '📊', title: `${active.icon || ''} ${active.name}`.trim(),
          text: `Nice session. What % is <b>${esc(active.course || active.name)}</b> at now?`,
          fields: [{ type: 'number', placeholder: '0–100', value: active.pct || 0, min: 0, max: 100 }],
          okText: 'Save & check ✓' });
        if (r === null) return;               // canceló: no marca
        const nv = Math.max(0, Math.min(100, parseInt(String(r[0]).replace(/[^0-9]/g, ''), 10) || 0));
        await api('/api/career', { body: { id: active.id, field: 'pct', value: nv } });
        toast(`📈 ${active.name} updated to ${nv}%. It flows to your goal automatically.`);
      }
    }
    // CASO ESPECIAL leer/Read: pregunta en qué página vas de los libros en "reading"
    // (igual que el curso pregunta el %). Actualiza el "On page" solo, sin escribirlo a mano.
    if (act === 'leer') {
      const leyendo = (S.books || []).filter(b => b.status === 'Leyendo' || b.status === 'Reading');
      if (leyendo.length) {
        const r = await modal({ icon: '📖', title: 'Reading progress',
          text: 'What page are you on now? Leave a book blank if you didn\'t read it today.',
          fields: leyendo.map(b => ({ type: 'number', min: 0,
            label: `${esc(b.title)}${b.pages ? ` (of ${b.pages})` : ''}`,
            placeholder: 'page', value: b.current || '' })),
          okText: 'Save & check ✓' });
        if (r === null) return;                 // canceló: no marca
        for (let k = 0; k < leyendo.length; k++) {
          const raw = String(r[k] ?? '').trim();
          if (raw === '') continue;             // ese libro no se tocó
          const val = Math.max(0, parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0);
          await api('/api/book', { body: { id: leyendo[k].id, field: 'current', value: val } });
          if (leyendo[k].pages && val >= leyendo[k].pages)   // llegó al final -> Terminado
            await api('/api/book', { body: { id: leyendo[k].id, field: 'status', value: 'Terminado' } });
        }
        toast('📖 Reading progress saved');
      }
    }
    await api('/api/routine', { body: { day, activity: act } });
    if (act !== 'estudio' && act !== 'leer') toast('✓ Done! One more step toward your goals.');
    // marcar el hábito sinónimo en Habits
    await sincronizarHabito(act, day, true);
  } else {
    const why = await modal({ icon: '🤔', title: 'Uncheck?',
      text: "Didn't get to do this? That's okay, life happens. You can note why.",
      fields: [{ type: 'text', placeholder: 'e.g. doctor appointment, plans... (optional)' }], okText: 'Uncheck' });
    if (why === null) return;
    await api('/api/routine', { body: { day, activity: act, note: why[0] || '' } });
    // al desmarcar inglés, borra los pasos guardados para que la próxima vez empiece de cero
    if (act === 'ingles') {
      for (const x of (S.rdone || []).filter(s => s.startsWith(`${day}|ingles#`))) {
        await api('/api/routine', { body: { day, activity: x.split('|')[1] } });  // toggle = borrar
      }
    }
    // al desmarcar, revisar si el hábito sinónimo debe desmarcarse
    await sincronizarHabito(act, day, false);
  }
  load();
  } finally {
    _routineBusy = false;
  }
});

// Marca/desmarca el hábito en Habits según una actividad de Life.
// Respeta sinónimos: Exercise se marca si ejercicio O gym; se desmarca solo si NINGUNA queda hecha.
function habitosDeActividad(act) {
  // actividad fija (mapa, array) o actividad extra (su hábito guardado en routine_extra)
  if (ACT_TO_HABIT[act]) return [].concat(ACT_TO_HABIT[act]);
  if (act && act.startsWith('extra_')) {
    const id = +act.slice(6);
    const ex = (S.routine_extra || []).find(x => x.id === id);
    return ex && ex.habit ? [ex.habit] : [];
  }
  return [];
}
async function sincronizarHabito(act, day, marcado) {
  const habitNames = habitosDeActividad(act);
  if (!habitNames.length) return;   // actividad libre, no afecta hábitos
  // hechas hoy según rdone (S aún no incluye el cambio recién hecho), + el cambio actual
  const hechasHoy = new Set((S.rdone || []).filter(x => x.startsWith(day + '|')).map(x => x.split('|')[1]));
  if (marcado) hechasHoy.add(act); else hechasHoy.delete(act);
  for (const habitName of habitNames) {
    const habit = (S.habits || []).find(h => h.name === habitName);
    if (!habit) continue;
    // sinónimos: TODAS las actividades cuyo mapeo incluye este hábito (fijas + extras)
    const sinonimos = Object.keys(ACT_TO_HABIT).filter(k => [].concat(ACT_TO_HABIT[k]).includes(habitName));
    for (const ex of (S.routine_extra || [])) {
      if (ex.habit === habitName) sinonimos.push('extra_' + ex.id);
    }
    const algunaHecha = sinonimos.some(s => hechasHoy.has(s));
    const marcadoActual = (S.marks || []).includes(`${habit.id}|${day}`);
    if (algunaHecha && !marcadoActual) await api('/api/habit', { body: { habit_id: habit.id, day } });
    else if (!algunaHecha && marcadoActual) await api('/api/habit', { body: { habit_id: habit.id, day } });
  }
}

// Rediferir cuotas (reschedule)
document.addEventListener('click', async (e) => {
  const ab = e.target.closest('.cuota-btn[data-act="abonar"]');
  if (ab) {
    const rtype = ab.dataset.rtype, id = +ab.dataset.id;
    let nombre, saldo, endpoint;
    if (rtype === 'compra') {
      const c = (S.compras || []).find(x => x.id === id); if (!c) return;
      const cuota = Math.round(c.valor / c.cuotas);
      nombre = c.concepto; saldo = cuota * c.cuotas - (c.abonado || 0); endpoint = '/api/compra/abonar';
    } else if (rtype === 'extra_debt') {
      const d = (S.extra_debts || []).find(x => x.id === id); if (!d) return;
      nombre = d.name; saldo = (d.total || 0) - (d.abonado || 0); endpoint = '/api/extra_debt/abonar';
    } else if (rtype === 'detalle') {
      let found = null;
      for (const items of Object.values(S.detalle || {})) { const m = items.find(it => it[5] === id); if (m) { found = m; break; } }
      if (!found) return;
      const cuota = found[1], restantes = (found[3] || 0) - (found[2] || 0);
      const abonadoFijo = found[6] || 0;               // capital ya abonado (no se ignora)
      nombre = found[0]; saldo = Math.max(cuota * restantes - abonadoFijo, 0); endpoint = '/api/detalle/abonar';
    } else return;
    if (!(saldo > 0)) { toast('This line is already paid off.'); return; }
    // valor de UNA cuota (para el botón "Pagar cuota actual")
    let cuotaActual = 0;
    if (rtype === 'detalle') { const f = found; cuotaActual = Math.min(f[1] || 0, saldo); }
    else if (rtype === 'compra') { const cc = (S.compras||[]).find(x=>x.id===id); cuotaActual = cc ? Math.min(Math.round(cc.valor/cc.cuotas), saldo) : 0; }
    else if (rtype === 'extra_debt') { const dd = (S.extra_debts||[]).find(x=>x.id===id); cuotaActual = dd ? Math.min(dd.cuota||0, saldo) : 0; }
    const r = await modal({ icon: '💵', title: 'Pay this installment',
      text: `<b>${esc(nombre)}</b> · balance ${fmt(saldo)}.<br><br>Pay the current installment (${fmt(cuotaActual)}) to lower the balance, hit the boss and log it — or type another amount for a bigger prepayment. (The monthly check in Home stays manual.)`,
      fields: [{ type: 'money', placeholder: `Amount (max ${fmt(saldo)})`, value: '' }],
      okText: 'Pay amount typed',
      extraBtn: cuotaActual > 0 ? `Pay current installment ${fmt(cuotaActual)}` : `Pay full ${fmt(saldo)}` });
    if (r === null) return;
    let monto;
    if (r === 'EXTRA') monto = cuotaActual > 0 ? cuotaActual : saldo;   // botón = pagar cuota actual
    else { monto = +String(r[0] || '').replace(/[^0-9]/g, '') || 0; }
    if (monto <= 0) { toast('Enter an amount greater than 0, or tap “Pay current installment”.'); return; }
    monto = Math.min(monto, saldo);
    const resp = await api(endpoint, { body: { id, monto } });
    const cuotasPag = (resp && resp.cuotas_pagadas) || 0;
    if (monto >= saldo) toast('✅ Fully paid — this debt is gone.');
    else if (cuotasPag >= 1) toast(`✓ Installment paid! ${fmt(monto)} hit the boss. Balance now ${fmt(saldo - monto)}.`);
    else toast(`💵 Paid ${fmt(monto)} to capital — balance now ${fmt(saldo - monto)}.`);
    load();
    return;
  }
  // Pago de préstamo de SALDO FIJO (Estiven, Jean Karlo, etc.): total o parcial
  const fijo = e.target.closest('.fijo-pay-btn');
  if (fijo) {
    const id = +fijo.dataset.id;
    const saldo = +fijo.dataset.saldo || 0;
    let nombre = 'This loan';
    for (const items of Object.values(S.detalle || {})) { const m = items.find(it => it[5] === id); if (m) { nombre = m[0]; break; } }
    const r = await modal({ icon: '💵', title: 'Pay this loan',
      text: `<b>${esc(nombre)}</b> · balance ${fmt(saldo)}.<br><br>Pay the full balance, or enter a partial amount. When it reaches 0 it disappears from the breakdown (kept in history).`,
      fields: [{ type: 'money', placeholder: `Amount (blank = full ${fmt(saldo)})`, value: '' }],
      okText: 'Pay', extraBtn: `Pay full ${fmt(saldo)}` });
    if (r === null) return;
    if (r === 'EXTRA') {
      await api('/api/detalle/abonar_fijo', { body: { id, full: true } });
      toast('✅ Loan paid in full — moved to history.');
    } else {
      const monto = +r[0] || 0;
      if (!monto || monto <= 0) { toast('Enter an amount greater than 0, or use “Pay full”.'); return; }
      const full = monto >= saldo;
      await api('/api/detalle/abonar_fijo', { body: { id, monto } });
      toast(full ? '✅ Loan paid in full — moved to history.' : `💵 Paid ${fmt(monto)} — balance reduced.`);
    }
    load();
    return;
  }
  const btn = e.target.closest('.redefer-btn');
  if (!btn) return;
  const tipo = btn.dataset.type;
  // calcular cuántas cuotas ya se pagaron, según el tipo
  let pagadas = 0, actualesTxt = '';
  if (tipo === 'compra') {
    const c = (S.compras || []).find(x => x.id === +btn.dataset.id);
    if (c) { pagadas = Math.max(0, Math.min(MES - c.start, c.cuotas)); actualesTxt = `${c.cuotas} installments`; }
  } else if (tipo === 'extra_debt') {
    const d = (S.extra_debts || []).find(x => x.id === +btn.dataset.id);
    if (d) { pagadas = Math.max(0, Math.min(MES - d.start, d.cuotas)); actualesTxt = `${d.cuotas} installments`; }
  } else if (tipo === 'creditor') {
    actualesTxt = 'this debt';
  } else if (tipo === 'detalle') {
    actualesTxt = `${btn.dataset.cuotas} installments`;
  }
  const r = await modal({ icon: '🔄', title: 'Reschedule / fix installments',
    text: `Reschedule <b>${actualesTxt}</b>. Type the number of installments you want. I split what you still owe into that many, starting the month you pick.<br><br>If the amount is <b>wrong</b>, type the <b>correct total</b> below and I'll use that instead.`,
    fields: [
      { type: 'number', placeholder: 'Number of installments (e.g. 12)', min: 1, max: 60 },
      { type: 'select', value: String(MES), options: S.plan.months.map((m, i) => ({ v: String(i), t: 'Start: ' + m })) },
      { type: 'money', placeholder: 'Correct total amount (optional)' }
    ], okText: 'Apply' });
  if (!r || !r[0]) return;
  const nuevas = Math.max(1, +r[0]);
  const start = +r[1];
  const monto = +String(r[2] || '').replace(/[^0-9]/g, '') || 0;   // 0 = usar el saldo actual
  let endpoint, body;
  if (tipo === 'compra') {
    endpoint = '/api/compra/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas, start, pagadas, monto };
  } else if (tipo === 'extra_debt') {
    endpoint = '/api/extra_debt/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas, start, pagadas, monto };
  } else if (tipo === 'detalle') {
    endpoint = '/api/detalle/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas, start, monto };
  } else {
    endpoint = '/api/creditor/redefer';
    body = { name: btn.dataset.name, cuotas: nuevas, start, monto };
  }
  await api(endpoint, { body });
  toast(monto ? `🔄 Fixed to ${nuevas} installments` : `🔄 Rescheduled to ${nuevas} installments`);
  load();
});

/* ---------- SUEÑOS ---------- */
function renderSuenos() {
  const cats = [...new Set(S.dreams.map(d => d.category))];
  $('#dreamList').innerHTML = cats.map(cat => {
    const items = S.dreams.filter(d => d.category === cat);
    const comprados = items.filter(d => d.bought).length;
    return `<div class="dream-cat">${cat} <small>· ${comprados}/${items.length} bought ✅</small></div>` +
      items.map(d => {
        const p = d.value ? Math.min(d.saved / d.value, 1) : 0;
        return `<div class="dream-item ${d.bought ? 'bought-item' : ''}">
          <span class="dname">${esc(d.name)} <button class="del-x" data-type="dream" data-id="${d.id}">✕</button></span>
          <input class="d-edit money-live" inputmode="numeric" data-f="value" data-id="${d.id}" value="${Number(d.value || 0).toLocaleString('es-CO')}" title="Valor (editable)">
          <input class="d-edit money-live" inputmode="numeric" data-f="saved" data-id="${d.id}" value="${Number(d.saved || 0).toLocaleString('es-CO')}" title="Lo que llevas ahorrado">
          <div class="mini-bar green"><i style="width:${d.bought ? 100 : p * 100}%"></i></div>
          <button class="buy-btn ${d.bought ? 'on' : ''}" data-id="${d.id}">${d.bought ? '✅ Comprado' : 'Bought?'}</button>
          <button class="to-shop" data-id="${d.id}" title="Send to Shopping & to-buy">→ 🛒</button>
        </div>`;
      }).join('');
  }).join('');
}
$('#dreamList').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('d-edit')) return;
  const v = +(e.target.value || '').replace(/\./g, '').replace(/[^0-9-]/g, '') || 0;
  await api('/api/dream', { body: { id: +e.target.dataset.id,
    field: e.target.dataset.f, value: v } });
  load();
});
$('#dreamList').addEventListener('click', async (e) => {
  const shop = e.target.closest('.to-shop');
  if (shop) {
    const d = S.dreams.find(x => x.id === +shop.dataset.id);
    if (!d) return;
    const esSkincare = /skincare/i.test(d.category || '');   // skincare se recompra: NO sale de la wishlist
    const msg = esSkincare
      ? `Send <b>${esc(d.name)}</b> to your 🛒 Shopping & to-buy list?<br><br>Skincare items stay in your wishlist so you can buy them again.`
      : `Move <b>${esc(d.name)}</b> to your 🛒 Shopping & to-buy list? It leaves your wishlist and you tick it off there once you buy it.`;
    if (!await confirmModal('Send to Shopping', msg)) return;
    await api('/api/shopping/new', { body: { name: d.name, slots: 1 } });
    if (!esSkincare) await api('/api/dream/' + d.id, { method: 'DELETE' });
    toast(esSkincare ? '🛒 Added to Shopping · kept in wishlist' : '🛒 Moved to Shopping & to-buy');
    load();
    return;
  }
  const b = e.target.closest('.buy-btn');
  if (!b) return;
  const d = S.dreams.find(x => x.id === +b.dataset.id);
  await api('/api/dream', { body: { id: d.id, field: 'bought', value: d.bought ? 0 : 1 } });
  load();
});

/* ---------- ANIME ---------- */
const A_TEMPS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
const A_EXTRA = [['peliculas', 'Pelis'], ['ovas', 'Ovas'], ['especiales', 'Esp']];
// cuántas columnas de temporada mostrar: 5 por defecto, más si algún anime tiene t6/t7 con datos
function tempsVisibles() {
  let n = 5;
  for (const a of S.animes) {
    if (numTotal(a.t7) > 0 || (a.v_t7 || 0) > 0) { n = 7; break; }
    if (numTotal(a.t6) > 0 || (a.v_t6 || 0) > 0) n = Math.max(n, 6);
  }
  return n;
}
function animeBloques() {
  const n = tempsVisibles();
  return A_TEMPS.slice(0, n).map((f, i) => [f, 'T' + (i + 1)]).concat(A_EXTRA);
}
const numTotal = (v) => {            // "25" -> 25 ; "35/170" -> 35 ; "" -> 0
  const m = String(v ?? '').match(/\d+/);
  return m ? +m[0] : 0;
};
function animeCompleto(a) {
  const todos = A_TEMPS.concat(A_EXTRA.map(x => x[0]));
  const conDatos = todos.filter(f => numTotal(a[f]) > 0);
  if (!conDatos.length) return false;
  return conDatos.every(f => (a['v_' + f] || 0) >= numTotal(a[f]));
}
function renderAnime() {
  // auto-finalizar: si está completo y no marcado Finalizado, lo marca solo
  for (const a of S.animes) {
    const completo = animeCompleto(a);
    if (completo && a.estado !== 'Finalizado ✅') {
      api('/api/anime', { body: { id: a.id, field: 'estado', value: 'Finalizado ✅' } });
      a.estado = 'Finalizado ✅';
    } else if (!completo && a.estado === 'Finalizado ✅') {
      // le salió temporada nueva: vuelve a "Viéndolo" automáticamente
      api('/api/anime', { body: { id: a.id, field: 'estado', value: 'Viéndolo 👀' } });
      a.estado = 'Viéndolo 👀';
    }
  }
  const viendo = S.animes.filter(a => a.estado === 'Viéndolo 👀').length;
  const fin = S.animes.filter(a => a.estado === 'Finalizado ✅').length;
  $('#animeStats').innerHTML = `
    <div class="card gold"><label>Watching now 👀</label><strong>${viendo}</strong></div>
    <div class="card green"><label>Finished ✅</label><strong>${fin}</strong></div>
    <div class="card"><label>In the list</label><strong>${S.animes.length}</strong></div>`;
  const pasa = (a) => ANIME_FILTRO === 'todos' || (a.estado || 'Pendiente') === ANIME_FILTRO
    || (ANIME_FILTRO === 'Pendiente' && !a.estado);
  const ranked = S.animes.filter(a => a.score != null && pasa(a));
  const rest = S.animes.filter(a => a.score == null && pasa(a));
  const estados = ['', 'Viéndolo 👀', 'En emisión 📡', 'Finalizado ✅', 'Pendiente'];
  const estLabel = { '': '—', 'Viéndolo 👀': 'Watching 👀', 'En emisión 📡': 'Airing 📡',
    'Finalizado ✅': 'Finished ✅', 'Pendiente': 'Pending' };
  const celda = (a, f) => {
    const total = numTotal(a[f]);
    const visto = a['v_' + f] || 0;
    const done = total && visto >= total;
    return `<td><div class="ep-box">
      <input class="v-in ${done ? 'full' : ''}" type="number" min="0" data-id="${a.id}" data-f="v_${f}" value="${total ? visto : ''}" placeholder="–" title="voy en">
      <span class="sep">de</span>
      <input class="t-in" type="number" min="0" data-id="${a.id}" data-f="${f}" value="${esc(a[f])}" placeholder="–" title="total">
    </div></td>`;
  };
  const BLOQUES = animeBloques();
  const nTemps = tempsVisibles();
  const fila = (a, rank) => {
    const estadoCls = { 'Viéndolo 👀': 'watching', 'Finalizado ✅': 'finished',
      'En emisión 📡': 'airing', 'Pendiente': 'pending' }[a.estado] || '';
    // botón +temporada: aparece si el anime usa todas las temps visibles y aún puede crecer
    const usadas = A_TEMPS.slice(0, nTemps).filter(f => numTotal(a[f]) > 0).length;
    const puedeMas = usadas >= nTemps && nTemps < 7;
    const addBtn = puedeMas
      ? `<button class="add-temp" data-id="${a.id}" data-next="t${nTemps + 1}" title="Add new season">+ season</button>` : '';
    return `<tr class="${estadoCls}">
      <td class="${rank === 1 ? 'rank-1' : ''}">${rank ? (rank === 1 ? '👑 1' : '#' + rank) : '—'}</td>
      <td class="an-name ${rank === 1 ? 'rank-1' : ''}">${esc(a.name)} ${addBtn}</td>` +
    BLOQUES.map(([f]) => celda(a, f)).join('') +
    `<td><select class="a-edit" data-id="${a.id}" data-f="estado">
      ${estados.map(s => `<option value="${s}" ${(a.estado || '') === s ? 'selected' : ''}>${estLabel[s]}</option>`).join('')}</select></td>
    <td><input class="a-edit score-input" type="number" step="0.1" min="0" max="100"
        data-f="score" data-id="${a.id}" value="${a.score ?? ''}" placeholder="0-100"></td>
    <td><button class="del-x" data-type="anime" data-id="${a.id}">✕</button></td></tr>`;
  };
  const ths = BLOQUES.map(([, lbl]) => `<th>${lbl}</th>`).join('');
  let rank = 0;
  $('#animeTable').innerHTML =
    '<tr><th>TOP</th><th>Anime</th>' + ths + '<th>Status</th><th>Pt</th><th></th></tr>' +
    ranked.map(a => fila(a, ++rank)).join('') +
    rest.map(a => fila(a, 0)).join('');
}
$('#animeTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('.add-temp');
  if (!btn) return;
  const next = btn.dataset.next;
  const lbl = 'T' + next.slice(1);
  const r = await modal({ icon: '✨', title: 'Nueva temporada',
    text: `How many episodes does <b>${lbl}</b> have? It will be added only to this anime.`,
    fields: [{ type: 'number', placeholder: 'Episodios de ' + lbl, min: 1 }], okText: 'Add ' + lbl });
  if (!r || !r[0]) return;
  await api('/api/anime', { body: { id: +btn.dataset.id, field: next, value: r[0] } });
  toast('✨ ' + lbl + ' added.');
  load();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('#animeFilter button');
  if (!b) return;
  ANIME_FILTRO = b.dataset.f;
  document.querySelectorAll('#animeFilter button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  renderAnime();
});
// al hacer foco en "voy en" o "total" que muestre 0, se vacía para escribir directo
document.addEventListener('focus', (e) => {
  if (e.target.matches('.v-in, .t-in') && e.target.value === '0') {
    e.target.select();   // selecciona el 0; al teclear lo reemplaza al instante
  }
}, true);
$('#animeTable').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.classList.contains('v-in') || t.classList.contains('t-in') || t.classList.contains('a-edit')) {
    // si subes "visto" y antes estaba Finalizado pero la temporada nueva lo deja incompleto,
    // el render lo recalcula solo (auto-finaliza solo cuando TODO está completo)
    await api('/api/anime', { body: { id: +t.dataset.id, field: t.dataset.f, value: t.value } });
    load();
  }
});

/* ---------- LIBROS ---------- */
let BOOK_FILTRO = 'all';
const BOOK_STATES = [
  ['Por comprar', 'To buy'], ['Por leer', 'To read'],
  ['Leyendo', 'Reading'], ['Terminado', 'Finished']
];
function finishedBooksByYear() {
  const grouped = new Map();
  (S.books || []).forEach(b => {
    if (b.status !== 'Terminado') return;
    const year = Number(b.read_year || 0);
    if (!Number.isInteger(year) || year < 1900) return;
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(b);
  });
  grouped.forEach(books => books.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es')));
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
}
function renderLibros() {
  const pasa = (b) => BOOK_FILTRO === 'all' || (b.status || 'Por leer') === BOOK_FILTRO;
  const lista = (S.books || []).filter(pasa);
  const currentYear = new Date().getFullYear();
  $('#bookTable').innerHTML =
    '<tr><th>Title</th><th>Status</th><th>Year read</th><th>Pages</th><th>On page</th><th>Progress</th><th></th></tr>' +
    lista.map(b => {
      const p = b.pages ? Math.min((b.status === 'Terminado' ? b.pages : b.current) / b.pages, 1) : 0;
      const year = Number(b.read_year || 0);
      const needsYear = b.status === 'Terminado' && !year;
      return `<tr class="${needsYear ? 'book-needs-year' : ''}"><td>${esc(b.title)}${needsYear ? '<span class="book-year-missing">Year needed</span>' : ''}</td>
        <td><select class="book-status" data-id="${b.id}">
          ${BOOK_STATES.map(([v, t]) => `<option value="${v}" ${v === b.status ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><input class="book-year pg-input" type="number" min="1900" max="${currentYear}" placeholder="year" value="${year || ''}" data-id="${b.id}" data-f="read_year" title="Year this book was finished"></td>
        <td><input class="pg-input" type="number" min="0" placeholder="total" value="${b.pages || ''}" data-id="${b.id}" data-f="pages"></td>
        <td><input class="pg-input" type="number" min="0" placeholder="page" value="${b.current || ''}" data-id="${b.id}" data-f="current"></td>
        <td><div class="mini-bar green" style="width:90px"><i style="width:${p * 100}%"></i></div></td>
        <td><button class="del-x" data-type="book" data-id="${b.id}">✕</button></td></tr>`;
    }).join('');
}
function showBookHistory() {
  const groups = finishedBooksByYear().slice().reverse();
  const finished = (S.books || []).filter(b => b.status === 'Terminado');
  const unassigned = finished.filter(b => !Number(b.read_year || 0)).length;
  const total = groups.reduce((sum, [, books]) => sum + books.length, 0);
  const best = groups.length ? groups.reduce((a, b) => b[1].length > a[1].length ? b : a) : null;
  const rows = groups.length ? groups.map(([year, books]) => `
    <div style="padding:10px 0;border-bottom:1px solid rgba(128,128,128,.22);text-align:left">
      <div style="display:flex;justify-content:space-between;gap:12px"><b>${year}</b><span>${books.length} book${books.length === 1 ? '' : 's'}</span></div>
      <div style="opacity:.75;margin-top:4px;font-size:.92em">${books.map(b => esc(b.title)).join(' · ')}</div>
    </div>`).join('') : '<div style="padding:16px 0;opacity:.7">No finished books have a year assigned yet.</div>';
  modal({ icon: '📚', title: 'Books read by year', okText: 'Close', text: `
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0 12px">
      <div style="padding:10px;border:1px solid rgba(128,128,128,.22);border-radius:10px"><b>${total}</b><br><span style="opacity:.7">with year</span></div>
      <div style="padding:10px;border:1px solid rgba(128,128,128,.22);border-radius:10px"><b>${best ? best[0] : '—'}</b><br><span style="opacity:.7">best year${best ? ` · ${best[1].length}` : ''}</span></div>
    </div>${unassigned ? `<div style="margin:8px 0;padding:8px;border-radius:8px;background:rgba(255,180,0,.12)">⚠ ${unassigned} finished book${unassigned === 1 ? '' : 's'} still need${unassigned === 1 ? 's' : ''} a year.</div>` : ''}${rows}` });
}
function showBookChart() {
  const groups = finishedBooksByYear();
  if (!groups.length) {
    modal({ icon: '📈', title: 'Reading curve', text: 'Assign a year to at least one finished book to build the chart.', okText: 'Close' });
    return;
  }
  const minYear = groups[0][0], maxYear = groups[groups.length - 1][0];
  const counts = new Map(groups.map(([year, books]) => [year, books.length]));
  const data = [];
  for (let year = minYear; year <= maxYear; year++) data.push([year, counts.get(year) || 0]);
  const W = 620, H = 280, left = 46, right = 18, top = 24, bottom = 42;
  const maxCount = Math.max(1, ...data.map(d => d[1]));
  const x = (i) => data.length === 1 ? (left + W - right) / 2 : left + i * (W - left - right) / (data.length - 1);
  const y = (v) => H - bottom - v * (H - top - bottom) / maxCount;
  const points = data.map((d, i) => `${x(i)},${y(d[1])}`).join(' ');
  const area = `${left},${H-bottom} ${points} ${x(data.length - 1)},${H-bottom}`;
  const labels = data.map((d, i) => `<text x="${x(i)}" y="${H-16}" text-anchor="middle" font-size="12" fill="currentColor" opacity=".7">${d[0]}</text>`).join('');
  const dots = data.map((d, i) => `<g><circle cx="${x(i)}" cy="${y(d[1])}" r="5" fill="var(--accent,#d7a84b)"/><text x="${x(i)}" y="${y(d[1])-10}" text-anchor="middle" font-size="12" fill="currentColor">${d[1]}</text></g>`).join('');
  const grid = Array.from({length:maxCount+1}, (_, v) => {
    const yy = y(v);
    return `<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="currentColor" opacity=".1"/><text x="${left-10}" y="${yy+4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".6">${v}</text>`;
  }).join('');
  const peak = groups.reduce((a, b) => b[1].length > a[1].length ? b : a);
  modal({ icon: '📈', title: 'Reading curve', okText: 'Close', text: `
    <div style="text-align:left;margin-bottom:8px">Peak: <b>${peak[0]}</b> with <b>${peak[1].length}</b> book${peak[1].length === 1 ? '' : 's'}.</div>
    <div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Books read per year" style="width:100%;min-width:420px;height:auto;color:inherit">
      ${grid}<polygon points="${area}" fill="var(--accent,#d7a84b)" opacity=".10"/><polyline points="${points}" fill="none" stroke="var(--accent,#d7a84b)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}
    </svg></div>` });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#bookFilter button');
  if (!b) return;
  BOOK_FILTRO = b.dataset.f;
  document.querySelectorAll('#bookFilter button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  renderLibros();
});
$('#bookHistoryBtn').addEventListener('click', showBookHistory);
$('#bookChartBtn').addEventListener('click', showBookChart);
$('#bookTable').addEventListener('change', async (e) => {
  const control = e.target;
  const id = +control.dataset.id;
  const previous = (S.books || []).find(x => x.id === id) || {};
  await withBusy(control, async () => {
    try {
      if (control.classList.contains('book-status')) {
        await api('/api/book', { body: { id, field: 'status', value: control.value } });
      } else if (control.classList.contains('pg-input')) {
        const f = control.dataset.f, val = +control.value || 0;
        if (f === 'read_year' && previous.read_year && val && val !== Number(previous.read_year)) {
          const ok = await confirmModal('Replace reading year', `Change <b>${esc(previous.title)}</b> from <b>${previous.read_year}</b> to <b>${val}</b>?`, false);
          if (!ok) { control.value = previous.read_year; return; }
        }
        await api('/api/book', { body: { id, field: f, value: val } });
        if (f !== 'read_year') {
          const pages = f === 'pages' ? val : (previous.pages || 0);
          const current = f === 'current' ? val : (previous.current || 0);
          if (pages > 0 && current >= pages)
            await api('/api/book', { body: { id, field: 'status', value: 'Terminado' } });
          else if (current > 0 && previous.status !== 'Terminado' && previous.status !== 'Leyendo')
            await api('/api/book', { body: { id, field: 'status', value: 'Leyendo' } });
        }
      }
      toast('📚 Book updated');
      await load();
    } catch (err) {
      renderLibros();
      throw err;
    }
  });
});

/* ---------- BORRAR (nivel superior) ---------- */
const DEL_MSG = {
  debt_extra: 'Delete this registered debt AND remove it from the boss? Only if you added it by mistake.',
  habit: 'Delete this habit AND all its marks? It won\'t affect months already closed in Haki history.',
  goal: 'Delete this goal?',
  compra: 'Delete this installment purchase? Its installment stops adding in Home and the boss bar goes down.',
  detalle: 'Remove this installment line from the breakdown? Do this only if it shouldn\'t be there.',
  dream: 'Delete this wish? (if you\'re not into it anymore, out)',
  book: 'Delete this book from your library?',
  anime: 'Delete this anime from the list?',
  debt: 'Delete this debt AND its logged payments? Only if you registered it by mistake.'
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.del-x');
  if (!b || !b.dataset.type) return;   // ignora botones .del-x propios de otros módulos (ej. historial gym)
  e.stopPropagation();
  if (!await confirmModal('Confirmar', DEL_MSG[b.dataset.type])) return;
  await api(`/api/${b.dataset.type}/${b.dataset.id}`, { method: 'DELETE' });
  load();
});

/* ---------- AGREGAR NUEVOS (nivel superior) ---------- */
$('#habitNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/habit/new', { body: { name: $('#hbName').value } });
  e.target.reset();
  load();
});

$('#goalNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/goal/new', { body: { name: $('#glName').value } });
  e.target.reset();
  load();
});

$('#compraNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!await confirmModal('Compra a cuotas', 'This breaks your promise of zero new installments. Log it only if it ALREADY happened in real life, so the system tells the truth.')) return;
  const _val = numVal('#cpValor'), _cuotas = +$('#cpCuotas').value, _start = +$('#cpStart').value;
  if (_cuotas >= 1 && !await confirmarTopeDeuda(_start, Math.round(_val / _cuotas))) return;
  const r = await api('/api/compra', { body: {
    creditor: $('#cpCred').value, concepto: $('#cpConcepto').value,
    valor: _val, cuotas: _cuotas,
    start: _start } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('💳 Purchase logged. The system now accounts for it.');
  e.target.reset();
  load();
});

$('#debtNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!await confirmModal('Registrar deuda', 'Remember your promise: nothing new on installments. Only log it if it already exists in real life, so the boss shows its true HP.')) return;
  const _val = numVal('#ndValor');
  const _cuotas = +$('#ndCuotas').value || 0;
  const _start = +$('#ndStart').value || 0;
  const _due = $('#ndDue').value || '';
  // aviso de tope 50%: cuota mensual si es a cuotas, o el valor completo si es pago prometido
  let _mes = -1, _cuota = 0;
  if (_cuotas >= 1) { _mes = _start; _cuota = Math.round(_val / _cuotas); }
  else if (_due) { _mes = mesDeFecha(_due); _cuota = _val; }
  if (_mes >= 0 && !await confirmarTopeDeuda(_mes, _cuota)) return;
  const r = await api('/api/debt/new', { body: {
    name: $('#ndName').value, valor: _val,
    cuotas: _cuotas, start: _start, due_date: _due } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('☠ New enemy registered in the Debt Boss.');
  e.target.reset();
  load();
});

$('#dreamNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/dream/new', { body: {
    category: $('#dnCat').value, name: $('#dnName').value,
    value: numVal('#dnValor') } });
  e.target.reset();
  load();
});

$('#bookNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = e.submitter || form.querySelector('[type="submit"]');
  await withBusy(submit, async () => {
    const title = $('#bkTitle').value.trim();
    if (!title) { toast('Write the book title', 'warn'); return; }
    await api('/api/book/new', { body: { title } });
    form.reset();
    toast('📚 Book added');
    await load();
  });
});

$('#animeNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = $('#anName').value.trim();
  if (!nombre) return;
  const campos = [
    { type: 'number', placeholder: 'Episodes S1', min: 0 },
    { type: 'number', placeholder: 'Episodes S2 (optional)', min: 0 },
    { type: 'number', placeholder: 'Episodes S3 (optional)', min: 0 },
    { type: 'number', placeholder: 'Movies (optional)', min: 0 },
    { type: 'number', placeholder: 'OVAs (optional)', min: 0 }
  ];
  const r = await modal({ icon: '📺', title: 'Add ' + nombre,
    text: 'Enter how many episodes each part has (you can edit and add S4–S7 later in the table).',
    fields: campos, okText: 'Add anime' });
  if (!r) return;
  const [t1, t2, t3, peliculas, ovas] = r;
  await api('/api/anime/new', { body: { name: nombre, t1, t2, t3, peliculas, ovas } });
  e.target.reset();
  toast('📺 <b>' + esc(nombre) + '</b> added to your list.');
  load();
});

/* ============================================================
   🤖 MASCOTA ROBOT — companion flotante que reacciona a tu vida
   ============================================================
   ── SLOTS DE IMAGEN (para usar TUS propias imágenes) ─────────
   Por defecto la mascota es un robot dibujado en SVG (pesa casi nada
   y puede animarse: parpadea, respira, celebra). Si quieres usar TUS
   PROPIAS imágenes, sube archivos .webp/.png a /static/img/ y pon aquí
   sus rutas. Deja en null los que no uses (esos seguirán con el SVG).

   Recomendado: imágenes cuadradas ~256x256, fondo transparente, < 200 KB.
   Un estado por "humor" de la mascota:
------------------------------------------------------------ */
const MASCOT_IMG = {
  idle:      '/static/img/pet-idle.webp',       // normal, en reposo
  happy:     '/static/img/pet-happy.webp',      // vas bien / derrotaste deuda
  worried:   '/static/img/pet-worried.webp',    // income en rojo
  celebrate: '/static/img/pet-celebrate.webp',  // meta lograda
  sleepy:    '/static/img/pet-sleepy.webp'      // sin actividad
};

/* ── SLOTS DE IMAGEN: BANNER DE CADA JEFE DE DEUDA ───────────
   Una imagen que aparece ARRIBA de la barra de cada jefe (deuda).
   La clave debe ser el NOMBRE EXACTO de la deuda como aparece en tu app.
   Sube las imágenes a /static/img/ y pon la ruta. Deja fuera las que no uses.
   Recomendado: banner horizontal ~600x200, .webp, < 200 KB.
   Ejemplo listo (descoméntalo y ajusta cuando tengas las imágenes):        */
const BOSS_IMG = {
  // 'Tarjeta DV — Jefe Final': '/static/img/boss-davivienda.webp',
  // 'ADDI':                     '/static/img/boss-addi.webp',
  // 'Codensa':                  '/static/img/boss-codensa.webp',
  // 'Banco de Bogotá':          '/static/img/boss-bogota.webp'
};
function bossBanner(name) {
  const src = BOSS_IMG[name];
  return src ? `<div class="boss-banner"><img loading="lazy" src="${src}" alt="${name}"></div>` : '';
}

/* ── SLOTS DE IMAGEN: CABECERA DE CADA TAB ───────────────────
   Un ícono/detalle pequeño junto al título de cada sección.
   La clave es el id de la tab (data-tab). Sube a /static/img/ y pon la ruta.
   Recomendado: cuadrada ~64x64, .webp/.png transparente, < 50 KB.               */
const TAB_IMG = {
  // home:    '/static/img/tab-home.webp',
  // gym:     '/static/img/tab-gym.webp',
  // life:    '/static/img/tab-life.webp',
  // deudas:  '/static/img/tab-deudas.webp'
};

// Robot SVG por defecto (una cara simple que cambia de expresión según el humor)
function mascotSVG(mood) {
  const eyes = {
    idle:      '<circle cx="34" cy="42" r="5" fill="#131022"/><circle cx="62" cy="42" r="5" fill="#131022"/>',
    happy:     '<path d="M29 42 q5 -6 10 0" stroke="#131022" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M57 42 q5 -6 10 0" stroke="#131022" stroke-width="3" fill="none" stroke-linecap="round"/>',
    worried:   '<circle cx="34" cy="43" r="5" fill="#131022"/><circle cx="62" cy="43" r="5" fill="#131022"/><path d="M27 33 l12 4 M69 33 l-12 4" stroke="#131022" stroke-width="2.5" stroke-linecap="round"/>',
    celebrate: '<path d="M29 40 l10 4 -10 4" stroke="#131022" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M67 40 l-10 4 10 4" stroke="#131022" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    sleepy:    '<path d="M29 43 h10 M57 43 h10" stroke="#131022" stroke-width="3" stroke-linecap="round"/>'
  }[mood] || '';
  const mouth = {
    idle:      '<path d="M40 58 q8 5 16 0" stroke="#131022" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
    happy:     '<path d="M38 56 q10 10 20 0" stroke="#131022" stroke-width="3" fill="none" stroke-linecap="round"/>',
    worried:   '<path d="M40 60 q8 -5 16 0" stroke="#131022" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
    celebrate: '<ellipse cx="48" cy="59" rx="8" ry="6" fill="#131022"/>',
    sleepy:    '<circle cx="48" cy="59" r="3" fill="#131022"/>'
  }[mood] || '';
  const glow = mood === 'celebrate' ? '<circle cx="48" cy="50" r="46" fill="none" stroke="var(--gold)" stroke-width="2" opacity=".6" class="pet-halo"/>' : '';
  return `<svg viewBox="0 0 96 104" xmlns="http://www.w3.org/2000/svg" class="pet-svg mood-${mood}">
    ${glow}
    <line x1="48" y1="6" x2="48" y2="16" stroke="var(--accent)" stroke-width="2.5"/>
    <circle cx="48" cy="6" r="4" fill="var(--gold)" class="pet-antenna"/>
    <rect x="12" y="16" width="72" height="66" rx="20" fill="var(--accent)"/>
    <rect x="20" y="26" width="56" height="40" rx="14" fill="#eef0ff"/>
    ${eyes}${mouth}
    <rect x="30" y="84" width="14" height="14" rx="4" fill="var(--accent)"/>
    <rect x="52" y="84" width="14" height="14" rx="4" fill="var(--accent)"/>
  </svg>`;
}

const PET_LINES = {
  happy:     ['Looking good! 🔥', 'Debt going down. Proud of you.', 'Keep this pace!', 'You showed up today. 💪'],
  worried:   ['Careful with spending this month.', "Income's tight — you got this.", 'Small steps still count.'],
  celebrate: ['🎉 HUGE! You did it!', 'Boss defeated! ☠', "That's a win. Enjoy it!"],
  sleepy:    ["Zzz... tap me when you're back.", 'Resting. Come log something!'],
  idle:      ['Hey Kevin 👋', 'Tap me anytime.', 'One task at a time.', "I'm here with you."]
};

let _petMoodTimer = null;
function petMood() {
  // deriva el "humor" de tu situación real (misma fuente de verdad: S)
  try {
    const i = (typeof MES === 'number') ? MES : 0;
    const ingreso = (typeof ingresoDelMes === 'function') ? ingresoDelMes(i) : 0;
    if (ingreso > 0) {
      const checks = new Set(S.checks || []);
      const mk = (typeof monthKey === 'function') ? monthKey(i) : '';
      let pagado = 0;
      for (const s of (S.servicios || [])) {
        if (s.method === 'Fondo') continue;
        if (payMethod(s.method).card) continue;
        if (checks.has(`${s.name}|${mk}`)) pagado += s.amount;
      }
      if (pagado > ingreso) return 'worried';
    }
    return 'idle';
  } catch { return 'idle'; }
}

function renderPet(forceMood) {
  const body = document.getElementById('petBody');
  if (!body) return;
  const mood = forceMood || petMood();
  const img = MASCOT_IMG[mood] || MASCOT_IMG.idle;
  body.innerHTML = img
    ? `<img src="${img}" alt="companion" class="pet-img mood-${mood}">`
    : mascotSVG(mood);
  body.parentElement.dataset.mood = mood;
}

function petSay(mood, ms = 3200) {
  const bubble = document.getElementById('petBubble');
  if (!bubble) return;
  const lines = PET_LINES[mood] || PET_LINES.idle;
  bubble.textContent = lines[Math.floor(Math.random() * lines.length)];
  bubble.classList.add('show');
  renderPet(mood === 'idle' ? null : mood);
  clearTimeout(_petMoodTimer);
  _petMoodTimer = setTimeout(() => { bubble.classList.remove('show'); renderPet(); }, ms);
}

// reacciones que otras partes de la app pueden disparar
function petCelebrate() { petSay('celebrate', 4000); }
function petHappy() { petSay('happy'); }

// 📅 Recordatorios de CITAS AGENDADAS (solo las scheduled=1 del calendario).
// El robot avisa 3, 2 y 1 días antes, y el mismo día. Devuelve el mensaje más urgente de hoy.
function scheduledReminder() {
  const hoy = hoyLocal();
  const [hy, hm, hd] = hoy.split('-').map(Number);
  const hoyUTC = Date.UTC(hy, hm - 1, hd);
  let best = null;   // el más cercano (menor cantidad de días restantes)
  for (const a of (S.routine_extra || [])) {
    if (!a.scheduled || !a.day) continue;
    const [yy, mm, dd] = a.day.split('-').map(Number);
    if (!yy) continue;
    const diff = Math.round((Date.UTC(yy, mm - 1, dd) - hoyUTC) / 86400000);
    if (diff < 0 || diff > 3) continue;   // solo dentro de la ventana de 3 días -> hoy
    let msg;
    if (diff === 0)      msg = `📅 Today: ${a.title}${a.time ? ' at ' + a.time : ''}`;
    else if (diff === 1) msg = `⏰ Tomorrow: ${a.title}`;
    else                 msg = `🗓️ In ${diff} days: ${a.title}`;
    if (best === null || diff < best.diff) best = { diff, msg };
  }
  return best;
}

// muestra el recordatorio de cita más urgente (si hay alguno hoy)
function petCheckAppointments() {
  const rem = scheduledReminder();
  if (!rem) return false;
  const bubble = document.getElementById('petBubble');
  if (!bubble) return false;
  bubble.textContent = rem.msg;
  bubble.classList.add('show');
  renderPet(rem.diff === 0 ? 'happy' : 'idle');
  clearTimeout(_petMoodTimer);
  _petMoodTimer = setTimeout(() => { bubble.classList.remove('show'); renderPet(); }, 6000);
  return true;
}


// v111 · Kevin Advisor: rules-based guidance from the app's real state.
// It does not invent progress, alter data or call an external AI service.
function kevinAdvisorMessage() {
  try {
    const reminder = scheduledReminder();
    if (reminder) return reminder.msg;

    const academy = academyReadState();
    const active = academyAllSkills().find(x => x.id === academy.activeSkillId);
    const today = hoyLocal();
    if (active && !academy.doneDates.includes(today)) {
      const ix = Math.min(Number(academy.sessions) || 0, active.practices.length - 1);
      return `🎯 Today's training: ${active.name}. ${active.practices[ix]}`;
    }

    const openGoals = (S.goals || [])
      .filter(g => g.status !== 'Lograda 🏆' && Number(g.pct || 0) < 100)
      .sort((a,b) => Number(b.pct || 0) - Number(a.pct || 0));
    const actionable = openGoals.find(g => String(g.next_step || '').trim());
    if (actionable) return `🗺️ Next expedition move: ${actionable.next_step}`;

    const hakiMonths = (S.history || []).filter(h => Number(h.pct || 0) >= 0.7).length;
    if (hakiMonths < 2) return `⚡ Hunter License requirement: conquer ${2 - hakiMonths} more Haki month${2 - hakiMonths === 1 ? '' : 's'}.`;

    const intel = academyDailyIntel();
    return `◈ ${intel.domain}: ${intel.text}`;
  } catch (_error) {
    return 'One deliberate action is enough to move today forward.';
  }
}

function petSayText(text, mood='idle', ms=6500) {
  const bubble = document.getElementById('petBubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  renderPet(mood);
  clearTimeout(_petMoodTimer);
  _petMoodTimer = setTimeout(() => { bubble.classList.remove('show'); renderPet(); }, ms);
}

// Click the mascot to receive the highest-priority useful briefing.
document.getElementById('petMascot')?.addEventListener('click', () => {
  const mood = petMood();
  petSayText(kevinAdvisorMessage(), mood === 'worried' ? 'worried' : 'idle');
});

// Cabeceras de tab: si hay imagen en TAB_IMG para una tab, la antepone al texto del botón.
function applyTabImages() {
  document.querySelectorAll('#tabs [data-tab]').forEach(btn => {
    const src = TAB_IMG[btn.dataset.tab];
    if (src && !btn.querySelector('.tab-img')) {
      const img = document.createElement('img');
      img.className = 'tab-img'; img.src = src; img.alt = '';
      btn.prepend(img);
    }
  });
}

load().then(() => {
  applyTabImages();
  renderPet();
  // al abrir la app: si hay una cita en la ventana de 3 días, el robot la recuerda; si no, saluda
  setTimeout(() => { if (!petCheckAppointments()) petSayText(kevinAdvisorMessage(), 'idle', 6500); }, 900);
});

// v102: el respaldo usa una descarga nativa para no depender del estado de la SPA.
