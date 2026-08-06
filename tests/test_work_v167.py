from pathlib import Path
import re

APP_JS = Path(__file__).resolve().parents[1] / "static" / "app.js"


def source():
    return APP_JS.read_text(encoding="utf-8")


def test_confirm_action_is_defined_before_work_calls():
    js = source()
    definition = js.find("async function confirmAction(")
    market_call = js.find("async function createWorkMarketMission(")
    assert definition >= 0
    assert market_call >= 0
    assert definition < market_call


def test_work_actions_use_central_async_error_boundary():
    js = source()
    assert "function runWorkAction(" in js
    assert "console.error('[Work Mode]', error)" in js
    assert "Market mission could not be created" in js
    assert "toggleWorkPortfolioChecklist(portfolioCheck)" in js


def test_all_work_click_actions_reference_declared_functions():
    js = source()
    declared = set(re.findall(r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", js))
    start = js.index("document.addEventListener('click', (e) => {")
    end = js.index("document.addEventListener('change', (e) => {", start)
    block = js[start:end]
    invoked = set(re.findall(r"=>\s*([A-Za-z_$][\w$]*)\s*\(", block))
    missing = sorted(name for name in invoked if name not in declared)
    assert missing == []


def test_market_mission_still_requires_confirmation():
    js = source()
    fn = re.search(
        r"async function createWorkMarketMission\(skill\)\{(?P<body>.*?)\nasync function editWorkPortfolio",
        js,
        re.S,
    )
    assert fn
    body = fn.group("body")
    assert "await confirmAction(" in body
    assert "if(!ok)return" in body
    assert "/api/work/market/mission" in body
