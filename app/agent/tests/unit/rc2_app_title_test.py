"""REQ-063: the App page title and the App title are the use case name the Build card shows, never a title Genie wrote.

Walk evidence (rc.7, franchises MVP): the Build card read "Restore Sales At Silent Franchises" while the published App header read
"Silent franchise sales monitor", the title Genie wrote into the page spec. Fail-pre: before the fix the deployed page kept Genie's
title, so the first test fails. The must-exclude cases pin the typed-name precedence, the 80-character clip and the no-name fallback.
"""
import copy
import types
import json
import os

from v120_artifacts_support import FakeSpark
from v140_implement_test import _churn_page, _inspire
from v142_dash_test import _runner as _pages_of

GENIE_TITLE = "Silent franchise sales monitor"
NAME = "Restore Sales At Silent Franchises"
TYPED = "Franchise sales watch"


# REQ-354 REQ-011 (734886e3d): the App settings read the siblings through the shell_sql module; no sibling rows here.
NO_SIBLINGS = types.SimpleNamespace(sibling_items=lambda rows, ucs: [])


class _Runner:
    def __init__(self, page):
        self.page = page

    def run(self, prompt, work, schema, label=""):
        with open(os.path.join(work, "page.json"), "w", encoding="utf-8") as handle:
            json.dump(self.page, handle)
        return {"exit": 0}


def _deployed_title(agent_ns, tmp_path, use_case, genie_title=GENIE_TITLE):
    page = _churn_page(agent_ns, id="n02_u01", use_case_id="N02-U01", title=genie_title)
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._implement_input_has_dates = lambda context: False
    inst._implement_app_prompt = lambda context, shell_sql, example, event_date, name: "Write page.json."
    inst._implement_page_file = lambda context, name, work, shell_sql, event_date, fresh=False: (
        json.load(open(os.path.join(work, "page.json"), encoding="utf-8")), [])
    context = {"uc_id": "N02-U01", "key": (5150, "N02-U01", 1), "use_case": use_case,
               "spec": {"outputs": {"app": True, "app_access": "sp"}, "retry_asks": {}}, "asset_status": {}, "vibes_split": {}, "vibes_asks": {}}
    deployed = []

    def deploy(work, page, gate=lambda: None):
        gate()
        deployed.append(copy.deepcopy(page))
        return {"app_name": "inspire-hub", "app_url": "https://example.com/app"}

    inst._implement_page_spec(context, _Runner(page), "app", deploy)
    [built] = deployed
    return built


def test_the_page_title_is_the_use_case_name_not_the_title_genie_wrote(agent_ns, tmp_path):
    built = _deployed_title(agent_ns, tmp_path, {"No": "N02-U01", "Name": NAME})
    assert built["title"] == NAME, "the header, the browser tab and the rail read the Build card's name, whatever Genie wrote"


def test_a_typed_name_is_the_page_title_and_wins_over_the_generated_name(agent_ns, tmp_path):
    built = _deployed_title(agent_ns, tmp_path, {"No": "N02-U01", "Name": NAME, "user_use_case_name": TYPED})
    assert built["title"] == TYPED, "the Build card shows the typed name, so the App shows it too"


def test_a_name_with_no_text_leaves_the_page_title_as_written(agent_ns, tmp_path):
    built = _deployed_title(agent_ns, tmp_path, {"No": "N02-U01", "Name": "   "})
    assert built["title"] == GENIE_TITLE, "with no use case name there is nothing to set, so the written title stays"


def test_the_page_title_is_clipped_to_the_eighty_characters_the_page_accepts(agent_ns, tmp_path):
    long_name = " ".join(["Restore"] * 30)
    built = _deployed_title(agent_ns, tmp_path, {"No": "N02-U01", "Name": long_name})
    assert built["title"] == long_name[:80] and len(built["title"]) == 80


def test_the_helper_reads_the_card_name_and_the_typed_name_first(agent_ns):
    title = agent_ns["implement_use_case_title"]
    assert title({"Name": NAME}) == NAME
    assert title({"Name": NAME, "user_use_case_name": TYPED}) == TYPED
    assert title({"Name": "  Restore   Sales  "}) == "Restore Sales"
    assert title({"Name": None}) == "" and title(None) == ""


def test_the_app_settings_title_is_the_use_case_name_with_no_id_prefix(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    inst.business_name = ""
    inst._implement_builder = lambda: "builder@example.com"
    context = {"uc_id": "N02-U01", "key": (5150, "N02-U01", 1), "use_case": {"No": "N02-U01", "Name": NAME}, "job_id": 77,
               "spec": {"outputs": {"app_access": "sp"}}, "urls": {}}
    core = type("Core", (), {"SETTINGS_VERSION": 1})
    written = inst._implement_app_settings(context, {"shell_core": core, "shell_sql": NO_SIBLINGS}, {"id": "n02_u01"}, None, "off", context["spec"]["outputs"])
    assert written["title"] == NAME, "the App title is the use case name, the same text a rename writes"


def test_a_rename_moves_the_app_title_and_the_page_title_together(agent_ns):
    settings = {"title": NAME, "version": 1}
    pages = [{"id": "n02_u01", "title": NAME, "use_case_id": "N02-U01"}, {"id": "n09", "title": "Returns", "use_case_id": "N09-U03"}]
    renamed, moved = agent_ns["implement_app_renamed"](settings, pages, "n02_u01", "Restore Sales Across Franchises")
    assert renamed["title"] == "Restore Sales Across Franchises" and moved[0]["title"] == renamed["title"]
    assert moved[1]["title"] == "Returns", "another use case's page keeps its own title"


def test_an_heir_takes_the_app_title_as_the_use_case_name_not_an_id_prefix(agent_ns):
    held = {"title": "N01-U01 Old", "pages": [{"id": "n01_u01"}, {"id": "n02_u01"}], "jobs": {}, "alerts": {}}
    owner = {"use_case_id": "N02-U01", "name": NAME, "page_id": "n02_u01"}
    settings, _kept = agent_ns["implement_app_take_out"](held, [{"id": "n01_u01"}, {"id": "n02_u01", "title": NAME}], "n01_u01", owner)
    assert settings["title"] == NAME


def test_a_rolled_back_app_keeps_the_title_its_saved_version_had(agent_ns, tmp_path):
    """Must-exclude (coordinator, int2): a rollback replays a saved page, and that page keeps the title it was saved with, even
    when the use case now has another name. Only a fresh build from Genie takes the use case name."""
    from v142_dash_test import _flow
    from v143_vibes_test import _no_loop, _NoGenie, _saved
    from v143_vibes_test import _churn_page as _v143_page
    saved_page = _v143_page(agent_ns, title="Desk as it was in v1")
    built, built_context, built_seen = _flow(agent_ns, tmp_path, outputs={"dashboard": False})
    built._implement_app(built_context, _pages_of(saved_page))
    again, context, again_seen = _flow(agent_ns, tmp_path / "again", outputs={"dashboard": False}, assets={"app": "churn-desk"})
    again._implement_genie_loop = _no_loop
    context["replay"] = {"app": _saved(saved_page)}
    assert again._implement_app(context, _NoGenie())["app_name"] == "churn-desk"
    _name, files, _reads, _space = again_seen["deployed"][0]
    rolled = json.loads(files["pages/n01_u01.json"])
    assert rolled["title"] == "Desk as it was in v1", "a rollback restores the saved page, title included"
