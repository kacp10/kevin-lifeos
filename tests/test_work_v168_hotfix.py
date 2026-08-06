from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.py").read_text(encoding="utf-8")


def test_v168_hotfix_recognizes_legacy_placeholders():
    assert "LOWER(TRIM(COALESCE(stakeholder,''))) IN ('', 'not assigned')" in APP
    assert "LOWER(TRIM(COALESCE(due_date,''))) IN ('', 'open')" in APP


def test_v168_hotfix_replaces_placeholders_but_preserves_custom_values():
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE work_tickets (code TEXT PRIMARY KEY, stakeholder TEXT, due_date TEXT)")
    con.executemany("INSERT INTO work_tickets VALUES (?,?,?)", [
        ("DATA-001", "Not assigned", "Open"),
        ("DATA-002", "Ana Pérez · BI Lead", "2026-08-20"),
    ])
    stakeholder = "Laura Gómez · Commercial Analytics Manager"
    due_date = "2026-08-13"
    for code in ("DATA-001", "DATA-002"):
        con.execute(
            """UPDATE work_tickets SET
               stakeholder=CASE WHEN LOWER(TRIM(COALESCE(stakeholder,''))) IN ('', 'not assigned') THEN ? ELSE stakeholder END,
               due_date=CASE WHEN LOWER(TRIM(COALESCE(due_date,''))) IN ('', 'open') THEN ? ELSE due_date END
               WHERE code=?""",
            (stakeholder, due_date, code),
        )
    first = con.execute("SELECT stakeholder,due_date FROM work_tickets WHERE code='DATA-001'").fetchone()
    second = con.execute("SELECT stakeholder,due_date FROM work_tickets WHERE code='DATA-002'").fetchone()
    assert first == (stakeholder, due_date)
    assert second == ("Ana Pérez · BI Lead", "2026-08-20")
