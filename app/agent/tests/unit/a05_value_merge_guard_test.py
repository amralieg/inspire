"""REQ-573 R12.1 (U7b review): pricing the run in inspire_merge_run never blocks the business output write.

The run prices its value spec after the output checks and before the write. A raise there (a bad stake_total, a calculator
bug) must print a plain "Value spec: not priced (...)" line and let the write go on, never stop the run silently or loudly."""
import ast
import json
import pathlib
import textwrap

from _nbload import notebook_cells

NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


def _merge_run():
    # D-SIZE2 (REQ-298): inspire_merge_run lives in the pinned result_history asset; _nbload splices it back into cells[1].
    src = "".join(s for kind, s in notebook_cells(str(NOTEBOOK)) if kind == "code")
    body = src[src.index("def inspire_merge_run("):src.index("def inspire_share_reads_sql(")]
    return ast.parse(textwrap.dedent(body)).body[0]


def _calls(node, name):
    return [n for n in ast.walk(node) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == name]


def test_1_pricing_sits_in_a_try_whose_handler_prints_not_priced():
    func = _merge_run()
    guarded = [t for t in ast.walk(func) if isinstance(t, ast.Try)
               and any(_calls(stmt, "inspire_value_calculate") for stmt in t.body)
               and any(_calls(stmt, "inspire_value_formula_spec") for stmt in t.body)]
    assert guarded, "inspire_value_formula_spec and inspire_value_calculate must run inside one try in inspire_merge_run"
    handler_text = [ast.unparse(h) for t in guarded for h in t.handlers]
    assert any("out(" in text and "not priced" in text for text in handler_text), \
        "the handler must print a 'Value spec: not priced (...)' line, never pass silently"
    assert not any(isinstance(stmt, ast.Raise) for t in guarded for h in t.handlers for stmt in ast.walk(h)), \
        "the handler must not re-raise: pricing never blocks the write"


def test_2_the_write_still_follows_the_pricing():
    func = _merge_run()
    text = ast.unparse(func)
    assert text.index("inspire_value_calculate(") < text.index("inspire_share_outputs("), \
        "the write and sharing come after pricing, so a pricing failure must not stop them"
