import copy

from v140_implement_test import _app_shell, _churn_page
from v142_dash_test import RESULT

DEPLOYED = [{"id": "block", "label": "Block", "status": "Done"},
            {"id": "investigate", "label": "Investigate", "status": "In progress"}]
KIND = [{"id": "merge", "label": "Merge", "status": "Done"}, {"id": "review_later", "label": "Review later", "status": "In progress"}]


def test_the_deployed_choices_of_the_same_use_case_are_the_ones_kept(agent_ns):
    pages = [{"id": "other", "use_case_id": "N09-U09", "records": {"choices": copy.deepcopy(KIND)}},
             {"id": "n01", "use_case_id": "N01-U01", "records": {"choices": copy.deepcopy(DEPLOYED)}}]
    assert agent_ns["implement_deployed_choices"](pages, "N01-U01") == DEPLOYED
    assert agent_ns["implement_deployed_choices"]([{"id": "n01", "use_case_id": "N01-U01", "records": {}}], "N01-U01") == []
    assert agent_ns["implement_deployed_choices"](None, "N01-U01") == []


def test_round_one_without_choices_keeps_the_deployed_ids_not_the_kind_defaults(agent_ns, tmp_path):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    raw = _churn_page(agent_ns)
    raw["records"] = {k: v for k, v in raw["records"].items() if k != "choices"}
    page = agent_ns["implement_app_page"](raw, "N01-U01", {}, RESULT, choices=agent_ns["implement_deployed_choices"](
        [{"id": "n01", "use_case_id": "N01-U01", "records": {"choices": DEPLOYED}}], "N01-U01"))
    assert [c["id"] for c in page["records"]["choices"]] == ["block", "investigate"]
    problems = agent_ns["implement_app_page_problems"](page, shell_sql, [RESULT, "main.s.orders"], False, stored=["block"])
    assert not [p for p in problems if "choice" in p], problems
