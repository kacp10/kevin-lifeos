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

const FRONT_V = 136;
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


// V135 · Pirate Position route + legacy milestones; V133 Word Hunter remains independent and protected
// The learning source is entered manually so the app never invents a book page or topic.
function languageSourceRows() {
  const pf = S.profile || {};
  try {
    const rows = JSON.parse(pf.language_sources_v2 || '[]');
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (_error) {}
  const legacy = {
    id:'legacy-source', language:pf.lang_language || 'English', book:pf.lang_book || '',
    level:pf.lang_book_level || '', unit:pf.lang_unit || '', pages:pf.lang_pages || '',
    topic:pf.lang_topic || '', grammar:pf.lang_grammar || '', updated_at:pf.lang_weekly_updated || ''
  };
  return (legacy.book || legacy.topic) ? [legacy] : [];
}
function languageHunterProfile() {
  const pf = S.profile || {};
  const rows = languageSourceRows();
  const activeId = pf.lang_active_source_id || rows[0]?.id || '';
  const active = rows.find(x => x.id === activeId) || rows[0] || {};
  return {
    id: active.id || '', language: active.language || 'English', book: active.book || '',
    level: active.level || '', unit: active.unit || '', pages: active.pages || '',
    topic: active.topic || '', grammar: active.grammar || '',
    weeklyUpdated: active.updated_at || pf.lang_weekly_updated || '', sourceCount: rows.length
  };
}
async function persistLanguageSources(rows, activeId) {
  rows = Array.isArray(rows) ? rows.slice(-60) : [];
  const active = rows.find(x => x.id === activeId) || rows[0] || {};
  const updates = {
    language_sources_v2: JSON.stringify(rows), lang_active_source_id: active.id || '',
    lang_language: active.language || 'English', lang_book: active.book || '',
    lang_book_level: active.level || '', lang_unit: active.unit || '', lang_pages: active.pages || '',
    lang_topic: active.topic || '', lang_grammar: active.grammar || '', lang_weekly_updated: active.updated_at || hoyLocal()
  };
  for (const [key,value] of Object.entries(updates)) {
    await api('/api/profile', { body:{ key, value:String(value ?? '') } });
    S.profile = S.profile || {}; S.profile[key] = String(value ?? '');
  }
}


function languageProfileArray(key) {
  try {
    const value = JSON.parse((S.profile || {})[key] || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_error) { return []; }
}
function languageErrors() { return languageProfileArray('language_errors_v1'); }
function languagePhrases() { return languageProfileArray('language_phrases_v1'); }
async function saveLanguageProfileArray(key, rows) {
  const value = JSON.stringify(rows.slice(-200));
  await api('/api/profile', { body:{ key, value } });
  S.profile = S.profile || {};
  S.profile[key] = value;
}
const WORD_HUNTER_CORE_1000 = ["the","of","and","to","in","a","that","he","was","it","his","is","with","as","i","had","for","at","by","on","not","be","from","but","you","or","her","him","which","were","all","this","she","they","are","have","said","an","one","who","so","what","there","their","when","been","may","if","no","up","my","them","into","more","out","would","me","we","did","only","could","now","man","its","has","will","then","some","time","after","do","other","about","such","before","very","how","should","over","your","these","new","than","any","those","well","old","first","himself","men","two","down","face","upon","see","can","like","our","same","know","without","went","made","little","long","states","came","where","under","room","must","even","eyes","come","still","being","most","go","thought","people","war","life","again","way","another","away","general","left","hand","day","through","began","great","own","also","asked","rostov","while","just","army","looked","say","count","back","am","whole","good","shall","head","right","part","government","felt","seemed","here","yes","us","something","why","place","having","much","state","house","against","between","though","every","nothing","emperor","heard","off","because","young","bone","take","disease","many","always","saw","never","three","don","tissue","skin","took","years","once","look","last","united","think","round","found","too","power","blood","met","might","father","usually","both","small","give","side","form","let","make","during","turned","quite","door","suddenly","knew","tell","told","whom","looking","yet","moment","already","love","large","get","holmes","end","treatment","chapter","officer","voice","words","few","hands","days","cases","everything","among","called","dear","congress","seen","often","gave","battle","history","taken","case","put","position","law","however","done","ll","smile","sometimes","country","soon","free","understand","soldiers","known","each","others","oh","become","far","brought","order","along","sat","especially","behind","women","course","result","night","stood","patient","work","joint","anything","going","cause","evidently","several","president","wife","passed","less","infection","matter","given","god","world","feeling","certain","mr","front","chief","does","whether","action","white","question","movement","condition","son","mind","herself","possible","morning","body","alone","later","horse","toward","death","present","followed","labor","necessary","money","woman","until","set","open","almost","nerve","want","ran","things","expression","act","use","replied","fig","troops","sent","south","half","officers","business","became","within","mother","commander","year","pp","wound","themselves","taking","thing","pain","number","leave","word","party","added","above","table","parts","lay","home","find","tissues","near","either","boris","enemy","constitution","fact","continued","letter","high","four","red","public","project","talk","held","common","west","example","national","important","illustration","friend","cried","entered","carried","second","received","nor","got","surface","land","five","light","next","cannot","used","glands","fire","ever","different","union","itself","twenty","really","around","saying","early","sitting","petya","best","full","better","evening","british","gutenberg","name","horses","bones","arm","together","since","road","political","thousand","cold","heart","speak","forms","shouted","means","kept","ask","impossible","vessels","due","arms","moved","line","petersburg","becomes","wish","vasili","rose","conditions","tuberculous","system","rise","gone","drawing","third","force","king","de","times","short","everyone","pressure","formed","black","hair","laws","fellow","clear","longer","remained","children","regiment","ready","help","results","hundred","forward","military","air","wounded","rode","peace","north","myself","answered","tried","growth","crowd","beyond","news","lost","tumour","service","point","past","orders","anyone","understood","interest","anatole","ah","across","bed","strange","reached","ten","sound","read","rather","process","close","standing","spoke","self","opinion","happy","frequently","beside","trade","presence","opened","making","limb","coming","till","soldier","formation","deep","operation","aneurysm","affairs","wanted","show","thus","raised","field","slavery","english","stopped","repeated","family","wished","rest","turning","perhaps","happened","following","seeing","colonies","applied","true","answer","muscles","talking","period","occur","neck","events","affected","revolution","kind","won","else","able","foot","cut","rapidly","call","appeared","southern","lower","led","husband","german","associated","york","terrible","abscess","returned","lymph","least","spread","middle","local","company","reason","noticed","features","attention","wall","return","ff","campaign","tumours","re","merely","whose","turn","steps","silent","water","effect","wounds","window","therefore","laid","giving","subject","speaking","soft","person","federal","size","dinner","waiting","strength","honor","hear","doctor","daughter","believe","quickly","placed","immediately","colonial","trying","questions","dark","conversation","street","hard","city","view","measures","feet","usual","removed","doing","bolkonski","sir","paper","lady","former","foreign","fell","civil","brother","account","six","republican","nearly","glanced","forces","child","fine","enough","town","particularly","closed","character","single","severe","hardly","court","considerable","afraid","tears","sides","please","freedom","coat","symptoms","knee","joints","syphilis","seat","nature","meet","human","ground","france","cancer","society","remarked","nation","gangrene","covered","boy","acute","strong","soul","rights","neither","changes","artery","although","swelling","spirit","washington","tone","thin","reply","hours","grew","girl","fear","adjutant","pale","late","helene","bring","mouth","except","dead","considered","according","area","yourself","faces","smiling","remember","feel","village","someone","rostovs","need","fresh","clinical","special","plan","lesions","ulcer","smiled","contrary","members","hour","attack","listened","friends","finally","employed","bridge","bagration","various","pus","bad","pass","membrane","ve","takes","occurs","haemorrhage","growing","europe","drew","primary","pavlovna","muscle","doubt","syphilitic","independence","described","convention","command","glad","change","appear","wrote","voices","showed","relations","powers","nerves","hope","decided","causes","virginia","terms","suppuration","secondary","russians","ordered","difficult","st","probably","fixed","drawn","unable","says","republicans","opening","minutes","lips","liable","killed","fingers","direction","struck","run","natural","leg","governor","frightened","complete","study","staff","smoke","sister","holding","capital","moving","loss","happiness","greater","cry","colonel","carriage","blue","beginning","mademoiselle","keep","serious","remain","method","master","idea","firm","direct","declared","running","step","simple","sarcoma","relation","pleasure","indeed","increased","heavy","group","consists","prepared","marked","influence","ill","further","dress","camp","vessel","thinking","property","lead","instead","alpatych","age","silence","matters","leaders","industry","duty","diseases","uncle","march","manner","living","expressed","chair","appearance","veins","seems","prevent","passing","chiefly","changed","term","story","slowly","popular","lines","besides","seven","produced","lord","leaving","attended","angry","victory","office","observed","mikhaylovna","low","dry","activity","upper","months","injury","effort","east","clearly","cells","bourienne","tendon","similar","sight","poor","latter","historians","established","dressing","tm","silver","series","pay","loved","live","excellency","eight","corner","wait","peasants","everybody","divided","destroyed","captain","broken","future","expected","thoughts","shoulders","organisms","jefferson","gold","book","tariff","straight","rostopchin","fall","danger","ball","uniform","thirty","sure","resulting","kissed","explain","prisoners","pressed","portion","finger","easy","control","subcutaneous","rule","purpose","occurred","majority","chronic","asking","remembered","produce","health","filled","economic","clock","arrived","ulcers","presented","persons","individual","hot","election","commerce","certainly","quiet","meeting","lying","legs","interests","exclaimed","distance","articular","written","western","weeks","spite","section","region","post","massachusetts","mamma","importance","houses","handsome","generals","follow","earth","church","administration","vein","shoulder","seem"];

const WORD_HUNTER_DETAILS = {
  the:['el / la / los / las','article','The book is on the table.','El libro está sobre la mesa.'],
  of:['de','preposition','A cup of coffee, please.','Una taza de café, por favor.'],
  and:['y','conjunction','I work and study every day.','Trabajo y estudio todos los días.'],
  to:['a / hacia / para','preposition','I am going to work.','Voy al trabajo.'],
  in:['en / dentro de','preposition','My keys are in the bag.','Mis llaves están en el bolso.'],
  a:['un / una','article','I need a minute.','Necesito un minuto.'],
  that:['eso / ese / que','determiner','I know that place.','Conozco ese lugar.'],
  he:['él','pronoun','He works from home.','Él trabaja desde casa.'],
  was:['era / estaba / fue','verb · past of be','The movie was good.','La película estuvo buena.'],
  it:['eso / ello','pronoun','It is very important.','Eso es muy importante.'],
  his:['su / de él','possessive','His phone is new.','Su teléfono es nuevo.'],
  is:['es / está','verb · form of be','She is at home.','Ella está en casa.'],
  with:['con','preposition','I live with my family.','Vivo con mi familia.'],
  as:['como / mientras','preposition','Use this box as a table.','Usa esta caja como mesa.'],
  i:['yo','pronoun','I study English every day.','Yo estudio inglés todos los días.'],
  had:['tenía / tuve / había','verb · past of have','I had a busy day.','Tuve un día ocupado.'],
  for:['para / por / durante','preposition','This gift is for you.','Este regalo es para ti.'],
  at:['en / a','preposition','Meet me at the station.','Encuéntrame en la estación.'],
  by:['por / junto a / antes de','preposition','I will finish by Friday.','Terminaré antes del viernes.'],
  on:['en / sobre','preposition','The phone is on the desk.','El teléfono está sobre el escritorio.'],
  not:['no','adverb','I am not tired.','No estoy cansado.'],
  be:['ser / estar','verb','Be careful with that box.','Ten cuidado con esa caja.'],
  from:['de / desde','preposition','I am from Colombia.','Soy de Colombia.'],
  but:['pero','conjunction','I am tired, but I will continue.','Estoy cansado, pero continuaré.'],
  you:['tú / usted / ustedes','pronoun','You can do it.','Tú puedes hacerlo.'],
  or:['o','conjunction','Tea or coffee?','¿Té o café?'],
  her:['ella / su / la','pronoun','I called her yesterday.','La llamé ayer.'],
  him:['él / lo / le','pronoun','I gave him the key.','Le di la llave.'],
  which:['cuál / que','pronoun','Which one do you prefer?','¿Cuál prefieres?'],
  were:['eran / estaban / fueron','verb · past of be','They were at work.','Ellos estaban en el trabajo.'],
  all:['todo / todos','determiner','All the doors are closed.','Todas las puertas están cerradas.'],
  this:['esto / este / esta','determiner','This lesson is useful.','Esta lección es útil.'],
  she:['ella','pronoun','She speaks English well.','Ella habla inglés bien.'],
  they:['ellos / ellas','pronoun','They live nearby.','Ellos viven cerca.'],
  are:['son / están','verb · form of be','We are ready.','Estamos listos.'],
  have:['tener / haber','verb','I have a question.','Tengo una pregunta.'],
  said:['dijo / dijeron','verb · past of say','She said hello.','Ella dijo hola.'],
  an:['un / una','article','I have an idea.','Tengo una idea.'],
  one:['uno / una','number','I need one more day.','Necesito un día más.'],
  who:['quién / que','pronoun','Who is calling?','¿Quién está llamando?'],
  so:['así que / tan','conjunction','I was tired, so I went home.','Estaba cansado, así que fui a casa.'],
  what:['qué / cuál','pronoun','What do you need?','¿Qué necesitas?'],
  there:['allí / hay','adverb','There is a store nearby.','Hay una tienda cerca.'],
  their:['su / sus / de ellos','possessive','Their house is beautiful.','Su casa es hermosa.'],
  when:['cuándo / cuando','adverb','When do you start work?','¿Cuándo empiezas a trabajar?'],
  been:['sido / estado','verb · participle of be','I have been very busy.','He estado muy ocupado.'],
  may:['puede que / poder','modal verb','It may rain today.','Puede que llueva hoy.'],
  if:['si','conjunction','Call me if you need help.','Llámame si necesitas ayuda.'],
  no:['no / ningún','determiner','There is no problem.','No hay ningún problema.'],
  up:['arriba / hacia arriba','adverb','Stand up, please.','Ponte de pie, por favor.'],
  my:['mi / mis','possessive','My name is Kevin.','Mi nombre es Kevin.'],
  them:['ellos / ellas / los / las','pronoun','I saw them yesterday.','Los vi ayer.'],
  into:['dentro de / hacia','preposition','Put it into the box.','Ponlo dentro de la caja.'],
  more:['más','determiner','I need more time.','Necesito más tiempo.'],
  out:['afuera / fuera','adverb','Let us go out tonight.','Salgamos esta noche.'],
  would:['haría / gustaría','modal verb','I would like some water.','Me gustaría un poco de agua.'],
  me:['me / mí','pronoun','Can you help me?','¿Puedes ayudarme?'],
  we:['nosotros / nosotras','pronoun','We are learning together.','Estamos aprendiendo juntos.'],
  did:['hizo / hicieron','verb · past of do','What did you say?','¿Qué dijiste?'],
  only:['solo / solamente','adverb','I only need five minutes.','Solo necesito cinco minutos.'],
  could:['podría / podía','modal verb','Could you repeat that?','¿Podrías repetir eso?'],
  now:['ahora','adverb','I am ready now.','Estoy listo ahora.'],
  man:['hombre','noun','That man is my neighbor.','Ese hombre es mi vecino.'],
  its:['su / de eso','possessive','The company changed its name.','La empresa cambió su nombre.'],
  has:['tiene / ha','verb · form of have','She has a new job.','Ella tiene un trabajo nuevo.'],
  will:['hará / auxiliar de futuro','modal verb','I will call you tomorrow.','Te llamaré mañana.'],
  then:['entonces / luego','adverb','Finish your work, then rest.','Termina tu trabajo y luego descansa.'],
  some:['algunos / algo de','determiner','I need some information.','Necesito algo de información.'],
  time:['tiempo / vez','noun','Do you have time today?','¿Tienes tiempo hoy?'],
  after:['después de','preposition','We can talk after work.','Podemos hablar después del trabajo.'],
  do:['hacer / auxiliar','verb','What do you do?','¿A qué te dedicas?'],
  other:['otro / otra','adjective','Try the other option.','Prueba la otra opción.'],
  about:['sobre / acerca de','preposition','Tell me about your day.','Cuéntame sobre tu día.'],
  such:['tal / semejante','determiner','I have never seen such a place.','Nunca he visto un lugar así.'],
  before:['antes de','preposition','Wash your hands before eating.','Lávate las manos antes de comer.'],
  very:['muy','adverb','This is very useful.','Esto es muy útil.'],
  how:['cómo','adverb','How does it work?','¿Cómo funciona?'],
  should:['debería','modal verb','You should get some rest.','Deberías descansar.'],
  over:['sobre / encima de / terminado','preposition','The meeting is over.','La reunión terminó.'],
  your:['tu / su / tus / sus','possessive','What is your name?','¿Cuál es tu nombre?'],
  these:['estos / estas','determiner','These shoes are comfortable.','Estos zapatos son cómodos.'],
  new:['nuevo / nueva','adjective','I started a new course.','Empecé un curso nuevo.'],
  than:['que / de lo que','conjunction','This is better than before.','Esto es mejor que antes.'],
  any:['algún / cualquier / nada de','determiner','Do you have any questions?','¿Tienes alguna pregunta?'],
  those:['esos / esas / aquellos','determiner','Those people are waiting.','Esas personas están esperando.'],
  well:['bien','adverb','You did very well.','Lo hiciste muy bien.'],
  old:['viejo / antiguo / de edad','adjective','This building is very old.','Este edificio es muy antiguo.'],
  first:['primero / primera','adjective','This is my first class.','Esta es mi primera clase.'],
  two:['dos','number','I have two brothers.','Tengo dos hermanos.'],
  down:['abajo / hacia abajo','adverb','Please sit down.','Por favor, siéntate.'],
  face:['cara / enfrentar','noun / verb','Wash your face with cold water.','Lávate la cara con agua fría.'],
  see:['ver','verb','I can see the mountains.','Puedo ver las montañas.'],
  can:['poder','modal verb','I can help you.','Puedo ayudarte.'],
  like:['gustar / como','verb / preposition','I like this song.','Me gusta esta canción.'],
  our:['nuestro / nuestra','possessive','Our team is ready.','Nuestro equipo está listo.'],
  same:['mismo / misma','adjective','We have the same idea.','Tenemos la misma idea.'],
  know:['saber / conocer','verb','I know the answer.','Sé la respuesta.'],
  without:['sin','preposition','Do not leave without your keys.','No salgas sin tus llaves.'],
  went:['fui / fue / fueron','verb · past of go','I went to the gym yesterday.','Fui al gimnasio ayer.'],
  made:['hizo / hecho','verb · past of make','I made breakfast this morning.','Preparé el desayuno esta mañana.'],
  little:['poco / pequeño','adjective','I have a little time.','Tengo un poco de tiempo.'],
  long:['largo / mucho tiempo','adjective','It was a long day.','Fue un día largo.'],
  where:['dónde / donde','adverb','Where do you live?','¿Dónde vives?'],
  under:['debajo de','preposition','The shoes are under the bed.','Los zapatos están debajo de la cama.'],
  must:['deber / tener que','modal verb','You must be careful.','Debes tener cuidado.'],
  even:['incluso / aun','adverb','Even small steps matter.','Incluso los pasos pequeños importan.'],
  come:['venir','verb','Come here, please.','Ven aquí, por favor.'],
  still:['todavía / aún','adverb','I am still learning.','Todavía estoy aprendiendo.'],
  most:['la mayoría / más','determiner','Most people need practice.','La mayoría de las personas necesita práctica.'],
  go:['ir','verb','I go to work at eight.','Voy al trabajo a las ocho.'],
  thought:['pensó / pensamiento','verb / noun','I thought about your idea.','Pensé en tu idea.'],
  people:['personas / gente','noun','Many people work from home.','Muchas personas trabajan desde casa.'],
  life:['vida','noun','Learning is part of life.','Aprender es parte de la vida.'],
  again:['otra vez / de nuevo','adverb','Please say it again.','Por favor, dilo otra vez.'],
  way:['manera / camino','noun','This is a better way to learn.','Esta es una mejor manera de aprender.'],
  another:['otro / otra','determiner','Can I have another example?','¿Puedo tener otro ejemplo?'],
  away:['lejos / fuera','adverb','My office is ten minutes away.','Mi oficina está a diez minutos.'],
  left:['izquierda / salió / dejó','adjective / verb','Turn left at the corner.','Gira a la izquierda en la esquina.'],
  hand:['mano','noun','Raise your hand.','Levanta la mano.'],
  day:['día','noun','Have a good day.','Que tengas un buen día.'],
  through:['a través de / por','preposition','We walked through the park.','Caminamos por el parque.'],
  great:['genial / excelente / grande','adjective','You did a great job.','Hiciste un excelente trabajo.'],
  own:['propio / propia','adjective','I want my own business.','Quiero mi propio negocio.'],
  also:['también','adverb','I also study technology.','También estudio tecnología.'],
  while:['mientras / un rato','conjunction','Listen while you read.','Escucha mientras lees.'],
  just:['solo / justo / acabar de','adverb','I just arrived home.','Acabo de llegar a casa.'],
  say:['decir','verb','How do you say this in English?','¿Cómo se dice esto en inglés?'],
  back:['atrás / espalda / de vuelta','adverb / noun','I will call you back.','Te devolveré la llamada.'],
  am:['soy / estoy','verb · form of be','I am ready to begin.','Estoy listo para empezar.'],
  good:['bueno / bien','adjective','That is a good question.','Esa es una buena pregunta.'],
  right:['derecha / correcto','adjective','Your answer is right.','Tu respuesta es correcta.'],
  part:['parte','noun','Practice is part of learning.','La práctica es parte del aprendizaje.'],
  here:['aquí','adverb','Your book is here.','Tu libro está aquí.'],
  yes:['sí','adverb','Yes, I understand.','Sí, entiendo.'],
  us:['nos / nosotros','pronoun','She helped us yesterday.','Ella nos ayudó ayer.'],
  something:['algo','pronoun','I need to tell you something.','Necesito decirte algo.'],
  why:['por qué','adverb','Why are you learning English?','¿Por qué estás aprendiendo inglés?'],
  place:['lugar','noun','This is a quiet place.','Este es un lugar tranquilo.'],
  much:['mucho / mucha','determiner','How much time do we have?','¿Cuánto tiempo tenemos?'],
  house:['casa','noun','My house is near the park.','Mi casa está cerca del parque.'],
  between:['entre','preposition','The bank is between two stores.','El banco está entre dos tiendas.'],
  every:['cada / todos','determiner','I practice every morning.','Practico cada mañana.'],
  nothing:['nada','pronoun','There is nothing to worry about.','No hay nada de qué preocuparse.'],
  because:['porque','conjunction','I stayed home because it was raining.','Me quedé en casa porque estaba lloviendo.'],
  take:['tomar / llevar','verb','Take your time.','Tómate tu tiempo.'],
  many:['muchos / muchas','determiner','I learned many new words.','Aprendí muchas palabras nuevas.'],
  always:['siempre','adverb','I always check my schedule.','Siempre reviso mi horario.'],
  never:['nunca','adverb','I never skip breakfast.','Nunca me salto el desayuno.'],
  three:['tres','number','Write three sentences.','Escribe tres oraciones.'],
  years:['años','noun','I have lived here for two years.','He vivido aquí durante dos años.'],
  once:['una vez','adverb','I go there once a week.','Voy allí una vez por semana.'],
  look:['mirar / parecer','verb','Look at this example.','Mira este ejemplo.'],
  last:['último / durar','adjective / verb','This is the last question.','Esta es la última pregunta.'],
  think:['pensar / creer','verb','I think this is useful.','Creo que esto es útil.'],
  found:['encontré / encontrado','verb · past of find','I found my keys.','Encontré mis llaves.'],
  too:['también / demasiado','adverb','I want to go too.','Yo también quiero ir.'],
  might:['podría / quizá','modal verb','I might go later.','Quizá vaya más tarde.'],
  father:['padre','noun','My father loves music.','A mi padre le encanta la música.'],
  usually:['normalmente','adverb','I usually wake up early.','Normalmente me despierto temprano.'],
  both:['ambos / ambas','determiner','We both like coffee.','A ambos nos gusta el café.'],
  small:['pequeño / pequeña','adjective','Start with a small goal.','Empieza con una meta pequeña.'],
  give:['dar','verb','Give me one example.','Dame un ejemplo.'],
  make:['hacer / crear','verb','I make my bed every morning.','Tiendo mi cama cada mañana.'],
  tell:['decir / contar','verb','Tell me what happened.','Cuéntame qué pasó.'],
  already:['ya','adverb','I already finished.','Ya terminé.'],
  love:['amar / encantar','verb','I love learning new things.','Me encanta aprender cosas nuevas.'],
  get:['obtener / recibir / llegar / ponerse','verb','I get home at six.','Llego a casa a las seis.'],
  end:['fin / terminar','noun / verb','The class ends at five.','La clase termina a las cinco.'],
  few:['pocos / pocas','determiner','I have a few questions.','Tengo algunas preguntas.'],
  everything:['todo','pronoun','Everything is ready.','Todo está listo.'],
  often:['a menudo','adverb','I often listen to podcasts.','A menudo escucho pódcast.'],
  put:['poner','verb','Put your phone on the table.','Pon tu teléfono sobre la mesa.'],
  however:['sin embargo','adverb','It was difficult; however, I continued.','Fue difícil; sin embargo, continué.'],
  sometimes:['a veces','adverb','I sometimes study at night.','A veces estudio por la noche.'],
  country:['país','noun','Colombia is a beautiful country.','Colombia es un país hermoso.'],
  soon:['pronto','adverb','I will see you soon.','Te veré pronto.'],
  free:['libre / gratis','adjective','This course is free.','Este curso es gratis.'],
  understand:['entender','verb','I understand the main idea.','Entiendo la idea principal.'],
  each:['cada','determiner','Review each word carefully.','Repasa cada palabra con cuidado.'],
  become:['convertirse','verb','Practice can become a habit.','La práctica puede convertirse en un hábito.'],
  order:['orden / pedir','noun / verb','I would like to order lunch.','Me gustaría pedir el almuerzo.'],
  night:['noche','noun','I read every night.','Leo todas las noches.'],
  work:['trabajo / trabajar','noun / verb','I work from Monday to Friday.','Trabajo de lunes a viernes.'],
  matter:['importar / asunto','verb / noun','Small details matter.','Los detalles pequeños importan.'],
  world:['mundo','noun','English is used around the world.','El inglés se usa en todo el mundo.'],
  does:['hace / auxiliar','verb · form of do','What does this word mean?','¿Qué significa esta palabra?'],
  question:['pregunta','noun','Ask one question at a time.','Haz una pregunta a la vez.'],
  morning:['mañana','noun','I exercise in the morning.','Hago ejercicio por la mañana.'],
  body:['cuerpo','noun','Rest helps your body recover.','Descansar ayuda a tu cuerpo a recuperarse.'],
  later:['más tarde','adverb','I will do it later.','Lo haré más tarde.'],
  money:['dinero','noun','I am saving money.','Estoy ahorrando dinero.'],
  want:['querer','verb','I want to improve my English.','Quiero mejorar mi inglés.'],
  things:['cosas','noun','I learned many useful things.','Aprendí muchas cosas útiles.'],
  use:['usar / uso','verb / noun','Use this word in a sentence.','Usa esta palabra en una oración.'],
  business:['negocio / empresa','noun','She wants to start a business.','Ella quiere iniciar un negocio.'],
  mother:['madre','noun','My mother is at home.','Mi madre está en casa.'],
  year:['año','noun','This year I will study more.','Este año estudiaré más.'],
  thing:['cosa','noun','The important thing is to continue.','Lo importante es continuar.'],
  number:['número','noun','Write your phone number here.','Escribe tu número de teléfono aquí.'],
  leave:['salir / dejar','verb','I leave home at seven.','Salgo de casa a las siete.'],
  word:['palabra','noun','Write the correct word.','Escribe la palabra correcta.'],
  table:['mesa / tabla','noun','The keys are on the table.','Las llaves están sobre la mesa.'],
  home:['casa / hogar','noun','I am going home.','Voy a casa.'],
  find:['encontrar','verb','I cannot find my phone.','No puedo encontrar mi teléfono.'],
  near:['cerca de','preposition','The gym is near my house.','El gimnasio está cerca de mi casa.'],
  high:['alto / alta','adjective','The price is too high.','El precio es demasiado alto.'],
  four:['cuatro','number','I train four days a week.','Entreno cuatro días por semana.'],
  red:['rojo / roja','adjective','The car is red.','El carro es rojo.'],
  important:['importante','adjective','Sleep is important for recovery.','Dormir es importante para la recuperación.'],
  friend:['amigo / amiga','noun','My friend lives nearby.','Mi amigo vive cerca.'],
  second:['segundo / segunda','number','This is my second attempt.','Este es mi segundo intento.'],
  five:['cinco','number','Wait five minutes.','Espera cinco minutos.'],
  light:['luz / ligero','noun / adjective','Turn on the light.','Enciende la luz.'],
  next:['siguiente / próximo','adjective','What is the next step?','¿Cuál es el siguiente paso?'],
  used:['usado / utilizó','adjective / verb','This tool is used for cutting.','Esta herramienta se usa para cortar.'],
  different:['diferente','adjective','Try a different method.','Prueba un método diferente.'],
  really:['realmente','adverb','I really like this lesson.','Realmente me gusta esta lección.'],
  around:['alrededor de / aproximadamente','preposition','I wake up around six.','Me despierto aproximadamente a las seis.'],
  best:['mejor / el mejor','adjective','Practice is the best way to improve.','Practicar es la mejor manera de mejorar.'],
  full:['lleno / completo','adjective','The bottle is full.','La botella está llena.'],
  better:['mejor','adjective','I feel better today.','Me siento mejor hoy.'],
  name:['nombre','noun','What is your name?','¿Cuál es tu nombre?'],
  since:['desde / ya que','preposition','I have worked here since 2024.','Trabajo aquí desde 2024.'],
  road:['carretera / camino','noun','The road is closed.','La carretera está cerrada.'],
  cold:['frío / resfriado','adjective / noun','The water is cold.','El agua está fría.'],
  heart:['corazón','noun','Exercise is good for your heart.','El ejercicio es bueno para tu corazón.'],
  speak:['hablar','verb','Please speak more slowly.','Por favor, habla más despacio.'],
  ask:['preguntar / pedir','verb','Ask your tutor for an example.','Pídele un ejemplo a tu tutor.'],
  help:['ayuda / ayudar','noun / verb','Can you help me?','¿Puedes ayudarme?'],
  air:['aire','noun','Open the window for fresh air.','Abre la ventana para que entre aire fresco.'],
  news:['noticias','noun','I read the news every morning.','Leo las noticias cada mañana.'],
  service:['servicio','noun','The service was excellent.','El servicio fue excelente.'],
  point:['punto / idea principal','noun','That is a good point.','Ese es un buen punto.'],
  interest:['interés','noun','Technology is one of my interests.','La tecnología es uno de mis intereses.'],
  sound:['sonido / sonar','noun / verb','That word sounds different.','Esa palabra suena diferente.'],
  read:['leer','verb','I read for twenty minutes.','Leo durante veinte minutos.'],
  close:['cerrar / cerca','verb / adjective','Please close the door.','Por favor, cierra la puerta.'],
  happy:['feliz','adjective','I am happy with my progress.','Estoy feliz con mi progreso.'],
  show:['mostrar','verb','Show me another example.','Muéstrame otro ejemplo.'],
  family:['familia','noun','My family supports me.','Mi familia me apoya.'],
  true:['verdadero / cierto','adjective','Is that true?','¿Eso es cierto?'],
  answer:['respuesta / responder','noun / verb','Write your answer here.','Escribe tu respuesta aquí.'],
  kind:['tipo / amable','noun / adjective','What kind of music do you like?','¿Qué tipo de música te gusta?'],
  able:['capaz','adjective','I am able to explain it now.','Ahora soy capaz de explicarlo.'],
  call:['llamar / llamada','verb / noun','Call me after work.','Llámame después del trabajo.'],
  lower:['más bajo / bajar','adjective / verb','Lower the volume, please.','Baja el volumen, por favor.'],
  reason:['razón','noun','What is the main reason?','¿Cuál es la razón principal?'],
  attention:['atención','noun','Pay attention to the ending.','Presta atención a la terminación.'],
  water:['agua','noun','Drink more water.','Bebe más agua.'],
  person:['persona','noun','She is a kind person.','Ella es una persona amable.'],
  size:['tamaño / talla','noun','What size do you need?','¿Qué talla necesitas?'],
  hear:['oír / escuchar','verb','Can you hear me?','¿Puedes oírme?'],
  believe:['creer','verb','I believe you can improve.','Creo que puedes mejorar.'],
  dark:['oscuro / oscura','adjective','It gets dark early.','Oscurece temprano.'],
  conversation:['conversación','noun','We had a short conversation.','Tuvimos una conversación corta.'],
  street:['calle','noun','The bank is across the street.','El banco está al otro lado de la calle.'],
  hard:['difícil / duro','adjective','This exercise is hard.','Este ejercicio es difícil.'],
  city:['ciudad','noun','Bogotá is a large city.','Bogotá es una ciudad grande.'],
  paper:['papel','noun','Write it on a piece of paper.','Escríbelo en una hoja de papel.'],
  child:['niño / niña','noun','The child is playing outside.','El niño está jugando afuera.'],
  fine:['bien / fino / multa','adjective','I am fine, thank you.','Estoy bien, gracias.'],
  enough:['suficiente','determiner','That is enough for today.','Eso es suficiente por hoy.'],
  please:['por favor','adverb','Please repeat the sentence.','Por favor, repite la oración.'],
  freedom:['libertad','noun','Financial freedom takes planning.','La libertad financiera requiere planificación.'],
  nature:['naturaleza','noun','I enjoy spending time in nature.','Disfruto pasar tiempo en la naturaleza.'],
  meet:['conocer / reunirse','verb','Nice to meet you.','Mucho gusto.'],
  human:['humano / humana','adjective','Sleep is a basic human need.','Dormir es una necesidad humana básica.'],
  strong:['fuerte','adjective','Consistency makes you stronger.','La constancia te hace más fuerte.'],
  fear:['miedo','noun','Do not let fear stop you.','No dejes que el miedo te detenga.'],
  bring:['traer','verb','Bring your notebook tomorrow.','Trae tu cuaderno mañana.'],
  remember:['recordar','verb','Remember to review your words.','Recuerda repasar tus palabras.'],
  feel:['sentir / sentirse','verb','How do you feel today?','¿Cómo te sientes hoy?'],
  need:['necesitar','verb','I need more practice.','Necesito más práctica.'],
  plan:['plan / planear','noun / verb','I have a plan for this week.','Tengo un plan para esta semana.'],
  hour:['hora','noun','The class lasts one hour.','La clase dura una hora.'],
  friends:['amigos / amigas','noun','I went out with my friends.','Salí con mis amigos.'],
  bad:['malo / mal','adjective','One bad day does not define your progress.','Un mal día no define tu progreso.'],
  change:['cambio / cambiar','noun / verb','Small habits can change your life.','Los hábitos pequeños pueden cambiar tu vida.'],
  hope:['esperanza / esperar','noun / verb','I hope you have a good day.','Espero que tengas un buen día.'],
  difficult:['difícil','adjective','This word is difficult to pronounce.','Esta palabra es difícil de pronunciar.'],
  minutes:['minutos','noun','Practice for ten minutes.','Practica durante diez minutos.'],
  run:['correr / funcionar','verb','I run three times a week.','Corro tres veces por semana.'],
  complete:['completo / completar','adjective / verb','Complete the mission when you are ready.','Completa la misión cuando estés listo.'],
  study:['estudiar / estudio','verb / noun','I study English at night.','Estudio inglés por la noche.'],
  keep:['mantener / guardar','verb','Keep practicing every week.','Sigue practicando cada semana.'],
  idea:['idea','noun','That is an interesting idea.','Esa es una idea interesante.'],
  step:['paso','noun','Take one step at a time.','Da un paso a la vez.'],
  simple:['simple / sencillo','adjective','Start with a simple sentence.','Empieza con una oración sencilla.'],
  health:['salud','noun','Exercise improves your health.','El ejercicio mejora tu salud.'],
  clock:['reloj','noun','Look at the clock.','Mira el reloj.'],
  hot:['caliente / caluroso','adjective','The coffee is hot.','El café está caliente.'],
  quiet:['tranquilo / silencioso','adjective','I need a quiet place to study.','Necesito un lugar tranquilo para estudiar.'],
  weeks:['semanas','noun','I have practiced for three weeks.','He practicado durante tres semanas.'],
  future:['futuro','noun','I am preparing for the future.','Me estoy preparando para el futuro.'],
  book:['libro','noun','This book is easy to read.','Este libro es fácil de leer.'],
  sure:['seguro / segura','adjective','Are you sure?','¿Estás seguro?'],
  explain:['explicar','verb','Can you explain it again?','¿Puedes explicarlo otra vez?'],
  easy:['fácil','adjective','This example is easy to understand.','Este ejemplo es fácil de entender.'],
  control:['control / controlar','noun / verb','Focus on what you can control.','Concéntrate en lo que puedes controlar.'],
  purpose:['propósito','noun','What is the purpose of this exercise?','¿Cuál es el propósito de este ejercicio?'],
  produce:['producir','verb','Try to produce a complete sentence.','Intenta producir una oración completa.'],
  live:['vivir / en vivo','verb / adjective','I live in Colombia.','Vivo en Colombia.'],
  wait:['esperar','verb','Wait a moment, please.','Espera un momento, por favor.'],
  broken:['roto / dañando','adjective','The screen is broken.','La pantalla está rota.'],
  danger:['peligro','noun','That sign warns of danger.','Ese aviso advierte del peligro.'],
  rule:['regla','noun','Learn the rule, then practice it.','Aprende la regla y luego practícala.'],
  earth:['Tierra / tierra','noun','The Earth moves around the Sun.','La Tierra gira alrededor del Sol.'],
  seem:['parecer','verb','This lesson seems easier now.','Esta lección parece más fácil ahora.']
};
function wordHunterDetails(word) {
  const row=WORD_HUNTER_DETAILS[wordHunterKey(word)];
  return row ? {meaning:row[0],part:row[1],example:row[2],exampleEs:row[3]} : null;
}

function wordHunterRows() { return languageProfileArray('language_word_deck_v1'); }
async function saveWordHunterRows(rows) { const value=JSON.stringify(rows.slice(-1800)); await api('/api/profile',{body:{key:'language_word_deck_v1',value}}); S.profile=S.profile||{}; S.profile.language_word_deck_v1=value; }
function wordHunterKey(v) { return String(v||'').trim().toLowerCase(); }
function wordHunterDatePlus(days) { const d=new Date(); d.setDate(d.getDate()+days); return localISO(d); }
function wordHunterBuiltInState() {
  const pf=S.profile||{};
  try { const x=JSON.parse(pf.language_word_core_state_v1||'{}'); return x&&typeof x==='object'?x:{}; } catch(_){ return {}; }
}
async function saveWordHunterBuiltInState(state) {
  const value=JSON.stringify(state); await api('/api/profile',{body:{key:'language_word_core_state_v1',value}}); S.profile=S.profile||{}; S.profile.language_word_core_state_v1=value;
}
function wordHunterPersonalMap() { const m=new Map(); wordHunterRows().forEach(x=>m.set(wordHunterKey(x.word||x.correct),x)); return m; }
function wordHunterDueCards(limit=10) {
  const today=hoyLocal(), personal=wordHunterRows().filter(x=>x.status!=='Mastered' && (!x.due||x.due<=today)).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))||(+b.priority||0)-(+a.priority||0));
  const state=wordHunterBuiltInState(), personalMap=wordHunterPersonalMap(), built=[];
  for (let i=0;i<WORD_HUNTER_CORE_1000.length && personal.length+built.length<limit;i++) {
    const word=WORD_HUNTER_CORE_1000[i], st=state[word]||{}, details=wordHunterDetails(word);
    if (!details || personalMap.has(word) || st.status==='Mastered') continue;
    if (!st.due || st.due<=today) built.push({id:'core:'+word,word,correct:word,wrong:'',meaning:st.meaning||details.meaning,part:details.part,example:st.example||details.example,exampleEs:details.exampleEs,source:'Core vocabulary',status:st.status||'New',due:st.due||today,core:true,index:i+1});
  }
  return personal.concat(built).slice(0,limit);
}
function wordHunterCounts() {
  const rows=wordHunterRows(), state=wordHunterBuiltInState();
  return {due:wordHunterDueCards(10).length,learning:rows.filter(x=>x.status!=='Mastered').length+Object.values(state).filter(x=>x.status&&x.status!=='Mastered').length,mastered:rows.filter(x=>x.status==='Mastered').length+Object.values(state).filter(x=>x.status==='Mastered').length};
}
async function addWordHunterCard(data={}) {
  const word=String(data.word||data.correct||'').trim(); if(!word)return false;
  const rows=wordHunterRows(), key=wordHunterKey(word), existing=rows.find(x=>wordHunterKey(x.word||x.correct)===key);
  const payload={id:existing?.id||`word-${Date.now()}`,word,wrong:String(data.wrong||'').trim(),meaning:String(data.meaning||'').trim(),example:String(data.example||'').trim(),source:data.source||'Personal',status:'Learning',due:hoyLocal(),interval:0,reviews:+existing?.reviews||0,priority:data.priority||2,created_at:existing?.created_at||hoyLocal(),updated_at:hoyLocal()};
  if(existing) Object.assign(existing,payload); else rows.push(payload);
  await saveWordHunterRows(rows); return true;
}
async function addWordHunterManual() {
  const r=await modal({icon:'Aa',title:'Add word or expression',text:'Save spelling, meaning and one useful example. Personal errors receive priority in daily review.',fields:[
    {type:'text',label:'Correct word or short expression',placeholder:'because'},
    {type:'text',label:'Your incorrect spelling · optional',placeholder:'becouse'},
    {type:'text',label:'Meaning in Spanish or your own words',placeholder:'porque'},
    {type:'text',label:'Example · optional',placeholder:'I stayed home because it was raining.'}
  ],okText:'Add to deck',lockClose:true,draftKey:'word_hunter_add'});
  if(!r)return false; if(!String(r[0]||'').trim()){toast('The correct word is required.');return false;}
  await addWordHunterCard({word:r[0],wrong:r[1],meaning:r[2],example:r[3],source:r[1]?'Personal error':'Manual',priority:r[1]?5:3}); toast('Aa Word added to today’s review deck.'); renderEnglish(); return true;
}
async function rateWordHunterCard(card,rating) {
  const gaps={again:1,hard:2,good:4,easy:7};
  if(card.core){const state=wordHunterBuiltInState(), current=state[card.word]||{}, mult=rating==='again'?1:rating==='hard'?1.5:rating==='good'?2:3, next=Math.max(gaps[rating],Math.round((+current.interval||1)*mult)); state[card.word]={...current,status:rating==='easy'&&(+current.reviews||0)>=2?'Mastered':'Learning',reviews:(+current.reviews||0)+1,interval:next,due:wordHunterDatePlus(next),updated_at:hoyLocal()}; await saveWordHunterBuiltInState(state);}
  else {const rows=wordHunterRows(), row=rows.find(x=>x.id===card.id);if(!row)return;const mult=rating==='again'?1:rating==='hard'?1.5:rating==='good'?2:3,next=Math.max(gaps[rating],Math.round((+row.interval||1)*mult));row.reviews=(+row.reviews||0)+1;row.interval=next;row.due=wordHunterDatePlus(next);row.status=rating==='easy'&&row.reviews>=3?'Mastered':'Learning';row.updated_at=hoyLocal();await saveWordHunterRows(rows);}
}
function openWordHunterReview() {
  let queue=wordHunterDueCards(10), pos=0, revealed=false; const previous=document.activeElement,back=document.createElement('div');back.className='modal-back word-hunter-back modal-back-stacked';
  const close=()=>{back.classList.remove('show');setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();renderEnglish();},240)};
  const draw=()=>{if(pos>=queue.length){back.innerHTML=`<div class="modal-card word-review-card"><div class="language-mission-top"><div><span>WORD HUNTER</span><h3>Review complete</h3></div><button class="language-mission-close">✕</button></div><div class="word-review-finish">◆ ${queue.length} cards reviewed today.</div><div class="language-notebook-footer"><button class="btn-ghost" data-word-close>Finish</button></div></div>`;back.querySelectorAll('.language-mission-close,[data-word-close]').forEach(x=>x.onclick=close);return;}
    const c=queue[pos], details=c.core?wordHunterDetails(c.word):null, meaning=c.meaning||details?.meaning||'Add a Spanish meaning from the library.', part=c.part||details?.part||'', example=c.example||details?.example||'', exampleEs=c.exampleEs||details?.exampleEs||''; back.innerHTML=`<div class="modal-card word-review-card"><div class="language-mission-top"><div><span>WORD HUNTER · ${pos+1}/${queue.length}</span><h3>${c.source==='Personal error'?'Spelling recovery':'Vocabulary review'}</h3></div><button class="language-mission-close">✕</button></div><div class="word-card-face"><small>${c.core?'DAILY VOCABULARY':'PERSONAL ERROR'}</small><strong>${esc(c.word||c.correct)}</strong>${!revealed&&c.wrong?`<span>Your error: ${esc(c.wrong)}</span>`:''}${revealed?`<div class="word-card-answer">${c.wrong?`<p><b>Your error:</b> ${esc(c.wrong)}</p>`:''}<p><b>Correct:</b> ${esc(c.word||c.correct)}</p><p><b>Significado:</b> ${esc(meaning)}</p>${part?`<p><b>Tipo:</b> ${esc(part)}</p>`:''}${example?`<div class="word-example-pair"><em>${esc(example)}</em>${exampleEs?`<span>${esc(exampleEs)}</span>`:''}</div>`:''}<p class="word-card-task">Say or write one new sentence using <b>${esc(c.word||c.correct)}</b>.</p></div>`:''}</div><div class="word-review-actions">${revealed?'<button data-rate="again">Again</button><button data-rate="hard">Hard</button><button data-rate="good">Good</button><button data-rate="easy">Easy</button>':'<button class="btn-gold" data-reveal>Show answer</button>'}</div></div>`;
    back.querySelector('.language-mission-close').onclick=close; const rev=back.querySelector('[data-reveal]');if(rev)rev.onclick=()=>{revealed=true;draw();};back.querySelectorAll('[data-rate]').forEach(b=>b.onclick=async()=>{b.disabled=true;await rateWordHunterCard(c,b.dataset.rate);pos++;revealed=false;draw();});
  };
  document.body.appendChild(back);document.body.classList.add('modal-open');draw();requestAnimationFrame(()=>back.classList.add('show'));
}
function openWordHunterLibrary() {
  const previous=document.activeElement,back=document.createElement('div');back.className='modal-back word-hunter-back modal-back-stacked';
  const draw=()=>{const rows=wordHunterRows().slice().sort((a,b)=>(a.status==='Mastered')-(b.status==='Mastered')||String(b.updated_at).localeCompare(String(a.updated_at)));const items=rows.length?rows.map(x=>`<article class="language-note-card ${x.status==='Mastered'?'mastered':''}" data-word-id="${esc(x.id)}"><div><small>${esc(x.source||'Personal')} · ${esc(x.status||'Learning')}</small><b>${esc(x.word||x.correct)}</b>${x.wrong?`<span>${esc(x.wrong)} → ${esc(x.word||x.correct)}</span>`:''}${x.meaning?`<em>${esc(x.meaning)}</em>`:''}</div><div class="language-note-actions"><button data-word-master>${x.status==='Mastered'?'Reopen':'Learned'}</button><button data-word-delete>✕</button></div></article>`).join(''):'<div class="language-notebook-empty">No personal words yet. Core vocabulary appears gradually in daily reviews.</div>';back.innerHTML=`<div class="modal-card language-notebook-card"><div class="language-mission-top"><div><span>WORD HUNTER ARCHIVE</span><h3>Personal vocabulary</h3></div><button class="language-mission-close">✕</button></div><div class="language-notebook-list">${items}</div><div class="language-notebook-footer"><button class="btn-ghost" data-word-add>＋ Add word</button></div></div>`;bind();};
  const close=()=>{back.classList.remove('show');setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();renderEnglish();},240)};
  const bind=()=>{back.querySelector('.language-mission-close').onclick=close;back.querySelector('[data-word-add]').onclick=async()=>{if(await addWordHunterManual())draw();};back.querySelectorAll('[data-word-master]').forEach(btn=>btn.onclick=async()=>{const rows=wordHunterRows(),row=rows.find(x=>x.id===btn.closest('[data-word-id]').dataset.wordId);if(!row)return;row.status=row.status==='Mastered'?'Learning':'Mastered';row.due=row.status==='Mastered'?'9999-12-31':hoyLocal();await saveWordHunterRows(rows);draw();});back.querySelectorAll('[data-word-delete]').forEach(btn=>btn.onclick=async()=>{if(!await confirmModal('Delete word','Remove this personal card permanently?',true))return;let rows=wordHunterRows().filter(x=>x.id!==btn.closest('[data-word-id]').dataset.wordId);await saveWordHunterRows(rows);draw();});};
  document.body.appendChild(back);document.body.classList.add('modal-open');draw();requestAnimationFrame(()=>back.classList.add('show'));
}

async function openWordHunterHelp() {
  await modal({icon:'Aa',title:'How Word Hunter works',text:'Word Hunter is independent from the daily English mission. Review up to 10 due cards whenever you want. Personal spelling errors appear first. Show the answer, read the Spanish meaning and bilingual example, then produce your own sentence. Again, Hard, Good and Easy only schedule the next review; they do not affect the English check.',fields:[],okText:'Understood',cancelText:null,lockClose:true});
}

function languageLearningContext() {
  const errors = languageErrors().filter(x => x.status !== 'Mastered').sort((a,b)=>(+b.count||1)-(+a.count||1)).slice(0,3);
  const phrases = languagePhrases().filter(x => x.confidence !== 'Mastered').slice(-3).reverse();
  const words = wordHunterDueCards(3);
  return { errors, phrases, words };
}
async function addLanguageError() {
  const r = await modal({ icon:'✎', title:'Add English error', text:'Save either one misspelled word or a complete sentence. Word errors can enter Word Hunter automatically.', fields:[
    {type:'select',label:'Error type',options:[{v:'word',t:'Word / spelling'},{v:'sentence',t:'Sentence / grammar'}]},
    {type:'text',label:'What you wrote or heard incorrectly',placeholder:'becouse / Yesterday I go to work.'},
    {type:'text',label:'Correct form',placeholder:'because / Yesterday I went to work.'},
    {type:'text',label:'Meaning, rule or context · optional',placeholder:'porque / Use the past form after yesterday.'}
  ], okText:'Save error', lockClose:true, draftKey:'language_error' });
  if (!r) return false;
  const kind=r[0]||'word',wrong=String(r[1]||'').trim(),correct=String(r[2]||'').trim(),rule=String(r[3]||'').trim();
  if (!wrong || !correct) { toast('Incorrect and correct forms are required.'); return false; }
  const rows=languageErrors();
  const existing=rows.find(x=>String(x.wrong||'').toLowerCase()===wrong.toLowerCase() && String(x.correct||'').toLowerCase()===correct.toLowerCase());
  if (existing) { existing.count=(+existing.count||1)+1; existing.rule=rule||existing.rule||''; existing.kind=kind||existing.kind||'sentence'; existing.status='Learning'; existing.updated_at=hoyLocal(); }
  else rows.push({id:`err-${Date.now()}`,kind,wrong,correct,rule,count:1,status:'Learning',updated_at:hoyLocal()});
  await saveLanguageProfileArray('language_errors_v1',rows);
  if(kind==='word' && !correct.includes(' ')) await addWordHunterCard({word:correct,wrong,meaning:rule,source:'Personal error',priority:5});
  toast(kind==='word'?'✎ Error saved and added to Word Hunter.':'✎ Error saved for future missions.'); return true;
}
async function addLanguagePhrase() {
  const cfg=languageHunterProfile();
  const r = await modal({ icon:'◆', title:'Add useful phrase', text:'Save complete phrases you want to use naturally, not isolated vocabulary.', fields:[
    {type:'text',label:'Useful phrase',placeholder:"I'm looking forward to the weekend."},
    {type:'text',label:'Meaning in your own words',placeholder:'Estoy esperando con ganas el fin de semana.'},
    {type:'text',label:'Personal example',placeholder:"I'm looking forward to starting my new course."},
    {type:'select',label:'Source',options:['American School Way','AI conversation','YouTube','Series','Website','Real conversation','Other'].map(v=>({v,t:v}))}
  ], okText:'Save phrase', lockClose:true, draftKey:'language_phrase' });
  if (!r) return false;
  const phrase=String(r[0]||'').trim(); if(!phrase){toast('The phrase is required.');return false;}
  const rows=languagePhrases();
  const existing=rows.find(x=>String(x.phrase||'').toLowerCase()===phrase.toLowerCase());
  if(existing){existing.meaning=String(r[1]||'').trim()||existing.meaning||'';existing.example=String(r[2]||'').trim()||existing.example||'';existing.source=r[3]||existing.source||'Other';existing.confidence='Learning';existing.updated_at=hoyLocal();}
  else rows.push({id:`phr-${Date.now()}`,phrase,meaning:String(r[1]||'').trim(),example:String(r[2]||'').trim(),source:r[3]||'Other',topic:cfg.topic||'',confidence:'Learning',updated_at:hoyLocal()});
  await saveLanguageProfileArray('language_phrases_v1',rows); toast('◆ Phrase saved for future missions.'); return true;
}
function openLanguageNotebook(kind) {
  const isError=kind==='errors';
  const previous=document.activeElement;
  const back=document.createElement('div'); back.className='modal-back language-notebook-back';
  const draw=()=>{
    const rows=isError?languageErrors():languagePhrases();
    const items=rows.length?rows.slice().reverse().map(x=>isError?`<article class="language-note-card ${x.status==='Mastered'?'mastered':''}" data-note-id="${esc(x.id)}"><div><small>${x.kind==='word'?'WORD':'SENTENCE'} · ${x.status==='Mastered'?'MASTERED':'LEARNING'} · repeated ${+x.count||1}×</small><b>${esc(x.wrong)}</b><span>${esc(x.correct)}</span>${x.rule?`<em>${esc(x.rule)}</em>`:''}</div><div class="language-note-actions"><button data-note-toggle>${x.status==='Mastered'?'Reopen':'Mastered'}</button><button data-note-delete aria-label="Delete">✕</button></div></article>`:`<article class="language-note-card ${x.confidence==='Mastered'?'mastered':''}" data-note-id="${esc(x.id)}"><div><small>${esc(x.source||'Other')} · ${x.confidence||'Learning'}</small><b>${esc(x.phrase)}</b>${x.meaning?`<span>${esc(x.meaning)}</span>`:''}${x.example?`<em>${esc(x.example)}</em>`:''}</div><div class="language-note-actions"><button data-note-toggle>${x.confidence==='Mastered'?'Reopen':'Mastered'}</button><button data-note-delete aria-label="Delete">✕</button></div></article>`).join(''):`<div class="language-notebook-empty">${isError?'No recurring errors saved yet.':'No useful phrases saved yet.'}</div>`;
    back.innerHTML=`<div class="modal-card language-notebook-card"><div class="language-mission-top"><div><span>LANGUAGE HUNTER NOTEBOOK</span><h3>${isError?'Recurring errors':'Useful phrases'}</h3></div><button type="button" class="language-mission-close">✕</button></div><div class="language-notebook-list">${items}</div><div class="language-notebook-footer"><button class="btn-ghost" data-note-add>${isError?'＋ Add error':'＋ Add phrase'}</button></div></div>`;
    bind();
  };
  const close=()=>{back.classList.remove('show');setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();},250)};
  const bind=()=>{
    back.querySelector('.language-mission-close').onclick=close;
    back.querySelector('[data-note-add]').onclick=async()=>{const ok=isError?await addLanguageError():await addLanguagePhrase();if(ok)draw();};
    back.querySelectorAll('[data-note-toggle]').forEach(btn=>btn.onclick=async()=>{const card=btn.closest('[data-note-id]');const rows=isError?languageErrors():languagePhrases();const row=rows.find(x=>x.id===card.dataset.noteId);if(!row)return;if(isError)row.status=row.status==='Mastered'?'Learning':'Mastered';else row.confidence=row.confidence==='Mastered'?'Learning':'Mastered';row.updated_at=hoyLocal();await saveLanguageProfileArray(isError?'language_errors_v1':'language_phrases_v1',rows);draw();});
    back.querySelectorAll('[data-note-delete]').forEach(btn=>btn.onclick=async()=>{const card=btn.closest('[data-note-id]');const ok=await confirmModal('Delete note','This learning note will be removed permanently.',true);if(!ok)return;let rows=isError?languageErrors():languagePhrases();rows=rows.filter(x=>x.id!==card.dataset.noteId);await saveLanguageProfileArray(isError?'language_errors_v1':'language_phrases_v1',rows);draw();});
  };
  document.body.appendChild(back);document.body.classList.add('modal-open');draw();requestAnimationFrame(()=>back.classList.add('show'));back.onclick=e=>{if(e.target===back)e.preventDefault();};
}

async function editLanguageSource(existing = null) {
  const cfg = existing || {language:'English',book:'',level:'',unit:'',pages:'',topic:'',grammar:''};
  const result = await modal({
    icon:'📘', title:existing ? 'Edit study lesson' : 'Add study lesson',
    text:'Save one lesson or study focus. Topics and grammar may contain several items separated by commas or semicolons.',
    fields:[
      {type:'text',label:'Language',value:cfg.language || 'English',placeholder:'English'},
      {type:'text',label:'Book or source',value:cfg.book || '',placeholder:'American School Way, YouTube, podcast...'},
      {type:'text',label:'Source level',value:cfg.level || '',placeholder:'A1, A2, B1 or B2'},
      {type:'text',label:'Unit or lesson',value:cfg.unit || '',placeholder:'Unit 9 / Lesson 3'},
      {type:'text',label:'Pages or material',value:cfg.pages || '',placeholder:'76–77 / video title'},
      {type:'text',label:'Topics',value:cfg.topic || '',placeholder:'Present continuous; daily routines; vocabulary'},
      {type:'text',label:'Grammar focuses',value:cfg.grammar || '',placeholder:'Present continuous; question forms'}
    ], okText:existing ? 'Save and activate' : 'Add and activate', lockClose:true, draftKey:existing ? 'language_source_edit' : 'language_source_add'
  });
  if (!result) return false;
  if (!String(result[1] || '').trim() || !String(result[5] || '').trim()) {
    toast('Source and at least one topic are required.'); return false;
  }
  const rows = languageSourceRows();
  const row = {
    id: existing?.id || `src-${Date.now()}`, language:String(result[0]||'English').trim(),
    book:String(result[1]||'').trim(), level:String(result[2]||'').trim(), unit:String(result[3]||'').trim(),
    pages:String(result[4]||'').trim(), topic:String(result[5]||'').trim(), grammar:String(result[6]||'').trim(),
    updated_at:hoyLocal()
  };
  const ix = rows.findIndex(x=>x.id===row.id); if(ix>=0) rows[ix]=row; else rows.push(row);
  await persistLanguageSources(rows,row.id); toast('📘 Study lesson saved and activated.'); return true;
}
async function configureLanguageHunterSource(force = false) {
  const rows = languageSourceRows();
  const cfg = languageHunterProfile();
  if (!force && cfg.book && cfg.topic) return true;
  if (!rows.length) return editLanguageSource(null);
  const options = rows.map(x=>({v:x.id,t:`${x.book || 'Source'} · ${x.unit || 'No unit'} · ${x.topic || 'No topic'}`}));
  options.push({v:'__new__',t:'＋ Add a new lesson/source'});
  const choice = await modal({
    icon:'🗂️', title:'English study lessons',
    text:'Choose the lesson you want to use today. Previous session records keep their original lesson even when you switch the active one.',
    fields:[{type:'select',label:'Active lesson',value:cfg.id || rows[0].id,options}], okText:'Continue'
  });
  if (!choice) return false;
  if (choice[0] === '__new__') return editLanguageSource(null);
  const selected = rows.find(x=>x.id===choice[0]);
  if (!selected) return false;
  const action = await modal({icon:'📚',title:selected.book || 'Study lesson',text:`<b>${esc(selected.unit||'No unit')}</b>${selected.pages?` · ${esc(selected.pages)}`:''}<br>${esc(selected.topic||'No topic')}`,fields:[{type:'select',label:'Action',options:[{v:'activate',t:'Use this lesson today'},{v:'edit',t:'Edit this lesson'}]}],okText:'Apply'});
  if (!action) return false;
  if (action[0] === 'edit') return editLanguageSource(selected);
  await persistLanguageSources(rows,selected.id); toast('📖 Active English lesson changed.'); return true;
}


function languageTutorPrompt(wd, minutes = 25) {
  const cfg = languageHunterProfile();
  const pf = S.profile || {};
  const qIdx = Math.min(+(pf.eng_q || 0), ENGLISH_TRIMESTERS.length - 1);
  const target = ENGLISH_TRIMESTERS[qIdx]?.level || 'A2';
  const verified = pf.eng_real_level || 'Not tested';
  const { titulo, pasos } = pasosInglesDelDia(wd);
  const learning = languageLearningContext();
  const errorText = learning.errors.length ? learning.errors.map((x,i)=>`${i+1}. ${x.wrong} → ${x.correct}${x.rule ? ` (${x.rule})` : ''}`).join('\n') : 'No recurring errors saved yet.';
  const phraseText = learning.phrases.length ? learning.phrases.map((x,i)=>`${i+1}. ${x.phrase}${x.example ? ` — ${x.example}` : ''}`).join('\n') : 'No useful phrases saved yet.';
  const wordText = learning.words.length ? learning.words.map((x,i)=>`${i+1}. ${x.word||x.correct}${x.wrong ? ` (previous error: ${x.wrong})` : ''}`).join('\n') : 'No priority words due today.';
  const previous = languageSessions().slice(-1)[0] || {};
  return `You are my Language Hunter English tutor.\n\nTODAY\nDay: ${DIAS[wd]}\nMission: ${titulo}\nVerified level: ${verified}\nCurrent target: ${target}\nAvailable time: ${minutes} minutes\n\nSTUDY LESSON\nBook: ${cfg.book || 'Not specified'}\nBook level: ${cfg.level || 'Not specified'}\nUnit: ${cfg.unit || 'Not specified'}\nPages: ${cfg.pages || 'Not specified'}\nTopics: ${cfg.topic || 'Not specified'}\nGrammar focuses: ${cfg.grammar || 'Not specified'}\n\nMISSION STEPS\n${pasos.map((p,i)=>`${i+1}. ${p.s}: ${p.how}`).join('\n')}\n\nRECURRING ERRORS TO RETRAIN\n${errorText}\n\nUSEFUL PHRASES TO REUSE\n${phraseText}\n\nWORDS TO RETRAIN\n${wordText}\n\nPREVIOUS SESSION\nMain issue: ${previous.issue || 'No previous issue logged'}\nHomework: ${previous.homework || 'No pending homework'}\n\nRULES\nSpeak mainly in English. Ask one question at a time. Make me produce English before explaining. Correct the most important errors, ask me to retry the corrected form, deliberately reuse the saved phrases, and finish with the exact LANGUAGE HUNTER SESSION REPORT plus a compact APP LOG line.`;
}

function copyLanguageTutorPrompt(wd) {
  const text = languageTutorPrompt(wd);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(()=>toast('Tutor prompt copied. Open your Language Hunter chat.'));
  }
  const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  toast('Tutor prompt copied. Open your Language Hunter chat.');
  return Promise.resolve();
}


function languageSessions() {
  try {
    const rows = JSON.parse((S.profile || {}).language_sessions_v1 || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (_e) { return []; }
}

async function persistLanguageSessions(rows) {
  const value = JSON.stringify((Array.isArray(rows) ? rows : []).slice(-120));
  await api('/api/profile', { body:{ key:'language_sessions_v1', value } });
  S.profile = S.profile || {};
  S.profile.language_sessions_v1 = value;
}

function reportSection(text, heading, nextHeadings = []) {
  const normalized = String(text || '').replace(/\r/g, '');
  const start = normalized.search(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`, 'mi'));
  if (start < 0) return '';
  const after = normalized.slice(start).replace(/^.*\n/, '');
  let end = after.length;
  for (const next of nextHeadings) {
    const pos = after.search(new RegExp(`^${next.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`, 'mi'));
    if (pos >= 0) end = Math.min(end, pos);
  }
  return after.slice(0, end).trim();
}

function parseTutorReport(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  const field = label => {
    const m = text.match(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*:\\s*(.*)$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  const mission = reportSection(text, 'MISSION RESULT', ['TOP CORRECTIONS']);
  const correctionsRaw = reportSection(text, 'TOP CORRECTIONS', ['NEW USEFUL PHRASES']);
  const phrasesRaw = reportSection(text, 'NEW USEFUL PHRASES', ['PRONUNCIATION OR SHADOWING NOTE']);
  const list = rawSection => rawSection.split('\n').map(x=>x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const corrections = list(correctionsRaw).slice(0, 3).map(line => {
    const parts = line.split(/\s*(?:→|->|=>)\s*/);
    return { raw:line, wrong:(parts[0] || '').trim(), correct:(parts[1] || '').trim() };
  });
  const phrases = list(phrasesRaw).slice(0, 5);
  const difficultyMatch = mission.match(/Difficulty\s*:\s*(Easy|Appropriate|Hard)/i);
  const weaknessMatch = mission.match(/Main weakness\s*:\s*(.*)/i);
  return {
    date: field('Date') || hoyLocal(),
    day: field('Day'),
    level: field('Level'),
    target: field('Target'),
    bookUnit: field('Book / unit'),
    topic: field('Topics') || field('Weekly topic'),
    skill: field('Main skill trained'),
    minutes: +(field('Minutes practiced').match(/\d+/) || [0])[0],
    difficulty: difficultyMatch ? difficultyMatch[1][0].toUpperCase()+difficultyMatch[1].slice(1).toLowerCase() : 'Appropriate',
    weakness: weaknessMatch ? weaknessMatch[1].trim() : field('RECURRING ERROR TO REVIEW NEXT TIME'),
    corrections,
    phrases,
    pronunciation: reportSection(text, 'PRONUNCIATION OR SHADOWING NOTE', ['RECURRING ERROR TO REVIEW NEXT TIME']),
    recurring: reportSection(text, 'RECURRING ERROR TO REVIEW NEXT TIME', ['HOMEWORK']),
    homework: reportSection(text, 'HOMEWORK', ['APP LOG']),
    log: reportSection(text, 'APP LOG', []),
    raw:text
  };
}

async function importLanguageTutorReport(wd) {
  const pasted = await modal({
    icon:'↳', title:'Import AI session result',
    text:'After finishing with your AI tutor, paste its complete LANGUAGE HUNTER SESSION REPORT here. The app previews it, then saves minutes, difficulty, corrections, phrases and homework for future missions.',
    fields:[{type:'textarea',label:'Tutor report',rows:14,placeholder:'LANGUAGE HUNTER SESSION REPORT\n\nDate: ...'}],
    okText:'Analyze report', lockClose:true, draftKey:'language_tutor_report'
  });
  if (!pasted || !String(pasted[0] || '').trim()) return false;
  const parsed = parseTutorReport(pasted[0]);
  if (!parsed.log && !parsed.minutes && !parsed.corrections.length && !parsed.phrases.length) {
    toast('The report format could not be recognized. Paste the full report.', 'warn');
    return false;
  }
  const cfg = languageHunterProfile();
  const validErrors = parsed.corrections.filter(x=>x.wrong && x.correct);
  const preview = `<div class="language-import-preview">
    <div><small>SESSION</small><b>${esc(parsed.skill || pasosInglesDelDia(wd).titulo)}</b><span>${parsed.minutes || 0} min · ${esc(parsed.difficulty)}</span></div>
    <div><small>MAIN ISSUE</small><b>${esc(parsed.weakness || parsed.recurring || 'Not detected')}</b></div>
    <div><small>DETECTED</small><b>${validErrors.length} corrections · ${parsed.phrases.length} phrases</b><span>${parsed.homework ? 'Homework included' : 'No homework detected'}</span></div>
  </div>`;
  const reviewed = await modal({
    icon:'✓', title:'Review imported session', text:preview,
    fields:[
      {type:'number',label:'Minutes practiced',value:parsed.minutes || 0,min:0,max:300},
      {type:'select',label:'Difficulty',value:parsed.difficulty,options:['Easy','Appropriate','Hard'].map(v=>({v,t:v}))},
      {type:'text',label:'Main issue',value:parsed.weakness || parsed.recurring || '',placeholder:'Main weakness'},
      {type:'textarea',label:'APP LOG',rows:3,value:parsed.log || '',placeholder:'Compact tutor summary'}
    ], okText:'Save imported session', lockClose:true, draftKey:'language_import_preview'
  });
  if (!reviewed) return false;
  const rows = languageSessions();
  rows.push({
    date:parsed.date || hoyLocal(), day:parsed.day || DIAS[wd],
    skill:parsed.skill || pasosInglesDelDia(wd).titulo, source_id:cfg.id || '', book:cfg.book,
    unit:cfg.unit, pages:cfg.pages, topic:parsed.topic || cfg.topic,
    grammar:cfg.grammar, minutes:+reviewed[0] || 0,
    difficulty:reviewed[1] || 'Appropriate', issue:String(reviewed[2] || '').trim(),
    phrases:parsed.phrases.length, log:String(reviewed[3] || '').trim(),
    homework:parsed.homework || '', pronunciation:parsed.pronunciation || '',
    imported:true
  });
  await persistLanguageSessions(rows);
  if (validErrors.length || parsed.phrases.length) {
    const addNotes = await confirmModal('Update learning notebook', `Add <b>${validErrors.length}</b> detected corrections and <b>${parsed.phrases.length}</b> useful phrases to the Language Hunter notebook?<br><br>You can review or delete them later.`, false);
    if (addNotes) {
      const errors = languageErrors();
      for (const item of validErrors) {
        const existing = errors.find(x=>String(x.wrong||'').toLowerCase()===item.wrong.toLowerCase() && String(x.correct||'').toLowerCase()===item.correct.toLowerCase());
        if (existing) { existing.count=(+existing.count||1)+1; existing.status='Learning'; existing.updated_at=hoyLocal(); }
        else errors.push({id:`err-${Date.now()}-${errors.length}`,kind:(!item.wrong.includes(' ')&&!item.correct.includes(' '))?'word':'sentence',wrong:item.wrong,correct:item.correct,rule:parsed.weakness || '',count:1,status:'Learning',updated_at:hoyLocal()});
        if(!item.wrong.includes(' ')&&!item.correct.includes(' ')) await addWordHunterCard({word:item.correct,wrong:item.wrong,meaning:parsed.weakness||'',source:'Personal error',priority:5});
      }
      await saveLanguageProfileArray('language_errors_v1', errors);
      const phrases = languagePhrases();
      for (const phrase of parsed.phrases) {
        if (!phrase || phrases.some(x=>String(x.phrase||'').toLowerCase()===phrase.toLowerCase())) continue;
        phrases.push({id:`phr-${Date.now()}-${phrases.length}`,phrase,meaning:'',example:'',source:'AI conversation',topic:cfg.topic||'',confidence:'Learning',updated_at:hoyLocal()});
      }
      await saveLanguageProfileArray('language_phrases_v1', phrases);
    }
  }
  toast('↳ Tutor report imported. The next prompt can use this evidence.');
  return true;
}

function openLanguageSessionHistory() {
  const rows = languageSessions().slice().reverse();
  const previous=document.activeElement;
  const back=document.createElement('div'); back.className='modal-back language-history-back modal-back-stacked';
  const items = rows.length ? rows.map(x=>`<article class="language-history-item"><div><small>${esc(x.date||'')} · ${esc(x.day||'')}</small><b>${esc(x.skill||'Language mission')}</b><span>${+x.minutes||0} min · ${esc(x.difficulty||'Appropriate')}</span><em>${esc(x.book||'')}${x.unit?' · '+esc(x.unit):''}${x.topic?' · '+esc(x.topic):''}</em></div><div><small>MAIN ISSUE</small><b>${esc(x.issue||'No issue logged')}</b>${x.homework?`<em>${esc(x.homework)}</em>`:''}</div></article>`).join('') : '<div class="language-notebook-empty">No tutor sessions saved yet.</div>';
  back.innerHTML=`<div class="modal-card language-history-card"><div class="language-mission-top"><div><span>LANGUAGE HUNTER ARCHIVE</span><h3>Tutor sessions</h3></div><button type="button" class="language-mission-close">✕</button></div><div class="language-history-list">${items}</div></div>`;
  const close=()=>{back.classList.remove('show');setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();},250)};
  document.body.appendChild(back);document.body.classList.add('modal-open');requestAnimationFrame(()=>back.classList.add('show'));back.querySelector('.language-mission-close').onclick=close;back.onclick=e=>{if(e.target===back)e.preventDefault();};
}

async function saveLanguageSessionReport(wd) {
  const cfg = languageHunterProfile();
  const importedToday = languageSessions().some(x => x.imported && x.date === hoyLocal() && (!x.source_id || x.source_id === cfg.id));
  if (importedToday) { toast('AI session result already saved. No duplicate manual report was created.'); return; }
  const r = await modal({
    icon:'📝', title:'Mission report',
    text:'Optional. The official English check is already safe; skipping this report will not affect Life, Habits, Goals or your streak.',
    fields:[
      {type:'number',label:'Minutes practiced',min:0,max:300,placeholder:'25'},
      {type:'select',label:'Difficulty',options:[{v:'Appropriate',t:'Appropriate'},{v:'Easy',t:'Easy'},{v:'Hard',t:'Hard'}]},
      {type:'text',label:'Main issue',placeholder:'Irregular verbs'},
      {type:'number',label:'New useful phrases',min:0,max:50,placeholder:'3'},
      {type:'text',label:'Tutor APP LOG (optional)',placeholder:'Speaking · 20 min · Past simple...'}
    ], okText:'Save report', cancelText:'Skip report', lockClose:true, draftKey:'language_manual_report'
  });
  if (!r) return;
  let sessions=languageSessions();
  sessions.push({date:hoyLocal(),day:DIAS[wd],skill:(pasosInglesDelDia(wd).titulo||''),source_id:cfg.id||'',book:cfg.book,unit:cfg.unit,pages:cfg.pages,topic:cfg.topic,grammar:cfg.grammar,minutes:+r[0]||0,difficulty:r[1]||'Appropriate',issue:String(r[2]||'').trim(),phrases:+r[3]||0,log:String(r[4]||'').trim()});
  await persistLanguageSessions(sessions);
  toast('📝 Mission report saved.');
}

function openLanguageMissionModal(day, wd) {
  return new Promise(async resolve => {
    const configured = await configureLanguageHunterSource(false);
    if (!configured) { resolve(false); return; }
    const cfg = languageHunterProfile();
    const { titulo, pasos } = pasosInglesDelDia(wd);
    const done = new Set(S.rdone || []);
    const previousFocus=document.activeElement;
    const back=document.createElement('div'); back.className='modal-back language-mission-back';
    const stepRows=pasos.map((p,k)=>`<label class="language-mission-step ${done.has(`${day}|ingles#${k}`)?'done':''}"><input type="checkbox" data-lang-step="${k}" ${done.has(`${day}|ingles#${k}`)?'checked':''}><span class="language-step-number">${String(k+1).padStart(2,'0')}</span><span><b>${esc(p.s)}</b><small>${esc(p.how)}</small></span></label>`).join('');
    back.innerHTML=`<div class="modal-card language-mission-card">
      <div class="language-mission-top"><div><span>LANGUAGE HUNTER · ${esc(DIAS[wd].toUpperCase())}</span><h3>${esc(titulo)}</h3></div><button type="button" class="language-mission-close" aria-label="Close">✕</button></div>
      <div class="language-source-strip"><div><small>ACTIVE LESSON · ${cfg.sourceCount} SAVED</small><b>${esc(cfg.book)}${cfg.level?' · '+esc(cfg.level):''}</b><span>${esc(cfg.unit||'No unit')}${cfg.pages?' · pages '+esc(cfg.pages):''}</span></div><button type="button" data-language-edit-source>Edit</button></div>
      <div class="language-topic-line"><span>${esc(cfg.topic)}</span>${cfg.grammar?`<b>${esc(cfg.grammar)}</b>`:''}</div>
      <div class="language-mission-steps">${stepRows}</div>
      <div class="language-notebook-toolbar language-notebook-toolbar-three"><button type="button" data-language-errors>✎ Errors <b>${languageErrors().filter(x=>x.status!=='Mastered').length}</b></button><button type="button" data-language-phrases>◆ Phrases <b>${languagePhrases().length}</b></button><button type="button" data-language-history>▤ Sessions <b>${languageSessions().length}</b></button></div>
      <div class="language-mission-actions language-mission-actions-v123"><button type="button" class="btn-ghost" data-language-ai>Copy AI tutor prompt</button><button type="button" class="btn-ghost" data-language-import>Import AI session result</button><button type="button" class="m-ok language-complete" disabled>Complete mission ✓</button></div>
      <small class="language-save-note">Every step is saved immediately. Close and continue later without losing progress.</small>
    </div>`;
    document.body.appendChild(back); document.body.classList.add('modal-open'); requestAnimationFrame(()=>back.classList.add('show'));
    let busy=false, closed=false;
    const refresh=()=>{ const boxes=[...back.querySelectorAll('[data-lang-step]')]; boxes.forEach(x=>x.closest('.language-mission-step').classList.toggle('done',x.checked)); back.querySelector('.language-complete').disabled=!boxes.every(x=>x.checked); };
    refresh();
    const close=(val)=>{ if(closed)return; closed=true; back.classList.remove('show'); setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previousFocus?.focus?.();},280);resolve(val); };
    back.querySelector('.language-mission-close').onclick=()=>close(false);
    back.onclick=e=>{if(e.target===back)e.preventDefault();};
    back.querySelector('[data-language-ai]').onclick=()=>copyLanguageTutorPrompt(wd);
    back.querySelector('[data-language-errors]').onclick=()=>openLanguageNotebook('errors');
    back.querySelector('[data-language-phrases]').onclick=()=>openLanguageNotebook('phrases');
    back.querySelector('[data-language-history]').onclick=()=>openLanguageSessionHistory();
    back.querySelector('[data-language-import]').onclick=()=>importLanguageTutorReport(wd);
    back.querySelector('[data-language-edit-source]').onclick=async()=>{ const ok=await configureLanguageHunterSource(true); if(ok){ close(false); toast('Source updated. Open the mission again.'); } };
    back.querySelectorAll('[data-lang-step]').forEach(box=>box.onchange=async()=>{
      if(busy){box.checked=!box.checked;return;} busy=true; box.disabled=true;
      try{
        const k=+box.dataset.langStep; const marker=`${day}|ingles#${k}`;
        await api('/api/routine',{body:{day,activity:`ingles#${k}`}});
        S.rdone=S.rdone||[];
        if(box.checked){if(!S.rdone.includes(marker))S.rdone.push(marker);}else{S.rdone=S.rdone.filter(x=>x!==marker);}
        refresh();
      }catch(err){box.checked=!box.checked;toast('The step could not be saved. Try again.');refresh();}
      finally{box.disabled=false;busy=false;}
    });
    back.querySelector('.language-complete').onclick=()=>close(true);
  });
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
function getCustomCards() {
  const raw = ((S || {}).profile || {}).custom_credit_cards;
  if (!raw) return [];
  try {
    const cards = JSON.parse(raw);
    return Array.isArray(cards) ? cards.filter(c => c && c.key && c.label) : [];
  } catch (e) { return []; }
}
function getPayMethods() {
  const custom = getCustomCards().map(c => ({ id: c.creditor || c.key, label: `${c.label} (credit)`, logo: '💳', card: true }));
  const seen = new Set();
  return [...PAY_METHODS, ...custom].filter(m => !seen.has(m.id) && seen.add(m.id));
}
const payMethod = (id) => getPayMethods().find(m => m.id === id) || PAY_METHODS[0];
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
        ? '⚠ The server took too long and did not confirm the operation. Try again.'
        : '⚠ Could not connect to the server. Check your connection and try again.', 'err');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      let friendly = 'The change could not be saved. Try again in a moment.';
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

function modal({ icon = '⚔', title = '', text = '', fields = [], okText = 'Confirm', danger = false, extraBtn = null, cancelText = null, lockClose = false, draftKey = null }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'modal-back';
    if (document.querySelector('.language-mission-back')) back.classList.add('modal-back-stacked');
    const fieldsHtml = fields.map((f, i) => {
      const lab = f.label ? `<label class="mfield-lab">${f.label}</label>` : '';
      if (f.type === 'select')
        return lab + `<select data-i="${i}">${f.options.map(o => { const v = o.v ?? o; const t = o.t ?? o; const sel = (f.value != null && String(f.value) === String(v)) ? ' selected' : ''; return `<option value="${v}"${sel}>${t}</option>`; }).join('')}</select>`;
      if (f.type === 'money') {
        const initVal = f.value != null && f.value !== '' ? Number(f.value).toLocaleString('es-CO') : '';
        return lab + `<input data-i="${i}" data-money="1" type="text" inputmode="numeric" placeholder="${f.placeholder || ''}" value="${initVal}">`;
      }
      if (f.type === 'textarea')
        return lab + `<textarea data-i="${i}" rows="${f.rows || 8}" placeholder="${f.placeholder || ''}">${esc(f.value ?? '')}</textarea>`;
      return lab + `<input data-i="${i}" type="${f.type || 'text'}" placeholder="${f.placeholder || ''}" value="${esc(f.value ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`;
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
      if (ev.key === 'Escape') { ev.preventDefault(); if (!lockClose) close(null); return; }
      if (ev.key !== 'Tab') return;
      const focusables = [...back.querySelectorAll('button,input,select,textarea,[href]')].filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const firstEl = focusables[0], lastEl = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === firstEl) { ev.preventDefault(); lastEl.focus(); }
      else if (!ev.shiftKey && document.activeElement === lastEl) { ev.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    back.querySelector('.m-ok').onclick = () => {
      if (draftKey) localStorage.removeItem('lifeos_draft_' + draftKey);
      if (fields.length) {
        const vals = [...back.querySelectorAll('[data-i]')].map(el =>
          el.dataset.money ? el.value.replace(/\./g, '').replace(/[^0-9-]/g, '') : el.value);
        close(vals);
      } else close(true);
    };
    const extra = back.querySelector('.m-extra');
    if (extra) extra.onclick = () => close('EXTRA');
    const cancel = back.querySelector('.m-cancel');
    if (cancel) cancel.onclick = () => { if (draftKey) localStorage.removeItem('lifeos_draft_' + draftKey); close(null); };
    back.onclick = (e) => { if (e.target === back && !lockClose) close(null); };
    if (draftKey && fields.length) {
      const storageKey = 'lifeos_draft_' + draftKey;
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (Array.isArray(saved)) [...back.querySelectorAll('[data-i]')].forEach((el,i)=>{ if(saved[i] != null && String(saved[i]) !== '') el.value=String(saved[i]); });
      } catch (_) {}
      const saveDraft = () => {
        const vals=[...back.querySelectorAll('[data-i]')].map(el=>el.value);
        localStorage.setItem(storageKey, JSON.stringify(vals));
      };
      back.querySelectorAll('[data-i]').forEach(el=>{el.addEventListener('input',saveDraft);el.addEventListener('change',saveDraft);});
    }
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
    '⚠ Version mismatch: server v' + (S.version || 1) + ' / browser v' + FRONT_V +
    '. Replace app.py, restart the server, then press Ctrl+F5.</div>');
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
const GYM_GROUP_IMG = { chest:'Pushups', triceps:'Bench_Dips', back:'Pullups', biceps:'Dumbbell_Bicep_Curl', quads:'Barbell_Squat', hamstrings:'Romanian_Deadlift', glutes:'Butt_Lift_Bridge', calves:'Standing_Calf_Raises', shoulders:'Dumbbell_Shoulder_Press', abs:'Crunches', forearms:'Farmers_Walk', cardio:'Jumping_Jacks' };
const EXERCISE_DB = {
  bench:         { n:'Bench Press', m:'Chest', img:'Barbell_Bench_Press_-_Medium_Grip', grp:'chest', eq:'Barbell', mode:'weight_reps', step:2.5 },
  incline_db:    { n:'Incline Dumbbell Press', m:'Upper chest', img:'Incline_Dumbbell_Press', grp:'chest', eq:'Dumbbell', mode:'weight_reps', step:2 },
  flyes:         { n:'Dumbbell Flyes', m:'Chest', img:'Dumbbell_Flyes', grp:'chest', eq:'Dumbbell', mode:'weight_reps', step:1 },
  pushups:       { n:'Push-ups', m:'Chest', img:'Pushups', grp:'chest', eq:'Bodyweight', mode:'reps', step:1 },
  dips_chest:    { n:'Chest Dips', m:'Chest', img:'Dips_-_Chest_Version', grp:'chest', eq:'Dip bars', mode:'bodyweight', step:2.5 },
  cable_cross:   { n:'Cable Crossover', m:'Chest', img:'Cable_Crossover', grp:'chest', eq:'Cable', mode:'weight_reps', step:2.5 },
  machine_bench: { n:'Machine Bench Press', m:'Chest', img:'Machine_Bench_Press', grp:'chest', eq:'Machine', mode:'weight_reps', step:5 },
  db_bench:      { n:'Dumbbell Bench Press', m:'Chest', img:'Dumbbell_Bench_Press', grp:'chest', eq:'Dumbbell', mode:'weight_reps', step:2 },
  decline_bench: { n:'Decline Bench Press', m:'Lower chest', img:'Decline_Barbell_Bench_Press', grp:'chest', eq:'Barbell', mode:'weight_reps', step:2.5 },
  pec_deck:      { n:'Pec Deck Fly', m:'Chest', img:'Butterfly', grp:'chest', eq:'Machine', mode:'weight_reps', step:5 },
  incline_push:  { n:'Incline Push-up', m:'Chest', img:'Pushups', grp:'chest', eq:'Bodyweight', mode:'reps', step:1 },
  diamond_push:  { n:'Diamond Push-up', m:'Chest / Triceps', img:'Pushups', grp:'chest', eq:'Bodyweight', mode:'reps', step:1 },

  tri_pushdown:  { n:'Triceps Pushdown', m:'Triceps', img:'Triceps_Pushdown', grp:'triceps', eq:'Cable', mode:'weight_reps', step:2.5 },
  tri_ext:       { n:'Overhead Triceps Extension', m:'Triceps', img:'Standing_Dumbbell_Triceps_Extension', grp:'triceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  dips_tri:      { n:'Triceps Dips', m:'Triceps', img:'Dips_-_Triceps_Version', grp:'triceps', eq:'Dip bars', mode:'bodyweight', step:2.5 },
  close_grip:    { n:'Close-Grip Bench Press', m:'Triceps', img:'Close-Grip_Barbell_Bench_Press', grp:'triceps', eq:'Barbell', mode:'weight_reps', step:2.5 },
  bench_dips2:   { n:'Bench Dips', m:'Triceps', img:'Bench_Dips', grp:'triceps', eq:'Bodyweight', mode:'reps', step:1 },
  cable_ext_1:   { n:'1-Arm Cable Extension', m:'Triceps', img:'Cable_One_Arm_Tricep_Extension', grp:'triceps', eq:'Cable', mode:'weight_reps', step:1 },
  skullcrusher:  { n:'Lying Triceps Extension', m:'Triceps', img:'Lying_Triceps_Press', grp:'triceps', eq:'EZ bar', mode:'weight_reps', step:2.5 },
  kickback:      { n:'Dumbbell Kickback', m:'Triceps', img:'Tricep_Dumbbell_Kickback', grp:'triceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  rope_overhead: { n:'Rope Overhead Extension', m:'Triceps', img:'Cable_Rope_Overhead_Triceps_Extension', grp:'triceps', eq:'Cable', mode:'weight_reps', step:2.5 },

  pullups:       { n:'Pull-ups', m:'Back / Lats', img:'Pullups', grp:'back', eq:'Pull-up bar', mode:'bodyweight', step:2.5 },
  lat_pull:      { n:'Lat Pulldown', m:'Back / Lats', img:'Wide-Grip_Lat_Pulldown', grp:'back', eq:'Cable machine', mode:'weight_reps', step:5 },
  bb_row:        { n:'Barbell Row', m:'Back', img:'Bent_Over_Barbell_Row', grp:'back', eq:'Barbell', mode:'weight_reps', step:2.5 },
  cable_row:     { n:'Seated Cable Row', m:'Back', img:'Seated_Cable_Rows', grp:'back', eq:'Cable machine', mode:'weight_reps', step:5 },
  tbar_row:      { n:'T-Bar Row', m:'Back', img:'Lying_T-Bar_Row', grp:'back', eq:'Machine', mode:'weight_reps', step:5 },
  one_arm_row:   { n:'One-Arm Dumbbell Row', m:'Back', img:'One-Arm_Dumbbell_Row', grp:'back', eq:'Dumbbell', mode:'weight_reps', step:2 },
  deadlift:      { n:'Barbell Deadlift', m:'Posterior chain', img:'Barbell_Deadlift', grp:'back', eq:'Barbell', mode:'weight_reps', step:5 },
  chinup:        { n:'Chin-Up', m:'Back / Biceps', img:'Chin-Up', grp:'back', eq:'Pull-up bar', mode:'bodyweight', step:2.5 },
  straight_pull: { n:'Straight-Arm Pulldown', m:'Lats', img:'Straight-Arm_Pulldown', grp:'back', eq:'Cable', mode:'weight_reps', step:2.5 },
  inverted_row:  { n:'Inverted Row', m:'Back', img:'Inverted_Row', grp:'back', eq:'Bar / Bodyweight', mode:'reps', step:1 },
  chest_row:     { n:'Chest-Supported Row', m:'Back', img:'Dumbbell_Incline_Row', grp:'back', eq:'Dumbbell', mode:'weight_reps', step:2 },
  shrug:         { n:'Barbell Shrug', m:'Traps', img:'Barbell_Shrug', grp:'back', eq:'Barbell', mode:'weight_reps', step:5 },
  pullover:      { n:'Dumbbell Pullover', m:'Lats / Chest', img:'Bent-Arm_Dumbbell_Pullover', grp:'back', eq:'Dumbbell', mode:'weight_reps', step:2 },

  bb_curl:       { n:'Barbell Curl', m:'Biceps', img:'Barbell_Curl', grp:'biceps', eq:'Barbell', mode:'weight_reps', step:2.5 },
  db_curl:       { n:'Dumbbell Curl', m:'Biceps', img:'Dumbbell_Bicep_Curl', grp:'biceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  hammer:        { n:'Hammer Curl', m:'Biceps / Brachialis', img:'Hammer_Curls', grp:'biceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  concentration: { n:'Concentration Curl', m:'Biceps', img:'Concentration_Curls', grp:'biceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  preacher:      { n:'Preacher Curl', m:'Biceps', img:'Preacher_Curl', grp:'biceps', eq:'EZ bar', mode:'weight_reps', step:2.5 },
  cable_curl2:   { n:'Cable Curl', m:'Biceps', img:'High_Cable_Curls', grp:'biceps', eq:'Cable', mode:'weight_reps', step:2.5 },
  incline_curl:  { n:'Incline Dumbbell Curl', m:'Biceps', img:'Incline_Dumbbell_Curl', grp:'biceps', eq:'Dumbbell', mode:'weight_reps', step:1 },
  reverse_curl:  { n:'Reverse Curl', m:'Biceps / Forearms', img:'Reverse_Barbell_Curl', grp:'biceps', eq:'Barbell', mode:'weight_reps', step:2.5 },
  spider_curl:   { n:'Spider Curl', m:'Biceps', img:'Preacher_Curl', grp:'biceps', eq:'Dumbbell', mode:'weight_reps', step:1 },

  squat:         { n:'Barbell Squat', m:'Quads / Glutes', img:'Barbell_Squat', grp:'quads', eq:'Barbell', mode:'weight_reps', step:5 },
  leg_press:     { n:'Leg Press', m:'Quads / Glutes', img:'Leg_Press', grp:'quads', eq:'Machine', mode:'weight_reps', step:10 },
  leg_ext:       { n:'Leg Extension', m:'Quads', img:'Leg_Extensions', grp:'quads', eq:'Machine', mode:'weight_reps', step:5 },
  lunges:        { n:'Dumbbell Lunges', m:'Quads / Glutes', img:'Dumbbell_Lunges', grp:'quads', eq:'Dumbbell', mode:'weight_reps', step:2 },
  front_squat:   { n:'Front Squat', m:'Quads / Core', img:'Front_Squat_Clean_Grip', grp:'quads', eq:'Barbell', mode:'weight_reps', step:2.5 },
  hack_squat:    { n:'Hack Squat', m:'Quads / Glutes', img:'Hack_Squat', grp:'quads', eq:'Machine', mode:'weight_reps', step:5 },
  goblet:        { n:'Goblet Squat', m:'Quads / Glutes', img:'Goblet_Squat', grp:'quads', eq:'Kettlebell', mode:'weight_reps', step:2 },
  split_squat:   { n:'Bulgarian Split Squat', m:'Quads / Glutes', img:'Dumbbell_Lunges', grp:'quads', eq:'Dumbbell', mode:'weight_reps', step:2 },
  step_up:       { n:'Dumbbell Step-Up', m:'Quads / Glutes', img:'Dumbbell_Step_Ups', grp:'quads', eq:'Dumbbell', mode:'weight_reps', step:2 },
  sissy_squat:   { n:'Sissy Squat', m:'Quads', img:'Bodyweight_Squat', grp:'quads', eq:'Bodyweight', mode:'reps', step:1 },
  wall_sit:      { n:'Wall Sit', m:'Quads', img:'Wall_Sit', grp:'quads', eq:'Bodyweight', mode:'duration', step:5 },

  rdl:           { n:'Romanian Deadlift', m:'Hamstrings / Glutes', img:'Romanian_Deadlift', grp:'hamstrings', eq:'Barbell', mode:'weight_reps', step:5 },
  leg_curl:      { n:'Lying Leg Curl', m:'Hamstrings', img:'Lying_Leg_Curls', grp:'hamstrings', eq:'Machine', mode:'weight_reps', step:5 },
  stiff_db:      { n:'Stiff-Leg Dumbbell Deadlift', m:'Hamstrings', img:'Stiff-Legged_Dumbbell_Deadlift', grp:'hamstrings', eq:'Dumbbell', mode:'weight_reps', step:2 },
  good_morning:  { n:'Good Morning', m:'Hamstrings / Back', img:'Good_Morning', grp:'hamstrings', eq:'Barbell', mode:'weight_reps', step:2.5 },
  seated_curl:   { n:'Seated Leg Curl', m:'Hamstrings', img:'Seated_Leg_Curl', grp:'hamstrings', eq:'Machine', mode:'weight_reps', step:5 },
  nordic_curl:   { n:'Nordic Hamstring Curl', m:'Hamstrings', img:'Natural_Glute_Ham_Raise', grp:'hamstrings', eq:'Bodyweight', mode:'reps', step:1 },
  hip_hinge:     { n:'Cable Pull-Through', m:'Hamstrings / Glutes', img:'Cable_Pull_Through', grp:'hamstrings', eq:'Cable', mode:'weight_reps', step:5 },

  hip_thrust:    { n:'Barbell Hip Thrust', m:'Glutes', img:'Barbell_Hip_Thrust', grp:'glutes', eq:'Barbell', mode:'weight_reps', step:5 },
  glute_bridge:  { n:'Glute Bridge', m:'Glutes', img:'Butt_Lift_Bridge', grp:'glutes', eq:'Bodyweight', mode:'reps', step:1 },
  cable_kick:    { n:'Cable Glute Kickback', m:'Glutes', img:'Cable_Hip_Extension', grp:'glutes', eq:'Cable', mode:'weight_reps', step:2.5 },
  abductor:      { n:'Hip Abductor Machine', m:'Glutes / Abductors', img:'Thigh_Abductor', grp:'glutes', eq:'Machine', mode:'weight_reps', step:5 },
  frog_pump:     { n:'Frog Pumps', m:'Glutes', img:'Butt_Lift_Bridge', grp:'glutes', eq:'Bodyweight', mode:'reps', step:1 },

  calf:          { n:'Standing Calf Raise', m:'Calves', img:'Standing_Calf_Raises', grp:'calves', eq:'Machine / Bodyweight', mode:'weight_reps', step:5 },
  seated_calf:   { n:'Seated Calf Raise', m:'Calves', img:'Seated_Calf_Raise', grp:'calves', eq:'Machine', mode:'weight_reps', step:5 },
  donkey_calf:   { n:'Donkey Calf Raise', m:'Calves', img:'Donkey_Calf_Raises', grp:'calves', eq:'Machine', mode:'weight_reps', step:5 },
  single_calf:   { n:'Single-Leg Calf Raise', m:'Calves', img:'Standing_Calf_Raises', grp:'calves', eq:'Bodyweight', mode:'reps', step:1 },

  db_press:      { n:'Dumbbell Shoulder Press', m:'Shoulders', img:'Dumbbell_Shoulder_Press', grp:'shoulders', eq:'Dumbbell', mode:'weight_reps', step:2 },
  lateral:       { n:'Lateral Raise', m:'Side delts', img:'Side_Lateral_Raise', grp:'shoulders', eq:'Dumbbell', mode:'weight_reps', step:1 },
  face_pull:     { n:'Face Pull', m:'Rear delts', img:'Face_Pull', grp:'shoulders', eq:'Cable', mode:'weight_reps', step:2.5 },
  arnold:        { n:'Arnold Press', m:'Shoulders', img:'Arnold_Dumbbell_Press', grp:'shoulders', eq:'Dumbbell', mode:'weight_reps', step:2 },
  bb_press:      { n:'Barbell Shoulder Press', m:'Shoulders', img:'Barbell_Shoulder_Press', grp:'shoulders', eq:'Barbell', mode:'weight_reps', step:2.5 },
  upright_row:   { n:'Upright Row', m:'Shoulders / Traps', img:'Upright_Barbell_Row', grp:'shoulders', eq:'Barbell', mode:'weight_reps', step:2.5 },
  rear_delt:     { n:'Cable Rear Delt Fly', m:'Rear delts', img:'Cable_Rear_Delt_Fly', grp:'shoulders', eq:'Cable', mode:'weight_reps', step:2.5 },
  front_raise:   { n:'Front Raise', m:'Front delts', img:'Front_Dumbbell_Raise', grp:'shoulders', eq:'Dumbbell', mode:'weight_reps', step:1 },
  reverse_fly:   { n:'Reverse Dumbbell Fly', m:'Rear delts', img:'Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench', grp:'shoulders', eq:'Dumbbell', mode:'weight_reps', step:1 },
  machine_press: { n:'Machine Shoulder Press', m:'Shoulders', img:'Machine_Shoulder_Military_Press', grp:'shoulders', eq:'Machine', mode:'weight_reps', step:5 },

  crunch:        { n:'Crunches', m:'Abs', img:'Crunches', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  plank:         { n:'Plank', m:'Core', img:'Plank', grp:'abs', eq:'Bodyweight', mode:'duration', step:5 },
  hanging:       { n:'Hanging Leg Raise', m:'Abs', img:'Hanging_Leg_Raise', grp:'abs', eq:'Pull-up bar', mode:'reps', step:1 },
  cable_crunch:  { n:'Cable Crunch', m:'Abs', img:'Cable_Crunch', grp:'abs', eq:'Cable', mode:'weight_reps', step:2.5 },
  russian_twist: { n:'Russian Twist', m:'Obliques', img:'Russian_Twist', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  ab_roller:     { n:'Ab Roller', m:'Abs', img:'Ab_Roller', grp:'abs', eq:'Ab wheel', mode:'reps', step:1 },
  situp:         { n:'Sit-Up', m:'Abs', img:'Sit-Up', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  reverse_crunch:{ n:'Reverse Crunch', m:'Abs', img:'Reverse_Crunch', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  side_plank:    { n:'Side Plank', m:'Obliques', img:'Side_Plank', grp:'abs', eq:'Bodyweight', mode:'duration', step:5 },
  dead_bug:      { n:'Dead Bug', m:'Core', img:'Dead_Bug', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  bicycle:       { n:'Bicycle Crunch', m:'Abs / Obliques', img:'Air_Bike', grp:'abs', eq:'Bodyweight', mode:'reps', step:1 },
  mountain:      { n:'Mountain Climbers', m:'Core', img:'Mountain_Climbers', grp:'abs', eq:'Bodyweight', mode:'duration', step:5 },
  hollow_hold:   { n:'Hollow Body Hold', m:'Core', img:'Plank', grp:'abs', eq:'Bodyweight', mode:'duration', step:5 },
  pallof:        { n:'Pallof Press', m:'Core / Anti-rotation', img:'Pallof_Press', grp:'abs', eq:'Cable', mode:'weight_reps', step:2.5 },

  wrist_curl:    { n:'Wrist Curl', m:'Forearms', img:'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench', grp:'forearms', eq:'Barbell', mode:'weight_reps', step:1 },
  reverse_wrist: { n:'Reverse Wrist Curl', m:'Forearms', img:'Palms-Down_Wrist_Curl_Over_A_Bench', grp:'forearms', eq:'Barbell', mode:'weight_reps', step:1 },
  farmers_walk:  { n:'Farmer Walk', m:'Grip / Full body', img:'Farmers_Walk', grp:'forearms', eq:'Dumbbell', mode:'duration_weight', step:2 },
  dead_hang:     { n:'Dead Hang', m:'Grip / Shoulders', img:'Pullups', grp:'forearms', eq:'Pull-up bar', mode:'duration', step:5 },

  jumping_jack:  { n:'Jumping Jacks', m:'Cardio', img:'Jumping_Jacks', grp:'cardio', eq:'Bodyweight', mode:'duration', step:10 },
  high_knees:    { n:'High Knees', m:'Cardio', img:'High_Knees', grp:'cardio', eq:'Bodyweight', mode:'duration', step:10 },
  burpee:        { n:'Burpees', m:'Full body', img:'Burpee', grp:'cardio', eq:'Bodyweight', mode:'reps', step:1 },
  bike:          { n:'Stationary Bike', m:'Cardio', img:'Bicycling_Stationary', grp:'cardio', eq:'Bike', mode:'duration', step:60 },
  rower:         { n:'Rowing Machine', m:'Cardio / Back', img:'Rowing_Stationary', grp:'cardio', eq:'Rower', mode:'duration', step:60 }
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
function exerciseMode(exId) { return (EXERCISE_DB[exId] && EXERCISE_DB[exId].mode) || 'weight_reps'; }
function parseTarget(range) {
  const nums = String(range || '').match(/\d+/g)?.map(Number) || [10];
  return { low: nums[0] || 10, high: nums[1] || nums[0] || 10 };
}
function formatGymSet(exId, set) {
  const mode = exerciseMode(exId);
  const value = +set.reps || 0;
  const load = +set.weight || 0;
  if (mode === 'duration') return `${value}s`;
  if (mode === 'duration_weight') return `${load ? load + 'kg · ' : ''}${value}s`;
  if (mode === 'reps') return `${value} reps`;
  if (mode === 'bodyweight') {
    if (load < 0) return `${value} reps · ${Math.abs(load)}kg assistance`;
    if (load > 0) return `${value} reps · +${load}kg`;
    return `${value} reps · bodyweight`;
  }
  return `${load}kg × ${value}`;
}
function fmtSets(exId, sets) { return sets.map(s => formatGymSet(exId, s)).join(', '); }
function gymSuggest(exId, repsRange) {
  const ex = EXERCISE_DB[exId] || {};
  const mode = exerciseMode(exId);
  const last = gymLastSession(exId);
  const { low, high } = parseTarget(repsRange);
  if (!last || !last.sets.length) {
    const firstText = mode === 'duration' || mode === 'duration_weight'
      ? 'First time — choose a controlled duration inside the target range.'
      : mode === 'reps' || mode === 'bodyweight'
        ? 'First time — use clean form and stay inside the target range.'
        : 'First time — pick a load you can fully control for the whole rep range.';
    return { weight:'', reps:'', text:firstText };
  }
  const lastSet = last.sets[last.sets.length - 1];
  const allHitTop = last.sets.every(s => (+s.reps || 0) >= high);
  const step = +ex.step || 1;
  if (mode === 'duration' || mode === 'duration_weight') {
    const next = Math.max(low, (+lastSet.reps || low) + step);
    return { weight:lastSet.weight || '', reps:next, text:`Aim for ${next}s with the same quality. When the top range feels controlled, choose a harder variation.` };
  }
  if (mode === 'reps') {
    const next = Math.max(low, (+lastSet.reps || low) + 1);
    return { weight:'', reps:next, text: allHitTop ? 'You reached the top range — add a harder variation or slower tempo.' : `Aim for ${next} clean reps.` };
  }
  if (mode === 'bodyweight') {
    const load = +lastSet.weight || 0;
    if (allHitTop) {
      if (load < 0) return { weight:Math.min(0, load + step), reps:low, text:`Top range reached — reduce assistance to ${Math.abs(Math.min(0, load + step))} kg.` };
      return { weight:load + step, reps:low, text:`Top range reached — try +${load + step} kg, or keep bodyweight with stricter form.` };
    }
    return { weight:load || '', reps:(+lastSet.reps || low) + 1, text:'Keep the same assistance or added load and aim for one more clean rep.' };
  }
  if (allHitTop && (+lastSet.weight || 0) > 0) {
    const next = +((+lastSet.weight || 0) + step).toFixed(1);
    return { weight:next, reps:low, text:`Top range reached → move to ${next} kg.` };
  }
  return { weight:lastSet.weight || '', reps:(+lastSet.reps || low) + 1, text:`Keep ${lastSet.weight || '?'} kg and aim for one more rep.` };
}
function gymScore(exId, set) {
  const mode = exerciseMode(exId), r = +set.reps || 0, w = +set.weight || 0;
  if (mode === 'duration') return r;
  if (mode === 'duration_weight') return r + Math.max(0, w) * 10;
  if (mode === 'reps') return r;
  if (mode === 'bodyweight') return r * 100 + w;
  return Math.max(0, w) * 1000 + r;
}
function gymProgression(exId) {
  const today = gymSetsFor(exId, hoyLocal());
  const last = gymLastSession(exId);
  if (!today.length || !last) return null;
  const best = arr => Math.max(...arr.map(s => gymScore(exId, s)));
  const t = best(today), l = best(last.sets);
  if (t > l) return { cls:'ok', text:'⬆ Stronger than last session — progress!' };
  if (t === l) return { cls:'mut', text:'➡ Matched last session — solid.' };
  return { cls:'bad', text:'⬇ Below last time — recovery, technique and fatigue can explain it.' };
}
function gymTrend(exId) {
  const dates = [...new Set((S.gym_sets || []).filter(s => s.exercise === exId).map(s => s.date))].sort().slice(-5);
  if (dates.length < 3) return null;
  const scores = dates.map(d => Math.max(...gymSetsFor(exId, d).map(s => gymScore(exId, s))));
  let gains = 0;
  for (let i=1;i<scores.length;i++) if (scores[i] > scores[i-1]) gains++;
  if (gains >= 2) return { cls:'ok', text:'Progress trend: improving. Keep this exercise.' };
  if (scores.slice(-3).every(v => v <= scores[scores.length-3])) return { cls:'bad', text:'No measurable progress in 3 sessions. Consider a lighter week or variation.' };
  return { cls:'mut', text:'Progress trend: stable.' };
}

function gymDateDiffDays(a,b=hoyLocal()) { return Math.max(0,Math.floor((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)); }
function gymAllTrainingDates() { return [...new Set((S.gym_sets||[]).map(x=>x.date).filter(Boolean))].sort(); }
function gymBlockState() {
  const p=getGymPrefs(), dates=gymAllTrainingDates();
  const start=p.blockStart || hoyLocal(); // V130 starts a fresh block without reinterpreting old history
  const weeks=Math.max(1,Math.floor(gymDateDiffDays(start)/7)+1);
  const length=Math.min(8,Math.max(4,+p.blockLength||6));
  const due=weeks>=length && p.blockReviewedStart!==start;
  const deloadActive=!!(p.deloadUntil && p.deloadUntil>=hoyLocal());
  return {start,weeks,length,due,deloadActive,deloadUntil:p.deloadUntil||null};
}
function gymBlockAnalysis() {
  const st=gymBlockState(), since=new Date(Date.now()-st.length*7*86400000).toISOString().slice(0,10);
  const ids=[...new Set((S.gym_sets||[]).filter(x=>x.date>=since).map(x=>x.exercise))];
  const rows=ids.map(id=>({id, ex:EXERCISE_DB[id], trend:gymTrend(id)})).filter(x=>x.ex);
  return {
    state:st,
    improving:rows.filter(x=>x.trend?.cls==='ok'),
    stable:rows.filter(x=>!x.trend||x.trend.cls==='mut'),
    stalled:rows.filter(x=>x.trend?.cls==='bad'),
    sessions:new Set((S.gym_sets||[]).filter(x=>x.date>=since).map(x=>x.date)).size
  };
}
function suggestedBlockSwaps(analysis) {
  const out=[];
  Object.entries(WORKOUT_PLAN).forEach(([wd,plan])=>{
    if(!plan.list)return;
    plan.list.forEach(([orig])=>{
      const current=effectiveExId(+wd,orig);
      if(!analysis.stalled.some(x=>x.id===current))return;
      const alt=altsFor(current).find(a=>!analysis.stalled.some(x=>x.id===a.id));
      if(alt)out.push({wd:+wd,orig,from:current,to:alt.id});
    });
  });
  return out.slice(0,6);
}
async function startNewGymBlock(extra={}) {
  const p=getGymPrefs();
  p.blockStart=hoyLocal(); p.blockReviewedStart=null; p.blockNumber=(+p.blockNumber||1)+1;
  Object.assign(p,extra); await saveGymPrefs(p); renderWorkout();
}
function openGymBlockReview() {
  const a=gymBlockAnalysis(), swaps=suggestedBlockSwaps(a), back=document.createElement('div'); back.className='modal-back doc-back';
  const rows=swaps.length?swaps.map(x=>`<label class="block-swap"><input type="checkbox" data-block-swap checked data-wd="${x.wd}" data-orig="${x.orig}" data-to="${x.to}"><span><b>${esc(EXERCISE_DB[x.from]?.n||x.from)}</b><small>→ ${esc(EXERCISE_DB[x.to]?.n||x.to)}</small></span></label>`).join(''):'<p class="hint">No stalled exercise needs replacement. Keeping the routine is a strong option.</p>';
  back.innerHTML=`<div class="modal-card doc-card gym-block-card"><div class="doc-head"><div><small>◆ TRAINING BLOCK</small><h3>Review · Week ${a.state.weeks}</h3></div><button class="doc-x">✕</button></div><div class="doc-body"><div class="block-score"><div><strong>${a.improving.length}</strong><span>improving</span></div><div><strong>${a.stable.length}</strong><span>stable</span></div><div><strong>${a.stalled.length}</strong><span>stalled</span></div></div><p class="hint">${a.sessions} training days analyzed. Nothing changes until you approve it.</p><details class="block-details"><summary>Suggested exercise changes</summary>${rows}</details><div class="block-actions"><button data-block-action="keep">Keep routine</button><button data-block-action="refresh">Apply selected changes</button><button data-block-action="deload">Start lighter week</button></div></div></div>`;
  document.body.appendChild(back); requestAnimationFrame(()=>back.classList.add('show')); const close=()=>{back.classList.remove('show');setTimeout(()=>back.remove(),250)}; back.querySelector('.doc-x').onclick=close; back.onclick=e=>{if(e.target===back)close()};
  back.querySelectorAll('[data-block-action]').forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.blockAction,p=getGymPrefs();
    if(action==='keep'){p.blockReviewedStart=a.state.start;p.blockStart=hoyLocal();p.blockNumber=(+p.blockNumber||1)+1;delete p.deloadUntil;await saveGymPrefs(p);close();toast('Routine kept · new training block started');renderWorkout();return;}
    if(action==='deload'){const until=new Date(Date.now()+7*86400000).toISOString().slice(0,10);p.deloadUntil=until;p.blockReviewedStart=a.state.start;await saveGymPrefs(p);close();toast('Lighter week active for 7 days');renderWorkout();return;}
    p.swaps=p.swaps||{}; back.querySelectorAll('[data-block-swap]:checked').forEach(c=>p.swaps[slotKey(+c.dataset.wd,c.dataset.orig)]=c.dataset.to);
    p.blockStart=hoyLocal();p.blockReviewedStart=null;p.blockNumber=(+p.blockNumber||1)+1;delete p.deloadUntil;await saveGymPrefs(p);close();toast('Approved changes applied · new block started');renderWorkout();
  });
}
function openMeasurementGuide() {
  docModal('📏 How to take your measurements', `<p>A simple <b>sewing tape (metro de costura)</b> is all you need. Measure in the morning before eating, relaxed, tape snug but not tight, on the same day each week.</p><ul class="gym-help-list"><li><b>Waist</b> — around the navel, relaxed. Your main fat-loss signal.</li><li><b>Chest</b> — across the nipples, arms down, normal breath.</li><li><b>Arm</b> — flexed bicep, at its thickest point.</li><li><b>Hips</b> — widest part of the glutes.</li><li><b>Thigh</b> — highest point, just under the glute.</li><li><b>Weight</b> — same scale, morning, after bathroom, before eating.</li></ul><p>One bad week means little. Food and water move the scale daily; the <b>2-week trend</b> matters.</p>`);
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
function gymCelebratedToday() { const p=getGymPrefs(); return p.workoutCelebratedDate===hoyLocal(); }
async function markGymCelebratedToday() { const p=getGymPrefs(); p.workoutCelebratedDate=hoyLocal(); await saveGymPrefs(p); }

let GYM_TIMER = { kind:null, exercise:null, endAt:0, remaining:0, interval:null, running:false, minimized:false, completed:false };
function gymTimerPrefs() {
  const p = getGymPrefs();
  return { autoRest:p.autoRest !== false, sound:p.timerSound !== false, vibration:p.timerVibration !== false, minimize:p.timerMinimize === true };
}
function gymBeep() {
  const pref = gymTimerPrefs();
  if (pref.sound) try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(.001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.18, ctx.currentTime+.02); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+.45);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+.48);
  } catch {}
  if (pref.vibration && navigator.vibrate) navigator.vibrate([180,80,180]);
}
function formatClock(sec) { sec=Math.max(0,Math.ceil(sec)); return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
function stopGymTimer(clear=true) {
  if (GYM_TIMER.interval) clearInterval(GYM_TIMER.interval);
  GYM_TIMER.interval=null; GYM_TIMER.running=false;
  if (clear) GYM_TIMER={kind:null,exercise:null,endAt:0,remaining:0,interval:null,running:false,minimized:false,completed:false};
  renderGymTimerBar();
}
function renderGymTimerBar() {
  document.querySelector('.gym-timer-float')?.remove();
  if (!GYM_TIMER.kind) return;
  const left = GYM_TIMER.running ? Math.max(0,(GYM_TIMER.endAt-Date.now())/1000) : GYM_TIMER.remaining;
  const exName=GYM_TIMER.exercise&&EXERCISE_DB[GYM_TIMER.exercise]?EXERCISE_DB[GYM_TIMER.exercise].n:'';
  const label=GYM_TIMER.kind==='rest'?'REST':'ACTIVE';
  const el=document.createElement('div'); el.className=`gym-timer-float ${GYM_TIMER.kind} ${GYM_TIMER.minimized?'minimized':''} ${GYM_TIMER.completed?'complete':''}`;
  el.innerHTML=`<button class="gym-timer-main" data-timer-toggle aria-label="${GYM_TIMER.minimized?'Expand':'Minimize'} timer"><span><small>${label}${exName?' · '+esc(exName):''}</small><strong>${GYM_TIMER.completed?'READY':formatClock(left)}</strong></span><b>${GYM_TIMER.minimized?'▲':'▼'}</b></button><div class="gym-timer-actions"><button data-timer-pause>${GYM_TIMER.running?'Pause':'Resume'}</button><button data-timer-add>+15s</button><button data-timer-stop>${GYM_TIMER.completed?'Done':'Skip'}</button></div>`;
  document.body.appendChild(el);
}
function startGymTimer(seconds, kind='rest', exercise=null) {
  stopGymTimer();
  GYM_TIMER={kind,exercise,endAt:Date.now()+seconds*1000,remaining:seconds,interval:null,running:true,minimized:gymTimerPrefs().minimize,completed:false};
  const tick=()=>{
    const left=Math.max(0,(GYM_TIMER.endAt-Date.now())/1000); GYM_TIMER.remaining=left; renderGymTimerBar();
    if (left<=0) { const ex=GYM_TIMER.exercise; if(GYM_TIMER.interval)clearInterval(GYM_TIMER.interval); GYM_TIMER.interval=null; GYM_TIMER.running=false; GYM_TIMER.remaining=0; GYM_TIMER.completed=true; GYM_TIMER.minimized=false; renderGymTimerBar(); gymBeep(); toast(kind==='rest'?'⚡ Rest complete — next set ready.':`⏱ Time complete${ex&&EXERCISE_DB[ex]?' · '+EXERCISE_DB[ex].n:''}`); }
  };
  GYM_TIMER.interval=setInterval(tick,500); tick();
}
document.addEventListener('click', e=>{
  const toggle=e.target.closest('[data-timer-toggle]'); if(toggle){e.preventDefault();e.stopPropagation();GYM_TIMER.minimized=!GYM_TIMER.minimized;renderGymTimerBar();return;}
  if (e.target.closest('[data-timer-pause]')) { e.preventDefault(); e.stopPropagation(); if(GYM_TIMER.completed)return;
    if (GYM_TIMER.running) { GYM_TIMER.remaining=Math.max(0,(GYM_TIMER.endAt-Date.now())/1000); clearInterval(GYM_TIMER.interval); GYM_TIMER.interval=null; GYM_TIMER.running=false; renderGymTimerBar(); }
    else startGymTimer(GYM_TIMER.remaining, GYM_TIMER.kind, GYM_TIMER.exercise);
  }
  if (e.target.closest('[data-timer-add]')) { e.preventDefault();e.stopPropagation(); if(GYM_TIMER.completed)return; const left=GYM_TIMER.running?Math.max(0,(GYM_TIMER.endAt-Date.now())/1000):GYM_TIMER.remaining; startGymTimer(left+15,GYM_TIMER.kind,GYM_TIMER.exercise); }
  if (e.target.closest('[data-timer-stop]')) {e.preventDefault();e.stopPropagation();stopGymTimer();}
});
function gymInputRow(id, idx, valueW, valueR, extra=false) {
  const ex=EXERCISE_DB[id]||{}, mode=exerciseMode(id), label=extra?'Extra':`Set ${idx+1}`;
  if (mode==='duration' || mode==='duration_weight') {
    return `<div class="set-row set-live ${extra?'set-extra':''}"><span class="set-n">${label}</span>${mode==='duration_weight'?`<input class="set-w" type="number" step="0.5" min="0" placeholder="kg" value="${valueW||''}">`:''}<input class="set-r" type="number" min="1" placeholder="seconds" value="${valueR||''}"><button class="set-timer" data-start-ex-timer="${id}" title="Start timer">⏱</button><button class="set-log" data-log="${id}">✓</button></div>`;
  }
  if (mode==='reps') return `<div class="set-row set-live ${extra?'set-extra':''}"><span class="set-n">${label}</span><input class="set-r" type="number" min="1" placeholder="reps" value="${valueR||''}"><button class="set-log" data-log="${id}">✓</button></div>`;
  if (mode==='bodyweight') return `<div class="set-row set-live ${extra?'set-extra':''}"><span class="set-n">${label}</span><input class="set-r" type="number" min="1" placeholder="reps" value="${valueR||''}"><input class="set-w body-load" type="number" step="0.5" placeholder="+kg / -assist" value="${valueW||''}" title="Positive = added weight, negative = assistance"><button class="set-log" data-log="${id}">✓</button></div>`;
  return `<div class="set-row set-live ${extra?'set-extra':''}"><span class="set-n">${label}</span><input class="set-w" type="number" step="0.5" min="0" placeholder="kg" value="${valueW||''}"><span class="set-x">×</span><input class="set-r" type="number" min="1" placeholder="reps" value="${valueR||''}"><button class="set-log" data-log="${id}">✓</button></div>`;
}
function targetLabel(id, reps) { const m=exerciseMode(id); return (m==='duration'||m==='duration_weight')?`${reps}`:`${reps} reps`; }
function renderWorkout() {
  const box=document.getElementById('workoutBox'); if(!box)return;
  const sel=document.getElementById('workoutDay'), todayWd=new Date().getDay();
  if(sel&&!sel.dataset.ready){ let opts=`<option value="today">Today · ${DAY_NAMES[todayWd]}</option>`; [1,2,3,4,5].forEach(w=>opts+=`<option value="${w}">${WORKOUT_PLAN[w].title}</option>`); opts+=`<option value="rest">🌿 Rest day</option>`; sel.innerHTML=opts; sel.dataset.ready='1'; sel.addEventListener('change',()=>{GYM_PLAN_SEL=sel.value;renderWorkout();}); }
  let wd=(GYM_PLAN_SEL==null||GYM_PLAN_SEL==='today')?todayWd:(GYM_PLAN_SEL==='rest'?0:+GYM_PLAN_SEL), plan=WORKOUT_PLAN[wd]||WORKOUT_PLAN[0];
  const titleEl=document.getElementById('workoutTitle'); if(titleEl) titleEl.textContent=(GYM_PLAN_SEL==null||GYM_PLAN_SEL==='today')?`🔥 Today · ${plan.title.replace(/^\S+\s/,'')}`:plan.title;
  if(plan.rest){ box.innerHTML=`<div class="rest-day"><div class="big">🌿</div><p><b>Rest day.</b> Recovery is part of the training arc.</p><p class="hint">Walk, mobility or gentle stretching only.</p></div>`; return; }
  const prefs=gymTimerPrefs(), block=gymBlockState();
  const blockLabel=block.deloadActive?`Deload until ${block.deloadUntil.slice(5)}`:`Block ${(+getGymPrefs().blockNumber||1)} · Week ${block.weeks}/${block.length}`;
  const toolbar=`<div class="gym-hunter-bar"><span>◆ TRAINING SYSTEM</span><button data-gym-timer-settings title="Timer settings">?</button><button class="gym-block-pill ${block.due?'due':''}" data-gym-block-review title="Review training block">${blockLabel}${block.due?' · Review':''}</button><small>${Object.keys(EXERCISE_DB).length} illustrated exercises · adaptive metrics</small></div>`;
  const banner=wd!==todayWd?`<div class="workout-banner">📅 Viewing <b>${plan.title.replace(/^\S+\s/,'')}</b>. New sets are saved to today.</div>`:'';
  let allDone=true;
  box.innerHTML=toolbar+banner+plan.list.map(([origId,baseSets,reps,rest])=>{
    const origEx=EXERCISE_DB[origId]; if(!origEx)return''; const id=effectiveExId(wd,origId), ex=EXERCISE_DB[id]||origEx, normalSets=effectiveSetCount(wd,origId,baseSets), sets=block.deloadActive?Math.max(1,Math.ceil(normalSets*.6)):normalSets, today=gymSetsFor(id,hoyLocal()), last=gymLastSession(id), sug=gymSuggest(id,reps), prog=gymProgression(id), trend=gymTrend(id), done=today.length>=sets; if(!done)allDone=false;
    const swapped=id!==origId, sessionsCount=new Set((S.gym_sets||[]).filter(s=>s.exercise===id).map(s=>s.date)).size, suggestVariation=!swapped&&sessionsCount>=8&&altsFor(id).length>0&&(!trend||trend.cls!=='ok');
    let rows=''; const shown=Math.max(sets,today.length);
    for(let i=0;i<shown;i++){
      if(i<today.length){const set=today[i];rows+=`<div class="set-row set-done"><span class="set-n">Set ${i+1}</span><span class="set-val">${formatGymSet(id,set)}</span><button class="set-undo" data-undo="${set.id}">✕</button></div>`;}
      else if(i===today.length){const prev=today[today.length-1];rows+=gymInputRow(id,i,prev?.weight??sug.weight,prev?.reps??sug.reps);}
      else rows+=`<div class="set-row set-upcoming"><span class="set-n">Set ${i+1}</span><span class="set-val mut">target ${targetLabel(id,reps)}</span></div>`;
    }
    if(today.length>=shown)rows+=gymInputRow(id,shown,today[today.length-1]?.weight||'', '', true);
    const canRemove=sets>Math.max(1,today.length), ctrl=`<div class="set-ctrl">${canRemove?`<button class="set-adj" data-adj="-1" data-wd="${wd}" data-orig="${origId}" data-base="${baseSets}">− Set</button>`:'<span></span>'}<button class="set-adj" data-adj="1" data-wd="${wd}" data-orig="${origId}" data-base="${baseSets}">+ Set</button></div>`;
    return `<div class="ex-card hunter-ex ${done?'ex-done':''}" data-ex="${id}" data-rest="${rest}" data-planned-sets="${sets}"><div class="ex-top"><img class="ex-img" loading="lazy" src="${GYM_IMG}${ex.img}/0.jpg" alt="${esc(ex.n)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${GYM_IMG}${GYM_GROUP_IMG[ex.grp]||'Pushups'}/0.jpg'}else this.classList.add('noimg')"><div class="ex-head"><div class="ex-name">${ex.n}${done?'<span class="ex-check">✓</span>':''}</div><div class="ex-mus">${ex.m} · ${ex.eq}${swapped?' · <span class="swap-tag">replaced</span>':''}</div><div class="ex-target">${sets} sets · ${targetLabel(id,reps)} · rest ${rest}s</div></div><div class="ex-actions"><button class="replace-btn" data-replace="${origId}" data-wd="${wd}">🔄</button>${swapped?`<button class="restore-btn" data-restore="${origId}" data-wd="${wd}">↺</button>`:''}</div></div><div class="ex-coach">${last?`<div class="ex-last">Last ${last.date.slice(5)} · ${fmtSets(id,last.sets)}</div>`:'<div class="ex-last mut">No history — today sets your baseline.</div>'}<div class="ex-suggest">🎯 ${sug.text}</div>${prog?`<div class="ex-prog ${prog.cls}">${prog.text}</div>`:''}${trend?`<div class="ex-trend ${trend.cls}">${trend.text}</div>`:''}${suggestVariation?`<div class="ex-variation">Variation recommended · <button class="link-like" data-replace="${origId}" data-wd="${wd}">review options</button></div>`:''}</div><div class="ex-sets">${rows}</div>${ctrl}</div>`;
  }).join('');
  if(allDone&&(GYM_PLAN_SEL==null||GYM_PLAN_SEL==='today')&&wd===todayWd&&GYM_CELEBRATED_DATE!==hoyLocal()&&!gymCelebratedToday()){GYM_CELEBRATED_DATE=hoyLocal();markGymCelebratedToday().catch(()=>{});showWorkoutCelebration();}
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
      <img class="alt-img" loading="lazy" src="${GYM_IMG}${a.img}/0.jpg" alt="" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='${GYM_IMG}${GYM_GROUP_IMG[a.grp]||'Pushups'}/0.jpg'}else this.classList.add('noimg')">
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
  const blockReview=e.target.closest('[data-gym-block-review]'); if(blockReview){openGymBlockReview();return;}
  const settings=e.target.closest('[data-gym-timer-settings]');
  if(settings){
    const p=getGymPrefs(), back=document.createElement('div'); back.className='modal-back doc-back';
    back.innerHTML=`<div class="modal-card doc-card gym-settings-card"><div class="doc-head"><h3>◆ Gym timers</h3><button class="doc-x">✕</button></div><div class="doc-body"><label class="toggle-line"><span>Auto-start rest timer</span><input id="gymAutoRest" type="checkbox" ${p.autoRest!==false?'checked':''}></label><label class="toggle-line"><span>Sound at zero</span><input id="gymTimerSound" type="checkbox" ${p.timerSound!==false?'checked':''}></label><label class="toggle-line"><span>Vibration</span><input id="gymTimerVibration" type="checkbox" ${p.timerVibration!==false?'checked':''}></label><label class="toggle-line"><span>Minimize after start</span><input id="gymTimerMinimize" type="checkbox" ${p.timerMinimize===true?'checked':''}></label><p class="hint">Timed exercises use seconds. Bodyweight exercises hide kilograms unless you add weight or assistance.</p><button class="m-ok" id="gymTimerSave">Save</button></div></div>`;
    document.body.appendChild(back); requestAnimationFrame(()=>back.classList.add('show')); const close=()=>{back.classList.remove('show');setTimeout(()=>back.remove(),250)}; back.querySelector('.doc-x').onclick=close; back.onclick=x=>{if(x.target===back)close()};
    back.querySelector('#gymTimerSave').onclick=async()=>{p.autoRest=back.querySelector('#gymAutoRest').checked;p.timerSound=back.querySelector('#gymTimerSound').checked;p.timerVibration=back.querySelector('#gymTimerVibration').checked;p.timerMinimize=back.querySelector('#gymTimerMinimize').checked;await saveGymPrefs(p);close();toast('Gym timer settings saved');}; return;
  }
  const startTimer=e.target.closest('[data-start-ex-timer]');
  if(startTimer){ const card=startTimer.closest('.ex-card'), input=card.querySelector('.set-live .set-r'), sec=Math.max(1,parseInt(input?.value,10)||parseTarget(card.querySelector('.ex-target')?.textContent).low||30); if(input&&!input.value)input.value=sec; startGymTimer(sec,'exercise',startTimer.dataset.startExTimer); return; }
  const replaceBtn=e.target.closest('[data-replace]'); if(replaceBtn){exercisePickerModal(replaceBtn.dataset.replace,replaceBtn.dataset.wd);return;}
  const restoreBtn=e.target.closest('[data-restore]'); if(restoreBtn){const p=getGymPrefs();p.swaps=p.swaps||{};delete p.swaps[slotKey(restoreBtn.dataset.wd,restoreBtn.dataset.restore)];await saveGymPrefs(p);toast('Original exercise restored');renderWorkout();return;}
  const adjBtn=e.target.closest('[data-adj]'); if(adjBtn){const wd=adjBtn.dataset.wd,orig=adjBtn.dataset.orig,base=+adjBtn.dataset.base,delta=+adjBtn.dataset.adj,p=getGymPrefs();p.setcount=p.setcount||{};const key=slotKey(wd,orig),cur=p.setcount[key]!=null?p.setcount[key]:base,today=gymSetsFor(effectiveExId(wd,orig),hoyLocal()),next=Math.max(Math.max(1,today.length),Math.min(10,cur+delta));if(delta<0&&next>=cur){toast('You already logged that many sets today');return;}p.setcount[key]=next;await saveGymPrefs(p);renderWorkout();return;}
  const log=e.target.closest('[data-log]');
  if(log){
    const todayPlan=WORKOUT_PLAN[new Date().getDay()]; if(todayPlan&&todayPlan.rest){toast('Today is your rest day 🌿');return;}
    const card=log.closest('.ex-card'), row=log.closest('.set-row'), mode=exerciseMode(log.dataset.log), wInput=row.querySelector('.set-w'), rInput=row.querySelector('.set-r');
    const w=parseFloat(String(wInput?.value||'0').replace(',','.'))||0, r=parseInt(rInput?.value,10)||0;
    if(r<=0){toast(mode==='duration'||mode==='duration_weight'?'Type the seconds first ⏱':'Type the reps first 💪');return;}
    try{const res=await api('/api/gym/set',{quiet:true,body:{date:hoyLocal(),exercise:log.dataset.log,weight:w,reps:r}});S.gym_sets=S.gym_sets||[];S.gym_sets.push({id:res.id,date:hoyLocal(),exercise:log.dataset.log,weight:w,reps:r});const rest=+card.dataset.rest||60, planned=+card.dataset.plannedSets||1, completed=gymSetsFor(log.dataset.log,hoyLocal()).length;if(gymTimerPrefs().autoRest&&completed<planned){startGymTimer(rest,'rest',log.dataset.log);toast(`Set ${completed} saved · Rest ${rest}s`);}else{stopGymTimer();toast(completed>=planned?'Exercise complete':'Set saved');}renderWorkout();renderGym();}
    catch{toast("Couldn't save that set right now.");}
    return;
  }
  const undo=e.target.closest('[data-undo]'); if(undo){const id=+undo.dataset.undo;try{await api('/api/gym/set/'+id,{method:'DELETE',quiet:true});S.gym_sets=(S.gym_sets||[]).filter(s=>s.id!=id);renderWorkout();renderGym();}catch{toast("Couldn't undo that set.");}return;}
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
  const totalTrainingDays = new Set((S.gym_sets || []).map(x => x.date).filter(Boolean)).size;
  const card = (label, val, sub) => `<div class="card gym-card"><label>${label}</label><strong>${val}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  panel.innerHTML =
    card('Current weight', curW != null ? curW + ' kg' : '—', curW == null ? 'log it when you have it' : '') +
    card('Goal weight', goalW != null ? goalW + ' kg' : '—', eg ? (eg.auto ? '✨ auto · tap Edit to override' : 'set by you') : 'add your height for auto') +
    card('To go', toGo != null ? (toGo > 0 ? toGo + ' kg' : '🎉 reached!') : '—', '') +
    card('Weeks in', semanas, startDate ? 'since ' + startDate : 'set a start date') +
    card('Training days', totalTrainingDays, 'lifetime · never resets monthly') +
    card('🔥 Training streak', exStreak + (exStreak === 1 ? ' day' : ' days'), 'rests and weekends do not break it');

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

  // guía compacta: el detalle vive en un modal para no ocupar la pantalla
  document.getElementById('gymHelp').innerHTML = `<button class="gym-measure-help" id="gymMeasureHelpBtn"><span>📏 Measurement guide</span><b>?</b></button>`;
}
document.getElementById('gymHelp')?.addEventListener('click',e=>{if(e.target.closest('#gymMeasureHelpBtn'))openMeasurementGuide();});

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
    safeRender('Hunter Profile', renderHunterProfile);
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
  const paper = cont?.closest('.notebook-paper');
  if (paper) paper.dataset.date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  const todos = S.todos || [];
  const pendientes = todos.filter(t => !t.done);
  const btn = document.getElementById('openTodoBtn');
  if (btn) btn.innerHTML = '📝 To-do' + (pendientes.length ? ` <span class="shop-count">${pendientes.length}</span>` : '');
  if (!cont) return;
  if (!todos.length) {
    cont.innerHTML = `<div class="todo-empty-note">
      <span>✦</span>
      <p>No field notes yet.<br><small>Write down the next thing you cannot afford to forget.</small></p>
    </div>`;
    return;
  }
  cont.innerHTML = todos.map(t => `
    <div class="todo-note-row ${t.done ? 'is-complete' : ''}" data-todo-row="${t.id}">
      <button class="todo-check" data-id="${t.id}" type="button"
        aria-pressed="${t.done ? 'true' : 'false'}"
        title="${t.done ? 'Reopen field note' : 'Complete field note'}">
        <span>${t.done ? '✓' : ''}</span>
      </button>
      <span class="todo-note-text">${esc(t.texto)}</span>
      <button class="todo-remove" data-todo="${t.id}" type="button" title="Delete field note">✕</button>
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
  const ok = await modal({
    icon: '📜',
    title: 'Clear completed field notes?',
    text: `${hechos.length} completed ${hechos.length === 1 ? 'note' : 'notes'} will be removed now. Otherwise, they disappear automatically tomorrow.`,
    okText: 'Clear completed',
    cancelText: 'Keep them'
  });
  if (ok === null) return;
  await withBusy(e.currentTarget, async () => {
    await api('/api/todo/clear_done', { body: {} });
    toast('✓ Completed field notes cleared');
    await load();
  });
});

document.addEventListener('click', async (e) => {
  const tchk = e.target.closest('.todo-check');
  if (tchk) {
    await withBusy(tchk, async () => {
      await api('/api/todo/toggle', { body: { id: +tchk.dataset.id } });
      await load();
    });
    return;
  }
  const tdel = e.target.closest('.todo-remove');
  if (tdel) {
    const item = (S.todos || []).find(t => +t.id === +tdel.dataset.todo);
    const ok = await modal({
      icon: '🗑️',
      title: 'Delete field note?',
      text: `<b>${esc(item?.texto || 'This note')}</b> will be removed from today’s notebook.`,
      okText: 'Delete note',
      cancelText: 'Keep it'
    });
    if (ok === null) return;
    await withBusy(tdel, async () => {
      await api('/api/todo/' + tdel.dataset.todo, { method: 'DELETE' });
      toast('✕ Field note removed');
      await load();
    });
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
        { type: 'select', label: 'Paid with', options: getPayMethods().map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) }
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
    ms.innerHTML = getPayMethods().map(m => `<option value="${m.id}">${m.logo} ${m.label}</option>`).join('');
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
        { type: 'select', value: s.method, options: getPayMethods().map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) },
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
        { type: 'select', options: getPayMethods().map(m => ({ v: m.id, t: `${m.logo} ${m.label}` })) },
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
const BASE_TARJETAS = [
  { key: 'Tarjeta DV', label: 'Davivienda', boss: 'Tarjeta DV — Jefe Final', creditor: 'Tarjeta DV', accent: 'red', code: '4582' },
  { key: 'ADDI', label: 'ADDI', boss: 'ADDI', creditor: 'ADDI', accent: 'green', code: '2048' },
  { key: 'Codensa', label: 'Codensa', boss: 'Codensa', creditor: 'Codensa', accent: 'amber', code: '7714' },
  { key: 'Banco de Bogotá', label: 'Banco de Bogotá', boss: 'Banco de Bogotá', creditor: 'Banco de Bogotá', accent: 'blue', code: '9016' }
];
function misTarjetas() {
  return [...BASE_TARJETAS, ...getCustomCards().map((c, i) => ({
    key: c.key, label: c.label, boss: c.boss || c.key, creditor: c.creditor || c.key,
    accent: c.accent || 'violet', code: String(6200 + i).slice(-4), custom: true
  }))];
}
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
  const cards = misTarjetas();
  const nombreMes = (S.plan.months || [])[MES] || '';
  const checksSet = new Set(S.checks || []);
  const mkCard = monthKey(MES);
  let totalLimit = 0, totalOwed = 0, totalAvailable = 0, totalPaid = 0;

  const rendered = cards.map(t => {
    const bd = (S.debts || []).find(d => d.name === t.boss);
    const comprado = bd ? compradoEn(bd.name) : 0;
    const abonDet = bd ? abonoDetalleDeUnJefe(bd.name) : 0;
    let totalCard = bd ? bd.initial + comprado : 0;
    let pagado = bd ? bd.abonado + abonDet : 0;
    let saldo = Math.max(totalCard - (bd ? bd.abonado : 0) - abonDet, 0);
    if (t.key === 'Tarjeta DV') {
      const st = amortState();
      totalCard = st.A.capital; saldo = st.saldoCapital; pagado = Math.max(totalCard - saldo, 0);
    }
    const cupo = +(pf['cupo_' + t.key] || 0);
    const disponible = cupo ? Math.max(cupo - saldo, 0) : 0;
    const usoPct = cupo ? Math.min((saldo / cupo) * 100, 100) : 0;
    const pagoPct = totalCard ? Math.min((pagado / totalCard) * 100, 100) : 0;
    const pagoMes = cuotaPlanMes(t.creditor, MES) + extraCuota(t.creditor, MES);
    const cuotaPagadaMes = checksSet.has(`${t.boss}|${mkCard}`) || checksSet.has(`${t.creditor}|${mkCard}`);
    const risk = !cupo ? 'unknown' : usoPct >= 80 ? 'critical' : usoPct >= 60 ? 'high' : usoPct >= 30 ? 'watch' : 'controlled';
    const riskLabel = { unknown: 'LIMIT NOT SET', critical: 'CRITICAL USE', high: 'HIGH USE', watch: 'UNDER WATCH', controlled: 'CONTROLLED' }[risk];
    totalLimit += cupo; totalOwed += saldo; totalAvailable += disponible; totalPaid += pagado;

    return `<article class="hunter-card hunter-card--${esc(t.accent || 'violet')} hunter-card--${risk}${saldo <= 0 ? ' is-defeated' : ''}">
      <div class="hunter-card-art" aria-hidden="true">
        <span class="hunter-card-shadow"></span><span class="hunter-card-chip"></span>
        <span class="hunter-card-orbit orbit-a"></span><span class="hunter-card-orbit orbit-b"></span>
        <span class="hunter-card-number">•••• &nbsp;•••• &nbsp;•••• &nbsp;${esc(t.code || '0000')}</span>
      </div>
      <div class="hunter-card-content">
        <header class="hunter-card-head">
          <div><span class="hunter-card-kicker">HUNTER BANK CARD</span>
            <h3><span aria-hidden="true">💳</span> ${esc(t.label)}</h3></div>
          <div class="hunter-card-actions">
            <span class="hunter-card-risk">${riskLabel}</span>
            <button class="card-cupo-edit" data-key="${esc(t.key)}" data-cupo="${cupo}" title="Set / raise the limit">✎</button>
          </div>
        </header>
        <div class="hunter-card-limit">${cupo ? `LIMIT <strong>${fmt(cupo)}</strong>` : 'SET YOUR LIMIT WITH ✎'}</div>
        <div class="card-grid">
          <div><label>You owe now</label><b class="owe">${fmt(saldo)}</b></div>
          <div><label>Available</label><b class="avail">${cupo ? fmt(disponible) : '—'}</b></div>
          <div><label>Paid so far</label><b class="paid">${fmt(pagado)}</b></div>
          <div><label>${nombreMes || 'This month'}</label><b>${cuotaPagadaMes ? '<span class="paid-chip">✓ paid</span>' : (pagoMes ? fmt(pagoMes) : '—')}</b></div>
        </div>
        ${saldo > 0 ? `<button class="card-pay-btn" data-boss="${esc(t.boss)}" data-creditor="${esc(t.creditor)}" data-saldo="${saldo}"><span>💵</span> Pay this card</button>` : '<div class="card-clear"><b>☠ BOSS DEFEATED</b><span>Balance cleared. Your limit is free again.</span></div>'}
        <div class="hunter-card-meter"><div class="card-bar ${saldo <= 0 ? 'paid' : ''}"><i style="width:${cupo ? usoPct : pagoPct}%"></i></div>
          <small>${cupo ? `${Math.round(usoPct)}% of your limit used` : `${Math.round(pagoPct)}% paid off · set your limit to see available room`}</small></div>
      </div>
    </article>`;
  }).join('');

  const globalUse = totalLimit ? Math.min((totalOwed / totalLimit) * 100, 100) : 0;
  cont.innerHTML = `<section class="credit-command">
      <div class="credit-command-copy"><span>CREDIT COMMAND</span><strong>${cards.length} active card${cards.length === 1 ? '' : 's'}</strong><small>${totalLimit ? `${Math.round(globalUse)}% global utilization` : 'Set limits to unlock utilization intel'}</small></div>
      <div class="credit-command-stats">
        <div><label>Total limit</label><b>${totalLimit ? fmt(totalLimit) : '—'}</b></div>
        <div><label>Total owed</label><b class="owe">${fmt(totalOwed)}</b></div>
        <div><label>Available</label><b class="avail">${totalLimit ? fmt(totalAvailable) : '—'}</b></div>
        <div><label>Paid so far</label><b class="paid">${fmt(totalPaid)}</b></div>
      </div>
      <button id="addCreditCard" class="credit-add-btn" type="button" aria-label="Add a new credit card"><span>＋</span><b>Add card</b></button>
    </section>
    <div class="credit-card-grid">${rendered}</div>`;
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

// Agregar una nueva tarjeta propia. Se integra a Debt Boss y a los medios de pago.
document.addEventListener('click', async (e) => {
  const add = e.target.closest('#addCreditCard');
  if (!add) return;
  const r = await modal({ icon: '💳', title: 'Add a credit card',
    text: 'Create another personal card. Its balance will join Debt Boss and it will become available as a credit payment method.',
    fields: [
      { type: 'text', placeholder: 'Card name (e.g. Nu Credit)' },
      { type: 'money', placeholder: 'Total limit (cupo)' },
      { type: 'money', placeholder: 'What you owe now (optional)' },
      { type: 'select', label: 'Visual identity', options: [
        { v: 'violet', t: '🟣 Violet' }, { v: 'blue', t: '🔵 Blue' },
        { v: 'red', t: '🔴 Red' }, { v: 'amber', t: '🟠 Amber' },
        { v: 'green', t: '🟢 Green' }, { v: 'cyan', t: '🩵 Cyan' }
      ] }
    ], okText: 'Create card' });
  if (!r) return;
  const name = String(r[0] || '').trim();
  const limit = +String(r[1] || '').replace(/[^0-9]/g, '') || 0;
  const initial = +String(r[2] || '').replace(/[^0-9]/g, '') || 0;
  if (name.length < 2) { toast('Use a card name with at least 2 characters', 'warn'); return; }
  if (limit && initial > limit) { toast('The current balance cannot be greater than the limit', 'warn'); return; }
  await withBusy(add, async () => {
    await api('/api/card/new', { body: { name, limit, initial, accent: r[3] || 'violet' } });
    toast(`💳 ${esc(name)} joined your credit command`);
    await load();
  });
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
// Días de descanso excepcionales guardados desde Life (por ejemplo, un festivo entre semana).
// Se conservan por fecha exacta para que no desaparezcan cuando el turno semanal vuelva a la normalidad.
function lifeRestDates() {
  try {
    const raw = JSON.parse((S.profile || {}).life_rest_dates || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}
function isLifeRestDate(iso) { return lifeRestDates().has(iso); }
async function saveLifeRestDate(iso) {
  if (!iso) return;
  const dates = lifeRestDates();
  dates.add(iso);
  await api('/api/profile', { body: { key: 'life_rest_dates', value: JSON.stringify([...dates].sort()) } });
  if (S.profile) S.profile.life_rest_dates = JSON.stringify([...dates].sort());
}
function nextVisibleDateForWeekday(wd) {
  const pick = document.getElementById('dayPick');
  if (pick) {
    const option = [...pick.options].find(o => Number(String(o.value).split('|')[1]) === Number(wd));
    if (option) return String(option.value).split('|')[0];
  }
  const d = new Date(); d.setHours(12,0,0,0);
  const current = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() + ((Number(wd) - current + 7) % 7));
  return localISO(d);
}
// Calcula días consecutivos de un hábito hasta hoy (o hasta ayer si hoy aún no se marca)
function rachaHabito(habitId, marks, extraSkipDays = []) {
  let streak = 0;
  const d = new Date();
  // si hoy no está marcado, empezar a contar desde ayer (no rompe la racha aún)
  const hoyKey = `${habitId}|${localISO(d)}`;
  if (!marks.has(hoyKey)) d.setDate(d.getDate() - 1);
  for (let k = 0; k < 400; k++) {
    const dow = d.getDay();
    const iso = localISO(d);
    if (dow === 0 || extraSkipDays.includes(dow) || isLifeRestDate(iso)) { d.setDate(d.getDate() - 1); continue; }   // domingos, descansos del hábito y Rest excepcionales de Life no rompen ni cuentan la racha
    const key = `${habitId}|${iso}`;
    if (marks.has(key)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

// Long-term record used by Pirate Position and legacy celebrations.
// Authorized rests never add days and never break the sequence.
function maxHistoricalHabitStreak(habit, marks = new Set(S.marks || [])) {
  const dates = [...marks]
    .filter(key => String(key).startsWith(`${habit.id}|`))
    .map(key => String(key).split('|')[1])
    .filter(Boolean)
    .sort();
  if (!dates.length) return 0;
  const first = new Date(`${dates[0]}T12:00:00`);
  const last = new Date(`${hoyLocal()}T12:00:00`);
  const extraSkip = habit.name === 'Exercise' ? [6] : [];
  let run = 0, best = 0;
  for (const d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const iso = localISO(d), dow = d.getDay();
    if (dow === 0 || extraSkip.includes(dow) || isLifeRestDate(iso)) continue;
    if (marks.has(`${habit.id}|${iso}`)) { run += 1; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}
function maxHistoricalDisciplineStreak() {
  const marks = new Set(S.marks || []);
  return Math.max(0, ...(S.habits || []).map(h => maxHistoricalHabitStreak(h, marks)));
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

  // Monthly score uses only this month's marks, while streaks keep the complete history.
  const currentMonthMarks = (S.marks || []).filter(key => String(key).split('|')[1]?.startsWith(ym + '-'));
  const done = currentMonthMarks.length;
  const restDates = lifeRestDates();
  let denominator = 0;
  const eligibleCalendarDays = new Set();
  for (const h of (S.habits || [])) {
    const exercise = h.name === 'Exercise';
    for (let d = 1; d <= elapsed; d++) {
      const iso = `${ym}-${String(d).padStart(2, '0')}`;
      const dow = new Date(iso + 'T12:00:00').getDay();
      const rest = dow === 0 || (exercise && dow === 6) || restDates.has(iso);
      if (!rest) { denominator++; eligibleCalendarDays.add(iso); }
    }
  }
  const globalPct = Math.min(1, done / Math.max(1, denominator));
  $('#habitStats').innerHTML = `
    <div class="card green"><label>Marks this month</label><strong>${done}</strong></div>
    <div class="card gold"><label>Haki completion</label><strong>${pct(globalPct)}</strong></div>
    <div class="card"><label>Active days</label><strong>${eligibleCalendarDays.size} / ${elapsed}</strong></div>`;
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
function goalFieldDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(String(value).slice(0, 16).replace('T', ' '));
  return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function goalLifeSignals(goal) {
  const careers = (S.careers || []).filter(c => String(c.goal_id || '') === String(goal.id));
  const today = S.today || hoyLocal();
  const routines = (S.rdone || []).filter(x => String(x).startsWith(today + '|')).length;
  const marks = (S.marks || []).filter(x => String(x).endsWith('|' + today)).length;
  const courses = (S.courses_done || []).filter(c => careers.some(k => String(k.id) === String(c.career_id))).length;
  return { careers, routines, marks, courses };
}

function expeditionOperations(goal) {
  const checkpoints = (S.goal_checkpoints || []).filter(x => String(x.goal_id) === String(goal.id));
  const logs = (S.goal_logs || []).filter(x => String(x.goal_id) === String(goal.id)).slice(0, 8);
  const strategy = (S.goal_strategy || []).find(x => String(x.goal_id) === String(goal.id)) || {};
  const done = checkpoints.filter(x => +x.done).length;
  const signals = goalLifeSignals(goal);
  const checkpointHtml = checkpoints.length ? checkpoints.map(cp => `<div class="gx-checkpoint ${+cp.done ? 'done' : ''}">
      <label class="gx-check-control" title="${+cp.done ? 'Reopen checkpoint' : 'Complete checkpoint'}">
        <input id="gx-check-${cp.id}" type="checkbox" data-goal-check-toggle="${cp.id}" ${+cp.done ? 'checked' : ''} aria-label="${+cp.done ? 'Reopen' : 'Complete'} checkpoint: ${esc(cp.title)}">
        <span class="gx-check-box" aria-hidden="true">${+cp.done ? '✓' : ''}</span>
      </label>
      <label class="gx-check-title" for="gx-check-${cp.id}">${esc(cp.title)}</label>
      <button type="button" class="gx-mini-delete" data-goal-check-delete="${cp.id}" aria-label="Delete checkpoint">×</button>
    </div>`).join('') : '<div class="gx-empty">No checkpoints yet. Break the expedition into concrete field objectives.</div>';
  const logHtml = logs.length ? logs.map(log => `<article class="gx-log"><span>${goalFieldDate(log.created)}</span><p>${esc(log.note)}</p><button type="button" data-goal-log-delete="${log.id}" aria-label="Delete field note">×</button></article>`).join('') : '<div class="gx-empty">No field notes yet. Record progress, evidence or a blocker.</div>';
  const threat = strategy.threat || 'Stable';
  return `<section class="gx-operations" data-goal-ops="${goal.id}">
    <div class="gx-ops-head"><div><span>EXPEDITION OPERATIONS</span><h3>Field execution layer</h3></div><div class="gx-completion"><b>${done}/${checkpoints.length}</b><small>checkpoints cleared</small></div></div>
    <div class="gx-ops-grid">
      <article class="gx-panel gx-checkpoints"><header><div><span>CHECKPOINTS</span><h4>Mission objectives</h4></div><b>${done}/${checkpoints.length}</b></header><p class="gx-retention-note">Completed checkpoints remain visible for 24 hours, then they are removed automatically.</p><div class="gx-check-list">${checkpointHtml}</div><form class="gx-inline-form" data-goal-check-form="${goal.id}"><input name="title" maxlength="180" placeholder="Add a concrete checkpoint" required><button type="submit">＋ Add</button></form></article>
      <article class="gx-panel gx-threat"><header><div><span>THREAT ANALYSIS</span><h4>Obstacle & countermeasure</h4></div><em class="gx-threat-badge threat-${threat.toLowerCase().replace(/\s+/g,'-')}">${esc(threat)}</em></header>
        <form data-goal-strategy-form="${goal.id}" class="gx-strategy-form"><label>Primary obstacle<input name="obstacle" value="${esc(strategy.obstacle || '')}" placeholder="What is slowing this route?"></label><label>Threat level<select name="threat">${['Stable','Under watch','High risk','Critical'].map(x=>`<option ${x===threat?'selected':''}>${x}</option>`).join('')}</select></label><label class="wide">Countermeasure<textarea name="strategy" rows="2" placeholder="How will you neutralize it?">${esc(strategy.strategy || '')}</textarea></label><label class="wide">Next field action<input name="next_action" value="${esc(strategy.next_action || '')}" placeholder="The next action you can execute"></label><button type="submit">Save field strategy</button></form>
      </article>
      <article class="gx-panel gx-signals"><header><div><span>CONNECTED SIGNALS</span><h4>Life systems feeding this route</h4></div></header><div class="gx-signal-grid"><div><strong>${signals.careers.length}</strong><span>linked careers</span></div><div><strong>${signals.courses}</strong><span>completed courses</span></div><div><strong>${signals.routines}</strong><span>Life checks today</span></div><div><strong>${signals.marks}</strong><span>Habit checks today</span></div></div><p>Career progress linked from Life continues syncing automatically. Habit activity is shown as context only; Haki remains its independent One Piece system.</p></article>
      <article class="gx-panel gx-journal"><header><div><span>FIELD LOG</span><h4>Expedition chronicle</h4></div></header><form class="gx-log-form" data-goal-log-form="${goal.id}"><textarea name="note" maxlength="600" rows="2" placeholder="What changed, what did you learn, and what happens next?" required></textarea><button type="submit">Record field note</button></form><div class="gx-log-list">${logHtml}</div></article>
    </div>
  </section>`;
}

function renderExpeditions() {
  const host = document.getElementById('expeditionPanel');
  if (!host) return;
  const goals = (S.goals || []).slice().sort((a,b) => {
    const aw = a.status === 'Lograda 🏆' ? 1 : 0, bw = b.status === 'Lograda 🏆' ? 1 : 0;
    return aw - bw || (b.pct || 0) - (a.pct || 0) || String(a.name).localeCompare(String(b.name));
  });
  if (!goals.length) {
    activeExpeditionId = null;
    host.innerHTML = `<div class="dc-empty dc-empty-dossier">
      <span class="dc-empty-mark">◇</span>
      <div><b>NO EXPEDITION DOSSIERS</b><p>Create your first Goal to reveal a route on the Dark Continent.</p></div>
    </div>`;
    return;
  }
  if (!goals.some(g => String(g.id) === String(activeExpeditionId))) activeExpeditionId = goals[0].id;
  const active = goals.find(g => String(g.id) === String(activeExpeditionId)) || goals[0];
  const p = Math.max(0, Math.min(100, +(active.pct || 0)));
  const achieved = active.status === 'Lograda 🏆' || p >= 100;
  const zoneIx = expeditionZoneIndex(p, achieved);
  const rank = hunterRankFor(p, achieved);
  const currentZone = EXPEDITION_ZONES[zoneIx].name;
  const statusKey = achieved ? 'conquered' : active.status === 'Pendiente' ? 'dormant' : p >= 80 ? 'final' : p >= 60 ? 'advanced' : p >= 40 ? 'trial' : 'active';
  const statusLabel = achieved ? 'TERRITORY CONQUERED' : active.status === 'Pendiente' ? 'DORMANT ROUTE' : p >= 80 ? 'FINAL APPROACH' : p >= 60 ? 'ADVANCED EXPEDITION' : p >= 40 ? 'TRIAL IN PROGRESS' : 'ACTIVE EXPEDITION';
  const target = String(active.target || '').trim();
  const zones = EXPEDITION_ZONES.map((z, i) => {
    const conquered = achieved || i < zoneIx;
    const current = !achieved && i === zoneIx;
    const locked = !conquered && !current;
    return `<div class="dc-zone ${conquered ? 'conquered' : ''} ${current ? 'current' : ''} ${locked ? 'locked' : ''}">
      <span class="dc-zone-index">0${i + 1}</span>
      <span class="dc-zone-dot">${conquered ? '✓' : current ? '◆' : '◇'}</span>
      <small>${esc(z.name)}</small>
    </div>`;
  }).join('<span class="dc-route-line"></span>');
  const routes = goals.map((g, i) => {
    const gp = Math.max(0, Math.min(100, +(g.pct || 0)));
    const ga = g.status === 'Lograda 🏆' || gp >= 100;
    const gr = hunterRankFor(gp, ga);
    const selected = String(g.id) === String(active.id);
    const routeState = ga ? 'CONQUERED' : g.status === 'Pendiente' ? 'DORMANT' : 'ACTIVE';
    return `<button type="button" class="dc-route-card ${selected ? 'active' : ''} ${ga ? 'completed' : ''}" data-expedition-select="${esc(String(g.id))}" aria-pressed="${selected}">
      <span class="dc-route-number">${String(i + 1).padStart(2,'0')}</span>
      <span class="dc-route-copy"><b>${esc(g.name)}</b><small>${routeState} · ${gp}%</small></span>
      <span class="dc-route-rank rank-${gr}">${gr}</span>
    </button>`;
  }).join('');
  const completedCount = goals.filter(g => g.status === 'Lograda 🏆' || Number(g.pct || 0) >= 100).length;
  host.innerHTML = `<div class="dc-command-header">
      <div class="dc-command-title"><span>DARK CONTINENT OPERATIONS</span><h2>Expedition Command Center</h2><p>Every Goal becomes a live route. Select a dossier, inspect its territory and execute the next critical mission.</p></div>
      <div class="dc-command-overview" aria-label="Expedition overview">
        <div><small>ROUTES</small><strong>${goals.length}</strong></div>
        <div><small>ACTIVE</small><strong>${goals.length - completedCount}</strong></div>
        <div><small>CONQUERED</small><strong>${completedCount}</strong></div>
      </div>
    </div>
    <div class="dc-shell">
      <aside class="dc-route-selector" aria-label="Expedition routes">
        <div class="dc-selector-title"><span>ROUTE DOSSIERS</span><b>${goals.length}</b></div>
        <div class="dc-route-scroll">${routes}</div>
      </aside>
      <article class="dc-expedition-feature ${achieved ? 'completed' : ''} status-${statusKey}" data-goal-id="${active.id}">
        <div class="dc-map-art" aria-hidden="true"></div>
        <div class="dc-map-overlay"></div>
        <div class="dc-feature-grid" aria-hidden="true"></div>
        <div class="dc-feature-content">
          <div class="dc-dossier-strip"><span>HUNTER ASSOCIATION · FIELD DOSSIER</span><b>${statusLabel}</b></div>
          <div class="dc-expedition-head">
            <div class="dc-expedition-copy"><span class="dc-eyebrow">SELECTED ROUTE</span><h2>${esc(active.name)}</h2><p>${esc(active.why || 'A territory worth conquering.')}</p></div>
            <div class="dc-rank rank-${rank}"><small>RANK</small><b>${rank}</b><span>${achieved ? 'CLEARED' : 'MISSION'}</span></div>
          </div>
          <div class="dc-feature-stats">
            <div><small>PROGRESS</small><strong>${p}%</strong><span>${100-p}% remaining</span></div>
            <div><small>CURRENT TERRITORY</small><strong>${esc(currentZone)}</strong><span>Phase ${zoneIx + 1} of ${EXPEDITION_ZONES.length}</span></div>
            <div><small>TARGET DATE</small><strong>${target ? esc(target) : 'Open timeline'}</strong><span>${achieved ? 'Mission archived' : 'Field objective'}</span></div>
          </div>
          <div class="dc-progress-block"><div class="dc-progress-meta"><span>ROUTE COMPLETION</span><strong>${p}%</strong></div><div class="dc-progress"><i style="width:${p}%"></i></div></div>
          <div class="dc-map" aria-label="Expedition territories">${zones}</div>
          <div class="dc-critical"><span>CRITICAL MISSION</span><b>${esc(expeditionMission(active))}</b><small>Complete this action to move the expedition forward.</small></div>
          ${achieved ? '<div class="dc-seal">EXPEDITION CONQUERED</div>' : ''}
        </div>
      </article>
    </div>
    ${expeditionOperations(active)}`;
}

document.addEventListener('click', (event) => {
  const route = event.target.closest('[data-expedition-select]');
  if (!route) return;
  activeExpeditionId = route.dataset.expeditionSelect;
  renderExpeditions();
});

document.addEventListener('submit', async (event) => {
  const checkForm = event.target.closest('[data-goal-check-form]');
  const logForm = event.target.closest('[data-goal-log-form]');
  const strategyForm = event.target.closest('[data-goal-strategy-form]');
  if (!checkForm && !logForm && !strategyForm) return;
  event.preventDefault();
  const form = checkForm || logForm || strategyForm;
  await withBusy(form.querySelector('button[type="submit"]') || form, async () => {
    const fd = new FormData(form);
    if (checkForm) await api('/api/goal/checkpoint', { body:{ goal_id:+checkForm.dataset.goalCheckForm, title:String(fd.get('title') || '').trim() } });
    if (logForm) await api('/api/goal/log', { body:{ goal_id:+logForm.dataset.goalLogForm, note:String(fd.get('note') || '').trim() } });
    if (strategyForm) await api('/api/goal/strategy', { body:{ goal_id:+strategyForm.dataset.goalStrategyForm, obstacle:fd.get('obstacle'), threat:fd.get('threat'), strategy:fd.get('strategy'), next_action:fd.get('next_action') } });
    await load();
    toast(checkForm ? 'Checkpoint added.' : logForm ? 'Field note recorded.' : 'Field strategy saved.');
  });
});

document.addEventListener('change', async (event) => {
  const toggle = event.target.closest('input[data-goal-check-toggle]');
  if (!toggle || toggle.disabled) return;

  // V116 final: los checkpoints son hitos visuales y persistentes.
  // No alteran porcentajes; Life, cursos, carreras o la edición manual del Goal
  // continúan siendo las únicas fuentes de progreso de la expedición.
  const done = toggle.checked ? 1 : 0;
  const previousDone = !done;
  toggle.checked = Boolean(previousDone);
  toggle.disabled = true;
  try {
    await api('/api/goal/checkpoint/toggle', {
      body: { id: +toggle.dataset.goalCheckToggle, done }
    });
    await load();
    toast(done ? '✓ Checkpoint completed · visible for 24 hours.' : '◇ Checkpoint reopened.');
  } catch (error) {
    toggle.checked = Boolean(previousDone);
    throw error;
  } finally {
    toggle.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const delCheck = event.target.closest('[data-goal-check-delete]');
  const delLog = event.target.closest('[data-goal-log-delete]');
  if (!delCheck && !delLog) return;

  if (delCheck) {
    const accepted = await modal({
      icon: '◇',
      title: 'Delete checkpoint',
      text: 'This checkpoint will be removed from the selected expedition.<br><small>The Goal, its progress and all other checkpoints will remain unchanged.</small>',
      okText: 'Delete checkpoint',
      cancelText: 'Keep it',
      danger: true
    });
    if (!accepted) return;
    await withBusy(delCheck, async () => {
      await api('/api/goal/checkpoint/' + delCheck.dataset.goalCheckDelete, { method:'DELETE' });
      await load();
      toast('Checkpoint deleted.');
    });
    return;
  }

  const accepted = await modal({
    icon: '✦',
    title: 'Delete field note',
    text: 'This entry will be removed only from the selected expedition log.',
    okText: 'Delete note',
    cancelText: 'Keep it',
    danger: true
  });
  if (!accepted) return;
  await withBusy(delLog, async () => {
    await api('/api/goal/log/' + delLog.dataset.goalLogDelete, { method:'DELETE' });
    await load();
    toast('Field note deleted.');
  });
});

const ACADEMY_DOMAINS = [
  {key:'mind',name:'Mind',icon:'◉',subcategories:['Psychology','Neuroscience'],topics:[
    ['mind-bystander','Bystander effect','Psychology','Why people may fail to help when others are present.',['What is diffusion of responsibility?','Which factors make intervention more likely?','How should a person act in a real emergency?'],['The Lucifer Effect — Philip Zimbardo','The Social Animal — Elliot Aronson']],
    ['mind-lovebombing','Love bombing','Psychology','How excessive early attention can become a control tactic.',['How is affection different from manipulation?','What warning signs matter?','How can boundaries be communicated safely?'],['The Gift of Fear — Gavin de Becker']],
    ['mind-confirmation','Confirmation bias','Psychology','Why the mind favors evidence that supports existing beliefs.',['How does it affect daily decisions?','How can opposing evidence be tested fairly?','What role do social networks play?'],['Thinking, Fast and Slow — Daniel Kahneman']],
    ['mind-dopamine','Dopamine and overstimulation','Neuroscience','Understand reward, motivation and the limits of “dopamine detox” claims.',['What does dopamine actually do?','Which claims are exaggerated?','How can stimulation be managed realistically?'],['Dopamine Nation — Anna Lembke']],
    ['mind-neurodiversity','Neurodiversity','Neuroscience','A framework for understanding neurological differences without reducing people to labels.',['What does neurodiversity mean?','How is it different from diagnosis?','Which accommodations can help?'],[]],
    ['mind-phantom','Phantom limb syndrome','Neuroscience','Why sensations can persist after a limb is lost.',['How does the brain map the body?','What is mirror therapy?','What does this reveal about perception?'],['The Brain That Changes Itself — Norman Doidge']]
  ]},
  {key:'character',name:'Character',icon:'◆',subcategories:['Philosophy','Discipline'],topics:[
    ['char-stoicism','Stoicism in adversity','Philosophy','Use control, judgment and action instead of empty motivational slogans.',['What is the dichotomy of control?','What did Stoics mean by virtue?','How can it be applied without suppressing emotion?'],['Meditations — Marcus Aurelius','Discourses — Epictetus']],
    ['char-amorfati','Amor fati','Philosophy','Examine the idea of accepting reality while still acting to improve it.',['What does acceptance not mean?','How is it different from resignation?','How could it guide a difficult decision?'],['The Daily Stoic — Ryan Holiday']],
    ['char-discipline','Discipline over motivation','Discipline','Build systems that continue when enthusiasm disappears.',['How do environment and friction shape behavior?','What makes a minimum viable habit?','How should failure be reviewed?'],['Atomic Habits — James Clear']],
    ['char-resilience','Resilience without denial','Discipline','Respond firmly to adversity while acknowledging real emotions and limits.',['What is adaptive coping?','When is asking for help a strength?','How can setbacks produce useful feedback?'],['Man’s Search for Meaning — Viktor Frankl']]
  ]},
  {key:'world',name:'World',icon:'◎',subcategories:['International relations','Countries & cultures','History'],topics:[
    ['world-state','State, nation and government','International relations','Distinguish concepts often mixed together in political discussion.',['What defines a sovereign state?','Can a nation exist without a state?','How does a government differ from the state?'],[]],
    ['world-un','How the United Nations works','International relations','Understand its main bodies, powers and limitations.',['What can the Security Council do?','What is the General Assembly for?','Why can the UN fail to stop conflicts?'],[]],
    ['world-culture','Cultural dimensions','Countries & cultures','Explore how communication, hierarchy and time differ across societies.',['What are the limits of cultural generalizations?','How can context prevent stereotypes?','How do norms affect business and travel?'],['The Culture Map — Erin Meyer']],
    ['world-geopolitics','Geopolitics basics','International relations','Study how geography, resources and alliances influence states.',['What makes a chokepoint important?','How do energy and trade routes affect power?','Why should deterministic explanations be avoided?'],['Prisoners of Geography — Tim Marshall']]
  ]},
  {key:'wealth',name:'Wealth',icon:'◇',subcategories:['Personal finance','Economics'],topics:[
    ['wealth-interest','Compound interest','Personal finance','See how time, rate and recurring contributions interact.',['What is the difference between nominal and effective rate?','How do fees change results?','Why does debt compound too?'],['The Psychology of Money — Morgan Housel']],
    ['wealth-inflation','Inflation in daily life','Economics','Understand why prices rise and how purchasing power changes.',['How is inflation measured?','Why do personal experiences differ from the index?','How do interest rates interact with inflation?'],[]],
    ['wealth-credit','How credit really works','Personal finance','Study interest, utilization, minimum payments and total cost.',['What is effective annual rate?','Why can minimum payments be dangerous?','How does utilization affect financial flexibility?'],[]],
    ['wealth-risk','Risk and diversification','Personal finance','Learn why concentration can amplify both gains and losses.',['What risks cannot be diversified away?','Why is time horizon important?','How do liquidity and volatility differ?'],['A Random Walk Down Wall Street — Burton Malkiel']]
  ]},
  {key:'technology',name:'Technology',icon:'⬡',subcategories:['AI & Data','Programming','Cloud & DevOps','Cybersecurity','Hardware & Software'],topics:[
    ['tech-ai','How modern AI works','AI & Data','Understand training data, models, inference and limitations.',['What is the difference between training and inference?','Why can models hallucinate?','What are tokens and context windows?'],['Artificial Intelligence: A Guide for Thinking Humans — Melanie Mitchell']],
    ['tech-ml','Machine learning foundations','AI & Data','Learn features, labels, training, validation and overfitting.',['How does supervised learning differ from unsupervised learning?','What is overfitting?','Why is a test set protected?'],['Hands-On Machine Learning — Aurélien Géron']],
    ['tech-data','Data pipelines','AI & Data','Follow data from collection through transformation, storage and use.',['What is ETL versus ELT?','Why does data quality matter?','What is lineage?'],['Fundamentals of Data Engineering — Joe Reis & Matt Housley']],
    ['tech-code','How programs execute','Programming','Connect source code, runtime, memory and operating systems.',['What does a compiler or interpreter do?','What is a process?','How do stack and heap differ at a high level?'],['Code — Charles Petzold']],
    ['tech-api','APIs and HTTP','Programming','Understand requests, responses, methods, status codes and authentication.',['What makes an API RESTful?','When are GET and POST appropriate?','How are tokens protected?'],[]],
    ['tech-docker','Docker containers','Cloud & DevOps','Understand images, containers, isolation and reproducible environments.',['How is a container different from a virtual machine?','What is an image layer?','Why are volumes needed?'],['Docker Deep Dive — Nigel Poulton']],
    ['tech-azure','Azure cloud foundations','Cloud & DevOps','Study regions, compute, storage, networking and shared responsibility.',['What is IaaS, PaaS and SaaS?','What is a resource group?','What remains the customer’s security responsibility?'],[]],
    ['tech-cyber','Defense in depth','Cybersecurity','Learn why security depends on multiple independent controls.',['What are preventive, detective and corrective controls?','Why is least privilege important?','How do backups support resilience?'],['Security Engineering — Ross Anderson']],
    ['tech-phishing','Phishing and social engineering','Cybersecurity','Recognize manipulation techniques used to bypass technical defenses.',['Which urgency signals are common?','How should links and domains be verified?','What should happen after a suspected click?'],[]],
    ['tech-hardware','CPU, RAM and storage','Hardware & Software','Understand how the main computer components cooperate.',['What does the CPU execute?','Why is RAM temporary?','How do SSDs differ from hard drives?'],['But How Do It Know? — J. Clark Scott']],
    ['tech-os','Operating systems','Hardware & Software','Study how an OS manages processes, memory, files and devices.',['What is a kernel?','How does virtual memory help?','What is a file system?'],['Operating Systems: Three Easy Pieces — Remzi & Andrea Arpaci-Dusseau']]
  ]},
  {key:'science',name:'Science',icon:'✦',subcategories:['Physics','Chemistry','Real-life mathematics'],topics:[
    ['science-electricity','Electricity at home','Physics','Understand voltage, current, power and household energy use.',['How do volts, amps and watts differ?','Why do breakers trip?','How is appliance energy cost estimated?'],['The Feynman Lectures on Physics — selected introductory chapters']],
    ['science-motion','Motion and braking distance','Physics','Connect speed, reaction time, friction and stopping distance.',['Why does stopping distance grow faster than speed?','How do rain and tires change friction?','What part is human reaction time?'],[]],
    ['science-heat','Heat transfer in daily life','Physics','Study conduction, convection and radiation through familiar examples.',['Why does metal feel colder than wood?','How does insulation work?','Why do dark surfaces heat differently?'],[]],
    ['science-acid','Acids, bases and pH','Chemistry','Understand pH in food, cleaning and the human body without unsafe mixing.',['What does the pH scale represent?','Why should household cleaners never be mixed casually?','How do buffers work?'],['Stuff Matters — Mark Miodownik']],
    ['science-battery','Battery chemistry','Chemistry','Explore how chemical reactions store and release electrical energy.',['What are anode, cathode and electrolyte?','Why do batteries degrade?','Why can heat be dangerous?'],[]],
    ['science-percent','Percentages and rates','Real-life mathematics','Use percentages correctly in discounts, interest, risk and change.',['What is the difference between percentage points and percent change?','How are successive discounts combined?','How can base-rate neglect mislead?'],['How Not to Be Wrong — Jordan Ellenberg']],
    ['science-probability','Probability in real decisions','Real-life mathematics','Reason about uncertainty, conditional probability and expected value.',['Why are rare-event tests often misunderstood?','What is expected value?','How does sample size affect confidence?'],['The Art of Statistics — David Spiegelhalter']]
  ]},
  {key:'learning',name:'Learning',icon:'▣',subcategories:['Study techniques','Critical research'],topics:[
    ['learn-recall','Active recall','Study techniques','Strengthen memory by retrieving instead of rereading.',['How should questions be created?','Why is retrieval effort useful?','How can feedback repair gaps?'],['Make It Stick — Brown, Roediger & McDaniel']],
    ['learn-spacing','Spaced repetition','Study techniques','Schedule reviews near the point of forgetting.',['Why is cramming fragile?','How should intervals expand?','What material benefits most?'],['Make It Stick — Brown, Roediger & McDaniel']],
    ['learn-feynman','Feynman technique','Study techniques','Expose gaps by explaining an idea simply and accurately.',['Why is simplification not the same as distortion?','How do you identify hidden jargon?','When should you return to sources?'],[]],
    ['learn-sources','Evaluate sources','Critical research','Check authority, evidence, date, incentives and corroboration.',['What is a primary source?','How can publication date matter?','What evidence would contradict the claim?'],['Calling Bullshit — Carl Bergstrom & Jevin West']]
  ]},
  {key:'culture',name:'Culture',icon:'◈',subcategories:['History','Arts & literature','General knowledge'],topics:[
    ['culture-renaissance','Why the Renaissance mattered','History','Investigate changes in art, knowledge, trade and political power.',['Why is the periodization debated?','How did printing accelerate change?','Which earlier cultures influenced it?'],['The Swerve — Stephen Greenblatt']],
    ['culture-science','Scientific revolutions','History','Study how evidence and institutions changed accepted explanations.',['What made a scientific revolution possible?','How did instruments affect discovery?','Why does science remain revisable?'],['The Structure of Scientific Revolutions — Thomas Kuhn']],
    ['culture-literature','Why read classic literature?','Arts & literature','Explore how fiction develops historical context, empathy and language.',['What makes a work a classic?','How should outdated values be examined?','What changes across translations?'],[]]
  ]}
];
const ACADEMY_TARGET = 7;
function academyBuiltinSkills(){return ACADEMY_DOMAINS.flatMap(d=>d.topics.map(t=>({domain:d,id:t[0],name:t[1],subcategory:t[2],summary:t[3],questions:t[4],books:t[5],source:'built-in',practices:[`Research ${t[1]} and answer the guiding questions.`]})));}
function academyReadState(){
  const raw=(S.profile||{}).hunter_academy_state;let st={activeSkillId:'',sessions:0,doneDates:[],mastered:[],startedOn:hoyLocal(),domain:'mind',history:[],saved:[],intelLang:'en',customTopics:[],importedPacks:[]};
  if(raw){try{st={...st,...JSON.parse(raw)}}catch(_e){}}
  st.history=Array.isArray(st.history)?st.history:[];st.saved=Array.isArray(st.saved)?st.saved:[];st.mastered=Array.isArray(st.mastered)?st.mastered:[];st.doneDates=Array.isArray(st.doneDates)?st.doneDates:[];st.customTopics=Array.isArray(st.customTopics)?st.customTopics:[];st.importedPacks=Array.isArray(st.importedPacks)?st.importedPacks:[];
  const all=academyAllSkills(st);if(!all.some(x=>x.id===st.activeSkillId)){const first=academyRecommendationFromState(st,all);st.activeSkillId=first?.id||'';st.domain=first?.domain?.key||st.domain;}
  return st;
}
function academyDomainFor(key,name){return ACADEMY_DOMAINS.find(d=>d.key===key)||{key:key||'custom',name:name||'Custom',icon:'✦',subcategories:[]};}
function academyNormalizeCustom(raw,index=0){
  const domainKey=String(raw.domainKey||raw.category_key||raw.category||'culture').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const known=ACADEMY_DOMAINS.find(d=>d.key===domainKey||d.name.toLowerCase()===String(raw.category||'').toLowerCase());
  const domain=known||academyDomainFor(domainKey,String(raw.category||'Custom'));
  const title=String(raw.name||raw.title||'').trim();
  return {id:String(raw.id||`custom-${Date.now()}-${index}-${Math.random().toString(36).slice(2,7)}`),name:title,domain,subcategory:String(raw.subcategory||'General').trim()||'General',summary:String(raw.summary||raw.why_it_matters||`Investigate ${title} and connect it with real life.`).trim(),questions:(Array.isArray(raw.questions)?raw.questions:Array.isArray(raw.research_questions)?raw.research_questions:[]).map(String).filter(Boolean).slice(0,8),books:(Array.isArray(raw.books)?raw.books:Array.isArray(raw.resources)?raw.resources.map(r=>typeof r==='string'?r:[r.title,r.author_or_source].filter(Boolean).join(' — ')):[]).map(String).filter(Boolean).slice(0,10),studyPrompt:String(raw.studyPrompt||raw.study_prompt||'').trim(),source:String(raw.source||'custom'),order:Number(raw.order||0),prerequisites:Array.isArray(raw.prerequisites)?raw.prerequisites.map(String):[]};
}
function academyAllSkills(st=null){st=st||academyReadState();return [...academyBuiltinSkills(),...(st.customTopics||[]).map(academyNormalizeCustom)].filter(x=>x.name);}
async function academySaveState(st){S.profile=S.profile||{};S.profile.hunter_academy_state=JSON.stringify(st);await api('/api/profile',{body:{key:'hunter_academy_state',value:S.profile.hunter_academy_state},quiet:true});}
function academyCompletedIds(st){return new Set((st.mastered||[]).concat((st.history||[]).map(x=>x.topicId)).filter(Boolean));}
function academyRecommendationFromState(st,all=academyAllSkills(st)){const done=academyCompletedIds(st),domainPending=all.filter(x=>x.domain.key===st.domain&&!done.has(x.id));return domainPending.sort((a,b)=>(a.order||0)-(b.order||0))[0]||all.filter(x=>!done.has(x.id)).sort((a,b)=>(a.order||0)-(b.order||0))[0]||null;}
function academyRecommendationV2(){const st=academyReadState();return academyRecommendationFromState(st,academyAllSkills(st));}
function academyDayNumber(){const d=new Date(),start=new Date(d.getFullYear(),0,0);return Math.floor((d-start)/86400000);}
const ACADEMY_DAILY_INTEL = [
  {domain:'Mind',icon:'◉',en:'A strong feeling is information, not an automatic command. Pause before turning emotion into action.',es:'Una emoción intensa es información, no una orden automática. Haz una pausa antes de convertirla en acción.'},
  {domain:'Technology',icon:'⬡',en:'An API is a defined agreement that lets software systems exchange requests and responses.',es:'Una API es un acuerdo definido que permite a sistemas de software intercambiar solicitudes y respuestas.'},
  {domain:'Wealth',icon:'◇',en:'Keep money for short-term expenses separate from money intended for long-term investment.',es:'Mantén separado el dinero de gastos a corto plazo del dinero destinado a inversiones de largo plazo.'},
  {domain:'Learning',icon:'▣',en:'Trying to recall an idea strengthens memory more than simply reading the same explanation again.',es:'Intentar recordar una idea fortalece más la memoria que volver a leer la misma explicación.'},
  {domain:'World',icon:'◎',en:'A country, a state, a nation and a government are related concepts, but they are not interchangeable.',es:'Un país, un Estado, una nación y un gobierno son conceptos relacionados, pero no son intercambiables.'},
  {domain:'Science',icon:'✧',en:'Percentage change always depends on the original value; the same number of points can represent very different changes.',es:'El cambio porcentual siempre depende del valor original; la misma cantidad de puntos puede representar cambios muy diferentes.'},
  {domain:'Character',icon:'◆',en:'Stoic control means choosing your judgment and action; it does not mean pretending that pain is absent.',es:'El control estoico significa elegir tu juicio y tu acción; no significa fingir que el dolor no existe.'},
  {domain:'Cybersecurity',icon:'⬡',en:'Never approve a login request that you did not initiate, even when the notification looks legitimate.',es:'Nunca apruebes una solicitud de inicio de sesión que no hayas iniciado, aunque la notificación parezca legítima.'},
  {domain:'Neuroscience',icon:'◉',en:'Dopamine is involved in motivation and learning; it is not a toxin that can be removed through a literal detox.',es:'La dopamina participa en la motivación y el aprendizaje; no es una toxina que pueda eliminarse mediante una desintoxicación literal.'},
  {domain:'Critical thinking',icon:'▣',en:'Before accepting a claim, ask what evidence would prove it wrong and whether that evidence was actually sought.',es:'Antes de aceptar una afirmación, pregunta qué evidencia la refutaría y si realmente se buscó esa evidencia.'},
  {domain:'Programming',icon:'⬡',en:'Readable code reduces future mistakes because software is maintained more often than it is written from scratch.',es:'El código legible reduce errores futuros porque el software se mantiene con más frecuencia de la que se escribe desde cero.'},
  {domain:'Culture',icon:'◈',en:'Learning historical context helps separate present-day assumptions from the values of another time and place.',es:'Aprender contexto histórico ayuda a separar las suposiciones actuales de los valores de otro tiempo y lugar.'}
];
function academyDailyIntel(){return {...ACADEMY_DAILY_INTEL[academyDayNumber()%ACADEMY_DAILY_INTEL.length]};}
function academyResearchPrompt(topic){if(topic.studyPrompt)return topic.studyPrompt;return `Act as my external Hunter instructor for: ${topic.name}.\n\nTeach me clearly and accurately. Cover these questions one at a time:\n${(topic.questions.length?topic.questions:['What is it?','Why does it matter?','How is it applied in real life?']).map((q,i)=>`${i+1}. ${q}`).join('\n')}\n\nUse practical examples, distinguish facts from disputed claims, and recommend reliable current sources. Finish with a concise summary, five concepts to remember and three questions I should be able to answer.`;}
function academyPackPrompt(st,domain){const all=academyAllSkills(st).filter(x=>x.domain.key===domain.key);return `Create a new topic pack for Kevin LifeOS Hunter Skill Academy.\n\nCATEGORY: ${domain.name}\nSUBCATEGORIES: ${domain.subcategories.join(', ')}\nEXISTING TOPICS:\n${all.map(x=>`- ${x.name}`).join('\n')}\n\nGenerate 10 useful new topics that do not repeat the list. Return JSON only with this exact structure:\n{\n  "pack_name":"",\n  "category":"${domain.name}",\n  "category_key":"${domain.key}",\n  "topics":[{\n    "title":"",\n    "subcategory":"",\n    "summary":"",\n    "research_questions":["","",""],\n    "prerequisites":[],\n    "order":1,\n    "study_prompt":"",\n    "resources":[{"type":"book|article|course|documentation","title":"","author_or_source":"","note":""}]\n  }]\n}\nRules: use real resources only; prefer official documentation for technical subjects; order foundational topics before advanced ones; do not repeat existing topics; do not include markdown.`;}
function academyPendingForDomain(st,domainKey){const done=academyCompletedIds(st);return academyAllSkills(st).filter(x=>x.domain.key===domainKey&&!done.has(x.id));}
function renderSkillAcademy(){
  const host=document.getElementById('skillAcademy');if(!host)return;const st=academyReadState(),all=academyAllSkills(st),done=academyCompletedIds(st);let active=all.find(x=>x.id===st.activeSkillId&&!done.has(x.id))||academyRecommendationFromState(st,all);if(active&&(active.id!==st.activeSkillId)){st.activeSkillId=active.id;st.domain=active.domain.key;academySaveState(st).catch(()=>{});}const completed=st.history.length;
  const domainTabs=ACADEMY_DOMAINS.map(d=>`<button class="academy-domain-tab ${d.key===st.domain?'active':''}" data-academy-domain="${d.key}"><span>${d.icon}</span>${esc(d.name)}</button>`).join('');
  const pending=academyPendingForDomain(st,st.domain);const catalogue=pending.slice(0,12).map((x,i)=>`<button class="academy-skill-option ${active&&x.id===active.id?'current':''}" data-academy-skill="${x.id}"><span>${active&&x.id===active.id?'→':'◇'}</span><div><b>${esc(x.name)}</b><small>${esc(x.subcategory)}${i===0?' · Recommended next':''}</small></div></button>`).join('');
  const intel=academyDailyIntel(),intelText=st.intelLang==='es'?intel.es:intel.en;const empty=!active;
  host.innerHTML=`<section class="academy-command-card academy-knowledge-card"><div class="academy-command-top"><div><span>DAILY HUNTER TRAINING</span><h3>${empty?'Route completed':esc(active.name)}</h3><p>${empty?'There are no pending topics. Import a new pack, add a custom topic or open your archive.':esc(active.summary)}</p></div><button class="academy-help" data-academy-help title="How it works">?</button></div><div class="academy-meta"><span>${active?active.domain.icon:'◆'} ${esc(active?.domain?.name||'Knowledge')}</span><span>${esc(active?.subcategory||'Archive ready')}</span><span>${completed} practices archived</span></div><div class="academy-actions">${active?'<button class="btn-ghost" data-academy-explore>Explore</button><button class="btn-ghost academy-book-btn" data-academy-books aria-label="Recommended reading">📚</button><button class="btn academy-complete-btn" data-academy-complete>LOG PRACTICE</button>':''}<button class="btn-ghost" data-academy-add>＋ Add</button><button class="btn-ghost" data-academy-import>Import</button></div></section><section class="academy-intel academy-intel-card"><div><span>◆ DAILY INTEL · ${esc(intel.domain)}</span><strong>${esc(intelText)}</strong></div><div class="academy-intel-actions"><button class="btn-ghost academy-intel-translate" data-academy-intel-lang>🔄 ${st.intelLang==='es'?'English':'Español'}</button><button class="academy-help" data-academy-intel-help>?</button></div><small>A daily concept or field note. It does not award progress or duplicate your training.</small></section><div class="academy-catalogue"><div class="academy-catalogue-head"><div><span>KNOWLEDGE PATHS</span><b>Pending topics</b></div><em>${pending.length} remaining</em></div><div class="academy-domain-tabs">${domainTabs}</div><div class="academy-skill-list">${catalogue||'<div class="academy-empty-route">Route completed · add or import more topics.</div>'}</div></div>`;
}
async function academyAddCustom(){const domains=ACADEMY_DOMAINS.map(d=>({v:d.key,t:d.name}));const r=await modal({icon:'＋',title:'Add custom topic',text:'Add only the topic now. Kevin LifeOS will build a safe general research prompt; details are optional.',fields:[{label:'Topic',placeholder:'Example: Retrieval-Augmented Generation'},{label:'Category',type:'select',options:domains},{label:'Subcategory',placeholder:'Example: AI & Data'},{label:'Why learn it? · Optional',type:'textarea',rows:3,placeholder:'Short context or goal'}],okText:'Add topic'});if(!r)return;const [title,domainKey,subcategory,summary]=r.map(x=>String(x||'').trim());if(!title)return toast('Topic name required');const st=academyReadState(),all=academyAllSkills(st);if(all.some(x=>x.name.toLowerCase()===title.toLowerCase()))return toast('That topic already exists');const domain=ACADEMY_DOMAINS.find(d=>d.key===domainKey)||ACADEMY_DOMAINS[0];const topic=academyNormalizeCustom({title,domainKey:domain.key,category:domain.name,subcategory:subcategory||domain.subcategories[0]||'General',summary:summary||`Investigate ${title} and connect it with real life.`,questions:[`What is ${title}?`,`Why does it matter?`,`How is it applied in real life?`],source:'custom'});st.customTopics.push(topic);st.activeSkillId=topic.id;st.domain=domain.key;await academySaveState(st);renderSkillAcademy();toast('Custom topic added');}
async function academyImportPack(){const st=academyReadState(),domain=ACADEMY_DOMAINS.find(d=>d.key===st.domain)||ACADEMY_DOMAINS[0];const choice=await modal({icon:'⬡',title:'Import topic pack',text:'Copy the generation prompt to GPT, then return and paste the JSON package. Nothing is added before validation.',okText:'Paste JSON',extraBtn:'Copy generation prompt',cancelText:'Cancel'});if(choice==='extra'){const txt=academyPackPrompt(st,domain);try{await navigator.clipboard.writeText(txt);toast('Generation prompt copied')}catch(_){prompt('Copy this prompt:',txt)}return;}if(!choice)return;const r=await modal({icon:'⬡',title:'Paste topic pack',fields:[{type:'textarea',rows:14,placeholder:'Paste valid JSON here'}],okText:'Validate'});if(!r)return;let pack;try{pack=JSON.parse(r[0])}catch(_){return toast('Invalid JSON')};if(!pack||!Array.isArray(pack.topics)||!pack.topics.length)return toast('No topics detected');const existing=new Set(academyAllSkills(st).map(x=>x.name.toLowerCase()));const valid=[],dupes=[];pack.topics.slice(0,30).forEach((raw,i)=>{const t=academyNormalizeCustom({...raw,category_key:pack.category_key||domain.key,category:pack.category||domain.name,source:'ai-import'},i);if(!t.name)return;if(existing.has(t.name.toLowerCase())||valid.some(x=>x.name.toLowerCase()===t.name.toLowerCase()))dupes.push(t.name);else valid.push(t)});const preview=`<b>${esc(pack.pack_name||'Topic pack')}</b><p>${valid.length} valid topic${valid.length===1?'':'s'} · ${dupes.length} duplicate${dupes.length===1?'':'s'} skipped.</p><ul>${valid.slice(0,10).map(x=>`<li>${esc(x.name)} <small>· ${esc(x.subcategory)}</small></li>`).join('')}</ul>${valid.length>10?`<p>+ ${valid.length-10} more</p>`:''}`;const ok=await modal({icon:'✓',title:'Import preview',text:preview,okText:`Import ${valid.length}`,cancelText:'Cancel'});if(!ok||!valid.length)return;st.customTopics.push(...valid);st.importedPacks.push({name:String(pack.pack_name||'Imported pack'),date:hoyLocal(),count:valid.length,domain:domain.key});const next=valid.sort((a,b)=>(a.order||0)-(b.order||0))[0];st.activeSkillId=next.id;st.domain=next.domain.key;await academySaveState(st);renderSkillAcademy();toast(`${valid.length} topics imported`);}
function academyArchiveHTML(){const st=academyReadState(),all=new Map(academyAllSkills(st).map(x=>[x.id,x]));const rows=[...st.history].sort((a,b)=>String(b.date).localeCompare(String(a.date)));if(!rows.length)return '<div class="profile-empty">No concepts archived yet.</div>';const grouped={};rows.forEach(h=>{const topic=all.get(h.topicId);const key=h.domain||topic?.domain?.name||'Knowledge';(grouped[key]||(grouped[key]=[])).push({...h,topic})});return Object.entries(grouped).map(([domain,items])=>`<section class="knowledge-archive-group"><header><b>${esc(domain)}</b><span>${items.length}</span></header>${items.map(x=>`<article><div><strong>✓ ${esc(x.name||x.topic?.name||'Archived concept')}</strong><small>${esc(x.subcategory||x.topic?.subcategory||'')} · ${esc(x.date||'')}</small></div>${x.note?`<p>${esc(x.note)}</p>`:''}</article>`).join('')}</section>`).join('');}
async function openKnowledgeArchive(){await modal({icon:'◈',title:'Hunter Knowledge Archive',text:`<div class="knowledge-archive-modal">${academyArchiveHTML()}</div>`,okText:'Close'});}
document.addEventListener('click',async(e)=>{
  const domainBtn=e.target.closest('[data-academy-domain]');if(domainBtn){const st=academyReadState();st.domain=domainBtn.dataset.academyDomain;const next=academyRecommendationFromState(st,academyAllSkills(st).filter(x=>x.domain.key===st.domain));st.activeSkillId=next?.id||'';await academySaveState(st);renderSkillAcademy();return;}
  const skillBtn=e.target.closest('[data-academy-skill]');if(skillBtn){const st=academyReadState(),next=academyAllSkills(st).find(x=>x.id===skillBtn.dataset.academySkill);if(!next)return;st.activeSkillId=next.id;st.domain=next.domain.key;await academySaveState(st);renderSkillAcademy();return;}
  const stNow=academyReadState(),active=academyAllSkills(stNow).find(x=>x.id===stNow.activeSkillId);
  if(e.target.closest('[data-academy-intel-lang]')){stNow.intelLang=stNow.intelLang==='es'?'en':'es';await academySaveState(stNow);renderSkillAcademy();return;}
  if(e.target.closest('[data-academy-intel-help]')){await modal({icon:'◆',title:'Daily Intel',text:'A short concept or real-life field note shown mainly in English. It never grants progress, streaks or achievements.',okText:'Understood'});return;}
  if(e.target.closest('[data-academy-help]')){await modal({icon:'?',title:'Hunter Skill Academy',text:'Study at your own pace. There is no streak, deadline or penalty. Log a topic only when you consider that you understand it; then it leaves the pending catalogue and enters your permanent Knowledge Archive.',okText:'Understood'});return;}
  if(e.target.closest('[data-academy-add]')){await academyAddCustom();return;}
  if(e.target.closest('[data-academy-import]')){await academyImportPack();return;}
  if(e.target.closest('[data-open-knowledge-archive]')){await openKnowledgeArchive();return;}
  if(e.target.closest('[data-academy-explore]')&&active){const text=`<b>${esc(active.name)}</b><br><small>${esc(active.domain.name)} · ${esc(active.subcategory)}</small><p>${esc(active.summary)}</p><b>Investigate</b><ol>${(active.questions.length?active.questions:['What is it?','Why does it matter?','How is it applied?']).map(q=>`<li>${esc(q)}</li>`).join('')}</ol>`;const r=await modal({icon:active.domain.icon,title:'Research mission',text,okText:'Copy AI prompt',cancelText:'Close'});if(r){const p=academyResearchPrompt(active);try{await navigator.clipboard.writeText(p);toast('Research prompt copied')}catch(_){prompt('Copy this prompt:',p)}}return;}
  if(e.target.closest('[data-academy-books]')&&active){const books=active.books.length?active.books.map(b=>`<li>${esc(b)}${active.source==='ai-import'?' <small>· AI-suggested, verify before use</small>':''}</li>`).join(''):'<li>No verified reading saved. Prefer official documentation, universities or recognized institutions.</li>';await modal({icon:'📚',title:'Recommended reading',text:`<b>${esc(active.name)}</b><ul>${books}</ul><p class="hint">Resources are optional and never award progress.</p>`,okText:'Close'});return;}
  if(e.target.closest('[data-academy-complete]')&&active){const st=academyReadState();const r=await modal({icon:'◆',title:'Archive learned concept',text:`Register <b>${esc(active.name)}</b> only when you feel you understand it. There is no deadline or streak.`,fields:[{type:'text',placeholder:'Optional: what did you understand?'}],okText:'Archive concept',cancelText:'Keep studying'});if(r===null)return;const today=hoyLocal();st.sessions=(Number(st.sessions)||0)+1;st.history.push({topicId:active.id,name:active.name,domain:active.domain.name,domainKey:active.domain.key,subcategory:active.subcategory,date:today,note:String(r[0]||'').trim().slice(0,300),source:active.source||'built-in'});if(!st.mastered.includes(active.id))st.mastered.push(active.id);if(!st.doneDates.includes(today))st.doneDates.push(today);const next=academyRecommendationFromState(st,academyAllSkills(st));st.activeSkillId=next?.id||'';if(next)st.domain=next.domain.key;await academySaveState(st);renderSkillAcademy();toast('Concept moved to Knowledge Archive');return;}
});


/* ====== V135 · PIRATE POSITION / LEGACY ROUTE ====== */
const PIRATE_POSITIONS = [
  { key:'apprentice', name:'Apprentice', subtitle:'The voyage begins', symbol:'rope' },
  { key:'subordinate', name:'Subordinate', subtitle:'Recognized crew member', symbol:'crew' },
  { key:'first-officer', name:'First Officer', subtitle:'Authority earned through discipline', symbol:'blade' },
  { key:'captain', name:'Captain', subtitle:'Command your own system', symbol:'helm' },
  { key:'supernova', name:'Supernova', subtitle:'A force impossible to ignore', symbol:'star' },
  { key:'yonko', name:'Yonko', subtitle:'An emperor of conquered territories', symbol:'crown' },
  { key:'pirate-king', name:'Pirate King', subtitle:'The final position', symbol:'throne' }
];
function pirateBadgeSVG(key, compact=false) {
  const pos=PIRATE_POSITIONS.find(x=>x.key===key)||PIRATE_POSITIONS[0];
  const glyphs={rope:'M31 18c-8 4-10 14-4 20s17 4 19-5-5-17-15-15zm3 18c9 9 20 11 30 4',crew:'M20 42h48M27 31l8-13 13 13 13-13 8 13',blade:'M24 63L65 22l7 7-41 41zm8-2 8 8',helm:'M18 45h60M48 16v58M25 28l46 34M71 28L25 62',star:'M48 12l9 24 25 1-20 15 7 25-21-14-21 14 7-25-20-15 25-1z',crown:'M17 62l6-35 19 17 8-28 10 28 18-17 1 35z',throne:'M22 69V38l12-18 14 18 14-18 12 18v31M22 49h52'};
  const accent={apprentice:'#91a6b6',subordinate:'#44d68a','first-officer':'#d7e8ff',captain:'#f4c96b',supernova:'#ff6b72',yonko:'#b77cff','pirate-king':'#ffd76a'}[pos.key];
  return `<svg class="pirate-badge-svg ${compact?'compact':''}" viewBox="0 0 96 96" role="img" aria-label="${esc(pos.name)} insignia" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="pg-${pos.key}" cx="50%" cy="45%"><stop offset="0" stop-color="${accent}" stop-opacity=".34"/><stop offset="1" stop-color="#05070d" stop-opacity="0"/></radialGradient></defs><circle cx="48" cy="48" r="43" fill="url(#pg-${pos.key})" stroke="${accent}" stroke-width="2"/><circle cx="48" cy="48" r="35" fill="#091018" stroke="${accent}" stroke-opacity=".45"/><path d="${glyphs[pos.symbol]}" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 76h44" stroke="${accent}" stroke-width="2" opacity=".55"/></svg>`;
}
function pirateReadState() {
  try {
    const raw=JSON.parse((S.profile||{}).pirate_position_v1||'{}');
    const history=Array.isArray(raw.history)?raw.history:[];
    const claimed=PIRATE_POSITIONS.some(x=>x.key===raw.claimed)?raw.claimed:'apprentice';
    return {claimed,history:history.length?history:[{key:'apprentice',date:raw.started_at||hoyLocal()}],started_at:raw.started_at||hoyLocal()};
  } catch (_) { return {claimed:'apprentice',history:[{key:'apprentice',date:hoyLocal()}],started_at:hoyLocal()}; }
}
async function pirateSaveState(state) {
  const value=JSON.stringify(state);
  await api('/api/profile',{body:{key:'pirate_position_v1',value},quiet:true});
  S.profile=S.profile||{}; S.profile.pirate_position_v1=value;
}
function pirateMetrics() {
  const conqueredMonths=(S.history||[]).filter(x=>Number(x.pct||0)>=.7).length;
  const maxStreak=maxHistoricalDisciplineStreak();
  const achievements=(S.achievement_unlocks||[]).length;
  const goals=(S.goals||[]).filter(g=>g.status==='Lograda 🏆'||Number(g.pct||0)>=100).length;
  const courses=(S.courses_done||[]).length;
  const gymDays=new Set((S.gym_sets||[]).map(x=>x.date).filter(Boolean)).size;
  const books=(S.books||[]).filter(b=>b.status==='Terminado').length;
  const englishDays=typeof diasInglesHechos==='function'?diasInglesHechos():0;
  const debts=(S.debts||[]).filter(d=>(Number(d.initial||0)+compradoEn(d.name)-Number(d.abonado||0))<=0).length;
  let academyDomains=0; try { const st=academyReadState(), map=new Map(academyAllSkills().map(x=>[x.id,x.domain.key])); academyDomains=new Set((st.mastered||[]).map(id=>map.get(id)).filter(Boolean)).size; } catch(_) {}
  const domains=[conqueredMonths>=1,gymDays>=7,courses>=1||books>=3,englishDays>=21,goals>=1,debts>=1,academyDomains>=2].filter(Boolean).length;
  return {conqueredMonths,maxStreak,achievements,goals,courses,gymDays,books,englishDays,debts,academyDomains,domains,haki:hakiLevelFor(conqueredMonths).key};
}
function pirateRequirements(metrics=pirateMetrics()) {
  const r=(label,current,target,done=current>=target)=>({label,current,target,done});
  return {
    apprentice:[],
    subordinate:[r('Conquered Haki months',metrics.conqueredMonths,1),r('Permanent archive records',metrics.achievements,1)],
    'first-officer':[r('Conquered Haki months',metrics.conqueredMonths,3),r('Historical discipline streak',metrics.maxStreak,30),r('Developed life domains',metrics.domains,3)],
    captain:[r('Conquered Haki months',metrics.conqueredMonths,6),r('Historical discipline streak',metrics.maxStreak,60),r('Completed expeditions',metrics.goals,2),r('Developed life domains',metrics.domains,4)],
    supernova:[r('Conquered Haki months',metrics.conqueredMonths,12),r('Historical discipline streak',metrics.maxStreak,120),r('Permanent archive records',metrics.achievements,12),r('Developed life domains',metrics.domains,5)],
    yonko:[r('Conquered Haki months',metrics.conqueredMonths,24),r('Historical discipline streak',metrics.maxStreak,180),r('Completed expeditions',metrics.goals,5),r('Developed life domains',metrics.domains,6),r("Conqueror's Haki",metrics.haki==='conqueror'?1:0,1)],
    'pirate-king':[r('Conquered Haki months',metrics.conqueredMonths,36),r('Historical discipline streak',metrics.maxStreak,365),r('Permanent archive records',metrics.achievements,25),r('Completed expeditions',metrics.goals,8),r('Developed life domains',metrics.domains,7)]
  };
}
function piratePositionState() {
  const saved=pirateReadState(), metrics=pirateMetrics(), requirements=pirateRequirements(metrics);
  const claimedIndex=Math.max(0,PIRATE_POSITIONS.findIndex(x=>x.key===saved.claimed));
  let eligibleIndex=0;
  PIRATE_POSITIONS.forEach((p,i)=>{if((requirements[p.key]||[]).every(x=>x.done)) eligibleIndex=i;});
  const next=PIRATE_POSITIONS[claimedIndex+1]||null;
  const nextReq=next?requirements[next.key]:[];
  const pct=nextReq.length?Math.round(nextReq.reduce((sum,x)=>sum+Math.min(1,Number(x.current||0)/Math.max(1,Number(x.target||1))),0)/nextReq.length*100):100;
  return {saved,metrics,requirements,claimedIndex,eligibleIndex,current:PIRATE_POSITIONS[claimedIndex],next,nextReq,progress:Math.max(0,Math.min(100,pct)),promotionAvailable:eligibleIndex>claimedIndex};
}
function pirateArchiveRecords() {
  const st=pirateReadState();
  let legacy={}; try{legacy=JSON.parse((S.profile||{}).pirate_legacy_v1||'{}')}catch(_){}
  const rows=(st.history||[]).map(x=>({label:`Promoted to ${(PIRATE_POSITIONS.find(p=>p.key===x.key)||PIRATE_POSITIONS[0]).name}`,date:x.date||''}));
  if(legacy.year365) rows.push({label:'One Year Unbroken',date:legacy.year365});
  if(legacy.day730) rows.push({label:'Legacy Awakened · 730 days',date:legacy.day730});
  return rows;
}
function applyPirateBrandBadge() {
  const brand=document.getElementById('openHunterProfile'); if(!brand)return;
  const st=piratePositionState();
  // Reuse the former subtitle slot so the position is shown once, beside the brand.
  brand.querySelectorAll('.brand-pirate-position').forEach((node,index)=>{if(index>0)node.remove();});
  let badge=brand.querySelector('.brand-pirate-position')||brand.querySelector('small');
  if(!badge){badge=document.createElement('small');brand.appendChild(badge);}
  badge.className='brand-pirate-position';
  badge.setAttribute('aria-label',`Current pirate position: ${st.current.name}`);
  badge.innerHTML=`${pirateBadgeSVG(st.current.key,true)}<b>${esc(st.current.name)}</b>`;
}
function pirateRouteModal() {
  const st=piratePositionState();
  const rows=PIRATE_POSITIONS.map((p,i)=>{const req=st.requirements[p.key]||[], unlocked=i<=st.claimedIndex, current=i===st.claimedIndex;return `<article class="pirate-route-rank ${unlocked?'unlocked':'locked'} ${current?'current':''}">${pirateBadgeSVG(p.key,true)}<div><span>${current?'CURRENT POSITION':unlocked?'ARCHIVED':'LOCKED'}</span><h3>${esc(p.name)}</h3><p>${esc(p.subtitle)}</p>${req.length?`<ul>${req.map(x=>`<li class="${x.done?'done':''}">${x.done?'✓':'◇'} ${esc(x.label)} <b>${Math.min(x.current,x.target)}/${x.target}</b></li>`).join('')}</ul>`:'<small>Starting position.</small>'}</div></article>`}).join('');
  modal({icon:'☠',title:'Pirate Position Route',text:`<div class="pirate-route-modal">${rows}</div><p class="hint">Positions never decrease. Authorized rest days never break discipline records. The app recognizes evidence; you claim each promotion.</p>`,okText:'Close'});
}
function pirateCelebrationOverlay({kind='promotion',position=null,title='',message='',onClaim=null}) {
  document.querySelector('.pirate-awakening')?.remove();
  const key=position?.key||kind;
  const art=position?pirateBadgeSVG(position.key):pirateBadgeSVG(kind==='legacy730'?'pirate-king':'supernova');
  const host=document.createElement('div'); host.className=`pirate-awakening ${kind}`;
  host.innerHTML=`<div class="pirate-awakening-sea"></div><div class="pirate-awakening-haki"></div><div class="pirate-awakening-particles"></div><section class="pirate-awakening-card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="pirate-awakening-kicker">${kind==='promotion'?'POSITION AWAKENED':'LEGACY MILESTONE'}</span><div class="pirate-awakening-emblem">${art}</div><h1>${esc(title)}</h1><p>${esc(message)}</p><button class="btn-gold" data-claim-pirate>${kind==='promotion'?'Claim position':'Archive milestone'}</button></section>`;
  document.body.appendChild(host); requestAnimationFrame(()=>host.classList.add('show')); petSayText(title,'celebrate',7000);
  host.querySelector('[data-claim-pirate]').addEventListener('click',async()=>{const btn=host.querySelector('[data-claim-pirate]');btn.disabled=true;try{if(onClaim)await onClaim();host.classList.remove('show');setTimeout(()=>host.remove(),500);toast(kind==='promotion'?`☠ ${position.name} archived`:'◆ Legacy milestone archived');applyPirateBrandBadge();renderHunterProfile();}catch(e){btn.disabled=false;toast('Could not archive milestone','err');}});
}
async function checkPirateCelebrations() {
  if(document.querySelector('.pirate-awakening'))return true;
  if(!(S.profile||{}).pirate_position_v1){await pirateSaveState(pirateReadState());applyPirateBrandBadge();}
  const maxStreak=maxHistoricalDisciplineStreak();
  let legacy={};try{legacy=JSON.parse((S.profile||{}).pirate_legacy_v1||'{}')}catch(_){}
  if(maxStreak>=730&&!legacy.day730){pirateCelebrationOverlay({kind:'legacy730',title:'LEGACY AWAKENED',message:'Two years ago, this journey began. Today, we stand one hundred times stronger.',onClaim:async()=>{legacy.day730=hoyLocal();const value=JSON.stringify(legacy);await api('/api/profile',{body:{key:'pirate_legacy_v1',value},quiet:true});S.profile.pirate_legacy_v1=value;}});return true;}
  if(maxStreak>=365&&!legacy.year365){pirateCelebrationOverlay({kind:'year365',title:'ONE YEAR UNBROKEN',message:'365 valid days of discipline. You are no longer the person who began this journey.',onClaim:async()=>{legacy.year365=hoyLocal();const value=JSON.stringify(legacy);await api('/api/profile',{body:{key:'pirate_legacy_v1',value},quiet:true});S.profile.pirate_legacy_v1=value;}});return true;}
  const st=piratePositionState();
  if(st.promotionAvailable){const next=PIRATE_POSITIONS[st.claimedIndex+1];pirateCelebrationOverlay({kind:'promotion',position:next,title:next.name.toUpperCase(),message:next.subtitle+'. Your actions have changed how the crew recognizes you.',onClaim:async()=>{const saved=pirateReadState();saved.claimed=next.key;saved.history=[...(saved.history||[]),{key:next.key,date:hoyLocal()}].filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i);await pirateSaveState(saved);}});return true;}
  return false;
}

function hunterProfileSkillStats() {
  const skillMap=new Map((S.skills||[]).map(x=>[String(x.id),x]));
  const bySkill=new Map();
  (S.course_skills||[]).forEach(link=>{const skill=skillMap.get(String(link.skill_id));if(!skill)return;const key=String(skill.id);if(!bySkill.has(key))bySkill.set(key,{...skill,courses:new Set()});bySkill.get(key).courses.add(String(link.course_id));});
  let academy={mastered:[],sessions:0,activeSkillId:''};try{academy=academyReadState();}catch(_){}
  const academySkills=academyAllSkills();
  return [...bySkill.values()].map(item=>{const evidence=item.courses.size;const academyMatch=academySkills.find(x=>x.name.toLowerCase()===String(item.name).toLowerCase());const practiced=academyMatch&&academy.mastered.includes(academyMatch.id);const level=practiced&&evidence>=2?'Reliable':evidence>=5?'Reliable':evidence>=3?'Practiced':evidence>=2?'Developing':'Introduced';return {...item,evidence,practiced,level};}).sort((a,b)=>b.evidence-a.evidence||a.name.localeCompare(b.name));
}
function renderHunterProfile() {
  const host=document.getElementById('hunterProfileContent'); if(!host)return;
  const rank=hunterGlobalRankState(), license=hunterLicenseState(), skills=hunterProfileSkillStats();
  const activeCareer=(S.careers||[]).find(x=>x.active)||(S.careers||[])[0];
  const activeGoal=activeCareer?(S.goals||[]).find(g=>String(g.id)===String(activeCareer.goal_id)):null;
  const unlocked=(S.achievement_unlocks||[]).length;
  const finished=(S.courses_done||[]).length;
  const pending=(S.courses_done||[]).filter(c=>!courseSkillNames(c.id).length);
  const books=(S.books||[]).filter(b=>b.status==='Terminado').length;
  const defeated=(S.debts||[]).filter(d=>(Number(d.initial||0)+compradoEn(d.name)-Number(d.abonado||0))<=0).length;
  const featured=(S.achievement_unlocks||[]).slice(0,4);
  const pirate=piratePositionState(), pirateRecords=pirateArchiveRecords();
  host.innerHTML=`<div class="hunter-profile-hero"><div><span>HUNTER ASSOCIATION · PRIVATE FILE</span><h1>KEVIN · HUNTER PROFILE</h1><p>A private record of the person your daily systems are building.</p></div><div class="hunter-profile-rank rank-${rank.current.rank}"><small>GLOBAL RANK</small><b>${rank.current.rank}</b><span>${esc(rank.current.title)}</span></div></div>
  <div class="hunter-profile-grid">
    <section class="hunter-profile-license"><div id="hunterProfileLicense"></div></section>
    <section class="hunter-profile-mission"><span>CURRENT EXPEDITION</span><h2>${esc(activeGoal?.name||activeCareer?.name||'Choose an active career')}</h2><p>${esc(activeGoal?.next_step||(S.career_courses||[]).find(x=>String(x.career_id)===String(activeCareer?.id))?.title||'Set the next field action in Goals or Life.')}</p><div class="mini-bar green"><i style="width:${activeGoal?.pct||progresoCareer(activeCareer||{})||0}%"></i></div><small>${activeGoal?.pct||progresoCareer(activeCareer||{})||0}% expedition progress</small></section>
  </div>
  <section class="hunter-profile-stats"><div><b>${rank.xp}</b><span>Expedition XP</span></div><div><b>${finished}</b><span>Finished courses</span></div><div><b>${skills.length}</b><span>Professional skills</span></div><div><b>${unlocked}</b><span>Archive records</span></div><div><b>${defeated}</b><span>Debts defeated</span></div><div><b>${books}</b><span>Books finished</span></div></section>
  <section class="hunter-profile-section"><div class="row-between"><div><span class="profile-kicker">PROFESSIONAL SKILLS</span><h2>Training evidence</h2></div><small>Backed by finished courses${skills.some(x=>x.practiced)?' and Skill Academy practice':''}.</small></div>${skills.length?`<div class="profile-skill-grid">${skills.map(x=>`<article class="profile-skill-card"><div><b>${esc(x.name)}</b><span>${esc(x.level)}</span></div><p>${x.evidence} completed course${x.evidence===1?'':'s'}${x.practiced?' · Skill Academy mastered':''}</p></article>`).join('')}</div>`:'<div class="profile-empty">Finish a course and record its skills to build your professional profile.</div>'}</section>
  ${pending.length?`<section class="hunter-profile-section pending-review"><div><span class="profile-kicker">SKILLS PENDING REVIEW</span><h2>${pending.length} finished course${pending.length===1?' has':'s have'} no registered skills</h2></div><div class="profile-review-list">${pending.map(c=>`<button data-course-skills="${c.id}"><span>✓ ${esc(c.title)}</span><small>${esc(c.career||'Career')}</small><b>Review skills →</b></button>`).join('')}</div></section>`:''}
  <section class="hunter-profile-section pirate-position-panel"><div class="pirate-position-summary"><div class="pirate-position-art">${pirateBadgeSVG(pirate.current.key)}</div><div><span class="profile-kicker">PIRATE POSITION</span><h2>${esc(pirate.current.name)}</h2><p>${esc(pirate.current.subtitle)} · ${esc(hakiLevelFor(pirate.metrics.conqueredMonths).name)}</p></div></div><div class="pirate-position-next"><div><span>${pirate.next?'NEXT POSITION':'FINAL POSITION'}</span><b>${pirate.next?esc(pirate.next.name):'The throne is yours'}</b></div><div class="mini-bar green"><i style="width:${pirate.progress}%"></i></div><button class="btn-ghost" data-open-pirate-route>View route</button></div></section>
  <section class="hunter-profile-section"><div><span class="profile-kicker">FEATURED ARCHIVE</span><h2>Permanent records</h2></div><div class="profile-featured-achievements">${[...pirateRecords.slice(-3).map(x=>`<span>☠ ${esc(x.label)}${x.date?` · ${esc(x.date)}`:''}</span>`),...featured.map(x=>`<span>◆ ${esc(String(x.akey||'').replace(/-/g,' '))}</span>`)].join('')||'<span>No permanent records unlocked yet.</span>'}</div></section>
  <section class="hunter-profile-section knowledge-archive-summary"><div class="row-between"><div><span class="profile-kicker">HUNTER KNOWLEDGE ARCHIVE</span><h2>Learned concepts</h2></div><button class="btn-ghost" data-open-knowledge-archive>Open archive</button></div><p>${academyReadState().history.length} practice record${academyReadState().history.length===1?'':'s'} preserved permanently. Completed topics stay out of the pending catalogue.</p></section>
  <section class="hunter-profile-haki haki-panel">
    <div id="hakiShowcase" class="haki-showcase" aria-live="polite"></div>
    <div class="hunter-profile-haki-history"><h3>Haki history · conquered months (≥70%)</h3><div id="hakiHistory" class="haki-history"></div><canvas id="hakiChart" height="150"></canvas></div>
  </section>`;
  renderHunterLicense('hunterProfileLicense');
  renderHaki();
}
function openHunterProfile(){const screen=document.getElementById('hunterProfileScreen');if(!screen)return;renderHunterProfile();screen.classList.add('open');screen.setAttribute('aria-hidden','false');document.body.classList.add('hunter-profile-open');window.scrollTo({top:0,behavior:'smooth'});}
function closeHunterProfile(){const screen=document.getElementById('hunterProfileScreen');if(!screen)return;screen.classList.remove('open');screen.setAttribute('aria-hidden','true');document.body.classList.remove('hunter-profile-open');}
document.addEventListener('click',e=>{if(e.target.closest('#openHunterProfile'))openHunterProfile();if(e.target.closest('#closeHunterProfile'))closeHunterProfile();if(e.target.closest('[data-open-pirate-route]'))pirateRouteModal();});

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
function renderHunterLicense(targetId='hunterLicensePanel') {
  const host = document.getElementById(targetId);
  if (!host) return;
  const st = hunterLicenseState();
  const unlockedOn = (S.profile || {}).hunter_license_unlocked_on || '';
  if (st.unlocked && !unlockedOn && !renderHunterLicense._saving) {
    renderHunterLicense._saving = true;
    const day = hoyLocal();
    api('/api/profile', { body:{ key:'hunter_license_unlocked_on', value:day }, quiet:true })
      .then(() => { S.profile = S.profile || {}; S.profile.hunter_license_unlocked_on = day; renderHunterLicense(targetId); })
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

/* ====== V117 · HUNTER ARCHIVE / ACHIEVEMENTS ====== */
const achievementUnlockPending = new Set();
const HUNTER_ARCHIVE_RARITIES = {
  Common:    { rank:1, label:'COMMON' },
  Uncommon:  { rank:2, label:'UNCOMMON' },
  Rare:      { rank:3, label:'RARE' },
  Epic:      { rank:4, label:'EPIC' },
  Legendary: { rank:5, label:'LEGENDARY' },
  Mythic:    { rank:6, label:'MYTHIC' }
};

function achievementProgress(current, target) {
  const safeTarget = Math.max(1, Number(target || 1));
  const safeCurrent = Math.max(0, Number(current || 0));
  return Math.max(0, Math.min(100, Math.round(safeCurrent / safeTarget * 100)));
}

function renderAchievements() {
  const grid = document.getElementById('achievementsGrid');
  if (!grid) return;

  const debts = S.debts || [];
  const dmg = debts.reduce((sum, debt) => sum + Number(debt.abonado || 0), 0);
  const defeated = debts.filter(debt => (Number(debt.initial || 0) + compradoEn(debt.name) - Number(debt.abonado || 0)) <= 0).length;
  const conqueredMonths = (S.history || []).filter(month => Number(month.pct || 0) >= 0.7).length;
  const completedGoals = (S.goals || []).filter(goal => goal.status === 'Lograda 🏆' || Number(goal.pct || 0) >= 100).length;
  const payments = (S.abonos || []).length;
  const completedCourses = (S.courses_done || []).length;
  const maxStreak = Math.max(0, ...(S.habits || []).map(habit => rachaHabito(habit.id, new Set(S.marks || []), habit.name === 'Exercise' ? [6] : [])));
  const completedBooks = (S.books || []).filter(book => book.status === 'Terminado').length;
  const completedAnime = (S.animes || []).filter(anime => /Terminado|Completado|Completed/i.test(String(anime.estado || ''))).length;
  const savedForDreams = (S.dreams || []).reduce((sum, dream) => sum + Number(dream.saved || 0), 0);
  const gymSessions = new Set((S.gym_sets || []).map(set => set.date).filter(Boolean)).size;
  const completedCheckpoints = (S.goal_checkpoints || []).filter(checkpoint => Number(checkpoint.done || 0) === 1).length;
  let masteredSkills = 0;
  try {
    const academyState=academyReadState();
    const topicDomain=new Map(academyAllSkills().map(topic=>[topic.id,topic.domain.key]));
    masteredSkills=new Set((academyState.mastered||[]).map(id=>topicDomain.get(id)).filter(Boolean)).size;
  } catch (_) {}
  const professionalSkills = hunterProfileSkillStats();
  const reliableProfessionalSkills = professionalSkills.filter(skill => skill.level === 'Reliable').length;
  const combinedMasterySkills = professionalSkills.filter(skill => skill.practiced).length;

  const savedUnlocks = new Map((S.achievement_unlocks || []).map(item => [String(item.akey), item.unlocked_at || '']));

  const achievements = [
    { id:'first-payment', category:'FINANCE', rarity:'Common', icon:'⚔', name:'First Blood', desc:'Record your first debt payment.', current:payments, target:1 },
    { id:'debt-slayer', category:'FINANCE', rarity:'Rare', icon:'☠', name:'Slayer', desc:'Defeat your first debt.', current:defeated, target:1 },
    { id:'debt-hunter', category:'FINANCE', rarity:'Epic', icon:'💀', name:'Hunter', desc:'Defeat three debts.', current:defeated, target:3 },
    { id:'warlord', category:'FINANCE', rarity:'Legendary', icon:'⚔', name:'Warlord', desc:'Pay 10M in total debt damage.', current:dmg, target:10000000, format:'money' },
    { id:'liberator', category:'FINANCE', rarity:'Mythic', icon:'👑', name:'Liberator', desc:'Defeat every registered debt.', current:defeated, target:Math.max(1, debts.length), secret:debts.length===0 },

    { id:'month-conqueror', category:'DISCIPLINE', rarity:'Uncommon', icon:'🛡', name:'Disciplined', desc:'Conquer your first month at 70% or more.', current:conqueredMonths, target:1 },
    { id:'iron-streak', category:'DISCIPLINE', rarity:'Rare', icon:'🔥', name:'On Fire', desc:'Maintain a seven-day habit streak.', current:maxStreak, target:7 },
    { id:'unstoppable', category:'DISCIPLINE', rarity:'Legendary', icon:'⚡', name:'Unstoppable', desc:'Reach a thirty-day habit streak.', current:maxStreak, target:30 },
    { id:'year-veteran', category:'DISCIPLINE', rarity:'Mythic', icon:'◉', name:'Year Veteran', desc:'Conquer twelve months.', current:conqueredMonths, target:12, secret:true },
    { id:'haki-master-legacy', category:'ONE PIECE LEGACY', rarity:'Epic', icon:'👁', name:'Haki Master', desc:'Legacy medal: conquer six Haki months. Haki still remains an independent One Piece system connected to Habits.', current:conqueredMonths, target:6 },

    { id:'first-goal', category:'EXPEDITIONS', rarity:'Uncommon', icon:'🎯', name:'Achiever', desc:'Complete your first Goal expedition.', current:completedGoals, target:1 },
    { id:'triple-conquest', category:'EXPEDITIONS', rarity:'Epic', icon:'◆', name:'Territory Hunter', desc:'Conquer three Goals.', current:completedGoals, target:3 },
    { id:'field-operator', category:'EXPEDITIONS', rarity:'Rare', icon:'◇', name:'Field Operator', desc:'Complete five expedition checkpoints.', current:completedCheckpoints, target:5 },

    { id:'student', category:'KNOWLEDGE', rarity:'Common', icon:'🎓', name:'Student', desc:'Finish your first course.', current:completedCourses, target:1 },
    { id:'specialist', category:'KNOWLEDGE', rarity:'Epic', icon:'✦', name:'Specialist', desc:'Finish five courses.', current:completedCourses, target:5 },
    { id:'reader', category:'KNOWLEDGE', rarity:'Common', icon:'📚', name:'Reader', desc:'Finish your first book.', current:completedBooks, target:1 },
    { id:'archivist', category:'KNOWLEDGE', rarity:'Rare', icon:'📖', name:'Bookworm', desc:'Finish five books.', current:completedBooks, target:5 },
    { id:'skill-master', category:'KNOWLEDGE', rarity:'Legendary', icon:'◈', name:'Skill Master', desc:'Master three Hunter Skill Academy paths.', current:masteredSkills, target:3 },
    { id:'first-professional-skill', category:'PROFESSIONAL', rarity:'Common', icon:'✦', name:'First Skill Acquired', desc:'Record your first skill from a finished course.', current:professionalSkills.length, target:1 },
    { id:'skill-collector', category:'PROFESSIONAL', rarity:'Rare', icon:'◆', name:'Skill Collector', desc:'Build evidence for ten distinct professional skills.', current:professionalSkills.length, target:10 },
    { id:'reliable-specialist', category:'PROFESSIONAL', rarity:'Epic', icon:'⬡', name:'Reliable Specialist', desc:'Reach Reliable level in one course-backed skill.', current:reliableProfessionalSkills, target:1 },
    { id:'proof-of-mastery', category:'PROFESSIONAL', rarity:'Legendary', icon:'◉', name:'Proof of Mastery', desc:'Back the same skill with completed training and Skill Academy practice.', current:combinedMasterySkills, target:1, secret:true },

    { id:'training-arc', category:'BODY', rarity:'Uncommon', icon:'🏋', name:'Training Arc', desc:'Log gym training on seven different days.', current:gymSessions, target:7 },
    { id:'dream-saver', category:'DREAMS', rarity:'Uncommon', icon:'🐷', name:'Saver', desc:'Save 500K toward your dreams.', current:savedForDreams, target:500000, format:'money' },
    { id:'big-saver', category:'DREAMS', rarity:'Epic', icon:'💎', name:'Big Saver', desc:'Save 2M toward your dreams.', current:savedForDreams, target:2000000, format:'money' }
  ].map(item => {
    const liveGot = Number(item.current || 0) >= Number(item.target || 1);
    const unlockedAt = savedUnlocks.get(item.id) || '';
    const got = liveGot || Boolean(unlockedAt);
    if (liveGot && !unlockedAt && !achievementUnlockPending.has(item.id)) {
      achievementUnlockPending.add(item.id);
      api('/api/achievement/unlock', { body:{ key:item.id } }).then(() => {
        S.achievement_unlocks = S.achievement_unlocks || [];
        S.achievement_unlocks.push({ akey:item.id, unlocked_at:new Date().toISOString() });
      }).catch(() => {}).finally(() => achievementUnlockPending.delete(item.id));
    }
    return { ...item, liveGot, got, unlockedAt };
  });

  const unlocked = achievements.filter(item => item.got).length;
  const rarityScore = achievements.filter(item => item.got).reduce((sum, item) => sum + (HUNTER_ARCHIVE_RARITIES[item.rarity] || HUNTER_ARCHIVE_RARITIES.Common).rank, 0);
  const next = achievements.filter(item => !item.got).sort((a,b) => achievementProgress(b.current,b.target)-achievementProgress(a.current,a.target))[0];
  const categories = [...new Set(achievements.map(item => item.category))];

  const cards = achievements.map(item => {
    const pct = achievementProgress(item.current, item.target);
    const hidden = item.secret && !item.got;
    const unlockedLabel = item.unlockedAt ? goalFieldDate(item.unlockedAt) : item.got ? 'Unlocked now' : '';
    const value = item.format === 'money'
      ? `${fmt(Math.min(item.current,item.target))} / ${fmt(item.target)}`
      : `${Math.min(item.current,item.target)} / ${item.target}`;
    return `<article class="hunter-achievement rarity-${item.rarity.toLowerCase()} ${item.got?'unlocked':'locked'} ${hidden?'secret':''}" data-achievement-id="${item.id}">
      <div class="hunter-achievement-aura" aria-hidden="true"></div>
      <header><span>${item.category}</span><b>${(HUNTER_ARCHIVE_RARITIES[item.rarity] || HUNTER_ARCHIVE_RARITIES.Common).label}</b></header>
      <div class="hunter-achievement-medal"><i>${item.got ? item.icon : hidden ? '?' : '◇'}</i><em>${item.got ? 'UNLOCKED' : hidden ? 'SECRET' : `${pct}%`}</em></div>
      <div class="hunter-achievement-copy"><h3>${hidden ? 'Hidden Achievement' : esc(item.name)}</h3><p>${hidden ? 'Meet a special condition to reveal this record.' : esc(item.desc)}</p></div>
      <div class="hunter-achievement-progress"><div><span>${item.got ? 'ARCHIVED' : 'PROGRESS'}</span><strong>${item.got ? 'COMPLETED' : value}</strong></div><div class="hunter-achievement-meter"><i style="width:${pct}%"></i></div></div>
      ${item.got ? `<div class="hunter-achievement-stamp">HUNTER ARCHIVE · ${esc(unlockedLabel)}</div>` : ''}
    </article>`;
  }).join('');

  grid.innerHTML = `<section class="hunter-archive">
    <div class="hunter-archive-hero">
      <div><span>HUNTER ASSOCIATION · PERMANENT RECORD</span><h2>Hunter Archive</h2><p>Achievements are generated from real activity across Finance, Goals, Life, Books, Gym and Skill Academy. Haki remains a separate One Piece system connected only to Habits.</p></div>
      <div class="hunter-archive-seal"><small>ARCHIVE SCORE</small><strong>${rarityScore}</strong><span>${unlocked}/${achievements.length} unlocked</span></div>
    </div>
    <div class="hunter-archive-summary">
      <div><small>UNLOCKED</small><strong>${unlocked}</strong><span>permanent records</span></div>
      <div><small>LOCKED</small><strong>${achievements.length-unlocked}</strong><span>trials remaining</span></div>
      <div><small>CATEGORIES</small><strong>${categories.length}</strong><span>connected systems</span></div>
      <div><small>NEXT RECORD</small><strong>${next ? achievementProgress(next.current,next.target)+'%' : '100%'}</strong><span>${next ? esc(next.name) : 'Archive complete'}</span></div>
    </div>
    <div class="hunter-achievement-grid">${cards}</div>
  </section>`;
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

  const historyHost = $('#hakiHistory');
  if (historyHost) {
    historyHost.innerHTML = (S.history || []).map(h =>
      `<span class="haki-month ${h.pct >= 0.7 ? 'win' : 'lose'}">
       ${esc(h.label)}: ${pct(h.pct)} ${h.pct >= 0.7 ? '✔' : '✘'}</span>`
    ).join('') || '<span class="hint">Close your first month to start earning Haki. The King demands 6 months ≥70%.</span>';
  }
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
  const goals = S.goals || [];
  const won = goals.filter(g => g.status === 'Lograda 🏆').length;
  const fuego = goals.filter(g => g.status === 'En proceso 🔥').length;
  const pending = goals.filter(g => g.status === 'Pendiente').length;
  const avg = goals.length ? Math.round(goals.reduce((sum, g) => sum + Math.max(0, Math.min(100, Number(g.pct || 0))), 0) / goals.length) : 0;
  $('#goalStats').innerHTML = `
    <div class="card gold goal-stat-card"><span class="goal-stat-icon">◆</span><div><label>Territories conquered</label><strong>${won} / ${goals.length}</strong><small>Completed expeditions</small></div></div>
    <div class="card goal-stat-card"><span class="goal-stat-icon">◈</span><div><label>Routes in progress</label><strong>${fuego}</strong><small>Active field missions</small></div></div>
    <div class="card goal-stat-card"><span class="goal-stat-icon">◇</span><div><label>Dormant routes</label><strong>${pending}</strong><small>Waiting for deployment</small></div></div>
    <div class="card goal-stat-card"><span class="goal-stat-icon">◎</span><div><label>Average completion</label><strong>${avg}%</strong><small>Across every route</small></div></div>`;
  const estados = ['Pendiente', 'En proceso 🔥', 'Lograda 🏆'];
  const estLbl = { 'Pendiente': 'Pending', 'En proceso 🔥': 'In progress 🔥', 'Lograda 🏆': 'Achieved 🏆' };
  $('#goalTable').innerHTML =
    '<tr><th>Goal</th><th>Why do you want it?</th><th>Date</th><th>Status</th><th>%</th><th>Progress</th><th>Next step</th><th></th></tr>' +
    goals.map(g => {
      const p = Math.min(Math.max(g.pct || 0, 0), 100);
      const bar = `<span class="goal-table-meter"><i style="width:${p}%"></i></span><small>${p}%</small>`;
      return `<tr class="${g.status === 'Lograda 🏆' ? 'goal-won' : ''}">
        <td data-label="Goal"><input class="g-edit wide" data-id="${g.id}" data-f="name" value="${esc(g.name)}"></td>
        <td data-label="Why"><input class="g-edit wide" data-id="${g.id}" data-f="why" value="${esc(g.why)}" placeholder="your reason in one line"></td>
        <td data-label="Target"><input class="g-edit" data-id="${g.id}" data-f="target" value="${esc(g.target)}" style="width:84px"></td>
        <td data-label="Status"><select class="g-edit" data-id="${g.id}" data-f="status">${estados.map(s => `<option value="${s}" ${s === g.status ? 'selected' : ''}>${estLbl[s]}</option>`).join('')}</select></td>
        <td data-label="Progress %"><input class="g-edit" type="number" min="0" max="100" data-id="${g.id}" data-f="pct" value="${p}" style="width:64px"></td>
        <td data-label="Route progress" class="bar-cell">${bar}</td>
        <td data-label="Critical mission"><input class="g-edit wide" data-id="${g.id}" data-f="next_step" value="${esc(g.next_step)}" placeholder="next small action"></td>
        <td data-label="Remove"><button class="del-x" data-type="goal" data-id="${g.id}" aria-label="Delete ${esc(g.name)}">✕</button></td></tr>`;
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
  const englishCareer = (S.careers || []).find(c => /ingl|english/i.test(c.name || ''));
  const immersionDays = diasInglesHechos();
  const trainingProgress = englishCareer ? progresoCareer(englishCareer) : Math.min(100, Math.round((immersionDays / 120) * 100));
  const lastLevel = pf.eng_real_level || '';
  const verifiedLevel = lastLevel || 'Not tested';
  const lastPct = pf.eng_real_pct || '';
  const lastDate = pf.eng_real_date || '';
  let languageSessions = [];
  try { languageSessions = JSON.parse(pf.language_sessions_v1 || '[]'); } catch (_) {}
  const skillNames = ['Speaking','Listening','Reading','Writing','Conversation','Immersion'];
  const skillStats = Object.fromEntries(skillNames.map(k => [k,{sessions:0,minutes:0}]));
  languageSessions.forEach(x => { const key=skillNames.find(k=>String(x.skill||'').toLowerCase().includes(k.toLowerCase())); if(key){skillStats[key].sessions++;skillStats[key].minutes+=Number(x.minutes)||0;} });
  const totalMinutes = languageSessions.reduce((n,x)=>n+(Number(x.minutes)||0),0);
  const leastSkill = skillNames.slice(0,4).sort((a,b)=>skillStats[a].minutes-skillStats[b].minutes)[0];

  let daysInStage = 0;
  if (startedQ) {
    const d0 = new Date(startedQ + 'T12:00:00');
    const now = new Date();
    daysInStage = Math.max(0, Math.floor((now - d0) / 86400000));
  }
  const milestone = Math.min(120, (qIdx + 1) * 30);
  const testDate = lastDate ? new Date(lastDate + 'T12:00:00') : null;
  const stageDate = startedQ ? new Date(startedQ + 'T12:00:00') : null;
  const testedThisStage = !!(testDate && stageDate && testDate >= stageDate);
  const levelCheckReady = immersionDays >= milestone && !testedThisStage;

  panel.innerHTML = `
    <div class="eng-command-card">
      <div class="eng-command-head">
        <div><span class="eng-command-kicker">LANGUAGE HUNTER MISSION</span><h3>${t.q}</h3></div>
        <span class="eng-command-progress">${trainingProgress}% training</span>
      </div>
      <div class="eng-status-grid">
        <div><span>Immersion</span><b>${immersionDays} days</b></div>
        <div><span>Verified level</span><b>${esc(verifiedLevel)}</b></div>
        <div><span>Current target</span><b>${esc(t.level)}</b></div>
        <div><span>Stage time</span><b>${startedQ ? `${daysInStage} days` : 'Not started'}</b></div>
      </div>
      <div class="mini-bar green eng-training-bar"><i style="width:${trainingProgress}%"></i></div>
      <div class="eng-compact-meta"><span>📘 ${esc(t.book)}</span><span>🎬 ${esc(t.subs)}</span><span>⏱ ${totalMinutes} min logged</span></div>
      <details class="eng-insights"><summary>Progress <small>${languageSessions.length} sessions · next focus: ${esc(leastSkill)}</small></summary><div class="eng-skill-mini">${skillNames.slice(0,4).map(k=>`<button type="button" title="${skillStats[k].sessions} sessions">${k}<b>${skillStats[k].minutes}m</b></button>`).join('')}</div><p class="hint">Detailed history stays in Sessions, Errors and Phrases. Your verified CEFR level changes only after an assessment.</p></details>
    </div>
    <div class="word-hunter-summary">
      <div><span>WORD HUNTER</span><b>${wordHunterCounts().due} due today</b><small>${wordHunterCounts().learning} learning · ${wordHunterCounts().mastered} mastered</small></div>
      <div class="word-hunter-summary-actions"><button id="wordHunterReview">Review</button><button id="wordHunterAdd" title="Add word">＋</button><button id="wordHunterLibrary" title="Open library">Library</button><button id="wordHunterHelp" class="word-hunter-help" title="How Word Hunter works">?</button></div>
    </div>
    <div class="eng-blocks eng-blocks-compact">
      <div class="eng-block">🗣 <b>Speak</b><span>Mon & Fri</span></div>
      <div class="eng-block">🎧 <b>Listen</b><span>Tue & Sat</span></div>
      <div class="eng-block">📖 <b>Read</b><span>Wed</span></div>
      <div class="eng-block">✍️ <b>Write</b><span>Thu</span></div>
    </div>
    <details class="eng-test eng-test-compact">
      <summary><span>📊 Level assessment</span>${lastLevel ? `<small>Last: ${esc(lastLevel)}${lastPct ? ` · ${esc(lastPct)}%` : ''}</small>` : '<small>Verify your real CEFR level</small>'}</summary>
      <p class="hint">Free tests mainly measure reading and listening. Speaking and writing remain part of your daily training.</p>
      <div class="eng-test-links">
        ${ENGLISH_TESTS.map(tst => `<a href="${tst.url}" target="_blank" rel="noopener" class="eng-test-link"><b>${tst.name}</b><small>${tst.note}</small></a>`).join('')}
      </div>
      ${lastLevel ? `<div class="eng-last">Last result: <b>${esc(lastLevel)}</b>${lastPct ? ` (${esc(lastPct)}%)` : ''}${lastDate ? ` · ${fmtFecha(lastDate)}` : ''}</div>` : ''}
      <button class="btn-gold" id="engLevelBtn">I took a test → enter my result</button>
    </details>
    <div class="eng-actions">
      <button class="btn-ghost" id="engTalkBtn">💬 Practice with AI tutor</button>
      ${qIdx < ENGLISH_TRIMESTERS.length - 1
        ? `<button class="btn-ghost" id="engNextBtn">Advance stage manually</button>`
        : '<span class="eng-final">🏆 Final stage — reaching for C1!</span>'}
    </div>`;
}

document.addEventListener('click', async (e) => {

  if (e.target.id === 'wordHunterReview') { openWordHunterReview(); return; }
  if (e.target.id === 'wordHunterAdd') { await addWordHunterManual(); return; }
  if (e.target.id === 'wordHunterLibrary') { openWordHunterLibrary(); return; }
  if (e.target.id === 'wordHunterHelp') { await openWordHunterHelp(); return; }
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
      sendPrompt("Act as my English tutor. Use only English unless I explicitly ask for Spanish. Start with today's Life training focus, ask one question at a time, correct my mistakes after I answer, explain the correction briefly, make me repeat the improved sentence, and finish with my 3 most important recurring mistakes plus a short homework task.");
    else
      toast('💬 Open a chat and tell me: "practice English with me"');
    return;
  }
  const lifeHelp = e.target.closest('[data-life-help]');
  if (lifeHelp) {
    const info = {
      overview: ['📅', 'Life', 'Your daily routine, career training, practical skills, English and weekly shifts live here. The order follows what you use most often.'],
      routine: ['✓', 'Today', 'Choose a date, complete the activities you actually do and add or schedule anything extra. Life keeps its existing links with Habits.'],
      careers: ['🗺', 'Career paths', 'Each career moves through Fundamentals, Intermediate, Projects and Professional. Courses keep their own progress and platform. You decide when a regular career stage is conquered; completing a course does not advance it automatically. English is different: immersion days drive training progress and CEFR tests verify your real level.'],
      skills: ['⚔', 'Hunter Skill Academy', 'Practice one real-world skill at a time. Course skills still remain connected to finished courses and Hunter Profile.'],
      workweek: ['🗓', 'Work week', 'Set your normal shift for each weekday. When a Monday–Friday day is marked Rest, the nearest visible date is also saved as an exceptional rest day, so it does not break Habit streaks or lower the monthly completion denominator.']
    }[lifeHelp.dataset.lifeHelp];
    if (info) await modal({ icon:info[0], title:info[1], text:info[2], okText:'Got it' });
    return;
  }
  if (e.target.id === 'freeTimeHelpBtn') {
    const text = ($('#freeTimeHint')?.innerHTML || '').trim();
    await modal({ icon:'⏳', title:'Free-time suggestion', text:text || 'No suggestion is available for this day.', okText:'Got it' });
    return;
  }
  if (e.target.id === 'lifeTipBtn') {
    const text = ($('#lifeTip')?.textContent || '').trim();
    await modal({ icon:'🧭', title:'Weekly advice', text:esc(text || 'No weekly advice is available yet.'), okText:'Got it' });
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
  const step = Math.max(0, Math.min(4, Number(c.step || 0)));
  // English is a special immersion career: its saved percentage is the partial progress
  // inside the current 30-day block. Restore that gradual slice instead of treating it
  // like a manually conquered multi-course career.
  if (/ingl|english/i.test(c.name || '')) {
    if (step >= 4) return 100;
    const partial = Math.max(0, Math.min(100, Number(c.pct || 0)));
    return Math.min(100, Math.round(step * 25 + partial * 0.25));
  }
  // V120 regular careers: only explicitly conquered stages move the career/linked Goal.
  // Course percentages remain independent evidence and never multiply the 25% stage reward.
  return Math.min(Math.max(Number(c.bank || 0), step * 25), 100);
}

const COURSE_SKILL_CATALOG = [
  { keys:['sql','query','database'], skills:['SQL','Data Querying','Data Filtering','Joins','Data Aggregation','Relational Databases','Data Validation'], category:'Data' },
  { keys:['excel','spreadsheet','sheets'], skills:['Microsoft Excel','Spreadsheets','Pivot Tables','Data Cleaning','Data Analysis','Data Validation'], category:'Data' },
  { keys:['power bi','dashboard','visualization','tableau'], skills:['Data Visualization','Dashboard Design','Business Intelligence','Data Storytelling','Data Modeling','Microsoft Power BI'], category:'Data' },
  { keys:['ask questions','data-driven','requirements','stakeholder'], skills:['Analytical Thinking','Problem Framing','Data-Driven Decision Making','Stakeholder Communication','Requirements Gathering','Business Analysis'], category:'Business' },
  { keys:['python','pandas','numpy'], skills:['Python','Pandas','Data Cleaning','Exploratory Data Analysis','Data Automation'], category:'Technology' },
  { keys:['statistics','probability','regression'], skills:['Statistics','Probability','Hypothesis Testing','Regression Analysis','Quantitative Analysis'], category:'Data' },
  { keys:['web','javascript','html','css','frontend'], skills:['Web Development','JavaScript','HTML','CSS','Responsive Design','Debugging'], category:'Technology' },
  { keys:['communication','presentation','storytelling'], skills:['Communication','Structured Communication','Presentation Skills','Data Storytelling'], category:'Communication' },
  { keys:['project','portfolio','capstone'], skills:['Project Planning','Problem Solving','Documentation','Portfolio Development'], category:'Professional' },
  { keys:['leadership','management'], skills:['Leadership','Team Coordination','Decision Making','Conflict Resolution'], category:'Professional' }
];
function courseSkillsFor(course, careerName='', step=0) {
  const text = `${course || ''} ${careerName || ''} ${PELDANOS[Number(step)||0] || ''}`.toLowerCase();
  const out = new Map();
  COURSE_SKILL_CATALOG.forEach(group => {
    if (group.keys.some(k => text.includes(k))) group.skills.forEach(name => out.set(name.toLowerCase(), {name, category:group.category, source:'suggested'}));
  });
  if (!out.size) ['Analytical Thinking','Problem Solving','Self-Directed Learning','Knowledge Application'].forEach(name => out.set(name.toLowerCase(), {name, category:'General', source:'suggested'}));
  return [...out.values()].slice(0, 12);
}
function courseSkillNames(courseId) {
  const links=(S.course_skills||[]).filter(x=>String(x.course_id)===String(courseId));
  const map=new Map((S.skills||[]).map(x=>[String(x.id),x]));
  return links.map(x=>map.get(String(x.skill_id))).filter(Boolean);
}
function courseSkillsModal({title, career, step=0, selected=[]}) {
  return new Promise(resolve => {
    const suggestions=courseSkillsFor(title,career,step);
    const chosen=new Map(selected.map(x=>[String(x.name||x).toLowerCase(), {name:x.name||x, category:x.category||'General', source:x.source||'manual'}]));
    const all=new Map(); [...suggestions,...selected].forEach(x=>all.set(String(x.name||x).toLowerCase(),x));
    const back=document.createElement('div'); back.className='modal-back';
    const draw=()=>{
      const chips=[...all.values()].map(x=>{const key=String(x.name||x).toLowerCase();const on=chosen.has(key);return `<button type="button" class="skill-choice ${on?'selected':''}" data-skill-key="${esc(key)}"><span>${on?'✓':'+'}</span>${esc(x.name||x)}</button>`}).join('');
      back.innerHTML=`<div class="modal-card course-skill-modal"><div class="modal-icon">✦</div><h3>Course skills</h3><p><b>${esc(title)}</b><br><small>${esc(career)} · ${esc(PELDANOS[Number(step)||0]||'Training')}</small></p><div class="skill-choice-grid">${chips}</div><label class="mfield-lab">Add a custom skill</label><div class="skill-custom-row"><input id="customSkillInput" placeholder="e.g. Data Governance"><button type="button" id="addCustomSkill">＋ Add</button></div><div class="modal-btns"><button class="m-cancel">Cancel</button><button class="m-skip">Finish without skills</button><button class="m-ok">Save skills & finish course</button></div></div>`;
      back.querySelectorAll('[data-skill-key]').forEach(btn=>btn.onclick=()=>{const key=btn.dataset.skillKey; if(chosen.has(key)) chosen.delete(key); else {const item=all.get(key); chosen.set(key,{name:item.name||item,category:item.category||'General',source:item.source||'suggested'});} draw();});
      const add=()=>{const inp=back.querySelector('#customSkillInput');const name=(inp.value||'').trim();if(!name)return;const key=name.toLowerCase();const item={name,category:'General',source:'manual'};all.set(key,item);chosen.set(key,item);draw();};
      back.querySelector('#addCustomSkill').onclick=add; back.querySelector('#customSkillInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add();}};
      back.querySelector('.m-cancel').onclick=()=>close(null); back.querySelector('.m-skip').onclick=()=>close([]); back.querySelector('.m-ok').onclick=()=>close([...chosen.values()]);
    };
    const close=val=>{back.classList.remove('show');setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');},220);resolve(val);};
    document.body.appendChild(back);document.body.classList.add('modal-open');draw();requestAnimationFrame(()=>back.classList.add('show'));back.onclick=e=>{if(e.target===back)close(null);};
  });
}

function renderCareer() {
  const wrap = document.getElementById('careerPanel');
  if (!wrap) return;
  const careers = S.careers || [];
  const activeCourses = S.career_courses || [];
  const done = S.courses_done || [];
  const skillLinks = S.course_skills || [];
  const skillMap = new Map((S.skills || []).map(x => [String(x.id), x]));

  const platformLabel = value => esc(value || 'Other');
  const finishedByStage = (items, c) => PELDANOS.map((stageName, step) => {
    const stageItems = items.filter(x => Number(x.step || 0) === step);
    if (!stageItems.length) return '';
    return `<section class="career-finished-stage"><header><span>STAGE ${step + 1}</span><b>${stageName}</b></header><div class="courses-done">${stageItems.map(d => {
      const names = skillLinks.filter(x => String(x.course_id) === String(d.id)).map(x => skillMap.get(String(x.skill_id))?.name).filter(Boolean);
      return `<span class="course-chip ${names.length ? 'has-skills' : 'skills-pending'}"><span>✓ ${esc(d.title)}</span><em>${platformLabel(d.platform)}</em><small>${names.length ? `${names.length} skill${names.length === 1 ? '' : 's'} recorded` : 'Skills pending review'}</small><button class="course-skill-review" data-course-skills="${d.id}" title="Review course skills">✦</button><button class="del-x" data-type="course" data-id="${d.id}">✕</button></span>`;
    }).join('')}</div></section>`;
  }).join('');

  const card = (c) => {
    const prog = progresoCareer(c);
    const step = Math.max(0, Math.min(3, Number(c.step || 0)));
    const completedPath = prog >= 100;
    const esIngles = /ingl|english/i.test(c.name || '');
    const diasIng = esIngles ? diasInglesHechos() : 0;
    const dots = PELDANOS.map((p, i) => `<span class="peldano ${i < step || completedPath ? 'done' : i === step ? 'now' : ''}">${i < step || completedPath ? '✓' : i + 1}. ${p}</span>`).join('');
    const careerActiveCourses = activeCourses.filter(x => String(x.career_id) === String(c.id));
    const myDone = done.filter(d => String(d.career_id || '') === String(c.id) || d.career === c.name);
    const renderActiveCourse = course => `
      <article class="career-course-card" data-course-card="${course.id}">
        <div class="career-course-top"><span class="course-platform">${platformLabel(course.platform)}</span><button class="del-x active-course-delete" data-active-course-delete="${course.id}" title="Remove active course">✕</button></div>
        <input class="career-course-title" data-active-course="${course.id}" data-course-field="title" value="${esc(course.title)}" aria-label="Course name">
        <div class="career-course-progress"><div><span>Course progress</span><strong>${Number(course.pct || 0)}%</strong></div><div class="mini-bar green"><i style="width:${Number(course.pct || 0)}%"></i></div><input data-active-course="${course.id}" data-course-field="pct" type="range" min="0" max="100" value="${Number(course.pct || 0)}"></div>
        <div class="career-course-actions"><button class="course-platform-edit" data-course-platform="${course.id}">✎ ${platformLabel(course.platform)}</button>${Number(course.pct || 0) >= 100 ? `<button class="course-complete" data-course-complete="${course.id}">✓ Finish course</button>` : ''}</div>
      </article>`;
    const activeHtml = careerActiveCourses.length ? PELDANOS.map((stageName, stageIndex) => {
      const items = careerActiveCourses.filter(x => Number(x.step || 0) === stageIndex);
      if (!items.length) return '';
      return `<section class="career-active-stage ${stageIndex === step ? 'current' : ''}"><header><span>STAGE ${stageIndex + 1}</span><b>${stageName}</b>${stageIndex === step ? '<em>CURRENT</em>' : ''}</header><div class="career-course-grid">${items.map(renderActiveCourse).join('')}</div></section>`;
    }).join('') : '<div class="career-course-empty">No active courses in this career yet.</div>';
    const finishedHtml = myDone.length ? finishedByStage(myDone, c) : '<p class="hint" style="margin:4px 0">No finished courses yet.</p>';
    const nextLabel = completedPath ? 'Career path conquered' : step >= 3 ? 'Declare Professional stage conquered' : `Conquer ${PELDANOS[step]} and move to ${PELDANOS[step + 1]}`;

    return `<article class="career-card career-operations ${c.active ? 'career-active' : ''}">
      <header class="career-head"><div><span class="career-kicker">HUNTER TRAINING ROUTE</span><b>${c.icon || '🎯'} ${esc(c.name)}</b></div><span class="career-prog">${prog}% to goal</span></header>
      <div class="peldano-row">${dots}</div>
      <div class="mini-bar green career-overall-bar"><i style="width:${prog}%"></i></div>
      ${esIngles ? `<section class="career-stage-head english-career-stage"><div><span>IMMERSION PATH</span><h3>${PELDANOS[step] || 'Professional'}</h3><p>Progress comes from completed English training days; CEFR level is verified through assessments.</p></div><a class="btn-ghost english-panel-link" href="#englishPanel">Open English mastery</a></section><div class="eng-auto">🔥 <b>${diasIng} days</b> of English practice logged · <b>${prog}%</b> training progress.</div>` : `<section class="career-stage-head"><div><span>STEP ${step + 1}</span><h3>${PELDANOS[step]}</h3><p>${STEP_DESC[step] || ''}</p></div><button class="advance-career-stage ${completedPath ? 'done' : ''}" data-advance-stage="${c.id}" ${completedPath ? 'disabled' : ''}>${completedPath ? '✓ Path conquered' : nextLabel}</button></section><section class="career-active-courses"><div class="career-section-title"><div><span>ACTIVE COURSES</span><b>${PELDANOS[step]} training</b></div><button class="add-active-course" data-add-active-course="${c.id}">＋ Add course</button></div>${activeHtml}</section>`}
      <footer class="career-foot">${c.active ? '<span class="active-badge">★ Active focus</span>' : `<button class="set-active" data-career="${c.id}">Set as focus</button>`}<button class="del-x" data-type="career" data-id="${c.id}" title="Delete career">✕</button></footer>
      ${esIngles ? '' : `<section class="career-courses"><b class="mini-title">Finished courses</b>${finishedHtml}</section>`}
    </article>`;
  };
  wrap.innerHTML = careers.map(card).join('') + `<button class="btn-gold add-career-btn" id="addCareerBtn">+ Add a career to learn</button>`;
}
function actividadesDelDia(wd, shiftKey) {
  const sh = SHIFTS[shiftKey] || SHIFTS.libre;
  const active = (S.careers || []).find(c => c.active) || (S.careers || [])[0];
  const focoLabel = active ? `${active.icon || ''} ${active.name}` : 'Study';
  const _ingPlan = INGLES_PLAN[wd] || INGLES_PLAN[0];
  const ing = _ingPlan.title;                                   // ej: "🗣 Speaking day"
  const ingDesc = _ingPlan.steps.map((st, i) => `${i + 1}) ${st.s}`).join('  ');  // pasos cortos numerados
  const studyDesc = active
    ? `Choose one active ${active.name} course, advance it and take notes.`
    : 'Advance one active course + take notes.';

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
  return active ? `Choose one active ${active.name} course, advance it and take notes.`
    : 'Advance one active course + take notes.';
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
  const weeklyShiftKey = (S.shifts || {})[wd] || 'libre';
  const shiftKey = isLifeRestDate(iso) ? 'descanso' : weeklyShiftKey;
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
    const wd = +e.target.dataset.wd;
    await api('/api/shift', { body: { weekday: wd, shift: e.target.value } });
    if (e.target.value === 'descanso' && wd <= 4) {
      const restIso = nextVisibleDateForWeekday(wd);
      await saveLifeRestDate(restIso);
      toast(`🌿 Rest saved for ${restIso}. It will not break Habit streaks.`);
    } else {
      toast('📅 Shift updated.');
    }
    load();
  } else if (e.target.matches('[data-career]')) {
    await api('/api/career', { body: { id: +e.target.dataset.career, field: e.target.dataset.f, value: e.target.value } });
    load();
  } else if (e.target.matches('[data-active-course]')) {
    const field = e.target.dataset.courseField;
    await api('/api/career/course', { body: { id:+e.target.dataset.activeCourse, field, value:e.target.value } });
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

  const addActive = e.target.closest('[data-add-active-course]');
  if (addActive) {
    const career = (S.careers || []).find(x => String(x.id) === String(addActive.dataset.addActiveCourse));
    if (!career) return;
    const r = await modal({ icon:'🎓', title:`Add ${PELDANOS[career.step || 0]} course`, text:`Every course has equal value as training evidence. The career stage changes only when you explicitly conquer it.`, fields:[{type:'text',label:'Course name',placeholder:'e.g. Azure Data Fundamentals'},{type:'select',label:'Platform',options:['Coursera','Udemy','Microsoft Learn','LinkedIn Learning','edX','YouTube','Platzi','Other'].map(v=>({v,t:v}))},{type:'select',label:'Training stage',options:PELDANOS.map((name,i)=>({v:String(i),t:`Step ${i+1}: ${name}`})),value:String(career.step||0)},{type:'number',label:'Initial progress %',value:0,min:0,max:100}], okText:'Add course'});
    if (!r || !String(r[0]||'').trim()) return;
    await api('/api/career/course/new',{body:{career_id:career.id,step:+r[2]||0,title:String(r[0]).trim(),platform:r[1]||'Other',pct:+r[3]||0}});
    toast('🎓 Course added to this stage'); load(); return;
  }

  const editPlatform = e.target.closest('[data-course-platform]');
  if (editPlatform) {
    const course=(S.career_courses||[]).find(x=>String(x.id)===String(editPlatform.dataset.coursePlatform)); if(!course)return;
    const r=await modal({icon:'🏷',title:'Course platform',fields:[{type:'text',label:'Platform',value:course.platform||'Other',placeholder:'Coursera, Udemy, Azure...'}],okText:'Save platform'});
    if(!r||!String(r[0]||'').trim())return;
    await api('/api/career/course',{body:{id:course.id,field:'platform',value:String(r[0]).trim()}}); load(); return;
  }

  const finishActive=e.target.closest('[data-course-complete]');
  if(finishActive){
    const course=(S.career_courses||[]).find(x=>String(x.id)===String(finishActive.dataset.courseComplete)); if(!course)return;
    const career=(S.careers||[]).find(x=>String(x.id)===String(course.career_id));
    const skills=await courseSkillsModal({title:course.title,career:career?.name||'',step:course.step||0}); if(skills===null)return;
    await api('/api/career/course/complete',{body:{course_id:course.id,skills}}); toast('✓ Course finished and skills recorded'); load(); return;
  }

  const deleteActive=e.target.closest('[data-active-course-delete]');
  if(deleteActive){
    const course=(S.career_courses||[]).find(x=>String(x.id)===String(deleteActive.dataset.activeCourseDelete)); if(!course)return;
    const ok=await confirmAction({icon:'✕',title:'Remove active course',text:`<b>${esc(course.title)}</b> will leave this training stage. Finished-course history and career progress are not changed.`,okText:'Remove course',cancelText:'Keep course',danger:true});
    if(!ok)return; await api(`/api/career/course/${course.id}`,{method:'DELETE'}); toast('Course removed'); load(); return;
  }

  const advance=e.target.closest('[data-advance-stage]');
  if(advance){
    const career=(S.careers||[]).find(x=>String(x.id)===String(advance.dataset.advanceStage)); if(!career)return;
    const step=Math.max(0,Math.min(3,Number(career.step||0))); const final=step>=3;
    const ok=await confirmAction({icon:'🗺',title:final?'Declare professional mastery?':`Conquer ${PELDANOS[step]}?`,text:final?`This records <b>${esc(career.name)}</b> as a fully conquered professional path (100%). Active courses may remain for continued learning.`:`You decide this stage is conquered. The linked Goal moves to <b>${(step+1)*25}%</b>. Every course stays equal; no individual course grants the stage by itself.`,okText:final?'Conquer career path':`Move to ${PELDANOS[step+1]}`,cancelText:'Not yet'});
    if(!ok)return; const result=await api('/api/career/advance-stage',{body:{career_id:career.id}}); toast(result.completed?'🏆 Professional path conquered':`🚀 ${PELDANOS[step+1]} unlocked`); load(); return;
  }

  const skillReview = e.target.closest('[data-course-skills]');
  if (skillReview) {
    const course = (S.courses_done || []).find(x => String(x.id) === String(skillReview.dataset.courseSkills));
    if (!course) return;
    const career = (S.careers || []).find(x => String(x.id) === String(course.career_id)) || (S.careers || []).find(x => x.name === course.career);
    const selected = courseSkillNames(course.id);
    const skills = await courseSkillsModal({ title:course.title, career:course.career, step:course.step || career?.step || 0, selected });
    if (skills === null) return;
    await api('/api/course/skills', { body:{ course_id:course.id, skills } });
    toast('✦ Course skills updated');
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
    // V121 · English opens one persistent Language Hunter mission modal.
    // Partial steps never affect Habits/Goals. Only completing every step allows the official check below.
    if (act === 'ingles') {
      const completed = await openLanguageMissionModal(day, CUR_WD);
      if (!completed) { toast('English mission progress saved.'); return; }
    }
    // V120: choose exactly which active course advanced. Course progress does not alter
    // the career/Goal stage percentage; only explicit stage conquest does that.
    if (act === 'estudio') {
      const active = (S.careers || []).find(x => x.active) || (S.careers || [])[0];
      const courses = active ? (S.career_courses || []).filter(x => String(x.career_id) === String(active.id)) : [];
      if (active && courses.length) {
        const options = courses.map(x => ({v:String(x.id),t:`${x.title} · ${x.platform || 'Other'} · ${x.pct || 0}%`}));
        const pick = await modal({icon:active.icon||'📊',title:`Study: ${active.name}`,text:'Which course did you advance today?',fields:[{type:'select',label:'Active course',options}],okText:'Continue'});
        if (pick === null) return;
        const course = courses.find(x => String(x.id) === String(pick[0]));
        if (!course) return;
        const r = await modal({icon:'📈',title:course.title,text:`Current progress: <b>${course.pct || 0}%</b><br>What percentage is this course at now?`,fields:[{type:'number',label:'Course progress %',value:course.pct||0,min:0,max:100}],okText:'Save & check ✓'});
        if (r === null) return;
        const nv=Math.max(0,Math.min(100,parseInt(String(r[0]).replace(/[^0-9]/g,''),10)||0));
        await api('/api/career/course',{body:{id:course.id,field:'pct',value:nv}});
        toast(`📈 ${course.title} updated to ${nv}%. Career stage progress stays unchanged.`);
      } else if (active) {
        toast('Add an active course to this career before logging study progress.');
        return;
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
    if (act === 'ingles') await saveLanguageSessionReport(CUR_WD);
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
  const dreams = S.dreams || [];
  const cats = [...new Set(dreams.map(d => d.category || 'Uncategorized'))];
  const totalValue = dreams.reduce((sum,d)=>sum+(+d.value||0),0);
  const totalSaved = dreams.reduce((sum,d)=>sum+Math.min(+d.saved||0,+d.value||Number.MAX_SAFE_INTEGER),0);
  const completed = dreams.filter(d=>d.bought).length;
  const ready = dreams.filter(d=>!d.bought && +d.value>0 && +d.saved>=+d.value).length;
  const summary = `<div class="wish-command-strip">
    <div><small>FUTURE TARGETS</small><b>${dreams.length}</b></div>
    <div><small>RESOURCES SAVED</small><b>${fmt(totalSaved)}</b></div>
    <div><small>READY TO CLAIM</small><b>${ready}</b></div>
    <div><small>CLAIMED</small><b>${completed}</b></div>
  </div>`;
  if (!dreams.length) {
    $('#dreamList').innerHTML = summary + `<div class="wish-empty"><span>◇</span><b>No future targets registered.</b><p>Add a purchase, experience or dream worth preparing for.</p></div>`;
    return;
  }
  const groups = cats.map(cat => {
    const items = dreams.filter(d => (d.category || 'Uncategorized') === cat);
    const bought = items.filter(d => d.bought).length;
    const saved = items.reduce((sum,d)=>sum+(+d.saved||0),0);
    return `<section class="wish-category">
      <header class="wish-category-head"><div><small>HUNTER TARGET CLASS</small><h3>${esc(cat)}</h3></div><div><b>${bought}/${items.length}</b><span>claimed · ${fmt(saved)} saved</span></div></header>
      <div class="wish-grid">${items.map(d => {
        const value = +d.value || 0, savedAmount = +d.saved || 0;
        const p = value ? Math.min(savedAmount / value, 1) : 0;
        const percent = d.bought ? 100 : Math.round(p * 100);
        const remaining = Math.max(value - savedAmount, 0);
        return `<article class="dream-item wish-card ${d.bought ? 'bought-item' : ''}">
          <div class="wish-card-top"><div><small>${d.bought ? 'TARGET CLAIMED' : percent >= 100 ? 'READY TO CLAIM' : 'FUTURE ACQUISITION'}</small><h4>${esc(d.name)}</h4></div><button class="del-x" data-type="dream" data-id="${d.id}" aria-label="Delete wish">✕</button></div>
          <div class="wish-money-grid">
            <label><span>Target value</span><input class="d-edit money-live" inputmode="numeric" data-f="value" data-id="${d.id}" value="${Number(value).toLocaleString('es-CO')}" title="Target value"></label>
            <label><span>Saved</span><input class="d-edit money-live" inputmode="numeric" data-f="saved" data-id="${d.id}" value="${Number(savedAmount).toLocaleString('es-CO')}" title="Amount saved"></label>
          </div>
          <div class="wish-progress"><div><span>${percent}% prepared</span><b>${d.bought ? 'Acquired' : remaining ? `${fmt(remaining)} remaining` : 'Ready'}</b></div><div class="mini-bar green"><i style="width:${percent}%"></i></div></div>
          <div class="wish-card-actions"><button class="buy-btn ${d.bought ? 'on' : ''}" data-id="${d.id}">${d.bought ? '✓ Claimed' : 'Mark as claimed'}</button><button class="to-shop" data-id="${d.id}" title="Send to Shopping & to-buy">Send to Shopping <span>→</span></button></div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }).join('');
  $('#dreamList').innerHTML = summary + groups;
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

/* ---------- ANIME HUNTER ARCHIVE · V136 ---------- */
const A_TEMPS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
const A_EXTRA = [['peliculas', 'Movies'], ['ovas', 'OVAs'], ['especiales', 'Specials']];
const ANIME_STATES = [
  ['', '—'], ['Viéndolo 👀', 'Watching'], ['En emisión 📡', 'Airing'],
  ['Pendiente', 'Pending'], ['Finalizado ✅', 'Finished']
];
const numTotal = (v) => {
  const m = String(v ?? '').match(/\d+/);
  return m ? +m[0] : 0;
};
function animeBloques() {
  return A_TEMPS.map((f, i) => [f, `Season ${i + 1}`]).concat(A_EXTRA);
}
function animeCompleto(a) {
  const conDatos = animeBloques().map(([f]) => f).filter(f => numTotal(a[f]) > 0);
  return conDatos.length > 0 && conDatos.every(f => (+a['v_' + f] || 0) >= numTotal(a[f]));
}
function animeProgress(a) {
  const blocks = animeBloques().filter(([f]) => numTotal(a[f]) > 0);
  const total = blocks.reduce((sum, [f]) => sum + numTotal(a[f]), 0);
  const watched = blocks.reduce((sum, [f]) => sum + Math.min(+a['v_' + f] || 0, numTotal(a[f])), 0);
  return { watched, total, pct: total ? Math.min(100, Math.round(watched / total * 100)) : 0 };
}
function animeNextBlock(a) {
  return animeBloques().find(([f]) => numTotal(a[f]) > 0 && (+a['v_' + f] || 0) < numTotal(a[f])) || null;
}
function animeCover(a) {
  return String(a.cover_url || '').trim();
}
function animeFallback(title = '') {
  const letter = String(title || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="anime-cover-fallback"><span>◆</span><b>${esc(letter)}</b></div>`;
}
function animeCoverHtml(a, cls = '') {
  const src = animeCover(a);
  if (!src) return animeFallback(a.name);
  return `<img class="anime-cover ${cls}" src="${esc(src)}" alt="${esc(a.name)} cover" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;anime-cover-fallback&quot;><span>◆</span><b>${esc(String(a.name || '?').charAt(0).toUpperCase())}</b></div>'">`;
}
function animeStatusLabel(state) {
  return (ANIME_STATES.find(([v]) => v === (state || '')) || ['', 'Pending'])[1];
}
function animeCard(a, { current = false, rank = null } = {}) {
  const p = animeProgress(a);
  const next = animeNextBlock(a);
  const quick = next ? `<button type="button" class="anime-quick-add" data-anime-plus="${a.id}" aria-label="Add one episode">＋1</button>` : '';
  const rankTag = rank ? `<span class="anime-rank">${rank === 1 ? '♛ 1' : '#' + rank}</span>` : '';
  return `<article class="anime-card ${current ? 'anime-card-current' : ''}" data-anime-card="${a.id}">
    <button type="button" class="anime-cover-button" data-anime-open="${a.id}" aria-label="Open ${esc(a.name)}">${animeCoverHtml(a)}${rankTag}</button>
    <div class="anime-card-body">
      <div class="anime-card-top"><span class="anime-status">${esc(animeStatusLabel(a.estado))}</span>${a.score != null ? `<b class="anime-score">★ ${esc(a.score)}</b>` : ''}</div>
      <h3>${esc(a.name)}</h3>
      <div class="anime-progress-line"><span>${p.total ? `${p.watched} / ${p.total}` : 'No episode total'}</span><b>${p.total ? p.pct + '%' : '—'}</b></div>
      <div class="mini-bar anime-mini-bar"><i style="width:${p.pct}%"></i></div>
      <div class="anime-card-actions">${quick}<button type="button" class="btn-ghost" data-anime-open="${a.id}">Open</button></div>
    </div>
  </article>`;
}
async function syncAnimeCompletion(a) {
  const complete = animeCompleto(a);
  if (complete && a.estado !== 'Finalizado ✅') {
    await api('/api/anime', { body: { id: a.id, field: 'estado', value: 'Finalizado ✅' } });
    a.estado = 'Finalizado ✅';
  } else if (!complete && a.estado === 'Finalizado ✅') {
    await api('/api/anime', { body: { id: a.id, field: 'estado', value: 'Viéndolo 👀' } });
    a.estado = 'Viéndolo 👀';
  }
}
function renderAnime() {
  const list = S.animes || [];
  for (const a of list) {
    const complete = animeCompleto(a);
    if (complete && a.estado !== 'Finalizado ✅') {
      a.estado = 'Finalizado ✅';
      api('/api/anime', { body: { id:a.id, field:'estado', value:'Finalizado ✅' } }).catch(()=>{});
    } else if (!complete && a.estado === 'Finalizado ✅') {
      a.estado = 'Viéndolo 👀';
      api('/api/anime', { body: { id:a.id, field:'estado', value:'Viéndolo 👀' } }).catch(()=>{});
    }
  }
  const watching = list.filter(a => a.estado === 'Viéndolo 👀' || a.estado === 'En emisión 📡');
  const finished = list.filter(a => a.estado === 'Finalizado ✅').length;
  $('#animeStats').innerHTML = `
    <div class="card gold"><label>Watching</label><strong>${watching.length}</strong></div>
    <div class="card green"><label>Finished</label><strong>${finished}</strong></div>
    <div class="card"><label>Archive</label><strong>${list.length}</strong></div>`;
  $('#animeCurrent').innerHTML = watching.length
    ? watching.slice(0, 3).map(a => animeCard(a, { current: true })).join('')
    : `<div class="anime-empty-state"><span>◇</span><b>No current expedition</b><small>Choose a pending anime or add a new one.</small></div>`;
  const pass = (a) => ANIME_FILTRO === 'todos' || (a.estado || 'Pendiente') === ANIME_FILTRO
    || (ANIME_FILTRO === 'Pendiente' && !a.estado);
  const visible = list.filter(pass).sort((a, b) => {
    if (a.score != null && b.score != null) return +b.score - +a.score;
    if (a.score != null) return -1;
    if (b.score != null) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });
  let rank = 0;
  $('#animeArchive').innerHTML = visible.length
    ? visible.map(a => animeCard(a, { rank: a.score != null ? ++rank : null })).join('')
    : `<div class="anime-empty-state"><span>◇</span><b>No matches</b><small>Change the archive filter.</small></div>`;
}
async function animeIncrement(id) {
  const a = (S.animes || []).find(x => +x.id === +id);
  if (!a) return;
  const next = animeNextBlock(a);
  if (!next) { toast('This anime has no pending episodes.', 'warn'); return; }
  const [field, label] = next;
  const value = Math.min(numTotal(a[field]), (+a['v_' + field] || 0) + 1);
  await api('/api/anime', { body: { id: a.id, field: 'v_' + field, value } });
  a['v_' + field] = value;
  await syncAnimeCompletion(a);
  toast(`📺 ${esc(label)} · ${value}/${numTotal(a[field])}`);
  renderAnime();
}
function openAnimeDetails(id) {
  const a = (S.animes || []).find(x => +x.id === +id);
  if (!a) return;
  const previous = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-back anime-detail-back';
  const blocks = animeBloques();
  const rows = blocks.map(([f, label]) => {
    const total = numTotal(a[f]);
    const watched = +a['v_' + f] || 0;
    if (!total && !A_TEMPS.slice(0, 3).includes(f) && !A_EXTRA.some(([x]) => x === f)) return '';
    return `<div class="anime-part-row ${total && watched >= total ? 'done' : ''}">
      <span>${esc(label)}</span>
      <input type="number" min="0" data-anime-field="v_${f}" data-anime-id="${a.id}" value="${total ? watched : ''}" placeholder="0" aria-label="${esc(label)} watched">
      <i>/</i>
      <input type="number" min="0" data-anime-field="${f}" data-anime-id="${a.id}" value="${total || ''}" placeholder="0" aria-label="${esc(label)} total">
    </div>`;
  }).join('');
  back.innerHTML = `<div class="modal-card anime-detail-card">
    <div class="anime-detail-hero">${animeCoverHtml(a, 'anime-detail-cover')}<div><span>ANIME FILE</span><div class="anime-title-line"><h3>${esc(a.name)}</h3><button type="button" class="anime-title-edit" data-anime-rename="${a.id}" aria-label="Edit anime title" title="Edit title">✎</button></div><small>${esc(animeStatusLabel(a.estado))}</small></div><button type="button" class="anime-detail-close" aria-label="Close">✕</button></div>
    <div class="anime-detail-controls">
      <label>Status<select data-anime-field="estado" data-anime-id="${a.id}">${ANIME_STATES.map(([v,t])=>`<option value="${v}" ${(a.estado||'')===v?'selected':''}>${t}</option>`).join('')}</select></label>
      <label>Score<input type="number" min="0" max="100" step="0.1" data-anime-field="score" data-anime-id="${a.id}" value="${a.score ?? ''}" placeholder="0–100"></label>
    </div>
    <div class="anime-parts">${rows}</div>
    <div class="anime-detail-actions">
      <button type="button" class="btn-ghost" data-anime-cover-search="${a.id}">Change cover</button>
      <button type="button" class="btn-ghost" data-anime-add-season="${a.id}">＋ Season</button>
      <button type="button" class="del-x" data-type="anime" data-id="${a.id}">Delete</button>
    </div>
  </div>`;
  const close = () => { back.classList.remove('show'); setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();},240); };
  document.body.appendChild(back); document.body.classList.add('modal-open'); requestAnimationFrame(()=>back.classList.add('show'));
  back.querySelector('.anime-detail-close').onclick = close;
  back.onclick = e => { if (e.target === back) close(); };
}
async function searchAnimeCovers(query) {
  try {
    const response = await api('/api/anime/search?q=' + encodeURIComponent(query), { method:'GET', quiet:true, timeout:26000 });
    return response.results || [];
  } catch (err) {
    err.coverProviderUnavailable = true;
    throw err;
  }
}
function pickAnimeCover(query, { allowNoCover = true } = {}) {
  return new Promise(async resolve => {
    const previous = document.activeElement;
    const back = document.createElement('div'); back.className = 'modal-back anime-cover-back';
    back.innerHTML = `<div class="modal-card anime-cover-card"><div class="anime-cover-head"><div><span>COVER SEARCH</span><h3>${esc(query)}</h3></div><button type="button" class="anime-detail-close">✕</button></div><div class="anime-cover-loading">Searching archive…</div></div>`;
    const close = val => { back.classList.remove('show'); setTimeout(()=>{back.remove();if(!document.querySelector('.modal-back'))document.body.classList.remove('modal-open');previous?.focus?.();},240); resolve(val); };
    document.body.appendChild(back); document.body.classList.add('modal-open'); requestAnimationFrame(()=>back.classList.add('show'));
    back.querySelector('.anime-detail-close').onclick=()=>close(null); back.onclick=e=>{if(e.target===back)close(null);};
    try {
      const results = await searchAnimeCovers(query);
      const body = back.querySelector('.anime-cover-loading');
      body.className = 'anime-cover-results';
      body.innerHTML = results.length ? results.map((r,i)=>`<button type="button" class="anime-cover-option" data-cover-index="${i}"><img src="${esc(r.cover_url)}" alt="" referrerpolicy="no-referrer"><span><b>${esc(r.title)}</b><small>${esc([r.type,r.year,r.episodes?`${r.episodes} ep`:null].filter(Boolean).join(' · '))}</small></span></button>`).join('') : '<div class="anime-empty-state"><b>No cover found</b><small>Try another title or continue without a cover.</small></div>';
      if (allowNoCover) body.insertAdjacentHTML('beforeend','<button type="button" class="btn-ghost anime-cover-upload-choice">Upload image from device</button><button type="button" class="btn-ghost anime-no-cover">Continue without cover</button>');
      body.onclick=e=>{const opt=e.target.closest('[data-cover-index]');if(opt)close(results[+opt.dataset.coverIndex]);else if(e.target.closest('.anime-cover-upload-choice'))close({upload:true});else if(e.target.closest('.anime-no-cover'))close({cover_url:'',external_id:'',source:''});};
    } catch (err) {
      const body=back.querySelector('.anime-cover-loading');
      body.innerHTML='<div class="anime-empty-state"><b>Cover providers unavailable</b><small>Jikan did not respond and AniList fallback was also unavailable. Your episodes and progress remain untouched.</small></div><div class="anime-cover-recovery"><button type="button" class="btn-gold anime-cover-retry">Retry</button><button type="button" class="btn-ghost anime-cover-upload">Upload image</button><button type="button" class="btn-ghost anime-cover-manual">Use direct image URL</button><button type="button" class="btn-ghost anime-cover-stop">Stop</button></div>';
      back.querySelector('.anime-cover-retry').onclick=()=>{ close({retry:true}); };
      back.querySelector('.anime-cover-upload').onclick=()=>close({upload:true});
      back.querySelector('.anime-cover-manual').onclick=async()=>{
        const r=await modal({icon:'🖼',title:'Manual cover',text:'Paste the direct HTTPS address of the image itself (it usually ends in .jpg, .png or .webp). A Google results-page link will not work.',fields:[{label:'Cover URL',placeholder:'https://...'}],okText:'Use cover'});
        const url=String(r?.[0]||'').trim();
        if(url && /^https:\/\//i.test(url)) close({cover_url:url,external_id:'',source:'Manual URL'});
        else if(url) toast('Use a valid HTTPS image URL.','warn');
      };
      back.querySelector('.anime-cover-stop').onclick=()=>close({provider_unavailable:true});
    }
  });
}
async function uploadAnimeCover(a) {
  if (!a) return false;
  return new Promise(resolve => {
    const input=document.createElement('input');
    input.type='file'; input.accept='image/jpeg,image/png,image/webp,image/gif';
    input.onchange=async()=>{
      const file=input.files?.[0];
      if(!file){resolve(false);return;}
      if(file.size>5*1024*1024){toast('Image must be 5 MB or smaller.','warn');resolve(false);return;}
      const fd=new FormData(); fd.append('cover',file);
      try{
        const response=await fetch(`/api/anime/${a.id}/cover-upload`,{method:'POST',body:fd});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error||'Upload failed');
        a.cover_url=data.cover_url||''; a.cover_source=data.cover_source||'Local upload';
        toast('🖼 Cover saved locally.'); resolve(true);
      }catch(err){toast(err.message||'Could not upload image.','warn');resolve(false);}
    };
    input.click();
  });
}

async function chooseAnimeCover(query, options={}) {
  let choice = await pickAnimeCover(query, options);
  if (choice?.retry) choice = await pickAnimeCover(query, options);
  return choice;
}
function animeTitleKey(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
async function applyAnimeCoverChoice(a, selected) {
  if(!a || !selected?.cover_url) return false;
  for(const [field,value] of [['cover_url',selected.cover_url],['external_id',selected.external_id||''],['cover_source',selected.source||'']]){
    await api('/api/anime',{body:{id:a.id,field,value}});
    a[field]=value;
  }
  const matched=String(selected.title||'').trim();
  if(matched && animeTitleKey(matched)!==animeTitleKey(a.name)){
    const rename=await modal({icon:'✎',title:'Matched title found',text:`Current: ${a.name}\nMatch: ${matched}\n\nUpdate only the stored title? Episodes and progress stay attached to the same anime.`,okText:'Update title',cancelText:'Keep current'});
    if(rename){await api('/api/anime',{body:{id:a.id,field:'name',value:matched}});a.name=matched;}
  }
  return true;
}
async function addAnimeFlow(name) {
  const selected = await chooseAnimeCover(name);
  if (selected === null) return false;
  const fields = [
    { type: 'number', label: 'Season 1 episodes', min: 0, value: selected?.episodes || '', placeholder: '0' },
    { type: 'number', label: 'Season 2 episodes · optional', min: 0, placeholder: '0' },
    { type: 'number', label: 'Season 3 episodes · optional', min: 0, placeholder: '0' },
    { type: 'number', label: 'Movies · optional', min: 0, placeholder: '0' },
    { type: 'number', label: 'OVAs · optional', min: 0, placeholder: '0' }
  ];
  const r = await modal({ icon:'📺', title:'Add ' + (selected?.title || name), text:'Confirm only the progress fields you use. Everything can be edited later.', fields, okText:'Add to archive' });
  if (!r) return false;
  await api('/api/anime/new', { body: { name:selected?.title || name, t1:r[0], t2:r[1], t3:r[2], peliculas:r[3], ovas:r[4], cover_url:selected?.cover_url || '', external_id:selected?.external_id || '', cover_source:selected?.source || '' } });
  return true;
}
async function findMissingAnimeCovers() {
  const missing=(S.animes||[]).filter(a=>!animeCover(a));
  if(!missing.length){toast('All anime already have a cover.');return;}
  let applied=0;
  for(const a of missing){
    const choice=await chooseAnimeCover(a.name);
    if(choice===null || choice?.provider_unavailable) { toast('Cover search stopped. Try again later.','warn'); break; }
    if(choice?.upload){if(await uploadAnimeCover(a)) applied++;}
    else if(choice?.cover_url){
      if(await applyAnimeCoverChoice(a,choice)) applied++;
    }
  }
  renderAnime(); toast(`🖼 ${applied} cover${applied===1?'':'s'} added.`);
}
document.addEventListener('click', async e => {
  const filter=e.target.closest('#animeFilter button');
  if(filter){ANIME_FILTRO=filter.dataset.f;document.querySelectorAll('#animeFilter button').forEach(x=>x.classList.remove('active'));filter.classList.add('active');renderAnime();return;}
  const plus=e.target.closest('[data-anime-plus]'); if(plus){await animeIncrement(+plus.dataset.animePlus);return;}
  const open=e.target.closest('[data-anime-open]'); if(open){openAnimeDetails(+open.dataset.animeOpen);return;}
  const cover=e.target.closest('[data-anime-cover-search]'); if(cover){const a=(S.animes||[]).find(x=>+x.id===+cover.dataset.animeCoverSearch);if(!a)return;const selected=await chooseAnimeCover(a.name);if(selected?.provider_unavailable){toast('Cover providers are unavailable. Try again later.','warn');return;}let changed=false;if(selected?.upload) changed=await uploadAnimeCover(a);else changed=await applyAnimeCoverChoice(a,selected);if(changed){document.querySelector('.anime-detail-back')?.remove();document.body.classList.remove('modal-open');renderAnime();openAnimeDetails(a.id);}return;}
  const rename=e.target.closest('[data-anime-rename]'); if(rename){const a=(S.animes||[]).find(x=>+x.id===+rename.dataset.animeRename);if(!a)return;const r=await modal({icon:'✎',title:'Edit anime title',text:'This changes only the name. Episodes, seasons and progress remain untouched.',fields:[{label:'Title',value:a.name,placeholder:'Anime title'}],okText:'Save title'});const name=String(r?.[0]||'').trim();if(name&&name!==a.name){await api('/api/anime',{body:{id:a.id,field:'name',value:name}});a.name=name;document.querySelector('.anime-detail-back')?.remove();document.body.classList.remove('modal-open');renderAnime();openAnimeDetails(a.id);}return;}
  const addSeason=e.target.closest('[data-anime-add-season]'); if(addSeason){const a=(S.animes||[]).find(x=>+x.id===+addSeason.dataset.animeAddSeason);if(!a)return;const next=A_TEMPS.find(f=>numTotal(a[f])===0);if(!next){toast('Seven seasons are already available.','warn');return;}const r=await modal({icon:'✨',title:'Add '+`Season ${+next.slice(1)}`,fields:[{type:'number',label:'Episodes',min:1}],okText:'Add season'});if(r?.[0]){await api('/api/anime',{body:{id:a.id,field:next,value:r[0]}});a[next]=r[0];document.querySelector('.anime-detail-back')?.remove();document.body.classList.remove('modal-open');renderAnime();openAnimeDetails(a.id);}return;}
});
document.addEventListener('change', async e => {
  const t=e.target.closest('[data-anime-field]'); if(!t)return;
  const a=(S.animes||[]).find(x=>+x.id===+t.dataset.animeId); if(!a)return;
  await api('/api/anime',{body:{id:a.id,field:t.dataset.animeField,value:t.value}});
  a[t.dataset.animeField]=t.dataset.animeField.startsWith('v_')?+t.value:t.value;
  await syncAnimeCompletion(a); renderAnime();
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
  dream: 'Delete this future target? Remove it only if it no longer belongs to your plans.',
  book: 'Delete this book from your library?',
  anime: 'Delete this anime from the list?',
  debt: 'Delete this debt AND its logged payments? Only if you registered it by mistake.'
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.del-x');
  if (!b || !b.dataset.type) return;   // ignora botones .del-x propios de otros módulos (ej. historial gym)
  e.stopPropagation();
  if (!await confirmModal('Confirm deletion', DEL_MSG[b.dataset.type])) return;
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
  if (!await confirmModal('Register debt', 'Remember your promise: nothing new on installments. Only log it if it already exists in real life, so the boss shows its true HP.')) return;
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
  const form=e.currentTarget, submit=e.submitter||form.querySelector('[type="submit"]');
  const name=$('#anName').value.trim();
  if(!name)return;
  await withBusy(submit, async()=>{
    const added=await addAnimeFlow(name);
    if(!added)return;
    form.reset();
    toast('📺 Anime added to your Hunter Archive.');
    await load();
  });
});
$('#animeMissingCovers')?.addEventListener('click', findMissingAnimeCovers);
$('#animeHelpBtn')?.addEventListener('click', ()=>modal({icon:'◆',title:'Anime Hunter Archive',text:'Track only what matters: current progress, status, score, seasons, movies, OVAs and specials. Covers come from an external search, while every progress record stays inside Kevin LifeOS.',okText:'Close'}));


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



function languageLevelCheckAdvice() {
  try {
    const pf=S.profile||{};
    const qIdx=Math.min(+(pf.eng_q||0),ENGLISH_TRIMESTERS.length-1);
    const target=ENGLISH_TRIMESTERS[qIdx]?.level||'A2';
    const milestone=Math.min(120,(qIdx+1)*30);
    const immersionDays=diasInglesHechos();
    const lastDate=pf.eng_real_date||'';
    const stageStart=pf['eng_q_start_'+qIdx]||'';
    const testedThisStage=!!(lastDate&&stageStart&&lastDate>=stageStart);
    if(immersionDays>=milestone&&!testedThisStage){
      return `🤖 Hunter, you have ${immersionDays} immersion days. Your ${target} level check mission is ready. Take the assessment, then enter the result in English mastery.`;
    }
  }catch(_error){}
  return '';
}

// v111 · Kevin Advisor: rules-based guidance from the app's real state.
// It does not invent progress, alter data or call an external AI service.
function kevinAdvisorMessage() {
  try {
    const pirateGreeting = `Welcome back, ${piratePositionState().current.name} Kevin. `;
    const reminder = scheduledReminder();
    if (reminder) return pirateGreeting + reminder.msg;

    const levelAdvice = languageLevelCheckAdvice();
    if (levelAdvice) return pirateGreeting + levelAdvice;

    const academy = academyReadState();
    const active = academyAllSkills().find(x => x.id === academy.activeSkillId);
    const today = hoyLocal();
    if (active && !academy.doneDates.includes(today)) {
      const ix = Math.min(Number(academy.sessions) || 0, active.practices.length - 1);
      return pirateGreeting + `🎯 Today's training: ${active.name}. ${active.practices[ix]}`;
    }

    const openGoals = (S.goals || [])
      .filter(g => g.status !== 'Lograda 🏆' && Number(g.pct || 0) < 100)
      .sort((a,b) => Number(b.pct || 0) - Number(a.pct || 0));
    const actionable = openGoals.find(g => String(g.next_step || '').trim());
    if (actionable) return pirateGreeting + `🗺️ Next expedition move: ${actionable.next_step}`;

    const hakiMonths = (S.history || []).filter(h => Number(h.pct || 0) >= 0.7).length;
    if (hakiMonths < 2) return pirateGreeting + `⚡ Hunter License requirement: conquer ${2 - hakiMonths} more Haki month${2 - hakiMonths === 1 ? '' : 's'}.`;

    const intel = academyDailyIntel();
    return pirateGreeting + `◈ ${intel.domain}: ${intel.text}`;
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
  applyPirateBrandBadge();
  renderPet();
  // al abrir la app: si hay una cita en la ventana de 3 días, el robot la recuerda; si no, saluda
  setTimeout(async () => { const celebrated=await checkPirateCelebrations(); if (!celebrated && !petCheckAppointments()) petSayText(kevinAdvisorMessage(), 'idle', 7200); }, 900);
});

// v102: el respaldo usa una descarga nativa para no depender del estado de la SPA.

// V123 · Contextual help for the Hunter Acquisition Board.
document.addEventListener('click', async (event) => {
  const help = event.target.closest('[data-help="wishlist"]');
  if (!help) return;
  await modal({
    icon:'◇',
    title:'How Future Targets work',
    text:'Register purchases, experiences or dreams you want to prepare for. Update the target value and the amount saved directly on each card. When you are ready to buy, send the target to Shopping. Mark it as claimed only after it is truly acquired.<br><br><b>Hunter rule:</b> prepare the resources first and avoid creating new installment debt.',
    okText:'Understood'
  });
});
