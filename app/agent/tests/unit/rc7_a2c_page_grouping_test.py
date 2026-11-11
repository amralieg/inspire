"""rc.7 A2c (REQ-012): the wizard's Data groups choice reaches the App page as its grouping. Its columns become top-bar filters that carry
the Work list's own labels, and a page built with no grouping gets no grouping at all."""
import copy
import os
import sys
import types

import pytest

from v161_app_column_filters_test import returns_page

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

GROUPED = ["channel", "return_reason"]


def with_grouping(page, names):
    out = copy.deepcopy(page)
    grouping = shell_sql.page_grouping(out, names)
    if grouping:
        out["grouping"] = grouping
    return out


def grouping_filters(page):
    return [f for f in shell_sql.list_column_filters(page) if f.get("grouping")]


def test_grouping_columns_become_top_filters_carrying_the_work_list_labels():
    page = with_grouping(returns_page(), GROUPED)
    shown = shell_sql.list_shown(page["records"])
    found = grouping_filters(page)
    assert [f["column"] for f in found] == GROUPED
    assert [f["label"] for f in found] == [shown["channel"][0], shown["return_reason"][0]]
    assert all(f["type"] == "multi_select" for f in found)
    assert page["grouping"] == {"mode": "columns", "group_by": [{"column": "channel", "label": shown["channel"][0]},
                                                               {"column": "return_reason", "label": shown["return_reason"][0]}]}


def test_the_grouping_names_the_business_label_of_each_column():
    grouping = shell_sql.page_grouping(returns_page(), ["Channel", "return_reason"])
    assert [g["label"] for g in grouping["group_by"]] == ["Channel", "Return reason"]
    assert [g["column"] for g in grouping["group_by"]] == ["Channel", "return_reason"]


def test_a_page_with_no_grouping_gets_no_grouping_filter_and_no_grouping():
    page = returns_page()
    assert shell_sql.page_grouping(page, []) == {}
    assert grouping_filters(page) == []
    assert grouping_filters(with_grouping(page, [])) == []
    assert shell_sql.grouping_entries(with_grouping(page, [])) == []


def test_a_grouping_column_the_work_list_does_not_show_still_gets_a_top_filter_with_its_business_label():
    page = with_grouping(returns_page(), ["region_code"])
    assert page["grouping"]["group_by"] == [{"column": "region_code", "label": "Region code"}]
    found = grouping_filters(page)
    assert [(f["column"], f["label"], f["type"]) for f in found] == [("region_code", "Region code", "multi_select")]


def test_a_grouping_flag_on_an_existing_list_filter_marks_it_without_a_duplicate():
    page = with_grouping(returns_page(), ["channel"])
    found = [f for f in shell_sql.list_column_filters(page) if f["column"] == "channel"]
    assert len(found) == 1 and found[0]["grouping"] is True


@pytest.mark.parametrize("value,columns", [("channel, return_reason", ["channel", "return_reason"]), ("channel", ["channel"]),
                                           ("all", None), ("custom", None), ("channel, all", None), ("", None)])
def test_the_notebook_writes_the_wizard_grouping_into_the_app_page(agent_ns, value, columns):
    settings = [{"name": "group_by", "source": "widget", "kind": "choice", "many": True, "group": "scope", "default": value,
                 "choices": ["channel", "return_reason"], "solo": ["all"]}]
    page = agent_ns["implement_app_page"](returns_page(), "N09-U03", {}, "main.shop.returns_out", settings, shell_sql=shell_sql)
    if columns is None:
        assert "grouping" not in page
    else:
        assert [g["column"] for g in page["grouping"]["group_by"]] == columns


def test_a_grouping_the_model_writes_itself_is_dropped_when_the_wizard_chose_none(agent_ns):
    page = dict(returns_page(), grouping={"mode": "columns", "group_by": [{"column": "channel", "label": "Channel"}]})
    built = agent_ns["implement_app_page"](page, "N09-U03", {}, "main.shop.returns_out", None)
    assert "grouping" not in built


@pytest.mark.parametrize("text,columns", [("channel", ["channel"]), ("channel, return_reason", ["channel", "return_reason"]),
                                         ("all", []), ("custom", []), ("channel, all", []), ("all, channel", []), ("", [])])
def test_the_app_reads_a_saved_grouping_value_the_way_the_wizard_does(text, columns):
    grouping = shell_sql.grouping_of(returns_page(), text)
    assert [g["column"] for g in grouping.get("group_by", [])] == columns


def stub_shell(rows):
    shell_core = sys.modules.get("shell_core") or __import__("shell_core")
    stub = types.SimpleNamespace(assumption_rows=lambda ws, who, page: rows)
    return shell_core.Shell, stub


@pytest.mark.parametrize("rows,columns", [
    ([{"name": "group_by", "text_value": "return_reason"}, {"name": "group_by", "text_value": "channel"}], ["return_reason"]),
    ([{"name": "group_by", "text_value": "all"}], []),
    ([{"name": "run_scope", "text_value": "records"}], None),
])
def test_the_saved_data_groups_setting_moves_the_grouping_without_a_rebuild(rows, columns):
    shell_class, stub = stub_shell(rows)
    page = with_grouping(dict(returns_page(), settings=[{"name": "group_by", "kind": "choice", "default": "channel"}]), ["channel"])
    live = shell_class.live_grouping(stub, None, None, page)
    if columns is None:
        assert live is page
        columns = ["channel"]
    else:
        assert [g["column"] for g in live.get("grouping", {}).get("group_by", [])] == columns
    assert [f["column"] for f in shell_sql.list_column_filters(live) if f.get("grouping")] == columns


def test_a_page_without_a_group_by_setting_never_reads_the_saved_rows():
    shell_class, _stub = stub_shell([])

    def boom(ws, who, page):
        raise AssertionError("no group_by setting, so no saved rows are read")

    stub = types.SimpleNamespace(assumption_rows=boom)
    page = dict(returns_page(), settings=[])
    assert shell_class.live_grouping(stub, None, None, page) is page


def test_the_notebook_call_site_passes_shell_sql_to_the_app_page_builder():
    import ast
    import _agentload
    tree = ast.parse(_agentload.agent_source())
    method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_implement_page_file")
    calls = [n for n in ast.walk(method) if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "implement_app_page"]
    assert len(calls) == 1
    keywords = {k.arg: k.value for k in calls[0].keywords}
    assert isinstance(keywords.get("shell_sql"), ast.Name) and keywords["shell_sql"].id == "shell_sql"
