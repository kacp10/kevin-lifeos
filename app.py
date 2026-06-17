"""
KEVIN LIFE OS — Backend
Flask + SQLite. Los datos viven en lifeos.db (ese archivo ES tu base de datos:
cópialo para hacer backup, bórralo para empezar de cero).
Correr:  python app.py   →  http://localhost:5000
"""
import json
import os
import sqlite3
from datetime import date
from flask import Flask, jsonify, render_template, request, g
import db_layer

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, 'lifeos.db')
VERSION = 26  # debe coincidir con FRONT_V en static/app.js
app = Flask(__name__)


def db():
    if 'db' not in g:
        g.db = db_layer.connect(DB)
    return g.db


@app.teardown_appcontext
def close_db(_=None):
    d = g.pop('db', None)
    if d is not None:
        d.close()


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
    CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY, name TEXT, initial INTEGER);
    CREATE TABLE IF NOT EXISTS abonos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, debt_id INTEGER,
        valor INTEGER, nota TEXT DEFAULT '', FOREIGN KEY(debt_id) REFERENCES debts(id));
    CREATE TABLE IF NOT EXISTS habits (id INTEGER PRIMARY KEY, name TEXT);
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
        pages INTEGER DEFAULT 0, current INTEGER DEFAULT 0);
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
        active INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS courses_done (
        id INTEGER PRIMARY KEY AUTOINCREMENT, career TEXT, title TEXT,
        finished_on TEXT);
    CREATE TABLE IF NOT EXISTS routine_extra (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, title TEXT, descr TEXT,
        weekday INTEGER DEFAULT -1, day TEXT DEFAULT '', habit TEXT DEFAULT '');
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
         done INTEGER DEFAULT 0, created TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS extra_debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, total INTEGER,
        cuota INTEGER DEFAULT 0, cuotas INTEGER DEFAULT 0, start INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, why TEXT DEFAULT '',
        target TEXT DEFAULT '', status TEXT DEFAULT 'Pendiente',
        pct INTEGER DEFAULT 0, next_step TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS compras (
        id INTEGER PRIMARY KEY AUTOINCREMENT, creditor TEXT, concepto TEXT,
        valor INTEGER, cuotas INTEGER, start INTEGER);
    ''')
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
    if not con.execute("SELECT 1 FROM config WHERE key='piggy_goal_v1'").fetchone():
        try:
            con.execute("ALTER TABLE piggy ADD COLUMN goal INTEGER DEFAULT 0")
        except Exception:
            pass
        con.execute("INSERT OR IGNORE INTO config VALUES ('piggy_goal_v1','1')")
        con.commit()
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
    # Postgres: resincronizar contadores SERIAL para que los INSERT nuevos no choquen
    if db_layer.IS_PG and hasattr(con, 'fix_sequences'):
        con.fix_sequences()
    con.close()


# Datos de referencia (servicios con fechas y desglose de deudas)
with open(os.path.join(BASE, 'seed_data.json'), encoding='utf-8') as _f:
    _SEED = json.load(_f)
SERVICIOS = _SEED.get('servicios', [])
DETALLE = _SEED.get('detalle', {})


# ---------------------- API ----------------------

@app.get('/')
def index():
    return render_template('index.html')


def _sync_metas_carreras(d):
    """Sincroniza el % de cada meta de Goals con el progreso de su carrera (por palabras clave).
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
            prog = min(round((c.get('step') or 0) * 25 + ((c.get('pct') or 0) / 100) * 25), 100)
            ck = keys(c.get('name'))
            best, bestscore = None, 0
            for g in goals:
                score = len(ck & keys(g.get('name')))
                if score > bestscore:
                    bestscore = score; best = g
            if best and bestscore > 0 and (best.get('pct') or 0) != prog:
                d.execute('UPDATE goals SET pct=? WHERE id=?', (prog, best['id']))
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
    abonos = [dict(r) for r in d.execute(
        '''SELECT a.id, a.fecha, a.valor, de.name FROM abonos a
           JOIN debts de ON de.id = a.debt_id
           ORDER BY a.id DESC LIMIT 30''')]
    habits = [dict(r) for r in d.execute('SELECT * FROM habits')]
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
    extra_debts = [dict(r) for r in d.execute('SELECT * FROM extra_debts')]
    core = [x[0] for x in _SEED['debts']]
    return jsonify(dict(version=VERSION, core_debts=core, compras=compras, goals=goals, extra_debts=extra_debts, shifts=shifts, profile=profile, rdone=rdone, careers=careers, courses_done=courses_done, routine_extra=routine_extra, routine_hidden=routine_hidden, routine_hidden_day=routine_hidden_day, journal=journal, assets=assets, expenses=expenses, month_income=month_income, plan=plan, debts=debts, abonos=abonos, habits=habits,
                        marks=marks, history=history, dreams=dreams,
                        animes=animes, books=books,
                        servicios=services, fund=fund, piggy=piggy, piggy_moves=piggy_moves, shopping=shopping, detalle=DETALLE,
                        checks=[f"{r['item']}|{r['month']}" for r in d.execute(
                            'SELECT item, month FROM payment_checks')],
                        today=date.today().isoformat()))


@app.post('/api/abono')
def abono():
    j = request.json
    valor = int(j['valor'])
    if valor <= 0:
        return jsonify(error='El abono debe ser mayor a cero'), 400
    db().execute('INSERT INTO abonos (fecha, debt_id, valor) VALUES (?,?,?)',
                 (j.get('fecha', date.today().isoformat()),
                  int(j['debt_id']), valor))
    db().commit()
    return jsonify(ok=True)


@app.delete('/api/abono/<int:aid>')
def abono_del(aid):
    db().execute('DELETE FROM abonos WHERE id=?', (aid,))
    db().commit()
    return jsonify(ok=True)


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
    j = request.json
    field = j.get('field', 'saved')
    if field not in ('saved', 'value', 'bought'):
        return jsonify(error='Campo no permitido'), 400
    db().execute(f'UPDATE dreams SET {field}=? WHERE id=?',
                 (int(j['value'] or 0), int(j['id'])))
    db().commit()
    return jsonify(ok=True)




@app.get('/api/ping')
def ping():
    return jsonify(version=VERSION)


@app.post('/api/check')
def check():
    j = request.json
    item, month = j['item'], j['month']
    debt_id = j.get('debt_id')          # si viene, es un pago de deuda -> abono real
    valor = int(j.get('valor') or 0)
    cur = db().execute('SELECT 1 FROM payment_checks WHERE item=? AND month=?',
                       (item, month)).fetchone()
    if cur:
        # desmarcar: quitar el check y, si era deuda, borrar el abono que creó este check
        db().execute('DELETE FROM payment_checks WHERE item=? AND month=?', (item, month))
        if debt_id:
            db().execute('DELETE FROM abonos WHERE debt_id=? AND nota=?',
                         (int(debt_id), f'check:{item}:{month}'))
    else:
        # marcar: registrar el check y, si era deuda, crear un abono real (baja el Debt Boss)
        db().execute('INSERT INTO payment_checks VALUES (?,?)', (item, month))
        if debt_id and valor > 0:
            db().execute('INSERT INTO abonos (debt_id, fecha, valor, nota) VALUES (?,?,?,?)',
                         (int(debt_id), date.today().isoformat(), valor, f'check:{item}:{month}'))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/debt/new')
def debt_new():
    j = request.json
    valor = int(j['valor'])
    if valor <= 0 or not j['name'].strip():
        return jsonify(error='Nombre y valor mayor a cero'), 400
    cuotas = int(j.get('cuotas') or 0)
    start = int(j.get('start') or 0)
    cuota = round(valor / cuotas) if cuotas >= 1 else 0
    db().execute('''INSERT INTO extra_debts (name, total, cuota, cuotas, start)
                    VALUES (?,?,?,?,?)''',
                 (j['name'].strip(), valor, cuota, cuotas, start))
    db().commit()
    return jsonify(ok=True)


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
    db().execute('INSERT INTO goals (name) VALUES (?)',
                 (request.json['name'].strip(),))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/goal')
def goal_update():
    j = request.json
    field = j['field']
    if field not in ('name', 'why', 'target', 'status', 'pct', 'next_step'):
        return jsonify(error='Campo no permitido'), 400
    value = int(j['value'] or 0) if field == 'pct' else j['value']
    db().execute(f'UPDATE goals SET {field}=? WHERE id=?', (value, int(j['id'])))
    db().commit()
    return jsonify(ok=True)


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
    db().execute('INSERT INTO careers (name, icon) VALUES (?,?)',
                 (j['name'].strip(), j.get('icon', '🎯')))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/career')
def career_update():
    j = request.json
    field = j['field']
    if field not in ('name', 'icon', 'step', 'course', 'pct', 'active'):
        return jsonify(error='Field not allowed'), 400
    if field == 'active':   # solo una activa a la vez
        db().execute('UPDATE careers SET active=0')
        db().execute('UPDATE careers SET active=1 WHERE id=?', (int(j['id']),))
    else:
        val = int(j['value'] or 0) if field in ('step', 'pct') else j['value']
        db().execute(f'UPDATE careers SET {field}=? WHERE id=?', (val, int(j['id'])))
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
    db().execute('INSERT INTO routine_extra (time, title, descr, weekday, day, habit) VALUES (?,?,?,?,?,?)',
                 (j.get('time', ''), j['title'].strip(), j.get('descr', ''),
                  int(j.get('weekday', -1)), j.get('day', ''), j.get('habit', '')))
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
    db().execute('DELETE FROM shopping WHERE done >= slots AND slots > 0')
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
                 (j['name'].strip(), int(j.get('quota') or 0), j.get('frequency', 'Monthly'),
                  j.get('last_deposit', ''), int(j.get('saved') or 0)))
    db().commit()
    return jsonify(ok=True)


@app.post('/api/fund')
def fund_update():
    j = request.json
    field = j['field']
    if field not in ('name', 'quota', 'frequency', 'last_deposit', 'saved'):
        return jsonify(error='Field not allowed'), 400
    val = int(j['value'] or 0) if field in ('quota', 'saved') else j['value']
    db().execute(f'UPDATE fund SET {field}=? WHERE id=?', (val, int(j['id'])))
    db().commit()
    return jsonify(ok=True)


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
    j = request.json
    field = j['field']
    if field not in ('name', 'amount', 'method', 'payday'):
        return jsonify(error='Field not allowed'), 400
    val = int(j['value'] or 0) if field == 'amount' else j['value']
    db().execute(f'UPDATE services SET {field}=? WHERE id=?', (val, int(j['id'])))
    db().commit()
    return jsonify(ok=True)


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
    # saldo restante = suma de las cuotas desde 'desde' en adelante
    saldo = sum(arr[desde:])
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
    pagadas = max(0, min(pagadas, c['cuotas']))
    saldo = max(c['valor'] - cuota_vieja * pagadas, 0)   # lo que falta por pagar
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
    pagadas = max(0, min(pagadas, d['cuotas'] or 0))
    saldo = max(d['total'] - (d['cuota'] or 0) * pagadas, 0)
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
    db().execute('INSERT INTO books (title) VALUES (?)',
                 (request.json['title'].strip(),))
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
    j = request.json
    field = j['field']
    if field not in ('status', 'pages', 'current'):
        return jsonify(error='Campo no permitido'), 400
    db().execute(f'UPDATE books SET {field}=? WHERE id=?',
                 (j['value'], int(j['id'])))
    db().commit()
    return jsonify(ok=True)


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
