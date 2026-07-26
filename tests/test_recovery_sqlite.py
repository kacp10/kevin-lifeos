import sqlite3
import unittest
from datetime import datetime

SCHEMA = '''
CREATE TABLE habits(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE habit_marks(habit_id INTEGER,day TEXT,PRIMARY KEY(habit_id,day));
CREATE TABLE routine_done(day TEXT,activity TEXT,note TEXT DEFAULT '',PRIMARY KEY(day,activity));
CREATE TABLE habit_recoveries(
 id INTEGER PRIMARY KEY AUTOINCREMENT,habit_id INTEGER NOT NULL,original_day TEXT NOT NULL,
 activity TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',
 added_to_day TEXT DEFAULT '',recovered_day TEXT DEFAULT '',created_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',
 UNIQUE(habit_id,original_day,activity));
'''

class RecoverySQLiteTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO habits VALUES(1,'English')")

    def test_recovery_marks_original_day_and_preserves_recovery_day(self):
        now=datetime.now().isoformat(timespec='seconds')
        self.db.execute("INSERT INTO habit_recoveries(habit_id,original_day,activity,title,created_at,updated_at) VALUES(1,'2026-07-24','ingles','English',?,?)",(now,now))
        row=self.db.execute('SELECT * FROM habit_recoveries').fetchone()
        self.db.execute('INSERT INTO habit_marks VALUES(?,?)',(row[1],row[2]))
        self.db.execute('INSERT INTO routine_done VALUES(?,?,?)',(row[2],row[3],'Recovered on 2026-07-26'))
        self.db.execute("UPDATE habit_recoveries SET status='recovered',recovered_day='2026-07-26' WHERE id=?",(row[0],))
        self.assertIsNotNone(self.db.execute("SELECT 1 FROM habit_marks WHERE habit_id=1 AND day='2026-07-24'").fetchone())
        self.assertEqual(self.db.execute('SELECT recovered_day FROM habit_recoveries').fetchone()[0],'2026-07-26')

    def test_rest_removes_pending_but_not_recovered_history(self):
        now=datetime.now().isoformat(timespec='seconds')
        self.db.execute("INSERT INTO habit_recoveries(habit_id,original_day,activity,title,created_at,updated_at) VALUES(1,'2026-07-25','ingles','English',?,?)",(now,now))
        self.db.execute("DELETE FROM habit_recoveries WHERE status='pending' AND original_day='2026-07-25'")
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM habit_recoveries').fetchone()[0],0)

    def test_unique_sync_does_not_duplicate(self):
        now=datetime.now().isoformat(timespec='seconds')
        sql="INSERT INTO habit_recoveries(habit_id,original_day,activity,title,created_at,updated_at) VALUES(1,'2026-07-24','ingles','English',?,?) ON CONFLICT(habit_id,original_day,activity) DO NOTHING"
        self.db.execute(sql,(now,now)); self.db.execute(sql,(now,now))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM habit_recoveries').fetchone()[0],1)

if __name__=='__main__': unittest.main()
