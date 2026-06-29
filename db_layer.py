"""
Capa de base de datos: usa Postgres si existe DATABASE_URL (en Render),
o SQLite en tu PC. El resto del código (app.py) NO cambia: las consultas
con '?' se traducen solas a Postgres, y .execute(...).fetchone() funciona igual.
"""
import os
import re

DATABASE_URL = os.environ.get('DATABASE_URL', '')
IS_PG = DATABASE_URL.startswith('postgres')


# ---------- Modo SQLite (tu PC) ----------
if not IS_PG:
    import sqlite3

    def connect(path):
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA foreign_keys = ON')
        return con

    PLACEHOLDER = '?'
    AUTOINC = 'INTEGER PRIMARY KEY AUTOINCREMENT'
    INTPK = 'INTEGER PRIMARY KEY'


# ---------- Modo Postgres (Render) ----------
else:
    import psycopg2
    import psycopg2.extras

    # Render entrega 'postgres://', psycopg2 quiere 'postgresql://'
    _url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

    class PGRow(dict):
        """Permite acceso por r['campo'] como sqlite3.Row."""
        pass

    class PGCursor:
        def __init__(self, cur):
            self._cur = cur

        def fetchone(self):
            r = self._cur.fetchone()
            return PGRow(r) if r else None

        def fetchall(self):
            return [PGRow(r) for r in self._cur.fetchall()]

        def __iter__(self):
            return iter(self.fetchall())

    class PGConn:
        """Envuelve psycopg2 para imitar la API de sqlite3 que usa app.py."""
        def __init__(self):
            self._con = psycopg2.connect(_url, cursor_factory=psycopg2.extras.RealDictCursor)

        # PK de cada tabla para construir ON CONFLICT
        PK = {
            'config': 'key', 'study_profile': 'key',
            'months_history': 'label', 'week_shifts': 'weekday',
            'payment_checks': '(item, month)', 'habit_marks': '(habit_id, day)',
            'routine_done': '(day, activity)', 'month_income': 'month',
            'routine_hidden': '(weekday, akey)', 'routine_hidden_day': '(day, akey)',
        }

        def _translate(self, sql):
            up = sql.upper()
            sql = sql.replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'SERIAL PRIMARY KEY')
            # INSERT OR REPLACE INTO tabla VALUES (...) -> upsert con ON CONFLICT DO UPDATE
            m = re.search(r'INSERT OR (REPLACE|IGNORE) INTO (\w+)', sql, re.I)
            if m:
                modo, tabla = m.group(1).upper(), m.group(2)
                pk = self.PK.get(tabla, 'id')
                sql = re.sub(r'INSERT OR (REPLACE|IGNORE) INTO', 'INSERT INTO', sql, flags=re.I)
                if modo == 'IGNORE':
                    sql += f' ON CONFLICT {self._conflict(pk)} DO NOTHING'
                else:
                    sql += f' ON CONFLICT {self._conflict(pk)} DO UPDATE SET {self._setexcluded(tabla, pk)}'
            sql = sql.replace('?', '%s')
            return sql

        def _conflict(self, pk):
            return pk if pk.startswith('(') else f'({pk})'

        def _setexcluded(self, tabla, pk):
            # actualiza todas las columnas menos la PK con el valor entrante (EXCLUDED)
            cols = {
                'config': ['value'], 'study_profile': ['value'],
                'months_history': ['pct'], 'week_shifts': ['shift'],
                'month_income': ['income'],
            }.get(tabla, ['value'])
            return ', '.join(f'{c}=EXCLUDED.{c}' for c in cols)

        def execute(self, sql, params=()):
            try:
                cur = self._con.cursor()
                cur.execute(self._translate(sql), params)
                return PGCursor(cur)
            except Exception:
                # una consulta falló: limpiar la conexión para que las siguientes funcionen
                try:
                    self._con.rollback()
                except Exception:
                    pass
                raise

        def executescript(self, script):
            cur = self._con.cursor()
            for stmt in script.split(';'):
                if stmt.strip():
                    try:
                        cur.execute(self._translate(stmt))
                    except Exception:
                        self._con.rollback()
                        cur = self._con.cursor()
            self._con.commit()

        def fix_sequences(self):
            # Asegura que la columna 'id' autoincremente en TODAS las tablas con id,
            # incluso las creadas como INTEGER PRIMARY KEY plano (dreams, books, habits, debts).
            # Crea una secuencia, la liga a la columna y la resincroniza al máximo id actual.
            # Todo idempotente: se puede correr muchas veces sin daño y sin borrar datos.
            tablas = ['debts', 'abonos', 'habits', 'dreams', 'animes', 'books',
                      'compras', 'goals', 'extra_debts', 'careers', 'courses_done',
                      'routine_extra', 'journal', 'assets', 'expenses', 'services', 'fund', 'piggy', 'piggy_moves', 'shopping', 'detalle_items', 'gym_sets']
            for t in tablas:
                cur = self._con.cursor()
                try:
                    seq = f'{t}_id_seq'
                    cur.execute(f'CREATE SEQUENCE IF NOT EXISTS {seq}')
                    cur.execute(f"ALTER TABLE {t} ALTER COLUMN id SET DEFAULT nextval('{seq}')")
                    cur.execute(f'ALTER SEQUENCE {seq} OWNED BY {t}.id')
                    cur.execute(
                        f"SELECT setval('{seq}', COALESCE((SELECT MAX(id) FROM {t}),1), true)")
                    self._con.commit()
                except Exception:
                    self._con.rollback()
            self._con.commit()

        def commit(self):
            self._con.commit()

        def close(self):
            self._con.close()

    def connect(path=None):
        return PGConn()

    PLACEHOLDER = '%s'
    AUTOINC = 'SERIAL PRIMARY KEY'
    INTPK = 'INTEGER PRIMARY KEY'
