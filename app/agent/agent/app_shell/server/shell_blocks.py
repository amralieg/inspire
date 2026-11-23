"""Typed answer blocks for the Agent page: the only shape the planner may answer in there.

The planner calls render_answer with a list of blocks. validate() keeps only whitelisted keys, checks every
reference (record keys, chart ids, KPI ids, columns, action ids) against what the person can see on this page,
and returns the clean blocks plus the problems it found. Nothing here reads a workspace: the caller passes in the
readable record keys, so the rules stay testable without one.

Genie answers in these blocks with few words: text only to explain, compare to weigh 2-4 options side by side,
resolve to close one record with one click, ticket and carousel for records, and the rest for choices, lists and charts.
"""
import re

BLOCK_TYPES = ("text", "ticket", "carousel", "actions", "choice", "multi_select", "table", "chart", "kpi", "email", "feedback", "compare", "resolve")
MAX_BLOCKS = 8
MAX_ITEMS = 30
# The chart a kind of use case shows: outliers on a control chart, forecasts on a band, segments as bars or a donut.
KIND_CHARTS = {"outlier": ("control", "scatter", "box"), "forecast": ("band", "line", "area"), "segment": ("bar", "horizontal_bar", "donut", "treemap")}
TEXT_CHARS = 1200
LABEL_CHARS = 160
WHY_CHARS = 400
ID_CHARS = 128
ASK_CHARS = 400
COMPARE_OPTIONS = 4
COMPARE_FACTS = 6
FACT_CHARS = 80
TAG = re.compile(r"<[^>]*>")
EMAIL_ADDRESS = re.compile(r"[^\s@]+@[^\s@]+")


def clip(value, chars: int) -> str:
    return str(value if value is not None else "").strip()[:chars]


def plain(value, chars: int) -> str:
    return clip(TAG.sub("", str(value if value is not None else "")), chars)


def ident(value) -> str:
    text = clip(value, ID_CHARS)
    return text if text else ""


def record_key_ok(raw, keys: set) -> str:
    key = ident(raw)
    return key if key and key in keys else ""


def whole(value, default: int, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return default
    try:
        number = int(float(value))
    except (ValueError, OverflowError):
        return default
    return min(max(number, low), high)


def pick_chart(types: dict, preferred: tuple) -> str:
    for kind in preferred:
        for chart_id, chart_type in types.items():
            if chart_type == kind:
                return chart_id
    return ""


def unknown(kind: str) -> dict:
    return {"type": "text", "markdown": f"This App cannot show a {plain(kind, 40) or 'block'} here, so the answer is in words."}


def ticket(raw, keys: set, problems: list):
    key = record_key_ok(raw.get("record_key"), keys)
    if not key:
        problems.append("a ticket names a record the person cannot see, so it is left out")
        return None
    return {"type": "ticket", "record_key": key, "label": plain(raw.get("label"), LABEL_CHARS) or key,
            "value_at_stake": plain(raw.get("value_at_stake"), 40), "tier": plain(raw.get("tier"), 40),
            "status": plain(raw.get("status"), 60), "why": plain(raw.get("why"), WHY_CHARS), "due": plain(raw.get("due"), 40)}


def choices(raw, cap: int, problems: list, what: str) -> list:
    out = []
    items = raw.get("options")
    if not isinstance(items, list):
        return out
    for item in items[:cap]:
        if not isinstance(item, dict) or not ident(item.get("id")):
            problems.append(f"a {what} option has no id, so it is left out")
            continue
        out.append({"id": ident(item.get("id")), "label": plain(item.get("label"), LABEL_CHARS) or ident(item.get("id")),
                    "detail": plain(item.get("detail"), WHY_CHARS), "ask": plain(item.get("ask"), ASK_CHARS)})
    if len(items) > cap:
        problems.append(f"a {what} takes at most {cap} {'option' if cap == 1 else 'options'}")
    return out


def compare_facts(raw) -> list:
    out = []
    for fact in raw if isinstance(raw, list) else []:
        if isinstance(fact, dict) and plain(fact.get("label"), FACT_CHARS) and plain(fact.get("value"), FACT_CHARS):
            out.append({"label": plain(fact.get("label"), FACT_CHARS), "value": plain(fact.get("value"), FACT_CHARS)})
    return out[:COMPARE_FACTS]


def compare(raw, problems: list):
    options = []
    for item in choices(raw, COMPARE_OPTIONS, problems, "compare"):
        source = next((o for o in raw.get("options") if isinstance(o, dict) and ident(o.get("id")) == item["id"]), {})
        options.append(dict(item, facts=compare_facts(source.get("facts"))))
    if len(options) < 2:
        problems.append("a compare needs at least 2 options, so it is left out")
        return None
    return {"type": "compare", "title": plain(raw.get("title"), LABEL_CHARS), "options": options}


def block(raw, ctx: dict, problems: list):
    kind = raw.get("type")
    keys, charts, kpis = ctx["keys"], ctx["charts"], ctx["kpis"]
    if kind == "text":
        return {"type": "text", "markdown": plain(raw.get("markdown"), TEXT_CHARS)}
    if kind == "ticket":
        return ticket(raw, keys, problems)
    if kind == "carousel":
        items = [t for t in (ticket(i, keys, problems) for i in (raw.get("items") or [])[:10] if isinstance(i, dict)) if t]
        if len(items) < 1:
            return None
        return {"type": "carousel", "items": items}
    if kind == "actions":
        picked = [k for k in (record_key_ok(r, keys) for r in (raw.get("record_keys") or [])[:ctx["act_rows"]]) if k]
        acts = [a for a in (raw.get("actions") or []) if a in ctx["actions"]]
        if not picked or not acts:
            problems.append("an actions block needs a record the person can see and an action the App offers")
            return None
        return {"type": "actions", "record_keys": list(dict.fromkeys(picked)), "actions": list(dict.fromkeys(acts))}
    if kind == "choice":
        options = choices(raw, 12, problems, "choice")
        if len(options) < 2:
            return None
        return {"type": "choice", "prompt": plain(raw.get("prompt"), LABEL_CHARS), "options": options}
    if kind == "multi_select":
        options = choices(raw, MAX_ITEMS, problems, "multi-select")
        if len(options) < 2:
            return None
        top = len(options)
        low = whole(raw.get("min"), 0, 0, top)
        high = whole(raw.get("max"), top, 1, top)
        return {"type": "multi_select", "prompt": plain(raw.get("prompt"), LABEL_CHARS), "options": options,
                "min": low, "max": max(high, low), "submit": plain(raw.get("submit"), 40) or "Use these",
                "ask": plain(raw.get("ask"), ASK_CHARS)}
    if kind == "table":
        columns = [c for c in (raw.get("columns") or []) if isinstance(c, str) and c in ctx["columns"]][:12]
        if not columns:
            problems.append("a table names no column of this page, so it is left out")
            return None
        picked = [k for k in (record_key_ok(r, keys) for r in (raw.get("record_keys") or [])[:ctx["act_rows"]]) if k]
        return {"type": "table", "columns": columns, "record_keys": list(dict.fromkeys(picked)), "limit": whole(raw.get("limit"), 10, 1, ctx["act_rows"])}
    if kind == "chart":
        chart = ident(raw.get("chart_id"))
        if not chart and raw.get("kind") in KIND_CHARTS:
            chart = pick_chart(ctx.get("chart_types") or {}, KIND_CHARTS[raw["kind"]])
            if not chart:
                problems.append(f"this use case has no {raw['kind']} chart, so it is left out")
                return None
        if chart not in charts:
            problems.append("a chart names no chart of this page, so it is left out")
            return None
        highlight = [k for k in (record_key_ok(r, keys) for r in (raw.get("highlight_keys") or [])[:ctx["act_rows"]]) if k]
        return {"type": "chart", "chart_id": chart, "title": plain(charts[chart], LABEL_CHARS), "highlight_keys": list(dict.fromkeys(highlight))}
    if kind == "kpi":
        kpi = ident(raw.get("kpi_id"))
        if kpi not in kpis:
            problems.append("a KPI names no KPI of this page, so it is left out")
            return None
        return {"type": "kpi", "kpi_id": kpi, "value": plain(raw.get("value"), 40), "value_at_stake": plain(raw.get("value_at_stake"), 40),
                "note": plain(raw.get("note"), WHY_CHARS)}
    if kind == "email":
        to = plain(raw.get("to_label"), 80)
        if EMAIL_ADDRESS.search(to):
            problems.append("an email names an address; it names a first name or a role, so it is left out")
            return None
        return {"type": "email", "to_label": to, "subject": plain(raw.get("subject"), LABEL_CHARS), "body": plain(raw.get("body"), TEXT_CHARS),
                "copyable": True}
    if kind == "feedback":
        return {"type": "feedback"}
    if kind == "compare":
        return compare(raw, problems)
    if kind == "resolve":
        key = record_key_ok(raw.get("record_key"), keys)
        if not key:
            problems.append("a resolve names a record the person cannot see, so it is left out")
            return None
        return {"type": "resolve", "record_key": key, "label": plain(raw.get("label"), LABEL_CHARS) or key,
                "value_at_stake": plain(raw.get("value_at_stake"), 40), "status": plain(raw.get("status"), 60)}
    return unknown(kind)


def validate(raw, ctx: dict) -> tuple:
    """Return (blocks, problems). ctx: keys (readable record keys), charts ({id: title}), kpis (ids), columns (list column ids),
    actions (ids the App offers), act_rows (max records one block names)."""
    problems = []
    if not isinstance(raw, list) or not raw:
        return [], ["render_answer takes a non-empty list of blocks"]
    if len(raw) > MAX_BLOCKS:
        problems.append(f"an answer takes at most {MAX_BLOCKS} blocks; the rest are left out")
    out = []
    for item in raw[:MAX_BLOCKS]:
        if not isinstance(item, dict):
            problems.append("a block is not an object, so it is left out")
            continue
        kind = item.get("type")
        if kind not in BLOCK_TYPES:
            out.append(unknown(kind))
            problems.append(f"block type {plain(kind, 40) or 'missing'} is not a block of this App")
            continue
        built = block(item, ctx, problems)
        if built is not None:
            out.append(built)
    return out, problems


def text_of(blocks: list) -> str:
    """The plain words of an answer: used for the turn's answer text, the saved thread and the feedback record."""
    parts = []
    for b in blocks:
        if b["type"] == "text":
            parts.append(b["markdown"])
        elif b["type"] == "ticket":
            parts.append(f"{b['label']}: {b['why']}".strip(": "))
        elif b["type"] == "compare":
            parts.append(b["title"])
        elif b["type"] == "resolve":
            parts.append(b["label"])
        elif b["type"] == "kpi":
            parts.append(f"{b['kpi_id']} {b['value']}".strip())
        elif b["type"] == "email":
            parts.append(f"Draft to {b['to_label']}: {b['subject']}")
    return "\n\n".join(p for p in parts if p)
