import json
import sqlite3
import unittest
from pathlib import Path

SCHEMA = '''
CREATE TABLE work_roles(
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 level TEXT DEFAULT 'Foundation', level_index INTEGER DEFAULT 0, promotion_ready INTEGER DEFAULT 0);
CREATE TABLE work_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, status TEXT DEFAULT 'backlog',
 review_status TEXT DEFAULT '', review_score INTEGER DEFAULT NULL);
CREATE TABLE work_skill_evidence(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, skill_key TEXT NOT NULL,
 skill_name TEXT NOT NULL, evidence_count INTEGER DEFAULT 0, approved_tickets INTEGER DEFAULT 0,
 score_total INTEGER DEFAULT 0, last_ticket_id INTEGER DEFAULT NULL, last_evidence_at TEXT DEFAULT '',
 UNIQUE(role_code, skill_key));
CREATE TABLE work_level_assessments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, role_code TEXT NOT NULL, from_level TEXT NOT NULL,
 target_level TEXT NOT NULL, status TEXT DEFAULT 'pending', readiness INTEGER DEFAULT 0,
 prompt_snapshot TEXT DEFAULT '', result_payload TEXT DEFAULT '', summary TEXT DEFAULT '',
 score INTEGER DEFAULT NULL, created_at TEXT DEFAULT '', reviewed_at TEXT DEFAULT '', promoted_at TEXT DEFAULT '');
'''


class WorkSkillsLevelCoachTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO work_roles(code,name) VALUES('data','Data Analyst')")

    def readiness(self):
        approved_n, avg_score = self.db.execute(
            "SELECT COUNT(*),COALESCE(AVG(review_score),0) FROM work_tickets WHERE role_code='data' AND status='done' AND review_status='approved'"
        ).fetchone()
        skill_n = self.db.execute(
            "SELECT COUNT(*) FROM work_skill_evidence WHERE role_code='data' AND approved_tickets>0"
        ).fetchone()[0]
        return min(100, min(50, approved_n * 10) + min(30, skill_n * 5) + (min(20, round(avg_score * .2)) if approved_n else 0))

    def test_unapproved_mission_does_not_count_as_readiness(self):
        self.db.execute("INSERT INTO work_tickets(role_code,status,review_status,review_score) VALUES('data','in_progress','changes_requested',68)")
        self.assertEqual(self.readiness(), 0)

    def test_approved_evidence_increases_readiness(self):
        self.db.execute("INSERT INTO work_tickets(role_code,status,review_status,review_score) VALUES('data','done','approved',90)")
        self.db.execute("INSERT INTO work_skill_evidence(role_code,skill_key,skill_name,evidence_count,approved_tickets,score_total) VALUES('data','sql','SQL',1,1,90)")
        self.assertEqual(self.readiness(), 33)

    def test_same_skill_is_aggregated_instead_of_duplicated(self):
        self.db.execute("INSERT INTO work_skill_evidence(role_code,skill_key,skill_name,evidence_count,approved_tickets,score_total) VALUES('data','sql','SQL',1,1,90)")
        self.db.execute("UPDATE work_skill_evidence SET evidence_count=evidence_count+1,approved_tickets=approved_tickets+1,score_total=score_total+85 WHERE role_code='data' AND skill_key='sql'")
        row = self.db.execute("SELECT COUNT(*),approved_tickets,score_total FROM work_skill_evidence WHERE role_code='data' AND skill_key='sql'").fetchone()
        self.assertEqual(row, (1, 2, 175))

    def test_approved_assessment_unlocks_but_does_not_promote(self):
        self.db.execute("INSERT INTO work_level_assessments(role_code,from_level,target_level,status,readiness) VALUES('data','Foundation','Junior','ready',80)")
        self.db.execute("UPDATE work_roles SET promotion_ready=1 WHERE code='data'")
        role = self.db.execute("SELECT level,promotion_ready FROM work_roles WHERE code='data'").fetchone()
        self.assertEqual(role, ('Foundation', 1))

    def test_manual_promotion_changes_level_and_clears_unlock(self):
        self.db.execute("UPDATE work_roles SET promotion_ready=1 WHERE code='data'")
        self.db.execute("UPDATE work_roles SET level='Junior',level_index=1,promotion_ready=0 WHERE code='data'")
        self.assertEqual(self.db.execute("SELECT level,level_index,promotion_ready FROM work_roles WHERE code='data'").fetchone(), ('Junior', 1, 0))

    def test_frontend_and_backend_keep_v165_features(self):
        root = Path(__file__).resolve().parent.parent
        app_py = (root / 'app.py').read_text(encoding='utf-8')
        app_js = (root / 'static' / 'app.js').read_text(encoding='utf-8')
        self.assertRegex(app_py, r'VERSION = (?:16[5-9]|1[7-9]\d|[2-9]\d\d)')
        self.assertRegex(app_js, r'const FRONT_V = (?:16[5-9]|1[7-9]\d|[2-9]\d\d);')
        self.assertIn('/api/work/level/assessment/request', app_py)
        self.assertIn('SKILLS & LEVEL COACH', app_js)
        self.assertIn('Promote manually', app_js)


if __name__ == '__main__':
    unittest.main()
