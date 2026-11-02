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


class FakeDataFrame:
    def __init__(self, spark, rows=None, source=None):
        self.spark = spark
        self.rows = list(rows or [])
        self.source = source
        self.added_columns = []

    def withColumn(self, name, value):
        self.added_columns.append(name)
        return self

    @property
    def write(self):
        return FakeWriter(self)

    def collect(self):
        return list(self.rows)


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
        return FakeDataFrame(self, rows=rows)


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


def make_inspire(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = CapturingLogger()
    obj._assets = TestEnvironmentAssets(ns)
    obj.session_id = 4242
    obj.business_name = "Acme"
    obj.inspire_database = ""
    obj.output_languages = ["English"]
    obj.generate_choices = ["PDF Catalog", "Presentation"]
    obj.docs_output_dir = "/Workspace/out/docs"
    obj.notebook_output_dir = "/Workspace/out/notebooks"
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
