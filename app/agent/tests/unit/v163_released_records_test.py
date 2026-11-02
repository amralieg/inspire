from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

RELEASED_NOTEBOOK = {"modified_at": 1000, "spec_version": 2}
TABLE = "main.inspire.churn_out"
KEY = (5150, "N01-U01", 3)


def test_a_notebook_record_a_released_build_wrote_asks_for_the_history_upgrade_and_one_this_version_wrote_never_does(agent_ns):
    previous = {"spec_version": 2}
    assert agent_ns["implement_reusable_notebook"](previous, RELEASED_NOTEBOOK) is True
    assert agent_ns["implement_notebook_keeps_history"](RELEASED_NOTEBOOK) is False, \
        "the released build records only modified_at and spec_version, so its notebook still writes the table itself"
    written = dict(RELEASED_NOTEBOOK, result_history=agent_ns["IMPLEMENT_RESULT_HISTORY"])
    assert agent_ns["implement_notebook_keeps_history"](written) is True
    assert "inspire_write_result(frame, result_table)" in agent_ns["IMPLEMENT_HISTORY_UPGRADE_CHOICE"]


def test_a_page_leaving_an_app_a_released_build_granted_names_the_grants_nobody_recorded(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_own_sharing = lambda key: ([], [])
    needs = {"service_principal": "sp-9", "departed": TABLE}
    out = inst._implement_take_back("app", "churn-desk", KEY, [], None, needs)
    tables = agent_ns["implement_and_list"](agent_ns["implement_companion_tables"](TABLE))
    assert out["warnings"] == [f"App: an older Inspire built this use case's page and kept no record of the grants it ran, so the App's service "
                               f"principal sp-9 may still read {tables}; check its grants on them"]
    inst._implement_revoke_app_sp = lambda asset_id, sp, wanted: ([], [], sp)
    recorded = inst._implement_take_back("app", "churn-desk", KEY, [], {"people": [], "service_principal": {"sql": []}}, needs)
    assert not any("older Inspire" in w for w in recorded["warnings"]), "an App whose grants this version recorded gets no such note"


def test_an_output_a_released_build_shared_names_the_people_nobody_recorded(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_own_sharing = lambda key: ([{"type": "user", "name": "pat"}], [])
    out = inst._implement_take_back("dashboard", "d1", KEY, [], None, None)
    assert out["warnings"] == ["Sharing Dashboard: an older Inspire shared this use case and kept no record of the access it gave, so pat may "
                               "still open the dashboard d1; check who may open it"]
    inst._implement_revoke_people = lambda name, asset_id, people, needed: ([], [], [], [])
    assert inst._implement_take_back("dashboard", "d1", KEY, [], {"people": []}, None)["warnings"] == [], \
        "an output whose people this version recorded gets no such note"
