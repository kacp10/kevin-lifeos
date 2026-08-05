import sqlite3
import unittest

BASE_SCHEMA = '''
CREATE TABLE work_roles(
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL, icon TEXT DEFAULT '◆', active INTEGER DEFAULT 0,
 level TEXT DEFAULT 'Foundation', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, status TEXT DEFAULT 'backlog', priority TEXT DEFAULT 'medium',
 mission_type TEXT DEFAULT 'standby', description TEXT DEFAULT '', acceptance TEXT DEFAULT '',
 created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
'''

MIGRATION = (
    "ALTER TABLE work_roles ADD COLUMN company TEXT DEFAULT ''",
    "ALTER TABLE work_roles ADD COLUMN sprint_name TEXT DEFAULT ''",
    "ALTER TABLE work_roles ADD COLUMN sprint_goal TEXT DEFAULT ''",
    "ALTER TABLE work_roles ADD COLUMN sprint_start TEXT DEFAULT ''",
    "ALTER TABLE work_roles ADD COLUMN sprint_end TEXT DEFAULT ''",
    "ALTER TABLE work_roles ADD COLUMN weekly_minutes INTEGER DEFAULT 180",
)


class WorkCommandCenterSQLiteTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(BASE_SCHEMA)
        for statement in MIGRATION:
            self.db.execute(statement)
        for code in ('data', 'dev', 'cyber', 'ml'):
            self.db.execute(
                '''INSERT INTO work_roles
                   (code,name,active,company,sprint_name,sprint_goal,weekly_minutes)
                   VALUES(?,?,?,?,?,?,?)''',
                (code, code.title(), 1 if code == 'data' else 0,
                 f'{code.title()} Lab', f'{code.upper()} SPRINT', 'Role-specific objective', 180),
            )
        self.db.execute(
            "INSERT INTO work_tickets(role_code,code,title,status) VALUES('data','DATA-001','Inspect data','ready')"
        )

    def test_v162_migration_adds_command_center_fields(self):
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(work_roles)')}
        self.assertTrue({'company', 'sprint_name', 'sprint_goal', 'sprint_start',
                         'sprint_end', 'weekly_minutes'}.issubset(columns))

    def test_command_context_is_independent_per_role(self):
        self.db.execute(
            "UPDATE work_roles SET company='Northstar', sprint_name='DATA WEEK' WHERE code='data'"
        )
        data = self.db.execute(
            "SELECT company,sprint_name FROM work_roles WHERE code='data'"
        ).fetchone()
        dev = self.db.execute(
            "SELECT company,sprint_name FROM work_roles WHERE code='dev'"
        ).fetchone()
        self.assertEqual(data, ('Northstar', 'DATA WEEK'))
        self.assertEqual(dev, ('Dev Lab', 'DEV SPRINT'))

    def test_role_switch_preserves_command_context(self):
        before = self.db.execute(
            "SELECT company,sprint_name,sprint_goal,weekly_minutes FROM work_roles WHERE code='data'"
        ).fetchone()
        self.db.execute('UPDATE work_roles SET active=0')
        self.db.execute("UPDATE work_roles SET active=1 WHERE code='cyber'")
        after = self.db.execute(
            "SELECT company,sprint_name,sprint_goal,weekly_minutes FROM work_roles WHERE code='data'"
        ).fetchone()
        self.assertEqual(before, after)

    def test_ticket_status_changes_without_crossing_roles(self):
        ticket = self.db.execute(
            "SELECT id,role_code FROM work_tickets WHERE code='DATA-001'"
        ).fetchone()
        self.assertEqual(ticket[1], 'data')
        self.db.execute("UPDATE work_tickets SET status='in_progress' WHERE id=?", (ticket[0],))
        self.assertEqual(
            self.db.execute('SELECT status FROM work_tickets WHERE id=?', (ticket[0],)).fetchone()[0],
            'in_progress',
        )


if __name__ == '__main__':
    unittest.main()
