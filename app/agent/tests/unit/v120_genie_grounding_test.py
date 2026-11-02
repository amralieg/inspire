"""v1.2.0 GENIE lane: Genie Code grounding in live Unity Catalog metadata (G-02, G-04, G-13, G-17) and
registry-matched analytics techniques in the Genie region."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import (CUSTOMERS, ORDERS, RESULT, STORES, FakeAgent, FakeLoader, build_inspire,
                                long_instruction, make_uc, schema_details)


def _index(inst, tables=None):
    return inst._build_genie_schema_index(schema_details(tables))


def test_genie_fields_carry_real_columns_types_and_comments(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    fields = inst._compute_per_uc_genie_fields(make_uc(), [], None)
    schema = fields["directly_involved_schema"]
    for token in ("amount", "DECIMAL(12,2)", "order value", "order_ts", "TIMESTAMP", "segment", "marketing segment"):
        assert token in schema, token
    assert "No column expansion is provided" not in schema
    assert "live Unity Catalog metadata" in schema


def test_genie_fields_leave_out_declared_tables_live_metadata_does_not_know(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    uc = make_uc(**{"Tables Involved": f"{ORDERS}, main.sales.ghost_table", "Primary Table": "main.sales.ghost_table"})
    fields = inst._compute_per_uc_genie_fields(uc, [], None)
    assert "ghost_table" not in fields["directly_involved_schema"]
    assert "ghost_table" not in fields["available_tables_listing"]
    assert "amount" in fields["directly_involved_schema"]


def test_genie_fields_without_any_metadata_never_trust_the_declared_tables(agent_ns):
    inst = build_inspire(agent_ns, loader=None)
    fields = inst._compute_per_uc_genie_fields(make_uc(), [], None)
    assert fields["directly_involved_schema"] == "No schema available"
    assert ORDERS not in fields["available_tables_listing"]


def test_genie_fields_keep_every_column_of_wide_tables(agent_ns):
    wide = [(f"attr_{i:03d}", "STRING", "") for i in range(200)] + [("customer_id", "BIGINT", ""), ("event_ts", "TIMESTAMP", "")]
    inst = build_inspire(agent_ns, loader=FakeLoader(tables={"main.web.events": wide}, relations={}))
    uc = make_uc(**{"Tables Involved": "main.web.events", "Primary Table": "main.web.events"})
    schema = inst._compute_per_uc_genie_fields(uc, [], None)["directly_involved_schema"]
    shown = [line for line in schema.splitlines()
             if line.startswith("| ") and not line.startswith(("| column", "| ---"))]
    assert len(shown) == len(wide)
    assert "| event_ts | TIMESTAMP |" in schema and "| customer_id | BIGINT |" in schema
    assert "| attr_000 | STRING |" in schema and "| attr_199 | STRING |" in schema
    assert "more columns not shown" not in schema


def test_genie_foreign_keys_come_from_live_metadata_with_inferred_tag(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    fks = inst._compute_per_uc_genie_fields(make_uc(), [], None)["foreign_key_relationships"]
    assert f"{ORDERS}.customer_id → {CUSTOMERS}.customer_id" in fks
    assert f"{ORDERS}.store_id → {STORES}.store_id (inferred)" in fks


def test_validator_flags_a_hallucinated_column_on_a_real_table(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction(f"Use `{ORDERS}.amount` and `{ORDERS}.discount_pct` from `{ORDERS}`.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is False
    assert bad == [f"{ORDERS}.discount_pct"]


def test_validator_checks_short_table_column_references(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction("Grounded in `orders.amount`, `customers.segment` and `orders.loyalty_tier`.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is False and bad == ["orders.loyalty_tier"]


def test_validator_checks_schema_table_column_references(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction("Measure sales.orders.amount against sales.orders.margin_pct.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is False and bad == ["sales.orders.margin_pct"]


def test_validator_never_self_allowlists_declared_tables_when_metadata_is_available(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    uc = make_uc(**{"Tables Involved": f"{ORDERS}, main.sales.ghost_table", "Primary Table": "main.sales.ghost_table",
                    "available_tables_listing": "- main.sales.ghost_table\n- main.sales.phantom"})
    text = long_instruction("Join `main.sales.ghost_table` with `main.sales.phantom` and `main.sales.orders`.")
    ok, bad = inst._validate_genie_instruction_references(uc, text, schema_index=_index(inst))
    assert ok is False
    assert bad == ["main.sales.ghost_table", "main.sales.phantom"]
    assert uc["genie_validation_basis"] == "live_metadata"


def test_validator_resolves_real_tables_outside_the_index_through_live_metadata(agent_ns):
    loader = FakeLoader()
    inst = build_inspire(agent_ns, loader=loader)
    text = long_instruction(f"Enrich with `{STORES}.region` and `{STORES}`.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst, {ORDERS: []}))
    assert ok is True and bad == []
    assert any(STORES in call for call in loader.calls)


def test_validator_accepts_code_namespaces_hosts_files_system_and_the_result_table(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction(
        "Train sklearn.ensemble.IsolationForest, sksurv.ensemble.RandomSurvivalForest, lifelines.statistics.logrank_test and "
        "networkx.algorithms.community, log with mlflow.models.infer_signature(X, y), avoid spark.conf.get, "
        "read system.access.table_lineage and main.information_schema.columns, see docs.databricks.com, save model.pkl.gz, "
        f"U.S.A rules, then MERGE INTO `{RESULT}` and fill `{RESULT}.ai_sys_confidence`; the example catalog.schema.table is a placeholder."
    )
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is True, bad


def test_validator_has_no_false_positives_on_the_shipped_demo_instructions(agent_ns):
    import glob
    import json
    import re
    from _agentload import ROOT
    pattern = agent_ns["DatabricksInspire"]._GENIE_REFERENCE_RE
    checked, flagged, columns_known, poison_checks = 0, [], 0, 0
    for demo in sorted(glob.glob(os.path.join(ROOT, "demos", "*"))):
        texts = []
        for path in sorted(glob.glob(os.path.join(demo, "notebooks", "**", "*.ipynb.py"), recursive=True)):
            source = open(path, encoding="utf-8", errors="ignore").read()
            if "No Genie Code instruction has been generated" in source:
                continue
            for cell in source.split("# COMMAND ----------"):
                if "## Genie Code instruction" in cell:
                    texts.append("\n".join(re.sub(r"^#\s*MAGIC ?", "", ln.lstrip())
                                           for ln in cell.splitlines() if ln.lstrip().startswith("# MAGIC")))
                    break
        tables = {}
        for text in texts:
            for m in pattern.finditer(text):
                parts = m.group(1).replace("`", "").lower().split(".")
                if len(parts) >= 3 and parts[0] == "samples":
                    tables.setdefault(".".join(parts[:3]), [])
        registry = json.load(open(glob.glob(os.path.join(demo, "docs", "*.json"))[0], encoding="utf-8"))
        for entry in registry["column_registry"].values():
            fqn, _, rest = entry.partition(",")
            parts = fqn.strip().split(".")
            tables.setdefault(".".join(parts[:3]).lower(), []).append((parts[3], rest.strip().split(" ")[0], ""))
            columns_known += 1
        inst = build_inspire(agent_ns, loader=FakeLoader(tables=tables, relations={}))
        for text in texts:
            result = re.search(r"MERGE INTO `?([A-Za-z0-9_.`]+)", text)
            uc = {"No": "DEMO", "Tables Involved": "", "result_table": result.group(1).replace("`", "") if result else ""}
            flagged.extend(inst._validate_genie_instruction_references(uc, text, schema_index=None)[1])
            checked += 1
            if os.path.basename(demo) == "tpcds_sf1":
                poisoned = text + "\nAlso use `samples.tpcds_sf1.store_sales.ss_fake_margin` and `samples.tpcds_sf1.store_sales_v2`."
                assert inst._validate_genie_instruction_references(uc, poisoned, schema_index=None)[1][-2:] == [
                    "samples.tpcds_sf1.store_sales.ss_fake_margin", "samples.tpcds_sf1.store_sales_v2"]
                poison_checks += 1
    assert checked >= 15 and columns_known >= 300 and poison_checks >= 1
    assert flagged == []


def test_validator_accepts_objects_the_implementation_creates_and_code_variables(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction(
        f"Register the model as `{RESULT}_model`, stage features in `{RESULT}_features` keyed on `{RESULT}_features.customer_id`, "
        "then call df.write.format and model.feature_importances_.argsort before X_train.columns.tolist."
    )
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is True, bad


def test_validator_still_flags_a_different_table_in_the_output_schema(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction("Read history from `main.inspire.some_other_feature_table`.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is False and bad == ["main.inspire.some_other_feature_table"]


def test_validator_flags_tables_in_unknown_and_known_catalogs(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    text = long_instruction("Join bogus_cat.bogus_sch.made_up with main.sales.invented_table.")
    ok, bad = inst._validate_genie_instruction_references(make_uc(), text, schema_index=_index(inst))
    assert ok is False
    assert bad == ["bogus_cat.bogus_sch.made_up", "main.sales.invented_table"]


def test_validator_treats_known_catalog_namesakes_of_code_namespaces_as_tables(agent_ns):
    loader = FakeLoader(tables={"spark.core.events": [("event_id", "BIGINT", "")]}, relations={})
    inst = build_inspire(agent_ns, loader=loader)
    uc = make_uc(**{"Tables Involved": "spark.core.events", "Primary Table": "spark.core.events"})
    ok, bad = inst._validate_genie_instruction_references(uc, long_instruction("Use `spark.core.events` and `spark.core.ghost`."), schema_index=None)
    assert ok is False and bad == ["spark.core.ghost"]


def test_validator_records_the_verification_basis(agent_ns):
    live = build_inspire(agent_ns, loader=FakeLoader())
    uc = make_uc()
    live._validate_genie_instruction_references(uc, long_instruction(f"Use `{ORDERS}`."), schema_index=None)
    assert uc["genie_validation_basis"] == "live_metadata"

    weak = build_inspire(agent_ns, loader=None)
    uc = make_uc()
    ok, bad = weak._validate_genie_instruction_references(uc, long_instruction("Use bogus_cat.bogus_sch.x_table."), schema_index=None)
    assert uc["genie_validation_basis"] == "uc_declared" and ok is False

    blind = build_inspire(agent_ns, loader=None)
    uc = make_uc(**{"Tables Involved": "", "Primary Table": ""})
    ok, bad = blind._validate_genie_instruction_references(uc, long_instruction("Use cat.sch.any_table."), schema_index=None)
    assert uc["genie_validation_basis"] == "none" and ok is True


def test_schema_details_from_use_cases_come_from_live_metadata_not_uc_claims(agent_ns):
    inst = build_inspire(agent_ns, loader=FakeLoader())
    ucs = [make_uc(), make_uc("N01-U02", **{"Tables Involved": "main.sales.ghost_table"})]
    details = inst._build_schema_details_from_use_cases(ucs)
    columns = {(f"{d[0]}.{d[1]}.{d[2]}", d[3]) for d in details}
    assert (ORDERS, "amount") in columns and (CUSTOMERS, "segment") in columns
    assert not any(d[3] == "_placeholder" for d in details)
    assert not any("ghost_table" in d[2] for d in details)


def test_schema_details_build_a_metadata_only_loader_when_the_run_has_none(fresh_ns):
    created = []

    class RecordingLoader(FakeLoader):
        def __init__(self, catalogs, schemas, tables, logger, **kwargs):
            created.append({"catalogs": catalogs, "schemas": schemas, "tables": tables, **kwargs})
            super().__init__()

    fresh_ns["DataLoader"] = RecordingLoader
    inst = build_inspire(fresh_ns, loader=None)
    details = inst._build_schema_details_from_use_cases([make_uc()])
    assert created == [{"catalogs": "", "schemas": "", "tables": "", "enable_two_pass": False, "enable_column_sampling": False}]
    assert any(d[3] == "amount" for d in details)
    inst._build_schema_details_from_use_cases([make_uc()])
    assert len(created) == 1


def test_technique_guidance_is_registry_matched_never_defaulted(agent_ns):
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    inst = build_inspire(agent_ns, loader=FakeLoader())
    assert inst._compute_per_uc_genie_fields(make_uc(**{"Analytics Technique": "anomaly detection"}), [], None)[
        "technique_implementation_guidance"] == guidance["Anomaly Detection"]
    assert inst._compute_per_uc_genie_fields(make_uc(**{"Analytics Technique": ""}), [], None)["technique_implementation_guidance"] == ""
    assert inst._compute_per_uc_genie_fields(make_uc(**{"Analytics Technique": "Quantum Divination"}), [], None)[
        "technique_implementation_guidance"] == ""
    assert any("[TECHNIQUE_UNKNOWN]" in str(c) for c in inst.logger.warning.call_args_list)


def test_generation_prompt_carries_the_registry_matched_technique(agent_ns):
    agent = FakeAgent([long_instruction(f"Use `{ORDERS}`.")] * 2)
    inst = build_inspire(agent_ns, loader=FakeLoader(), agent=agent)
    inst._generate_genie_instruction_for_use_case(make_uc(**{"Analytics Technique": "anomaly detection"}), [], "")
    uc = make_uc()
    uc.pop("Analytics Technique")
    inst._generate_genie_instruction_for_use_case(uc, [], "")
    assert agent.calls[0]["vars"]["analytics_technique"] == "Anomaly Detection"
    assert agent.calls[1]["vars"]["analytics_technique"] == ""
    assert agent.calls[1]["vars"]["technique_implementation_guidance"] == ""


def test_generation_recomputes_stale_persisted_fields_when_live_metadata_is_reachable(agent_ns):
    agent = FakeAgent([long_instruction(f"Use `{ORDERS}`.")])
    inst = build_inspire(agent_ns, loader=FakeLoader(), agent=agent)
    uc = make_uc(_genie_fields_cached=True, directly_involved_schema="- `main.sales.orders` (tables only, persisted by v1.1.3)",
                 foreign_key_relationships="None", available_tables_listing="", technique_implementation_guidance="")
    inst._generate_genie_instruction_for_use_case(uc, [], "", schema_index=None)
    sent = agent.calls[0]["vars"]["directly_involved_schema"]
    assert "persisted by v1.1.3" not in sent and "order value" in sent


def test_generation_replays_persisted_fields_only_when_no_live_metadata_exists(agent_ns):
    agent = FakeAgent([long_instruction("Use the persisted schema.")])
    inst = build_inspire(agent_ns, loader=None, agent=agent)
    uc = make_uc(_genie_fields_cached=True, directly_involved_schema="persisted schema text",
                 foreign_key_relationships="persisted fks", available_tables_listing="persisted listing",
                 technique_implementation_guidance="persisted guidance")
    inst._generate_genie_instruction_for_use_case(uc, [], "", schema_index=None)
    sent = agent.calls[0]["vars"]
    assert sent["directly_involved_schema"] == "persisted schema text"
    assert sent["foreign_key_relationships"] == "persisted fks" and sent["available_tables_listing"] == "persisted listing"


def test_genie_prompt_cites_only_metadata_columns(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "you will inspect columns autonomously" not in prompt
    assert "Do NOT expand table columns or list schemas -- the implementer inspects schemas directly." not in prompt
    assert "the ONLY source columns you may cite" in prompt
    assert "An invented table or column name = FAILURE." in prompt
