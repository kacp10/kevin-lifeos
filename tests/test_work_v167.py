import json
import sqlite3
import unittest
from pathlib import Path

SCHEMA = """
CREATE TABLE work_tickets(id INTEGER PRIMARY KEY, role_code TEXT, status TEXT, review_status TEXT);
CREATE TABLE work_portfolio_projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, title TEXT NOT NULL,
 slug TEXT NOT NULL, summary TEXT DEFAULT '', status TEXT DEFAULT 'internal',
 ticket_ids_json TEXT DEFAULT '[]', checklist_json TEXT DEFAULT '{}', repo_url TEXT DEFAULT '',
 linkedin_url TEXT DEFAULT '', readme_text TEXT DEFAULT '', interview_notes TEXT DEFAULT '',
 created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '', published_at TEXT DEFAULT '',
 UNIQUE(role_code, slug));
"""

class WorkPortfolioOperationsTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)

    def test_only_approved_missions_are_valid_portfolio_evidence(self):
        self.db.execute("INSERT INTO work_tickets VALUES(1,'dev','done','approved')")
        self.db.execute("INSERT INTO work_tickets VALUES(2,'dev','done','changes_requested')")
        approved={r[0] for r in self.db.execute("SELECT id FROM work_tickets WHERE role_code='dev' AND status='done' AND review_status='approved'")}
        self.assertIn(1,approved)
        self.assertNotIn(2,approved)

    def test_project_status_starts_internal(self):
        self.db.execute("INSERT INTO work_portfolio_projects(role_code,title,slug,ticket_ids_json) VALUES('data','Sales Analysis','sales-analysis','[1]')")
        self.assertEqual(self.db.execute('SELECT status FROM work_portfolio_projects').fetchone()[0],'internal')

    def test_publication_checklist_is_persistent(self):
        checklist={'approved_evidence':True,'readme':True,'setup':True,'tests':True,'results':True,'limitations':True,'repo_public':False}
        self.db.execute("INSERT INTO work_portfolio_projects(role_code,title,slug,checklist_json) VALUES('ml','Churn Model','churn-model',?)",(json.dumps(checklist),))
        loaded=json.loads(self.db.execute('SELECT checklist_json FROM work_portfolio_projects').fetchone()[0])
        self.assertTrue(loaded['tests'])
        self.assertFalse(loaded['repo_public'])

    def test_portfolio_operations_survive_future_versions(self):
        root=Path(__file__).resolve().parent.parent
        app_py=(root/'app.py').read_text(encoding='utf-8')
        app_js=(root/'static'/'app.js').read_text(encoding='utf-8')
        self.assertRegex(app_py, r'VERSION = (?:16[7-9]|1[7-9]\d|[2-9]\d{2,})')
        self.assertRegex(app_js, r'const FRONT_V = (?:16[7-9]|1[7-9]\d|[2-9]\d{2,});')
        self.assertIn('/api/work/portfolio/project',app_py)
        self.assertIn('PORTFOLIO OPERATIONS',app_js)
        self.assertIn('Copy README prompt',app_js)

if __name__=='__main__': unittest.main()
