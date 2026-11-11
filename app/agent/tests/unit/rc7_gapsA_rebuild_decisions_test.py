"""A look-only rebuild keeps a decision list: the held page keeps its records dataset, its decision layout and the decisions option."""
import copy

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v142_look_test import _app_shell


def _decision_page(agent_ns, own: str) -> dict:
    records = agent_ns["IMPLEMENT_RECORDS_DATASET"]
    return {"id": own, "title": "Driver breakdown", "layout": "performance_explainer",
            "datasets": [{"name": records, "sql": "select 1 as record_key"}],
            "records": {"dataset": records, "title": "Decision list", "columns": ["record_key"]},
            "result_table": "main.inspire.n04_u05"}


def test_a_look_only_rebuild_redeploys_the_held_decision_list_with_its_records_and_decisions(agent_ns, tmp_path, monkeypatch):
    payload, modules = _app_shell(agent_ns, tmp_path)
    inst = _inspire(agent_ns, FakeSpark())
    own = "n04_u05"
    held = _decision_page(agent_ns, own)
    monkeypatch.setattr(inst, "_implement_app_own_page", lambda context, host: own, raising=False)
    monkeypatch.setattr(inst, "_implement_emit", lambda *args, **kwargs: "step", raising=False)
    redeployed = []
    monkeypatch.setattr(inst, "_implement_app_redeploy", lambda *args, **kwargs: redeployed.append(args) or ({}, [], {"kind": "delta"}), raising=False)
    options = {"decisions": True, "modify": True, "replace_edits": False, "alerts": False}
    host = {"merged": False, "name": "airline-n04-u05", "pages": [copy.deepcopy(held)],
            "settings": {"genie": {"space_id": ""}, "options": dict(options)}, "info": [], "notes": []}
    context = {"uc_id": "N04-U05", "job_id": None,
               "use_case": {"use_case_kind": "driver_breakdown", "app_layout": "performance_explainer"},
               "spec": {"outputs": {"app_look": {"style": "a", "layout": "sidebar", "palette": "default", "theme": "light"},
                                    "app_purpose": "channel revenue drivers"}},
               "key": ("4242", "N04-U05", 3), "allowed": []}
    inst._implement_app_restyle(context, host, {}, modules)
    assert len(redeployed) == 1, "a look-only rebuild with the same layout redeploys"
    settings, pages = redeployed[0][2], redeployed[0][3]
    assert pages == [held], "the held decision page reaches the redeploy as it was"
    assert settings["options"] == options, "the decisions option survives the look-only rebuild"
    assert any(d.get("name") == agent_ns["IMPLEMENT_RECORDS_DATASET"] for d in pages[0]["datasets"])
    assert pages[0]["records"] == held["records"]
