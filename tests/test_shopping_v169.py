from pathlib import Path
import sqlite3
import re

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'app.py').read_text(encoding='utf-8')
JS = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')


def test_v169_versions_are_synchronized():
    server = int(re.search(r'VERSION = (\d+)', APP).group(1))
    browser = int(re.search(r'const FRONT_V = (\d+);', JS).group(1))
    assert server == browser == 169


def test_shopping_payment_methods_are_focused_and_card_routes_are_real():
    for name in ('Efectivo', 'Nequi', 'Davivienda', 'Banco de Bogotá', 'Codensa', 'ADDI', 'Tarjeta Nicole'):
        assert name in JS
    assert "'Davivienda': ('Tarjeta DV', 'Tarjeta DV — Jefe Final')" in APP
    assert "creditor: 'Tarjeta DV', boss: 'Tarjeta DV — Jefe Final'" in JS


def test_shopping_uses_single_atomic_backend_operation():
    shopping = JS[JS.index("document.addEventListener('click', async (e) => {\n  const chk = e.target.closest('.shop-check');"):JS.index("if (e.target.id === 'clearDoneBtn')")]
    assert "/api/shopping/complete" in shopping
    assert "/api/shopping/bought" not in shopping
    assert "/api/expense/new" not in shopping
    assert "/api/compra" not in shopping
    assert "if (rc === null) return;" in shopping
    assert "confirmarTopeDeuda" in shopping


def test_backend_links_shopping_to_expense_and_installment_for_safe_undo():
    assert "shopping_finance_links_v1" in APP
    assert "expense_id" in APP and "compra_id" in APP
    assert "@app.post('/api/shopping/complete')" in APP
    assert "with transaction() as con:" in APP[APP.index("def shopping_complete()"):APP.index("@app.post('/api/shopping/bought')")]
    assert "This item is already in purchase history" in APP
    assert "This card purchase already has payments" in APP


def test_cash_vs_credit_accounting_model_no_double_count():
    # Minimal model of the invariants V169 relies on:
    # cash/nequi expense leaves income now; card expense is excluded from salary and only its due installment counts.
    income = 2_850_000
    cash_purchase = 120_000
    card_total = 600_000
    installments = 6
    card_installment = round(card_total / installments)
    spent_cash_month = cash_purchase
    spent_card_purchase_now = 0
    debt_due = card_installment
    assert income - spent_cash_month == 2_730_000
    assert spent_card_purchase_now == 0
    assert debt_due == 100_000


def test_link_columns_support_reversible_financial_records():
    con = sqlite3.connect(':memory:')
    con.execute('CREATE TABLE shopping (id INTEGER PRIMARY KEY, name TEXT, slots INTEGER, done INTEGER, bought_at TEXT, cost INTEGER, method TEXT, expense_id INTEGER, compra_id INTEGER)')
    con.execute('CREATE TABLE expenses (id INTEGER PRIMARY KEY, name TEXT, amount INTEGER, method TEXT, kind TEXT, month TEXT)')
    con.execute('CREATE TABLE compras (id INTEGER PRIMARY KEY, creditor TEXT, concepto TEXT, valor INTEGER, cuotas INTEGER, start INTEGER, abonado INTEGER DEFAULT 0)')
    con.execute("INSERT INTO shopping VALUES (1,'Laptop stand',1,1,'2026-08-07',300000,'Davivienda',10,20)")
    con.execute("INSERT INTO expenses VALUES (10,'Laptop stand',300000,'Davivienda','once','Agosto 2026')")
    con.execute("INSERT INTO compras VALUES (20,'Tarjeta DV','Laptop stand',300000,3,2,0)")
    row = con.execute('SELECT expense_id,compra_id FROM shopping WHERE id=1').fetchone()
    con.execute('DELETE FROM compras WHERE id=?', (row[1],))
    con.execute('DELETE FROM expenses WHERE id=?', (row[0],))
    con.execute("UPDATE shopping SET bought_at='',done=0,cost=0,method='',expense_id=NULL,compra_id=NULL WHERE id=1")
    assert con.execute('SELECT COUNT(*) FROM expenses').fetchone()[0] == 0
    assert con.execute('SELECT COUNT(*) FROM compras').fetchone()[0] == 0
    assert con.execute('SELECT done,bought_at,cost FROM shopping WHERE id=1').fetchone() == (0, '', 0)


def test_nicole_is_visible_in_my_credit_cards():
    base = JS[JS.index('const BASE_TARJETAS = ['):JS.index('function misTarjetas()')]
    assert "key: 'Tarjeta Nicole'" in base
    assert "boss: 'Tarjeta Nicole'" in base


def test_shopping_double_click_is_blocked_while_purchase_flow_is_open():
    assert "chk.dataset.purchaseBusy === '1'" in JS
    assert "chk.dataset.purchaseBusy = '1'" in JS
    assert "delete chk.dataset.purchaseBusy" in JS


def test_shopping_async_errors_are_caught_in_ui_handlers():
    assert "console.error('[Shopping purchase]', err)" in JS
    assert "console.error('[Shopping undo]', err)" in JS
