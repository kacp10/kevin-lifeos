"""
KEVIN LIFE OS — Backend
Flask + SQLite. Los datos viven en lifeos.db (ese archivo ES tu base de datos:
cópialo para hacer backup, bórralo para empezar de cero).
Correr:  python app.py   →  http://localhost:5000
"""
import hashlib
import json
import logging
import os
import re
import secrets
import sqlite3
from datetime import date
from datetime import datetime
from contextlib import contextmanager
from flask import Flask, jsonify, render_template, request, g, Response
import db_layer

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, 'lifeos.db')
VERSION = 113  # must match FRONT_V in static/app.js
app = Flask(__name__)

# Logging útil tanto en local como en Render. No imprime contraseñas ni cuerpos JSON.
logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
)
logger = logging.getLogger('kevin-lifeos')


def _auth_enabled():
    return bool(os.environ.get('LIFEOS_PASSWORD'))


def _valid_credentials(username, password):
    expected_user = os.environ.get('LIFEOS_USERNAME', 'kevin')
    expected_password = os.environ.get('LIFEOS_PASSWORD', '')
    return (
        bool(expected_password)
        and secrets.compare_digest(username or '', expected_user)
        and secrets.compare_digest(password or '', expected_password)
    )


@app.before_request
def protect_private_app():
    """Protección opcional para el despliegue público.

    Se activa únicamente al definir LIFEOS_PASSWORD en Render o en el entorno local.
    /api/ping y los archivos estáticos quedan libres para health checks y carga inicial.
    """
    if not _auth_enabled() or request.path == '/api/ping' or request.path.startswith('/static/'):
        return None
    auth = request.authorization
    if auth and _valid_credentials(auth.username, auth.password):
        return None
    return (
        'Authentication required',
        401,
        {'WWW-Authenticate': 'Basic realm="Kevin LifeOS", charset="UTF-8"'},
    )


@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return response


@app.errorhandler(500)
def internal_error(error):
    logger.exception('Unhandled server error: %s', error)
    return jsonify(error='Internal server error. Please try again.'), 500



def to_int(v):
    """Convierte a entero de forma TOLERANTE, sin lanzar nunca un error 500.
    Acepta None, números y textos con separadores colombianos/europeos:
      '320.198'      -> 320198   (punto = separador de miles)
      '1.539.668'    -> 1539668
      '320,50'       -> 320      (coma = decimal, se redondea: la BD guarda enteros)
      '1.234,56'     -> 1235
      '$ 36.000'     -> 36000
    Si no logra interpretar nada, devuelve 0 (jamás rompe la app)."""
    if v is None or isinstance(v, bool):
        return int(v or 0)
    if isinstance(v, (int, float)):
        return int(round(v))
    s = re.sub(r'[^\d,.\-]', '', str(v).strip())   # quita $, espacios, letras
    if s in ('', '-', '.', ','):
        return 0
    has_dot, has_comma = '.' in s, ',' in s
    if has_dot and has_comma:
        # el separador que aparece de ÚLTIMO es el decimal
        if s.rfind(',') > s.rfind('.'):            # 1.234.567,89  (formato es-CO)
            s = s.replace('.', '').replace(',', '.')
        else:                                       # 1,234,567.89 (formato en-US)
            s = s.replace(',', '')
    elif has_comma:                                 # solo coma -> decimal
        s = s.replace(',', '.')
    elif has_dot:
        # solo punto(s): si son separadores de miles (varios puntos, o un grupo
        # final de exactamente 3 dígitos) los quitamos; si parece decimal, se deja.
        if s.count('.') > 1 or len(s.rsplit('.', 1)[-1]) == 3:
            s = s.replace('.', '')
    try:
        return int(round(float(s)))
    except ValueError:
        return 0


def safe_field_update(table, allowed_fields, int_fields, j, coerce=None, default_field=None):
    """UPDATE de un solo campo con whitelist centralizada (una sola línea de defensa
    en vez de repetir la validación en cada endpoint). Nunca deja pasar un campo
    fuera de `allowed_fields`, y usa `coerce` (por defecto: entero tolerante) solo
    para los campos listados en `int_fields`. Devuelve la respuesta jsonify lista."""
    field = j.get('field', default_field)
    if field not in allowed_fields:
        return jsonify(error='Field not allowed'), 400
    try:
        rid = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Invalid id'), 400
    fn = coerce or (lambda v: int(v or 0))
    val = fn(j.get('value')) if field in int_fields else j.get('value')
    db().execute(f'UPDATE {table} SET {field}=? WHERE id=?', (val, rid))
    db().commit()
    return jsonify(ok=True)


def db():
    if 'db' not in g:
        g.db = db_layer.connect(DB)
    return g.db


@contextmanager
def transaction():
    """Transacción atómica para operaciones que modifican varias tablas."""
    con = db()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise


def apply_migration(con, version, description, statements=()):
    """Ejecuta una migración nueva una sola vez y deja registro verificable."""
    done = con.execute('SELECT 1 FROM schema_migrations WHERE version=?', (version,)).fetchone()
    if done:
        return False
    try:
        for sql, params in statements:
            con.execute(sql, params)
        con.execute(
            'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?,?,?)',
            (version, datetime.now().isoformat(timespec='seconds'), description),
        )
        con.commit()
        logger.info('Migration %s applied: %s', version, description)
        return True
    except Exception:
        con.rollback()
        logger.exception('Migration %s failed: %s', version, description)
        raise


@app.teardown_appcontext
def close_db(_=None):
    d = g.pop('db', None)
    if d is not None:
        d.close()


def _consolidar_v2(con):
    """Traduce las 5 fuentes viejas de deuda al modelo único (debts_v2 + payments),
    preservando exactamente los valores actuales. Idempotente: borra y reconstruye
    debts_v2/payments en cada arranque desde las tablas viejas (fuente durante Fase 1-2).

    PRINCIPIO ANTI-DOBLE-CONTEO (clave):
      El 'detalle_items' es la VISTA CANÓNICA de la deuda. Cada línea del detalle = 1 deuda v2.
      Un jefe (tabla debts) cuyo initial YA está descompuesto en su detalle NO entra como deuda
      propia (se contaría doble). El jefe solo aporta sus ABONOS directos (pagos).
      - Jefe con grupo de detalle homónimo (o vía CRED_TO_DEBT)  -> NO crea deuda base
      - Préstamo individual que también es línea de 'Préstamos personales' -> NO crea deuda base
      - Jefe SIN representación en el detalle -> sí entra con su initial
    """
    CRED_TO_DEBT = {'Tarjeta DV': 'Tarjeta DV — Jefe Final', 'Joseph (cuota)': 'Joseph'}
    # inverso: nombre de jefe -> grupo de detalle que lo representa
    DEBT_TO_GRUPO = {v: k for k, v in CRED_TO_DEBT.items()}

    con.execute('DELETE FROM payments')
    con.execute('DELETE FROM debts_v2')

    def nueva_deuda(nombre, grupo, tipo, valor_total, num_cuotas, cuota,
                    mes_inicio=-1, nomina=0, origen='', origen_id=0):
        con.execute(
            '''INSERT INTO debts_v2 (nombre, grupo, tipo, valor_total, num_cuotas, cuota,
               mes_inicio, nomina, activa, origen, origen_id)
               VALUES (?,?,?,?,?,?,?,?,1,?,?)''',
            (nombre, grupo, tipo, valor_total, num_cuotas, cuota, mes_inicio, nomina, origen, origen_id))
        row = con.execute('SELECT id FROM debts_v2 WHERE origen=? AND origen_id=? ORDER BY id DESC',
                          (origen, origen_id)).fetchone()
        return dict(row)['id']

    def pago(debt_id, monto, mes='', tipo='cuota', fecha='', nota=''):
        if monto and monto > 0:
            con.execute('INSERT INTO payments (debt_id, mes, monto, tipo, fecha, nota) VALUES (?,?,?,?,?,?)',
                        (debt_id, mes, int(monto), tipo, fecha or date.today().isoformat(), nota))

    # ── Conjuntos para decidir qué jefes NO deben entrar como deuda propia ──
    grupos_detalle = set(
        dict(r)['grupo'] for r in con.execute('SELECT DISTINCT grupo FROM detalle_items').fetchall())
    # nombres de líneas dentro de "Préstamos personales" (para no duplicar los jefes-préstamo sueltos)
    lineas_prestamos = set()
    for it in con.execute("SELECT nombre FROM detalle_items WHERE grupo='Préstamos personales'").fetchall():
        nom = dict(it)['nombre']
        # normalizar: "Estiven 1 (con interés...)" -> "Estiven", "Angie (interés..)" -> "Angie"
        base = nom.split('(')[0].strip()
        base = ''.join(ch for ch in base if not ch.isdigit()).strip()
        lineas_prestamos.add(base)

    def jefe_esta_en_detalle(nombre):
        # ¿este jefe ya está representado en el detalle (directo, por mapeo, o como préstamo)?
        if nombre in grupos_detalle:
            return True
        if DEBT_TO_GRUPO.get(nombre) in grupos_detalle:   # ej. 'Tarjeta DV — Jefe Final' -> 'Tarjeta DV'
            return True
        base = ''.join(ch for ch in nombre if not ch.isdigit()).strip()
        if base in lineas_prestamos or nombre in lineas_prestamos:
            return True
        return False

    # 1) DEBTS (jefes): entran con su initial SOLO si NO están representados en el detalle.
    #    Si el jefe YA vive en el detalle, TODOS sus pagos (abonos directos, abonos de check,
    #    abonos con nota detalle:ID) ya están reflejados en 'pagadas'/'abonado_fijo' de sus líneas.
    #    Por eso NO creamos ninguna deuda "(abonos)" para él: contarla otra vez inflaba el pago
    #    y producía saldos negativos. Solo los jefes SIN detalle entran con su initial + abonos.
    for d in con.execute('SELECT * FROM debts').fetchall():
        d = dict(d)
        en_detalle = jefe_esta_en_detalle(d['name'])
        if en_detalle:
            continue   # su deuda y sus pagos ya viven completos en el detalle
        did = nueva_deuda(d['name'], d['name'], 'libre', d['initial'] or 0, 0, 0,
                          origen='debts', origen_id=d['id'])
        for ab in con.execute('SELECT * FROM abonos WHERE debt_id=?', (d['id'],)).fetchall():
            ab = dict(ab)
            pago(did, ab['valor'], mes=(ab.get('fecha') or '')[:7], tipo='capital',
                 fecha=ab.get('fecha') or '', nota=ab.get('nota') or 'abono')

    # 2) DETALLE_ITEMS (VISTA CANÓNICA): una deuda v2 por línea
    for it in con.execute('SELECT * FROM detalle_items ORDER BY orden, id').fetchall():
        it = dict(it)
        grupo = it['grupo']
        es_nomina = 1 if (grupo or '').lower().startswith('nómina') or (grupo or '').lower().startswith('nomina') else 0
        total = it['total'] or 0
        cuota = it['cuota'] or 0
        fijo = it['fijo'] or 0
        if total > 0 and cuota > 0:
            valor_total = cuota * total
            did = nueva_deuda(it['nombre'], grupo, 'cuotas', valor_total, total, cuota,
                              mes_inicio=(it.get('start_month') if it.get('start_month') is not None else -1),
                              nomina=es_nomina, origen='detalle', origen_id=it['id'])
            for _k in range(it['pagadas'] or 0):
                pago(did, cuota, tipo='cuota', nota='seed:pagada')
            if it.get('abonado_fijo'):
                pago(did, it['abonado_fijo'], tipo='capital', nota='abono')
        else:
            valor_total = fijo or 0
            did = nueva_deuda(it['nombre'], grupo, 'fijo', valor_total, 0, 0,
                              nomina=es_nomina, origen='detalle', origen_id=it['id'])
            if it.get('abonado_fijo'):
                pago(did, it['abonado_fijo'], tipo='capital', nota='abono')

    # 3) EXTRA_DEBTS (deudas registradas por Kevin) — nunca están en el detalle, entran siempre
    for d in con.execute('SELECT * FROM extra_debts').fetchall():
        d = dict(d)
        tipo = 'cuotas' if (d['cuotas'] or 0) >= 1 else 'libre'
        did = nueva_deuda(d['name'], '☠ ' + d['name'], tipo, d['total'] or 0,
                          d['cuotas'] or 0, d['cuota'] or 0,
                          mes_inicio=(d.get('start') if d.get('start') is not None else -1),
                          origen='extra', origen_id=d['id'])
        if d.get('abonado'):
            pago(did, d['abonado'], tipo='capital', nota='abono')
        for ab in con.execute(
                "SELECT * FROM abonos WHERE nota=? OR nota LIKE ?",
                (f"extra:{d['id']}", f"extracheck:{d['id']}:%")).fetchall():
            ab = dict(ab)
            pago(did, ab['valor'], mes=(ab.get('fecha') or '')[:7], tipo='cuota',
                 fecha=ab.get('fecha') or '', nota='check')

    # 4) COMPRAS (compras a cuotas nuevas): son deuda ADICIONAL a la tarjeta (no están en el detalle)
    for cmp in con.execute('SELECT * FROM compras ORDER BY id').fetchall():
        cmp = dict(cmp)
        grupo = CRED_TO_DEBT.get(cmp['creditor'], cmp['creditor'])
        cuotas = cmp['cuotas'] or 0
        valor = cmp['valor'] or 0
        cuota = round(valor / cuotas) if cuotas else 0
        did = nueva_deuda(cmp['concepto'], grupo, 'cuotas', valor, cuotas, cuota,
                          mes_inicio=(cmp.get('start') if cmp.get('start') is not None else -1),
                          origen='compra', origen_id=cmp['id'])
        if cmp.get('abonado'):
            pago(did, cmp['abonado'], tipo='capital', nota='abono')


def init_db():
    """Crea las tablas y siembra los datos de Kevin la primera vez."""
    # Evaluar si es primera vez ANTES de conectar (sqlite crea el archivo al conectar)
    sqlite_existe = os.path.exists(DB)
    con = db_layer.connect(DB)
    if db_layer.IS_PG:
        try:
            row = con.execute("SELECT value FROM config WHERE key='plan'").fetchone()
            first_time = row is None
        except Exception:
            con = db_layer.connect(DB)
            first_time = True
    else:
        # en SQLite: primera vez si el archivo no existía O si no tiene el plan
        first_time = True
        if sqlite_existe:
            try:
                tmp = db_layer.connect(DB)
                r = tmp.execute("SELECT value FROM config WHERE key='plan'").fetchone()
                first_time = r is None
                tmp.close()
            except Exception:
                first_time = True
    con.executescript('''
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY, name TEXT, initial INTEGER);
    CREATE TABLE IF NOT EXISTS abonos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, debt_id INTEGER,
        valor INTEGER, nota TEXT DEFAULT '', FOREIGN KEY(debt_id) REFERENCES debts(id));
    CREATE TABLE IF NOT EXISTS habits (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE IF NOT EXISTS gym_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, exercise TEXT,
        weight REAL DEFAULT 0, reps INTEGER DEFAULT 0, created TEXT);
    CREATE TABLE IF NOT EXISTS habit_marks (
        habit_id INTEGER, day TEXT, PRIMARY KEY (habit_id, day));
    CREATE TABLE IF NOT EXISTS months_history (
        label TEXT PRIMARY KEY, pct REAL);
    CREATE TABLE IF NOT EXISTS dreams (
        id INTEGER PRIMARY KEY, category TEXT, name TEXT,
        value INTEGER, saved INTEGER DEFAULT 0, bought INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS animes (
        id INTEGER PRIMARY KEY, name TEXT, score REAL,
        t1 TEXT DEFAULT '', t2 TEXT DEFAULT '', t3 TEXT DEFAULT '',
        t4 TEXT DEFAULT '', t5 TEXT DEFAULT '', t6 TEXT DEFAULT '', t7 TEXT DEFAULT '',
        peliculas TEXT DEFAULT '', ovas TEXT DEFAULT '', especiales TEXT DEFAULT '',
        estado TEXT DEFAULT '',
        v_t1 INTEGER DEFAULT 0, v_t2 INTEGER DEFAULT 0, v_t3 INTEGER DEFAULT 0,
        v_t4 INTEGER DEFAULT 0, v_t5 INTEGER DEFAULT 0, v_t6 INTEGER DEFAULT 0,
        v_t7 INTEGER DEFAULT 0, v_peliculas INTEGER DEFAULT 0,
        v_ovas INTEGER DEFAULT 0, v_especiales INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY, title TEXT, status TEXT DEFAULT 'Por comprar',
        pages INTEGER DEFAULT 0, current INTEGER DEFAULT 0,
        read_year INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS payment_checks (
        item TEXT, month TEXT, PRIMARY KEY (item, month));
    CREATE TABLE IF NOT EXISTS week_shifts (
        weekday INTEGER PRIMARY KEY, shift TEXT);
    CREATE TABLE IF NOT EXISTS routine_done (
        day TEXT, activity TEXT, note TEXT DEFAULT '', PRIMARY KEY (day, activity));
    CREATE TABLE IF NOT EXISTS study_profile (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS careers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, icon TEXT DEFAULT '🎯',
        step INTEGER DEFAULT 0, course TEXT DEFAULT '', pct INTEGER DEFAULT 0,
        active INTEGER DEFAULT 0, bank INTEGER DEFAULT 0, goal_id INTEGER DEFAULT NULL);
    CREATE TABLE IF NOT EXISTS courses_done (
        id INTEGER PRIMARY KEY AUTOINCREMENT, career TEXT, title TEXT,
        finished_on TEXT);
    CREATE TABLE IF NOT EXISTS routine_extra (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, title TEXT, descr TEXT,
        weekday INTEGER DEFAULT -1, day TEXT DEFAULT '', habit TEXT DEFAULT '',
        scheduled INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS routine_hidden (
        weekday INTEGER, akey TEXT, PRIMARY KEY (weekday, akey));
    CREATE TABLE IF NOT EXISTS routine_hidden_day (
        day TEXT, akey TEXT, PRIMARY KEY (day, akey));
    CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, mood TEXT DEFAULT '',
        note TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, amount INTEGER,
        method TEXT DEFAULT 'Efectivo', kind TEXT DEFAULT 'once',
        month TEXT DEFAULT '', created TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS month_income (
        month TEXT PRIMARY KEY, income INTEGER);
    CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, amount INTEGER,
        method TEXT DEFAULT 'Efectivo', payday TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS fund (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, quota INTEGER DEFAULT 0,
        frequency TEXT DEFAULT 'Monthly', last_deposit TEXT DEFAULT '',
        saved INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS piggy (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, kind TEXT DEFAULT 'free',
        monthly INTEGER DEFAULT 0, started TEXT DEFAULT '', icon TEXT DEFAULT '🐷',
        goal INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS piggy_moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT, piggy_id INTEGER, amount INTEGER,
        day TEXT, note TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS shopping (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slots INTEGER DEFAULT 1,
         done INTEGER DEFAULT 0, created TEXT DEFAULT '',
         bought_at TEXT DEFAULT '', cost INTEGER DEFAULT 0, method TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT,
        done INTEGER DEFAULT 0, created TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS detalle_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, grupo TEXT, nombre TEXT,
        cuota INTEGER DEFAULT 0, pagadas INTEGER DEFAULT 0, total INTEGER DEFAULT 0,
        fijo INTEGER DEFAULT 0, orden INTEGER DEFAULT 0, abonado_fijo INTEGER DEFAULT 0,
        start_month INTEGER DEFAULT -1);
    CREATE TABLE IF NOT EXISTS extra_debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, total INTEGER,
        cuota INTEGER DEFAULT 0, cuotas INTEGER DEFAULT 0, start INTEGER DEFAULT 0,
        due_date TEXT DEFAULT '', abonado INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, why TEXT DEFAULT '',
        target TEXT DEFAULT '', status TEXT DEFAULT 'Pendiente',
        pct INTEGER DEFAULT 0, next_step TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT, creditor TEXT, concepto TEXT,
        valor INTEGER, cuotas INTEGER, start INTEGER, abonado INTEGER DEFAULT 0);
    ''')
    # Índices: gym_sets/abonos/payment_checks crecen indefinidamente con el uso;
    # estos evitan que las consultas se vuelvan lentas cuando haya mucho historial.
    # IF NOT EXISTS los hace seguros de correr en cada arranque, en SQLite y Postgres.
    for idx_sql in (
        'CREATE INDEX IF NOT EXISTS idx_gym_sets_date_ex ON gym_sets(date, exercise)',
        'CREATE INDEX IF NOT EXISTS idx_payment_checks_month ON payment_checks(month)',
        'CREATE INDEX IF NOT EXISTS idx_abonos_fecha ON abonos(fecha)',
        'CREATE INDEX IF NOT EXISTS idx_abonos_debt_id ON abonos(debt_id)',
    ):
        try:
            con.execute(idx_sql)
        except Exception as e:
            print('  (aviso) no se pudo crear índice:', e)
    apply_migration(
        con, 'v102_foundation',
        'Backups, transactional guards and formal migration registry'
    )
    apply_migration(
        con, 'v103_performance_indexes',
        'Indexes for books, expenses, purchases and payment history',
        (
            ('CREATE INDEX IF NOT EXISTS idx_books_status_year ON books(status, read_year)', ()),
            ('CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month)', ()),
            ('CREATE INDEX IF NOT EXISTS idx_compras_creditor ON compras(creditor)', ()),
            ('CREATE INDEX IF NOT EXISTS idx_extra_debts_start ON extra_debts(start)', ()),
        ),
    )
    if first_time:
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            seed = json.load(f)
        plan = {k: seed[k] for k in
                ('months', 'salario', 'extra', 'vida', 'ahorro', 'creditors')}
        con.execute('INSERT INTO config VALUES (?,?)',
                    ('plan', json.dumps(plan, ensure_ascii=False)))
        for i, (name, initial) in enumerate(seed['debts'], 1):
            con.execute('INSERT INTO debts VALUES (?,?,?)', (i, name, initial))
        for i, h in enumerate(seed['habits'], 1):
            con.execute('INSERT INTO habits VALUES (?,?)', (i, h))
        for i, d in enumerate(seed['dreams'], 1):
            con.execute('INSERT INTO dreams (id,category,name,value) VALUES (?,?,?,?)',
                        (i, d[0], d[1], d[2]))
        for i, a in enumerate(seed['animes'], 1):
            con.execute('''INSERT INTO animes
                (id, name, score, t1, t2, t3, t4, t5, peliculas, ovas, especiales, estado)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
                (i, a['name'], a['score'], a['t1'], a['t2'], a['t3'], a['t4'],
                 a['t5'], a['peliculas'], a['ovas'], a['especiales'], a['estado']))
        for i, b in enumerate(seed['books'], 1):
            con.execute('INSERT INTO books (id,title) VALUES (?,?)', (i, b))
        con.commit()
        print('✦ Base de datos creada y sembrada: lifeos.db')
    # Migración: si tu DB es vieja, agrega las deudas que falten (una sola vez)
    flag = con.execute("SELECT 1 FROM config WHERE key='debts_v2'").fetchone()
    if not flag:
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            seed = json.load(f)
        existentes = {r[0] for r in con.execute('SELECT name FROM debts')}
        for name, initial in seed['debts']:
            if name not in existentes:
                con.execute('INSERT INTO debts (name, initial) VALUES (?,?)',
                            (name, initial))
                print(f'  + deuda agregada a tu alcancía: {name}')
        con.execute("INSERT INTO config VALUES ('debts_v2','1')")
        con.commit()
    # Migración: sembrar metas una sola vez
    if not con.execute("SELECT 1 FROM config WHERE key='goals_v1'").fetchone():
        metas = [('Get developer work', 'Dec 2026', 'Pendiente', 0),
                 ('Learn Data analysis', 'Dec 2026', 'Pendiente', 0),
                 ('Learn to drive', '2027', 'Pendiente', 0),
                 ('Learn to dance', '2027', 'Pendiente', 0),
                 ('Salir de todas las deudas', 'Ene 2027', 'En proceso 🔥', 5)]
        for n, t, st, p in metas:
            con.execute('INSERT INTO goals (name, target, status, pct) VALUES (?,?,?,?)',
                        (n, t, st, p))
        con.execute("INSERT INTO config VALUES ('goals_v1','1')")
        con.commit()
    # Migración v8: episodios y estado en animes
    if not con.execute("SELECT 1 FROM config WHERE key='animes_v2'").fetchone():
        for col, tipo in [('t1', 'TEXT'), ('t2', 'TEXT'), ('t3', 'TEXT'), ('t4', 'TEXT'),
                          ('t5', 'TEXT'), ('peliculas', 'TEXT'), ('ovas', 'TEXT'),
                          ('especiales', 'TEXT'), ('estado', 'TEXT')]:
            try:
                con.execute(f"ALTER TABLE animes ADD COLUMN {col} {tipo} DEFAULT ''")
            except sqlite3.OperationalError:
                pass
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            seed = json.load(f)
        for a in seed['animes']:
            con.execute('''UPDATE animes SET t1=?, t2=?, t3=?, t4=?, t5=?,
                           peliculas=?, ovas=?, especiales=? WHERE name=?''',
                        (a['t1'], a['t2'], a['t3'], a['t4'], a['t5'],
                         a['peliculas'], a['ovas'], a['especiales'], a['name']))
        con.execute("INSERT INTO config VALUES ('animes_v2','1')")
        con.commit()
        print('  + episodios cargados en tu lista de anime')
    if not con.execute("SELECT 1 FROM config WHERE key='animes_v3'").fetchone():
        for col in ('v_t1','v_t2','v_t3','v_t4','v_t5','v_peliculas','v_ovas','v_especiales'):
            try:
                con.execute(f"ALTER TABLE animes ADD COLUMN {col} INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass
        con.execute("INSERT INTO config VALUES ('animes_v3','1')")
        con.commit()
        print('  + seguimiento de progreso por temporada activado')
    if not con.execute("SELECT 1 FROM config WHERE key='animes_v4'").fetchone():
        for col, tipo in [('t6','TEXT'),('t7','TEXT'),('v_t6','INTEGER'),('v_t7','INTEGER')]:
            try:
                con.execute(f"ALTER TABLE animes ADD COLUMN {col} {tipo} DEFAULT {'0' if tipo=='INTEGER' else chr(39)+chr(39)}")
            except sqlite3.OperationalError:
                pass
        con.execute("INSERT INTO config VALUES ('animes_v4','1')")
        con.commit()
        print('  + temporadas 6 y 7 disponibles')
    # Migración v8: skincare desglosado, laptop en piezas, marca de comprado
    if not con.execute("SELECT 1 FROM config WHERE key='dreams_v2'").fetchone():
        try:
            con.execute("ALTER TABLE dreams ADD COLUMN bought INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            seed = json.load(f)
        for nombre in seed.get('dreams_quitar', []):
            con.execute('DELETE FROM dreams WHERE name=?', (nombre,))
        for cat, nom, val in seed.get('dreams_nuevos', []):
            if not con.execute('SELECT 1 FROM dreams WHERE name=?', (nom,)).fetchone():
                con.execute('INSERT INTO dreams (category, name, value) VALUES (?,?,?)',
                            (cat, nom, val))
        con.execute("INSERT INTO config VALUES ('dreams_v2','1')")
        con.commit()
        print('  + skincare desglosado y laptop en piezas en tus sueños')
    if not con.execute("SELECT 1 FROM config WHERE key='life_v1'").fetchone():
        # perfil inicial de Kevin (editable luego en la pestaña Life)
        perfil = {'ingles_nivel': 'A1-A2', 'horas_dia': '3-4',
                  'data_curso': 'Google Data Analytics (Coursera)', 'data_pct': '14',
                  'foco2': 'Data',
                  'data_step': '0', 'ciber_curso': '', 'ciber_pct': '0', 'ciber_step': '0'}
        for k, v in perfil.items():
            con.execute('INSERT OR IGNORE INTO study_profile VALUES (?,?)', (k, v))
        # turnos por defecto (0=lunes..6=domingo)
        defaults = {0: '9-18', 1: '9-18', 2: '9-18', 3: '9-18', 4: '9-18',
                    5: 'libre', 6: 'descanso'}
        for wd, sh in defaults.items():
            con.execute('INSERT OR IGNORE INTO week_shifts VALUES (?,?)', (wd, sh))
        con.execute("INSERT INTO config VALUES ('life_v1','1')")
        con.commit()
        print('  + pestaña Life (rutina inteligente) activada')
    if not con.execute("SELECT 1 FROM config WHERE key='routine_habit_v1'").fetchone():
        try:
            con.execute("ALTER TABLE routine_extra ADD COLUMN habit TEXT DEFAULT ''")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('routine_habit_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='routine_day_v1'").fetchone():
        try:
            con.execute("ALTER TABLE routine_extra ADD COLUMN day TEXT DEFAULT ''")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('routine_day_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='careers_v1'").fetchone():
        con.execute("INSERT INTO careers (name, icon, step, course, pct, active) VALUES (?,?,?,?,?,?)",
                    ('Data Analytics', '📊', 0, 'Google Data Analytics (Coursera)', 14, 1))
        con.execute("INSERT INTO careers (name, icon, step, course, pct, active) VALUES (?,?,?,?,?,?)",
                    ('Cybersecurity', '🛡', 0, '', 0, 0))
        con.execute("INSERT INTO config VALUES ('careers_v1','1')")
        con.commit()
        print('  + carreras personalizables activadas')
    if not con.execute("SELECT 1 FROM config WHERE key='networth_v1'").fetchone():
        con.execute("INSERT INTO assets (name, value) VALUES (?,?)", ('Company fund savings', 0))
        con.execute("INSERT OR IGNORE INTO config VALUES ('networth_v1','1')")
        con.commit()
        print('  + net worth y diario activados')
    if not con.execute("SELECT 1 FROM config WHERE key='abono_nota_v1'").fetchone():
        try:
            con.execute("ALTER TABLE abonos ADD COLUMN nota TEXT DEFAULT ''")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('abono_nota_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='consolidar_estiven_v1'").fetchone():
        try:
            # buscar el Estiven del plan (tabla debts)
            estiven_plan = con.execute(
                "SELECT id FROM debts WHERE LOWER(name) LIKE 'estiven%' OR LOWER(name) LIKE 'stiven%' ORDER BY id LIMIT 1").fetchone()
            if estiven_plan:
                pid = dict(estiven_plan)['id']
                # sumar las extra_debts llamadas estiven/stiven
                extras = con.execute(
                    "SELECT id, total FROM extra_debts WHERE LOWER(name) LIKE 'estiven%' OR LOWER(name) LIKE 'stiven%'").fetchall()
                suma = sum(dict(x)['total'] for x in extras)
                if suma > 0:
                    con.execute("UPDATE debts SET initial = initial + ? WHERE id=?", (suma, pid))
                    for x in extras:
                        xid = dict(x)['id']
                        con.execute("DELETE FROM abonos WHERE nota=? OR nota LIKE ?",
                                    (f'extra:{xid}', f'extracheck:{xid}:%'))
                        con.execute("DELETE FROM extra_debts WHERE id=?", (xid,))
                    print(f'  + Estiven consolidado: +{suma} sumado al del plan')
        except Exception as e:
            print('  (aviso) no se pudo consolidar Estiven:', e)
        con.execute("INSERT OR IGNORE INTO config VALUES ('consolidar_estiven_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='extra_due_v1'").fetchone():
        try:
            con.execute("ALTER TABLE extra_debts ADD COLUMN due_date TEXT DEFAULT ''")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('extra_due_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='piggy_goal_v1'").fetchone():
        try:
            con.execute("ALTER TABLE piggy ADD COLUMN goal INTEGER DEFAULT 0")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('piggy_goal_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='tech_typo_v1'").fetchone():
        try:
            con.execute("UPDATE dreams SET category='Technology' WHERE category='Tecnology'")
            print('  + categoría "Tecnology" corregida a "Technology"')
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('tech_typo_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='eat_clean_v1'").fetchone():
        try:
            con.execute("UPDATE habits SET name='Eat clean (no junk food)' WHERE name='Healthy eating'")
            print('  + hábito "Healthy eating" -> "Eat clean (no junk food)"')
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('eat_clean_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='career_bank_v1'").fetchone():
        try:
            con.execute("ALTER TABLE careers ADD COLUMN bank INTEGER DEFAULT 0")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('career_bank_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='career_goal_link_v1'").fetchone():
        try:
            con.execute("ALTER TABLE careers ADD COLUMN goal_id INTEGER DEFAULT NULL")
        except Exception:
            pass
        try:
            # enlazar retroactivamente carreras existentes con su meta correspondiente
            # (por nombre "Learn X" o palabras clave), solo si hay una coincidencia única y clara
            careers_rows = [dict(r) for r in con.execute('SELECT * FROM careers').fetchall()]
            goals_rows = [dict(r) for r in con.execute('SELECT * FROM goals').fetchall()]
            for car in careers_rows:
                if car.get('goal_id'):
                    continue
                name_l = (car['name'] or '').lower()
                candidates = [g for g in goals_rows if
                              ('learn ' + name_l) in (g['name'] or '').lower()
                              or name_l in (g['name'] or '').lower()
                              or (re.search(r'ingl|english', name_l) and re.search(r'ingl|english', (g['name'] or '').lower()))
                              or (re.search(r'data|anal[íi]tic|datos', name_l) and re.search(r'data|anal[íi]tic|datos', (g['name'] or '').lower()))
                              or (re.search(r'ciber|cyber|security', name_l) and re.search(r'ciber|cyber|security', (g['name'] or '').lower()))]
                if len(candidates) == 1:
                    con.execute('UPDATE careers SET goal_id=? WHERE id=?', (candidates[0]['id'], car['id']))
                    print(f"  + carrera \"{car['name']}\" enlazada a meta \"{candidates[0]['name']}\"")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('career_goal_link_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='gym_baseline_v1'").fetchone():
        try:
            row = con.execute("SELECT value FROM study_profile WHERE key='gym_data'").fetchone()
            g = json.loads(dict(row)['value']) if row else {}
            if not g.get('baseline'):
                g['baseline'] = {'date': g.get('start') or date.today().isoformat(),
                                  'weight': 77, 'waist': 92, 'chest': 100, 'arm': 32, 'hip': 96, 'thigh': 49}
                if not g.get('start'):
                    g['start'] = g['baseline']['date']
                con.execute("INSERT OR REPLACE INTO study_profile VALUES ('gym_data', ?)", (json.dumps(g),))
                print('  + medidas iniciales de gym registradas como punto de partida')
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('gym_baseline_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='detalle_abonado_fijo_v1'").fetchone():
        try:
            con.execute("ALTER TABLE detalle_items ADD COLUMN abonado_fijo INTEGER DEFAULT 0")
        except Exception:
            pass   # ya existe (BD nueva creada con la columna): sin problema
        con.execute("INSERT OR IGNORE INTO config VALUES ('detalle_abonado_fijo_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='shopping_history_v1'").fetchone():
        for col, decl in (('bought_at', "TEXT DEFAULT ''"), ('cost', 'INTEGER DEFAULT 0'), ('method', "TEXT DEFAULT ''")):
            try:
                con.execute(f"ALTER TABLE shopping ADD COLUMN {col} {decl}")
            except Exception:
                pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('shopping_history_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='routine_scheduled_v1'").fetchone():
        try:
            con.execute("ALTER TABLE routine_extra ADD COLUMN scheduled INTEGER DEFAULT 0")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('routine_scheduled_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='abono_parcial_v1'").fetchone():
        for tabla in ('compras', 'extra_debts'):
            try:
                con.execute(f"ALTER TABLE {tabla} ADD COLUMN abonado INTEGER DEFAULT 0")
            except Exception:
                pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('abono_parcial_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='detalle_start_v1'").fetchone():
        try:
            con.execute("ALTER TABLE detalle_items ADD COLUMN start_month INTEGER DEFAULT -1")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('detalle_start_v1','1')")
        con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='books_read_year_v1'").fetchone():
        try:
            con.execute("ALTER TABLE books ADD COLUMN read_year INTEGER DEFAULT 0")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('books_read_year_v1','1')")
        con.commit()
        print('  + seguimiento anual de libros activado')

    # ── FIX abonos viejos "atrapados": cuando abonado_fijo cubre cuotas completas pero
    #    'pagadas' no avanzó (bug anterior). Convierte esos abonos en cuotas pagadas y crea
    #    el abono al jefe, para que salgan pagados y le peguen al boss. Idempotente por clave. ──
    if not con.execute("SELECT 1 FROM config WHERE key='detalle_abono_migra_v1'").fetchone():
        GRUPO_TO_DEBT = {'Tarjeta DV': 'Tarjeta DV — Jefe Final'}
        for it in con.execute("SELECT * FROM detalle_items WHERE abonado_fijo>0 AND total>0 AND cuota>0").fetchall():
            it = dict(it)
            cuota = it['cuota']; total = it['total']; pagadas = it['pagadas'] or 0
            abon = it['abonado_fijo'] or 0
            if cuota <= 0:
                continue
            cuotasCubiertas = min(abon // cuota, total - pagadas)
            if cuotasCubiertas >= 1:
                sobrante = abon - cuotasCubiertas * cuota
                nuevasPagadas = pagadas + cuotasCubiertas
                if nuevasPagadas >= total:
                    con.execute("UPDATE detalle_items SET pagadas=?, abonado_fijo=0 WHERE id=?", (total, it['id']))
                else:
                    con.execute("UPDATE detalle_items SET pagadas=?, abonado_fijo=? WHERE id=?",
                                (nuevasPagadas, sobrante, it['id']))
                # abono al jefe por lo que cubrió cuotas (para el boss/historial), si no existía ya
                jefe_name = GRUPO_TO_DEBT.get(it['grupo'], it['grupo'])
                jefe = con.execute("SELECT id FROM debts WHERE name=?", (jefe_name,)).fetchone()
                if jefe:
                    jid = dict(jefe)['id']
                    ya = con.execute("SELECT 1 FROM abonos WHERE nota=?", (f"detalle:{it['id']}",)).fetchone()
                    if not ya:
                        con.execute("INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)",
                                    (jid, date.today().isoformat(), cuotasCubiertas * cuota, f"detalle:{it['id']}"))
        con.execute("INSERT OR IGNORE INTO config VALUES ('detalle_abono_migra_v1','1')")
        con.commit()
        print('  + abonos parciales viejos convertidos a cuotas pagadas')
    # ════════════════════════════════════════════════════════════════
    # ARQUITECTURA v2: Single Source of Truth (debts_v2 + payments)
    # Estas tablas conviven con las viejas durante la transición (Fase 1).
    # NO se borra nada viejo aquí: solo se CONSTRUYE el modelo nuevo en paralelo.
    # ════════════════════════════════════════════════════════════════
    con.execute('''CREATE TABLE IF NOT EXISTS debts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT, grupo TEXT, tipo TEXT DEFAULT 'cuotas',
        valor_total INTEGER DEFAULT 0, num_cuotas INTEGER DEFAULT 0,
        cuota INTEGER DEFAULT 0, mes_inicio INTEGER DEFAULT -1,
        nomina INTEGER DEFAULT 0, activa INTEGER DEFAULT 1,
        origen TEXT DEFAULT '', origen_id INTEGER DEFAULT 0)''')
    con.execute('''CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debt_id INTEGER, mes TEXT DEFAULT '', monto INTEGER DEFAULT 0,
        tipo TEXT DEFAULT 'cuota', fecha TEXT DEFAULT '', nota TEXT DEFAULT '',
        FOREIGN KEY(debt_id) REFERENCES debts_v2(id))''')
    con.commit()
    if not con.execute("SELECT 1 FROM config WHERE key='detalle_v1'").fetchone():
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            _sd = json.load(f)
        orden = 0
        for grupo, items in _sd.get('detalle', {}).items():
            for it in items:
                nombre = it[0]
                cuota = it[1] if len(it) > 1 and it[1] is not None else 0
                pagadas = it[2] if len(it) > 2 and it[2] is not None else 0
                total = it[3] if len(it) > 3 and it[3] is not None else 0
                fijo = it[4] if len(it) > 4 and it[4] is not None else 0
                con.execute('''INSERT INTO detalle_items (grupo, nombre, cuota, pagadas, total, fijo, orden)
                               VALUES (?,?,?,?,?,?,?)''',
                            (grupo, nombre, cuota, pagadas, total, fijo, orden))
                orden += 1
        con.execute("INSERT OR IGNORE INTO config VALUES ('detalle_v1','1')")
        con.commit()
        print('  + desglose de deudas migrado a tabla editable')
    if not con.execute("SELECT 1 FROM config WHERE key='shopping_v1'").fetchone():
        items = [
            ('Eye drops', 1), ('Cloe (my cat) 🐱', 3), ('Black pants', 1),
            ('Gym clothes', 1), ('Deodorant', 1), ('Clean the mirror', 1),
        ]
        for nm, sl in items:
            con.execute('INSERT INTO shopping (name, slots, done, created) VALUES (?,?,?,?)',
                        (nm, sl, 0, date.today().isoformat()))
        con.execute("INSERT OR IGNORE INTO config VALUES ('shopping_v1','1')")
        con.commit()
        print('  + lista de compras activada')
    if not con.execute("SELECT 1 FROM config WHERE key='fund_v1'").fetchone():
        fondo = [
            ('Ahorros permanentes', 36000, 'Monthly', '2026-05-30', 320198),
            ('Aportes sociales', 144000, 'Monthly', '2026-05-30', 1218960),
            ('Revalorización aportes', 0, '', '2026-04-30', 510),
        ]
        for f in fondo:
            con.execute('INSERT INTO fund (name, quota, frequency, last_deposit, saved) VALUES (?,?,?,?,?)', f)
        con.execute("INSERT OR IGNORE INTO config VALUES ('fund_v1','1')")
        con.commit()
        print('  + fondo de empresa activado')
    if not con.execute("SELECT 1 FROM config WHERE key='services_v1'").fetchone():
        with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as f:
            seed = json.load(f)
        for s in seed.get('servicios', []):
            nombre = s[0]
            monto = s[1] if len(s) > 1 else 0
            metodo = s[2] if len(s) > 2 and s[2] not in ('—', '', None) else 'Efectivo'
            payday = s[3] if len(s) > 3 else ''
            con.execute('INSERT INTO services (name, amount, method, payday) VALUES (?,?,?,?)',
                        (nombre, monto, metodo, payday))
        con.execute("INSERT OR IGNORE INTO config VALUES ('services_v1','1')")
        con.commit()
        print('  + servicios editables activados')
    # ── CONSOLIDACIÓN v2 (al final: todas las tablas viejas ya están pobladas) ──
    # Reconstruye debts_v2 + payments desde las 5 fuentes viejas, preservando exacto.
    # Idempotente: se re-ejecuta cada arranque durante la transición (Fase 1-2).
    _consolidar_v2(con)
    con.commit()
    print('  + modelo financiero v2 consolidado (Single Source of Truth)')
    # Postgres: resincronizar contadores SERIAL para que los INSERT nuevos no choquen
    if db_layer.IS_PG and hasattr(con, 'fix_sequences'):
        con.fix_sequences()
    con.close()


# Datos de referencia (servicios con fechas y desglose de deudas)
with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as _f:
    _SEED = json.load(_f)
SERVICIOS = _SEED.get('servicios', [])
DETALLE = _SEED.get('detalle', {})


def _detalle_actual(d):
    """Reconstruye el desglose desde la tabla editable, con el formato
    [nombre,cuota,pagadas,total,fijo,id,abonado_fijo,start_month]."""
    out = {}
    rows = d.execute('SELECT * FROM detalle_items ORDER BY orden, id').fetchall()
    for r in rows:
        r = dict(r)
        out.setdefault(r['grupo'], []).append(
            [r['nombre'], r['cuota'],
             r['pagadas'] if r['total'] else None,
             r['total'] if r['total'] else None,
             r['fijo'], r['id'], r.get('abonado_fijo', 0) or 0,
             r.get('start_month', -1) if r.get('start_month') is not None else -1])
    return out


# ---------------------- API ----------------------

@app.get('/')
def index():
    return render_template('index.html', version=VERSION)


def _sync_metas_carreras(d):
    """Sincroniza el % de cada meta de Goals con el progreso de su carrera.
    Prioriza el enlace explícito (careers.goal_id); si no existe, lo busca por
    palabras clave y lo deja enlazado para la próxima vez (sin ambigüedad futura).
    Blindada: si algo falla, no tumba la app."""
    try:
        import re as _re
        stop = {'learn', 'get', 'to', 'the', 'a', 'my', 'of', 'and', 'analytics', 'analysis'}
        def keys(name):
            name = (name or '').lower()
            ws = set(w for w in _re.sub(r'[^a-záéíóúñ ]', ' ', name).split() if w and w not in stop)
            if _re.search(r'data|anal[íi]t|analy', name): ws.add('data')
            if _re.search(r'cyber|ciber|secur', name): ws.add('cyber')
            if _re.search(r'ingl|english', name): ws.add('english')
            return ws
        careers = [dict(r) for r in d.execute('SELECT * FROM careers').fetchall()]
        goals = [dict(r) for r in d.execute('SELECT * FROM goals').fetchall()]
        for c in careers:
            # progreso real: lo banqueado (nunca baja) o nivel+curso actual, el que sea mayor
            prog = min(round(max((c.get('bank') or 0),
                                  (c.get('step') or 0) * 25 + ((c.get('pct') or 0) / 100) * 25)), 100)
            best = None
            if c.get('goal_id'):
                best = next((g for g in goals if g['id'] == c['goal_id']), None)
            if not best:
                ck = keys(c.get('name'))
                bestscore = 0
                for g in goals:
                    score = len(ck & keys(g.get('name')))
                    if score > bestscore:
                        bestscore = score; best = g
                if best and bestscore > 0:
                    d.execute('UPDATE careers SET goal_id=? WHERE id=?', (best['id'], c['id']))
            if not best:
                continue
            if (best.get('pct') or 0) != prog:
                d.execute('UPDATE goals SET pct=? WHERE id=?', (prog, best['id']))
                estado = best.get('status')
                if prog >= 100 and estado != 'Lograda 🏆':
                    d.execute("UPDATE goals SET status=? WHERE id=?", ('Lograda 🏆', best['id']))
                elif prog > 0 and estado == 'Pendiente':
                    d.execute("UPDATE goals SET status=? WHERE id=?", ('En proceso 🔥', best['id']))
        d.commit()
    except Exception as e:
        print('  (aviso) no se pudo sincronizar metas-carreras:', e)
        try:
            d.rollback()
        except Exception:
            pass


def _sync_carrera_ingles(d):
    """La carrera 'Inglés' sube sola según los días con bloque de inglés completado.
    ~30 días = 1 peldaño (25%). Blindada: si algo falla, no tumba la app."""
    try:
        eng = d.execute("SELECT * FROM careers WHERE LOWER(name) LIKE '%ingl%' OR LOWER(name) LIKE '%english%'").fetchone()
        if not eng:
            return
        eng = dict(eng)
        dias = len(set(r['day'] for r in d.execute(
            "SELECT day FROM routine_done WHERE activity='ingles'").fetchall()))
        DPP = 30
        step = min(dias // DPP, 4)
        pct = round(((dias % DPP) / DPP) * 100) if step < 4 else 0
        if eng.get('step') != step or (eng.get('pct') or 0) != pct:
            d.execute('UPDATE careers SET step=?, pct=? WHERE id=?', (step, pct, eng['id']))
            d.commit()
    except Exception as e:
        print('  (aviso) no se pudo sincronizar carrera inglés:', e)
        try:
            d.rollback()
        except Exception:
            pass


def _aplicar_aportes_fondo(d):
    """Suma automáticamente el aporte mensual de cada concepto del fondo de empresa.
    El aporte cae el día 30. Si han pasado uno o más días 30 desde el último depósito
    registrado, suma la cuota por cada mes pendiente y actualiza la fecha."""
    try:
        from datetime import date as _date
        hoy = _date.today()
        for f in d.execute('SELECT * FROM fund').fetchall():
            f = dict(f)
            quota = f.get('quota') or 0
            if quota <= 0 or (f.get('frequency') or '').lower() not in ('monthly', 'mensual'):
                continue
            last = f.get('last_deposit') or ''
            try:
                y, m, dd = [int(x) for x in last.split('-')]
                last_d = _date(y, m, dd)
            except Exception:
                continue
            # contar cuántos "día 30" han pasado entre last_d y hoy
            meses = 0
            cur_y, cur_m = last_d.year, last_d.month
            while True:
                # siguiente fecha de aporte: el día 28-30 del mes siguiente al último
                cur_m += 1
                if cur_m > 12:
                    cur_m = 1; cur_y += 1
                import calendar
                diap = min(30, calendar.monthrange(cur_y, cur_m)[1])
                prox = _date(cur_y, cur_m, diap)
                if prox <= hoy:
                    meses += 1
                else:
                    break
                if meses > 60:
                    break
            if meses > 0:
                nuevo_saved = (f.get('saved') or 0) + quota * meses
                import calendar
                diap = min(30, calendar.monthrange(cur_y if cur_m != 1 else cur_y, cur_m)[1])
                # fecha del último aporte aplicado
                ly, lm = last_d.year, last_d.month
                for _ in range(meses):
                    lm += 1
                    if lm > 12:
                        lm = 1; ly += 1
                ld = min(30, calendar.monthrange(ly, lm)[1])
                nueva_fecha = f"{ly:04d}-{lm:02d}-{ld:02d}"
                d.execute('UPDATE fund SET saved=?, last_deposit=? WHERE id=?',
                          (nuevo_saved, nueva_fecha, f['id']))
        d.commit()



    except Exception as e:
        print('  (aviso) no se pudo aplicar aportes del fondo:', e)
        try:
            d.rollback()
        except Exception:
            pass

@app.get('/api/v2check')
def v2check():
    """DIAGNÓSTICO (no cambia nada visible): compara el motor VIEJO vs el motor v2
    sobre la base de datos REAL, para validar equivalencia antes de conmutar.
    Devuelve HTML legible en el navegador: /api/v2check"""
    d = db()
    CRED_TO_DEBT = {'Tarjeta DV': 'Tarjeta DV — Jefe Final', 'Joseph (cuota)': 'Joseph'}

    # ── SALDO VIEJO por grupo (como lo calcula renderDesglose en app.js) ──
    def saldo_viejo_grupo(grupo):
        s = 0
        for it in d.execute("SELECT * FROM detalle_items WHERE grupo=?", (grupo,)).fetchall():
            it = dict(it)
            if (it['total'] or 0) > 0 and (it['cuota'] or 0) > 0:
                trans = it['pagadas'] or 0
                s += max(it['cuota'] * (it['total'] - trans) - (it['abonado_fijo'] or 0), 0)
            else:
                s += max((it['fijo'] or 0) - (it['abonado_fijo'] or 0), 0)
        return s

    # ── SALDO V2 por grupo (Σ por deuda de max(valor_total - pagos, 0)) ──
    def saldo_v2_grupo(grupo):
        s = 0
        for db2 in d.execute("SELECT * FROM debts_v2 WHERE grupo=?", (grupo,)).fetchall():
            db2 = dict(db2)
            r = d.execute("SELECT COALESCE(SUM(monto),0) s FROM payments WHERE debt_id=?", (db2['id'],)).fetchone()
            s += max(db2['valor_total'] - dict(r)['s'], 0)   # una deuda nunca resta por debajo de 0
        return s

    grupos = sorted(set(dict(r)['grupo'] for r in d.execute("SELECT DISTINCT grupo FROM detalle_items").fetchall()))
    filas = []
    tot_v = tot_2 = 0
    for g in grupos:
        sv = saldo_viejo_grupo(g); s2 = saldo_v2_grupo(g)
        tot_v += sv; tot_2 += s2
        ok = '✅' if sv == s2 else f'❌ dif {s2 - sv:,}'
        filas.append(f"<tr><td>{g}</td><td style='text-align:right'>${sv:,}</td>"
                     f"<td style='text-align:right'>${s2:,}</td><td>{ok}</td></tr>")

    # extra_debts (deudas registradas) — no están en detalle, se listan aparte
    extra_rows = []
    for ed in d.execute("SELECT * FROM extra_debts").fetchall():
        ed = dict(ed)
        pgv = d.execute("SELECT COALESCE(SUM(valor),0) s FROM abonos WHERE nota=? OR nota LIKE ?",
                        (f"extra:{ed['id']}", f"extracheck:{ed['id']}:%")).fetchone()
        pagado = dict(pgv)['s'] + (ed.get('abonado') or 0)
        saldo_v = max((ed['total'] or 0) - pagado, 0)
        db2 = d.execute("SELECT id FROM debts_v2 WHERE origen='extra' AND origen_id=?", (ed['id'],)).fetchone()
        s2 = 0
        if db2:
            db2 = dict(db2)
            r = d.execute("SELECT COALESCE(SUM(monto),0) s FROM payments WHERE debt_id=?", (db2['id'],)).fetchone()
            vt = d.execute("SELECT valor_total FROM debts_v2 WHERE id=?", (db2['id'],)).fetchone()
            s2 = max(dict(vt)['valor_total'] - dict(r)['s'], 0)
        tot_v += saldo_v; tot_2 += s2
        ok = '✅' if saldo_v == s2 else f'❌ dif {s2 - saldo_v:,}'
        extra_rows.append(f"<tr><td>☠ {ed['name']}</td><td style='text-align:right'>${saldo_v:,}</td>"
                          f"<td style='text-align:right'>${s2:,}</td><td>{ok}</td></tr>")

    total_ok = '✅ CUADRAN' if tot_v == tot_2 else f'❌ diferencia ${tot_2 - tot_v:,}'
    n_deudas_v2 = dict(d.execute("SELECT COUNT(*) c FROM debts_v2").fetchone())['c']
    n_pagos_v2 = dict(d.execute("SELECT COUNT(*) c FROM payments").fetchone())['c']

    # ── DRILL-DOWN: para cada grupo con ❌, mostrar sus líneas viejas y sus deudas v2 con pagos ──
    grupos_mal = [g for g in grupos if saldo_viejo_grupo(g) != saldo_v2_grupo(g)]
    drill = ''
    for g in grupos_mal:
        drill += f"<h2>🔎 {g}</h2>"
        # lado viejo: líneas del detalle
        drill += "<b style='color:#9aa;font-size:.85rem'>Detalle viejo (línea: cuota×restantes − abonado_fijo)</b><table>"
        for it in d.execute("SELECT * FROM detalle_items WHERE grupo=? ORDER BY orden,id", (g,)).fetchall():
            it = dict(it)
            if (it['total'] or 0) > 0 and (it['cuota'] or 0) > 0:
                trans = it['pagadas'] or 0
                sv_l = max(it['cuota'] * (it['total'] - trans) - (it['abonado_fijo'] or 0), 0)
                desc = f"cuota ${it['cuota']:,} × ({it['total']}−{trans} pagadas) − abonado ${it['abonado_fijo'] or 0:,}"
            else:
                sv_l = max((it['fijo'] or 0) - (it['abonado_fijo'] or 0), 0)
                desc = f"fijo ${it['fijo'] or 0:,} − abonado ${it['abonado_fijo'] or 0:,}"
            drill += f"<tr><td>{it['nombre']}</td><td style='color:#9aa;font-size:.8rem'>{desc}</td><td style='text-align:right'>${sv_l:,}</td></tr>"
        drill += "</table>"
        # lado v2: deudas y sus pagos
        drill += "<b style='color:#9aa;font-size:.85rem'>Deudas v2 (valor_total − Σpagos)</b><table>"
        for db2 in d.execute("SELECT * FROM debts_v2 WHERE grupo=? ORDER BY id", (g,)).fetchall():
            db2 = dict(db2)
            pagos = [dict(p) for p in d.execute("SELECT monto,tipo,nota FROM payments WHERE debt_id=?", (db2['id'],)).fetchall()]
            sp = sum(p['monto'] for p in pagos)
            sv_l = db2['valor_total'] - sp
            pgtxt = ' + '.join(f"${p['monto']:,}({p['tipo']}/{p['nota']})" for p in pagos) or '—'
            drill += (f"<tr><td>{db2['nombre']}<br><span style='color:#9aa;font-size:.75rem'>{db2['origen']} · pagos: {pgtxt}</span></td>"
                      f"<td style='text-align:right'>${sv_l:,}</td></tr>")
        drill += "</table>"

    html = f"""<!doctype html><html><head><meta charset=utf-8>
    <title>v2 check</title><style>
    body{{font-family:system-ui;background:#0f1115;color:#e6e6e6;padding:24px;max-width:820px;margin:auto}}
    table{{width:100%;border-collapse:collapse;margin:10px 0}}
    td,th{{padding:7px 9px;border-bottom:1px solid #262a33;vertical-align:top}}
    th{{text-align:left;color:#9aa}}
    h1{{font-size:1.3rem}} h2{{font-size:1rem;color:#cbd;margin-top:22px}}
    .big{{font-size:1.15rem;font-weight:800}} .ok{{color:#34d399}} .bad{{color:#f87171}}
    code{{background:#1a1d24;padding:2px 6px;border-radius:5px}}
    </style></head><body>
    <h1>🔍 Diagnóstico motor v2 vs viejo</h1>
    <p>Comparación sobre <b>tu base de datos real</b>. Si todo sale ✅, el motor nuevo
    deriva exactamente los mismos saldos que ves hoy.</p>
    <p>Modelo v2: <code>{n_deudas_v2}</code> deudas · <code>{n_pagos_v2}</code> pagos registrados.</p>
    <h2>Saldo por grupo (desglose)</h2>
    <table><tr><th>Grupo</th><th style='text-align:right'>Viejo</th>
    <th style='text-align:right'>v2</th><th>¿Igual?</th></tr>
    {''.join(filas)}
    {('<tr><td colspan=4 style="color:#9aa;padding-top:14px">Deudas registradas</td></tr>' + ''.join(extra_rows)) if extra_rows else ''}
    </table>
    <h2>Total</h2>
    <p class=big>Viejo: <b>${tot_v:,}</b> &nbsp;·&nbsp; v2: <b>${tot_2:,}</b></p>
    <p class="big {'ok' if tot_v==tot_2 else 'bad'}">{total_ok}</p>
    {('<hr style="border-color:#262a33;margin:24px 0"><h1>Detalle de los grupos que NO cuadran</h1>' + drill) if drill else ''}
    <p style='color:#9aa;font-size:.85rem;margin-top:20px'>Este endpoint es solo lectura y no modifica nada.
    El sistema que usas sigue siendo el viejo; v2 corre en paralelo.</p>
    </body></html>"""
    return html


@app.get('/api/state')
def state():
    d = db()
    month = request.args.get('month', date.today().strftime('%Y-%m'))
    plan = json.loads(d.execute(
        "SELECT value FROM config WHERE key='plan'").fetchone()['value'])
    debts = [dict(r) for r in d.execute(
        '''SELECT de.id, de.name, de.initial,
                  COALESCE(SUM(a.valor),0) AS abonado
           FROM debts de LEFT JOIN abonos a ON a.debt_id = de.id
           GROUP BY de.id ORDER BY de.initial DESC''')]
    # abonos a deudas principales (con debt_id) + abonos a deudas registradas (nota extra/extracheck)
    abonos_core = [dict(r) for r in d.execute(
        '''SELECT a.id, a.fecha, a.valor, de.name FROM abonos a
           JOIN debts de ON de.id = a.debt_id
           ORDER BY a.id DESC LIMIT 30''')]
    abonos_extra = []
    for r in d.execute(
        '''SELECT a.id, a.fecha, a.valor, a.nota FROM abonos a
           WHERE a.debt_id IS NULL AND a.nota != '' ORDER BY a.id DESC LIMIT 30''').fetchall():
        r = dict(r)
        # extraer el nombre según el tipo de nota
        nota = r['nota'] or ''
        nombre = '?'
        if nota.startswith('compra:'):
            # nota = compra:ID:Concepto  -> ataque a una compra a cuotas (ej. Internet)
            partes = nota.split(':', 2)
            nombre = partes[2] if len(partes) > 2 else 'Compra'
        else:
            ed_id = None
            if nota.startswith('extra:'):
                ed_id = nota.split(':')[1]
            elif nota.startswith('extracheck:'):
                ed_id = nota.split(':')[1]
            if ed_id:
                row = d.execute('SELECT name FROM extra_debts WHERE id=?', (int(ed_id),)).fetchone()
                if row:
                    nombre = dict(row)['name']
        abonos_extra.append({'id': r['id'], 'fecha': r['fecha'], 'valor': r['valor'], 'name': nombre})
    abonos = sorted(abonos_core + abonos_extra, key=lambda a: a['id'], reverse=True)[:30]
    habits = [dict(r) for r in d.execute('SELECT * FROM habits')]
    gym_sets = [dict(r) for r in d.execute('SELECT * FROM gym_sets ORDER BY date, id')]
    marks = [f"{r['habit_id']}|{r['day']}" for r in d.execute(
        "SELECT habit_id, day FROM habit_marks WHERE day LIKE ?", (month + '%',))]
    history = [dict(r) for r in d.execute(
        'SELECT * FROM months_history ORDER BY label')]
    dreams = [dict(r) for r in d.execute(
        'SELECT * FROM dreams ORDER BY value DESC')]
    animes = [dict(r) for r in d.execute(
        'SELECT * FROM animes ORDER BY score DESC NULLS LAST, name')]
    books = [dict(r) for r in d.execute('SELECT * FROM books')]
    compras = [dict(r) for r in d.execute('SELECT * FROM compras ORDER BY id DESC')]
    _sync_carrera_ingles(d)
    _sync_metas_carreras(d)
    goals = [dict(r) for r in d.execute('SELECT * FROM goals')]
    shifts = {r['weekday']: r['shift'] for r in d.execute('SELECT * FROM week_shifts')}
    profile = {r['key']: r['value'] for r in d.execute('SELECT * FROM study_profile')}
    rdone = [f"{r['day']}|{r['activity']}" for r in d.execute('SELECT day, activity FROM routine_done')]
    careers = [dict(r) for r in d.execute('SELECT * FROM careers')]
    courses_done = [dict(r) for r in d.execute('SELECT * FROM courses_done ORDER BY id DESC')]
    routine_extra = [dict(r) for r in d.execute('SELECT * FROM routine_extra')]
    routine_hidden = [f"{r['weekday']}|{r['akey']}" for r in d.execute('SELECT weekday, akey FROM routine_hidden')]
    routine_hidden_day = [f"{r['day']}|{r['akey']}" for r in d.execute('SELECT day, akey FROM routine_hidden_day')]
    journal = [dict(r) for r in d.execute('SELECT * FROM journal ORDER BY day DESC, id DESC')]
    assets = [dict(r) for r in d.execute('SELECT * FROM assets')]
    expenses = [dict(r) for r in d.execute('SELECT * FROM expenses ORDER BY id DESC')]
    month_income = {r['month']: r['income'] for r in d.execute('SELECT * FROM month_income')}
    services = [dict(r) for r in d.execute('SELECT * FROM services ORDER BY id')]
    _aplicar_aportes_fondo(d)
    fund = [dict(r) for r in d.execute('SELECT * FROM fund ORDER BY id')]
    piggy = [dict(r) for r in d.execute('SELECT * FROM piggy ORDER BY id')]
    piggy_moves = [dict(r) for r in d.execute('SELECT * FROM piggy_moves ORDER BY id DESC')]
    shopping = [dict(r) for r in d.execute('SELECT * FROM shopping ORDER BY done, id')]
    todos = [dict(r) for r in d.execute('SELECT * FROM todos ORDER BY done, id DESC')]
    extra_debts = [dict(r) for r in d.execute('SELECT * FROM extra_debts')]
    # 'abonado' de una deuda registrada = abono guardado en su columna (checks nuevos + abonos parciales)
    #  MÁS abonos históricos registrados en la tabla 'abonos' (compatibilidad con datos viejos).
    for ed in extra_debts:
        row = d.execute(
            "SELECT COALESCE(SUM(valor),0) AS ab FROM abonos WHERE nota=? OR nota LIKE ?",
            (f"extra:{ed['id']}", f"extracheck:{ed['id']}:%")).fetchone()
        historicos = dict(row)['ab'] if row else 0
        ed['abonado'] = (ed.get('abonado') or 0) + historicos
    core = [x[0] for x in _SEED['debts']]
    return jsonify(dict(version=VERSION, core_debts=core, compras=compras, goals=goals, extra_debts=extra_debts, shifts=shifts, profile=profile, rdone=rdone, careers=careers, courses_done=courses_done, routine_extra=routine_extra, routine_hidden=routine_hidden, routine_hidden_day=routine_hidden_day, journal=journal, assets=assets, expenses=expenses, month_income=month_income, plan=plan, debts=debts, abonos=abonos, habits=habits,
                        marks=marks, history=history, dreams=dreams,
                        animes=animes, books=books, gym_sets=gym_sets,
                        servicios=services, fund=fund, piggy=piggy, piggy_moves=piggy_moves, shopping=shopping, todos=todos, detalle=_detalle_actual(d),
                        checks=[f"{r['item']}|{r['month']}" for r in d.execute(
                            'SELECT item, month FROM payment_checks')],
                        today=date.today().isoformat()))


@app.post('/api/abono')
def abono():
    j = request.json or {}
    valor = to_int(j.get('valor'))
    if valor <= 0:
        return jsonify(error='El abono debe ser mayor a cero'), 400
    extra_id = j.get('extra_id')
    with transaction() as con:
        if extra_id is not None:
            try:
                extra_id = int(extra_id)
            except (TypeError, ValueError):
                return jsonify(error='Deuda inválida'), 400
            deuda = con.execute('SELECT total, abonado FROM extra_debts WHERE id=?', (extra_id,)).fetchone()
            if not deuda:
                return jsonify(error='La deuda ya no existe'), 404
            deuda = dict(deuda)
            saldo = max((deuda.get('total') or 0) - (deuda.get('abonado') or 0), 0)
            valor = min(valor, saldo)
            if valor <= 0:
                return jsonify(error='La deuda ya está pagada'), 409
            con.execute('INSERT INTO abonos (fecha, debt_id, valor, nota) VALUES (?,?,?,?)',
                        (j.get('fecha', date.today().isoformat()), None, valor, f'extra:{extra_id}'))
        else:
            try:
                debt_id = int(j.get('debt_id'))
            except (TypeError, ValueError):
                return jsonify(error='Deuda inválida'), 400
            deuda = con.execute('SELECT initial FROM debts WHERE id=?', (debt_id,)).fetchone()
            if not deuda:
                return jsonify(error='La deuda ya no existe'), 404
            pagado = con.execute('SELECT COALESCE(SUM(valor),0) AS s FROM abonos WHERE debt_id=?',
                                 (debt_id,)).fetchone()
            saldo = max((dict(deuda)['initial'] or 0) - (dict(pagado)['s'] or 0), 0)
            valor = min(valor, saldo)
            if valor <= 0:
                return jsonify(error='La deuda ya está pagada'), 409
            con.execute('INSERT INTO abonos (fecha, debt_id, valor) VALUES (?,?,?)',
                        (j.get('fecha', date.today().isoformat()), debt_id, valor))
    return jsonify(ok=True, aplicado=valor)


@app.delete('/api/abono/<int:aid>')
def abono_del(aid):
    db().execute('DELETE FROM abonos WHERE id=?', (aid,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/card/pay')
def card_pay():
    """Pago realista a una tarjeta (tipo banco): un solo monto que se reparte.
    Primero liquida las compras a cuotas más antiguas de esa tarjeta (sube su 'abonado'),
    y lo que sobre se abona a la deuda base del jefe (tabla abonos). Así el pago se ve
    reflejado en TODO: panel de tarjetas, jefe, desglose y libertad."""
    j = request.json or {}
    boss = j.get('boss')            # nombre del jefe (ej. 'Codensa')
    creditor = j.get('creditor')    # nombre del creditor para compras (ej. 'Codensa')
    monto = to_int(j.get('monto'))
    if monto <= 0:
        return jsonify(error='Enter an amount greater than 0'), 400
    con = db()
    d = con.execute('SELECT * FROM debts WHERE name=?', (boss,)).fetchone()
    if not d:
        return jsonify(error='Card not found'), 404
    d = dict(d)
    restante = monto
    try:
        # 1) liquidar compras a cuotas de esta tarjeta, de la más antigua a la más nueva
        compras = [dict(r) for r in con.execute(
            'SELECT * FROM compras WHERE creditor=? ORDER BY id ASC', (creditor,)).fetchall()]
        for c in compras:
            if restante <= 0:
                break
            saldo_c = max((c['valor'] or 0) - (c.get('abonado') or 0), 0)
            if saldo_c <= 0:
                continue
            aplica = min(restante, saldo_c)
            nuevo = (c.get('abonado') or 0) + aplica
            if nuevo >= (c['valor'] or 0):
                con.execute('DELETE FROM compras WHERE id=?', (c['id'],))   # compra saldada
            else:
                con.execute('UPDATE compras SET abonado=? WHERE id=?', (nuevo, c['id']))
            restante -= aplica
        # 2) lo que sobre baja la deuda base del jefe (registrada como abono)
        if restante > 0:
            row = con.execute('SELECT COALESCE(SUM(valor),0) AS s FROM abonos WHERE debt_id=?', (d['id'],)).fetchone()
            ya_abonado = dict(row)['s'] if row else 0
            base_saldo = max((d['initial'] or 0) - ya_abonado, 0)
            aplica = min(restante, base_saldo)
            if aplica > 0:
                con.execute('INSERT INTO abonos (fecha, debt_id, valor) VALUES (?,?,?)',
                             (date.today().isoformat(), d['id'], aplica))
                restante -= aplica
        con.commit()
    except Exception:
        con.rollback()
        raise
    return jsonify(ok=True, aplicado=monto - restante, sobrante=restante)


@app.post('/api/habit')
def habit():
    j = request.json
    cur = db().execute('SELECT 1 FROM habit_marks WHERE habit_id=? AND day=?',
                       (j['habit_id'], j['day'])).fetchone()
    if cur:
        db().execute('DELETE FROM habit_marks WHERE habit_id=? AND day=?',
                     (j['habit_id'], j['day']))
    else:
        db().execute('INSERT INTO habit_marks VALUES (?,?)',
                     (j['habit_id'], j['day']))
    db().commit()
    return jsonify(ok=True, marked=not cur)


@app.post('/api/close_month')
def close_month():
    j = request.json
    db().execute('INSERT OR REPLACE INTO months_history VALUES (?,?)',
                 (j['label'], float(j['pct'])))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/dream')
def dream():
    return safe_field_update('dreams', ('saved', 'value', 'bought'),
                              ('saved', 'value', 'bought'), request.json or {}, default_field='saved')




BACKUP_TABLES = (
    'config', 'schema_migrations', 'debts', 'abonos', 'habits', 'gym_sets',
    'habit_marks', 'months_history', 'dreams', 'animes', 'books',
    'payment_checks', 'week_shifts', 'routine_done', 'study_profile',
    'careers', 'courses_done', 'routine_extra', 'routine_hidden',
    'routine_hidden_day', 'journal', 'assets', 'expenses', 'month_income',
    'services', 'fund', 'piggy', 'piggy_moves', 'shopping', 'todos',
    'detalle_items', 'extra_debts', 'goals', 'compras', 'debts_v2', 'payments'
)


@app.get('/api/backup')
def download_backup():
    """Exportación portable y de solo lectura; funciona con SQLite y PostgreSQL."""
    con = db()
    tables = {}
    counts = {}
    for table in BACKUP_TABLES:
        try:
            rows = [dict(r) for r in con.execute(f'SELECT * FROM {table}').fetchall()]
        except Exception as exc:
            logger.warning('Backup: no se pudo leer %s: %s', table, exc)
            continue
        tables[table] = rows
        counts[table] = len(rows)
    warnings = []
    required = {'config', 'debts', 'books', 'habits', 'goals'}
    missing = sorted(required - set(tables))
    if missing:
        warnings.append('Missing required tables: ' + ', '.join(missing))
    if counts.get('config', 0) == 0:
        warnings.append('The config table is empty')
    if counts.get('books', 0) and any(
        int(row.get('read_year') or 0) > date.today().year for row in tables.get('books', [])
    ):
        warnings.append('Some books contain a future read_year')

    canonical = json.dumps(
        tables, ensure_ascii=False, sort_keys=True, separators=(',', ':')
    ).encode('utf-8')
    payload = {
        'format': 'kevin-lifeos-backup-v2',
        'app_version': VERSION,
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'database': 'postgresql' if db_layer.IS_PG else 'sqlite',
        'table_count': len(tables),
        'counts': counts,
        'warnings': warnings,
        'data_sha256': hashlib.sha256(canonical).hexdigest(),
        'tables': tables,
    }
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
    filename = f'kevin-lifeos-backup-{date.today().isoformat()}.json'
    return Response(
        raw,
        mimetype='application/json; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Length': str(len(raw)),
            'Cache-Control': 'no-store',
        },
    )


@app.get('/api/ping')
def ping():
    return jsonify(version=VERSION)


@app.post('/api/check')
def check():
    j = request.json
    item, month = j['item'], j['month']
    debt_id = j.get('debt_id')          # si viene, es un pago de deuda principal -> abono real
    extra_id = j.get('extra_id')        # si viene, es un pago a deuda registrada prometida
    valor = int(j.get('valor') or 0)
    con = db()
    cur = con.execute('SELECT 1 FROM payment_checks WHERE item=? AND month=?',
                       (item, month)).fetchone()
    if cur:
        # desmarcar: quitar el check y revertir el abono que creó este check
        con.execute('DELETE FROM payment_checks WHERE item=? AND month=?', (item, month))
        if debt_id:
            con.execute('DELETE FROM abonos WHERE debt_id=? AND nota=?',
                         (int(debt_id), f'check:{item}:{month}'))
        if extra_id:
            # borrar el registro de abono que creó este check (revierte historial, boss y desglose)
            con.execute('DELETE FROM abonos WHERE nota=?',
                         (f'extracheck:{extra_id}:{item}:{month}',))
    else:
        # marcar: registrar el check y crear un abono real (baja el Debt Boss)
        con.execute('INSERT INTO payment_checks VALUES (?,?)', (item, month))
        if debt_id and valor > 0:
            con.execute('INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)',
                         (int(debt_id), date.today().isoformat(), valor, f'check:{item}:{month}'))
        if extra_id and valor > 0:
            # registra el abono a la deuda registrada en la tabla 'abonos' (nota extracheck):
            # UNA sola fuente de verdad -> aparece en el HISTORIAL, baja el boss y el desglose.
            con.execute('INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)',
                         (None, date.today().isoformat(), valor, f'extracheck:{extra_id}:{item}:{month}'))
            # si con este pago se salda del todo, borrar la deuda registrada (desaparece de todos lados)
            ed = con.execute('SELECT * FROM extra_debts WHERE id=?', (int(extra_id),)).fetchone()
            if ed:
                ed = dict(ed)
                pagado_total = con.execute(
                    "SELECT COALESCE(SUM(valor),0) AS s FROM abonos WHERE nota=? OR nota LIKE ?",
                    (f"extra:{ed['id']}", f"extracheck:{ed['id']}:%")).fetchone()
                pagado_total = dict(pagado_total)['s'] + (ed.get('abonado') or 0)
                if pagado_total >= (ed['total'] or 0):
                    con.execute('DELETE FROM abonos WHERE nota LIKE ?', (f'extracheck:{ed["id"]}:%',))
                    con.execute('DELETE FROM extra_debts WHERE id=?', (int(extra_id),))
    con.commit()
    return jsonify(ok=True)


@app.post('/api/debt/consolidate')
def debt_consolidate():
    """Suma el total de unas deudas registradas (extra_ids) al 'initial' de una
    deuda del plan (debt_id), y luego borra esas deudas registradas."""
    j = request.json
    debt_id = int(j['debt_id'])
    extra_ids = j.get('extra_ids', [])
    suma = 0
    for eid in extra_ids:
        row = db().execute('SELECT total FROM extra_debts WHERE id=?', (int(eid),)).fetchone()
        if row:
            suma += dict(row)['total']
    if suma > 0:
        db().execute('UPDATE debts SET initial = initial + ? WHERE id=?', (suma, debt_id))
        for eid in extra_ids:
            # mover también cualquier abono hecho a esa extra_debt al historial general
            db().execute('DELETE FROM abonos WHERE nota=? OR nota LIKE ?',
                         (f'extra:{int(eid)}', f'extracheck:{int(eid)}:%'))
            db().execute('DELETE FROM extra_debts WHERE id=?', (int(eid),))
    db().commit()
    return jsonify(ok=True, sumado=suma)


@app.post('/api/debt/new')
def debt_new():
    j = request.json
    valor = int(j['valor'])
    if valor <= 0 or not j['name'].strip():
        return jsonify(error='Nombre y valor mayor a cero'), 400
    cuotas = int(j.get('cuotas') or 0)
    start = int(j.get('start') or 0)
    cuota = round(valor / cuotas) if cuotas >= 1 else 0
    db().execute('''INSERT INTO extra_debts (name, total, cuota, cuotas, start, due_date)
                    VALUES (?,?,?,?,?,?)''',
                 (j['name'].strip(), valor, cuota, cuotas, start, j.get('due_date', '')))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/debt_extra/edit')
def debt_extra_edit():
    return safe_field_update('extra_debts', ('name', 'total', 'due_date'), ('total',), request.json or {})


@app.delete('/api/debt_extra/<int:i>')
def debt_extra_del(i):
    db().execute('DELETE FROM extra_debts WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/habit/new')
def habit_new():
    db().execute('INSERT INTO habits (name) VALUES (?)',
                 (request.json['name'].strip(),))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/habit/<int:i>')
def habit_del(i):
    db().execute('DELETE FROM habit_marks WHERE habit_id=?', (i,))
    db().execute('DELETE FROM habits WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/goal/new')
def goal_new():
    name = request.json['name'].strip()
    db().execute('INSERT INTO goals (name) VALUES (?)', (name,))
    db().commit()
    row = db().execute('SELECT id FROM goals WHERE name=? ORDER BY id DESC', (name,)).fetchone()
    return jsonify(ok=True, id=dict(row)['id'] if row else None)


@app.post('/api/goal')
def goal_update():
    return safe_field_update('goals', ('name', 'why', 'target', 'status', 'pct', 'next_step'),
                              ('pct',), request.json or {})


@app.delete('/api/goal/<int:i>')
def goal_del(i):
    db().execute('DELETE FROM goals WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/shift')
def shift():
    j = request.json
    db().execute('INSERT OR REPLACE INTO week_shifts VALUES (?,?)',
                 (int(j['weekday']), j['shift']))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/career/new')
def career_new():
    j = request.json
    name = j['name'].strip()
    icon = j.get('icon', '🎯')
    db().execute('INSERT INTO careers (name, icon) VALUES (?,?)', (name, icon))
    db().commit()
    row = db().execute('SELECT id FROM careers WHERE name=? AND icon=? ORDER BY id DESC', (name, icon)).fetchone()
    return jsonify(ok=True, id=dict(row)['id'] if row else None)


@app.post('/api/career')
def career_update():
    j = request.json or {}
    field = j.get('field')
    if field not in ('name', 'icon', 'step', 'course', 'pct', 'active', 'bank', 'goal_id'):
        return jsonify(error='Field not allowed'), 400
    try:
        cid = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Invalid career id'), 400
    if field == 'active':   # solo una activa a la vez
        db().execute('UPDATE careers SET active=0')
        db().execute('UPDATE careers SET active=1 WHERE id=?', (cid,))
    else:
        val = int(j.get('value') or 0) if field in ('step', 'pct', 'bank') else j.get('value')
        if field == 'goal_id' and (val == '' or val is None):
            val = None
        db().execute(f'UPDATE careers SET {field}=? WHERE id=?', (val, cid))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/career/<int:i>')
def career_del(i):
    db().execute('DELETE FROM careers WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/course/done')
def course_done():
    j = request.json
    db().execute('INSERT INTO courses_done (career, title, finished_on) VALUES (?,?,?)',
                 (j.get('career', ''), j['title'].strip(), j.get('finished_on', date.today().isoformat())))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/course/<int:i>')
def course_del(i):
    db().execute('DELETE FROM courses_done WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/routine_hide')
def routine_hide():
    j = request.json
    akey = j['akey']
    scope = j.get('scope', 'day')   # 'day' = solo esa fecha, 'week' = todos esos días
    if scope == 'week':
        wd = int(j['weekday'])
        cur = db().execute('SELECT 1 FROM routine_hidden WHERE weekday=? AND akey=?', (wd, akey)).fetchone()
        if cur:
            db().execute('DELETE FROM routine_hidden WHERE weekday=? AND akey=?', (wd, akey))
        else:
            db().execute('INSERT INTO routine_hidden (weekday, akey) VALUES (?,?)', (wd, akey))
    else:
        day = j['day']
        cur = db().execute('SELECT 1 FROM routine_hidden_day WHERE day=? AND akey=?', (day, akey)).fetchone()
        if cur:
            db().execute('DELETE FROM routine_hidden_day WHERE day=? AND akey=?', (day, akey))
        else:
            db().execute('INSERT INTO routine_hidden_day (day, akey) VALUES (?,?)', (day, akey))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/routine_extra/new')
def routine_extra_new():
    j = request.json
    db().execute('INSERT INTO routine_extra (time, title, descr, weekday, day, habit, scheduled) VALUES (?,?,?,?,?,?,?)',
                 (j.get('time', ''), j['title'].strip(), j.get('descr', ''),
                  int(j.get('weekday', -1)), j.get('day', ''), j.get('habit', ''),
                  1 if j.get('scheduled') else 0))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/routine_extra/<int:i>')
def routine_extra_del(i):
    db().execute('DELETE FROM routine_extra WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/shopping/new')
def shopping_new():
    j = request.json
    db().execute('INSERT INTO shopping (name, slots, done, created) VALUES (?,?,?,?)',
                 (j['name'].strip(), int(j.get('slots') or 1), 0, date.today().isoformat()))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/todo/new')
def todo_new():
    j = request.json or {}
    texto = (j.get('texto') or '').strip()
    if not texto:
        return jsonify(error='Write something first'), 400
    db().execute('INSERT INTO todos (texto, done, created) VALUES (?,?,?)',
                 (texto, 0, date.today().isoformat()))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/todo/toggle')
def todo_toggle():
    j = request.json or {}
    tid = int(j['id'])
    row = db().execute('SELECT done FROM todos WHERE id=?', (tid,)).fetchone()
    if not row:
        return jsonify(error='no encontrado'), 404
    db().execute('UPDATE todos SET done=? WHERE id=?', (0 if dict(row)['done'] else 1, tid))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/todo/<int:i>')
def todo_del(i):
    db().execute('DELETE FROM todos WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/todo/clear_done')
def todo_clear_done():
    """Elimina los pendientes completados en una sola operación atómica."""
    cur = db().execute('DELETE FROM todos WHERE done=1')
    db().commit()
    return jsonify(ok=True, deleted=max(cur.rowcount or 0, 0))


@app.post('/api/shopping/bought')
def shopping_bought():
    """Marca un item como COMPRADO: registra fecha, costo y método. A partir de aquí
    sale de la lista activa (Shopping & To Buy) y aparece solo en el historial de compras."""
    j = request.json or {}
    try:
        iid = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Invalid id'), 400
    row = db().execute('SELECT * FROM shopping WHERE id=?', (iid,)).fetchone()
    if not row:
        return jsonify(error='Item not found'), 404
    it = dict(row)
    cost = to_int(j.get('cost'))
    method = j.get('method') or ''
    # marcar completo + comprado (bought_at es lo que lo mueve al historial)
    db().execute('UPDATE shopping SET done=slots, bought_at=?, cost=?, method=? WHERE id=?',
                 (date.today().isoformat(), cost, method, iid))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/shopping/unbuy')
def shopping_unbuy():
    """Devuelve un item del historial a la lista activa (por si se marcó por error)."""
    j = request.json or {}
    try:
        iid = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Invalid id'), 400
    db().execute("UPDATE shopping SET bought_at='', done=0 WHERE id=?", (iid,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/shopping/tick')
def shopping_tick():
    """Suma una raya. Cuando done == slots, el item queda completado (tachado)."""
    j = request.json
    row = db().execute('SELECT slots, done FROM shopping WHERE id=?', (int(j['id']),)).fetchone()
    if not row:
        return jsonify(error='not found'), 404
    row = dict(row)
    nuevo = row['done'] + 1
    if nuevo > row['slots']:
        nuevo = 0   # si ya estaba completo y vuelven a tocar, reinicia (des-completar)
    db().execute('UPDATE shopping SET done=? WHERE id=?', (nuevo, int(j['id'])))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/shopping/<int:i>')
def shopping_del(i):
    db().execute('DELETE FROM shopping WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/shopping/clear_done')
def shopping_clear():
    """Borra los items ya completados (done >= slots)."""
    db().execute("DELETE FROM shopping WHERE done >= slots AND slots > 0 AND (bought_at IS NULL OR bought_at = '')")
    db().commit()
    return jsonify(ok=True)


@app.post('/api/piggy/new')
def piggy_new():
    j = request.json
    db().execute('INSERT INTO piggy (name, kind, monthly, started, icon, goal) VALUES (?,?,?,?,?,?)',
                 (j['name'].strip(), j.get('kind', 'free'), int(j.get('monthly') or 0),
                  j.get('started', date.today().isoformat()), j.get('icon', '🐷'),
                  int(j.get('goal') or 0)))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/piggy/add')
def piggy_add():
    j = request.json
    db().execute('INSERT INTO piggy_moves (piggy_id, amount, day, note) VALUES (?,?,?,?)',
                 (int(j['piggy_id']), int(j['amount'] or 0),
                  j.get('day', date.today().isoformat()), j.get('note', '')))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/piggy_move/<int:i>')
def piggy_move_del(i):
    db().execute('DELETE FROM piggy_moves WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/piggy/<int:i>')
def piggy_del(i):
    db().execute('DELETE FROM piggy_moves WHERE piggy_id=?', (i,))
    db().execute('DELETE FROM piggy WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/fund/new')
def fund_new():
    j = request.json
    db().execute('INSERT INTO fund (name, quota, frequency, last_deposit, saved) VALUES (?,?,?,?,?)',
                 (j['name'].strip(), to_int(j.get('quota')), j.get('frequency', 'Monthly'),
                  j.get('last_deposit', ''), to_int(j.get('saved'))))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/fund')
def fund_update():
    return safe_field_update('fund', ('name', 'quota', 'frequency', 'last_deposit', 'saved'),
                              ('quota', 'saved'), request.json or {}, coerce=to_int)


@app.delete('/api/fund/<int:i>')
def fund_del(i):
    db().execute('DELETE FROM fund WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/service/new')
def service_new():
    j = request.json
    db().execute('INSERT INTO services (name, amount, method, payday) VALUES (?,?,?,?)',
                 (j['name'].strip(), int(j.get('amount') or 0),
                  j.get('method', 'Efectivo'), j.get('payday', '')))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/service')
def service_update():
    return safe_field_update('services', ('name', 'amount', 'method', 'payday'),
                              ('amount',), request.json or {})


@app.delete('/api/service/<int:i>')
def service_del(i):
    db().execute('DELETE FROM services WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/income')
def income_set():
    j = request.json
    db().execute('INSERT OR REPLACE INTO month_income (month, income) VALUES (?,?)',
                 (j['month'], int(j['income'] or 0)))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/expense/new')
def expense_new():
    j = request.json
    db().execute('''INSERT INTO expenses (name, amount, method, kind, month, created)
                    VALUES (?,?,?,?,?,?)''',
                 (j['name'].strip(), int(j['amount'] or 0), j.get('method', 'Efectivo'),
                  j.get('kind', 'once'), j.get('month', ''), date.today().isoformat()))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/expense/<int:i>')
def expense_del(i):
    db().execute('DELETE FROM expenses WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/journal/new')
def journal_new():
    j = request.json
    db().execute('INSERT INTO journal (day, mood, note) VALUES (?,?,?)',
                 (j.get('day', date.today().isoformat()), j.get('mood', ''), j['note'].strip()))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/journal/<int:i>')
def journal_del(i):
    db().execute('DELETE FROM journal WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/asset/new')
def asset_new():
    j = request.json
    db().execute('INSERT INTO assets (name, value) VALUES (?,?)',
                 (j['name'].strip(), int(j.get('value') or 0)))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/asset')
def asset_update():
    j = request.json
    db().execute('UPDATE assets SET value=? WHERE id=?', (int(j['value'] or 0), int(j['id'])))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/asset/<int:i>')
def asset_del(i):
    db().execute('DELETE FROM assets WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/profile')
def profile_set():
    j = request.json
    db().execute('INSERT OR REPLACE INTO study_profile VALUES (?,?)',
                 (j['key'], j['value']))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/gym/set')
def gym_set_add():
    j = request.json or {}
    ex = (j.get('exercise') or '').strip()
    if not ex:
        return jsonify(error='No exercise given'), 400
    d = (str(j.get('date') or '').strip()) or date.today().isoformat()

    def to_num(v, integer=False):
        try:
            n = float(str(v).lower().replace(',', '.').replace('kg', '').replace('reps', '').strip() or 0)
        except (ValueError, TypeError):
            n = 0
        return int(n) if integer else n
    weight = to_num(j.get('weight'))
    reps = to_num(j.get('reps'), integer=True)
    created = datetime.now().isoformat()
    try:
        db().execute(
            'INSERT INTO gym_sets (date, exercise, weight, reps, created) VALUES (?,?,?,?,?)',
            (d, ex, weight, reps, created))
        db().commit()
        # recuperar el id de forma portable (SQLite y Postgres): por su timestamp único
        row = db().execute(
            'SELECT id FROM gym_sets WHERE date=? AND exercise=? AND created=? ORDER BY id DESC',
            (d, ex, created)).fetchone()
        new_id = dict(row)['id'] if row else None
        return jsonify(ok=True, id=new_id)
    except Exception as e:
        return jsonify(error='Could not save the set: ' + str(e)), 400


@app.delete('/api/gym/set/<int:i>')
def gym_set_del(i):
    db().execute('DELETE FROM gym_sets WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/routine')
def routine():
    j = request.json
    cur = db().execute('SELECT 1 FROM routine_done WHERE day=? AND activity=?',
                       (j['day'], j['activity'])).fetchone()
    if cur:
        db().execute('DELETE FROM routine_done WHERE day=? AND activity=?',
                     (j['day'], j['activity']))
    else:
        db().execute('INSERT INTO routine_done (day, activity, note) VALUES (?,?,?)',
                     (j['day'], j['activity'], j.get('note', '')))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/compra')
def compra():
    j = request.json
    valor, cuotas, start = int(j['valor']), int(j['cuotas']), int(j['start'])
    if valor <= 0 or cuotas < 1 or not (0 <= start <= 11) or not j['concepto'].strip():
        return jsonify(error='Revisa: valor > 0, cuotas >= 1, mes válido y concepto'), 400
    db().execute('INSERT INTO compras (creditor, concepto, valor, cuotas, start) VALUES (?,?,?,?,?)',
                 (j['creditor'], j['concepto'].strip(), valor, cuotas, start))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/detalle/redefer')
def detalle_redefer():
    """Redifiere una compra del desglose original: toma el saldo restante y lo
    reparte en N cuotas nuevas, empezando en el mes 'start' que elija el usuario.
    id = id del detalle_items."""
    j = request.json
    iid = int(j['id'])
    nuevas = int(j['cuotas'])
    start = int(j.get('start', -1))
    if nuevas < 1:
        return jsonify(error='cuotas inválidas'), 400
    row = db().execute('SELECT * FROM detalle_items WHERE id=?', (iid,)).fetchone()
    if not row:
        return jsonify(error='no encontrado'), 404
    it = dict(row)
    monto = int(j.get('monto') or 0)
    restantes = max((it['total'] or 0) - (it['pagadas'] or 0), 0)
    saldo = monto if monto > 0 else (it['cuota'] or 0) * restantes
    nueva_cuota = round(saldo / nuevas)
    # reiniciar: nuevas cuotas, 0 pagadas, y desde el mes elegido
    db().execute('UPDATE detalle_items SET cuota=?, pagadas=0, total=?, start_month=? WHERE id=?',
                 (nueva_cuota, nuevas, start, iid))
    db().commit()
    return jsonify(ok=True, cuota=nueva_cuota, saldo=saldo)


@app.post('/api/detalle/abonar')
def detalle_abonar():
    """Abona un MONTO en pesos a una línea de cuotas del desglose.
    Regla (como banco / como dar check en Home):
      - cada vez que el abono cubre el valor de una cuota, se marca 1 cuota como pagada
        (pagadas += 1) → la cuota sale 'paid', baja del total del mes y le pega al jefe.
      - el sobrante que no completa otra cuota se guarda como capital (abonado_fijo) y
        acorta el plazo. (Compat: acepta 'cuotas_pagadas'.)"""
    j = request.json
    iid = int(j['id'])
    row = db().execute('SELECT * FROM detalle_items WHERE id=?', (iid,)).fetchone()
    if not row:
        return jsonify(error='no encontrado'), 404
    it = dict(row)
    total = it['total'] or 0
    cuota = it['cuota'] or 0
    pagadas = it['pagadas'] or 0
    yaAbonado = it.get('abonado_fijo') or 0
    saldoTotal = cuota * total
    if 'monto' in j:
        monto = to_int(j.get('monto'))
    else:
        monto = cuota * max(1, int(j.get('cuotas_pagadas', 1)))
    if monto <= 0:
        return jsonify(error='Enter an amount greater than 0'), 400

    # cuánto queda pendiente hoy (cuotas por pagar + capital ya abonado)
    saldoActual = max(saldoTotal - cuota * pagadas - yaAbonado, 0)
    aplicar = min(monto, saldoActual)     # no se puede abonar más de lo que se debe

    # 1) el abono cubre cuotas completas -> avanzan como si fueran checks
    cuotasNuevas = 0
    sobrante = aplicar
    if cuota > 0:
        # capital ya guardado + este abono, ¿cuántas cuotas completas suma?
        disponible = yaAbonado + aplicar
        cuotasNuevas = min(disponible // cuota, total - pagadas)
        sobrante = disponible - cuotasNuevas * cuota     # capital que queda tras cubrir cuotas
    nuevasPagadas = pagadas + cuotasNuevas
    nuevoAbonado = sobrante if cuota > 0 else (yaAbonado + aplicar)

    if nuevasPagadas >= total:
        # saldada del todo: desaparece del desglose
        db().execute('UPDATE detalle_items SET pagadas=?, abonado_fijo=? WHERE id=?', (total, 0, iid))
    else:
        db().execute('UPDATE detalle_items SET pagadas=?, abonado_fijo=? WHERE id=?',
                     (nuevasPagadas, nuevoAbonado, iid))

    # 2) el abono le pega al JEFE de esta tarjeta (para que baje el Boss y salga en historial)
    #    grupo del detalle -> jefe en tabla debts (directo o por mapeo)
    GRUPO_TO_DEBT = {'Tarjeta DV': 'Tarjeta DV — Jefe Final'}
    jefe_name = GRUPO_TO_DEBT.get(it['grupo'], it['grupo'])
    jefe = db().execute('SELECT id FROM debts WHERE name=?', (jefe_name,)).fetchone()
    if jefe:
        jid = dict(jefe)['id']
        db().execute('INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)',
                     (jid, date.today().isoformat(), aplicar, f'detalle:{iid}'))
    db().commit()
    nuevoSaldo = max(saldoTotal - cuota * nuevasPagadas - nuevoAbonado, 0)
    return jsonify(ok=True, saldo=nuevoSaldo, cuotas_pagadas=cuotasNuevas)


@app.delete('/api/detalle/<int:i>')
def detalle_del(i):
    db().execute('DELETE FROM detalle_items WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/detalle/abonar_fijo')
def detalle_abonar_fijo():
    """Abona a un cargo de SALDO FIJO (préstamos sin cuotas: Estiven, Jean Karlo, etc.).
    monto = cantidad a abonar; si full=True, salda todo el saldo restante.
    Cuando el saldo llega a 0, la línea desaparece del desglose (queda en la tabla con
    abonado_fijo == fijo, para trazabilidad; no se borra)."""
    j = request.json or {}
    try:
        iid = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Invalid id'), 400
    row = db().execute('SELECT * FROM detalle_items WHERE id=?', (iid,)).fetchone()
    if not row:
        return jsonify(error='Loan not found'), 404
    it = dict(row)
    fijo = it.get('fijo') or 0
    if not fijo or it.get('total'):
        return jsonify(error='This line is not a fixed-balance loan'), 400
    ya = it.get('abonado_fijo') or 0
    restante = max(fijo - ya, 0)
    if j.get('full'):
        monto = restante
    else:
        monto = to_int(j.get('monto'))
        if monto <= 0:
            return jsonify(error='Enter an amount greater than 0'), 400
    nuevo = min(ya + monto, fijo)
    db().execute('UPDATE detalle_items SET abonado_fijo=? WHERE id=?', (nuevo, iid))
    db().commit()
    return jsonify(ok=True, abonado=nuevo, saldo=max(fijo - nuevo, 0))


@app.post('/api/extra_debt/abonar')
def extra_debt_abonar():
    """Abona un MONTO en pesos a una deuda registrada: baja el total. Si llega a 0, la borra.
    (Compatibilidad: si llega 'cuotas_pagadas' en vez de 'monto', lo convierte a monto = cuota * n.)"""
    j = request.json
    did = int(j['id'])
    d = db().execute('SELECT * FROM extra_debts WHERE id=?', (did,)).fetchone()
    if not d:
        return jsonify(error='no encontrado'), 404
    d = dict(d)
    saldo = max((d['total'] or 0) - (d.get('abonado') or 0), 0)
    if 'monto' in j:
        monto = min(to_int(j.get('monto')), saldo)
    else:
        cuota = d['cuota'] or (round(d['total'] / d['cuotas']) if d['cuotas'] else 0)
        monto = min(cuota * max(1, int(j.get('cuotas_pagadas', 1))), saldo)
    if monto <= 0:
        return jsonify(error='Enter an amount greater than 0'), 400
    nuevo_abonado = (d.get('abonado') or 0) + monto
    if nuevo_abonado >= (d['total'] or 0):
        db().execute('DELETE FROM extra_debts WHERE id=?', (did,))
    else:
        db().execute('UPDATE extra_debts SET abonado=? WHERE id=?', (nuevo_abonado, did))
    db().commit()
    return jsonify(ok=True, saldo=max((d['total'] or 0) - nuevo_abonado, 0))


@app.post('/api/creditor/redefer')
def creditor_redefer():
    """Redifiere una deuda principal del plan (Tarjeta DV, Crédito Nicole, etc.).
    Toma el saldo restante desde el mes actual y lo reparte en N cuotas iguales."""
    j = request.json
    nombre = j['name']
    nuevas = int(j['cuotas'])
    desde = int(j.get('start', 0))    # mes desde el que aplica el nuevo plan
    if nuevas < 1:
        return jsonify(error='cuotas inválidas'), 400
    row = db().execute("SELECT value FROM config WHERE key='plan'").fetchone()
    if not row:
        return jsonify(error='sin plan'), 404
    plan = json.loads(dict(row)['value'])
    cred = plan.get('creditors', {})
    if nombre not in cred:
        return jsonify(error='deuda no encontrada'), 404
    arr = cred[nombre]
    # saldo restante = suma de las cuotas desde 'desde'; o el monto correcto si lo mandan
    monto = int(j.get('monto') or 0)
    saldo = monto if monto > 0 else sum(arr[desde:])
    cuota = round(saldo / nuevas)
    # reescribir el array: 0 antes de 'desde', luego 'nuevas' cuotas, luego 0
    nuevo_arr = []
    for i in range(len(arr)):
        if i < desde:
            nuevo_arr.append(0)               # ya no se debe nada antes del nuevo plan
        elif i < desde + nuevas:
            nuevo_arr.append(cuota)
        else:
            nuevo_arr.append(0)
    # si las nuevas cuotas se pasan de los 12 meses, ajustamos la última visible
    cred[nombre] = nuevo_arr
    plan['creditors'] = cred
    db().execute("UPDATE config SET value=? WHERE key='plan'",
                 (json.dumps(plan, ensure_ascii=False),))
    db().commit()
    return jsonify(ok=True, cuota=cuota, saldo=saldo)


@app.post('/api/compra/redefer')
def compra_redefer():
    """Redifiere una compra: toma el SALDO RESTANTE (lo que falta por pagar) y lo
    reparte en el nuevo número de cuotas, desde el mes elegido. Como un banco."""
    j = request.json
    cid = int(j['id'])
    nuevas = int(j['cuotas'])
    start = int(j.get('start', 0))
    pagadas = int(j.get('pagadas', 0))   # cuántas cuotas ya se pagaron (lo calcula el frontend)
    c = db().execute('SELECT * FROM compras WHERE id=?', (cid,)).fetchone()
    if not c or nuevas < 1:
        return jsonify(error='datos inválidos'), 400
    c = dict(c)
    cuota_vieja = round(c['valor'] / c['cuotas']) if c['cuotas'] else 0
    monto = int(j.get('monto') or 0)
    pagadas = max(0, min(pagadas, c['cuotas']))
    saldo = monto if monto > 0 else max(c['valor'] - cuota_vieja * pagadas, 0)   # monto correcto o lo que falta
    # el nuevo "valor" de la compra pasa a ser el saldo, repartido en las nuevas cuotas
    db().execute('UPDATE compras SET valor=?, cuotas=?, start=? WHERE id=?',
                 (saldo, nuevas, start, cid))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/extra_debt/redefer')
def extra_debt_redefer():
    """Redifiere una deuda registrada: toma el saldo restante y lo reparte en
    el nuevo número de cuotas, desde el mes elegido."""
    j = request.json
    did = int(j['id'])
    nuevas = int(j['cuotas'])
    start = int(j.get('start', 0))
    pagadas = int(j.get('pagadas', 0))
    d = db().execute('SELECT * FROM extra_debts WHERE id=?', (did,)).fetchone()
    if not d or nuevas < 1:
        return jsonify(error='datos inválidos'), 400
    d = dict(d)
    monto = int(j.get('monto') or 0)
    pagadas = max(0, min(pagadas, d['cuotas'] or 0))
    saldo = monto if monto > 0 else max(d['total'] - (d['cuota'] or 0) * pagadas, 0)
    nueva_cuota = round(saldo / nuevas)
    db().execute('UPDATE extra_debts SET total=?, cuotas=?, cuota=?, start=? WHERE id=?',
                 (saldo, nuevas, nueva_cuota, start, did))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/compra/<int:i>')
def compra_del(i):
    db().execute('DELETE FROM compras WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/compra/abonar')
def compra_abonar():
    """Abona un MONTO en pesos a una compra a cuotas.
    Regla (como pediste): si el abono cubre el valor de una cuota, esa cuota cuenta como
    pagada (baja del saldo y del mes); el sobrante va a capital. El abono le pega al Boss
    (compradoEn resta 'abonado') y NO toca el check (ese sigue manual en Home).
    Devuelve cuotas_pagadas para que la UI muestre 'installment paid'."""
    j = request.json
    cid = int(j['id'])
    c = db().execute('SELECT * FROM compras WHERE id=?', (cid,)).fetchone()
    if not c:
        return jsonify(error='no encontrado'), 404
    c = dict(c)
    valor = c['valor'] or 0
    cuotas = c['cuotas'] or 1
    cuota = round(valor / cuotas) if cuotas else 0
    yaAbonado = c.get('abonado') or 0
    saldo = max(valor - yaAbonado, 0)
    if 'monto' in j:
        monto = min(to_int(j.get('monto')), saldo)
    else:
        monto = min(cuota * max(1, int(j.get('cuotas_pagadas', 1))), saldo)
    if monto <= 0:
        return jsonify(error='Enter an amount greater than 0'), 400
    nuevo_abonado = yaAbonado + monto
    # ¿cuántas cuotas completas cubre este abono (para el mensaje/UI)?
    cuotas_nuevas = 0
    if cuota > 0:
        cuotas_nuevas = (nuevo_abonado // cuota) - (yaAbonado // cuota)
    if nuevo_abonado >= valor:
        db().execute('DELETE FROM compras WHERE id=?', (cid,))   # pagada por completo
    else:
        db().execute('UPDATE compras SET abonado=? WHERE id=?', (nuevo_abonado, cid))
    # registrar el ataque en el HISTORIAL (debt_id=None: el boss ya lo cuenta vía 'abonado')
    db().execute('INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)',
                 (None, date.today().isoformat(), monto, f'compra:{cid}:{c["concepto"]}'))
    db().commit()
    return jsonify(ok=True, saldo=max(valor - nuevo_abonado, 0), cuotas_pagadas=int(cuotas_nuevas))


@app.delete('/api/dream/<int:i>')
def dream_del(i):
    db().execute('DELETE FROM dreams WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/book/<int:i>')
def book_del(i):
    db().execute('DELETE FROM books WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/anime/<int:i>')
def anime_del(i):
    db().execute('DELETE FROM animes WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/debt/edit')
def debt_edit():
    return safe_field_update('debts', ('name', 'initial'), ('initial',), request.json or {})


@app.delete('/api/debt/<int:i>')
def debt_del(i):
    db().execute('DELETE FROM abonos WHERE debt_id=?', (i,))
    db().execute('DELETE FROM debts WHERE id=?', (i,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/dream/new')
def dream_new():
    j = request.json
    db().execute('INSERT INTO dreams (category, name, value) VALUES (?,?,?)',
                 (j['category'].strip(), j['name'].strip(), int(j.get('value') or 0)))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/book/new')
def book_new():
    title = str((request.json or {}).get('title') or '').strip()
    if not title:
        return jsonify(error='Escribe el título del libro'), 400
    if len(title) > 180:
        return jsonify(error='El título es demasiado largo'), 400
    db().execute('INSERT INTO books (title) VALUES (?)', (title,))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/anime/new')
def anime_new():
    j = request.json
    cols = ['name', 'score']
    vals = [j['name'].strip(), None]
    for b in ('t1', 't2', 't3', 't4', 't5', 't6', 't7', 'peliculas', 'ovas', 'especiales'):
        cols.append(b)
        vals.append(str(j.get(b, '') or ''))
    ph = ','.join('?' * len(cols))
    db().execute(f'INSERT INTO animes ({",".join(cols)}) VALUES ({ph})', vals)
    db().commit()
    return jsonify(ok=True)

@app.post('/api/anime')
def anime():
    j = request.json
    field = j.get('field', 'score')
    bloques = ('t1','t2','t3','t4','t5','t6','t7','peliculas','ovas','especiales')
    vistos = tuple('v_' + b for b in bloques)
    if field not in (('score', 'estado') + bloques + vistos):
        return jsonify(error='Campo no permitido'), 400
    v = j.get('value')
    if field == 'score':
        v = None if v in (None, '') else float(v)
    elif field in vistos:
        v = int(v or 0)
    db().execute(f'UPDATE animes SET {field}=? WHERE id=?', (v, int(j['id'])))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/book')
def book():
    j = request.json or {}
    try:
        book_id = int(j.get('id'))
    except (TypeError, ValueError):
        return jsonify(error='Libro inválido'), 400

    field = j.get('field')
    if field not in ('status', 'pages', 'current', 'read_year'):
        return jsonify(error='Campo no permitido'), 400

    row = db().execute('SELECT * FROM books WHERE id=?', (book_id,)).fetchone()
    if not row:
        return jsonify(error='Libro no encontrado'), 404
    current_book = dict(row)

    value = j.get('value')
    if field in ('pages', 'current'):
        try:
            value = max(0, int(value or 0))
        except (TypeError, ValueError):
            return jsonify(error='Número de páginas inválido'), 400
    elif field == 'read_year':
        try:
            value = int(value or 0)
        except (TypeError, ValueError):
            return jsonify(error='Año inválido'), 400
        current_year = date.today().year
        if value and not (1900 <= value <= current_year):
            return jsonify(error=f'El año debe estar entre 1900 y {current_year}'), 400
    elif field == 'status':
        allowed = ('Por comprar', 'Por leer', 'Leyendo', 'Terminado')
        if value not in allowed:
            return jsonify(error='Estado no permitido'), 400

    db().execute(f'UPDATE books SET {field}=? WHERE id=?', (value, book_id))

    # Al terminar un libro por estado o por páginas, registra el año actual
    # únicamente cuando todavía no se ha asignado uno manualmente.
    should_finish = field == 'status' and value == 'Terminado'
    if field in ('pages', 'current'):
        pages = value if field == 'pages' else int(current_book.get('pages') or 0)
        current = value if field == 'current' else int(current_book.get('current') or 0)
        should_finish = pages > 0 and current >= pages
    if should_finish and not int(current_book.get('read_year') or 0):
        db().execute('UPDATE books SET read_year=? WHERE id=?', (date.today().year, book_id))

    db().commit()
    updated = db().execute('SELECT * FROM books WHERE id=?', (book_id,)).fetchone()
    return jsonify(ok=True, book=dict(updated) if updated else None)


# Inicializar BD al importar (gunicorn en Render no usa __main__)
try:
    with app.app_context():
        init_db()  # arranque
except Exception as _e:
    print('init_db diferido:', _e)


if __name__ == '__main__':
    init_db()
    print('✦ KEVIN LIFE OS corriendo en  →  http://localhost:5000')
    app.run(debug=False, port=5000, host='0.0.0.0')
