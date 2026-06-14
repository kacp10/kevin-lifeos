"""
MIGRADOR: sube tus datos del lifeos.db local a la base Postgres de Render.
Uso (una sola vez, cuando la web ya esté desplegada y vacía):
  1. Copia aquí tu lifeos.db (el de tu PC con tus datos).
  2. En Render → tu base de datos → copia la "External Database URL".
  3. Corre:  python migrar_a_nube.py "pega-aqui-la-url-externa"
"""
import sqlite3
import sys
import psycopg2

if len(sys.argv) < 2:
    print('Falta la URL. Uso: python migrar_a_nube.py "postgresql://...."')
    sys.exit(1)

PG_URL = sys.argv[1].replace('postgres://', 'postgresql://', 1)
sq = sqlite3.connect('lifeos.db')
sq.row_factory = sqlite3.Row
pg = psycopg2.connect(PG_URL)
pgc = pg.cursor()

# tablas a migrar (todas las de datos del usuario)
TABLAS = ['config', 'debts', 'abonos', 'habits', 'habit_marks', 'months_history',
          'dreams', 'animes', 'books', 'payment_checks', 'compras', 'goals',
          'extra_debts', 'week_shifts', 'routine_done', 'study_profile']

for t in TABLAS:
    try:
        filas = sq.execute(f'SELECT * FROM {t}').fetchall()
    except sqlite3.OperationalError:
        print(f'  (omito {t}: no existe en tu BD local)')
        continue
    if not filas:
        print(f'  {t}: vacía, nada que migrar')
        continue
    cols = filas[0].keys()
    colstr = ', '.join(cols)
    ph = ', '.join(['%s'] * len(cols))
    # limpiar la tabla destino primero para no duplicar
    pgc.execute(f'DELETE FROM {t}')
    n = 0
    for fila in filas:
        try:
            pgc.execute(f'INSERT INTO {t} ({colstr}) VALUES ({ph})', tuple(fila))
            n += 1
        except Exception as e:
            print(f'  ⚠ fila saltada en {t}: {e}')
            pg.rollback()
            continue
    pg.commit()
    print(f'  ✓ {t}: {n} filas migradas')

pg.close()
sq.close()
print('\\n✦ ¡Listo! Tus datos ya están en la nube. Recarga tu web de Render.')
