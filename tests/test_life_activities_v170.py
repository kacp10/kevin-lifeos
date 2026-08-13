from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'app.py').read_text(encoding='utf-8')
JS = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
HTML = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
STYLE = (ROOT / 'static' / 'style.css').read_text(encoding='utf-8')


def test_v170_versions_are_synchronized():
    server = int(re.search(r'VERSION = (\d+)', APP).group(1))
    browser = int(re.search(r'const FRONT_V = (\d+);', JS).group(1))
    assert server == browser == 170


def test_requested_daily_activity_defaults_are_present():
    assert "title: '🛏️ Room reset'" in JS
    assert "key: 'roomreset'" in JS
    assert "title: '🙏 Gratitude'" in JS
    assert "key: 'gratitude'" in JS
    assert "title: '🌙 Hunter Rest'" in JS
    assert "key: 'dormir'" in JS
    routine = JS[JS.index('function actividadesDelDia'):JS.index('function bloqueEstudio')]
    assert "V170_ACTIVITY_EFFECTIVE_DAY" in JS
    assert "? { t: '6:00', title: '🛏️ Room reset'" in routine
    assert "? { t: 'Sleep', title: '🌙 Hunter Rest'" in routine
    assert "if(v170Active) acts.push({ t: `${h}:55`, title: '🙏 Gratitude'" in routine


def test_gratitude_and_organization_habit_links_are_correct():
    mapping = JS[JS.index('const ACT_TO_HABIT'):JS.index('// Sub-tareas del bloque de inglés')]
    assert "roomreset: ['Be organized']" in mapping
    assert "morning: ['God and Spirituality', 'Be organized']" in mapping
    assert "gratitude: ['God and Spirituality']" in mapping
    assert "dormir: ['Sleep well']" in mapping
    assert "if(key==='ejercicio') return ['Exercise'];" in JS
    assert "if(key==='morning') return [];" in JS


def test_system_activities_can_be_renamed_relinked_deleted_and_restored():
    assert 'life_activity_overrides_v1' in JS
    assert "data-life-activity-edit" in JS
    assert "Delete this system activity permanently" in JS
    assert "Restore system default" in JS
    assert "manageLifeActivitiesBtn" in HTML
    assert "System activity restored" in JS
    # internal key remains unchanged when title/habits are customized
    assert 'saveLifeActivityOverrides' in JS
    assert 'lifeDefaultHabits' in JS


def test_custom_activities_can_be_edited_without_recreating_schedule():
    assert "@app.patch('/api/routine_extra/<int:i>')" in APP
    endpoint = APP[APP.index("@app.patch('/api/routine_extra/<int:i>')"):APP.index("@app.delete('/api/routine_extra/<int:i>')")]
    assert 'UPDATE routine_extra SET time=?, title=?, descr=?, habit=? WHERE id=?' in endpoint
    assert 'weekday' not in endpoint.split('UPDATE routine_extra SET',1)[1]
    assert "data-life-extra-edit" in JS
    assert "Edit custom activity" in JS


def test_habit_uncheck_keeps_synonym_behavior_with_overrides():
    sync = JS[JS.index('async function sincronizarHabito'):JS.index('// Rediferir cuotas')]
    assert 'defaultKeys = new Set' in sync
    assert 'lifeDefaultHabits(k, day).includes(habitName)' in sync
    assert 'sinonimos.some(s => hechasHoy.has(s))' in sync


def test_mobile_activity_controls_are_touch_friendly():
    compact = STYLE.replace(' ', '')
    assert '.edit-activity{' in STYLE
    assert '#manageLifeActivitiesBtn{width:100%}' in compact
    assert 'min-width:32px;min-height:32px' in compact


def test_continuity_prompt_contains_v170_rules():
    assert 'V170 Daily Activity Control' in JS
    assert 'Water + gratitude marca God and Spirituality + Be organized' in JS
