import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402
from v140_implement_test import _app_flow, _churn_page  # noqa: E402

with open(os.path.join(SHELL, "examples", "network_explorer.json"), encoding="utf-8") as _handle:
    NETWORK = json.load(_handle)

QUOTE = "The network is one picture; the lists under it carry the rest."


def test_a_layout_with_no_section_for_the_picked_kinds_of_chart_never_asks_for_them(capsys):
    assert shell_sql.placeable_chart_types(NETWORK) == set() and shell_sql.layout_takes_charts(NETWORK) is False
    assert shell_sql.kind_problems(NETWORK, ["trend", "bars"]) == ([], [])
    assert "[LAYOUT-KINDS SKIPPED] page=" in capsys.readouterr().out
    plain = {"charts": [{"type": "line"}]}
    assert shell_sql.layout_takes_charts(plain) is True and shell_sql.placeable_chart_types(plain) is None
    assert shell_sql.kind_problems(plain, ["trend", "bars"]) == (
        ["the page draws no bars by segment chart: add one of type bar or horizontal_bar or stacked_bar"], [])


def _network_flow(agent_ns, tmp_path, layout, outputs=None):
    page = _churn_page(agent_ns)
    page["charts"], page["fewer_charts"] = [], QUOTE
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=page, outputs=outputs or {})
    context.update(app_layout=layout, layout_tables={})
    inst._implement_app(context, None)
    return seen["errors"]


def test_a_layout_that_holds_none_of_the_minimum_charts_may_say_fewer_charts_without_a_customer_ask(agent_ns, tmp_path):
    [error] = _network_flow(agent_ns, tmp_path / "net", "network_explorer")
    assert "fewer_charts quotes" not in error and "the page draws no" not in error
    assert "the page has 0 charts; it needs 1 to 8" in error, "the graph section's own chart is still asked for"


def test_the_default_layout_still_refuses_a_fewer_charts_quote_the_customer_never_gave(agent_ns, tmp_path):
    [error] = _network_flow(agent_ns, tmp_path / "plain", "")
    assert f"fewer_charts quotes {QUOTE!r}, but the customer gave no asks for this App" in error
