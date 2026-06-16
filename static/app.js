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

const FRONT_V = 17;
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
        ${fields.length || !danger ? '<button class="m-cancel">Cancel</button>' : ''}
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
      : 'no installments (pay it down when you can)';
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
  const r = await api('/api/abono', { body: { debt_id: +$('#abonoDebt').value, valor } });
  if (r.error) { toast('⚠ ' + r.error, 'err'); return; }
  toast('⚔ Hit of <b>' + fmt(valor) + '</b> al jefe!');
  const f = $('#dmgFloat');
  f.textContent = '−' + fmt(valor);
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  $('#abonoValor').value = '';
  load(true);
});

$('#abonoList').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('del')) return;
  if (!await confirmModal('Deshacer abono', 'Undo this attack? The damage goes back to the boss.')) return;
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
  return { label: `${nombre} · installment ${num}/${total}`, cuota,
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
      label: `💳 ${c.concepto}` + (activa ? ` · installment ${num}/${c.cuotas}` : ` (${c.cuotas} cuotas desde ${S.plan.months[c.start]})`),
      cuota: activa ? cuotaDe(c) : 0,
      saldo: Math.max(c.valor - cuotaDe(c) * pagadas, 0),
      done: num > c.cuotas
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
        : `<tr><td>${it.label}</td>
           <td class="num">${it.cuota ? fmt(it.cuota) : '—'}</td>
           <td class="num">${it.saldo ? fmt(it.saldo) : '—'}</td></tr>`).join('') +
      '</table></details>';
  }).join('');
  html += `<div class="desglose-total"><span>TOTAL DEBT IN ${S.plan.months[i].toUpperCase()} (excl. payroll)</span>
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
  $('#habitMonthTitle').textContent = 'Habits · ' + monthName;

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
  load();
});

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
  await api('/api/goal', { body: { id: +e.target.dataset.id, field: e.target.dataset.f, value: e.target.value } });
  load();
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
const INGLES_PLAN = [
  ['English (20 min) — Grammar', 'Language Transfer (audio), 1 lesson. Simple structures: to be, present, past. 20 focused minutes.'],
  ['English (20 min) — Vocabulary', '15 new words in Anki. Review yesterday\'s. Note the ones you see at work.'],
  ['English (20 min) — Listening', 'VOA Learning English (beginner). English subtitles, repeat out loud (shadowing).'],
  ['English (20 min) — Speaking', 'ELSA Speak + describe your day out loud. Record 1 min and listen back.'],
  ['English (20 min) — Reading', 'Graded readers or VOA news. Underline what you don\'t get, look it up after.'],
  ['English (20 min) — Review', 'Review the week. If you watch anime today, use English subtitles and note 5 phrases.'],
  ['English (15 min) — Easy', 'Just what you enjoyed most this week. A rested mind learns too.']
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
  // 2. Selector de día (próximos 7 días desde hoy)
  const pick = $('#dayPick');
  if (!pick.dataset.ready) {
    const base = new Date(S.today);
    let opts = '';
    for (let k = 0; k < 7; k++) {
      const d = new Date(base); d.setDate(base.getDate() + k);
      const iso = d.toISOString().slice(0, 10);
      const wd = (d.getDay() + 6) % 7;
      opts += `<option value="${iso}|${wd}">${k === 0 ? 'TODAY · ' : ''}${DIAS[wd]} ${d.getDate()}/${d.getMonth() + 1}</option>`;
    }
    pick.innerHTML = opts;
    pick.dataset.ready = '1';
    pick.onchange = renderRoutineDay;
  }
  renderRoutineDay();

  // Panel de carreras personalizables
  renderCareer();
  // sincronizar metas que coincidan por nombre con una carrera
  for (const c of (S.careers || [])) {
    const prog = progresoCareer(c);
    const meta = (S.goals || []).find(g => {
      const gn = (g.name || '').toLowerCase(), cn = (c.name || '').toLowerCase();
      return gn.includes(cn) || cn.includes(gn.replace('learn ', '').replace('get ', ''));
    });
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
function renderRoutineDay() {
  const val = $('#dayPick').value;
  if (!val) return;
  const [iso, wdStr] = val.split('|');
  const wd = +wdStr;
  CUR_WD = wd;
  const shiftKey = (S.shifts || {})[wd] || 'libre';
  const { rest, acts, msg } = actividadesDelDia(wd, shiftKey);
  // añadir actividades extra del usuario para este día (weekday -1 = todos los días)
  const extras = (S.routine_extra || []).filter(x => x.weekday === -1 || x.weekday === wd);
  for (const x of extras) {
    acts.push({ t: x.time || '—', title: x.title, d: x.descr || '', key: 'extra_' + x.id, extraId: x.id });
  }
  const done = new Set(S.rdone || []);
  let html = '';
  if (rest && msg) html += `<div class="rest-day"><div class="big">🌿</div><p>${msg}</p></div>`;
  html += acts.map(a => {
    const isDone = done.has(`${iso}|${a.key}`);
    const delBtn = a.extraId ? `<button class="del-x" data-type="routine_extra" data-id="${a.extraId}" title="Remove">✕</button>` : '';
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
    await api('/api/career/new', { body: { name: r[0], icon: r[1] || '🎯' } });
    toast('🚀 Career added');
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

  if (e.target.id === 'addRoutineBtn') {
    const sh = SHIFTS[(S.shifts || {})[CUR_WD] || 'libre'];
    const sugerencia = (!sh || !sh.work) ? 'Free day — any time works'
      : `Free after ${sh.work[1] + 1}:00`;
    const r = await modal({ icon: '➕', title: 'Add activity',
      text: `Add something to this day. ${sugerencia}.`,
      fields: [
        { type: 'text', placeholder: 'Time (e.g. 20:00)' },
        { type: 'text', placeholder: 'Activity name' },
        { type: 'text', placeholder: 'Short note (optional)' }
      ], okText: 'Add' });
    if (!r || !r[1].trim()) return;
    await api('/api/routine_extra/new', { body: { time: r[0], title: r[1], descr: r[2], weekday: CUR_WD } });
    toast('➕ Activity added to this day');
    load();
    return;
  }

  const c = e.target.closest('.rb-check');
  if (!c) return;
  const day = c.dataset.day, act = c.dataset.act;
  if (!c.classList.contains('on')) {
    // permitir registrar por qué no se hizo (opcional) -> aquí solo lo marca hecho
    await api('/api/routine', { body: { day, activity: act } });
    toast('✓ Done! One more step toward your goals.');
  } else {
    const why = await modal({ icon: '🤔', title: 'Uncheck?',
      text: "Didn't get to do this? That's okay, life happens. You can note why.",
      fields: [{ type: 'text', placeholder: 'e.g. doctor appointment, plans... (optional)' }], okText: 'Uncheck' });
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
