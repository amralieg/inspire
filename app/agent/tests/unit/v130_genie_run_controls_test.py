"""v1.3.0 Genie notebooks: the first cell is a short use-case card with the disclaimer and the copy line, the second
holds the instruction, Genie Code adds its cells after it, and the Run controls cell stays last and ends with inspire_main(),
which runs Genie Code's run_use_case() here or as the notebook's tagged Databricks job (dbx_inspire_ai_* tags on a
persistent job with a paused schedule), so the dashboard registers every run and the work runs once."""
import ast
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire, make_uc

FAMILIES = {"A": "Classification", "B": "Anomaly Detection", "C": "Clustering", "D": "Recommendation", "E": "Forecasting",
            "F": "Trend Analysis", "G": "Sentiment Analysis", "H": "Optimization"}
TAG_KEYS = {"dbx_inspire_ai_business", "dbx_inspire_ai_usecase", "dbx_inspire_ai_usecase_id", "dbx_inspire_ai_session",
            "dbx_inspire_ai_session_id", "dbx_inspire_ai_launcher_source", "dbx_inspire_ai_run_type", "inspire_version",
            "dbx_inspire_ai_version"}
INSTRUCTION = ("## 1. Goal\nThe retention lead decides weekly.\n\n## 3. Parameters\n| widget | type | default | used for |\n"
               "|---|---|---|---|\n| `result_table` | text | main.inspire.n01_u01_churn_out | Business output table |\n"
               "| `lookback_weeks` | text | `12` | Weeks of history per entity |\n\n## 4. Readiness Check\nChecks.\n")


def _text(cell):
    return "".join(cell["source"])


def _notebook(agent_ns, technique="Classification", **fields):
    inst = build_inspire(agent_ns)
    writes = []
    inst._write_notebook_to_workspace = lambda d, p, obj, uid: writes.append(obj) or p
    uc = make_uc(**{"Analytics Technique": technique, "genie_instruction": INSTRUCTION, "genie_instruction_status": "success", **fields})
    inst._assemble_genie_code_notebook(uc, {})
    return inst, uc, writes[-1]


def _controls(agent_ns, technique="Classification"):
    _inst, _uc, nb = _notebook(agent_ns, technique)
    source = _text(nb["cells"][-1])
    definitions, call = source.rstrip().rsplit("\n", 1)
    ns = {}
    exec(compile(definitions, "run_controls", "exec"), ns)
    return ns, call


class _Widgets:
    def __init__(self, values):
        self.values, self.created = dict(values), []

    def dropdown(self, name, default, choices, label):
        self.created.append((name, default, tuple(choices), label))
        self.values.setdefault(name, default)

    def text(self, name, default, label):
        self.created.append((name, default, None, label))
        self.values.setdefault(name, default)

    def get(self, name):
        if name not in self.values:
            raise ValueError(f"No input widget named {name} is defined")
        return self.values[name]


def _dbutils(**values):
    return types.SimpleNamespace(widgets=_Widgets(values), notebook=types.SimpleNamespace(exits=[], exit=None))


def _launcher(ns, launch_result=None, outcome=None, path="/Workspace/Shared/demos/biz/notebooks/N01-U01 - churn"):
    calls = {}

    class FakeLauncher(ns["JobLauncher"]):
        @staticmethod
        def get_current_notebook_path():
            return path

        def launch(self, **kwargs):
            calls["launch"] = dict(kwargs, tags=dict(self.job_tags), base=dict(self.widget_key_values), path=self.notebook_path)
            return launch_result or {"success": True, "run_id": 7, "job_url": "https://host/jobs/1/runs/7"}

        def wait_for_run(self, run_id, timeout_s=1800, poll_s=15, out=print):
            calls["wait"] = (run_id, timeout_s)
            return outcome or {"status": "SUCCESS", "output": "1240 rows written"}
    return FakeLauncher, calls


@pytest.mark.parametrize("family,technique", sorted(FAMILIES.items()))
def test_every_notebook_has_the_card_the_instruction_and_the_run_controls(agent_ns, family, technique):
    _inst, uc, nb = _notebook(agent_ns, technique)
    assert [c["cell_type"] for c in nb["cells"]] == ["markdown", "code", "code", "code"]
    head = _text(nb["cells"][0])
    cls = agent_ns["DatabricksInspire"]
    assert head.startswith("# N01-U01: ") and "| **What it does** |" in head and "| **Data** |" in head and "| **Output** |" in head
    for gone in ("## Use-case card", "| Decision card | |", "## Use Case Details", "| **Analytics Technique** |", "not assessed"):
        assert gone not in head, gone
    assert head.rstrip().endswith(cls._GENIE_NOTEBOOK_DISCLAIMER + "\n\n" + cls._GENIE_COPY_LINE), \
        "one markdown cell ends with the disclaimer, then the copy line right above the instruction"
    assert 'without the surrounding quotes (the `r"""` and `"""` lines)' in cls._GENIE_COPY_LINE
    assert len(head.strip().splitlines()) <= 14, "the card was 44 lines with two tables"
    titles = [c["metadata"]["application/vnd.databricks.v1+cell"].get("title") for c in nb["cells"]]
    assert titles[1:] == ["Genie Code instruction", agent_ns["GENIE_NUMBER_HELPERS_TITLE"], "Run controls (Inspire, do not edit)"]
    assert _text(nb["cells"][2]) == agent_ns["GENIE_NUMBER_TEXT_SOURCE"], "the helpers cell holds Inspire's tested copy as it is"
    controls = _text(nb["cells"][-1])
    ast.parse(controls)
    assert "class JobLauncher" in controls and 'dropdown("execution", "As job", ["As job", "Here"], "Execution")' in controls
    run = ast.literal_eval(controls.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["marker"] == agent_ns["INSPIRE_CHILD_MARKER"] and set(run["job_tags"]) == TAG_KEYS
    assert run["job_tags"]["dbx_inspire_ai_run_type"] == ("training" if family in "ABCD" else "analysis")
    assert run["job_tags"]["dbx_inspire_ai_usecase"] and run["job_slug"] == run["job_tags"]["dbx_inspire_ai_usecase"]
    assert run["job_tags"]["dbx_inspire_ai_usecase_id"] == uc["No"] == "N01-U01"
    assert run["job_tags"]["dbx_inspire_ai_business"] == agent_ns["JobLauncher"]._sanitize_tag(_inst.business_name), \
        "the business tag is spelled the way every other Inspire job spells it, so one filter finds them all"
    assert run["job_tags"]["dbx_inspire_ai_session"] == run["job_tags"]["dbx_inspire_ai_session_id"]
    assert run["job_tags"]["inspire_version"] == run["job_tags"]["dbx_inspire_ai_version"] == agent_ns["__AGENT_VERSION__"]
    assert run["widget_names"][:2] == ["result_table", "lookback_weeks"] and run["wait_minutes"] == 30


def test_the_card_shows_the_star_and_an_assessed_decision_and_kpi_only(agent_ns):
    elite = {"decision": "Which accounts get a retention call each week", "decision_owner": "Retention lead", "cadence": "weekly",
             "kpi": "90-day churn rate", "kpi_direction": "down", "value_tier": "Material", "blockers": []}
    _inst, _uc, nb = _notebook(agent_ns, best_of_best="Y", best_of_best_rank=3, best_of_best_score=8.62, elite_status="ELITE",
                               elite_assessment=elite, Solution="Scores each account's churn risk weekly.",
                               **{"Strategy Path": "Grow revenue > Basket size", "Tables Involved": "main.shop.orders, main.shop.customers"})
    head = _text(nb["cells"][0])
    assert "\u2605 Best of Best #3 \u00b7 Elite Score 8.6 / 10" in head
    assert "| **What it does** | Scores each account's churn risk weekly. |" in head
    assert "| **Decision** | Which accounts get a retention call each week \u00b7 Retention lead \u00b7 weekly |" in head
    assert "| **KPI** | 90-day churn rate (down) |" in head
    assert "| **Data** | `orders`, `customers` |" in head
    assert "Strategy Alignment" not in head and "Elite Status" not in head and "Value Tier" not in head
    _inst, _uc, plain = _notebook(agent_ns)
    plain_head = _text(plain["cells"][0])
    assert "Best of Best #" not in plain_head, "only a starred use case shows the star"
    assert "| **Decision** |" not in plain_head and "| **KPI** |" not in plain_head, "an unassessed use case shows no 'not assessed' rows"


def test_main_is_the_last_line_and_runs_the_use_case_once_here_or_in_the_job_run(agent_ns):
    ns, call = _controls(agent_ns)
    assert call.strip() == "inspire_main()", "inspire_main() is the very last line of the last cell"
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    written = {"status": "written", "rows_written": 1240, "as_of_date": "2026-09-30", "run_id": "5f0c"}
    for values, expected in (({marker: "1"}, "child"), ({"execution": "Here"}, "here")):
        runs = []
        ns["run_use_case"] = lambda: runs.append(1) or written
        launcher, calls = _launcher(ns)
        dbu, out = _dbutils(**values), []
        dbu.notebook.exit = dbu.notebook.exits.append
        gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=out.append)
        assert gate["execution"] == expected and runs == [1] and "launch" not in calls, values
        text = "wrote 1240 rows for as_of_date 2026-09-30 with run_id 5f0c"
        assert gate["outcome"] == text and dbu.notebook.exits == [text], \
            "the job run returns its outcome to the notebook that launched it, so a stop is never reported as success"
        assert f"Use case outcome: {text}." in out
    runs = []
    ns["run_use_case"] = lambda: runs.append(1)
    launcher, calls = _launcher(ns)
    dbu = _dbutils()
    dbu.notebook.exit = dbu.notebook.exits.append
    gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert gate["execution"] == "job" and "launch" in calls and runs == [], \
        "As job runs the use case inside the tagged job run only, never a second time in this session"


def test_main_runs_nothing_before_genie_code_builds_the_notebook(agent_ns):
    ns, _call = _controls(agent_ns)
    ns.pop("run_use_case", None)
    launcher, calls = _launcher(ns)
    out = []
    gate = ns["inspire_main"](dbu=_dbutils(), launcher_cls=launcher, out=out.append)
    assert gate == {"execution": "not built"} and "launch" not in calls, "no job is created for a notebook Genie Code has not built"
    assert any("Genie Code has not built this notebook yet" in line for line in out)


def test_as_job_creates_the_tagged_persistent_job_runs_it_and_stops_here(agent_ns):
    ns, call = _controls(agent_ns)
    assert call.strip() == "inspire_main()"
    launcher, calls = _launcher(ns)
    dbu = _dbutils(result_table="main.inspire.n01_u01_churn_out", lookback_weeks=" 16 ", as_of_date="2026-09-30")
    dbu.notebook.exit = dbu.notebook.exits.append
    out = []
    result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=out.append)
    assert result["execution"] == "job" and result["status"] == "SUCCESS"
    launch = calls["launch"]
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    assert launch["job_name"] == ns["JobLauncher"].persistent_job_name(ns["INSPIRE_RUN"]["job_slug"], launch["path"])
    assert launch["job_name"].startswith("dbx_inspire_ai_")
    assert launch["run_parameters"] == {"result_table": "main.inspire.n01_u01_churn_out", "lookback_weeks": "16",
                                        "as_of_date": "2026-09-30", marker: "1", "refresh_requested_by": "the notebook"}
    assert launch["base"] == dict(launch["run_parameters"], as_of_date="latest", refresh_requested_by="schedule"), \
        "the job's stored parameters run as the child with the latest as-of date, so a scheduled run never repeats this run's date"
    assert launch["max_concurrent_runs"] == 1 and launch["queue"] is True and launch["schedule_cron"] == ns["INSPIRE_RUN"]["schedule_cron"]
    assert set(launch["tags"]) == TAG_KEYS | {"dbx_inspire_ai_notebook"}
    assert launch["tags"]["dbx_inspire_ai_notebook"] == "N01-U01_-_churn"
    assert calls["wait"] == (7, 30 * 60)
    assert dbu.notebook.exits == ["Job run finished: 1240 rows written. Results table: main.inspire.n01_u01_churn_out. "
                                  "Run: https://host/jobs/1/runs/7"]
    assert ("The tagged job run finished: 1240 rows written. Results table: main.inspire.n01_u01_churn_out. "
            "Run: https://host/jobs/1/runs/7") in out
    assert result["outcome"] == "1240 rows written"
    assert ("execution", "As job", ("As job", "Here"), "Execution") in dbu.widgets.created


def test_the_launching_notebook_reports_a_stopped_job_run_and_never_a_blanket_success(agent_ns):
    ns, _call = _controls(agent_ns)
    for output, reported in (("stopped without writing: STOP RULE: halo test empty", "stopped without writing: STOP RULE: halo test empty"),
                             (None, "the job run returned no outcome")):
        launcher, _calls = _launcher(ns, outcome={"status": "SUCCESS", "output": output})
        dbu, out = _dbutils(), []
        dbu.notebook.exit = dbu.notebook.exits.append
        result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=out.append)
        assert result["status"] == "SUCCESS" and result["outcome"] == reported
        assert f"The tagged job run finished: {reported}. Results table: {ns['INSPIRE_RUN']['result_table']}. " \
               "Run: https://host/jobs/1/runs/7" in out
        assert dbu.notebook.exits == [f"Job run finished: {reported}. Results table: {ns['INSPIRE_RUN']['result_table']}. "
                                      "Run: https://host/jobs/1/runs/7"]
        assert not any("successfully" in line for line in out), \
            "round 22: a job run that stopped at its STOP RULE was reported as 'finished successfully. Results: <table>'"


def test_run_use_case_outcomes_read_the_same_here_and_from_the_job_run(agent_ns):
    import datetime
    import numpy as np
    ns, _call = _controls(agent_ns)
    text = ns["inspire_outcome_text"]
    assert text({"status": "written", "rows_written": np.int64(53999), "as_of_date": datetime.date(2003, 1, 1),
                 "run_id": "31f0a774"}) == "wrote 53999 rows for as_of_date 2003-01-01 with run_id 31f0a774"
    assert text({"status": "stopped", "stop_reason": "STOP RULE: halo test empty"}) == \
        "stopped without writing: STOP RULE: halo test empty"
    assert text({"status": "stopped"}) == "stopped without writing: no reason given"
    assert text(None) == "run_use_case() returned no outcome, so this run's printed summary is its only record"
    assert text("custom summary") == "custom summary"
    ns["run_use_case"] = lambda: {"status": "stopped", "stop_reason": "row_count 0 < min_rows 1"}
    dbu = _dbutils(**{agent_ns["INSPIRE_CHILD_MARKER"]: "1"})
    dbu.notebook.exit = dbu.notebook.exits.append
    launcher, _calls = _launcher(ns)
    gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert dbu.notebook.exits == ["stopped without writing: row_count 0 < min_rows 1"] and gate["execution"] == "child"
    ns["run_use_case"] = lambda: None
    dbu = _dbutils(execution="Here")
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert dbu.notebook.exits == ["run_use_case() returned no outcome, so this run's printed summary is its only record"]


def test_the_exit_value_carries_everything_run_use_case_printed(agent_ns, capsys):
    ns, _call = _controls(agent_ns)
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    written = {"status": "written", "rows_written": 3, "as_of_date": "2026-09-30", "run_id": "5f0c"}
    headline = "wrote 3 rows for as_of_date 2026-09-30 with run_id 5f0c"

    def use_case():
        print("Readiness row_count: 3 measured; 1 required")
        print("Rows per tier: Act now 1, Review 1, Monitor 1")
        return written

    for values in ({marker: "1"}, {"execution": "Here"}):
        ns["run_use_case"] = use_case
        launcher, _calls = _launcher(ns)
        dbu = _dbutils(**values)
        dbu.notebook.exit = dbu.notebook.exits.append
        stream = sys.stdout
        gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
        assert sys.stdout is stream, "inspire_main() puts the notebook's own stdout back after the run"
        assert gate["outcome"] == headline, values
        assert dbu.notebook.exits == [f"{headline}\n\nPrinted log of this run:\nReadiness row_count: 3 measured; 1 required\n"
                                      "Rows per tier: Act now 1, Review 1, Monitor 1"], \
            "round 28: dbutils.notebook.exit wiped every line the run printed, so no readiness value or metric was visible"
        assert "Rows per tier: Act now 1, Review 1, Monitor 1" in capsys.readouterr().out, "the lines still print as they run"
    ns["run_use_case"] = lambda: print("x" * 250000) or written
    dbu = _dbutils(**{marker: "1"})
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_main"](dbu=dbu, launcher_cls=_launcher(ns)[0], out=lambda *_a: None)
    capsys.readouterr()
    capped = dbu.notebook.exits[0]
    assert capped.startswith(headline + "\n\nPrinted log of this run:\n" + "x" * 20000 + "\n... (150000 characters of the printed log left out) ...\n")
    assert capped.endswith("x" * 80000) and len(capped) < 101000, "the job output API returns only the first 1 MB"

    def broken():
        print("Readiness passed")
        raise ValueError("boom")

    ns["run_use_case"] = broken
    dbu = _dbutils(**{marker: "1"})
    dbu.notebook.exit = dbu.notebook.exits.append
    stream = sys.stdout
    with pytest.raises(ValueError, match="boom"):
        ns["inspire_main"](dbu=dbu, launcher_cls=_launcher(ns)[0], out=lambda *_a: None)
    assert dbu.notebook.exits == [] and sys.stdout is stream, "a failing run raises with its output and restores stdout"
    assert ns["inspire_exit_text"]("stopped without writing: x", "  \n") == "stopped without writing: x"


def test_the_launching_notebook_returns_the_job_runs_printed_log_under_its_headline(agent_ns):
    ns, _call = _controls(agent_ns)
    child = "wrote 3 rows for as_of_date 2026-09-30 with run_id 5f0c\n\nPrinted log of this run:\nReadiness passed\nRows per tier: 1, 1, 1"
    launcher, _calls = _launcher(ns, outcome={"status": "SUCCESS", "output": child})
    dbu, out = _dbutils(), []
    dbu.notebook.exit = dbu.notebook.exits.append
    result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=out.append)
    table = ns["INSPIRE_RUN"]["result_table"]
    assert result["outcome"] == "wrote 3 rows for as_of_date 2026-09-30 with run_id 5f0c"
    assert dbu.notebook.exits == [f"Job run finished: wrote 3 rows for as_of_date 2026-09-30 with run_id 5f0c. Results table: "
                                  f"{table}. Run: https://host/jobs/1/runs/7\n\nPrinted log of this run:\nReadiness passed\n"
                                  "Rows per tier: 1, 1, 1"]
    assert out[-1] == (f"The tagged job run finished: wrote 3 rows for as_of_date 2026-09-30 with run_id 5f0c. Results table: "
                       f"{table}. Run: https://host/jobs/1/runs/7")
    launcher, _calls = _launcher(ns, outcome={"status": "RUNNING"})
    dbu = _dbutils()
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert dbu.notebook.exits == ["Job run still running after 30 minutes; follow it here: https://host/jobs/1/runs/7"], \
        "the exit replaces the cell's printed lines, so it carries the wait and the link itself"
    rule = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert "exits with it, followed by everything `run_use_case()` printed" in rule
    assert "so never call `dbutils.notebook.exit` in your own cells, and return the outcome instead" in rule, \
        "a round 22 notebook exited from its own cell, so inspire_main() never returned the outcome"


def test_a_preview_from_the_notebook_runs_only_the_notebook_task_and_keeps_full_as_the_jobs_default(agent_ns):
    ns, _call = _controls(agent_ns)
    for profile, only in (("preview", ["inspire_task"]), ("full", None), (" Preview ", ["inspire_task"])):
        launcher, calls = _launcher(ns)
        dbu = _dbutils(result_table="main.inspire.n01_u01_churn_out", run_profile=profile)
        dbu.notebook.exit = dbu.notebook.exits.append
        ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
        launch = calls["launch"]
        assert launch.get("only_tasks") == only, profile
        assert launch["run_parameters"]["run_profile"] == profile.strip(), profile
        assert launch["base"]["run_profile"] == "full", "a scheduled run of the job always runs every task, the alert included"
    launcher, calls = _launcher(ns)
    dbu = _dbutils(result_table="main.inspire.n01_u01_churn_out")
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert "only_tasks" not in calls["launch"] and "run_profile" not in calls["launch"]["run_parameters"]
    assert "run_profile" not in calls["launch"]["base"]


def test_the_job_run_itself_and_execution_here_run_in_place(agent_ns):
    ns, _call = _controls(agent_ns)
    marker = agent_ns["INSPIRE_CHILD_MARKER"]
    for values, expected in (({marker: "1"}, "child"), ({"execution": "Here"}, "here")):
        launcher, calls = _launcher(ns)
        dbu = _dbutils(**values)
        result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
        assert result["execution"] == expected and "launch" not in calls, values


def test_a_failed_launch_runs_here_and_a_failed_job_run_raises(agent_ns):
    ns, _call = _controls(agent_ns)
    out = []
    launcher, _calls = _launcher(ns, launch_result={"success": False, "error": "PERMISSION_DENIED: jobs"})
    result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=_dbutils(), launcher_cls=launcher, out=out.append)
    assert result == {"execution": "here", "fallback": "launch failed", "error": "PERMISSION_DENIED: jobs"}
    assert any("this run is not tagged" in line for line in out)
    launcher, _calls = _launcher(ns, outcome={"status": "FAILED", "error": "ValueError: boom"})
    with pytest.raises(RuntimeError, match="did not succeed \\(FAILED\\): ValueError: boom"):
        ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=_dbutils(), launcher_cls=launcher, out=lambda *_a: None)


def test_genie_code_adds_its_cells_above_the_last_run_controls_cell_and_builds_run_use_case(agent_ns):
    rule = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert "never edit, move or remove it" in rule and "set its Execution widget to Here" in rule and "set it back to As job" in rule
    assert "Inspire's Run controls cell is the last cell of the notebook and ends with `inspire_main()`" in rule
    assert ("add every cell between the instruction cell and Inspire's Number helpers cell, which sits directly above the Run "
            "controls cell, never editing, moving or removing the Number helpers cell either") in rule
    assert "Put each build step in a function and define `run_use_case()`, with no arguments" in rule
    assert "only imports, function definitions and the Parameters cell's widgets and typed reads run at top level" in rule, \
        "with ordinary cells, Run all would run the use case and the tagged job would run it again"
    assert "such as `as_of_date` = `latest` or a default the Parameters section says how to compute, is resolved by the first step " \
           "`run_use_case()` runs, never in the Parameters cell" in rule, \
        "two notebooks queried each table's newest date in the Parameters cell, so the session and the job run both ran it"
    params = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    params = params[params.index("## 3. Parameters"):params.index("## 4. Readiness Check")]
    assert ("The first step of `run_use_case()`, never the Parameters cell, computes these defaults, resolves `latest` and "
            "prints each table's newest date") in params
    assert params.index("A default that depends on the data is written as how to compute it") < params.index(
        "The first step of `run_use_case()`, never the Parameters cell")
    assert "and the notebook prints each table's newest date" not in params
    inst = build_inspire(agent_ns)
    for technique in FAMILIES.values():
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "never creates or deletes jobs (Inspire's Run controls cell runs its tagged job)" in prompt
    agents = agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert "Run controls" in agents and "Never edit or delete Inspire's four cells" in agents
    assert "between the instruction cell and the Number helpers cell, which sits directly above the Run controls cell, the last cell" \
        in agents
    assert "run_use_case()" in agents and "Add your cells below the Run controls cell" not in agents
    assert ("`run_use_case()` returns the run's outcome as a dict: {'status': 'written', 'rows_written': <n>, 'as_of_date': "
            "<date>, 'run_id': <id>} after the write, or {'status': 'stopped', 'stop_reason': <the message the STOP RULE "
            "printed>} when a check stops the run") in rule
    assert "Check each test run by that outcome, never by counting the output table's rows, which also holds earlier runs" in rule, \
        "round 22: Genie Code counted rows by as_of_date, took an earlier run's 53,123 rows as its own and reported success"
    assert "returns the run's outcome (written, with its row count, as_of_date and run_id, or stopped, with the reason)" in agents
    assert "and prints that outcome" in agents and "check each run by its outcome" in agents
    done = prompt[prompt.index("## 8. Definition of Done"):]
    assert "rows with this run's run_id" in done and "rows for this run's as_of_date" not in done


def test_widget_names_come_from_the_parameters_table_or_the_core_widgets(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc())
    core = [w["name"] for w in inst._genie_core_widgets(spec)]
    assert "as_of_date" in core
    assert inst._genie_widget_names(INSTRUCTION, spec) == ["result_table", "lookback_weeks"] + [n for n in core if n != "result_table"], \
        "core widgets the parameters table left out still reach the job"
    assert inst._genie_widget_names("## 1. Goal\nNo parameters section.\n", spec) == core


def test_round_41_a_test_run_is_submitted_with_the_widget_name_and_only_after_the_notebooks_runs_are_canceled(agent_ns):
    rule = agent_ns["GENIE_RUN_CONTROLS_RULE"]
    assert ("give a test run you submit as a job `{\"execution\": \"Here\"}` in its notebook task's base_parameters, the widget's "
            "name, never its label `Execution`, which the run ignores and so launches the tagged job") in rule, \
        ("round 41: the delisting notebook's first test run passed {'Execution': 'Here'}, so it ran as the tagged job (run "
         "123456789000005); test runs of rounds 27, 31, 39 and 41 passed the label")
    assert ("submit each test run in one command that first lists the active runs with their tasks (`databricks jobs list-runs "
            "--active-only --expand-tasks`, since without `--expand-tasks` a run lists no tasks, so no path matches and nothing is "
            "canceled) and cancels every run whose task runs this notebook's path, with or without `/Workspace` before it") in rule, \
        ("round 41: the delisting notebook listed the active runs without --expand-tasks and filtered them on r.get('tasks'), "
         "which no run had, so it canceled nothing")
    assert ("and never submit from two commands at once, since a second submit, such as one repeated after a long output, starts "
            "a run that writes the output table while the first still does") in rule, \
        ("rounds 9, 23, 30, 31 and 41 each had two test runs of one notebook running at once; in round 41 the delisting notebook's "
         "second run started 3 seconds after the first and stopped on DELTA_CONCURRENT_APPEND")
    assert rule.index("Run one test at a time") < rule.index("submit each test run in one command") < rule.index("with retries off")
    path = "/Users/someone@example.com/genie_loop/N09-U04"

    def canceled(listed):
        return [run["run_id"] for run in listed
                if any((task.get("notebook_task") or {}).get("notebook_path") in (path, "/Workspace" + path)
                       for task in run.get("tasks", []))]

    assert canceled([{"run_id": 1, "run_name": "N09-U04-build-test"}, {"run_id": 2, "run_name": "dbx_inspire_ai_n09_u04"}]) == [], \
        "a listing without --expand-tasks carries no tasks, so the notebook's own runs are never canceled"
    assert canceled([{"run_id": 1, "tasks": [{"notebook_task": {"notebook_path": path}}]},
                      {"run_id": 2, "tasks": [{"notebook_task": {"notebook_path": "/Workspace" + path}}]},
                      {"run_id": 3, "tasks": [{"notebook_task": {"notebook_path": path + "_copy"}}]},
                      {"run_id": 4, "tasks": [{"spark_python_task": {"python_file": "etl.py"}}]}]) == [1, 2], \
        "with the tasks listed, only the runs of this notebook's path are canceled"
    ns, _call = _controls(agent_ns)
    for values, launched in (({"Execution": "Here"}, True), ({"execution": "Here"}, False)):
        runs = []
        ns["run_use_case"] = lambda: runs.append(1) or {"status": "written", "rows_written": 5, "as_of_date": "2026-09-30", "run_id": "a1"}
        launcher, calls = _launcher(ns)
        dbu = _dbutils(**values)
        dbu.notebook.exit = dbu.notebook.exits.append
        gate = ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
        assert ("launch" in calls) is launched, values
        assert gate["execution"] == ("job" if launched else "here") and runs == ([] if launched else [1]), (values, gate)
    inst = build_inspire(agent_ns)
    for technique in FAMILIES.values():
        assert rule in inst._genie_platform_rules(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))), technique
    assert rule.isascii()
