"""REQ-506 lane 4: the counter prices each resolved record by its own value at stake (per-case fallback), and GET value/leaders ranks
the people who resolved records here. The viewer sees their own name; every other person is User 1, User 2 (Amr, 2026-11-23)."""
import json

import pytest

from fx84_value_counter_test import _Counter, _basis, _page, _server
from v141_app_shell_test import call
from v144_app_data_test import EDITOR
from v211_genie_agent_test import agent_shell

ME = "@".join(["pat.lee", "example.com"])
OTHERS = ["@".join([n, "example.com"]) for n in ("sam.roe", "kim.ng", "lee.fox")]


class _Valued(_Counter):
    """The fx84 stand-in, with a value_at_stake column on the result table."""

    def table_fields(self, ws, who, page):
        return [{"name": "record_key"}, {"name": "action_status"}, {"name": "value_at_stake"}]

    def leaders(self, email=ME, name=None):
        headers = {"x-forwarded-email": email} if email else {}
        if name:
            headers["x-forwarded-preferred-username"] = name
        return self.core.Shell.value_leaders(self, headers, "n01_u01")


def _valued(basis=None, **kw):
    return _Valued(_server()["shell_core"], _basis() if basis is None else basis, **kw)


def test_resolved_counts_sum_the_value_at_stake_at_close_when_the_table_has_it():
    sql = _server()["shell_sql"]
    text, _ = sql.resolved_counts_query(_page(), {"record_key", "action_status", "value_at_stake"}, ME, 1700000000000000, None)
    flat = text.replace("`", "")
    assert "mine_v" in flat and "team_v" in flat and "_inspire_at_close" in flat
    assert "mine_n" in flat and "team_n" in flat, "the counts stay"


def test_the_counter_uses_each_records_own_value_when_the_read_carries_it():
    out = _valued(rows=[{"mine_n": 3, "team_n": 10, "mine_v": 4500.0, "team_v": 12000.0, "weeks": ""}]).call()
    assert out["mine"] == {"cases": 3, "value": 4500.0} and out["team"] == {"cases": 10, "value": 12000.0}


def test_the_counter_falls_back_to_the_per_case_value_when_no_record_value_is_known():
    out = _valued(rows=[{"mine_n": 3, "team_n": 10, "mine_v": None, "team_v": None, "weeks": ""}]).call()
    assert out["mine"] == {"cases": 3, "value": 3000.0} and out["team"] == {"cases": 10, "value": 10000.0}


def test_the_leaders_query_groups_closes_by_closer_since_go_live_with_bound_parameters():
    sql = _server()["shell_sql"]
    text, params = sql.value_leaders_query(_page(), {"record_key", "action_status", "value_at_stake"}, 1700000000000000, None)
    flat = text.replace("`", "")
    assert "GROUP BY" in flat and "_inspire_closer" in flat and "_inspire_status = 'Done'" in flat
    assert " AS closer" in flat and " AS records" in flat and " AS value" in flat
    assert "1700000000000000" not in text and any(p["value"] == "1700000000000000" for p in params)


BOARD = [{"closer": OTHERS[0], "records": 5, "value": 9000.0}, {"closer": ME.title(), "records": 3, "value": 3000.0},
         {"closer": OTHERS[1], "records": 4, "value": None}, {"closer": "run 7", "records": 2, "value": 100.0}, {"closer": None, "records": 1, "value": 1.0}]


def test_the_board_ranks_by_value_and_names_only_the_viewer():
    out = _valued(rows=[dict(r) for r in BOARD]).leaders(name="Pat Lee")
    assert out["shown"] is True and out["currency"] == "USD" and out["people"] == 3, "only people, never a run or a blank closer"
    assert [(r["rank"], r["name"], r["value"], r["records"], r["me"]) for r in out["leaders"]] == [
        (1, "User 1", 9000.0, 5, False), (2, "User 2", 4000.0, 4, False), (3, "Pat Lee", 3000.0, 3, True)]
    assert out["me"] == {"rank": 3, "value": 3000.0, "records": 3}
    text = json.dumps(out).lower()
    for other in OTHERS + ["sam", "kim", "example.com"]:
        assert other not in text, f"the reply names nobody but the viewer: {other}"


def test_without_a_display_name_the_viewer_is_the_part_of_the_email_before_the_at():
    out = _valued(rows=[dict(r) for r in BOARD]).leaders()
    mine = [r for r in out["leaders"] if r["me"]]
    assert [r["name"] for r in mine] == ["pat.lee"]
    assert "example.com" not in json.dumps(out)


def test_a_viewer_who_resolved_nothing_has_no_rank_and_everyone_is_user_n():
    out = _valued(rows=[dict(r) for r in BOARD[:1] + BOARD[2:3]]).leaders()
    assert out["me"] == {"rank": None, "value": 0, "records": 0}
    assert [r["name"] for r in out["leaders"]] == ["User 1", "User 2"] and not any(r["me"] for r in out["leaders"])


def test_the_board_shows_the_top_10_and_my_row_when_i_am_below_them():
    rows = [{"closer": f"p{i}@example.org", "records": 1, "value": float(100 - i)} for i in range(14)]
    rows.insert(12, {"closer": ME, "records": 1, "value": 88.5})
    out = _valued(rows=rows).leaders()
    assert len(out["leaders"]) == 11 and out["leaders"][-1]["me"] is True and out["leaders"][-1]["rank"] == 13
    assert [r["name"] for r in out["leaders"][:10]] == [f"User {i}" for i in range(1, 11)]
    assert out["people"] == 15 and "example.org" not in json.dumps(out)


@pytest.mark.parametrize("make", [lambda: _valued(basis={}, rows=[]), lambda: _valued(rows=[], actions=False)])
def test_no_basis_or_no_actions_shows_no_board(make):
    assert make().leaders() == {"shown": False}


def test_a_failed_read_shows_no_board_and_says_why():
    out = _valued(fail=True).leaders()
    assert out["shown"] is False and out["warning"]


def test_the_counter_reply_still_names_no_other_person():
    out = _valued(rows=[{"mine_n": 3, "team_n": 10, "mine_v": 4500.0, "team_v": 12000.0, "weeks": ""}]).call()
    assert not any(k in out for k in ("people", "rank", "leaders"))


def test_the_shell_answers_get_value_leaders(tmp_path):
    s, _ws, _made = agent_shell(tmp_path)
    status, out = call(s, "GET", "value/leaders", query={"page": "n01_u05"}, headers=EDITOR)
    assert status == 200 and out == {"shown": False}, (status, out)
