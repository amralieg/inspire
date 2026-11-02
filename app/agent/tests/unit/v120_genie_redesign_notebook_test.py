"""Genie Code notebooks: Inspire writes four cells per use case (the title with the use-case card, the copy line and a
one-line disclaimer, then the self-contained instruction as a raw-string code cell, then the Number helpers, then the Run controls), the instruction carries the elite decision block, invented
numbers go through the one repair pass, edited notebooks are never overwritten, and AGENTS.md carries the shared Genie Code
rules."""
import ast
import json
import os
import re
import sys
import types
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source
from _nbload import strip_magic_lines
from v120_genie_redesign_support import FakeWorkspace
from v120_genie_support import CUSTOMERS, ORDERS, FakeAgent, FakeLoader, build_inspire, long_instruction, make_uc

ONE_PER_FAMILY = {"A": "Classification", "B": "Anomaly Detection", "C": "Clustering", "D": "Recommendation", "E": "Forecasting",
                  "F": "Trend Analysis", "G": "Sentiment Analysis", "H": "Optimization"}
ELITE = {"decision": "Which accounts get a retention call each week", "decision_owner": "Retention lead", "cadence": "weekly",
         "kpi": "90-day churn rate", "kpi_direction": "down", "value_tier": "Material", "outcome_definition": "no order in the 90 days after the as-of date",
         "time_column": f"{ORDERS}.order_ts", "entity_key_column": f"{ORDERS}.customer_id", "join_path": [ORDERS, CUSTOMERS],
         "signal_columns": [f"{ORDERS}.amount"], "build_path": "Lakeflow job with an MLflow model", "blockers": ["no consent flag"]}


def _text(cell):
    return "".join(cell["source"]) if isinstance(cell["source"], list) else cell["source"]


def _code_tokens(source):
    import io
    import tokenize
    kept = []
    for token in tokenize.generate_tokens(io.StringIO(strip_magic_lines(source)).readline):
        if token.type not in {tokenize.STRING, tokenize.COMMENT} | {getattr(tokenize, n, -1) for n in ("FSTRING_START", "FSTRING_MIDDLE", "FSTRING_END")}:
            kept.append(token.string)
    return " ".join(kept)


def _spec(controls):
    return ast.literal_eval(controls[controls.index("SPEC = ") + len("SPEC = "):controls.index("\nfor _kind")])


def _notebook(agent_ns, technique, **uc_fields):
    inst = build_inspire(agent_ns)
    writes = []
    inst._write_notebook_to_workspace = lambda d, p, obj, uid: writes.append(obj) or p
    fields = {"Analytics Technique": technique, "genie_instruction": "## 1. Decision and Owner\nThe retention lead decides weekly. " + "x " * 60,
              "genie_instruction_status": "success"}
    fields.update(uc_fields)
    inst._assemble_genie_code_notebook(make_uc(**fields), {})
    return writes[-1]


@pytest.mark.parametrize("family,technique", sorted(ONE_PER_FAMILY.items()))
def test_every_family_writes_the_card_the_instruction_and_the_run_controls(agent_ns, family, technique):
    instruction = "## 1. Goal\nThe retention lead decides weekly. " + "x " * 60
    nb = _notebook(agent_ns, technique, genie_instruction=instruction)
    assert [c["cell_type"] for c in nb["cells"]] == ["markdown", "code", "code", "code"]
    head, code = _text(nb["cells"][0]), _text(nb["cells"][1])
    cls = agent_ns["DatabricksInspire"]
    assert head.startswith("# N01-U01: Use case N01-U01\n\n| | |\n|---|---|\n| **What it does** |")
    assert head.rstrip().endswith(cls._GENIE_NOTEBOOK_DISCLAIMER + "\n\n" + cls._GENIE_COPY_LINE)
    assert nb["cells"][1]["metadata"]["application/vnd.databricks.v1+cell"]["title"] == "Genie Code instruction"
    tree = ast.parse(code)
    assert len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr)
    assert ast.literal_eval(tree.body[0].value).strip() == instruction.strip()
    meta = nb["metadata"]["application/vnd.databricks.v1+notebook"]
    assert meta["language"] == "python" and meta["environmentMetadata"]["environment_version"] == agent_ns["GENIE_NOTEBOOK_ENV_VERSION"]
    every = head + code + _text(nb["cells"][-1])
    for gone in ("GENIE SLOT", "Contract check", "SPEC = ", "Smoke test", "InspireSlotNotFilled"):
        assert gone not in every, (family, gone)
    assert nb["cells"][2]["metadata"]["application/vnd.databricks.v1+cell"]["title"] == agent_ns["GENIE_NUMBER_HELPERS_TITLE"]
    assert nb["cells"][-1]["metadata"]["application/vnd.databricks.v1+cell"]["title"] == "Run controls (Inspire, do not edit)"


@pytest.mark.parametrize("family,technique", sorted(ONE_PER_FAMILY.items()))
def test_only_families_a_to_d_register_a_model(agent_ns, family, technique):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
    mandate = inst._build_code_structure_mandate(spec)
    lifecycle = family in "ABCD"
    assert spec["family"] == family
    assert (spec["model_name"] == "main.inspire.n01_u01_churn_out_model") is lifecycle and (spec["model_name"] is None) is (not lifecycle)
    run_pattern = next(line for line in mandate.splitlines() if line.startswith("Run pattern: "))
    assert ("`main.inspire.n01_u01_churn_out_model` with the alias champion" in run_pattern) is lifecycle
    assert ("nothing is registered" in run_pattern) is (not lifecycle)
    assert not {"retrain_days", "max_psi"} & set(spec["thresholds"])
    assert "run mode" not in mandate.lower() and "GENIE SLOT" not in mandate and "SPEC" not in mandate


def test_the_brief_pins_the_packages_of_the_environment_constant(agent_ns):
    inst = build_inspire(agent_ns)

    def brief(technique):
        return inst._build_code_structure_mandate(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))

    assert "which already ships scikit-learn==1.6.1; the notebook installs nothing." in brief("Classification")
    assert "which already ships statsmodels==0.14.4; the notebook installs nothing." in brief("Forecasting")
    assert "which already ships scikit-learn==1.6.1, scipy==1.15.1; the notebook installs nothing." in brief("Recommendation")
    assert "which already ships every library this use case needs; the notebook installs nothing." in brief("Sentiment Analysis")
    assert not any("%pip" in brief(t) or "pip install" in brief(t)
                   for t in ("Classification", "Forecasting", "Recommendation", "Sentiment Analysis"))
    assert f"serverless environment version {agent_ns['GENIE_NOTEBOOK_ENV_VERSION']}" in brief("Classification")


def test_the_spec_names_the_model_the_output_table_and_the_tier_actions(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(elite_assessment=ELITE, elite_status="ELITE"))
    assert spec["model_name"] == "main.inspire.n01_u01_churn_out_model" and spec["family"] == "A"
    assert spec["result_table"] == "`main`.`inspire`.`n01_u01_churn_out`"
    assert spec["action_by_tier"]["Act now"] == "Act in this weekly cycle"
    assert spec["action_target"] == "Which accounts get a retention call each week"
    assert not {"widgets", "experiment_leaf"} & set(spec)
    assert {"job_slug", "job_tags", "schedule_cron", "wait_minutes"} <= set(spec)
    mandate = inst._build_code_structure_mandate(spec)
    assert "Business output table `main`.`inspire`.`n01_u01_churn_out` (Delta" in mandate
    assert "'Act now' = \"Act in this weekly cycle\"" in mandate
    assert "its own next step for Which accounts get a retention call each week" in mandate
    columns = [line[2:].split(" ")[0] for line in mandate.splitlines() if line.startswith("- ")]
    assert columns == [name for name, _ in agent_ns["INSPIRE_CORE_COLUMNS"]]
    assert "rank is at most floor(`act_now_share` x N)" in mandate and "floor((`act_now_share` + `review_share`) x N)" in mandate
    assert "AI facts: " + agent_ns["GENIE_EXPLANATION_FACTS_RULE"] in mandate
    assert f"at most {agent_ns['INSPIRE_AI_AUTO_ROWS']} per run" in mandate and "top-ranked of them" not in mandate


def test_elite_values_beneficiary_and_sponsor_reach_the_prompt(agent_ns):
    agent = FakeAgent([long_instruction(f"Use `{ORDERS}.amount`.")])
    inst = build_inspire(agent_ns, loader=FakeLoader(), agent=agent)
    inst._generate_genie_instruction_for_use_case(make_uc(elite_assessment=ELITE, elite_status="ELITE", Beneficiary="Account managers", Sponsor="Head of sales"), [], "")
    sent = agent.calls[0]["vars"]
    assert sent["decision"] == ELITE["decision"] and sent["decision_owner"] == "Retention lead" and sent["cadence"] == "weekly"
    assert sent["kpi"] == "90-day churn rate" and sent["outcome_definition"] == ELITE["outcome_definition"]
    assert sent["time_column"] == f"{ORDERS}.order_ts" and sent["entity_key_column"] == f"{ORDERS}.customer_id"
    assert sent["join_path"] == f"{ORDERS} -> {CUSTOMERS}" and sent["blockers"] == "no consent flag"
    assert sent["beneficiary"] == "Account managers" and sent["sponsor"] == "Head of sales"
    assert sent["model_name"] == "main.inspire.n01_u01_churn_out_model" and sent["execution_family"].startswith("family A, Supervised scoring")
    assert "readiness `positives`" in sent["readiness_thresholds"] and "Run pattern: every run trains on closed outcome windows" in sent["code_structure_mandate"]
    assert sent["execution_family"] == "family A, Supervised scoring"
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    rendered = prompt.format(**sent)
    assert ELITE["decision"] in rendered and "Retention lead" in rendered


def test_without_an_elite_assessment_every_decision_field_is_not_assessed(agent_ns):
    agent = FakeAgent([long_instruction(f"Use `{ORDERS}.amount`.")])
    inst = build_inspire(agent_ns, loader=FakeLoader(), agent=agent)
    inst._generate_genie_instruction_for_use_case(make_uc(), [], "")
    sent = agent.calls[0]["vars"]
    for key in agent_ns["DatabricksInspire"]._GENIE_DECISION_KEYS:
        assert sent[key] == "not assessed", key


def test_persisted_stale_guidance_never_reaches_the_prompt(agent_ns):
    agent = FakeAgent([long_instruction("Use the persisted schema.")])
    inst = build_inspire(agent_ns, loader=None, agent=agent)
    uc = make_uc(_genie_fields_cached=True, directly_involved_schema="persisted schema text", foreign_key_relationships="persisted fks",
                 available_tables_listing="persisted listing", technique_implementation_guidance="OLD guidance: MINIMUM BAR ... is a FAILURE")
    inst._generate_genie_instruction_for_use_case(uc, [], "", schema_index=None)
    sent = agent.calls[0]["vars"]
    assert sent["directly_involved_schema"] == "persisted schema text"
    assert sent["technique_implementation_guidance"] == agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Classification"]
    assert "OLD guidance" not in json.dumps(sent)


def test_the_instruction_is_emitted_without_an_appended_launcher(agent_ns):
    text = long_instruction(f"Use `{ORDERS}.amount`.")
    inst = build_inspire(agent_ns, loader=FakeLoader(), agent=FakeAgent([text]))
    uc = inst._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert uc["genie_instruction"].startswith(text.strip()) and "Job Launcher" not in uc["genie_instruction"]
    assert not hasattr(agent_ns["DatabricksInspire"], "_build_job_launcher_instruction_section")


@pytest.mark.parametrize("text,flagged", [
    ("The model gives an accuracy improvement of 20-30% over today.", True),
    ("Expected impact: reduce churn by 25%.", True),
    ("This saves $2.4M a year.", True),
    ("An estimated 15-20% improvement in recall.", True),
    ("Missing data reduces accuracy by ~15%.", True),
    ("Expect an AUC of 0.85 on unseen weeks.", True),
    ("Improve the KPI by [ESTIMATE: depends on `orders.amount`].", False),
    ("Report a 95% prediction interval for each forecast.", False),
    ("Stop if join coverage is below 80%: the readiness gate enforces it.", False),
    ("Accept when AUC is at least 0.60 and beats the baseline by 0.02.", False),
    ("Every segment must hold at least 3% of entities.", False),
])
def test_numeric_claim_validator(agent_ns, text, flagged):
    claims = agent_ns["DatabricksInspire"]._find_unsupported_numeric_claims(text)
    assert bool(claims) is flagged, claims


def test_invented_numbers_go_through_the_single_repair_pass(agent_ns):
    invented = long_instruction(f"Use `{ORDERS}.amount`. It gives an accuracy improvement of 20-30% over the current process.")
    clean = long_instruction(f"Use `{ORDERS}.amount`. The gain is [ESTIMATE: depends on `orders.amount`].")
    agent = FakeAgent([invented, clean])
    inst = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=agent)
    uc = inst._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert len(agent.calls) == 2 and agent.calls[1]["skip_cache"] is True
    feedback = agent.calls[1]["vars"]["directly_involved_schema"]
    assert "REPAIR REQUIRED" in feedback and "accuracy improvement of 20-30%" in feedback
    assert uc["genie_instruction_status"] == "success" and uc["genie_numeric_claims"] == []


def test_invented_numbers_left_after_the_repair_fail_ultra_high_and_warn_in_good_mode(agent_ns):
    invented = long_instruction(f"Use `{ORDERS}.amount`. It cuts churn by 25%.")
    strict = build_inspire(agent_ns, loader=FakeLoader(), quality="Ultra High", agent=FakeAgent([invented, invented]))
    uc = strict._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert uc["genie_instruction_status"] == "failed_validation" and uc["genie_instruction"] == "" and uc["genie_numeric_claims"]
    soft = build_inspire(agent_ns, loader=FakeLoader(), quality="Good", agent=FakeAgent([invented, invented]))
    uc = soft._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert uc["genie_instruction_status"] == "validation_errors" and "cuts churn by 25%" in uc["genie_numeric_claims"][0]
    nb = _notebook(agent_ns, "Classification", genie_instruction_status="validation_errors", genie_numeric_claims=uc["genie_numeric_claims"])
    assert len(nb["cells"]) == 4 and "These statements cite figures that are not in the data" in _text(nb["cells"][1])
    assert "cuts churn by 25%" in _text(nb["cells"][1])


def test_the_ai_endpoint_default_is_the_first_detected_worker_endpoint(fresh_ns):
    fresh_ns["TECHNICAL_CONTEXT"]["models"] = [
        {"name": "t", "order": 1, "type": "thinker", "size": "large", "enabled": True, "llm_endpoint_name": "databricks-thinker-x"},
        {"name": "w2", "order": 3, "type": "worker", "size": "small", "enabled": True, "llm_endpoint_name": "databricks-worker-small"},
        {"name": "w1", "order": 2, "type": "worker", "size": "large", "enabled": True, "llm_endpoint_name": "databricks-worker-large"},
    ]
    assert fresh_ns["DatabricksInspire"]._genie_ai_endpoint_default() == "databricks-worker-large"
    spec = build_inspire(fresh_ns)._genie_notebook_spec(make_uc())
    assert spec["ai_endpoint"] == "databricks-worker-large"
    assert "AI endpoint: `databricks-worker-large`." in build_inspire(fresh_ns)._build_code_structure_mandate(spec)


def test_cadence_maps_to_a_paused_schedule_or_none(agent_ns):
    inst = build_inspire(agent_ns)
    assert inst._genie_cadence("weekly")["cron"] == "0 0 6 ? * MON"
    assert inst._genie_cadence("Daily")["cron"] == "0 0 6 * * ?" and inst._genie_cadence("monthly")["days"] == 30
    assert inst._genie_cadence("not assessed") == {"cron": None, "days": None, "season": None, "horizon": None}
    src = agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE
    assert "pause_status=_jl_jobs.PauseStatus.PAUSED" in src and "QueueSettings(enabled=True)" in src


def _workspace_inst(agent_ns, workspace):
    inst = build_inspire(agent_ns)
    inst.w_client = types.SimpleNamespace(workspace=workspace)
    import databricks.sdk.service.workspace as ws
    for name, values in (("ImportFormat", {"JUPYTER": "JUPYTER", "AUTO": "AUTO"}), ("ExportFormat", {"JUPYTER": "JUPYTER", "AUTO": "AUTO", "SOURCE": "SOURCE"})):
        if not hasattr(ws, name):
            setattr(ws, name, types.SimpleNamespace())
        for member, value in values.items():
            if not hasattr(getattr(ws, name), member):
                setattr(getattr(ws, name), member, value)
    return inst


def _written_notebook(agent_ns, uc):
    inst = build_inspire(agent_ns)
    captured = []
    inst._write_notebook_to_workspace = lambda d, p, obj, uid: captured.append((d, p, obj)) or p
    inst._assemble_genie_code_notebook(uc, {})
    notebook_dir, path, obj = captured[0]
    agent_ns["DatabricksInspire"]._stamp_notebook_fingerprint(obj)
    return notebook_dir, path, obj


def test_an_untouched_notebook_is_overwritten_in_place(agent_ns):
    uc = make_uc(genie_instruction="instruction " + "x" * 200)
    notebook_dir, path, stamped = _written_notebook(agent_ns, uc)
    workspace = FakeWorkspace(existing={path[:-len(".ipynb")]: {"cells": stamped["cells"]}})
    inst = _workspace_inst(agent_ns, workspace)
    fresh = _written_notebook(agent_ns, uc)[2]
    fresh["cells"] = [dict(c) for c in stamped["cells"]]
    for cell in fresh["cells"]:
        cell["source"] = [s for s in cell["source"] if "Inspire fingerprint" not in s]
    assert inst._write_notebook_to_workspace(notebook_dir, path, fresh, uc["No"]) == path
    assert workspace.imports[0]["path"] == path


def test_a_notebook_edited_by_the_user_or_genie_is_never_overwritten(agent_ns):
    uc = make_uc(genie_instruction="instruction " + "x" * 200)
    notebook_dir, path, stamped = _written_notebook(agent_ns, uc)
    edited = json.loads(json.dumps(stamped))
    edited["cells"].append({"cell_type": "code", "execution_count": 0, "outputs": [],
                            "metadata": {"application/vnd.databricks.v1+cell": {"nuid": "built-by-genie"}},
                            "source": ["orders = spark.table('main.sales.orders')\n"]})
    workspace = FakeWorkspace(existing={path[:-len(".ipynb")]: {"cells": edited["cells"]}})
    inst = _workspace_inst(agent_ns, workspace)
    new_obj = _written_notebook(agent_ns, uc)[2]
    for cell in new_obj["cells"]:
        cell["source"] = [s for s in cell["source"] if "Inspire fingerprint" not in s]
    written = inst._write_notebook_to_workspace(notebook_dir, path, new_obj, uc["No"])
    assert written != path and re.search(r" \(regenerated \d{4}-\d{2}-\d{2} \d{6}\)\.ipynb$", written)
    assert [i["path"] for i in workspace.imports] == [written]
    assert json.loads(workspace.imports[0]["content"])["metadata"]["application/vnd.databricks.v1+notebook"]["notebookName"] == os.path.basename(written)[:-len(".ipynb")]
    assert any("[NOTEBOOK-PRESERVED]" in str(c) for c in inst.logger.warning.call_args_list)


def test_flipping_the_route_2_flag_alone_still_regenerates_in_place(agent_ns):
    inst = build_inspire(agent_ns)
    captured = []
    inst._write_notebook_to_workspace = lambda d, p, obj, uid: captured.append((d, p, obj)) or p
    uc = make_uc()
    inst._assemble_skeleton_notebook(uc)
    notebook_dir, path, skeleton = captured[0]
    agent_ns["DatabricksInspire"]._stamp_notebook_fingerprint(skeleton)
    flagged = json.loads(json.dumps(skeleton))
    for cell in flagged["cells"]:
        cell["source"] = [s.replace("generate_genie_code_instruction = False", "generate_genie_code_instruction = True") for s in cell["source"]]
    assert "generate_genie_code_instruction = True" in json.dumps(flagged)
    workspace = FakeWorkspace(existing={path[:-len(".ipynb")]: {"cells": flagged["cells"]}})
    writer = _workspace_inst(agent_ns, workspace)
    assert writer._existing_notebook_state(path) == ("untouched", None)
    added = json.loads(json.dumps(skeleton))
    added["cells"].append({"cell_type": "markdown", "source": ["my own notes\n"]})
    assert _workspace_inst(agent_ns, FakeWorkspace(existing={path[:-len(".ipynb")]: {"cells": added["cells"]}}))._existing_notebook_state(path)[0] == "edited"


def test_missing_and_unreadable_notebooks(agent_ns):
    inst = _workspace_inst(agent_ns, FakeWorkspace())
    assert inst._existing_notebook_state("/Workspace/out/x.ipynb") == ("absent", None)
    blocked = _workspace_inst(agent_ns, FakeWorkspace(export_error=PermissionError("PERMISSION_DENIED")))
    assert blocked._existing_notebook_state("/Workspace/out/x.ipynb")[0] == "unreadable"


def test_an_untouched_regenerated_sibling_is_reused_instead_of_piling_up_copies(agent_ns):
    uc = make_uc(genie_instruction="instruction " + "x" * 200)
    notebook_dir, path, stamped = _written_notebook(agent_ns, uc)
    base = os.path.basename(path)[:-len(".ipynb")]
    sibling = os.path.join(notebook_dir, f"{base} (regenerated 2026-10-01 101010)")
    workspace = FakeWorkspace(existing={sibling: {"cells": stamped["cells"]}}, listing=[sibling, os.path.join(notebook_dir, "other")])
    inst = _workspace_inst(agent_ns, workspace)
    assert inst._regenerated_notebook_path(notebook_dir, base) == sibling + ".ipynb"


def test_agents_file_is_written_once_within_the_limit_and_never_over_a_user_edit(agent_ns):
    template = agent_ns["GENIE_AGENTS_FILE_TEMPLATE"]
    assert len(template) <= 20000 and "second cell" in template and "Never edit or delete Inspire's four cells" in template
    assert ("Add your cells between the instruction cell and the Number helpers cell, which sits directly above the Run controls "
            "cell, the last cell") in template
    assert "define run_use_case(), which runs the steps in order" in template and "The Run controls cell ends with inspire_main()" in template
    assert "a value computed from the data, such as as_of_date = latest, is resolved by the first step of run_use_case()" in template
    assert "Run controls" in template and "set Execution to Here" in template and "the first three cells" not in template
    for gone in ("GENIE SLOT", "Contract check", "InspireReadinessStop", "SPEC[", "Smoke test"):
        assert gone not in template, gone
    workspace = FakeWorkspace()
    inst = _workspace_inst(agent_ns, workspace)
    path = inst._write_genie_agents_file()
    assert path == "/Workspace/out/notebooks/AGENTS.md" and len(workspace.imports) == 1 and len(workspace.imports[0]["content"]) <= 20000
    assert inst._write_genie_agents_file() == path and len(workspace.imports) == 1
    edited = workspace.imports[0]["content"].replace("Add your cells", "Add our cells")
    assert edited != workspace.imports[0]["content"]
    workspace2 = FakeWorkspace(existing={"/Workspace/out/notebooks/AGENTS.md": edited})
    inst2 = _workspace_inst(agent_ns, workspace2)
    assert inst2._write_genie_agents_file() == path and workspace2.imports == []
    workspace3 = FakeWorkspace(existing={"/Workspace/out/notebooks/AGENTS.md": workspace.imports[0]["content"]})
    inst3 = _workspace_inst(agent_ns, workspace3)
    inst3._write_genie_agents_file()
    assert len(workspace3.imports) == 1


def test_genie_waves_write_the_agents_file_only_when_a_genie_notebook_was_written(agent_ns):
    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    calls = []
    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=lambda uc, t: "/nb/g.ipynb", _write_genie_agents_file=lambda root="": calls.append(1) or "/x/AGENTS.md")
    inst._run_genie_waves([make_uc()], [], "", {}, {})
    assert calls == [1]
    inst2 = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=lambda uc, *a, **k: dict(uc, genie_instruction_status="failed", genie_instruction=""),
                          _write_genie_agents_file=lambda root="": calls.append(2) or "")
    inst2._run_genie_waves([make_uc()], [], "", {}, {})
    assert calls == [1]


def test_a_notebook_this_run_wrote_is_recognised_even_if_the_workspace_reformats_it(agent_ns):
    uc = make_uc(genie_instruction="instruction " + "x" * 200)
    notebook_dir, path, stamped = _written_notebook(agent_ns, uc)
    stamp = agent_ns["DatabricksInspire"]._stored_fingerprint(stamped["cells"])
    reformatted = json.loads(json.dumps(stamped))
    reformatted["cells"][0]["source"] = [s.replace("Copy the cell", "Copy  the cell") for s in reformatted["cells"][0]["source"]]
    assert reformatted["cells"][0]["source"] != stamped["cells"][0]["source"]
    workspace = FakeWorkspace(existing={path[:-len(".ipynb")]: {"cells": reformatted["cells"]}})
    inst = _workspace_inst(agent_ns, workspace)
    assert inst._existing_notebook_state(path)[0] == "edited"
    inst._genie_written_fingerprints = {path: stamp}
    assert inst._existing_notebook_state(path) == ("untouched", None)


def test_the_writer_records_what_it_stamped_for_the_rest_of_the_run(agent_ns):
    uc = make_uc(genie_instruction="instruction " + "x" * 200)
    notebook_dir, path, _ = _written_notebook(agent_ns, uc)
    obj = _written_notebook(agent_ns, uc)[2]
    for cell in obj["cells"]:
        cell["source"] = [s for s in cell["source"] if "Inspire fingerprint" not in s]
    inst = _workspace_inst(agent_ns, FakeWorkspace())
    inst._write_notebook_to_workspace(notebook_dir, path, obj, uc["No"])
    assert inst._genie_written_fingerprints[path] == agent_ns["DatabricksInspire"]._stored_fingerprint(obj["cells"])


def test_an_over_long_instruction_triggers_the_repair_but_never_fails_it(fresh_ns):
    fresh_ns["GENIE_INSTRUCTION_MAX_CHARS"] = 400
    long_text = long_instruction(f"Use `{ORDERS}.amount`. " + "Detail. " * 80)
    short_text = long_instruction(f"Use `{ORDERS}.amount`.")
    agent = FakeAgent([long_text, short_text])
    inst = build_inspire(fresh_ns, loader=FakeLoader(), quality="Ultra High", agent=agent)
    uc = inst._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert len(agent.calls) == 2 and "under 400 characters" in agent.calls[1]["vars"]["directly_involved_schema"]
    assert uc["genie_instruction_status"] == "success" and uc["genie_instruction"].startswith(short_text.strip())
    rounds = fresh_ns["GENIE_INSTRUCTION_REPAIR_ROUNDS"]
    stubborn = FakeAgent([long_text] * (rounds + 2))
    inst2 = build_inspire(fresh_ns, loader=FakeLoader(), quality="Ultra High", agent=stubborn)
    uc2 = inst2._generate_genie_instruction_for_use_case(make_uc(), [], "")
    assert uc2["genie_instruction_status"] == "success" and len(stubborn.calls) == rounds + 1
    assert any("still failing after" in str(c) for c in inst2.logger.warning.call_args_list)
    assert any("[GENIE-SIZE]" in str(c) for c in inst2.logger.warning.call_args_list)


def test_the_first_cell_is_the_card_then_the_copy_line(agent_ns):
    nb = _notebook(agent_ns, "Classification")
    head = _text(nb["cells"][0])
    visible = re.sub(r"<!--.*?-->", "", head, flags=re.S).strip().splitlines()
    assert visible[:3] == ["# N01-U01: Use case N01-U01", "", "| | |"]
    assert visible[-3:] == [agent_ns["DatabricksInspire"]._GENIE_NOTEBOOK_DISCLAIMER, "", agent_ns["DatabricksInspire"]._GENIE_COPY_LINE]
    for gone in ("Smoke test", "Contract check", "GENIE SLOT"):
        assert gone not in head




@pytest.mark.parametrize("family,technique", sorted(ONE_PER_FAMILY.items()))
def test_every_readiness_line_carries_its_plain_stop_message_without_placeholders(agent_ns, family, technique):
    inst = build_inspire(agent_ns)
    text = inst._genie_threshold_text(inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique})))
    rules = agent_ns["INSPIRE_READINESS_RULES"]
    readiness = [line for line in text.splitlines() if line.startswith("- readiness `")]
    assert len(readiness) == len(rules["common"]) + len(rules[family])
    assert all('; when it fails, print: "' in line and line.endswith('"') for line in readiness)
    assert "{" not in text and "}" not in text and "<measured>" in text
    assert agent_ns["DatabricksInspire"]._find_unsupported_numeric_claims(text) == []
    assert '"Only <measured> of rows match along the verified join path; at least 80% must match."' in text


def test_the_stop_message_fills_the_required_value_and_never_leaves_a_placeholder(agent_ns):
    stop = agent_ns["DatabricksInspire"]._genie_stop_message
    assert stop("The outcome occurs in {observed:.2%} of cases; below {required:.2%} it cannot be separated reliably.", 0.005) \
        == "The outcome occurs in <measured> of cases; below 0.50% it cannot be separated reliably."
    assert stop("There are {observed} entities; at least {required} are needed.", "10 x k") == "There are <measured> entities; at least 10 x k are needed."
    assert stop("{observed:.0%} missing; at most {required:.0%} allowed.", "not a number") == "<measured> missing; at most not a number allowed."
