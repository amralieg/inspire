import ast
import os
import re
import threading
import types
from collections import defaultdict

import numpy as np
import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire

SENTINEL = "ZQV9101QZ"
TOKEN = "dapi" + "cd" * 16
HOST = "adb-zqv.example.net"
EMAIL = "ana.lopez@example.com"
HIDDEN = (SENTINEL, TOKEN, HOST, EMAIL)
FOREIGN = (f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"INT\" because it is malformed. "
           f"SQLSTATE: 22018 while reading https://{HOST}/api/2.0/sql for {EMAIL} with {TOKEN}")


def _failing(*_args, **_kwargs):
    raise RuntimeError(FOREIGN)


def _clean(lines):
    lines = [str(line) for line in lines]
    assert lines, "the failure was reported"
    assert [s for s in HIDDEN if any(s in line for line in lines)] == [], lines
    assert any("CAST_INVALID_INPUT" in line for line in lines), lines
    return lines


def test_discover_metric_view_listing_logs_its_error_without_a_value(agent_ns):
    logger = CapturingLogger()
    assert agent_ns["collect_metric_views"](FakeSpark(responder=_failing), [("main", "sales")], logger) == []
    _clean([line for _level, line in logger.matching("Metric views not listed for main.sales")])


def test_discover_column_metadata_failure_is_stored_and_logged_without_a_value(agent_ns):
    loader_cls = agent_ns["DataLoader"]
    loader = loader_cls.__new__(loader_cls)
    loader.spark, loader.logger = FakeSpark(responder=_failing), CapturingLogger()
    loader._metadata_lock, loader._describe_failures, loader._metadata_errors = threading.RLock(), defaultdict(int), {}
    assert loader._describe_table_columns("main", "sales", "orders") is None
    _clean(list(loader._metadata_errors.values()) + [line for _level, line in loader.logger.matching("Column metadata unavailable")])


def test_discover_feedback_read_failure_is_logged_without_a_value(agent_ns):
    inst = make_inspire(agent_ns, spark=FakeSpark(responder=_failing), inspire_database="main.inspire")
    assert inst._load_feedback() == {}
    _clean([line for _level, line in inst.logger.matching("unreadable")])


def test_shared_retry_helper_logs_every_attempt_without_a_value(agent_ns):
    logger = CapturingLogger()
    assert agent_ns["retry_with_logging"](_failing, max_attempts=2, logger=logger, fallback="kept", context="orders") == "kept"
    lines = _clean([line for _level, line in logger.records if line.startswith(("Attempt 1/2 failed", "All 2 attempts failed"))])
    assert len(lines) == 2, logger.records


def test_shared_parallel_executor_reports_a_failed_task_without_a_value(agent_ns, capsys):
    logger = CapturingLogger()
    results = agent_ns["ParallelExecutor"].execute_parallel([_failing], max_workers=1, task_name="probe", logger=logger,
                                                            return_exceptions=True)
    assert [type(result) for result in results] == [RuntimeError]
    printed = capsys.readouterr().err
    _clean([line for _level, line in logger.matching("probe #0 failed")] + [printed])
    assert "Traceback (most recent call last)" in printed and "in _failing" in printed


def test_shared_job_launcher_describes_a_failed_run_without_a_value(agent_ns):
    launcher_cls = agent_ns["JobLauncher"]
    launcher = launcher_cls.__new__(launcher_cls)
    run = types.SimpleNamespace(state=types.SimpleNamespace(state_message=FOREIGN), run_id=7, tasks=[])
    output = types.SimpleNamespace(error=f"Py4JJavaError: {FOREIGN}", error_trace=f"Traceback ...\nRuntimeError: {FOREIGN}")
    w = types.SimpleNamespace(jobs=types.SimpleNamespace(get_run_output=lambda run_id: output))
    _clean([launcher.describe_run_failure(w, run)])
    unreadable = types.SimpleNamespace(jobs=types.SimpleNamespace(get_run_output=_failing))
    _clean([launcher.describe_run_failure(unreadable, run)])


def test_tracking_failed_step_keeps_its_record_and_log_free_of_a_value(agent_ns):
    inst = make_inspire(agent_ns)
    entry = inst._record_failed_step("CSV Catalog", "English", RuntimeError(FOREIGN))
    _clean([entry["error"]] + [line for _level, line in inst.logger.matching("[ARTIFACT STEP FAILED]")])
    composed = inst._record_failed_step("Generate Lock", "", "another run holds the Generate lock for business 'Acme'")
    assert composed["error"] == "another run holds the Generate lock for business 'Acme'"


def test_tracking_ai_call_log_row_of_an_exhausted_call_has_no_value(agent_ns):
    recorder, delivered = agent_ns["AILogRecorder"](), []
    recorder.attach(4242, delivered.append)
    recorder.record_exhausted({"request_id": "r1", "attempts": 2, "prompt": "DOMAIN_FINDER_PROMPT"}, "the prompt", RuntimeError(FOREIGN))
    assert [row["status"] for row in delivered] == ["exhausted"]
    _clean([delivered[0]["response"]])


def test_tracking_table_setup_failure_is_logged_and_recorded_without_a_value(agent_ns):
    inst = make_inspire(agent_ns, spark=FakeSpark(responder=_failing), _tracking_table_name="main.inspire.__inspire_usecases",
                        _tracking_table_created=False, _tracking_lock=threading.Lock())
    inst._create_tracking_table()
    _clean([line for _level, line in inst.logger.matching("Failed to create tracking table")]
           + [step["error"] for step in inst.failed_steps])


@pytest.fixture(scope="module")
def run_controls(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    inst = build_inspire(agent_ns)
    uc = make_uc()
    source = inst._genie_run_controls_source(uc, inst._genie_notebook_spec(uc), "")
    namespace = {}
    exec(compile(source.rsplit("\ninspire_main()", 1)[0], "run_controls", "exec"), namespace)
    return source, namespace


def test_the_generated_notebook_carries_the_one_redaction_ahead_of_inspire_code(agent_ns, run_controls):
    source, namespace = run_controls
    assert agent_ns["REDACT_SOURCE"].strip() in source and "@@" not in source
    assert source.index("def inspire_redact_text(") < source.index("class JobLauncher") < source.index("def inspire_run_tables(")
    assert namespace["inspire_redact_text"].__code__.co_filename == "run_controls"


def test_the_generated_notebook_run_log_reports_a_failed_read_without_a_value(run_controls):
    _source, namespace = run_controls
    printed = []
    run = {"source_tables": ["main.sales.orders"], "segments": None}
    entries = namespace["inspire_run_tables"](FakeSpark(responder=_failing), run, out=printed.append)
    assert [entry["table"] for entry in entries] == ["main.sales.orders"]
    _clean(printed)
    assert all("main.sales.orders" in line for line in printed), printed


INSPIRE_NAMES = ("inspire_redact_text", "inspire_redact_secrets", "INSPIRE_REDACTED_VALUE", "INSPIRE_SECRET_TOKEN_RE",
                 "INSPIRE_SECRET_HOST_RE", "INSPIRE_SECRET_EMAIL_RE", "INSPIRE_SPARK_VALUE_TEMPLATES", "INSPIRE_REDACT_ERROR_CHARS")
GENIE_NAMES = {name.split("_", 1)[1]: name for name in INSPIRE_NAMES}
GENIE_MODULE_NAMES = ("re", "np", "floor", "isfinite", "log10", "Real", "types", "sys", "io", "contextlib", "main")


def _genie_cell():
    redact, value = "inspire_redact_text".split("_", 1)[1], "INSPIRE_REDACTED_VALUE".split("_", 1)[1]
    rest = sorted(set(GENIE_NAMES) - {redact, value})
    return ("import json as re\nimport numpy as np\nfrom numpy import floor, isfinite, log10\nfrom fractions import Fraction as Real\n"
            "types, sys, io, contextlib = ['churn', 'stay'], 'a system label', 'an input label', 'a context note'\n"
            f"{value} = 'pending review'\n" + "".join(f"{name} = '{name} of Genie'\n" for name in rest)
            + f"\n\ndef {redact}(text):\n    return 'masked by Genie: ' + text\n\n\n"
            "def main():\n    return 'the main of Genie'\n\n\n"
            "def run_use_case():\n"
            f"    return [main(), {redact}('row 7'), re.dumps({{'a': 1}}), log10(np.array([10.0, 100.0])).tolist(),\n"
            "            floor(np.array([1.5, 2.5])).tolist(), bool(isfinite(np.array([1.0, 2.0])).all()), str(Real(1, 3)),\n"
            f"            types, sys, io, contextlib, {value}] + [{', '.join(rest)}]\n")


def _generic_globals(source):
    names = set()
    for node in ast.parse(source).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(target.id for target in node.targets if isinstance(target, ast.Name))
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((alias.asname or alias.name).split(".")[0] for alias in node.names)
    return {name for name in names if not (name.lower().startswith("inspire") or name.startswith("_"))}


@pytest.fixture(scope="module")
def generated_notebook(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    from v130_genie_run_controls_test import INSTRUCTION
    inst, writes = build_inspire(agent_ns), []
    inst._write_notebook_to_workspace = lambda _d, path, notebook, _uid: writes.append(notebook) or path
    inst._assemble_genie_code_notebook(make_uc(genie_instruction=INSTRUCTION, genie_instruction_status="success"), {})
    cells = ["".join(cell["source"]) for cell in writes[-1]["cells"] if cell["cell_type"] == "code"]
    assert len(cells) == 3 and cells[1] == agent_ns["GENIE_NUMBER_TEXT_SOURCE"]
    return cells


def test_the_cells_inspire_writes_bind_no_generic_name_genie_code_could_also_use(agent_ns, generated_notebook):
    _instruction, helpers, controls = generated_notebook
    assert _generic_globals(controls) == {"JobLauncher"}
    assert _generic_globals(helpers) == set(agent_ns["GENIE_NUMBER_HELPERS"])
    assert _generic_globals("import re\nfrom math import floor\n" + helpers) == set(agent_ns["GENIE_NUMBER_HELPERS"]) | {"re", "floor"}


def test_the_name_the_contract_tells_genie_inspire_calls_is_the_one_the_run_controls_define_and_call(agent_ns, generated_notebook):
    controls = generated_notebook[2]
    body = ast.parse(controls).body
    last = body[-1]
    assert isinstance(last, ast.Expr) and isinstance(last.value, ast.Call) and not last.value.args
    name = last.value.func.id
    assert name.startswith("inspire_") and [n.name for n in body if isinstance(n, ast.FunctionDef) and n.name == name] == [name]
    rule, boundary, agents = (agent_ns["GENIE_RUN_CONTROLS_RULE"], agent_ns["GENIE_CELL_BOUNDARY_RULE"],
                              agent_ns["GENIE_AGENTS_FILE_TEMPLATE"])
    assert f"ends with `{name}()`" in rule and f"ending with `{name}()`" in boundary
    assert f"The Run controls cell ends with {name}()" in agents and controls.splitlines()[0].count(f"{name}() runs") == 1
    assert [text for text in (rule, boundary, agents, controls) if re.search(r"(?<![\w.])main\(\)", text)] == []


RUN_CONTROLS_DOCS = ("readme.md", os.path.join("docs", "integration-guide.md"), os.path.join("docs", "design-guide.md"),
                     os.path.join("rules", "inspire-ai-rules.csv"))
RUN_CONTROLS_WORDS = re.compile(r"Run controls|run_use_case|Genie Code")


def _lines_naming_main(texts):
    return [f"{path}:{number}" for path, text in texts.items() for number, line in enumerate(text.splitlines(), 1)
            if RUN_CONTROLS_WORDS.search(line) and re.search(r"(?<![\w.])main\(\)", line)]


def test_the_readme_the_guides_the_rules_and_the_notebook_text_name_the_call_the_run_controls_make(generated_notebook):
    from _nbload import ROOT, notebook_cells
    name = ast.parse(generated_notebook[2]).body[-1].value.func.id
    texts = {}
    for path in RUN_CONTROLS_DOCS:
        with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
            texts[path] = handle.read()
    texts["agent notebook markdown"] = "\n".join(source for kind, source in notebook_cells() if kind == "markdown")
    assert _lines_naming_main(texts) == []
    assert [path for path, text in texts.items() if f"{name}()" not in text] == []
    assert _lines_naming_main({"probe.md": "Run controls, the last cell, ends with `main()`.\nInspire runs main() once."}) == ["probe.md:1"]


def test_genie_code_keeps_its_own_names_and_inspire_still_redacts_in_the_same_notebook(generated_notebook):
    instruction, helpers, controls = generated_notebook
    alone = {}
    exec(compile(_genie_cell(), "genie", "exec"), alone)
    expected = alone["run_use_case"]()
    assert expected[:2] == ["the main of Genie", "masked by Genie: row 7"] and expected[3] == [1.0, 2.0] and expected[6] == "1/3"
    notebook = {}
    exec(compile(instruction, "instruction", "exec"), notebook)
    exec(compile(_genie_cell(), "genie", "exec"), notebook)
    genie = {name: notebook[name] for name in list(GENIE_NAMES) + list(GENIE_MODULE_NAMES)}
    exec(compile(helpers, "number_helpers", "exec"), notebook)
    exec(compile(controls.rstrip().rsplit("\n", 1)[0], "run_controls", "exec"), notebook)
    assert sorted(name for name, value in genie.items() if notebook[name] is not value) == []
    assert notebook["run_use_case"]() == expected
    assert notebook["fmt_num"](1060) == "1,060" and notebook["is_missing"](float("nan")) and notebook["fmt_count"](1, "store") == "1 store"
    assert notebook["inspire_redact_text"].__code__.co_filename == "run_controls"
    assert notebook["INSPIRE_REDACTED_VALUE"] == "a data value" and notebook["_redact_re"].__name__ == "re"
    _clean([notebook["inspire_redact_text"](FOREIGN, set(), "")])
    printed = []
    notebook["inspire_run_tables"](FakeSpark(responder=_failing), {"source_tables": ["main.sales.orders"], "segments": None},
                                   out=printed.append)
    _clean(printed)


OUTSIDE_TEXT_RAISES = {
    "inspire_sql": "inspire_redact_text(q, ",
    "_parse_translation_rows": "first_line",
    "implement_vision_verdict": "str(text).split()",
    "_implement_llm_object": "str(raw or '')",
    "_implement_genie_smoke": "message.get('error')",
    "_implement_app_deployment": "deployment.get('status')",
    "_implement_app_health": "status.get('message')",
}


def test_a_raise_that_quotes_text_from_outside_inspire_routes_it_through_the_one_redaction():
    from _agentload import agent_source
    found = {name: [] for name in OUTSIDE_TEXT_RAISES}
    for fn in ast.walk(ast.parse(agent_source())):
        if isinstance(fn, ast.FunctionDef) and fn.name in OUTSIDE_TEXT_RAISES:
            for node in ast.walk(fn):
                if isinstance(node, ast.Raise) and node.exc is not None:
                    found[fn.name] += [part for part in ast.walk(node.exc) if isinstance(part, ast.FormattedValue)
                                       and OUTSIDE_TEXT_RAISES[fn.name] in ast.unparse(part.value)]
    assert {name: len(parts) for name, parts in found.items() if not parts} == {}
    bare = [(name, ast.unparse(part.value)) for name, parts in found.items() for part in parts
            if not (isinstance(_uncut(part.value), ast.Call) and getattr(_uncut(part.value).func, "id", "") == "inspire_redact_text")]
    assert bare == []


def _uncut(value):
    while isinstance(value, ast.Subscript) and isinstance(value.slice, ast.Slice):
        value = value.value
    return value
