/* KEVIN LIFE OS — frontend */
let S = null;          // estado global del servidor
let pieChart = null;
const $ = (q) => document.querySelector(q);
const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pct = (n) => (n * 100).toFixed(1) + '%';
/* --- compras a cuotas --- */
const planIndex = (d) => (d.getFullYear() - 2026) * 12 + d.getMonth() - 6;  // julio 2026 = 0
const CRED_TO_DEBT = { 'Tarjeta DV': 'Tarjeta DV — Jefe Final', 'Joseph (cuota)': 'Joseph' };
const CRED_TO_GRUPO = { 'Joseph (cuota)': 'Joseph' };
const cuotaDe = (c) => Math.round(c.valor / c.cuotas);
const compraActiva = (c, i) => i >= c.start && i < c.start + c.cuotas;
const extraCuota = (cred, i) => S.compras
  .filter(c => c.creditor === cred && compraActiva(c, i))
  .reduce((s, c) => s + cuotaDe(c), 0);
const extraDebtCuota = (i) => (S.extra_debts || [])
  .filter(d => d.cuotas >= 1 && i >= d.start && i < d.start + d.cuotas)
  .reduce((s, d) => s + d.cuota, 0);
const compradoEn = (debtName) => S.compras
  .filter(c => (CRED_TO_DEBT[c.creditor] || c.creditor) === debtName)
  .reduce((s, c) => s + c.valor, 0);

const monthKey = (i) => {                     // índice del plan -> 'AAAA-MM'
  const t = 6 + i;                            // mes 0 del plan = julio 2026
  return `${2026 + Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
};

/* ---------- tabs ---------- */
document.getElementById('tabs').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('tab-' + e.target.dataset.tab).classList.add('active');
});

const FRONT_V = 29;
let MES = 0;   // mes seleccionado en Inicio (0 = julio 2026)
let ANIME_FILTRO = 'todos';
// Medios de pago. isCard=true significa tarjeta de crédito -> suma a cuotas de esa deuda.
// Conexión Life -> Habits: qué hábito marca cada actividad de la rutina.
// Varias actividades pueden marcar el MISMO hábito (ej: ejercicio o gym -> Exercise).
const ACT_TO_HABIT = {
  ejercicio: 'Exercise', gym: 'Exercise',
  ingles: 'English',
  estudio: 'Study and hard work', proyecto: 'Study and hard work',
  leer: 'Read',
  dormir: 'Sleep well',
  skincare: 'Take care my face and body'
};
// Sub-tareas del bloque de inglés (para preguntar una por una al marcar)
// Extrae los pasos numerados (1) 2) 3)) de la rutina de inglés de un día concreto
function pasosInglesDelDia(wd) {
  const plan = INGLES_PLAN[wd] || INGLES_PLAN[0];
  const titulo = plan[0];      // ej: "English — Shadowing day"
  const desc = plan[1];        // ej: "1) ... 2) ... 3) ..."
  // partir por los marcadores "N)"
  const partes = desc.replace(/^\d\)\s*/, '').split(/\d\)\s*/).map(s => s.trim()).filter(Boolean);
  if (partes.length <= 1) {
    // día sin pasos numerados (ej. Light immersion): un solo paso con toda la descripción
    return { titulo, pasos: [{ t: titulo, d: desc }] };
  }
  return { titulo, pasos: partes.map((p, i) => ({ t: `Step ${i + 1}`, d: p })) };
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
  { id: 'Banco de Bogotá', label: 'Banco de Bogotá (credit)', logo: '🔵', card: true }
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

async function api(path, opts) {
  let r;
  try {
    r = await fetch(path, opts ? {
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    } : undefined);
  } catch (err) {
    toast('⚠ Could not reach the server.', 'err');
    throw err;
  }
  if (!r.ok) {
    toast('⚠ Error ' + r.status + '. Reinicia el servidor (Ctrl+C → python app.py)', 'err');
    throw new Error(r.status + ' en ' + path);
  }
  return r.json();
}

/* ====== MODALES Y TOASTS BONITOS ====== */
function toast(msg, tipo) {
  let wrap = document.getElementById('toastWrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (tipo === 'err' ? ' err' : '');
  t.innerHTML = msg;
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

function celebrate({ icon = '🎉', title = '', text = '', confettiOn = true }) {
  if (confettiOn) confetti();
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

function modal({ icon = '⚔', title = '', text = '', fields = [], okText = 'Confirmar', danger = false, extraBtn = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const fieldsHtml = fields.map((f, i) => f.type === 'select'
      ? `<select data-i="${i}">${f.options.map(o => { const v = o.v ?? o; const t = o.t ?? o; const sel = (f.value != null && String(f.value) === String(v)) ? ' selected' : ''; return `<option value="${v}"${sel}>${t}</option>`; }).join('')}</select>`
      : `<input data-i="${i}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" value="${f.value ?? ''}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`
    ).join('');
    back.innerHTML = `<div class="modal-card">
      <div class="modal-icon">${icon}</div>
      <h3>${title}</h3>${text ? `<p>${text}</p>` : ''}
      ${fieldsHtml}
      <div class="modal-btns">
        ${fields.length || !danger ? '<button class="m-cancel">Cancel</button>' : ''}
        ${extraBtn ? `<button class="m-extra danger">${extraBtn}</button>` : ''}
        <button class="m-ok ${danger ? 'danger' : ''}">${okText}</button>
      </div></div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const close = (val) => { back.classList.remove('show'); setTimeout(() => back.remove(), 280); resolve(val); };
    back.querySelector('.m-ok').onclick = () => {
      if (fields.length) {
        const vals = [...back.querySelectorAll('[data-i]')].map(el => el.value);
        close(vals);
      } else close(true);
    };
    const extra = back.querySelector('.m-extra');
    if (extra) extra.onclick = () => close('EXTRA');
    const cancel = back.querySelector('.m-cancel');
    if (cancel) cancel.onclick = () => close(null);
    back.onclick = (e) => { if (e.target === back) close(null); };
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

async function load(animate) {
  const ym = hoyLocal().slice(0, 7);
  S = await api('/api/state?month=' + ym);
  checkVersion();
  renderFreedom();
  renderInicio();
  renderShopping();
  renderBoss(animate);
  renderHabitos();
  renderSuenos();
  renderAnime();
  renderLibros();
  renderGoals();
  renderLife();
  renderHaki();
  renderAchievements();
  setTimeout(avisosInteligentes, 1200);
  setTimeout(preguntaPagoDelDia, 2000);
}

let _avisosMostrados = false;
function avisosInteligentes() {
  if (_avisosMostrados) return;      // solo una vez por carga de página
  _avisosMostrados = true;
  const hoy = new Date();
  const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  // 1. Fin de mes: recordar cerrar el mes
  if (hoy.getDate() >= diasEnMes - 1) {
    const ymActual = hoyLocal().slice(0, 7);
    const yaCerrado = (S.history || []).some(h => {
      // label tipo "June 2026" no coincide directo con ym; chequeo laxo por mes/año
      return false;
    });
    toast('📅 Month is ending — close it in Habits to lock your Haki.');
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
document.addEventListener('click', async (e) => {
  const chk = e.target.closest('.shop-check');
  if (chk) {
    await api('/api/shopping/tick', { body: { id: +chk.dataset.id } });
    load();
    return;
  }
  if (e.target.id === 'clearDoneBtn') {
    await api('/api/shopping/clear_done', {});
    toast('🧹 Cleared checked items'); load();
    return;
  }
});

function renderShopping() {
  const cont = document.getElementById('shoppingList');
  if (!cont) return;
  const items = S.shopping || [];
  if (!items.length) {
    cont.innerHTML = '<p class="hint">Nothing on the list. Add what you need above. 🛒</p>';
    return;
  }
  cont.innerHTML = items.map(it => {
    const slots = it.slots || 1;
    const done = it.done || 0;
    const complete = slots > 0 && done >= slots;
    // rayas: una marca por cada sub-tarea (para Cloe = 3)
    let rayas = '';
    if (slots > 1) {
      rayas = '<span class="shop-slots">' +
        Array.from({ length: slots }, (_, k) =>
          `<i class="slot ${k < done ? 'on' : ''}"></i>`).join('') + '</span>';
    }
    return `<div class="shop-item ${complete ? 'done' : ''}" data-id="${it.id}">
      <button class="shop-check ${complete ? 'on' : ''}" data-id="${it.id}" title="${slots > 1 ? 'Tap once per task (' + done + '/' + slots + ')' : 'Mark done'}">
        ${complete ? '✓' : (slots > 1 ? done : '')}
      </button>
      <span class="shop-name">${esc(it.name)}</span>
      ${rayas}
      <button class="del-x" data-type="shopping" data-id="${it.id}">✕</button>
    </div>`;
  }).join('');
}

function renderFreedom() {
  const panel = document.getElementById('freedomPanel');
  if (!panel) return;
  const init = (S.debts || []).reduce((s, d) => s + d.initial + compradoEn(d.name), 0)
    + (S.extra_debts || []).reduce((s, d) => s + d.total, 0);
  const dmg = (S.debts || []).reduce((s, d) => s + d.abonado, 0);
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

  const enemigosVivos = (S.debts || []).filter(d => (d.initial + compradoEn(d.name) - d.abonado) > 0).length
    + (S.extra_debts || []).length;
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
}

function renderInicio() {
  const sel = $('#monthSel');
  if (!sel.options.length) {
    S.plan.months.forEach((m, i) => sel.add(new Option(m, i)));
    sel.onchange = renderInicio;
  }
  const i = +sel.value || 0;
  MES = i;
  const p = S.plan;
  const ingreso = ingresoDelMes(i);
  const deudas = Object.entries(p.creditors)
    .map(([n, arr]) => [n, arr[i] + extraCuota(n, i), extraCuota(n, i)])
    .filter(d => d[1] > 0);
  (S.extra_debts || []).filter(d => d.cuotas >= 1 && i >= d.start && i < d.start + d.cuotas)
    .forEach(d => deudas.push([d.name + ' (registrada)', d.cuota, 0]));
  const totalDeudas = deudas.reduce((s, d) => s + d[1], 0);
  // gastos del mes actual que NO son a crédito (los de crédito ya cuentan como cuota)
  const mesKey = p.months[i];
  const gastosMes = (S.expenses || []).filter(x =>
    (x.kind === 'monthly' || x.month === mesKey) && !payMethod(x.method).card && x.method !== 'Ahorro')
    .reduce((s, x) => s + x.amount, 0);
  const egresos = p.vida + p.ahorro + totalDeudas + gastosMes;
  const saldo = ingreso - egresos;

  $('#kpis').innerHTML = `
    <div class="card"><label>Monthly income</label><strong>${fmt(ingreso)}</strong></div>
    <div class="card red"><label>Debt this month</label><strong>${fmt(totalDeudas)}</strong></div>
    <div class="card"><label>Life + savings</label><strong>${fmt(p.vida + p.ahorro)}</strong></div>
    <div class="card ${saldo >= 0 ? 'green' : 'red'}"><label>Expected balance</label><strong>${fmt(saldo)}</strong></div>` +
    (() => {
      const crecioCompras = deudas.reduce((s, d) => s + d[2], 0);
      const cuotasReg = extraDebtCuota(i);
      const sinCuotas = (S.extra_debts || []).filter(d => !(d.cuotas >= 1)).reduce((s, d) => s + d.total, 0);
      const crecio = crecioCompras + cuotasReg;
      let html = '';
      if (crecio > 0)
        html += `<div class="card red"><label>📈 Debt grew this month</label><strong>+${fmt(crecio)}</strong></div>`;
      if (sinCuotas > 0)
        html += `<div class="card red"><label>☠ Registered debts without installments (balance)</label><strong>${fmt(sinCuotas)}</strong></div>`;
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

  const data = {
    labels: ['Needs', 'Savings', 'Debt', 'Free cushion'],
    datasets: [{
      data: [p.vida, p.ahorro, totalDeudas, Math.max(saldo, 0)],
      backgroundColor: ['#7c6ce0', '#f5b942', '#e0445c', '#36c9a7'],
      borderColor: '#1d1932', borderWidth: 3
    }]
  };
  if (pieChart) { pieChart.data = data; pieChart.update(); }
  else pieChart = new Chart($('#pieChart'), {
    type: 'doughnut', data,
    options: { plugins: { legend: { labels: { color: '#ece9f7' } } }, cutout: '58%' }
  });

  renderChecklist(i, deudas);
  renderExpenses(i);
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
    <td><input class="fund-edit" type="number" data-id="${f.id}" data-f="quota" value="${f.quota || 0}" style="width:90px"></td>
    <td><input class="fund-edit" data-id="${f.id}" data-f="frequency" value="${esc(f.frequency || '')}" style="width:90px"></td>
    <td><input class="fund-edit" type="date" data-id="${f.id}" data-f="last_deposit" value="${f.last_deposit || ''}" style="width:140px"></td>
    <td><input class="fund-edit" type="number" data-id="${f.id}" data-f="saved" value="${f.saved || 0}" style="width:110px"></td>
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
      { type: 'number', placeholder: 'Monthly quota' },
      { type: 'number', placeholder: 'Already saved' }
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
        { type: 'number', placeholder: 'Goal amount (0 = free jar)' },
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
        { type: 'number', placeholder: 'Amount' },
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
  const amount = +$('#exAmount').value || 0;
  const method = $('#exMethod').value;
  const kind = $('#exKind').value;
  if (!name || amount <= 0) return;
  const mesKey = S.plan.months[MES];
  const m = payMethod(method);

  // Si es tarjeta de crédito: preguntar a cuántas cuotas y crear la "compra a cuotas"
  if (m.card) {
    const r = await modal({ icon: m.logo, title: 'Paid with ' + m.id,
      text: `This is a credit-card payment. In how many installments? It will add to <b>${m.id}</b>'s debt automatically.`,
      fields: [{ type: 'number', placeholder: '# installments (1 = single)', min: 1, value: '1' }],
      okText: 'Add to card' });
    if (!r) return;
    const cuotas = Math.max(1, +r[0] || 1);
    // crear la compra a cuotas (reusa la lógica existente). start = mes actual MES.
    await api('/api/compra', { body: { creditor: method, concepto: name, valor: amount, cuotas, start: MES } });
    // y registrar el gasto también (para el historial del mes)
    await api('/api/expense/new', { body: { name, amount, method, kind, month: kind === 'monthly' ? '' : mesKey } });
    toast(`💳 ${fmt(amount)} added to ${m.id} (${cuotas} ${cuotas === 1 ? 'installment' : 'installments'})`);
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
    fields: [{ type: 'number', placeholder: 'Net income', min: 0, value: actual }],
    okText: 'Save income' });
  if (!r) return;
  await api('/api/income', { body: { month: mesKey, income: +r[0] || 0 } });
  toast('💰 Income updated for ' + mesKey);
  load();
});

/* ---------- CHECKLIST DE PAGOS ---------- */
function renderChecklist(i, deudas) {
  const mk = monthKey(i);
  const checks = new Set(S.checks);
  // fila de servicio (editable): objeto {id,name,amount,method,payday}
  const svcRow = (s) => {
    const paid = checks.has(`${s.name}|${mk}`);
    const m = payMethod(s.method);
    return `<div class="check-item ${paid ? 'paid' : ''}" data-item="${s.name}" data-mk="${mk}">
      <div class="box">${paid ? '✓' : ''}</div>
      <span class="cname">${esc(s.name)}</span>
      <small>${m.logo} ${esc(s.method || '—')} · ${esc(s.payday || '')}</small>
      <span class="cval">${fmt(s.amount)}</span>
      <button class="svc-edit" data-id="${s.id}" title="Edit">✎</button></div>`;
  };
  // fila de deuda: lleva debt_id y valor para abonar de verdad
  const debtRow = (d) => {
    const [item, val] = d;
    const debtName = CRED_TO_DEBT[item] || item;
    const debt = S.debts.find(x => x.name === debtName);
    const paid = checks.has(`${item}|${mk}`);
    return `<div class="check-item debt ${paid ? 'paid' : ''}" data-item="${item}" data-mk="${mk}"
            data-debt="${debt ? debt.id : ''}" data-val="${val}">
      <div class="box">${paid ? '✓' : ''}</div>
      <span class="cname">${esc(item)}</span>
      <small>⚔ this month's installment${debt ? ' · hits the boss' : ''}</small>
      <span class="cval">${fmt(val)}</span></div>`;
  };
  $('#checkServicios').innerHTML = (S.servicios || []).map(svcRow).join('')
    + `<button class="btn-add-svc" id="addServiceBtn">+ Add service</button>`;
  $('#checkDeudas').innerHTML = deudas.map(debtRow).join('');
  const total = (S.servicios || []).length + deudas.length;
  const done = [...checks].filter(c => c.endsWith('|' + mk)).length;
  $('#checkCount').textContent = `${done} / ${total} paid`;

  // ===== Barra de ingreso: gastado vs disponible (opción C) =====
  renderIncomeBar(i, mk, deudas);
}

function renderIncomeBar(i, mk, deudas) {
  const cont = document.getElementById('incomeBar');
  if (!cont) return;
  const ingreso = ingresoDelMes(i);
  const checks = new Set(S.checks);
  // lo "pagado" del mes = servicios marcados + deudas marcadas (lo que dio check)
  let pagado = 0;
  for (const s of (S.servicios || [])) if (checks.has(`${s.name}|${mk}`)) pagado += s.amount;
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
        { type: 'number', placeholder: 'Amount', value: s.amount },
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
    await api('/api/service', { body: { id: s.id, field: 'method', value: r[2] } });
    await api('/api/service', { body: { id: s.id, field: 'payday', value: r[3] } });
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
  const body = { item: c.dataset.item, month: c.dataset.mk };
  if (c.dataset.debt) { body.debt_id = +c.dataset.debt; body.valor = +c.dataset.val || 0; }
  await api('/api/check', { body });
  await load();
  // si marcó una deuda, celebrar si la derrotó
  if (c.dataset.debt && !c.classList.contains('paid')) {
    const dn = CRED_TO_DEBT[c.dataset.item] || c.dataset.item;
    const debt = S.debts.find(x => x.name === dn);
    if (debt && (debt.initial + compradoEn(debt.name) - debt.abonado) <= 0)
      celebrate({ icon: '☠', title: 'ENEMY DEFEATED', text: `<b>${dn}</b> is down. Paid in full. 🔥` });
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
function renderBoss(animate) {
  const init = S.debts.reduce((s, d) => s + d.initial + compradoEn(d.name), 0)
    + (S.extra_debts || []).reduce((s, d) => s + d.total, 0);
  const dmg = S.debts.reduce((s, d) => s + d.abonado, 0)
    + (S.extra_debts || []).reduce((s, d) => s + (d.abonado || 0), 0);
  const rest = init - dmg;
  $('#bossInit').textContent = fmt(init);
  $('#bossDmg').textContent = fmt(dmg);
  $('#bossRest').textContent = fmt(rest);
  requestAnimationFrame(() =>
    $('#bossHp').style.width = Math.max(0, (rest / init) * 100) + '%');

  const sel = $('#abonoDebt');
  const optsCore = S.debts
    .filter(d => d.initial + compradoEn(d.name) - d.abonado > 0)
    .map(d => `<option value="${d.id}">${d.name} (${fmt(d.initial + compradoEn(d.name) - d.abonado)})</option>`).join('');
  const optsExtra = (S.extra_debts || [])
    .filter(d => (d.total - (d.abonado || 0)) > 0)
    .map(d => `<option value="x:${d.id}">${d.name} (${fmt(d.total - (d.abonado || 0))})</option>`).join('');
  sel.innerHTML = optsCore + optsExtra;

  const extraBars = (S.extra_debts || []).map(d => {
    const ab = d.abonado || 0;
    const rest = Math.max(d.total - ab, 0);
    const w = d.total ? (rest / d.total) * 100 : 0;
    const cuotaTxt = d.cuotas >= 1
      ? `${d.cuotas} cuotas de ${fmt(d.cuota)} desde ${S.plan.months[d.start] || '—'}`
      : 'no installments (pay it down when you can)';
    return `<div class="debt-item ${rest <= 0 ? 'dead' : ''}">
      <div class="row-between"><span>☠ ${d.name}
        <button class="del-x" data-type="debt_extra" data-id="${d.id}" title="Borrar deuda">✕</button></span>
        <strong>${rest <= 0 ? '☠ DERROTADA' : fmt(rest)}</strong></div>
      <div class="mini-bar"><i style="width:${Math.max(w, 0)}%"></i></div>
      <small>${ab > 0 ? fmt(ab) + ' de daño · ' : ''}${cuotaTxt}</small></div>`;
  }).join('');
  $('#debtList').innerHTML = extraBars + S.debts.map(d => {
    const tot = d.initial + compradoEn(d.name);
    const r = tot - d.abonado;
    const w = tot ? (r / tot) * 100 : 0;
    const propia = !new Set(S.core_debts).has(d.name);
    return `<div class="debt-item ${r <= 0 ? 'dead' : ''}">
      <div class="row-between"><span>${d.name}${propia ?
        ` <button class="del-x" data-type="debt" data-id="${d.id}" title="Borrar deuda">✕</button>` : ''}</span>
        <strong>${r <= 0 ? '☠ DERROTADA' : fmt(r)}</strong></div>
      <div class="mini-bar"><i style="width:${Math.max(w, 0)}%"></i></div>
      <small>${fmt(d.abonado)} de daño causado</small></div>`;
  }).join('');

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

  $('#abonoList').innerHTML = S.abonos.map(a =>
    `<li><span>${a.fecha} · ${a.name}</span>
     <span>${fmt(a.valor)} <button class="del" data-id="${a.id}" title="Deshacer">✕</button></span></li>`
  ).join('') || '<li>No attacks yet. The first payment is the most important one.</li>';
}

$('#abonoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = +$('#abonoValor').value;
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
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('⚔ Hit of <b>' + fmt(valor) + '</b> to the boss!');
  const f = $('#dmgFloat');
  f.textContent = '−' + fmt(valor);
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  $('#abonoValor').value = '';
  await load(true);
  // ¿este abono mató al enemigo?
  const vivasAhora = snapshotDeudasVivas();
  if (debtName && vivasAntes.has(debtName) && !vivasAhora.has(debtName)) {
    celebrate({ icon: '☠', title: 'ENEMY DEFEATED', text: `<b>${debtName}</b> is down. One less chain. 🔥` });
  } else if (vivasAhora.size === 0 && vivasAntes.size > 0) {
    celebrate({ icon: '👑', title: 'YOU ARE FREE', text: 'Every debt defeated. You won the war, Kevin.' });
  }
});

$('#abonoList').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('del')) return;
  if (!await confirmModal('Deshacer abono', 'Undo this attack? The damage goes back to the boss.')) return;
  await api('/api/abono/' + e.target.dataset.id, { method: 'DELETE' });
  load();
});

/* ---------- DESGLOSE ---------- */
function calcItem(it, i) {
  const [nombre, cuota, pagadas, total, fijo, detId] = it;
  if (total == null) {                       // cargo fijo o saldo libre, no envejece
    return { label: nombre, cuota, saldo: fijo || 0, done: false };
  }
  const num = pagadas + i + 1;               // cuota que se paga en el mes elegido
  if (num > total) {
    return { label: nombre, cuota: 0, saldo: 0, done: true };
  }
  return { label: `${nombre} · installment ${num}/${total}`, cuota,
           saldo: cuota * (total - num), done: false,
           redefer: detId ? { type: 'detalle', id: detId, cuotas: total } : null };
}

function renderDesglose() {
  const i = MES;
  const filas = {};
  for (const [g, items] of Object.entries(S.detalle)) {
    filas[g] = items.map(it => calcItem(it, i));
  }
  const grupoRedefer = {};   // grupo -> {type, id/name} para el botón de rediferir
  // deudas principales del plan (creditors): rediferibles por nombre
  const creditorNames = Object.keys((S.plan && S.plan.creditors) || {});
  for (const [g, items] of Object.entries(S.detalle)) {
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
      const num = i - d.start + 1;
      const pagadas = Math.min(Math.max(num, 0), d.cuotas);
      const activa = num >= 1 && num <= d.cuotas;
      filas[g] = [{
        label: activa ? `Cuota ${num}/${d.cuotas}` : `${d.cuotas} cuotas desde ${S.plan.months[d.start] || '—'}`,
        cuota: activa ? d.cuota : 0,
        saldo: Math.max(d.total - d.cuota * pagadas, 0),
        done: num > d.cuotas,
        redefer: num <= d.cuotas ? { type: 'extra_debt', id: d.id, cuotas: d.cuotas } : null
      }];
    } else {
      filas[g] = [{ label: 'Saldo (sin cuotas)', cuota: 0, saldo: d.total, done: false }];
    }
  }
  for (const c of S.compras) {
    const g = CRED_TO_GRUPO[c.creditor] || c.creditor;
    const num = i - c.start + 1;             // cuota de la compra en el mes elegido
    const pagadas = Math.min(Math.max(num, 0), c.cuotas);
    const activa = num >= 1 && num <= c.cuotas;
    (filas[g] = filas[g] || []).push({
      label: `💳 ${c.concepto}` + (activa ? ` · installment ${num}/${c.cuotas}` : ` (${c.cuotas} cuotas desde ${S.plan.months[c.start]})`),
      cuota: activa ? cuotaDe(c) : 0,
      saldo: Math.max(c.valor - cuotaDe(c) * pagadas, 0),
      done: num > c.cuotas,
      redefer: num <= c.cuotas ? { type: 'compra', id: c.id, cuotas: c.cuotas } : null
    });
  }
  let total = 0;
  let html = `<p class="hint">Calculated for <b>${S.plan.months[i]}</b> — change it with the month selector in Home and watch installments advance on their own.</p>`;
  html += Object.entries(filas).map(([grupo, items]) => {
    const saldo = items.reduce((s, it) => s + it.saldo, 0);
    if (!grupo.startsWith('Nómina')) total += saldo;
    return `<details><summary><span>${grupo}</span>
      <span class="sum-val">${saldo ? fmt(saldo) : 'cargos fijos'}</span></summary>
      <table class="table">
      <tr><th>Item</th><th>This month</th><th>Balance after paying</th></tr>` +
      items.map(it => it.done
        ? `<tr class="done-row"><td>✓ ${it.label} — TERMINADA</td><td class="num">—</td><td class="num">$0</td></tr>`
        : `<tr><td>${it.label}${it.redefer
            ? ` <button class="redefer-btn mini" data-type="${it.redefer.type}" data-id="${it.redefer.id}" data-cuotas="${it.redefer.cuotas}" title="Reschedule this purchase">🔄</button>`
            : ''}</td>
           <td class="num">${it.cuota ? fmt(it.cuota) : '—'}</td>
           <td class="num">${it.saldo ? fmt(it.saldo) : '—'}</td></tr>`).join('') +
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
function rachaHabito(habitId, marks) {
  let streak = 0;
  const d = new Date();
  // si hoy no está marcado, empezar a contar desde ayer (no rompe la racha aún)
  const hoyKey = `${habitId}|${localISO(d)}`;
  if (!marks.has(hoyKey)) d.setDate(d.getDate() - 1);
  for (let k = 0; k < 400; k++) {
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
    const racha = rachaHabito(h.id, marks);
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
  load();
});

$('#closeMonth').addEventListener('click', async (e) => {
  const { label, pct: p } = e.target.dataset;
  if (!await confirmModal('Cerrar el mes', `You're about to save <b>${label}</b> with <b>${(p * 100).toFixed(1)}%</b> in your Haki history. ${p >= 0.7 ? 'Month conquered! 👑' : 'Didn\'t reach 70%, but keep going.'}`, false)) return;
  await api('/api/close_month', { body: { label, pct: +p } });
  await load();
  if (+p >= 0.7) celebrate({ icon: '👑', title: 'MONTH CONQUERED', text: `<b>${label}</b> closed at <b>${(p * 100).toFixed(0)}%</b>. Your Haki grows stronger.` });
});

/* ====== ACHIEVEMENTS ====== */
function renderAchievements() {
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;
  const dmg = (S.debts || []).reduce((s, d) => s + d.abonado, 0);
  const enemigosMuertos = (S.debts || []).filter(d => (d.initial + compradoEn(d.name) - d.abonado) <= 0).length;
  const mesesGanados = (S.history || []).filter(h => h.pct >= 0.7).length;
  const metasLogradas = (S.goals || []).filter(g => g.status === 'Lograda 🏆').length;
  const abonos = (S.abonos || []).length;
  const cursosFin = (S.courses_done || []).length;
  const maxRacha = Math.max(0, ...(S.habits || []).map(h => rachaHabito(h.id, new Set(S.marks))));
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
      <div class="ach-icon">${l.got ? l.icon : '🔒'}</div>
      <div class="ach-name">${l.name}</div>
      <div class="ach-desc">${l.desc}</div>
    </div>`).join('');
}

function renderHaki() {
  const wins = S.history.filter(h => h.pct >= 0.7).length;
  const level =
    wins === 0 ? '😴 Haki asleep' :
    wins < 2 ? '👁 Observation Haki' :
    wins < 4 ? '🛡 Armament Haki' :
    wins < 6 ? '⚡ Advanced Haki' : '👑 CONQUEROR\'S HAKI';
  $('#hakiBadge').textContent = `${level} · ${wins} ${wins === 1 ? 'month' : 'months'}`;
  $('#hakiHistory').innerHTML = S.history.map(h =>
    `<span class="haki-month ${h.pct >= 0.7 ? 'win' : 'lose'}">
     ${h.label}: ${pct(h.pct)} ${h.pct >= 0.7 ? '✔' : '✘'}</span>`
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
// sincroniza la meta conectada con el progreso de carrera (sin pasar de lo que ya tenga manual si es mayor)
async function syncMeta(foco) {
  const meta = nombreMetaFoco(foco);
  if (!meta) return;
  const prog = progresoCarrera(foco);
  if (prog !== (meta.pct || 0)) {
    await api('/api/goal', { body: { id: meta.id, field: 'pct', value: prog } });
  }
}

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
  ['English — Speak + Book day', '1) Warm-up: talk about your day OUT LOUD 5 min, record it. 2) American School Way 15 min, read ALOUD. 3) Close: tell the AI in English what you read (15 min). Speaking is the goal.'],
  ['English — Shadowing day', '1) Warm-up talking 5 min. 2) Disney+/Netflix scene you KNOW, English subs. Repeat each line out loud copying the actor (shadowing) 15 min. 3) Summarize the scene to the AI in English.'],
  ['English — Vocabulary in action', '1) Talk 5 min. 2) Pick 10 words you keep forgetting, build a sentence OUT LOUD with each. 3) Tell the AI a short story using all 10 words.'],
  ['English — Book deep day', '1) Talk 5 min. 2) American School Way: redo a past unit, read aloud, do the exercises speaking the answers. 3) Explain the grammar point to the AI in your own words, in English.'],
  ['English — Pure conversation', '1) No warm-up — go straight to talking with the AI for 20-25 min about anything: work, anime, dreams. Push to talk 2 min non-stop. This is the day that breaks A2.'],
  ['English — Re-watch & produce', '1) Talk 5 min. 2) Re-watch a scene from earlier this week WITHOUT subtitles, see how much you catch. 3) Record yourself retelling it, then send it to the AI to correct.'],
  ['English — Light immersion', 'Lighter day: watch something you LOVE in English (subs on if needed). Note 5 phrases that sounded natural. Say them out loud 3 times each. Rest is part of learning.']
];
// Metas trimestrales (el progreso lo decides TÚ por tu habilidad de hablar)
const ENGLISH_TRIMESTERS = [
  { q: 'Q1 · A2 → A2+', goal: 'Talk 2 min straight in English without stopping (errors OK).', book: 'American School Way — Intermediate', subs: 'English subtitles always' },
  { q: 'Q2 · A2+ → B1', goal: 'Hold a 5-min conversation with the AI about daily topics.', book: 'American School Way — Upper-Intermediate', subs: 'Start removing subs on known scenes' },
  { q: 'Q3 · B1 → B1+', goal: 'Give opinions, tell stories in past & future, argue a point.', book: 'American School Way — Advanced', subs: 'No subtitles' },
  { q: 'Q4 · B1+ → B2', goal: 'Discuss abstract topics, understand natives at normal speed.', book: 'American School Way — Advanced / B2-C1', subs: 'Native content, no subs' }
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
  const lvl = pf.ingles_nivel || 'A1-A2';
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
  // solo actualizar si cambió, para no spamear el servidor
  if (eng.step !== step) await api('/api/career', { body: { id: eng.id, field: 'step', value: step } });
  if ((eng.pct || 0) !== pctDelPeldano && step < 4)
    await api('/api/career', { body: { id: eng.id, field: 'pct', value: pctDelPeldano } });
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
  panel.innerHTML = `
    <div class="eng-hero">
      <div class="eng-q">${t.q}</div>
      <div class="eng-goal">🎯 Speaking goal: <b>${t.goal}</b></div>
      <div class="eng-meta">📘 ${t.book} · 🎬 ${t.subs}</div>
      ${diasEnQ ? `<div class="eng-days">${diasEnQ}</div>` : ''}
    </div>
    <div class="eng-rule">⚖️ The golden rule: <b>1 minute speaking for every minute listening/reading.</b> Most people do 90% input → they understand but can't talk. You do 50/50. That's what breaks A2.</div>
    <div class="eng-blocks">
      <div class="eng-block"><span class="eng-bn">1</span> Warm-up: talk out loud about your day (record it)</div>
      <div class="eng-block"><span class="eng-bn">2</span> Input: American School Way, read ALOUD</div>
      <div class="eng-block"><span class="eng-bn">3</span> Shadowing: copy a known scene line by line</div>
      <div class="eng-block hot"><span class="eng-bn">4</span> Talk to the AI in English — the sacred block ⚔</div>
    </div>
    <div class="eng-actions">
      ${qIdx < ENGLISH_TRIMESTERS.length - 1
        ? `<button class="btn-gold" id="engNextBtn">✓ I reached the speaking goal → next quarter</button>`
        : '<span class="eng-final">🏆 Final quarter — you\'re reaching for B2/C1!</span>'}
      <button class="btn-ghost" id="engTalkBtn">💬 Practice with me now</button>
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
  if (e.target.id === 'engTalkBtn') {
    if (typeof sendPrompt === 'function')
      sendPrompt("Let's practice English. Talk to me only in English, ask me questions about my day, and gently correct my mistakes. Start now.");
    else
      toast('💬 Open a chat and tell me: "practice English with me"');
    return;
  }
  if (e.target.id === 'engHelpBtn') {
    await modal({ icon: '🔑', title: 'The real secrets',
      text: '1) Speaking is a PHYSICAL skill, not knowledge — train your mouth daily.<br>2) Comprehensible input: watch what you understand ~85%, not random new shows.<br>3) Depth > breadth: one episode 5 times beats 5 episodes once.<br>4) Forced output: after every input, retell it out loud.<br>5) Shadowing: copy natives out loud, ritme and accent.<br><br>Duolingo and passive Netflix feel like progress but barely build speaking. The discomfort of talking IS the learning.',
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
  return Math.min(Math.round((c.step || 0) * 25 + ((c.pct || 0) / 100) * 25), 100);
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
  const [ing, ingDesc] = INGLES_PLAN[wd] || INGLES_PLAN[0];
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
  acts.push({ t: '6:00', title: 'Abs + jump rope', d: '4 min abs + ~10 min jump rope (increase over time). Wake up the body. ⚡', key: 'ejercicio' });
  acts.push({ t: '6:20', title: 'Skincare AM', d: 'Cleanse + sunscreen. 5 minutes that show. 🧴', key: 'skincare' });

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
    acts.push({ t: `${h}:30`, title: 'Read (20 min) + Skincare PM', d: '20 min reading and night routine. Close the day. 📖', key: 'leer' });
    acts.push({ t: 'Sleep', title: 'Off to bed', d: 'Sleeping well is a habit on your list. Protect it like a payment.', key: 'dormir' });
  } else if (shiftKey === 'sabado' || shiftKey === 'sabado11') {
    acts.push({ t: '8:00', title: `English — ${ing}`, d: ingDesc, key: 'ingles' });
    const [si, sfin] = sh.work || [10, 18];
    acts.push({ t: `${si}:00`, title: '💼 WORK Saturday (locked)', d: 'Saturday shift. Take the rest of the day easy.', work: true, key: 'work' });
    acts.push({ t: `${sfin + 1}:00`, title: 'Light gym or a walk', d: 'Something easy, you already worked today.', key: 'gym' });
    acts.push({ t: 'Night', title: 'Read (20 min) + Skincare', d: 'Calm close, 20 min reading.', key: 'leer' });
  } else {
    acts.push({ t: '6:40', title: `English — ${ing}`, d: ingDesc, key: 'ingles' });
    acts.push({ t: '8:00', title: `DEEP study: ${focoLabel}`, d: studyDesc + ' Take advantage: day off = long project session.', key: 'estudio' });
    acts.push({ t: '11:00', title: 'Gym 🏋️', d: 'Train calmly, you have time.', key: 'gym' });
    acts.push({ t: 'Afternoon', title: 'Project / portfolio', d: 'Advance your project or a practice room.', key: 'proyecto' });
    acts.push({ t: 'Night', title: 'Read (20 min) + Skincare PM', d: '20 min reading. Close the day.', key: 'leer' });
  }
  return { rest: false, acts };
}

function bloqueEstudio(pf) {
  const active = (S.careers || []).find(c => c.active);
  return active ? `${active.course || active.name} (${active.pct || 0}%). Advance one module + take notes.`
    : 'Advance your active course + take notes.';
}

let CUR_WD = 0;
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
      <div class="rb-body"><div class="rb-title">${a.title} ${delBtn}</div><div class="rb-desc">${a.d}</div></div>
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
  if (setA) { await api('/api/career', { body: { id: +setA.dataset.career, field: 'active', value: 1 } }); toast('★ Focus updated'); load(); return; }

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
    await api('/api/career/new', { body: { name: careerName, icon } });
    if (choice === '__new__') {
      // crear la meta en Goals con un nombre alineado para que el emparejamiento la conecte
      await api('/api/goal/new', { body: { name: 'Learn ' + careerName } });
      toast('🚀 Career + goal created and linked');
    } else if (choice === '__none__') {
      toast('🚀 Career added (no goal linked)');
    } else {
      toast('🚀 Career added, linked to your goal');
      // el sync por nombre lo conectará; si el usuario eligió una meta específica,
      // igual el emparejamiento por palabras clave suele acertar.
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
  const day = c.dataset.day, act = c.dataset.act;
  const marcando = !c.classList.contains('on');

  if (marcando) {
    // CASO ESPECIAL: inglés pregunta tarea por tarea
    if (act === 'ingles') {
      const { titulo, pasos } = pasosInglesDelDia(CUR_WD);
      for (let k = 0; k < pasos.length; k++) {
        const task = pasos[k];
        const r = await modal({ icon: '🗣', title: `${titulo} · ${k + 1}/${pasos.length}`,
          text: `Did you do this part?<br><br><b>${task.d}</b>`,
          okText: 'Yes, done ✓', extraBtn: 'Not yet' });
        if (r === 'EXTRA' || r === null) {
          toast('No worries — finish the rest and check it again. 💪');
          return;   // no marca si falta alguna
        }
      }
    }
    await api('/api/routine', { body: { day, activity: act } });
    toast('✓ Done! One more step toward your goals.');
    // marcar el hábito sinónimo en Habits
    await sincronizarHabito(act, day, true);
  } else {
    const why = await modal({ icon: '🤔', title: 'Uncheck?',
      text: "Didn't get to do this? That's okay, life happens. You can note why.",
      fields: [{ type: 'text', placeholder: 'e.g. doctor appointment, plans... (optional)' }], okText: 'Uncheck' });
    if (why === null) return;
    await api('/api/routine', { body: { day, activity: act, note: why[0] || '' } });
    // al desmarcar, revisar si el hábito sinónimo debe desmarcarse
    await sincronizarHabito(act, day, false);
  }
  load();
});

// Marca/desmarca el hábito en Habits según una actividad de Life.
// Respeta sinónimos: Exercise se marca si ejercicio O gym; se desmarca solo si NINGUNA queda hecha.
function habitoDeActividad(act) {
  // actividad fija (mapa) o actividad extra (su hábito guardado en routine_extra)
  if (ACT_TO_HABIT[act]) return ACT_TO_HABIT[act];
  if (act && act.startsWith('extra_')) {
    const id = +act.slice(6);
    const ex = (S.routine_extra || []).find(x => x.id === id);
    return ex && ex.habit ? ex.habit : null;
  }
  return null;
}
async function sincronizarHabito(act, day, marcado) {
  const habitName = habitoDeActividad(act);
  if (!habitName) return;   // actividad libre, no afecta hábitos
  const habit = (S.habits || []).find(h => h.name === habitName);
  if (!habit) return;
  // ¿qué otras actividades apuntan al mismo hábito? (sinónimos: fijas + extras)
  const sinonimos = Object.keys(ACT_TO_HABIT).filter(k => ACT_TO_HABIT[k] === habitName);
  for (const ex of (S.routine_extra || [])) {
    if (ex.habit === habitName) sinonimos.push('extra_' + ex.id);
  }
  // hechas hoy según rdone (refrescamos desde S, que aún no incluye el cambio recién hecho)
  const hechasHoy = new Set((S.rdone || [])
    .filter(x => x.startsWith(day + '|'))
    .map(x => x.split('|')[1]));
  // aplicar el cambio que acabamos de hacer (S aún no lo refleja)
  if (marcado) hechasHoy.add(act); else hechasHoy.delete(act);
  const algunaHecha = sinonimos.some(s => hechasHoy.has(s));
  const marcadoActual = (S.marks || []).includes(`${habit.id}|${day}`);
  // si debe estar marcado y no lo está -> marcar; si no debe y lo está -> desmarcar
  if (algunaHecha && !marcadoActual) {
    await api('/api/habit', { body: { habit_id: habit.id, day } });
  } else if (!algunaHecha && marcadoActual) {
    await api('/api/habit', { body: { habit_id: habit.id, day } });
  }
}

// Rediferir cuotas (reschedule)
document.addEventListener('click', async (e) => {
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
  const r = await modal({ icon: '🔄', title: 'Reschedule installments',
    text: `Reschedule <b>${actualesTxt}</b>. Type ANY new number of installments — 1 (pay it all next month), 6, 12, 24, whatever you want. I take what you still owe and split it into that many, starting the month you pick. Just like the bank.`,
    fields: [
      { type: 'number', placeholder: 'New number of installments (e.g. 1, 6, 12...)', min: 1, max: 60 },
      { type: 'select', value: String(MES), options: S.plan.months.map((m, i) => ({ v: String(i), t: 'Start: ' + m })) }
    ], okText: 'Reschedule' });
  if (!r || !r[0]) return;
  const nuevas = Math.max(1, +r[0]);
  const start = +r[1];
  let endpoint, body;
  if (tipo === 'compra') {
    endpoint = '/api/compra/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas, start, pagadas };
  } else if (tipo === 'extra_debt') {
    endpoint = '/api/extra_debt/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas, start, pagadas };
  } else if (tipo === 'detalle') {
    endpoint = '/api/detalle/redefer';
    body = { id: +btn.dataset.id, cuotas: nuevas };
  } else {
    endpoint = '/api/creditor/redefer';
    body = { name: btn.dataset.name, cuotas: nuevas, start };
  }
  await api(endpoint, { body });
  toast(`🔄 Rescheduled to ${nuevas} installments`);
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
          <input class="d-edit" type="number" min="0" data-f="value" data-id="${d.id}" value="${d.value}" title="Valor (editable)">
          <input class="d-edit" type="number" min="0" data-f="saved" data-id="${d.id}" value="${d.saved}" title="Lo que llevas ahorrado">
          <div class="mini-bar green"><i style="width:${d.bought ? 100 : p * 100}%"></i></div>
          <button class="buy-btn ${d.bought ? 'on' : ''}" data-id="${d.id}">${d.bought ? '✅ Comprado' : 'Bought?'}</button>
        </div>`;
      }).join('');
  }).join('');
}
$('#dreamList').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('d-edit')) return;
  await api('/api/dream', { body: { id: +e.target.dataset.id,
    field: e.target.dataset.f, value: +e.target.value || 0 } });
  load();
});
$('#dreamList').addEventListener('click', async (e) => {
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
function renderLibros() {
  const pasa = (b) => BOOK_FILTRO === 'all' || (b.status || 'Por leer') === BOOK_FILTRO;
  const lista = S.books.filter(pasa);
  $('#bookTable').innerHTML =
    '<tr><th>Title</th><th>Status</th><th>Pages</th><th>On page</th><th>Progress</th><th></th></tr>' +
    lista.map(b => {
      const p = b.pages ? Math.min((b.status === 'Terminado' ? b.pages : b.current) / b.pages, 1) : 0;
      return `<tr><td>${esc(b.title)}</td>
        <td><select class="book-status" data-id="${b.id}">
          ${BOOK_STATES.map(([v, t]) => `<option value="${v}" ${v === b.status ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><input class="pg-input" type="number" min="0" value="${b.pages}" data-id="${b.id}" data-f="pages"></td>
        <td><input class="pg-input" type="number" min="0" value="${b.current}" data-id="${b.id}" data-f="current"></td>
        <td><div class="mini-bar green" style="width:90px"><i style="width:${p * 100}%"></i></div></td>
        <td><button class="del-x" data-type="book" data-id="${b.id}">✕</button></td></tr>`;
    }).join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#bookFilter button');
  if (!b) return;
  BOOK_FILTRO = b.dataset.f;
  document.querySelectorAll('#bookFilter button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  renderLibros();
});
$('#bookTable').addEventListener('change', async (e) => {
  const id = +e.target.dataset.id;
  if (e.target.classList.contains('book-status'))
    await api('/api/book', { body: { id, field: 'status', value: e.target.value } });
  else if (e.target.classList.contains('pg-input'))
    await api('/api/book', { body: { id, field: e.target.dataset.f, value: +e.target.value || 0 } });
  load();
});

/* ---------- BORRAR (nivel superior) ---------- */
const DEL_MSG = {
  debt_extra: 'Delete this registered debt AND remove it from the boss? Only if you added it by mistake.',
  habit: 'Delete this habit AND all its marks? It won\'t affect months already closed in Haki history.',
  goal: 'Delete this goal?',
  compra: 'Delete this installment purchase? Its installment stops adding in Home and the boss bar goes down.',
  dream: 'Delete this wish? (if you\'re not into it anymore, out)',
  book: 'Delete this book from your library?',
  anime: 'Delete this anime from the list?',
  debt: 'Delete this debt AND its logged payments? Only if you registered it by mistake.'
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.del-x');
  if (!b) return;
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
  const r = await api('/api/compra', { body: {
    creditor: $('#cpCred').value, concepto: $('#cpConcepto').value,
    valor: +$('#cpValor').value, cuotas: +$('#cpCuotas').value,
    start: +$('#cpStart').value } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('💳 Purchase logged. The system now accounts for it.');
  e.target.reset();
  load();
});

$('#debtNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!await confirmModal('Registrar deuda', 'Remember your promise: nothing new on installments. Only log it if it already exists in real life, so the boss shows its true HP.')) return;
  const r = await api('/api/debt/new', { body: {
    name: $('#ndName').value, valor: +$('#ndValor').value,
    cuotas: +$('#ndCuotas').value || 0, start: +$('#ndStart').value || 0 } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('☠ New enemy registered in the Debt Boss.');
  e.target.reset();
  load();
});

$('#dreamNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/dream/new', { body: {
    category: $('#dnCat').value, name: $('#dnName').value,
    value: +$('#dnValor').value || 0 } });
  e.target.reset();
  load();
});

$('#bookNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/book/new', { body: { title: $('#bkTitle').value } });
  e.target.reset();
  load();
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
  toast('📺 <b>' + nombre + '</b> added to your list.');
  load();
});

load();
