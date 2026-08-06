from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'app.py').read_text(encoding='utf-8')
JS = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')


def test_v168_versions_are_synchronized():
    assert 'VERSION = 168' in APP
    assert 'const FRONT_V = 168;' in JS


def test_v168_starter_missions_are_complete_and_upgraded():
    assert 'Laura Gómez · Commercial Analytics Manager' in APP
    assert 'data_quality_report.md' in APP
    assert "UPDATE work_roles SET sprint_start=?" in APP
    assert "UPDATE work_roles SET sprint_end=?" in APP
    assert "due_date=CASE WHEN COALESCE(due_date,'')=''" in APP


def test_v168_market_missions_are_automatically_defined():
    assert "role_context={" in APP
    assert "due=(date.today()+timedelta(days=7)).isoformat()" in APP
    assert "VALUES(?,?,?,'ready','high','focus'" in APP


def test_v168_guides_the_user_and_explains_portfolio_lock():
    assert 'function workNextStep(ticket)' in JS
    assert 'WHAT DO I DO NOW?' in JS
    assert 'Portfolio is locked for now' in JS
    assert 'Complete and approve at least one mission first.' in JS


def test_v168_removes_version_label_from_mission_control():
    mission_render = JS[JS.index('function renderWorkMode()'):JS.index('async function openWorkMode()')]
    assert 'V167 portfolio operations' not in mission_render
    assert 'data-work-ticket-edit' in mission_render


def test_v168_new_missions_receive_guided_defaults():
    assert 'function workMissionDefaults(active)' in JS
    assert "value:t?.stakeholder||d.stakeholder" in JS
    assert "value:t?.due_date||workDatePlus(7)" in JS
    assert 'Mission created with guided defaults' in JS
