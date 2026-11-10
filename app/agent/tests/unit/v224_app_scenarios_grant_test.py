"""The notebook creates <result_table>_scenarios next to the result table at build time and grants the App's service principal on it."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v140_implement_test import READS, SHELL_FILES, _deploy_inspire, _inspire, sdk_stub  # noqa: E402,F401
from v150_app_owners_access_test import NEW_APP  # noqa: E402


def _files(agent_ns, **pages):
    folder = agent_ns["IMPLEMENT_APP_PAGES_DIR"]
    return {f"{folder}/{name}.json": text if isinstance(text, str) else json.dumps(text) for name, text in pages.items()}


def test_the_notebook_and_the_app_server_name_the_same_scenario_columns_in_the_same_order(agent_ns):
    columns = agent_ns["INSPIRE_SCENARIO_COLUMNS"]
    assert [name for name, _kind in columns] == list(shell_sql.SCENARIO_COLUMNS)
    assert {name for name, kind in columns if kind == "DOUBLE"} == set(shell_sql.SCENARIO_NUMBERS)
    assert dict(columns)["changed_at"] == "TIMESTAMP"
    assert agent_ns["INSPIRE_SCENARIOS_SUFFIX"] == shell_sql.SCENARIOS_SUFFIX
    assert agent_ns["inspire_scenarios_table"]("main.finance.margin_out") == "main.finance.margin_out_scenarios"


def test_the_assumptions_table_keeps_its_name_and_columns_after_sharing_the_sibling_helpers(agent_ns):
    assert agent_ns["inspire_assumptions_table"]("main.inspire.churn_out") == "main.inspire.churn_out_assumptions"
    assert agent_ns["inspire_assumptions_create_sql"]("main.inspire.churn_out") == (
        "CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_assumptions` (use_case_id STRING, name STRING, value DOUBLE, "
        "changed_by STRING, changed_at TIMESTAMP, note STRING, text_value STRING)")


def test_only_pages_with_a_scenario_and_a_result_table_ask_for_a_scenarios_table(agent_ns):
    pick = agent_ns["implement_app_scenario_tables"]
    files = _files(agent_ns, a={"result_table": "main.s.lab_out", "scenario": {"levers": []}},
                   b={"result_table": "main.s.queue_out", "records": {"key": "k"}},
                   c={"scenario": {"levers": []}}, d="{not json", e={"result_table": "main.s.odd_out", "scenario": "text"})
    files["settings.json"] = json.dumps({"result_table": "main.s.not_a_page", "scenario": {}})
    assert pick(files) == {"main.s.lab_out"}
    assert pick({}) == set() and pick(None) == set()


def test_the_app_service_principal_gets_and_on_uninstall_loses_its_scenarios_table_grant(agent_ns):
    from v150_app_owners_access_test import Catalog
    spark = Catalog(schema=[("entity_id", "string")])
    inst = _inspire(agent_ns, spark)
    ran = []
    warnings = inst._implement_app_sibling_access("main.inspire.lab_out", agent_ns["INSPIRE_SCENARIOS_SUFFIX"], agent_ns["INSPIRE_SCENARIO_COLUMNS"], agent_ns["IMPLEMENT_SCENARIOS_REFUSED"], "sp-7", ran)
    created = [s for s in spark.statements if s.startswith("CREATE TABLE")]
    assert created and created[0].startswith("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`lab_out_scenarios` (event_id STRING, use_case_id STRING")
    granted = [s for s in spark.statements if s.startswith("GRANT") and " ON TABLE " in s]
    assert warnings == [] and granted == ["GRANT SELECT ON TABLE `main`.`inspire`.`lab_out_scenarios` TO `sp-7`",
                                          "GRANT MODIFY ON TABLE `main`.`inspire`.`lab_out_scenarios` TO `sp-7`"]
    spark.statements.clear()
    record = {"name": "sp-7", "sql": ran, "genie": []}
    _warnings, _said, left = inst._implement_revoke_app_sp("lab-desk", record, {"pages": [], "service_principal": "sp-7"})
    revoked = [s for s in spark.statements if s.startswith("REVOKE")]
    assert len(revoked) == len([g for g in ran if g.get("level") == "table"]) == 2
    assert all("lab_out_scenarios" in s for s in revoked)
    assert not (left or {}).get("sql")


LAB_FILES = dict(SHELL_FILES, **{"pages/n01_u01.json": json.dumps({"id": "n01_u01", "result_table": "main.inspire.churn_out",
                                                                    "layout": "scenario_lab", "scenario": {"levers": []}})})
SCENARIOS_CREATE = "CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_scenarios`"


def _deployed(agent_ns, files, outputs=None, answers=NEW_APP):
    from v150_app_owners_access_test import Catalog
    spark = Catalog()
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(answers))
    inst.spark = spark
    if outputs:
        context["spec"] = dict(context["spec"], outputs=dict(context["spec"]["outputs"], **outputs))
    return spark, inst._implement_deploy_app(context, "churn-desk", files, READS, poll_s=0)


def test_building_a_scenario_app_creates_and_grants_its_scenarios_table_and_a_queue_app_does_not(agent_ns, sdk_stub):
    spark, fields = _deployed(agent_ns, LAB_FILES)
    assert "_warnings" not in fields and fields["app_url"] == "https://churn-desk.example"
    assert any(s.startswith(SCENARIOS_CREATE) for s in spark.statements)
    assert {"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_scenarios` TO `sp-1`",
            "GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_scenarios` TO `sp-1`"} <= set(spark.statements)
    spark, _fields = _deployed(agent_ns, SHELL_FILES)
    assert not any("_scenarios" in s for s in spark.statements)


def test_a_per_user_scenario_app_still_gets_its_scenarios_table(agent_ns, sdk_stub):
    answers = [NEW_APP[0], NEW_APP[1], dict(NEW_APP[1], user_api_scopes=["sql:restricted-query", "genie"])] + NEW_APP[2:]
    spark, fields = _deployed(agent_ns, LAB_FILES, {"app_access": "user", "app_options": {"decisions": False}}, answers)
    assert fields["app_url"] == "https://churn-desk.example"
    assert any(s.startswith(SCENARIOS_CREATE) for s in spark.statements)
    assert "GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_scenarios` TO `sp-1`" in spark.statements


def test_a_scenarios_table_that_cannot_be_created_is_a_warning_naming_it_and_grants_nothing(agent_ns):
    class Refusing(FakeSpark):
        def sql(self, statement, *args, **kwargs):
            if statement.startswith("CREATE TABLE") and "_scenarios" in statement:
                raise RuntimeError("PERMISSION_DENIED: CREATE TABLE")
            return super().sql(statement, *args, **kwargs)

    spark = Refusing()
    inst = _inspire(agent_ns, spark)
    ran = []
    warnings = inst._implement_app_sibling_access("main.inspire.lab_out", agent_ns["INSPIRE_SCENARIOS_SUFFIX"], agent_ns["INSPIRE_SCENARIO_COLUMNS"], agent_ns["IMPLEMENT_SCENARIOS_REFUSED"], "sp-7", ran)
    assert len(warnings) == 1 and "save, share or choose scenarios" in warnings[0]
    assert "lab_out_scenarios" not in warnings[0].split("Inspire could not")[0], "no table id in the main sentence"
    assert "could not create it" in warnings[0] and ran == []
    assert not [s for s in spark.statements if s.startswith("GRANT")]
