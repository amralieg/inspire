import json
import math
import re

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
TABLE_PART = re.compile(r"^[^`.\x00-\x1f]{1,255}$")
FACTS_VERSION = 5
FACTS_COLUMN = "run_facts"
ACTED_SUFFIX = "_acted"
RUN_LOG_SUFFIX = "_run_log"
CLOSED_SUFFIX = "_closed"
CLOSES_SUFFIX = "_closes"
CHANGES_SUFFIX = "_run_changes"
FEEDBACK_SUFFIX = "_feedback"
PLANS_SUFFIX = "_plans"
COMPANION_SUFFIXES = ("_summary", "_assumptions", RUN_LOG_SUFFIX, ACTED_SUFFIX, CLOSED_SUFFIX, CHANGES_SUFFIX, CLOSES_SUFFIX, PLANS_SUFFIX,
                      "_scenarios", FEEDBACK_SUFFIX)
FLAGGED_TIERS = ("Act now", "Review")
NEW = "New"
IN_PROGRESS = "In progress"
DONE = "Done"
DISMISSED = "Dismissed"
COULD_NOT = "Could not fix"
STATUS_KINDS = {NEW: "open", IN_PROGRESS: "open", DONE: "done", DISMISSED: "dismissed", COULD_NOT: "could_not"}
STATUS_LABELS = {DISMISSED: "Not an issue"}
ACTION_STATUSES = tuple(STATUS_KINDS)
CHOICE_COLUMN = "action_choice"


def statuses_of(*kinds) -> tuple:
    return tuple(status for status, kind in STATUS_KINDS.items() if kind in kinds)


def status_label(status) -> str:
    return STATUS_LABELS.get(status, str(status or NEW))


def choice_id(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(label).lower()).strip("-")


OPEN_STATUSES = statuses_of("open")
CLOSED_STATUSES = tuple(s for s in ACTION_STATUSES if s not in OPEN_STATUSES)
MEASURED_STATUSES = statuses_of("done", "could_not")
DEFAULT_CHOICES = tuple({"id": choice_id(status_label(s)), "label": status_label(s), "status": s} for s in ACTION_STATUSES)
RESOLVED = "Resolved"
STILL_FLAGGED = "Still flagged"
MONEY_COLUMN = "value_at_stake"
CLOSE_TYPES = {"realized_value": "DOUBLE", "realized_note": "STRING"}
HOLDOUT_TYPES = {"held_back": "BOOLEAN", "run_tier": "STRING"}
KEPT_SINCE = "not_listed_since"
GONE_STATES = ("left", "missing", "resolved")
BATCH_COLUMN = "action_batch"
BATCH_NOTE = "action_batch_note"
BATCH_VALUES = "action_batch_values"
BATCH_TYPES = (BATCH_COLUMN, BATCH_NOTE, BATCH_VALUES)
UNDO_KEY = "undo"
ACTED_COLUMNS = ("record_key", "use_case_id", "run_id", "valid_from", "valid_to", "is_current", "change_source", "changed_by",
                 "action_status", CHOICE_COLUMN, "action_outcome", "action_owner", "action_due", "action_note", "dismiss_reason", MONEY_COLUMN,
                 KEPT_SINCE) + tuple(CLOSE_TYPES) + BATCH_TYPES
WEIGHT = "_inspire_w"
PEOPLE_MAX = 200
RUN_ROWS = 5000
OWNER_ROWS = 50
FLOOR_DEPTHS = (1000, 100000)
FLOOR_MARGIN = 4
FACT_NUMBERS = ("current_n", "held_n", "left_n")
CHANGED_KEYS = "SELECT `_q_key` FROM qk"
MISSED = "_inspire_missed"
FANNING_CALLS = re.compile(r"\b(?:explode|explode_outer|posexplode|posexplode_outer|inline|inline_outer)\s*\(", re.I)


def object_shape_problems(holder, what: str, objects=(), lists=()) -> list:
    if not isinstance(holder, dict):
        return [f"{what} is not a JSON object"]
    problems = [f"{what} {key} must be a JSON object" for key in objects
                if holder.get(key) is not None and not isinstance(holder.get(key), dict)]
    for key in lists:
        items = holder.get(key)
        if items is None:
            continue
        if not isinstance(items, list):
            problems.append(f"{what} {key} must be a list of JSON objects")
            continue
        odd = [str(index + 1) for index, item in enumerate(items) if not isinstance(item, dict)]
        if odd:
            one = len(odd) == 1
            problems.append(f"{what} {key} must each be a JSON object, and {'entry' if one else 'entries'} {', '.join(odd)} "
                            f"{'is' if one else 'are'} not")
    return problems


def quote(name: str) -> str:
    if not IDENT.match(str(name or "")):
        raise ValueError(f"{name!r} is not a column or dataset name")
    return f"`{name}`"


def table_name(name) -> str:
    parts = [p.strip() for p in str(name or "").split(".")]
    if len(parts) != 3 or not all(TABLE_PART.match(p) for p in parts):
        raise ValueError(f"{name!r} is not a catalog.schema.table name")
    return ".".join(f"`{p}`" for p in parts)


def sql_list(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def count_when(condition: str) -> str:
    return f"COUNT(CASE WHEN {condition} THEN 1 END)"


def stored_stake(alias: str = "") -> str:
    return f"CAST({alias + '.' if alias else ''}{quote(MONEY_COLUMN)} AS DOUBLE)"


def stake_of(names, alias: str = "") -> str:
    return stored_stake(alias) if MONEY_COLUMN in names else "CAST(NULL AS DOUBLE)"


def names_table(text, name: str) -> bool:
    return bool(name) and re.search(rf"(?<![\w$]){re.escape(name)}(?![\w$])", str(text or "").replace("`", ""), re.I) is not None


def fanning_datasets(page, names) -> dict:
    sql = {str(d.get("name")): str(d.get("sql") or "").strip().rstrip(";").strip()
           for d in (page or {}).get("datasets") or [] if isinstance(d, dict)}
    return {name: text for name, text in sql.items() if any(names_table(text, n) for n in names or ()) or FANNING_CALLS.search(text)}


def companion(table: str, suffix: str) -> str:
    return ".".join(p.strip() for p in str(table).split(".")) + suffix


def acted_condition(names) -> str:
    owned = " OR NULLIF(TRIM(`action_owner`), '') IS NOT NULL" if "action_owner" in names else ""
    return f"(`action_status` IS NOT NULL{owned})"


def versions_source(table: str, history: dict, keys: str = "", runs=None) -> str:
    log = history["log"]
    stamped = {"run_id": "g.`_g_run`", "as_of_date": "g.`_g_date`", "rank": "g.`_g_rank`", "valid_from": "g.`_g_ran`",
               "valid_to": "g.`_g_next`", "is_current": "FALSE", "changed_by": "concat('run ', CAST(g.`_g_run` AS STRING))"}
    plain = ", ".join(quote(c) for c in history["columns"])
    picked = ", ".join(f"{stamped[c]} AS {quote(c)}" if c in stamped else f"v.{quote(c)}" for c in history["columns"])
    where = lambda *parts: f" WHERE {' AND '.join(p for p in parts if p)}" if any(parts) else ""
    keyed = f"`record_key` IN ({keys})" if keys else ""
    wanted = f"`change_source` = 'run' AND `run_id` IN ({runs['want']})" if runs else ""
    within = where(keyed, wanted)
    logged = where(f"l.`record_key` IN ({keys})" if keys else "", f"l.`run_id` IN ({runs['near']})" if runs else "")
    since = f" AND v.`valid_from` >= {runs['since']}" if runs else ""
    lead = (f"SELECT l.`use_case_id` AS `_g_uc`, l.`run_id` AS `_g_run`, l.`as_of_date` AS `_g_date`, l.`rank` AS `_g_rank`, "
            f"l.`ran_at` AS `_g_ran`, l.`record_key` AS `_g_key`, LEAD(l.`ran_at`) OVER (PARTITION BY l.`use_case_id`, l.`record_key` ORDER BY "
            f"l.`ran_at`) AS `_g_next` FROM {log} AS l{logged}")
    lead = f"SELECT * FROM ({lead}) AS g0 WHERE `_g_run` IN ({runs['want']})" if runs else lead
    written = f"(SELECT `record_key`, `use_case_id`, `run_id`, `change_source` FROM {table}{within})" if runs else table
    found = (f"SELECT g.*, v.`valid_from` AS `_g_from`, ROW_NUMBER() OVER (PARTITION BY g.`_g_key`, g.`_g_run` ORDER BY v.`valid_from`) "
             f"AS `_g_nth` FROM ({lead}) AS g LEFT ANTI JOIN {written} AS x ON x.`record_key` = g.`_g_key` AND "
             f"x.`use_case_id` <=> g.`_g_uc` AND x.`run_id` <=> g.`_g_run` AND x.`change_source` = 'run' JOIN {table} AS v ON "
             f"v.`record_key` = g.`_g_key` AND v.`use_case_id` <=> g.`_g_uc` AND v.`change_source` = 'run' AND v.`valid_from` > g.`_g_ran`{since}")
    return (f"(SELECT {plain} FROM {table}{within} UNION ALL SELECT {picked} FROM ({found}) AS g JOIN {table} AS v ON "
            f"v.`record_key` = g.`_g_key` AND v.`use_case_id` <=> g.`_g_uc` AND v.`change_source` = 'run' AND v.`valid_from` = g.`_g_from`{since} "
            f"WHERE g.`_g_nth` = 1)")


def close_event(status: str = "`action_status`", was: str = "`_inspire_was`", closed: str = "") -> str:
    return f"`change_source` = 'action' AND {status} IN ({closed or sql_list(CLOSED_STATUSES)}) AND COALESCE({was}, '') <> {status}"


def closing_ctes(table: str, names: set, label=None, scope: str = "", history=None, source: str = "", closed: str = "") -> dict:
    if closed:
        live = closing_ctes(table, names, label, source="avd")
        return dict({"avd": CHANGED_ACTED, "hmd": live["hm"],
                     "hm": f"SELECT * FROM {closed} WHERE `_inspire_k` NOT IN (SELECT `_q_key` FROM qk) UNION ALL SELECT * FROM hmd"},
                    **{name: live[name] for name in ("hx", "hw", "hu", "ho")})
    within = f"{scope} AND " if scope and not source else ""
    acted = f"SELECT `record_key` FROM {source or table} WHERE {within}`action_status` IS NOT NULL"
    versions = source or (f"{versions_source(table, history, acted)} AS hv" if history else table)
    stake = stake_of(names)
    named = f"CAST({quote(label)} AS STRING)" if label and label in names else "CAST(NULL AS STRING)"
    comment = "CAST(`action_note` AS STRING)" if "action_note" in names else "CAST(NULL AS STRING)"
    choice = f"CAST({quote(CHOICE_COLUMN)} AS STRING)" if CHOICE_COLUMN in names else "CAST(NULL AS STRING)"
    batch = (f"CAST(`{BATCH_COLUMN}` AS STRING) AS `_inspire_batch`, NULLIF(TRIM(`{BATCH_NOTE}`), '') AS `_inspire_batch_note`, "
             f"COALESCE(`{BATCH_VALUES}` LIKE '%\"{UNDO_KEY}\"%', FALSE) AS `_inspire_batch_undo`" if all(n in names for n in BATCH_TYPES) else
             "CAST(NULL AS STRING) AS `_inspire_batch`, CAST(NULL AS STRING) AS `_inspire_batch_note`, FALSE AS `_inspire_batch_undo`")
    closes = close_event()
    last = lambda cell: f"MAX(CASE WHEN `_inspire_nth` = 1 THEN {cell} END)"
    at_close = lambda cell: f"MAX(CASE WHEN `_inspire_closes` = 1 AND `valid_from` = `_inspire_closed` THEN {cell} END)"
    ran = lambda cell: f"MAX(CASE WHEN `change_source` = 'run' AND `valid_from` = `_inspire_ran` THEN {cell} END)"
    gone = f"{last('CASE WHEN `is_current` THEN 0 ELSE 1 END')} = 1"
    absent = f"{last('`_inspire_missing`')} IS NOT NULL"
    after = "`change_source` = 'run' AND `valid_from` > `_inspire_closed`"
    return {
        "hx": (f"SELECT `record_key`, `is_current`, `change_source`, `changed_by`, `action_status`, `action_outcome`, `valid_from`, "
               f"`valid_to`, {stake} AS `_inspire_stake`, CAST(`realized_value` AS DOUBLE) AS `_inspire_realized`, CAST(`realized_note` AS "
               f"STRING) AS `_inspire_note`, CAST(`dismiss_reason` AS STRING) AS `_inspire_reason`, {comment} AS `_inspire_comment`, {choice} AS `_inspire_choice`, {batch}, "
               f"{named} AS `_inspire_label`, CAST({quote(KEPT_SINCE)} AS TIMESTAMP) AS `_inspire_missing`, ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY `valid_from` DESC) "
               f"AS `_inspire_nth`, LAG(`action_status`) OVER (PARTITION BY `record_key` ORDER BY `valid_from`) AS `_inspire_was` "
               f"FROM {versions} WHERE {within}`record_key` IN ({acted})"),
        "hk": (f"SELECT `record_key` AS `_inspire_kk`, `action_status` AS `_inspire_closed_as`, `valid_from` AS `_inspire_closed`, "
               f"`changed_by` AS `_inspire_closer`, `_inspire_stake` AS `_inspire_at_close`, `_inspire_batch` AS `_inspire_closed_batch`, "
               f"`_inspire_batch_undo` AS `_inspire_closed_undo`, `_inspire_batch_note` AS `_inspire_closed_note`, "
               f"NULLIF(TRIM(`_inspire_reason`), '') AS `_inspire_closed_reason`, NULLIF(TRIM(`_inspire_comment`), '') AS "
               f"`_inspire_closed_comment`, ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY `valid_from` DESC) AS `_inspire_kth` "
               f"FROM hx WHERE {closes}"),
        "hw": (f"SELECT hx.*, CASE WHEN {closes} THEN 1 ELSE 0 END AS `_inspire_closes`, MAX(CASE WHEN {closes} THEN `valid_from` END) "
               f"OVER (PARTITION BY `record_key`) AS `_inspire_closed` FROM hx"),
        "hu": f"SELECT hw.*, MAX(CASE WHEN {after} THEN `valid_from` END) OVER (PARTITION BY `record_key`) AS `_inspire_ran` FROM hw",
        "ho": (f"SELECT `record_key` AS `_inspire_k`, {last('`_inspire_label`')} AS `_inspire_label`, {last('`action_status`')} AS "
               f"`_inspire_status`, {last('`_inspire_choice`')} AS `_inspire_choice`, MAX(`_inspire_closed`) AS `_inspire_closed`, {at_close('`changed_by`')} AS `_inspire_closer`, "
               f"{at_close('`_inspire_stake`')} AS `_inspire_at_close`, "
               f"{last('`_inspire_realized`')} AS `_inspire_realized`, NULLIF(TRIM({last('`_inspire_note`')}), '') AS `_inspire_note`, "
               f"NULLIF(TRIM({last('`_inspire_reason`')}), '') AS `_inspire_reason`, CASE WHEN {gone} THEN 'left' WHEN {absent} THEN "
               f"'missing' WHEN {ran('`action_outcome`')} = '{RESOLVED}' THEN 'resolved' WHEN {ran('`action_outcome`')} = '{STILL_FLAGGED}' "
               f"THEN 'flagged' ELSE 'unchecked' END AS `_inspire_state`, CASE WHEN {gone} OR {absent} THEN 0 ELSE "
               f"{ran('`_inspire_stake`')} END AS `_inspire_now`, COALESCE(MIN(CASE WHEN {after} AND `action_outcome` = '{RESOLVED}' THEN "
               f"`valid_from` END), CASE WHEN {gone} THEN {last('`valid_to`')} ELSE {last('`_inspire_missing`')} END) AS `_inspire_seen` "
               f"FROM hu GROUP BY `record_key` HAVING MAX(`_inspire_closed`) IS NOT NULL AND {last('`change_source`')} <> 'delete' AND "
               f"{at_close('`action_status`')} = {last('`action_status`')}"),
        "hm": (f"SELECT o.*, CASE WHEN o.`_inspire_status` = '{DONE}' AND o.`_inspire_state` IN ({sql_list(GONE_STATES)}) THEN 1 ELSE 0 END "
               f"AS `_inspire_measured_ok`, CASE WHEN o.`_inspire_status` = '{DONE}' AND o.`_inspire_state` IN ({sql_list(GONE_STATES)}) AND "
               f"o.`_inspire_at_close` IS NOT NULL THEN GREATEST(o.`_inspire_at_close` - COALESCE(o.`_inspire_now`, 0), 0) END AS "
               f"`_inspire_measured` FROM ho AS o"),
    }


CLOSING_ORDER = ("avd", "hx", "hw", "hu", "ho", "hmd", "hm")
CHANGED_ACTED = "SELECT * FROM av WHERE `record_key` IN (SELECT `_q_key` FROM qk)"
CLOSED_COLUMNS = (("_inspire_k", "STRING"), ("_inspire_label", "STRING"), ("_inspire_status", "STRING"), ("_inspire_choice", "STRING"),
                  ("_inspire_closed", "TIMESTAMP"),
                  ("_inspire_closer", "STRING"), ("_inspire_at_close", "DOUBLE"), ("_inspire_realized", "DOUBLE"), ("_inspire_note", "STRING"), ("_inspire_reason", "STRING"),
                  ("_inspire_state", "STRING"), ("_inspire_now", "DOUBLE"), ("_inspire_seen", "TIMESTAMP"), ("_inspire_measured_ok", "INT"),
                  ("_inspire_measured", "DOUBLE"))
CHANGED_KEY = "_inspire_changed"
CLOSED_FIELDS = {"_inspire_closed_by": "_inspire_closer", "_inspire_closed_at": "_inspire_closed", "_inspire_closed_batch": "_inspire_closed_batch",
                 "_inspire_closed_undo": "_inspire_closed_undo", "_inspire_closed_note": "_inspire_closed_note",
                 "_inspire_closed_reason": "_inspire_closed_reason", "_inspire_closed_comment": "_inspire_closed_comment"}
CLOSED_AS = "_inspire_closed_as"


def closes_facts(table: str) -> dict:
    return {"table": table, "fields": list(CLOSED_FIELDS)}


def pinned_closes(facts) -> bool:
    held = facts.get("closes") if isinstance(facts, dict) else None
    return isinstance(held, dict) and bool(held.get("table")) and held.get("fields") == list(CLOSED_FIELDS)


def latest_closes(key: str, status: str, alias) -> str:
    picked = ", ".join(f"z.`{name}` AS `{alias(field)}`" for field, name in CLOSED_FIELDS.items())
    return f"SELECT z.`_inspire_kk` AS `{key}`, z.`{CLOSED_AS}` AS `{status}`, {picked} FROM hk AS z WHERE z.`_inspire_kth` = 1"


def pinned_closes_sql(closes: str, key: str, status: str, alias, keys: str = "") -> str:
    picked = ", ".join(f"z.`{field}` AS `{alias(field)}`" for field in CLOSED_FIELDS)
    within = f" WHERE z.`_inspire_k` IN ({keys})" if keys else ""
    return f"SELECT z.`_inspire_k` AS `{key}`, z.`{CLOSED_AS}` AS `{status}`, {picked} FROM {closes} AS z{within}"


def changed_closing_sql(table: str, names: set, label=None, limit: int = 0) -> tuple:
    live = closing_ctes(table, names, label, source="avd")
    steps = dict({"avd": CHANGED_ACTED}, **{name: live[name] for name in ("hx", "hw", "hu", "ho", "hm")})
    picked = ", ".join(f"h.{quote(name)}" for name, _kind in CLOSED_COLUMNS)
    return steps, (f"SELECT k.`_q_key` AS `{CHANGED_KEY}`, {picked} FROM qk AS k LEFT JOIN hm AS h ON h.`_inspire_k` = k.`_q_key` "
                   f"ORDER BY k.`_q_key` LIMIT {int(limit)}")


def closed_now_sql(closed: str, changed: list, add) -> str:
    keys = sorted({str(r[CHANGED_KEY]) for r in changed})
    if not keys:
        return f"SELECT * FROM {closed}"
    kept = f"SELECT * FROM {closed} WHERE `_inspire_k` NOT IN (SELECT explode(from_json({add(json.dumps(keys))}, 'ARRAY<STRING>')))"
    rows = [{name: r.get(name) for name, _kind in CLOSED_COLUMNS} for r in changed if r.get("_inspire_k") is not None]
    if not rows:
        return kept
    shape = ", ".join(f"`{name}`: {kind}" for name, kind in CLOSED_COLUMNS)
    return f"{kept} UNION ALL SELECT inline(from_json({add(json.dumps(rows, default=str))}, 'ARRAY<STRUCT<{shape}>>'))"


def closed_rows_sql(acted: str, names: set, label=None) -> str:
    closing = closing_ctes(acted, names, label, source=acted)
    return "WITH " + ", ".join(f"{name} AS ({closing[name]})" for name in CLOSING_ORDER if name in closing) + " SELECT * FROM hm"


def closes_rows_sql(acted: str, names: set, label=None) -> str:
    closing = closing_ctes(acted, names, label, source=acted)
    return f"WITH hx AS ({closing['hx']}), hk AS ({closing['hk']}) {latest_closes('_inspire_k', CLOSED_AS, lambda field: field)}"


def acted_columns(names, label=None) -> list:
    return [c for c in ACTED_COLUMNS if c in names] + ([label] if label and label in names and label not in ACTED_COLUMNS else [])


def acted_versions_sql(table: str, names: set, label=None, scope: str = "", history=None) -> str:
    within = f"{scope} AND " if scope else ""
    keys = f"SELECT DISTINCT `record_key` FROM {table} WHERE {within}{acted_condition(names)}"
    versions = f"{versions_source(table, history, keys)} AS hv" if history else table
    columns = acted_columns(names, label)
    plain = ", ".join(quote(c) for c in columns)
    closing = closing_ctes(table, names, label, source="a")
    marked = (f"SELECT {plain}, ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY `valid_from` DESC) AS `_a_nth`, "
              f"LEAD(`change_source`) OVER (PARTITION BY `record_key` ORDER BY `valid_from`) AS `_a_next`, "
              f"ROW_NUMBER() OVER (PARTITION BY `record_key`, `change_source` = 'run' ORDER BY `valid_from` DESC) AS `_a_run` "
              f"FROM {versions} WHERE {within}`record_key` IN ({keys})")
    resolved = (f"SELECT a.`record_key` AS `_a_key`, MIN(a.`valid_from`) AS `_a_ok` FROM a JOIN hk ON hk.`_inspire_kk` = a.`record_key` AND "
                f"hk.`_inspire_kth` = 1 WHERE a.`change_source` = 'run' AND a.`action_outcome` = '{RESOLVED}' AND a.`valid_from` > "
                f"hk.`_inspire_closed` GROUP BY a.`record_key`")
    kept = ("a.`change_source` <> 'run' OR a.`_a_next` <> 'run' OR a.`_a_nth` = 1 OR (a.`change_source` = 'run' AND a.`_a_run` = 1) "
            "OR a.`valid_from` = z.`_a_ok`")
    return (f"WITH a AS ({marked}), hx AS ({closing['hx']}), hk AS ({closing['hk']}), z AS ({resolved}) "
            f"SELECT {', '.join(f'a.{quote(c)}' for c in columns)} FROM a LEFT JOIN z ON z.`_a_key` = a.`record_key` WHERE {kept}")


def weighted(rows: str, weight: str = "1") -> str:
    return f"(SELECT r.*, {weight} AS `{WEIGHT}` FROM {rows} AS r)"


def current_cells(names: set, alias: str) -> dict:
    live = f"COALESCE({alias}.`is_current` AND {alias}.`change_source` <> 'delete', FALSE)"
    held = f"COALESCE({alias}.`held_back`, FALSE)" if "held_back" in names else "FALSE"
    return {"current_n": f"CASE WHEN {live} THEN 1 ELSE 0 END", "held_n": f"CASE WHEN {live} AND {held} THEN 1 ELSE 0 END"}


def estimated_cell(names: set, tier, alias: str, stake: str) -> tuple:
    if not tier or tier not in names:
        return None, None, None
    shown = f"CAST({alias}.{quote(tier)} AS STRING)"
    opened = f" AND COALESCE({alias}.`action_status`, '{NEW}') IN ({sql_list(OPEN_STATUSES)})" if "action_status" in names else ""
    counted = (f"COALESCE({alias}.`is_current` AND {alias}.`change_source` <> 'delete' AND {shown} IN ({sql_list(FLAGGED_TIERS)}){opened}, "
               f"FALSE)")
    return shown, f"CASE WHEN {counted} THEN 1 ELSE 0 END", f"CASE WHEN {counted} THEN {stake} END"


def holdout_cells(alias: str, names=()) -> dict:
    missing = f" OR {alias}.{quote(KEPT_SINCE)} IS NOT NULL" if KEPT_SINCE in names else ""
    left = (f"{alias}.`record_key` IS NULL{missing} OR NOT COALESCE({alias}.`run_tier` IN ({sql_list(FLAGGED_TIERS)}), FALSE)")
    counted = f"COALESCE({alias}.`change_source`, '') <> 'delete'"
    return {"n": f"CASE WHEN {counted} THEN 1 ELSE 0 END", "hits": f"CASE WHEN {counted} AND ({left}) THEN 1 ELSE 0 END"}


def left_cell(alias: str) -> str:
    return f"CASE WHEN {alias}.`record_key` IS NULL OR {alias}.`change_source` = 'delete' THEN 1 ELSE 0 END"


def held_ctes(log: str, scope: str = "", keys: str = "") -> str:
    within = f"{scope} AND " if scope else ""
    picked = f" AND `record_key` IN ({keys})" if keys else ""
    flagged = sql_list(FLAGGED_TIERS)
    return (f"SELECT `record_key` AS `_inspire_hk`, MAX(CASE WHEN `held_back` THEN 1 ELSE 0 END) AS `_inspire_held`, MAX(CASE WHEN "
            f"`run_tier` IN ({flagged}) THEN 1 ELSE 0 END) AS `_inspire_flagged` FROM {log} WHERE {within}`held_back` IS NOT NULL"
            f"{picked} GROUP BY `record_key`")


def previous_keys(log: str, previous: str, scope: str = "", keys: str = "") -> str:
    within = f"{scope} AND " if scope else ""
    picked = f" AND `record_key` IN ({keys})" if keys else ""
    return f"SELECT DISTINCT `record_key` AS `_inspire_pk` FROM {log} WHERE {within}CAST(`run_id` AS STRING) = {previous}{picked}"


def live_rows(rows: str) -> str:
    return f"(SELECT * FROM {rows} AS r WHERE r.`is_current`)"


def counts_sql(rows: str, names: set) -> str:
    cells = current_cells(names, "c")
    return (f"SELECT COALESCE(SUM({cells['current_n']}), 0) AS `_inspire_n`, COALESCE(SUM({cells['held_n']}), 0) AS `_inspire_held` "
            f"FROM {rows} AS c")


def estimated_sql(rows: str, names: set, tier, stake: str, joined: str = "") -> str:
    shown, counted, money = estimated_cell(names, tier, "c", stake)
    return (f"SELECT {shown} AS `_inspire_tier`, SUM({counted}) AS `_inspire_n`, SUM({money}) AS `_inspire_money` FROM {rows} AS c{joined} "
            f"WHERE {counted} = 1 GROUP BY {shown}")


def holdout_sql(held: str, rows: str, names=()) -> str:
    cells = holdout_cells("c", names)
    return (f"SELECT h.`_inspire_held`, SUM({cells['n']}) AS `_inspire_n`, SUM({cells['hits']}) AS `_inspire_hits` FROM ({held}) AS h LEFT JOIN "
            f"{live_rows(rows)} AS c ON c.`record_key` = h.`_inspire_hk` WHERE h.`_inspire_flagged` = 1 GROUP BY h.`_inspire_held`")


def left_sql(log: str, previous: str, rows: str, scope: str = "") -> str:
    return (f"SELECT SUM({left_cell('c')}) AS `_inspire_left` FROM ({previous_keys(log, previous, scope)}) AS p LEFT JOIN {live_rows(rows)} "
            f"AS c ON c.`record_key` = p.`_inspire_pk`")


def snapshot_numbers_sql(table: str, names: set, tier, log: str, previous, scope: str = "", version=None) -> str:
    source = f"{table} VERSION AS OF {int(version)}" if version is not None else table
    within = f" WHERE {scope}" if scope else ""
    rows = f"(SELECT * FROM {source}{within})"
    branches = [f"SELECT 'counts' AS `kind`, CAST(NULL AS STRING) AS `tier`, `_inspire_n` AS `n`, `_inspire_held` AS `hits`, "
                f"CAST(NULL AS DOUBLE) AS `money` FROM ({counts_sql(rows, names)}) AS x"]
    if tier and tier in names:
        branches.append(f"SELECT 'estimated' AS `kind`, `_inspire_tier` AS `tier`, `_inspire_n` AS `n`, CAST(NULL AS BIGINT) AS `hits`, "
                        f"`_inspire_money` AS `money` FROM ({estimated_sql(rows, names, tier, stake_of(names, 'c'))}) AS x")
    if previous is not None:
        branches.append(f"SELECT 'left' AS `kind`, CAST(NULL AS STRING) AS `tier`, `_inspire_left` AS `n`, CAST(NULL AS BIGINT) AS `hits`, "
                        f"CAST(NULL AS DOUBLE) AS `money` FROM ({left_sql(log, previous, rows, scope)}) AS x")
    if all(n in names for n in HOLDOUT_TYPES) and tier:
        branches.append(f"SELECT 'holdout' AS `kind`, CASE WHEN `_inspire_held` = 1 THEN 'held' ELSE 'shown' END AS `tier`, `_inspire_n` AS `n`, "
                        f"`_inspire_hits` AS `hits`, CAST(NULL AS DOUBLE) AS `money` FROM ({holdout_sql(held_ctes(log, scope), rows, names)}) AS x")
    return " UNION ALL ".join(branches)


def change_ctes(table: str, stamp, people: list, columns, scope: str = "") -> dict:
    at = f"timestamp_micros({int(stamp)})"
    within = f" AND {scope}" if scope else ""
    listed = " UNION ALL ".join(f"SELECT CAST({k} AS STRING) AS `k`, CAST({v} AS BIGINT) AS `v`" for k, v in people)
    kept = ", ".join(f"q.{quote(c)}" for c in columns if c not in ("is_current", "valid_to"))
    return {
        "qp": listed or "SELECT CAST(NULL AS STRING) AS `k`, CAST(NULL AS BIGINT) AS `v` WHERE FALSE",
        "q": (f"SELECT t.*, (t.`valid_from` <= {at} OR pf.`k` IS NOT NULL) AS `_q_in`, (t.`valid_to` IS NULL OR (t.`valid_to` > {at} AND "
              f"pt.`k` IS NULL)) AS `_q_open` FROM (SELECT * FROM {table} WHERE (`valid_from` > {at} OR `valid_to` > {at}){within}) AS t "
              f"LEFT JOIN qp AS pf ON pf.`k` = t.`record_key` AND pf.`v` = unix_micros(t.`valid_from`) LEFT JOIN qp AS pt ON pt.`k` = "
              f"t.`record_key` AND pt.`v` = unix_micros(t.`valid_to`)"),
        "qk": "SELECT DISTINCT `record_key` AS `_q_key` FROM q WHERE NOT `_q_in`",
        "qn": "SELECT q.* FROM q JOIN qk ON qk.`_q_key` = q.`record_key` WHERE q.`is_current`",
        "qt": (f"SELECT {kept}, TRUE AS `is_current`, CAST(NULL AS TIMESTAMP) AS `valid_to` FROM q JOIN qk ON qk.`_q_key` = q.`record_key` "
               f"WHERE q.`_q_in` AND q.`_q_open`"),
    }


CHANGE_ORDER = ("qp", "q", "qk", "qn", "qt")


PAIRED = "FROM qk AS k LEFT JOIN qn AS n ON n.`record_key` = k.`_q_key` LEFT JOIN qt AS t ON t.`record_key` = k.`_q_key`"


def count_delta_sql(names: set) -> str:
    now, then = current_cells(names, "n"), current_cells(names, "t")
    return (f"SELECT COALESCE(SUM({now['current_n']} - {then['current_n']}), 0) AS `_inspire_n`, COALESCE(SUM({now['held_n']} - "
            f"{then['held_n']}), 0) AS `_inspire_held` {PAIRED}")


def floors_sql(rows: str, names: set, depths=FLOOR_DEPTHS) -> str:
    if MONEY_COLUMN not in names:
        return ""
    live = "c.`is_current` AND c.`change_source` <> 'delete'"
    opened = f" AND COALESCE(c.`action_status`, '{NEW}') IN ({sql_list(OPEN_STATUSES)})" if "action_status" in names else ""
    kept = " AND NOT COALESCE(c.`held_back`, FALSE)" if "held_back" in names else ""
    deepest, picked = max(depths), ", ".join(str(int(k)) for k in depths)
    branch = lambda name, extra: (f"SELECT '{name}' AS `set`, `n` AS `k`, `s` AS `x` FROM (SELECT `s`, ROW_NUMBER() OVER (ORDER BY `s` DESC) AS "
                                  f"`n` FROM (SELECT {stored_stake('c')} AS `s` FROM {rows} AS c WHERE {live}{extra} AND "
                                  f"c.{quote(MONEY_COLUMN)} IS NOT NULL ORDER BY `s` DESC LIMIT {int(deepest)}) AS t) AS r WHERE `n` IN ({picked})")
    ranked = ""
    if "rank" in names:
        ranked = (f" UNION ALL SELECT 'rank' AS `set`, `n` AS `k`, `s` AS `x` FROM (SELECT `s`, ROW_NUMBER() OVER (ORDER BY `s` ASC) AS `n` "
                  f"FROM (SELECT CAST(c.`rank` AS DOUBLE) AS `s` FROM {rows} AS c WHERE {live} AND c.`rank` IS NOT NULL ORDER BY `s` ASC "
                  f"LIMIT {int(deepest)}) AS t) AS r WHERE `n` IN ({picked})")
    return f"{branch('open', opened + kept)} UNION ALL {branch('all', '')}{ranked}"


def floors_of(rows) -> dict:
    out = {"open": [], "all": [], "rank": []}
    for row in rows or []:
        if row.get("set") in out and row.get("x") is not None:
            out[row["set"]].append([int(row["k"]), float(row["x"])])
    return {name: sorted(found) for name, found in out.items()}


def floor_depth(depths, need: int, filtered: bool):
    usable = [int(k) for k in depths if int(k) >= need * FLOOR_MARGIN]
    if not usable:
        return None
    return max(usable) if filtered else min(usable)


def floor_for(floors: dict, name: str, need: int, filtered: bool):
    kept = {int(k): x for k, x in (floors or {}).get(name) or []}
    depth = floor_depth(kept, need, filtered)
    return None if depth is None else kept[depth]


def delta_numbers_sql(names: set, tier, log: str, previous, stake_now: str, stake_then: str, scope: str = "", keys: str = CHANGED_KEYS,
                      missed: str = "0") -> str:
    branches = [f"SELECT 'counts' AS `kind`, CAST(NULL AS STRING) AS `tier`, `_inspire_n` AS `n`, `_inspire_held` AS `hits`, "
                f"CAST(NULL AS DOUBLE) AS `money` FROM ({count_delta_sql(names)}) AS x"]
    pair = PAIRED
    shown_now, counted_now, money_now = estimated_cell(names, tier, "n", stake_now)
    if shown_now:
        shown_then, counted_then, money_then = estimated_cell(names, tier, "t", stake_then)
        branches.append(f"SELECT 'estimated' AS `kind`, x.`tier`, SUM(x.`n`) AS `n`, CAST(NULL AS BIGINT) AS `hits`, SUM(x.`money`) AS `money` "
                        f"FROM (SELECT {shown_now} AS `tier`, {counted_now} AS `n`, {money_now} AS `money` FROM qn AS n UNION ALL SELECT "
                        f"{shown_then} AS `tier`, -{counted_then} AS `n`, -({money_then}) AS `money` FROM qt AS t) AS x WHERE x.`n` <> 0 "
                        f"GROUP BY x.`tier`")
    if previous is not None:
        branches.append(f"SELECT 'left' AS `kind`, CAST(NULL AS STRING) AS `tier`, `_inspire_left` AS `n`, CAST(NULL AS BIGINT) AS `hits`, "
                        f"CAST(NULL AS DOUBLE) AS `money` FROM ({left_delta_sql(log, previous, scope, keys)}) AS l")
    if all(n in names for n in HOLDOUT_TYPES) and tier:
        held_now, held_then = holdout_cells("n", names), holdout_cells("t", names)
        branches.append(f"SELECT 'holdout' AS `kind`, CASE WHEN h.`_inspire_held` = 1 THEN 'held' ELSE 'shown' END AS `tier`, "
                        f"SUM({held_now['n']} - {held_then['n']}) AS `n`, SUM({held_now['hits']} - {held_then['hits']}) AS `hits`, "
                        f"CAST(NULL AS DOUBLE) AS `money` {pair} JOIN ({held_ctes(log, scope, keys)}) AS h ON "
                        f"h.`_inspire_hk` = k.`_q_key` WHERE h.`_inspire_flagged` = 1 GROUP BY 1, 2")
    branches.append("SELECT 'changed' AS `kind`, CAST(NULL AS STRING) AS `tier`, (SELECT COUNT(*) FROM qk) AS `n`, "
                    "(SELECT COUNT(*) FROM q) AS `hits`, CAST((SELECT unix_micros(GREATEST(MAX(`valid_from`), COALESCE(MAX(`valid_to`), "
                    "MAX(`valid_from`)))) FROM q) AS DOUBLE) AS `money`")
    branches.append(f"SELECT 'missed' AS `kind`, CAST(NULL AS STRING) AS `tier`, CAST({missed} AS BIGINT) AS `n`, CAST(NULL AS BIGINT) AS "
                    f"`hits`, CAST(NULL AS DOUBLE) AS `money`")
    return " UNION ALL ".join(branches)


def acted_source(acted: str, columns: list) -> str:
    plain = ", ".join(quote(c) for c in columns)
    return (f"(SELECT {plain} FROM {acted} AS a WHERE NOT EXISTS (SELECT 1 FROM q WHERE q.`record_key` = a.`record_key` AND q.`valid_from` = "
            f"a.`valid_from`) UNION ALL SELECT {plain} FROM q)")


def action_cells(alias: str) -> dict:
    live = f"{alias}.`change_source` <> 'delete'"
    done = f"{live} AND {alias}.`action_status` = '{DONE}'"
    return {"open_n": f"CASE WHEN {live} AND {alias}.`is_current` AND {alias}.`action_status` IN ({sql_list(OPEN_STATUSES)}) THEN 1 ELSE 0 END",
            "done_n": f"CASE WHEN {done} THEN 1 ELSE 0 END",
            "resolved_n": f"CASE WHEN {done} AND (NOT {alias}.`is_current` OR {alias}.`action_outcome` = '{RESOLVED}') THEN 1 ELSE 0 END"}


ACTION_NUMBERS = ("open_n", "done_n", "resolved_n")


def action_counts_sql(source: str) -> str:
    cells = action_cells("a")
    picked = ", ".join(f"COALESCE(SUM({cells[name]}), 0) AS {name}" for name in ACTION_NUMBERS)
    return (f"SELECT {picked} FROM (SELECT `is_current`, `change_source`, `action_status`, `action_outcome` FROM {source} WHERE "
            f"`record_key` IN (SELECT `record_key` FROM {source} WHERE `action_status` IS NOT NULL) QUALIFY ROW_NUMBER() OVER (PARTITION BY "
            f"`record_key` ORDER BY `valid_from` DESC) = 1) AS a")


def action_numbers_of(rows) -> dict:
    row = (rows or [{}])[0] or {}
    return {name: int(row.get(name) or 0) for name in ACTION_NUMBERS}


def action_delta_sql(acted: str, base: dict, keys: str = CHANGED_KEYS) -> str:
    latest = lambda source, among: (f"(SELECT `record_key`, `is_current`, `change_source`, `action_status`, `action_outcome` FROM {source} "
                                    f"WHERE `record_key` IN ({among}) QUALIFY ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY "
                                    f"`valid_from` DESC) = 1)")
    now, then = action_cells("n"), action_cells("t")
    picked = ", ".join(f"{int(base[name])} + COALESCE(SUM({now[name]} - {then[name]}), 0) AS {name}" for name in ACTION_NUMBERS)
    return (f"SELECT {picked} FROM qk AS k LEFT JOIN {latest('q', CHANGED_KEYS)} AS n ON n.`record_key` = k.`_q_key` LEFT JOIN "
            f"{latest(acted, keys)} AS t ON t.`record_key` = k.`_q_key`")


def latest_changes_sql(log: str, latest: str, scope: str = "") -> str:
    within = f"{scope} AND " if scope else ""
    return (f"SELECT CAST(`run_id` AS STRING) AS `run_id`, `record_key`, `change`, `moved_to` FROM {log} WHERE {within}"
            f"CAST(`run_id` AS STRING) = {latest} AND `change` IS NOT NULL")


def owners_sql(source: str, limit: int = OWNER_ROWS) -> str:
    return (f"SELECT `action_owner` AS v FROM {source} WHERE `is_current` AND `change_source` <> 'delete' AND TRIM(`action_owner`) <> '' "
            f"GROUP BY `action_owner` ORDER BY COUNT(*) DESC, v LIMIT {int(limit)}")


def left_delta_sql(log: str, previous: str, scope: str = "", keys: str = CHANGED_KEYS) -> str:
    return (f"SELECT COALESCE(SUM({left_cell('n')} - {left_cell('t')}), 0) AS `_inspire_left` FROM qk AS k LEFT JOIN qn AS n ON "
            f"n.`record_key` = k.`_q_key` LEFT JOIN qt AS t ON t.`record_key` = k.`_q_key` JOIN "
            f"({previous_keys(log, previous, scope, keys)}) AS p ON p.`_inspire_pk` = k.`_q_key`")


def missed_sql(select: str, missed: str) -> str:
    return f"SELECT x.*, CAST({missed} AS BIGINT) AS `{MISSED}` FROM ({select}) AS x"


def runs_sql(log: str, tier: bool, scope: str = "", limit: int = RUN_ROWS) -> str:
    shown = "CAST(`tier` AS STRING)" if tier else "CAST(NULL AS STRING)"
    within = f" WHERE {scope}" if scope else ""
    return (f"SELECT CAST(`run_id` AS STRING) AS run_id, {shown} AS tier, MAX(CAST(`as_of_date` AS DATE)) AS as_of_date, MIN(`ran_at`) "
            f"AS ran_at, unix_micros(MIN(`ran_at`)) AS ran_us, COUNT(*) AS n FROM {log}{within} GROUP BY 1, 2 ORDER BY ran_at DESC "
            f"LIMIT {int(limit)}")


def numbers_of(rows) -> dict:
    out = {"current_n": 0, "held_n": 0, "left_n": None, "estimated": {}, "holdout": {}, "changed": None, "missed": 0}
    for row in rows or []:
        kind = row.get("kind")
        if kind == "counts":
            out["current_n"], out["held_n"] = int(row.get("n") or 0), int(row.get("hits") or 0)
        elif kind == "estimated" and row.get("tier") is not None:
            out["estimated"][str(row["tier"])] = {"n": int(row.get("n") or 0), "money": None if row.get("money") is None else float(row["money"])}
        elif kind == "left":
            out["left_n"] = int(row.get("n") or 0)
        elif kind == "holdout" and row.get("tier") is not None:
            out["holdout"][str(row["tier"])] = {"n": int(row.get("n") or 0), "hits": int(row.get("hits") or 0)}
        elif kind == "changed":
            out["changed"] = {"keys": int(row.get("n") or 0), "rows": int(row.get("hits") or 0),
                              "latest_us": None if row.get("money") is None else int(float(row["money"]))}
        elif kind == "missed":
            out["missed"] = int(row.get("n") or 0)
    return out


def added_numbers(base: dict, delta: dict) -> dict:
    out = {k: base.get(k) for k in FACT_NUMBERS}
    for key in FACT_NUMBERS:
        if out[key] is not None and delta.get(key) is not None:
            out[key] = int(out[key]) + int(delta[key])
    estimated = {tier: dict(v) for tier, v in (base.get("estimated") or {}).items()}
    for tier, change in (delta.get("estimated") or {}).items():
        held = estimated.setdefault(tier, {"n": 0, "money": None})
        held["n"] = int(held["n"]) + int(change["n"])
        if change.get("money") is not None:
            held["money"] = (held["money"] or 0.0) + float(change["money"])
    holdout = {state: dict(v) for state, v in (base.get("holdout") or {}).items()}
    for state, change in (delta.get("holdout") or {}).items():
        held = holdout.setdefault(state, {"n": 0, "hits": 0})
        held["n"], held["hits"] = int(held["n"]) + int(change["n"]), int(held["hits"]) + int(change["hits"])
    return settled(dict(out, estimated=estimated, holdout=holdout))


def settled(numbers: dict) -> dict:
    return dict(numbers, estimated={k: v for k, v in (numbers.get("estimated") or {}).items() if v["n"]},
                holdout={k: v for k, v in (numbers.get("holdout") or {}).items() if v["n"]})


def facts_problem(facts) -> str:
    if not isinstance(facts, dict):
        return "the latest run kept no counts for the App"
    if facts.get("v") != FACTS_VERSION:
        return "the latest run kept its counts in an older shape"
    for key in ("log", "acted", "closed", "changes", "actions", "stamp_us", "people", "numbers", "runs", "names", "columns"):
        if key not in facts:
            return f"the latest run's counts have no {key}"
    if not isinstance(facts.get("actions"), dict) or any(not isinstance(facts["actions"].get(name), int) for name in ACTION_NUMBERS):
        return "the latest run's counts have no action counts"
    if not isinstance(facts.get("people"), list) or len(facts["people"]) > PEOPLE_MAX:
        return "the latest run's counts list too many changes made while it ran"
    return ""




LEDGER_TABLE = "__inspire_value_ledger"
LEDGER_COLUMNS = (("session_id", "STRING"), ("result_table", "STRING"), ("use_case_id", "STRING"), ("run_id", "STRING"),
                  ("record_key", "STRING"), ("kind", "STRING"), ("currency", "STRING"), ("unit", "STRING"), ("at_stake", "DOUBLE"),
                  ("saved", "DOUBLE"), ("recorded_at", "TIMESTAMP"), ("recorded_by", "STRING"))
LEDGER_NAMES = tuple(name for name, _kind in LEDGER_COLUMNS)
LEDGER_COLUMNS_DDL = ", ".join(f"`{name}` {kind}" for name, kind in LEDGER_COLUMNS)


def ledger_table(inspire_database: str) -> str:
    return table_name(f"{str(inspire_database or '').strip()}.{LEDGER_TABLE}")


def ledger_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)):
            raise ValueError("a ledger amount is a finite number, or NULL when it is not measured")
        return repr(float(value))
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def ledger_create_sql(table: str) -> str:
    return f"CREATE TABLE IF NOT EXISTS {table} ({LEDGER_COLUMNS_DDL})"


LEDGER_GRANTS = ("SELECT", "MODIFY")


def quote_principal(principal) -> str:
    return "`" + str(principal or "").strip().replace("`", "``") + "`"


def ledger_grant_sqls(table: str, principal: str) -> list:
    if not str(principal or "").strip():
        raise ValueError("the value ledger grant needs the App's service principal")
    return [f"GRANT {privilege} ON TABLE {table} TO {quote_principal(principal)}" for privilege in LEDGER_GRANTS]


def ledger_stake_row(session_id, result_table, use_case_id, run_id, kind, currency, unit, at_stake, recorded_by="") -> dict:
    return {"session_id": str(session_id), "result_table": result_table, "use_case_id": str(use_case_id), "run_id": str(run_id),
            "record_key": None, "kind": kind, "currency": currency or None, "unit": unit or None, "at_stake": at_stake, "saved": None,
            "recorded_by": recorded_by or None}


def ledger_saved_row(session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, saved, recorded_by="") -> dict:
    return {"session_id": str(session_id), "result_table": result_table, "use_case_id": str(use_case_id), "run_id": str(run_id),
            "record_key": str(record_key), "kind": kind, "currency": currency or None, "unit": unit or None, "at_stake": None,
            "saved": saved, "recorded_by": recorded_by or None}


def ledger_insert_sql(table: str, rows: list) -> str:
    if not rows:
        raise ValueError("the value ledger insert has no rows")
    names = [name for name in LEDGER_NAMES if name != "recorded_at"]
    tuples = []
    for row in rows:
        unknown = set(row) - set(LEDGER_NAMES)
        if unknown:
            raise ValueError(f"the value ledger has no column {', '.join(sorted(unknown))}")
        tuples.append("(" + ", ".join(ledger_literal(row.get(name)) for name in names) + ", current_timestamp())")
    columns = ", ".join(f"`{name}`" for name in names + ["recorded_at"])
    return f"INSERT INTO {table} ({columns}) VALUES {', '.join(tuples)}"


def ledger_saved_from_batch_sql(table: str, result_table: str, batch_column: str, batch_id: str, found: dict, use_case_id: str,
                                value, recorded_by: str) -> str:
    keys = f"(SELECT DISTINCT `record_key` FROM {table_name(result_table)} WHERE `change_source` = 'action' AND `{batch_column}` = "
    keys += f"{ledger_literal(str(batch_id))} AND `record_key` IS NOT NULL)"
    select = [ledger_literal(str(found["session_id"])), ledger_literal(result_table), ledger_literal(str(use_case_id)),
              ledger_literal(str(found["run_id"])), "`record_key`", ledger_literal(found.get("kind")),
              ledger_literal(found.get("currency") or None), ledger_literal(found.get("unit") or None), "NULL",
              ledger_literal(value), ledger_literal(recorded_by or None)]
    names = [name for name in LEDGER_NAMES if name != "recorded_at"]
    columns = ", ".join(f"`{name}`" for name in names + ["recorded_at"])
    return (f"INSERT INTO {table} ({columns}) SELECT {', '.join(select)}, current_timestamp() FROM {keys} AS batch_keys")


def ledger_clear_from_batch_sql(table: str, result_table: str, use_case_id: str, batch_column: str, batch_id: str,
                                recorded_by: str) -> str:
    keys = (f"(SELECT DISTINCT `record_key` FROM {table_name(result_table)} WHERE `change_source` = 'action' AND `{batch_column}` = "
            f"{ledger_literal(str(batch_id))} AND `record_key` IS NOT NULL)")
    latest = ("SELECT session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, saved, ROW_NUMBER() OVER "
              "(PARTITION BY session_id, result_table, use_case_id, record_key ORDER BY recorded_at DESC, run_id DESC) AS rn "
              f"FROM {table} WHERE result_table = {ledger_literal(result_table)} AND use_case_id = {ledger_literal(str(use_case_id))} "
              "AND record_key IS NOT NULL")
    counted = (f"(SELECT session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit FROM ({latest}) latest "
               "WHERE rn = 1 AND saved IS NOT NULL)")
    names = [name for name in LEDGER_NAMES if name != "recorded_at"]
    columns = ", ".join(f"`{name}`" for name in names + ["recorded_at"])
    select = ("c.session_id, c.result_table, c.use_case_id, c.run_id, c.record_key, c.kind, c.currency, c.unit, NULL, NULL, "
              f"{ledger_literal(recorded_by or None)}")
    return (f"INSERT INTO {table} ({columns}) SELECT {select}, current_timestamp() FROM {counted} AS c "
            f"JOIN {keys} AS k ON k.`record_key` = c.record_key")


def ledger_latest_stake_sql(table: str, result_table: str, use_case_id: str) -> str:
    return (f"SELECT session_id, run_id, kind, currency, unit FROM {table} WHERE result_table = {ledger_literal(result_table)} "
            f"AND use_case_id = {ledger_literal(use_case_id)} AND record_key IS NULL ORDER BY recorded_at DESC LIMIT 1")


GO_LIVE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def ledger_saved_since_sql(table: str, result_table: str, use_case_id: str, since: str) -> str:
    if not GO_LIVE_TIME.match(str(since or "")):
        raise ValueError("the go-live time is an ISO timestamp such as 2026-11-10T20:00:00Z")
    latest = ("SELECT kind, currency, unit, saved, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id, record_key "
              "ORDER BY recorded_at DESC, run_id DESC) AS rn "
              f"FROM {table} WHERE result_table = {ledger_literal(result_table)} AND use_case_id = {ledger_literal(str(use_case_id))} "
              f"AND record_key IS NOT NULL AND recorded_at >= CAST({ledger_literal(since)} AS TIMESTAMP)")
    return ("SELECT kind, currency, unit, CAST(SUM(saved) AS DOUBLE) AS amount, CAST(COUNT(*) AS INT) AS records "
            f"FROM ({latest}) latest WHERE rn = 1 AND saved IS NOT NULL GROUP BY kind, currency, unit")


def rebuild_action(what: str, first: bool = False, page: str = "the Build page") -> str:
    text = f"build {what} again with Vibe/Add/Remove Features on {page}"
    return text[:1].upper() + text[1:] if first else text


# The money rule core. shell_sql and the Inspire run job both read it from here, so the App's KPI, the Genie answer and
# the run's value at stake come from one implementation.

MONEY_CODES = frozenset((
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP "
    "CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR "
    "IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR "
    "MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE "
    "SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XCG XOF "
    "XPF YER ZAR ZMW ZWG ZWL").split())

CURRENCY_FILTER = "currency"

PERIOD_GRAINS = ("week", "month", "quarter", "year")

CONVERTED = "_inspire_converted"

MONEY_RULE_MODES = ("per_currency", "convert")

MONEY_MAX_PERIODS = 60

MONTHS_PER_PERIOD = {"month": 1, "quarter": 3, "year": 12}

IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")

MONEY_TABLE_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}")

MONEY_STATUS_RE = re.compile(r"^[A-Za-z0-9_ -]{1,40}$")

MONEY_RULES = ("losses", "net", "gains")

MONEY_SIGN_KINDS = ("column", "status")

MONEY_PER = ("row", "group")

MONEY_MAX_STATUSES = 20

MONEY_VALUE_METHODS = ("fixed", "column", "equation")

MONEY_EQUATION_MAX_CHARS = 200

MONEY_EQUATION_MAX_TOKENS = 60

MONEY_EQUATION_TOKEN = re.compile(r"\s*(?:([A-Za-z_][A-Za-z0-9_]{0,63})|([0-9]+(?:\.[0-9]+)?)|([-+*/()]))")

MONEY_EQUATION_HELP = ("The equation adds, subtracts, multiplies and divides column names and numbers, with brackets, "
                       "such as quantity * unit_price - discount.")

def money_equation_tokens(text: str):
    tokens, at = [], 0
    while at < len(text):
        if not text[at:].strip():
            break
        found = MONEY_EQUATION_TOKEN.match(text, at)
        if not found:
            return None
        tokens.append(("column", found.group(1)) if found.group(1) else ("number", found.group(2)) if found.group(2)
                      else ("op", found.group(3)))
        at = found.end()
        if len(tokens) > MONEY_EQUATION_MAX_TOKENS:
            return None
    return tokens

def money_equation_sql(expression):
    if not isinstance(expression, str):
        return None
    text = expression.strip()
    if not text or len(text) > MONEY_EQUATION_MAX_CHARS:
        return None
    tokens = money_equation_tokens(text)
    if not tokens:
        return None
    at = 0

    def peek_op(*ops):
        return at < len(tokens) and tokens[at][0] == "op" and tokens[at][1] in ops

    def factor():
        nonlocal at
        if at >= len(tokens):
            raise ValueError("equation")
        kind, value = tokens[at]
        at += 1
        if kind == "number":
            return value
        if kind == "column":
            return quote(value)
        if value == "-":
            return f"(-{factor()})"
        if value == "(":
            inner = sum_()
            if not peek_op(")"):
                raise ValueError("equation")
            at += 1
            return f"({inner})"
        raise ValueError("equation")

    def product():
        nonlocal at
        left = factor()
        while peek_op("*", "/"):
            op = tokens[at][1]
            at += 1
            right = factor()
            left = f"try_divide({left}, {right})" if op == "/" else f"({left} * {right})"
        return left

    def sum_():
        nonlocal at
        left = product()
        while peek_op("+", "-"):
            op = tokens[at][1]
            at += 1
            left = f"({left} {op} {product()})"
        return left

    try:
        sql = sum_()
    except ValueError:
        return None
    return sql if at == len(tokens) else None

def money_value_sql(value: dict):
    if value["method"] == "fixed":
        return repr(float(value["amount"]))
    if value["method"] == "column":
        return f"CAST({quote(value['column'])} AS DOUBLE)"
    equation = money_equation_sql(value["expression"])
    return None if equation is None else f"CAST({equation} AS DOUBLE)"

def money_sign_problems(sign) -> list:
    if not isinstance(sign, dict) or sign.get("kind") not in MONEY_SIGN_KINDS:
        return [f"the gain sign is a column or a status: one of {', '.join(MONEY_SIGN_KINDS)}"]
    if not (isinstance(sign.get("column"), str) and IDENT_RE.fullmatch(sign["column"])):
        return ["the gain sign names a plain column name"]
    if sign["kind"] == "status" and not (isinstance(sign.get("value"), str) and MONEY_STATUS_RE.fullmatch(sign["value"])):
        return ["the gain status is a plain status word such as gain"]
    if sign["kind"] == "status" and "losses" in sign:
        losses = sign["losses"]
        if not isinstance(losses, list) or len(losses) > MONEY_MAX_STATUSES or not all(isinstance(v, str) and MONEY_STATUS_RE.fullmatch(v) for v in losses):
            return ["the loss statuses are plain status words, such as used"]
        if sign.get("value") in losses:
            return ["a status cannot be both a gain and a loss"]
    return []

def money_value_problems(value) -> list:
    if not isinstance(value, dict):
        return ["the value of each record is an object: its method, and its amount, column or equation"]
    if value.get("method") not in MONEY_VALUE_METHODS:
        return [f"the value method is one of {', '.join(MONEY_VALUE_METHODS)}"]
    problems = []
    by_code, by_column = "currency" in value, "currency_column" in value
    if by_code == by_column:
        problems.append("the value names one currency: a code such as USD (currency), or the column that holds it (currency_column)")
    elif by_code and value["currency"] not in MONEY_CODES:
        problems.append("the value currency is an ISO 4217 code such as USD")
    elif by_column and not (isinstance(value["currency_column"], str) and IDENT_RE.fullmatch(value["currency_column"])):
        problems.append("the value currency_column is a plain column name")
    method = value["method"]
    if method == "fixed":
        amount = value.get("amount")
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not 0 < amount <= 1e12:
            problems.append("a fixed value is a positive amount per record")
    if method == "column" and not (isinstance(value.get("column"), str) and IDENT_RE.fullmatch(value["column"])):
        problems.append("a column value names the plain column that holds each amount")
    if method == "equation" and money_equation_sql(value.get("expression")) is None:
        problems.append(MONEY_EQUATION_HELP)
    return problems

def money_rule_problems(money) -> list:
    problems = _money_rule_problems(money)
    if isinstance(money, dict) and "value" in money:
        problems += money_value_problems(money["value"])
    return problems

def _money_rule_problems(money) -> list:
    """The money rule, the same rules as the Inspire backend (app/backend/lib/moneyRule.js), checked against one fixture."""
    if money is None:
        return []
    if not isinstance(money, dict):
        return ["the money rule is an object: currency mode and, when it converts, base and rates"]
    mode = money.get("currency", "per_currency")
    if mode not in MONEY_RULE_MODES:
        return [f"the money currency mode is one of {', '.join(MONEY_RULE_MODES)}"]
    problems = []
    window = money.get("window")
    if window is not None:
        periods = window.get("periods") if isinstance(window, dict) else None
        if not isinstance(periods, int) or isinstance(periods, bool) or not 1 <= periods <= MONEY_MAX_PERIODS:
            problems.append(f"the money window counts 1 to {MONEY_MAX_PERIODS} closed periods")
    if "statuses" in money:
        statuses = money["statuses"]
        if not isinstance(statuses, list) or not 1 <= len(statuses) <= MONEY_MAX_STATUSES:
            problems.append(f"the statuses are a list of 1 to {MONEY_MAX_STATUSES} status values")
        else:
            problems += [f"the status {s!r} is a plain word such as used" for s in statuses
                         if not isinstance(s, str) or not MONEY_STATUS_RE.match(s)]
    if "statuses" in money and not (isinstance(money.get("status_column"), str) and IDENT_RE.fullmatch(money["status_column"])):
        problems.append("statuses need status_column, the plain column name that holds each row status")
    if money.get("rule") == "gains" and not isinstance(money.get("sign"), dict):
        problems.append("gains needs a sign: the column whose positive values are gains, or the status value that marks a gain")
    if "sign" in money:
        problems += money_sign_problems(money["sign"])
    if "rule" in money and money["rule"] not in MONEY_RULES:
        problems.append(f"the money rule is one of {', '.join(MONEY_RULES)}")
    if "off" in money and not isinstance(money["off"], bool):
        problems.append("off is true or false")
    per = money.get("per", "row")
    if per not in MONEY_PER:
        problems.append(f"per is one of {', '.join(MONEY_PER)}")
    if per == "group" and not (isinstance(money.get("group_column"), str) and IDENT_RE.fullmatch(money["group_column"])):
        problems.append("per group needs group_column, the plain column name that identifies each group")
    if mode == "per_currency":
        return problems
    rate_keys = [k for k in ("rates", "rate_column", "rate_table") if k in money]
    if len(rate_keys) > 1:
        return problems + ["converting money takes typed rates, one rate column, or a rate table, not more than one"]
    base = str(money.get("base") or "")
    problems += [] if base in MONEY_CODES else [f"the money base currency is an ISO 4217 code such as USD, not {base or 'nothing'}"]
    if "rate_table" in money:
        table = money["rate_table"]
        keys = ("table", "currency_column", "base_column", "date_column", "rate_column", "load_column")
        if not isinstance(table, dict) or not all(isinstance(table.get(k), str) for k in keys):
            return problems + ["the rate table names its table and its columns: table, currency_column, base_column, date_column, rate_column, load_column"]
        if not MONEY_TABLE_RE.fullmatch(table["table"]):
            problems.append("the rate table is a table name such as main.fx.rates")
        problems += [f"the rate table {k} is a plain column name" for k in keys[1:] if not IDENT_RE.fullmatch(table[k])]
        return problems
    if "rate_column" in money:
        column = money.get("rate_column")
        return problems + ([] if isinstance(column, str) and IDENT_RE.fullmatch(column) else ["the rate column is a plain column name"])
    rates = money.get("rates")
    if not isinstance(rates, dict) or not rates:
        return problems + ["converting money needs at least one rate, typed in as currency: units of the base currency"]
    for code, rate in rates.items():
        if code not in MONEY_CODES or isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 < rate < 1e9:
            problems.append(f"the rate for {code!r} must be an ISO 4217 code with a positive number")
    return problems

def money_scope(page: dict, dataset: str) -> dict:
    """The one rule every money total follows: the currency column, the period the rows are kept to, the window, the conversion,
    and how each group is counted."""
    currency = next((column for f in page.get("filters") or [] if f.get("id") == CURRENCY_FILTER
                     for column in [(f.get("columns") or {}).get(dataset)] if column), "")
    period, grain = "", ""
    for f in page.get("filters") or []:
        column = (f.get("columns") or {}).get(dataset)
        if column and f.get("type") == "date_range" and f.get("grain") in PERIOD_GRAINS:
            period, grain = column, f["grain"]
            break
    money = page.get("money") if isinstance(page.get("money"), dict) and not money_rule_problems(page.get("money")) else {}
    convert = money.get("currency") == "convert"
    rates = money.get("rates") if convert and "rates" in money else None
    rate_column = money.get("rate_column") if convert and "rate_column" in money else None
    rate_table = money.get("rate_table") if convert and "rate_table" in money else None
    window = (money.get("window") or {}).get("periods", 0)
    value = money.get("value") if isinstance(money.get("value"), dict) else None
    value_currency = VALUE_CURRENCY if value and ("currency" in value or "currency_column" in value) else ""
    currency_column = value_currency or currency
    return {"currency": "" if (rates or rate_column or rate_table) else currency_column, "currency_column": currency_column, "period": period,
            "grain": grain, "rates": rates or {}, "rate_column": rate_column or "", "rate_table": rate_table or {},
            "base": str(money.get("base") or "") if convert else "", "window": window if period else 0,
            "per_group": money.get("group_column") if money.get("per") == "group" else "",
            "value": money.get("value") if isinstance(money.get("value"), dict) else None, "direction": money.get("rule", "losses"),
            "sign": money.get("sign") if isinstance(money.get("sign"), dict) else None,
            "currency_filter": currency}

def money_sign_column(sign) -> str:
    return quote(sign["column"])

def money_gain_predicate(sign) -> str:
    if sign["kind"] == "column":
        return f"CAST({money_sign_column(sign)} AS DOUBLE) > 0"
    return f"{money_sign_column(sign)} = {sql_text(sign['value'])}"

def money_loss_predicate(sign) -> str:
    if sign["kind"] == "column":
        return f"CAST({money_sign_column(sign)} AS DOUBLE) < 0"
    losses = sign.get("losses") or []
    return f"{money_sign_column(sign)} IN ({', '.join(sql_text(v) for v in losses)})" if losses else "FALSE"

def money_direction_amount(amount: str, direction: str, sign=None) -> str:
    """The amount a direction counts. The saved value is a magnitude. With no sign, losses counts every magnitude and net keeps the
    value's own sign. With a sign: a gain row is one the sign marks as a gain, a loss row one it marks as a loss, and every other row
    counts zero. Gains counts the gain rows, losses counts the loss rows, and net is gains minus losses. A NULL amount, or a NULL sign on
    a column sign, is unrated: it is left out of every total and counted in the left-out line."""
    magnitude = f"GREATEST({amount}, 0)"
    if sign is None:
        return amount if direction == "net" else f"CASE WHEN {amount} IS NULL THEN NULL ELSE {magnitude} END"
    unrated = f"{amount} IS NULL" + (f" OR {money_sign_column(sign)} IS NULL" if sign["kind"] == "column" else "")
    on_gain, on_loss = {"gains": (magnitude, "0"), "losses": ("0", magnitude), "net": (magnitude, f"-{magnitude}")}[direction]
    return (f"CASE WHEN {unrated} THEN NULL WHEN {money_gain_predicate(sign)} THEN {on_gain} "
            f"WHEN {money_loss_predicate(sign)} THEN {on_loss} ELSE 0 END")

VALUE_CURRENCY = "_inspire_value_currency"

def money_value_override(page: dict, dataset: str, sql: str) -> str:
    """The value the person saved for each record replaces the Genie value_at_stake in every money total: the rule's direction
    decides which sign counts, and a currency the value names replaces the currency column of the page."""
    scope = money_scope(page, dataset)
    value = scope["value"]
    if not value or money_value_problems(value):
        return sql
    amount = money_value_sql(value)
    if amount is None:
        return sql
    amount = money_direction_amount(amount, scope["direction"], scope["sign"])
    replaced = ["value_at_stake"] + ([scope["currency_filter"]] if scope["currency_filter"] else [])
    currency_part = ""
    if "currency" in value or "currency_column" in value:
        source = sql_text(value["currency"]) if "currency" in value else quote(value["currency_column"])
        currency_part = f", {source} AS {quote(VALUE_CURRENCY)}"
        if scope["currency_filter"]:
            currency_part += f", {source} AS {quote(scope['currency_filter'])}"
    return f"SELECT * EXCEPT ({', '.join(quote(c) for c in replaced)}), {amount} AS value_at_stake{currency_part} FROM ({sql}) AS v"

def money_joined(page: dict, dataset: str, sql: str) -> str:
    """Every row of the dataset, with its converted amount in CONVERTED: no row is dropped here, so a row with no rate shows as NULL."""
    scope = money_scope(page, dataset)
    if scope["rates"]:
        cases = " ".join(f"WHEN {sql_text(code)} THEN {float(rate)!r}" for code, rate in sorted(scope["rates"].items()))
        return (f"SELECT *, CAST(value_at_stake AS DOUBLE) * CASE {quote(scope['currency_column'])} {cases} ELSE NULL END AS {CONVERTED} "
                f"FROM ({sql}) AS c")
    if scope["rate_column"]:
        return (f"SELECT *, CAST(value_at_stake AS DOUBLE) * CAST({quote(scope['rate_column'])} AS DOUBLE) AS {CONVERTED} "
                f"FROM ({sql}) AS c")
    if scope["rate_table"] and scope["period"]:
        table = scope["rate_table"]
        key = f"{quote(table['currency_column'])}, {quote(table['base_column'])}, CAST({quote(table['date_column'])} AS DATE)"
        rates = (f"SELECT from_code, to_code, rate_date, rate FROM (SELECT {quote(table['currency_column'])} AS from_code, "
                 f"{quote(table['base_column'])} AS to_code, CAST({quote(table['date_column'])} AS DATE) AS rate_date, "
                 f"CAST({quote(table['rate_column'])} AS DOUBLE) AS rate, ROW_NUMBER() OVER (PARTITION BY {key} "
                 f"ORDER BY {quote(table['load_column'])} DESC) AS _latest FROM {table_name(table['table'])}) AS ranked "
                 f"WHERE _latest = 1")
        return (f"SELECT c.*, CAST(c.value_at_stake AS DOUBLE) * r.rate AS {CONVERTED} FROM ({sql}) AS c LEFT JOIN ({rates}) AS r "
                f"ON c.{quote(scope['currency_column'])} = r.from_code AND r.to_code = {sql_text(scope['base'])} "
                f"AND CAST(c.{quote(scope['period'])} AS DATE) = r.rate_date")
    return sql

def money_source(page: dict, dataset: str, sql: str) -> str:
    """Rows a money total may add: a dated row in a period that has closed, in the window the rule sets, converted when the rule converts,
    and one row per group when the rule counts each group once."""
    sql = money_value_override(page, dataset, sql)
    scope = money_scope(page, dataset)
    inner = money_joined(page, dataset, sql) if (scope["rates"] or scope["rate_column"] or scope["rate_table"]) else sql
    if scope["per_group"]:
        amount = money_expression(page, dataset, MONEY_COLUMN)
        inner = (f"SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY {quote(scope['per_group'])} "
                 f"ORDER BY {amount} DESC NULLS LAST) AS _inspire_rank FROM ({inner}) AS g) AS ranked WHERE _inspire_rank = 1")
    if not scope["period"]:
        return inner
    column, grain = quote(scope["period"]), scope["grain"]
    closed = f"{column} < date_trunc('{grain}', current_date())"
    if scope["window"]:
        lookback = (f"date_sub(date_trunc('week', current_date()), {7 * scope['window']})" if grain == "week"
                    else f"add_months(date_trunc('{grain}', current_date()), -{scope['window'] * MONTHS_PER_PERIOD[grain]})")
        closed += f" AND {column} >= {lookback}"
    return f"SELECT * FROM ({inner}) AS m WHERE {column} IS NOT NULL AND {closed}"

def date_column(page: dict, dataset: str) -> str:
    return next((column for f in page.get("filters") or [] if f.get("type") == "date_range"
                 for column in [(f.get("columns") or {}).get(dataset)] if column), "")

def future_source(page: dict, dataset: str, sql: str) -> str:
    """Rows a KPI or chart may read: rows dated after today are left out, undated rows stay (a money total also drops them)."""
    column = date_column(page, dataset)
    if not column or column not in sql:
        return sql
    return f"SELECT * FROM ({sql}) AS f WHERE {quote(column)} IS NULL OR {quote(column)} <= current_date"

def money_expression(page: dict, dataset: str, expression: str) -> str:
    """A money expression reads the converted amount when the rule converts, and the stake amount otherwise."""
    scope = money_scope(page, dataset)
    if not (scope["rates"] or scope["rate_column"] or scope["rate_table"]):
        return expression
    return re.sub(r"\bvalue_at_stake\b", CONVERTED, expression)

def money_currency_column(page: dict, kpi: dict) -> str:
    return money_scope(page, kpi["dataset"])["currency"] if kpi.get("format") == "currency" else ""

def sql_text(value) -> str:
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


RUN_TOTAL_DATASET = "run_rows"


def run_total_query(source: str) -> str:
    """The Implement run's value at stake: the money rule the App's KPI reads (closed months, undated and future rows left out) over
    the flagged rows `source` holds as value_at_stake and as_of_date. It is the App's money_source and money_expression, not a copy."""
    page = {"datasets": [{"name": RUN_TOTAL_DATASET, "sql": source}],
            "filters": [{"id": "as_of", "type": "date_range", "grain": "month", "columns": {RUN_TOTAL_DATASET: "as_of_date"}}]}
    expression = money_expression(page, RUN_TOTAL_DATASET, "SUM(value_at_stake)")
    return f"SELECT {expression} AS value FROM ({money_source(page, RUN_TOTAL_DATASET, source)}) AS d"


RUN_ROWS_DATASET = "run_rows"


def run_rows_source(source: str, date_column: str) -> str:
    """The rows of a run that its counts read: the App's count rule (future_source), so a dated row after today is left out and an
    undated row stays, as the App's count KPIs keep them. The run's counts and the App's counts over the same rows then agree."""
    page = {"datasets": [{"name": RUN_ROWS_DATASET, "sql": source}],
            "filters": [{"id": "as_of", "type": "date_range", "columns": {RUN_ROWS_DATASET: date_column}}]}
    return future_source(page, RUN_ROWS_DATASET, source)
