import datetime
import decimal
import json
import queue
import re
import threading
import time

import shell_facts
from shell_db import BROWSER_SAFE_WHOLE, QueryError, browser_whole, stamp_of

KINDS = ("lakebase", "delta")
LAKEBASE = "lakebase"
PG_NAME = re.compile(r"^[A-Za-z0-9_]{1,63}$")
PIPELINE_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
UC_PART = re.compile(r"^[^`.\x00-\x1f]{1,255}$")
ENV_KEYS = ("PGHOST", "PGDATABASE", "PGUSER", "LAKEBASE_ENDPOINT")
ROW_COLUMN = "_inspire_row"
POOL_SIZE = 8
CONNECT_TIMEOUT_S = 15
STATEMENT_TIMEOUT_MS = 30000
READ_TIMEOUT_MS = 2500
READ_CURSOR = "inspire_read"
TOKEN_SLACK_S = 300
TOKEN_LIFE_S = 3600
SYNC_POLL_S = 5
SYNC_RETRY_S = 30
SYNC_DEADLINE_S = 1800
CLOCK_SKEW_S = 5
EPOCH_MS_FROM = 100_000_000_000
NOTE_TTL_S = 600
SYNCED_TTL_S = 60
SYNC_DONE = ("COMPLETED",)
SYNC_ENDED = ("COMPLETED", "FAILED", "CANCELED", "CANCELLED")
TYPE_NAMES = {"bool": "BOOLEAN", "int2": "SHORT", "int4": "INT", "int8": "LONG", "float4": "FLOAT", "float8": "DOUBLE",
              "numeric": "DECIMAL", "text": "STRING", "varchar": "STRING", "bpchar": "STRING", "name": "STRING", "date": "DATE",
              "timestamptz": "TIMESTAMP", "timestamp": "TIMESTAMP_NTZ", "bytea": "BINARY", "interval": "INTERVAL"}
INTEGER_PARAMS = ("TINYINT", "SMALLINT", "INT", "INTEGER", "BIGINT", "LONG", "SHORT", "BYTE")
JSON_TYPES = ("ARRAY", "MAP", "STRUCT")
PG_TYPES = {"STRING": "TEXT", "LONG": "BIGINT", "BIGINT": "BIGINT", "INT": "INTEGER", "INTEGER": "INTEGER", "SHORT": "SMALLINT",
            "SMALLINT": "SMALLINT", "BYTE": "SMALLINT", "TINYINT": "SMALLINT", "DOUBLE": "DOUBLE PRECISION", "FLOAT": "REAL",
            "BOOLEAN": "BOOLEAN", "DATE": "DATE", "TIMESTAMP": "TIMESTAMPTZ", "TIMESTAMP_NTZ": "TIMESTAMP", "BINARY": "BYTEA",
            "INTERVAL": "INTERVAL", "ARRAY": "JSONB", "MAP": "JSONB", "STRUCT": "JSONB"}
SPARK_UNITS = {"YEAR": "year", "YYYY": "year", "YY": "year", "QUARTER": "quarter", "MONTH": "month", "MM": "month", "MON": "month",
               "WEEK": "week", "DAY": "day", "DD": "day", "HOUR": "hour", "MINUTE": "minute", "SECOND": "second"}
EXTRACT_FIELDS = {"Year": "YEAR", "Month": "MONTH", "Day": "DAY", "DayOfMonth": "DAY", "DayOfYear": "DOY", "WeekOfYear": "WEEK",
                  "Quarter": "QUARTER", "Hour": "HOUR", "Minute": "MINUTE"}
DIFF_SECONDS = {"SECOND": 1, "MINUTE": 60, "HOUR": 3600, "DAY": 86400, "WEEK": 604800}
DIFF_MONTHS = {"MONTH": 1, "QUARTER": 3, "YEAR": 12}
INTERVAL_UNITS = {"YEAR": ("years", 1), "QUARTER": ("months", 3), "MONTH": ("months", 1), "WEEK": ("weeks", 1), "DAY": ("days", 1),
                  "HOUR": ("hours", 1), "MINUTE": ("mins", 1), "SECOND": ("secs", 1)}
DEFAULT_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
SERVED = frozenset((
    "Abs", "And", "ArrayAgg", "Avg", "Case", "Cast", "Ceil", "Coalesce", "Concat", "ConcatWs", "Corr", "Count", "CumeDist", "CurrentDate",
    "CurrentTimestamp", "DateDiff", "DateFromParts", "DenseRank", "Exists", "Exp", "Extract", "FirstValue", "Floor", "Greatest", "If", "Lag",
    "LastDay", "LastValue", "Lead", "Least", "Length", "Ln", "LogicalAnd", "LogicalOr", "Lower", "Max", "Median", "Min", "Ntile", "Nullif",
    "Nvl2", "Or", "Pad", "PercentRank", "Pow", "Rank", "RegexpILike", "RegexpLike", "Replace", "RowNumber", "SafeDivide", "Sign", "Sqrt",
    "Stddev", "StddevPop", "StddevSamp", "Substring", "Sum", "TimeStrToTime", "TimeToStr", "Trim", "TryCast", "TsOrDsToDate", "Upper",
    "Variance", "VariancePop"))
REWRITTEN = frozenset((
    "AddMonths", "ApproxDistinct", "ApproxQuantile", "ArgMax", "ArgMin", "ArrayContains", "ArraySize", "ArrayToString", "ArrayUniqueAgg",
    "CountIf", "DateAdd", "DateTrunc", "DayOfWeek", "Explode", "Inline", "IntDiv", "JSONExtractScalar", "Log", "Quantile", "RegexpExtract",
    "Round", "Second", "StrToUnix", "TimestampAdd", "TimestampDiff", "TimestampTrunc", "TsOrDsAdd", "UnixMicros", "UnixToStr",
    *EXTRACT_FIELDS))
REWRITTEN_CALLS = ("from_json", "isnull", "isnotnull", "pmod")
SERVED_CALLS = REWRITTEN_CALLS + ("make_date",)
OVERLAY_KEYS = 500
OVERLAY_ROWS = 5000
_DIALECT = []


class LakebaseError(QueryError):
    pass


class NotServed(Exception):
    table = ""


class NotHeld(NotServed):
    def __init__(self, table: str):
        super().__init__(f"{table} has no copy in Lakebase")
        self.table = table


def uc_key(name) -> str:
    return ".".join(part.strip().strip("`").lower() for part in str(name or "").split("."))


def uc_name(name) -> str:
    parts = str(name or "").split(".")
    if len(parts) != 3 or not all(UC_PART.match(p) for p in parts):
        raise ValueError(f"{name!r} is not a catalog.schema.table name")
    return ".".join(f"`{p}`" for p in parts)


def quoted(column: str) -> str:
    return "`" + str(column).replace("`", "``") + "`"


def backend_kind(settings: dict) -> str:
    backend = settings.get("backend")
    return backend.get("kind") if isinstance(backend, dict) and backend.get("kind") in KINDS else "delta"


def _columns_problem(name: str, entry) -> list:
    columns = entry.get("columns") if isinstance(entry, dict) else None
    if (not isinstance(columns, list) or not columns
            or any(not isinstance(c, dict) or not str(c.get("name") or "").strip() or not str(c.get("type") or "").strip() for c in columns)):
        return [f"the Lakebase copy of {name} must list its columns with their Unity Catalog types"]
    return []


def backend_problems(backend, auth: str, pages: list) -> list:
    if not isinstance(backend, dict) or backend.get("kind") not in KINDS:
        return [f"the App backend must be an object whose kind is one of {', '.join(KINDS)}"]
    if backend["kind"] != LAKEBASE:
        return []
    problems = []
    if auth != "sp":
        problems.append("only an App that reads through its service principal can read Lakebase, because Lakebase does not carry "
                        "Unity Catalog row filters, column masks or grants to each viewer")
    if not isinstance(backend.get("pipeline_id"), str) or not PIPELINE_ID.match(backend["pipeline_id"]):
        problems.append("the Lakebase backend needs pipeline_id, the id of the pipeline that syncs its tables")
    tables = backend.get("tables")
    if not isinstance(tables, dict) or not tables:
        problems.append("the Lakebase backend needs tables: each Unity Catalog table or view it holds, with its Postgres table and "
                        "columns")
        tables = {}
    for name, entry in tables.items():
        try:
            uc_name(name)
        except ValueError as error:
            problems.append(f"the Lakebase backend holds {error}")
        parts = str((entry or {}).get("pg") if isinstance(entry, dict) else "").split(".")
        if len(parts) != 2 or not all(PG_NAME.match(p) for p in parts):
            problems.append(f"the Lakebase copy of {name} must be a Postgres schema.table of letters, digits and underscores")
        problems += _columns_problem(name, entry)
    held = {uc_key(n) for n in tables}
    datasets = backend.get("datasets")
    if not isinstance(datasets, dict):
        problems.append("the Lakebase backend needs datasets: for each page, the view behind each of its datasets")
        datasets = {}
    previous = backend.get("previous", {})
    if not isinstance(previous, dict):
        problems.append("the Lakebase backend previous must be an object: for each page, the view of each dataset as the previous run "
                        "left it")
        previous = {}
    by_id = {p.get("id"): p for p in pages}
    for kind, what, mapped in (("datasets", "dataset", datasets), ("previous runs of datasets", "the previous run of dataset", previous)):
        for page_id, views in mapped.items():
            page = by_id.get(page_id)
            if page is None:
                problems.append(f"the Lakebase backend names {kind} of page {page_id}, which the App does not have")
                continue
            names = {d.get("name") for d in page.get("datasets") or []}
            for dataset, view in (views.items() if isinstance(views, dict) else ()):
                if dataset not in names:
                    problems.append(f"the Lakebase backend names {what} {dataset} of page {page_id}, which the page does not have")
                elif uc_key(view) not in held:
                    problems.append(f"page {page_id} {what} {dataset} reads {view}, which the Lakebase backend does not hold")
    return problems


def _copy_sql(view: str, backend: dict) -> str:
    tables = {uc_key(k): v for k, v in (backend.get("tables") or {}).items()}
    columns = [c["name"] for c in tables[uc_key(view)]["columns"] if c["name"] != ROW_COLUMN]
    return f"SELECT {', '.join(quoted(c) for c in columns)} FROM {uc_name(view)}"


def served_page(page: dict, backend: dict) -> dict:
    views = (backend.get("datasets") or {}).get(page.get("id")) or {}
    if not views:
        return page
    datasets = []
    for dataset in page.get("datasets") or []:
        view = views.get(dataset.get("name"))
        datasets.append(dict(dataset, sql=_copy_sql(view, backend)) if view else dataset)
    return dict(page, datasets=datasets)


def delta_by_design(pages: list, backend: dict) -> set:
    out = set()
    for page in pages:
        if page.get("result_table") and current_copy(backend, page["result_table"]):
            result = uc_key(page["result_table"])
            out |= {result} | {result + suffix for suffix in shell_facts.COMPANION_SUFFIXES}
    return out


def current_copy(backend: dict, result_table) -> str:
    return uc_key({uc_key(k): v for k, v in ((backend or {}).get("current") or {}).items()}.get(uc_key(result_table)) or "")


def changes_copy(backend: dict, result_table) -> str:
    return uc_key({uc_key(k): v for k, v in ((backend or {}).get("changes") or {}).items()}.get(uc_key(result_table)) or "")
def previous_sql(page: dict, backend: dict, name: str):
    view = ((backend.get("previous") or {}).get(page.get("id")) or {}).get(name)
    return _copy_sql(view, backend) if view else None


def page_tables(page: dict, backend: dict, derived=None) -> set:
    views = (backend.get("datasets") or {}).get(page.get("id")) or {}
    out = {uc_key(v) for v in views.values() if derived is None or uc_key(v) in derived}
    if derived is None:
        out |= {uc_key(v) for v in ((backend.get("previous") or {}).get(page.get("id")) or {}).values()}
    if page.get("result_table"):
        out.add(uc_key(page["result_table"]))
        out |= {current_copy(backend, page["result_table"])} - {""}
    return out


def _unit(node) -> str:
    return str(getattr(node, "name", node) or "").strip("'\"").upper()


def _interval(unit: str, amount: str) -> str:
    if unit not in INTERVAL_UNITS:
        raise NotServed(f"the query adds {unit.lower() or 'an unnamed unit'} to a date, which Lakebase cannot run")
    field, scale = INTERVAL_UNITS[unit]
    return f"MAKE_INTERVAL({field} => CAST(({amount}){' * 3' if scale == 3 else ''} AS INTEGER))"


def _trunc_unit(node) -> str:
    unit = SPARK_UNITS.get(_unit(node))
    if unit is None:
        raise NotServed(f"the query truncates dates to {_unit(node).lower() or 'an unnamed unit'}, which Lakebase cannot run")
    return unit


def _time_diff(self, e) -> str:
    unit, end, start = _unit(e.args.get("unit")), self.sql(e, "this"), self.sql(e, "expression")
    span = f"CAST({end} AS TIMESTAMPTZ) - CAST({start} AS TIMESTAMPTZ)"
    if unit in DIFF_SECONDS:
        return f"CAST(TRUNC(EXTRACT(EPOCH FROM {span}) / {DIFF_SECONDS[unit]}) AS BIGINT)"
    if unit in DIFF_MONTHS:
        age = f"AGE(CAST({end} AS TIMESTAMPTZ), CAST({start} AS TIMESTAMPTZ))"
        return f"CAST(TRUNC((EXTRACT(YEAR FROM {age}) * 12 + EXTRACT(MONTH FROM {age})) / {DIFF_MONTHS[unit]}) AS BIGINT)"
    raise NotServed(f"the query counts {unit.lower() or 'an unnamed unit'} between two times, which Lakebase cannot run")


def _default_format(self, e, what: str) -> None:
    fmt = e.args.get("format")
    if fmt is not None and fmt.name != DEFAULT_TIME_FORMAT:
        raise NotServed(f"the query {what} with the format {self.sql(fmt)}, which Lakebase cannot run")


def _str_to_unix(self, e) -> str:
    _default_format(self, e, "reads a time")
    return f"CAST(FLOOR(EXTRACT(EPOCH FROM CAST({self.sql(e, 'this') or 'CURRENT_TIMESTAMP'} AS TIMESTAMPTZ))) AS BIGINT)"


def _unix_to_str(self, e) -> str:
    _default_format(self, e, "writes a time")
    return f"TO_CHAR(TO_TIMESTAMP({self.sql(e, 'this')}), 'YYYY-MM-DD HH24:MI:SS')"


def _regexp_extract(self, e) -> str:
    group = e.args.get("group")
    index = int(group.name) if group is not None and group.is_int else 1 if group is None else None
    if not index:
        raise NotServed("the query takes a regular expression's whole match or a computed group, which Lakebase cannot run")
    text = self.sql(e, "this")
    return f"CASE WHEN {text} IS NULL THEN NULL ELSE COALESCE((REGEXP_MATCH({text}, {self.sql(e, 'expression')}))[{index}], '') END"


def _transforms(exp) -> dict:
    extract = {getattr(exp, name): (lambda field: lambda self, e: f"CAST(EXTRACT({field} FROM {self.sql(e, 'this')}) AS INTEGER)")(field)
               for name, field in EXTRACT_FIELDS.items()}
    return {
        **extract,
        exp.UnixMicros: lambda self, e: f"CAST(FLOOR(EXTRACT(EPOCH FROM {self.sql(e, 'this')}) * 1000000) AS BIGINT)",
        exp.Mod: lambda self, e: self.binary(e, "%%"),
        exp.Log: lambda self, e: (f"LOG(CAST({self.sql(e, 'this')} AS NUMERIC), CAST({self.sql(e, 'expression')} AS NUMERIC))"
                                  if e.args.get("expression") else f"LN({self.sql(e, 'this')})"),
        exp.CountIf: lambda self, e: f"COUNT(CASE WHEN {self.sql(e, 'this')} THEN 1 END)",
        exp.Round: lambda self, e: (f"ROUND(CAST({self.sql(e, 'this')} AS NUMERIC)"
                                    + (f", CAST({self.sql(e, 'decimals')} AS INTEGER))" if e.args.get("decimals") else ")")),
        exp.Second: lambda self, e: f"CAST(FLOOR(EXTRACT(SECOND FROM {self.sql(e, 'this')})) AS INTEGER)",
        exp.Ceil: lambda self, e: (f"CAST(CEIL({self.sql(e, 'this')}) AS BIGINT)" if not e.args.get("decimals")
                                   else f"CEIL({self.sql(e, 'this')}, {self.sql(e, 'decimals')})"),
        exp.Floor: lambda self, e: (f"CAST(FLOOR({self.sql(e, 'this')}) AS BIGINT)" if not e.args.get("decimals")
                                    else f"FLOOR({self.sql(e, 'this')}, {self.sql(e, 'decimals')})"),
        exp.DayOfWeek: lambda self, e: f"(CAST(EXTRACT(DOW FROM {self.sql(e, 'this')}) AS INTEGER) + 1)",
        exp.ArgMax: lambda self, e: (f"(ARRAY_AGG({self.sql(e, 'this')} ORDER BY {self.sql(e, 'expression')} DESC) "
                                     f"FILTER (WHERE {self.sql(e, 'expression')} IS NOT NULL))[1]"),
        exp.ArgMin: lambda self, e: (f"(ARRAY_AGG({self.sql(e, 'this')} ORDER BY {self.sql(e, 'expression')} ASC) "
                                     f"FILTER (WHERE {self.sql(e, 'expression')} IS NOT NULL))[1]"),
        exp.ArrayUniqueAgg: lambda self, e: f"ARRAY_AGG(DISTINCT {self.sql(e, 'this')}) FILTER (WHERE {self.sql(e, 'this')} IS NOT NULL)",
        exp.Quantile: lambda self, e: f"PERCENTILE_CONT({self.sql(e, 'quantile')}) WITHIN GROUP (ORDER BY {self.sql(e, 'this')})",
        exp.ApproxQuantile: lambda self, e: f"PERCENTILE_DISC({self.sql(e, 'quantile')}) WITHIN GROUP (ORDER BY {self.sql(e, 'this')})",
        exp.ApproxDistinct: lambda self, e: f"COUNT(DISTINCT {self.sql(e, 'this')})",
        exp.TsOrDsAdd: lambda self, e: (f"CAST({self.sql(e, 'this')} AS DATE) + CAST({self.sql(e, 'expression')} AS INTEGER)"
                                        if _unit(e.args.get("unit")) in ("", "DAY") else
                                        f"CAST(CAST({self.sql(e, 'this')} AS DATE) + "
                                        f"{_interval(_unit(e.args.get('unit')), self.sql(e, 'expression'))} AS DATE)"),
        exp.TimestampAdd: lambda self, e: (f"CAST({self.sql(e, 'this')} AS TIMESTAMPTZ) + "
                                           f"{_interval(_unit(e.args.get('unit')), self.sql(e, 'expression'))}"),
        exp.DateAdd: lambda self, e: (f"CAST({self.sql(e, 'this')} AS TIMESTAMPTZ) + "
                                      f"{_interval(_unit(e.args.get('unit')) or 'DAY', self.sql(e, 'expression'))}"),
        exp.AddMonths: lambda self, e: f"CAST(CAST({self.sql(e, 'this')} AS DATE) + {_interval('MONTH', self.sql(e, 'expression'))} AS DATE)",
        exp.DateTrunc: lambda self, e: f"CAST(DATE_TRUNC('{_trunc_unit(e.args.get('unit'))}', {self.sql(e, 'this')}) AS DATE)",
        exp.TimestampTrunc: lambda self, e: (f"DATE_TRUNC('{_trunc_unit(e.args.get('unit'))}', "
                                             f"CAST({self.sql(e, 'this')} AS TIMESTAMPTZ))"),
        exp.TimestampDiff: _time_diff,
        exp.StrToUnix: _str_to_unix,
        exp.UnixToStr: _unix_to_str,
        exp.RegexpExtract: _regexp_extract,
        exp.IntDiv: lambda self, e: f"CAST(TRUNC(CAST({self.sql(e, 'this')} AS NUMERIC) / {self.sql(e, 'expression')}) AS BIGINT)",
    }


def _dialect():
    if not _DIALECT:
        from sqlglot import exp
        from sqlglot.dialects.postgres import Postgres

        class Served(Postgres):
            class Generator(Postgres.Generator):
                TRANSFORMS = {**Postgres.Generator.TRANSFORMS, **_transforms(exp)}

        _DIALECT.append(Served)
    return _DIALECT[0]


def escape_percent(text: str) -> str:
    out, quote = [], None
    for ch in text:
        if quote and ch == "%":
            out.append("%%")
            continue
        if quote and ch == quote:
            quote = None
        elif not quote and ch in ("'", '"'):
            quote = ch
        out.append(ch)
    return "".join(out)


def _spark_name(node) -> str:
    return node.sql(dialect="databricks").split("(")[0].strip().upper() or type(node).__name__.upper()


def refuse_unserved(tree) -> None:
    from sqlglot import exp
    for node in tree.walk():
        if isinstance(node, exp.Anonymous):
            if node.name.lower() not in SERVED_CALLS:
                raise NotServed(f"the query uses {node.name.upper()}, which Lakebase cannot run")
        elif isinstance(node, exp.Func) and type(node).__name__ not in SERVED | REWRITTEN:
            raise NotServed(f"the query uses {_spark_name(node)}, which Lakebase cannot run")


def _spark_type(text: str):
    from sqlglot import exp
    from sqlglot.errors import SqlglotError
    try:
        return exp.DataType.build(str(text), dialect="databricks")
    except (SqlglotError, ValueError) as error:
        raise NotServed(f"the query reads JSON as {text}, which Lakebase cannot run") from error


def column_kinds(entries) -> dict:
    kinds = {}
    for entry in entries:
        for column in entry["columns"]:
            name, kind = str(column["name"]).lower(), str(column.get("type") or "").upper()
            text = str(column.get("type_text") or kind) if kind in JSON_TYPES else kind
            kinds[name] = text if kinds.get(name, text) == text else None
    return {name: text for name, text in kinds.items() if text}


def json_kinds(kinds: dict) -> dict:
    return {name: text for name, text in kinds.items() if text.split("<")[0].upper() in JSON_TYPES}


def _integral(node, kinds: dict) -> bool:
    from sqlglot import exp
    if isinstance(node, (exp.Paren, exp.Neg)):
        return _integral(node.this, kinds)
    if isinstance(node, (exp.Add, exp.Sub, exp.Mul, exp.Mod)):
        return _integral(node.this, kinds) and _integral(node.expression, kinds)
    if isinstance(node, (exp.Count, exp.CountIf, exp.RowNumber, exp.Rank, exp.DenseRank, exp.Ntile, exp.Length, exp.Predicate,
                         exp.Connector, exp.Not, exp.Boolean)):
        return True
    if isinstance(node, exp.Literal):
        return node.is_int
    if isinstance(node, exp.Column):
        return kinds.get(node.name.lower()) in INTEGER_PARAMS + ("BOOLEAN",)
    return isinstance(node, exp.Cast) and node.to.this in exp.DataType.INTEGER_TYPES


def _bigint_sums(tree, kinds: dict) -> None:
    from sqlglot import exp
    for total in list(tree.find_all(exp.Sum)):
        if _integral(total.this, kinds):
            target = total
            while isinstance(target.parent, (exp.Window, exp.Filter)):
                target = target.parent
            target.replace(exp.Cast(this=target.copy(), to=exp.DataType.build("BIGINT")))


def _numeric_mods(tree, kinds: dict) -> None:
    from sqlglot import exp
    for mod in reversed(list(tree.find_all(exp.Mod))):
        if not (_integral(mod.this, kinds) and _integral(mod.expression, kinds)):
            numeric = exp.DataType.build("NUMERIC", dialect="postgres")
            mod.replace(exp.Anonymous(this="MOD", expressions=[exp.Cast(this=mod.this.copy(), to=numeric),
                                                               exp.Cast(this=mod.expression.copy(), to=numeric.copy())]))


def _truncate_integer_casts(tree, kinds: dict) -> None:
    from sqlglot import exp
    for cast in list(tree.find_all(exp.Cast)):
        if cast.to.this in exp.DataType.INTEGER_TYPES and not _integral(cast.this, kinds):
            numeric = exp.Cast(this=cast.this.copy(), to=exp.DataType.build("NUMERIC", dialect="postgres"))
            cast.set("this", exp.Anonymous(this="TRUNC", expressions=[numeric]))


def _json_of(node, kinds):
    from sqlglot import exp
    spark = node.meta.get("spark_type") if node.meta else None
    if spark is not None:
        return spark
    if isinstance(node, exp.Column) and node.name.lower() in kinds:
        return _spark_type(kinds[node.name.lower()])
    return None


def _template(sql: str, **parts):
    import sqlglot
    from sqlglot import exp
    tree = sqlglot.parse_one(sql, read="postgres")
    for column in list(tree.find_all(exp.Column)):
        if column.name in parts and not column.table:
            column.replace(parts[column.name].copy())
    return tree


def _element(spark, what: str):
    from sqlglot import exp
    if not spark.is_type(exp.DataType.Type.ARRAY):
        raise NotServed(f"the query uses {what} on a map or struct, which Lakebase cannot run")
    element = spark.expressions[0] if spark.expressions else exp.DataType.build("STRING")
    return element


def _scalar_elements(node, spark, what: str):
    from sqlglot import exp
    element = _element(spark, what)
    if element.this in exp.DataType.NESTED_TYPES:
        raise NotServed(f"the query uses {what} on an array of structs, which Lakebase cannot run")
    out = exp.Anonymous(this="JSONB_ARRAY_ELEMENTS_TEXT", expressions=[node.copy()])
    return out if element.this in exp.DataType.TEXT_TYPES else exp.Cast(this=out, to=element.copy())


def _from_json(node):
    from sqlglot import exp
    args = node.expressions
    if len(args) != 2 or not args[1].is_string:
        raise NotServed("the query reads JSON without naming its type, which Lakebase cannot run")
    spark = _spark_type(args[1].name)
    if spark.this not in exp.DataType.NESTED_TYPES:
        raise NotServed(f"the query reads JSON as {args[1].name}, which Lakebase cannot run")
    out = exp.Cast(this=args[0].copy(), to=exp.DataType.build("JSONB", dialect="postgres"))
    out.meta["spark_type"] = spark
    return out


def _inline(node, kinds):
    from sqlglot import exp
    spark, select = _json_of(node.this, kinds), node.parent
    element = _element(spark, "INLINE") if spark is not None else None
    source = "from_" if "from_" in exp.Select.arg_types else "from"
    if (element is None or not element.is_type(exp.DataType.Type.STRUCT) or not isinstance(select, exp.Select)
            or select.expressions != [node] or select.args.get(source)):
        raise NotServed("the query uses INLINE other than to read a JSON array of structs on its own, which Lakebase cannot run")
    fields = ", ".join(f'"{f.this.name}" {f.args["kind"].sql(dialect="postgres")}' for f in element.expressions)
    table = _template(f'SELECT * FROM JSONB_TO_RECORDSET(__json__) AS "_inline"({fields})', __json__=node.this)
    select.set("expressions", [exp.Star()])
    select.set(source, table.args[source])


def _json_path(path) -> list:
    from sqlglot import exp
    keys = []
    for part in (path.expressions if isinstance(path, exp.JSONPath) else [None]):
        if isinstance(part, exp.JSONPathRoot):
            continue
        if isinstance(part, exp.JSONPathKey) and isinstance(part.this, str):
            keys.append(part.this)
        elif isinstance(part, exp.JSONPathSubscript) and isinstance(part.this, int) and part.this >= 0:
            keys.append(str(part.this))
        else:
            raise NotServed("the query reads JSON with a path Lakebase cannot follow")
    return keys


def _path_text(target, keys: list):
    from sqlglot import exp
    return exp.Anonymous(this="JSONB_EXTRACT_PATH_TEXT", expressions=[target.copy()] + [exp.Literal.string(k) for k in keys])


def _rewrite_json(tree, kinds) -> None:
    from sqlglot import exp
    for node in list(tree.find_all(exp.Anonymous)):
        name, args = node.name.lower(), node.expressions
        if name == "from_json":
            node.replace(_from_json(node))
        elif name in ("isnull", "isnotnull") and len(args) == 1:
            test = exp.Paren(this=exp.Is(this=args[0].copy(), expression=exp.Null()))
            node.replace(test if name == "isnull" else exp.Paren(this=exp.Not(this=test)))
        elif name == "pmod" and len(args) == 2:
            a, b = args
            node.replace(exp.Paren(this=exp.Mod(this=exp.Paren(this=exp.Add(this=exp.Paren(this=exp.Mod(this=a.copy(), expression=b.copy())),
                                                                              expression=b.copy())), expression=b.copy())))
        elif name in REWRITTEN_CALLS:
            raise NotServed(f"the query uses {name.upper()} in a form Lakebase cannot run")
    for node in list(tree.find_all(exp.Inline)):
        _inline(node, kinds)
    for node in reversed(list(tree.find_all(exp.Explode, exp.ArraySize, exp.ArrayContains, exp.ArrayToString, exp.Bracket,
                                            exp.JSONExtractScalar))):
        spark = _json_of(node.this, kinds)
        if isinstance(node, exp.JSONExtractScalar):
            target = node.this if spark is not None else exp.Cast(this=node.this.copy(), to=exp.DataType.build("JSONB", dialect="postgres"))
            node.replace(_path_text(target, _json_path(node.expression)))
        elif isinstance(node, exp.ArraySize):
            length = exp.Anonymous(this="CARDINALITY" if spark is None else "JSONB_ARRAY_LENGTH", expressions=[node.this.copy()])
            node.replace(exp.Coalesce(this=length, expressions=[exp.Literal.number(-1)]))
        elif spark is None:
            continue
        elif isinstance(node, exp.Explode):
            node.replace(_scalar_elements(node.this, spark, "EXPLODE"))
        elif isinstance(node, exp.ArrayContains):
            _element(spark, "ARRAY_CONTAINS")
            node.replace(exp.Paren(this=exp.ArrayContainsAll(
                this=node.this.copy(), expression=exp.Anonymous(this="JSONB_BUILD_ARRAY", expressions=[node.expression.copy()]))))
        elif isinstance(node, exp.ArrayToString):
            _scalar_elements(node.this, spark, "ARRAY_JOIN")
            node.replace(_template(
                'CASE WHEN __a__ IS NULL THEN NULL ELSE COALESCE((SELECT STRING_AGG("_e"."v", __s__ ORDER BY "_e"."n") FROM '
                'JSONB_ARRAY_ELEMENTS_TEXT(__a__) WITH ORDINALITY AS "_e"("v", "n")), \'\') END', __a__=node.this, __s__=node.expression))
        else:
            index = node.expressions[0] if len(node.expressions) == 1 else None
            if index is None or not (index.is_string or index.is_int):
                raise NotServed("the query reads an array or map element by a computed index, which Lakebase cannot run")
            key = index.name if index.is_string else str(int(index.name) - int(node.args.get("offset") or 0))
            if key.startswith("-"):
                raise NotServed("the query reads an array element counted from its end, which Lakebase cannot run")
            node.replace(_path_text(node.this, [key]))


def param_value(param: dict):
    value, kind = param.get("value"), str(param.get("type") or "STRING").upper()
    if value is None:
        return None
    if kind == "DATE":
        return datetime.date.fromisoformat(str(value)[:10])
    if kind in INTEGER_PARAMS:
        return int(value)
    if kind in ("FLOAT", "DOUBLE"):
        return float(value)
    if kind.startswith("DECIMAL"):
        return decimal.Decimal(str(value))
    if kind == "BOOLEAN":
        return str(value).lower() == "true"
    return str(value)


def pg_ident(name) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def pg_type(column: dict) -> str:
    kind, text = str(column.get("type") or "").upper(), str(column.get("type_text") or "").upper().replace(" ", "")
    if kind == "DECIMAL":
        return "NUMERIC" + (text[7:] if text.startswith("DECIMAL(") else "")
    return PG_TYPES.get(kind, "TEXT")


def _overlay(entry: dict, overlay: dict, index: int, values: dict):
    import sqlglot
    schema, name = entry["pg"].split(".")
    columns = [c for c in entry["columns"] if c["name"] != ROW_COLUMN]
    names = ", ".join(pg_ident(c["name"]) for c in columns)
    typed = ", ".join(f"{pg_ident(c['name'])} {pg_type(c)}" for c in columns)
    keys, rows = f"_lb_keys_{index}", f"_lb_rows_{index}"
    try:
        values[keys] = json.dumps(sorted(overlay["keys"]), allow_nan=False)
        values[rows] = json.dumps(overlay["rows"], allow_nan=False, default=str)
    except ValueError as error:
        raise NotServed(f"the latest changes to {entry['pg']} cannot be shown on top of Lakebase: {error}") from error
    return sqlglot.parse_one(
        f"SELECT {names} FROM {pg_ident(schema)}.{pg_ident(name)} AS \"_c\" WHERE NOT EXISTS (SELECT 1 FROM "
        f"JSONB_ARRAY_ELEMENTS_TEXT(CAST(%({keys})s AS JSONB)) AS \"_k\"(\"v\") WHERE \"_k\".\"v\" = CAST(\"_c\".{pg_ident(overlay['column'])} "
        f"AS TEXT)) UNION ALL SELECT {names} FROM JSONB_TO_RECORDSET(CAST(%({rows})s AS JSONB)) AS \"_o\"({typed})", read="postgres")


def render(sql: str, params, tables: dict, held=(), overlays=None) -> tuple:
    import sqlglot
    from sqlglot import exp
    from sqlglot.errors import ErrorLevel, SqlglotError

    try:
        tree = sqlglot.parse_one(sql, read="databricks")
    except SqlglotError as error:
        raise NotServed(f"the query is not one Lakebase can read: {error}") from error
    refuse_unserved(tree)
    read, values = set(), {p["name"]: param_value(p) for p in params or []}
    for table in list(tree.find_all(exp.Table)):
        parts = [p for p in (table.catalog, table.db, table.name) if p]
        if len(parts) == 1:
            continue
        key = ".".join(parts).lower()
        entry = tables.get(key)
        if entry is None:
            raise NotHeld(key)
        if key in held:
            raise NotServed(f"{key} changed after Lakebase last synced it")
        alias = exp.to_identifier(table.alias or table.name, quoted=True)
        schema, name = entry["pg"].split(".")
        copy = exp.Table(this=exp.to_identifier(name, quoted=True), db=exp.to_identifier(schema, quoted=True))
        columns = [c["name"] for c in entry["columns"] if c["name"] != ROW_COLUMN]
        if (overlays or {}).get(key):
            table.replace(_overlay(entry, overlays[key], sum(1 for v in values if v.startswith("_lb_keys_")), values).subquery(alias))
        elif len(columns) == len(entry["columns"]):
            copy.set("alias", table.args.get("alias") or exp.TableAlias(this=alias))
            table.replace(copy)
        else:
            body = exp.select(*(exp.column(c, quoted=True) for c in columns)).from_(copy)
            table.replace(body.subquery(alias))
        read.add(key)
    kinds = column_kinds(tables[k] for k in read)
    _truncate_integer_casts(tree, kinds)
    _bigint_sums(tree, kinds)
    _rewrite_json(tree, json_kinds(kinds))
    _numeric_mods(tree, kinds)
    try:
        text = tree.sql(dialect=_dialect(), identify=True, unsupported_level=ErrorLevel.RAISE)
    except SqlglotError as error:
        raise NotServed(f"the query uses SQL Lakebase cannot run: {error}") from error
    return escape_percent(text), values, read


def dataset_reads(sql: str):
    try:
        import sqlglot
        from sqlglot import exp
        from sqlglot.errors import SqlglotError
    except ImportError:
        return None
    try:
        tree = sqlglot.parse_one(str(sql or ""), read="databricks")
    except SqlglotError:
        return None
    return {".".join(p for p in (t.catalog, t.db, t.name) if p).lower() for t in tree.find_all(exp.Table) if t.db}


def derived_copies(page: dict, backend: dict) -> set:
    views = (backend.get("datasets") or {}).get(page.get("id")) or {}
    result = uc_key(page.get("result_table")) if page.get("result_table") else ""
    out = set()
    for dataset in page.get("datasets") or []:
        view = views.get(dataset.get("name"))
        reads = dataset_reads(dataset.get("sql")) if view else set()
        if view and result and (reads is None or result in reads):
            out.add(uc_key(view))
    return out


def overlay_plan(pages: list, backend: dict, derived: dict, result_table: str, record_keys) -> dict:
    tables = {uc_key(k): v for k, v in (backend.get("tables") or {}).items()}
    result = current_copy(backend, result_table) or uc_key(result_table)
    if result not in tables or not record_keys:
        return {}
    kept = {c["name"] for c in tables[result]["columns"]}
    copies = {}
    for page in pages:
        view = uc_key(((backend.get("datasets") or {}).get(page.get("id")) or {}).get("records") or "")
        if uc_key(page.get("result_table")) != uc_key(result_table) or view not in tables or view not in (derived.get(page.get("id")) or ()):
            continue
        names = {c["name"] for c in tables[view]["columns"]}
        key = (page.get("records") or {}).get("key")
        column = "record_key" if "record_key" in names and "record_key" in kept else key if key in names and key in kept else None
        if column:
            copies[view] = column
    return {"result": result, "keys": sorted({str(k) for k in record_keys}), "copies": copies}


def dataset_sources(pages: list, backend: dict) -> dict:
    out = {}
    for page in pages:
        current = current_copy(backend, page.get("result_table")) if page.get("result_table") else ""
        if current:
            out[current] = f"SELECT * FROM {uc_name(page['result_table'])} WHERE `is_current` AND `change_source` <> 'delete'"
        views = (backend.get("datasets") or {}).get(page.get("id")) or {}
        for dataset in page.get("datasets") or []:
            if views.get(dataset.get("name")):
                out[uc_key(views[dataset["name"]])] = str(dataset.get("sql") or "").strip().rstrip(";")
    return out


def overlay_query(table: str, columns: list, column: str, values: list, source: str = "") -> tuple:
    names = ", ".join(quoted(c["name"]) for c in columns if c["name"] != ROW_COLUMN)
    origin = f"({source}) AS d" if source else uc_name(table)
    return (f"SELECT {names} FROM {origin} WHERE CAST({quoted(column)} AS STRING) IN "
            f"(SELECT explode(from_json(:keys, 'ARRAY<STRING>')))",
            [{"name": "keys", "value": json.dumps(sorted(values)), "type": "STRING"}])


def cell(value):
    if value is None or isinstance(value, (bool, float, str)):
        return value
    if isinstance(value, (int, list, dict)):
        return browser_whole(value)
    if isinstance(value, decimal.Decimal):
        whole = value.is_finite() and value == value.to_integral_value() and abs(value) > BROWSER_SAFE_WHOLE
        return browser_whole(int(value)) if whole else float(value)
    if isinstance(value, datetime.datetime):
        zoned = value.tzinfo is not None
        value = value.astimezone(datetime.timezone.utc) if zoned else value
        return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}" + ("Z" if zoned else "")
    if isinstance(value, datetime.date):
        return value.isoformat()
    return str(value)


def columns_of(names: list, type_names: list, known: dict) -> list:
    out = []
    for name, type_name in zip(names, type_names):
        uc = known.get(name)
        if uc:
            kind = str(uc["type"]).upper()
            out.append({"name": name, "type": kind, "type_text": str(uc.get("type_text") or kind).upper()})
        else:
            kind = TYPE_NAMES.get(type_name, "STRING")
            out.append({"name": name, "type": kind, "type_text": kind})
    return out


def epoch_of(value, fallback: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return (value / 1000 if value >= EPOCH_MS_FROM else value) if value > 0 else fallback
    text = str(value or "").strip()
    if text.isdigit():
        return epoch_of(int(text), fallback)
    stamp = stamp_of(text)
    return stamp.timestamp() if stamp else fallback


class Lakebase:
    def __init__(self, backend: dict, env: dict, service, clock=time.time, sleep=time.sleep, connect=None):
        missing = [k for k in ENV_KEYS if not str(env.get(k) or "").strip()]
        if missing:
            raise LakebaseError(f"the App has no Lakebase database to read: {', '.join(missing)} is not set, so add its postgres "
                                f"resource")
        self.host, self.database, self.user, self.endpoint = (str(env[k]).strip() for k in ENV_KEYS)
        self.port = int(env.get("PGPORT") or 5432)
        self.tables = {uc_key(k): v for k, v in backend["tables"].items()}
        self.pipeline = backend["pipeline_id"]
        self.service, self.clock, self.sleep = service, clock, sleep
        self._connect = connect
        self.pool = queue.LifoQueue()
        self.lock = threading.Lock()
        self.token, self.expires = "", 0.0
        self.held, self.syncer = {}, None
        self.overlays, self.stuck, self.queued, self.overlayer = {}, {}, queue.Queue(), None
        self.note, self.noted_at, self.synced_at = "", 0.0, None
        self.synced_iso, self.synced_read = None, float("-inf")

    def credential(self) -> str:
        with self.lock:
            if self.token and self.clock() < self.expires - TOKEN_SLACK_S:
                return self.token
        try:
            body = self.service().call("POST", "/api/2.0/postgres/credentials", {"endpoint": self.endpoint})
        except QueryError as error:
            raise LakebaseError(f"the App could not get a Lakebase password: {error}") from error
        token = str(body.get("token") or "")
        if not token:
            raise LakebaseError("Lakebase gave the App no password")
        with self.lock:
            self.token, self.expires = token, epoch_of(body.get("expire_time"), self.clock() + TOKEN_LIFE_S)
        return token

    def _psycopg(self):
        try:
            import psycopg
        except ImportError as error:
            raise LakebaseError("the App cannot read Lakebase because psycopg is not installed") from error
        password = self.credential()
        try:
            conn = (self._connect or psycopg.connect)(host=self.host, port=self.port, dbname=self.database, user=self.user,
                                                      password=password, sslmode="require", connect_timeout=CONNECT_TIMEOUT_S,
                                                      autocommit=True)
            with conn.cursor() as cur:
                cur.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
                cur.execute("SET default_transaction_read_only = on")
                cur.execute("SET TIME ZONE 'UTC'")
        except psycopg.Error as error:
            raise LakebaseError(f"the App could not connect to Lakebase: {error}") from error
        return conn

    def _take(self):
        while True:
            try:
                conn = self.pool.get_nowait()
            except queue.Empty:
                return self._psycopg()
            if not getattr(conn, "closed", False):
                return conn

    def _give(self, conn) -> None:
        if getattr(conn, "closed", False):
            return
        if self.pool.qsize() < POOL_SIZE:
            self.pool.put(conn)
        else:
            conn.close()

    @staticmethod
    def _type_name(conn, oid) -> str:
        info = conn.adapters.types.get(oid) if hasattr(conn, "adapters") else None
        return getattr(info, "name", "") or ""

    @staticmethod
    def _lost(error) -> bool:
        try:
            import psycopg
        except ImportError:
            return False
        if isinstance(error, psycopg.errors.QueryCanceled):
            return False
        return isinstance(error, (psycopg.OperationalError, psycopg.InterfaceError))

    def query(self, text: str, values: dict, limit: int) -> tuple:
        for attempt in (0, 1):
            conn = self._take()
            try:
                with conn.transaction():
                    with conn.cursor() as setup:
                        setup.execute(f"SET LOCAL statement_timeout = {READ_TIMEOUT_MS}")
                    with conn.cursor(name=READ_CURSOR) as cur:
                        cur.execute(text, values)
                        rows = cur.fetchmany(limit + 1)
                        description = list(cur.description or [])
                names = [c.name for c in description]
                types = [self._type_name(conn, c.type_code) for c in description]
            except Exception as error:
                lost = self._lost(error)
                if not lost:
                    self._give(conn)
                    raise QueryError(str(error).strip() or type(error).__name__) from error
                try:
                    conn.close()
                except Exception:
                    pass
                self.close()
                if attempt == 0:
                    continue
                raise LakebaseError(f"Lakebase did not answer: {error}") from error
            self._give(conn)
            return names, types, rows
        raise LakebaseError("Lakebase did not answer")

    def run(self, sql: str, params, limit: int) -> dict:
        with self.lock:
            held = set(self.held)
            overlays = {table: {"column": entry["column"], "keys": list(entry["rows"]),
                                "rows": [row for _at, rows in entry["rows"].values() for row in rows]}
                        for table, entry in self.overlays.items() if entry["rows"]}
        text, values, read = render(sql, params, self.tables, held, overlays)
        known = {}
        for key in sorted(read):
            for column in self.tables[key]["columns"]:
                known.setdefault(column["name"], column)
        names, types, rows = self.query(text, values, limit)
        return {"columns": columns_of(names, types, known), "rows": [{n: cell(v) for n, v in zip(names, row)} for row in rows[:limit]],
                "truncated": len(rows) > limit}

    def noted(self, text: str) -> None:
        with self.lock:
            self.note, self.noted_at = " ".join(str(text).split())[:600], self.clock()

    def pending(self) -> bool:
        with self.lock:
            return bool(self.held)

    def status(self) -> dict:
        synced = self.synced()
        with self.lock:
            note = self.note if self.note and self.clock() - self.noted_at < NOTE_TTL_S else ""
            return {"note": note, "catching_up": bool(self.held), "synced_at": synced}

    def synced_marker(self):
        with self.lock:
            fresh = self.clock() - self.synced_read < SYNCED_TTL_S
            return self.synced_iso if fresh and self.synced_iso and not self.held and not self.overlays else None

    def synced(self):
        with self.lock:
            if self.clock() - self.synced_read < SYNCED_TTL_S:
                return self.synced_iso
        try:
            updates = self.service().call("GET", f"/api/2.0/pipelines/{self.pipeline}").get("latest_updates") or []
        except QueryError:
            updates = None
        if updates is not None:
            done = [epoch_of(u.get("creation_time"), 0) for u in updates if str(u.get("state") or "") in SYNC_DONE]
            latest = max(done + ([self.synced_at] if self.synced_at else []), default=0)
            iso = (datetime.datetime.fromtimestamp(latest, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if latest else None)
            with self.lock:
                self.synced_iso, self.synced_read = iso, self.clock()
        return self.synced_iso

    def wrote(self, keys, plan=None, fetch=None) -> None:
        now, threads = self.clock(), []
        plan = plan if plan and plan.get("result") in self.tables else None
        with self.lock:
            for key in {uc_key(k) for k in keys} | ({plan["result"], *plan["copies"]} if plan else set()):
                if key in self.tables:
                    self.held[key] = now
            if plan and fetch is not None:
                self.queued.put((plan, fetch, now))
                if self.overlayer is None:
                    self.overlayer = threading.Thread(target=self._overlay_loop, name="lakebase-overlay", daemon=True)
                    threads.append(self.overlayer)
            if self.held and self.syncer is None:
                self.syncer = threading.Thread(target=self._sync, name="lakebase-sync", daemon=True)
                threads.append(self.syncer)
        for thread in threads:
            thread.start()

    def _overlay_loop(self) -> None:
        try:
            while True:
                with self.lock:
                    if self.queued.empty():
                        self.overlayer = None
                        return
                    plan, fetch, at = self.queued.get_nowait()
                self.overlay(plan, fetch, at)
        except BaseException:
            with self.lock:
                self.overlayer = None
            raise

    def _rows(self, fetch, table: str, column: str, values: list) -> list:
        names = [c["name"] for c in self.tables[table]["columns"] if c["name"] != ROW_COLUMN]
        return [{n: row.get(n) for n in names} for row in fetch(table, self.tables[table]["columns"], column, values)] if values else []

    def overlay(self, plan: dict, fetch, at: float) -> None:
        result, tables = plan["result"], [plan["result"], *plan["copies"]]
        try:
            found = {result: ("record_key", plan["keys"], self._rows(fetch, result, "record_key", plan["keys"]))}
            for view, column in plan["copies"].items():
                values = sorted({str(r[column]) for r in found[result][2] if r.get(column) is not None})
                found[view] = (column, values, self._rows(fetch, view, column, values))
        except Exception as error:
            with self.lock:
                for table in tables:
                    self.stuck[table] = max(self.stuck.get(table, at), at)
            self.noted(f"the App reads your latest changes from Delta tables until Lakebase syncs them, because it could not "
                       f"read them back: {error}")
            return
        with self.lock:
            if self.synced_at is not None and self.synced_at >= at - CLOCK_SKEW_S:
                return
            for table, (column, keys, rows) in found.items():
                entry = self.overlays.setdefault(table, {"column": column, "rows": {}})
                grouped = {}
                for row in rows:
                    grouped.setdefault(str(row.get(column)), []).append(row)
                for key in keys:
                    if key not in entry["rows"] or entry["rows"][key][0] <= at:
                        entry["rows"][key] = (at, grouped.get(key, []))
                if len(entry["rows"]) > OVERLAY_KEYS or sum(len(r) for _t, r in entry["rows"].values()) > OVERLAY_ROWS:
                    del self.overlays[table]
                    self.stuck[table] = max(self.stuck.get(table, at), at)
                if self.held.get(table) == at and table not in self.stuck:
                    del self.held[table]

    def landed(self, created: float) -> None:
        cut = created - CLOCK_SKEW_S
        with self.lock:
            self.held = {k: t for k, t in self.held.items() if t >= cut}
            self.stuck = {k: t for k, t in self.stuck.items() if t >= cut}
            for table in list(self.overlays):
                kept = {k: v for k, v in self.overlays[table]["rows"].items() if v[0] >= cut}
                if kept:
                    self.overlays[table]["rows"] = kept
                else:
                    del self.overlays[table]
            self.synced_at = max(created, self.synced_at or created)

    def _sync(self) -> None:
        try:
            while True:
                with self.lock:
                    if not self.held and not self.overlays:
                        self.syncer = None
                        return
                try:
                    state, created = self.sync_now()
                except QueryError as error:
                    self.noted(f"Lakebase could not sync the latest changes, so the App reads them from Delta tables: {error}")
                    self.sleep(SYNC_RETRY_S)
                    continue
                if state in SYNC_DONE:
                    self.landed(created)
                else:
                    self.noted(f"the Lakebase sync ended {state.lower()}, so the App reads the latest changes from Delta tables")
                    self.sleep(SYNC_RETRY_S)
        except BaseException:
            with self.lock:
                self.syncer = None
            raise

    def close(self) -> None:
        while True:
            try:
                conn = self.pool.get_nowait()
            except queue.Empty:
                return
            conn.close()

    def sync_now(self) -> tuple:
        return self._wait(self._update())

    def _update(self) -> str:
        ws = self.service()
        try:
            return str(ws.call("POST", f"/api/2.0/pipelines/{self.pipeline}/updates", {}).get("update_id") or "")
        except QueryError:
            detail = ws.call("GET", f"/api/2.0/pipelines/{self.pipeline}")
            for update in detail.get("latest_updates") or []:
                if str(update.get("state") or "") not in SYNC_ENDED and update.get("update_id"):
                    return str(update["update_id"])
            raise

    def _wait(self, update_id: str) -> tuple:
        if not update_id:
            raise QueryError("the Lakebase sync pipeline started no update")
        started = self.clock()
        while True:
            update = self.service().call("GET", f"/api/2.0/pipelines/{self.pipeline}/updates/{update_id}").get("update") or {}
            state = str(update.get("state") or "")
            if state in SYNC_ENDED:
                return state, epoch_of(update.get("creation_time"), 0)
            if self.clock() - started > SYNC_DEADLINE_S:
                raise QueryError(f"the Lakebase sync ran longer than {SYNC_DEADLINE_S // 60} minutes")
            self.sleep(SYNC_POLL_S)
