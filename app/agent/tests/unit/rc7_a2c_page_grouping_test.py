"""rc.7 A2c (REQ-012): the wizard's Data groups choice reaches the App page as its grouping. Its columns become top-bar filters that carry
the Work list's own labels, and a page built with no grouping gets no grouping at all."""
import copy
import os
import sys

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
    assert shell_sql.grouping_columns(with_grouping(page, [])) == set()


def test_a_grouping_column_the_work_list_does_not_show_adds_no_filter():
    page = with_grouping(returns_page(), ["region_code"])
    assert page["grouping"]["group_by"] == [{"column": "region_code", "label": "Region code"}]
    assert grouping_filters(page) == []


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
