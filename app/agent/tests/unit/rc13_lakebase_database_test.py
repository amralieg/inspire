import pytest

DENIED = "permission denied for database databricks_postgres"
BUILDER = "builder@example.com"
ROLE = '"builder@example.com"'


class FakeCursor:
    def __init__(self, schema_exists: bool = False, fail_on: str = "", error: str = DENIED):
        self.sql, self.schema_exists, self.fail_on, self.error = [], schema_exists, fail_on, error
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        self.sql.append(statement)
        if self.fail_on and statement.startswith(self.fail_on):
            raise RuntimeError(self.error)
        self._last = (1,) if (statement.startswith("SELECT 1") and self.schema_exists) else None

    def fetchone(self):
        return self._last


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def cursor(self):
        return self._cursor


def _inst(agent_ns, cursor, logged):
    """A real DatabricksInspire instance whose connection, builder and logger are fakes."""
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj._implement_lakebase_connection = lambda env: FakeConn(cursor)
    obj._implement_lakebase_log_refusal = lambda what, error: logged.append(what)
    obj._implement_builder = lambda: BUILDER
    return obj


def _pg():
    return type("PG", (), {"pg_ident": staticmethod(lambda name: '"' + name + '"')})


def test_a_token_inside_the_object_name_a_permission_error_quotes_never_reaches_the_refusal(agent_ns):
    token = "dapi" + "ab" * 16
    refusal = agent_ns["implement_lakebase_refusal"](RuntimeError(f"permission denied for table churn_desk.{token}"), BUILDER)
    assert token not in str(refusal)
    assert token not in refusal.statement
    assert "<redacted>" in str(refusal)


def test_a_database_refusal_maps_to_the_exact_grant_for_the_builder_role(agent_ns):
    refusal = agent_ns["implement_lakebase_refusal"](RuntimeError(DENIED + "\nDETAIL: x"), BUILDER)
    assert isinstance(refusal, agent_ns["ImplementLakebasePermission"])
    assert refusal.statement == f"GRANT CREATE ON DATABASE databricks_postgres TO {ROLE}"
    assert "only its owner or a databricks_superuser can grant" in str(refusal)


def test_a_schema_or_table_refusal_maps_to_its_own_grant(agent_ns):
    refusal = agent_ns["implement_lakebase_refusal"]
    assert refusal(RuntimeError("permission denied for schema churn_desk"), BUILDER).statement == (
        f"GRANT ALL PRIVILEGES ON SCHEMA churn_desk TO {ROLE}")
    assert refusal(RuntimeError("must be owner of table churn_desk.orders"), BUILDER).statement == (
        f"GRANT ALL PRIVILEGES ON TABLE churn_desk.orders TO {ROLE}")


def test_an_error_that_is_not_a_postgres_permission_refusal_maps_to_nothing(agent_ns):
    assert agent_ns["implement_lakebase_refusal"](RuntimeError("syntax error at or near x"), BUILDER) is None


def test_the_grant_quotes_a_role_name_that_holds_a_double_quote(agent_ns):
    refusal = agent_ns["implement_lakebase_refusal"](RuntimeError(DENIED), 'odd"name')
    assert refusal.statement.endswith('TO "odd""name"')


def test_the_fallback_asks_the_owner_to_run_the_statement_then_build_again(agent_ns):
    refusal = agent_ns["implement_lakebase_refusal"](RuntimeError(DENIED), BUILDER)
    text = agent_ns["implement_lakebase_fallback"](str(refusal), refusal.statement)
    assert text.startswith("App: it reads Delta tables, so its pages take a few seconds to load, because Inspire could not set up Lakebase: ")
    assert text.endswith(f". Ask the Lakebase project owner to run {refusal.statement}, then build the App again to switch it to Lakebase")
    assert "build the App again" in text and "Build the App again" not in text


def test_enforce_views_does_not_ask_for_create_when_the_schema_already_exists(agent_ns):
    cursor, logged = FakeCursor(schema_exists=True), []
    _inst(agent_ns, cursor, logged)._implement_lakebase_enforce_views({}, [], "churn_desk", _pg())
    assert not any(s.startswith("CREATE SCHEMA") for s in cursor.sql)
    assert cursor.sql[0].startswith("SELECT 1 FROM pg_catalog.pg_namespace") and logged == []


def test_enforce_views_creates_a_missing_schema_before_anything_else(agent_ns):
    cursor, logged = FakeCursor(schema_exists=False), []
    _inst(agent_ns, cursor, logged)._implement_lakebase_enforce_views({}, [], "churn_desk", _pg())
    assert cursor.sql[1] == 'CREATE SCHEMA "churn_desk"'


def test_a_builder_without_create_on_the_database_gets_the_grant_not_the_raw_error(agent_ns):
    # Before this change the raw psycopg error escaped, so the App fell back with no grant to run.
    cursor, logged = FakeCursor(fail_on="CREATE SCHEMA"), []
    with pytest.raises(agent_ns["ImplementLakebasePermission"]) as raised:
        _inst(agent_ns, cursor, logged)._implement_lakebase_enforce_views({}, [], "churn_desk", _pg())
    assert raised.value.statement == f"GRANT CREATE ON DATABASE databricks_postgres TO {ROLE}"
    assert logged == ["create the Lakebase schema churn_desk"]


def test_any_lakebase_statement_refused_by_postgres_surfaces_its_grant(agent_ns):
    cursor, logged = FakeCursor(fail_on="GRANT", error="permission denied for schema churn_desk"), []
    with pytest.raises(agent_ns["ImplementLakebasePermission"]) as raised:
        _inst(agent_ns, cursor, logged)._implement_lakebase_sql({}, ["GRANT USAGE ON SCHEMA churn_desk TO x"])
    assert raised.value.statement == f"GRANT ALL PRIVILEGES ON SCHEMA churn_desk TO {ROLE}"
    assert logged == ["run a Lakebase statement"]


def test_a_reason_for_a_non_permission_error_keeps_the_redacted_text(agent_ns):
    obj = _inst(agent_ns, FakeCursor(), [])
    assert obj._implement_lakebase_reason(RuntimeError("connection reset"), "x") == "connection reset"


def test_an_unrelated_sql_error_still_propagates_unchanged(agent_ns):
    cursor, logged = FakeCursor(), []

    class Boom(Exception):
        pass

    def broken(statement, params=None):
        raise Boom("syntax error")

    cursor.execute = broken
    with pytest.raises(Boom):
        _inst(agent_ns, cursor, logged)._implement_lakebase_enforce_views({}, [], "churn_desk", _pg())
    assert logged == []


def test_a_lakebase_permission_refusal_carries_one_structured_entry_with_its_exact_grant(agent_ns):
    # REQ-150: the Build page raises Permission Required for this refusal, so the entry carries the exact GRANT and the grantee.
    entry = agent_ns["implement_lakebase_permission_entry"](RuntimeError(DENIED), BUILDER)
    assert entry["statements"] == [f'GRANT CREATE ON DATABASE databricks_postgres TO "{BUILDER}"']
    assert entry["principal"] == BUILDER and entry["instructions"] == []
    assert "databricks_superuser" in entry["why"]
    assert agent_ns["implement_lakebase_permission_entry"](RuntimeError("syntax error"), BUILDER) is None


def test_the_permission_entry_has_the_fields_of_the_app_permission_payload_and_drops_repeated_statements(agent_ns):
    entry = agent_ns["implement_permission_entry"]("app-sp", ["GRANT SELECT ON TABLE a.b.c TO `app-sp`", "", "GRANT SELECT ON TABLE a.b.c TO `app-sp`"], "why")
    assert entry == {"statements": ["GRANT SELECT ON TABLE a.b.c TO `app-sp`"], "instructions": [], "principal": "app-sp", "why": "why"}


def test_the_scope_view_denial_and_the_app_return_raise_one_structured_entry_each(agent_ns):
    # Source-level check of the wiring in _implement_deploy_app (the scope loop needs a live Spark session to run).
    import json
    from pathlib import Path
    notebook = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
    body = "".join("".join(c["source"]) for c in json.loads(notebook.read_text(encoding="utf-8"))["cells"] if c["cell_type"] == "code")
    assert body.count("permissions.append(implement_permission_entry(client_id, denied_scope,") == 1
    assert '**({"_permissions": permissions} if permissions else {})' not in body, "entries reach the build through the context, not the return"
    assert 'permissions.extend(lakebase.get("permissions") or [])' in body
def test_an_app_query_check_problem_string_maps_to_its_grant(agent_ns):
    # The caller of the App query check maps each problem string the same way (_implement_app_lakebase).
    problem = "dataset trend: permission denied for schema churn_desk"
    refusal = agent_ns["implement_lakebase_refusal"](problem, BUILDER)
    assert refusal.statement == f"GRANT ALL PRIVILEGES ON SCHEMA churn_desk TO {ROLE}"


def test_a_build_whose_app_fails_after_a_refused_grant_keeps_the_entries_on_its_failure_and_warning_writes(agent_ns):
    # Source-level: the failed-output record and the final write both read the entries the deploy collected on the context,
    # so a grant refused before the App failed still reaches asset_status and the Build page. Fails before: the failure record had no entries.
    import json
    from pathlib import Path
    notebook = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
    body = "".join("".join(c["source"]) for c in json.loads(notebook.read_text(encoding="utf-8"))["cells"] if c["cell_type"] == "code")
    failed = body.index('asset_status["permissions"] = list(context.get("permissions") or [])\n                asset_status[name] = dict(implement_kept_asset')
    assert failed > 0
    assert body.count('asset_status["permissions"] = list(context.get("permissions") or [])') == 2
    assert 'permissions = context.setdefault("permissions", [])' in body


def test_a_whole_build_failure_after_a_refused_grant_keeps_its_entries_on_the_failed_record(agent_ns):
    # REQ-150: the whole-build failure (_implement_failed) reads _implement_stopped_fields. The entries collected on the
    # build's inflight dict must reach asset_status there. Fails before: the failed record carried no permissions.
    import types
    entry = agent_ns["implement_permission_entry"]("app-sp", ["GRANT SELECT ON TABLE a.b.c TO `app-sp`"], "why")
    stub = types.SimpleNamespace(_implement_notebook_modified_at=lambda path: "2026-11-13T03:00:00Z")
    inflight = {"asset_status": {"app": {"state": "failed"}}, "notebook_path": "/W/impl/N01", "permissions": [entry]}
    fields = agent_ns["DatabricksInspire"]._implement_stopped_fields(stub, ("1", "N01-U01", 2), inflight)
    assert fields["asset_status"]["permissions"] == [entry]
    assert fields["asset_status"]["app"] == {"state": "failed"}


def test_a_refusal_with_no_identity_names_no_grant_instead_of_a_placeholder_role(agent_ns):
    # REQ-149: with no identity to grant to, a GRANT would name a placeholder role the owner cannot run, so no statement is made.
    refusal = agent_ns["implement_lakebase_refusal"](RuntimeError(DENIED), "")
    assert isinstance(refusal, agent_ns["ImplementLakebasePermission"])
    assert refusal.statement == "" and "<identity>" not in str(refusal)
    assert "the identity Inspire runs as cannot create objects in the database databricks_postgres" in str(refusal)
    assert agent_ns["implement_lakebase_permission_entry"](RuntimeError(DENIED), "") is None


def test_the_reason_for_a_refusal_with_no_identity_asks_the_owner_to_run_nothing(agent_ns):
    obj = _inst(agent_ns, FakeCursor(), [])
    obj._implement_builder = lambda: ""
    reason = obj._implement_lakebase_reason(RuntimeError(DENIED), "x")
    assert reason.startswith("the identity Inspire runs as cannot create objects in the database databricks_postgres")
    assert "ask the Lakebase project owner" not in reason and reason.endswith("can grant")
