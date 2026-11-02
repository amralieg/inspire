import datetime
import functools
import json
import math
import re
import zoneinfo
from html.parser import HTMLParser

SPEC_VERSION = 1
RECORDS_DATASET = "records"
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
REVIEW_LINK = re.compile(r"^https://[a-z0-9.-]{1,253}/\?review=[A-Za-z0-9%._~-]{1,600}&uc=[A-Za-z0-9%._~-]{1,600}$")
TABLE_PART = re.compile(r"^[^`.\x00-\x1f]{1,255}$")
HISTORY_COLUMNS = ("record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by")
RUN_COLUMNS = ("run_id", "use_case_id", "as_of_date")
ID_COLUMN = "entity_id"
CHANGE_SOURCES = ("run", "edit", "add", "delete", "action")
PEOPLE_SOURCES = CHANGE_SOURCES[1:]
BATCH_COLUMN = "action_batch"
BATCH_NOTE = "action_batch_note"
BATCH_VALUES = "action_batch_values"
SNOOZE_COLUMN = "snooze_until"
JOINED_COLUMN = "joined_at"
ACTION_TYPES = {"action_owner": "STRING", "action_status": "STRING", "action_due": "DATE", "action_note": "STRING",
                "dismiss_reason": "STRING", "action_outcome": "STRING", SNOOZE_COLUMN: "DATE", BATCH_COLUMN: "STRING",
                BATCH_NOTE: "STRING", BATCH_VALUES: "STRING", JOINED_COLUMN: "TIMESTAMP"}
BATCH_TYPES = (BATCH_COLUMN, BATCH_NOTE, BATCH_VALUES)
CLOSE_TYPES = {"realized_value": "DOUBLE", "realized_note": "STRING"}
HOLDOUT_TYPES = {"held_back": "BOOLEAN", "run_tier": "STRING"}
KEPT_TYPES = {"edited_by_person": "BOOLEAN", "not_listed_since": "TIMESTAMP"}
KEPT_SINCE = "not_listed_since"
NOT_IN_RUN = "Not in the latest run"
GONE_STATES = ("left", "missing", "resolved")
ACTION_EDITABLE = ("action_owner", "action_status", "action_due", "action_note", "dismiss_reason", SNOOZE_COLUMN) + tuple(CLOSE_TYPES)
UNDONE_KEYS = ("action_owner", "action_status", "action_due", "action_note", "dismiss_reason", SNOOZE_COLUMN) + tuple(CLOSE_TYPES)
ACT_NOTE = "note"
WINDOWS = ("hour", "today", "week", "month", "all")
ZONE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_+-]{0,30}(/[A-Za-z0-9_+-]{1,30}){0,2}$")
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
NO_WINDOW = "no_window"
BATCH_ID = re.compile(r"^[0-9a-f]{32}$")
UNDO_KEY = "undo"
ACTION_STATUSES = ("New", "In progress", "Done", "Dismissed", "Could not fix")
OPEN_STATUSES = ("New", "In progress")
DISMISSED = "Dismissed"
DONE = "Done"
COULD_NOT = "Could not fix"
CLOSED_STATUSES = (DONE, DISMISSED, COULD_NOT)
RESOLVED = "Resolved"
STILL_FLAGGED = "Still flagged"
FLAGGED_TIERS = ("Act now", "Review")
HELD_BACK = "Held back"
HELD_MEANING = ("Held back records were flagged Act now or Review but are kept off the to fix list on purpose, so later runs can compare "
                "them with the records people acted on.")
MONEY_COLUMN = "value_at_stake"
MONEY_VALUES = "hv"
LISTED_MONEY = f"COALESCE(c.`_inspire_money`, CAST(d.`{MONEY_COLUMN}` AS DOUBLE))"
IMPACT_COLUMNS = (("k", "STRING"), ("label", "STRING"), ("status", "STRING"), ("state", "STRING"), ("reason", "STRING"), ("note", "STRING"),
                  ("tier", "STRING"), ("n", "BIGINT"), ("hits", "BIGINT"), ("n_since", "BIGINT"), ("money", "DOUBLE"),
                  ("money_since", "DOUBLE"), ("before", "DOUBLE"), ("after", "DOUBLE"), ("reported", "DOUBLE"), ("at", "TIMESTAMP"))
IMPACT_REASONS = 5
DIGEST_SEND = "send"
NOT_RUN_YET = "No run of this use case has written its results yet."
NO_ACT_NOW = "no record reached Act now in the last run."
OVERVIEW_RUNS = 60
OVERVIEW_COLUMNS = (("k", "STRING"), ("label", "STRING"), ("why", "STRING"), ("owner", "STRING"), ("tier", "STRING"),
                    ("status", "STRING"), ("reason", "STRING"), ("money", "DOUBLE"), ("n", "BIGINT"), ("at", "TIMESTAMP"),
                    ("day", "DATE"), ("fx", "STRING"), ("missing", "TIMESTAMP"))
ACTION_SORTS = {"action_owner": "_inspire_owner", "action_status": "_inspire_status"}
AI_COLUMNS = ("ai_explanation", "ai_confidence_reason", "ai_facts_hash", "ai_facts", "confidence_level", "ai_next_action",
              "ai_expected_result", "ai_other_option", "ai_evidence", "ai_check")
VALUE_FORMULA = "value_at_stake_formula"
VALUE_PLACEHOLDER = re.compile(r"\{([^{}:]*)(?::([^{}]*))?\}")
VALUE_KINDS = ("money", "number", "percent")
VALUE_TOKEN = re.compile(r"\s*(?:([0-9]+(?:\.[0-9]+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/(),]))")
VALUE_FUNCTIONS = ("greatest", "least")
VALUE_EXPRESSION_CHARS = 300
ASSUMPTIONS_SUFFIX = "_assumptions"
AI_CATEGORY = re.compile(r"^ai_cat_[a-z0-9_]{1,40}$")
AI_LISTED = ("ai_explanation", "confidence_level")
AI_UNEXPLAINED = "Not explained yet"
SUMMARY_SUFFIX = "_summary"
SEEN_TYPE = "ARRAY<STRUCT<k: STRING, v: BIGINT>>"
LIKE_ESCAPE = "!"
LIST_DIRS = ("asc", "desc")
CURSOR_DIRS = ("next", "prev")
KEYSET_TYPES = ("STRING", "CHAR", "VARCHAR", "BYTE", "SHORT", "INT", "LONG", "DOUBLE", "DATE", "BOOLEAN")
MONEY_SORT = "_inspire_money"
MERGE_KEY = "_inspire_merge"
VERSION_COLUMN = "_inspire_version"
RUN_LOG_PROPERTY = "inspire.run_log"
RUN_LOG_TIER_PROPERTY = "inspire.run_log_tier"
RUN_FACTS_COLUMN = "run_facts"
STAGE_PROPERTY = "inspire.run_stage"
STAGES_MAX = 10
STAGE_STATES = ("running", "done", "stopped")
STAGE_REASON_CHARS = 300
NON_DATA_OPERATIONS = ("OPTIMIZE", "VACUUM START", "VACUUM END", "SET TBLPROPERTIES", "UNSET TBLPROPERTIES", "ANALYZE",
                       "COMPUTE STATISTICS", "CLUSTER BY", "UPGRADE PROTOCOL")
FIELD_KINDS = {"STRING": "text", "CHAR": "text", "VARCHAR": "text", "BYTE": "integer", "SHORT": "integer", "INT": "integer",
               "LONG": "integer", "FLOAT": "decimal", "DOUBLE": "decimal", "DECIMAL": "decimal", "BOOLEAN": "boolean", "DATE": "date",
               "TIMESTAMP": "timestamp", "TIMESTAMP_NTZ": "timestamp"}
SQL_TYPES = {"STRING": "STRING", "CHAR": "STRING", "VARCHAR": "STRING", "BYTE": "TINYINT", "SHORT": "SMALLINT", "INT": "INT",
             "LONG": "BIGINT", "FLOAT": "FLOAT", "DOUBLE": "DOUBLE", "BOOLEAN": "BOOLEAN", "DATE": "DATE", "TIMESTAMP": "TIMESTAMP",
             "TIMESTAMP_NTZ": "TIMESTAMP_NTZ"}
INTEGER_BITS = {"BYTE": 7, "SHORT": 15, "INT": 31, "LONG": 63}
LINES_TYPE = "ARRAY<STRING>"
CONCURRENT = re.compile(r"Concurrent\w*Exception|DELTA_CONCURRENT|CONCURRENT_(APPEND|DELETE|TRANSACTION)", re.I)
MONEY_CODES = frozenset((
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP "
    "CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR "
    "IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR "
    "MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE "
    "SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XCG XOF "
    "XPF YER ZAR ZMW ZWG ZWL").split())
IMPACT_KINDS = ("money", "count", "hours", "percent", "number")
_NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")
_INTEGER = re.compile(r"^[-+]?\d{1,20}$")
_TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d{1,6})?)?$")
_DECIMAL_TYPE = re.compile(r"^DECIMAL\((\d{1,2}),(\d{1,2})\)$")
_EXPRESSION_NAMES = re.compile(r"`([^`]+)`|\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()")
_SQL_WORDS = frozenset(("distinct", "case", "when", "then", "else", "end", "and", "or", "not", "null", "is", "in", "as", "true", "false",
                        "like", "ilike", "rlike", "between", "interval", "filter", "over", "partition", "by", "order", "asc", "desc",
                        "nulls", "first", "last", "within", "group", "int", "integer", "bigint", "smallint", "tinyint", "double", "float",
                        "decimal", "string", "date", "timestamp", "boolean", "day", "days", "month", "months", "year", "years"))
FORMATS = ("number", "integer", "currency", "percent", "text", "date", "month")
CHART_TYPES = ("bar", "horizontal_bar", "stacked_bar", "line", "area", "stacked_area", "pareto", "scatter", "donut", "heatmap")
CHART_KINDS = ("trend", "bars", "split", "pareto", "scatter")
CHART_KIND_TYPES = {"trend": ("line", "area", "stacked_area"), "bars": ("bar", "horizontal_bar", "stacked_bar"), "split": ("donut",),
                    "pareto": ("pareto",), "scatter": ("scatter", "heatmap")}
CHART_KIND_LABELS = {"trend": "Trend over time", "bars": "Bars by segment", "split": "Share of a whole", "pareto": "Biggest first",
                     "scatter": "Two measures"}
CHART_PICK = ("trend", "bars", "pareto")
TIME_CHARTS = ("line", "area", "stacked_area", "bar", "stacked_bar", "heatmap")
SERIES_CHARTS = ("stacked_bar", "stacked_area", "heatmap")
ADDITIVE_CHARTS = ("stacked_bar", "stacked_area", "pareto", "donut")
X_KINDS = ("time", "category", "value")
SORTS = ("value_desc", "value_asc", "x_asc")
FILTER_TYPES = ("date_range", "multi_select")
SEGMENT_FILTERS_MIN = 3
DRIVER = "driver"
DRIVERS_MIN = 1
DRIVERS_TITLE = "Drivers"
GUIDE_PREFIX = "How to read:"
GUIDE_TITLES = 2
RUN_COLUMN = "_inspire_run"
RUN_LATEST = "latest"
RUN_SCOPES = "run_scopes"
SCOPE_KEY_PATTERN = '"key": "([^"]*)"'
SCOPE_ALL_TEXT = "All records"
SCOPE_FIRST_RUN = "First run: "
SCOPE_PART = "part of the records"
SCOPE_SENTENCE = " The latest run covered only "
SCOPE_SCHEMA = "ARRAY<STRUCT<scope: STRING, text: STRING>>"
SCOPE_COLUMN = "run_scope"
SCOPE_TEMPLATE = "{{#QUERY_RESULT_ROWS}}{{" + SCOPE_COLUMN + "}}{{/QUERY_RESULT_ROWS}}"
RUN_PREVIOUS = "previous"
REASONS_KEPT = ("as_of_date", "priority_tier", "run_id")
REASON_NUMBERS = r"[0-9]+([.,][0-9]+)*"
REASON_NUMBER_MARK = "\u2026"
COMPARE_RUN = "vs previous run"
CHANGE_MARKS = {"up": "\u25b2", "down": "\u25bc", "same": "\u25a0"}
CHANGE_WORDS = {"same": "unchanged", "from_zero": "from 0", "none": "No earlier run to compare",
                "story_none": "with no earlier run to compare"}
TREND_RUN_LABEL = "run_label"
COLUMN_FILTERS = "column_filters"
COLUMN_FILTER_TYPES = ("multi_select", "number_range", "date_range")
FORMAT_FILTERS = {"number": "number_range", "integer": "number_range", "currency": "number_range", "percent": "number_range",
                  "text": "multi_select", "date": "date_range", "month": "date_range"}
RANGE_EDGES = {"number_range": ("min", "max"), "date_range": ("from", "to")}
FILTER_FIELD_KINDS = {"number_range": ("integer", "decimal"), "date_range": ("date", "timestamp")}
FORMAT_FITS = {"text": "text", "boolean": "text", "integer": "number", "decimal": "number", "date": "date", "timestamp": "date"}
LIST_ROLE_LABELS = {"rank": "Rank", "label": "Item", "tier": "Tier"}
GRAINS = ("day", "month")
GOODS = ("up", "down", "neutral")
PRESETS = (("3m", "Last 3 months", 3), ("6m", "Last 6 months", 6), ("12m", "Last 12 months", 12), ("24m", "Last 24 months", 24),
           ("all", "All time", None))
PRESET_IDS = tuple(p[0] for p in PRESETS)
ICONS = ("tag", "box", "truck", "trend", "users", "grid", "calendar", "filter", "sliders", "home")
HUES = ("blue", "teal", "amber", "green", "violet", "coral", "plum", "rose", "slate")
RATIO_TOKENS = frozenset(("ratio", "rate", "pct", "percent", "percentage", "proportion", "share", "avg", "average", "mean",
                          "median", "margin", "per"))
CAPS = {"kpis": (3, 6), "charts": (3, 8), "tables": (0, 3), "filters": (1, 8), "tiles": 12, "datasets": 12, "y": 4,
        "chart_rows": 5000, "table_rows": 5000, "records_rows": 5000, "options": 500, "values": 200, "value_chars": 300,
        "history_rows": 500, "runs_rows": 5000, "field_chars": 4000, "lines": 50, "fields": 200,
        "list_rows": 100, "list_offset": 10 ** 9, "search_chars": 200, "option_matches": 50, "act_records": 200, "owners": 50,
        "owner_chars": 254, "reason_chars": 300, "overview_rows": 500, "assumption_rows": 200, "assumption_limit": 1e15,
        "realized_note_chars": 500, "realized_value": 10 ** 15, "impact_rows": 100, "promised_chars": 1000, "benefits": 5, "usage_rows": 2000,
        "range_number": 10 ** 15, "blocks": (0, 8), "block_text": 4000, "block_html": 20000, "image_bytes": 2 * 1024 * 1024,
        "image_height": (40, 1200), "url_chars": 2000, "kpi_rows": 2, "act_match": 100000, "note_chars": 500, "snooze_days": 365,
        "conflicts_shown": 20, "similar_sample": 5, "similar_by": 3, "batches": 20, "exclude_keys": 50, "window_limit": 1000,
        "utc_offset_min": 840, "act_history": 200, "closers_today": 200}
ALERT_OPERATORS = {">=": "GREATER_THAN_OR_EQUAL", ">": "GREATER_THAN", "=": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN",
                   "<=": "LESS_THAN_OR_EQUAL"}
ALERT_BASES = ("fixed", "baseline")
ALERT_BASELINE_DIRECTIONS = {">=": "+", ">": "+", "<=": "-", "<": "-"}
ALERT_BASELINE_SIGMAS = 2
ALERT_BASELINE_MIN_RUNS = 5
ALERT_BASELINE_RUNS = 30
ALERT_FIRED = "alert_value"
ALERT_HELD = "not_reliable"
ALERT_WATCHED = "watched_value"
ALERT_PREVIOUS = "previous_run_value"
ALERT_RECORDS = "records"
ALERT_RECORDS_LABEL = "Records on the list"
ALERT_GONE = ("DELETED", "TRASHED")
CURRENT_ROWS = "is_current AND change_source <> 'delete'"
SQL_CHARS = 20000
EXPRESSION_CHARS = 600
TEXT_LIMITS = {"title": 80, "question": 240, "sponsor": 80, "label": 60, "hint": 220, "caption": 160, "alt": 160}
BLOCKS = "blocks"
BLOCK_KINDS = ("text", "image", "html")
BLOCK_PLACES = ("top", "bottom", "before", "after", "beside")
BLOCK_ANCHORS = {"filters": "the filter bar", "kpis": "the KPI row", "charts": "the charts", "records": "the decision list"}
BLOCK_WIDTHS = ("full", "wide", "half", "narrow")
BLOCK_ALIGNS = ("left", "center", "right")
BLOCK_FIELDS = ("id", "kind", "place", "width", "align", "content")
IMAGE_FIELDS = ("url", "alt", "caption", "height", "file")
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
BLOCK_FOLDER = "blocks"
BLOCK_FILE = re.compile(r"^blocks/[0-9a-f]{64}\.(?:png|jpg|gif|webp)$")
HTML_TAGS = frozenset(("a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
                       "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
                       "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s",
                       "samp", "section", "small", "span", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td",
                       "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr"))
HTML_ATTRS = frozenset(("align", "alt", "cite", "class", "colspan", "datetime", "dir", "headers", "height", "href", "id", "lang",
                        "open", "rel", "reversed", "role", "rowspan", "scope", "span", "src", "start", "style", "target",
                        "title", "valign", "width"))
HTML_CODE_TAGS = frozenset(("script", "iframe", "object", "embed", "frame", "frameset", "applet", "portal", "noscript", "template"))
_SAFE_LINK = re.compile(r"^(?:https?:|mailto:|#)", re.I)
_LINK_SPACE = re.compile(r"[\x00-\x20]+")
_DATA_IMAGE = re.compile(r"^data:image/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$", re.I)
_CSS_BANNED = re.compile(r"@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|\\", re.I)
_CSS_URL = re.compile(r"url\s*\(\s*['\"]?\s*([^'\")\s]*)", re.I)
_MARKDOWN_LINK = re.compile(r"(!?)\[([^\]\n]*)\]\(([^)\s]*)\)")
_MARKDOWN_TAG = re.compile(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?>|<!--")
_IMAGE_URL = re.compile(r"^https?://[^\s/?#]+[^\s]*$", re.I)
IMAGE_PATH = re.compile(r"^/(?:Workspace|Volumes/[^/\s]+/[^/\s]+/[^/\s]+)/\S+$")
_WRITE_WORDS = re.compile(r"\b(insert|update|delete|merge|drop|create|alter|grant|revoke|truncate|copy|optimize|vacuum|call|refresh|"
                          r"msck|use|set|reset|cache|uncache|restore|undrop|comment)\b", re.I)
_EXPRESSION_WORDS = re.compile(r"\b(select|from|join|union|where|having|insert|update|delete|merge|drop|create|alter|grant)\b", re.I)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ADDITIVE = re.compile(r"^(sum|count)\s*\(", re.I)
AGGREGATE_ASK = "write one aggregate expression over the dataset's columns"
AGGREGATE_FUNCTIONS = frozenset((
    "sum", "count", "count_if", "avg", "mean", "min", "max", "median", "mode", "percentile", "percentile_approx", "approx_percentile",
    "percentile_cont", "percentile_disc", "approx_count_distinct", "approx_top_k", "stddev", "stddev_samp", "stddev_pop", "std",
    "variance", "var_samp", "var_pop", "any_value", "any", "some", "every", "bool_and", "bool_or", "first", "first_value", "last",
    "last_value", "min_by", "max_by", "collect_list", "collect_set", "array_agg", "listagg", "string_agg", "corr", "covar_pop",
    "covar_samp", "kurtosis", "skewness", "regr_avgx", "regr_avgy", "regr_count", "regr_intercept", "regr_r2", "regr_slope", "regr_sxx",
    "regr_sxy", "regr_syy", "histogram_numeric", "try_sum", "try_avg", "bit_and", "bit_or", "bit_xor", "hll_sketch_agg", "hll_union_agg",
    "kll_sketch_agg_bigint", "kll_sketch_agg_double", "kll_sketch_agg_float", "bitmap_construct_agg", "bitmap_or_agg", "count_min_sketch",
    "measure"))
_NILADIC = frozenset(("current_date", "current_timestamp", "current_timezone", "current_user", "current_catalog", "current_schema"))
_AGGREGATE_TOKENS = re.compile(r"`[^`]*`|(?<![\w.])[A-Za-z_][A-Za-z0-9_]*|\(|\)")
_WINDOW = re.compile(r"\bover\s*\(", re.I)


def quote(name: str) -> str:
    if not IDENT.match(str(name or "")):
        raise ValueError(f"{name!r} is not a column or dataset name")
    return f"`{name}`"


def table_name(name) -> str:
    parts = [p.strip() for p in str(name or "").split(".")]
    if len(parts) != 3 or not all(TABLE_PART.match(p) for p in parts):
        raise ValueError(f"{name!r} is not a catalog.schema.table name")
    return ".".join(f"`{p}`" for p in parts)


def strip_sql_text(sql: str, keep_names: bool = False) -> str:
    text = re.sub(r"--[^\n]*", " ", str(sql or ""))
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"'(?:[^'\\]|\\.)*'", "''", text)
    text = re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)
    return text if keep_names else re.sub(r"`[^`]*`", "``", text)


def dataset_sql_problems(name: str, sql: str) -> list:
    text = str(sql or "").strip().rstrip(";").strip()
    if not text:
        return [f"dataset {name} has no SQL"]
    if len(text) > SQL_CHARS:
        return [f"dataset {name} SQL is {plural(len(text), 'character')}; keep it under {SQL_CHARS:,}"]
    bare = strip_sql_text(text)
    problems = []
    if ";" in bare:
        problems.append(f"dataset {name} holds more than one statement; write one SELECT")
    if not re.match(r"^\s*(select|with)\b", bare, re.I):
        problems.append(f"dataset {name} must start with SELECT or WITH")
    word = _WRITE_WORDS.search(bare)
    if word:
        problems.append(f"dataset {name} uses {word.group(1).upper()}; datasets only read data")
    return problems


def clean_sql(sql: str) -> str:
    return str(sql or "").strip().rstrip(";").strip()


def _balanced(text: str) -> bool:
    depth = 0
    for ch in text:
        depth += ch == "("
        depth -= ch == ")"
        if depth < 0:
            return False
    return depth == 0


def expression_problems(where: str, expression) -> list:
    text = str(expression or "").strip()
    if not text:
        return [f"{where} has no expression"]
    if len(text) > EXPRESSION_CHARS:
        return [f"{where} expression is longer than {plural(EXPRESSION_CHARS, 'character')}"]
    bare = strip_sql_text(text)
    if ";" in bare or "--" in text or "/*" in text:
        return [f"{where} expression holds a statement separator or a comment"]
    word = _EXPRESSION_WORDS.search(bare)
    if word:
        return [f"{where} expression uses {word.group(1).upper()}; {AGGREGATE_ASK}"]
    if not _balanced(bare):
        return [f"{where} expression has unbalanced parentheses"]
    loose = _unaggregated(strip_sql_text(text, keep_names=True))
    return [f"{where} expression {loose}, so it gives a value for every row; {AGGREGATE_ASK}"] if loose else []


def _unaggregated(text: str) -> str:
    if _WINDOW.search(text):
        return "is a window function (OVER)"
    tokens = list(_AGGREGATE_TOKENS.finditer(text))
    inside, aggregated = [], False
    for index, match in enumerate(tokens):
        token = match.group(0)
        if token == "(":
            called = index and not text[tokens[index - 1].end():match.start()].strip()
            name = tokens[index - 1].group(0).lower() if called else ""
            aggregated = aggregated or name in AGGREGATE_FUNCTIONS
            inside.append(name in AGGREGATE_FUNCTIONS or bool(inside and inside[-1]))
        elif token == ")":
            if inside:
                inside.pop()
        elif not token.startswith("`") and (text[match.end():].lstrip().startswith("(") or token.lower() in _SQL_WORDS
                                             or token.lower() in _NILADIC):
            continue
        elif not (inside and inside[-1]):
            return f"reads {token.strip('`')} outside an aggregate"
    return "" if aggregated else "holds no aggregate"


def is_additive(expression: str) -> bool:
    text = strip_sql_text(str(expression or "").strip())
    match = _ADDITIVE.match(text)
    if not match:
        return False
    depth = 0
    for index in range(match.end() - 1, len(text)):
        depth += text[index] == "("
        depth -= text[index] == ")"
        if depth == 0:
            return not text[index + 1:].strip()
    return False


def summed_ratio_columns(expression: str) -> list:
    found = []
    for inner in re.findall(r"\bsum\s*\(\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\)", strip_sql_text(str(expression or ""), keep_names=True), re.I):
        if RATIO_TOKENS & set(inner.lower().split("_")):
            found.append(inner)
    return found


def _text_problem(where: str, value, key: str, required: bool = True) -> list:
    text = str(value or "").strip()
    if not text:
        return [f"{where} has no {key}"] if required else []
    limit = TEXT_LIMITS.get(key, 120)
    return [f"{where} {key} is longer than {plural(limit, 'character')}"] if len(text) > limit else []


def _ids(items, where: str, problems: list) -> set:
    seen = set()
    for item in items:
        ident = str((item or {}).get("id") or (item or {}).get("name") or "")
        if not IDENT.match(ident):
            problems.append(f"{where} {ident!r} needs an id of letters, digits and underscores")
        elif ident in seen:
            problems.append(f"{where} {ident} appears twice")
        seen.add(ident)
    return seen


def _count_problem(key: str, items: list, low=None) -> list:
    floor, high = CAPS[key]
    low = floor if low is None else low
    if not low <= len(items) <= high:
        return [f"the page has {len(items)} {key}; it needs {low} to {high}"]
    return []


def review_problems(page: dict) -> list:
    review = page.get("review")
    if review is None:
        return []
    if not isinstance(review, str) or not REVIEW_LINK.match(review):
        return ["the page review must be the link to its use case on Inspire's Review page, as Inspire writes it"]
    return [] if page.get("use_case_id") else ["the page has a review link but no use_case_id, so the link names no use case"]


def spec_problems(page: dict) -> list:
    if not isinstance(page, dict):
        return ["the page spec is not a JSON object"]
    problems = []
    if page.get("version") != SPEC_VERSION:
        problems.append(f"the page spec version must be {SPEC_VERSION}")
    problems += _text_problem("the page", page.get("title"), "title")
    problems += _text_problem("the page", page.get("question"), "question")
    problems += _text_problem("the page", page.get("sponsor"), "sponsor", required=False)
    problems += _promised_problems(page.get("promised"))
    problems += page_settings_problems(page.get("settings"))
    problems += review_problems(page)
    if page.get("icon") not in ICONS:
        problems.append(f"the page icon must be one of {', '.join(ICONS)}")
    result = page.get("result_table")
    if result is not None:
        try:
            table_name(result)
        except ValueError as error:
            problems.append(f"the page result_table: {error}")
            result = None
    datasets = page.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        return problems + ["the page has no datasets"]
    if len(datasets) > CAPS["datasets"]:
        problems.append(f"the page has {plural(len(datasets), 'dataset')}; keep it to {CAPS['datasets']}")
    names = _ids(datasets, "dataset", problems)
    for dataset in datasets:
        problems += dataset_sql_problems(dataset.get("name"), dataset.get("sql"))
    sqls = {dataset.get("name"): dataset.get("sql") for dataset in datasets}
    filters = page.get("filters") if isinstance(page.get("filters"), list) else []
    problems += _count_problem("filters", filters)
    _ids(filters, "filter", problems)
    for f in filters:
        where = f"filter {f.get('id')}"
        problems += _text_problem(where, f.get("label"), "label")
        if f.get("type") not in FILTER_TYPES:
            problems.append(f"{where} type must be one of {', '.join(FILTER_TYPES)}")
            continue
        columns = f.get("columns")
        if not isinstance(columns, dict) or not columns:
            problems.append(f"{where} names no dataset column")
            continue
        for dataset, column in columns.items():
            if dataset not in names:
                problems.append(f"{where} names dataset {dataset}, which the page does not define")
            if not IDENT.match(str(column or "")):
                problems.append(f"{where} column {column!r} is not a column name")
        if f["type"] == "date_range":
            if f.get("grain", "month") not in GRAINS:
                problems.append(f"{where} grain must be day or month")
            if f.get("default", "12m") not in PRESET_IDS:
                problems.append(f"{where} default must be one of {', '.join(PRESET_IDS)}")
    kpis = page.get("kpis") if isinstance(page.get("kpis"), list) else []
    problems += _count_problem("kpis", kpis)
    _ids(kpis, "KPI", problems)
    for kpi in kpis:
        where = f"KPI {kpi.get('id')}"
        problems += _text_problem(where, kpi.get("label"), "label")
        problems += _text_problem(where, kpi.get("caption"), "caption", required=False)
        if kpi.get("dataset") not in names:
            problems.append(f"{where} reads dataset {kpi.get('dataset')}, which the page does not define")
        shape = expression_problems(where, kpi.get("expression"))
        problems += shape
        problems += _format_problems(where, kpi)
        if kpi.get("good", "neutral") not in GOODS:
            problems.append(f"{where} good must be up, down or neutral")
        if kpi.get("compare") and result and kpi.get("dataset") in names and not reads_table(sqls.get(kpi.get("dataset")), result):
            problems.append(f"{where} compares with the previous run, but its dataset {kpi.get('dataset')} does not read the result table "
                            f"{result}, the one table that keeps earlier runs; set compare only on a KPI over that table")
        elif kpi.get("compare") and result and kpi.get("dataset") in names and runs_problem(sqls.get(kpi.get("dataset")), result):
            problems.append(f"{where} compares with the previous run, but its dataset {kpi.get('dataset')} cannot be read run by run: "
                            f"{runs_problem(sqls.get(kpi.get('dataset')), result)}")
        split = run_split_problem(kpi.get("expression")) if kpi.get("compare") and not shape else ""
        if split:
            problems.append(f"{where} compares with the previous run, but {split}, or set no compare")
    charts = page.get("charts") if isinstance(page.get("charts"), list) else []
    fewer = isinstance(page.get("fewer_charts"), str) and bool(page["fewer_charts"].strip())
    problems += _count_problem("charts", charts, 1 if fewer else None)
    _ids(charts, "chart", problems)
    for chart in charts:
        problems += _chart_problems(chart, names)
    tables = page.get("tables") if isinstance(page.get("tables"), list) else []
    problems += _count_problem("tables", tables)
    _ids(tables, "table", problems)
    for table in tables:
        problems += _table_problems(table, names)
    problems += _records_problems(page.get("records"), RECORDS_DATASET in names)
    problems += similar_by_problems(page)
    problems += blocks_problems(page)
    tiles = len(kpis) + len(charts) + len(tables) + (1 if RECORDS_DATASET in names else 0)
    if tiles > CAPS["tiles"]:
        problems.append(f"the page has {tiles} tiles; keep it to {CAPS['tiles']} so it reads at a glance")
    return problems


def _promised_problems(promised) -> list:
    if promised is None:
        return []
    if not isinstance(promised, dict):
        return ["the page promised must be an object of the catalog's business value and its benefits"]
    problems = []
    value, benefits = promised.get("value", ""), promised.get("benefits", [])
    if not isinstance(value, str) or len(value) > CAPS["promised_chars"]:
        problems.append(f"the page promised value must be text of at most {CAPS['promised_chars']} characters")
    if (not isinstance(benefits, list) or len(benefits) > CAPS["benefits"]
            or any(not isinstance(b, str) or len(b) > CAPS["value_chars"] for b in benefits)):
        problems.append(f"the page promised benefits must be at most {CAPS['benefits']} lines of at most {CAPS['value_chars']} characters")
    return problems


def _format_problems(where: str, item: dict) -> list:
    problems = []
    if item.get("format", "number") not in FORMATS:
        problems.append(f"{where} format must be one of {', '.join(FORMATS)}")
    if item.get("format") == "currency" and str(item.get("currency") or "") not in MONEY_CODES:
        problems.append(f"{where} is money, so it needs an ISO 4217 currency code such as USD")
    return problems


def _whole(value, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _chart_problems(chart: dict, names: set) -> list:
    where = f"chart {chart.get('id')}"
    problems = _text_problem(where, chart.get("title"), "title") + _text_problem(where, chart.get("hint"), "hint")
    kind = chart.get("type")
    if kind not in CHART_TYPES:
        return problems + [f"{where} type must be one of {', '.join(CHART_TYPES)}"]
    if chart.get("dataset") not in names:
        problems.append(f"{where} reads dataset {chart.get('dataset')}, which the page does not define")
    x = chart.get("x") if isinstance(chart.get("x"), dict) else {}
    ys = chart.get("y") if isinstance(chart.get("y"), list) else []
    if not 1 <= len(ys) <= CAPS["y"]:
        problems.append(f"{where} needs 1 to {CAPS['y']} measures in y")
    for index, y in enumerate(ys):
        problems += _text_problem(f"{where} measure {index + 1}", y.get("label"), "label")
        problems += expression_problems(f"{where} measure {index + 1}", y.get("expression"))
        problems += _format_problems(f"{where} measure {index + 1}", y)
    if kind == "scatter":
        problems += expression_problems(f"{where} x", x.get("expression"))
        if not IDENT.match(str(chart.get("group") or "")):
            problems.append(f"{where} is a scatter, so it needs a group column that names each point")
        if len(ys) != 1:
            problems.append(f"{where} is a scatter, so it plots exactly one measure against x")
    else:
        if not IDENT.match(str(x.get("column") or "")):
            problems.append(f"{where} x needs a column")
        if x.get("kind") not in ("time", "category"):
            problems.append(f"{where} x kind must be time or category")
    series = chart.get("series")
    if series is not None:
        if not isinstance(series, dict) or not IDENT.match(str(series.get("column") or "")):
            problems.append(f"{where} series needs a column")
        elif not _whole(series.get("top", 5), 1, 8):
            problems.append(f"{where} series top must be a whole number from 1 to 8")
    if kind in SERIES_CHARTS and not series:
        problems.append(f"{where} is a {kind}, so it needs a series column")
    if kind in ("donut", "pareto", "scatter", "horizontal_bar") and series:
        problems.append(f"{where} is a {kind}, so it cannot split into series")
    if chart.get("sort", "value_desc") not in SORTS:
        problems.append(f"{where} sort must be one of {', '.join(SORTS)}")
    if not _whole(chart.get("limit", 25), 1, 500):
        problems.append(f"{where} limit must be a whole number from 1 to 500")
    if chart.get("span", 1) not in (1, 2):
        problems.append(f"{where} span must be 1 or 2")
    if not isinstance(chart.get(DRIVER, False), bool):
        problems.append(f"{where} {DRIVER} must be true or false")
    return problems


def _table_problems(table: dict, names: set) -> list:
    where = f"table {table.get('id')}"
    problems = _text_problem(where, table.get("title"), "title") + _text_problem(where, table.get("hint"), "hint", required=False)
    if table.get("dataset") not in names:
        problems.append(f"{where} reads dataset {table.get('dataset')}, which the page does not define")
    columns = table.get("columns") if isinstance(table.get("columns"), list) else []
    if not 1 <= len(columns) <= 12:
        problems.append(f"{where} needs 1 to 12 columns")
    for column in columns:
        if not IDENT.match(str((column or {}).get("column") or "")):
            problems.append(f"{where} column {column!r} needs a column name")
        problems += _text_problem(f"{where} column {(column or {}).get('column')}", (column or {}).get("label"), "label")
        problems += _format_problems(f"{where} column {(column or {}).get('column')}", column or {})
    sort = table.get("sort") or {}
    if sort and not IDENT.match(str(sort.get("column") or "")):
        problems.append(f"{where} sort needs a column")
    if not _whole(table.get("limit", CAPS["table_rows"]), 1, CAPS["table_rows"]):
        problems.append(f"{where} limit must be a whole number from 1 to {CAPS['table_rows']}")
    return problems + column_filter_problems(where, table.get(COLUMN_FILTERS), table_shown(table))


def _records_problems(records, has_dataset: bool) -> list:
    if records is None:
        return ["the page has a records dataset but no records section"] if has_dataset else []
    if not has_dataset:
        return ["the page has a records section but no dataset named records"]
    if not isinstance(records, dict):
        return ["the records section is not a JSON object"]
    where = "the records list"
    problems = _text_problem(where, records.get("title"), "title") + _text_problem(where, records.get("hint"), "hint", required=False)
    problems += _text_problem(f"{where} label_title", records.get("label_title"), "label", required=False)
    for key in ("key", "label", "rank"):
        if not IDENT.match(str(records.get(key) or "")):
            problems.append(f"{where} needs a {key} column")
    for key in ("sublabel", "tier", "reasons", "action"):
        if records.get(key) is not None and not IDENT.match(str(records.get(key))):
            problems.append(f"{where} {key} must be a column name")
    for key, low, high in (("columns", 1, 8), ("detail", 0, 12)):
        items = records.get(key) if isinstance(records.get(key), list) else []
        if not low <= len(items) <= high:
            problems.append(f"{where} needs {low} to {high} {key}")
        for column in items:
            if not IDENT.match(str((column or {}).get("column") or "")):
                problems.append(f"{where} {key} entry {column!r} needs a column name")
            problems += _text_problem(f"{where} {key} {(column or {}).get('column')}", (column or {}).get("label"), "label")
            problems += _format_problems(f"{where} {key} {(column or {}).get('column')}", column or {})
    return problems + column_filter_problems(where, records.get(COLUMN_FILTERS), list_shown(records))


def _column_label(name: str) -> str:
    words = str(name or "").replace("_", " ").strip()
    return words[:1].upper() + words[1:]


def list_shown(records: dict) -> dict:
    listed = {c["column"]: c for c in records.get("columns") or [] if isinstance(c, dict) and isinstance(c.get("column"), str)}
    titles = dict(LIST_ROLE_LABELS, label=records.get("label_title") or LIST_ROLE_LABELS["label"])
    shown = {}
    for key, kind in (("rank", "integer"), ("label", "text"), ("sublabel", "text"), ("tier", "text")):
        column = records.get(key)
        if isinstance(column, str) and column:
            entry = listed.get(column) or {}
            shown.setdefault(column, (entry.get("label") or titles.get(key) or _column_label(column), entry.get("format") or kind))
    for column, entry in listed.items():
        shown.setdefault(column, (entry.get("label") or _column_label(column), entry.get("format", "number")))
    return shown


def table_shown(table: dict) -> dict:
    return {c["column"]: (c.get("label") or _column_label(c["column"]), c.get("format", "number"))
            for c in table.get("columns") or [] if isinstance(c, dict) and isinstance(c.get("column"), str)}


def column_filter_problems(where: str, entries, shown: dict) -> list:
    if entries is None:
        return []
    if not isinstance(entries, list):
        return [f"{where} {COLUMN_FILTERS} must be a list of the columns that get a filter, each as {{\"column\": name}}"]
    problems, seen = [], set()
    for entry in entries:
        column = entry.get("column") if isinstance(entry, dict) else None
        if not isinstance(column, str) or not IDENT.match(column):
            problems.append(f"{where} column filter {entry!r} needs a column name")
            continue
        if column in seen:
            problems.append(f"{where} column filter {column} appears twice")
            continue
        seen.add(column)
        if column not in shown:
            problems.append(f"{where} has a column filter on {column}, which it does not show; filter one of the columns it shows: "
                            f"{', '.join(shown)}")
            continue
        kind = FORMAT_FILTERS.get(shown[column][1])
        if kind is None:
            continue
        stated = entry.get("type", kind)
        if stated not in COLUMN_FILTER_TYPES:
            problems.append(f"{where} column filter {column} type must be one of {', '.join(COLUMN_FILTER_TYPES)}")
        elif stated != kind:
            problems.append(f"{where} column {column} shows as {shown[column][1]}, so its filter is a {kind}, not a {stated}")
    return problems


def column_filters(entries, shown: dict) -> list:
    out = []
    for entry in entries if isinstance(entries, list) else []:
        column = entry.get("column") if isinstance(entry, dict) else None
        kind = FORMAT_FILTERS.get(shown[column][1]) if isinstance(column, str) and column in shown else None
        if kind and column not in {f["column"] for f in out}:
            out.append({"column": column, "type": kind, "label": shown[column][0]})
    return out


def list_column_filters(page: dict) -> list:
    records = page.get("records")
    return column_filters(records.get(COLUMN_FILTERS), list_shown(records)) if isinstance(records, dict) else []


def table_column_filters(table: dict) -> list:
    return column_filters(table.get(COLUMN_FILTERS), table_shown(table))


def page_column_filters(page: dict) -> dict:
    return {"list": list_column_filters(page),
            "tables": {t["id"]: table_column_filters(t) for t in page.get("tables") or [] if table_column_filters(t)}}


def column_type_problems(where: str, filters: list, columns) -> list:
    types = {c.get("name"): str(c.get("type") or "").upper() for c in columns or []}
    problems = []
    for f in filters:
        wanted = FILTER_FIELD_KINDS.get(f["type"])
        held = types.get(f["column"])
        if wanted and held and FIELD_KINDS.get(held) not in wanted:
            fit = FORMAT_FITS.get(FIELD_KINDS.get(held), "text")
            problems.append(f"{where} column filter {f['column']} is a {f['type']}, but {f['column']} holds {held} values; "
                            f"set the column's format to {fit} so its filter fits its values")
    return problems


def safe_link(url) -> bool:
    text = str(url or "")
    return len(text) <= CAPS["url_chars"] and bool(_SAFE_LINK.match(_LINK_SPACE.sub("", text)))


def css_problems(where: str, css: str) -> list:
    problems = []
    banned = _CSS_BANNED.search(css or "")
    if banned:
        problems.append(f"{where} styles use {banned.group(0)!r}, which a block cannot hold" + (": write the character itself, "
                        "not a CSS escape" if banned.group(0) == "\\" else ""))
    for url in _CSS_URL.findall(css or ""):
        if not _DATA_IMAGE.match(url):
            problems.append(f"{where} styles load {url[:80]!r}; a style loads only a data:image URL, so put any other image in "
                            f"an image block that names its /Workspace or /Volumes path, and Inspire copies it into the App")
    return problems


class _HtmlScan(HTMLParser):
    def __init__(self, where: str):
        super().__init__(convert_charrefs=True)
        self.where, self.problems, self.styling = where, [], False

    def _say(self, problems) -> None:
        self.problems += [p for p in problems if p not in self.problems]

    def handle_starttag(self, tag, attrs):
        at = f"{self.where} <{tag}>"
        if tag not in HTML_TAGS:
            self._say([f"{self.where} uses <{tag}>, which a block cannot hold" + (", since it runs code or loads another page"
                                                                                  if tag in HTML_CODE_TAGS else "")])
        for name, value in attrs:
            value = value or ""
            if name.startswith("on"):
                self._say([f"{at} has the event handler {name}, which a block cannot hold"])
            elif name not in HTML_ATTRS and not name.startswith(("aria-", "data-")):
                self._say([f"{at} has the attribute {name}, which a block cannot hold"])
            elif name == "href" and not safe_link(value):
                self._say([f"{at} links to {value[:80]!r}; a link goes to an http, https or mailto address"])
            elif name == "src" and tag != "img":
                self._say([f"{at} has the attribute src, which only an <img> takes"])
            elif name == "src" and not _DATA_IMAGE.match(value.strip()):
                self._say([f"{at} loads {value[:80]!r}; an image inside html is a data:image URL, so put any other image in "
                           f"an image block that names its /Workspace or /Volumes path, and Inspire copies it into the App"])
            elif name == "style":
                self._say(css_problems(at, value))
        self.styling = tag == "style"

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.styling = False

    def handle_endtag(self, tag):
        if tag == "style":
            self.styling = False

    def handle_data(self, data):
        if self.styling:
            self._say(css_problems(f"{self.where} <style>", data))

    def handle_decl(self, decl):
        self._say([f"{self.where} holds <!{decl[:40]}>; a block holds a piece of HTML, not a whole document"])

    def unknown_decl(self, data):
        self._say([f"{self.where} holds <![{data[:40]}>, which a block cannot hold"])

    def handle_pi(self, data):
        self._say([f"{self.where} holds <?{data[:40]}>, which a block cannot hold"])


def html_problems(where: str, html) -> list:
    if not isinstance(html, str) or not html.strip():
        return [f"{where} is an html block, so its content is the HTML and CSS it shows"]
    if len(html) > CAPS["block_html"]:
        return [f"{where} html is longer than {plural(CAPS['block_html'], 'character')}"]
    scan = _HtmlScan(where)
    scan.feed(html)
    scan.close()
    return scan.problems


def markdown_problems(where: str, text) -> list:
    if not isinstance(text, str) or not text.strip():
        return [f"{where} is a text block, so its content is the Markdown text it shows"]
    problems = [] if len(text) <= CAPS["block_text"] else [f"{where} text is longer than {plural(CAPS['block_text'], 'character')}"]
    if _MARKDOWN_TAG.search(text):
        problems.append(f"{where} text holds HTML tags; a text block is Markdown, so put HTML in an html block")
    for image, _label, url in _MARKDOWN_LINK.findall(text):
        if image:
            problems.append(f"{where} text shows the image {url[:80]}; put an image in an image block that names its "
                            f"/Workspace or /Volumes path, so Inspire copies it into the App")
        elif not safe_link(url):
            problems.append(f"{where} links to {url[:80]!r}; a link goes to an http, https or mailto address")
    return problems


def image_problems(where: str, content) -> list:
    if not isinstance(content, dict):
        return [f"{where} is an image block, so its content is {{\"url\", \"alt\"}} with an optional caption and height"]
    problems = []
    extra = sorted(set(content) - set(IMAGE_FIELDS))
    if extra:
        problems.append(f"{where} content has {', '.join(extra)}; an image block takes {', '.join(IMAGE_FIELDS[:4])}")
    url = content.get("url")
    if not (isinstance(url, str) and (IMAGE_PATH.match(url.strip()) or _IMAGE_URL.match(url.strip())) and len(url) <= CAPS["url_chars"]):
        problems.append(f"{where} url must be the /Workspace/... or /Volumes/... path of the image, at most {CAPS['url_chars']} "
                        f"characters")
    picked = content.get("file")
    if picked is not None and not (isinstance(picked, str) and BLOCK_FILE.match(picked)):
        problems.append(f"{where} file {picked!r} is not an image Inspire copied into the App; leave file out, Inspire sets it")
    problems += _text_problem(where, content.get("alt"), "alt")
    problems += _text_problem(where, content.get("caption"), "caption", required=False)
    low, high = CAPS["image_height"]
    if content.get("height") is not None and not _whole(content["height"], low, high):
        problems.append(f"{where} height must be a whole number of pixels from {low} to {high}")
    return problems


def _block_elements(page: dict) -> tuple:
    anchors = {k: v for k, v in BLOCK_ANCHORS.items() if k != "records" or isinstance(page.get("records"), dict)}
    kinds = {}
    for group, kind in (("kpis", "KPI"), ("charts", "chart"), ("tables", "table")):
        for item in page.get(group) if isinstance(page.get(group), list) else []:
            if isinstance(item, dict) and item.get("id"):
                kinds.setdefault(str(item["id"]), []).append(kind)
    return anchors, kinds


def _place_problems(where: str, block: dict, anchors: dict, kinds: dict, blocks: set) -> list:
    place = block.get("place")
    if not isinstance(place, dict) or place.get("where") not in BLOCK_PLACES:
        return [f"{where} place must be {{\"where\": one of {', '.join(BLOCK_PLACES)}}}, with \"of\" naming the element it sits by "
                f"unless it is top or bottom"]
    at, named = place["where"], str(place.get("of") or "")
    extra = sorted(set(place) - {"where", "of"})
    if extra:
        return [f"{where} place has {', '.join(extra)}; it takes where and of"]
    if at in ("top", "bottom"):
        return [f"{where} sits at the page {at}, so its place takes no of"] if named else []
    known = list(anchors) + list(kinds) + sorted(blocks - {str(block.get("id"))})
    if not named:
        return [f"{where} sits {at} an element, so its place needs of, one of: {', '.join(known)}"]
    if named == str(block.get("id")):
        return [f"{where} cannot sit {at} itself"]
    if len(kinds.get(named, [])) > 1:
        return [f"{where} sits {at} {named}, which is both a {kinds[named][0]} and a {kinds[named][1]}; give them different ids"]
    if named not in anchors and named not in kinds and named not in blocks:
        return [f"{where} sits {at} {named}, which the page does not have; name one of: {', '.join(known)}"]
    if at != "beside":
        return []
    if named in blocks:
        return [f"{where} sits beside the block {named}; a block sits beside the filter bar, the KPI row, the charts, a KPI, a "
                f"chart, a table or the decision list, so put it before or after the block {named}"]
    problems = []
    if block.get("width", "full") == "full":
        problems.append(f"{where} sits beside {named}, so its width is wide, half or narrow, not full")
    if block.get("align", "left") == "center":
        problems.append(f"{where} sits beside {named}: its align says the side, left or right, not center")
    return problems


def _chain_problems(blocks: list) -> list:
    follows = {str(b.get("id")): str(b["place"].get("of") or "") for b in blocks
               if isinstance(b.get("place"), dict) and b["place"].get("where") in ("before", "after")}
    problems, reported = [], set()
    for start in follows:
        seen, at = [start], follows[start]
        while at in follows and at not in seen:
            seen.append(at)
            at = follows[at]
        if at in seen and at not in reported:
            loop = seen[seen.index(at):]
            reported |= set(loop)
            problems.append(f"blocks {' then '.join(loop + [at])} place each other in a circle; put one of them by an element "
                            f"or at the page top or bottom")
    return problems


def blocks_problems(page: dict) -> list:
    blocks = page.get(BLOCKS)
    if blocks is None:
        return []
    if not isinstance(blocks, list) or any(not isinstance(b, dict) for b in blocks):
        return [f"the page {BLOCKS} must be a list of block objects, each {{{', '.join(BLOCK_FIELDS)}}}"]
    problems = _count_problem(BLOCKS, blocks)
    ids = _ids(blocks, "block", problems)
    anchors, kinds = _block_elements(page)
    check = {"text": markdown_problems, "html": html_problems, "image": image_problems}
    for block in blocks:
        ident = str(block.get("id") or "")
        where = f"block {ident}"
        extra = sorted(set(block) - set(BLOCK_FIELDS))
        if extra:
            problems.append(f"{where} has {', '.join(extra)}; a block takes {', '.join(BLOCK_FIELDS)}")
        if ident in anchors or ident in kinds:
            problems.append(f"{where} has the id of {anchors.get(ident) or 'a ' + kinds[ident][0]}; give the block an id of its own")
        if block.get("width", "full") not in BLOCK_WIDTHS:
            problems.append(f"{where} width must be one of {', '.join(BLOCK_WIDTHS)}")
        if block.get("align", "left") not in BLOCK_ALIGNS:
            problems.append(f"{where} align must be one of {', '.join(BLOCK_ALIGNS)}")
        problems += _place_problems(where, block, anchors, kinds, ids)
        if block.get("kind") not in check:
            problems.append(f"{where} kind must be one of {', '.join(BLOCK_KINDS)}")
            continue
        problems += check[block["kind"]](where, block.get("content"))
    return problems + _chain_problems(blocks)


def image_blocks(page) -> list:
    return [b for b in (page or {}).get(BLOCKS) or [] if isinstance(b, dict) and b.get("kind") == "image"
            and isinstance(b.get("content"), dict)] if isinstance(page, dict) else []


def block_plan(page: dict) -> dict:
    blocks = [b for b in (page or {}).get(BLOCKS) or [] if isinstance(b, dict) and b.get("id")]
    ids = {str(b["id"]) for b in blocks}
    near, roots = {"before": {}, "after": {}}, {}
    for block in blocks:
        place = block.get("place") if isinstance(block.get("place"), dict) else {}
        at, named = place.get("where"), str(place.get("of") or "")
        if at in ("before", "after") and named in ids and named != str(block["id"]):
            near[at].setdefault(named, []).append(block)
            continue
        if at in ("before", "after") and named:
            anchor, side = named, at
        elif at == "beside" and named and named not in ids:
            anchor, side = named, "right" if block.get("align") == "right" else "left"
        else:
            anchor, side = "@top" if at == "top" else "@bottom", "after"
        roots.setdefault(anchor, {"before": [], "after": [], "left": [], "right": []})[side].append(block)
    seen = set()

    def expand(items) -> list:
        out = []
        for block in items:
            if str(block["id"]) not in seen:
                seen.add(str(block["id"]))
                out += expand(near["before"].get(str(block["id"]), [])) + [block] + expand(near["after"].get(str(block["id"]), []))
        return out

    plan = {anchor: {side: expand(items) for side, items in sides.items()} for anchor, sides in roots.items()}
    left = [b for b in blocks if str(b["id"]) not in seen]
    if left:
        plan.setdefault("@bottom", {"before": [], "after": [], "left": [], "right": []})["after"] += left
    return plan


def public_blocks(page: dict) -> list:
    out = []
    for block in page.get(BLOCKS) or []:
        item = {k: block.get(k) for k in BLOCK_FIELDS[:5]}
        content = block.get("content")
        item["content"] = ({k: content.get(k) for k in ("file", "alt", "caption", "height")} if block.get("kind") == "image"
                           and isinstance(content, dict) else content)
        out.append(item)
    return out


def quality_problems(page: dict, event_date: bool = False) -> list:
    problems = []
    filters = [f for f in page.get("filters") or [] if isinstance(f, dict)]
    dates = [f for f in filters if f.get("type") == "date_range"]
    segments = [f for f in filters if f.get("type") == "multi_select"]
    if not dates:
        problems.append("the page has no date range filter; add one on the run date (as_of_date)")
    elif not any("as_of_date" in (f.get("columns") or {}).values() for f in dates):
        problems.append("no date range filters the run date (as_of_date) of the business output table")
    elif "as_of_date" not in (dates[0].get("columns") or {}).values():
        problems.append(f"the first date range ({dates[0].get('id')}) must be the run date (as_of_date): the page header and the KPIs show it")
    if event_date and len(dates) < 2:
        problems.append("an input table has a date column, so add a second date range on that event date")
    if len(segments) < SEGMENT_FILTERS_MIN:
        problems.append(f"the page has {plural(len(segments), 'segment filter')}; add at least {SEGMENT_FILTERS_MIN} people can slice by")
    covered = {d for f in filters for d in (f.get("columns") or {})}
    for kind, items in (("KPI", page.get("kpis") or []), ("chart", page.get("charts") or []), ("table", page.get("tables") or [])):
        for item in items:
            if item.get("dataset") and item["dataset"] not in covered:
                problems.append(f"no filter reaches {kind} {item.get('id')} (dataset {item['dataset']}), so the filters would not change it")
    for kpi in page.get("kpis") or []:
        for column in summed_ratio_columns(kpi.get("expression")):
            problems.append(f"KPI {kpi.get('id')} sums {column}, a ratio or an average; divide two sums instead")
    for chart in page.get("charts") or []:
        problems += _shape_problems(chart)
    if len(driver_charts(page)) < DRIVERS_MIN:
        problems.append(f"the page has no Drivers chart: set \"{DRIVER}\": true on at least {DRIVERS_MIN} chart that shows what "
                        "drives the result, such as where the listed records concentrate or the reasons that put them on the list")
    return problems


def driver_charts(page: dict) -> list:
    return [c for c in page.get("charts") or [] if isinstance(c, dict) and c.get(DRIVER) is True]


def and_words(titles) -> str:
    titles = [str(t) for t in titles if t]
    return "".join(titles) if len(titles) < 2 else f"{', '.join(titles[:-1])} and {titles[-1]}"


def reading_guide(steps) -> str:
    parts = []
    for verb, titles in steps:
        titles = [t for t in titles if t]
        if titles:
            more = " and the tiles beside them" if len(titles) > GUIDE_TITLES else ""
            parts.append(f"{verb} {and_words(titles[:GUIDE_TITLES])}{more}")
    return f"{GUIDE_PREFIX} {', '.join(parts)}." if parts else ""


def drivers_section(page: dict):
    driven = driver_charts(page)
    if not driven:
        return None
    return {"title": DRIVERS_TITLE, "charts": [c.get("id") for c in driven],
            "guide": f"What drives the result: {and_words([c.get('title') for c in driven])}. Each tile reads the use case's results and "
                     "answers to the filters above."}


def kind_problems(page: dict, kinds, skipped=()) -> tuple:
    drawn = {str(c.get("type")) for c in page.get("charts") or [] if isinstance(c, dict)}
    missing = [k for k in kinds if k in CHART_KIND_TYPES and not drawn & set(CHART_KIND_TYPES[k])]
    return ([f"the page draws no {CHART_KIND_LABELS[k].lower()} chart: add one of type {' or '.join(CHART_KIND_TYPES[k])}"
             for k in missing if k not in skipped], [k for k in missing if k in skipped])


def _shape_problems(chart: dict) -> list:
    where = f"chart {chart.get('id')}"
    kind, x = chart.get("type"), chart.get("x") or {}
    ys = chart.get("y") or []
    problems = []
    if x.get("kind") == "time" and kind not in TIME_CHARTS:
        problems.append(f"{where} plots time on x, so draw it as a line, area or bar, not a {kind}")
    if kind in ("line", "area", "stacked_area") and x.get("kind") != "time":
        problems.append(f"{where} is a {kind}, which reads as change over time; its x must be time")
    if kind in ADDITIVE_CHARTS:
        for y in ys:
            if not is_additive(y.get("expression")):
                problems.append(f"{where} is a {kind}, whose parts add up to a whole, so each measure must be one SUM or COUNT")
    for y in ys:
        for column in summed_ratio_columns(y.get("expression")):
            problems.append(f"{where} sums {column}, a ratio or an average; divide two sums instead")
    if kind == "pareto" and chart.get("sort", "value_desc") != "value_desc":
        problems.append(f"{where} is a pareto, so it sorts by value, largest first")
    if kind in ("bar", "horizontal_bar") and x.get("kind") == "category" and chart.get("sort") == "x_asc" and not x.get("ordered"):
        problems.append(f"{where} ranks categories, so sort by value unless x has a natural order (set x.ordered)")
    if kind == "donut" and len(ys) != 1:
        problems.append(f"{where} is a donut, so it shows one measure")
    if kind in ("heatmap", "pareto") and len(ys) != 1:
        problems.append(f"{where} is a {kind}, so it shows one measure")
    return problems


def _date(value) -> datetime.date:
    text = str(value or "")
    try:
        if _DATE.match(text):
            return datetime.date.fromisoformat(text)
    except ValueError:
        pass
    raise ValueError(f"{value!r} is not a YYYY-MM-DD date")


def add_months(day: datetime.date, months: int) -> datetime.date:
    total = day.year * 12 + day.month - 1 + months
    year, month = divmod(total, 12)
    month += 1
    last = (datetime.date(year + (month == 12), month % 12 + 1, 1) - datetime.timedelta(days=1)).day
    return datetime.date(year, month, min(day.day, last))


def preset_ranges(grain: str, low, high) -> list:
    if low is None or high is None:
        return []
    first, last = _date(str(low)[:10]), _date(str(high)[:10])
    out = []
    for ident, label, months in PRESETS:
        if months is None:
            start = first
        elif grain == "month":
            start = add_months(last.replace(day=1), -(months - 1))
        else:
            start = add_months(last, -months) + datetime.timedelta(days=1)
        out.append({"id": ident, "label": label, "from": max(start, first).isoformat(), "to": last.isoformat()})
    return out


def filter_values_problems(page: dict, values) -> list:
    if values is None:
        return []
    if not isinstance(values, dict):
        return ["filters must be an object of filter id to value"]
    known = {f.get("id"): f for f in page.get("filters") or []}
    problems = []
    for key, value in values.items():
        f = known.get(key)
        if f is None:
            problems.append(f"the page has no filter {key!r}")
        elif value not in (None, [], {}):
            problems += _value_problems(f.get("type"), f"filter {key}", value)
    return problems


def column_values_problems(filters: list, values, where: str) -> list:
    if values is None:
        return []
    if not isinstance(values, dict):
        return [f"{where} column filters must be an object of column to value"]
    known = {f["column"]: f for f in filters}
    problems = []
    for key, value in values.items():
        f = known.get(key)
        if f is None:
            listed = f"; its column filters: {', '.join(known)}" if known else "; it has no column filters"
            problems.append(f"{where} has no column filter {key!r}{listed}")
        elif value not in (None, [], {}):
            problems += _value_problems(f["type"], f"{where} column filter {key}", value, open_ends=True)
    return problems


def table_values_problems(page: dict, tables) -> list:
    if tables is None:
        return []
    if not isinstance(tables, dict):
        return ["table_filters must be an object of table id to its column filters"]
    known = {t.get("id"): t for t in page.get("tables") or []}
    problems = []
    for ident, values in tables.items():
        if ident not in known:
            problems.append(f"the page has no table {ident!r}")
        else:
            problems += column_values_problems(table_column_filters(known[ident]), values, f"table {ident}")
    return problems


def _edge(kind: str, value):
    if value is None or value == "":
        return None
    if kind == "date_range":
        return _date(value).isoformat()
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) >= CAPS["range_number"]:
        raise ValueError(f"{value!r} is not a number")
    return float(value)


def _value_problems(kind, where: str, value, open_ends: bool = False) -> list:
    if kind in RANGE_EDGES:
        low, high = RANGE_EDGES[kind]
        what = "dates" if kind == "date_range" else "numbers"
        if not isinstance(value, dict):
            return [f"{where} takes {low} and {high} {what}"]
        if not open_ends:
            try:
                _date(value.get(low))
                _date(value.get(high))
            except ValueError as error:
                return [f"{where}: {error}"]
            return []
        unknown = sorted(set(value) - {low, high})
        if unknown:
            return [f"{where} takes {low} and {high} {what}, not {', '.join(map(str, unknown))}"]
        try:
            start, end = _edge(kind, value.get(low)), _edge(kind, value.get(high))
        except ValueError as error:
            return [f"{where}: {error}"]
        if start is not None and end is not None and start > end:
            return [f"{where} runs from {value[low]} to {value[high]}; its {low} must not be above its {high}"]
        return []
    if not isinstance(value, list) or len(value) > CAPS["values"]:
        return [f"{where} takes a list of at most {CAPS['values']} values"]
    if any(not isinstance(v, str) or len(v) > CAPS["value_chars"] for v in value):
        return [f"{where} values must be text of at most {CAPS['value_chars']} characters"]
    return []


class _Params:
    def __init__(self):
        self.items = []

    def add(self, value, kind: str = "STRING") -> str:
        name = f"p{len(self.items)}"
        self.items.append({"name": name, "value": value, "type": kind})
        return f":{name}"


def literal(value) -> str:
    return "'" + str("" if value is None else value).replace("\\", "\\\\").replace("'", "\\'") + "'"


class _Literals:
    def add(self, value, kind: str = "STRING") -> str:
        return literal(value)


def _where(page: dict, dataset: str, values: dict, params: _Params) -> str:
    conditions = _conditions(page, dataset, values, params)
    return f" WHERE {' AND '.join(conditions)}" if conditions else ""


def _conditions(page: dict, dataset: str, values: dict, params) -> list:
    conditions = []
    for f in page.get("filters") or []:
        column = (f.get("columns") or {}).get(dataset)
        value = (values or {}).get(f.get("id"))
        if not column or value in (None, [], {}):
            continue
        conditions += _condition(f.get("type"), quote(column), value, params)
    return conditions


def _condition(kind, target: str, value, params) -> list:
    if kind not in RANGE_EDGES:
        return [f"CAST({target} AS STRING) IN ({', '.join(params.add(str(v)) for v in value)})"]
    low, high = (value.get(edge) for edge in RANGE_EDGES[kind])
    cast = "DATE" if kind == "date_range" else "DOUBLE"
    shown = str if kind == "date_range" else (lambda v: repr(float(v)))
    if kind == "date_range" and low and high:
        start, end = sorted((str(low), str(high)))
        return [f"CAST({target} AS DATE) BETWEEN {params.add(start, 'DATE')} AND {params.add(end, 'DATE')}"]
    if low not in (None, "") and high not in (None, ""):
        return [f"CAST({target} AS {cast}) BETWEEN {params.add(shown(low), cast)} AND {params.add(shown(high), cast)}"]
    if low not in (None, ""):
        return [f"CAST({target} AS {cast}) >= {params.add(shown(low), cast)}"]
    if high not in (None, ""):
        return [f"CAST({target} AS {cast}) <= {params.add(shown(high), cast)}"]
    return []


def column_conditions(filters: list, values, params, targets=None) -> list:
    conditions = []
    for f in filters:
        value = (values or {}).get(f["column"])
        if value not in (None, [], {}):
            conditions += _condition(f["type"], (targets or {}).get(f["column"]) or quote(f["column"]), value, params)
    return conditions


def _dataset(page: dict, name: str) -> str:
    for dataset in page.get("datasets") or []:
        if dataset.get("name") == name:
            return clean_sql(dataset.get("sql"))
    raise KeyError(f"the page has no dataset {name}")


def _item(page: dict, key: str, ident: str) -> dict:
    for item in page.get(key) or []:
        if item.get("id") == ident:
            return item
    raise KeyError(f"the page has no {key[:-1]} {ident}")


def kpi_query(page: dict, ident: str, values: dict, previous: str = None) -> tuple:
    kpi = _item(page, "kpis", ident)
    sql, params = _dataset(page, kpi["dataset"]), _Params()
    where = _where(page, kpi["dataset"], values, params)
    text = f"SELECT 'now' AS period, {kpi['expression']} AS value FROM ({sql}) AS d{where}"
    if kpi.get("compare") and previous:
        text += f" UNION ALL SELECT 'before' AS period, {previous_value(kpi['expression'])} AS value FROM ({previous}) AS d{where}"
    return f"{text} LIMIT {CAPS['kpi_rows']}", params.items


def chart_query(page: dict, ident: str, values: dict) -> tuple:
    chart = _item(page, "charts", ident)
    sql, params = _dataset(page, chart["dataset"]), _Params()
    where = _where(page, chart["dataset"], values, params)
    ys = ", ".join(f"{y['expression']} AS y{i}" for i, y in enumerate(chart["y"]))
    if chart["type"] == "scatter":
        group = quote(chart["group"])
        text = (f"SELECT CAST({group} AS STRING) AS x_label, {chart['x']['expression']} AS x, {ys} FROM ({sql}) AS d{where} "
                f"GROUP BY {group} LIMIT {int(chart.get('limit', 200))}")
        return text, params.items
    x = quote(chart["x"]["column"])
    series = chart.get("series")
    keys = f"{x} AS x" + (f", CAST({quote(series['column'])} AS STRING) AS s" if series else "")
    group = x + (f", {quote(series['column'])}" if series else "")
    if chart["type"] == "pareto":
        text = (f"SELECT x, y0, SUM(y0) OVER () AS total FROM (SELECT {keys}, {ys} FROM ({sql}) AS d{where} GROUP BY {group}) AS g "
                f"ORDER BY y0 DESC NULLS LAST LIMIT {int(chart.get('limit', 25))}")
        return text, params.items
    if chart["x"].get("kind") == "time" or chart.get("sort") == "x_asc" or series:
        order, limit = "1 ASC", CAPS["chart_rows"]
    else:
        order = "2 DESC NULLS LAST" if chart.get("sort", "value_desc") == "value_desc" else "2 ASC NULLS LAST"
        limit = int(chart.get("limit", 25))
    text = f"SELECT {keys}, {ys} FROM ({sql}) AS d{where} GROUP BY {group} ORDER BY {order} LIMIT {limit}"
    return text, params.items


def table_query(page: dict, ident: str, values: dict, columns=None) -> tuple:
    table = _item(page, "tables", ident)
    sql, params = _dataset(page, table["dataset"]), _Params()
    picked = ", ".join(quote(c["column"]) for c in table["columns"])
    sort = table.get("sort") or {}
    order = f" ORDER BY {quote(sort['column'])} {'DESC' if sort.get('desc', True) else 'ASC'} NULLS LAST" if sort.get("column") else ""
    limit = min(int(table.get("limit", CAPS["table_rows"])), CAPS["table_rows"])
    conditions = _conditions(page, table["dataset"], values, params) + column_conditions(table_column_filters(table), columns, params)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    return f"SELECT {picked} FROM ({sql}) AS d{where}{order} LIMIT {limit}", params.items


def records_sql(table: str) -> str:
    return f"SELECT * FROM {table_name(table)} WHERE {CURRENT_ROWS}"


def records_query(page: dict, values: dict) -> tuple:
    sql, params = _dataset(page, RECORDS_DATASET), _Params()
    rank = quote((page.get("records") or {}).get("rank") or "rank")
    where = _where(page, RECORDS_DATASET, values, params)
    return f"SELECT * FROM ({sql}) AS d{where} ORDER BY {rank} ASC NULLS LAST LIMIT {CAPS['records_rows']}", params.items


def alert_query(measure: str, operator: str, threshold, basis: str = "fixed", source: str = "", conditions=(), table: str = "", columns=(),
                name: str = ALERT_WATCHED, extra=(), condition: str = "", hold: str = "", threshold_sql: str = "", history=None,
                scopes=False, scope_sql: str = "") -> dict:
    if operator not in ALERT_OPERATORS:
        raise ValueError(f"an alert compares with one of {', '.join(ALERT_OPERATORS)}, not {operator!r}")
    if basis not in ALERT_BASES:
        raise ValueError(f"an alert threshold is fixed or a baseline of earlier runs, not {basis!r}")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold):
        raise ValueError(f"an alert threshold is a number, not {threshold!r}")
    baseline = basis == "baseline"
    if baseline and operator not in ALERT_BASELINE_DIRECTIONS:
        raise ValueError(f"a baseline fires on a rise or a fall against earlier runs, so compare with one of "
                         f"{' '.join(ALERT_BASELINE_DIRECTIONS)}, not {operator}")
    if not str(source or "").strip():
        raise ValueError("an alert reads one dataset, the one its KPI or its decision list reads")
    if baseline and not (table and columns and reads_table(source, table)):
        raise ValueError("a baseline reads each earlier run as it left the result table, so its dataset must read the result table, "
                         "whose columns Inspire must read")
    split = run_split_problem(measure) if baseline else ""
    if split:
        raise ValueError(f"an alert compared with earlier runs reads each run on its own, but {split}, or use a fixed number")
    for label in [name] + [alias for _expression, alias in extra]:
        quote(label)
    number = float(threshold)
    tail = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    labels, backs = [name] + [alias for _expression, alias in extra], range(1, ALERT_BASELINE_RUNS + 1)
    if baseline:
        measured = ", ".join([f"{run_measure(measure, RUN_LATEST)} AS {name}"]
                             + [f"{run_measure(expression, RUN_LATEST)} AS {alias}" for expression, alias in extra]
                             + [f"{previous_run_measure(measure, back)} AS v{back}" for back in backs])
        base = (f"WITH runs AS (SELECT * FROM ({runs_compare_sql(source, table, columns, range(ALERT_BASELINE_RUNS + 1), history, scopes)}) "
                f"AS d{tail}),\n"
                f"{name} AS (SELECT {measured} FROM runs)")
    else:
        measured = ", ".join([f"{measure} AS {name}"] + [f"{expression} AS {alias}" for expression, alias in extra])
        base = f"WITH latest AS (SELECT * FROM ({source}) AS d{tail}),\n{name} AS (SELECT {measured} FROM latest)"
    user = re.sub(r"--[^\n]*", " ", str(condition or "")).strip().rstrip(";").strip()
    held = str(hold or "").strip()
    scoped = {"scoped": True} if scope_sql else {}
    scope_shown = [f"{scope_sql} AS {SCOPE_COLUMN}"] if scope_sql else []
    if not user and not baseline and not held and not threshold_sql:
        return dict({"query": f"{base}\nSELECT {', '.join(labels + scope_shown)} FROM {name}", "column": name,
                     "operator": ALERT_OPERATORS[operator], "threshold": number}, **scoped)
    limit = f"({threshold_sql})" if threshold_sql else repr(number)
    rule, shown, joins, read = f"t.{name} {operator} {limit}", [f"t.{label}" for label in labels], "", name
    if threshold_sql and not baseline:
        shown.append(f"{limit} AS alert_threshold")
    if baseline:
        sign = ALERT_BASELINE_DIRECTIONS[operator]
        band = f"t.baseline_mean {sign} {ALERT_BASELINE_SIGMAS} * t.baseline_sd"
        enough = f"t.history_runs >= {ALERT_BASELINE_MIN_RUNS}"
        value, kept = "`_inspire_value`", labels + ["v1"]
        base += (f",\nhistory AS (SELECT {', '.join(f't.{column}' for column in kept)}, CASE k.n "
                 f"{' '.join(f'WHEN {back} THEN t.v{back}' for back in backs)} END AS {value} FROM {name} t CROSS JOIN "
                 f"({' UNION ALL '.join(f'SELECT {back} AS n' for back in backs)}) AS k),\n"
                 f"baseline AS (SELECT {', '.join(f'MAX({column}) AS {column}' for column in kept)}, COUNT({value}) AS history_runs, "
                 f"AVG({value}) AS baseline_mean, COALESCE(STDDEV_SAMP({value}), 0) AS baseline_sd FROM history)")
        rule = f"CASE WHEN {enough} THEN t.{name} {'>' if sign == '+' else '<'} {band} ELSE {rule} END"
        shown += ["t.history_runs", "ROUND(t.baseline_mean, 2) AS baseline_mean", "ROUND(t.baseline_sd, 2) AS baseline_sd",
                  f"CASE WHEN {enough} THEN ROUND({band}, 2) ELSE {limit} END AS alert_threshold",
                  f"CASE WHEN {enough} THEN 'baseline' ELSE 'fixed' END AS threshold_basis", f"t.v1 AS {ALERT_PREVIOUS}"]
        read = "baseline"
    if user:
        base += f",\nuser_condition AS (\n{user}\n)"
        rule += " OR COALESCE(c.triggered, FALSE)"
        shown.append("COALESCE(c.triggered, FALSE) AS condition_met")
        joins += " LEFT JOIN (SELECT triggered FROM user_condition LIMIT 1) c ON TRUE"
    if held:
        rule = f"({rule}) AND NOT COALESCE(({held}), FALSE)"
        shown.append(f"COALESCE(({held}), FALSE) AS {ALERT_HELD}")
    return dict({"query": f"{base}\nSELECT CASE WHEN {rule} THEN 1 ELSE 0 END AS {ALERT_FIRED}, {', '.join(shown + scope_shown)} FROM "
                          f"{read} t{joins}", "column": ALERT_FIRED, "operator": ALERT_OPERATORS[">="], "threshold": 1.0}, **scoped)


def watch_measures(page: dict) -> list:
    listed = ([{"id": ALERT_RECORDS, "label": ALERT_RECORDS_LABEL, "dataset": RECORDS_DATASET, "expression": "COUNT(*)", "format": "integer",
                "currency": ""}] if page.get("records") else [])
    return listed + [{"id": k["id"], "label": k.get("label") or k["id"], "dataset": k["dataset"], "expression": k["expression"],
                      "format": k.get("format") or "number", "currency": k.get("currency") or ""} for k in page.get("kpis") or []]


def watch_query(page: dict, watch: dict, names=(), history=None) -> dict:
    what, values = watch.get("what"), watch.get("filters") or {}
    measured = next((m for m in watch_measures(page) if m["id"] == what), None)
    if measured is None:
        raise ValueError(f"the page has no {'decision list' if what == ALERT_RECORDS else f'KPI {what!r}'} to watch")
    dataset, measure, label = measured["dataset"], measured["expression"], measured["label"]
    problems = filter_values_problems(page, values)
    if problems:
        raise ValueError("; ".join(problems))
    picked = [f for f in page.get("filters") or [] if values.get(f.get("id"))]
    for f in picked:
        if f.get("type") != "multi_select":
            raise ValueError(f"an alert keeps checking as new runs arrive, so it filters on segments, not on the dates of {f.get('label')}")
        if dataset not in (f.get("columns") or {}):
            raise ValueError(f"the filter {f.get('label')} does not reach {label}, so it cannot narrow this alert")
    operator, threshold, basis = watch.get("operator"), watch.get("threshold"), watch.get("basis") or "fixed"
    source, conditions = _dataset(page, dataset), _conditions(page, dataset, values, _Literals())
    scope_sql = scope_line_sql(page["result_table"], str(page.get("use_case_id") or "")) if page_scopes(page) and page.get("result_table") else ""
    if basis != "baseline":
        return alert_query(measure, operator, threshold, basis, source=source, conditions=conditions, scope_sql=scope_sql)
    problem = baseline_problem(page, measured, names)
    if problem:
        raise ValueError(problem)
    return alert_query(measure, operator, threshold, basis, source=source, conditions=conditions, table=page["result_table"],
                       columns=list(names), history=history, scopes=page_scopes(page), scope_sql=scope_sql)


def baseline_problem(page: dict, measured: dict, columns) -> str:
    label, table = measured["label"], page.get("result_table")
    if not table:
        return "this page names no result table, so it has no earlier runs to compare with; use a fixed number"
    if not columns:
        return (f"Inspire could not read the columns of the result table {table}, so {label} cannot be compared with earlier runs; "
                "use a fixed number")
    if not reads_table(_dataset(page, measured["dataset"]), table):
        return (f"{label} reads dataset {measured['dataset']}, which does not read the result table {table}, the one table that keeps "
                f"earlier runs; use a fixed number")
    shape = runs_problem(_dataset(page, measured["dataset"]), table)
    if shape:
        return f"{label} reads dataset {measured['dataset']}, which cannot be read run by run: {shape}; use a fixed number"
    split = run_split_problem(measured["expression"])
    return f"{label} is compared with earlier runs, but {split}, or use a fixed number" if split else ""


def assigned_query(table: str, owner: str, hour_end: str = "date_trunc('HOUR', current_timestamp())") -> dict:
    target, who = table_name(table), literal(str(owner).strip().lower())
    query = (f"WITH owned AS (SELECT `record_key` FROM {target} WHERE `is_current` AND `change_source` <> 'delete' AND "
             f"lower(`action_owner`) = {who}),\n"
             f"versions AS (SELECT `record_key`, `change_source`, `action_owner`, `changed_by`, `valid_from`, LAG(`action_owner`) OVER "
             f"(PARTITION BY `record_key` ORDER BY `valid_from`) AS `was` FROM {target} WHERE `record_key` IN (SELECT `record_key` FROM owned))\n"
             f"SELECT COUNT(DISTINCT `record_key`) AS assigned FROM versions WHERE `change_source` = 'action' AND lower(`action_owner`) = "
             f"{who} AND NOT (lower(`was`) <=> {who}) AND NOT (lower(`changed_by`) <=> {who}) AND `valid_from` >= {hour_end} - INTERVAL 1 "
             f"HOUR AND `valid_from` < {hour_end}")
    return {"query": query, "column": "assigned", "operator": ALERT_OPERATORS[">"], "threshold": 0.0}


def contains_pattern(text: str) -> str:
    return "%" + re.sub(r"([!%_])", rf"{LIKE_ESCAPE}\1", str(text)) + "%"


def _choice_query(page: dict, sources, search: str, limit: int) -> tuple:
    params = _Params()
    parts = [f"SELECT DISTINCT CAST({quote(column)} AS STRING) AS v FROM ({_dataset(page, dataset)}) AS d" for dataset, column in sources]
    match = f" AND v ILIKE {params.add(contains_pattern(search))} ESCAPE '{LIKE_ESCAPE}'" if search else ""
    return f"SELECT v FROM ({' UNION '.join(parts)}) AS o WHERE v IS NOT NULL{match} ORDER BY v LIMIT {int(limit)}", params.items


def options_query(page: dict, ident: str, search: str = "", limit: int = CAPS["options"]) -> tuple:
    return _choice_query(page, _item(page, "filters", ident)["columns"].items(), search, limit)


def column_filter(page: dict, table, column: str, kind: str = "") -> tuple:
    if table is None:
        dataset, filters, where = RECORDS_DATASET, list_column_filters(page), "the decision list"
    else:
        item = _item(page, "tables", table)
        dataset, filters, where = item["dataset"], table_column_filters(item), f"table {table}"
    found = next((f for f in filters if f["column"] == column and (not kind or f["type"] == kind)), None)
    if found is None:
        raise KeyError(f"{where} has no {'choice ' if kind == 'multi_select' else ''}column filter {column!r}")
    return dataset, found


def column_options_query(page: dict, table, column: str, search: str = "", limit: int = CAPS["options"]) -> tuple:
    dataset, _found = column_filter(page, table, column, "multi_select")
    return _choice_query(page, [(dataset, column)], search, limit)


def bounds_query(page: dict, ident: str) -> tuple:
    f = _item(page, "filters", ident)
    parts = [f"SELECT CAST({quote(column)} AS DATE) AS v FROM ({_dataset(page, dataset)}) AS d" for dataset, column in f["columns"].items()]
    return f"SELECT MIN(v) AS low, MAX(v) AS high FROM ({' UNION ALL '.join(parts)}) AS b", []


def default_values(page: dict, bounds: dict) -> dict:
    values = {}
    for f in page.get("filters") or []:
        if f.get("type") != "date_range":
            continue
        low, high = (bounds or {}).get(f["id"], (None, None))
        choice = next((p for p in preset_ranges(f.get("grain", "month"), low, high) if p["id"] == f.get("default", "12m")), None)
        if choice and choice["id"] != "all":
            values[f["id"]] = {"from": choice["from"], "to": choice["to"]}
    return values


def page_queries(page: dict, values: dict, tables=None, previous=None) -> list:
    out = [("kpi", k["id"]) + kpi_query(page, k["id"], values, (previous or {}).get(k["dataset"])) for k in page.get("kpis") or []]
    out += [("chart", c["id"]) + chart_query(page, c["id"], values) for c in page.get("charts") or []]
    out += [("table", t["id"]) + table_query(page, t["id"], values, (tables or {}).get(t["id"])) for t in page.get("tables") or []]
    return out


def schema_query(table: str) -> tuple:
    return f"SELECT * FROM {table_name(table)} LIMIT 0", []


def dataset_columns_query(page: dict, name: str) -> tuple:
    return f"SELECT * FROM ({_dataset(page, name)}) AS d LIMIT 0", []


def list_columns(page: dict) -> list:
    records = page.get("records") or {}
    names = [records.get(k) for k in ("rank", "label", "tier", "key", "sublabel")] + [c.get("column") for c in records.get("columns") or []]
    return list(dict.fromkeys(n for n in names if n))


def unjoined_reason(page: dict, columns, fields) -> str:
    if not page.get("result_table"):
        return "the page names no result table"
    if fields is None:
        return "the App could not read the result table's columns"
    return f"the decision list selects neither record_key nor its key {(page.get('records') or {}).get('key')} from the result table"


def list_context(page: dict, columns, fields, decisions: bool) -> dict:
    records = page.get("records") or {}
    names = {f["name"] for f in fields or []}
    key = records.get("key")
    versioned = bool(page.get("result_table")) and fields is not None
    join = "record_key" if versioned and "record_key" in columns else key if versioned and key in columns and key in names else None
    ai = ([n for n in AI_LISTED if n in names] + sorted(n for n in names if AI_CATEGORY.match(n))) if join else []
    return {"table": table_name(page["result_table"]) if join else None, "join": join, "held": bool(join and "held_back" in names),
            "actions": bool(join and decisions), "changes": bool(join),
            "tier": records.get("tier") if records.get("tier") in names else None,
            "tie": "record_key" if "record_key" in columns else key, "ai": ai,
            "categories": [n for n in ai if AI_CATEGORY.match(n)],
            "scopes": table_name(str(page["result_table"]).strip() + SUMMARY_SUFFIX) if join and page_scopes(page) else None,
            "unjoined": "" if join else unjoined_reason(page, columns, fields)}


def ai_alias(name: str) -> str:
    return f"_inspire_{name}"


@functools.lru_cache(maxsize=1)
def zone_data() -> bool:
    return bool(zoneinfo.available_timezones())


def time_zone_of(data: dict) -> tuple:
    name = data.get("time_zone")
    if name is None or name == "":
        return datetime.timezone.utc, "UTC", False
    if not isinstance(name, str) or not ZONE_NAME.match(name):
        raise ValueError("time_zone takes the name of a time zone, such as Asia/Dubai")
    try:
        return zoneinfo.ZoneInfo(name), name, True
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        if not zone_data():
            return datetime.timezone.utc, "UTC", False
        raise ValueError(f"time_zone {name} is not a time zone the App knows; send its name, such as Asia/Dubai") from None


def window_params(data: dict, now: datetime.datetime):
    window, top, offset = data.get("window"), data.get("window_limit"), data.get("utc_offset_min", 0)
    zone, _name, zoned = time_zone_of(data)
    if window is None:
        if top is not None:
            raise ValueError("window_limit goes with a window: send window as one of " + ", ".join(WINDOWS))
        return None
    if window not in WINDOWS:
        raise ValueError(f"window must be one of {', '.join(WINDOWS)}")
    if top is not None and not _whole(top, 1, CAPS["window_limit"]):
        raise ValueError(f"window_limit must be a whole number from 1 to {CAPS['window_limit']}")
    if not _whole(offset, -CAPS["utc_offset_min"], CAPS["utc_offset_min"]):
        raise ValueError(f"utc_offset_min must be a whole number of minutes from -{CAPS['utc_offset_min']} to {CAPS['utc_offset_min']}")
    return dict(window_bounds(window, now, offset, zone if zoned else None), limit=top)


class Refusal(ValueError):
    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def window_request(data: dict, context: dict, now: datetime.datetime):
    window = window_params(data, now)
    if window and not context["actions"]:
        raise Refusal("this decision list keeps no actions, so it has no window of actions to show", NO_WINDOW)
    return window


def window_bounds(window: str, now: datetime.datetime, offset_min: int = 0, zone=None) -> dict:
    zone = zone or datetime.timezone(datetime.timedelta(minutes=offset_min))
    local = (now if now.tzinfo else now.replace(tzinfo=datetime.timezone.utc)).astimezone(zone).replace(tzinfo=None)
    today = local.date()
    out = {"window": window, "today": today.isoformat()}
    if window == "all":
        return out
    midnight = datetime.datetime.combine(today, datetime.time())
    if window == "hour":
        start = local.replace(minute=0, second=0, microsecond=0)
        end, first, last = start + datetime.timedelta(hours=1), today, today + datetime.timedelta(days=1)
    elif window == "today":
        start, end = midnight, midnight + datetime.timedelta(days=1)
    elif window == "week":
        start = midnight - datetime.timedelta(days=today.weekday())
        end = start + datetime.timedelta(days=7)
    else:
        start = midnight.replace(day=1)
        end = datetime.datetime.combine(add_months(today.replace(day=1), 1), datetime.time())
    if window != "hour":
        first, last = start.date(), end.date()
    micros = lambda stamp: (stamp.replace(tzinfo=zone) - EPOCH) // datetime.timedelta(microseconds=1)
    return dict(out, start_day=first.isoformat(), end_day=last.isoformat(), start_us=micros(start), end_us=micros(end))


WINDOW_EXTRA = ("CAST(`action_due` AS DATE) AS `_inspire_due`", f"CAST(`{SNOOZE_COLUMN}` AS DATE) AS `_inspire_snooze`",
                f"`{JOINED_COLUMN}` AS `_inspire_joined`")
WINDOW_PICKED = ("c.`_inspire_due`", "c.`_inspire_snooze`", "c.`_inspire_joined`")


def window_conditions(bounds: dict, params, held: bool, today: str) -> list:
    opened = ", ".join(f"'{s}'" for s in OPEN_STATUSES)
    out = [f"COALESCE(c.`_inspire_status`, 'New') IN ({opened})", f"(c.`_inspire_snooze` IS NULL OR c.`_inspire_snooze` <= {today})"]
    if held:
        out.append("NOT COALESCE(c.`_inspire_held`, FALSE)")
    if bounds["window"] != "all":
        first, last = params.add(bounds["start_day"], "DATE"), params.add(bounds["end_day"], "DATE")
        start, end = params.add(str(bounds["start_us"]), "BIGINT"), params.add(str(bounds["end_us"]), "BIGINT")
        out.append(f"(c.`_inspire_due` < {today} OR (c.`_inspire_due` >= {first} AND c.`_inspire_due` < {last}) OR "
                   f"(c.`_inspire_due` IS NULL AND unix_micros(c.`_inspire_joined`) >= {start} AND "
                   f"unix_micros(c.`_inspire_joined`) < {end}))")
    return out


def window_order(stake: str, due: str, today: str, tie: str) -> str:
    return (f"{stake} DESC NULLS LAST, CASE WHEN {due} < {today} THEN 0 ELSE 1 END ASC, {due} ASC NULLS LAST"
            + (f", {tie} ASC" if tie else ""))


def list_request(page: dict, data: dict, context: dict, now: datetime.datetime = None) -> dict:
    sort = data.get("sort") or {}
    if not isinstance(sort, dict):
        raise ValueError("sort takes an object with a key and a dir")
    window = window_request(data, context, now or datetime.datetime.now(datetime.timezone.utc))
    exclude = data.get("exclude") or []
    if not isinstance(exclude, list) or len(exclude) > CAPS["exclude_keys"] or not all(
            isinstance(k, str) and 0 < len(k) <= 512 for k in exclude):
        raise ValueError(f"exclude takes a list of at most {CAPS['exclude_keys']} record keys")
    if exclude and not context["join"]:
        raise ValueError("this decision list is not joined to the result table, so it cannot leave out records by key")
    allowed = list_columns(page) + (list(ACTION_SORTS) if context["actions"] else [])
    ranked = bool(window) and not sort
    return dict(_list_request(page, data, context, allowed), window=window, ranked=ranked, exclude=list(dict.fromkeys(exclude)))


def _list_request(page: dict, data: dict, context: dict, allowed: list) -> dict:
    sort = data.get("sort") or {}
    key = sort.get("key") or (page.get("records") or {}).get("rank")
    if not isinstance(key, str) or key not in allowed:
        raise ValueError(f"the decision list cannot sort by {key!r}; sort by one of its columns: {', '.join(allowed)}")
    direction = sort.get("dir") or "asc"
    if direction not in LIST_DIRS:
        raise ValueError("sort dir must be asc or desc")
    offset, limit = data.get("offset", 0), data.get("limit", 25)
    if not _whole(offset, 0, CAPS["list_offset"]):
        raise ValueError(f"offset must be a whole number from 0 to {CAPS['list_offset']}")
    if not _whole(limit, 1, CAPS["list_rows"]):
        raise ValueError(f"limit must be a whole number from 1 to {CAPS['list_rows']}")
    search = data.get("search") or ""
    if not isinstance(search, str) or len(search) > CAPS["search_chars"]:
        raise ValueError(f"search for text of at most {CAPS['search_chars']} characters")
    mine, changed = data.get("mine", False), data.get("changed", False)
    if not isinstance(mine, bool) or not isinstance(changed, bool):
        raise ValueError("mine and changed take true or false")
    if mine and not context["actions"]:
        raise ValueError("this decision list keeps no action owners, so it cannot show your actions")
    if changed and not context["changes"]:
        raise ValueError("this decision list keeps no runs to compare, so it cannot show what changed since the last run")
    return {"sort": key, "dir": direction, "offset": offset, "limit": limit, "search": search.strip(), "mine": mine, "changed": changed,
            "ai": ai_request(data.get("ai"), context), "columns": data.get(COLUMN_FILTERS) or {}, "cursor": list_cursor_value(data.get("cursor"))}


def _cursor_cell(value) -> bool:
    return value is None or (isinstance(value, (str, int, float, bool)) and len(str(value)) <= CAPS["field_chars"])


def list_cursor_value(cursor):
    if cursor in (None, {}):
        return None
    if (not isinstance(cursor, dict) or cursor.get("dir") not in CURSOR_DIRS or not _cursor_cell(cursor.get("value"))
            or cursor.get("key") is None or not _cursor_cell(cursor.get("key"))):
        raise ValueError("cursor takes the dir (next or prev) and the value and key of the row the page starts from")
    return {"dir": cursor["dir"], "value": cursor.get("value"), "key": cursor["key"]}


def list_cursor_fields(request: dict, context: dict) -> dict:
    money_sort = request["sort"] == MONEY_COLUMN and bool(context.get("money"))
    field = ACTION_SORTS.get(request["sort"], MONEY_SORT if money_sort else request["sort"])
    kinds = context.get("types") or {}
    kind = "DOUBLE" if field == MONEY_SORT else "STRING" if field in ACTION_SORTS.values() else kinds.get(field)
    tie = context["tie"]
    usable = kind in KEYSET_TYPES and (tie == request["sort"] or kinds.get(tie) in KEYSET_TYPES)
    return {"sort": field, "kind": kind, "tie": tie, "tie_kind": kinds.get(tie), "keyset": usable}


def _keyset(request: dict, fields: dict, params) -> tuple:
    cursor = request.get("cursor")
    if not cursor or not fields["keyset"] or not request["offset"]:
        return "", ""
    sort, tie, unique = quote(fields["sort"]), quote(fields["tie"]), fields["tie"] == request["sort"]
    after, descending = cursor["dir"] == "next", request["dir"] == "desc"
    key = f"CAST({params.add(str(cursor['key']))} AS {SQL_TYPES[fields['kind'] if unique else fields['tie_kind']]})"
    tie_step = ">" if after else "<"
    if cursor["value"] is None:
        held = f"({sort} IS NULL AND {tie} {tie_step} {key})" if not unique else "FALSE"
        found = held if after else f"({sort} IS NOT NULL OR {held})"
    else:
        value = f"CAST({params.add(str(cursor['value']).lower() if isinstance(cursor['value'], bool) else str(cursor['value']))} AS {SQL_TYPES[fields['kind']]})"
        step = ">" if after != descending else "<"
        found = f"({sort} {step} {value}" + ("" if unique else f" OR ({sort} = {value} AND {tie} {tie_step} {key})") + (f" OR {sort} IS NULL" if after else "") + ")"
    if after:
        return f" WHERE {found}", ""
    back = f"{sort} {'ASC' if descending else 'DESC'} NULLS FIRST" + ("" if unique else f", {tie} DESC")
    return f" WHERE {found}", back


def ai_request(picked, context: dict) -> dict:
    if picked in (None, {}):
        return {}
    if not isinstance(picked, dict):
        raise ValueError("ai takes an object of AI categories, each with the values to show")
    out = {}
    for name, values in picked.items():
        if name not in context["categories"]:
            known = ", ".join(context["categories"]) or "none"
            why = f", since it reads no AI reasoning from the result table: {context['unjoined']}" if context.get("unjoined") else ""
            raise ValueError(f"the decision list has no AI category {name!r}; its AI categories: {known}{why}")
        if not isinstance(values, list) or len(values) > CAPS["values"] or not all(
                isinstance(v, str) and 0 < len(v) <= CAPS["value_chars"] for v in values):
            raise ValueError(f"{name} takes a list of at most {CAPS['values']} values of 1 to {CAPS['value_chars']} characters")
        if values:
            out[name] = list(dict.fromkeys(values))
    return out


def history_layout(properties, fields):
    log = str((properties or {}).get(RUN_LOG_PROPERTY) or "").strip()
    if not log or not fields:
        return None
    try:
        quoted = table_name(log)
    except ValueError:
        return None
    types = {f["name"]: f.get("type") for f in fields}
    return {"log": quoted, "tier": str((properties or {}).get(RUN_LOG_TIER_PROPERTY) or "").strip() or None,
            "columns": [f["name"] for f in fields], "run_type": SQL_TYPES.get(str(types.get("run_id") or "").upper(), "STRING")}


def versions_source(table: str, history: dict, keys: str = "") -> str:
    log = history["log"]
    stamped = {"run_id": "g.`_g_run`", "as_of_date": "g.`_g_date`", "rank": "g.`_g_rank`", "valid_from": "g.`_g_ran`",
               "valid_to": "g.`_g_next`", "is_current": "FALSE", "changed_by": "concat('run ', CAST(g.`_g_run` AS STRING))"}
    plain = ", ".join(quote(c) for c in history["columns"])
    picked = ", ".join(f"{stamped[c]} AS {quote(c)}" if c in stamped else f"v.{quote(c)}" for c in history["columns"])
    within = f" WHERE `record_key` IN ({keys})" if keys else ""
    logged = f" WHERE l.`record_key` IN ({keys})" if keys else ""
    found = (f"SELECT g.*, v.`valid_from` AS `_g_from`, ROW_NUMBER() OVER (PARTITION BY g.`_g_key`, g.`_g_run` ORDER BY v.`valid_from`) "
             f"AS `_g_nth` FROM (SELECT l.`use_case_id` AS `_g_uc`, l.`run_id` AS `_g_run`, l.`as_of_date` AS `_g_date`, l.`rank` AS `_g_rank`, "
             f"l.`ran_at` AS `_g_ran`, l.`record_key` AS `_g_key`, LEAD(l.`ran_at`) OVER (PARTITION BY l.`use_case_id`, l.`record_key` ORDER BY "
             f"l.`ran_at`) AS `_g_next` FROM {log} AS l{logged}) AS g LEFT ANTI JOIN {table} AS x ON x.`record_key` = g.`_g_key` AND "
             f"x.`use_case_id` <=> g.`_g_uc` AND x.`run_id` <=> g.`_g_run` AND x.`change_source` = 'run' JOIN {table} AS v ON "
             f"v.`record_key` = g.`_g_key` AND v.`use_case_id` <=> g.`_g_uc` AND v.`change_source` = 'run' AND v.`valid_from` > g.`_g_ran`")
    return (f"(SELECT {plain} FROM {table}{within} UNION ALL SELECT {picked} FROM ({found}) AS g JOIN {table} AS v ON "
            f"v.`record_key` = g.`_g_key` AND v.`use_case_id` <=> g.`_g_uc` AND v.`change_source` = 'run' AND v.`valid_from` = g.`_g_from` "
            f"WHERE g.`_g_nth` = 1)")


def facts_run(facts, key: str):
    value = (facts or {}).get(key)
    return None if value is None else str(value)


def _runs_ctes(table: str, history=None, facts=None, scopes=None) -> dict:
    if facts and history:
        latest, previous = facts_run(facts, "latest"), facts_run(facts, "previous")
        typed = lambda value: "CAST(NULL AS STRING)" if value is None else f"CAST({sql_text(value)} AS {history['run_type']})"
        return {"n": f"SELECT {typed(latest)} AS `_inspire_latest`, {typed(previous)} AS `_inspire_previous`"}
    source, ran, only = ((history["log"], "`ran_at`", "") if history else
                         (table, "`valid_from`", " WHERE `change_source` = 'run'"))
    runs = (f"SELECT `run_id` AS `_inspire_run`, MIN({ran}) AS `_inspire_ran`, MAX({ran}) AS `_inspire_ended` "
            f"FROM {source}{only} GROUP BY `run_id`")
    if scopes:
        runs = f"SELECT `_inspire_run`, `_inspire_ran`, `_inspire_ended` FROM {_scoped_runs(f'({runs}) AS r', scopes)}"
    return {"r": runs,
            "n": "SELECT MAX(IF(`_inspire_nth` = 1, `_inspire_run`, NULL)) AS `_inspire_latest`, MAX(IF(`_inspire_nth` = 2, "
                 "`_inspire_run`, NULL)) AS `_inspire_previous` FROM (SELECT `_inspire_run`, ROW_NUMBER() OVER (ORDER BY `_inspire_ran` "
                 "DESC) AS `_inspire_nth` FROM r) AS q"}


def _compare_ctes(context: dict) -> dict:
    scopes = context.get("scopes")
    facts = None if scopes and not logged_changes(context) else context.get("facts")
    return _runs_ctes(context["table"], context.get("history"), facts, scopes)


RUNS_CTE = "`_inspire_runs`"
_RUNS_JOINS = frozenset(("join", "inner", "left", "right", "full", "cross", "outer", "semi", "anti", "natural"))
_RUNS_CLAUSES = frozenset(("where", "group", "having", "qualify", "window", "order", "limit", "offset", "cluster", "distribute", "sort"))
_RUNS_BY = frozenset(("group", "order", "cluster", "distribute", "sort"))
_RUNS_SETS = frozenset(("union", "intersect", "except", "minus"))
_RUNS_FIX = {"pivot": "PIVOT on the result table mixes runs; pivot with CASE WHEN inside the aggregates instead",
             "unpivot": "UNPIVOT on the result table mixes runs; list each column in its own UNION ALL part instead",
             "tablesample": "TABLESAMPLE on the result table samples across runs; filter its rows with WHERE instead",
             "rollup": "ROLLUP cannot be grouped run by run; write one GROUP BY per level and combine them with UNION ALL",
             "cube": "CUBE cannot be grouped run by run; write one GROUP BY per combination and combine them with UNION ALL",
             "grouping": "GROUPING SETS cannot be grouped run by run; write one GROUP BY per set and combine them with UNION ALL"}
_RUNS_NOT_ALIAS = frozenset(("on", "using", "lateral", "tablesample", "pivot", "unpivot")) | _RUNS_JOINS | _RUNS_CLAUSES | _RUNS_SETS
_SQL_COMMENTS = re.compile(r"('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`]|``)*`)|--[^\n]*|/\*.*?\*/", re.S)
_RUNS_MARK = "\x00"
_RUNS_TOP = "`_inspire_top_row`"
_RUNS_WITH = "its WITH clause is not a list of name AS (query); write each query as name AS (SELECT ...)"
_RUNS_HIDDEN = ("it reads the result table in a subquery outside its FROM, such as in its SELECT list or WHERE; join that query in its FROM "
                "instead and match it on the columns the subquery compared")


def _scoped_runs(runs: str, scopes) -> str:
    if not scopes:
        return runs
    keyed = (f"SELECT r.*, k.`_inspire_scope` FROM {runs} LEFT JOIN (SELECT CAST(`run_id` AS STRING) AS `_inspire_scope_run`, "
             f"MAX(regexp_extract(`run_segments`, '{SCOPE_KEY_PATTERN}', 1)) AS `_inspire_scope` FROM {scopes} GROUP BY CAST(`run_id` AS STRING)) "
             "AS k ON CAST(r.`_inspire_run` AS STRING) = k.`_inspire_scope_run`")
    return (f"(SELECT * FROM (SELECT s.*, FIRST_VALUE(s.`_inspire_scope`) OVER (ORDER BY s.`_inspire_ran` DESC) AS `_inspire_latest_scope` "
            f"FROM ({keyed}) AS s) AS s WHERE COALESCE(s.`_inspire_scope`, '') = COALESCE(s.`_inspire_latest_scope`, '')) AS r")


def _runs_ranked(table: str, history=None, scopes=None) -> str:
    runs = _scoped_runs(f"({_runs_ctes(table, history)['r']}) AS r", scopes)
    return f"SELECT `_inspire_run`, `_inspire_ended`, ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC) AS `_inspire_nth` FROM {runs}"


def _runs_rows(table: str, columns, backs, history=None, scopes=None) -> str:
    run, listed = quote(RUN_COLUMN), ", ".join(quote(c) for c in columns)
    parts = [f"SELECT {listed}, '{RUN_LATEST}' AS {run} FROM {table}"] if 0 in backs else []
    earlier = [str(back + 1) for back in backs if back]
    if earlier:
        kept = ", ".join("TRUE AS `is_current`" if c == "is_current" else f"t.{quote(c)}" for c in columns)
        of = "`_inspire_run` AS `_inspire_run_id`, " if history else ""
        ends = (f"SELECT {of}`_inspire_ended`, CASE WHEN `_inspire_nth` = 2 THEN '{RUN_PREVIOUS}' ELSE '{RUN_PREVIOUS}_' || "
                f"CAST(`_inspire_nth` - 1 AS STRING) END AS {run} FROM ({_runs_ranked(table, history, scopes)}) AS q WHERE `_inspire_nth` IN "
                f"({', '.join(earlier)})")
        if history:
            parts.append(f"SELECT {kept}, e.{run} FROM {versions_source(table, history)} AS t JOIN ({ends}) AS e ON t.`change_source` = 'run' "
                         f"AND CAST(t.`run_id` AS STRING) = CAST(e.`_inspire_run_id` AS STRING)")
        else:
            parts.append(f"SELECT {kept}, e.{run} FROM {table} AS t JOIN ({ends}) AS e ON t.`valid_from` <= e.`_inspire_ended` AND "
                         f"(t.`valid_to` IS NULL OR t.`valid_to` > e.`_inspire_ended`)")
    return "\nUNION ALL\n".join(parts)


def _runs_zero(tokens: list, start: int, end: int) -> list:
    depth, out = 0, []
    for index in range(start, end):
        if tokens[index] == ")":
            depth -= 1
        elif depth == 0 and not tokens[index].isspace():
            out.append(index)
        if tokens[index] == "(":
            depth += 1
    return out

def _runs_word(tokens: list, at: int, end: int) -> str:
    at = _measure_skip(tokens, at, end)
    return tokens[at].lower() if at < end else ""


def _runs_before(tokens: list, at: int, start: int) -> str:
    at -= 1
    while at >= start and tokens[at].isspace():
        at -= 1
    return tokens[at] if at >= start else ""


def _runs_subqueries(tokens: list, start: int, end: int):
    index = start
    while index < end:
        if tokens[index] == "(" and _runs_word(tokens, index + 1, end) in ("select", "with"):
            close = _measure_close(tokens, index, end)
            yield index, close
            index = close
        index += 1


def _runs_outside(tokens: list, start: int, end: int):
    index = start
    for opened, close in list(_runs_subqueries(tokens, start, end)) + [(end, end - 1)]:
        yield from range(index, opened)
        index = close + 1


def _runs_aggregated(tokens: list, start: int, end: int) -> bool:
    for index in _runs_outside(tokens, start, end):
        if (tokens[index].lower() in _MEASURE_AGGREGATES and _runs_word(tokens, index + 1, end) == "("
                and _runs_before(tokens, index, start) != "."):
            opened = _measure_skip(tokens, index + 1, end)
            if _runs_word(tokens, _measure_close(tokens, opened, end) + 1, end) != "over":
                return True
    return False


def _runs_query(tokens: list, start: int, end: int, table: str, ctes=frozenset()) -> tuple:
    first, prefix, ctes = _measure_skip(tokens, start, end), "", set(ctes)
    if first < end and tokens[first].lower() == "with":
        at = _measure_skip(tokens, first + 1, end)
        if at < end and tokens[at].lower() == "recursive":
            raise ValueError("it uses WITH RECURSIVE, which cannot be read run by run; write the recursion out as joins, or compute it in "
                             "the notebook that writes the result table")
        parts = []
        while True:
            name = tokens[at] if at < end else ""
            if not (name.startswith("`") or _MEASURE_WORD.fullmatch(name)):
                raise ValueError(_RUNS_WITH)
            after, listed = _measure_skip(tokens, at + 1, end), None
            if after < end and tokens[after] == "(":
                listed = _measure_close(tokens, after, end)
                after = _measure_skip(tokens, listed + 1, end)
            opened = _measure_skip(tokens, after + 1, end)
            if after >= end or tokens[after].lower() != "as" or opened >= end or tokens[opened] != "(":
                raise ValueError(_RUNS_WITH)
            close = _measure_close(tokens, opened, end)
            inner, carries = _runs_query(tokens, opened + 1, close, table, ctes)
            (ctes.add if carries else ctes.discard)(name.strip("`").lower())
            head = ("".join(tokens[at:listed]) + f", {quote(RUN_COLUMN)}" + "".join(tokens[listed:opened + 1]) if listed and carries
                    else "".join(tokens[at:opened + 1]))
            parts.append(f"{head}{inner})")
            follow = _measure_skip(tokens, close + 1, end)
            if follow < end and tokens[follow] == ",":
                at = _measure_skip(tokens, follow + 1, end)
                continue
            start, first = follow, follow
            break
        prefix = "WITH " + ",\n".join(parts) + "\n"
    if first >= end or tokens[first].lower() != "select":
        raise ValueError("it is not a SELECT; write the dataset as a SELECT, after WITH name AS (SELECT ...) if it needs other queries")
    cuts = [i for i in _runs_zero(tokens, start, end) if tokens[i].lower() in _RUNS_SETS
            and not (tokens[i].lower() == "except" and _runs_before(tokens, i, start) == "*")]
    texts, carried, at = [], set(), first
    for cut in cuts + [end]:
        text, carries = _runs_select(tokens, at, cut, table, ctes, bool(cuts))
        texts.append(text)
        carried.add(carries)
        if cut < end:
            follow = _measure_skip(tokens, cut + 1, end)
            at = follow + 1 if tokens[follow].lower() in ("all", "distinct") else cut + 1
            texts.append("".join(tokens[cut:at]))
    if len(carried) > 1:
        raise ValueError("only some parts of its UNION read the result table, so their rows would belong to no run; read the result table "
                         "in every part, or join the part that does not read it to the part that does")
    return prefix + "".join(texts), carried == {True}


def _runs_item(tokens: list, start: int, end: int, table: str, ctes, put) -> dict:
    first = _measure_skip(tokens, start, end)
    if first >= end:
        raise ValueError("its FROM has an empty item; remove the extra comma or JOIN")
    named = cte = False
    if tokens[first] == "(":
        close = _measure_close(tokens, first, end)
        inner, carries = _runs_query(tokens, first + 1, close, table, ctes)
        put(first + 1, close, inner)
        after = close + 1
    else:
        after = first
        while after < end and (tokens[after] == "." or tokens[after].startswith("`") or _MEASURE_WORD.fullmatch(tokens[after])):
            if after > first and tokens[after] != "." and tokens[after - 1] != ".":
                break
            after += 1
        written = "".join(tokens[first:after])
        name = [part.strip("`").lower() for part in written.split(".")]
        named = name == [part.strip().strip("`").lower() for part in str(table).split(".")]
        cte = not named and len(name) == 1 and name[0] in ctes
        carries = named or cte
    at = _measure_skip(tokens, after, end)
    if at < end and tokens[at].lower() == "as":
        at = _measure_skip(tokens, at + 1, end)
    alias = (tokens[at] if at < end and (tokens[at].startswith("`") or (_MEASURE_WORD.fullmatch(tokens[at]) and tokens[at].lower()
                                                                        not in _RUNS_NOT_ALIAS)) else "")
    rest = _measure_skip(tokens, at + 1, end) if alias else at
    if named:
        last = table_name(table).split(".")[-1]
        put(first, after, RUNS_CTE + ("" if alias else f" AS {last}"))
        alias = alias or last
    elif cte:
        put(first, after, _RUNS_MARK + written)
        alias = alias or written
    cut = next((tokens[i].lower() for i in range(start, end) if tokens[i].lower() in ("pivot", "unpivot", "tablesample")), "")
    if carries and cut:
        raise ValueError(f"it uses {_RUNS_FIX[cut]}")
    if carries and not alias:
        raise ValueError("a subquery in its FROM that reads the result table has no alias; give it one, as in (SELECT ...) AS d")
    return {"alias": alias, "carries": carries, "rest": rest, "end": end, "opened": first if tokens[first] == "(" else None}


def _runs_select(tokens: list, start: int, end: int, table: str, ctes=frozenset(), in_union: bool = False) -> tuple:
    out, before, run = list(tokens[start:end]) + [""], {}, quote(RUN_COLUMN)

    def put(first, stop, text):
        out[first - start:stop - start] = [text] + [""] * (stop - first - 1)

    def add(at, text):
        before.setdefault(at - start, []).append(text)

    def clause(i):
        if _runs_before(tokens, i, start) == "." or words[i] not in _RUNS_CLAUSES:
            return False
        if words[i] == "window":
            return _runs_word(tokens, _measure_skip(tokens, i + 1, end) + 1, end) == "as"
        return words[i] not in _RUNS_BY or _runs_word(tokens, i + 1, end) == "by"

    zero = _runs_zero(tokens, start, end)
    words = {i: tokens[i].lower() for i in zero}
    select = next(i for i in zero if words[i] == "select")
    found = next((i for i in zero if i > select and words[i] == "from" and _runs_before(tokens, i, start) != "."), None)
    clauses = [i for i in zero if found is not None and i > found and clause(i)]
    stop = next(iter(clauses), end)
    items, kind, at, marks, index = [], "", (found or end) + 1, [], 0
    inside = [i for i in zero if found is not None and found < i < stop]
    while index < len(inside):
        i = inside[index]
        if tokens[i] == ",":
            marks.append((i, i + 1, ","))
        elif words[i] in _RUNS_JOINS and _runs_word(tokens, i + 1, end) != "(":
            last = index
            while last < len(inside) and words[inside[last]] in _RUNS_JOINS and words[inside[last]] != "join":
                last += 1
            if last < len(inside) and words[inside[last]] == "join":
                marks.append((i, inside[last] + 1, " ".join(words[x] for x in inside[index:last + 1])))
                index = last
        index += 1
    if found is not None:
        joint = None
        for mark_start, mark_end, mark_kind in marks + [(stop, stop, "")]:
            items.append(dict(_runs_item(tokens, at, mark_start, table, ctes, put), kind=kind, joint=joint))
            at, kind, joint = mark_end, mark_kind, (mark_start, mark_end)
    derived = {item["opened"] for item in items}
    for opened, close in _runs_subqueries(tokens, start, end):
        if opened not in derived and _runs_query(tokens, opened + 1, close, table, ctes)[1]:
            raise ValueError(_RUNS_HIDDEN)
    runs = [item for item in items if item["carries"]]
    for index, item in enumerate(items):
        joined, earlier = set(item["kind"].split()), any(x["carries"] for x in items[:index])
        if item["carries"] and not earlier and joined & {"semi", "anti"}:
            raise ValueError("it filters another table with a SEMI or ANTI JOIN on the result table, so its rows would belong to no run; "
                             "put the result table first, or JOIN a SELECT DISTINCT of the result table's columns instead")
        if (item["carries"] and ("full" in joined or ("left" in joined and not earlier))) or (joined & {"right", "full"} and earlier):
            raise ValueError("it outer-joins the result table so rows of another table could belong to no run; put the result table first "
                             "in a LEFT JOIN, or use JOIN")
    top = None
    if runs:
        first = runs[0]["alias"]
        for item in runs[1:]:
            on, kinds, match = item["rest"], set(item["kind"].split()), f"{item['alias']}.{run} = {first}.{run}"
            word = tokens[on].lower() if on < item["end"] else ""
            if "natural" in kinds:
                continue
            if word == "on":
                put(on, on + 1, f"{tokens[on]} (")
                add(item["end"], f") AND {match} ")
            elif word == "using":
                opened = _measure_skip(tokens, on + 1, item["end"])
                add(_measure_close(tokens, opened, item["end"]), f", {run}")
            else:
                if item["kind"] == "," or "cross" in kinds:
                    put(*item["joint"], " JOIN " if item["kind"] == "," else "JOIN")
                add(item["end"], f" ON {match} ")
        listed = _measure_skip(tokens, select + 1, found)
        distinct = tokens[listed].lower() == "distinct"
        listed += tokens[listed].lower() in ("distinct", "all")
        pieces, covered = _measure_arguments(tokens, listed, found), False
        for piece in pieces:
            text = " ".join(piece.split()).lower()
            if text == "*" or text.startswith("* except"):
                if len(runs) > 1:
                    raise ValueError("it selects * from the result table read twice; name the columns it needs from each read")
                covered = True
            covered = covered or any(re.fullmatch(rf"{re.escape(r['alias'].lower())}\s*\.\s*\*(\s+except\b.*)?", text, re.S) for r in runs)
        if not covered:
            add(found, f", {first}.{run} ")
        named = next((i for i in clauses if words[i] == "window"), None)

        def window(opened, high):
            inner = _measure_skip(tokens, opened + 1, high)
            if tokens[inner].lower() == "partition":
                add(_measure_skip(tokens, inner + 1, high) + 1, f" {first}.{run},")
            else:
                add(opened + 1, f"PARTITION BY {first}.{run} ")

        qualify = next((i for i in clauses if words[i] == "qualify"), None)
        for low, high in [(select + 1, found)] + ([(qualify + 1, next((c for c in clauses if c > qualify), end))] if qualify else []):
            for i in _runs_outside(tokens, low, high):
                if tokens[i].lower() != "over" or _runs_before(tokens, i, start) != ")":
                    continue
                opened = _measure_skip(tokens, i + 1, high)
                if opened < high and tokens[opened] == "(":
                    window(opened, high)
                elif named is None:
                    raise ValueError("it uses OVER with a window name but no WINDOW clause defines it; write the window inline in OVER (...)")
        if named is not None:
            high = next((c for c in clauses if c > named), end)
            for i in _runs_zero(tokens, named + 1, high):
                if tokens[i].lower() == "as" and _runs_word(tokens, i + 1, high) == "(":
                    window(_measure_skip(tokens, i + 1, high), high)
        group = next((i for i in clauses if words[i] == "group"), None)
        if group is not None:
            by = _measure_skip(tokens, group + 1, end)
            stop = next((c for c in clauses if c > group), end)
            grouped = sorted({tokens[x].lower() for x in range(by + 1, stop)} & {"rollup", "cube", "grouping"})
            if grouped:
                raise ValueError(f"it uses {_RUNS_FIX[grouped[0]]}")
            if _runs_word(tokens, by + 1, stop) != "all":
                add(stop, f", {first}.{run} ")
        elif _runs_aggregated(tokens, select + 1, found) or any(words[i] == "having" for i in clauses):
            add(next((c for c in clauses if words[c] != "where"), end), f" GROUP BY {first}.{run} ")
        order, limit, offset = (next((i for i in clauses if words[i] == w), None) for w in ("order", "limit", "offset"))
        if limit is not None or offset is not None:
            if in_union:
                raise ValueError("it uses LIMIT or OFFSET on a UNION, which cannot keep each run's own top rows; wrap the UNION as "
                                 "SELECT * FROM (...) AS u ORDER BY u.column LIMIT n")
            if order is None:
                raise ValueError("it uses LIMIT or OFFSET without ORDER BY, so the rows each run keeps are not defined; add ORDER BY with "
                                 "the columns that pick the top rows")
            if distinct:
                raise ValueError("it uses SELECT DISTINCT with LIMIT, so each run's top rows would be picked before its duplicates are "
                                 "removed; write the DISTINCT as GROUP BY on the same columns")
            count = _runs_word(tokens, limit + 1, end) if limit is not None else ""
            skipped = _runs_word(tokens, offset + 1, end) if offset is not None else "0"
            if (limit is not None and not count.isdigit()) or not skipped.isdigit():
                raise ValueError("its LIMIT or OFFSET is not a whole number; write each as a number")
            by = _measure_skip(tokens, order + 1, end)
            sorting = _measure_arguments(tokens, by + 1, next((c for c in clauses if c > order), end))
            aliases = {}
            for piece in pieces:
                parts = piece.split()
                if len(parts) >= 3 and parts[-2].lower() == "as":
                    aliases[parts[-1].strip("`").lower()] = (parts[0].split(".")[-1].strip("`").lower()
                                                             if len(parts) == 3 and re.fullmatch(r"[\w`.]+", parts[0]) else "")
            for piece in sorting:
                lead = (piece.split() or [""])[0]
                if lead.isdigit() or aliases.get(lead.strip("`").lower(), lead.strip("`").lower()) != lead.strip("`").lower():
                    raise ValueError("its ORDER BY before LIMIT names a position or a SELECT alias; order by the source columns, as in "
                                     "ORDER BY o.value DESC")
            add(found, f", ROW_NUMBER() OVER (PARTITION BY {first}.{run} ORDER BY {', '.join(p.strip() for p in sorting)}) AS {_RUNS_TOP} ")
            put(order, end, "")
            top = (int(skipped), int(count) if count else None)
    text = "".join("".join(before.get(k, ())) + piece for k, piece in enumerate(out))
    hidden = [name for name in ctes if re.search(rf"\b(?:FROM|JOIN)\s+`?{re.escape(name)}`?(?![\w`.])", text, re.I)]
    if reads_table(text, table) or hidden:
        raise ValueError(_RUNS_HIDDEN)
    if top:
        text = (f"SELECT * EXCEPT ({_RUNS_TOP}) FROM ({text}) AS `_inspire_top` WHERE {_RUNS_TOP} > {top[0]}"
                + (f" AND {_RUNS_TOP} <= {top[0] + top[1]}" if top[1] is not None else ""))
    return text, bool(runs)


def _table_reads(table: str):
    parts = [p.strip().strip("`") for p in str(table or "").split(".")]
    named = r"\.".join(f"`?({re.escape(p)})`?" for p in parts)
    return re.compile(rf"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|--[^\n]*|/\*.*?\*/|\b(FROM|JOIN|TABLE)(\s+){named}(?![\w`.])", re.I | re.S)


def reads_table(sql: str, table: str) -> bool:
    table_name(table)
    return any(match.group(1) for match in _table_reads(table).finditer(str(sql or "")))


def runs_compare_sql(sql: str, table: str, columns, backs=(0, 1), history=None, scopes=False) -> str:
    backs = sorted(set(backs))
    if not backs or any(isinstance(b, bool) or not isinstance(b, int) or not 0 <= b <= ALERT_BASELINE_RUNS for b in backs):
        raise ValueError(f"the runs to read are 0, the latest, to {ALERT_BASELINE_RUNS} runs before it, not {backs!r}")
    tokens = _MEASURE_TOKEN.findall(_SQL_COMMENTS.sub(lambda m: m.group(1) or " ", clean_sql(sql)))
    text, carries = _runs_query(tokens, 0, len(tokens), table)
    if not carries:
        raise ValueError(f"it does not read the result table {table} in its FROM, the one table that keeps earlier runs")
    summary = table_name(str(table).strip() + SUMMARY_SUFFIX) if scopes else None
    rows, text = f"{RUNS_CTE} AS (\n{_runs_rows(table_name(table), columns, backs, history, summary)}\n)", text.replace(_RUNS_MARK, "")
    return f"WITH {rows},\n{text[len('WITH '):]}" if text.startswith("WITH ") else f"WITH {rows}\n{text}"


def runs_problem(sql: str, table: str) -> str:
    try:
        runs_compare_sql(sql, table, HISTORY_COLUMNS + ("run_id",))
    except ValueError as error:
        return str(error)
    return ""


def previous_rows(page: dict, name: str, columns, history=None):
    sql, table = _dataset(page, name), page.get("result_table")
    if not table or not columns or not reads_table(sql, table):
        return None
    return runs_compare_sql(sql, table, columns, (1,), history, page_scopes(page))


def previous_value(expression, rows: str = "COUNT(*)") -> str:
    return f"CASE WHEN {rows} = 0 THEN NULL ELSE {expression} END"


_MEASURE_TOKEN = re.compile(r"\s+|'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`]|``)*`|[^\W\d]\w*|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|.", re.S)
_MEASURE_WORD = re.compile(r"[^\W\d]\w*")
_MEASURE_ALL = ("count", "count_if", "sum", "avg", "mean", "min", "max", "median", "stddev", "stddev_pop", "stddev_samp", "std", "variance",
                "var_pop", "var_samp", "skewness", "kurtosis", "try_sum", "try_avg", "bool_and", "bool_or", "every", "max_by", "min_by",
                "corr", "covar_pop", "covar_samp", "regr_avgx", "regr_avgy", "regr_count", "regr_intercept", "regr_r2", "regr_slope",
                "regr_sxx", "regr_sxy", "regr_syy")
_MEASURE_FIRST = ("percentile", "percentile_approx", "approx_percentile", "approx_count_distinct", "mode")
_MEASURE_ORDERED = ("percentile_cont", "percentile_disc")
_MEASURE_AGGREGATES = frozenset(_MEASURE_ALL + _MEASURE_FIRST + _MEASURE_ORDERED)
_MEASURE_SCALARS = frozenset(("abs", "round", "bround", "ceil", "ceiling", "floor", "coalesce", "nullif", "ifnull", "nvl", "nvl2", "if", "iff",
                              "greatest", "least", "try_divide", "try_multiply", "try_add", "try_subtract", "div", "mod", "pmod", "power",
                              "pow", "sqrt", "cbrt", "exp", "ln", "log", "log2", "log10", "sign", "signum", "cast", "try_cast", "decimal",
                              "zeroifnull", "nullifzero", "int", "integer", "bigint", "smallint", "tinyint", "double", "float",
                              "string", "date", "timestamp", "boolean", "day", "month", "year"))
_MEASURE_KEYWORDS = frozenset(("and", "or", "not", "in", "when", "then", "else", "case", "is", "between", "like", "ilike", "rlike",
                               "end", "as", "null", "true", "false", "interval"))
_MEASURE_SORT_WORDS = ("asc", "desc", "nulls", "first", "last")


def _measure_skip(tokens: list, at: int, end: int) -> int:
    while at < end and tokens[at].isspace():
        at += 1
    return at


def _measure_close(tokens: list, at: int, end: int) -> int:
    depth = 0
    for index in range(at, end):
        depth += tokens[index] == "("
        depth -= tokens[index] == ")"
        if depth == 0:
            return index
    raise ValueError("its parentheses do not close")


def compare_words() -> dict:
    return {"vs": COMPARE_RUN, "marks": dict(CHANGE_MARKS), "words": dict(CHANGE_WORDS)}


def change_text_sql(now: str, before: str) -> str:
    now, before = f"CAST(({now}) AS DOUBLE)", f"CAST(({before}) AS DOUBLE)"
    size = f"round(abs({now} - {before}) / NULLIF(abs({before}), 0) * 100, 1)"
    way = f"CASE WHEN {now} > {before} THEN {sql_text(CHANGE_MARKS['up'])} ELSE {sql_text(CHANGE_MARKS['down'])} END"
    tail = sql_text(" " + COMPARE_RUN)
    return (f"CASE WHEN {now} IS NULL OR {before} IS NULL THEN '' "
            f"WHEN {now} = {before} OR {size} = 0 THEN {sql_text(' '.join((CHANGE_MARKS['same'], CHANGE_WORDS['same'], COMPARE_RUN)))} "
            f"WHEN {before} = 0 THEN concat({way}, ' ', {sql_text(CHANGE_WORDS['from_zero'])}, {tail}) "
            f"ELSE concat({way}, ' ', format_string('%.1f', {size}), '%', {tail}) END")


def _measure_arguments(tokens: list, start: int, end: int) -> list:
    spans, depth, begin = [], 0, start
    for index in range(start, end):
        depth += tokens[index] == "("
        depth -= tokens[index] == ")"
        if tokens[index] == "," and depth == 0:
            spans.append("".join(tokens[begin:index]))
            begin = index + 1
    spans.append("".join(tokens[begin:end]))
    return [] if len(spans) == 1 and not spans[0].strip() else spans


def _measure_argument(name: str, text: str, picked: str) -> str:
    body = text.strip()
    lead = re.match(r"(?:DISTINCT|ALL)\b\s*", body, re.I)
    keyword = lead.group(0) if lead else ""
    body = body[len(keyword):].strip()
    if body == "*" and name == "count" and not keyword:
        body = "1"
    if not body or body == "*":
        raise ValueError(f"{name.upper()}( ) has an argument it cannot read")
    inner = _MEASURE_TOKEN.findall(body)
    for index, token in enumerate(inner):
        after = _measure_skip(inner, index + 1, len(inner))
        if token.lower() in _MEASURE_AGGREGATES and after < len(inner) and inner[after] == "(":
            raise ValueError(f"it puts {token.upper()}( ) inside {name.upper()}( )")
    return f"{keyword}CASE WHEN {picked} THEN {body} END"


def _measure_ordered(tokens: list, start: int, end: int, picked: str) -> str:
    order = _measure_skip(tokens, start, end)
    by = _measure_skip(tokens, order + 1, end)
    if order >= end or tokens[order].lower() != "order" or by >= end or tokens[by].lower() != "by":
        raise ValueError("WITHIN GROUP holds no ORDER BY")
    stop = end
    while stop > by + 1 and (tokens[stop - 1].isspace() or tokens[stop - 1].lower() in _MEASURE_SORT_WORDS):
        stop -= 1
    body = "".join(tokens[by + 1:stop]).strip()
    if not body or len(_measure_arguments(tokens, by + 1, stop)) != 1:
        raise ValueError("WITHIN GROUP must order by one expression")
    return f"{''.join(tokens[start:by + 1]).strip()} {_measure_argument('ORDER BY', body, picked)}{''.join(tokens[stop:end]).rstrip()}"


def _measure_aggregate(tokens: list, at: int, opened: int, closed: int, end: int, picked: str) -> tuple:
    name = tokens[at].lower()
    texts = _measure_arguments(tokens, opened + 1, closed)
    data = range(len(texts)) if name in _MEASURE_ALL else range(min(1, len(texts))) if name in _MEASURE_FIRST else ()
    shown = [_measure_argument(name, text, picked) if index in data else text.strip() for index, text in enumerate(texts)]
    text, stop = f"{''.join(tokens[at:opened])}({', '.join(shown)})", closed + 1
    after = _measure_skip(tokens, closed + 1, end)
    follows = tokens[after].lower() if after < end else ""
    if follows in ("over", "filter"):
        raise ValueError(f"{name.upper()}( ) {follows.upper()} is a window or a filter it cannot split by run")
    if follows == "within":
        group = _measure_skip(tokens, after + 1, end)
        opening = _measure_skip(tokens, group + 1, end)
        if group >= end or tokens[group].lower() != "group" or opening >= end or tokens[opening] != "(":
            raise ValueError(f"{name.upper()}( ) WITHIN is not followed by GROUP (ORDER BY ...)")
        shut = _measure_close(tokens, opening, end)
        return text + "".join(tokens[closed + 1:opening]) + f"({_measure_ordered(tokens, opening + 1, shut, picked)})", shut + 1
    if name in _MEASURE_ORDERED or not data:
        raise ValueError(f"{name.upper()}( ) reads no column it can split by run")
    return text, stop


def _measure_part(tokens: list, start: int, end: int, picked: str, found: list) -> str:
    out, at = [], start
    while at < end:
        token = tokens[at]
        if token.startswith("`"):
            raise ValueError(f"the column {token} sits outside an aggregate")
        if not _MEASURE_WORD.fullmatch(token):
            out.append(token)
            at += 1
            continue
        word, opened = token.lower(), _measure_skip(tokens, at + 1, end)
        called = opened < end and tokens[opened] == "("
        if called and word in _MEASURE_AGGREGATES:
            text, at = _measure_aggregate(tokens, at, opened, _measure_close(tokens, opened, end), end, picked)
            found.append(word)
            out.append(text)
        elif called and word in _MEASURE_SCALARS:
            closed = _measure_close(tokens, opened, end)
            out.append(f"{''.join(tokens[at:opened])}({_measure_part(tokens, opened + 1, closed, picked, found)})")
            at = closed + 1
        elif word in _SQL_WORDS and (not called or word in _MEASURE_KEYWORDS):
            out.append(token)
            at += 1
        elif called:
            raise ValueError(f"{token}( ) is not an aggregate it can split by run")
        else:
            raise ValueError(f"the column {token} sits outside an aggregate")
    return "".join(out)


def run_tag(back: int) -> str:
    return RUN_LATEST if back == 0 else RUN_PREVIOUS if back == 1 else f"{RUN_PREVIOUS}_{back}"


def run_measure(expression, run: str) -> str:
    if run not in {run_tag(back) for back in range(ALERT_BASELINE_RUNS + 1)}:
        raise ValueError(f"a run is {RUN_LATEST} or {RUN_PREVIOUS}, or {run_tag(2)} to {run_tag(ALERT_BASELINE_RUNS)}, not {run!r}")
    tokens, found = _MEASURE_TOKEN.findall(str(expression or "")), []
    text = _measure_part(tokens, 0, len(tokens), f"{quote(RUN_COLUMN)} = '{run}'", found)
    if not found:
        raise ValueError("it holds no aggregate such as SUM, COUNT or AVG")
    return text.strip()


def run_split_problem(expression) -> str:
    try:
        run_measure(expression, RUN_PREVIOUS)
    except ValueError as error:
        return f"{error}; write it so every column sits inside an aggregate such as SUM, COUNT, AVG, MIN or MAX"
    return ""


def previous_run_measure(expression, back: int = 1) -> str:
    return previous_value(run_measure(expression, run_tag(back)), run_measure("COUNT(*)", run_tag(back)))


def trend_sql(table: str, measures: dict, history=None) -> str:
    shown = "".join(f", {expression} AS {quote(name)}" for name, expression in measures.items())
    label = f"date_format(r.`_inspire_ran`, 'yyyy-MM-dd HH:mm:ss') AS {quote(TREND_RUN_LABEL)}"
    if history:
        return (f"{_with(_runs_ctes(table, history), ['r'])}\nSELECT CAST(r.`_inspire_run` AS STRING) AS `run_id`, "
                f"r.`_inspire_ran` AS `ran_at`, {label}{shown}\nFROM r JOIN {versions_source(table, history)} AS t ON "
                f"CAST(t.`run_id` AS STRING) = CAST(r.`_inspire_run` AS STRING) AND t.`change_source` = 'run'\n"
                f"GROUP BY r.`_inspire_run`, r.`_inspire_ran`")
    return (f"{_with(_runs_ctes(table), ['r'])}\nSELECT CAST(r.`_inspire_run` AS STRING) AS `run_id`, r.`_inspire_ran` AS `ran_at`, "
            f"{label}{shown}\n"
            f"FROM r JOIN {table} AS t ON t.`valid_from` <= r.`_inspire_ended` AND (t.`valid_to` IS NULL OR t.`valid_to` > "
            f"r.`_inspire_ended`) AND t.`change_source` <> 'delete'\nGROUP BY r.`_inspire_run`, r.`_inspire_ran`")


def reason_wording(text: str) -> str:
    return f"regexp_replace(TRIM(CAST({text} AS STRING)), {sql_text(REASON_NUMBERS)}, {sql_text(REASON_NUMBER_MARK)})"


def reasons_sql(table: str, column: str, columns) -> str:
    kept = "".join(f", t.{quote(c)}" for c in REASONS_KEPT if c in columns)
    return (f"SELECT t.`record_key`{kept}, {reason_wording('r.`reason`')} AS `reason` FROM {table} AS t "
            f"LATERAL VIEW EXPLODE(t.{quote(column)}) r AS `reason` WHERE t.`is_current` AND t.`change_source` <> 'delete' "
            f"AND r.`reason` IS NOT NULL AND TRIM(CAST(r.`reason` AS STRING)) <> ''")


def logged_changes(context: dict) -> bool:
    history = context.get("history")
    return bool(history) and (context["tier"] is None or context["tier"] == history.get("tier"))


def _change_ctes(context: dict, within: str = "") -> dict:
    table, tier = context["table"], context["tier"]
    scope = f" AND t.`record_key` IN (SELECT `_inspire_key` FROM {within})" if within else ""
    if logged_changes(context) and context.get("latest_log"):
        return {"l": f"SELECT t.`record_key` AS `_inspire_lk`, t.`change` AS `_inspire_ch`, t.`moved_to` AS `_inspire_mt` FROM "
                     f"{context['latest_log']} AS t WHERE TRUE{scope}"}
    if logged_changes(context):
        return {"l": f"SELECT t.`record_key` AS `_inspire_lk`, t.`change` AS `_inspire_ch`, t.`moved_to` AS `_inspire_mt` FROM "
                     f"{context['history']['log']} AS t JOIN n ON t.`run_id` = n.`_inspire_latest` WHERE n.`_inspire_previous` IS NOT NULL{scope}"}
    if context.get("history"):
        table = versions_source(table, context["history"])
    tier_sql = f", CAST(t.{quote(tier)} AS STRING) AS `_inspire_tier`" if tier else ""
    compared = " AND t.`run_id` IN (SELECT `_inspire_run` FROM r)" if context.get("scopes") else ""
    out = {"l": f"SELECT t.`record_key` AS `_inspire_lk`{tier_sql} FROM {table} AS t JOIN n ON t.`run_id` = n.`_inspire_latest` "
                f"WHERE t.`change_source` = 'run' AND n.`_inspire_previous` IS NOT NULL{scope}",
           "o": f"SELECT DISTINCT t.`record_key` AS `_inspire_ok` FROM {table} AS t JOIN n ON t.`run_id` <> n.`_inspire_latest` "
                f"WHERE t.`change_source` = 'run'{compared}{scope}"}
    if tier:
        out["p"] = (f"SELECT t.`record_key` AS `_inspire_pk`, CAST(t.{quote(tier)} AS STRING) AS `_inspire_was` FROM {table} AS t "
                    f"JOIN n ON t.`run_id` = n.`_inspire_previous` WHERE t.`change_source` = 'run'{scope}")
    return out


def _moved(context: dict) -> str:
    if logged_changes(context):
        return "l.`_inspire_ch` = 'moved'" if context["tier"] else "FALSE"
    return "p.`_inspire_pk` IS NOT NULL AND NOT (l.`_inspire_tier` <=> p.`_inspire_was`)" if context["tier"] else "FALSE"


def _change_columns(context: dict) -> list:
    moved = _moved(context)
    if logged_changes(context):
        moved_to = "CASE WHEN l.`_inspire_ch` = 'moved' THEN l.`_inspire_mt` END" if context["tier"] else "CAST(NULL AS STRING)"
        return [f"CASE WHEN l.`_inspire_ch` = 'new' THEN 'new' WHEN {moved} THEN 'moved' END AS `_inspire_change`",
                f"{moved_to} AS `_inspire_moved_to`"]
    return [f"CASE WHEN l.`_inspire_lk` IS NULL THEN NULL WHEN o.`_inspire_ok` IS NULL THEN 'new' WHEN {moved} THEN 'moved' END "
            f"AS `_inspire_change`",
            f"CASE WHEN l.`_inspire_lk` IS NOT NULL AND o.`_inspire_ok` IS NOT NULL AND {moved} THEN l.`_inspire_tier` END "
            f"AS `_inspire_moved_to`" if context["tier"] else "CAST(NULL AS STRING) AS `_inspire_moved_to`"]


def _change_joins(context: dict, key: str, suffix: str = "") -> str:
    if logged_changes(context):
        return f" LEFT JOIN l{suffix} AS l ON l.`_inspire_lk` = {key}"
    joins = f" LEFT JOIN l{suffix} AS l ON l.`_inspire_lk` = {key} LEFT JOIN o{suffix} AS o ON o.`_inspire_ok` = {key}"
    return joins + (f" LEFT JOIN p{suffix} AS p ON p.`_inspire_pk` = {key}" if context["tier"] else "")


def _current_cte(context: dict, extra=()) -> str:
    join, actions = context["join"], context["actions"]
    mapped = f", CAST({quote(join)} AS STRING) AS `_inspire_join`" if join != "record_key" else ""
    owned = ", `action_owner` AS `_inspire_owner`, `action_status` AS `_inspire_status`" if actions else ""
    explained = "".join(f", CAST({quote(n)} AS STRING) AS {quote(ai_alias(n))}" for n in context["ai"])
    more = "".join(f", {e}" for e in [*extra, f"CAST({quote(KEPT_SINCE)} AS TIMESTAMP) AS `_inspire_missing`", *context.get("money", [])])
    return (f"SELECT `record_key` AS `_inspire_key`{mapped}, CAST(unix_micros(`valid_from`) AS STRING) AS `_inspire_version`{owned}"
            f"{explained}{more} FROM {context.get('current') or context['table']} WHERE `is_current` AND `change_source` <> 'delete'")


def _current_on(context: dict, alias: str) -> str:
    join = context["join"]
    return (f"c.`_inspire_key` = {alias}.`record_key`" if join == "record_key"
            else f"c.`_inspire_join` = CAST({alias}.{quote(join)} AS STRING)")


def _current_join(context: dict, alias: str) -> tuple:
    columns = ["c.`_inspire_key`", "c.`_inspire_version`"] + (["c.`_inspire_owner`", "c.`_inspire_status`"] if context["actions"] else [])
    money = ["c.`_inspire_money`", "c.`_inspire_fx`"] if context.get("money") else []
    windowed = (list(WINDOW_PICKED) + (["c.`_inspire_held`"] if context.get("held") else [])) if context.get("windowed") else []
    return (f" LEFT JOIN c ON {_current_on(context, alias)}",
            columns + [f"c.{quote(ai_alias(n))}" for n in context["ai"]] + money + ["c.`_inspire_missing`"] + windowed)


def _window_extra(context: dict) -> list:
    return list(WINDOW_EXTRA) + (["CAST(`held_back` AS BOOLEAN) AS `_inspire_held`"] if context.get("held") else [])


def _stake(context: dict, prefix: str = "") -> str:
    if context.get("money"):
        return f"{prefix}{quote(MONEY_SORT)}"
    return f"{prefix}{quote(MONEY_COLUMN)}" if MONEY_COLUMN in (context.get("types") or {}) else "CAST(NULL AS DOUBLE)"


def _ai_value(name: str) -> str:
    return f"COALESCE(c.{quote(ai_alias(name))}, '{AI_UNEXPLAINED}')"


def _with(ctes: dict, names) -> str:
    return "WITH " + ", ".join(f"{name} AS ({ctes[name]})" for name in names if name in ctes)


def _listed(page: dict, values: dict, columns, context: dict, params) -> tuple:
    priced = bool(context.get("money"))
    filters = list_column_filters(page)
    found = _conditions(page, RECORDS_DATASET, values, params) + column_conditions(
        [f for f in filters if not (priced and f["column"] == MONEY_COLUMN)], columns, params)
    money = column_conditions([f for f in filters if priced and f["column"] == MONEY_COLUMN], columns, params,
                              {MONEY_COLUMN: LISTED_MONEY})
    where = f" WHERE {' AND '.join(found)}" if found else ""
    return f"SELECT * FROM ({_dataset(page, RECORDS_DATASET)}) AS d{where}", money


def list_queries(page: dict, values: dict, request: dict, context: dict, editor: str = "") -> dict:
    params = _Params()
    plan = _list_plan(page, values, request, context, editor, params)
    ctes, context, early, counted = plan["ctes"], plan["context"], plan["early"], plan["counted"]
    fields = list_cursor_fields(request, context)
    fields = dict(fields, keyset=False) if request.get("ranked") else fields
    sort = quote(fields["sort"])
    if request.get("ranked"):
        order = window_order(_stake(context), "`_inspire_due`", plan["today"], quote(context["tie"]))
    else:
        order = f"{sort} {request['dir'].upper()} NULLS LAST" + (f", {quote(context['tie'])} ASC" if context["tie"] != request["sort"] else "")
    counted_params = list(params.items)
    seek, back = _keyset(request, fields, params)
    paged = f"LIMIT {int(request['limit'])}" if seek else f"LIMIT {int(request['limit'])} OFFSET {int(request['offset'])}"
    top = (request.get("window") or {}).get("limit")
    if top:
        ctes["w"] = f"SELECT * FROM f ORDER BY {order} LIMIT {int(top)}"
    ctes["s"] = f"SELECT * FROM {'w' if top else 'f'}{seek} ORDER BY {back or order} {paged}"
    shown, late = "s", []
    if context["join"] and "c" not in early:
        join, columns = _current_join(context, "s")
        ctes["k"] = f"SELECT s.*, {', '.join(columns)} FROM s{join}"
        shown = "k"
    if context["changes"] and "h" not in early:
        ctes.update(_change_ctes(context, shown))
        late = _change_columns(context)
    outer = f"SELECT {', '.join([f'{shown}.*'] + late)} FROM {shown}" + (_change_joins(context, f"{shown}.`_inspire_key`") if late else "")
    return {"rows": (f"{_with(ctes, ['d', 'c', 'r', 'n', 'l0', 'o0', 'p0', 'f', 'w', 's', 'k', 'l', 'o', 'p'])} {outer} ORDER BY {order}",
                     params.items),
            "total": (f"{_with(ctes, counted)} SELECT COUNT(*) AS total FROM f", counted_params)}


def list_match_query(page: dict, values: dict, request: dict, context: dict, editor: str = "", params=None) -> dict:
    if not context["join"]:
        raise ValueError(f"the App cannot act on the records of this list as a set: {context.get('unjoined') or 'it is not joined'}")
    params = params if params is not None else _Params()
    plan = _list_plan(page, values, request, context, editor, params, current=True)
    ctes, counted = dict(plan["ctes"]), list(plan["counted"])
    top = (request.get("window") or {}).get("limit")
    source = "f"
    if top:
        order = window_order(_stake(plan["context"]), "`_inspire_due`", plan["today"], quote(plan["context"]["tie"]))
        ctes["w"], counted, source = f"SELECT * FROM f ORDER BY {order} LIMIT {int(top)}", counted + ["w"], "w"
    head = _with(ctes, counted)
    return {"keys": f"{head} SELECT DISTINCT `_inspire_key` FROM {source} WHERE `_inspire_key` IS NOT NULL", "params": params,
            "total": f"{head} SELECT COUNT(DISTINCT `_inspire_key`) AS total FROM {source} WHERE `_inspire_key` IS NOT NULL"}


def _list_plan(page: dict, values: dict, request: dict, context: dict, editor: str, params, current: bool = False) -> dict:
    records = page.get("records") or {}
    window = request.get("window")
    context = dict(context, windowed=bool(window))
    listed, money = _listed(page, values, request.get("columns"), context, params)
    ctes = {"d": listed}
    conditions = list(money)
    if request["search"]:
        holder = params.add(contains_pattern(request["search"]))
        searched = list(dict.fromkeys(c for c in (records.get("label"), records.get("key"), records.get("sublabel")) if c))
        conditions.append("(" + " OR ".join(f"CAST(d.{quote(c)} AS STRING) ILIKE {holder} ESCAPE '{LIKE_ESCAPE}'" for c in searched) + ")")
    early, today = set(), ""
    if current or window or request.get("exclude"):
        early.add("c")
    if window:
        today = params.add(window["today"], "DATE")
        conditions += window_conditions(window, params, context["held"], today)
    if request.get("exclude"):
        conditions.append(f"COALESCE(c.`_inspire_key`, '') NOT IN (SELECT explode(from_json("
                          f"{params.add(json.dumps(request['exclude'], ensure_ascii=False))}, 'ARRAY<STRING>')))")
    if context["join"]:
        ctes["c"] = _current_cte(context, _window_extra(context) if window else ())
    if context["changes"] and not (logged_changes(context) and context.get("latest_log")):
        ctes.update(_compare_ctes(context))
    if request["mine"]:
        conditions.append(f"lower(c.`_inspire_owner`) = lower({params.add(editor)})")
        early.add("c")
    money_sort = request["sort"] == MONEY_COLUMN and bool(context.get("money"))
    if request["sort"] in ACTION_SORTS or money_sort or money:
        early.add("c")
    for name, picked in request["ai"].items():
        conditions.append(f"{_ai_value(name)} IN ({', '.join(params.add(v) for v in picked)})")
        early.add("c")
    if request["changed"]:
        ctes.update({f"{name}0": sql for name, sql in _change_ctes(context).items()})
        wanted = "'new', 'moved'" if context["tier"] else "'new'"
        conditions.append(f"l.`_inspire_ch` IN ({wanted})" if logged_changes(context)
                          else f"(l.`_inspire_lk` IS NOT NULL AND (o.`_inspire_ok` IS NULL OR {_moved(context)}))")
        early |= {"c", "h"}
    picked, joins = ["d.*"], ""
    if "c" in early:
        join, columns = _current_join(context, "d")
        picked, joins = picked + columns, joins + join
    if "h" in early:
        picked, joins = picked + _change_columns(context), joins + _change_joins(context, "c.`_inspire_key`", "0")
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    ctes["f"] = f"SELECT {', '.join(picked)} FROM d{joins}{where}"
    counted = ["d"] + (["c"] if "c" in early else []) + (["r", "n", "l0", "o0", "p0"] if "h" in early else []) + ["f"]
    return {"ctes": ctes, "context": context, "early": early, "counted": counted, "today": today}


def ai_counts_query(page: dict, values: dict, context: dict, columns=None) -> tuple:
    params = _Params()
    listed, money = _listed(page, values, columns, context, params)
    ctes = {"d": listed, "c": _current_cte(dict(context, money=context["money"] if money else []))}
    where = f" WHERE {' AND '.join(money)}" if money else ""
    counts = " UNION ALL ".join(f"SELECT '{name}' AS f, {_ai_value(name)} AS v, COUNT(*) AS n FROM d LEFT JOIN c ON "
                                f"{_current_on(context, 'd')}{where} GROUP BY {_ai_value(name)}" for name in context["categories"])
    return f"{_with(ctes, ['d', 'c'])} {counts}", params.items


def facts_query(page: dict) -> tuple:
    params = _Params()
    scope = f"`use_case_id` = {params.add(str(page['use_case_id']))} AND " if page.get("use_case_id") else ""
    return (f"SELECT `{RUN_FACTS_COLUMN}` FROM {table_name(str(page['result_table']).strip() + SUMMARY_SUFFIX)} WHERE {scope}"
            f"`{RUN_FACTS_COLUMN}` IS NOT NULL ORDER BY `updated_at` DESC NULLS LAST LIMIT 1", params.items)


def facts_runs(facts) -> list:
    out = []
    for row in (facts or {}).get("runs") or []:
        micros = int(row.get("ran_us") or 0)
        stamp = datetime.datetime.fromtimestamp(micros // 1_000_000, datetime.timezone.utc)
        out.append({"run_id": None if row.get("run_id") is None else str(row["run_id"]), "tier": row.get("tier"),
                    "as_of_date": row.get("as_of_date"), "ran_at": stamp.strftime("%Y-%m-%dT%H:%M:%S") + f".{micros % 1_000_000 // 1000:03d}Z",
                    "n": int(row.get("n") or 0)})
    return out


def summary_query(page: dict, limit: int = 1, run_ids=None, index: bool = False) -> tuple:
    params = _Params()
    conditions = [f"`use_case_id` = {params.add(str(page['use_case_id']))}"] if page.get("use_case_id") else []
    if run_ids is not None:
        holder = params.add(json.dumps([str(r) for r in run_ids], ensure_ascii=False))
        conditions.append(f"CAST(`run_id` AS STRING) IN (SELECT explode(from_json({holder}, 'ARRAY<STRING>')))")
    picked = "CAST(`run_id` AS STRING) AS `run_id`, `updated_at`" if index else "*"
    scope = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    return (f"SELECT {picked} FROM {table_name(str(page['result_table']).strip() + SUMMARY_SUFFIX)}{scope} "
            f"ORDER BY `updated_at` DESC NULLS LAST LIMIT {int(limit)}", params.items)


def _expression_tree(text: str):
    tokens, at = [], 0
    while text[at:].strip():
        match = VALUE_TOKEN.match(text, at)
        if not match:
            raise ValueError(f"{text[at:].strip()[:20]!r} is not a number, a name, + - * / ( ) or a comma")
        number, name, sign = match.groups()
        tokens.append(("number", number) if number else ("name", name) if name else ("sign", sign))
        at = match.end()
    spot = [0]
    peek = lambda: tokens[spot[0]] if spot[0] < len(tokens) else (None, None)

    def take(want=None):
        token = peek()
        if token[0] is None or (want and token != want):
            raise ValueError(f"expected {want[1] if want else 'more'} at {token[1] or 'the end'}")
        spot[0] += 1
        return token

    def factor():
        kind, word = peek()
        if (kind, word) == ("sign", "-"):
            take()
            return ("negative", factor())
        if (kind, word) == ("sign", "("):
            take()
            inner = expression()
            take(("sign", ")"))
            return inner
        if kind == "number":
            return ("number", float(take()[1]))
        if kind != "name":
            raise ValueError(f"expected a number, a name or ( at {word or 'the end'}")
        take()
        if peek() != ("sign", "("):
            if word.lower() in VALUE_FUNCTIONS:
                raise ValueError(f"{word} is a function")
            if not IDENT.match(word):
                raise ValueError(f"{word[:20]}... is longer than 63 characters")
            return ("name", word)
        if word.lower() not in VALUE_FUNCTIONS:
            raise ValueError(f"{word}( ) is not greatest( ) or least( )")
        take()
        args = [expression()]
        while peek() == ("sign", ","):
            take()
            args.append(expression())
        take(("sign", ")"))
        if len(args) < 2:
            raise ValueError(f"{word}( ) needs at least two values")
        return ("call", word.lower(), args)

    def term():
        node = factor()
        while peek() in (("sign", "*"), ("sign", "/")):
            node = ("operation", take()[1], node, factor())
        return node

    def expression():
        node = term()
        while peek() in (("sign", "+"), ("sign", "-")):
            node = ("operation", take()[1], node, term())
        return node

    tree = expression()
    if spot[0] != len(tokens):
        raise ValueError(f"unexpected {tokens[spot[0]][1]}")
    return tree


def _expression_names(tree) -> list:
    if tree[0] == "name":
        return [tree[1]]
    if tree[0] == "negative":
        return _expression_names(tree[1])
    if tree[0] == "operation":
        return _expression_names(tree[2]) + _expression_names(tree[3])
    if tree[0] == "call":
        return [n for arg in tree[2] for n in _expression_names(arg)]
    return []


def _expression_sql(tree, named) -> str:
    if tree[0] == "number":
        return repr(tree[1])
    if tree[0] == "name":
        return named(tree[1])
    if tree[0] == "negative":
        return f"(- {_expression_sql(tree[1], named)})"
    if tree[0] == "call":
        return f"{tree[1].upper()}({', '.join(_expression_sql(arg, named) for arg in tree[2])})"
    left, right = _expression_sql(tree[2], named), _expression_sql(tree[3], named)
    return f"({left} / NULLIF({right}, 0))" if tree[1] == "/" else f"({left} {tree[1]} {right})"


def as_number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _assumption_list(raw) -> list:
    try:
        listed = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return []
    out = []
    for at, item in enumerate(listed if isinstance(listed, list) else []):
        name, number = str((item or {}).get("name") or ""), as_number((item or {}).get("value"))
        kind = (item or {}).get("kind") if (item or {}).get("kind") in VALUE_KINDS else "number"
        if IDENT.match(name) and number is not None and name not in {a["name"] for a in out}:
            low, high = as_number((item or {}).get("low")), as_number((item or {}).get("high"))
            declared = {"low": low, "high": high} if low is not None and high is not None and low <= high else {}
            out.append(dict({"name": name, "kind": kind, "run_value": number, "at": at}, **declared))
    return out


def assumption_value(value):
    number = as_number(value)
    return number if number is not None and abs(number) < CAPS["assumption_limit"] else None


def money_model(summary, fields, edits=()) -> dict:
    run = summary or {}
    numeric = {f["name"].lower(): f["name"] for f in fields or [] if f.get("kind") in ("integer", "decimal") and IDENT.match(f["name"])}
    known = {f["name"].lower() for f in fields or []}
    assumptions = [a for a in _assumption_list(run.get("value_assumptions")) if a["name"].lower() not in known]
    positions = {a["name"]: a.pop("at") for a in assumptions}
    latest = {}
    for edit in edits or []:
        name = str(edit.get("name") or "")
        if name not in latest and assumption_value(edit.get("value")) is not None:
            latest[name] = edit
    for a in assumptions:
        edit = latest.get(a["name"])
        if edit and setting_problem(assumption_setting(a["name"], a["kind"], a.get("low"), a.get("high")), number_text(as_number(edit["value"]))):
            edit = None
        a["setting"] = assumption_setting(a["name"], a["kind"], a.get("low"), a.get("high"))
        a.update(value=as_number(edit["value"]) if edit else a["run_value"], changed_by=str((edit or {}).get("changed_by") or ""),
                 changed_at=(edit or {}).get("changed_at"), note=str((edit or {}).get("note") or ""))
    by_name = {a["name"]: a for a in assumptions}
    template = " ".join(str(run.get("value_formula") or "").split())
    parts, columns, at = [], [], 0
    for match in VALUE_PLACEHOLDER.finditer(template):
        parts.append({"text": template[at:match.start()]})
        at = match.end()
        name, kind = match.group(1).strip(), (match.group(2) or "number").strip()
        kind = kind if kind in VALUE_KINDS else "number"
        if name.lower() in numeric:
            columns.append(numeric[name.lower()])
            parts.append({"column": numeric[name.lower()], "kind": kind})
        elif name in by_name:
            parts.append({"assumption": name, "kind": kind})
        else:
            parts.append({"text": match.group(0)})
    parts.append({"text": template[at:]})
    said = any(f["name"] == VALUE_FORMULA for f in fields or [])
    model = {"currency": str(run.get("currency") or ""), "unit": impact_unit(run), "impact_kind": impact_of(run)["kind"],
             "basis": str(run.get("decision_basis") or ""),
             "act_now_amount": as_number(run.get("act_now_amount")), "review_amount": as_number(run.get("review_amount")),
             "template": template, "parts": [p for p in parts if p != {"text": ""}], "columns": list(dict.fromkeys(columns)),
             "inputs": "columns" if columns else "said" if said else "", "assumptions": assumptions, "expression": None,
             "recomputes": False, "changed": any(a["value"] != a["run_value"] for a in assumptions), "problem": "", "_numeric": numeric,
             "_at": positions}
    text = " ".join(str(run.get("value_expression") or "").split())
    impact = impact_of(summary) if summary else None
    stake, noun = stake_words(impact), stake_noun(impact)
    if not assumptions:
        model["problem"] = f"the {stake} formula of this use case names no assumption"
    elif not text:
        model["problem"] = f"the notebook was built before the App could work out the {noun} again; {rebuild_action(f'its {stake} formula')}"
    elif len(text) > VALUE_EXPRESSION_CHARS:
        model["problem"] = f"the {stake} arithmetic is {plural(len(text), 'character')}; the App reads at most {VALUE_EXPRESSION_CHARS}"
    else:
        try:
            tree = _expression_tree(text)
        except ValueError as error:
            model["problem"] = f"the {stake} arithmetic cannot be read: {error}"
            return model
        names = list(dict.fromkeys(_expression_names(tree)))
        unknown = [n for n in names if n.lower() not in numeric and n not in by_name]
        used = {n for n in names if n in by_name}
        if unknown:
            model["problem"] = f"the {stake} arithmetic names {', '.join(unknown)}, which is neither a number column nor an assumption"
        elif used != set(by_name):
            model["problem"] = (f"the {stake} arithmetic leaves out {', '.join(n for n in by_name if n not in used)}, so changing "
                                f"it would not change the {noun}")
        elif not any(n.lower() in numeric for n in names):
            model["problem"] = f"the {stake} arithmetic names no column of the records, so every record would get the same {noun}"
        else:
            model.update(expression=text, recomputes=True, _tree=tree)
    return model


def number_text(value) -> str:
    return ("%.10f" % (float(value) + 0.0)).rstrip("0").rstrip(".")


def public_money(model):
    return {k: v for k, v in model.items() if not k.startswith("_")} if model else None


def money_sql(model, alias: str = "", live: bool = False) -> str:
    stake = f"{alias + '.' if alias else ''}{quote(MONEY_COLUMN)}"
    if not model or not model.get("recomputes") or not (live or model.get("changed")):
        return f"CAST({stake} AS DOUBLE)"
    numeric, order = model["_numeric"], {a["name"]: i for i, a in enumerate(model["assumptions"])}
    values = {a["name"]: f"{MONEY_VALUES}.`_inspire_v{order[a['name']]}`" if live else repr(float(a["value"])) for a in model["assumptions"]}
    named = lambda n: f"CAST({alias + '.' if alias else ''}{quote(numeric[n.lower()])} AS DOUBLE)" if n.lower() in numeric else values[n]
    worked = _expression_sql(model["_tree"], named)
    if live:
        return f"CASE WHEN {stake} IS NULL THEN NULL WHEN {MONEY_VALUES}.`_inspire_changed` THEN {worked} ELSE CAST({stake} AS DOUBLE) END"
    return f"CASE WHEN {stake} IS NULL THEN NULL ELSE {worked} END"


def money_values_sql(model, result_table: str, use_case: str) -> str:
    if not model or not model.get("recomputes"):
        return ""
    edits, summary = table_name(str(result_table).strip() + ASSUMPTIONS_SUFFIX), table_name(str(result_table).strip() + SUMMARY_SUFFIX)
    scope, cells, pairs = sql_text(use_case), [], []
    for i, a in enumerate(model["assumptions"]):
        name, path = sql_text(a["name"]), f"$[{model['_at'][a['name']]}]"
        cells.append(f"(SELECT CAST(a.`value` AS DOUBLE) FROM {edits} AS a WHERE a.`use_case_id` = {scope} AND a.`name` = {name} AND "
                     f"ABS(a.`value`) < {CAPS['assumption_limit']!r} ORDER BY {assumption_order('a')} LIMIT 1) AS `_inspire_e{i}`")
        cells.append(f"COALESCE((SELECT CASE WHEN get_json_object(s.`value_assumptions`, '{path}.name') = {name} THEN "
                     f"CAST(get_json_object(s.`value_assumptions`, '{path}.value') AS DOUBLE) END FROM {summary} AS s WHERE s.`use_case_id` = "
                     f"{scope} ORDER BY s.`updated_at` DESC NULLS LAST LIMIT 1), {float(a['run_value'])!r}) AS `_inspire_r{i}`")
        bounded = assumption_setting(a["name"], a["kind"], a.get("low"), a.get("high"))
        inside = " AND ".join(f"w.`_inspire_e{i}` {sign} {float(bounded[key])!r}" for key, sign in (("low", ">="), ("high", "<="))
                              if bounded[key] is not None)
        held = f"CASE WHEN {inside} THEN w.`_inspire_e{i}` END" if inside else f"w.`_inspire_e{i}`"
        pairs.append((f"COALESCE({held}, w.`_inspire_r{i}`)", f"w.`_inspire_r{i}`"))
    values = ", ".join(f"{value} AS `_inspire_v{i}`" for i, (value, _run) in enumerate(pairs))
    changed = " OR ".join(f"{value} <> {run}" for value, run in pairs)
    return f"SELECT {values}, ({changed}) AS `_inspire_changed` FROM (SELECT {', '.join(cells)}) AS w"


def money_inputs_sql(model, alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    if (model or {}).get("inputs") == "said":
        return f"CAST({prefix}{quote(VALUE_FORMULA)} AS STRING)"
    if (model or {}).get("inputs") != "columns":
        return "CAST(NULL AS STRING)"
    return "concat_ws('|', " + ", ".join(f"COALESCE(CAST({prefix}{quote(c)} AS STRING), '')" for c in model["columns"]) + ")"


def money_columns(model) -> list:
    if not model:
        return []
    return [f"{money_sql(model)} AS `_inspire_money`", f"{money_inputs_sql(model)} AS `_inspire_fx`"]


ALERT_THRESHOLD_SETTING = "alert_threshold"


def setting_value_sql(result_table: str, use_case_id: str, name: str) -> str:
    return (f"(SELECT CAST(a.`value` AS DOUBLE) FROM {table_name(str(result_table).strip() + ASSUMPTIONS_SUFFIX)} AS a WHERE "
            f"a.`use_case_id` = {sql_text(use_case_id)} AND a.`name` = {sql_text(name)} ORDER BY {assumption_order('a')} LIMIT 1)")


def threshold_setting_sql(result_table: str, use_case_id: str, threshold) -> str:
    saved = setting_value_sql(result_table, use_case_id, ALERT_THRESHOLD_SETTING)
    return f"COALESCE(CASE WHEN {saved} >= 0 THEN {saved} END, {float(threshold)!r})"


def assumption_order(alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    return f"{prefix}`changed_at` DESC, {prefix}`value` DESC"


def assumptions_table(page: dict) -> str:
    return table_name(str(page["result_table"]).strip() + ASSUMPTIONS_SUFFIX)


def usage_query(page: dict, since: str) -> tuple:
    params = _Params()
    scope = f"`use_case_id` = {params.add(str(page['use_case_id']))} AND " if page.get("use_case_id") else ""
    return (f"SELECT CAST(`changed_by` AS STRING) AS `who`, CAST(`change_source` AS STRING) AS `what`, COUNT(*) AS `n`, MAX(`valid_from`) "
            f"AS `at` FROM {table_name(page['result_table'])} WHERE {scope}`change_source` IN ({_sql_list(PEOPLE_SOURCES)}) AND "
            f"CAST(`valid_from` AS DATE) >= {params.add(since, 'DATE')} GROUP BY `changed_by`, `change_source`", params.items)


def assumption_usage_query(page: dict, since: str) -> tuple:
    params = _Params()
    return (f"SELECT CAST(`changed_by` AS STRING) AS `who`, 'assumption' AS `what`, COUNT(*) AS `n`, MAX(`changed_at`) AS `at` FROM "
            f"{assumptions_table(page)} WHERE `use_case_id` = {params.add(str(page.get('use_case_id') or ''))} AND CAST(`changed_at` AS "
            f"DATE) >= {params.add(since, 'DATE')} GROUP BY `changed_by`", params.items)


def assumptions_query(page: dict, limit: int = CAPS["assumption_rows"]) -> tuple:
    params = _Params()
    return (f"SELECT * FROM {assumptions_table(page)} WHERE `use_case_id` = "
            f"{params.add(str(page.get('use_case_id') or ''))} ORDER BY {assumption_order()} LIMIT {int(limit)}", params.items)


def assumption_write(page: dict, name: str, value, editor: str, note: str, text=None) -> tuple:
    params = _Params()
    cells = [params.add(str(page.get("use_case_id") or "")), params.add(name)]
    cells += ["CAST(NULL AS DOUBLE)" if value is None else params.add(repr(float(value)), "DOUBLE"), params.add(editor),
              "current_timestamp()", params.add(note)] + ([] if text is None else [params.add(str(text))])
    return (f"INSERT INTO {assumptions_table(page)} (`use_case_id`, `name`, `value`, `changed_by`, `changed_at`, `note`"
            f"{'' if text is None else ', `text_value`'}) VALUES ({', '.join(cells)})", params.items)


SETTING_GROUPS = ("impact", "flagging", "scope", "alerts")
SETTING_KINDS = ("money", "number", "integer", "percent", "choice", "days")
SETTING_SOURCES = ("widget", "alert")
SETTING_ALL = "all"
SETTING_NUMBER = re.compile(r"^-?[0-9]+(?:\.[0-9]+)?$")
SETTINGS_CAP = 80
SETTING_TEXTS = ("label", "help", "reason", "unit", "allowed", "default", "applies")
TIER_CUTOFFS = ("act_now_amount", "review_amount")
TIER_SHARES = ("act_now_share", "review_share")
SEGMENT_CHOICES = 50
ASSUMPTION_BOUNDS = {"percent": (0.0, 1.0, "0 to 1"), "money": (0.0, None, "at least 0"), "number": (None, None, "any number")}


def page_settings_problems(settings) -> list:
    if settings is None:
        return []
    if not isinstance(settings, list) or len(settings) > SETTINGS_CAP:
        return [f"the page settings must be a list of at most {SETTINGS_CAP} settings"]
    problems, seen = [], set()
    for at, item in enumerate(settings, 1):
        where = f"page setting {at}"
        if not isinstance(item, dict):
            problems.append(f"{where} is not an object")
            continue
        name = item.get("name")
        if not isinstance(name, str) or not IDENT.match(name) or name in seen:
            problems.append(f"{where} needs a name of its own, of letters, digits and _")
            continue
        seen.add(name)
        for key, allowed in (("group", SETTING_GROUPS), ("kind", SETTING_KINDS), ("source", SETTING_SOURCES)):
            if item.get(key) not in allowed:
                problems.append(f"setting {name}: {key} must be one of {', '.join(allowed)}")
        problems += [f"setting {name}: {key} must be a number or null" for key in ("low", "high")
                     if item.get(key) is not None and as_number(item.get(key)) is None]
        problems += [f"setting {name}: {key} must be text" for key in SETTING_TEXTS if item.get(key) is not None and not isinstance(item[key], str)]
        choices = item.get("choices") if item.get("choices") is not None else []
        if not isinstance(choices, list) or not all(isinstance(c, str) for c in choices):
            problems.append(f"setting {name}: choices must be a list of text")
        if item.get("reads_setting") is not None and not isinstance(item["reads_setting"], bool):
            problems.append(f"setting {name}: reads_setting must be true or false")
    return problems


def setting_problem(setting: dict, value) -> str:
    setting = setting or {}
    name, text = str(setting.get("name") or ""), str("" if value is None else value).strip()
    if setting.get("kind") == "choice":
        choices = [str(c) for c in setting.get("choices") or []]
        picked = [part.strip() for part in text.split(",") if part.strip()] if setting.get("many") else [text]
        allowed = choices + ([SETTING_ALL] if setting.get("many") else [])
        if (not text and not setting.get("optional")) or [part for part in picked if choices and part not in allowed]:
            return f"{name} is '{text}'; allowed: {', '.join(allowed) if choices else 'any text'}"
        alone = [part for part in picked if part in (setting.get("solo") or [])]
        if alone and len(picked) > 1:
            return f"{name} is '{text}'; {' and '.join(alone)} stand{'s' if len(alone) == 1 else ''} alone, never with another choice"
        return ""
    low, high, whole = as_number(setting.get("low")), as_number(setting.get("high")), bool(setting.get("whole"))
    low_open, high_open = bool(setting.get("low_open")), bool(setting.get("high_open"))
    number = float(text) if SETTING_NUMBER.match(text) and not (whole and "." in text) else None
    if number is None or (low is not None and (number <= low if low_open else number < low)) or (
            high is not None and (number >= high if high_open else number > high)):
        return f"{name} is '{text}'; allowed: {setting.get('allowed') or 'a number'}"
    return ""


def assumption_setting(name: str, kind: str, low=None, high=None) -> dict:
    kind = kind if kind in ASSUMPTION_BOUNDS else "number"
    if as_number(low) is not None and as_number(high) is not None:
        return {"name": name, "kind": kind, "low": float(low), "high": float(high), "allowed": f"{number_text(low)} to {number_text(high)}"}
    base_low, base_high, allowed = ASSUMPTION_BOUNDS[kind]
    return {"name": name, "kind": kind, "low": base_low, "high": base_high, "allowed": allowed}


def setting_set_problems(values: dict) -> list:
    numbers = {name: float(text) for name, text in values.items() if SETTING_NUMBER.match(str(text if text is not None else "").strip())}
    problems = []
    if all(name in numbers for name in TIER_SHARES) and sum(numbers[name] for name in TIER_SHARES) > 1 + 1e-9:
        problems.append(f"act_now_share + review_share is {number_text(sum(numbers[n] for n in TIER_SHARES))}; allowed: at most 1")
    if all(name in numbers for name in TIER_CUTOFFS) and numbers["review_amount"] > numbers["act_now_amount"]:
        problems.append(f"review_amount is {number_text(numbers['review_amount'])}, above act_now_amount "
                        f"{number_text(numbers['act_now_amount'])}; a record needs at least as much at stake to act on now as to review")
    for low_name in sorted(numbers):
        high_name = "max_" + low_name[4:]
        if low_name.startswith("min_") and high_name in numbers and numbers[low_name] > numbers[high_name]:
            problems.append(f"{low_name} is {number_text(numbers[low_name])}, above {high_name} {number_text(numbers[high_name])}")
    return problems


def flagged_ok_sql(names, segments=()) -> str:
    ok = "`data_quality_flag` = 'ok'" if "data_quality_flag" in names else "TRUE"
    if segments and "segment_or_item" in names:
        ok += " AND CAST(`segment_or_item` AS STRING) IN (" + ", ".join(sql_text(str(s)) for s in segments) + ")"
    return ok


def amount_tier_sql(stake: str, cutoffs: tuple, segments, names) -> str:
    ok = flagged_ok_sql(names, segments)
    act_now, review = (float(c) for c in cutoffs)
    return (f"CASE WHEN {ok} AND {stake} >= {act_now!r} THEN 'Act now' WHEN {ok} AND {stake} >= {review!r} THEN 'Review' "
            "ELSE 'Monitor' END")


def share_cuts(shares, passed: int) -> tuple:
    act_now, review = (float(s) for s in shares)
    return int(math.floor(act_now * passed + 1e-9)), int(math.floor((act_now + review) * passed + 1e-9))


def share_tier_sql(cuts: tuple, names) -> str:
    ok = flagged_ok_sql(names)
    return (f"CASE WHEN {ok} AND `rank` <= {int(cuts[0])} THEN 'Act now' WHEN {ok} AND `rank` <= {int(cuts[1])} THEN 'Review' "
            "ELSE 'Monitor' END")


def tier_preview_query(page: dict, moved: str, cap: int, names) -> tuple:
    params = _Params()
    held = "COALESCE(`held_back`, FALSE)" if "held_back" in names else "FALSE"
    was = (f"CASE WHEN {held} THEN CAST(`run_tier` AS STRING) ELSE CAST(`priority_tier` AS STRING) END"
           if {"held_back", "run_tier"} <= set(names) else "CAST(`priority_tier` AS STRING)")
    landed = "`_inspire_moved`"
    if cap:
        seated = f"{landed} = 'Act now' AND NOT `_inspire_held`" + (" AND NOT `_inspire_dismissed`" if "action_status" in names else "")
        order = ("`rank` ASC NULLS LAST, " if "rank" in names else "") + "`record_key` ASC"
        landed = (f"CASE WHEN {seated} AND ROW_NUMBER() OVER (PARTITION BY CASE WHEN {seated} THEN 1 ELSE 0 END ORDER BY {order}) > "
                  f"{int(cap)} THEN 'Review' ELSE `_inspire_moved` END")
    dismissed = ", COALESCE(`action_status` = 'Dismissed', FALSE) AS `_inspire_dismissed`" if "action_status" in names else ""
    keyed = ", `rank`" if "rank" in names else ""
    scope = params.add(str(page.get("use_case_id") or ""))
    rows = (f"SELECT {was} AS `_inspire_from`, {moved} AS `_inspire_moved`, {held} AS `_inspire_held`{dismissed}, `record_key`{keyed} "
            f"FROM {table_name(page['result_table'])} WHERE {CURRENT_ROWS} AND `use_case_id` = {scope}")
    return (f"SELECT `_inspire_from`, `_inspire_to`, COUNT(*) AS `_inspire_n` FROM (SELECT `_inspire_from`, {landed} AS `_inspire_to` "
            f"FROM ({rows}) AS m) AS t GROUP BY `_inspire_from`, `_inspire_to`", params.items)


def segments_query(page: dict, limit: int = SEGMENT_CHOICES) -> tuple:
    params = _Params()
    return (f"SELECT DISTINCT CAST(`segment_or_item` AS STRING) AS `segment` FROM {table_name(page['result_table'])} WHERE {CURRENT_ROWS} "
            f"AND `use_case_id` = {params.add(str(page.get('use_case_id') or ''))} AND `segment_or_item` IS NOT NULL "
            f"ORDER BY `segment` LIMIT {int(limit)}", params.items)


def _overview_select(kind: str, cells: dict, columns=OVERVIEW_COLUMNS) -> str:
    picked = [f"CAST({cells[name]} AS {sql_kind})" if name in cells else f"CAST(NULL AS {sql_kind})" for name, sql_kind in columns]
    return "SELECT " + ", ".join([f"'{kind}' AS `kind`"] + [f"{p} AS {quote(name)}" for p, (name, _k) in zip(picked, columns)])


def _count(condition: str) -> str:
    return f"COUNT(CASE WHEN {condition} THEN 1 END)"


def _sql_list(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def closing_ctes(table: str, names: set, label=None, scope: str = "", history=None) -> dict:
    within = f"{scope} AND " if scope else ""
    acted = f"SELECT `record_key` FROM {table} WHERE {within}`action_status` IS NOT NULL"
    versions = f"{versions_source(table, history, acted)} AS hv" if history else table
    stake = money_sql(None) if MONEY_COLUMN in names else "CAST(NULL AS DOUBLE)"
    named = f"CAST({quote(label)} AS STRING)" if label and label in names else "CAST(NULL AS STRING)"
    comment = "CAST(`action_note` AS STRING)" if "action_note" in names else "CAST(NULL AS STRING)"
    batched = all(n in names for n in BATCH_TYPES)
    batch = (f"CAST(`{BATCH_COLUMN}` AS STRING) AS `_inspire_batch`, NULLIF(TRIM(`{BATCH_NOTE}`), '') AS `_inspire_batch_note`, "
             f"COALESCE(`{BATCH_VALUES}` LIKE '%\"{UNDO_KEY}\"%', FALSE) AS `_inspire_batch_undo`" if batched else
             "CAST(NULL AS STRING) AS `_inspire_batch`, CAST(NULL AS STRING) AS `_inspire_batch_note`, FALSE AS `_inspire_batch_undo`")
    first = "hk.`_inspire_kk` = hx.`record_key` AND hk.`_inspire_kth` = 1"
    gone = _sql_list(GONE_STATES)
    return {
        "hx": (f"SELECT `record_key`, `is_current`, `change_source`, `changed_by`, `action_status`, `action_outcome`, `valid_from`, `valid_to`, "
               f"{stake} AS `_inspire_stake`, CAST(`realized_value` AS DOUBLE) AS `_inspire_realized`, CAST(`realized_note` AS STRING) AS "
               f"`_inspire_note`, CAST(`dismiss_reason` AS STRING) AS `_inspire_reason`, {comment} AS `_inspire_comment`, {batch}, "
               f"{named} AS `_inspire_label`, CAST({quote(KEPT_SINCE)} AS TIMESTAMP) AS `_inspire_missing`, "
               f"ROW_NUMBER() OVER (PARTITION BY `record_key` ORDER BY `valid_from` DESC) AS `_inspire_nth`, LAG(`action_status`) OVER "
               f"(PARTITION BY `record_key` ORDER BY `valid_from`) AS `_inspire_was` FROM {versions} WHERE {within}`record_key` IN ({acted})"),
        "hk": (f"SELECT `record_key` AS `_inspire_kk`, `action_status` AS `_inspire_closed_as`, `valid_from` AS `_inspire_closed`, "
               f"`changed_by` AS `_inspire_closer`, `_inspire_stake` AS `_inspire_at_close`, `_inspire_batch` AS `_inspire_closed_batch`, "
               f"`_inspire_batch_undo` AS `_inspire_closed_undo`, `_inspire_batch_note` AS `_inspire_closed_note`, NULLIF(TRIM(`_inspire_reason`), "
               f"'') AS `_inspire_closed_reason`, NULLIF(TRIM(`_inspire_comment`), '') AS `_inspire_closed_comment`, ROW_NUMBER() OVER "
               f"(PARTITION BY `record_key` ORDER BY `valid_from` DESC) AS `_inspire_kth` FROM hx WHERE `change_source` = 'action' AND "
               f"`action_status` IN ({_sql_list(CLOSED_STATUSES)}) AND COALESCE(`_inspire_was`, '') <> `action_status`"),
        "hr": (f"SELECT hx.`record_key` AS `_inspire_rk`, hx.`_inspire_stake` AS `_inspire_after`, hx.`action_outcome` AS `_inspire_found`, "
               f"ROW_NUMBER() OVER (PARTITION BY hx.`record_key` ORDER BY hx.`valid_from` DESC) AS `_inspire_rth` FROM hx JOIN hk ON {first} "
               f"WHERE hx.`change_source` = 'run' AND hx.`valid_from` > hk.`_inspire_closed`"),
        "hf": (f"SELECT hx.`record_key` AS `_inspire_fk`, MIN(hx.`valid_from`) AS `_inspire_ok` FROM hx JOIN hk ON {first} WHERE "
               f"hx.`change_source` = 'run' AND hx.`action_outcome` = '{RESOLVED}' AND hx.`valid_from` > hk.`_inspire_closed` "
               f"GROUP BY hx.`record_key`"),
        "ho": (f"SELECT l.`record_key` AS `_inspire_k`, l.`_inspire_label`, l.`action_status` AS `_inspire_status`, k.`_inspire_closed`, "
               f"k.`_inspire_closer`, k.`_inspire_at_close`, l.`_inspire_realized`, NULLIF(TRIM(l.`_inspire_note`), '') AS `_inspire_note`, "
               f"NULLIF(TRIM(l.`_inspire_reason`), '') AS `_inspire_reason`, CASE WHEN NOT l.`is_current` THEN 'left' WHEN "
               f"l.`_inspire_missing` IS NOT NULL THEN 'missing' WHEN r.`_inspire_found` = '{RESOLVED}' THEN 'resolved' WHEN "
               f"r.`_inspire_found` = '{STILL_FLAGGED}' THEN 'flagged' ELSE 'unchecked' END AS `_inspire_state`, CASE WHEN NOT "
               f"l.`is_current` OR l.`_inspire_missing` IS NOT NULL THEN 0 ELSE r.`_inspire_after` END AS `_inspire_now`, "
               f"COALESCE(f.`_inspire_ok`, CASE WHEN NOT l.`is_current` THEN l.`valid_to` ELSE l.`_inspire_missing` END) AS `_inspire_seen` "
               f"FROM hx AS l JOIN hk AS k "
               f"ON k.`_inspire_kk` = l.`record_key` AND k.`_inspire_kth` = 1 AND k.`_inspire_closed_as` = l.`action_status` LEFT JOIN hr AS r "
               f"ON r.`_inspire_rk` = l.`record_key` AND r.`_inspire_rth` = 1 LEFT JOIN hf AS f ON f.`_inspire_fk` = l.`record_key` WHERE "
               f"l.`_inspire_nth` = 1 AND l.`change_source` <> 'delete'"),
        "hm": (f"SELECT o.*, CASE WHEN o.`_inspire_status` = '{DONE}' AND o.`_inspire_state` IN ({gone}) THEN 1 ELSE 0 END AS "
               f"`_inspire_measured_ok`, CASE WHEN o.`_inspire_status` = '{DONE}' AND o.`_inspire_state` IN ({gone}) AND "
               f"o.`_inspire_at_close` IS NOT NULL THEN GREATEST(o.`_inspire_at_close` - COALESCE(o.`_inspire_now`, 0), 0) END AS "
               f"`_inspire_measured` FROM ho AS o"),
    }


CLOSING_ORDER = ("hx", "hk", "hr", "hf", "ho", "hm")
CLOSED_FIELDS = {"_inspire_closed_by": "_inspire_closer", "_inspire_closed_at": "_inspire_closed", "_inspire_closed_batch": "_inspire_closed_batch",
                 "_inspire_closed_undo": "_inspire_closed_undo", "_inspire_closed_note": "_inspire_closed_note",
                 "_inspire_closed_reason": "_inspire_closed_reason", "_inspire_closed_comment": "_inspire_closed_comment"}


def use_case_scope(page: dict, params) -> str:
    return f"`use_case_id` = {params.add(str(page['use_case_id']))}" if page.get("use_case_id") else ""


def closed_query(page: dict, table: str, keys: list, names: set, history=None) -> tuple:
    params = _Params()
    within = use_case_scope(page, params)
    scope = f"{within + ' AND ' if within else ''}`record_key` IN ({', '.join(params.add(str(k)) for k in keys)})"
    ctes = closing_ctes(table, names, scope=scope, history=history)
    picked = ", ".join(f"z.`{source}` AS `{field}`" for field, source in CLOSED_FIELDS.items())
    return (f"{_with(ctes, ['hx', 'hk'])} SELECT z.`_inspire_kk` AS `record_key`, z.`_inspire_closed_as` AS `_inspire_status`, {picked} FROM hk AS z "
            f"WHERE z.`_inspire_kth` = 1", params.items)


def overview_query(page: dict, values: dict, picked: dict, context: dict, fields: list, quarter: str, since: str, model=None,
                   window=None, done_between: tuple = ()) -> tuple:
    records = page.get("records") or {}
    names = {f["name"] for f in fields}
    money, held = MONEY_COLUMN in names, "held_back" in names
    table, params = context["table"], _Params()
    priced = money_columns(model) or [f"{money_sql(None)} AS `_inspire_money`", "CAST(NULL AS STRING) AS `_inspire_fx`"]
    extra = (priced if money else []) + (
        list(WINDOW_EXTRA) if window else ["CAST(`action_due` AS DATE) AS `_inspire_due`"]) + (
        ["CAST(`held_back` AS BOOLEAN) AS `_inspire_held`"] if held else [])
    ctes = {"d": f"SELECT * FROM ({_dataset(page, RECORDS_DATASET)}) AS d{_where(page, RECORDS_DATASET, values, params)}",
            "c": _current_cte(dict(context, actions=True), extra)}
    tier = f"CAST(d.{quote(records['tier'])} AS STRING)" if records.get("tier") else None
    due = "c.`_inspire_due`"
    tiers, opened = ", ".join(f"'{t}'" for t in FLAGGED_TIERS), ", ".join(f"'{s}'" for s in OPEN_STATUSES)
    flagged = f"{tier} IN ({tiers})" if tier else "FALSE"
    conditions = [f"({flagged} OR {due} IS NOT NULL)", f"COALESCE(c.`_inspire_status`, 'New') IN ({opened})"]
    if held:
        conditions.append("NOT COALESCE(c.`_inspire_held`, FALSE)")
    conditions += [f"{_ai_value(name)} IN ({', '.join(params.add(v) for v in chosen)})" for name, chosen in picked.items()]
    ranked, top = "`money` DESC NULLS LAST, `k` ASC", CAPS["overview_rows"]
    if window:
        today = params.add(window["today"], "DATE")
        conditions += window_conditions(window, params, held, today)[1:]
        ranked = window_order("`money`", "`day`", today, "`k`")
        top = min(top, int(window.get("limit") or top))
    item = {"k": f"COALESCE(c.`_inspire_key`, CAST(d.{quote(records['key'])} AS STRING))", "label": f"d.{quote(records['label'])}",
            "n": "COUNT(*) OVER ()"}
    item.update({k: v for k, v in (("why", "c.`_inspire_ai_explanation`" if "ai_explanation" in context["ai"] else None),
                                   ("owner", "c.`_inspire_owner`"), ("tier", tier), ("status", "c.`_inspire_status`"),
                                   ("reason", _ai_value(context["categories"][0]) if context["categories"] else None),
                                   ("money", "c.`_inspire_money`" if money else None), ("day", due),
                                   ("fx", "c.`_inspire_fx`" if money else None),
                                   ("missing", "c.`_inspire_missing`")) if v})
    ctes["i"] = (f"{_overview_select('item', item)} FROM d LEFT JOIN c ON {_current_on(context, 'd')} WHERE {' AND '.join(conditions)} "
                 f"ORDER BY {ranked} LIMIT {top}")
    branches = ["SELECT * FROM i"]
    history = context.get("history")
    ctes.update(closing_ctes(table, names, scope=use_case_scope(page, params), history=history))
    start, first = params.add(quarter, "DATE"), params.add(since, "DATE")
    fixed, gone, ok = f"v.`_inspire_status` = '{DONE}'", f"v.`_inspire_status` = '{DISMISSED}'", "v.`_inspire_measured_ok` = 1"
    acted, saved = f"CAST(v.`_inspire_closed` AS DATE) >= {start}", f"CAST(v.`_inspire_seen` AS DATE) >= {start}"
    stats = (("fixed", {"n": _count(fixed), "at": f"MIN(CASE WHEN {fixed} THEN v.`_inspire_closed` END)"}),
             ("fixed_q", {"n": _count(f"{fixed} AND {acted}")}),
             ("dismissed", {"n": _count(gone)}),
             ("dismissed_q", {"n": _count(f"{gone} AND {acted}")}),
             ("saved", {"n": _count(ok), "money": f"SUM(CASE WHEN {ok} THEN v.`_inspire_measured` END)",
                        "at": f"MIN(CASE WHEN {ok} THEN v.`_inspire_seen` END)"}),
             ("saved_q", {"n": _count(f"{ok} AND {saved}"), "money": f"SUM(CASE WHEN {ok} AND {saved} THEN v.`_inspire_measured` END)"}))
    branches += [f"{_overview_select(kind, cells)} FROM hm AS v" for kind, cells in stats]
    day = "CAST(v.`_inspire_seen` AS DATE)"
    branches.append(f"{_overview_select('day', {'n': 'COUNT(*)', 'money': 'SUM(v.`_inspire_measured`)', 'day': day})} FROM hm AS v "
                    f"WHERE {ok} AND {day} >= {first} GROUP BY {day}")
    if done_between:
        who, closed = "lower(v.`_inspire_closer`)", "unix_micros(v.`_inspire_closed`)"
        since_us, until_us = (params.add(str(us), "BIGINT") for us in done_between)
        ctes["hn"] = (f"SELECT {who} AS `_inspire_who`, COUNT(*) AS `_inspire_n` FROM hm AS v WHERE {fixed} AND {closed} >= {since_us} AND "
                      f"{closed} < {until_us} GROUP BY {who} ORDER BY `_inspire_n` DESC, `_inspire_who` ASC LIMIT {CAPS['closers_today']}")
        branches.append(f"{_overview_select('mine', {'k': 'n.`_inspire_who`', 'n': 'n.`_inspire_n`'})} FROM hn AS n")
    source, ran, only = (history["log"], "`ran_at`", "") if history else (table, "`valid_from`", " WHERE `change_source` = 'run'")
    ctes["r"] = (f"SELECT CAST(`run_id` AS STRING) AS `_inspire_run`, MIN({ran}) AS `_inspire_ran`, MAX(CAST(`as_of_date` AS DATE)) "
                 f"AS `_inspire_day` FROM {source}{only} GROUP BY CAST(`run_id` AS STRING) ORDER BY "
                 f"`_inspire_ran` DESC LIMIT {OVERVIEW_RUNS}")
    branches.append(f"{_overview_select('run', {'k': 'r.`_inspire_run`', 'at': 'r.`_inspire_ran`', 'day': 'r.`_inspire_day`'})} FROM r")
    return f"{_with(ctes, ['d', 'c', 'i', *CLOSING_ORDER, 'hn', 'r'])} {' UNION ALL '.join(branches)}", params.items


def impact_ctes(table: str, names: set, tier, label, scope: str, since: str, listed: bool = True, model=None, values: str = "",
                history=None) -> tuple:
    within = f"{scope} AND " if scope else ""
    priced = MONEY_COLUMN in names
    stake = money_sql(model, live=bool(values)) if priced else "CAST(NULL AS DOUBLE)"
    held = all(n in names for n in HOLDOUT_TYPES)
    live = f"{within}`is_current` AND `change_source` <> 'delete'"
    ctes = {"hc": f"SELECT COUNT(*) AS `_inspire_n`, {_count('`held_back`') if held else '0'} AS `_inspire_held` FROM {table} WHERE {live}"}
    branches = [f"{_overview_select('current', {'n': '`_inspire_n`', 'hits': '`_inspire_held`'}, IMPACT_COLUMNS)} FROM hc"]
    if tier:
        shown = f"CAST({quote(tier)} AS STRING)"
        opened = f" AND COALESCE(`action_status`, 'New') IN ({_sql_list(OPEN_STATUSES)})"
        joined = f" CROSS JOIN {MONEY_VALUES}" if values and priced else ""
        if joined:
            ctes[MONEY_VALUES] = values
        ctes["he"] = (f"SELECT {shown} AS `_inspire_tier`, COUNT(*) AS `_inspire_n`, SUM({stake}) AS `_inspire_money` FROM {table}{joined} "
                      f"WHERE {live} AND {shown} IN ({_sql_list(FLAGGED_TIERS)}){opened} GROUP BY {shown}")
        branches.append(f"{_overview_select('estimated', {'tier': '`_inspire_tier`', 'n': '`_inspire_n`', 'money': '`_inspire_money`'}, IMPACT_COLUMNS)} "
                        f"FROM he")
    ctes.update(closing_ctes(table, names, label, scope, history))
    fixed, ok = f"v.`_inspire_status` = '{DONE}'", "v.`_inspire_measured_ok` = 1"
    closed, seen = f"CAST(v.`_inspire_closed` AS DATE) >= {since}", f"CAST(v.`_inspire_seen` AS DATE) >= {since}"
    reported = f"{fixed} AND v.`_inspire_realized` IS NOT NULL"
    ctes["hs"] = (f"SELECT v.`_inspire_status`, COUNT(*) AS `_inspire_n`, {_count(closed)} AS `_inspire_since` FROM hm AS v "
                  f"GROUP BY v.`_inspire_status`")
    ctes["hd"] = (f"SELECT v.`_inspire_reason`, COUNT(*) AS `_inspire_n` FROM hm AS v WHERE v.`_inspire_status` = '{DISMISSED}' AND "
                  f"v.`_inspire_reason` IS NOT NULL GROUP BY v.`_inspire_reason` ORDER BY `_inspire_n` DESC, v.`_inspire_reason` "
                  f"LIMIT {IMPACT_REASONS}")
    dated = f"{reported} AND {closed}"
    counted = f"{ok} AND {seen}"
    sums = {"reported": {"n": _count(reported), "n_since": _count(dated),
                         "money": f"SUM(CASE WHEN {reported} THEN v.`_inspire_realized` END)",
                         "money_since": f"SUM(CASE WHEN {dated} THEN v.`_inspire_realized` END)"},
            "measured": {"n": _count(ok), "n_since": _count(counted), "money": f"SUM(CASE WHEN {ok} THEN v.`_inspire_measured` END)",
                         "money_since": f"SUM(CASE WHEN {counted} THEN v.`_inspire_measured` END)"}}
    tallies = {"status": "`_inspire_status`", "n": "`_inspire_n`", "n_since": "`_inspire_since`"}
    branches += [f"{_overview_select('status', tallies, IMPACT_COLUMNS)} FROM hs"]
    branches += [f"{_overview_select(kind, cells, IMPACT_COLUMNS)} FROM hm AS v" for kind, cells in sums.items()]
    branches += [f"{_overview_select('outcome', {'state': 'v.`_inspire_state`', 'n': 'COUNT(*)'}, IMPACT_COLUMNS)} FROM hm AS v WHERE "
                 f"{fixed} GROUP BY v.`_inspire_state`",
                 f"{_overview_select('reason', {'reason': '`_inspire_reason`', 'n': '`_inspire_n`'}, IMPACT_COLUMNS)} FROM hd"]
    if listed:
        ctes["hl"] = (f"SELECT * FROM hm ORDER BY COALESCE(`_inspire_measured`, `_inspire_realized`, 0) DESC, `_inspire_closed` DESC, "
                      f"`_inspire_k` ASC LIMIT {CAPS['impact_rows']}")
        cells = {"k": "`_inspire_k`", "label": "`_inspire_label`", "status": "`_inspire_status`", "state": "`_inspire_state`",
                 "reason": "`_inspire_reason`", "note": "`_inspire_note`", "before": "`_inspire_at_close`", "after": "`_inspire_now`",
                 "money": "`_inspire_measured`", "reported": "`_inspire_realized`", "at": "`_inspire_closed`"}
        branches.append(f"{_overview_select('record', cells, IMPACT_COLUMNS)} FROM hl")
    if held and tier:
        flagged = _sql_list(FLAGGED_TIERS)
        ctes["hh"] = (f"SELECT `record_key` AS `_inspire_hk`, MAX(CASE WHEN `held_back` THEN 1 ELSE 0 END) AS `_inspire_held`, MAX(CASE WHEN "
                      f"`run_tier` IN ({flagged}) THEN 1 ELSE 0 END) AS `_inspire_flagged` FROM "
                      + (f"{history['log']} WHERE {within}" if history else f"{table} WHERE {within}`change_source` = 'run' AND ")
                      + "`held_back` IS NOT NULL GROUP BY `record_key`")
        ctes["hn"] = (f"SELECT `record_key` AS `_inspire_nk`, `run_tier` AS `_inspire_tier`, `change_source` AS `_inspire_src`, "
                      f"CAST({quote(KEPT_SINCE)} AS TIMESTAMP) AS `_inspire_missing` FROM {table} WHERE {within}`is_current`")
        left = (f"hn.`_inspire_nk` IS NULL OR hn.`_inspire_missing` IS NOT NULL OR NOT COALESCE(hn.`_inspire_tier` IN ({flagged}), "
                f"FALSE)")
        ctes["hq"] = (f"SELECT hh.`_inspire_held`, COUNT(*) AS `_inspire_n`, {_count(left)} AS `_inspire_hits` FROM hh LEFT JOIN hn ON "
                      f"hn.`_inspire_nk` = hh.`_inspire_hk` WHERE hh.`_inspire_flagged` = 1 AND COALESCE(hn.`_inspire_src`, '') <> 'delete' "
                      f"GROUP BY hh.`_inspire_held`")
        state = "CASE WHEN `_inspire_held` = 1 THEN 'held' ELSE 'shown' END"
        branches.append(f"{_overview_select('holdout', {'state': state, 'n': '`_inspire_n`', 'hits': '`_inspire_hits`'}, IMPACT_COLUMNS)} FROM hq")
    return ctes, branches


IMPACT_ORDER = (MONEY_VALUES, "hc", "he", *CLOSING_ORDER, "hs", "hd", "hl", "hh", "hn", "hq")


def impact_query(page: dict, fields: list, since: str, model=None, history=None) -> tuple:
    names, records, params = {f["name"] for f in fields}, page.get("records") or {}, _Params()
    tier = records.get("tier") if records.get("tier") in names else None
    scope = use_case_scope(page, params)
    ctes, branches = impact_ctes(table_name(page["result_table"]), names, tier, records.get("label"), scope, params.add(since, "DATE"),
                                 model=model, history=history)
    return f"{_with(ctes, IMPACT_ORDER)} {' UNION ALL '.join(branches)}", params.items


def sql_text(value) -> str:
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def impact_of(summary) -> dict:
    s = summary or {}
    kind = str(s.get("impact_kind") or "").strip().lower()
    currency = " ".join(str(s.get("currency") or "").split())
    if kind not in IMPACT_KINDS:
        return {"kind": "money", "unit": currency} if not currency or currency in MONEY_CODES else {"kind": "number", "unit": currency}
    if kind == "money":
        return {"kind": kind, "unit": currency if currency in MONEY_CODES else ""}
    return {"kind": kind, "unit": " ".join(str(s.get("impact_unit") or "").split())}


def impact_unit(summary) -> str:
    return impact_of(summary)["unit"]


def stake_noun(impact) -> str:
    if not isinstance(impact, dict):
        return "amount"
    if impact.get("kind") == "money":
        return "money"
    return " ".join(str(impact.get("unit") or "").split()) or str(impact.get("kind") or "amount")


def stake_words(impact) -> str:
    return f"{stake_noun(impact)} at stake"


def stake_label(impact) -> str:
    words = stake_words(impact)
    return f"{words[:1].upper()}{words[1:]}"


def _digest_money(amount: str, currency: str, kept: bool) -> str:
    unit = f", {sql_text(' ' + currency)}" if str(currency or "").strip() else ""
    return f"concat(format_number(COALESCE({amount}, 0), 0){unit})" if kept else "'Not measured yet'"


def _digest_count(number: str) -> str:
    return f"CAST(COALESCE({number}, 0) AS STRING)"


def plural(n, one: str, many: str = "") -> str:
    shown = f"{n:,}" if isinstance(n, int) and not isinstance(n, bool) else n
    return f"{shown} {one if n == 1 else many or one + 's'}"


def rebuild_action(what: str = "it", first: bool = False) -> str:
    text = f"build {what} again with Edit MVP on Inspire's Build page"
    return text[:1].upper() + text[1:] if first else text


def _plural_sql(number: str, one: str, many: str) -> str:
    return f"CASE WHEN {number} = 1 THEN {sql_text(one)} ELSE {sql_text(many)} END"


def _reason_sql(reason: str) -> str:
    first, second = f"substr({reason}, 1, 1)", f"substr({reason}, 2, 1)"
    return (f"CASE WHEN {first} BETWEEN 'A' AND 'Z' AND {second} BETWEEN 'a' AND 'z' THEN concat(lower({first}), substr({reason}, 2)) "
            f"ELSE {reason} END")


def _covered_sql(segments: str) -> str:
    parts = f"from_json({segments}, {sql_text(SCOPE_SCHEMA)})"
    shown = f"CASE WHEN TRIM(COALESCE(s.`text`, '')) = '' THEN {sql_text(SCOPE_PART)} ELSE TRIM(s.`text`) END"
    return f"COALESCE(array_join(transform(filter({parts}, s -> s.`scope` IS NOT NULL AND s.`scope` <> 'all'), s -> {shown}), '; '), '')"


def scope_line_sql(table: str, use_case: str = "") -> str:
    scope = f" WHERE `use_case_id` = {sql_text(use_case)}" if use_case else ""
    covered = _covered_sql("l.`segments`")
    return (f"COALESCE((SELECT CASE WHEN {covered} = '' THEN '' ELSE concat({sql_text(SCOPE_SENTENCE.lstrip())}, {covered}, '.') END FROM "
            f"(SELECT CAST(`run_segments` AS STRING) AS `segments` FROM {table_name(str(table).strip() + SUMMARY_SUFFIX)}{scope} ORDER BY "
            f"`updated_at` DESC NULLS LAST LIMIT 1) AS l), '')")


def run_status_query(summary_table: str, use_case: str = "", scopes: bool = False) -> str:
    scope = f" WHERE `use_case_id` = {sql_text(use_case)}" if use_case else ""
    segments = ", CAST(`run_segments` AS STRING) AS `segments`" if scopes else ""
    latest = (f"SELECT 1 AS `seen`, CAST(`not_reliable` AS STRING) AS `unreliable`, CAST(`nothing_to_act` AS STRING) AS `nothing`, "
              f"CAST(`act_now_records` AS BIGINT) AS `act`, CAST(`over_capacity_records` AS BIGINT) AS `over`, "
              f"CAST(`act_now_capacity` AS BIGINT) AS `cap`{segments} FROM {table_name(summary_table)}{scope} ORDER BY `updated_at` DESC "
              f"NULLS LAST LIMIT 1")
    act, over = "COALESCE(l.`act`, 0)", "COALESCE(l.`over`, 0)"
    held = (f"concat('; ', format_number({over}, 0), {_plural_sql(over, ' more record would', ' more records would')}, "
            f"' qualify for Act now, but the team capacity of ', format_number(l.`cap`, 0), ' a run holds ', "
            f"{_plural_sql(over, 'it', 'them')}, ' in Review')")
    nothing = _reason_sql(f"COALESCE(NULLIF(TRIM(l.`nothing`), ''), {sql_text(NO_ACT_NOW)})")
    headline = (f"CASE WHEN l.`seen` IS NULL THEN 'Not run yet' WHEN l.`unreliable` IS NOT NULL THEN 'Not reliable yet' "
                f"WHEN {act} = 0 THEN 'Nothing to act on yet' ELSE concat(format_number({act}, 0), ' to act on now') END")
    sentence = (f"CASE WHEN l.`seen` IS NULL THEN {sql_text(NOT_RUN_YET)} WHEN l.`unreliable` IS NOT NULL THEN "
                f"concat('Not reliable yet: ', l.`unreliable`) WHEN {act} = 0 THEN concat('Nothing to act on yet, because ', {nothing}) "
                f"ELSE concat(format_number({act}, 0), {_plural_sql(act, ' record to act on now', ' records to act on now')}, "
                f"CASE WHEN {over} > 0 THEN {held} ELSE '' END, '.') END")
    if scopes:
        covered = _covered_sql("l.`segments`")
        sentence = (f"concat({sentence}, CASE WHEN l.`seen` IS NULL OR {covered} = '' THEN '' ELSE concat({sql_text(SCOPE_SENTENCE)}, "
                    f"{covered}, '.') END)")
    return f"SELECT {headline} AS `headline`, {sentence} AS `sentence` FROM (SELECT 1 AS `one`) AS z LEFT JOIN ({latest}) AS l ON TRUE"


def digest_query(table: str, fields: list, tier: str = "priority_tier", label=None, use_case: str = "", impact=None,
                 since: str = "date_sub(current_date(), 7)", model=None, status_table: str = "", history=None, scopes: bool = False) -> str:
    impact = impact or impact_of(None)
    currency = impact["unit"]
    names = {f["name"] for f in fields}
    scope = f"`use_case_id` = {sql_text(use_case)}" if use_case else ""
    ctes, branches = impact_ctes(table_name(table), names, tier if tier in names else None, label, scope, since, listed=False, model=model,
                                 values=money_values_sql(model, table, use_case), history=history)
    ctes["hi"] = " UNION ALL ".join(branches)

    def pick(kind: str, column: str, how: str = "MAX", where: str = "") -> str:
        return f"{how}(CASE WHEN `kind` = '{kind}'{where} THEN {quote(column)} END)"

    status = lambda s, column="n": pick("status", column, "SUM", f" AND `status` = '{s}'")
    held = lambda state, column: pick("holdout", column, "SUM", f" AND `state` = '{state}'")
    ctes["hz"] = ("SELECT " + ", ".join(f"{sql} AS {quote(name)}" for name, sql in (
        ("est", pick("estimated", "money", "SUM")), ("est_n", pick("estimated", "n", "SUM")),
        ("rep", pick("reported", "money")), ("rep_w", pick("reported", "money_since")), ("rep_n", pick("reported", "n")),
        ("rep_wn", pick("reported", "n_since")), ("mes", pick("measured", "money")), ("mes_w", pick("measured", "money_since")),
        ("mes_n", pick("measured", "n")), ("mes_wn", pick("measured", "n_since")), ("closed", pick("status", "n", "SUM")),
        ("wrong", status(DISMISSED)), ("fixed_w", status(DONE, "n_since")), ("wrong_w", status(DISMISSED, "n_since")),
        ("could_w", status(COULD_NOT, "n_since")), ("shown_n", held("shown", "n")), ("shown_hits", held("shown", "hits")),
        ("held_n", held("held", "n")), ("held_hits", held("held", "hits")))) + " FROM hi")
    share = lambda hits, n: f"concat(CAST(CAST(ROUND(100.0 * {hits} / NULLIF({n}, 0)) AS INT) AS STRING), '%')"
    money = MONEY_COLUMN in names
    priced = money and bool(tier in names)
    ctes["ha"] = (f"SELECT COUNT(*) AS `acted_n`, SUM(v.`_inspire_at_close`) AS `acted` FROM hm AS v WHERE v.`_inspire_status` IN "
                  f"({_sql_list((DONE, COULD_NOT))}) AND CAST(v.`_inspire_closed` AS DATE) >= {since}")
    sources = {0: "st", 2: "hz CROSS JOIN ha"}
    if status_table:
        ctes["st"] = run_status_query(status_table, use_case, scopes)
    rows = ([(0, "'Latest run'", "`headline`", "`sentence`")] if status_table else []) + [
        (1, sql_text(f"{stake_label(impact)} now (estimated)"), _digest_money("est", currency, priced),
         f"concat({sql_text(stake_label(impact) + ' on the ')}, {_digest_count('est_n')}, ' open records flagged Act now or Review, added up')"),
        (2, "'Acted on this week'", _digest_money("acted", currency, money),
         f"concat({_digest_count('acted_n')}, ' records people marked fixed or could not fix this week, with this much at stake on them "
         f"when they did')"),
        (3, "'Reported by people this week'", _digest_money("rep_w", currency, True),
         f"concat('Amounts people entered on ', {_digest_count('rep_wn')}, ' records they marked fixed this week; ', "
         f"{_digest_money('rep', currency, True)}, ' on ', {_digest_count('rep_n')}, ' records so far')"),
        (4, "'Measured by later runs this week'", _digest_money("mes_w", currency, money),
         f"concat({sql_text(stake_label(impact) + ' when fixed, less what a later run still finds, on ')}, {_digest_count('mes_wn')}, ' fixes a later run "
         f"confirmed this week; ', {_digest_money('mes', currency, money)}, ' on ', {_digest_count('mes_n')}, ' fixes so far')"),
        (5, "'Closed this week'", _digest_count("COALESCE(fixed_w, 0) + COALESCE(wrong_w, 0) + COALESCE(could_w, 0)"),
         f"concat({_digest_count('fixed_w')}, ' fixed, ', {_digest_count('wrong_w')}, ' not a real issue, ', {_digest_count('could_w')}, "
         f"' could not fix')"),
        (6, "'Recommendations people said were wrong'", f"COALESCE({share('wrong', 'closed')}, 'Not measured yet')",
         f"concat('People marked ', {_digest_count('wrong')}, ' of ', {_digest_count('closed')}, ' closed records not a real issue, so far')"),
        (7, "'Held back to measure impact'", f"COALESCE(concat({share('shown_hits', 'shown_n')}, ' vs ', {share('held_hits', 'held_n')}), "
                                               f"'Not measured yet')",
         f"concat('Flagged records that left the list or stopped being flagged: ', {_digest_count('shown_hits')}, ' of ', "
         f"{_digest_count('shown_n')}, ' shown to people, ', {_digest_count('held_hits')}, ' of ', {_digest_count('held_n')}, ' held back')")]
    held_row = " WHERE COALESCE(held_n, 0) > 0"
    union = " UNION ALL ".join(f"SELECT {order} AS `position`, {figure} AS `figure`, {amount} AS `amount`, {how} AS `how` FROM "
                               f"{sources.get(order, 'hz')}" + (held_row if order == 7 else "") for order, figure, amount, how in rows)
    ctes["hy"] = union
    return (f"{_with(ctes, (*IMPACT_ORDER, 'hi', 'hz', 'ha', 'st', 'hy'))} SELECT `figure`, `amount`, `how`, 1 AS {quote(DIGEST_SEND)} "
            f"FROM hy ORDER BY `position`")


def list_summary_queries(context: dict) -> dict:
    table, out, history = context["table"], {}, context.get("history")
    current = f"SELECT `record_key` FROM {table} WHERE `is_current` AND `change_source` <> 'delete'"
    if context["changes"]:
        runs = _compare_ctes(context)
        source, only = (history["log"], "") if history else (table, " WHERE p.`change_source` = 'run'")
        out["left"] = (f"{_with(runs, ['r', 'n'])} SELECT COUNT(DISTINCT p.`record_key`) AS left_n FROM {source} AS p JOIN n ON "
                       f"p.`run_id` = n.`_inspire_previous` LEFT ANTI JOIN ({current}) AS c ON c.`record_key` = p.`record_key`"
                       f"{only}", [])
    out["kept"] = (f"SELECT COUNT(*) AS kept_n FROM {table} WHERE `is_current` AND `change_source` <> 'delete' AND "
                   f"{quote(KEPT_SINCE)} IS NOT NULL", [])
    if context["actions"]:
        opened = ", ".join(f"'{s}'" for s in OPEN_STATUSES)
        out["impact"] = (f"SELECT COUNT_IF(a.`is_current` AND a.`action_status` IN ({opened})) AS open_n, "
                         f"COUNT_IF(a.`action_status` = 'Done') AS done_n, COUNT_IF(a.`action_status` = 'Done' AND "
                         f"(NOT a.`is_current` OR a.`action_outcome` = 'Resolved')) AS resolved_n FROM (SELECT `is_current`, "
                         f"`change_source`, `action_status`, `action_outcome` FROM {table} WHERE `record_key` IN (SELECT `record_key` "
                         f"FROM {table} WHERE `action_status` IS NOT NULL) QUALIFY ROW_NUMBER() OVER (PARTITION BY `record_key` "
                         f"ORDER BY `valid_from` DESC) = 1) AS a WHERE a.`change_source` <> 'delete'", [])
        out["owners"] = (f"SELECT `action_owner` AS v FROM {context.get('current') or table} WHERE `is_current` AND `change_source` <> 'delete' AND "
                         f"TRIM(`action_owner`) <> '' GROUP BY `action_owner` ORDER BY COUNT(*) DESC, v LIMIT {CAPS['owners']}", [])
    return out


def list_keys_query(page: dict, values: dict, columns) -> tuple:
    params = _Params()
    key = quote((page.get("records") or {}).get("key") or "record_key")
    expr = f"COALESCE(CAST(`record_key` AS STRING), CAST({key} AS STRING))" if "record_key" in columns else f"CAST({key} AS STRING)"
    return (f"SELECT COUNT(*) AS n, COUNT(DISTINCT {expr}) AS k FROM ({_dataset(page, RECORDS_DATASET)}) AS d"
            f"{_where(page, RECORDS_DATASET, values, params)}", params.items)


def current_query(table: str, keys: list) -> tuple:
    params = _Params()
    holder = params.add(json.dumps([str(k) for k in keys], ensure_ascii=False))
    return (f"SELECT *, CAST(unix_micros(`valid_from`) AS STRING) AS `{VERSION_COLUMN}` FROM {table_name(table)} WHERE `is_current` "
            f"AND `record_key` IN (SELECT explode(from_json({holder}, 'ARRAY<STRING>')))", params.items)


def snapshot_of(table: str, version) -> str:
    return f"{table_name(table)} VERSION AS OF {int(version)}"


def match_conflicts_query(table: str, match: dict, batch_id: str, held: bool) -> tuple:
    params = match["params"]
    kept = "COALESCE(b.`held_back`, FALSE)" if held else "FALSE"
    return (f"SELECT b.`record_key`, b.`change_source`, b.`changed_by`, b.`valid_from`, {kept} AS `held_back`, COUNT(*) OVER () AS "
            f"`_inspire_n` FROM {table_name(table)} AS b JOIN ({match['keys']}) AS w ON b.`record_key` = w.`_inspire_key` WHERE "
            f"b.`is_current` AND NOT (b.`{BATCH_COLUMN}` <=> {params.add(str(batch_id))}) ORDER BY b.`record_key` "
            f"LIMIT {CAPS['conflicts_shown']}", params.items)


def batches_query(page: dict, limit: int = CAPS["batches"], batch_id: str = None) -> tuple:
    table, params = table_name(page["result_table"]), _Params()
    scope = f" AND `use_case_id` = {params.add(str(page['use_case_id']))}" if page.get("use_case_id") else ""
    only = f" AND b.`{BATCH_COLUMN}` = {params.add(str(batch_id))}" if batch_id else ""
    undo = (f"SELECT DISTINCT get_json_object(`{BATCH_VALUES}`, '$.{UNDO_KEY}') AS `_inspire_undo` FROM {table} WHERE "
            f"`change_source` = 'action' AND `{BATCH_VALUES}` LIKE '%\"{UNDO_KEY}\"%'{scope}")
    return (f"SELECT b.`{BATCH_COLUMN}` AS `batch_id`, MAX(b.`changed_by`) AS `editor`, MIN(b.`valid_from`) AS `at`, "
            f"COUNT(DISTINCT b.`record_key`) AS `n`, MAX(b.`{BATCH_VALUES}`) AS `batch_values`, MAX(b.`{BATCH_NOTE}`) AS `note`, "
            f"MAX(CASE WHEN u.`_inspire_undo` IS NOT NULL THEN 1 ELSE 0 END) AS `undone` FROM {table} AS b LEFT JOIN ({undo}) AS u ON "
            f"u.`_inspire_undo` = b.`{BATCH_COLUMN}` WHERE b.`change_source` = 'action' AND b.`{BATCH_COLUMN}` IS NOT NULL"
            f"{scope.replace('`use_case_id`', 'b.`use_case_id`')}{only} GROUP BY b.`{BATCH_COLUMN}` ORDER BY `at` DESC LIMIT {int(limit)}",
            params.items)


def batch_records_query(page: dict, batch_id: str, restored_by: str) -> tuple:
    table, params = table_name(page["result_table"]), _Params()
    wrote = (f"SELECT DISTINCT `record_key` FROM {table} WHERE `change_source` = 'action' AND `{BATCH_COLUMN}` = "
             f"{params.add(str(batch_id))}")
    done = f"CASE WHEN c.`change_source` = 'action' AND c.`{BATCH_COLUMN}` <=> {params.add(str(restored_by))} THEN 1 ELSE 0 END"
    return (f"SELECT x.`record_key`, c.`change_source`, c.`changed_by`, c.`valid_from`, {done} AS `_inspire_done`, COUNT(*) OVER () AS "
            f"`_inspire_n` FROM ({wrote}) AS x LEFT JOIN {table} AS c ON c.`record_key` = x.`record_key` AND c.`is_current` "
            f"ORDER BY `_inspire_done`, x.`record_key` LIMIT {CAPS['conflicts_shown']}", params.items)


def similar_values_query(page: dict, context: dict, record_key: str, filters: list) -> tuple:
    params = _Params()
    columns = ", ".join(f"CAST(d.{quote(f['columns'][RECORDS_DATASET])} AS STRING) AS {quote(f['id'])}" for f in filters)
    ctes = {"d": f"SELECT * FROM ({_dataset(page, RECORDS_DATASET)}) AS d", "c": _current_cte(context)}
    return (f"{_with(ctes, ['d', 'c'])} SELECT {columns} FROM d JOIN c ON {_current_on(context, 'd')} WHERE c.`_inspire_key` = "
            f"{params.add(str(record_key))} LIMIT 1", params.items)


def similar_filters(page: dict) -> list:
    by = {f.get("id"): f for f in page.get("filters") or [] if isinstance(f, dict)}
    return [by[i] for i in page.get("similar_by") or [] if i in by]


def similar_by_problems(page: dict) -> list:
    chosen = page.get("similar_by")
    if chosen is None:
        return []
    usable = {f.get("id") for f in page.get("filters") or [] if isinstance(f, dict) and f.get("type") == "multi_select"
              and RECORDS_DATASET in (f.get("columns") or {})}
    if not isinstance(chosen, list) or not 1 <= len(chosen) <= CAPS["similar_by"] or len(set(map(str, chosen))) != len(chosen):
        return [f"similar_by takes 1 to {CAPS['similar_by']} distinct filter ids"]
    return [f"similar_by names {i!r}, which is no segment filter of the decision list" for i in chosen if i not in usable]


def change_fields(columns: list) -> list:
    out = []
    for column in columns or []:
        name = str(column.get("name") or "")
        kind_name = str(column.get("type") or "").upper()
        text = re.sub(r"\s+", "", str(column.get("type_text") or kind_name).upper())
        role = ("history" if name in HISTORY_COLUMNS else "run" if name in RUN_COLUMNS else "id" if name == ID_COLUMN
                else "action" if name in ACTION_TYPES or name in CLOSE_TYPES else "holdout" if name in HOLDOUT_TYPES
                else "kept" if name in KEPT_TYPES
                else "ai" if name in AI_COLUMNS or name == VALUE_FORMULA or AI_CATEGORY.match(name) else "business")
        kind = "lines" if text == LINES_TYPE else FIELD_KINDS.get(kind_name)
        out.append({"name": name, "type": kind_name, "type_text": text, "kind": kind, "role": role,
                    "editable": role == "business" and kind is not None and bool(IDENT.match(name))})
    return out


def action_values(values, today: datetime.date = None) -> dict:
    if not isinstance(values, dict) or not values:
        raise ValueError("send the action values to change, as an object of column name to value")
    wrong = sorted(str(k) for k in values if k not in ACTION_EDITABLE + (ACT_NOTE,))
    if wrong:
        raise ValueError(f"{', '.join(wrong)} cannot be changed by an action; an action changes {', '.join(ACTION_EDITABLE + (ACT_NOTE,))}")
    out = dict(values)
    if ACT_NOTE in out:
        note = out.pop(ACT_NOTE)
        if note is not None and not isinstance(note, str):
            raise ValueError("note takes text")
        note = (note or "").strip()
        if len(note) > CAPS["note_chars"]:
            raise ValueError(f"note takes at most {CAPS['note_chars']} characters")
        out[BATCH_NOTE] = note or None
    if SNOOZE_COLUMN in out:
        out[SNOOZE_COLUMN] = snooze_date(out[SNOOZE_COLUMN], today or datetime.datetime.now(datetime.timezone.utc).date())
    elif "action_status" in out:
        out[SNOOZE_COLUMN] = None
    status = out.get("action_status")
    if "action_status" in out and status not in ACTION_STATUSES:
        raise ValueError(f"action_status must be one of {', '.join(ACTION_STATUSES)}")
    owner, raw = out.get("action_owner"), out.get("dismiss_reason")
    if isinstance(owner, str) and len(owner.strip()) > CAPS["owner_chars"]:
        raise ValueError(f"action_owner takes at most {CAPS['owner_chars']} characters")
    if raw is not None and not isinstance(raw, str):
        raise ValueError("dismiss_reason takes text")
    reason = (raw or "").strip()
    if "dismiss_reason" in out and status != DISMISSED and (reason or "action_status" not in out):
        raise ValueError("a dismiss_reason goes only with the Dismissed status")
    if status == DISMISSED and not reason:
        raise ValueError("say why the recommendation is wrong: dismissing a record needs a dismiss_reason")
    if len(reason) > CAPS["reason_chars"]:
        raise ValueError(f"dismiss_reason takes at most {CAPS['reason_chars']} characters")
    if "action_status" in out and status != DISMISSED:
        out["dismiss_reason"] = None
    if any(k in out for k in CLOSE_TYPES) and status != DONE:
        raise ValueError(f"the {stake_noun(None)} a fix saved goes only with the Done status: send action_status Done with "
                         "realized_value and realized_note")
    if "realized_value" in out:
        out["realized_value"] = realized_amount(out["realized_value"])
    if "realized_note" in out:
        note = out["realized_note"]
        if note is not None and not isinstance(note, str):
            raise ValueError("realized_note takes text")
        note = (note or "").strip()
        if len(note) > CAPS["realized_note_chars"]:
            raise ValueError(f"realized_note takes at most {CAPS['realized_note_chars']} characters")
        out["realized_note"] = note or None
    if "action_status" in out and status != DONE:
        out.update(dict.fromkeys(CLOSE_TYPES))
    return out


def snooze_date(raw, today: datetime.date):
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if not isinstance(raw, str) or not _DATE.match(raw.strip()):
        raise ValueError("snooze_until takes a date as YYYY-MM-DD")
    day = _date(raw.strip())
    last = today + datetime.timedelta(days=CAPS["snooze_days"])
    if not today < day <= last:
        raise ValueError(f"snooze_until takes a date after today ({today.isoformat()}) and at most {CAPS['snooze_days']} days "
                         f"ahead ({last.isoformat()})")
    return day.isoformat()


def realized_amount(raw):
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    text = str(raw).strip()
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)) or not _NUMBER.match(text) or not math.isfinite(float(text)):
        raise ValueError(f"realized_value takes the {stake_noun(None)} the fix saved, as a number")
    if not 0 <= float(text) <= CAPS["realized_value"]:
        raise ValueError(f"realized_value takes an amount from 0 to {CAPS['realized_value']:,}")
    return float(text)


def sql_type(field: dict) -> str:
    if field["kind"] == "lines":
        return LINES_TYPE
    if field["type"] == "DECIMAL":
        match = _DECIMAL_TYPE.match(field.get("type_text") or "")
        return f"DECIMAL({match.group(1)},{match.group(2)})" if match else "DECIMAL(38,18)"
    return SQL_TYPES[field["type"]]


def field_value(field: dict, raw, params: _Params) -> str:
    name, kind = field["name"], field["kind"]
    if kind == "lines":
        items = raw.split("\n") if isinstance(raw, str) else [] if raw is None else raw
        if not isinstance(items, list) or any(not isinstance(i, str) for i in items):
            raise ValueError(f"{name} takes lines of text")
        items = [i.strip() for i in items if i.strip()]
        if len(items) > CAPS["lines"] or any(len(i) > CAPS["value_chars"] for i in items):
            raise ValueError(f"{name} takes at most {CAPS['lines']} lines of at most {CAPS['value_chars']} characters")
        return f"from_json({params.add(json.dumps(items, ensure_ascii=False))}, '{LINES_TYPE}')" if items else "NULL"
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return "NULL"
    if kind == "text":
        if not isinstance(raw, str) or len(raw.strip()) > CAPS["field_chars"]:
            raise ValueError(f"{name} takes text of at most {CAPS['field_chars']} characters")
        return params.add(raw.strip())
    if kind == "boolean":
        text = ("true" if raw else "false") if isinstance(raw, bool) else str(raw).strip().lower()
        if text not in ("true", "false"):
            raise ValueError(f"{name} takes true or false")
        return text
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        raise ValueError(f"{name} takes a single value, not {type(raw).__name__}")
    text = str(raw).strip()
    if kind == "integer":
        if not _INTEGER.match(text):
            raise ValueError(f"{name} takes a whole number")
        limit = 2 ** INTEGER_BITS[field["type"]]
        if not -limit <= int(text) < limit:
            raise ValueError(f"{name} is too large for its column")
        return f"CAST({params.add(str(int(text)))} AS {sql_type(field)})"
    if kind == "decimal":
        if not _NUMBER.match(text) or not math.isfinite(float(text)):
            raise ValueError(f"{name} takes a number")
        return f"CAST({params.add(text)} AS {sql_type(field)})"
    if kind == "date":
        try:
            return params.add(_date(text).isoformat(), "DATE")
        except ValueError as error:
            raise ValueError(f"{name}: {error}") from error
    if kind == "timestamp":
        match = _TIMESTAMP.match(text)
        try:
            stamp = datetime.datetime.fromisoformat(f"{match.group(1)} {match.group(2)}{match.group(3) or ':00'}") if match else None
        except ValueError:
            stamp = None
        if stamp is None:
            raise ValueError(f"{name} takes a date and time as YYYY-MM-DD HH:MM")
        return f"CAST({params.add(stamp.isoformat(sep=' '))} AS {sql_type(field)})"
    raise ValueError(f"{name} cannot be changed in the App")


def version_write(table: str, fields: list, source: str, records: list, editor: str, values=None, batch=None, match=None,
                  undo=None) -> tuple:
    staged, params = version_staged(table, fields, source, records, editor, values, batch, match, undo)
    names = [f["name"] for f in fields]
    target = table_name(table)
    columns = ", ".join(quote(n) for n in names)
    sql = (f"MERGE INTO {target} AS tgt USING (SELECT s.`record_key` AS `{MERGE_KEY}`, s.* FROM ({staged}) AS s UNION ALL "
           f"SELECT NULL AS `{MERGE_KEY}`, s.* FROM ({staged}) AS s) AS src "
           f"ON tgt.`record_key` = src.`{MERGE_KEY}` AND tgt.`is_current` "
           f"WHEN MATCHED THEN UPDATE SET tgt.`valid_to` = src.`valid_from`, tgt.`is_current` = false "
           f"WHEN NOT MATCHED AND src.`{MERGE_KEY}` IS NULL THEN INSERT ({columns}) "
           f"VALUES ({', '.join(f'src.{quote(n)}' for n in names)})")
    return sql, params.items


def version_staged(table: str, fields: list, source: str, records: list, editor: str, values=None, batch=None, match=None,
                   undo=None) -> tuple:
    if source not in PEOPLE_SOURCES:
        raise ValueError(f"the App writes edit, add, delete or action versions, not {source!r}")
    if not records and match is None and undo is None:
        raise ValueError("name the record to change")
    names = [f["name"] for f in fields]
    odd = [n for n in names if not IDENT.match(n) or n == MERGE_KEY]
    if odd:
        raise ValueError(f"the result table has columns the App cannot write safely: {', '.join(odd[:5])}")
    target, values = table_name(table), dict(values or {})
    params = match["params"] if match else _Params()
    key = params.add(str(records[0][0])) if source == "add" else "b.`record_key`"
    computed = {"record_key": key, "valid_from": "current_timestamp()", "valid_to": "CAST(NULL AS TIMESTAMP)", "is_current": "true",
                "change_source": params.add(source), "changed_by": params.add(str(editor))}
    if source in ("edit", "add"):
        computed["edited_by_person"] = "true"
    if source == "add":
        computed[JOINED_COLUMN] = "current_timestamp()"
    if batch is not None:
        computed.update({BATCH_COLUMN: params.add(str(batch["id"])), BATCH_VALUES: params.add(str(batch["values"]))})
        if BATCH_NOTE not in values:
            computed[BATCH_NOTE] = "CAST(NULL AS STRING)"
    else:
        computed.update({name: "CAST(NULL AS STRING)" for name in BATCH_TYPES})
    restored = set(UNDONE_KEYS) if undo is not None else set()
    picked = []
    for f in fields:
        if f["name"] in computed:
            expr = computed[f["name"]]
        elif f["name"] in restored:
            expr = f"p.{quote(f['name'])}"
        elif f["name"] in values:
            expr = field_value(f, values[f["name"]], params)
        elif source == "add" and f["role"] != "run":
            expr = "NULL"
        else:
            expr = f"b.{quote(f['name'])}"
        picked.append(f"{expr} AS {quote(f['name'])}")
    kept = " AND NOT COALESCE(b.`held_back`, FALSE)" if source == "action" and "held_back" in names else ""
    if source == "add":
        base = (f"FROM (SELECT * FROM {target} WHERE `is_current` ORDER BY `as_of_date` DESC NULLS LAST, `valid_from` DESC LIMIT 1) "
                f"AS b WHERE NOT EXISTS "
                f"(SELECT 1 FROM {target} AS c WHERE c.`record_key` = {key} AND c.`is_current` AND c.`change_source` <> 'delete')")
    elif undo is not None:
        base = (f"FROM {target} AS b JOIN {target} AS p ON p.`record_key` = b.`record_key` AND p.`valid_to` = b.`valid_from` "
                f"WHERE b.`is_current` AND b.`change_source` = 'action' AND b.`{BATCH_COLUMN}` = {params.add(str(undo))}")
    elif match is not None:
        base = (f"FROM {target} AS b JOIN ({match['keys']}) AS w ON b.`record_key` = w.`_inspire_key` JOIN {match['before']} AS a ON "
                f"a.`record_key` = b.`record_key` AND a.`valid_from` = b.`valid_from` AND a.`is_current` WHERE b.`is_current` AND "
                f"b.`change_source` <> 'delete'{kept}")
    else:
        if any(not re.match(r"^\d{1,19}$", str(us or "")) for _key, us in records):
            raise ValueError("name the version you read as valid_from_us, the microseconds of its valid_from")
        seen = params.add(json.dumps([{"k": str(k), "v": int(us)} for k, us in records], ensure_ascii=False))
        base = (f"FROM {target} AS b JOIN (SELECT inline(from_json({seen}, '{SEEN_TYPE}'))) AS w ON b.`record_key` = w.`k` "
                f"AND unix_micros(b.`valid_from`) = w.`v` WHERE b.`is_current` AND b.`change_source` <> 'delete'{kept}")
    return f"SELECT {', '.join(picked)} {base}", params


def history_query(page: dict, value, by_record_key: bool = False, history=None) -> tuple:
    table, params = table_name(page["result_table"]), _Params()
    key = "record_key" if by_record_key else str((page.get("records") or {}).get("key") or "record_key")
    holder = params.add(str(value))
    if key == "record_key":
        where = f"`record_key` = {holder}"
    else:
        where = f"`record_key` IN (SELECT `record_key` FROM {table} WHERE `is_current` AND CAST({quote(key)} AS STRING) = {holder})"
    if history:
        keys = (holder if key == "record_key" else
                f"SELECT `record_key` FROM {table} WHERE `is_current` AND CAST({quote(key)} AS STRING) = {holder}")
        source = f"{versions_source(table, history, keys)} AS hv"
    else:
        source = table
    return (f"SELECT *, CAST(unix_micros(`valid_from`) AS STRING) AS `{VERSION_COLUMN}` FROM {source} WHERE {where} "
            f"ORDER BY `valid_from` DESC LIMIT {CAPS['history_rows']}", params.items)


def expression_columns(expression) -> set:
    found = set()
    for quoted, bare in _EXPRESSION_NAMES.findall(strip_sql_text(str(expression or ""), keep_names=True)):
        if quoted or bare.lower() not in _SQL_WORDS:
            found.add(quoted or bare)
    return found


def runs_query(page: dict, fields: list, history=None) -> tuple:
    names = {f["name"] for f in fields}
    tier = (page.get("records") or {}).get("tier")
    tier_sql = f"CAST({quote(tier)} AS STRING)" if tier in names else "CAST(NULL AS STRING)"
    if history and (tier not in names or tier == history.get("tier")):
        logged = "CAST(`tier` AS STRING)" if tier in names else "CAST(NULL AS STRING)"
        return (f"SELECT CAST(`run_id` AS STRING) AS run_id, {logged} AS tier, MAX(CAST(`as_of_date` AS DATE)) AS as_of_date, "
                f"MIN(`ran_at`) AS ran_at, COUNT(*) AS n FROM {history['log']} GROUP BY 1, 2 ORDER BY ran_at DESC LIMIT {CAPS['runs_rows']}", [])
    source = f"{versions_source(table_name(page['result_table']), history)} AS hv" if history else table_name(page['result_table'])
    return (f"SELECT CAST(`run_id` AS STRING) AS run_id, {tier_sql} AS tier, MAX(CAST(`as_of_date` AS DATE)) AS as_of_date, "
            f"MIN(`valid_from`) AS ran_at, COUNT(*) AS n FROM {source} WHERE `change_source` = 'run' "
            f"GROUP BY 1, 2 ORDER BY ran_at DESC LIMIT {CAPS['runs_rows']}", [])


def run_health(rows: list, today: datetime.date) -> dict:
    runs = {}
    for row in rows or []:
        ident = str(row.get("run_id"))
        run = runs.setdefault(ident, {"run_id": ident, "as_of_date": None, "ran_at": None, "rows": 0, "tiers": {}})
        count = int(row.get("n") or 0)
        run["rows"] += count
        if row.get("tier") is not None:
            run["tiers"][str(row["tier"])] = run["tiers"].get(str(row["tier"]), 0) + count
        day, ran = str(row.get("as_of_date") or "")[:10], str(row.get("ran_at") or "")
        if day and (run["as_of_date"] is None or day > run["as_of_date"]):
            run["as_of_date"] = day
        if ran and (run["ran_at"] is None or ran < run["ran_at"]):
            run["ran_at"] = ran
    ordered = sorted(runs.values(), key=lambda r: (r["as_of_date"] or "", r["ran_at"] or ""))
    dates = sorted({_date(r["as_of_date"]) for r in ordered if r["as_of_date"]})
    gaps = sorted(g for g in ((b - a).days for a, b in zip(dates, dates[1:])) if g > 0)
    cadence = gaps[(len(gaps) - 1) // 2] if gaps else None
    since = (today - dates[-1]).days if dates else None
    return {"runs": list(reversed(ordered)), "cadence_days": cadence, "last_as_of_date": dates[-1].isoformat() if dates else None,
            "days_since": since, "overdue": bool(cadence and since is not None and since > 1.5 * cadence)}


def page_scopes(page) -> bool:
    return bool((page or {}).get(RUN_SCOPES)) or any(isinstance(s, dict) and s.get("name") == "run_scope" for s in (page or {}).get("settings") or [])


def run_scope(segments):
    for item in segments if isinstance(segments, list) else []:
        if isinstance(item, dict) and item.get("scope"):
            return item
    return None


def scope_text(scope) -> str:
    if not isinstance(scope, dict) or not scope.get("scope") or scope["scope"] == "all":
        return SCOPE_ALL_TEXT
    return SCOPE_FIRST_RUN + (" ".join(str(scope.get("text") or "").split()) or SCOPE_PART)


def summary_scope(row):
    try:
        parsed = json.loads(str((row or {}).get("run_segments") or ""))
    except ValueError:
        parsed = None
    return run_scope(parsed)


def scoped_text(row) -> str:
    scope = summary_scope(row)
    return scope_text(scope) if scope and scope.get("scope") != "all" else ""


def scope_note(latest, previous) -> str:
    if latest is None or previous is None:
        return ""
    return "" if str(latest.get("key") or "") == str(previous.get("key") or "") else "The previous run covered a different scope."


def scope_facts(scope, tables, duration_s) -> dict:
    if not isinstance(scope, dict) or not scope.get("scope"):
        return {}
    if scope["scope"] == "all":
        return {"covered": "", "everything": ""}
    main = str(scope.get("table") or "").lower()
    entry = next((t for t in tables or [] if str(t.get("table") or "").lower() == main), None)
    read, total = (entry or {}).get("rows"), (entry or {}).get("rows_total")
    if read is None or total is None:
        return {"covered": "", "everything": ""}
    minutes = None if duration_s is None else max(duration_s, 0) / 60
    extent = {"groups": f" ({plural(len(scope.get('values') or []), 'group')})",
              "recent": f" ({scope.get('column')} since {(scope.get('values') or [''])[0]})",
              "records": ""}.get(scope["scope"], "")
    took = "" if minutes is None else f" in {plural(max(1, round(minutes)), 'minute')}"
    covered = f"The first run covered {read:,} of {plural(total, 'record')}{extent}{took}."
    if minutes is None or not read:
        return {"covered": covered, "everything": f"Run on everything covers all {plural(total, 'record')}."}
    return {"covered": covered, "everything": (f"Run on everything covers all {plural(total, 'record')}, about "
                                               f"{plural(max(1, round(minutes * total / read)), 'minute')} at this run's pace.")}


def scope_view(rows) -> dict:
    scopes = [summary_scope(row) for row in list(rows or [])[:2]]
    latest = scopes[0] if scopes else None
    return {"text": scope_text(latest) if latest else "", "note": scope_note(latest, scopes[1] if len(scopes) > 1 else None)}
