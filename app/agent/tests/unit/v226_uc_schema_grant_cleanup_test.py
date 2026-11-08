"""Deleting a use case's App takes back the grants Inspire gave the App's service principal on that use case's own schema, and only
those: a grant Inspire did not make stays, the schema and its data stay, a principal or schema already gone is nothing to take back,
a refused revoke is one clear line and never fails the delete, and two use cases touch nothing of each other's."""
import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _delete_app_inspire

KEY = (5150, "N01-U01", 3)
OURS = {"description": "Inspire use case N01-U01 (session 5150): Predict churn"}


def _own(ns, uc="N01-U01", sid=5150):
    (catalog, schema), *_ = sorted(ns["implement_own_schemas"](uc, "Acme", sid, "main.inspire"))
    assert ns["compute_result_table_name"](uc, "", "", "main.inspire", session_id=sid, business_name="Acme").startswith(f"`{catalog}`.`{schema}`.")
    return f"`{catalog}`.`{schema}`", f"{catalog}.{schema}"


def _schema_grant(obj, plain, privilege):
    return {"privilege": privilege, "level": "schema", "object": obj, "table": f"{plain}.churn_results"}


def _table_grant(table, privilege="SELECT"):
    parts = table.split(".")
    return {"privilege": privilege, "level": "table", "object": ".".join(f"`{p}`" for p in parts), "table": table}


def _record(sql, sp="sp-7"):
    return {"people": [], "service_principal": {"name": sp, "sql": sql, "genie": []}}


class _Logged:
    def __init__(self):
        self.lines = []

    def __getattr__(self, level):
        return lambda message, *a, **k: self.lines.append((level, str(message)))


def _deleter(ns, responder=None, app=OURS):
    inst = _delete_app_inspire(ns, app)
    assert inst.business_name == "Acme" and inst.inspire_database == "main.inspire"
    inst.spark = FakeSpark(responder)
    inst.logger = _Logged()
    return inst


def _revokes(inst):
    return [s for s in inst.spark.statements if s.startswith("REVOKE")]


def test_deleting_the_app_takes_back_the_grants_inspire_gave_on_its_own_schema_and_keeps_the_schema(agent_ns):
    obj, plain = _own(agent_ns)
    inst = _deleter(agent_ns)
    sql = [_schema_grant(obj, plain, p) for p in ("USE SCHEMA", "SELECT", "MODIFY")] + [_table_grant(f"{plain}.churn_results_plans", "MODIFY")]
    outcome = inst._implement_delete_output("app", "churn-desk", KEY, grants=_record(sql))
    assert _revokes(inst) == [f"REVOKE USE SCHEMA ON SCHEMA {obj} FROM `sp-7`", f"REVOKE SELECT ON SCHEMA {obj} FROM `sp-7`",
                              f"REVOKE MODIFY ON SCHEMA {obj} FROM `sp-7`",
                              f"REVOKE MODIFY ON TABLE {obj}.`churn_results_plans` FROM `sp-7`"]
    assert not [s for s in inst.spark.statements if s.startswith(("DROP", "DELETE", "TRUNCATE"))], "the schema and its data stay"
    assert inst.calls == [("GET", "/api/2.0/apps/churn-desk"), ("DELETE", "/api/2.0/apps/churn-desk")]
    assert outcome["warnings"] == [] and outcome["refused"] is False and outcome["grants_left"] is None
    assert any("[IMPLEMENT-DELETE-GRANTS FIRED]" in line for _level, line in inst.logger.lines)


def test_a_grant_inspire_did_not_make_and_one_outside_the_own_schema_are_never_revoked(agent_ns):
    obj, plain = _own(agent_ns)
    inst = _deleter(agent_ns)
    sql = [_schema_grant(obj, plain, "SELECT"), _table_grant("main.sales.orders"),
           {"privilege": "USE CATALOG", "level": "catalog", "object": "`main`", "table": f"{plain}.churn_results"}]
    inst._implement_delete_output("app", "churn-desk", KEY, grants=_record(sql))
    assert _revokes(inst) == [f"REVOKE SELECT ON SCHEMA {obj} FROM `sp-7`"], \
        "USE SCHEMA and MODIFY the principal already held are not in the record, so they stay; a source table and the catalog are not this schema"
    bare = _deleter(agent_ns)
    assert bare._implement_delete_output("app", "churn-desk", KEY, grants={"people": []})["warnings"] == []
    assert _revokes(bare) == [], "an App built by an older Inspire kept no record, so nothing is taken back"


def test_a_principal_or_schema_already_gone_is_nothing_to_take_back(agent_ns):
    obj, plain = _own(agent_ns)

    def gone(statement):
        if statement.startswith("REVOKE USE SCHEMA"):
            raise RuntimeError("[PRINCIPAL_DOES_NOT_EXIST] Could not find principal with name sp-7.")
        if statement.startswith("REVOKE SELECT"):
            raise RuntimeError(f"[SCHEMA_NOT_FOUND] The schema {obj} cannot be found. Verify the spelling. SQLSTATE: 42704")
        return None
    inst = _deleter(agent_ns, gone)
    sql = [_schema_grant(obj, plain, p) for p in ("USE SCHEMA", "SELECT", "MODIFY")]
    outcome = inst._implement_delete_output("app", "churn-desk", KEY, grants=_record(sql))
    assert len(_revokes(inst)) == 3 and outcome["warnings"] == [] and outcome["grants_left"] is None
    assert ("DELETE", "/api/2.0/apps/churn-desk") in inst.calls
    assert not [line for level, line in inst.logger.lines if level == "warning" and "GRANTS" in line]


def test_an_app_already_deleted_still_has_its_grants_taken_back(agent_ns):
    obj, plain = _own(agent_ns)
    inst = _deleter(agent_ns, app=None)
    outcome = inst._implement_delete_output("app", "churn-desk", KEY, grants=_record([_schema_grant(obj, plain, "MODIFY")]))
    assert _revokes(inst) == [f"REVOKE MODIFY ON SCHEMA {obj} FROM `sp-7`"] and outcome["warnings"] == []
    assert inst.calls == [("GET", "/api/2.0/apps/churn-desk")]


def test_a_revoke_refused_on_permission_is_one_clear_line_and_the_app_is_still_deleted(agent_ns):
    obj, plain = _own(agent_ns)

    def denied(statement):
        if statement.startswith("REVOKE MODIFY"):
            raise RuntimeError("[PERMISSION_DENIED] User does not have MANAGE on Schema 'main._inspire_x'.")
        return None
    inst = _deleter(agent_ns, denied)
    sql = [_schema_grant(obj, plain, p) for p in ("SELECT", "MODIFY")]
    outcome = inst._implement_delete_output("app", "churn-desk", KEY, grants=_record(sql))
    assert ("DELETE", "/api/2.0/apps/churn-desk") in inst.calls and outcome["refused"] is False and outcome["state"] == "deleted"
    assert outcome["warnings"] == [f"App: REVOKE MODIFY ON SCHEMA {obj} FROM `sp-7` failed, so the App's service principal may still use "
                                   f"the schema {obj}: [PERMISSION_DENIED] User does not have MANAGE on Schema 'main._inspire_x'."]
    warned = [line for level, line in inst.logger.lines if level == "warning" and "GRANTS" in line]
    assert len(warned) == 1 and warned[0].startswith("[IMPLEMENT-DELETE-GRANTS FIRED] N01-U01: the App churn-desk is deleted, but")
    assert outcome["grants_left"] == {"service_principal": {"name": "sp-7", "sql": [sql[1]], "genie": []}}, \
        "the grant still held stays on record"


def test_the_record_of_a_failed_revoke_is_kept_and_a_clean_one_is_dropped(agent_ns):
    obj, plain = _own(agent_ns)
    sql = [_schema_grant(obj, plain, "MODIFY")]
    status = {"app": {"state": "ready", "created": False}, "grants": {"app": {"churn-desk": _record(sql)}}}
    inst = _deleter(agent_ns, lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no MANAGE")) if s.startswith("REVOKE") else None)
    inst._implement_delete_outputs(["app"], {"app": "churn-desk"}, KEY, None, status, ())
    assert status["grants"]["app"]["churn-desk"]["service_principal"]["sql"] == sql and status["app"]["state"] == "deleted"
    clean = {"app": {"state": "ready", "created": False}, "grants": {"app": {"churn-desk": _record(sql)}}}
    _deleter(agent_ns)._implement_delete_outputs(["app"], {"app": "churn-desk"}, KEY, None, clean, ())
    assert "churn-desk" not in clean["grants"]["app"]


def test_two_use_cases_share_nothing_each_delete_touches_only_its_own_schema(agent_ns):
    first, first_plain = _own(agent_ns, "N01-U01")
    second, second_plain = _own(agent_ns, "N01-U02")
    assert first != second
    inst = _deleter(agent_ns)
    sql = [_schema_grant(first, first_plain, "SELECT"), _schema_grant(second, second_plain, "SELECT")]
    inst._implement_delete_output("app", "churn-desk", KEY, grants=_record(sql))
    assert _revokes(inst) == [f"REVOKE SELECT ON SCHEMA {first} FROM `sp-7`"], "the other use case's schema is never touched"
    other = _deleter(agent_ns, app={"description": "Inspire use case N01-U02 (session 5150): Price"})
    other._implement_delete_output("app", "price-desk", (5150, "N01-U02", 1), grants=_record(sql, sp="sp-9"))
    assert _revokes(other) == [f"REVOKE SELECT ON SCHEMA {second} FROM `sp-9`"]


def test_an_app_someone_else_now_owns_keeps_every_grant(agent_ns):
    obj, plain = _own(agent_ns)
    inst = _deleter(agent_ns, app={"description": "Finance team tool"})
    outcome = inst._implement_delete_output("app", "churn-desk", KEY, grants=_record([_schema_grant(obj, plain, "SELECT")]))
    assert outcome["refused"] is True and _revokes(inst) == []


def test_a_use_case_taken_out_of_a_shared_app_loses_the_grants_on_its_own_schema_too(agent_ns):
    obj, plain = _own(agent_ns)
    inst = _deleter(agent_ns)
    inst._implement_app_needs = lambda pages, settings: ({"main.other.kept"}, set(), "")
    sql = [_schema_grant(obj, plain, "SELECT"), _table_grant("main.other.kept"),
           {"privilege": "USE SCHEMA", "level": "schema", "object": "`main`.`other`", "table": "main.other.kept"}]
    back = inst._implement_take_back("app", "hub-desk", KEY, [], _record(sql), {"service_principal": "sp-7", "pages": []})
    assert _revokes(inst) == [f"REVOKE SELECT ON SCHEMA {obj} FROM `sp-7`"], \
        "the departed use case's schema is taken back; the table and schema another use case still reads keep their grants"
    assert back["warnings"] == []


@pytest.mark.parametrize("error, gone", [("[PRINCIPAL_DOES_NOT_EXIST] Could not find principal with name x", True),
                                         ("SCHEMA_NOT_FOUND: schema main.s does not exist", True),
                                         ("[PERMISSION_DENIED] User does not have MANAGE", False), ("timeout", False)])
def test_a_grant_is_gone_only_when_its_principal_or_object_is(agent_ns, error, gone):
    assert agent_ns["implement_grant_gone"](RuntimeError(error)) is gone
