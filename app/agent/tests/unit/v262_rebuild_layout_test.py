"""A rebuild of an existing App whose page was laid out as the dashboard gets the decision layout: the held page is not reused."""
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v200_kinds_artifacts_test import RESULT


def test_a_held_page_with_another_layout_is_named_so_the_page_is_rebuilt(agent_ns):
    note = agent_ns["implement_held_layout_note"]
    pages = [{"id": "n04_u05", "layout": "dashboard"}]
    assert "rebuilds the page" in note(pages, "n04_u05", "performance_explainer")
    assert note(pages, "n04_u05", "dashboard") == ""
    assert note(pages, "other", "performance_explainer") == ""
    assert note([], "n04_u05", "performance_explainer") == ""


def test_a_look_only_rebuild_of_a_dashboard_page_that_now_draws_a_decision_list_rebuilds_the_page(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, FakeSpark())
    own = "n04_u05"
    monkeypatch.setattr(inst, "_implement_app_own_page", lambda context, host: own, raising=False)
    monkeypatch.setattr(inst, "_implement_emit", lambda *args, **kwargs: "step", raising=False)
    redeployed = []
    monkeypatch.setattr(inst, "_implement_app_redeploy", lambda *args, **kwargs: redeployed.append(args) or ({}, [], {"kind": "delta"}), raising=False)
    host = {"merged": False, "name": "airline-n04-u05", "pages": [{"id": own, "layout": "dashboard", "records": None}],
            "settings": {"genie": {"space_id": ""}}, "info": [], "notes": []}
    context = {"uc_id": "N04-U05", "use_case": {"use_case_kind": "driver_breakdown", "app_layout": "dashboard"},
               "spec": {"outputs": {"app_look": {"style": "a"}, "app_purpose": "channel revenue drivers"}}, "key": ("4242", "N04-U05", 3)}
    result = inst._implement_app_restyle(context, host, {}, {"shell_core": None})
    assert result is None, "the held dashboard page is not reused"
    assert redeployed == [], "nothing is redeployed without Genie"
    assert any("rebuilds the page" in text for text in host["info"])
