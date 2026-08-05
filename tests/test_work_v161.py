import sqlite3
import unittest

SCHEMA = '''
CREATE TABLE work_roles(
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL, icon TEXT DEFAULT '◆', active INTEGER DEFAULT 0,
 level TEXT DEFAULT 'Foundation', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, status TEXT DEFAULT 'backlog', priority TEXT DEFAULT 'medium',
 mission_type TEXT DEFAULT 'standby', description TEXT DEFAULT '', acceptance TEXT DEFAULT '',
 created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
CREATE TABLE work_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, ticket_id INTEGER DEFAULT NULL,
 day TEXT NOT NULL, minutes INTEGER DEFAULT 0, session_type TEXT DEFAULT 'standby',
 result TEXT DEFAULT 'progress', note TEXT DEFAULT '', created_at TEXT DEFAULT '');
'''

class WorkFoundationSQLiteTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        for code in ('data', 'dev', 'cyber', 'ml'):
            self.db.execute(
                'INSERT INTO work_roles(code,name,active) VALUES(?,?,?)',
                (code, code.title(), 1 if code == 'data' else 0),
            )
        self.db.execute(
            "INSERT INTO work_tickets(role_code,code,title,status) VALUES('data','DATA-001','Dataset inspection','ready')"
        )

    def test_only_one_role_stays_active(self):
        self.db.execute('UPDATE work_roles SET active=0')
        self.db.execute("UPDATE work_roles SET active=1 WHERE code='dev'")
        active = self.db.execute('SELECT code FROM work_roles WHERE active=1').fetchall()
        self.assertEqual(active, [('dev',)])

    def test_role_switch_does_not_delete_other_roles(self):
        self.db.execute('UPDATE work_roles SET active=0')
        self.db.execute("UPDATE work_roles SET active=1 WHERE code='cyber'")
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM work_roles').fetchone()[0], 4)

    def test_session_keeps_role_and_ticket_evidence(self):
        ticket_id = self.db.execute("SELECT id FROM work_tickets WHERE code='DATA-001'").fetchone()[0]
        self.db.execute(
            "INSERT INTO work_sessions(role_code,ticket_id,day,minutes,session_type,result,note) VALUES(?,?,?,?,?,?,?)",
            ('data', ticket_id, '2026-08-05', 25, 'standby', 'progress', 'Mapped columns'),
        )
        row = self.db.execute('SELECT role_code,ticket_id,minutes,session_type FROM work_sessions').fetchone()
        self.assertEqual(row, ('data', ticket_id, 25, 'standby'))

    def test_academy_is_not_part_of_work_schema(self):
        tables = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn('hunter_academy_state', tables)

if __name__ == '__main__':
    unittest.main()
