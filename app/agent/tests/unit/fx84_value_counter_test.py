import datetime
import json
import os
import re
import sys

import pytest

from v165_review_links_test import _server

HERE = os.path.dirname(os.path.abspath(__file__))
DISCLAIMER = json.load(open(os.path.join(HERE, "..", "..", "..", "backend", "lib", "valueDisclaimer.json"), encoding="utf-8"))


def _basis(**over):
    return dict({"amount": 1000000.0, "currency": "USD", "status": "calculated", "case_noun": "claim", "cases_per_year": 1000.0,
                 "cases_from": "your data", "version": 2, "saved_at": "2026-11-20 10:00:00", "disclaimer": dict(DISCLAIMER)}, **over)


def _page():
    return {"id": "n01_u01", "use_case_id": "N01-U01", "result_table": "main.inspire.out", "records": {"label": "name"}}


def test_value_basis_clean_keeps_a_valid_basis_and_computes_the_per_case_value_once():
    sql = _server()["shell_sql"]
    kept = sql.value_basis_clean(_basis())
    assert kept["per_case"] == 1000.0 and kept["amount"] == 1000000.0 and kept["disclaimer"] == DISCLAIMER


@pytest.mark.parametrize("change", [
    {"amount": 0}, {"amount": -5}, {"amount": float("nan")}, {"amount": float("inf")}, {"amount": "1000"}, {"amount": True}, {"amount": None},
    {"currency": "usd"}, {"currency": "US"}, {"currency": "USD1"}, {"currency": None},
    {"cases_per_year": 0}, {"cases_per_year": -1}, {"cases_per_year": float("nan")}, {"cases_per_year": None},
    {"status": "guess"}, {"status": None},
    {"disclaimer": None}, {"disclaimer": {"short": "", "full": "x"}}, {"disclaimer": {"short": "x", "full": " "}}, {"disclaimer": {"short": "x"}},
])
def test_value_basis_clean_drops_each_invalid_field(change):
    assert _server()["shell_sql"].value_basis_clean(_basis(**change)) is None


@pytest.mark.parametrize("raw", [None, "x", [], 5])
def test_value_basis_clean_drops_a_basis_that_is_not_a_mapping(raw):
    assert _server()["shell_sql"].value_basis_clean(raw) is None


def test_resolved_counts_query_counts_my_done_closes_and_the_teams_since_go_live_with_bound_parameters():
    sql = _server()["shell_sql"]
    text, params = sql.resolved_counts_query(_page(), {"record_key", "action_status"}, "Me@Example.com", 1700000000000000, None)
    flat = text.replace("`", "")
    assert "_inspire_status = 'Done'" in flat
    assert re.search(r"lower\(_inspire_closer\) = :p\d+", flat)
    assert "me@example.com" not in text.lower() and "1700000000000000" not in text
    assert any(p["value"] == "me@example.com" and p["type"] == "STRING" for p in params)
    assert any(p["value"] == "1700000000000000" and p["type"] == "BIGINT" for p in params)
    assert "mine_n" in flat and "team_n" in flat and "weeks" in flat and "LIMIT 52" in flat


class _Counter:
    """A stand-in for the shell: only what value_counter reads."""

    def __init__(self, core, basis, rows=None, fail=False, actions=True, now=datetime.datetime(2026, 11, 25, 12, tzinfo=datetime.timezone.utc)):
        self.core, self.rows, self.fail, self.actions, self._now = core, rows, fail, actions, now
        self.settings = {"built_at": "2026-11-10T20:00:00Z", "value_basis": {"n01_u01": basis} if basis is not None else {}}
        self.page_ = _page()

    def page(self, ident):
        return self.page_

    def workspace(self, headers):
        return object(), "who"

    def table_fields(self, ws, who, page):
        return [{"name": "record_key"}, {"name": "action_status"}]

    def keeps_actions(self, ws, who, page, fields):
        return self.actions

    def history_for(self, ws, who, page, fields):
        return None

    def now(self):
        return self._now

    def run(self, ws, who, sql, params, limit, **kw):
        if self.fail:
            raise self.core.QueryError("boom")
        return {"rows": self.rows}

    def call(self, email="me@example.com"):
        headers = {"x-forwarded-email": email} if email else {}
        return self.core.Shell.value_counter(self, headers, "n01_u01")


def _counter(basis=None, **kw):
    core = _server()["shell_core"]
    return _Counter(core, _basis() if basis is None else basis, **kw)


def _week(offset):
    today = datetime.date(2026, 11, 25)
    return str(today - datetime.timedelta(days=today.weekday()) + datetime.timedelta(weeks=offset))


def test_the_counter_prices_each_resolved_case_from_the_saved_basis_and_carries_the_disclaimer():
    out = _counter(rows=[{"mine_n": 3, "team_n": 10, "weeks": ""}]).call()
    assert out["shown"] is True
    assert out["mine"] == {"cases": 3, "value": 3000.0} and out["team"] == {"cases": 10, "value": 10000.0}
    assert out["per_case"] == 1000.0 and out["currency"] == "USD" and out["case_noun"] == "claim" and out["status"] == "calculated"
    assert out["cases_from"] == "your data" and out["disclaimer"]["short"] == DISCLAIMER["short"]


def test_without_a_signed_in_person_the_counter_has_no_personal_line():
    out = _counter(rows=[{"mine_n": 0, "team_n": 4, "weeks": ""}]).call(email="")
    assert out["shown"] is True and out["mine"] is None and out["team"]["value"] == 4000.0
    assert out["streak_weeks"] == 0 and out["badges"] == [] and out["next_badge"] is None


def test_no_valid_basis_shows_nothing():
    assert _counter(basis={}, rows=[]).call() == {"shown": False}
    assert _counter(basis=_basis(amount=0), rows=[]).call() == {"shown": False}


def test_a_page_that_keeps_no_actions_shows_nothing():
    assert _counter(rows=[], actions=False).call() == {"shown": False}


def test_a_failed_read_shows_nothing_and_says_why():
    out = _counter(fail=True).call()
    assert out["shown"] is False and out["warning"]


@pytest.mark.parametrize("offsets, streak", [([0, -1, -2, -4], 3), ([-1, -2], 2), ([-1, -3], 1), ([0], 1), ([-2], 0), ([], 0)])
def test_the_streak_counts_consecutive_weeks_and_an_empty_current_week_does_not_break_it(offsets, streak):
    rows = [{"mine_n": 5, "team_n": 5, "weeks": ",".join(_week(o) for o in offsets)}]
    assert _counter(rows=rows).call()["streak_weeks"] == streak


def test_badges_follow_the_share_of_the_yearly_value_and_name_the_next_one():
    out = _counter(basis=_basis(amount=1000.0, cases_per_year=100.0), rows=[{"mine_n": 6, "team_n": 6, "weeks": ""}]).call()
    assert out["mine"]["value"] == 60.0
    assert [b["key"] for b in out["badges"]] == ["first", "p1", "p5"]
    assert out["next_badge"]["key"] == "p10" and out["next_badge"]["remaining"] == pytest.approx(40.0)


def test_no_resolved_case_earns_no_badge_and_the_first_is_next():
    out = _counter(rows=[{"mine_n": 0, "team_n": 0, "weeks": ""}]).call()
    assert out["badges"] == [] and out["next_badge"]["key"] == "first"
    assert not any(k in out for k in ("people", "rank", "leaders"))
