"""An App that lets people change records or record decisions may write the result table of every page it holds, not only the building one."""
import pytest

from v140_implement_test import READS, SHELL_FILES, _app_flow, _churn_page, _deploy_inspire, sdk_stub  # noqa: F401
from v142_merge_test import OWN_SOURCE, _host_files, _host_page, _restyle_inspire
from v150_app_owners_access_test import GRANT, NEW_APP, Catalog

OTHER = "main.inspire.sales_out"
MODIFY_OWN = GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`")
MODIFY_OTHER = GRANT.format("MODIFY", "TABLE `main`.`inspire`.`sales_out`")


def _deploy(agent_ns, options, page_tables, access="sp"):
    spark = Catalog(schema=[("entity_id", "string")])
    scoped = [dict(NEW_APP[1], user_api_scopes=["sql", "genie"])] if access == "user" else []
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, NEW_APP[:2] + scoped + NEW_APP[2:])
    inst.spark = spark
    context["spec"] = dict(context["spec"], outputs=dict(context["spec"]["outputs"], app_options=options, app_access=access))
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0, page_tables=page_tables)
    return spark, fields


def test_a_per_user_app_that_records_decisions_gets_read_and_modify_on_every_page_result_table_and_nothing_else(agent_ns, sdk_stub):
    spark, fields = _deploy(agent_ns, {"modify": True, "decisions": True}, ["main.inspire.churn_out", OTHER, OTHER], access="user")
    for table in ("`main`.`inspire`.`churn_out`", "`main`.`inspire`.`sales_out`"):
        assert spark.statements.count(GRANT.format("SELECT", f"TABLE {table}")) == 1, table
        assert spark.statements.count(GRANT.format("MODIFY", f"TABLE {table}")) == 1, table
    granted = {s.split(" ON ", 1)[1].split(" TO ")[0] for s in spark.statements if s.startswith("GRANT") and " ON TABLE " in s}
    assert granted == {"TABLE `main`.`inspire`.`churn_out`", "TABLE `main`.`inspire`.`sales_out`"}, \
        "a per-user App reads its other tables as the viewer, so its service principal gets only the decision tables"
    assert "_warnings" not in fields


def test_a_per_user_app_that_records_no_decisions_gets_no_table_grant(agent_ns, sdk_stub):
    spark, _fields = _deploy(agent_ns, {"modify": True, "decisions": False}, ["main.inspire.churn_out", OTHER], access="user")
    assert not any(s.startswith("GRANT") and " ON TABLE " in s for s in spark.statements)


@pytest.mark.parametrize("options", [{"modify": False, "decisions": True}, {"modify": True, "decisions": False}])
def test_a_hub_that_writes_records_gets_modify_on_every_page_result_table(agent_ns, sdk_stub, options):
    spark, fields = _deploy(agent_ns, options, ["main.inspire.churn_out", OTHER, OTHER])
    assert MODIFY_OWN in spark.statements and MODIFY_OTHER in spark.statements
    assert spark.statements.count(MODIFY_OTHER) == 1
    assert "_warnings" not in fields


def test_a_hub_that_only_reads_its_records_gets_modify_on_no_page_result_table(agent_ns, sdk_stub):
    spark, _fields = _deploy(agent_ns, {"modify": False, "decisions": False}, ["main.inspire.churn_out", OTHER])
    assert not any(s.startswith("GRANT MODIFY") and ("`churn_out`" in s or "`sales_out`" in s) for s in spark.statements)


def test_an_app_given_no_other_pages_writes_only_its_own_result_table(agent_ns, sdk_stub):
    spark, _fields = _deploy(agent_ns, {"modify": False, "decisions": True}, ())
    assert MODIFY_OWN in spark.statements and MODIFY_OTHER not in spark.statements


def test_the_app_page_build_hands_the_deploy_every_page_result_table(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    handed = []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  handed.append(list(page_tables)) or {"app_name": name})
    inst._implement_app(context, None)
    assert handed == [["main.inspire.churn_out"]]


def test_a_look_only_edit_hands_the_deploy_every_page_result_table(agent_ns, tmp_path, monkeypatch):
    import json
    from v142_merge_test import VALID
    own, other = _host_page(agent_ns, "N01-U01", "Churn desk"), _host_page(agent_ns, "N01-U02", "Stock desk")
    own["result_table"], other["result_table"] = "main.inspire.churn_out", OTHER
    files = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[own, other], title="N01-U01 Predict churn", genie="g1",
                        style="a", layout="sidebar", palette="default", theme="light")
    inst = _restyle_inspire(agent_ns, tmp_path, monkeypatch, files)
    handed = []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  handed.append(list(page_tables)) or {"app_name": name, "app_url": "https://churn-desk.example",
                                                                       "app_health": "passed"})
    previous = json.loads(json.dumps(VALID))
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    current = dict(previous, outputs={**previous["outputs"], "app_look": {"layout": "tabs"}})
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": current},
                                        (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert handed == [["main.inspire.churn_out", OTHER]]


def test_pointing_a_hub_page_at_its_genie_agent_hands_the_deploy_every_page_result_table(agent_ns, tmp_path, monkeypatch):
    from v142_merge_test import HOST_APP
    from v157_genie_repoint_test import _flow
    host, joined = _host_page(agent_ns), agent_ns["implement_app_page"](_churn_page(agent_ns, title="Churn desk"), "N01-U01", {})
    host["result_table"], joined["result_table"] = OTHER, "main.inspire.churn_out"
    inst, context, _seen = _flow(agent_ns, tmp_path, monkeypatch, _host_files(agent_ns, tmp_path, pages=[host, joined]), app=HOST_APP,
                                 outputs={"merge": {"app": "sales-desk"}})
    handed = []
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  handed.append(list(page_tables)) or {"app_name": name})
    inst._implement_app(context, None)
    assert handed == [[OTHER, "main.inspire.churn_out"]]
