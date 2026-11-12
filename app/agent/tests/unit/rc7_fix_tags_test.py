import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace  # noqa: E402
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402
from v140_implement_test import VALID, _left_by, _probe_inspire  # noqa: E402
from v192_job_asset_tags_test import _Api, _tagger  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _build_without_a_job_in_this_run(ns, api):
    inst = _probe_inspire(ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_carried = lambda t: ({"notebook_path": "/W/nb", "result_rows": 40, "dashboard_id": "d1"},
                                         _left_by(2, {"dashboard": {"state": "ready", "spec_version": 2}}))
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, None, {})
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    inst._implement_api = api
    return inst


def test_a_publish_with_no_preview_in_this_run_still_names_its_assets_on_the_build_job(ns):
    api = _Api({"dbx_inspire_ai_run_type": "implement", "team": "growth"})
    inst = _build_without_a_job_in_this_run(ns, api)
    tables_seen = []
    inst._implement_tag_tables = lambda uc, tables, key: tables_seen.append(list(tables))
    use_case = {"job_id": 77, "session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)}
    assert inst._implement_one_locked(use_case, (5150, "N01-U01", 3)) == "ready"
    written = [body["new_settings"]["tags"] for body in api.updates()
               if body.get("job_id") == 77 and "tags" in (body.get("new_settings") or {})]
    assert any(tags.get("dbx_inspire_ai_genie_space_id") == "g1" and tags.get("dbx_inspire_ai_app_name") == "churn-desk"
               for tags in written), written
    assert tables_seen and tables_seen[0][0] == VALID["config"]["result_table"]


def test_a_publish_with_no_job_at_all_says_so_in_the_log(ns):
    api = _Api()
    inst = _tagger(ns, api)
    inst._implement_tag_job_assets("N01-U01", None, {"genie_space": "g1"}, {"genie_space": {"state": "ready"}})
    assert api.calls == []
    warnings = [msg for level, msg in inst.logger.records if level == "WARNING"]
    assert len(warnings) == 1 and "[IMPLEMENT-ASSET-TAGS]" in warnings[0] and "N01-U01" in warnings[0]


def test_an_identity_tag_write_with_no_job_says_so_in_the_log(ns):
    api = _Api()
    inst = _tagger(ns, api)
    inst._implement_tag_job_identity("N01-U01", None, (5150, "N01-U01", 3))
    assert api.calls == []
    warnings = [msg for level, msg in inst.logger.records if level == "WARNING"]
    assert len(warnings) == 1 and "[IMPLEMENT-IDENTITY-TAGS]" in warnings[0]


def test_result_and_run_tables_get_the_same_use_case_tags_as_their_schema(ns):
    spark = FakeSpark()
    inst = make_inspire(ns, spark=spark, session_id=5150)
    inst.business_name, inst.inspire_database = "Acme", "main.inspire"
    inst._implement_tag_tables("N01-U01", ["main.acme_n01.n01_u01_results", "", "main.acme_n01.n01_u01_results",
                                           "main.acme_n01.n01_u01_run_log"], (5150, "N01-U01", 3))
    tags = ("'inspire_session_id' = '5150', 'inspire_use_case_id' = 'N01-U01', 'inspire_business' = 'Acme', "
            "'inspire_database' = 'main.inspire'")
    assert spark.statements == [
        f"ALTER TABLE `main`.`acme_n01`.`n01_u01_results` SET TAGS ({tags})",
        f"ALTER TABLE `main`.`acme_n01`.`n01_u01_run_log` SET TAGS ({tags})",
    ]


def test_a_table_the_tag_statement_refuses_is_warned_and_never_fails_the_build(ns):
    def refuse(statement):
        raise RuntimeError("PERMISSION_DENIED: only the owner can set tags")

    inst = make_inspire(ns, spark=FakeSpark(responder=refuse), session_id=5150)
    inst._implement_tag_tables("N01-U01", ["main.acme_n01.n01_u01_results"], (5150, "N01-U01", 3))
    warnings = [msg for level, msg in inst.logger.records if level == "WARNING"]
    assert len(warnings) == 1 and "[IMPLEMENT-TABLE-TAGS]" in warnings[0] and "main.acme_n01.n01_u01_results" in warnings[0]


def test_the_table_tag_rule_is_the_backend_uc_rule(ns):
    launcher = ns["JobLauncher"]
    assert launcher.tag_key("inspire.session id", "uc") == "inspire_session_id"
    assert len(launcher.tag_value("x" * 300, "uc")) == 256
