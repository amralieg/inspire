from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

TABLE = "main.inspire.churn_out"
FEEDBACK = "`main`.`inspire`.`churn_out_feedback`"
NAMES = ["feedback_id", "use_case_id", "section", "record_key", "text", "reported_by", "reported_at", "status", "vibe_text",
         "handled_by", "handled_at", "filters"]


def test_the_feedback_table_sits_next_to_the_result_table_with_every_column(agent_ns):
    assert agent_ns["inspire_feedback_table"](TABLE) == "main.inspire.churn_out_feedback"
    assert agent_ns["inspire_feedback_table"]("`main`.`uc_n01`.`n01_u01_results`") == "main.uc_n01.n01_u01_results_feedback"
    assert [n for n, _k in agent_ns["INSPIRE_FEEDBACK_COLUMNS"]] == NAMES
    sql = agent_ns["inspire_feedback_create_sql"](TABLE)
    assert sql.startswith(f"CREATE TABLE IF NOT EXISTS {FEEDBACK} (feedback_id STRING, use_case_id STRING, section STRING")
    assert "reported_at TIMESTAMP" in sql and "handled_at TIMESTAMP" in sql and sql.endswith("filters STRING)")


def test_an_older_feedback_table_gains_only_its_missing_columns(fresh_ns):
    old = [("feedback_id", "string"), ("use_case_id", "string"), ("section", "string"), ("record_key", "string"), ("text", "string"),
           ("reported_by", "string"), ("reported_at", "timestamp"), ("status", "string")]

    def respond(statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": n, "data_type": t} for n, t in old]
        return []
    spark = FakeSpark(responder=respond)
    fresh_ns["inspire_ensure_feedback"](spark, TABLE)
    assert spark.statements[0].startswith(f"CREATE TABLE IF NOT EXISTS {FEEDBACK}")
    altered = [s for s in spark.statements if s.startswith("ALTER")]
    assert altered == [f"ALTER TABLE {FEEDBACK} ADD COLUMN `{n}` {k}" for n, k in
                       (("vibe_text", "STRING"), ("handled_by", "STRING"), ("handled_at", "TIMESTAMP"), ("filters", "STRING"))]
    full = FakeSpark(responder=lambda s: [{"col_name": n, "data_type": "string"} for n in NAMES] if s.startswith("DESCRIBE") else [])
    fresh_ns["inspire_ensure_feedback"](full, TABLE)
    assert not [s for s in full.statements if s.startswith("ALTER")]


def test_the_assumptions_table_still_builds_through_the_shared_sibling_helper(fresh_ns):
    sql = fresh_ns["inspire_assumptions_create_sql"](TABLE)
    assert sql == ("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_assumptions` (use_case_id STRING, name STRING, value DOUBLE, "
                   "changed_by STRING, changed_at TIMESTAMP, note STRING, text_value STRING)")


def _grants(spark):
    return [s for s in spark.statements if s.startswith("GRANT") and "churn_out_feedback" in s]


def test_the_build_creates_the_feedback_table_and_grants_the_app_service_principal(agent_ns):
    from v150_app_owners_access_test import Catalog
    for per_user in (False, True):
        spark = Catalog(schema=[("entity_id", "string"), ("priority_tier", "string")])
        inst = _inspire(agent_ns, spark)
        ran = []
        warnings = inst._implement_app_write_grants(TABLE, "sp-7", {}, [], ran, per_user=per_user, feedback=True)
        assert warnings == []
        assert any(s.startswith(f"CREATE TABLE IF NOT EXISTS {FEEDBACK}") for s in spark.statements)
        assert _grants(spark) == [f"GRANT SELECT ON TABLE {FEEDBACK} TO `sp-7`", f"GRANT MODIFY ON TABLE {FEEDBACK} TO `sp-7`"]
        assert {g["privilege"] for g in ran if g.get("table") == "main.inspire.churn_out_feedback" and g.get("level") == "table"} == {"SELECT", "MODIFY"}
        spark.statements.clear()
        inst._implement_revoke_app_sp("churn-desk", {"name": "sp-7", "sql": ran, "genie": []}, {"pages": [], "service_principal": "sp-7"})
        revoked = [s for s in spark.statements if s.startswith("REVOKE") and "churn_out_feedback" in s]
        assert len(revoked) == 2, "Uninstall takes back the feedback grants too"


def test_a_table_the_page_only_reads_gets_no_feedback_table(agent_ns):
    from v150_app_owners_access_test import Catalog
    spark = Catalog(schema=[("entity_id", "string")])
    inst = _inspire(agent_ns, spark)
    inst._implement_app_write_grants(TABLE, "sp-7", {}, [], [], feedback=False)
    assert not [s for s in spark.statements if "churn_out_feedback" in s]


def test_a_feedback_table_inspire_cannot_create_warns_and_names_what_people_lose(agent_ns):
    from v150_app_owners_access_test import Catalog
    spark = Catalog(schema=[("entity_id", "string")], fail={f"CREATE TABLE IF NOT EXISTS {FEEDBACK}": RuntimeError("PERMISSION_DENIED: no CREATE TABLE")})
    inst = _inspire(agent_ns, spark)
    warnings = inst._implement_app_write_grants(TABLE, "sp-7", {}, [], [], feedback=True)
    assert len(warnings) == 1 and warnings[0].startswith("App: people cannot report issues about this use case from the App until its service "
                                                         "principal sp-7 can read and change the result table.")
    assert "PERMISSION_DENIED" in warnings[0] and not _grants(spark)


def test_both_build_call_sites_ask_for_the_feedback_table_on_the_use_case_table_only(agent_ns):
    source = __import__("_agentload").agent_source()
    assert source.count('feedback=table == context["result_table"]') == 2
