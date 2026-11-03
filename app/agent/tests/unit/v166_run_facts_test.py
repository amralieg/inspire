import datetime
import json
import os
import random
import sys

import psycopg
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_facts  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import app_dir, call  # noqa: E402
from v145_lakebase_test import PG_ENV, PG_SCHEMA, CredentialWorkspace, postgres  # noqa: E402,F401

UTC = datetime.timezone.utc
TABLE = "main.ops.facts_out"
LOG = f"{TABLE}_run_log"
ACTED = f"{TABLE}_acted"
STAMP = datetime.datetime(2026, 9, 29, 6, tzinfo=UTC)
STAMP_US = int(STAMP.timestamp() * 1_000_000)
COLUMNS = [("record_key", "STRING", "text"), ("use_case_id", "STRING", "text"), ("run_id", "STRING", "text"), ("as_of_date", "DATE", "date"),
           ("rank", "INT", "integer"), ("priority_tier", "STRING", "text"), ("entity_label", "STRING", "text"),
           ("value_at_stake", "DOUBLE", "double precision"), ("action_owner", "STRING", "text"), ("action_status", "STRING", "text"),
           ("action_due", "DATE", "date"), ("action_outcome", "STRING", "text"), ("dismiss_reason", "STRING", "text"),
           ("realized_value", "DOUBLE", "double precision"), ("realized_note", "STRING", "text"),
           ("not_listed_since", "TIMESTAMP", "timestamptz"), ("held_back", "BOOLEAN", "boolean"),
           ("run_tier", "STRING", "text"), ("valid_from", "TIMESTAMP", "timestamptz"), ("valid_to", "TIMESTAMP", "timestamptz"),
           ("is_current", "BOOLEAN", "boolean"), ("change_source", "STRING", "text"), ("changed_by", "STRING", "text")]
NAMES = {n for n, _t, _pg in COLUMNS}
LOG_COLUMNS = [("use_case_id", "STRING", "text"), ("run_id", "STRING", "text"), ("as_of_date", "DATE", "date"), ("ran_at", "TIMESTAMP", "timestamptz"),
               ("record_key", "STRING", "text"), ("rank", "INT", "integer"), ("tier", "STRING", "text"), ("held_back", "BOOLEAN", "boolean"),
               ("run_tier", "STRING", "text"), ("first_run", "STRING", "text"), ("change", "STRING", "text"), ("moved_to", "STRING", "text")]
RUNS = {"r3": 15, "r4": 22, "r5": 29}
PLAIN = "main.ops.plain_out"
CLOSED = f"{TABLE}_closed"
PG_KINDS = {"STRING": "text", "TIMESTAMP": "timestamptz", "DOUBLE": "double precision", "INT": "integer"}
HM_COLUMNS = [(name, kind, PG_KINDS[kind]) for name, kind in shell_facts.CLOSED_COLUMNS]
PLAIN_COLUMNS = [c for c in COLUMNS if c[0] != "value_at_stake"]


def at(day, hour=6):
    return datetime.datetime(2026, 9, day, hour, tzinfo=UTC)


def version(key, run, tier, stake, valid_from, valid_to=None, current=False, source="run", status=None, owner=None, outcome=None,
            held=None, run_tier=None, realized=None):
    return {"record_key": key, "use_case_id": "U1", "run_id": run, "as_of_date": datetime.date(2026, 9, RUNS.get(run, 29)), "rank": 1,
            "priority_tier": tier, "entity_label": f"Item {key}", "value_at_stake": stake, "action_owner": owner, "action_status": status,
            "action_due": None, "action_outcome": outcome, "dismiss_reason": None, "realized_value": realized, "realized_note": None,
            "not_listed_since": None, "held_back": held, "run_tier": run_tier or tier, "valid_from": valid_from, "valid_to": valid_to,
            "is_current": current,
            "change_source": source, "changed_by": "pat" if source != "run" else f"run {run}"}


SNAPSHOT = [
    version("a", "r5", "Act now", 500.0, at(29), current=True),
    version("b", "r3", "Review", 200.0, at(15), at(16, 9)),
    version("b", "r3", "Review", 200.0, at(16, 9), at(22), source="action", status="In progress", owner="sam@example.com"),
    version("b", "r5", "Review", 200.0, at(29), current=True, status="In progress", owner="sam@example.com"),
    version("c", "r3", "Act now", 300.0, at(15), at(17, 9)),
    version("c", "r3", "Act now", 300.0, at(17, 9), at(22), source="action", status="Done", owner="pat@example.com"),
    version("c", "r5", "Monitor", 20.0, at(29), current=True, status="Done", owner="pat@example.com", outcome="Resolved"),
    version("d", "r4", "Review", 90.0, at(22), at(29)),
    version("e", "r5", "Held back", 400.0, at(29), current=True, held=True, run_tier="Act now"),
]
LOGGED = [(key, run, tier, held, run_tier) for key, run, tier, held, run_tier in (
    ("a", "r3", "Act now", False, "Act now"), ("a", "r4", "Act now", False, "Act now"), ("a", "r5", "Act now", False, "Act now"),
    ("b", "r3", "Review", False, "Review"), ("b", "r4", "Review", False, "Review"), ("b", "r5", "Review", False, "Review"),
    ("c", "r3", "Act now", False, "Act now"), ("c", "r4", "Monitor", False, "Monitor"), ("c", "r5", "Monitor", False, "Monitor"),
    ("d", "r4", "Review", False, "Review"), ("e", "r4", "Held back", True, "Act now"), ("e", "r5", "Held back", True, "Act now"))]


def log_rows():
    return [{"use_case_id": "U1", "run_id": run, "as_of_date": datetime.date(2026, 9, RUNS[run]), "ran_at": at(RUNS[run]), "record_key": key,
             "rank": 1, "tier": tier, "held_back": held, "run_tier": run_tier, "first_run": "r3", "change": None, "moved_to": None}
            for key, run, tier, held, run_tier in LOGGED]


def after_writes():
    rows = [dict(r) for r in SNAPSHOT]
    wrote = at(30, 10)
    for row in rows:
        if row["is_current"] and row["record_key"] in ("a", "e"):
            row.update(is_current=False, valid_to=wrote)
    rows.append(version("a", "r5", "Act now", 500.0, wrote, current=True, source="action", status="Done", owner="pat@example.com"))
    rows.append(version("e", "r5", "Held back", 400.0, wrote, current=True, source="delete", held=True, run_tier="Act now"))
    rows.append(version("f", "r5", "Act now", 100.0, wrote, current=True, source="add"))
    return rows


def _create(cur, name, columns, rows):
    cur.execute(f'DROP TABLE IF EXISTS "{PG_SCHEMA}"."{name}"')
    cur.execute(f'CREATE TABLE "{PG_SCHEMA}"."{name}" (' + ", ".join(f'"{n}" {pg}' for n, _t, pg in columns) + ")")
    for row in rows:
        cur.execute(f'INSERT INTO "{PG_SCHEMA}"."{name}" VALUES (' + ", ".join(["%s"] * len(columns)) + ")", [row[n] for n, _t, _pg in columns])


def _typed(columns):
    return [{"name": n, "type": t, "type_text": t} for n, t, _pg in columns]


@pytest.fixture(scope="module")
def engine(postgres):  # noqa: F811
    def local(**kwargs):
        return psycopg.connect(host=postgres["host"], port=postgres["port"], dbname="postgres", user="inspire",
                               connect_timeout=kwargs["connect_timeout"], autocommit=kwargs["autocommit"])

    with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
        _create(cur, "facts_out", COLUMNS, SNAPSHOT)
        _create(cur, "facts_out_run_log", LOG_COLUMNS, log_rows())
    tables = {TABLE: {"pg": f"{PG_SCHEMA}.facts_out", "columns": _typed(COLUMNS)},
              LOG: {"pg": f"{PG_SCHEMA}.facts_out_run_log", "columns": _typed(LOG_COLUMNS)},
              PLAIN: {"pg": f"{PG_SCHEMA}.plain_out", "columns": _typed(PLAIN_COLUMNS)},
              CLOSED: {"pg": f"{PG_SCHEMA}.facts_out_closed", "columns": _typed(HM_COLUMNS)},
              ACTED: {"pg": f"{PG_SCHEMA}.facts_out_acted", "columns": _typed([c for c in COLUMNS if c[0] in shell_facts.ACTED_COLUMNS
                                                                                 or c[0] == "entity_label"])}}
    lb = shell_pg.Lakebase({"pipeline_id": "pipeline-1", "tables": tables, "datasets": {}}, PG_ENV, lambda: CredentialWorkspace(),
                           connect=local)

    def rows(sql, params=()):
        return lb.run(sql, list(params), 5000)["rows"]

    def write(name, columns, data):
        with local(connect_timeout=10, autocommit=True) as conn, conn.cursor() as cur:
            _create(cur, name, columns, data)

    yield {"rows": rows, "write": write}
    lb.close()


HISTORY = {"log": shell_facts.table_name(LOG), "columns": [n for n, _t, _pg in COLUMNS], "tier": "priority_tier", "run_type": "STRING"}
SCOPE = "`use_case_id` = 'U1'"


def _numbers(engine, sql):
    return shell_facts.numbers_of(engine["rows"](sql))


def _facts(people=()):
    return {"v": shell_facts.FACTS_VERSION, "log": LOG, "acted": ACTED, "closed": TABLE + "_closed", "changes": TABLE + "_run_changes",
            "actions": {"open_n": 1, "done_n": 1, "resolved_n": 1}, "tier": "priority_tier", "label": "entity_label", "stamp_us": STAMP_US,
            "people": [list(p) for p in people], "latest": "r5", "previous": "r4", "runs": [], "numbers": {}, "names": sorted(NAMES),
            "columns": shell_facts.acted_columns(NAMES, "entity_label"), "scope": "U1", "switched": True}


def test_the_run_counts_plus_the_changes_people_made_since_equal_the_counts_read_live_on_a_real_postgres(engine):
    quoted, log = shell_facts.table_name(TABLE), shell_facts.table_name(LOG)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    base = _numbers(engine, shell_facts.snapshot_numbers_sql(quoted, NAMES, "priority_tier", log, "'r4'", SCOPE))
    assert (base["current_n"], base["held_n"], base["left_n"]) == (4, 1, 1), "a, b, c and e are current, e is held back, d left after r4"
    assert base["estimated"] == {"Act now": {"n": 1, "money": 500.0}, "Review": {"n": 1, "money": 200.0}}
    assert base["holdout"] == {"held": {"n": 1, "hits": 0}, "shown": {"n": 4, "hits": 2}}, \
        "c is no longer flagged and d left the list, so two of the four records shown to people stopped being flagged"
    engine["write"]("facts_out", COLUMNS, after_writes())
    params = shell_sql._Params()
    ctes = shell_facts.change_ctes(quoted, STAMP_US, [], [n for n, _t, _pg in COLUMNS], SCOPE)
    delta = shell_facts.delta_numbers_sql(NAMES, "priority_tier", log, "'r4'", shell_facts.stored_stake("n"), shell_facts.stored_stake("t"), SCOPE)
    changes = shell_facts.numbers_of(engine["rows"](f"{shell_sql._with(ctes, shell_facts.CHANGE_ORDER)} {delta}", params.items))
    assert changes["changed"]["keys"] == 3 and changes["changed"]["rows"] == 5, "a, e and f changed: two closed versions and three new ones"
    live = shell_facts.settled(_numbers(engine, shell_facts.snapshot_numbers_sql(quoted, NAMES, "priority_tier", log, "'r4'", SCOPE)))
    added = shell_facts.added_numbers(base, changes)
    assert {k: added[k] for k in shell_facts.FACT_NUMBERS} == {k: live[k] for k in shell_facts.FACT_NUMBERS} == {
        "current_n": 4, "held_n": 0, "left_n": 2}, "e was deleted and f was added after the run, so e left the list too"
    assert added["estimated"] == live["estimated"] == {"Act now": {"n": 1, "money": 100.0}, "Review": {"n": 1, "money": 200.0}}, \
        "a was marked Done, so it left the open estimate, and f joined it"
    assert added["holdout"] == live["holdout"] == {"shown": {"n": 4, "hits": 2}}, "the deleted held back record no longer counts"
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)


def test_a_table_that_keeps_no_money_at_stake_still_gets_its_counts_and_its_closing(engine):
    engine["write"]("plain_out", PLAIN_COLUMNS, SNAPSHOT)
    names, quoted, log = {n for n, _t, _pg in PLAIN_COLUMNS}, shell_facts.table_name(PLAIN), shell_facts.table_name(LOG)
    counted = _numbers(engine, shell_facts.snapshot_numbers_sql(quoted, names, "priority_tier", log, "'r4'", SCOPE))
    assert counted["estimated"] == {"Act now": {"n": 1, "money": None}, "Review": {"n": 1, "money": None}}
    history = dict(HISTORY, columns=[n for n, _t, _pg in PLAIN_COLUMNS])
    closed = engine["rows"]("WITH " + ", ".join(f"{n} AS ({sql})" for n, sql in shell_facts.closing_ctes(
        quoted, names, "entity_label", SCOPE, history).items()) + " SELECT * FROM hm")
    assert [r["_inspire_k"] for r in closed] == ["c"] and closed[0]["_inspire_at_close"] is None
    assert shell_facts.floors_sql("t", names) == "", "no money, so no floor to page by"


def _closing_by_joins(table, label):
    first = "hk.`_inspire_kk` = hx.`record_key` AND hk.`_inspire_kth` = 1"
    steps = shell_facts.closing_ctes(table, NAMES, label)
    steps = {"hx": steps["hx"], "hk": steps["hk"],
             "hr": ("SELECT hx.`record_key` AS `_inspire_rk`, hx.`_inspire_stake` AS `_inspire_after`, hx.`action_outcome` AS `_inspire_found`, "
                    "ROW_NUMBER() OVER (PARTITION BY hx.`record_key` ORDER BY hx.`valid_from` DESC) AS `_inspire_rth` FROM hx JOIN hk ON "
                    f"{first} WHERE hx.`change_source` = 'run' AND hx.`valid_from` > hk.`_inspire_closed`"),
             "hf": (f"SELECT hx.`record_key` AS `_inspire_fk`, MIN(hx.`valid_from`) AS `_inspire_ok` FROM hx JOIN hk ON {first} WHERE "
                    "hx.`change_source` = 'run' AND hx.`action_outcome` = 'Resolved' AND hx.`valid_from` > hk.`_inspire_closed` "
                    "GROUP BY hx.`record_key`"),
             "ho": ("SELECT l.`record_key` AS `_inspire_k`, l.`_inspire_label`, l.`action_status` AS `_inspire_status`, k.`_inspire_closed`, "
                    "k.`_inspire_closer`, k.`_inspire_at_close`, l.`_inspire_realized`, NULLIF(TRIM(l.`_inspire_note`), '') AS `_inspire_note`, "
                    "NULLIF(TRIM(l.`_inspire_reason`), '') AS `_inspire_reason`, CASE WHEN NOT l.`is_current` THEN 'left' WHEN "
                    "l.`_inspire_missing` IS NOT NULL THEN 'missing' WHEN r.`_inspire_found` = 'Resolved' THEN 'resolved' WHEN "
                    "r.`_inspire_found` = 'Still flagged' THEN 'flagged' ELSE 'unchecked' END AS `_inspire_state`, CASE WHEN NOT "
                    "l.`is_current` OR l.`_inspire_missing` IS NOT NULL THEN 0 ELSE r.`_inspire_after` END AS `_inspire_now`, "
                    "COALESCE(f.`_inspire_ok`, CASE WHEN NOT l.`is_current` THEN l.`valid_to` ELSE l.`_inspire_missing` END) AS `_inspire_seen` "
                    "FROM hx AS l JOIN hk AS k "
                    "ON k.`_inspire_kk` = l.`record_key` AND k.`_inspire_kth` = 1 AND k.`_inspire_closed_as` = l.`action_status` LEFT JOIN hr "
                    "AS r ON r.`_inspire_rk` = l.`record_key` AND r.`_inspire_rth` = 1 LEFT JOIN hf AS f ON f.`_inspire_fk` = l.`record_key` "
                    "WHERE l.`_inspire_nth` = 1 AND l.`change_source` <> 'delete'")}
    return "WITH " + ", ".join(f"{n} AS ({sql})" for n, sql in steps.items()) + " SELECT * FROM ho"


def _closing_cases():
    rows = []
    add = lambda key, run, stake, day, hour=6, **kw: rows.append(dict(version(key, run, "Act now", stake, at(day, hour), **kw)))
    add("g", "r3", 100.0, 15, source="run")
    add("g", "r3", 100.0, 16, 9, source="action", status="Done", owner="pat")
    add("g", "r4", 60.0, 22, outcome="Resolved", status="Done")
    add("g", "r5", 80.0, 29, outcome="Still flagged", status="Done", current=True)
    add("h", "r3", 70.0, 15)
    add("h", "r3", 70.0, 17, 9, source="action", status="Dismissed", current=True)
    add("i", "r3", 50.0, 15)
    add("i", "r3", 50.0, 16, 9, source="action", status="Done")
    add("i", "r3", 50.0, 18, 9, source="action", status="In progress", current=True)
    add("j", "r3", 40.0, 15)
    add("j", "r3", 40.0, 16, 9, source="action", status="Done")
    add("j", "r4", 40.0, 22, status="Done")
    add("k", "r3", 30.0, 15)
    add("k", "r3", 30.0, 16, 9, source="action", status="Done")
    add("k", "r3", 30.0, 17, 9, source="delete", status="Done", current=True)
    add("l", "r3", 90.0, 15)
    add("l", "r3", 90.0, 16, 9, source="action", status="Done")
    add("l", "r3", 90.0, 17, 9, source="action", status="In progress")
    add("l", "r4", 75.0, 22, status="In progress")
    add("l", "r4", 75.0, 23, 9, source="action", status="Could not fix")
    add("l", "r5", 65.0, 29, status="Could not fix", outcome="Resolved", current=True)
    add("m", "r3", 20.0, 15)
    add("m", "r3", 20.0, 16, 9, source="action", status="Done", realized=150.0)
    add("m", "r3", 25.0, 17, 9, source="action", status="Done", realized=175.0)
    add("m", "r4", 25.0, 22, status="Done", outcome="Resolved", current=True)
    for key in "ghijklm":
        mine = sorted((r for r in rows if r["record_key"] == key), key=lambda r: r["valid_from"])
        for before, after in zip(mine, mine[1:]):
            before["valid_to"] = after["valid_from"]
    for row in rows:
        if row["record_key"] == "h":
            row["dismiss_reason"] = "  Not a real issue  "
        if row["record_key"] == "j":
            row["is_current"] = False
            row["valid_to"] = row["valid_to"] or at(29)
    return rows


def test_the_closing_in_one_pass_per_record_equals_the_closing_built_from_joins_on_a_real_postgres(engine):
    engine["write"]("facts_out", COLUMNS, _closing_cases())
    quoted, iso = shell_facts.table_name(TABLE), lambda moment: shell_pg.cell(moment)
    ordered = lambda sql: sorted(engine["rows"](sql), key=lambda r: r["_inspire_k"])
    joined = ordered(_closing_by_joins(quoted, "entity_label"))
    passed = ordered(shell_facts.closed_rows_sql(quoted, NAMES, "entity_label"))
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert [{k: v for k, v in r.items() if not k.startswith("_inspire_measured")} for r in passed] == joined
    by_key = {r["_inspire_k"]: r for r in passed}
    assert set(by_key) == {"g", "h", "j", "l", "m"}, "i was opened again and k was deleted, so neither counts as closed"
    assert (by_key["g"]["_inspire_state"], by_key["g"]["_inspire_seen"]) == ("flagged", iso(at(22))), \
        "the latest run after the fix flags it again, while the first run that found it fixed stays the day it was seen fixed"
    assert (by_key["h"]["_inspire_state"], by_key["h"]["_inspire_reason"]) == ("unchecked", "Not a real issue")
    assert (by_key["j"]["_inspire_state"], by_key["j"]["_inspire_now"]) == ("left", 0)
    assert (by_key["l"]["_inspire_status"], by_key["l"]["_inspire_at_close"], by_key["l"]["_inspire_closed"]) == \
        ("Could not fix", 75.0, iso(at(23, 9)))
    assert (by_key["m"]["_inspire_closed"], by_key["m"]["_inspire_at_close"]) == (iso(at(16, 9)), 20.0), \
        "saving Done again is not a new close, so the money at stake is the one at the first close"


def _closing(engine, ctes, source="", table=TABLE, closed=""):
    closing = shell_facts.closing_ctes(shell_facts.table_name(table), NAMES, "entity_label", SCOPE, HISTORY, source=source, closed=closed)
    order = [*shell_facts.CHANGE_ORDER, "av", *shell_facts.CLOSING_ORDER]
    merged = dict(ctes, **closing)
    rows = engine["rows"](f"WITH {', '.join(f'{n} AS ({merged[n]})' for n in order if n in merged)} SELECT * FROM hm")
    return sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, default=str))


def test_the_records_people_acted_on_kept_by_the_run_give_the_same_closing_as_their_whole_history_before_and_after_new_actions(engine):
    quoted = shell_facts.table_name(TABLE)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    acted = engine["rows"](shell_facts.acted_versions_sql(quoted, NAMES, "entity_label", SCOPE, HISTORY))
    assert {r["record_key"] for r in acted} == {"b", "c"}, "only the records people acted on are kept"
    full = engine["rows"](f"SELECT * FROM {shell_facts.versions_source(quoted, HISTORY)} AS hv WHERE `record_key` IN ('b', 'c')")
    assert len(acted) < len(full), "the run keeps the versions the closing reads, not one per run"
    columns = shell_facts.acted_columns(NAMES, "entity_label")
    engine["write"]("facts_out_acted", [c for c in COLUMNS if c[0] in columns], acted)
    closed = engine["rows"](shell_facts.closed_rows_sql(shell_facts.table_name(ACTED), NAMES, "entity_label"))
    engine["write"]("facts_out_closed", HM_COLUMNS, closed)
    assert [r["_inspire_k"] for r in closed] == ["c"], "the run stores the closing of c, the one record people closed"
    ctes = shell_facts.change_ctes(quoted, STAMP_US, [], [n for n, _t, _pg in COLUMNS], SCOPE)
    ctes["av"] = shell_facts.acted_source(shell_facts.table_name(ACTED), columns)
    assert _closing(engine, ctes, "av") == _closing(engine, {}) and len(_closing(engine, {})) == 1, "c is closed as Done before the writes"
    engine["write"]("facts_out", COLUMNS, after_writes())
    stored, live = _closing(engine, ctes, "av"), _closing(engine, {})
    assert stored == live and {r["_inspire_k"] for r in live} == {"a", "c"}, "a, marked Done after the run, joins c from the changes"
    kept = _closing(engine, ctes, "av", closed=shell_facts.table_name(CLOSED))
    assert kept == live, "the stored closing of the records nobody changed, plus the closing rebuilt for a, equals the closing read live"
    counted = engine["rows"](f"{shell_sql._with(ctes, (*shell_facts.CHANGE_ORDER, 'av'))} {shell_facts.action_counts_sql('av')}")
    assert counted == engine["rows"](shell_facts.action_counts_sql(quoted)) == [{"open_n": 1, "done_n": 2, "resolved_n": 1}]
    owners = engine["rows"](f"{shell_sql._with(ctes, (*shell_facts.CHANGE_ORDER, 'av'))} {shell_facts.owners_sql('av')}")
    assert owners == engine["rows"](shell_facts.owners_sql(quoted)) == [{"v": "pat@example.com"}, {"v": "sam@example.com"}]
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)


def _reopened():
    rows = after_writes()
    wrote = at(30, 11)
    for row in rows:
        if row["is_current"] and row["record_key"] in ("b", "c"):
            row.update(is_current=False, valid_to=wrote)
    rows.append(version("b", "r5", "Review", 200.0, wrote, current=True, source="action", status="Done", owner="sam@example.com"))
    rows.append(version("c", "r5", "Monitor", 20.0, wrote, current=True, source="action", status="In progress", owner="pat@example.com"))
    return rows


@pytest.mark.parametrize("written,expected", [
    (after_writes, {"open_n": 1, "done_n": 2, "resolved_n": 1}),
    (_reopened, {"open_n": 1, "done_n": 2, "resolved_n": 0}),
])
def test_the_action_counts_the_run_kept_plus_the_changes_since_equal_the_counts_read_live_on_a_real_postgres(engine, written, expected):
    quoted, acted = shell_facts.table_name(TABLE), shell_facts.table_name(ACTED)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    columns = shell_facts.acted_columns(NAMES, "entity_label")
    engine["write"]("facts_out_acted", [c for c in COLUMNS if c[0] in columns],
                    engine["rows"](shell_facts.acted_versions_sql(quoted, NAMES, "entity_label", SCOPE, HISTORY)))
    base = shell_facts.action_numbers_of(engine["rows"](shell_facts.action_counts_sql(acted)))
    assert base == {"open_n": 1, "done_n": 1, "resolved_n": 1}, "b was in progress and c was marked Done and resolved when the run counted"
    engine["write"]("facts_out", COLUMNS, written())
    ctes = shell_facts.change_ctes(quoted, STAMP_US, [], [n for n, _t, _pg in COLUMNS], SCOPE)
    added = engine["rows"](f"{shell_sql._with(ctes, shell_facts.CHANGE_ORDER)} {shell_facts.action_delta_sql(acted, base)}")
    keys, _missed = shell_sql.changed_keys(["a", "b", "c", "e", "f", "z"])
    listed = engine["rows"](f"{shell_sql._with(ctes, shell_facts.CHANGE_ORDER)} {shell_facts.action_delta_sql(acted, base, keys)}")
    live = engine["rows"](shell_facts.action_counts_sql(quoted))
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert added == listed == live == [expected], "the run's counts plus the records changed since give the counts read live, up and down"


def test_the_summary_by_the_listed_keys_equals_what_left_the_action_counts_and_the_owners_read_live_on_a_real_postgres(engine):
    quoted, acted, log = shell_facts.table_name(TABLE), shell_facts.table_name(ACTED), shell_facts.table_name(LOG)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    columns = shell_facts.acted_columns(NAMES, "entity_label")
    engine["write"]("facts_out_acted", [c for c in COLUMNS if c[0] in columns],
                    engine["rows"](shell_facts.acted_versions_sql(quoted, NAMES, "entity_label", SCOPE, HISTORY)))
    ran = _numbers(engine, shell_facts.snapshot_numbers_sql(quoted, NAMES, "priority_tier", log, "'r4'", SCOPE))
    facts = dict(_facts(), actions=shell_facts.action_numbers_of(engine["rows"](shell_facts.action_counts_sql(acted))),
                 numbers={"left_n": ran["left_n"]})
    engine["write"]("facts_out", COLUMNS, after_writes())
    live = shell_facts.settled(_numbers(engine, shell_facts.snapshot_numbers_sql(quoted, NAMES, "priority_tier", log, "'r4'", SCOPE)))
    expected = {"left": [{"left_n": live["left_n"]}], "impact": engine["rows"](shell_facts.action_counts_sql(quoted)),
                "owners": engine["rows"](shell_facts.owners_sql(quoted))}
    context = {"table": quoted, "changes": True, "actions": True, "facts": facts}
    read = lambda keys: {name: engine["rows"](*query) for name, query in shell_sql.list_summary_queries(dict(context, changed_keys=keys)).items()}
    shown = lambda found: {name: [{k: v for k, v in row.items() if k != shell_facts.MISSED} for row in rows] for name, rows in found.items()}
    missed = lambda found: [shell_sql.summary_missed(found[name]) for name in ("left", "impact")]
    try:
        for keys in (None, ["a", "e", "f"], ["a", "b", "e", "f", "z"]):
            found = read(keys)
            assert shown(found) == expected and missed(found) == [0, 0], keys
        short = read(["a"])
        assert missed(short) == [2, 2], "e and f changed after the keys were read, so the App reads the summary again"
        assert shown(short)["left"] != expected["left"], "e left the list, which the short key list cannot see"
        assert missed(read([])) == [3, 3], "a, e and f changed after an empty key list was read"
    finally:
        engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert expected["left"] == [{"left_n": 2}] and expected["owners"] == [{"v": "pat@example.com"}, {"v": "sam@example.com"}]


def test_the_changes_since_the_run_read_the_log_by_the_listed_keys_and_count_the_keys_the_list_missed_on_a_real_postgres(engine):
    quoted, log = shell_facts.table_name(TABLE), shell_facts.table_name(LOG)
    ctes = shell_facts.change_ctes(quoted, STAMP_US, [], [n for n, _t, _pg in COLUMNS], SCOPE)
    numbers = lambda keys: shell_facts.numbers_of(engine["rows"](
        f"{shell_sql._with(ctes, shell_facts.CHANGE_ORDER)} " + shell_facts.delta_numbers_sql(
            NAMES, "priority_tier", log, "'r4'", shell_facts.stored_stake("n"), shell_facts.stored_stake("t"), SCOPE, *shell_sql.changed_keys(keys))))
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert numbers([]) == numbers(None) and numbers([])["missed"] == 0, "nothing changed since the run, so the App reads no run log row"
    engine["write"]("facts_out", COLUMNS, after_writes())
    try:
        assert numbers([])["missed"] == 3, "a, e and f changed after an empty key list was read"
        whole = numbers(None)
        assert numbers(["a", "e", "f"]) == numbers(["a", "b", "e", "f", "z"]) == whole and whole["missed"] == 0
        short = numbers(["a"])
        assert short["missed"] == 2 and short["left_n"] != whole["left_n"], \
            "e and f changed after the keys were read, so the App reads the numbers again by the changes"
    finally:
        engine["write"]("facts_out", COLUMNS, SNAPSHOT)


def test_the_latest_run_changes_keep_only_the_marked_records_of_that_run_on_a_real_postgres(engine):
    log = shell_facts.table_name(LOG)
    marked = [dict(r, change="new" if r["record_key"] == "a" and r["run_id"] == "r5" else ("moved" if r["record_key"] == "c" else None),
                   moved_to="Monitor" if r["record_key"] == "c" else None) for r in log_rows()]
    engine["write"]("facts_out_run_log", LOG_COLUMNS, marked)
    kept = engine["rows"](shell_facts.latest_changes_sql(log, "'r5'", SCOPE))
    engine["write"]("facts_out_run_log", LOG_COLUMNS, log_rows())
    assert sorted((r["run_id"], r["record_key"], r["change"]) for r in kept) == [("r5", "a", "new"), ("r5", "c", "moved")], \
        "only the latest run's records that came new or moved are kept, never another run's marks or the unmarked records"


def test_the_stored_closing_less_the_changed_records_plus_their_closing_read_now_is_the_closing_read_live(engine):
    quoted = shell_facts.table_name(TABLE)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    columns = shell_facts.acted_columns(NAMES, "entity_label")
    engine["write"]("facts_out_acted", [c for c in COLUMNS if c[0] in columns],
                    engine["rows"](shell_facts.acted_versions_sql(quoted, NAMES, "entity_label", SCOPE, HISTORY)))
    stored = engine["rows"](shell_facts.closed_rows_sql(shell_facts.table_name(ACTED), NAMES, "entity_label"))
    engine["write"]("facts_out", COLUMNS, after_writes())
    ctes = shell_facts.change_ctes(quoted, STAMP_US, [], [n for n, _t, _pg in COLUMNS], SCOPE)
    ctes["av"] = shell_facts.acted_source(shell_facts.table_name(ACTED), columns)
    steps, select = shell_facts.changed_closing_sql(quoted, NAMES, "entity_label", 501)
    ctes.update(steps)
    changed = engine["rows"](f"{shell_sql._with(ctes, (*shell_facts.CHANGE_ORDER, 'av', 'avd', 'hx', 'hw', 'hu', 'ho', 'hm'))} {select}")
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert [r[shell_facts.CHANGED_KEY] for r in changed] == ["a", "e", "f"], "a was marked Done, e deleted and f added after the run"
    keys = {r[shell_facts.CHANGED_KEY] for r in changed}
    now = [r for r in stored if r["_inspire_k"] not in keys] + [{k: v for k, v in r.items() if k != shell_facts.CHANGED_KEY}
                                                                for r in changed if r["_inspire_k"] is not None]
    engine["write"]("facts_out", COLUMNS, after_writes())
    live = _closing(engine, {})
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    assert sorted(now, key=lambda r: json.dumps(r, sort_keys=True, default=str)) == live and {r["_inspire_k"] for r in live} == {"a", "c"}
    plain = shell_facts.closed_now_sql("x.y.z_closed", [], lambda v: ":p0")
    assert plain == "SELECT * FROM x.y.z_closed", "nothing changed since the run, so the stored closing is the closing"
    seen = []
    kept = shell_facts.closed_now_sql("x.y.z_closed", changed, lambda v: (seen.append(json.loads(v)), f":p{len(seen) - 1}")[1])
    assert "NOT IN (SELECT explode(from_json(:p0, 'ARRAY<STRING>')))" in kept and "inline(from_json(:p1, 'ARRAY<STRUCT<`_inspire_k`: STRING" in kept
    assert seen[0] == ["a", "e", "f"] and [r["_inspire_k"] for r in seen[1]] == ["a"], "only a is closed now; e and f leave the stored rows"


def test_a_change_that_landed_while_the_run_counted_is_counted_once():
    people = [("a", STAMP_US + 5)]
    ctes = shell_facts.change_ctes("`t`", STAMP_US, [(":p0", ":p1")], ["record_key", "valid_from", "valid_to", "is_current"])
    assert "SELECT CAST(:p0 AS STRING) AS `k`, CAST(:p1 AS BIGINT) AS `v`" == ctes["qp"]
    assert "(t.`valid_from` <= timestamp_micros(" in ctes["q"] and "pf.`k` IS NOT NULL" in ctes["q"], \
        "a version the run's own count already saw is part of the snapshot, not a change after it"
    assert shell_facts.facts_problem(dict(_facts(people), people=[["k", 1]] * (shell_facts.PEOPLE_MAX + 1)))
    assert shell_facts.facts_problem(_facts(people)) == ""


def test_numbers_from_the_run_and_the_changes_since_add_up_and_drop_empty_groups():
    base = {"current_n": 10, "held_n": 2, "left_n": 3, "estimated": {"Act now": {"n": 4, "money": 400.0}}, "holdout": {"held": {"n": 1, "hits": 0}}}
    delta = shell_facts.numbers_of([{"kind": "counts", "n": -1, "hits": -1}, {"kind": "estimated", "tier": "Act now", "n": -4, "money": -400.0},
                                    {"kind": "estimated", "tier": "Review", "n": 1, "money": 50.0}, {"kind": "left", "n": 2},
                                    {"kind": "holdout", "tier": "held", "n": -1, "hits": 0}])
    added = shell_facts.added_numbers(base, delta)
    assert (added["current_n"], added["held_n"], added["left_n"]) == (9, 1, 5)
    assert added["estimated"] == {"Review": {"n": 1, "money": 50.0}} and added["holdout"] == {}


def test_a_floor_is_used_only_when_its_depth_covers_the_page_with_room_to_spare():
    floors = {"open": [[1000, 90.0], [100000, 10.0]], "all": [[1000, 95.0]]}
    assert shell_facts.floor_for(floors, "open", 25, False) == 90.0, "the first page reads only the top thousand"
    assert shell_facts.floor_for(floors, "open", 25, True) == 10.0, "a filtered page reads deeper, since a filter thins the top"
    assert shell_facts.floor_for(floors, "open", 300, False) == 10.0
    assert shell_facts.floor_for(floors, "all", 300, False) is None, "no floor deep enough, so the page reads every row"
    assert shell_facts.floor_for({}, "open", 25, False) is None


def test_facts_of_another_run_or_shape_are_never_used():
    good = dict(_facts(), numbers={"current_n": 1})
    row = {"run_id": "r5", shell_sql.RUN_FACTS_COLUMN: json.dumps(good)}
    assert shell_sql.state_facts(row) is not None
    assert shell_sql.state_facts(dict(row, run_id="r6")) is None, "the latest run kept no facts, so the App counts live"
    assert shell_sql.state_facts(dict(row, **{shell_sql.RUN_FACTS_COLUMN: json.dumps(dict(good, v=1))})) is None
    assert shell_sql.state_facts(dict(row, **{shell_sql.RUN_FACTS_COLUMN: "not json"})) is None
    for key in ("changes", "actions"):
        assert shell_sql.state_facts(dict(row, **{shell_sql.RUN_FACTS_COLUMN: json.dumps({k: v for k, v in good.items() if k != key})})) is None
    assert shell_sql.state_facts(dict(row, **{shell_sql.RUN_FACTS_COLUMN: json.dumps(dict(good, actions={"open_n": 1}))})) is None, \
        "a run that kept only part of its action counts is not used"
    assert shell_sql.state_facts(row, TABLE) is not None and shell_sql.state_facts(row, "main.ops.moved_out") is None, \
        "facts kept for a table the page no longer reads point at another table's run log, so the App counts live"
    elsewhere = dict(row, **{shell_sql.RUN_FACTS_COLUMN: json.dumps(dict(good, changes="main.ops.other_out_run_changes"))})
    assert shell_sql.state_facts(elsewhere, TABLE) is None, "the latest run's changes must be read from this table's own copy"
    unswitched = dict(row, **{shell_sql.RUN_FACTS_COLUMN: json.dumps(dict(good, changes=None))})
    assert shell_sql.state_facts(unswitched, TABLE) is not None, "a table with no run log keeps no copy of the latest run's changes"


HUB_TABLE = "main.pricing.loss_desk_out"


class FactsWarehouse:
    def __init__(self, facts, floor_rows=25, changed_n=0, money=None):
        from v148_app_hub_test import COLUMNS as HUB_COLUMNS, TYPES as HUB_TYPES
        self.facts, self.sql, self.floor_rows, self.changed_n, self.miss = facts, [], floor_rows, changed_n, False
        self.keys, self.missed, self.broken = None, 0, None
        self.status, self.closes, self.changed_closes = {}, {}, {}
        self.money = dict(money or {})
        self.fields = [{"name": n, "type": HUB_TYPES.get(n, "STRING"), "type_text": HUB_TYPES.get(n, "STRING")} for n in HUB_COLUMNS]

    def run_sql(self, warehouse, sql, params, limit=5000):
        self.sql.append((sql, params, limit))
        rows = lambda found: {"columns": [], "rows": found, "truncated": False}
        if "DESCRIBE HISTORY" in sql.upper():
            raise AssertionError("no request may read a table's Delta history")
        if "z.`_inspire_closed_as` AS `_inspire_status`" in sql:
            seen = dict(self.closes, **(self.changed_closes if " q AS (" in sql else {}))
            asked = {p["value"] for p in params}
            return rows([dict(seen[k], record_key=k, _inspire_status="Done") for k in sorted(asked & set(seen))])
        if sql.startswith(f"SELECT * FROM {shell_facts.table_name(HUB_TABLE + '_summary')}"):
            summary = {k: v for k, v in self.money.items() if k != "edits"}
            return rows([dict({"run_id": "r5", "updated_at": "2026-09-29T06:10:00Z", "run_facts": json.dumps(self.facts),
                               "value_assumptions": None}, **summary)])
        if sql.startswith(f"SELECT * FROM {shell_facts.table_name(HUB_TABLE + '_assumptions')}"):
            return rows(list(self.money.get("edits") or []))
        if sql.startswith("SELECT COUNT(*) AS `n`, unix_micros(GREATEST("):
            ahead = {shell_sql.AHEAD_STAMP: self.facts.get("stamp_us")} if f"AS `{shell_sql.AHEAD_STAMP}`" in sql else {}
            return rows([dict({"n": self.changed_n, "us": STAMP_US + 5 if self.changed_n else None,
                               "keys": None if self.keys is None else json.dumps(self.keys)}, **ahead)])
        if f"AS `{shell_facts.CHANGED_KEY}`" in sql:
            return rows([{shell_facts.CHANGED_KEY: "k1", "_inspire_k": "k1", "_inspire_status": "Done", "_inspire_state": "unchecked",
                          "_inspire_closed": "2026-09-30T10:00:00.000Z", "_inspire_measured_ok": 0},
                         {shell_facts.CHANGED_KEY: "k2", "_inspire_k": None}])
        if sql.endswith("LIMIT 0"):
            return {"columns": self.fields, "rows": [], "truncated": False}
        if "+ d.`_inspire_n` AS total" in sql:
            return rows([{"total": int(sql.split(" + d.`_inspire_n` AS total")[0].rsplit("SELECT ", 1)[1])}])
        if "AS total" in sql:
            return rows([{"total": 10001}])
        missed = self.missed if "CAST(`_q_key` AS STRING) NOT IN (" in sql else 0
        if self.broken and self.broken in sql and f"`record_key` IN ({shell_facts.CHANGED_KEYS})" in sql:
            raise shell_core.QueryError("TEMPORARILY_UNAVAILABLE")
        if "AS left_n" in sql:
            return rows([{"left_n": 7, shell_facts.MISSED: missed}])
        if "AS open_n" in sql:
            return rows([{"open_n": 2, "done_n": 1, "resolved_n": 1, shell_facts.MISSED: missed}])
        if "`action_owner` AS v" in sql:
            return rows([{"v": "pat@example.com"}, {"v": "sam@example.com"}])
        if "'counts' AS `kind`" in sql:
            return rows([{"kind": "counts", "n": 0, "hits": 0}, {"kind": "changed", "n": 0, "hits": 0, "money": None},
                         {"kind": "missed", "n": missed}])
        if "`value_at_stake` >=" in sql or "`rank` <=" in sql:
            return rows([self.row(i, None if self.miss and i == 3 else f"k{i}") for i in range(self.floor_rows)])
        return rows([self.row(i, f"k{i}") for i in range(min(limit, 25))])

    def row(self, i, key):
        return dict({"record_key": f"k{i}", "_inspire_key": key}, **({"_inspire_status": self.status[key]} if key in self.status else {}))


def _facts_shell(tmp_path, facts, floor_rows=25, changed_n=0, money=None):
    from v148_app_hub_test import SETTINGS, hub_page, hub_shell
    ws = FactsWarehouse(facts, floor_rows, changed_n, money)
    settings = dict(SETTINGS, options=dict(SETTINGS.get("options") or {}, decisions=True))
    s, ws, _made = hub_shell(tmp_path, settings=settings, pages=[hub_page()], ws=ws)
    return s, ws


def _ready_facts(**extra):
    from v148_app_hub_test import COLUMNS as HUB_COLUMNS
    names = set(HUB_COLUMNS)
    return dict(_facts(), log=HUB_TABLE + "_run_log", acted=HUB_TABLE + "_acted", closed=HUB_TABLE + "_closed", scope="N01-U05",
                changes=HUB_TABLE + "_run_changes", actions={"open_n": 2, "done_n": 1, "resolved_n": 1},
                names=sorted(names),
                columns=shell_facts.acted_columns(names, "entity_label"),
                numbers={"current_n": 9808265, "held_n": 0, "left_n": 7, "estimated": {}, "holdout": {}},
                runs=[{"run_id": "r5", "tier": "Act now", "as_of_date": "2026-09-29", "ran_us": STAMP_US, "n": 3}]) | extra


def test_the_runs_screen_reads_the_runs_the_run_kept_and_never_the_run_log_or_the_table_history(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts())
    status, out = call(s, "GET", "runs", query={"page": "n01_u05"})
    assert status == 200 and [r["run_id"] for r in out["runs"]] == ["r5"], out
    assert not [sql for sql, _p, _l in ws.sql if "_run_log" in sql], "the runs come from the run's own summary row"


@pytest.mark.parametrize("changed_n", [0, 3])
def test_impact_and_the_overview_read_the_stored_closing_and_rebuild_it_only_for_the_records_changed_since_the_run(tmp_path, changed_n):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=changed_n)
    status, out = call(s, "GET", "impact", query={"page": "n01_u05"})
    assert status == 200, out
    status, out = call(s, "POST", "overview", body={"page": "n01_u05"})
    assert status == 200, out
    rebuilt = [sql for sql, _p, _l in ws.sql if f"AS `{shell_facts.CHANGED_KEY}`" in sql]
    closing = [(sql, p) for sql, p, _l in ws.sql if "loss_desk_out_closed" in sql]
    assert len(closing) == 2 and all(" hx AS (" not in sql and " q AS (" not in sql for sql, _p in closing), \
        "the screens read the stored closing and never rebuild the closing chain from the versions"
    if changed_n == 0:
        assert not rebuilt and all("from_json" not in sql for sql, _p in closing), "nothing changed since the run, so nothing is rebuilt"
    else:
        assert len(rebuilt) == 1, "the closing of the changed records is rebuilt once and shared by both screens"
        assert all("NOT IN (SELECT explode(from_json(" in sql and "inline(from_json(" in sql for sql, _p in closing)
        assert all(any(p["value"] == '["k1", "k2"]' for p in params) for _sql, params in closing)


def _copies_of(sql):
    return {name: {"pg": f"app.t{i}", "columns": [{"name": "x", "type": "STRING", "type_text": "STRING"}]}
            for i, name in enumerate(sorted(shell_pg.dataset_reads(sql) or ()))}


def test_every_query_a_page_with_run_facts_sends_to_lakebase_is_one_lakebase_runs_and_delta_gets_the_same_spark_sql(tmp_path):
    from v145_lakebase_test import DELTA_ONLY_BUILDERS, read_routes
    earlier = {"run_id": "r4", "tier": "Act now", "as_of_date": "2026-09-22", "ran_us": STAMP_US - 7 * 86400 * 1_000_000, "n": 3}
    s, ws = _facts_shell(tmp_path, _ready_facts(runs=_ready_facts()["runs"] + [earlier]), changed_n=3)
    sent, execute = [], s.execute
    s.execute = lambda w, sql, params, limit, delta=False: sent.append((sql, params, delta)) or execute(w, sql, params, limit, delta)
    body = {"page": "n01_u05", "filters": {}, "record_key": "k1", "title": "Loss", "kind": "chart", "context": {}}
    query = {"page": "n01_u05", "record_key": "k1", "filter": "category", "q": "o", "offset": "0"}
    for method, path in read_routes():
        if not path.startswith("genie"):
            status, out = call(s, method, path, query if method == "GET" else None, body=body if method == "POST" else None)
            assert status < 500, (method, path, out)
    s.check({})
    on_lakebase = [(sql, params) for sql, params, delta in sent if not delta]
    timed = [sql for sql, _params in on_lakebase if "timestamp_micros(" in sql]
    assert len(on_lakebase) >= 30 and len(timed) >= 5, "the run facts path asks for the changes since the run by its stamp"
    refused = {}
    for sql, params in on_lakebase:
        try:
            shell_pg.render(sql, params, _copies_of(sql))
        except shell_pg.NotServed as reason:
            refused[shell_sql.error_text(reason)] = sql
    assert refused == {}, refused
    delta_only = {name for names in DELTA_ONLY_BUILDERS.values() for name in names} - {"rand"}
    assert any(f"{name}(" in sql for sql, _p, delta in sent if delta for name in delta_only), "the change count is read on Delta"
    assert not [sql for sql, _p in on_lakebase if any(f"{name}(" in sql for name in delta_only)]
    warehouse = [sql for sql, _p, _l in ws.sql]
    assert all(sql in warehouse for sql in timed), "a Delta App sends the same Spark SQL, timestamp_micros and all, to the warehouse"


def test_an_unfiltered_list_counts_from_the_run_and_a_filtered_one_counts_up_to_the_cap(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts())
    base = {"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25}
    status, out = call(s, "POST", "records", body=base)
    assert status == 200 and out["total"] == 9808265 and out["total_more"] is False, out
    totals = [sql for sql, _p, _l in ws.sql if "AS total" in sql]
    assert totals and all("9808265 + d.`_inspire_n` AS total" in sql for sql in totals), "the run's count plus the changes since"
    ws.sql.clear()
    status, out = call(s, "POST", "records", body=dict(base, filters={"category": ["A"]}))
    assert status == 200 and out["total"] == shell_sql.CAPS["count_cap"] and out["total_more"] is True, out
    capped = [sql for sql, _p, _l in ws.sql if "AS total" in sql]
    assert capped and all(f"LIMIT {shell_sql.CAPS['count_cap'] + 1}) AS z" in sql for sql in capped)


def test_the_money_sort_reads_only_rows_above_the_floor_and_reads_every_row_when_the_floor_leaves_the_page_short(tmp_path):
    facts = _ready_facts(floors={"open": [[1000, 900.0]], "all": [[1000, 950.0], [100000, 10.0]]})
    s, ws = _facts_shell(tmp_path, facts)
    body = {"page": "n01_u05", "sort": {"key": "value_at_stake", "dir": "desc"}, "limit": 25}
    status, out = call(s, "POST", "records", body=body)
    assert status == 200 and len(out["rows"]) == 25, out
    floored = [sql for sql, _p, _l in ws.sql if "`value_at_stake` >= 950.0" in sql]
    assert floored and " JOIN c ON " in floored[0] and " LEFT JOIN c ON " not in floored[0], \
        "only the current rows above the floor join the list, so the warehouse skips every file below it"
    s, ws = _facts_shell(tmp_path / "short", facts, floor_rows=3)
    status, out = call(s, "POST", "records", body=body)
    assert status == 200 and len(out["rows"]) == 25, "three rows above the floor are fewer than the page, so the App reads every row"
    assert len([sql for sql, _p, _l in ws.sql if "`value_at_stake` >= 950.0" in sql]) == 1


def test_a_stake_floor_holds_only_while_the_stored_stake_is_the_sort_key():
    facts = _ready_facts(floors={"open": [[1000, 900.0]], "all": [[1000, 950.0]], "rank": [[1000, 1000.0]]})
    page, context = {"records": {"rank": "rank"}}, {"join": "record_key", "types": {"value_at_stake": "DOUBLE", "rank": "INT"}}
    by_money = {"sort": "value_at_stake", "dir": "desc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": False, "ai": {},
                "columns": {}}
    assert shell_sql.list_floor(page, by_money, context, facts, None, False) == \
        {"column": "value_at_stake", "op": ">=", "value": 950.0, "on": "d"}, "no money model, so the list sorts by its own stored stake"
    kept = {"recomputes": True, "changed": False}
    priced = dict(context, money=["m"])
    assert shell_sql.list_floor(page, by_money, priced, facts, kept, False) == \
        {"column": "value_at_stake", "op": ">=", "value": 950.0, "on": "c"}, "the App's money sorts, which is the stored stake read by key"
    assert shell_sql.list_floor(page, dict(by_money, ranked=True), context, facts, None, False) == \
        {"column": "value_at_stake", "op": ">=", "value": 900.0, "on": "d"}, "the ranked list reads the open records not held back"
    assert shell_sql.list_floor(page, dict(by_money, sort="rank", dir="asc"), context, facts, None, False) == \
        {"column": "rank", "op": "<=", "value": 1000.0, "on": "d"}
    assert shell_sql.list_floor(page, by_money, {"join": "record_key", "types": {"rank": "INT"}}, facts, None, False) is None
    assert shell_sql.list_floor(page, dict(by_money, cursor={"key": "k"}), context, facts, None, False) is None
    assert shell_sql.list_floor(page, dict(by_money, dir="asc"), context, facts, None, False) is None
    assert shell_sql.list_floor(page, dict(by_money, search="Item 42"), context, facts, None, False) is None, \
        "a search finds a handful of records, so a floor would only add a second read"


def test_after_an_assumption_change_the_money_order_reads_the_top_current_records_by_the_apps_own_money():
    facts = _ready_facts(floors={"open": [[1000, 900.0]], "all": [[1000, 950.0], [100000, 10.0]], "rank": [[1000, 1000.0]]})
    page = {"records": {"rank": "rank"}}
    priced = {"join": "record_key", "types": {"value_at_stake": "DOUBLE", "rank": "INT"}, "money": ["m"]}
    by_money = {"sort": "value_at_stake", "dir": "desc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": False, "ai": {},
                "columns": {}}
    live = {"recomputes": True, "changed": True}
    assert shell_sql.list_floor(page, by_money, priced, facts, live, False) == {"top": 1000, "on": "c"}, \
        "the stored stake no longer orders the list, so the App reads the top thousand current records by the money it shows"
    assert shell_sql.list_floor(page, by_money, priced, facts, live, True) == {"top": 100000, "on": "c"}, "a filter thins the top"
    assert shell_sql.list_floor(page, by_money, priced, None, live, False) == {"top": 1000, "on": "c"}, "the cut needs no stored floor"
    assert shell_sql.list_floor(page, dict(by_money, offset=25000), priced, facts, live, False) is None, "no cut deep enough for the page"
    for request, why in ((dict(by_money, mine=True), "my actions"), (dict(by_money, changed=True), "the records changed since the run"),
                         (dict(by_money, ai={"ai_cat_driver": ["Price"]}), "an AI category"),
                         (dict(by_money, columns={"value_at_stake": {"min": 10}}), "a money range"),
                         (dict(by_money, ranked=True), "the ranked order"), (dict(by_money, dir="asc"), "the smallest money first"),
                         (dict(by_money, cursor={"key": "k"}), "a cursor"), (dict(by_money, search="Item 42"), "a search")):
        assert shell_sql.list_floor(page, request, priced, facts, live, False) is None, why
    assert shell_sql.list_floor(page, dict(by_money, sort="rank", dir="asc"), priced, facts, live, False) == \
        {"column": "rank", "op": "<=", "value": 1000.0, "on": "d"}, "the rank the run wrote still orders the list whatever the money"
    assert shell_sql.list_floor(page, by_money, dict(priced, join="entity_id"), facts, live, False) is None, \
        "a list joined on its own key orders its ties by that key, which the current versions do not hold"
    context = dict(priced, actions=False, ai=[], table="`main`.`ops`.`desk_out`", floor={"top": 1000, "on": "c"})
    cut = shell_sql._current_cte(dict(context, money=["1.0 AS `_inspire_money`"]))
    assert cut.startswith("SELECT * FROM (SELECT `record_key` AS `_inspire_key`") and cut.endswith(
        "WHERE `is_current` AND `change_source` <> 'delete') AS c0 ORDER BY `_inspire_money` DESC NULLS LAST, `_inspire_key` ASC LIMIT 1000")
    assert shell_sql._current_join(context, "d")[0] == " JOIN c ON c.`_inspire_key` = d.`record_key`", \
        "only the records inside the cut join the list, so the warehouse never joins every record to sort them"


def _scaled_model(expression, assumptions, edits):
    fields = [{"name": n, "kind": "decimal"} for n in ("units", "bonus", "value_at_stake")]
    summary = {"value_formula": "{units:number} units", "value_expression": expression,
               "value_assumptions": json.dumps([{"name": n, "value": v, "kind": "number"} for n, v in assumptions])}
    return shell_sql.money_model(summary, fields, [{"name": n, "value": v} for n, v in edits])


@pytest.mark.parametrize("expression, assumptions, edits, scale", [
    ("units * PRICE", [("PRICE", 20.0)], [("PRICE", 30.0)], 1.5),
    ("greatest(0, units * PRICE * KEEP)", [("PRICE", 20.0), ("KEEP", 0.5)], [("PRICE", 30.0)], 1.5),
    ("(units + bonus) * PRICE / KEEP", [("PRICE", 20.0), ("KEEP", 0.5)], [("PRICE", 30.0), ("KEEP", 0.25)], 3.0),
    ("least(units * PRICE, bonus * PRICE)", [("PRICE", 20.0)], [("PRICE", 10.0)], 0.5),
    ("- units * PRICE * PRICE", [("PRICE", 2.0)], [("PRICE", -4.0)], 4.0),
    ("units * PRICE + KEEP", [("PRICE", 20.0), ("KEEP", 5.0)], [("PRICE", 30.0)], None),
    ("units * (PRICE - KEEP)", [("PRICE", 20.0), ("KEEP", 5.0)], [("PRICE", 30.0)], None),
    ("greatest(10, units * PRICE)", [("PRICE", 20.0)], [("PRICE", 30.0)], None),
    ("units * PRICE", [("PRICE", 20.0)], [("PRICE", -20.0)], None),
    ("units * PRICE", [("PRICE", 20.0)], [("PRICE", 0.0)], None),
    ("units * PRICE", [("PRICE", 0.0)], [("PRICE", 5.0)], None),
    ("units / PRICE", [("PRICE", 2.0)], [("PRICE", 0.0)], None),
    ("units * PRICE * 0", [("PRICE", 2.0)], [("PRICE", 3.0)], None),
])
def test_an_assumption_change_keeps_the_stored_order_only_when_it_multiplies_every_record_by_one_positive_number(expression, assumptions,
                                                                                                              edits, scale):
    model = _scaled_model(expression, assumptions, edits)
    assert model["recomputes"] and model["changed"], model["problem"]
    found = shell_sql.money_scale(model)
    assert found == pytest.approx(scale) if scale is not None else found is None, (expression, found)


def test_a_money_model_the_app_cannot_work_out_never_counts_as_scaled():
    assert shell_sql.money_scale(None) is None
    assert shell_sql.money_scale({"recomputes": True, "changed": True}) is None
    assert shell_sql.money_scale(dict(_scaled_model("units * PRICE", [("PRICE", 20.0)], [("PRICE", 30.0)]), recomputes=False)) is None


def test_the_widened_floor_keeps_every_record_the_scaled_money_puts_on_the_page_though_the_run_rounded_each_stake():
    gap, share = shell_sql.VALUE_TOLERANCE
    tolerance = lambda x: max(gap, abs(x) * share)
    rng = random.Random(7)
    worked = [1000 + rng.random() * 0.2 for _ in range(4000)] + [rng.random() * 900 for _ in range(6000)] + \
             [-50 - rng.random() for _ in range(500)]
    stake = [w + rng.uniform(-1, 1) * tolerance(w) * 0.999 for w in worked]
    assert all(abs(w - s) <= tolerance(s) for w, s in zip(worked, stake)), "the notebook refuses a run whose stake is off its arithmetic"
    depth, need, scale = 1000, 100, 1.5
    floor = sorted(stake, reverse=True)[depth - 1]
    page = sorted(range(len(worked)), key=lambda i: (-worked[i] * scale, i))[:need]
    widened = shell_sql.stake_floor(floor)
    assert all(stake[i] >= widened for i in page), "every record the changed money puts on the page sits above the widened floor"
    assert any(stake[i] < floor for i in page), "the run's own floor would drop a record of the page, so the widening is needed"
    assert floor - 3 * tolerance(floor) <= widened < floor - 2 * tolerance(floor) * (1 - share), "the floor widens by about twice the rounding"
    for value in (-80.0, -0.004, 0.0, 0.004, 3.0, 950.0, 2.5e9):
        low = value - tolerance(value)
        assert shell_sql.stake_floor(value) + tolerance(shell_sql.stake_floor(value)) <= low, value


def test_after_an_assumption_change_that_only_scales_the_money_the_list_keeps_the_stored_floor_widened_by_the_runs_rounding():
    facts = _ready_facts(floors={"open": [[1000, 900.0]], "all": [[1000, 950.0], [100000, 10.0]], "rank": [[1000, 1000.0]]})
    page = {"records": {"rank": "rank"}}
    priced = {"join": "record_key", "types": {"value_at_stake": "DOUBLE", "rank": "INT"}, "money": ["m"]}
    by_money = {"sort": "value_at_stake", "dir": "desc", "offset": 0, "limit": 25, "search": "", "mine": False, "changed": False, "ai": {},
                "columns": {}}
    scaled = _scaled_model("greatest(0, units * PRICE)", [("PRICE", 20.0)], [("PRICE", 30.0)])
    assert shell_sql.list_floor(page, by_money, priced, facts, scaled, False) == \
        {"column": "value_at_stake", "op": ">=", "value": shell_sql.stake_floor(950.0), "on": "c"}
    assert shell_sql.list_floor(page, dict(by_money, ranked=True), priced, facts, scaled, False) == \
        {"column": "value_at_stake", "op": ">=", "value": shell_sql.stake_floor(900.0), "on": "c"}, "the ranked list keeps its open floor"
    assert shell_sql.list_floor(page, by_money, priced, None, scaled, False) == {"top": 1000, "on": "c"}, \
        "without the run's floors the App still cuts the top records by the money it shows"
    shifted = _scaled_model("units * PRICE + 5", [("PRICE", 20.0)], [("PRICE", 30.0)])
    assert shell_sql.list_floor(page, by_money, priced, facts, shifted, False) == {"top": 1000, "on": "c"}, \
        "an added amount reorders the records, so the stored stake no longer orders them"
    assert shell_sql.list_floor(page, dict(by_money, ranked=True), priced, facts, shifted, False) is None


@pytest.mark.parametrize("expression, scaled", [("greatest(0, rank * PRICE)", True), ("rank * PRICE + 5", False)])
def test_the_money_sort_after_an_assumption_change_reads_the_rows_above_the_widened_floor_only_when_the_change_scales_the_money(
        tmp_path, expression, scaled):
    money = {"value_formula": "{rank:number} x {PRICE:money}", "value_expression": expression,
             "value_assumptions": json.dumps([{"name": "PRICE", "value": 20.0, "kind": "money"}]),
             "edits": [{"name": "PRICE", "value": "30.0", "changed_by": "owner01", "changed_at": "2026-10-01T00:00:00Z", "note": ""}]}
    facts = _ready_facts(floors={"open": [[1000, 900.0]], "all": [[1000, 950.0], [100000, 10.0]], "rank": [[1000, 1000.0]]})
    s, ws = _facts_shell(tmp_path, facts, money=money)
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "value_at_stake", "dir": "desc"}, "limit": 25})
    assert status == 200 and len(out["rows"]) == 25 and out["money"]["changed"] is True, out
    widened = [sql for sql, _p, _l in ws.sql if f"`value_at_stake` >= {shell_sql.stake_floor(950.0)!r}" in sql]
    cut = [sql for sql, _p, _l in ws.sql if " AS c0 ORDER BY `_inspire_money` DESC NULLS LAST, `_inspire_key` ASC LIMIT 1000" in sql]
    assert (len(widened), len(cut)) == ((1, 0) if scaled else (0, 1)), (len(widened), len(cut))
    assert not [sql for sql, _p, _l in ws.sql if "`value_at_stake` >= 950.0" in sql], "the run's own floor is never used on changed money"


def test_the_default_rank_order_reads_only_the_rows_ranked_inside_the_floor(tmp_path):
    facts = _ready_facts(floors={"open": [], "all": [], "rank": [[1000, 1000.0]]})
    s, ws = _facts_shell(tmp_path, facts)
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and len(out["rows"]) == 25, out
    floored = [sql for sql, _p, _l in ws.sql if "`rank` <= 1000.0" in sql]
    assert floored and " f AS (SELECT d.* FROM d WHERE d.`rank` <= 1000.0), " in floored[0], \
        "the floor narrows the list on the column it sorts by, so the warehouse skips the files of records ranked below it"
    assert "WHERE `is_current` AND `change_source` <> 'delete' AND `rank` <= 1000.0)" in floored[0] and " LEFT JOIN c ON " in floored[0], \
        "the current versions joined to the page are read inside the same floor, so neither read touches the files below it"
    assert len(floored) == 1
    ws.sql.clear()
    ws.miss = True
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25, "offset": 25})
    assert status == 200 and all(r["_inspire_key"] for r in out["rows"]), out
    listed = [sql for sql, _p, _l in ws.sql if " OFFSET 25)" in sql]
    assert len(listed) == 2 and "`rank` <= " not in listed[1], \
        "a page row whose current version sits outside the floor makes the App read the page again without it"
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "desc"}, "limit": 25})
    assert status == 200 and not [sql for sql, _p, _l in ws.sql if "`rank` <= " in sql and "DESC" in sql.split("ORDER BY")[-1]]


def test_the_records_summary_reads_the_records_people_acted_on_and_the_run_count_of_records_that_left(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts())
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["summary"]["left"] == 7 and out["summary"]["open"] == 2, out
    summary = [sql for sql, _p, _l in ws.sql if "AS open_n" in sql or "AS left_n" in sql]
    assert summary and all(shell_facts.table_name(HUB_TABLE + "_acted") in sql or "AS left_n" in sql for sql in summary)
    assert not [sql for sql in summary if "LEFT ANTI JOIN" in sql], "no request rebuilds the run versions from the log"
    counted = [sql for sql in summary if "AS open_n" in sql]
    assert counted and all("2 + COALESCE(SUM(" in sql and "FROM av" not in sql for sql in counted), \
        "the action counts are the run's counts plus the records changed since, never a recount of every record people acted on"
    owners = [sql for sql, _p, _l in ws.sql if "`action_owner` AS v" in sql]
    assert len(summary) == 2 and len(owners) == 1 and "FROM av WHERE" in owners[0], \
        "the records that left, the action counts and the owners are three statements the warehouse runs beside the page"
    assert out["summary"]["owners"] == ["pat@example.com", "sam@example.com"], out


def _summary_reads(ws, name):
    marker = {"left": "AS left_n", "impact": "AS open_n"}[name]
    return [sql for sql, _p, _l in ws.sql if marker in sql]


def test_the_records_summary_reads_the_run_log_only_for_the_records_changed_since_the_run(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=2)
    ws.keys = ["k1", "k'2"]
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["summary"]["left"] == 7 and out["summary"]["open"] == 2, out
    (left,), (impact,) = _summary_reads(ws, "left"), _summary_reads(ws, "impact")
    looked = left.split(f"FROM {shell_facts.table_name(HUB_TABLE + '_run_log')} WHERE ")[1:]
    assert len(looked) == 1 and looked[0].split(") AS p ON ")[0].endswith("AND `record_key` IN ('k1', 'k\\'2')"), \
        "the run log is read by the listed keys, so the warehouse skips every file of the run that holds none of them"
    acted = impact.split(f"FROM {shell_facts.table_name(HUB_TABLE + '_acted')} WHERE ")
    assert acted[1].startswith("`record_key` IN ('k1', 'k\\'2') QUALIFY "), "the records people acted on are read by the same keys"
    for sql in (left, impact):
        assert (f"CAST((SELECT COUNT(*) FROM qk WHERE CAST(`_q_key` AS STRING) NOT IN ('k1', 'k\\'2')) AS BIGINT) AS "
                f"`{shell_facts.MISSED}`") in sql, "each keyed read counts the changed records its key list missed"


def test_a_record_changed_after_the_keys_were_read_makes_the_summary_read_the_log_by_the_changes_again(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    ws.keys, ws.missed = ["k1"], 1
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["summary"]["left"] == 7 and out["summary"]["open"] == 2 and not out["errors"], out
    for name in ("left", "impact"):
        first, again = _summary_reads(ws, name)
        assert "IN ('k1')" in first and "IN ('k1')" not in again and f"`record_key` IN ({shell_facts.CHANGED_KEYS})" in again, \
            "the second read finds the changed records itself, so a record changed after the keys were read is counted"
    assert len([sql for sql, _p, _l in ws.sql if "`action_owner` AS v" in sql]) == 1, "the owners never depend on the key list"


@pytest.mark.parametrize("missed", [0, 1])
def test_opening_the_page_reads_the_records_summary_once_so_the_first_records_wait_only_for_the_list(tmp_path, missed):
    from v165_scale_test import Recorder
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=2)
    ws.keys, ws.missed, s.stamp_pool = ["k1", "k2"], missed, Recorder()
    owners = lambda: [sql for sql, _p, _l in ws.sql if "`action_owner` AS v" in sql]
    assert call(s, "GET", "defaults", query={"page": "n01_u05"})[0] == 200
    assert len(_summary_reads(ws, "left")) == len(_summary_reads(ws, "impact")) == len(owners()) == 1, \
        "opening the page reads the records that left, the action counts and the owners once, before the list asks"
    assert not [sql for sql, _p, _l in ws.sql if "AS total" in sql], "the list itself waits for its own request"
    ws.sql.clear()
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["rows"] and not out["errors"], out
    assert out["summary"] == {"left": 7, "open": 2, "done": 1, "resolved": 1, "owners": ["pat@example.com", "sam@example.com"]}, out
    assert [sql for sql, _p, _l in ws.sql if "AS total" in sql] and not owners(), "the list reads its rows and count and reuses the summary"
    for name in ("left", "impact"):
        again = _summary_reads(ws, name)
        assert len(again) == missed and all(f"`record_key` IN ({shell_facts.CHANGED_KEYS})" in sql for sql in again), \
            "a record changed after the page opened makes the list read that count again by the changes"


def test_a_page_with_no_result_table_reads_no_records_summary_when_it_opens(tmp_path):
    from v165_scale_test import Recorder
    from v148_app_hub_test import SETTINGS, hub_page, hub_shell
    ws = FactsWarehouse(_ready_facts())
    page = {k: v for k, v in hub_page().items() if k != "result_table"}
    s, ws, _made = hub_shell(tmp_path, settings=dict(SETTINGS, options=dict(SETTINGS.get("options") or {}, decisions=True)),
                             pages=[page], ws=ws)
    s.stamp_pool = Recorder()
    assert call(s, "GET", "defaults", query={"page": page["id"]})[0] == 200
    assert not [sql for sql, _p, _l in ws.sql if "AS left_n" in sql or "AS open_n" in sql or "`action_owner` AS v" in sql]


def test_a_summary_read_again_that_fails_shows_its_error_and_keeps_the_rest_of_the_list(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    ws.keys, ws.missed, ws.broken = ["k1"], 1, "AS left_n"
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["rows"] and out["summary"]["open"] == 2, out
    assert "left" not in out["summary"] and "TEMPORARILY_UNAVAILABLE" in out["errors"]["left"], \
        "a count read by the short key list is never shown, and the failed read again is named"


@pytest.mark.parametrize("keys", [None, []])
def test_the_summary_reads_the_log_by_the_changes_when_the_keys_are_too_many_or_none_changed(tmp_path, keys):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=0 if keys == [] else 600)
    ws.keys = keys
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and out["summary"]["left"] == 7 and out["summary"]["open"] == 2, out
    for name in ("left", "impact"):
        (sql,) = _summary_reads(ws, name)
        if keys is None:
            assert f"`record_key` IN ({shell_facts.CHANGED_KEYS})" in sql and "NOT IN (" not in sql, \
                "more changed records than the cap keeps the lookup inside the warehouse"
        else:
            assert "`record_key` IN (CAST(NULL AS STRING))" in sql and "CAST((SELECT COUNT(*) FROM qk) AS BIGINT)" in sql, \
                "no changed records reads no run log rows, and any record changed since is counted as missed"


def test_the_impact_numbers_read_the_run_log_by_the_changed_keys_and_again_by_the_changes_when_one_was_missed(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    ws.keys = ["k1"]
    status, out = call(s, "GET", "impact", query={"page": "n01_u05"})
    numbers = [sql for sql, _p, _l in ws.sql if "'counts' AS `kind`" in sql]
    assert status == 200 and len(numbers) == 1 and "`record_key` IN ('k1')" in numbers[0], (status, out)
    assert f"`record_key` IN ({shell_facts.CHANGED_KEYS})" not in numbers[0].split(" q AS (")[1].split("'left' AS `kind`")[1]
    s, ws = _facts_shell(tmp_path / "again", _ready_facts(), changed_n=1)
    ws.keys, ws.missed = ["k1"], 1
    status, out = call(s, "GET", "impact", query={"page": "n01_u05"})
    numbers = [sql for sql, _p, _l in ws.sql if "'counts' AS `kind`" in sql]
    assert status == 200 and len(numbers) == 2 and "IN ('k1')" not in numbers[1], (status, out)
    assert f"`record_key` IN ({shell_facts.CHANGED_KEYS})" in numbers[1], "the second read finds the changed records itself"


def test_the_list_reads_its_new_and_moved_marks_from_the_latest_run_changes_and_never_scans_the_run_log(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts())
    body = {"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25}
    for extra in ({}, {"changed": True}):
        ws.sql.clear()
        status, out = call(s, "POST", "records", body=dict(body, **extra))
        assert status == 200, out
        listed = [sql for sql, _p, _l in ws.sql if "AS `_inspire_ch`" in sql]
        marks = f"FROM {shell_facts.table_name(HUB_TABLE + '_run_changes')} AS t WHERE TRUE AND CAST(t.`run_id` AS STRING) = 'r5'"
        assert listed and all(marks in sql for sql in listed), listed
        assert not [sql for sql in listed if "_run_log" in sql], "the marks of the page never scan the whole run log"
    s, ws = _facts_shell(tmp_path / "plain", _ready_facts(changes=None))
    status, out = call(s, "POST", "records", body=body)
    listed = [sql for sql, _p, _l in ws.sql if "AS `_inspire_ch`" in sql]
    assert status == 200 and listed and all("_run_log" in sql and "_run_changes" not in sql for sql in listed), \
        "a run that kept no changes table reads the marks from the run log"


def test_lakebase_reads_set_a_short_statement_timeout_inside_their_transaction():
    from v145_lakebase_test import FakeConn, lakebase, password_service
    conn = FakeConn()
    lb, _made, _clock = lakebase(password_service("t1"), [conn])
    lb.query("SELECT category FROM big", {}, 5)
    assert (f"SET LOCAL statement_timeout = {shell_pg.READ_TIMEOUT_MS}", None) in conn.executed
    assert shell_pg.READ_TIMEOUT_MS < shell_pg.STATEMENT_TIMEOUT_MS


def _closes(engine, keys, facts=None, changed=None):
    sql, params = shell_sql.closed_query({"use_case_id": "U1"}, shell_facts.table_name(TABLE), keys, NAMES, HISTORY, facts, changed)
    return sorted(engine["rows"](sql, params), key=lambda r: r["record_key"])


def test_the_closing_of_the_listed_records_read_from_the_run_facts_equals_the_closing_read_live_before_and_after_new_actions(engine):
    quoted = shell_facts.table_name(TABLE)
    engine["write"]("facts_out", COLUMNS, SNAPSHOT)
    columns = shell_facts.acted_columns(NAMES, "entity_label")
    engine["write"]("facts_out_acted", [c for c in COLUMNS if c[0] in columns],
                    engine["rows"](shell_facts.acted_versions_sql(quoted, NAMES, "entity_label", SCOPE, HISTORY)))
    keys, facts = ["a", "b", "c", "e"], _facts()
    try:
        live = _closes(engine, keys)
        assert [r["record_key"] for r in live] == ["c"] and live[0]["_inspire_closed_by"] == "pat", live
        assert _closes(engine, keys, facts, []) == _closes(engine, keys, facts, None) == live, \
            "nothing changed since the run, so the records people acted on give the closing the full history gives"
        engine["write"]("facts_out", COLUMNS, after_writes())
        live = _closes(engine, keys)
        assert [r["record_key"] for r in live] == ["a", "c"], live
        assert _closes(engine, keys, facts, ["a", "e", "f"]) == _closes(engine, keys, facts, None) == live, \
            "a was marked Done after the run, so the closing reads the changes since the run with the records people acted on"
        assert _closes(engine, ["c"], facts, ["a", "e", "f"]) == [r for r in live if r["record_key"] == "c"], \
            "c did not change since the run, so the records people acted on alone give its closing"
        assert [r["record_key"] for r in _closes(engine, keys, facts, [])] == ["c"], \
            "a key list read before a was marked Done misses a, so the App must read the records it missed again"
    finally:
        engine["write"]("facts_out", COLUMNS, SNAPSHOT)


def _closes_read(ws):
    return [(sql, sorted(p["value"] for p in params if p["value"] != "N01-U05")) for sql, params, _l in ws.sql
            if "z.`_inspire_closed_as` AS `_inspire_status`" in sql]


@pytest.mark.parametrize("changed, reads", [
    (["k9"], [("acted", ["k1", "k2"])]),
    (["k1"], [("changes", ["k1", "k2"])]),
    (None, [("changes", ["k1", "k2"])]),
])
def test_the_closing_of_the_listed_records_reads_the_records_people_acted_on_and_the_changes_only_when_one_of_them_changed(
        tmp_path, changed, reads):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    ws.keys, ws.status = changed, {"k1": "Done", "k2": "Done"}
    ws.closes = {"k1": {"_inspire_closed_by": "pat@example.com"}, "k2": {"_inspire_closed_by": "sam@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and not out["errors"], out
    found = _closes_read(ws)
    assert [("changes" if " q AS (" in sql else "acted", keys) for sql, keys in found] == reads, found
    for sql, _keys in found:
        assert f"FROM {shell_facts.table_name(HUB_TABLE + '_acted')} WHERE " in sql and "_run_log" not in sql, \
            "the closing reads the records people acted on, never the run log"
        assert (shell_facts.table_name(HUB_TABLE) in sql) == (" q AS (" in sql), \
            "the result table is read only for the changes since the run"
    by = {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}
    assert by["k1"] == "pat@example.com" and by["k2"] == "sam@example.com" and by["k3"] is None, by


def test_a_closed_record_the_key_list_missed_is_read_again_with_the_changes_since_the_run(tmp_path):
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    ws.keys, ws.status = ["k9"], {"k1": "Done", "k2": "Done"}
    ws.closes, ws.changed_closes = {"k1": {"_inspire_closed_by": "pat@example.com"}}, {"k2": {"_inspire_closed_by": "sam@example.com"}}
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "sort": {"key": "rank", "dir": "asc"}, "limit": 25})
    assert status == 200 and not out["errors"], out
    found = _closes_read(ws)
    assert [(" q AS (" in sql, keys) for sql, keys in found] == [(False, ["k1", "k2"]), (True, ["k2"])], \
        "k2 was closed after the key list was read, so only k2 is read again with the changes since the run"
    by = {r["_inspire_key"]: r.get("_inspire_closed_by") for r in out["rows"]}
    assert by["k1"] == "pat@example.com" and by["k2"] == "sam@example.com", by


def _state_reads(ws):
    return [sql for sql, _p, _l in ws.sql if sql.startswith(f"SELECT * FROM {shell_facts.table_name(HUB_TABLE + '_summary')}")
            or sql.startswith("SELECT COUNT(*) AS `n`, unix_micros(GREATEST(")]


def test_the_page_state_is_read_again_in_the_background_once_half_its_life_is_gone_so_no_request_waits_for_it(tmp_path):
    from v165_scale_test import Recorder
    now = [1_000.0]
    s, ws = _facts_shell(tmp_path, _ready_facts(), changed_n=1)
    s.cache, s.stamp_pool, page = shell_core.Cache(clock=lambda: now[0]), Recorder(), s.page("n01_u05")
    first = s.page_state(ws, "sp", page)
    assert len(_state_reads(ws)) == 2 and not s.stamp_pool.jobs, "a cold page reads the summary and the changes since the run"
    now[0] += shell_core.STAMP_TTL_S / 2 - 1
    assert s.page_state(ws, "sp", page) is first and len(_state_reads(ws)) == 2, "a young state is served as it is"
    s.lookups[("state", "sp", page["id"])] = shell_core.Future()
    now[0] += 2
    assert s.page_state(ws, "sp", page) is first and not s.stamp_pool.jobs, "a state already being read again is not read twice"
    s.lookups.clear()
    assert s.page_state(ws, "sp", page) is first and len(s.stamp_pool.jobs) == 1, "an old state is served while it is read again"
    assert len(_state_reads(ws)) == 4 and s.cache.left(("state", "sp", page["id"])) == shell_core.STAMP_TTL_S
    renewed = s.page_state(ws, "sp", page)
    assert renewed is not first and renewed == first and not s.lookups, "the next request gets the state read in the background"
    now[0] += shell_core.STAMP_TTL_S + 1
    assert s.page_state(ws, "sp", page) is not renewed and len(_state_reads(ws)) == 6, "an expired state is read in the request"


def test_requests_waiting_on_a_page_state_read_that_fails_get_its_error_instead_of_waiting_forever(tmp_path, monkeypatch):
    import threading
    s, ws = _facts_shell(tmp_path, _ready_facts())
    page, started, gate, waiting = s.page("n01_u05"), threading.Event(), threading.Event(), threading.Event()

    class Watched(shell_core.Future):
        def result(self, timeout=None):
            waiting.set()
            return super().result(timeout)

    def broken(_ws, _page):
        started.set()
        gate.wait(5)
        raise RuntimeError("the summary read broke")

    monkeypatch.setattr(shell_core, "Future", Watched)
    s.read_state, errors = broken, []

    def ask():
        try:
            s.page_state(ws, "sp", page)
        except RuntimeError as error:
            errors.append(str(error))

    first, second = threading.Thread(target=ask, daemon=True), threading.Thread(target=ask, daemon=True)
    first.start()
    assert started.wait(5)
    second.start()
    assert waiting.wait(5)
    gate.set()
    first.join(5)
    second.join(5)
    assert not second.is_alive() and errors == ["the summary read broke"] * 2, errors
    assert not s.lookups, "a failed read leaves no lookup behind, so the next request reads again"
