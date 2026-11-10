import types

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import _inspire, _spec
from v232_protected_sources_test import MASK, OWN, RESULT, SOURCE, SUMMARY, _CatalogSpark, _table

APP = "app-x1y2z3 sample-app"
DENIED = f"Principal '{APP}' does not have READ METADATA on Table {SOURCE}"
GRANT = f"GRANT READ METADATA ON TABLE `main`.`s`.`orders_v2` TO `{APP}`"


def _rows(principal, privilege, mine):
    return [{"level": "table", "privilege": privilege, "principal": principal, "mine": mine, "me": "builder@example.com"}]


def _gate(ns, *, api, rows):
    spark = _CatalogSpark({SOURCE: _table(["owner", "ssn", "region"], filters=[(OWN, "owner")], masks=[("ssn", MASK, "region")]),
                           RESULT: _table(["owner", "ssn", "region"]), SUMMARY: _table(["tier", "n"])})
    inst = _inspire(ns, spark)
    inst.logger = CapturingLogger()
    inst.w_client = types.SimpleNamespace(current_user=types.SimpleNamespace(
        me=lambda: types.SimpleNamespace(user_name=APP)))
    inst._implement_principal = lambda: APP
    inst._implement_abac = lambda table, warnings, denied=None: type(inst)._implement_abac(inst, table, warnings, denied)
    inst._implement_access_rows = lambda table, warnings=None: rows
    inst._implement_api = api
    inst._genie_involved_tables = lambda use_case: ["main.s.orders"]
    inst._implement_notebook_cells_text = lambda path: ""
    inst._implement_retried = lambda fn, label: fn()
    inst.updates = []
    inst._implement_update = lambda key, **kw: inst.updates.append(kw)
    spec = _spec(ns)[0]
    spec["outputs"].update({"app_access": "user"})
    context = {"spec": spec, "key": (5150, "N01-U01", 2), "use_case": {}, "asset_status": {}, "result_table": RESULT,
               "summary_table": SUMMARY, "allowed": [RESULT, SUMMARY, SOURCE]}
    return inst, context


def _denies_source(method, path, body=None, query=None):
    if "orders_v2" in path and "policies" in path:
        raise RuntimeError(DENIED)
    return {}


def test_a_service_principal_denied_the_abac_read_is_refused_with_its_name_and_the_grant_not_a_row_leak_claim(agent_ns):
    rows = _rows("owner@example.com", "OWNER", False)
    inst, context = _gate(agent_ns, api=_denies_source, rows=rows)
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_protection_gate(context, [])
    reason = str(stop.value)
    assert reason.startswith(f"Inspire did not publish. The App's service principal {APP} cannot read the access policies of {SOURCE}")
    assert f"owner@example.com or a manager of {SOURCE} runs `{GRANT}`" in reason
    assert "would show rows" not in reason
    assert context["asset_status"]["protection"]["check"] is True
    assert "does not have READ METADATA" in context["asset_status"]["protection"]["details"]
    assert not any(s.startswith("GRANT") for s in inst.spark.statements)


def test_a_manager_builder_grants_read_metadata_on_the_source_and_the_read_then_passes(agent_ns):
    rows = _rows("builder@example.com", "MANAGE", True)
    state = {"granted": False}

    def api(method, path, body=None, query=None):
        if "orders_v2" in path and "policies" in path and not state["granted"]:
            raise RuntimeError(DENIED)
        return {}

    inst, context = _gate(agent_ns, api=api, rows=rows)
    original = inst.spark.sql

    def spark_sql(statement, args=None):
        if statement == GRANT:
            state["granted"] = True
        return original(statement, args)

    inst.spark.sql = spark_sql
    warnings = []
    read = inst._implement_protections([SOURCE], warnings)
    assert GRANT in inst.spark.statements
    assert "unread" not in read[SOURCE] and warnings == []


def test_a_builder_who_cannot_manage_the_source_never_grants_read_metadata(agent_ns):
    rows = _rows("owner@example.com", "OWNER", False)
    inst, _context = _gate(agent_ns, api=lambda *a, **k: (_ for _ in ()).throw(RuntimeError(DENIED)), rows=rows)
    read = inst._implement_protections([SOURCE], [])
    assert not any(s.startswith("GRANT") for s in inst.spark.statements)
    denied = read[SOURCE]["denied"]
    assert (denied["table"], denied["principal"], denied["statement"], denied["owner"]) == (SOURCE, APP, GRANT, "owner@example.com")


def test_an_unreadable_source_that_is_not_a_permission_problem_is_still_refused_and_never_granted(agent_ns):
    rows = _rows("builder@example.com", "MANAGE", True)
    inst, context = _gate(agent_ns, api=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("socket closed by peer")), rows=rows)
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_protection_gate(context, [])
    reason = str(stop.value)
    assert reason.startswith("Inspire did not publish. Inspire could not read the row filters, column masks and ABAC policies of")
    assert "service principal" not in reason and "would show rows" not in reason
    assert not any(s.startswith("GRANT") for s in inst.spark.statements)


def test_a_principal_who_already_holds_manage_satisfies_the_read_metadata_need(agent_ns):
    rows = _rows(APP, "MANAGE", False)
    plan = agent_ns["implement_access_plan"](SOURCE, rows, APP, (agent_ns["IMPLEMENT_ABAC_READ_NEED"],))
    assert plan["grants"] == [] and plan["gaps"] == []


def test_the_app_read_grants_include_read_metadata_on_the_source_tables(agent_ns):
    rows = [{"level": "table", "privilege": "OWNER", "principal": "owner@example.com", "mine": False, "me": "builder@example.com"},
            {"level": "table", "privilege": "MANAGE", "principal": "builder@example.com", "mine": True, "me": "builder@example.com"},
            {"level": "schema", "privilege": "MANAGE", "principal": "builder@example.com", "mine": True, "me": "builder@example.com"},
            {"level": "catalog", "privilege": "MANAGE", "principal": "builder@example.com", "mine": True, "me": "builder@example.com"}]
    inst, _context = _gate(agent_ns, api=lambda *a, **k: {}, rows=rows)
    ran = []
    unread = inst._implement_app_read_grants([SOURCE, RESULT], {SOURCE: rows, RESULT: rows}, "client-7", ran, sources=[SOURCE])
    assert unread == {}
    assert "GRANT READ METADATA ON TABLE `main`.`s`.`orders_v2` TO `client-7`" in inst.spark.statements
    assert not any("READ METADATA" in s and "churn_out" in s for s in inst.spark.statements), "a result table gets no ABAC read (must-exclude)"
    assert any(r["privilege"] == "READ METADATA" and r["table"] == SOURCE for r in ran)


def test_the_refusal_names_the_unread_table_without_claiming_rows_are_hidden(agent_ns):
    plan = {"apply": [], "refuse": [], "blocked": [], "unread": [
        f"The App's service principal {APP} cannot read the access policies of {SOURCE}, so Inspire cannot tell whether the results keep them"],
        "grant": []}
    reason = agent_ns["implement_protection_refusal"](plan)
    assert "would show rows" not in reason and "Press Check again" in reason
