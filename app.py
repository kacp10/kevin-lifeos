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
VERSION = 15  # debe coincidir con FRONT_V en static/app.js
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
        valor INTEGER, FOREIGN KEY(debt_id) REFERENCES debts(id));
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
    goals = [dict(r) for r in d.execute('SELECT * FROM goals')]
    shifts = {r['weekday']: r['shift'] for r in d.execute('SELECT * FROM week_shifts')}
    profile = {r['key']: r['value'] for r in d.execute('SELECT * FROM study_profile')}
    rdone = [f"{r['day']}|{r['activity']}" for r in d.execute('SELECT day, activity FROM routine_done')]
    extra_debts = [dict(r) for r in d.execute('SELECT * FROM extra_debts')]
    core = [x[0] for x in _SEED['debts']]
    return jsonify(dict(version=VERSION, core_debts=core, compras=compras, goals=goals, extra_debts=extra_debts, shifts=shifts, profile=profile, rdone=rdone, plan=plan, debts=debts, abonos=abonos, habits=habits,
                        marks=marks, history=history, dreams=dreams,
                        animes=animes, books=books,
                        servicios=SERVICIOS, detalle=DETALLE,
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
    cur = db().execute('SELECT 1 FROM payment_checks WHERE item=? AND month=?',
                       (j['item'], j['month'])).fetchone()
    if cur:
        db().execute('DELETE FROM payment_checks WHERE item=? AND month=?',
                     (j['item'], j['month']))
    else:
        db().execute('INSERT INTO payment_checks VALUES (?,?)',
                     (j['item'], j['month']))
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
