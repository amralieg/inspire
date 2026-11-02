import importlib.util
import json
import os
import sys

import pytest

from v140_implement_test import VALID, _churn_page
from v142_dash_test import _runner as _pages
from v142_merge_test import _host_files, _host_page, _merge_flow
from v164_inside_inspire_deploy_test import _builder, _written

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
WEB = os.path.join(ROOT, "agent", "app_shell", "web", "src")
URL = VALID["outputs"]["inspire_url"]


def _server():
    sys.path.insert(0, SERVER)
    try:
        modules = {}
        for name in ("shell_sql", "shell_core"):
            spec = importlib.util.spec_from_file_location(name, os.path.join(SERVER, f"{name}.py"))
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            spec.loader.exec_module(module)
            modules[name] = module
        return modules
    finally:
        sys.path.remove(SERVER)


def _review(ns, uc_id="N01-U01", session=5150):
    return ns["implement_review_link"](URL, session, uc_id)


def _page_files(files):
    return {name: json.loads(body) for name, body in files.items() if name.startswith("pages/")}


def test_every_page_inspire_writes_carries_the_review_link_of_its_own_use_case_and_drops_one_genie_wrote(agent_ns):
    page = agent_ns["implement_app_page"](dict(_churn_page(agent_ns), review="javascript:alert(1)"), "N01-U01", {}, "main.inspire.churn_out",
                                          review=_review(agent_ns))
    assert page["review"] == f"{URL}/?review=5150&uc=N01-U01"
    bare = agent_ns["implement_app_page"](dict(_churn_page(agent_ns), review="javascript:alert(1)"), "N01-U01", {}, "main.inspire.churn_out")
    assert "review" not in bare, "a page Genie wrote never keeps a review link Inspire did not build"


def test_an_app_of_its_own_writes_its_page_with_the_review_link(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, hosted=False)
    inst._implement_app(context, _pages(_churn_page(agent_ns)))
    pages = _page_files(seen["deployed"][0][1])
    assert [page["review"] for page in pages.values()] == [_review(agent_ns)]


def test_a_page_inside_inspire_writes_the_review_link_and_says_it_runs_inside(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch)
    inst._implement_app(context, _pages(_churn_page(agent_ns)))
    written = _written(seen["calls"])
    pages = [json.loads(body) for path, body in written.items() if "/pages/" in path]
    assert [page["review"] for page in pages] == [_review(agent_ns)]
    settings = json.loads(next(body for path, body in written.items() if path.endswith("/inspire_app.json")))
    assert settings["host"] == "inspire"


@pytest.mark.parametrize("placement", ["domain", "business"])
def test_a_shared_app_keeps_each_use_cases_own_review_link_on_its_own_page(agent_ns, tmp_path, monkeypatch, placement):
    host = dict(_host_page(agent_ns), review=agent_ns["implement_review_link"](URL, 4242, "N01-U07"))
    files = _host_files(agent_ns, tmp_path, pages=[host])
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, files=files, outputs={"app_placement": placement})
    inst._implement_app(context, None)
    assert seen["errors"] == []
    pages = {page["use_case_id"]: page["review"] for page in _page_files(seen["deployed"][-1][1]).values()}
    assert pages == {"N01-U07": f"{URL}/?review=4242&uc=N01-U07", "N01-U01": _review(agent_ns)}


def test_the_shell_shows_only_inspires_review_link_for_a_named_use_case_and_refuses_to_load_any_other(agent_ns):
    modules = _server()
    shell_sql, shell_core = modules["shell_sql"], modules["shell_core"]
    good = f"{URL}/?review=5150&uc=N01-U01"
    base = {"id": "n01_u01", "use_case_id": "N01-U01"}
    assert shell_sql.review_problems(dict(base, review=good)) == [] and shell_sql.review_problems(base) == []
    assert shell_core.public_page(dict(base, review=good))["review"] == good
    assert shell_core.public_page(base)["review"] == ""
    for session, case in (("5150", "N01-U01"), ("run 7/a&b+c", "Ν01·Υ01"), ("2222222222222222222", "n01-u01_x.y~z")):
        assert shell_sql.review_problems(dict(base, review=agent_ns["implement_review_link"](URL, session, case))) == [], (session, case)
    for bad in ("javascript:alert(1)", "http://inspire.example.com/?review=5150&uc=N01-U01", f"{URL}/?review=5150",
                f"{URL}/?review=5150&uc=N01-U01&x=1", "https://Inspire.example.com/?review=5150&uc=N01-U01",
                f"{URL}/?review=5 150&uc=N01-U01", f"{URL}/?uc=N01-U01&review=5150", f"{URL}/?review=&uc=N01-U01", 5150, ["x"]):
        assert shell_sql.review_problems(dict(base, review=bad)) == [
            "the page review must be the link to its use case on Inspire's Review page, as Inspire writes it"], bad
    lost = {"id": "n01_u01", "review": good}
    assert shell_sql.review_problems(lost) == ["the page has a review link but no use_case_id, so the link names no use case"]
    page = dict(_churn_page(agent_ns), review="javascript:alert(1)")
    assert "page n01_u05: the page review must be the link to its use case on Inspire's Review page, as Inspire writes it" in (
        shell_core.settings_problems({"pages": [page["id"]]}, [page]))


def test_the_review_label_inspire_writes_is_the_one_the_app_shows(agent_ns):
    with open(os.path.join(WEB, "Home.jsx"), encoding="utf-8") as handle:
        home = handle.read()
    assert f"export const REVIEW_LABEL = '{agent_ns['IMPLEMENT_REVIEW_LABEL']}';" in home
    assert agent_ns["IMPLEMENT_REVIEW_LABEL"] == "Open in Inspire Review"
