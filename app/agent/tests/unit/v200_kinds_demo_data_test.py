import copy
import datetime
import json
import pathlib

import numpy as np
import pandas as pd
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT.parent
DEMO = APP / "dbx_generate_demo_data.py"
KINDS = ROOT / "agent" / "app_shell" / "kinds.json"


def _signal_cell():
    cells = DEMO.read_text().split("# COMMAND ----------")
    found = [c for c in cells if "def _kind_signal_frames(" in c]
    assert len(found) == 1, "one notebook cell defines the kind-signal generator"
    return found[0]


@pytest.fixture(scope="module")
def gen():
    ns = {}
    exec(compile(_signal_cell(), str(DEMO), "exec"), ns)
    return ns


@pytest.fixture(scope="module")
def registry():
    return json.loads(KINDS.read_text())


@pytest.fixture(scope="module")
def bundle(gen):
    return gen["_kind_signal_frames"]()


@pytest.fixture(scope="module")
def checks(gen, bundle):
    return gen["_kind_signal_checks"](bundle)


def _kind_ids():
    return [k["id"] for k in json.loads(KINDS.read_text())["kinds"]]


def test_the_generator_cell_needs_no_spark_to_build_and_check(gen):
    assert "spark" not in gen
    assert callable(gen["_kind_signal_frames"]) and callable(gen["_kind_signal_checks"])


def test_every_registry_kind_has_exactly_one_data_check(checks, registry):
    assert sorted(checks) == sorted(k["id"] for k in registry["kinds"])
    assert len(checks) == 40


@pytest.mark.parametrize("kind_id", _kind_ids())
def test_each_demo_signal_is_planted_and_passes_its_kind_check(checks, kind_id):
    result = checks[kind_id]
    assert result["ok"], f"{kind_id}: {result['detail']}"
    assert result["detail"]


@pytest.mark.parametrize("kind_id", _kind_ids())
def test_each_kind_has_enough_items_for_every_component_of_its_layout(checks, registry, kind_id):
    kind = next(k for k in registry["kinds"] if k["id"] == kind_id)
    layout = next(lay for lay in registry["layouts"] if lay["id"] == kind["layout"])
    need = max(layout["min_items"].values())
    assert checks[kind_id]["items"] >= need, f"{kind_id} on {kind['layout']}: {checks[kind_id]['items']} < {need}"


def test_the_layout_minimums_the_plan_names_are_met(bundle):
    t = {n: s["frame"] for n, s in bundle["tables"].items()}
    weeks = t["weekly_sales"]["week_start"].nunique()
    assert weeks >= 104 and weeks // 52 >= 2
    sales = t["weekly_sales"]
    levers = [c for c in ("unit_price", "promotion_active", "weekly_capacity_units") if sales[c].nunique() > 1]
    assert len(levers) >= 2
    assert set(t["customers"]["offer_variant"]) == {"treatment", "control"}
    first_promo = sales[sales["promotion_active"] == "Y"]["week_start"].min()
    assert (first_promo - sales["week_start"].min()).days >= 8 * 7
    assert t["case_events"]["step_name"].nunique() >= 3
    assert t["case_events"]["case_id"].notna().all() and t["case_events"]["event_at"].notna().all()
    assert t["sites"][["latitude", "longitude"]].notna().all().all()
    assert t["customers"][["latitude", "longitude"]].notna().all().all()
    assert len(t["account_links"]) >= 10 and len(t["site_transfers"]) >= 10
    assert t["cases"]["complaint_text"].str.len().min() > 10


def test_the_seed_makes_the_data_deterministic(gen):
    first = gen["_kind_signal_frames"](7)
    again = gen["_kind_signal_frames"](7)
    other = gen["_kind_signal_frames"](8)
    for name in first["tables"]:
        pd.testing.assert_frame_equal(first["tables"][name]["frame"], again["tables"][name]["frame"])
    assert not first["tables"]["weekly_sales"]["frame"].equals(other["tables"]["weekly_sales"]["frame"])
    assert gen["KIND_SIGNAL_SEED"] == 1400


def _breaks(bundle, name, fn):
    broken = copy.deepcopy(bundle)
    broken["tables"][name]["frame"] = fn(broken["tables"][name]["frame"].copy())
    return broken


def _no_shift(frame):
    frame["fill_volume_ml"] = np.random.default_rng(0).normal(500, 2, len(frame)).round(2)
    return frame


def _one_reason(frame):
    frame["complaint_text"] = "The delivery arrived late again."
    return frame


def _no_rings(frame):
    return frame[frame["link_type"] != "shared_device"]


def _flat_plan(frame):
    frame["plan_revenue_amount"] = frame["revenue_amount"]
    return frame


def _no_promos(frame):
    frame["promotion_active"] = "N"
    return frame


def _clean_controls(frame):
    frame = frame.drop_duplicates(["invoice_id", "payment_date", "paid_amount", "created_by"]).copy()
    same = frame["created_by"] == frame["approved_by"]
    frame.loc[same, "approved_by"] = "Clerk 99"
    return frame


def _all_on_time(frame):
    frame["due_at"] = frame["created_at"] + pd.Timedelta(days=3650)
    return frame


def _no_duplicates(frame):
    return frame[~frame["street_address"].str.endswith(" St")]


def _blank_comment(spec_bundle):
    broken = copy.deepcopy(spec_bundle)
    broken["tables"]["orders"]["columns"]["freight_cost"] = ""
    return broken


def _flat_units(frame):
    frame["units_sold"] = 100
    frame["revenue_amount"] = (frame["unit_price"] * 100).round(2)
    return frame


def _always_stocked(frame):
    frame["on_hand_units"] = frame["on_hand_units"].clip(lower=5)
    return frame


def _random_treatment(frame):
    frame["offer_outcome"] = np.where(np.random.default_rng(1).uniform(0, 1, len(frame)) < 0.12, "accepted", "declined")
    return frame


def _no_hub(frame):
    rng = np.random.default_rng(3)
    frame["from_site_id"] = rng.integers(1, 31, len(frame))
    frame["to_site_id"] = (frame["from_site_id"] + rng.integers(1, 30, len(frame)) - 1) % 30 + 1
    return frame


BREAKS = [
    ("process_control", "measurements", _no_shift),
    ("reason_codes", "cases", _one_reason),
    ("fraud_rings", "account_links", _no_rings),
    ("variance_to_plan", "weekly_sales", _flat_plan),
    ("promotion_lift", "weekly_sales", _no_promos),
    ("controls_testing", "payments", _clean_controls),
    ("sla_aging", "cases", _all_on_time),
    ("entity_matching", "customers", _no_duplicates),
    ("forecast", "weekly_sales", _flat_units),
    ("inventory_replenishment", "weekly_sales", _always_stocked),
    ("experiment_readout", "customers", _random_treatment),
    ("uplift_targeting", "customers", _random_treatment),
    ("network_dependency", "site_transfers", _no_hub),
]


@pytest.mark.parametrize("kind_id,table,fn", BREAKS, ids=[b[0] for b in BREAKS])
def test_a_check_fails_when_its_signal_is_removed(gen, bundle, kind_id, table, fn):
    result = gen["_kind_signal_checks"](_breaks(bundle, table, fn))[kind_id]
    assert not result["ok"], f"{kind_id} still passes without its signal: {result['detail']}"


def test_leakage_check_fails_when_bank_and_ledger_agree(gen, bundle):
    broken = copy.deepcopy(bundle)
    pay = broken["tables"]["payments"]["frame"]
    inv = broken["tables"]["invoices"]["frame"].set_index("invoice_id")
    pay["paid_amount"] = pay["invoice_id"].map(inv["amount_paid"])
    assert not gen["_kind_signal_checks"](broken)["leakage_reconciliation"]["ok"]


def test_data_agent_check_fails_on_a_missing_column_comment_or_a_dangling_key(gen, bundle):
    assert not gen["_kind_signal_checks"](_blank_comment(bundle))["data_agent"]["ok"]
    broken = copy.deepcopy(bundle)
    broken["tables"]["orders"]["frame"].loc[0, "site_id"] = 999
    assert not gen["_kind_signal_checks"](broken)["data_agent"]["ok"]


def _sql_type(series):
    if pd.api.types.is_integer_dtype(series):
        return "BIGINT"
    if pd.api.types.is_float_dtype(series):
        return "DOUBLE"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "TIMESTAMP"
    if isinstance(series.dropna().iloc[0], datetime.date):
        return "DATE"
    return "STRING"


def _table_roles(agent_ns, spec):
    cols = {c: _sql_type(spec["frame"][c]) for c in spec["frame"].columns}
    fks = {c: f"demo.core.core_{target}" for c, target in spec["fks"].items()}
    return agent_ns["DatabricksInspire"]._column_signals(cols, spec["columns"], fks, None)["roles"]


def _signature_met(signature, roles, fks):
    have = {role: list(cols) for role, cols in roles.items() if cols}
    if any(role not in have for role in signature["roles_all"]):
        return False
    if signature["roles_any"] and not any(role in have for role in signature["roles_any"]):
        return False
    if any(len(have.get(role, [])) < n for role, n in signature["min_counts"].items()):
        return False
    if signature["fk_pattern"] == "fact_to_dim" and not fks:
        return False
    if signature["fk_pattern"] == "edge_pair" and not have.get("edge_pair"):
        return False
    return True


@pytest.fixture(scope="module")
def table_roles(agent_ns, bundle):
    return {name: _table_roles(agent_ns, spec) for name, spec in bundle["tables"].items()}


@pytest.mark.parametrize("kind_id", _kind_ids())
def test_each_kind_signature_is_met_on_one_demo_table(registry, bundle, table_roles, kind_id):
    signature = next(k for k in registry["kinds"] if k["id"] == kind_id)["signature"]
    anchors = [name for name, roles in table_roles.items()
               if _signature_met(signature, roles, bundle["tables"][name]["fks"])]
    assert anchors, f"no demo table carries the column roles of {kind_id}: {signature}"


def test_the_signature_probe_rejects_a_table_without_the_roles(registry, bundle, table_roles):
    by_id = {k["id"]: k["signature"] for k in registry["kinds"]}
    assert not _signature_met(by_id["marketing_mix"], table_roles["sites"], bundle["tables"]["sites"]["fks"])
    assert not _signature_met(by_id["fraud_rings"], table_roles["orders"], bundle["tables"]["orders"]["fks"])
    assert not _signature_met(by_id["peer_benchmarking"], table_roles["marketing_weekly"], {})
    assert _signature_met(by_id["marketing_mix"], table_roles["marketing_weekly"], {})


def test_the_pipeline_writes_the_signal_tables_unless_the_user_switches_them_off():
    source = DEMO.read_text()
    main = source.split("# COMMAND ----------")
    flow = next(c for c in main if "_call_foundation_model(user_description" in c and "exec(code_str" in c)
    assert "if plant_kind_signals:" in flow and "_plant_kind_signals(inspire_catalog, demo_schema, tables)" in flow
    assert flow.index("_plant_kind_signals(") < flow.index("_apply_uc_table_metadata(table_metadata, tables)")
    assert flow.index("_plant_kind_signals(") < flow.index("_verify_tables_for_inspire(tables)")
    assert 'dbutils.widgets.text("plant_kind_signals", "yes"' in source
    assert "[DEMO-SIGNAL FIRED] skipped" in flow


class _Writer:
    def __init__(self, log, frame):
        self.log, self.frame = log, frame

    def mode(self, value):
        self.log.append(("mode", value))
        return self

    def option(self, key, value):
        self.log.append(("option", key, value))
        return self

    def saveAsTable(self, name):
        self.log.append(("save", name, len(self.frame)))


class _Frame:
    def __init__(self, log, frame):
        self.write = _Writer(log, frame)


class _Spark:
    def __init__(self):
        self.log = []

    def createDataFrame(self, frame):
        return _Frame(self.log, frame)

    def sql(self, text):
        self.log.append(("sql", text))


def test_plant_writes_every_table_with_keys_and_returns_metadata_for_the_comment_step(gen):
    ns = {}
    exec(compile(_signal_cell(), str(DEMO), "exec"), ns)
    spark = _Spark()
    ns["spark"] = spark
    fqns, metadata = ns["_plant_kind_signals"]("cat-1", "demo", ["cat-1.demo.llm_table_1"])
    assert len(fqns) == 13 and all(f.startswith("cat-1.demo.core_") for f in fqns)
    saved = [entry[1] for entry in spark.log if entry[0] == "save"]
    assert saved == ["`" + "`.`".join(f.split(".")) + "`" for f in fqns]
    sql = [entry[1] for entry in spark.log if entry[0] == "sql"]
    assert sum("PRIMARY KEY (" in s for s in sql) == 11
    assert sum("FOREIGN KEY (" in s for s in sql) == 15
    assert all("DROP PRIMARY KEY IF EXISTS CASCADE" in s for s in sql[:11])
    assert [m["fqn"] for m in metadata] == fqns and all(m["description"] and m["columns"] for m in metadata)


def test_plant_refuses_to_overwrite_a_generated_table_with_the_same_name(gen):
    ns = {}
    exec(compile(_signal_cell(), str(DEMO), "exec"), ns)
    ns["spark"] = _Spark()
    with pytest.raises(RuntimeError, match="already use the signal table names"):
        ns["_plant_kind_signals"]("c", "s", ["c.s.core_orders"])


def test_plant_stops_before_writing_when_a_signal_check_fails(gen):
    ns = {}
    exec(compile(_signal_cell(), str(DEMO), "exec"), ns)
    spark = _Spark()
    ns["spark"] = spark
    good = ns["_kind_signal_checks"]

    def failing(bundle):
        out = good(bundle)
        out["anomaly"] = {"ok": False, "detail": "no jumps", "items": 0}
        return out
    ns["_kind_signal_checks"] = failing
    with pytest.raises(RuntimeError, match="anomaly"):
        ns["_plant_kind_signals"]("c", "s", [])
    assert not [e for e in spark.log if e[0] == "save"]


def test_the_backend_copy_and_the_bundle_match_the_app_notebook():
    import base64
    assert (APP / "backend" / "dbx_generate_demo_data.py").read_text() == DEMO.read_text()
    bundle_js = (APP / "backend" / "demo_notebook_bundle.js").read_text()
    payload = json.loads(bundle_js.removeprefix("module.exports = ").rstrip().rstrip(";"))
    assert base64.b64decode(payload).decode() == DEMO.read_text()
