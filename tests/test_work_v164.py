import json
import sqlite3
import unittest
from pathlib import Path

SCHEMA = '''
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, status TEXT DEFAULT 'backlog', review_note TEXT DEFAULT '',
 review_score INTEGER DEFAULT NULL, review_round INTEGER DEFAULT 0,
 review_status TEXT DEFAULT '', review_payload TEXT DEFAULT '', correction_plan TEXT DEFAULT '',
 reviewed_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
CREATE TABLE work_ticket_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, role_code TEXT NOT NULL,
 event_type TEXT NOT NULL, from_status TEXT DEFAULT '', to_status TEXT DEFAULT '',
 note TEXT DEFAULT '', score INTEGER DEFAULT NULL, created_at TEXT DEFAULT '');
'''


class WorkAIReviewBridgeTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute(
            "INSERT INTO work_tickets(role_code,code,title,status) VALUES('data','DATA-001','Analyze churn','review')"
        )
        self.ticket_id = self.db.execute(
            "SELECT id FROM work_tickets WHERE code='DATA-001'"
        ).fetchone()[0]

    def import_review(self, decision, score, summary, corrections):
        payload = {
            'decision': decision,
            'score': score,
            'summary': summary,
            'strengths': ['Clear query'],
            'issues': [],
            'required_changes': corrections,
            'skills_demonstrated': ['SQL'],
            'questions': ['How did you validate duplicates?'],
        }
        target = 'done' if decision == 'approved' else 'in_progress'
        previous = self.db.execute(
            'SELECT status FROM work_tickets WHERE id=?', (self.ticket_id,)
        ).fetchone()[0]
        current_round = self.db.execute(
            'SELECT review_round FROM work_tickets WHERE id=?', (self.ticket_id,)
        ).fetchone()[0]
        review_round = current_round + 1
        self.db.execute(
            '''UPDATE work_tickets SET status=?,review_note=?,review_score=?,review_round=?,
               review_status=?,review_payload=?,correction_plan=? WHERE id=?''',
            (target, summary, score, review_round, decision,
             json.dumps(payload), json.dumps(corrections), self.ticket_id),
        )
        self.db.execute(
            '''INSERT INTO work_ticket_history
               (ticket_id,role_code,event_type,from_status,to_status,note,score)
               VALUES(?,?,?,?,?,?,?)''',
            (self.ticket_id, 'data', f'ai_{decision}', previous, target, summary, score),
        )

    def test_changes_requested_creates_correction_plan(self):
        self.import_review('changes_requested', 68, 'Fix validation', ['Remove duplicated rows'])
        row = self.db.execute(
            'SELECT status,review_status,correction_plan FROM work_tickets WHERE id=?',
            (self.ticket_id,),
        ).fetchone()
        self.assertEqual(row[0:2], ('in_progress', 'changes_requested'))
        self.assertEqual(json.loads(row[2]), ['Remove duplicated rows'])

    def test_approved_review_closes_mission(self):
        self.import_review('approved', 94, 'All criteria demonstrated', [])
        row = self.db.execute(
            'SELECT status,review_score,review_status FROM work_tickets WHERE id=?',
            (self.ticket_id,),
        ).fetchone()
        self.assertEqual(row, ('done', 94, 'approved'))

    def test_each_import_increments_review_round(self):
        self.import_review('changes_requested', 65, 'Round one', ['Add tests'])
        self.db.execute("UPDATE work_tickets SET status='review' WHERE id=?", (self.ticket_id,))
        self.import_review('approved', 90, 'Round two approved', [])
        self.assertEqual(
            self.db.execute('SELECT review_round FROM work_tickets WHERE id=?', (self.ticket_id,)).fetchone()[0],
            2,
        )

    def test_structured_payload_is_preserved(self):
        self.import_review('approved', 88, 'Validated evidence', [])
        payload = json.loads(
            self.db.execute('SELECT review_payload FROM work_tickets WHERE id=?', (self.ticket_id,)).fetchone()[0]
        )
        self.assertEqual(payload['decision'], 'approved')
        self.assertIn('SQL', payload['skills_demonstrated'])
        self.assertIn('questions', payload)

    def test_frontend_and_backend_versions_are_v164(self):
        root = Path(__file__).resolve().parent.parent
        app_py = (root / 'app.py').read_text(encoding='utf-8')
        app_js = (root / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertRegex(app_py, r'VERSION = (16[4-9]|1[7-9][0-9])')
        self.assertRegex(app_js, r'const FRONT_V = (16[4-9]|1[7-9][0-9]);')
        self.assertIn('/api/work/ticket/review/import', app_py)
        self.assertIn('Copy AI review prompt', app_js)


if __name__ == '__main__':
    unittest.main()
