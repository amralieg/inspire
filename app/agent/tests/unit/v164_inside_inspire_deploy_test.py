"""Inside Inspire on the agent side: a page hosted in Inspire's Run tab is written, as the exact App source Inspire would deploy, to
a folder per version, with no Databricks App, no grant to an App service principal and no App API call. The record names the live
version only, a held version writes its folder and leaves the live page as it is, Publish anyway moves it, Uninstall deletes every
version, and a move out of Inspire deletes the page only once the new App is published, offline."""
import base64
import json
import re
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import TRUTH, VALID, _churn_page, _contract, _FileRunner, _inspire, _left_by, _spec
from v142_dash_test import ROWS, _flow, _runner as _pages
from v142_merge_test import _serve_files
from v143_vibes_test import BUILT, LIVE, _locked, _run, _verdicts
from v162_app_blocks_test import FILE, PNG, _image_page

ASK = "Put the riskiest customers first"
MVP = "/W/acme/session_5150/Sales/N01-U01/mvp"
ID = "n01-u01-5150"
FOLDER = f"{MVP}/apps/{ID}"
OWN = {"app_access": "user", "app_backend": "delta", "app_warehouse_id": "wh2"}
HOSTED = dict(OWN, app_placement="inspire")
LIVE_HOSTED = {"id": ID, "source": f"{FOLDER}/v2", "version": 2, "warehouse_id": "wh2", "page": "n01_u01",
               "published_at": "2026-10-30T08:00:00Z"}
LIVE_RECORD = {"placement": "inspire", "hosted": LIVE_HOSTED, "app_name": "", "app_url": "", "state": "ready", "spec_version": 2,
               "title": "N01-U01 Predict churn"}
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")


def _hosted_spec(ns, **outputs):
    spec, errors = _spec(ns, outputs={**VALID["outputs"], **OWN, **outputs})
    assert errors == []
    spec["outputs"].update(app_placement="inspire", app_name="")
    return spec


def _app_calls(calls):
    return [c[:2] for c in calls if "/api/2.0/apps" in c[1] or "/permissions/apps" in c[1] or "entity-tag-assignments" in c[1]]


def _written(calls):
    return {c[2]["path"]: base64.b64decode(c[2]["content"]) for c in calls if c[:2] == ("POST", "/api/2.0/workspace/import")}


def _grants(spark):
    return [s for s in spark.statements if s.upper().startswith(("GRANT", "REVOKE"))]


def _dirs(inst):
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": MVP.rsplit("/", 1)[0], "mvp": MVP, "version": f"{MVP}/v{key[2]}"}


def _builder(ns, tmp_path, monkeypatch, hosted=True, asset_status=None, assets=None, version=2, listing=None, files=None):
    _serve_files(ns, monkeypatch, files or {})
    inst, context, seen = _flow(ns, tmp_path, outputs={"dashboard": False, **OWN}, asset_status=asset_status, assets=assets)
    if hosted:
        context["spec"] = _hosted_spec(ns, dashboard=False)
        del inst._implement_deploy_app
    context["key"] = (5150, "N01-U01", version)
    _dirs(inst)
    folders = dict(listing or {})

    def api(method, path, body=None, query=None):
        seen["calls"].append((method, path, body))
        if (method, path) == ("GET", "/api/2.0/workspace/list"):
            return {"objects": folders.get((query or {}).get("path"), [])}
        return {}

    inst._implement_api = api
    return inst, context, seen


def _own_files(ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(ns, tmp_path / "own", monkeypatch, hosted=False)
    inst._implement_app(context, _pages(_churn_page(ns)))
    return seen["deployed"][0][1]


def _settings(files):
    return {k: v for k, v in json.loads(files["inspire_app.json"]).items() if k != "built_at"}


def test_a_page_inside_inspire_is_the_app_source_written_to_its_version_folder_with_no_app_call_and_no_grant(agent_ns, tmp_path,
                                                                                                             monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch)
    granted = []
    inst._implement_grant = lambda *args, **kwargs: granted.append(args) or []
    try:
        fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    except Exception as error:
        fields = {"failed": str(error)}
    assert _app_calls(seen["calls"]) == [], "a page inside Inspire never creates, reads, starts, grants or tags a Databricks App"
    assert _grants(inst.spark) == [] and granted == [], "nothing is granted to any service principal"
    assert not any(c[0] == "DELETE" or "permissions" in c[1] for c in seen["calls"])
    written, own = _written(seen["calls"]), _own_files(agent_ns, tmp_path, monkeypatch)
    assert sorted(written) == sorted(f"{FOLDER}/v2/{relative}" for relative in own), "exactly the files the App deploy sends"
    for relative, text in own.items():
        if relative != "inspire_app.json":
            assert written[f"{FOLDER}/v2/{relative}"] == (text if isinstance(text, bytes) else text.encode("utf-8")), relative
    settings = json.loads(written[f"{FOLDER}/v2/inspire_app.json"])
    assert settings["auth"] == "user" and settings["backend"] == {"kind": "delta"} and settings["host"] == "inspire"
    assert "host" not in _settings(own), "only a page inside Inspire says where it runs; an App of its own keeps its service principal"
    same = {k: v for k, v in settings.items() if k not in ("built_at", "feedback_table")}
    assert same == dict({k: v for k, v in _settings(own).items() if k != "feedback_table"}, host="inspire")
    assert settings["feedback_table"] == "main.inspire.__inspire_app_feedback_n01_u01", "an App inside Inspire has no name, so its reports table is named for its use case"
    assert (fields["app_name"], fields["app_url"]) == ("", "")
    hosted = fields["_asset"]["hosted"]
    assert fields["_asset"] == {"placement": "inspire", "hosted": hosted, "app_name": "", "app_url": ""}
    assert {k: v for k, v in hosted.items() if k != "published_at"} == {"id": ID, "source": f"{FOLDER}/v2", "version": 2,
                                                                         "warehouse_id": "wh2", "page": "n01_u01"}
    assert STAMP.match(hosted["published_at"])
    assert context["app_host"]["source"] == f"{FOLDER}/v2", "the checks after the build read the folder it just wrote"


def test_a_held_page_writes_its_folder_but_publishes_nothing_until_it_is_published(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, asset_status={"app": json.loads(json.dumps(LIVE_RECORD))},
                                   assets={"genie_space": "g1", "app": ID}, version=3)
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_app(context, _pages(_churn_page(agent_ns)))
    written = _written(seen["calls"])
    assert written and all(path.startswith(f"{FOLDER}/v3/") for path in written), "the held version's folder holds its candidate"
    assert context["asset_status"]["app"] == LIVE_RECORD, "the live page stays v2 while v3 is held"
    assert _app_calls(seen["calls"]) == [] and _grants(inst.spark) == []
    seen["calls"].clear()
    candidate = {"artifact": held.value.artifact, "vibes": "", "spec_version": 3, "merged_into": "", "held": True}
    context.update(replay={"app": (3, candidate)}, publishing={"app"})
    fields = inst._implement_app(context, _FileRunner([], []))
    hosted = fields["_asset"]["hosted"]
    assert (hosted["source"], hosted["version"]) == (f"{FOLDER}/v3", 3) and _app_calls(seen["calls"]) == []


def test_a_look_only_edit_rewrites_the_page_into_the_next_version_folder_without_genie_or_an_app(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, asset_status={"app": json.loads(json.dumps(LIVE_RECORD))},
                                   assets={"genie_space": "g1", "app": ID}, version=3)
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    core = inst._implement_app_shell()[1]["shell_core"]
    settings = agent_ns["implement_app_settings"](core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "Ask Genie is off",
                                                  "2026-10-30T08:00:00Z", context["spec"]["outputs"])
    read = _serve_files(agent_ns, monkeypatch, {f"{FOLDER}/v2/inspire_app.json": json.dumps(dict(settings, backend={"kind": "delta"})),
                                                f"{FOLDER}/v2/pages/{page['id']}.json": json.dumps(page)})
    context["spec"] = _hosted_spec(agent_ns, dashboard=False, app_look={"theme": "dark"})
    context["restyle"] = ["app"]
    fields = inst._implement_app(context, None)
    assert read == [f"{FOLDER}/v2/inspire_app.json", f"{FOLDER}/v2/pages/{page['id']}.json"], "the page as it is now is read from Inspire"
    written = _written(seen["calls"])
    assert json.loads(written[f"{FOLDER}/v3/inspire_app.json"])["theme"] == "dark"
    assert fields["_asset"]["hosted"]["source"] == f"{FOLDER}/v3" and _app_calls(seen["calls"]) == []


def test_a_new_genie_agent_points_the_page_at_it_in_the_next_version_folder_and_names_no_app(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, asset_status={"app": json.loads(json.dumps(LIVE_RECORD))},
                                   assets={"genie_space": "g9", "app": ID}, version=3)
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    core = inst._implement_app_shell()[1]["shell_core"]
    settings = agent_ns["implement_app_settings"](core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "Ask Genie is off",
                                                  "2026-10-30T08:00:00Z", context["spec"]["outputs"])
    _serve_files(agent_ns, monkeypatch, {f"{FOLDER}/v2/inspire_app.json": json.dumps(dict(settings, backend={"kind": "delta"})),
                                         f"{FOLDER}/v2/pages/{page['id']}.json": json.dumps(dict(page, genie=None, genie_note="off"))})
    context["repoint"] = ["app"]
    fields = inst._implement_app(context, None)
    written = json.loads(_written(seen["calls"])[f"{FOLDER}/v3/pages/{page['id']}.json"])
    assert written["genie"]["space_id"] == "g9" and fields["_asset"]["hosted"]["source"] == f"{FOLDER}/v3"
    messages = [e.get("message") or "" for e in inst.emitted]
    assert "the Genie Agent changed: Inspire points the page inside Inspire at it and writes it again, without Genie" in messages
    assert "the page inside Inspire now asks this use case's Genie Agent" in messages
    assert not any("the App n01-u01" in m for m in messages) and _app_calls(seen["calls"]) == []


def test_the_audit_reads_the_hosted_page_and_its_images_from_inspire_never_an_app_deployment(agent_ns, tmp_path, monkeypatch):
    inst, context, seen = _builder(agent_ns, tmp_path, monkeypatch, asset_status={"app": json.loads(json.dumps(LIVE_RECORD))})
    page = _image_page(agent_ns)
    page["blocks"][0]["content"]["file"] = FILE
    exported = []

    def api(method, path, body=None, query=None):
        seen["calls"].append((method, path, body))
        exported.append((query or {}).get("path"))
        return {"content": base64.b64encode(PNG).decode()}

    inst._implement_api = api
    found = inst._implement_app_block_images({"artifacts": {"app": page}, "asset_status": context["asset_status"]})
    assert found[0]["bytes"] == PNG and exported == [f"{FOLDER}/v2/static/{FILE}"]
    core = inst._implement_app_shell()[1]["shell_core"]
    read = _serve_files(agent_ns, monkeypatch, {})
    host = inst._implement_app_host(context, core)
    assert read == [f"{FOLDER}/v2/inspire_app.json"] and host["source"] == "" and host["settings"] is None
    assert _app_calls(seen["calls"]) == []


def test_a_new_version_folder_copies_each_image_from_the_live_version_and_fetches_only_what_it_lacks(agent_ns, tmp_path, monkeypatch):
    inst, _context, seen = _builder(agent_ns, tmp_path, monkeypatch)
    page = _image_page(agent_ns)
    page["blocks"][0]["content"]["file"] = FILE
    files = {"pages/n01_u01.json": json.dumps(page)}
    held, exported, fetched = {f"{FOLDER}/v2/static/{FILE}": PNG}, [], []

    def api(method, path, body=None, query=None):
        exported.append((query or {}).get("path"))
        if (query or {}).get("path") not in held:
            raise RuntimeError("RESOURCE_DOES_NOT_EXIST: no such file")
        return {"content": base64.b64encode(held[query["path"]]).decode()}

    inst._implement_api = api
    monkeypatch.setitem(agent_ns, "implement_checked_image", lambda url, shell_sql: fetched.append(url) or (PNG, ""))
    assert inst._implement_app_block_files(files, f"{FOLDER}/v3", f"{FOLDER}/v2") == {f"static/{FILE}": PNG}
    assert exported == [f"{FOLDER}/v2/static/{FILE}"] and fetched == [], "the live version's copy is reused, with no download"
    held[f"{FOLDER}/v2/static/{FILE}"] = b"GIF89a" + b"\x00" * 16
    assert inst._implement_app_block_files(files, f"{FOLDER}/v3", f"{FOLDER}/v2") == {f"static/{FILE}": PNG}
    assert len(fetched) == 1, "a copy that is not the checked image is never reused; the image is fetched and checked again"
    assert _app_calls(seen["calls"]) == []


def _deleting(listing):
    deleted, calls = [], []

    def api(method, path, body=None, query=None):
        calls.append((method, path, body))
        if (method, path) == ("GET", "/api/2.0/workspace/list"):
            return {"objects": listing.get((query or {}).get("path"), [])}
        if (method, path) == ("POST", "/api/2.0/workspace/delete"):
            deleted.append((body["path"], body.get("recursive")))
        return {}

    return api, deleted, calls


VERSIONS = {FOLDER: [{"path": f"{FOLDER}/v2", "object_type": "DIRECTORY"}, {"path": f"{FOLDER}/v3", "object_type": "DIRECTORY"}]}


def test_uninstall_deletes_every_version_folder_of_the_page_and_its_record(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Predict churn", "Business Domain": "Sales"}
    inst._row_to_uc = lambda row: dict(row)
    inst._implement_output_dirs = lambda uc, key, notebook_path="": [MVP]
    inst._implement_remove_use_case_dir = lambda uc, key: []
    inst._implement_warehouse_note = lambda key: ""
    inst._implement_api, deleted, calls = _deleting(VERSIONS)
    status = {"app": json.loads(json.dumps(LIVE_RECORD))}
    assert inst._implement_uninstall((5150, "N01-U01", 4), {"job_id": 77}, status) == "uninstalled"
    assert deleted[:3] == [(f"{FOLDER}/v2", True), (f"{FOLDER}/v3", True), (FOLDER, True)]
    final = inst.updates[-1]["asset_status"]["app"]
    assert "hosted" not in final and final["state"] == "deleted", final
    assert _app_calls(calls) == []


def test_a_folder_that_holds_more_than_versions_keeps_it_and_the_record_stays_live(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_api, deleted, _calls = _deleting({FOLDER: VERSIONS[FOLDER] + [{"path": f"{FOLDER}/notes.txt", "object_type": "FILE"}]})
    inst._implement_update = lambda key, **f: None
    outcome = inst._implement_delete_output("app", ID, (5150, "N01-U01", 4), status=LIVE_RECORD)
    assert deleted == [(f"{FOLDER}/v2", True), (f"{FOLDER}/v3", True)] and outcome["refused"] is False
    outside = dict(LIVE_RECORD, hosted=dict(LIVE_HOSTED, source="/W/acme/elsewhere/v2"))
    outcome = inst._implement_delete_output("app", ID, (5150, "N01-U01", 4), status=outside)
    assert outcome["refused"] is True and outcome["state"] == "released" and len(deleted) == 2, "a folder Inspire cannot name is left"


def test_moving_out_of_inspire_deletes_the_page_only_once_the_app_is_published(agent_ns, tmp_path, monkeypatch):
    live = {"app": json.loads(json.dumps(LIVE_RECORD))}
    listing = {FOLDER: [{"path": f"{FOLDER}/v2", "object_type": "DIRECTORY"}]}
    moving = {"hosted": False, "asset_status": live, "assets": {"app": ID}, "listing": listing}
    inst, context, seen = _builder(agent_ns, tmp_path / "held", monkeypatch, **moving)
    context["hold_mode"] = True
    with pytest.raises(agent_ns["ImplementCandidate"]):
        inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert not any(c[:2] == ("POST", "/api/2.0/workspace/delete") for c in seen["calls"]), "a held App leaves the page inside Inspire"
    inst, context, seen = _builder(agent_ns, tmp_path / "failed", monkeypatch, **moving)
    inst._implement_deploy_app = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("the App deployment FAILED: boom"))
    with pytest.raises(Exception):
        inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert not any(c[:2] == ("POST", "/api/2.0/workspace/delete") for c in seen["calls"]), "an App that did not deploy keeps the page"
    inst, context, seen = _builder(agent_ns, tmp_path / "live", monkeypatch, **moving)
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    deleted = [c[2]["path"] for c in seen["calls"] if c[:2] == ("POST", "/api/2.0/workspace/delete")]
    assert deleted == [f"{FOLDER}/v2", FOLDER] and fields["app_name"] == "churn-desk"
    assert "_warnings" not in fields or not any("inside Inspire" in w for w in fields["_warnings"])


def test_moving_into_inspire_leaves_the_old_app_as_it_is_and_says_so_for_an_app_it_shared(agent_ns, tmp_path, monkeypatch):
    shared = {"app": {"state": "ready", "spec_version": 2, "merged_into": "sales-desk", "page": "n01_u01_s5150"}}
    inst, context, seen = _builder(agent_ns, tmp_path / "shared", monkeypatch, asset_status=shared, assets={"app": "sales-desk"})
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert fields["_notes"] == ["App: this use case's page is now inside Inspire; the App sales-desk keeps what Inspire built there before "
                                "and is no longer refreshed for it"]
    assert not any("keeps what Inspire built" in w for w in fields.get("_warnings") or []), "the move the user chose is a note"
    assert _app_calls(seen["calls"]) == [] and not any(c[0] == "DELETE" for c in seen["calls"])
    own = {"app": {"state": "ready", "spec_version": 2, "backend": "delta"}}
    inst, context, seen = _builder(agent_ns, tmp_path / "own", monkeypatch, asset_status=own, assets={"app": "churn-desk"})
    fields = inst._implement_app(context, _pages(_churn_page(agent_ns)))
    assert not any("keeps what Inspire built" in w for w in (fields.get("_warnings") or []) + (fields.get("_notes") or [])), \
        "its own App is left as on a rename"
    assert _app_calls(seen["calls"]) == [] and not any(c[0] == "DELETE" for c in seen["calls"])


def test_sharing_a_page_inside_inspire_gives_its_viewers_its_warehouse_and_no_app_permission(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    grants, calls = [], []
    inst._implement_grant = lambda kind, object_id, principals, level: grants.append((kind, object_id, level)) or []
    inst._implement_access_rows = lambda table, warnings=None: []
    inst._implement_emit = lambda *a, **k: None
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path)) or {}
    spec = dict(_hosted_spec(agent_ns), sharing={"principals": [{"type": "group", "name": "planners"}]})
    status = {"app": json.loads(json.dumps(LIVE_RECORD))}
    warnings = inst._implement_share("N01-U01", "main.inspire.churn_out", spec, {"dashboard": "d1", "genie_space": "g1", "app": ID},
                                     None, asset_status=status)
    assert ("sql/warehouses", "wh2", "CAN_USE") in grants and not any(kind == "apps" for kind, _o, _l in grants)
    assert _app_calls([(m, p, None) for m, p in calls]) == []
    assert not [w for w in warnings if w.startswith(("Sharing App", "Sharing the SQL warehouse"))], warnings


def _hosted_locked(ns, tmp_path, monkeypatch):
    inst, previous = _locked(ns, previous_outputs=HOSTED)
    del inst._implement_app
    carried = {k: v for k, v in BUILT.items() if k not in ("app_name", "app_url")}
    live = _left_by(2, json.loads(json.dumps(LIVE)))
    live["app"] = json.loads(json.dumps(LIVE_RECORD))
    inst._implement_carried = lambda target, through_own=False: (dict(carried), json.loads(json.dumps(live)))
    inst.local_log_output_dir = str(tmp_path)
    inst._genie_decision_contract = _contract
    inst._implement_input_has_dates = lambda context: False
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(r) for r in ROWS]
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or []
    inst._implement_app_prompt = lambda *args: "write page.json"
    inst._implement_runner = lambda uc: "genie"
    work = tmp_path / "genie"
    work.mkdir(parents=True, exist_ok=True)
    page = _churn_page(ns)
    for dataset in page["datasets"]:
        dataset["sql"] = dataset["sql"].replace("main.s.orders", VALID["data"]["tables"]["main.s.orders"])
    (work / "page.json").write_text(json.dumps(page))
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy, tools=None: deploy(str(work))
    _dirs(inst)
    _serve_files(ns, monkeypatch, {})
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(mkdirs=lambda p: None),
                                          config=types.SimpleNamespace(host="https://h/"))
    inst.calls = []
    inst._implement_api = lambda method, path, body=None, query=None: inst.calls.append((method, path, body)) or {}
    return inst, previous


def test_an_older_app_name_is_not_carried_past_a_page_inside_inspire(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    rows = [{"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "status": "ready", "app_name": "", "app_url": "",
             "asset_status": {"app": json.loads(json.dumps(LIVE_RECORD))}},
            {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 1, "status": "ready", "app_name": "churn-desk",
             "app_url": "https://churn-desk.example", "asset_status": {"app": {"state": "ready", "spec_version": 1}}}]
    inst._implement_select = lambda where, args, order=None: [dict(r) for r in rows]
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3})
    assert "app_name" not in carried and "app_url" not in carried
    assert agent_ns["implement_output_assets"](carried, status)["app"] == ID
    assert agent_ns["implement_kept_asset"](LIVE_RECORD) == {"placement": "inspire", "hosted": LIVE_HOSTED}, \
        "a failed or unticked build keeps the live page it does not replace"


def test_the_page_id_joins_the_use_case_and_its_session_so_two_sessions_never_share_a_folder(agent_ns, tmp_path, monkeypatch):
    name, rule = agent_ns["implement_app_hosted_name"], agent_ns["IMPLEMENT_APP_HOSTED_ID_RE"]
    assert name("N01-U01", 5150) == ID and name("N01-U01", 6160) == "n01-u01-6160"
    assert name("N01-U01", 5150) != name("N01-U01", 6160), "the same use case id in two sessions gets two pages"
    longest = name("N01-U01 " + "x" * 80, 2222222222222222222)
    assert len(longest) == 63 and rule.fullmatch(longest), longest
    assert longest.endswith("-2222222222222222222") and longest.startswith("n01-u01-xx"), "the use case part is cut, never the session"
    assert rule.fullmatch(name("N01-U01 " + "x" * 80, 2222222222222222222) + "x") is None, "64 characters break the rule"
    cut = name("a" * 42 + "-bc", 2222222222222222222)
    assert cut == "a" * 42 + "-2222222222222222222" and rule.fullmatch(cut), "a cut that ends on a dash drops the dash"
    assert name("", 5150) == "5150" and name("N01-U01", None) == "n01-u01"
    fallback = name("***", None)
    assert rule.fullmatch(fallback) and len(fallback) == 12
    inst, context, _seen = _builder(agent_ns, tmp_path, monkeypatch)
    assert inst._implement_app_target_name(context) == ID
    context["asset_status"] = {"app": dict(LIVE_RECORD, hosted=dict(LIVE_HOSTED, id="n01-u01", source=f"{MVP}/apps/n01-u01/v2"))}
    assert inst._implement_app_target_name(context) == "n01-u01", "a page already recorded keeps its id and its folder"


def test_the_weekly_impact_email_links_to_the_page_in_inspire_s_run_tab(agent_ns, tmp_path):
    url, line = "https://inspire.example.com", f"Open this use case's page in Inspire's Run tab: https://inspire.example.com/?run={ID}"
    from v140_implement_test import ALERT, _output_context
    from v149_impact_test import _digest_inspire
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    context = _output_context(agent_ns, **ALERT, **HOSTED, inspire_url=url)
    assert agent_ns["implement_app_hosted"](context["spec"]["outputs"]) and context["spec"]["outputs"]["inspire_url"] == url
    context["urls"]["app_url"] = "https://old-app.example.com"
    inst._implement_alert(context, None)
    digest = [body for method, path, body, _q in calls if (method, path) == ("POST", "/api/2.0/alerts")][-1]
    lines = digest["custom_description"].split("\n")
    assert line in lines, lines
    assert not any("Open the Impact page of the App" in text or "old-app" in text for text in lines), "no App link for a page in Inspire"
    assert sum("https://" in text for text in lines) == 1
    page_line = agent_ns["implement_digest_page_line"]
    assert page_line("https://app.example.com/") == "Open the Impact page of the App: https://app.example.com/?open=impact"
    assert page_line("") == "" and page_line("", ID, url) == line
    assert page_line("", ID, "") == "", "with no Inspire address there is no Run tab to link to"


def _pruning(ns, listing, held=(), broken=None):
    inst = _inspire(ns, FakeSpark())
    inst._implement_api, deleted, calls = _deleting(listing)
    asked = []

    def select(where, args, order=None):
        asked.append((where, dict(args)))
        if broken:
            raise broken
        return [{"spec_version": v, "status": "vibe_not_met"} for v in held] if args.get("status") == "vibe_not_met" else []

    inst._implement_select = select
    return inst, deleted, calls, asked


def _folders(*versions, extra=()):
    return {FOLDER: [{"path": f"{FOLDER}/v{v}", "object_type": "DIRECTORY"} for v in versions] + list(extra)}


def test_a_publish_deletes_every_version_folder_but_the_live_one(agent_ns):
    live = dict(LIVE_RECORD, spec_version=5, hosted=dict(LIVE_HOSTED, source=f"{FOLDER}/v5", version=5))
    others = [{"path": f"{FOLDER}/static", "object_type": "DIRECTORY"}, {"path": f"{FOLDER}/v9.json", "object_type": "FILE"}]
    inst, deleted, _calls, asked = _pruning(agent_ns, _folders(1, 2, 3, 4, 5, 6, extra=others))
    inst._implement_app_hosted_prune((5150, "N01-U01", 5), live)
    assert sorted(deleted) == sorted((f"{FOLDER}/v{n}", True) for n in (1, 2, 3, 4, 6)), "every older and newer version folder goes"
    assert (f"{FOLDER}/v5", True) not in deleted, "the live folder survives"
    assert not any(path.endswith(("/static", "/v9.json")) for path, _r in deleted), "only version folders are ever deleted"
    assert asked == [], "no version is held any more, so no held row is read"


def test_a_held_version_published_anyway_loses_its_folder_to_the_version_that_published_it(agent_ns):
    live = dict(LIVE_RECORD, spec_version=4, hosted=dict(LIVE_HOSTED, source=f"{FOLDER}/v4", version=4))
    inst, deleted, _calls, _asked = _pruning(agent_ns, _folders(2, 3, 4), held=[3])
    inst._implement_app_hosted_prune((5150, "N01-U01", 4), live)
    assert deleted == [(f"{FOLDER}/v2", True), (f"{FOLDER}/v3", True)], "v4 holds what v3 held, so v3 is no longer needed"


def test_a_page_not_published_in_this_version_or_whose_held_versions_cannot_be_read_deletes_nothing(agent_ns):
    live = dict(LIVE_RECORD, spec_version=5, hosted=dict(LIVE_HOSTED, source=f"{FOLDER}/v5", version=5))
    for record, key in ((live, (5150, "N01-U01", 6)), (dict(live, state="failed"), (5150, "N01-U01", 5)),
                        ({"state": "ready", "spec_version": 5, "backend": "delta"}, (5150, "N01-U01", 5)),
                        ):
        inst, deleted, calls, asked = _pruning(agent_ns, _folders(1, 5))
        inst._implement_app_hosted_prune(key, record)
        assert deleted == [] and calls == [], record
    inst, deleted, _calls, _asked = _pruning(agent_ns, _folders(1, 5))
    inst._implement_app_hosted_prune((5150, "N01-U01", 5), dict(live, hosted=dict(LIVE_HOSTED, source="/W/elsewhere/v5")))
    assert not any(path.startswith(FOLDER) for path, _r in deleted), "a page published elsewhere never prunes this page's folder"
    inst, deleted, calls, _asked = _pruning(agent_ns, _folders(1, 5))
    inst._implement_folder_objects = lambda folder: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED: no LIST on the folder"))
    inst.logger = CapturingLogger()
    inst._implement_app_hosted_prune((5150, "N01-U01", 5), live)
    assert deleted == [] and calls == []
    assert any("are kept, because Inspire could not read which of them are held" in m for _k, m in inst.logger.records)


def test_a_published_run_prunes_the_older_folders_and_the_held_one_it_replaced_once_its_record_is_saved(agent_ns, tmp_path,
                                                                                                           monkeypatch):
    inst, previous = _hosted_locked(agent_ns, tmp_path, monkeypatch)
    _verdicts(inst, [ASK], status="done")
    listing, deletes = _folders(2, 3, 4), []

    def api(method, path, body=None, query=None):
        inst.calls.append((method, path, body))
        if (method, path) == ("GET", "/api/2.0/workspace/list"):
            return {"objects": listing.get((query or {}).get("path"), [])}
        if (method, path) == ("POST", "/api/2.0/workspace/delete"):
            deletes.append(("delete", body["path"], [u.get("status") for u in inst.updates]))
        return {}

    inst._implement_api = api
    inst._implement_select = lambda where, args, order=None: ([{"spec_version": 3, "status": "vibe_not_met"}]
                                                              if args.get("status") == "vibe_not_met" else [])
    sent = dict(previous, outputs={**previous["outputs"], "app_vibes": ASK})
    assert _run(inst, sent, version=4) in ("ready", "ready_with_warnings")
    record = inst.updates[-1]["asset_status"]["app"]
    assert record["hosted"]["source"] == f"{FOLDER}/v4"
    assert [(kind, path) for kind, path, _statuses in deletes] == [("delete", f"{FOLDER}/v2"), ("delete", f"{FOLDER}/v3")], \
        "v4 replaced the held v3 and is live, so only v4 stays"
    assert deletes[0][2][-1] in ("ready", "ready_with_warnings"), "the folder goes only after the row names the new live version"
