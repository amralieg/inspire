import ast
import json
import math
import os
import re
import sqlite3
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

sqlglot = pytest.importorskip("sqlglot")

LONG_COLUMN = "c" * 70
KELVIN = "\u212a"
COLUMNS = (("entity_id", "string", "STRING"), ("value_at_stake", "double", "DOUBLE"), ("units", "bigint", "LONG"),
           ("price", "double", "DOUBLE"), ("label", "string", "STRING"), ("Mixed_Case", "decimal(10,2)", "DECIMAL"),
           ("prix_é", "double", "DOUBLE"), (LONG_COLUMN, "double", "DOUBLE"), ("tiny", "tinyint", "BYTE"), (KELVIN, "double", "DOUBLE"))
SCHEMA = [(name, kind) for name, kind, _api in COLUMNS]
CONSTANTS = {"RATE": 0.5, "WEEKS": 12, "NEG": -0.5, "ZERO": 0, "BIG": 1e14, "N" * 64: 2.0, "N" * 63: 3.0, "FLAG": True,
             "INF": float("inf"), "NAN": float("nan"), "HUGE": 10 ** 400, "TAUX_É": 0.2, "label": 2.0}
ROWS = [{"entity_id": "a", "value_at_stake": 10.0, "units": 4, "price": 2.5, "label": "x", "Mixed_Case": 1.5, "prix_é": 3.0,
         LONG_COLUMN: 1.0, "tiny": 1, KELVIN: 1.0},
        {"entity_id": "b", "value_at_stake": 0.0, "units": 0, "price": 0.0, "label": "y", "Mixed_Case": -2.0, "prix_é": 1.0,
         LONG_COLUMN: 2.0, "tiny": 0, KELVIN: 2.0},
        {"entity_id": "c", "value_at_stake": 7.25, "units": 13, "price": 1.75, "label": "z", "Mixed_Case": 100.0, "prix_é": 0.0,
         LONG_COLUMN: 0.0, "tiny": 3, KELVIN: 3.0}]


def _padded(length):
    text = "units * RATE"
    while len(text) + 4 <= length:
        text += " + 0"
    return text + "1" * (length - len(text)) if length > len(text) else text


CORPUS = [
    ("units * RATE", ["RATE"], True),
    ("greatest(0, units * RATE)", ["RATE"], True),
    ("least(units, price) * RATE", ["RATE"], True),
    ("GREATEST(units, price, 3) - Least(units, 1) * RATE", ["RATE"], True),
    ("((units + price) * (RATE - 1)) / WEEKS", ["RATE", "WEEKS"], True),
    ("(((units))) * ((RATE))", ["RATE"], True),
    ("-units * RATE", ["RATE"], True),
    ("units * -NEG", ["NEG"], True),
    ("units - -NEG", ["NEG"], True),
    ("- - units * RATE", ["RATE"], True),
    ("-(units - price) * -RATE", ["RATE"], True),
    ("units / ZERO * RATE", ["ZERO", "RATE"], True),
    ("units / (price - price) + RATE", ["RATE"], True),
    ("units * 0.5 * RATE", ["RATE"], True),
    ("007 * units * RATE", ["RATE"], True),
    ("UNITS * mixed_case * RATE", ["RATE"], True),
    ("tiny * BIG", ["BIG"], True),
    ("units *\tRATE\n", ["RATE"], True),
    ("units * " + "N" * 63, ["N" * 63], True),
    ("(" * 60 + "units * RATE" + ")" * 60, ["RATE"], True),
    (_padded(300), ["RATE"], True),
    (_padded(301), ["RATE"], False),
    ("units * RATE + " + " + ".join(["units"] * 80), ["RATE"], False),
    ("(" * 400 + "units * RATE" + ")" * 400, ["RATE"], False),
    ("1e3 * units * RATE", ["RATE"], False),
    (".5 * units * RATE", ["RATE"], False),
    ("5. * units * RATE", ["RATE"], False),
    ("units * RATE * UNKNOWN", ["RATE"], False),
    ("units * secret_column * RATE", ["RATE"], False),
    ("label * RATE", ["RATE"], False),
    ("units * label", ["label"], False),
    ("units * rate", ["RATE"], False),
    ("units * RATE; DROP TABLE x", ["RATE"], False),
    ("drop * units * RATE", ["RATE"], False),
    ("units * RATE -- comment", ["RATE"], False),
    ("units * RATE /* note */", ["RATE"], False),
    ("sum(units) * RATE", ["RATE"], False),
    ("sleep(units) * RATE", ["RATE"], False),
    ("greatest(units) * RATE", ["RATE"], False),
    ("greatest * units * RATE", ["RATE"], False),
    ("greatest(units, ) * RATE", ["RATE"], False),
    ("greatest() * RATE", ["RATE"], False),
    ("units * RATE)", ["RATE"], False),
    ("(units * RATE", ["RATE"], False),
    ("units RATE", ["RATE"], False),
    ("units ** RATE", ["RATE"], False),
    ("+units * RATE", ["RATE"], False),
    ("units * 'x' * RATE", ["RATE"], False),
    ("units * RATE + `price`", ["RATE"], False),
    ("prix_é * RATE", ["RATE"], False),
    ("units * TAUX_É", ["TAUX_É"], False),
    ("units * RATE", ["RATE", "WEEKS"], False),
    ("units * RATE * WEEKS", ["RATE"], False),
    ("RATE * WEEKS", ["RATE", "WEEKS"], False),
    ("units * " + "N" * 64, ["N" * 64], False),
    (LONG_COLUMN + " * RATE", ["RATE"], False),
    ("k * RATE", ["RATE"], False),
    ("units * INF", ["INF"], False),
    ("units * NAN", ["NAN"], False),
    ("units * FLAG", ["FLAG"], False),
    ("units * HUGE", ["HUGE"], False),
    ("", ["RATE"], False),
    ("   ", ["RATE"], False),
]


def _formula(shown):
    return "{units:number} units lost x " + " x ".join("{%s}" % name for name in shown)


def _notebook(ns, text, shown):
    value = {"basis": "measured", "currency": "USD", "amounts": {}, "formula": _formula(shown), "expression": text,
             "expression_required": True, "constants": {n: CONSTANTS[n] for n in CONSTANTS if n in shown or n in str(text)}}
    formula, problems = ns["inspire_value_formula"](value, SCHEMA)
    if problems:
        return None, value
    expression, problems = ns["inspire_value_expression"](value, SCHEMA, formula)
    assert (expression is None) == bool(problems), (text, problems)
    return expression, value


def _fields():
    return shell_sql.change_fields([{"name": name, "type": api} for name, _kind, api in COLUMNS])


def _shell(text, shown, edits=None):
    run = [{"name": n, "value": CONSTANTS[n], "kind": "number"} for n in shown]
    summary = {"value_formula": _formula(shown), "value_expression": text, "currency": "USD", "decision_basis": "measured",
               "value_assumptions": json.dumps(run, default=str)}
    return shell_sql.money_model(summary, _fields(), edits or [])


@pytest.mark.parametrize("text,shown,accepted", CORPUS, ids=[f"{i:02d}" for i in range(len(CORPUS))])
def test_the_notebook_and_the_app_accept_and_refuse_the_same_money_arithmetic(agent_ns, text, shown, accepted):
    expression, _value = _notebook(agent_ns, text, shown)
    model = _shell(text, shown)
    assert (expression is not None) is accepted, ("notebook", text, shown)
    assert model["recomputes"] is accepted, ("app", text, shown, model["problem"])
    if not accepted:
        assert model["problem"], "a refusal always says why"
        assert shell_sql.money_sql(dict(model, changed=True)) == "CAST(`value_at_stake` AS DOUBLE)"


def test_the_corpus_covers_every_kind_of_arithmetic_the_brief_names():
    texts = [text for text, _shown, _ok in CORPUS]
    assert len(CORPUS) >= 30 and sum(ok for _t, _s, ok in CORPUS) >= 15 and sum(not ok for _t, _s, ok in CORPUS) >= 15
    for needle in ("(((", "-NEG", "/ ZERO", "UNKNOWN", "secret_column", "DROP", "sum(", "greatest(", "least(", "1e3", ".5", "é"):
        assert any(needle in text for text in texts), needle
    assert any(len(text) > 300 for text in texts) and any(len(text) == 300 for text in texts)


def _oracle(text, row, constants):
    columns = {name.lower(): name for name in row}

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant):
            return float(node.value)
        if isinstance(node, ast.Name):
            return float(row[columns[node.id.lower()]]) if node.id.lower() in columns else float(constants[node.id])
        if isinstance(node, ast.UnaryOp):
            inner = walk(node.operand)
            return None if inner is None else -inner
        if isinstance(node, ast.Call):
            args = [walk(a) for a in node.args]
            if any(a is None for a in args):
                raise LookupError("a NULL inside greatest or least is engine-defined")
            return (max if node.func.id.lower() == "greatest" else min)(args)
        left, right = walk(node.left), walk(node.right)
        if left is None or right is None:
            return None
        if isinstance(node.op, ast.Div):
            return None if right == 0 else left / right
        return {ast.Add: left + right, ast.Sub: left - right, ast.Mult: left * right}[type(node.op)]

    return walk(ast.parse(re.sub(r"\b0+([0-9])", r"\1", " ".join(text.split())), mode="eval"))


def _sqlite_values(expression_sql):
    limit = sys.getrecursionlimit()
    sys.setrecursionlimit(max(limit, 20000))
    try:
        sql = sqlglot.parse_one(f"SELECT {expression_sql} AS v FROM `money_rows` ORDER BY `entity_id`", read="databricks").sql(
            dialect="sqlite")
    finally:
        sys.setrecursionlimit(limit)
    db = sqlite3.connect(":memory:")
    names = [name for name, _kind, _api in COLUMNS]
    db.execute(f'CREATE TABLE "money_rows" ({", ".join(chr(34) + n + chr(34) for n in names)})')
    db.executemany(f'INSERT INTO "money_rows" VALUES ({", ".join("?" for _ in names)})', [tuple(r[n] for n in names) for r in ROWS])
    return [row[0] for row in db.execute(sql).fetchall()]


def _latest_edits(sql, params, edits):
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE "churn_out_assumptions" (use_case_id, name, value, changed_by, changed_at, note, text_value)')
    db.executemany('INSERT INTO "churn_out_assumptions" VALUES (?, ?, ?, ?, ?, ?, NULL)', edits)
    return db.execute(tree.sql(dialect="sqlite"), params).fetchall()


@pytest.mark.parametrize("order", [(26.0, 30.0), (30.0, 26.0)])
def test_the_run_and_the_app_take_the_same_edit_when_two_land_at_the_same_instant(agent_ns, order):
    edits = [("N01-U01", "PRICE", value, who, "2026-10-23 09:00:00", "") for value, who in zip(order, ("sam.ortiz", "pat.lee"))]
    run = _latest_edits(agent_ns["inspire_assumptions_latest_sql"]("main.inspire.churn_out", "N01-U01"), {}, edits)
    sql, params = shell_sql.assumptions_query({"result_table": "main.inspire.churn_out", "use_case_id": "N01-U01"})
    app = _latest_edits(sql, {p["name"]: p["value"] for p in params}, edits)
    assert [(r["name"], r["value"]) for r in run] == [("PRICE", 30.0)], "the next run takes the same edit whichever was written first"
    assert (app[0]["name"], app[0]["value"]) == ("PRICE", 30.0), "the App shows the edit the next run uses"


@pytest.mark.parametrize("text,shown", [(t, s) for t, s, ok in CORPUS if ok], ids=[f"{i:02d}" for i, c in enumerate(CORPUS) if c[2]])
def test_accepted_arithmetic_gives_the_same_money_in_the_notebook_the_app_and_by_hand(agent_ns, text, shown):
    expression, value = _notebook(agent_ns, text, shown)
    edits = [{"name": n, "value": CONSTANTS[n], "changed_by": "pat"} for n in shown]
    run = [{"name": n, "value": CONSTANTS[n] + 1.0, "kind": "number"} for n in shown]
    summary = {"value_formula": _formula(shown), "value_expression": text, "value_assumptions": json.dumps(run)}
    model = shell_sql.money_model(summary, _fields(), edits)
    assert model["changed"] is True and model["recomputes"] is True, model["problem"]
    notebook = _sqlite_values(agent_ns["inspire_value_expression_sql"](expression, value))
    app = _sqlite_values(shell_sql.money_sql(model))
    assert notebook == app, text
    for row, got in zip(sorted(ROWS, key=lambda r: r["entity_id"]), notebook):
        try:
            want = _oracle(text, row, CONSTANTS)
        except LookupError:
            continue
        assert (got is None) == (want is None) and (want is None or math.isclose(got, want, rel_tol=1e-12, abs_tol=1e-12)), \
            (text, row["entity_id"], got, want)


def test_a_negative_assumption_after_a_minus_never_writes_a_sql_comment(agent_ns):
    expression, value = _notebook(agent_ns, "units - -NEG * -NEG", ["NEG"])
    sql = agent_ns["inspire_value_expression_sql"](expression, value)
    model = _shell("units - -NEG * -NEG", ["NEG"], [{"name": "NEG", "value": -0.25}])
    for text in (sql, shell_sql.money_sql(model)):
        assert "--" not in text, text
        assert "/*" not in text
    assert _sqlite_values(sql) == [3.75, -0.25, 12.75]


def test_the_two_parsers_share_one_grammar_and_one_length_limit(agent_ns):
    assert agent_ns["INSPIRE_VALUE_EXPRESSION_TOKEN"] == shell_sql.VALUE_TOKEN.pattern
    assert tuple(agent_ns["INSPIRE_VALUE_EXPRESSION_FUNCTIONS"]) == tuple(shell_sql.VALUE_FUNCTIONS)
    assert agent_ns["INSPIRE_VALUE_FORMULA_MAX_CHARS"] == shell_sql.VALUE_EXPRESSION_CHARS
    assert "^" + agent_ns["INSPIRE_VALUE_NAME"] + "$" == shell_sql.IDENT.pattern


def test_an_expression_without_an_assumption_checks_the_run_but_gives_the_app_nothing_to_change(agent_ns):
    expression, _value = _notebook(agent_ns, "units * price", [])
    assert expression is not None, "the run still checks its money against the arithmetic"
    model = _shell("units * price", [])
    assert model["recomputes"] is False and model["problem"] == "the money at stake formula of this use case names no assumption"


@pytest.mark.parametrize("value", [True, False, float("inf"), float("-inf"), float("nan"), 10 ** 400, "12", None])
def test_a_constant_that_is_not_a_finite_number_is_not_an_assumption(agent_ns, value):
    assert agent_ns["inspire_number_constant"](value) is False
    assert shell_sql.as_number(value) == (12.0 if value == "12" else None)


@pytest.mark.parametrize("value", [0, 12, -0.5, 1e14, 2 ** 60])
def test_a_finite_number_is_an_assumption(agent_ns, value):
    assert agent_ns["inspire_number_constant"](value) is True
    assert shell_sql.as_number(value) == float(value)


@pytest.mark.parametrize("formula,constants", [("{units:number} units x {TAUX_É}", {"TAUX_É": 2.0}),
                                               ("{units:number} units x {%s}" % ("N" * 64), {"N" * 64: 2.0}),
                                               ("{prix_é:money} a unit x {RATE}", {"RATE": 0.5}),
                                               ("{%s:number} x {RATE}" % LONG_COLUMN, {"RATE": 0.5})])
def test_a_formula_naming_a_name_the_app_cannot_hold_is_refused(agent_ns, formula, constants):
    value = {"basis": "measured", "currency": "USD", "amounts": {}, "formula": formula, "expression": None,
             "expression_required": False, "constants": constants}
    parsed, problems = agent_ns["inspire_value_formula"](value, SCHEMA)
    assert parsed is None and len(problems) == 1, problems
    assert "letters, digits and _" in problems[0] and "63" in problems[0], problems
    assert re.fullmatch(agent_ns["INSPIRE_VALUE_NAME"], "N" * 63) and not re.fullmatch(agent_ns["INSPIRE_VALUE_NAME"], "N" * 64)


def test_the_app_never_quotes_a_formula_column_it_cannot_name():
    summary = {"value_formula": "{prix_é:money} a unit x {%s:number} x {units} x {RATE}" % LONG_COLUMN, "value_expression": "units * RATE",
               "value_assumptions": json.dumps([{"name": "RATE", "value": 0.5, "kind": "number"}])}
    model = shell_sql.money_model(summary, _fields(), [{"name": "RATE", "value": 0.25}])
    assert model["columns"] == ["units"] and model["recomputes"] is True
    assert shell_sql.money_inputs_sql(model) == "concat_ws('|', COALESCE(CAST(`units` AS STRING), ''))"
