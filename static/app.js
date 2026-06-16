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

const FRONT_V = 16;
let MES = 0;   // mes seleccionado en Inicio (0 = julio 2026)
let ANIME_FILTRO = 'todos';   // debe coincidir con VERSION en app.py

async function api(path, opts) {
  let r;
  try {
    r = await fetch(path, opts ? {
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    } : undefined);
  } catch (err) {
    toast('⚠ No pude hablar con el servidor. ¿Está corriendo <b>python app.py</b>?', 'err');
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

function modal({ icon = '⚔', title = '', text = '', fields = [], okText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const fieldsHtml = fields.map((f, i) => f.type === 'select'
      ? `<select data-i="${i}">${f.options.map(o => `<option value="${o.v ?? o}">${o.t ?? o}</option>`).join('')}</select>`
      : `<input data-i="${i}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" value="${f.value ?? ''}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`
    ).join('');
    back.innerHTML = `<div class="modal-card">
      <div class="modal-icon">${icon}</div>
      <h3>${title}</h3>${text ? `<p>${text}</p>` : ''}
      ${fieldsHtml}
      <div class="modal-btns">
        ${fields.length || !danger ? '<button class="m-cancel">Cancelar</button>' : ''}
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
    const cancel = back.querySelector('.m-cancel');
    if (cancel) cancel.onclick = () => close(null);
    back.onclick = (e) => { if (e.target === back) close(null); };
    const first = back.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 100);
  });
}
async function confirmModal(title, text, danger = true) {
  return await modal({ icon: danger ? '⚠' : '❓', title, text, okText: 'Sí, hazlo', danger }) === true;
}

function checkVersion() {
  if (S.version === FRONT_V) return;
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="background:#e0445c;color:#fff;padding:10px 16px;text-align:center;font-weight:700">' +
    '⚠ Archivos desparejados: servidor v' + (S.version || 1) + ' / navegador v' + FRONT_V +
    '. Reemplaza app.py y reinicia el servidor (Ctrl+C → python app.py), luego Ctrl+F5.</div>');
}

async function load(animate) {
  const ym = new Date().toISOString().slice(0, 7);
  S = await api('/api/state?month=' + ym);
  checkVersion();
  renderInicio();
  renderBoss(animate);
  renderHabitos();
  renderSuenos();
  renderAnime();
  renderLibros();
  renderGoals();
  renderLife();
  renderHaki();
}

/* ---------- INICIO ---------- */
function renderInicio() {
  const sel = $('#monthSel');
  if (!sel.options.length) {
    S.plan.months.forEach((m, i) => sel.add(new Option(m, i)));
    sel.onchange = renderInicio;
  }
  const i = +sel.value || 0;
  MES = i;
  const p = S.plan;
  const ingreso = p.salario + p.extra[i];
  const deudas = Object.entries(p.creditors)
    .map(([n, arr]) => [n, arr[i] + extraCuota(n, i), extraCuota(n, i)])
    .filter(d => d[1] > 0);
  (S.extra_debts || []).filter(d => d.cuotas >= 1 && i >= d.start && i < d.start + d.cuotas)
    .forEach(d => deudas.push([d.name + ' (registrada)', d.cuota, 0]));
  const totalDeudas = deudas.reduce((s, d) => s + d[1], 0);
  const egresos = p.vida + p.ahorro + totalDeudas;
  const saldo = ingreso - egresos;

  $('#kpis').innerHTML = `
    <div class="card"><label>Ingreso del mes</label><strong>${fmt(ingreso)}</strong></div>
    <div class="card red"><label>Deudas del mes</label><strong>${fmt(totalDeudas)}</strong></div>
    <div class="card"><label>Vida + ahorro</label><strong>${fmt(p.vida + p.ahorro)}</strong></div>
    <div class="card ${saldo >= 0 ? 'green' : 'red'}"><label>Saldo esperado</label><strong>${fmt(saldo)}</strong></div>` +
    (() => {
      const crecioCompras = deudas.reduce((s, d) => s + d[2], 0);
      const cuotasReg = extraDebtCuota(i);
      const sinCuotas = (S.extra_debts || []).filter(d => !(d.cuotas >= 1)).reduce((s, d) => s + d.total, 0);
      const crecio = crecioCompras + cuotasReg;
      let html = '';
      if (crecio > 0)
        html += `<div class="card red"><label>📈 Deuda creció este mes</label><strong>+${fmt(crecio)}</strong></div>`;
      if (sinCuotas > 0)
        html += `<div class="card red"><label>☠ Deudas registradas sin cuotas (saldo)</label><strong>${fmt(sinCuotas)}</strong></div>`;
      return html;
    })();

  $('#pagosTable').innerHTML =
    deudas.map(d => `<tr><td>${d[0]}${d[2] > 0 ? ` <small class="grew" title="incluye compra a cuotas">📈 +${fmt(d[2])}</small>` : ''}</td><td class="num">${fmt(d[1])}</td></tr>`).join('') +
    `<tr><th>Total deudas</th><th class="num">${fmt(totalDeudas)}</th></tr>`;

  const dPct = totalDeudas / ingreso;
  $('#diagnostico').textContent =
    dPct > 0.5 ? '⚔ MODO GUERRA: la deuda se come más de la mitad del ingreso. Aguanta, cada mes baja.' :
    dPct > 0.3 ? '🛡 RESISTIENDO: la deuda aún pesa más que el ideal. Vas por buen camino.' :
    '👑 ZONA 50/30/20: la deuda ya cabe en la regla. Hora de soltar plata a gustos y sueños.';

  const data = {
    labels: ['Necesidades', 'Ahorro', 'Deudas', 'Colchón libre'],
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
  renderDesglose();
}

/* ---------- CHECKLIST DE PAGOS ---------- */
function renderChecklist(i, deudas) {
  const mk = monthKey(i);
  const checks = new Set(S.checks);
  const row = (item, val, extra) => {
    const paid = checks.has(`${item}|${mk}`);
    return `<div class="check-item ${paid ? 'paid' : ''}" data-item="${item}" data-mk="${mk}">
      <div class="box">${paid ? '✓' : ''}</div>
      <span class="cname">${item}</span>
      <small>${extra || ''}</small>
      <span class="cval">${fmt(val)}</span></div>`;
  };
  $('#checkServicios').innerHTML = S.servicios
    .map(s => row(s[0], s[1], `${s[2]} · ${s[3]}`)).join('');
  $('#checkDeudas').innerHTML = deudas
    .map(d => row(d[0], d[1], 'cuota del mes')).join('');
  const total = S.servicios.length + deudas.length;
  const done = [...checks].filter(c => c.endsWith('|' + mk)).length;
  $('#checkCount').textContent = `${done} / ${total} pagados`;
}

document.addEventListener('click', async (e) => {
  const c = e.target.closest('.check-item');
  if (!c) return;
  await api('/api/check', { body: { item: c.dataset.item, month: c.dataset.mk } });
  load();
});

/* ---------- ALCANCÍA / BOSS ---------- */
function renderBoss(animate) {
  const init = S.debts.reduce((s, d) => s + d.initial + compradoEn(d.name), 0)
    + (S.extra_debts || []).reduce((s, d) => s + d.total, 0);
  const dmg = S.debts.reduce((s, d) => s + d.abonado, 0);
  const rest = init - dmg;
  $('#bossInit').textContent = fmt(init);
  $('#bossDmg').textContent = fmt(dmg);
  $('#bossRest').textContent = fmt(rest);
  requestAnimationFrame(() =>
    $('#bossHp').style.width = Math.max(0, (rest / init) * 100) + '%');

  const sel = $('#abonoDebt');
  sel.innerHTML = S.debts
    .filter(d => d.initial + compradoEn(d.name) - d.abonado > 0)
    .map(d => `<option value="${d.id}">${d.name} (${fmt(d.initial + compradoEn(d.name) - d.abonado)})</option>`).join('');

  const extraBars = (S.extra_debts || []).map(d => {
    const cuotaTxt = d.cuotas >= 1
      ? `${d.cuotas} cuotas de ${fmt(d.cuota)} desde ${S.plan.months[d.start] || '—'}`
      : 'sin cuotas (abónale cuando puedas)';
    return `<div class="debt-item">
      <div class="row-between"><span>☠ ${d.name}
        <button class="del-x" data-type="debt_extra" data-id="${d.id}" title="Borrar deuda">✕</button></span>
        <strong>${fmt(d.total)}</strong></div>
      <div class="mini-bar"><i style="width:100%"></i></div>
      <small>${cuotaTxt}</small></div>`;
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
    .map((m, ix) => `<option value="${ix}">1ª cuota: ${m}</option>`).join('');
  $('#ndStart').innerHTML = '<option value="0">1ª cuota: mes inicial</option>' + S.plan.months
    .map((m, ix) => `<option value="${ix}">1ª cuota: ${m}</option>`).join('');
  $('#compraList').innerHTML = S.compras.map(c =>
    `<li><span>${c.creditor} · ${c.concepto} · ${c.cuotas} x ${fmt(cuotaDe(c))} desde ${S.plan.months[c.start]}</span>
     <span>${fmt(c.valor)} <button class="del-x" data-type="compra" data-id="${c.id}">✕</button></span></li>`
  ).join('') || '<li>Sin compras nuevas a cuotas. Que siga así. 🙏</li>';

  renderDesglose();

  $('#abonoList').innerHTML = S.abonos.map(a =>
    `<li><span>${a.fecha} · ${a.name}</span>
     <span>${fmt(a.valor)} <button class="del" data-id="${a.id}" title="Deshacer">✕</button></span></li>`
  ).join('') || '<li>Aún sin ataques. El primer abono es el más importante.</li>';
}

$('#abonoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = +$('#abonoValor').value;
  const r = await api('/api/abono', { body: { debt_id: +$('#abonoDebt').value, valor } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('⚔ ¡Golpe de <b>' + fmt(valor) + '</b> al jefe!');
  const f = $('#dmgFloat');
  f.textContent = '−' + fmt(valor);
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  $('#abonoValor').value = '';
  load(true);
});

$('#abonoList').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('del')) return;
  if (!await confirmModal('Deshacer abono', '¿Quieres deshacer este ataque? El daño se le devuelve al jefe.')) return;
  await api('/api/abono/' + e.target.dataset.id, { method: 'DELETE' });
  load();
});

/* ---------- DESGLOSE ---------- */
function calcItem(it, i) {
  const [nombre, cuota, pagadas, total, fijo] = it;
  if (total == null) {                       // cargo fijo o saldo libre, no envejece
    return { label: nombre, cuota, saldo: fijo || 0, done: false };
  }
  const num = pagadas + i + 1;               // cuota que se paga en el mes elegido
  if (num > total) {
    return { label: nombre, cuota: 0, saldo: 0, done: true };
  }
  return { label: `${nombre} · cuota ${num}/${total}`, cuota,
           saldo: cuota * (total - num), done: false };
}

function renderDesglose() {
  const i = MES;
  const filas = {};
  for (const [g, items] of Object.entries(S.detalle)) {
    filas[g] = items.map(it => calcItem(it, i));
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
        done: num > d.cuotas
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
      label: `💳 ${c.concepto}` + (activa ? ` · cuota ${num}/${c.cuotas}` : ` (${c.cuotas} cuotas desde ${S.plan.months[c.start]})`),
      cuota: activa ? cuotaDe(c) : 0,
      saldo: Math.max(c.valor - cuotaDe(c) * pagadas, 0),
      done: num > c.cuotas
    });
  }
  let total = 0;
  let html = `<p class="hint">Calculado para <b>${S.plan.months[i]}</b> — cámbialo con el selector de mes en Inicio y mira las cuotas avanzar solas.</p>`;
  html += Object.entries(filas).map(([grupo, items]) => {
    const saldo = items.reduce((s, it) => s + it.saldo, 0);
    if (!grupo.startsWith('Nómina')) total += saldo;
    return `<details><summary><span>${grupo}</span>
      <span class="sum-val">${saldo ? fmt(saldo) : 'cargos fijos'}</span></summary>
      <table class="table">
      <tr><th>Concepto</th><th>Cuota del mes</th><th>Saldo tras pagar</th></tr>` +
      items.map(it => it.done
        ? `<tr class="done-row"><td>✓ ${it.label} — TERMINADA</td><td class="num">—</td><td class="num">$0</td></tr>`
        : `<tr><td>${it.label}</td>
           <td class="num">${it.cuota ? fmt(it.cuota) : '—'}</td>
           <td class="num">${it.saldo ? fmt(it.saldo) : '—'}</td></tr>`).join('') +
      '</table></details>';
  }).join('');
  html += `<div class="desglose-total"><span>TOTAL DEUDA EN ${S.plan.months[i].toUpperCase()} (sin nómina)</span>
    <span>${fmt(total)}</span></div>`;
  $('#desglose').innerHTML = html;
}

/* ---------- HÁBITOS ---------- */
function renderHabitos() {
  const today = new Date(S.today);
  const ym = S.today.slice(0, 7);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const elapsed = today.getDate();
  const monthName = today.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  $('#habitMonthTitle').textContent = 'Hábitos · ' + monthName;

  const marks = new Set(S.marks);
  let html = '<tr><th></th>';
  for (let d = 1; d <= daysInMonth; d++) html += `<th>${d}</th>`;
  html += '</tr>';
  S.habits.forEach(h => {
    html += `<tr><td class="hname">${h.name} <button class="del-x" data-type="habit" data-id="${h.id}">✕</button></td>`;
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
    <div class="card gold"><label>Cumplimiento del mes</label><strong>${pct(globalPct)}</strong></div>
    <div class="card"><label>Días transcurridos</label><strong>${elapsed} / ${daysInMonth}</strong></div>`;
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
  if (!await confirmModal('Cerrar el mes', `Vas a guardar <b>${label}</b> con <b>${(p * 100).toFixed(1)}%</b> en tu historial de Haki. ${p >= 0.7 ? '¡Mes conquistado! 👑' : 'No llegó al 70%, pero sigue.'}`, false)) return;
  await api('/api/close_month', { body: { label, pct: +p } });
  load();
});

function renderHaki() {
  const wins = S.history.filter(h => h.pct >= 0.7).length;
  const level =
    wins === 0 ? '😴 Haki dormido' :
    wins < 2 ? '👁 Haki de Observación' :
    wins < 4 ? '🛡 Haki de Armamento' :
    wins < 6 ? '⚡ Haki avanzado' : '👑 HAKI DEL REY CONQUISTADOR';
  $('#hakiBadge').textContent = `${level} · ${wins} ${wins === 1 ? 'mes' : 'meses'}`;
  $('#hakiHistory').innerHTML = S.history.map(h =>
    `<span class="haki-month ${h.pct >= 0.7 ? 'win' : 'lose'}">
     ${h.label}: ${pct(h.pct)} ${h.pct >= 0.7 ? '✔' : '✘'}</span>`
  ).join('') || '<span class="hint">Cierra tu primer mes para empezar a ganar Haki. El Rey exige 6 meses ≥70%.</span>';
}

/* ---------- METAS ---------- */
function renderGoals() {
  const won = S.goals.filter(g => g.status === 'Lograda 🏆').length;
  const fuego = S.goals.filter(g => g.status === 'En proceso 🔥').length;
  $('#goalStats').innerHTML = `
    <div class="card gold"><label>Metas logradas</label><strong>${won} / ${S.goals.length}</strong></div>
    <div class="card"><label>En proceso 🔥</label><strong>${fuego}</strong></div>`;
  const estados = ['Pendiente', 'En proceso 🔥', 'Lograda 🏆'];
  $('#goalTable').innerHTML =
    '<tr><th>Meta</th><th>¿Por qué la quieres?</th><th>Fecha</th><th>Estado</th><th>%</th><th>Progreso</th><th>Próximo paso</th><th></th></tr>' +
    S.goals.map(g => {
      const p = Math.min(Math.max(g.pct || 0, 0), 100);
      const bar = '█'.repeat(Math.round(p / 5)) + '░'.repeat(20 - Math.round(p / 5));
      return `<tr class="${g.status === 'Lograda 🏆' ? 'goal-won' : ''}">
        <td><input class="g-edit wide" data-id="${g.id}" data-f="name" value="${esc(g.name)}"></td>
        <td><input class="g-edit wide" data-id="${g.id}" data-f="why" value="${esc(g.why)}" placeholder="tu razón en una frase"></td>
        <td><input class="g-edit" data-id="${g.id}" data-f="target" value="${esc(g.target)}" style="width:84px"></td>
        <td><select class="g-edit" data-id="${g.id}" data-f="status">
          ${estados.map(s => `<option ${s === g.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><input class="g-edit" type="number" min="0" max="100" data-id="${g.id}" data-f="pct" value="${p}" style="width:64px"></td>
        <td class="bar-cell">${bar}</td>
        <td><input class="g-edit wide" data-id="${g.id}" data-f="next_step" value="${esc(g.next_step)}" placeholder="siguiente acción pequeña"></td>
        <td><button class="del-x" data-type="goal" data-id="${g.id}">✕</button></td></tr>`;
    }).join('');
}
$('#goalTable').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('g-edit')) return;
  await api('/api/goal', { body: { id: +e.target.dataset.id, field: e.target.dataset.f, value: e.target.value } });
  load();
});

/* ====== PELDAÑOS DE CARRERA (Data / Ciber) ====== */
const PELDANOS = ['Fundamentos', 'Intermedio', 'Proyectos', 'Profesional'];
const PELDANO_DESC = [
  'Lo básico: SQL, Excel, Python intro, conceptos. Tu curso actual vive aquí.',
  'Profundizas: estadística, limpieza de datos, visualización, consultas complejas.',
  'Construyes: 2-3 proyectos reales en tu portafolio (GitHub, dashboards).',
  'El sello: un certificado fuerte (Google Data Analytics, CompTIA Security+) + listo para trabajar.'
];
const PELDANO_DESC_CIBER = [
  'Lo básico: redes, Linux, conceptos de seguridad. Cisco "Intro a Ciberseguridad".',
  'Profundizas: TryHackMe rooms, criptografía básica, análisis de vulnerabilidades.',
  'Practicas: máquinas resueltas, writeups, un mini-portafolio de hacking ético.',
  'El sello: certificado fuerte (CompTIA Security+) + listo para trabajar.'
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
  'sabado': { label: 'Sábado 10am – 6pm', work: [10, 18] },
  'sabado11': { label: 'Sábado 11am – 7pm', work: [11, 19] },
  'libre': { label: 'Libre', work: null },
  'descanso': { label: 'Descanso', work: null }
};
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// inglés A1-A2 → C1: qué tocar cada día de la semana
const INGLES_PLAN = [
  ['Inglés (20 min) — Gramática', 'Language Transfer (audio), 1 lección. Estructuras simples: to be, presente, pasado. 20 min enfocados.'],
  ['Inglés (20 min) — Vocabulario', '15 palabras nuevas en Anki. Repasa las de ayer. Apunta las que veas en el trabajo.'],
  ['Inglés (20 min) — Listening', 'VOA Learning English (beginner). Subtítulos en inglés y repite en voz alta (shadowing).'],
  ['Inglés (20 min) — Speaking', 'ELSA Speak + describe tu día en voz alta. Grábate 1 min y escúchate.'],
  ['Inglés (20 min) — Reading', 'Graded readers o noticias VOA. Subraya lo que no entiendas, búscalo después.'],
  ['Inglés (20 min) — Repaso', 'Repasa la semana. Si ves anime hoy, ponlo con subtítulos en inglés y anota 5 frases.'],
  ['Inglés (15 min) — Suave', 'Solo lo que más te gustó esta semana. Mente descansada también aprende.']
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
  $('#pfFoco').innerHTML = ['Data', 'Ciber'].map(v =>
    `<option value="${v}" ${(pf.foco2 || 'Data') === v ? 'selected' : ''}>${v === 'Data' ? '🎯 Analítica de Datos' : '🎯 Ciberseguridad'}</option>`).join('');
  // sincronizar ambas metas con su progreso de carrera al cargar
  syncMeta('Data'); syncMeta('Ciber');

  // 2. Selector de día (próximos 7 días desde hoy)
  const pick = $('#dayPick');
  if (!pick.dataset.ready) {
    const base = new Date(S.today);
    let opts = '';
    for (let k = 0; k < 7; k++) {
      const d = new Date(base); d.setDate(base.getDate() + k);
      const iso = d.toISOString().slice(0, 10);
      const wd = (d.getDay() + 6) % 7;
      opts += `<option value="${iso}|${wd}">${k === 0 ? 'HOY · ' : ''}${DIAS[wd]} ${d.getDate()}/${d.getMonth() + 1}</option>`;
    }
    pick.innerHTML = opts;
    pick.dataset.ready = '1';
    pick.onchange = renderRoutineDay;
  }
  renderRoutineDay();

  // Panel de carrera con peldaños (Data y Ciber)
  renderCareer(pf);
  // Progreso REAL del foco según días de estudio cumplidos (no un salto a 100)
  const focoMeta = (S.goals || []).find(g => {
    const n = (g.name || '').toLowerCase();
    return (pf.foco2 || 'Data') === 'Ciber'
      ? /ciber|cyber|security|seguridad/.test(n)
      : /data|anal[íi]tic|datos/.test(n);
  });
  const diasEstudio = (S.rdone || []).filter(x => x.endsWith('|estudio') || x.endsWith('|proyecto')).length;
  // 3. Consejo de la semana según foco
  const foco = pf.foco2 || 'Data';
  const pct = +pf.data_pct || 0;
  let tip = `Tu inglés está en ${pf.ingles_nivel || 'A1-A2'}: la constancia diaria pesa más que las maratones. 30 min TODOS los días te llevan al C1, no 3 horas un solo día. `;
  if (foco === 'Data') {
    tip += pct < 30 ? `Vas en ${pct}% de tu curso: céntrate en fundamentos y SQL. Practica en SQLBolt en paralelo.`
      : pct < 70 ? `${pct}% del curso: ya puedes empezar tu primer proyecto en Looker Studio con datos reales (¡los de este Life OS!).`
      : `${pct}%: recta final. Sube 2 proyectos a GitHub y arma tu LinkedIn en inglés. Después: Data Engineering Zoomcamp.`;
  } else {
    tip += 'Foco en Ciberseguridad: arranca con Cisco "Introducción a la Ciberseguridad" (gratis, español) y TryHackMe los fines de semana.';
  }
  tip += ` Llevas ${diasEstudio} ${diasEstudio === 1 ? 'sesión' : 'sesiones'} de estudio registradas — cada ✓ es progreso real. El 100% de una meta no se regala: se gana día a día, y tú decides cuándo de verdad llegaste.`;
  // Sugerir actualizar el % de la meta conectada, sin forzarlo
  if (focoMeta) {
    const gp = focoMeta.pct || 0;
    tip += ` Tu meta "${focoMeta.name}" va en ${gp}%: súbelo TÚ en la pestaña Metas cuando sientas el avance, no antes.`;
  }
  $('#lifeTip').textContent = tip;
}

function renderCareer(pf) {
  const wrap = document.getElementById('careerPanel');
  if (!wrap) return;
  const bloque = (foco) => {
    const isCiber = foco === 'Ciber';
    const cursoK = isCiber ? 'ciber_curso' : 'data_curso';
    const pctK = isCiber ? 'ciber_pct' : 'data_pct';
    const stepK = isCiber ? 'ciber_step' : 'data_step';
    const step = +(pf[stepK] || 0);
    const pct = +(pf[pctK] || 0);
    const prog = progresoCarrera(foco);
    const descs = isCiber ? PELDANO_DESC_CIBER : PELDANO_DESC;
    const dots = PELDANOS.map((p, i) =>
      `<span class="peldano ${i < step ? 'done' : i === step ? 'now' : ''}">${i < step ? '✓' : i + 1}. ${p}</span>`).join('');
    return `<div class="career-card">
      <div class="career-head"><b>${isCiber ? '🛡 Ciberseguridad' : '📊 Analítica de Datos'}</b>
        <span class="career-prog">${prog}% de la meta</span></div>
      <div class="peldano-row">${dots}</div>
      <div class="mini-bar green" style="margin:8px 0"><i style="width:${prog}%"></i></div>
      <div class="abono-form" style="margin-top:8px">
        <select data-pf="${stepK}" style="flex:2">
          ${PELDANOS.map((p, i) => `<option value="${i}" ${i === step ? 'selected' : ''}>Peldaño ${i + 1}: ${p}</option>`).join('')}
        </select>
        <input data-pf="${cursoK}" placeholder="Curso actual" value="${esc(pf[cursoK] || '')}" style="flex:2">
        <input data-pf="${pctK}" type="number" min="0" max="100" value="${pct}" placeholder="% curso" style="flex:1">
      </div>
      <p class="hint" style="margin:6px 0 0">${descs[step]}</p>
    </div>`;
  };
  wrap.innerHTML = bloque('Data') + bloque('Ciber');
}

function actividadesDelDia(wd, shiftKey) {
  const sh = SHIFTS[shiftKey] || SHIFTS.libre;
  const pf = S.profile || {};
  const foco = pf.foco2 || 'Data';
  const focoLabel = foco === 'Data' ? 'Analítica de Datos' : 'Ciberseguridad';
  const [ing, ingDesc] = INGLES_PLAN[wd] || INGLES_PLAN[0];

  if (shiftKey === 'descanso') {
    return { rest: true, msg: 'Domingo de descanso 🌿', acts: [
      { t: '9:00', title: 'Despertar sin alarma', d: 'Descansa de verdad. El cuerpo también entrena descansando.' },
      { t: '10:00', title: 'Skincare + algo rico', d: 'Cuida tu piel sin prisa.' },
      { t: 'Libre', title: 'Lectura ligera o anime', d: '1 capítulo de un libro o un episodio. Disfruta sin culpa.' },
      { t: 'Noche', title: 'Planea la semana', d: 'Mira tu horario y ajusta los turnos en esta pestaña.' }
    ]};
  }

  const acts = [];
  acts.push({ t: '6:00', title: 'Saltar lazo + ejercicio', d: '4 min de lazo + abdominales. Enciende el cuerpo. ⚡', key: 'ejercicio' });
  acts.push({ t: '6:20', title: 'Skincare AM', d: 'Limpieza + protector solar. 5 min que se notan. 🧴', key: 'skincare' });

  if (sh.work) {
    const [ini, fin] = sh.work;
    // antes del trabajo: si entra a las 9 o 12, mete inglés/estudio en la mañana
    if (ini >= 9) {
      acts.push({ t: `6:40`, title: `Inglés — ${ing}`, d: ingDesc, key: 'ingles' });
      if (ini >= 12) acts.push({ t: '8:30', title: `Estudio: ${focoLabel}`, d: bloqueEstudio(pf), key: 'estudio' });
    }
    acts.push({ t: `${ini}:00`, title: '💼 WORK (bloqueado)', d: 'Solo trabajo, cursos de Softtek, o adelantar Coursera en los ratos libres.', work: true, key: 'work' });
    // después del trabajo
    let h = fin + 1;
    if (ini < 9) { acts.push({ t: `${h}:00`, title: `Inglés — ${ing}`, d: ingDesc, key: 'ingles' }); h += 1; }
    acts.push({ t: `${h}:00`, title: `Estudio: ${focoLabel}`, d: bloqueEstudio(pf), key: 'estudio' }); h += 1;
    acts.push({ t: `${h}:00`, title: 'Gym 🏋️', d: 'Tu hora de hierro. No la negocies.', key: 'gym' }); h += 1;
    acts.push({ t: `${h}:30`, title: 'Leer (20 min) + Skincare PM', d: '20 min de lectura y rutina de noche. Cierra el día. 📖', key: 'leer' });
    acts.push({ t: 'Dormir', title: 'A la cama', d: 'Dormir bien es un hábito de tu lista. Protégelo como un pago.', key: 'dormir' });
  } else if (shiftKey === 'sabado') {
    acts.push({ t: '8:00', title: `Inglés — ${ing}`, d: ingDesc, key: 'ingles' });
    acts.push({ t: '10:00', title: '💼 WORK sábado (bloqueado)', d: 'Turno de sábado. Suave con el resto del día.', work: true, key: 'work' });
    acts.push({ t: '19:00', title: 'Gym ligero o caminar', d: 'Algo suave, ya trabajaste hoy.', key: 'gym' });
    acts.push({ t: 'Noche', title: 'Leer (20 min) + Skincare', d: 'Cierre tranquilo, 20 min de lectura.', key: 'leer' });
  } else {
    // día libre entre semana: sesión profunda
    acts.push({ t: '6:40', title: `Inglés — ${ing}`, d: ingDesc, key: 'ingles' });
    acts.push({ t: '8:00', title: `Estudio PROFUNDO: ${focoLabel}`, d: bloqueEstudio(pf) + ' Aprovecha: día libre = sesión larga de proyecto.', key: 'estudio' });
    acts.push({ t: '11:00', title: 'Gym 🏋️', d: 'Entrena con calma, tienes tiempo.', key: 'gym' });
    acts.push({ t: 'Tarde', title: 'Proyecto / portafolio', d: 'Avanza tu proyecto de datos o una room de ciberseguridad.', key: 'proyecto' });
    acts.push({ t: 'Noche', title: 'Leer (20 min) + Skincare PM', d: '20 min de lectura. Cierra el día.', key: 'leer' });
  }
  return { rest: false, acts };
}

function bloqueEstudio(pf) {
  const pct = +(pf.data_pct || 0);
  if ((pf.foco2 || 'Data') === 'Ciber')
    return 'Cisco Skills for All + 1 room de TryHackMe. Anota comandos de Linux nuevos.';
  return `Google Data Analytics (vas en ${pct}%). Avanza 1 módulo + 20 min de SQLBolt. Toma notas de lo que practicas.`;
}

function renderRoutineDay() {
  const val = $('#dayPick').value;
  if (!val) return;
  const [iso, wdStr] = val.split('|');
  const wd = +wdStr;
  const shiftKey = (S.shifts || {})[wd] || 'libre';
  const { rest, acts, msg } = actividadesDelDia(wd, shiftKey);
  const done = new Set(S.rdone || []);
  let html = '';
  if (rest && msg) html += `<div class="rest-day"><div class="big">🌿</div><p>${msg}</p></div>`;
  html += acts.map(a => {
    const isDone = done.has(`${iso}|${a.key}`);
    return `<div class="routine-block ${a.work ? 'work' : ''} ${isDone ? 'done' : ''}">
      <span class="rb-time">${a.t}</span>
      <div class="rb-body"><div class="rb-title">${a.title}</div><div class="rb-desc">${a.d}</div></div>
      <button class="rb-check ${isDone ? 'on' : ''}" data-day="${iso}" data-act="${a.key}">${isDone ? '✓' : ''}</button>
    </div>`;
  }).join('');
  $('#routineDay').innerHTML = html;
}

// listeners de Life
document.addEventListener('change', async (e) => {
  if (e.target.matches('#shiftGrid select')) {
    await api('/api/shift', { body: { weekday: +e.target.dataset.wd, shift: e.target.value } });
    toast('📅 Turno actualizado.');
    load();
  } else if (e.target.id === 'pfFoco') {
    await api('/api/profile', { body: { key: 'foco2', value: e.target.value } });
    load();
  } else if (e.target.matches('[data-pf]')) {
    await api('/api/profile', { body: { key: e.target.dataset.pf, value: e.target.value } });
    load();
  }
});
document.addEventListener('click', async (e) => {
  const c = e.target.closest('.rb-check');
  if (!c) return;
  const day = c.dataset.day, act = c.dataset.act;
  if (!c.classList.contains('on')) {
    // permitir registrar por qué no se hizo (opcional) -> aquí solo lo marca hecho
    await api('/api/routine', { body: { day, activity: act } });
    toast('✓ ¡Hecho! Un golpe más a tus metas.');
  } else {
    const why = await modal({ icon: '🤔', title: '¿Desmarcar?',
      text: '¿No alcanzaste a hacer esto? Está bien, la vida pasa. Puedes anotar por qué.',
      fields: [{ type: 'text', placeholder: 'ej: cita médica, planes... (opcional)' }], okText: 'Desmarcar' });
    if (why === null) return;
    await api('/api/routine', { body: { day, activity: act, note: why[0] || '' } });
  }
  load();
});

/* ---------- SUEÑOS ---------- */
function renderSuenos() {
  const cats = [...new Set(S.dreams.map(d => d.category))];
  $('#dreamList').innerHTML = cats.map(cat => {
    const items = S.dreams.filter(d => d.category === cat);
    const comprados = items.filter(d => d.bought).length;
    return `<div class="dream-cat">${cat} <small>· ${comprados}/${items.length} comprados ✅</small></div>` +
      items.map(d => {
        const p = d.value ? Math.min(d.saved / d.value, 1) : 0;
        return `<div class="dream-item ${d.bought ? 'bought-item' : ''}">
          <span class="dname">${esc(d.name)} <button class="del-x" data-type="dream" data-id="${d.id}">✕</button></span>
          <input class="d-edit" type="number" min="0" data-f="value" data-id="${d.id}" value="${d.value}" title="Valor (editable)">
          <input class="d-edit" type="number" min="0" data-f="saved" data-id="${d.id}" value="${d.saved}" title="Lo que llevas ahorrado">
          <div class="mini-bar green"><i style="width:${d.bought ? 100 : p * 100}%"></i></div>
          <button class="buy-btn ${d.bought ? 'on' : ''}" data-id="${d.id}">${d.bought ? '✅ Comprado' : '¿Comprado?'}</button>
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
    <div class="card gold"><label>Viéndolo ahora 👀</label><strong>${viendo}</strong></div>
    <div class="card green"><label>Finalizados ✅</label><strong>${fin}</strong></div>
    <div class="card"><label>En la lista</label><strong>${S.animes.length}</strong></div>`;
  const pasa = (a) => ANIME_FILTRO === 'todos' || (a.estado || 'Pendiente') === ANIME_FILTRO
    || (ANIME_FILTRO === 'Pendiente' && !a.estado);
  const ranked = S.animes.filter(a => a.score != null && pasa(a));
  const rest = S.animes.filter(a => a.score == null && pasa(a));
  const estados = ['', 'Viéndolo 👀', 'En emisión 📡', 'Finalizado ✅', 'Pendiente'];
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
      ? `<button class="add-temp" data-id="${a.id}" data-next="t${nTemps + 1}" title="Añadir temporada nueva">+ temp</button>` : '';
    return `<tr class="${estadoCls}">
      <td class="${rank === 1 ? 'rank-1' : ''}">${rank ? (rank === 1 ? '👑 1' : '#' + rank) : '—'}</td>
      <td class="an-name ${rank === 1 ? 'rank-1' : ''}">${esc(a.name)} ${addBtn}</td>` +
    BLOQUES.map(([f]) => celda(a, f)).join('') +
    `<td><select class="a-edit" data-id="${a.id}" data-f="estado">
      ${estados.map(s => `<option value="${s}" ${(a.estado || '') === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></td>
    <td><input class="a-edit score-input" type="number" step="0.1" min="0" max="100"
        data-f="score" data-id="${a.id}" value="${a.score ?? ''}" placeholder="0-100"></td>
    <td><button class="del-x" data-type="anime" data-id="${a.id}">✕</button></td></tr>`;
  };
  const ths = BLOQUES.map(([, lbl]) => `<th>${lbl}</th>`).join('');
  let rank = 0;
  $('#animeTable').innerHTML =
    '<tr><th>TOP</th><th>Anime</th>' + ths + '<th>Estado</th><th>Pt</th><th></th></tr>' +
    ranked.map(a => fila(a, ++rank)).join('') +
    rest.map(a => fila(a, 0)).join('');
}
$('#animeTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('.add-temp');
  if (!btn) return;
  const next = btn.dataset.next;
  const lbl = 'T' + next.slice(1);
  const r = await modal({ icon: '✨', title: 'Nueva temporada',
    text: `¿Cuántos episodios tiene la <b>${lbl}</b>? Se añadirá solo a este anime.`,
    fields: [{ type: 'number', placeholder: 'Episodios de ' + lbl, min: 1 }], okText: 'Añadir ' + lbl });
  if (!r || !r[0]) return;
  await api('/api/anime', { body: { id: +btn.dataset.id, field: next, value: r[0] } });
  toast('✨ ' + lbl + ' añadida.');
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
function renderLibros() {
  const states = ['Por comprar', 'Por leer', 'Leyendo', 'Terminado'];
  $('#bookTable').innerHTML =
    '<tr><th>Título</th><th>Estado</th><th>Págs</th><th>Voy en</th><th>Progreso</th><th></th></tr>' +
    S.books.map(b => {
      const p = b.pages ? Math.min((b.status === 'Terminado' ? b.pages : b.current) / b.pages, 1) : 0;
      return `<tr><td>${b.title}</td>
        <td><select class="book-status" data-id="${b.id}">
          ${states.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select></td>
        <td><input class="pg-input" type="number" min="0" value="${b.pages}" data-id="${b.id}" data-f="pages"></td>
        <td><input class="pg-input" type="number" min="0" value="${b.current}" data-id="${b.id}" data-f="current"></td>
        <td><div class="mini-bar green" style="width:90px"><i style="width:${p * 100}%"></i></div></td>
        <td><button class="del-x" data-type="book" data-id="${b.id}">✕</button></td></tr>`;
    }).join('');
}
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
  debt_extra: '¿Borrar esta deuda registrada Y quitarla del jefe? Solo si la metiste por error.',
  habit: '¿Borrar este hábito Y todas sus x marcadas? No afecta los meses ya cerrados en el historial de Haki.',
  goal: '¿Borrar esta meta?',
  compra: '¿Borrar esta compra a cuotas? Su cuota dejará de sumarse en Inicio y la barra del enemigo baja.',
  dream: '¿Borrar este sueño? (si ya no te interesa, fuera)',
  book: '¿Borrar este libro de la biblioteca?',
  anime: '¿Borrar este anime de la lista?',
  debt: '¿Borrar esta deuda Y sus abonos registrados? Solo hazlo si la registraste por error.'
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
  if (!await confirmModal('Compra a cuotas', 'Esto rompe tu promesa de cero cuotas nuevas. Regístrala solo si YA pasó en la vida real, para que el sistema diga la verdad.')) return;
  const r = await api('/api/compra', { body: {
    creditor: $('#cpCred').value, concepto: $('#cpConcepto').value,
    valor: +$('#cpValor').value, cuotas: +$('#cpCuotas').value,
    start: +$('#cpStart').value } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('💳 Compra registrada. El sistema ya la tiene en cuenta.');
  e.target.reset();
  load();
});

$('#debtNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!await confirmModal('Registrar deuda', 'Recuerda tu promesa: nada nuevo a cuotas. Solo regístrala si ya existe en la vida real, para que el jefe muestre su HP verdadero.')) return;
  const r = await api('/api/debt/new', { body: {
    name: $('#ndName').value, valor: +$('#ndValor').value,
    cuotas: +$('#ndCuotas').value || 0, start: +$('#ndStart').value || 0 } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('☠ Nuevo enemigo registrado en la Alcancía.');
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
    { type: 'number', placeholder: 'Episodios T1', min: 0 },
    { type: 'number', placeholder: 'Episodios T2 (opcional)', min: 0 },
    { type: 'number', placeholder: 'Episodios T3 (opcional)', min: 0 },
    { type: 'number', placeholder: 'Películas (opcional)', min: 0 },
    { type: 'number', placeholder: 'OVAs (opcional)', min: 0 }
  ];
  const r = await modal({ icon: '📺', title: 'Agregar ' + nombre,
    text: 'Pon cuántos episodios tiene cada parte (puedes editar y agregar T4–T7 después en la tabla).',
    fields: campos, okText: 'Agregar anime' });
  if (!r) return;
  const [t1, t2, t3, peliculas, ovas] = r;
  await api('/api/anime/new', { body: { name: nombre, t1, t2, t3, peliculas, ovas } });
  e.target.reset();
  toast('📺 <b>' + nombre + '</b> agregado a tu lista.');
  load();
});

load();
