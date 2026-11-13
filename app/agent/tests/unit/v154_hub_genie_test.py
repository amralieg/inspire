import copy

import pytest

from v141_app_shell_test import PAGE, SETTINGS, call, shell
from v144_app_chrome_test import CHART, OLD_SCREENS, RECORD, explain_body, refused
import shell_agent  # noqa: E402
import shell_core

FIRST_SPACE, SECOND_SPACE = SETTINGS["genie"]["space_id"], "01f0dd44ee55ff66"
HUB = dict(SETTINGS, business="Acme taxis", pages=["n01_u05", "n02_u01", "n03_u01"])


def second(**changes):
    return dict(copy.deepcopy(PAGE), id="n02_u01", use_case_id="N02-U01", title="Unusual trip queue", **changes)


def joined():
    return dict(copy.deepcopy(PAGE), id="n03_u01", use_case_id="N03-U01", title="Fare revenue forecast")


def hub(tmp_path, settings=None, pages=None):
    return shell(tmp_path, settings or HUB, pages or [PAGE, second(genie={"space_id": SECOND_SPACE, "title": "Unusual trip queue"}), joined()])


def test_each_page_uses_its_own_genie_agent_and_a_page_without_one_uses_the_app_s_only_when_it_is_the_first():
    pages = [PAGE, second(genie={"space_id": SECOND_SPACE, "title": "Unusual trip queue"}), joined()]
    assert shell_core.page_genie(HUB, pages, pages[0]) == (SETTINGS["genie"], "")
    assert shell_core.page_genie(HUB, pages, pages[1]) == ({"space_id": SECOND_SPACE, "title": "Unusual trip queue"}, "")
    assert shell_core.page_genie(HUB, pages, pages[2]) == (None, shell_core.JOINED_GENIE_NOTE)
    off = second(genie=None, genie_note="The Genie Agent did not build: the warehouse was stopped")
    assert shell_core.page_genie(HUB, [PAGE, off], off) == (None, off["genie_note"])
    assert shell_core.page_genie(dict(HUB, genie=None, genie_note="No Genie Agent"), [PAGE], PAGE) == (None, "No Genie Agent")


@pytest.mark.parametrize("genie, note, problem", [
    ({"title": "No space"}, "", "page n02_u01: its Genie Agent needs a space_id, or set genie to null with a genie_note"),
    ({"space_id": "  ", "title": "Blank"}, "", "page n02_u01: its Genie Agent needs a space_id, or set genie to null with a genie_note"),
    ("01f0dd44ee55ff66", "", "page n02_u01: its Genie Agent needs a space_id, or set genie to null with a genie_note"),
    (None, "", "page n02_u01: Ask Genie is off, so genie_note must say why"),
    (None, "   ", "page n02_u01: Ask Genie is off, so genie_note must say why"),
])
def test_a_page_s_own_genie_agent_must_name_its_space_or_say_why_it_is_off(genie, note, problem):
    settings = dict(HUB, pages=["n01_u05", "n02_u01"])
    assert problem in shell_core.settings_problems(settings, [PAGE, second(genie=genie, genie_note=note)])
    assert shell_core.settings_problems(settings, [PAGE, second(genie={"space_id": SECOND_SPACE, "title": "t"})]) == []
    assert shell_core.settings_problems(settings, [PAGE, second(genie=None, genie_note="It failed")]) == []


def test_the_app_tells_the_browser_each_page_s_genie_agent_and_the_hub_says_each_use_case_has_its_own(tmp_path):
    s, _sp, _user, _made = hub(tmp_path)
    info = call(s, "GET", "app")[1]
    assert [p["genie"] for p in info["pages"]] == [
        {"enabled": True, "agent": False, "title": "Pricing desk", "url": f"https://dbc-1.example.com/genie/rooms/{FIRST_SPACE}", "note": ""},
        {"enabled": True, "agent": False, "title": "Unusual trip queue", "url": f"https://dbc-1.example.com/genie/rooms/{SECOND_SPACE}", "note": ""},
        {"enabled": False, "agent": False, "title": "", "url": "", "note": f"{shell_agent.NO_MODEL} {shell_core.JOINED_GENIE_NOTE}"}]
    assert info["genie"] == {"enabled": True, "title": "", "url": "", "note": shell_core.HUB_GENIE_NOTE}
    assert "space_id" not in str(info["pages"])


def test_a_hub_where_no_page_has_genie_says_so_and_a_one_page_app_shows_its_page_s_genie(tmp_path):
    off = dict(HUB, genie=None, genie_note="The Genie Agent did not build")
    (tmp_path / "off").mkdir()
    s, _sp, _user, _made = shell(tmp_path / "off", off, [PAGE, second(genie=None, genie_note="It failed"), joined()])
    assert call(s, "GET", "app")[1]["genie"] == {"enabled": False, "title": "", "url": "", "note": shell_core.HUB_GENIE_OFF}
    (tmp_path / "one").mkdir()
    s, _sp, _user, _made = shell(tmp_path / "one")
    info = call(s, "GET", "app")[1]
    assert info["genie"] == info["pages"][0]["genie"] and info["genie"]["enabled"] is True


def test_asking_on_a_page_goes_to_that_page_s_genie_agent_and_a_joined_page_or_the_hub_never_asks(tmp_path):
    s, sp_ws, _user, _made = hub(tmp_path)
    assert call(s, "POST", "genie/ask", body={"page": "n02_u01", "question": "Which trips stand out?"})[0] == 200
    assert call(s, "POST", "genie/ask", body={"page": "n01_u05", "question": "Which items lose most?"})[0] == 200
    assert sp_ws.genie == [(SECOND_SPACE, "Which trips stand out?", ""), (FIRST_SPACE, "Which items lose most?", "")]
    assert call(s, "POST", "genie/ask", body={"page": "n03_u01", "question": "q"}) == (409, {"error": shell_core.JOINED_GENIE_NOTE})
    for screen in OLD_SCREENS:
        assert call(s, "POST", "genie/ask", body={"page": screen, "question": "q"}) == refused(screen)
    assert call(s, "POST", "genie/ask", body={"question": "q"}) == (400, {"error": "name the page whose use case Genie answers about"})
    assert call(s, "POST", "genie/ask", body={"page": "n09_u09", "question": "q"}) == (404, {"error": "the App has no page 'n09_u09'"})
    assert len(sp_ws.genie) == 2


def test_the_answer_is_read_from_the_genie_agent_of_the_page_that_asked(tmp_path):
    s, sp_ws, _user, _made = hub(tmp_path)
    status, _msg = call(s, "GET", "genie/message", query={"page": "n02_u01", "conversation_id": "c1", "message_id": "m1"})
    assert status == 200 and sp_ws.genie[-1][0] == SECOND_SPACE
    assert call(s, "GET", "genie/message", query={"page": "n03_u01", "conversation_id": "c1", "message_id": "m1"})[0] == 409
    assert call(s, "GET", "genie/message", query={"page": "overview", "conversation_id": "c1", "message_id": "m1"})[0] == 404
    assert call(s, "GET", "genie/message", query={"conversation_id": "c1", "message_id": "m1"})[0] == 400
    assert len(sp_ws.genie) == 1


def test_explaining_a_chart_asks_the_page_s_genie_agent_and_names_the_hub_not_the_first_use_case(tmp_path):
    s, sp_ws, _user, _made = hub(tmp_path)
    status, out = call(s, "POST", "genie/explain", body=explain_body(page="n02_u01"))
    assert status == 200 and sp_ws.genie[-1][0] == SECOND_SPACE
    assert out["question"].startswith('Explain a chart from the App "Acme taxis - Databricks Inspire Use Cases Hub", on the page '
                                      '"Unusual trip queue" (N02-U01).')
    assert "Pricing desk" not in out["question"]
    record = explain_body(page="n02_u01", kind="record", title="Trip 7", context=copy.deepcopy(RECORD))
    assert call(s, "POST", "genie/explain", body=record)[0] == 200 and sp_ws.genie[-1][0] == SECOND_SPACE
    assert call(s, "POST", "genie/explain", body=explain_body(page="n03_u01")) == (409, {"error": shell_core.JOINED_GENIE_NOTE})
    assert len(sp_ws.genie) == 2


def test_a_hub_or_a_one_page_app_refuses_the_old_hub_screens_and_a_one_page_app_still_asks_without_naming_its_page(tmp_path):
    (tmp_path / "hub").mkdir()
    s, sp_ws, _user, _made = hub(tmp_path / "hub")
    (tmp_path / "one").mkdir()
    one, one_ws, _user, _made = shell(tmp_path / "one")
    for screen in OLD_SCREENS:
        body = explain_body(page=screen, title="Could save, by use case", context=copy.deepcopy(CHART))
        assert call(s, "POST", "genie/explain", body=body) == refused(screen)
        assert call(one, "POST", "genie/explain", body=body) == refused(screen)
        assert call(one, "POST", "genie/ask", body={"page": screen, "question": "Why?"}) == refused(screen)
    assert call(one, "POST", "genie/ask", body={"question": "Why?"})[0] == 200
    assert sp_ws.genie == [] and [g[0] for g in one_ws.genie] == [FIRST_SPACE]
