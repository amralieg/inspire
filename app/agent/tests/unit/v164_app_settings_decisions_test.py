import json
import os
import re
import sqlite3

import pytest

from v141_app_shell_test import SETTINGS, call
from v147_value_at_stake_test import _sqlite
from v149_app_money_test import ASSUMPTIONS, OWNER, SAM, _summary
from v163_app_settings_test import BASE, DECLARED, SettingsWorkspace, _shell
import shell_core
import shell_pg
import shell_sql

sqlglot = pytest.importorskip("sqlglot")
FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_change_classes.json")
TABLE = "main.pricing.loss_desk_out"
SHARES = [dict(BASE, name="act_now_share", label="Share of rows to act on now", group="flagging", kind="percent", unit="%", low=0, high=1,
               allowed="0 to 1", default="0.05"),
          dict(BASE, name="review_share", label="Share of rows to review next", group="flagging", kind="percent", unit="%", low=0, high=1,
               allowed="0 to 1", default="0.2")]
ALERT = dict(DECLARED[-1], reads_setting=True)
PREDICTED = ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "value_at_stake", "data_quality_flag", "use_case_id",
             "run_id", "as_of_date", "is_current", "change_source", "action_status", "held_back", "run_tier")
SUMMARY = ("use_case_id", "run_id", "currency", "decision_basis", "act_now_amount", "review_amount", "value_formula", "value_expression",
           "value_assumptions", "accepted", "passing_records", "act_now_share", "review_share", "act_now_capacity", "updated_at")


def _tier(rank, flag, cuts):
    if flag == "ok" and rank <= cuts[0]:
        return "Act now"
    return "Review" if flag == "ok" and rank <= cuts[1] else "Monitor"


def _rows(ranks, passed, shares, flags=None, dismissed=(), held=()):
    cuts = shell_sql.share_cuts(shares, passed)
    out = []
    for i, rank in enumerate(ranks):
        flag = (flags or {}).get(i, "ok")
        tier = _tier(rank, flag, cuts)
        out.append({"record_key": f"k{i:02d}", "entity_id": f"k{i:02d}", "entity_label": f"Item {i}", "priority_tier": "Held back"
                    if i in held and tier != "Monitor" else tier, "rank": rank, "value_at_stake": 10.0, "data_quality_flag": flag,
                    "use_case_id": "N01-U05", "run_id": "r4", "as_of_date": "2026-10-20", "is_current": 1, "change_source": "run",
                    "action_status": "Dismissed" if i in dismissed else None, "held_back": 1 if i in held else 0, "run_tier": tier})
    return out


class ShareWorkspace(SettingsWorkspace):
    def __init__(self, rows, passed, shares, capacity=None, accepted=True):
        super().__init__(summary=False)
        self.db.execute('DROP TABLE "loss_desk_out"')
        self.db.execute('DROP TABLE "loss_desk_out_summary"')
        self.db.execute(f'CREATE TABLE "loss_desk_out" ({", ".join(chr(34) + c + chr(34) for c in PREDICTED)})')
        self.db.executemany(f'INSERT INTO "loss_desk_out" VALUES ({", ".join("?" for _ in PREDICTED)})', [tuple(r[c] for c in PREDICTED) for r in rows])
        self.db.execute(f'CREATE TABLE "loss_desk_out_summary" ({", ".join(chr(34) + c + chr(34) for c in SUMMARY)})')
        row = {"use_case_id": "N01-U05", "run_id": "r4", "currency": "USD", "decision_basis": "predicted", "act_now_amount": None,
               "review_amount": None, "value_formula": None, "value_expression": None, "value_assumptions": None, "accepted": accepted,
               "passing_records": passed, "act_now_share": shares[0], "review_share": shares[1], "act_now_capacity": capacity,
               "updated_at": "2026-10-20 07:00:00"}
        self.db.execute(f'INSERT INTO "loss_desk_out_summary" VALUES ({", ".join("?" for _ in SUMMARY)})', tuple(row[c] for c in SUMMARY))


def _share_shell(tmp_path, rows, passed, shares=(0.05, 0.2), capacity=None, accepted=True):
    ws = ShareWorkspace(rows, passed, shares, capacity, accepted)
    return _shell(tmp_path, ws, declared=SHARES)


def _preview(s, name, value, who=OWNER):
    return call(s, "POST", "settings/preview", headers={"x-forwarded-email": who}, body={"page": "n01_u05", "name": name, "value": value})


def _agent_off_tier(agent_ns, rows, passed, shares):
    value = {"basis": "predicted", "currency": "USD", "amounts": {}, "accepted": True, "passed": passed,
             "shares": {"act_now_share": str(shares[0]), "review_share": str(shares[1])}}
    stage = [{k: r[k] for k in ("entity_id", "entity_label", "priority_tier", "rank", "value_at_stake", "data_quality_flag", "use_case_id",
                                "run_id", "as_of_date")} for r in rows]
    stage = [dict(r, priority_tier=x["run_tier"]) for r, x in zip(stage, rows)]
    return int(_sqlite(agent_ns["inspire_run_profile_sql"]("c.s.stage", list(stage[0]), value), stage)["off_share_tier"])


@pytest.mark.parametrize("family,ranks,passed,new_share", [
    ("A", list(range(1, 41)), 30, "0.2"),
    ("D", list(range(1, 61)), 60, "0.1"),
    ("E", list(range(1, 25)), 12, "0.5"),
    ("H", list(range(1, 201)), 150, "0.01"),
])
def test_a_share_preview_counts_what_the_next_run_writes_for_each_share_family(tmp_path, agent_ns, family, ranks, passed, new_share):
    rows = _rows(ranks, passed, (0.05, 0.2))
    s, _ws, _made = _share_shell(tmp_path, rows, passed)
    status, out = _preview(s, "act_now_share", new_share)
    assert status == 200 and out["exact"] is True, (family, out)
    moved = sum(m["n"] for m in out["moves"])
    assert moved == _agent_off_tier(agent_ns, rows, passed, (float(new_share), 0.2)) > 0, family
    cuts = shell_sql.share_cuts((float(new_share), 0.2), passed)
    expected = {}
    for r in rows:
        after = _tier(r["rank"], r["data_quality_flag"], cuts)
        if after != r["run_tier"]:
            expected[(r["run_tier"], after)] = expected.get((r["run_tier"], after), 0) + 1
    assert {(m["from"], m["to"]): m["n"] for m in out["moves"]} == expected, family


def test_tied_ranks_at_the_boundary_share_a_tier_in_the_preview_and_in_the_run(tmp_path, agent_ns):
    ranks = [1, 2, 2, 2, 5, 6, 7, 8, 9, 10]
    rows = _rows(ranks, 10, (0.1, 0.2))
    s, _ws, _made = _share_shell(tmp_path, rows, 10, shares=(0.1, 0.2))
    out = _preview(s, "act_now_share", "0.2")[1]
    assert out["moves"] == [{"from": "Review", "to": "Act now", "n": 3}], "the three rows tied at rank 2 move together"
    assert _agent_off_tier(agent_ns, rows, 10, (0.2, 0.2)) == 3


def test_the_preview_keeps_the_team_capacity_and_never_seats_a_dismissed_or_held_back_record(tmp_path, agent_ns):
    rows = _rows(list(range(1, 21)), 20, (0.1, 0.3), dismissed=(0,), held=(1,))
    s, _ws, _made = _share_shell(tmp_path, rows, 20, shares=(0.1, 0.3), capacity=3)
    out = _preview(s, "act_now_share", "0.4")[1]
    cuts = shell_sql.share_cuts((0.4, 0.3), 20)
    stage = [dict(r, priority_tier=_tier(r["rank"], "ok", cuts)) for r in rows]
    seats = agent_ns["inspire_capacity_seats_sql"]("c.s.stage", list(PREDICTED), ("record_key",), 0.0, None, "N01-U05")
    over = _seat_rows(seats, stage)
    final = {r["record_key"]: ("Review" if r["record_key"] in over else r["priority_tier"]) for r in stage}
    expected = {}
    for r in rows:
        if final[r["record_key"]] != r["run_tier"]:
            expected[(r["run_tier"], final[r["record_key"]])] = expected.get((r["run_tier"], final[r["record_key"]]), 0) + 1
    assert {(m["from"], m["to"]): m["n"] for m in out["moves"]} == expected and expected


def _seat_rows(seats, stage):
    held = [r for r in stage if r["action_status"] != "Dismissed" and not r["held_back"]]
    tree = sqlglot.parse_one(seats, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    db = sqlite3.connect(":memory:")
    db.execute(f'CREATE TABLE "stage" ({", ".join(chr(34) + c + chr(34) for c in PREDICTED)})')
    db.executemany(f'INSERT INTO "stage" VALUES ({", ".join("?" for _ in PREDICTED)})', [tuple(r[c] for c in PREDICTED) for r in held])
    return {k for k, seat in db.execute(tree.sql(dialect="sqlite")).fetchall() if seat > 3}


def test_lakebase_and_delta_give_the_same_share_preview(tmp_path):
    rows = _rows(list(range(1, 41)), 30, (0.05, 0.2))
    names = set(PREDICTED)
    moved = shell_sql.share_tier_sql(shell_sql.share_cuts((0.2, 0.2), 30), names)
    sql, params = shell_sql.tier_preview_query({"result_table": TABLE, "use_case_id": "N01-U05"}, moved, 4, names)
    held = {shell_pg.uc_key(TABLE): {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in PREDICTED]}}
    text, values, _read = shell_pg.render(sql, params, held)
    pg_tree = sqlglot.parse_one(text.replace("%(p0)s", "'N01-U05'"), read="postgres")
    delta_tree = sqlglot.parse_one(re.sub(r":p0", "'N01-U05'", sql), read="databricks")
    for tree in (pg_tree, delta_tree):
        for table in tree.find_all(sqlglot.exp.Table):
            table.set("catalog", None)
            table.set("db", None)
            table.set("this", sqlglot.exp.to_identifier("loss_desk_out"))
    counts = []
    for tree in (delta_tree, pg_tree):
        db = sqlite3.connect(":memory:")
        db.execute(f'CREATE TABLE "loss_desk_out" ({", ".join(chr(34) + c + chr(34) for c in PREDICTED)})')
        db.executemany(f'INSERT INTO "loss_desk_out" VALUES ({", ".join("?" for _ in PREDICTED)})', [tuple(r[c] for c in PREDICTED) for r in rows])
        counts.append(sorted(db.execute(tree.sql(dialect="sqlite")).fetchall()))
    assert counts[0] == counts[1] and counts[0], counts
    assert values == {"p0": "N01-U05"} and "`" not in text and "ROW_NUMBER() OVER" in text


def test_an_unaccepted_or_older_prediction_says_the_next_run_decides(tmp_path):
    rows = _rows(list(range(1, 11)), 10, (0.05, 0.2))
    s, _ws, _made = _share_shell(tmp_path / "a", rows, 10, accepted=False)
    assert _preview(s, "act_now_share", "0.3")[1] == {"exact": False, "moves": [], "text": shell_core.PREVIEW_UNACCEPTED}
    s, _ws, _made = _share_shell(tmp_path / "b", rows, None)
    assert _preview(s, "act_now_share", "0.3")[1] == {"exact": False, "moves": [], "text": shell_core.PREVIEW_OLD_SHARES}


def _ranged_shell(tmp_path, edits=()):
    ranged = json.dumps([{"name": "PRICE", "value": 20.0, "kind": "money", "low": 10, "high": 40},
                         {"name": "KEEP", "value": 0.5, "kind": "percent", "low": 0.2, "high": 0.9}])
    return _shell(tmp_path, SettingsWorkspace(summary=_summary(value_assumptions=ranged), edits=edits))


def test_a_declared_range_holds_in_the_app_s_settings_and_money_panel(tmp_path):
    s, ws, _made = _ranged_shell(tmp_path)
    view = call(s, "GET", "settings", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    price = {x["name"]: x for x in view["settings"]}["PRICE"]
    assert (price["low"], price["high"], price["allowed"]) == (10.0, 40.0, "10 to 40")
    assert call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                body={"page": "n01_u05", "name": "PRICE", "value": 50, "was": 20}) == (400, {"error": "PRICE is '50'; allowed: 10 to 40"})
    assert call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                body={"page": "n01_u05", "name": "KEEP", "value": "0.95", "was": "0.5"})[1] == {"error": "KEEP is '0.95'; allowed: 0.2 to 0.9"}
    assert not ws.queries("INSERT INTO")
    money = call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    assert {a["name"]: a["setting"]["allowed"] for a in money["model"]["assumptions"]} == {"PRICE": "10 to 40", "KEEP": "0.2 to 0.9"}
    assert call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                body={"page": "n01_u05", "name": "PRICE", "value": "30", "was": "20"})[0] == 200


def test_a_saved_value_outside_the_declared_range_is_not_the_value_the_app_shows(tmp_path):
    s, _ws, _made = _ranged_shell(tmp_path, edits=[("N01-U05", "PRICE", 55.0, SAM, "2026-10-23 09:00:00", "", None)])
    money = call(s, "GET", "money", query={"page": "n01_u05"}, headers={"x-forwarded-email": OWNER})[1]
    assert {a["name"]: a["value"] for a in money["model"]["assumptions"]}["PRICE"] == 20.0, "the run refuses 55, so the App shows 20"


def test_the_app_bounds_match_the_shared_fixture():
    fixture = json.load(open(FIXTURE))
    for case in fixture["assumption_settings"]:
        assert shell_sql.assumption_setting(case["name"], case["kind"], case["low"], case["high"]) == case["setting"], case
    for case in fixture["setting_values"]:
        assert shell_sql.setting_problem(case["setting"], case["value"]) == case["problem"], case


def _alert_shell(tmp_path, entry=ALERT):
    return _shell(tmp_path, SettingsWorkspace(), declared=DECLARED[:-1] + [entry])


def test_an_owner_changes_the_alert_threshold_in_the_app_and_the_alert_reads_it(tmp_path, agent_ns):
    s, ws, _made = _alert_shell(tmp_path)
    status, out = call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "alert_threshold", "value": "5", "was": "0", "note": "fewer emails"})
    assert status == 200, out
    assert {x["name"]: x for x in out["settings"]}["alert_threshold"]["value"] == "5"
    query = agent_ns["implement_alert_query"](shell_sql, TABLE, {"alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 1},
                                              threshold_from="N01-U05")
    assert query["column"] == "alert_value" and query["threshold"] == 1.0
    fired = lambda: ws.run_sql("wh1", query["query"].replace("COUNT_IF(priority_tier IN ('Act now'))",
                                                             "SUM(CASE WHEN priority_tier IN ('Act now') THEN 1 ELSE 0 END)"), [])["rows"][0]
    assert (fired()["alert_value"], fired()["alert_threshold"]) == (0, 5.0), "4 Act now records stay below the threshold the owner set"
    ws.db.execute("UPDATE \"loss_desk_out_assumptions\" SET \"changed_at\" = '2026-10-23 09:00:00' WHERE \"name\" = 'alert_threshold'")
    call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
         body={"page": "n01_u05", "name": "alert_threshold", "value": "2", "was": "5"})
    assert (fired()["alert_value"], fired()["alert_threshold"]) == (1, 2.0)


def test_a_non_owner_cannot_change_the_alert_and_an_older_alert_stays_on_the_build_page(tmp_path):
    s, ws, _made = _alert_shell(tmp_path)
    assert call(s, "POST", "settings/save", headers={"x-forwarded-email": SAM},
                body={"page": "n01_u05", "name": "alert_threshold", "value": "5", "was": "0"}) == (
        403, {"error": "Only the owners of this use case can change its settings"})
    s, ws, _made = _alert_shell(tmp_path / "old", dict(ALERT, reads_setting=False))
    status, out = call(s, "POST", "settings/save", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "alert_threshold", "value": "5", "was": "0"})
    assert status == 409 and "until the alert is built again" in out["error"] and not ws.queries("INSERT INTO")


def test_the_app_and_the_run_share_one_rank_cut_and_one_alert_setting_name(agent_ns):
    assert shell_sql.TIER_SHARES == agent_ns["INSPIRE_SHARE_NAMES"]
    assert shell_sql.ALERT_THRESHOLD_SETTING == agent_ns["INSPIRE_ALERT_THRESHOLD_SETTING"]
    for passed in (0, 1, 7, 10, 20, 33, 100, 1000):
        for shares in ((0.05, 0.2), (0.1, 0.3), (0.2, 0.2), (0.3, 0.7), (1.0, 0.0), (0.07, 0.13)):
            value = {"passed": passed, "shares": {"act_now_share": str(shares[0]), "review_share": str(shares[1])}}
            assert shell_sql.share_cuts(shares, passed) == agent_ns["inspire_share_cuts"](value), (passed, shares)
