import sys

import pytest

from v140_implement_test import VALID
from v165_review_links_test import _server

URL = VALID["outputs"]["inspire_url"]


def _facts():
    _server()
    return sys.modules["shell_facts"]
RUN = f"{URL}/?review=5150"


def _settings(agent_ns, **extra):
    return agent_ns["implement_app_settings"](1, "Churn desk", ["n01_u01"], None, "", "2026-11-11T00:00:00Z", outputs=VALID["outputs"], **extra)


def test_the_more_use_cases_link_names_the_run_on_inspire_review(agent_ns):
    assert agent_ns["implement_run_review_link"](URL, 5150) == RUN
    assert agent_ns["implement_run_review_link"](URL, "2222222222222222222") == f"{URL}/?review=2222222222222222222"
    assert agent_ns["implement_run_review_link"]("", 5150) == ""


def test_the_app_keeps_the_run_review_link_it_is_given_and_drops_it_when_there_is_none(agent_ns):
    assert _settings(agent_ns, review_run=RUN)["review_run"] == RUN
    assert "review_run" not in _settings(agent_ns)


@pytest.mark.parametrize("value, served", [
    (RUN, RUN),
    ("javascript:alert(1)", ""),
    ("http://inspire.example.com/?review=5150", ""),
    (f"{URL}/?review=5150&uc=N01-U01", ""),
    (f"{URL}/?review=5 150", ""),
    (5150, ""),
    (["x"], ""),
    (None, ""),
])
def test_the_shell_serves_only_a_run_link_on_inspire_review(value, served):
    assert _server()["shell_sql"].run_review_link(value) == served


def test_the_shell_serves_the_run_link_inspire_writes(agent_ns):
    link = agent_ns["implement_run_review_link"](URL, 5150)
    assert _server()["shell_sql"].run_review_link(link) == link


def _app_info(settings):
    from unittest import mock
    shell_core = _server()["shell_core"]
    stub = mock.MagicMock()
    stub.settings = dict({"title": "Churn desk", "style": "a", "palette": "p", "theme": "t", "layout": "l", "auth": "sp"}, **settings)
    stub.pages = []
    stub.by_id = {}
    stub.inside = settings.get("inside", False)
    return shell_core.Shell.app_info(stub, {})


@pytest.mark.parametrize("review_run, served", [
    ("https://inspire.example.com/?review=5150", "https://inspire.example.com/?review=5150"),
    ("javascript:alert(1)", ""),
    ("https://inspire.example.com/?review=5150&uc=N01-U01", ""),
    (None, ""),
])
def test_the_app_info_the_page_reads_carries_the_run_review_link_only_when_it_is_inspires_review(review_run, served):
    info = _app_info({"review_run": review_run} if review_run is not None else {})
    assert info["review_run"] == served


SINCE = "2026-11-10T20:00:00Z"
TABLE = "main.inspire.__inspire_value_ledger"


def test_the_saved_total_since_go_live_counts_each_record_once_by_its_latest_state_and_only_after_go_live():
    sql = _facts().ledger_saved_since_sql(TABLE, "main.inspire.churn_out", "N01-U01", SINCE)
    assert "recorded_at >= CAST('2026-11-10T20:00:00Z' AS TIMESTAMP)" in sql
    assert "record_key IS NOT NULL" in sql and "ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id, record_key" in sql
    assert "WHERE rn = 1 AND saved IS NOT NULL" in sql, "a record whose latest row is a clear counts nothing"
    assert "GROUP BY kind, currency, unit" in sql, "currencies and units are never added together"
    assert "result_table = 'main.inspire.churn_out'" in sql and "use_case_id = 'N01-U01'" in sql


@pytest.mark.parametrize("since", ["", None, "2026-11-10", "2026-11-10 20:00:00", "2026-11-10T20:00:00Z'; DROP TABLE x --"])
def test_a_go_live_date_that_is_not_an_iso_timestamp_is_refused_before_it_reaches_sql(since):
    with pytest.raises(ValueError):
        _facts().ledger_saved_since_sql(TABLE, "main.inspire.churn_out", "N01-U01", since)


def test_the_app_reads_its_saved_rows_since_its_go_live_and_says_so_when_there_is_no_go_live_date():
    from unittest import mock
    shell_core = _server()["shell_core"]
    rows = [{"kind": "money", "currency": "AED", "unit": "a year", "amount": 12000.0, "records": 3}]
    stub = mock.MagicMock()
    stub.settings = {"built_at": SINCE}
    stub.ledger_writer = lambda ws: ws
    stub.execute = mock.MagicMock(return_value={"rows": rows})
    page = {"result_table": "main.inspire.churn_out", "use_case_id": "N01-U01", "value_ledger": TABLE}
    out = shell_core.Shell.saved_value(stub, "ws", page)
    assert out == {"since": SINCE, "lines": rows, "warning": ""}
    assert "CAST('2026-11-10T20:00:00Z' AS TIMESTAMP)" in stub.execute.call_args[0][1]
    stub.settings = {}
    out = shell_core.Shell.saved_value(stub, "ws", page)
    assert out["lines"] == [] and out["warning"].startswith("the App has no go-live date")
    assert out["since"] == ""
    assert shell_core.Shell.saved_value(stub, "ws", {"result_table": "t", "use_case_id": "u"})["lines"] == []
