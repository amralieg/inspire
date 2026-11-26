"""REQ-404: a page of another use case on a shared App that no longer works at the default filters does not stop this use case's
publish. The other page is kept as it was and named in a warning. A problem with this use case's own page, or with the App as a whole,
still refuses the build."""
import os  # noqa: E402
import sys  # noqa: E402

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402


def split_check(problems, pages, own_id):
    """The one attribution (shell_core.page_problems_split), read as (own problems, the pages kept)."""
    own, kept = shell_core.page_problems_split(problems, pages, own_id)
    return own, [p for p, _problems in kept]


OWN = {"id": "n01_u01_s5150", "title": "Churn desk", "use_case_id": "N01-U01"}
OTHER = {"id": "n01_u07", "title": "Sales desk", "use_case_id": "N01-U07"}
OTHER_LONG = {"id": "n01_u07_s5150", "title": "Stock desk", "use_case_id": "N01-U09"}
OWN_FAIL = "page n01_u01_s5150: kpi:revenue failed: DIVIDE_BY_ZERO"
OTHER_FAIL = "page n01_u07: chart:by_category failed: TABLE_OR_VIEW_NOT_FOUND"
APP_FAIL = "the App files do not hold together: the warehouse is not set"


def test_another_use_cases_failing_page_is_kept_and_does_not_belong_to_this_build(agent_ns):
    own, kept = split_check([OWN_FAIL, OTHER_FAIL, APP_FAIL], [OWN, OTHER], OWN["id"])
    assert own == [OWN_FAIL, APP_FAIL], "this use case's page and the App as a whole still refuse the build"
    assert [p["id"] for p in kept] == ["n01_u07"], "only the other use case's page is kept"


def test_a_page_id_that_prefixes_another_page_id_is_not_mixed_up(agent_ns):
    problem = "page n01_u07_s5150: kpi:stock failed: DIVIDE_BY_ZERO"
    own, kept = split_check([problem], [OWN, OTHER, OTHER_LONG], OWN["id"])
    assert own == [] and [p["id"] for p in kept] == ["n01_u07_s5150"], "'page n01_u07:' must not match 'page n01_u07_s5150:'"
    own, kept = split_check(["page n01_u07: chart:x failed: E"], [OWN, OTHER, OTHER_LONG], OWN["id"])
    assert own == [] and [p["id"] for p in kept] == ["n01_u07"]


def test_a_problem_that_names_this_page_and_another_stays_with_this_build(agent_ns):
    both = "page n01_u01_s5150: the join reads page n01_u07: E"
    own, kept = split_check([both], [OWN, OTHER], OWN["id"])
    assert own == [both] and kept == [], "a problem that touches this page is never waved through"


def test_the_kept_page_warning_names_the_use_case_to_rebuild_and_says_the_page_stays(agent_ns):
    warn = lambda pages: agent_ns["implement_app_kept_warning"](pages, "App")
    [text] = warn([OTHER])
    assert text == ("App: page 'Sales desk' of use case N01-U07 no longer works at the default filters, so the App keeps it as it was. "
                    "To fix it: build that use case again with Vibe/Add/Remove Features on the Build page or remove the page"), text
    assert warn([]) == []
    [two] = warn([OTHER, OTHER_LONG, OTHER])
    assert two.startswith("App: pages 'Sales desk' of use case N01-U07 and 'Stock desk' of use case N01-U09 no longer work at the "
                          "default filters, so the App keeps them as they were."), two
    assert two.count("'Sales desk'") == 1, "a page named twice is listed once"


def test_this_builds_own_page_failing_still_refuses_with_the_default_filters_reason(agent_ns):
    error = agent_ns["implement_app_check_failure"]([OWN_FAIL], "App")
    assert type(error) is RuntimeError
    assert str(error) == "the App was run at its default filters and " + agent_ns["inspire_listing"]([OWN_FAIL])
