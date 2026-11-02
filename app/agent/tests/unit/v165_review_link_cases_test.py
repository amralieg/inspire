import json
import os

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_review_link_cases.json")


def test_the_shared_review_link_cases_are_what_the_agent_builds_today(agent_ns):
    with open(FIXTURE, encoding="utf-8") as handle:
        text = handle.read()
    data = json.loads(text)
    assert json.dumps(data, indent=2, ensure_ascii=False) + "\n" == text
    assert data["error"] == agent_ns["IMPLEMENT_APP_HOSTED_ERRORS"]["inspire_url"]
    for case in data["cases"]:
        errors = []
        base = agent_ns["implement_inspire_url"]({"inspire_url": case["inspire_url"]}, True, errors)
        assert (base, errors) == (case["base"], case["errors"]), case["name"]
        assert agent_ns["implement_review_link"](base, case["session_id"], case["use_case_id"]) == case["link"], case["name"]


def test_the_review_link_cases_cover_quoting_slashes_capitals_and_every_missing_part():
    with open(FIXTURE, encoding="utf-8") as handle:
        data = json.load(handle)
    by_name = {case["name"]: case for case in data["cases"]}
    assert len(by_name) == len(data["cases"]) >= 19
    assert by_name["a plain address"]["link"] == by_name["an address with a trailing slash"]["link"] == (
        by_name["an address in capitals with spaces and a slash"]["link"]) == "https://inspire.example.com/?review=2222222222222222222&uc=N01-U01"
    assert by_name["ids with an ampersand"]["link"] == "https://inspire.example.com/?review=a%26b&uc=N01%26U01"
    assert by_name["ids with a percent sign"]["link"] == "https://inspire.example.com/?review=100%25&uc=N01%2520U01"
    assert by_name["ids with the characters quoting keeps"]["link"] == "https://inspire.example.com/?review=a-b_c.d~e&uc=N01-U01_x.y~z"
    linked = [case for case in data["cases"] if case["link"]]
    assert all(case["link"].count("?") == 1 and case["link"].count("&") == 1 for case in linked), "every other ? and & is quoted"
    broken = [case for case in data["cases"] if not case["link"]]
    assert {case["name"] for case in broken} == {"a use case id that is empty", "a session id that is empty", "a missing address",
                                                 "an address that is not text", "an address with a path", "an address over http"}
    assert all(case["errors"] == [data["error"]] for case in broken if "address" in case["name"])
