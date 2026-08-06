import json
import sqlite3
import unittest
from pathlib import Path

SCHEMA = '''
CREATE TABLE work_market_jobs(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, title TEXT NOT NULL,
 company TEXT NOT NULL, location TEXT DEFAULT '', source_name TEXT DEFAULT 'LinkedIn',
 source_url TEXT UNIQUE NOT NULL, posted_date TEXT DEFAULT '', captured_at TEXT DEFAULT '',
 skills_json TEXT DEFAULT '[]', notes TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE work_skill_evidence(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, skill_key TEXT NOT NULL,
 skill_name TEXT NOT NULL, evidence_count INTEGER DEFAULT 0, approved_tickets INTEGER DEFAULT 0,
 score_total INTEGER DEFAULT 0, UNIQUE(role_code, skill_key));
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL, status TEXT DEFAULT 'backlog');
'''


class WorkMarketIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)

    def test_source_url_is_unique_and_traceable(self):
        row=('data','Data Analyst','Example Co','Bogotá','LinkedIn','https://example.com/job/1','2026-08-01','2026-08-06T10:00:00',json.dumps(['SQL','Power BI']))
        self.db.execute('INSERT INTO work_market_jobs(role_code,title,company,location,source_name,source_url,posted_date,captured_at,skills_json) VALUES(?,?,?,?,?,?,?,?,?)',row)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('INSERT INTO work_market_jobs(role_code,title,company,location,source_name,source_url,posted_date,captured_at,skills_json) VALUES(?,?,?,?,?,?,?,?,?)',row)

    def test_gap_uses_approved_evidence_not_course_or_academy_counts(self):
        self.db.execute("INSERT INTO work_market_jobs(role_code,title,company,source_url,skills_json) VALUES('data','Analyst','A','https://a.test',?)", (json.dumps(['SQL','Power BI']),))
        self.db.execute("INSERT INTO work_skill_evidence(role_code,skill_key,skill_name,evidence_count,approved_tickets,score_total) VALUES('data','sql','SQL',1,1,90)")
        demanded=set(json.loads(self.db.execute('SELECT skills_json FROM work_market_jobs').fetchone()[0]))
        evidenced={r[0] for r in self.db.execute("SELECT skill_name FROM work_skill_evidence WHERE approved_tickets>0")}
        self.assertEqual(demanded-evidenced, {'Power BI'})

    def test_archiving_source_preserves_record_but_hides_it_from_active_market(self):
        self.db.execute("INSERT INTO work_market_jobs(role_code,title,company,source_url,active) VALUES('cyber','SOC Analyst','A','https://a.test',1)")
        self.db.execute('UPDATE work_market_jobs SET active=0 WHERE source_url=?',('https://a.test',))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM work_market_jobs').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM work_market_jobs WHERE active=1').fetchone()[0],0)

    def test_market_gap_can_create_backlog_mission_without_auto_approval(self):
        self.db.execute("INSERT INTO work_tickets(role_code,code,title,status) VALUES('ml','ML-002','Demonstrate MLOps','backlog')")
        self.assertEqual(self.db.execute("SELECT status FROM work_tickets WHERE code='ML-002'").fetchone()[0], 'backlog')

    def test_frontend_and_backend_versions_are_v166(self):
        root=Path(__file__).resolve().parent.parent
        app_py=(root/'app.py').read_text(encoding='utf-8')
        app_js=(root/'static'/'app.js').read_text(encoding='utf-8')
        self.assertIn('VERSION = 166',app_py)
        self.assertIn('const FRONT_V = 166;',app_js)
        self.assertIn('/api/work/market/job',app_py)
        self.assertIn('MARKET INTELLIGENCE',app_js)
        self.assertIn('Vacancies → evidence gaps',app_js)


if __name__=='__main__':
    unittest.main()
