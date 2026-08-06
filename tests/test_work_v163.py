import sqlite3
import unittest

SCHEMA = '''
CREATE TABLE work_roles(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, active INTEGER DEFAULT 0);
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, status TEXT DEFAULT 'backlog', priority TEXT DEFAULT 'medium',
 mission_type TEXT DEFAULT 'standby', description TEXT DEFAULT '', acceptance TEXT DEFAULT '',
 stakeholder TEXT DEFAULT '', due_date TEXT DEFAULT '', deliverables TEXT DEFAULT '',
 blocked_reason TEXT DEFAULT '', review_note TEXT DEFAULT '', review_score INTEGER DEFAULT NULL,
 created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
CREATE TABLE work_ticket_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, role_code TEXT NOT NULL,
 event_type TEXT NOT NULL, from_status TEXT DEFAULT '', to_status TEXT DEFAULT '',
 note TEXT DEFAULT '', score INTEGER DEFAULT NULL, created_at TEXT DEFAULT '');
'''

class WorkMissionSystemTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.executemany('INSERT INTO work_roles(code,active) VALUES(?,?)', [('data',1),('dev',0)])
        self.db.execute("""INSERT INTO work_tickets(role_code,code,title,status,description,acceptance,deliverables)
                         VALUES('data','DATA-001','Analyze churn','in_progress','Business context','Validated KPI','SQL + report')""")
        self.ticket_id=self.db.execute("SELECT id FROM work_tickets WHERE code='DATA-001'").fetchone()[0]

    def test_complete_mission_fields_persist(self):
        row=self.db.execute('SELECT description,acceptance,deliverables FROM work_tickets WHERE id=?',(self.ticket_id,)).fetchone()
        self.assertEqual(row,('Business context','Validated KPI','SQL + report'))

    def test_blocker_preserves_reason_and_history(self):
        self.db.execute("UPDATE work_tickets SET status='blocked',blocked_reason='Dataset unavailable' WHERE id=?",(self.ticket_id,))
        self.db.execute("INSERT INTO work_ticket_history(ticket_id,role_code,event_type,from_status,to_status,note) VALUES(?,?,'blocked','in_progress','blocked',?)",(self.ticket_id,'data','Dataset unavailable'))
        self.assertEqual(self.db.execute('SELECT status,blocked_reason FROM work_tickets WHERE id=?',(self.ticket_id,)).fetchone(),('blocked','Dataset unavailable'))
        self.assertEqual(self.db.execute('SELECT event_type FROM work_ticket_history WHERE ticket_id=?',(self.ticket_id,)).fetchone()[0],'blocked')

    def test_changes_requested_returns_to_execution(self):
        self.db.execute("UPDATE work_tickets SET status='in_progress',review_score=62,review_note='Fix duplicated rows' WHERE id=?",(self.ticket_id,))
        self.assertEqual(self.db.execute('SELECT status,review_score FROM work_tickets WHERE id=?',(self.ticket_id,)).fetchone(),('in_progress',62))

    def test_approved_review_closes_mission(self):
        self.db.execute("UPDATE work_tickets SET status='done',review_score=91,review_note='Approved' WHERE id=?",(self.ticket_id,))
        self.db.execute("INSERT INTO work_ticket_history(ticket_id,role_code,event_type,from_status,to_status,note,score) VALUES(?,?,'approved','review','done','Approved',91)",(self.ticket_id,'data'))
        self.assertEqual(self.db.execute('SELECT status,review_score FROM work_tickets WHERE id=?',(self.ticket_id,)).fetchone(),('done',91))

    def test_history_remains_role_scoped(self):
        self.db.execute("INSERT INTO work_ticket_history(ticket_id,role_code,event_type,note) VALUES(?,?,'created','Created')",(self.ticket_id,'data'))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM work_ticket_history WHERE role_code='dev'").fetchone()[0],0)

if __name__=='__main__': unittest.main()
