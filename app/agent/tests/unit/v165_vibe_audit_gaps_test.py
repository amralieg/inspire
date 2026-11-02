import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v161_app_column_filters_test import returns_page  # noqa: F401
import shell_sql  # noqa: E402

ASSET = "app:page:n01_u01"
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000")
PAGE = {"id": "n01_u01", "title": "Loss desk", "question": "Which stores lose the most?", "hue": "teal",
        "records": {"title": "Fix plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                    "columns": [{"column": "channel", "label": "Channel"}]},
        "blocks": [{"id": "hero", "kind": "image", "place": {"where": "top"}, "width": "half", "align": "center",
                    "content": {"file": "", "alt": "Mickey Mouse", "caption": "Our mascot", "url": "https://example.com/m.png"}}]}
ROSTER = [{"name": "a", "llm_endpoint_name": "ep-think-large", "type": "thinker", "size": "large", "order": 1, "enabled": True},
          {"name": "b", "llm_endpoint_name": "ep-work-small", "type": "worker", "size": "small", "order": 2, "enabled": True}]
GENIE_ENDPOINT = {"name": "g", "llm_endpoint_name": "databricks-gpt-5-6-sol", "type": "worker", "size": "small", "order": 9, "enabled": True}
UNCHECKED_AGAIN = ". Nothing shows the ask was missed: press Try again to check it again"
PARTS = ("notebook", "ai_reasoning", "value_formula", "dashboard", "genie_space", "app", "alert")


def _ask(text, check=None, where="", keep=False):
    return {"ask": text, "check": check, "keep": keep, "where": where}


def _llm(inst, splits, verdicts=()):
    seen = []

    def llm(kind, prompt, schema):
        seen.append((kind, prompt))
        if kind == "split":
            return {"asks": splits[prompt.split('"""\n', 1)[1].rsplit('\n"""', 1)[0]]}
        return {"checks": [dict({"n": n, "where": ""}, **verdict) for n, verdict in enumerate(verdicts, 1)]}

    inst._implement_vibes_llm = llm
    return seen


def _image(page=PAGE):
    return [{"block": "hero", "file": "", "alt": "Mickey Mouse", "caption": "Our mascot", "url": "https://example.com/m.png",
             "media_type": "image/png", "bytes": PNG, "error": ""}]


def _vision(inst, answers):
    paths = []

    def api(method, path, body=None, query=None):
        paths.append(path)
        endpoint = path.split("/")[2]
        answer = answers.get(endpoint, RuntimeError(f"ENDPOINT_NOT_FOUND: {endpoint} does not exist"))
        if isinstance(answer, Exception):
            raise answer
        return {"choices": [{"message": {"content": [{"type": "reasoning", "summary": []}, {"type": "text", "text": json.dumps(answer)}]}}]}

    inst._implement_api = api
    return paths


def _roster(agent_ns, monkeypatch, models):
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"], "models", [dict(m) for m in models])


def _image_round(inst, ask="Show Mickey Mouse", check=None, page=PAGE):
    _llm(inst, {ask: [_ask(ask, check or {"kind": "image", "value": "Mickey Mouse"})]})
    return inst._implement_vibes_round({}, [{"asset": ASSET, "text": ask, "artifact": page, "images": lambda: _image(page)}], "test")


YES = {"subject": True, "look": True, "reason": "it shows Mickey Mouse"}


def test_a_roster_without_the_genie_code_endpoint_checks_the_picture_through_its_own_first_endpoint(agent_ns, monkeypatch):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    paths = _vision(inst, {"ep-think-large": YES})
    found = _image_round(inst)
    assert found["checks"][ASSET][0]["status"] == "done"
    assert paths == ["/serving-endpoints/ep-think-large/invocations"]
    assert agent_ns["implement_vision_endpoints"]() == ["ep-think-large", "ep-work-small"]
    assert "IMPLEMENT_VIBES_VISION_ENDPOINT" not in agent_ns


def test_the_genie_code_endpoint_goes_first_only_when_the_roster_names_it(agent_ns, monkeypatch):
    _roster(agent_ns, monkeypatch, ROSTER + [GENIE_ENDPOINT])
    assert agent_ns["implement_vision_endpoints"]() == ["databricks-gpt-5-6-sol", "ep-think-large", "ep-work-small"]


def test_an_endpoint_that_refuses_pictures_falls_through_to_the_next(agent_ns, monkeypatch):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    paths = _vision(inst, {"ep-think-large": RuntimeError("BAD_REQUEST: image input is not supported"), "ep-work-small": YES})
    found = _image_round(inst)
    assert found["checks"][ASSET][0]["status"] == "done"
    assert paths == ["/serving-endpoints/ep-think-large/invocations", "/serving-endpoints/ep-work-small/invocations"]
    _image_round(inst)
    assert paths[-1] == "/serving-endpoints/ep-work-small/invocations" and len(paths) == 3, "a refusal is tried last after that"


def test_every_endpoint_refusing_leaves_the_ask_unchecked_naming_each_and_why_and_nothing_outside_the_roster_is_called(agent_ns,
                                                                                                                       monkeypatch):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    paths = _vision(inst, {"ep-think-large": RuntimeError("BAD_REQUEST: image input is not supported"),
                           "ep-work-small": {"verdict": "maybe"}})
    found = _image_round(inst)
    [check] = found["checks"][ASSET]
    assert check["status"] == "missing" and check["evidence"].startswith("Inspire could not check this ask: block hero: no model of this "
                                                                         "workspace could see the picture: ")
    assert "ep-think-large: BAD_REQUEST: image input is not supported" in check["evidence"]
    assert "ep-work-small: it gave no verdict" in check["evidence"]
    assert found["resend"] == {}
    assert {p.split("/")[2] for p in paths} <= {m["llm_endpoint_name"] for m in ROSTER}
    assert "databricks-gpt-5-6-sol" not in " ".join(paths), "a name the roster does not hold is never called"


def test_placement_is_never_judged_from_the_picture(agent_ns, monkeypatch):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Mickey Mouse in the middle of the page"
    sent = []
    paths = _vision(inst, {"ep-think-large": {"subject": True, "look": True, "reason": "Mickey Mouse stands on the left side of the picture"}})
    api = inst._implement_api
    inst._implement_api = lambda method, path, body=None, query=None: sent.append(body) or api(method, path, body, query)
    found = _image_round(inst, ask, [{"kind": "block", "value": {"kind": "image", "align": "center"}},
                                     {"kind": "image", "value": "Mickey Mouse"}])
    [check] = found["checks"][ASSET]
    assert check["status"] == "done" and check["checks"] == [{"name": "block: kind image, align center", "passed": True},
                                                              {"name": "image: Mickey Mouse", "passed": True}]
    text = sent[0]["messages"][0]["content"][0]["text"]
    assert ("Where the picture sits on the page and where the subject sits in the frame are checked elsewhere, so never answer false "
            "because of a position. Reply with one JSON object") in text and "where it sits in the picture" not in text
    assert '"subject": true or false, "look": true or false' in text
    assert "never where it sits" in agent_ns["implement_vibes_split_prompt"](ASSET, ask)
    _vision(inst, {"ep-think-large": {"subject": True, "look": False, "reason": "a pencil sketch, not the cartoon look"}})
    found = _image_round(inst, "Show cartoon Mickey Mouse", {"kind": "image", "value": "cartoon Mickey Mouse"})
    assert found["checks"][ASSET][0]["status"] == "missing", "the look still decides"
    assert paths


def _dashboard_page(agent_ns, with_image=True):
    page = {"id": "n01_u01", "title": "Loss desk", "charts": [{"id": "trend", "type": "line", "title": "Loss trend", "x": {"column": "d"},
                                                              "y": [{"label": "Loss"}]}]}
    if with_image:
        page["blocks"] = [{"id": "mascot", "kind": "image", "place": {"where": "top"}, "width": "half",
                           "content": {"file": agent_ns["implement_block_file"](PNG, shell_sql), "alt": "Mickey Mouse",
                                       "url": "https://example.com/m.png"}}]
    return page


def _dashboard_gate(agent_ns, inst, tmp_path, page, answers, round_no=1, ask="Show Mickey Mouse on top",
                    check=None):
    inst.local_log_output_dir = str(tmp_path)
    for block in page.get("blocks") or []:
        stored = tmp_path / "implement" / "_app_blocks" / block["content"]["file"]
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_bytes(PNG)
    _llm(inst, {ask: [_ask(ask, check or {"kind": "image", "value": "Mickey Mouse"})]}, [{"status": "done", "evidence": "Loss trend"}])
    paths = _vision(inst, answers)
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {"dashboard": True, "dashboard_vibes": ask}},
               "asset_status": {}, "genie_round": {"name": "dashboard", "round": round_no, "rounds": 3}}
    return context, paths


def test_a_dashboard_picture_goes_through_the_same_image_check(agent_ns, monkeypatch, tmp_path):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    page = _dashboard_page(agent_ns)
    context, paths = _dashboard_gate(agent_ns, inst, tmp_path, page, {"ep-think-large": dict(YES, subject=False, reason="a cartoon cat")})
    with pytest.raises(agent_ns["ImplementAsksMissed"]) as missed:
        inst._implement_output_vibes_gate(context, "dashboard", page)
    assert "'Show Mickey Mouse on top': block mascot: a cartoon cat" in missed.value.missed
    context, paths = _dashboard_gate(agent_ns, inst, tmp_path, page, {"ep-think-large": YES}, round_no=2)
    inst._implement_output_vibes_gate(context, "dashboard", page)
    assert context["round_vibes"]["dashboard"]["checks"]["dashboard"][0]["status"] == "done"
    images = inst._implement_dashboard_block_images(page)
    assert images[0]["bytes"] == PNG and images[0]["error"] == "" and images[0]["media_type"] == "image/png"


def test_a_dashboard_picture_missing_from_the_store_is_fetched_and_checked_against_inspires_copy(agent_ns, monkeypatch, tmp_path):
    inst = _inspire(agent_ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    page = _dashboard_page(agent_ns)
    monkeypatch.setitem(agent_ns, "implement_checked_image", lambda url, shell: (PNG, ""))
    assert inst._implement_dashboard_block_images(page)[0]["bytes"] == PNG
    monkeypatch.setitem(agent_ns, "implement_checked_image", lambda url, shell: (PNG + b"changed", ""))
    assert inst._implement_dashboard_block_images(page)[0]["error"] == "Inspire's copy is not the image Inspire checked"


def test_a_dashboard_with_no_picture_is_unchanged(agent_ns, monkeypatch, tmp_path):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    page = _dashboard_page(agent_ns, with_image=False)
    context, paths = _dashboard_gate(agent_ns, inst, tmp_path, page, {}, ask="Show the loss trend",
                                     check={"kind": "text", "value": "Loss trend"})
    inst._implement_output_vibes_gate(context, "dashboard", page)
    assert context["round_vibes"]["dashboard"]["checks"]["dashboard"][0]["status"] == "done" and paths == []
    assert inst._implement_dashboard_block_images(page) == []


def test_the_restyle_hands_its_live_page_to_the_build_so_a_snapshot_is_saved(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    emitted = []
    inst._implement_emit = lambda *args, **kwargs: emitted.append(args[1:3])
    inst._implement_app_kept_settings = lambda context, host, core: {"genie": {}}
    inst._implement_app_redeploy = lambda *args: ({"app_name": "churn-desk", "app_url": "https://a"}, [],
                                                  {"kind": agent_ns["IMPLEMENT_APP_BACKENDS"][-1]})
    inst._implement_app_own_page = lambda context, host: "n01_u01"
    other = dict(PAGE, id="n02_u01", title="Another page")
    host = {"merged": False, "name": "churn-desk", "app": {}, "settings": {}, "pages": [other, PAGE], "notes": []}
    look = {"style": "a", "layout": "sidebar", "palette": "ocean", "theme": "dark"}
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {"app_look": look, "app_pages": {}}}}
    fields = inst._implement_app_restyle(context, host, {}, {"shell_core": None})
    assert fields["app_name"] == "churn-desk" and context["artifacts"]["app"] == PAGE
    assert context["artifacts"]["app"] is not PAGE, "the snapshot is a copy, never the App's own page object"


@pytest.mark.parametrize("palette,status", [("ocean", "done"), ("sunset", "missing")])
def test_a_look_change_on_an_app_holding_a_color_ask_judges_the_color_again_on_the_rebuilt_app(agent_ns, palette, status):
    from v143_vibes_test import _locked, _run
    from v148_asset_vibes_test import PAGE as BUILT_PAGE, PARTS as BUILT_PARTS, _carrying
    ask = "Use the ocean palette"
    inst, previous = _locked(agent_ns, {f"{ASSET}_vibes": ask})
    _carrying(inst, dict(BUILT_PARTS, **{ASSET: dict(BUILT_PARTS[ASSET], vibes_split={"text": ask, "asks": [_ask(ask, {"kind": "color",
                                                                                                                          "value": "ocean"})]},
                                                    vibes_checks=[{"ask": ask, "status": "done", "evidence": "palette ocean"}])}))
    inst._implement_app = lambda context, runner: (context.setdefault("artifacts", {}).__setitem__("app", json.loads(json.dumps(BUILT_PAGE)))
                                                   or {"app_name": "churn-desk", "app_url": "https://a"})
    inst._implement_runner = lambda uc: "genie"
    seen = _llm(inst, {ask: [_ask(ask, {"kind": "color", "value": "ocean"})]})
    _run(inst, dict(previous, outputs={**previous["outputs"], "app_look": {"palette": palette}}))
    final = inst.updates[-1]["asset_status"]
    [check] = final[ASSET]["vibes_checks"]
    assert check["status"] == status and check["checks"] == [{"name": "color: ocean", "passed": status == "done"}]
    assert final["app"]["snapshot"] is True and final[ASSET]["spec_version"] == 3
    assert [e["status"] for e in final["checklist"]] == ["met" if status == "done" else "not_met"]
    assert not [k for k, _p in seen if k == "split"], "the unchanged text keeps its stored asks"


def test_a_look_change_with_no_live_page_checks_the_saved_copy_and_never_copies_old_verdicts(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Use the ocean palette"
    _llm(inst, {ask: [_ask(ask, {"kind": "color", "value": "ocean"})]})
    inst._implement_snapshot = lambda key, name, version: {"artifact": dict(PAGE, hue="")}
    before = {"state": "ready", "spec_version": 2, "snapshot": True}
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "asset_status": {"app": dict(before), ASSET: {
        "vibes_split": {"text": ask, "asks": []}, "vibes_checks": [{"ask": ask, "status": "done", "evidence": "palette ocean"}]}},
               "spec": {"outputs": {"app": True, "app_look": {"palette": "sunset"}, f"{ASSET}_vibes": ask}}, "vibes_split": {}}
    warnings = inst._implement_kept_vibes(context, "app", {ASSET: ask}, before)
    assert context["asset_status"][ASSET]["vibes_checks"][0]["status"] == "missing" and warnings
    context["asset_status"]["app"] = {}
    context.pop("previous_artifacts")
    inst._implement_kept_vibes(context, "app", {ASSET: ask}, {})
    [check] = context["asset_status"][ASSET]["vibes_checks"]
    assert check["status"] == "missing" and check["evidence"].startswith("Inspire could not check this ask: the App only changed its look")


def test_a_color_ask_a_restyle_newly_meets_is_met_and_never_called_nothing_new(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    ask = "Use the ocean palette"
    _llm(inst, {ask: [_ask(ask, {"kind": "color", "value": "ocean"})]})
    inst._implement_snapshot = lambda key, name, version: {"artifact": dict(PAGE, hue="")}
    before = {"state": "ready", "spec_version": 2, "snapshot": True}
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "asset_status": {"app": dict(before), ASSET: {
        "vibes_split": {"text": ask, "asks": []}, "vibes_checks": [{"ask": ask, "status": "missing", "evidence": "palette sunset"}]}},
               "spec": {"outputs": {"app": True, "app_look": {"palette": "ocean"}, f"{ASSET}_vibes": ask}}, "vibes_split": {}}
    items = inst._implement_output_vibe_items(context, "app", {ASSET: ask}, dict(PAGE, hue=""), [], before=before)
    assert items[0]["built_before"] is not None and items[0]["asked_before"] == set(), "the ask was not met before, so it is new work"
    [check] = inst._implement_vibes_round({}, items, "test")["checks"][ASSET]
    assert check["status"] == "done" and check["evidence"] == "the built App page n01_u01 shows ocean: palette ocean"


def test_an_unchanged_vibe_reuses_its_stored_asks_with_no_split_even_from_an_old_record(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    text = "Show the Fix plan table"
    stored = {ASSET: {"vibes_split": {"text": text, "asks": [{"ask": text, "check": None, "where": "the Fix plan table"}]}}}
    seen = _llm(inst, {text: [_ask("Display the table called Fix plan")]}, [{"status": "done", "evidence": "Fix plan"}])
    found = inst._implement_vibes_checks(agent_ns["implement_vibes_seed"](stored), ASSET, text, PAGE, built_before=dict(PAGE, title="x"))
    assert [c["ask"] for c in found] == [text], "the reworded split can no longer replace the stored asks"
    assert [kind for kind, _prompt in seen] == ["judge"]


def test_an_edited_vibe_splits_again_its_old_asks_are_gone_and_the_split_sees_them(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    old, new = "Show the Fix plan table", "Show the Fix plan table and add a map"
    cache = agent_ns["implement_vibes_seed"]({ASSET: {"vibes_split": {"text": old, "asks": [_ask(old)]}}})
    seen = _llm(inst, {new: [_ask(old), _ask("Add a map")]}, [{"status": "done", "evidence": "Fix plan"}, {"status": "missing",
                                                                                                         "evidence": "no map"}])
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "asset_status": {ASSET: {"vibes_split": {"text": old, "asks": [_ask(old)]},
                                                                                          "vibes_checks": [{"ask": old, "status": "done",
                                                                                                            "evidence": "Fix"}]}},
               "vibes_split": cache}
    checks = inst._implement_vibes_checks(cache, ASSET, new, PAGE)
    inst._implement_record_vibes(context, ASSET, new, checks, "ready")
    record = context["asset_status"][ASSET]
    assert record["vibes_split"]["text"] == new and [a["ask"] for a in record["vibes_split"]["asks"]] == [old, "Add a map"]
    assert [c["ask"] for c in record["vibes_checks"]] == [old, "Add a map"]
    [split_prompt] = [prompt for kind, prompt in seen if kind == "split"]
    assert f"Inspire split this part's earlier words into these asks:\n1. {old}\n" in split_prompt


@pytest.mark.parametrize("stored", [None, {"text": "Show the Fix plan table", "asks": [{"ask": ""}]},
                                    {"text": "Show the Fix plan table", "asks": "broken"}], ids=["missing", "empty_ask", "corrupt"])
def test_a_missing_or_corrupt_stored_split_falls_back_to_a_fresh_split(agent_ns, stored):
    inst = _inspire(agent_ns, FakeSpark())
    text = "Show the Fix plan table"
    seen = _llm(inst, {text: [_ask(text)]}, [{"status": "done", "evidence": "Fix plan"}])
    cache = agent_ns["implement_vibes_seed"]({ASSET: {"vibes_split": stored}} if stored else {})
    assert inst._implement_vibes_checks(cache, ASSET, text, PAGE)[0]["status"] == "done"
    assert [kind for kind, _prompt in seen] == ["split", "judge"]


def _records(texts, done=True):
    return {asset: {"vibes_split": {"text": text}, "vibes_checks": [{"ask": text, "status": "done" if done else "missing",
                                                                     "evidence": "seen"}]} for asset, text in texts.items()}


def test_every_checklist_part_is_one_of_the_seven_and_every_status_is_met_or_not_met(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_emit = lambda *args, **kwargs: None
    texts = {"notebook": "Hold out 8 weeks", "ai_reasoning": "Answer in Spanish", "value_formula": "Count weeks left",
             "dashboard": "Put the trend first", "genie_space": "Explain rank 1", ASSET: "Show the Fix plan", "alert": "Send at 7am"}
    outputs = {"dashboard": True, "genie_space": True, "app": True, "alert": True, "ai_reasoning_vibes": texts["ai_reasoning"],
               "value_formula_vibes": texts["value_formula"], "dashboard_vibes": texts["dashboard"],
               "genie_space_vibes": texts["genie_space"], f"{ASSET}_vibes": texts[ASSET], "alert_vibes": texts["alert"]}
    cache = {(asset, text): [_ask(text)] for asset, text in texts.items()}
    status = _records(texts)
    status["genie_space"]["vibes_checks"][0].update(status="missing", evidence="Inspire could not check this ask: the endpoint is busy")
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": outputs, "data": {"notes": texts["notebook"]}},
               "asset_status": status, "vibes_split": cache, "vibes_checked": dict(texts)}
    entries = inst._implement_vibe_checklist(context)
    assert sorted(e["part"] for e in entries) == sorted(PARTS) and {e["status"] for e in entries} == {"met", "not_met"}
    unchecked = next(e for e in entries if e["part"] == "genie_space")
    assert unchecked["status"] == "not_met" and unchecked["evidence"].startswith("Inspire could not check this ask:")


def test_nothing_on_the_checklist_is_copied_from_a_record_this_version_did_not_check(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_emit = lambda *args, **kwargs: None
    text = "Show the Fix plan"
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "spec": {"outputs": {"app": True, f"{ASSET}_vibes": text}, "data": {}},
               "asset_status": _records({ASSET: text}), "vibes_split": {(ASSET, text): [_ask(text)]}}
    [entry] = inst._implement_vibe_checklist(context)
    assert entry["status"] == "not_met" and entry["unchecked"] is True
    assert entry["evidence"] == f"Inspire could not check this ask: Inspire did not check it in this version{UNCHECKED_AGAIN}"


def test_a_retried_ask_never_lets_the_other_asks_keep_their_old_verdicts(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    text = "Show the Fix plan and add a map"
    seen = _llm(inst, {text: [_ask("Show the Fix plan"), _ask("Add a map")]}, [{"status": "missing", "evidence": "no Fix plan"},
                                                                              {"status": "missing", "evidence": "no map"}])
    previous = [{"ask": "Show the Fix plan", "status": "done", "evidence": "old"}]
    found = inst._implement_vibes_round({}, [{"asset": ASSET, "text": text, "artifact": PAGE, "previous": previous, "retry": ["Add a map"]}],
                                        "test")
    assert [c["evidence"] for c in found["checks"][ASSET]] == ["no Fix plan", "no map"]
    [judge] = [prompt for kind, prompt in seen if kind == "judge"]
    assert "1. Show the Fix plan" in judge and "2. Add a map" in judge


def test_the_checklist_is_written_before_the_version_status_is_set(agent_ns):
    from v143_vibes_test import _locked, _run
    from v148_asset_vibes_test import PAGE as BUILT_PAGE, WIDGET_VIBES, _built, _carrying, _llm as built_llm, _vibed
    inst, previous = _locked(agent_ns)
    _carrying(inst)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_dashboard = _built("dashboard", BUILT_PAGE)
    built_llm(inst)
    order, update, checklist = [], inst._implement_update, inst._implement_vibe_checklist
    inst._implement_update = lambda key, **fields: order.append(("status", fields["status"]) if "status" in fields else ("update", "")) or \
        update(key, **fields)
    inst._implement_vibe_checklist = lambda context: order.append(("checklist", "")) or checklist(context)
    status = _run(inst, _vibed(previous, ["dashboard:by_region"], **{"dashboard:by_region_vibes": WIDGET_VIBES}))
    final_at = max(i for i, (kind, value) in enumerate(order) if kind == "status" and value == status)
    assert order.index(("checklist", "")) < final_at
    assert inst.updates[-1]["asset_status"]["checklist_summary"]["total"] == 2


class _Status(RuntimeError):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def _sequence(inst, replies):
    paths = []

    def api(method, path, body=None, query=None):
        endpoint = path.split("/")[2]
        paths.append(endpoint)
        answer = replies[endpoint].pop(0) if replies.get(endpoint) else YES
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps(answer)
        return {"choices": [{"message": {"content": [{"type": "text", "text": text}]}}]}

    inst._implement_api = api
    return paths


@pytest.mark.parametrize("failure", [RuntimeError("TEMPORARILY_UNAVAILABLE: the request timed out"), _Status(503, "Service Unavailable"),
                                     _Status(504, "Gateway Timeout"), RuntimeError("Read timed out"), "{not json at all"],
                         ids=["unavailable", "503", "504", "timeout", "garbled_reply"])
def test_an_endpoint_that_fails_for_a_passing_reason_keeps_its_place_for_the_next_picture(agent_ns, monkeypatch, failure):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    paths = _sequence(inst, {"ep-think-large": [failure]})
    _image_round(inst)
    assert paths == ["ep-think-large", "ep-work-small"]
    _image_round(inst)
    assert paths[2:] == ["ep-think-large"], "after a timeout, a server error or a garbled reply the endpoint is tried first again"


@pytest.mark.parametrize("refusal", [_Status(400, "BAD_REQUEST: image_url content is not supported"), _Status(404, "ENDPOINT_NOT_FOUND"),
                                     RuntimeError("BAD_REQUEST: image input is not supported for this endpoint"),
                                     "I cannot view images, so I cannot tell what the picture shows."],
                         ids=["400", "404", "bad_request_text", "says_it_cannot_read_images"])
def test_an_endpoint_that_refuses_pictures_for_good_is_tried_last_after_that(agent_ns, monkeypatch, refusal):
    _roster(agent_ns, monkeypatch, ROSTER)
    inst = _inspire(agent_ns, FakeSpark())
    paths = _sequence(inst, {"ep-think-large": [refusal]})
    _image_round(inst)
    assert paths == ["ep-think-large", "ep-work-small"]
    _image_round(inst)
    assert paths[2:] == ["ep-work-small"], "a refusal for good moves the endpoint to the end"
    paths.clear()
    _sequence(inst, {"ep-work-small": [_Status(503, "Service Unavailable")]})
    found = _image_round(inst)
    assert found["checks"][ASSET][0]["status"] == "done", "a demoted endpoint is still tried before giving up"
