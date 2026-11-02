import json
import math
import operator as op
import re
import sys
import urllib.parse
import uuid

import shell_sql
from shell_db import HttpError, QueryError, rows_of

HEADER = "-- inspire-app-alert "
META_VERSION = 1
WATCH = "watch"
ASSIGNED = "assigned"
SCHEDULES = {"hourly": ("0 0 * * * ?", "every hour"), "daily": ("0 0 8 * * ?", "every day at 08:00 UTC"),
             "weekly": ("0 0 8 ? * MON", "every Monday at 08:00 UTC")}
TIMEZONE = "UTC"
ASSIGNED_CRON = "0 5 * * * ?"
ASSIGNED_RETRIGGER_S = 3000
APP_CAP = 20
PERSON_CAP = 10
NOTICE_CAP = 50
RECIPIENT_CAP = 20
NAME_CHARS = 100
FOLDER_CHARS = 1000
LIST_TTL_S = 5
USER_TTL_S = 600
FIELDS = ("display_name", "query_text", "custom_summary", "custom_description", "evaluation", "schedule")
EMAIL = re.compile(r"^[^@\s,;\"\\<>()]{1,64}@[^@\s,;\"\\<>()]{1,190}\.[A-Za-z0-9-]{2,63}$")
FOLDER = re.compile(r"^/[^\x00-\x1f]{1,999}$")
STATES = {"OK": "ok", "TRIGGERED": "triggered", "ERROR": "error"}
COMPARE = {">=": op.ge, ">": op.gt, "=": op.eq, "!=": op.ne, "<": op.lt, "<=": op.le}
WORDS = {">=": "is at or above", ">": "is above", "=": "equals", "!=": "is not", "<": "is below", "<=": "is at or below"}
USER_REASON = ("This App shows each person only their own data, so it sends no alerts: an alert runs with one identity's access and "
               "would email what that identity can read.")
UNREACHABLE = ("The App cannot reach its alerts folder, so it cannot show or keep alerts. Ask the person who built it to "
               f"{shell_sql.rebuild_action()}")
NO_WAREHOUSE = "the App has no SQL warehouse; add the sql-warehouse resource"
NOT_FOUND = "this App keeps no alert with that id; the alert set up when the App was built opens in Databricks"
COUNT_MEASURE = re.compile(r"^\s*COUNT(_IF)?\s*\(", re.IGNORECASE)
TIER_COLUMN = "priority_tier"
TIER_FILTER = "tier"
TIER_LABEL = "Tier"
PAGE_KPIS = 12
PAGE_SEGMENTS = 6
PAGE_SKIPPED = ("rank",)
CLI_VERSION = 1
NAME_LIMIT = 250
SUMMARY_LIMIT = 250
RUNBOOK_LIMIT = 4000
RUNBOOK_PART_LIMIT = 400
RUNBOOK_LINKS = (("dashboard", "Dashboard"), ("genie", "Genie Agent"), ("app", "App"))
RUNBOOK_CLEARS = {True: "When it clears: you get one more email when it returns to OK.",
                  False: "When it clears: it sends no email, and you hear from it again only the next time it fires."}
SENTENCE_END = re.compile(r"[.!?](?=\s|$)")
LIST_MARK = re.compile(r"\s*\d+\.")


def read_meta(text) -> dict:
    first = str(text or "").split("\n", 1)[0]
    if not first.startswith(HEADER):
        return {}
    try:
        meta = json.loads(first[len(HEADER):])
    except ValueError:
        return {}
    return meta if isinstance(meta, dict) and meta.get("v") == META_VERSION and meta.get("kind") in (WATCH, ASSIGNED) else {}


def write_meta(meta: dict, query: str) -> str:
    return HEADER + json.dumps(meta, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n" + query


def folder_problems(settings: dict) -> list:
    folder, options = settings.get("alert_folder"), settings.get("options")
    on = isinstance(options, dict) and options.get("alerts") is True
    if folder is None:
        return ["the App sends alerts, so its settings need alert_folder, the workspace folder that keeps them"] if on else []
    if not (isinstance(folder, str) and FOLDER.match(folder)):
        return [f"the App alert_folder must be a workspace folder path of at most {FOLDER_CHARS} characters, not {folder!r}"]
    return []


def same(a, b) -> bool:
    return bool(a) and bool(b) and str(a).strip().lower() == str(b).strip().lower()


def clean_watch(raw) -> dict:
    if not isinstance(raw, dict):
        raise HttpError(400, "say what the alert watches: what, filters, operator, threshold and basis")
    threshold = raw.get("threshold")
    if isinstance(threshold, str) and threshold.strip():
        try:
            threshold = float(threshold)
        except ValueError:
            threshold = None
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold):
        raise HttpError(400, "the threshold must be a number")
    filters = raw.get("filters") or {}
    if not isinstance(filters, dict):
        raise HttpError(400, "filters must be an object of filter id to the values to keep")
    kept = {str(k): list(dict.fromkeys(v)) for k, v in filters.items() if v not in (None, [], {})}
    return {"what": str(raw.get("what") or ""), "filters": kept, "operator": str(raw.get("operator") or ""), "threshold": float(threshold),
            "basis": str(raw.get("basis") or "fixed")}


def number_text(value) -> str:
    if value is None:
        return "no value"
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:.4g}"


def alert_subscriptions(emails, destinations=()) -> list:
    return [{"user_email": e} for e in emails] + [{"destination_id": d} for d in destinations]


def cut_text(text, limit: int) -> str:
    text = str(text or "")
    if len(text) <= limit:
        return text
    ends = [m.end() for m in SENTENCE_END.finditer(text, 0, limit + 1)
            if m.end() <= limit and not LIST_MARK.fullmatch(text[text.rfind("\n", 0, m.start()) + 1:m.end()])]
    ends += [i for i, ch in enumerate(text[:limit + 1]) if ch == "\n"]
    if max(ends, default=0) > 0:
        lines = text[:max(ends)].rstrip().split("\n")
        while len(lines) > 1 and lines[-1].rstrip().endswith(":"):
            lines.pop()
        return "\n".join(lines).rstrip()
    space = max(text.rfind(" ", 0, limit + 1), text.rfind("\n", 0, limit + 1))
    return text[:space].rstrip() if space > 0 else text[:limit]


def sentence(text) -> str:
    text = " ".join(str(text or "").split())
    return text if not text or text[-1] in ".!?" else f"{text}."


def plain_text(value) -> str:
    if isinstance(value, (list, tuple)):
        return ", ".join(t for t in (plain_text(v) for v in value) if t)
    return " ".join(str(value).split()) if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def runbook_guide(decision="", owner="", solution="", dashboard="", genie="", app="", kpi="") -> dict:
    texts = {"decision": plain_text(decision), "owner": plain_text(owner), "solution": plain_text(solution), "kpi": plain_text(kpi)}
    links = {"dashboard": dashboard, "genie": genie, "app": app}
    guide = {key: cut_text(text, RUNBOOK_PART_LIMIT) for key, text in texts.items() if text}
    guide.update({key: str(url).strip() for key, url in links.items() if str(url or "").strip().startswith("https://")})
    return guide


def use_case_guide(use_case, dashboard="", genie="", app="") -> dict:
    use_case = use_case if isinstance(use_case, dict) else {}
    assessment = use_case.get("elite_assessment")
    if isinstance(assessment, str):
        try:
            assessment = json.loads(assessment)
        except ValueError:
            assessment = {}
    assessment = assessment if isinstance(assessment, dict) else {}
    solution = next((use_case[key] for key in ("Solution", "solution") if plain_text(use_case.get(key))), "")
    return runbook_guide(assessment.get("decision"), assessment.get("decision_owner"), solution, dashboard, genie, app, assessment.get("kpi"))


def runbook_rows_step(tiers: str = "", url: str = "") -> str:
    return (f"Open the decision list{f' ({url})' if url else ''} and work {f'the {tiers} rows' if tiers else 'its rows'} by rank, top first; "
            "each row's recommended action says what to do with it.")


def runbook(fired: str, threshold: str, checked: str, guide=None, clears: bool = True, first=(), more=()) -> str:
    guide = guide if isinstance(guide, dict) else {}
    steps = [step for step in first if step]
    if guide.get("decision"):
        steps.append(f"{guide['owner']} decides: {guide['decision']}" if guide.get("owner") else f"The decision it informs: {guide['decision']}")
    if guide.get("solution"):
        steps.append(f"How the use case acts on it: {guide['solution']}")
    if guide.get("genie"):
        steps.append(f"Ask the Genie Agent ({guide['genie']}) why a row is on the list or how it compares with earlier runs.")
    lines = [f"What fired: {sentence(fired)}", f"Why this threshold: {sentence(threshold)}", f"How often it checks: {sentence(checked)}"]
    if steps:
        lines += ["What to do first:"] + [f"{number}. {sentence(step)}" for number, step in enumerate(steps, 1)]
    looks = [(label, guide[key]) for key, label in RUNBOOK_LINKS if guide.get(key)]
    if looks:
        lines += ["Where to look:"] + [f"{label}: {url}" for label, url in looks]
    lines += [RUNBOOK_CLEARS[bool(clears)]] + [sentence(line) for line in more if line]
    if guide.get("kpi"):
        lines.append(f"KPI it moves: {sentence(guide['kpi'])}")
    return cut_text("\n".join(lines), RUNBOOK_LIMIT)


def alert_body(name: str, query: str, warehouse: str, summary: str, description: str, source: dict, operator: str, threshold,
               subscriptions: list, cron: str, timezone: str, paused: bool, notify_on_ok: bool, retrigger: int = 0) -> dict:
    notification = {"notify_on_ok": notify_on_ok, "subscriptions": list(subscriptions)}
    if retrigger:
        notification["retrigger_seconds"] = int(retrigger)
    return {"display_name": cut_text(name, NAME_LIMIT), "query_text": query, "warehouse_id": warehouse,
            "custom_summary": cut_text(summary, SUMMARY_LIMIT), "custom_description": cut_text(description, RUNBOOK_LIMIT),
            "evaluation": {"source": dict(source), "comparison_operator": operator, "threshold": {"value": {"double_value": float(threshold)}},
                           "empty_result_state": "OK", "notification": notification},
            "schedule": {"quartz_cron_schedule": cron, "timezone_id": timezone, "pause_status": "PAUSED" if paused else "UNPAUSED"}}


def workspace_user(call, email: str) -> str:
    found = call("GET", "/api/2.0/preview/scim/v2/Users", {"filter": f'userName eq "{email}"', "attributes": "userName,active"}) or {}
    names = [r.get("userName") for r in found.get("Resources") or [] if r.get("active") is not False and same(r.get("userName"), email)]
    return str(names[0]) if names else ""


def can_change(meta: dict, person: str, admin: bool) -> bool:
    return admin or same(meta.get("owner") if meta.get("kind") == ASSIGNED else meta.get("by"), person)


def entries_of(alerts) -> list:
    out = []
    for alert in alerts or []:
        if not isinstance(alert, dict) or str(alert.get("lifecycle_state") or "ACTIVE").upper() in shell_sql.ALERT_GONE:
            continue
        meta = read_meta(alert.get("query_text"))
        if meta:
            out.append({"alert": alert, "meta": meta})
    return out


def find_entry(entries: list, ident) -> dict:
    ident = str(ident or "")
    entry = next((e for e in entries if str(e["alert"].get("id")) == ident), None)
    if entry is None:
        raise HttpError(404, NOT_FOUND)
    return entry


def measure_of(page: dict, what) -> dict:
    return next((m for m in shell_sql.watch_measures(page) if m["id"] == what), {})


def scope_text(page: dict, watch: dict) -> str:
    filters = {f["id"]: f.get("label") or f["id"] for f in page.get("filters") or []}
    return "; ".join(f"{filters.get(k, k)}: {', '.join(v)}" for k, v in (watch.get("filters") or {}).items())


def rule_words(watch: dict) -> str:
    if watch["basis"] == "baseline":
        rise = shell_sql.ALERT_BASELINE_DIRECTIONS[watch["operator"]] == "+"
        return (f"{'rises above' if rise else 'falls below'} the usual range of up to {shell_sql.ALERT_BASELINE_RUNS} earlier runs "
                f"({WORDS[watch['operator']]} {number_text(watch['threshold'])} until {shell_sql.ALERT_BASELINE_MIN_RUNS} earlier runs exist)")
    return f"{WORDS[watch['operator']]} {number_text(watch['threshold'])}"


def rule_text(page: dict, watch: dict) -> str:
    return f"{measure_of(page, watch['what']).get('label') or watch['what']} {rule_words(watch)}"


def alert_view(entry: dict, person: str, admin: bool, host: str, page: dict = None) -> dict:
    alert, meta = entry["alert"], entry["meta"]
    evaluation = alert.get("evaluation") or {}
    paused = str((alert.get("schedule") or {}).get("pause_status") or "").upper() == "PAUSED"
    allowed = can_change(meta, person, admin)
    emails = [s["user_email"] for s in (evaluation.get("notification") or {}).get("subscriptions") or [] if s.get("user_email")]
    watch = meta.get("watch") if meta.get("kind") == WATCH and isinstance(meta.get("watch"), dict) else None
    shown = {"rule": "", "scope": ""}
    if watch and page:
        try:
            shown = {"rule": rule_text(page, watch), "scope": scope_text(page, watch)}
        except (KeyError, TypeError, ValueError):
            pass
    return dict({"id": str(alert.get("id")), "kind": meta["kind"], "page": meta.get("page"), "name": meta.get("name") or alert.get("display_name"),
                 "by": meta.get("by") or "", "owner": meta.get("owner") or "", "watch": meta.get("watch"), "schedule": meta.get("schedule"),
                 "state": "paused" if paused else STATES.get(str(evaluation.get("state") or "").upper(), "unknown"),
                 "checked": evaluation.get("last_evaluated_at") or None, "emails": emails if allowed else [], "email_count": len(emails),
                 "can_change": allowed, "url": f"{host}/sql/alerts-v2/{alert.get('id')}" if host else "",
                 "owner_user_name": str(alert.get("owner_user_name") or ""),
                 "notify_on_ok": (evaluation.get("notification") or {}).get("notify_on_ok") is True}, **shown)


def measure_list(page: dict, names, unreadable: str = "") -> list:
    names = list(names or ())
    out = []
    for m in shell_sql.watch_measures(page):
        reach = [f for f in page.get("filters") or [] if f.get("type") == "multi_select" and m["dataset"] in (f.get("columns") or {})]
        problem = (unreadable or "Inspire could not read the result table") if not names else shell_sql.baseline_problem(page, m, names)
        count = bool(COUNT_MEASURE.match(m["expression"]))
        out.append(dict({k: m[k] for k in ("id", "label", "format", "currency")}, filters=[f["id"] for f in reach], baseline=not problem,
                        baseline_filters=[] if problem else [f["id"] for f in reach], baseline_note=problem,
                        min=0 if count else None, whole=count))
    return out


def page_listing(page: dict, entries: list, person: str, admin: bool, host: str, built: str, unread: int, measures: list,
                 on: bool = True, reason: str = "") -> dict:
    out = {"on": on, "reason": reason, "built": built or "", "alerts": [], "unread": 0,
           "caps": {"app": APP_CAP, "person": PERSON_CAP, "used": 0, "mine": 0},
           "schedules": [{"id": k, "label": label} for k, (_cron, label) in SCHEDULES.items()], "operators": list(shell_sql.ALERT_OPERATORS),
           "baseline_operators": list(shell_sql.ALERT_BASELINE_DIRECTIONS), "operator_words": dict(WORDS), "measures": [], "admin": False}
    if not on:
        return out
    watches = [e for e in entries if e["meta"]["kind"] == WATCH]
    out.update(alerts=[alert_view(e, person, admin, host, page) for e in entries if e["meta"].get("page") == page["id"]],
               unread=int(unread or 0), measures=measures, admin=admin,
               caps=dict(out["caps"], used=len(watches), mine=sum(same(e["meta"].get("by"), person) for e in watches)))
    return out


def threshold_problem(page: dict, watch: dict) -> str:
    measured = measure_of(page, watch["what"])
    if not measured or not COUNT_MEASURE.match(measured["expression"]):
        return ""
    if watch["threshold"] < 0:
        return f"{measured['label']} counts rows, so it is never below 0; set a threshold of 0 or more"
    if not float(watch["threshold"]).is_integer():
        return f"{measured['label']} counts rows, so set a whole number as the threshold"
    return ""


def watch_plan_query(page: dict, watch: dict, names, history=None) -> dict:
    problem = threshold_problem(page, watch)
    if problem:
        raise HttpError(400, problem)
    try:
        if watch["basis"] != "baseline":
            return shell_sql.watch_query(page, watch)
        return shell_sql.watch_query(page, watch, names(), history() if history else None)
    except ValueError as error:
        raise HttpError(400, str(error)) from error


def recipient_list(raw) -> list:
    if not isinstance(raw, list) or not raw:
        raise HttpError(400, "add at least one email address to send the alert to")
    if len(raw) > RECIPIENT_CAP:
        raise HttpError(400, f"an alert emails at most {RECIPIENT_CAP} people")
    typed = []
    for item in raw:
        email = item.strip() if isinstance(item, str) else ""
        if not EMAIL.match(email):
            raise HttpError(400, f"{item!r} is not an email address")
        if not any(same(email, t) for t in typed):
            typed.append(email)
    return typed


def watch_tiers(page: dict, watch: dict) -> str:
    tier = (page.get("records") or {}).get("tier")
    picked = [v for f in page.get("filters") or [] if tier and (f.get("columns") or {}).get(shell_sql.RECORDS_DATASET) == tier
              for v in (watch.get("filters") or {}).get(f.get("id")) or []]
    return " and ".join(picked)


def watch_reason(watch: dict, by: str) -> str:
    number = number_text(watch["threshold"])
    if watch["basis"] != "baseline":
        return f"{number} is the number {by} set for this alert in the App"
    sign = "plus" if shell_sql.ALERT_BASELINE_DIRECTIONS[watch["operator"]] == "+" else "minus"
    return (f"the usual range of up to {shell_sql.ALERT_BASELINE_RUNS} earlier runs, their mean {sign} {shell_sql.ALERT_BASELINE_SIGMAS} "
            f"standard deviations, worked out again at every check; until {shell_sql.ALERT_BASELINE_MIN_RUNS} earlier runs exist it uses "
            f"{number}, the number {by} set")


def page_guide(page: dict, link: str = "") -> dict:
    stamped = page.get("runbook") if isinstance(page.get("runbook"), dict) else {}
    return runbook_guide(stamped.get("decision"), stamped.get("owner"), stamped.get("solution"), stamped.get("dashboard"), stamped.get("genie"),
                         link, stamped.get("kpi"))


def watch_texts(page: dict, meta: dict, link: str) -> tuple:
    watch = meta["watch"]
    label, rule, scope = measure_of(page, watch["what"]).get("label") or watch["what"], rule_words(watch), scope_text(page, watch)
    title = page.get("title") or page["id"]
    fired = f"{label} on {title} {rule}" + (f", counting only {scope}" if scope else "")
    first = ([runbook_rows_step(watch_tiers(page, watch), link)] if watch["what"] == shell_sql.ALERT_RECORDS
             else [f"Open the App page{f' ({link})' if link else ''} and look at {label} and the rows behind it."])
    description = runbook(fired, watch_reason(watch, meta["by"]), SCHEDULES[meta["schedule"]][1], page_guide(page, link),
                          meta.get("notify_on_ok") is not False, first, [f"Set up in the App by {meta['by']}"])
    return cut_text(f"{meta['name']}: {label} {rule}", SUMMARY_LIMIT), description


def watch_body(query: dict, meta: dict, summary: str, description: str, emails: list, cron: str, paused: bool, warehouse: str,
               retrigger: int = 0) -> dict:
    name = re.sub(r"[/\\\x00-\x1f]+", "-", meta["name"]).strip()[:NAME_CHARS]
    return alert_body(f"{name} ({meta['token']})", write_meta(meta, query["query"]), warehouse, summary, description,
                      {"name": query["column"], "display": query["column"]}, query["operator"], query["threshold"],
                      alert_subscriptions(emails), cron, TIMEZONE, paused, meta["kind"] == WATCH and meta.get("notify_on_ok") is not False,
                      retrigger)


def plan_save(page: dict, data: dict, person: str, admin: bool, entries, warehouse: str, link: str, names, resolve,
              history=None) -> dict:
    if not warehouse:
        raise HttpError(500, NO_WAREHOUSE)
    watch = clean_watch(data.get("watch"))
    schedule = str(data.get("schedule") or "")
    if schedule not in SCHEDULES:
        raise HttpError(400, f"check the alert {', '.join(list(SCHEDULES)[:-1])} or {list(SCHEDULES)[-1]}")
    paused = data.get("paused", False)
    if not isinstance(paused, bool):
        raise HttpError(400, "paused takes true or false")
    notify = data.get("notify_on_ok")
    if notify is not None and not isinstance(notify, bool):
        raise HttpError(400, "notify_on_ok takes true or false: whether the alert sends one more email when it returns to OK")
    name = " ".join(str(data.get("name") or "").split())
    if not name or len(name) > NAME_CHARS:
        raise HttpError(400, f"name the alert in 1 to {NAME_CHARS} characters")
    query = watch_plan_query(page, watch, names, history)
    ident = str(data.get("id") or "")
    listed = entries()
    if ident:
        entry = find_entry(listed, ident)
        if entry["meta"]["kind"] != WATCH:
            raise HttpError(409, "this alert emails an owner when records are assigned to them; you can pause it or delete it")
        if entry["meta"].get("page") != page["id"]:
            raise HttpError(409, "this alert watches another page of the App; change it there")
        if not can_change(entry["meta"], person, admin):
            raise HttpError(403, "only the person who set up this alert, or the App's admin, can change it")
        by, token = entry["meta"].get("by") or person, entry["meta"].get("token") or uuid.uuid4().hex[:6]
        notify = entry["meta"].get("notify_on_ok") is not False if notify is None else notify
    else:
        watches = [e for e in listed if e["meta"]["kind"] == WATCH]
        if len(watches) >= APP_CAP:
            raise HttpError(409, f"this App already keeps {APP_CAP} alerts, the most it keeps; delete one first")
        if sum(same(e["meta"].get("by"), person) for e in watches) >= PERSON_CAP:
            raise HttpError(409, f"you already set up {PERSON_CAP} alerts in this App, the most one person keeps; delete one first")
        by, token, notify = person, uuid.uuid4().hex[:6], notify is not False
    emails = resolve(data.get("emails"))
    meta = {"v": META_VERSION, "kind": WATCH, "page": page["id"], "by": by, "name": name, "watch": watch, "schedule": schedule, "token": token,
            "notify_on_ok": notify}
    summary, description = watch_texts(page, meta, link)
    return {"id": ident, "meta": meta,
            "body": watch_body(query, meta, summary, description, emails, SCHEDULES[schedule][0], paused, warehouse)}


def plan_pause(entries, data: dict, person: str, admin: bool) -> dict:
    paused = data.get("paused")
    if not isinstance(paused, bool):
        raise HttpError(400, "paused takes true or false")
    entry = find_entry(entries(), data.get("id"))
    if not can_change(entry["meta"], person, admin):
        raise HttpError(403, "only the person who set up this alert, the person it emails, or the App's admin can pause it")
    return {"entry": entry, "schedule": dict(entry["alert"].get("schedule") or {}, pause_status="PAUSED" if paused else "UNPAUSED")}


def plan_delete(entries, data: dict, person: str, admin: bool) -> dict:
    entry = find_entry(entries(), data.get("id"))
    if not can_change(entry["meta"], person, admin):
        raise HttpError(403, "only the person who set up this alert, the person it emails, or the App's admin can delete it")
    return entry


def preview_view(watch: dict, row: dict) -> dict:
    value = row.get(shell_sql.ALERT_WATCHED)
    if watch["basis"] != "baseline":
        fires = value is not None and COMPARE[watch["operator"]](float(value), watch["threshold"])
        return dict(shell_sql.compare_words(), value=value, fires=fires, threshold=watch["threshold"], basis="fixed",
                    history_runs=row.get("history_runs"))
    return dict(shell_sql.compare_words(), value=value, fires=bool(row.get(shell_sql.ALERT_FIRED)), threshold=row.get("alert_threshold"),
                basis=row.get("threshold_basis") or "fixed", history_runs=row.get("history_runs"), previous=row.get(shell_sql.ALERT_PREVIOUS))


def _field_id(prefix: str, name: str) -> str:
    return f"{prefix}_{re.sub(r'[^a-z0-9_]+', '_', name.lower()).strip('_')}"[:60]


def alert_page(table: str, columns: list, page_id: str, title: str = "", segments=(), guide=None) -> dict:
    sql = shell_sql.records_sql(table)
    fields = shell_sql.change_fields(columns)
    by = {f["name"]: f for f in fields}
    filters = ([{"id": TIER_FILTER, "type": "multi_select", "label": TIER_LABEL, "columns": {shell_sql.RECORDS_DATASET: TIER_COLUMN}}]
               if TIER_COLUMN in by else [])
    for name in dict.fromkeys(str(s) for s in segments or ()):
        field = by.get(name)
        if field and name != TIER_COLUMN and field["role"] == "business" and field["kind"] == "text" and len(filters) <= PAGE_SEGMENTS:
            filters.append({"id": _field_id("segment", name), "type": "multi_select", "label": name.replace("_", " ").capitalize(),
                            "columns": {shell_sql.RECORDS_DATASET: name}})
    kpis = [{"id": _field_id("total", f["name"]), "label": f"Total {f['name'].replace('_', ' ')}", "dataset": shell_sql.RECORDS_DATASET,
             "expression": f"SUM({shell_sql.quote(f['name'])})", "format": "number"}
            for f in fields if f["role"] == "business" and f["kind"] in ("integer", "decimal") and f["name"] not in PAGE_SKIPPED
            and shell_sql.IDENT.match(f["name"])][:PAGE_KPIS]
    return {"version": shell_sql.SPEC_VERSION, "id": str(page_id), "title": str(title or page_id), "result_table": table,
            "datasets": [{"name": shell_sql.RECORDS_DATASET, "sql": sql}],
            "records": {"tier": TIER_COLUMN if TIER_COLUMN in by else "", "rank": "rank" if "rank" in by else ""},
            "filters": filters, "kpis": kpis, **({"runbook": guide} if guide else {})}


def _cli_person(args: dict) -> tuple:
    person = str(args.get("person") or "").strip()
    if not person:
        raise HttpError(401, "sign in so the App can record who made the change")
    return person, args.get("admin") is True


def _cli_names(args: dict) -> set:
    manifest = args.get("manifest")
    columns = rows_of(manifest, [], 0)["columns"] if isinstance(manifest, dict) else []
    return [f["name"] for f in shell_sql.change_fields(columns)]


def _cli_page(args: dict) -> dict:
    manifest = args.get("manifest") if isinstance(args.get("manifest"), dict) else {}
    return alert_page(str(args.get("table") or ""), rows_of(manifest, [], 0)["columns"], str(args.get("page_id") or ""),
                      str(args.get("title") or ""), args.get("segments") or (),
                      use_case_guide(args.get("use_case"), str(args.get("dashboard") or ""), str(args.get("genie") or "")))


def _cli_listing(args: dict) -> dict:
    page, person = args["page"], str(args.get("person") or "").strip()
    names = _cli_names(args) if page.get("result_table") else set()
    unreadable = ("this page keeps no earlier runs" if not page.get("result_table")
                  else "" if names else str(args.get("unreadable") or "Inspire could not read the result table"))
    measures = measure_list(page, names, unreadable)
    listing = page_listing(page, entries_of(args.get("alerts")), person, args.get("admin") is True, str(args.get("host") or ""),
                           str(args.get("built") or ""), int(args.get("unread") or 0), measures)
    reached = {i for m in measures for i in m["filters"]}
    filters = []
    for f in page.get("filters") or []:
        if f.get("id") in reached:
            sql, params = shell_sql.options_query(page, f["id"])
            filters.append({"id": f["id"], "label": f.get("label") or f["id"], "sql": sql, "params": params})
    return {"listing": listing, "filters": filters}


def _cli_query(args: dict) -> dict:
    watch = clean_watch(args.get("watch"))
    return {"watch": watch, "query": watch_plan_query(args["page"], watch, lambda: _cli_names(args))}


def _cli_preview(args: dict) -> dict:
    watch = clean_watch(args.get("watch"))
    result = args.get("result") if isinstance(args.get("result"), dict) else {}
    rows = rows_of(result.get("manifest") or {}, [(result.get("result") or {}).get("data_array") or []], 2)["rows"]
    return preview_view(watch, rows[0] if rows else {})


def _cli_save(args: dict) -> dict:
    person, admin = _cli_person(args)
    entries = entries_of(args.get("alerts"))
    data = args.get("data") if isinstance(args.get("data"), dict) else {}
    if args.get("name_from_rule") is True and not " ".join(str(data.get("name") or "").split()):
        data = dict(data, name=rule_text(args["page"], clean_watch(data.get("watch")))[:NAME_CHARS])
    planned = plan_save(args["page"], data, person, admin, lambda: entries, str(args.get("warehouse") or ""), str(args.get("link") or ""),
                        lambda: _cli_names(args), recipient_list)
    if planned["id"]:
        return dict(planned, method="PATCH", path=f"/api/2.0/alerts/{planned['id']}", params={"update_mask": ",".join(FIELDS)})
    folder = str(args.get("folder") or "")
    if not FOLDER.match(folder):
        raise HttpError(500, f"the alerts folder must be a workspace folder path, not {folder!r}")
    return dict(planned, method="POST", path="/api/2.0/alerts", params={}, body=dict(planned["body"], parent_path=folder))


def _cli_saved(args: dict) -> dict:
    person, admin = _cli_person(args)
    return alert_view({"alert": args["alert"], "meta": args["meta"]}, person, admin, str(args.get("host") or ""), args.get("page"))


def _cli_pause(args: dict) -> dict:
    person, admin = _cli_person(args)
    planned = plan_pause(lambda: entries_of(args.get("alerts")), args, person, admin)
    ident = planned["entry"]["alert"]["id"]
    return {"id": str(ident), "meta": planned["entry"]["meta"], "method": "PATCH", "path": f"/api/2.0/alerts/{ident}",
            "params": {"update_mask": "schedule"}, "body": {"schedule": planned["schedule"]}}


def _cli_delete(args: dict) -> dict:
    person, admin = _cli_person(args)
    ident = plan_delete(lambda: entries_of(args.get("alerts")), args, person, admin)["alert"]["id"]
    return {"id": str(ident), "method": "DELETE", "path": f"/api/2.0/alerts/{ident}", "params": {}, "body": None}


CLI = {"page": _cli_page, "listing": _cli_listing, "query": _cli_query, "preview": _cli_preview, "save": _cli_save, "saved": _cli_saved,
       "pause": _cli_pause, "delete": _cli_delete}


def cli(stdin=None, stdout=None) -> int:
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    try:
        request = json.loads(stdin.read() or "{}")
        if not isinstance(request, dict) or request.get("v") != CLI_VERSION:
            raise HttpError(400, f"send an alert step of version {CLI_VERSION}")
        step = CLI.get(str(request.get("op") or ""))
        if step is None:
            raise HttpError(400, f"there is no alert step {request.get('op')!r}; the steps are {', '.join(CLI)}")
        args = request.get("args")
        if not isinstance(args, dict):
            raise HttpError(400, "send the alert step's arguments as an object")
        out = {"ok": True, "result": step(args)}
    except HttpError as error:
        out = {"ok": False, "status": error.status, "error": error.message}
    except (ValueError, KeyError, TypeError) as error:
        out = {"ok": False, "status": 400, "error": str(error)}
    stdout.write(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=str))
    stdout.flush()
    return 0


class Alerts:
    def __init__(self, shell):
        self.shell = shell

    def folder(self) -> str:
        return str(self.shell.settings.get("alert_folder") or "")

    def status(self) -> dict:
        if self.shell.settings["auth"] == "user":
            return {"on": False, "reason": USER_REASON}
        return {"on": self.shell.option("alerts") and bool(self.folder()), "reason": ""}

    def require(self) -> None:
        state = self.status()
        if not state["on"]:
            raise HttpError(409, state["reason"] or f"Alerts are off for this App; turn them on in Inspire and {shell_sql.rebuild_action('the App')}")

    def admin(self, headers: dict) -> bool:
        names = [headers.get(h) for h in ("x-forwarded-email", "x-forwarded-preferred-username")]
        return any(same(self.shell.settings.get("admin"), n) for n in names)

    def can_change(self, meta: dict, person: str, admin: bool) -> bool:
        return can_change(meta, person, admin)

    def entries(self) -> list:
        key = ("alerts", self.folder())
        hit = self.shell.cache.get(key)
        if hit is not None:
            return hit
        ws = self.shell.service()
        try:
            listed = ws.call("GET", "/api/2.0/workspace/list", params={"path": self.folder()})
        except QueryError as error:
            raise HttpError(503, f"{UNREACHABLE}: {error}") from error
        ids = [str(o.get("object_id")) for o in listed.get("objects") or [] if o.get("object_type") == "ALERT" and o.get("object_id")]
        done, errors = self.shell._parallel({ident: (lambda i=ident: ws.call("GET", f"/api/2.0/alerts/{i}")) for ident in ids})
        out = {"items": entries_of([done[ident] for ident in ids if done.get(ident) is not None]), "unread": sorted(errors)}
        self.shell.cache.put(key, out, LIST_TTL_S)
        return out

    def forget(self) -> None:
        self.shell.cache.drop(lambda key: key[:1] == ("alerts",))

    def find(self, ident) -> dict:
        return find_entry(self.entries()["items"], ident)

    def view(self, entry: dict, person: str, admin: bool, page: dict = None) -> dict:
        return alert_view(entry, person, admin, self.shell.host(), page)

    def names(self, page: dict) -> list:
        ws = self.shell.service()
        return [f["name"] for f in self.shell.table_fields(ws, "sp", page)]

    def history(self, page: dict):
        ws = self.shell.service()
        return self.shell.history_for(ws, "sp", page, self.shell.table_fields(ws, "sp", page))

    def measures(self, page: dict) -> list:
        try:
            names = self.names(page) if page.get("result_table") else set()
            unreadable = "" if page.get("result_table") else "this page keeps no earlier runs"
        except (QueryError, HttpError) as error:
            names, unreadable = set(), getattr(error, "message", None) or str(error)
        return measure_list(page, names, unreadable)

    def listing(self, headers: dict, ident) -> dict:
        page = self.shell.page(ident)
        state = self.status()
        built = (self.shell.settings.get("alerts") or {}).get(page["id"]) or ""
        if not state["on"]:
            return page_listing(page, [], "", False, "", built, 0, [], False, state["reason"])
        person, admin = str(headers.get("x-forwarded-email") or "").strip(), self.admin(headers)
        listed = self.entries()
        return page_listing(page, listed["items"], person, admin, self.shell.host(), built, len(listed["unread"]), self.measures(page))

    def query(self, page: dict, watch: dict) -> dict:
        return watch_plan_query(page, watch, lambda: self.names(page), lambda: self.history(page))

    def preview(self, headers: dict, data: dict) -> dict:
        self.require()
        page = self.shell.page(data.get("page"))
        watch = clean_watch(data.get("watch"))
        query = self.query(page, watch)
        row = (self.shell.execute(self.shell.service(), query["query"], [], 2, delta=True).get("rows") or [{}])[0]
        return preview_view(watch, row)

    def user_name(self, email: str) -> str:
        key = ("scim", email.lower())
        hit = self.shell.cache.get(key)
        if hit is not None:
            return hit
        service = self.shell.service()
        name = workspace_user(lambda method, path, params: service.call(method, path, params=params), email)
        self.shell.cache.put(key, name, USER_TTL_S)
        return name

    def recipients(self, raw) -> list:
        found = [(email, self.user_name(email)) for email in recipient_list(raw)]
        unknown = [email for email, name in found if not name]
        if unknown:
            verb = "is not a user" if len(unknown) == 1 else "are not users"
            raise HttpError(400, f"{', '.join(unknown)} {verb} of this workspace; alerts go only to workspace users")
        return [name for _email, name in found]

    def app_link(self, headers: dict, page: dict) -> str:
        host = str(headers.get("x-forwarded-host") or "").split(",")[0].strip()
        return f"https://{host}/?open={urllib.parse.quote(page['id'], safe='')}" if re.match(r"^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$", host) else ""

    def watch_texts(self, page: dict, meta: dict, link: str) -> tuple:
        return watch_texts(page, meta, link)

    def body(self, query: dict, meta: dict, summary: str, description: str, emails: list, cron: str, paused: bool, retrigger: int = 0) -> dict:
        return watch_body(query, meta, summary, description, emails, cron, paused, self.shell.warehouse, retrigger)

    def save(self, headers: dict, data: dict) -> dict:
        self.require()
        page = self.shell.page(data.get("page"))
        person, admin = self.shell.editor(headers), self.admin(headers)
        planned = plan_save(page, data, person, admin, lambda: self.entries()["items"], self.shell.warehouse, self.app_link(headers, page),
                            lambda: self.names(page), self.recipients, lambda: self.history(page))
        ws, ident = self.shell.service(), planned["id"]
        saved = (ws.call("PATCH", f"/api/2.0/alerts/{ident}", planned["body"], params={"update_mask": ",".join(FIELDS)}) if ident
                 else ws.call("POST", "/api/2.0/alerts", dict(planned["body"], parent_path=self.folder())))
        self.forget()
        return {"alert": self.view({"alert": saved, "meta": planned["meta"]}, person, admin, page)}

    def pause(self, headers: dict, data: dict) -> dict:
        self.require()
        person, admin = self.shell.editor(headers), self.admin(headers)
        planned = plan_pause(lambda: self.entries()["items"], data, person, admin)
        entry = planned["entry"]
        saved = self.shell.service().call("PATCH", f"/api/2.0/alerts/{entry['alert']['id']}", {"schedule": planned["schedule"]},
                                          params={"update_mask": "schedule"})
        self.forget()
        return {"alert": self.view({"alert": saved, "meta": entry["meta"]}, person, admin, self.shell.by_id.get(entry["meta"].get("page")))}

    def delete(self, headers: dict, data: dict) -> dict:
        self.require()
        person, admin = self.shell.editor(headers), self.admin(headers)
        entry = plan_delete(lambda: self.entries()["items"], data, person, admin)
        self.shell.service().call("DELETE", f"/api/2.0/alerts/{entry['alert']['id']}")
        self.forget()
        return {"deleted": str(entry["alert"]["id"])}

    def assigned(self, headers: dict, page: dict, owner, editor: str) -> str:
        email = str(owner or "").strip()
        if not email or same(email, editor) or not self.status()["on"] or not page.get("result_table"):
            return ""
        if not EMAIL.match(email):
            return f"No email went to {email}: it is not an email address."
        try:
            name = self.user_name(email)
            if not name:
                return f"No email went to {email}: alerts go only to users of this workspace."
            notices = [e for e in self.entries()["items"] if e["meta"]["kind"] == ASSIGNED and e["meta"].get("page") == page["id"]]
            if any(same(e["meta"].get("owner"), name) for e in notices):
                return f"{name} gets an email about it within the hour."
            if len(notices) >= NOTICE_CAP:
                return f"No email went to {name}: this page already emails {NOTICE_CAP} owners, the most it keeps."
            meta = {"v": META_VERSION, "kind": ASSIGNED, "page": page["id"], "owner": name, "by": editor,
                    "name": f"Assigned to {name} on {page.get('title') or page['id']}", "token": uuid.uuid4().hex[:6]}
            link = self.app_link(headers, page)
            title = page.get("title") or page["id"]
            description = runbook(f"someone assigned you records on {title} in the last full hour",
                                  "it emails you for any hour in which someone else gives you at least one record",
                                  "every hour, five minutes past the hour", page_guide(page, link), False,
                                  [f"Open the App{f' ({link})' if link else ''} and pick Mine on the list to see them"],
                                  ["Set up in the App the first time someone gave you records"])
            body = self.body(shell_sql.assigned_query(page["result_table"], name), meta, f"New records were assigned to you on {title}",
                             description, [name], ASSIGNED_CRON, False, ASSIGNED_RETRIGGER_S)
            self.shell.service().call("POST", "/api/2.0/alerts", dict(body, parent_path=self.folder()))
        except (QueryError, HttpError) as error:
            return f"No email went to {email}: the App could not set up its email ({getattr(error, 'message', None) or error})."
        self.forget()
        return f"{name} gets an email about it within the hour."
