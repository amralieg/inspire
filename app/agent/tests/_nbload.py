"""Notebook reading and runtime stubbing for the offline Inspire test suite.

`agent/dbx_inspire_ai_agent.ipynb` is a Databricks notebook: it imports `pyspark`, the Databricks
SDK and `pandas`, and it calls `create_widgets()` (which needs `dbutils`) at module level. None of
those exist in a plain pytest process, so this module installs import-level doubles for them before
any notebook source is compiled.

The doubles are deliberately thin. They exist to let module-level code REACH the pure function and
class definitions, not to emulate Spark. Anything that actually touches Spark, the SDK or a widget
at call time is out of scope for the offline suite and must be tested against a live run.
"""
import base64
import gzip
import json
import os
import re
import sys
import types
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
AGENT_NB = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")

MAGIC = re.compile(r"^%(pip|conda|sh|run|md|sql|scala|r|fs|load_ext|matplotlib|config)\b")

PYSPARK_MODULES = ("pyspark", "pyspark.sql", "pyspark.sql.types", "pyspark.sql.functions",
                   "pyspark.sql.utils")

_HONEST_TYPES = {}


def _honest_types():
    """Built once and handed out by identity thereafter.

    Rebuilding per install would rebind `pyspark.sql.types.StructType` to a fresh class object on
    every namespace load, so an `isinstance` against a handle captured earlier would start
    answering False halfway through a session.
    """
    if _HONEST_TYPES:
        return _HONEST_TYPES

    def _mk(name):
        def _init(self, *a, **kw):
            self.args = a
            self.__dict__.update(kw)
        return type(name, (), {"__init__": _init})

    for n in ("StringType", "ArrayType", "IntegerType", "MapType", "DoubleType", "BooleanType",
              "LongType", "TimestampType", "VariantType"):
        _HONEST_TYPES[n] = _mk(n)

    class _StructField:
        def __init__(self, name, dataType=None, nullable=True, metadata=None):
            self.name = name
            self.dataType = dataType
            self.nullable = nullable

    class _StructType:
        def __init__(self, fields=None):
            self.fields = list(fields or [])
            self.names = [getattr(f, "name", None) for f in self.fields]

        def fieldNames(self):
            return list(self.names)

    _HONEST_TYPES["StructField"] = _StructField
    _HONEST_TYPES["StructType"] = _StructType
    return _HONEST_TYPES


def _ensure_module(name):
    mod = sys.modules.get(name)
    if mod is None:
        mod = types.ModuleType(name)
        sys.modules[name] = mod
    return mod


def install_types():
    """(Re)install the type doubles onto `pyspark.sql.types`, keyed on identity.

    Separate from `install_stubs` because the type module is process-global: a test that overwrites
    `StructType` leaves every later test in the same pytest process writing schema-less rows.
    """
    for mod in PYSPARK_MODULES:
        _ensure_module(mod)
    tmod = sys.modules["pyspark.sql.types"]
    for name, cls in _honest_types().items():
        if vars(tmod).get(name) is not cls:
            setattr(tmod, name, cls)


class NullSpark:
    """Raises on every attribute so a test that reaches Spark fails loudly instead of passing on a
    silently-empty result."""

    def __getattr__(self, name):
        raise AssertionError(
            "offline harness: notebook code reached spark.%s - this code path needs a live run "
            "or an explicit double" % name)


class NullWidgets:
    """Answers widget creation so module-level `create_widgets()` completes, and returns "" for
    every read so no test can depend on a widget value it did not set explicitly."""

    def _accept(self, *a, **kw):
        return None

    dropdown = text = multiselect = combobox = remove = removeAll = _accept

    def get(self, *a, **kw):
        return ""


class NullDbutils:
    def __init__(self):
        self.widgets = NullWidgets()

    def __getattr__(self, name):
        raise AssertionError(
            "offline harness: notebook code reached dbutils.%s - this code path needs a live run "
            "or an explicit double" % name)


def install_stubs():
    """Install every import-level double the agent notebook needs to compile and exec offline."""
    install_types()

    pyspark = sys.modules["pyspark"]
    sqlmod = sys.modules["pyspark.sql"]
    pyspark.sql = sqlmod
    sqlmod.types = sys.modules["pyspark.sql.types"]
    sqlmod.functions = sys.modules["pyspark.sql.functions"]
    sqlmod.utils = sys.modules["pyspark.sql.utils"]

    if "SparkSession" not in vars(sqlmod):
        class SparkSession:
            class builder:
                @staticmethod
                def getOrCreate():
                    return None
        sqlmod.SparkSession = SparkSession
    if "DataFrame" not in vars(sqlmod):
        sqlmod.DataFrame = type("DataFrame", (), {})
    if "Row" not in vars(sqlmod):
        sqlmod.Row = type("Row", (), {})
    fmod = sys.modules["pyspark.sql.functions"]
    for fname in ("col", "lit", "when", "expr"):
        if fname not in vars(fmod):
            setattr(fmod, fname, (lambda *a, **kw: None))
    umod = sys.modules["pyspark.sql.utils"]
    if "AnalysisException" not in vars(umod):
        umod.AnalysisException = type("AnalysisException", (Exception,), {})

    databricks = _ensure_module("databricks")
    sdk = _ensure_module("databricks.sdk")
    if "WorkspaceClient" not in vars(sdk):
        sdk.WorkspaceClient = type("WorkspaceClient", (), {"__init__": (lambda self, **kw: None)})
    cfg = _ensure_module("databricks.sdk.config")
    if "Config" not in vars(cfg):
        cfg.Config = type("Config", (), {"__init__": (lambda self, **kw: None)})
    svc = _ensure_module("databricks.sdk.service")
    ws = _ensure_module("databricks.sdk.service.workspace")
    jobs = _ensure_module("databricks.sdk.service.jobs")
    for n in ("JobSettings", "Task", "NotebookTask", "SubmitTask", "QueueSettings",
              "TaskDependency"):
        if n not in vars(jobs):
            def _mk(_n):
                def _init(self, **kw):
                    self.__dict__.update(kw)
                return type(_n, (), {"__init__": _init})
            setattr(jobs, n, _mk(n))
    if "RunIf" not in vars(jobs):
        jobs.RunIf = types.SimpleNamespace(ALL_DONE="ALL_DONE", ALL_SUCCESS="ALL_SUCCESS")
    databricks.sdk = sdk
    sdk.config = cfg
    sdk.service = svc
    svc.workspace = ws
    svc.jobs = jobs

    if "pandas" not in sys.modules:
        try:
            import pandas  # noqa: F401 — prefer the real module when available
        except ImportError:
            _ensure_module("pandas")


_CELL_CACHE = {}


def _fingerprint(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (os.path.abspath(path), st.st_size, st.st_mtime_ns)


def notebook_cells(path=None):
    """Every cell as `(cell_type, source)` in notebook order, read once per revision per process.

    Keyed on the bytes behind the path rather than the path itself, so a test that rewrites a
    notebook in place cannot be answered from the previous revision. Positions are preserved so a
    caller can address `cells[1]` the way the notebook itself does.
    """
    path = path or AGENT_NB
    fp = _fingerprint(path)
    hit = _CELL_CACHE.get(fp) if fp is not None else None
    if hit is not None:
        return list(hit)
    with open(path, "r", encoding="utf-8") as fh:
        nb = json.load(fh)
    out = []
    for cell in nb.get("cells", []):
        src = cell.get("source", [])
        out.append((cell.get("cell_type"), "".join(src) if isinstance(src, list) else str(src)))
    if fp is not None:
        _CELL_CACHE[fp] = list(out)
    return out


def strip_magic_lines(src):
    """Blank out Databricks cell magics, preserving line numbers.

    The pattern is an explicit allowlist anchored at column 0 rather than a generic `^%\\w`, because
    the agent's prompt templates are multi-line string literals and a generic match would silently
    delete a line of prompt text that happens to start with a percent sign.
    """
    return "\n".join("" if MAGIC.match(ln) else ln for ln in src.split("\n"))


def code_cells(path=None, strip_magics=True):
    out = []
    for cell_type, src in notebook_cells(path):
        if cell_type != "code":
            continue
        out.append(strip_magic_lines(src) if strip_magics else src)
    return out


def packed_text(value):
    try:
        raw = base64.b64decode(value, validate=False)
    except ValueError:
        return None
    for inflate in (zlib.decompress, gzip.decompress, lambda data: data):
        try:
            return inflate(raw).decode("utf-8")
        except (OSError, ValueError, zlib.error, UnicodeDecodeError, EOFError):
            continue
    return None


NOTEBOOK_ASSET_PINS = re.compile(r"^INSPIRE_NOTEBOOK_ASSETS = (\{.*\})$", re.M)


def notebook_assets(path=None):
    found = [NOTEBOOK_ASSET_PINS.findall(src) for kind, src in notebook_cells(path) if kind == "code"]
    lines = [line for each in found for line in each]
    if len(lines) != 1:
        raise AssertionError(f"the notebook must pin its assets on one INSPIRE_NOTEBOOK_ASSETS line, it has {len(lines)}")
    out = []
    for _name, pin in sorted(json.loads(lines[0]).items()):
        with open(os.path.join(ROOT, pin["repo"]), encoding="utf-8") as fh:
            out.append((pin["repo"], fh.read()))
    return out

