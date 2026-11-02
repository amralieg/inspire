import datetime
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core
import shell_db
import shell_sql
from v141_app_shell_test import SETTINGS, call
from v144_app_ops_test import job_run
from v148_app_hub_test import TODAY
from v149_app_money_test import OWNER
from v149_impact_test import PERSON, ROWS as IMPACT_ROWS, Workspace, shell, v

sqlglot = pytest.importorskip("sqlglot")

JOB = "4100"
SINCE = (datetime.datetime.fromtimestamp(TODAY, datetime.timezone.utc) - datetime.timedelta(days=30)).date().isoformat()
OTHER = "@".join(["sam.roe", "example.com"])
ASSUMED = [("N01-U05", "WEEKS_LEFT_IN_SEASON", 6.0, OWNER, "2026-10-21 08:00:00", "Season ends early"),
           ("N01-U05", "WEEKS_LEFT_IN_SEASON", 5.0, OWNER, "2026-10-22 08:00:00", ""),
           ("N01-U05", "COST_PER_HOUR", 40.0, PERSON, "2026-08-01 08:00:00", "too old to count"),
           ("N02-U09", "COST_PER_HOUR", 45.0, PERSON, "2026-10-22 08:00:00", "another use case")]
RUNS = [job_run(9, "2026-10-23T08:00:00Z", "2026-10-23T08:20:00Z", trigger="ONE_TIME", by=PERSON),
        job_run(8, "2026-10-22T08:00:00Z", "2026-10-22T08:20:00Z", trigger="ONE_TIME", by=PERSON),
        job_run(7, "2026-10-20T06:00:00Z", "2026-10-20T06:20:00Z"),
        job_run(6, "2026-10-19T06:00:00Z", "2026-10-19T06:20:00Z", trigger="ONE_TIME", by="build"),
        job_run(5, "2026-09-01T08:00:00Z", "2026-09-01T08:20:00Z", trigger="ONE_TIME", by=OTHER)]
ROWS = IMPACT_ROWS + [v("e9", "Review", 80.0, "r4", at="2026-10-21 10:00:00", source="edit", changed_by=OTHER),
        v("n9", "Review", 30.0, "r4", at="2026-10-21 11:00:00", source="add", changed_by=OTHER)]
BUSINESS = ("value_at_stake", "entity_label", "action_note", "dismiss_reason", "realized_note", "realized_value", "`value`", "`note`")


class UsageWorkspace(Workspace):
    def __init__(self, rows=None, assumed=ASSUMED, runs=RUNS, **kw):
        super().__init__(ROWS if rows is None else rows, **kw)
        self.runs, self.job_calls = runs, []
        if assumed is not None:
            self.db.execute('CREATE TABLE "loss_desk_out_assumptions" (use_case_id, name, value, changed_by, changed_at, note)')
            self.db.executemany('INSERT INTO "loss_desk_out_assumptions" VALUES (?, ?, ?, ?, ?, ?)', assumed)

    def job_runs(self, job_id, active_only=False, limit=25):
        self.job_calls.append((job_id, active_only, limit))
        return {"runs": [] if active_only else self.runs[:limit], "more": False}


def admin(tmp_path, ws, headers, settings=None, query=None):
    owned = dict(SETTINGS, jobs={"n01_u05": JOB}, use_case_owners={"n01_u05": [OWNER]})
    s = shell(tmp_path, ws, settings=dict(owned, **(settings or {})))
    return call(s, "GET", "admin/usage", query=query, headers=headers)


def _expected():
    people = [r for r in ROWS if r["change_source"] in shell_sql.PEOPLE_SOURCES and r["valid_from"][:10] >= SINCE]
    counts = dict.fromkeys(shell_core.USAGE_KINDS, 0)
    for r in people:
        counts[r["change_source"]] += 1
    return counts, people


def test_an_owner_sees_who_used_each_use_case_from_what_the_app_already_keeps(tmp_path):
    ws = UsageWorkspace()
    status, out = admin(tmp_path, ws, {"x-forwarded-email": OWNER})
    assert status == 200, out
    counts, people = _expected()
    assert all(counts[k] for k in shell_core.USAGE_KINDS[:4]), "the fixture has every kind of change inside the window"
    counts.update(assumption=2, refresh=2)
    (page,) = out["pages"]
    assert (page["id"], page["counts"], page["total"], page["errors"]) == ("n01_u05", counts, sum(counts.values()), [])
    assert page["people"] == 3 and page["last"] == "2026-10-23T08:00:00Z"
    by = {p["who"]: p for p in out["people"]}
    assert set(by) == {PERSON, OWNER, OTHER}, "a run is never a person, so 'run r4' is not listed"
    assert (by[OTHER]["counts"]["edit"], by[OTHER]["counts"]["add"]) == (1, 1)
    assert by[OWNER]["counts"]["assumption"] == 2 and by[PERSON]["counts"]["refresh"] == 2 and by[PERSON]["pages"] == ["Desk n01_u05"]
    assert by[PERSON]["counts"]["action"] == len([r for r in people if r["change_source"] == "action"])
    assert [p["who"] for p in out["people"]] == [PERSON, OWNER, OTHER], "the person who changed something last comes first"
    assert (out["days"], out["since"], out["kinds"]) == (30, SINCE, list(shell_core.USAGE_KINDS))
    old = [r for r in ROWS if r["change_source"] == "action" and r["valid_from"][:10] < SINCE]
    assert old, "the fixture has an action older than 30 days, which must not count"


def test_the_usage_reads_who_what_and_when_and_never_a_record_s_values(tmp_path):
    ws = UsageWorkspace()
    admin(tmp_path, ws, {"x-forwarded-email": OWNER})
    used = [(sql, params) for sql, params, _limit in ws.sql if "GROUP BY `changed_by`" in sql]
    assert len(used) == 2, [s for s, _p, _l in ws.sql]
    for sql, params in used:
        picked = sqlglot.parse_one(sql, read="databricks").selects
        assert [s.alias_or_name for s in picked] == ["who", "what", "n", "at"], sql
        assert not [name for name in BUSINESS if name in sql], sql
        assert {"name": params[-1]["name"], "value": SINCE, "type": "DATE"} == params[-1]


@pytest.mark.parametrize("headers,query,status,text", [
    ({"x-forwarded-email": PERSON}, None, 403, "Only the owners of this App can open Admin"),
    ({"x-forwarded-email": PERSON}, {"user": OWNER, "email": OWNER}, 403, "Only the owners of this App can open Admin"),
    ({"x-forwarded-email": PERSON, "x-forwarded-user": OWNER}, None, 403, "Only the owners of this App can open Admin"),
    ({}, {"user": OWNER}, 401, "Sign in so the App can check that you own it before it opens Admin"),
])
def test_anyone_but_an_owner_is_refused_before_the_app_reads_anything(tmp_path, headers, query, status, text):
    ws = UsageWorkspace()
    got, out = admin(tmp_path, ws, headers, query=query)
    assert (got, out) == (status, {"error": text}), "the identity comes from the workspace's own headers, never from what the browser sends"
    assert ws.sql == [] and ws.job_calls == [], "a refusal reads no table and no job"


def test_every_owner_named_by_the_build_may_open_admin_and_an_app_with_none_says_so(tmp_path):
    status, out = admin(tmp_path, UsageWorkspace(), {"x-forwarded-preferred-username": PERSON.upper()},
                        settings={"use_case_owners": {"n01_u05": [PERSON]}})
    assert status == 200 and out["pages"][0]["counts"]["refresh"] == 2, "owners match the signed in name, case aside"
    status, out = admin(tmp_path / "builder", UsageWorkspace(), {"x-forwarded-email": OWNER}, settings={"use_case_owners": {"n01_u05": [PERSON]}})
    assert (status, out) == (403, {"error": "Only the owners of this App can open Admin"}), \
        "the person who built the App is not an owner by that alone"
    status, out = admin(tmp_path / "none", UsageWorkspace(), {"x-forwarded-email": OWNER}, settings={"use_case_owners": {}})
    assert (status, out) == (403, {"error": "No one can open Admin in this App, because it names no owner; build it again with Edit MVP on Inspire's Build page"})


def test_a_part_that_cannot_load_says_so_and_the_rest_still_counts(tmp_path):
    ws = UsageWorkspace(assumed=None, fail={"GROUP BY `changed_by`, `change_source`": shell_db.QueryError("PERMISSION_DENIED: no SELECT")})
    status, out = admin(tmp_path, ws, {"x-forwarded-email": OWNER})
    (page,) = out["pages"]
    assert status == 200 and page["errors"] == ["The changes people made could not load: PERMISSION_DENIED: no SELECT"]
    assert page["counts"]["refresh"] == 2 and page["counts"]["assumption"] == 0, "a use case with no assumption table has no assumption changes"


def test_the_assumption_owners_check_still_reads_as_before(tmp_path):
    s = shell(tmp_path, UsageWorkspace(), settings=dict(SETTINGS, use_case_owners={"n01_u05": [OWNER]}))
    page, model = s.pages[0], {"recomputes": True}
    assert s.assumption_refusal({}, page, model) == "Sign in so the App can record who changed the assumption"
    assert s.assumption_refusal({"x-forwarded-email": PERSON}, page, model) == "Only the owners of this use case can change its assumptions"
    assert s.assumption_refusal({"x-forwarded-email": OWNER}, page, model) == ""
