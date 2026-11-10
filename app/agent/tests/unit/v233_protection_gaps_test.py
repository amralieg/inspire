import json
import os
import sys
import types

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import READS, SHELL_FILES, _deploy_inspire, _not_access_reads, sdk_stub  # noqa: F401
from v142_look_test import DEPLOYED, NEW_APP, _user_context
from v232_protected_sources_test import MASK, OWN, RESULT, SOURCE, SUMMARY, _gate, _plan, _protection, _source, _table

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402

VIEW = "main.s.orders_view"
BOUND_FILTER = "ALTER TABLE `main`.`inspire`.`churn_out` SET ROW FILTER main.sec.own_rows ON (`owner`)"


def _view_api(dependencies, calls=None):
    def api(method, path, body=None, query=None):
        if calls is not None:
            calls.append(path)
        if path.startswith("/api/2.1/unity-catalog/tables/"):
            name = path.rsplit("/", 1)[-1]
            if isinstance(dependencies.get(name), Exception):
                raise dependencies[name]
            return {"view_dependencies": {"dependencies": [{"table": {"table_full_name": t}} for t in dependencies.get(name, [])]}}
        return {}
    return api


def test_a_failed_protection_read_counts_as_protected_so_a_service_principal_app_is_refused(agent_ns):
    inst, context = _gate(agent_ns, ["owner"], outputs={"app_access": "sp"})
    inst.spark.sql = lambda statement, args=None: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no USE CATALOG"))
    warnings = []
    read = inst._implement_protections([SOURCE], warnings)
    assert read[SOURCE]["unread"].startswith("PERMISSION_DENIED") and agent_ns["implement_is_protected"](read[SOURCE])
    assert warnings[0].startswith("Sharing: Inspire could not read the row filters and column masks of a table")
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_source_protection(context["key"], context["spec"], context["use_case"], context["asset_status"], [])
    assert "cannot read through its service principal" in str(stop.value)
    assert "The App reads 1 protected source table" in str(stop.value)


def test_an_unreadable_abac_policy_list_counts_as_protected_but_a_workspace_without_abac_does_not(agent_ns):
    inst, _context = _gate(agent_ns, ["owner"])
    inst._implement_abac = types.MethodType(type(inst)._implement_abac, inst)
    inst.spark.tables["main.s.plain"] = _table(["owner"])
    inst._implement_api = lambda method, path, body=None, query=None: (_ for _ in ()).throw(RuntimeError("INTERNAL_ERROR: boom"))
    warnings = []
    plain = inst._implement_protections(["main.s.plain"], warnings)["main.s.plain"]
    assert plain["unread"] == "its ABAC policies could not be read" and agent_ns["implement_is_protected"](plain)
    inst._implement_api = lambda method, path, body=None, query=None: (_ for _ in ()).throw(RuntimeError("FEATURE_DISABLED: abac"))
    assert not agent_ns["implement_is_protected"](inst._implement_protections(["main.s.plain"], [])["main.s.plain"])


def test_a_view_source_carries_the_filter_and_mask_of_the_table_it_reads(agent_ns):
    inst, context = _gate(agent_ns, ["owner"], outputs={"app_access": "sp"})
    inst.spark.tables[VIEW] = _table(["owner", "ssn", "region"], view=True)
    calls = []
    inst._implement_api = _view_api({VIEW: [SOURCE]}, calls)
    inst.logger = CapturingLogger()
    read = inst._implement_protections([VIEW], [])[VIEW]
    assert read["row_filters"] == [{"function": OWN, "columns": ["owner"]}] and set(read["masks"]) == {"ssn"}
    assert f"/api/2.1/unity-catalog/tables/{VIEW}" in calls
    assert any("[IMPLEMENT-PROTECTION-VIEW FIRED]" in m for _, m in inst.logger.records)
    inst._genie_involved_tables = lambda use_case: [VIEW]
    with pytest.raises(agent_ns["ImplementStopped"]):
        inst._implement_source_protection(context["key"], context["spec"], context["use_case"], context["asset_status"], [])
    plan = _plan(agent_ns)({VIEW: read}, {RESULT: _protection(agent_ns, ["owner", "value"])})
    assert plan["apply"] == [BOUND_FILTER]


def test_a_view_over_an_unprotected_table_stays_unprotected(agent_ns):
    inst, _context = _gate(agent_ns, ["owner"])
    inst.spark.tables[VIEW] = _table(["owner"], view=True)
    inst.spark.tables["main.s.plain"] = _table(["owner"])
    inst._implement_api = _view_api({VIEW: ["main.s.plain"]})
    assert not agent_ns["implement_is_protected"](inst._implement_protections([VIEW], [])[VIEW])


def test_a_view_whose_tables_cannot_be_read_or_that_reads_itself_counts_as_protected(agent_ns):
    inst, _context = _gate(agent_ns, ["owner"])
    inst.spark.tables[VIEW] = _table(["owner"], view=True)
    inst._implement_api = _view_api({VIEW: RuntimeError("PERMISSION_DENIED")})
    warnings = []
    read = inst._implement_protections([VIEW], warnings)[VIEW]
    assert read["unread"] == "the tables the view reads could not be read" and warnings
    inst._implement_api = _view_api({VIEW: [VIEW]})
    looped = inst._implement_protections([VIEW], [])[VIEW]
    assert "reads views more than 4 deep or reads itself" in looped["unread"]


def test_the_plan_refuses_a_source_or_result_whose_protection_could_not_be_read(agent_ns):
    unread = agent_ns["implement_protection_unread"]("PERMISSION_DENIED")
    plan = _plan(agent_ns)({SOURCE: unread}, {RESULT: _protection(agent_ns, ["owner"])})
    assert plan["unread"] == ["Inspire could not read the row filters, column masks and ABAC policies of a source table (PERMISSION_DENIED), "
                              "so it cannot tell that the results keep them"] and plan["refuse"] == []
    plan = _plan(agent_ns)(_source(agent_ns), {RESULT: unread})
    assert plan["unread"] == ["Inspire could not read the row filters and column masks of a result table (PERMISSION_DENIED), so it cannot "
                              "tell that it keeps those of its sources"] and plan["apply"] == [] and plan["refuse"] == []


def test_the_gate_refuses_when_a_result_cannot_be_read_again_after_binding(agent_ns):
    inst, context = _gate(agent_ns, ["owner", "ssn", "region"])
    real = inst.spark.sql

    def sql(statement, args=None):
        if args and args.get("t") == "churn_out" and any(s.startswith("ALTER") for s in inst.spark.statements):
            raise RuntimeError("TEMPORARILY_UNAVAILABLE")
        return real(statement, args)

    inst.spark.sql = sql
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_protection_gate(context, [])
    assert "could not read the row filters and column masks of a result table" in str(stop.value)


def test_a_passed_gate_keeps_a_record_of_the_blocked_totals_and_every_protection(agent_ns):
    inst, context = _gate(agent_ns, ["owner", "ssn", "region", "value"])
    inst._implement_protection_gate(context, [])
    record = context["asset_status"]["protection"]
    assert record == {"state": "kept", "spec_version": 2, "blocked": [SUMMARY],
                      "protected": {RESULT: "a row filter and a column mask on ssn", SOURCE: "a row filter and a column mask on ssn"}}
    assert set(context["protection"]) == {SOURCE, RESULT, SUMMARY}


def test_genie_hides_sampled_values_of_masked_columns_and_row_filtered_tables(agent_ns):
    hidden = agent_ns["implement_protected_columns"]
    assert hidden(_protection(agent_ns, ["owner"], filters=[(OWN, "owner")])) == {"*"}
    assert hidden(_protection(agent_ns, ["ssn", "city"], masks=[("ssn", MASK, None)])) == {"ssn"}
    assert hidden(_protection(agent_ns, ["a"], policies=[{"name": "p", "kind": "column_mask"}])) == {"*"}
    assert hidden(_protection(agent_ns, ["city"])) == set()
    known = {"city": ("city", "string", "City"), "region": ("region", "string", "Region")}

    def configs(hide):
        table = {"identifier": "main.s.t", "column_configs": [{"column_name": "city"}, {"column_name": "region"}]}
        agent_ns["_implement_genie_column_configs"](table, known, False, (), [5], hide)
        return {c["column_name"]: (c["enable_format_assistance"], c["enable_entity_matching"]) for c in table["column_configs"]}

    assert configs(()) == {"city": (True, True), "region": (True, True)}, "unprotected columns keep Genie's sampled values"
    shown = configs({"region"})
    assert shown["region"] == (False, False) and shown["city"] == (True, True)
    assert set(configs({"*"}).values()) == {(False, False)}


def test_totals_over_row_filtered_sources_leave_the_dashboard_genie_prompt_and_history(agent_ns):
    unblocked = agent_ns["implement_unblocked"]
    context = {"blocked": ["`main`.`inspire`.`Churn_Summary`"]}
    assert unblocked(context, SUMMARY) == "" and unblocked(context, RESULT) == RESULT and unblocked({}, SUMMARY) == SUMMARY
    assert unblocked(context, "") == ""
    inst, _context = _gate(agent_ns, ["owner"])
    shell_sql = types.SimpleNamespace(history_layout=lambda properties, columns: {"log": properties})
    log = agent_ns["inspire_run_log_table"](RESULT)
    inst.spark.sql = lambda statement, args=None: (_ for _ in ()).throw(AssertionError(f"read {statement}"))
    assert inst._implement_history_layout(RESULT, shell_sql, [log]) is None


def test_an_alert_over_protected_tables_is_refused_and_one_over_plain_tables_is_not(agent_ns):
    inst, context = _gate(agent_ns, ["owner"])
    inst.logger = CapturingLogger()
    context.update(uc_id="N01-U01", protected={SOURCE: "a row filter"})
    with pytest.raises(agent_ns["ImplementBlocked"]) as stop:
        inst._implement_alert(context, None)
    assert str(stop.value).startswith(f"the alert reads {SOURCE} (a row filter), and Databricks checks an alert as its owner")
    assert any("[IMPLEMENT-PROTECTED-ALERT FIRED]" in m for _, m in inst.logger.records)
    context["protected"] = {}
    with pytest.raises(agent_ns["ImplementBlocked"]) as plain:
        inst._implement_alert(context, None)
    assert "the use case has no job yet" in str(plain.value)


def _decided_deploy(agent_ns, protected):
    created = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
    read = dict(created, user_api_scopes=["sql:restricted-query", "genie"])
    inst, context, calls, _imported = _deploy_inspire(agent_ns, NEW_APP + [created, read] + DEPLOYED, access=[])
    inst.logger = CapturingLogger()
    context = _user_context(agent_ns, context, decisions=True)
    context["protected"] = protected
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, "g1", poll_s=0)
    return inst, fields


def test_a_per_user_app_over_a_protected_result_gives_its_service_principal_no_grant_and_people_write_as_themselves(agent_ns, sdk_stub):
    inst, _fields = _decided_deploy(agent_ns, {})
    assert any("TO `sp-1`" in s for s in _not_access_reads(inst.spark.statements)), "decisions on a plain table are written by the App"
    inst, fields = _decided_deploy(agent_ns, {RESULT: "a row filter"})
    assert not any("TO `sp-1`" in s for s in _not_access_reads(inst.spark.statements))
    assert any(w.startswith(f"App: each person records decisions on {RESULT} as themselves") for w in fields.get("_warnings") or [])
    assert any("[IMPLEMENT-PROTECTED-WRITER FIRED]" in m for _, m in inst.logger.records)


def test_the_shell_writes_decisions_as_the_viewer_when_the_app_reads_protected_tables():
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.inside, shell.writer_factory, shell._writer, shell._sp = False, None, None, None
    shell.sp_factory = lambda: "service-principal"
    shell.settings = {"auth": "user"}
    assert shell.decision_writer("viewer") == "service-principal"
    shell.settings = {"auth": "user", "protected": {SOURCE: "a row filter"}}
    assert shell.decision_writer("viewer") == "viewer"
    refused = shell.write_refused("main.inspire.churn_out", "PERMISSION_DENIED", as_app=True)
    assert "you may not change main.inspire.churn_out" in refused.message and "service principal" not in refused.message
