import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")


def _code():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        cells = json.load(handle)["cells"]
    return "".join("".join(c["source"]) + "\n" for c in cells if c["cell_type"] == "code")


def test_one_builder_makes_every_link_with_each_part_quoted_and_one_slash(agent_ns):
    link = agent_ns["implement_link"]
    assert link("https://inspire.example.com", review="2222222222222222222", uc="N01-U01") == (
        "https://inspire.example.com/?review=2222222222222222222&uc=N01-U01")
    assert link("https://inspire.example.com/", run="n01-u01-5150") == "https://inspire.example.com/?run=n01-u01-5150"
    assert link(" https://inspire.example.com// ", run="x") == "https://inspire.example.com/?run=x"
    assert link("https://inspire.example.com", review="a b/c&d+e", uc="Ν01·Υ01") == (
        "https://inspire.example.com/?review=a%20b%2Fc%26d%2Be&uc=%CE%9D01%C2%B7%CE%A501")
    assert link("https://inspire.example.com", review="run=1#x?y") == "https://inspire.example.com/?review=run%3D1%23x%3Fy"
    assert link("https://inspire.example.com") == "https://inspire.example.com/"
    assert link("", run="x") == link(None, run="x") == link("  ", run="x") == ""


def test_the_review_link_needs_the_session_and_the_use_case_and_never_a_half_link(agent_ns):
    review = agent_ns["implement_review_link"]
    assert review("https://inspire.example.com", 2222222222222222222, "N01-U01") == (
        "https://inspire.example.com/?review=2222222222222222222&uc=N01-U01")
    assert review("https://inspire.example.com", " 7 ", " N01-U01 ") == "https://inspire.example.com/?review=7&uc=N01-U01"
    for session, case in (("", "N01-U01"), (None, "N01-U01"), ("7", ""), ("7", None), ("  ", "N01-U01")):
        assert review("https://inspire.example.com", session, case) == "", (session, case)
    assert review("", "7", "N01-U01") == ""


def test_the_email_lines_go_through_the_builder(agent_ns):
    line = agent_ns["implement_digest_page_line"]
    assert line("https://churn-desk-5150.example.com/", "", "") == "Open the Impact page of the App: https://churn-desk-5150.example.com/?open=impact"
    assert line("", "n01-u01-5150", "https://inspire.example.com") == (
        "Open this use case's page in Inspire's Run tab: https://inspire.example.com/?run=n01-u01-5150")


def test_the_notebook_formats_a_link_query_in_one_place_only():
    code = _code()
    builder = re.search(r"\ndef implement_link\(.*?\n(?=\n\S)", code, re.S).group(0)
    rest = code.replace(builder, "")
    assert code.count(builder) == 1
    assert "urllib.parse.quote(" in builder and "urllib.parse.quote(" not in rest
    assert "urlencode(" not in code
    hand_built = re.findall(r"f[\"'][^\"'\n]*/\?[A-Za-z_]+=", rest) + re.findall(r"[\"']/\?[A-Za-z_]+=[\"']?", rest)
    assert hand_built == [], hand_built
