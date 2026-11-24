"""Shared offline doubles for the v1.2.0 ARTIFACTS lane tests (writers, tracking, translation,
storage). Not a test module: pytest collects only *_test.py files.
"""
import base64
import os
import re
import sys
import threading
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


class CapturingLogger:
    def __init__(self):
        self.records = []
        self._lock = threading.Lock()

    def _add(self, level, msg):
        with self._lock:
            self.records.append((level, str(msg)))

    def debug(self, msg, *a, **k):
        self._add("DEBUG", msg)

    def info(self, msg, *a, **k):
        self._add("INFO", msg)

    def warning(self, msg, *a, **k):
        self._add("WARNING", msg)

    def error(self, msg, *a, **k):
        self._add("ERROR", msg)

    def critical(self, msg, *a, **k):
        self._add("CRITICAL", msg)

    def exception(self, msg, *a, **k):
        self._add("ERROR", msg)

    def matching(self, needle, level=None):
        with self._lock:
            return [r for r in self.records if needle in r[1] and (level is None or r[0] == level)]


class FakeWorkspaceApi:
    def __init__(self, fail=False):
        self.files = {}
        self.dirs = set()
        self.fail = fail

    def mkdirs(self, path):
        self.dirs.add(path)

    def import_(self, path, content, format=None, overwrite=True):
        if self.fail:
            raise RuntimeError("workspace import limit exceeded")
        self.files[path] = base64.b64decode(content)

    def export(self, path, format=None):
        if path not in self.files:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: Path ({path}) doesn't exist.")
        return types.SimpleNamespace(content=base64.b64encode(self.files[path]).decode())

    def get_status(self, path):
        return types.SimpleNamespace(path=path, object_id=None)


class RunNowApiClient:
    def __init__(self, jobs):
        self.jobs = jobs

    def do(self, method, path, query=None, headers=None, body=None, raw=False, files=None, data=None, response_headers=None):
        assert (method, path) == ("POST", "/api/2.1/jobs/run-now"), (method, path)
        return {"run_id": self.jobs.run_now(**body).run_id}


class FakeWriter:
    def __init__(self, df):
        self.df = df
        self.options = {}
        self._format = None
        self._mode = None

    def format(self, value):
        self._format = value
        return self

    def mode(self, value):
        self._mode = value
        return self

    def option(self, key, value):
        self.options[key] = value
        return self

    def saveAsTable(self, name):
        spark = self.df.spark
        record = {"table": name, "mode": self._mode, "format": self._format, "options": dict(self.options),
                  "rows": list(self.df.rows), "source": self.df.source}
        if spark.fail_write and spark.fail_write(record):
            raise RuntimeError(f"write to {name} failed")
        spark.writes.append(record)


# The REQ-249 repr guard runs one SQL shape over a frame: max(CAST(`col` RLIKE 'pattern' AS INT)) AS cN.
REPR_GUARD_EXPR = re.compile(r"^max\(CAST\(`(?P<col>[^`]+)` RLIKE '(?P<lit>(?:[^'\\]|\\.)*)' AS INT\)\) AS c(?P<i>\d+)$")


class FakeDataFrame:
    def __init__(self, spark, rows=None, source=None, columns=None):
        self.spark = spark
        self.rows = list(rows or [])
        self.source = source
        self.added_columns = []
        self.columns = list(columns or [])

    @property
    def schema(self):
        """The declared columns of a frame made by createDataFrame, as typed string columns (the summary and companion guards read it)."""
        return types.SimpleNamespace(fields=[types.SimpleNamespace(name=n, dataType=types.SimpleNamespace(typeName=lambda: "string"))
                                             for n in self.columns])

    def selectExpr(self, *exprs):
        """Evaluates the REQ-249 repr guard over the tuple rows: max() of the RLIKE hits, NULL when no row holds the column."""
        values = []
        for expr in exprs:
            match = REPR_GUARD_EXPR.match(expr)
            assert match, f"the guard emitted an unexpected expression: {expr}"
            index = self.columns.index(match.group("col"))
            pattern = re.sub(r"\\(.)", r"\1", match.group("lit"))
            hits = [int(bool(re.search(pattern, str(row[index])))) for row in self.rows if row[index] is not None]
            values.append(max(hits) if hits else None)
        return types.SimpleNamespace(first=lambda: tuple(values))

    def withColumn(self, name, value):
        self.added_columns.append(name)
        return self

    @property
    def write(self):
        return FakeWriter(self)

    def collect(self):
        return list(self.rows)


def absent_scope_views(statement):
    """A responder for a Spark double before any App-owned scope view exists. SHOW CREATE TABLE fails with NOT_FOUND, as Spark does for a
    view that is not there yet (scope_view_definition reads it before every rewrite); every other statement returns no rows."""
    if statement.startswith("SHOW CREATE TABLE "):
        raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found. SQLSTATE: 42P01")
    return []


class FakeSpark:
    """Records every statement and DataFrame write. `responder(statement)` may return rows (a list)
    for a statement or raise to simulate a failure."""

    def __init__(self, responder=None, fail_write=None):
        self.statements = []
        self.writes = []
        self.created = []
        self.responder = responder
        self.fail_write = fail_write
        self._lock = threading.Lock()

    def sql(self, statement, *args, **kwargs):
        with self._lock:
            self.statements.append(" ".join(str(statement).split()))
        rows = self.responder(" ".join(str(statement).split())) if self.responder else None
        text = " ".join(str(statement).split())
        match = re.match(r"^SELECT .* FROM (\S+)$", text, re.I)
        return FakeDataFrame(self, rows=rows or [], source=match.group(1) if match else None)

    def createDataFrame(self, rows, schema=None):
        rows = list(rows)
        self.created.append((rows, schema))
        if isinstance(schema, str):
            names = [part.split()[0] for part in schema.split(",")]
        elif schema is None:
            names = []
        else:
            # A pyspark StructType (the product passes one) exposes its columns as `.fields`; Spark iterates none of it.
            names = [field.name for field in schema.fields]
        return FakeDataFrame(self, rows=rows, columns=names)


class FakeDimension:
    """A pandas table read as a Spark DataFrame through the where, selectExpr, groupBy, agg and toDF calls the grouping join
    makes; `steps` records every call, shared by each frame the calls return."""

    def __init__(self, frame, steps=None):
        self.frame, self.steps, self.columns = frame, [] if steps is None else steps, list(frame.columns)

    def _next(self, frame, step):
        self.steps.append(step)
        return FakeDimension(frame, self.steps)

    def where(self, condition):
        named = re.fullmatch(r"`([^`]+)` IS NOT NULL", condition).group(1)
        return self._next(self.frame[self.frame[named].notna()], ("where", condition))

    def selectExpr(self, *exprs):
        import pandas as pd
        picked = {}
        for expr in exprs:
            cast = re.fullmatch(r"CAST\(`([^`]+)` AS STRING\) AS `([^`]+)`", expr)
            named = cast or re.fullmatch(r"`([^`]+)` AS `([^`]+)`", expr)
            source = self.frame[named.group(1)]
            picked[named.group(2)] = source.astype(str) if cast else source
        return self._next(pd.DataFrame(picked), ("selectExpr", list(exprs)))

    def groupBy(self, name):
        self.steps.append(("groupBy", name))
        return FakeGroupedDimension(self, name)

    def toDF(self, *names):
        return self._next(self.frame.set_axis(list(names), axis=1), ("toDF", list(names)))

    def toPandas(self):
        return self.frame.copy()


class FakeGroupedDimension:
    def __init__(self, dimension, name):
        self.dimension, self.name = dimension, name

    def agg(self, how):
        (column, function), = how.items()
        grouped = self.dimension.frame.groupby(self.name, as_index=False)[column].agg(function)
        return self.dimension._next(grouped, ("agg", dict(how)))


class TestEnvironmentAssets:
    """The packages come from this test environment and no font is in the assets, as on a machine with no Inspire assets."""

    def __init__(self, ns):
        self.ns = ns

    def python(self, module):
        return ""

    def path(self, entry):
        raise self.ns["InspireAssetError"]("The Inspire assets hold no files in tests.")

    def entry(self, kind, name, *args, **kwargs):
        raise self.ns["InspireAssetError"](f"The Inspire assets file /tests/manifest.json lists no {name}. Install step: none in tests.")


def unprotected_reads(ns):
    return lambda tables, warnings, *args: {t: ns["implement_protection"]([{"kind": "table", "function_name": "MANAGED"}]) for t in tables}


def make_inspire(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = CapturingLogger()
    obj._assets = TestEnvironmentAssets(ns)
    obj.session_id = 4242
    obj.business_name = "Acme"
    obj.inspire_database = ""
    obj.output_languages = ["English"]
    obj.generate_choices = []
    obj.docs_output_dir = "/Workspace/out/docs"
    obj.notebook_output_dir = "/Workspace/out/notebooks"
    obj._implement_protections = unprotected_reads(ns)
    obj._implement_root_dir = "/Workspace/Shared/inspire-ai"
    obj.w_client = types.SimpleNamespace(workspace=FakeWorkspaceApi(), config=types.SimpleNamespace(host=""))
    obj._notebook_object_ids = {}
    obj.final_inspire_results_json = {}
    obj.use_cases_quality = "Good"
    obj.atomic_writer = None
    obj.max_parallelism = 2
    obj.processing_honesty = {"total_tables_discovered": 0, "total_tables_processed": 0, "total_batches_created": 0,
                              "total_batch_splits": 0, "batch_split_history": [], "tables_with_columns_dropped": []}
    for key, value in attrs.items():
        setattr(obj, key, value)
    return obj


def elite_assessment(**overrides):
    assessment = {
        "decision": "Reorder stock for each store every Monday",
        "decision_owner": "Regional supply planner",
        "cadence": "weekly",
        "kpi": "Stock-out rate",
        "kpi_direction": "decrease",
        "value_driver": "Fewer stock-outs on `units_sold` peaks",
        "value_tier": "Material",
        "signal_columns": ["main.s.sales.units_sold", "main.s.sales.sale_date"],
        "join_path": ["main.s.sales.store_id = main.s.stores.store_id"],
        "build_path": "Daily forecast job writing a reorder table",
        "blockers": [],
        "red_team": "Promotions not in the data may distort the signal",
        "red_team_verdict": "survives",
        "scores": {"business_value": 9, "evidence_strength": 8, "implementability": 8, "actionability": 9},
        "verdict": "ELITE",
        "verdict_reason": "Weekly reorder decision backed by daily unit sales",
        "second_opinion": None,
        "verification": {"passed": True, "failures": []},
    }
    assessment.update(overrides)
    return assessment


def make_uc(no, domain="Sales", **extra):
    uc = {"No": no, "Name": f"Forecast demand {no}", "usecase": f"Forecast Demand {no}", "type": "Opportunity",
          "Analytics Technique": "Forecasting", "Statement": f"Statement for {no}", "Solution": "Model it",
          "Business Value": "Value", "Beneficiary": "Planner", "Sponsor": "COO",
          "Tables Involved": "main.s.sales", "Primary Table": "main.s.sales", "Business Domain": domain,
          "Subdomain": "Planning", "Quality": "High", "Quality Score": 4.0, "Priority": 7.0,
          "Inspire Score": 7.65, "scoring_status": "scored", "result_table": f"main.s.r_{no}"}
    uc.update(extra)
    return uc
