"""Every dashboard Inspire builds links its use case on Inspire's Review page, from the one link the page carries, and a page with no
link to a use case never shows one."""
from v140_implement_test import _churn_page
from v142_dash_test import RESULT, _canvas, _doc, _flow, _page, _runner, _shell

URL = "https://inspire.example.com"


def _texts(doc):
    return {w["widget"]["name"]: w for w in _canvas(doc)[0]["layout"] if "multilineTextboxSpec" in w["widget"]}


def _line(ns, review):
    return [f"[{ns['IMPLEMENT_REVIEW_LABEL']}]({review}) to read how Inspire found and scored this use case."]


def test_the_dashboard_links_its_use_case_on_inspire_s_review_page(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    review = agent_ns["implement_review_link"](URL, 5150, "N01-U01")
    assert review == f"{URL}/?review=5150&uc=N01-U01"
    link = _texts(_doc(seen))["review_link"]
    assert link["widget"]["multilineTextboxSpec"]["lines"] == _line(agent_ns, review)
    assert link["position"] == {"x": 0, "y": 2, "width": 12, "height": 1}, "the link sits right under the page's title and question"


def test_the_review_link_follows_the_genie_agent_link(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"genie_space_name": "Churn desk"}, assets={"genie_space": "g1"})
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    texts = _texts(_doc(seen))
    assert texts["genie_link"]["position"]["y"] == 2 and texts["review_link"]["position"] == {"x": 0, "y": 3, "width": 12, "height": 1}


def test_the_review_link_carries_the_address_and_use_case_quoted_once(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"inspire_url": "https://Inspire-2.example.com/"})
    context.update(uc_id="N01 U/7&x")
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    lines = _texts(_doc(seen))["review_link"]["widget"]["multilineTextboxSpec"]["lines"]
    assert lines == _line(agent_ns, "https://inspire-2.example.com/?review=5150&uc=N01%20U%2F7%26x")


def test_a_page_with_no_review_link_has_no_review_widget_and_the_same_layout(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    assert "review" not in page
    bare = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    linked = agent_ns["implement_dashboard_from_page"](dict(page, review=f"{URL}/?review=5150&uc=N01-U01"), shell_sql, RESULT, {})
    assert "review_link" not in _texts(bare) and "review_link" in _texts(linked)
    before = {w["widget"]["name"]: w["position"] for w in _canvas(bare)[0]["layout"]}
    after = {w["widget"]["name"]: w["position"] for w in _canvas(linked)[0]["layout"] if w["widget"]["name"] != "review_link"}
    assert before.keys() == after.keys()
    assert all(after[n] == (p if n == "header" else dict(p, y=p["y"] + 1)) for n, p in before.items()), \
        "the link adds one row under the header and moves nothing else"
    assert [p["layout"] for p in _canvas(bare)[1:]] == [p["layout"] for p in _canvas(linked)[1:]], "only the main page has the link"
    for empty in ("", None):
        assert "review_link" not in _texts(agent_ns["implement_dashboard_from_page"](dict(page, review=empty), shell_sql, RESULT, {}))
