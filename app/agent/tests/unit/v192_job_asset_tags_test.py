import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source, load_agent_namespace  # noqa: E402
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v120_launcher_fix_test import _CapJobs, cap_sdk  # noqa: E402,F401
from v120_modes_main_test import FakeDbutils, widget_values  # noqa: E402
from v140_implement_test import VALID, _probe_inspire  # noqa: E402

VERSION_KEY = "dbx_inspire_ai_version"
ALL_KINDS = {"dashboard": "01ef0a1b2c3d4e5f", "genie_space": "01ef9f8e7d6c5b4a", "app": "churn-desk", "alert": "a1b2c3d4-0000-1111-2222-333344445555"}


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _status(**extra):
    status = {"dashboard": {"state": "ready"}, "genie_space": {"state": "ready"}, "app": {"state": "ready", "backend": "lakebase"},
              "alert": {"state": "ready", "digest_id": "d9e8f7a6-0000-1111-2222-333344445555"}, "ai_reasoning": {"state": "ready"}}
    status.update(extra)
    return status


def test_every_agent_job_tag_builder_carries_the_version_tag(ns):
    version = ns["__AGENT_VERSION__"]
    assert ns["INSPIRE_VERSION_TAGS"] == {"inspire_version": version, VERSION_KEY: version}
    inst = build_inspire(ns)
    spec = inst._genie_notebook_spec(make_uc())
    assert spec["job_tags"][VERSION_KEY] == spec["job_tags"]["inspire_version"] == version
    tagger = make_inspire(ns, spark=FakeSpark(), session_id=5150)
    tags = tagger._implement_tags(tagger._genie_notebook_spec(make_uc()), (5150, "N01-U01", 2), "/W/nb")
    assert tags[VERSION_KEY] == version and tags["dbx_inspire_ai_run_type"] == "implement"


def test_the_discovery_job_the_agent_launches_carries_the_version_tag(ns, monkeypatch):
    seen = []

    class Recorder:
        def __init__(self, notebook_path, widget_key_values, job_tags=None):
            seen.append(dict(job_tags or {}))

        @staticmethod
        def get_current_notebook_path():
            return "/Users/someone/agent/dbx_inspire_ai_agent"

        def launch(self, **kwargs):
            return {"success": False, "error": "offline test: launch disabled"}

    class Stub:
        def __init__(self, **kw):
            self.final_inspire_results_json = {}

        def run(self):
            return None

        def finalize_atomic_writer(self, success=True, error_message=None):
            return None

        def run_exit_value(self):
            return ""

    monkeypatch.setitem(ns, "dbutils", FakeDbutils(widget_values(**{"14_session_id": ""})))
    monkeypatch.setitem(ns, "_detect_is_job_context", lambda: False)
    monkeypatch.setitem(ns, "JobLauncher", Recorder)
    monkeypatch.setitem(ns, "DatabricksInspire", Stub)
    ns["main"]()
    assert len(seen) == 1 and seen[0]["dbx_inspire_ai_run_type"] == "discovery"
    assert seen[0][VERSION_KEY] == seen[0]["inspire_version"] == ns["__AGENT_VERSION__"]


def test_the_launcher_source_generated_notebooks_embed_runs_without_the_agent_version(ns):
    scope = {"inspire_redact_text": lambda text, known, extra: text}
    exec(compile(ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE, "<JobLauncher>", "exec"), scope)
    launcher = scope["JobLauncher"]
    assert launcher.merged_tags({"team": "x"}, {"dbx_inspire_ai_run_type": "analysis"}) == {"team": "x", "dbx_inspire_ai_run_type": "analysis"}
    assert "__AGENT_VERSION__" not in ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE


def test_asset_tags_name_one_tag_per_built_kind(ns):
    tags = ns["implement_asset_tags"](ALL_KINDS, _status(), "databricks-claude-sonnet", "a7f3c2e1-1111")
    assert tags == {
        "dbx_inspire_ai_app_name": "churn-desk",
        "dbx_inspire_ai_app_id": "a7f3c2e1-1111",
        "dbx_inspire_ai_genie_space_id": "01ef9f8e7d6c5b4a",
        "dbx_inspire_ai_dashboard_id": "01ef0a1b2c3d4e5f",
        "dbx_inspire_ai_alert_ids": "a1b2c3d4-0000-1111-2222-333344445555,d9e8f7a6-0000-1111-2222-333344445555",
        "dbx_inspire_ai_alert_count": "2",
        "dbx_inspire_ai_agent_endpoint": "databricks-claude-sonnet",
        "dbx_inspire_ai_lakebase_project": ns["IMPLEMENT_LAKEBASE_PROJECT"],
        "dbx_inspire_ai_assets": "app,genie,dashboard,alert,agent_endpoint,lakebase",
    }
    assert set(tags) <= set(ns["JobLauncher"].ASSET_TAG_KEYS)


@pytest.mark.parametrize("assets,status,endpoint,expected_kinds", [
    ({"dashboard": "d1"}, {"dashboard": {"state": "ready"}}, "", "dashboard"),
    ({"dashboard": "d1", "genie_space": "g1"}, {"dashboard": {"state": "deleted"}, "genie_space": {"state": "unmanaged"}}, "", "genie"),
    ({"app": "inside-page"}, {"app": {"state": "ready", "placement": "inspire", "backend": "lakebase"}}, "", "lakebase"),
    ({"app": "desk"}, {"app": {"state": "ready", "backend": "delta"}}, "", "app"),
    ({"alert": "a1"}, {"alert": {"state": "released", "digest_id": "dg"}}, "", None),
    ({}, {"ai_reasoning": {"state": "failed"}}, "databricks-claude", None),
    ({}, {"ai_reasoning": {"state": "ready"}}, "databricks-claude", "agent_endpoint"),
    ({"dashboard": None, "genie_space": ""}, {}, "", None),
])
def test_asset_tags_skip_kinds_that_were_not_built_or_are_gone(ns, assets, status, endpoint, expected_kinds):
    tags = ns["implement_asset_tags"](assets, status, endpoint)
    assert tags.get("dbx_inspire_ai_assets") == expected_kinds
    if expected_kinds is None:
        assert tags == {}
    if "placement" in (status.get("app") or {}):
        assert "dbx_inspire_ai_app_name" not in tags and "dbx_inspire_ai_app_id" not in tags


def test_asset_tag_values_keep_only_the_characters_billing_allows(ns):
    tags = ns["implement_asset_tags"]({"app": "my app/v2", "alert": "id,with,commas", "genie_space": "g 1@x:y+z=w"},
                                      {"alert": {"state": "ready", "digest_id": "a b"}}, "end point/x")
    assert tags["dbx_inspire_ai_app_name"] == "my_app_v2"
    assert tags["dbx_inspire_ai_genie_space_id"] == "g_1@x:y+z=w"
    assert tags["dbx_inspire_ai_alert_ids"] == "id_with_commas,a_b" and tags["dbx_inspire_ai_alert_count"] == "2"
    assert "dbx_inspire_ai_agent_endpoint" not in tags
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-=.,_:@")
    assert all(set(value) <= allowed for value in tags.values())
    assert ns["JobLauncher"]._sanitize_tag("Acme, Inc.") == "Acme_Inc", "job names and the older tags keep the narrow set"


def test_alert_ids_that_do_not_fit_keep_whole_ids_and_the_full_count(ns):
    first, second = "a" * 200, "b" * 200
    tags = ns["implement_asset_tags"]({"alert": first}, {"alert": {"state": "ready", "digest_id": second}})
    assert tags["dbx_inspire_ai_alert_ids"] == first and tags["dbx_inspire_ai_alert_count"] == "2"
    assert len(ns["JobLauncher"]._sanitize_tag("x" * 300)) == 255
    assert len(ns["implement_asset_tags"]({"dashboard": "d" * 400}, {})["dbx_inspire_ai_dashboard_id"]) == 255


def test_the_tag_cap_keeps_twenty_and_drops_the_lowest_priority_inspire_tags(ns, capsys):
    launcher = ns["JobLauncher"]
    inspire = {key: "v" for key in launcher.TAG_PRIORITY}
    user = {"team": "growth", "cost_center": "42"}
    kept = launcher.merged_tags(user, inspire)
    assert len(kept) == 20 and set(user) <= set(kept)
    dropped = [key for key in launcher.TAG_PRIORITY if key not in kept]
    assert dropped == list(launcher.TAG_PRIORITY[18:]), "the tail of the priority list goes first"
    assert {"inspire_version", "dbx_inspire_ai_session"} <= set(dropped) and VERSION_KEY in kept
    out = capsys.readouterr().out
    assert "[JOB-TAG-CAP FIRED]" in out and all(key in out for key in dropped)
    assert launcher.merged_tags(user, inspire) == kept, "the cap is deterministic"
    unknown = launcher.capped_tags(dict(inspire, dbx_inspire_ai_zzz="v"))[1]
    assert unknown[-1] == "dbx_inspire_ai_zzz", "an Inspire key the list does not name ranks below every listed one"
    capsys.readouterr()
    small = launcher.merged_tags({}, {"dbx_inspire_ai_run_type": "implement"})
    assert small == {"dbx_inspire_ai_run_type": "implement"} and "[JOB-TAG-CAP FIRED]" not in capsys.readouterr().out


class _Api:
    def __init__(self, tags=None, fail=None, app=None):
        self.calls, self.tags, self.fail, self.app = [], dict(tags or {}), dict(fail or {}), app or {"id": "a7f3c2e1-1111"}

    def __call__(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        for (failing_method, prefix), error in self.fail.items():
            if method == failing_method and path.startswith(prefix):
                raise error
        if path == "/api/2.2/jobs/get":
            return {"settings": {"tags": dict(self.tags)}}
        if path.startswith("/api/2.0/apps/"):
            return dict(self.app)
        return {}

    def updates(self):
        return [body for method, path, body, _q in self.calls if (method, path) == ("POST", "/api/2.2/jobs/update")]


def _tagger(ns, api):
    inst = make_inspire(ns, spark=FakeSpark(), session_id=5150)
    inst._implement_api = api
    return inst


def test_the_asset_update_merges_into_the_job_tags_and_clears_stale_asset_tags(ns):
    live = {"team": "growth", "dbx_inspire_ai_business": "Acme", VERSION_KEY: "v1.3.0", "dbx_inspire_ai_dashboard_id": "old",
            "dbx_inspire_ai_assets": "dashboard"}
    api = _Api(live)
    inst = _tagger(ns, api)
    inst._implement_tag_job_assets("N01-U01", 77, {"genie_space": "g1", "dashboard": "old"},
                                   {"genie_space": {"state": "ready"}, "dashboard": {"state": "deleted"}})
    [update] = api.updates()
    assert update == {"job_id": 77, "new_settings": {"tags": {"team": "growth", "dbx_inspire_ai_business": "Acme", VERSION_KEY: "v1.3.0",
                                                              "dbx_inspire_ai_genie_space_id": "g1", "dbx_inspire_ai_assets": "genie"}}}
    assert any("[IMPLEMENT-ASSET-TAGS]" in msg and "genie" in msg for level, msg in inst.logger.records if level == "INFO")


def test_the_asset_update_reads_the_app_id_and_skips_the_write_when_nothing_changed(ns):
    api = _Api()
    inst = _tagger(ns, api)
    inst._implement_tag_job_assets("N01-U01", "77", {"app": "churn-desk"}, {"app": {"state": "ready", "backend": "delta"}})
    [update] = api.updates()
    assert update["new_settings"]["tags"] == {"dbx_inspire_ai_app_name": "churn-desk", "dbx_inspire_ai_app_id": "a7f3c2e1-1111",
                                              "dbx_inspire_ai_assets": "app"}
    assert ("GET", "/api/2.0/apps/churn-desk", None, None) in api.calls
    same = _Api(update["new_settings"]["tags"])
    _tagger(ns, same)._implement_tag_job_assets("N01-U01", 77, {"app": "churn-desk"}, {"app": {"state": "ready", "backend": "delta"}})
    assert same.updates() == []


def test_no_job_means_no_tag_calls(ns):
    api = _Api()
    for job_id in (None, "", "not-a-job"):
        _tagger(ns, api)._implement_tag_job_assets("N01-U01", job_id, {"dashboard": "d1"}, {"dashboard": {"state": "ready"}})
    assert api.calls == []


@pytest.mark.parametrize("fail", [
    {("POST", "/api/2.2/jobs/update"): RuntimeError("PERMISSION_DENIED: cannot edit job 77")},
    {("GET", "/api/2.2/jobs/get"): RuntimeError("RESOURCE_DOES_NOT_EXIST: job 77")},
])
def test_a_failed_tag_update_never_fails_the_run(ns, fail):
    api = _Api({"team": "growth"}, fail=fail)
    inst = _tagger(ns, api)
    assert inst._implement_tag_job_assets("N01-U01", 77, {"dashboard": "d1"}, {"dashboard": {"state": "ready"}}) is None
    warnings = [msg for level, msg in inst.logger.records if level == "WARNING"]
    assert len(warnings) == 1 and "[IMPLEMENT-ASSET-TAGS]" in warnings[0] and "job 77" in warnings[0]


def test_an_unreadable_app_id_still_tags_the_app_name(ns):
    api = _Api(fail={("GET", "/api/2.0/apps/"): RuntimeError("PERMISSION_DENIED: no CAN_VIEW on app")})
    inst = _tagger(ns, api)
    inst._implement_tag_job_assets("N01-U01", 77, {"app": "churn-desk"}, {"app": {"state": "ready"}})
    [update] = api.updates()
    assert update["new_settings"]["tags"] == {"dbx_inspire_ai_app_name": "churn-desk", "dbx_inspire_ai_assets": "app"}
    assert any("could not be read" in msg for level, msg in inst.logger.records if level == "WARNING")


def test_a_finished_build_tags_the_use_case_job_with_its_assets(ns):
    inst = _probe_inspire(ns, None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    inst._implement_dashboard = lambda c, r: pytest.fail("the dashboard did not change")
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    api = _Api({"dbx_inspire_ai_run_type": "implement", "team": "growth"})
    inst._implement_api = api
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                      (5150, "N01-U01", 3)) == "ready"
    tagged = [body for body in api.updates() if body.get("job_id") == 77 and "tags" in (body.get("new_settings") or {})]
    assert len(tagged) == 1
    tags = tagged[0]["new_settings"]["tags"]
    assert tags["team"] == "growth" and tags["dbx_inspire_ai_run_type"] == "implement"
    assert tags["dbx_inspire_ai_dashboard_id"] == "d1" and tags["dbx_inspire_ai_genie_space_id"] == "g1"
    assert tags["dbx_inspire_ai_app_name"] == "churn-desk" and tags["dbx_inspire_ai_app_id"] == "a7f3c2e1-1111"
    assert set(tags["dbx_inspire_ai_assets"].split(",")) >= {"app", "genie", "dashboard"}


class _TagJobs(_CapJobs):
    def __init__(self, tags, schedule=None, get_raises=False):
        super().__init__(existing_job_id=77)
        self.tags, self.schedule, self.get_raises, self.settings = dict(tags), schedule, get_raises, []

    def get(self, job_id=None):
        if self.get_raises:
            raise RuntimeError("jobs/get is down")
        return types.SimpleNamespace(settings=types.SimpleNamespace(schedule=self.schedule, tags=dict(self.tags)))

    def update(self, job_id=None, new_settings=None):
        self.calls.append("update")
        self.settings.append(new_settings)

    def create(self, **kwargs):
        self.settings.append(types.SimpleNamespace(**kwargs))
        return super().create(**kwargs)


def _launch(ns, tags, **kw):
    return ns["JobLauncher"]("/Users/a/agent", {"14_session_id": "1"}, tags).launch(
        job_name="dbx_inspire_ai_churn_1a2b3c4d", run_name="dbx_inspire_ai_churn_1a2b3c4d", **kw)


def test_a_relaunch_keeps_the_asset_and_user_tags_already_on_the_job(ns, cap_sdk):
    live = {"team": "growth", "dbx_inspire_ai_app_name": "churn-desk", "dbx_inspire_ai_assets": "app", "dbx_inspire_ai_run_type": "old"}
    cap_sdk["jobs"] = jobs = _TagJobs(live)
    assert _launch(ns, {"dbx_inspire_ai_run_type": "implement", VERSION_KEY: "v1.3.0"})["success"] is True
    [settings] = jobs.settings
    assert settings.tags == {"team": "growth", "dbx_inspire_ai_app_name": "churn-desk", "dbx_inspire_ai_assets": "app",
                             "dbx_inspire_ai_run_type": "implement", VERSION_KEY: "v1.3.0"}


def test_a_relaunch_whose_job_cannot_be_read_still_launches_with_its_own_tags(ns, cap_sdk, capsys):
    cap_sdk["jobs"] = jobs = _TagJobs({"team": "growth"}, get_raises=True)
    assert _launch(ns, {"dbx_inspire_ai_run_type": "implement"})["success"] is True
    assert jobs.settings[0].tags == {"dbx_inspire_ai_run_type": "implement"}
    assert "so its tags are set to this run's only" in capsys.readouterr().out
    cap_sdk["jobs"] = _TagJobs({}, get_raises=True)
    refused = _launch(ns, {"dbx_inspire_ai_run_type": "implement"}, schedule_cron="0 0 8 * * ?")
    assert refused["success"] is False and "could not be read to check whether it already has a schedule" in refused["error"]


def test_a_new_job_is_created_with_capped_tags(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _TagJobs({})
    jobs.existing_job_id = None
    many = {f"dbx_inspire_ai_extra_{i:02d}": "v" for i in range(25)}
    assert _launch(ns, many)["success"] is True
    assert len(jobs.settings[0].tags) == 20


def test_the_scheduled_plan_merges_tags_too(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _TagJobs({"dbx_inspire_ai_dashboard_id": "d1"})
    launcher = ns["JobLauncher"]("/Users/a/agent", {"14_session_id": "1"}, {"dbx_inspire_ai_run_type": "analysis"})
    launcher._detect_compute_type = lambda: (True, None)
    assert launcher.plan_next_scheduled_run("dbx_inspire_ai_churn_1a2b3c4d") == 77
    assert jobs.settings[0].tags == {"dbx_inspire_ai_dashboard_id": "d1", "dbx_inspire_ai_run_type": "analysis"}


def test_closing_grep_every_job_write_in_the_launcher_goes_through_the_tag_merge():
    src = agent_source()
    start = src.index("class JobLauncher:")
    launcher = src[start:src.index("\n'''", start)]
    assert launcher.count("tags=self.job_tags") == 0
    assert launcher.count("JobLauncher.merged_tags(") == 3
    assert src.count("**INSPIRE_VERSION_TAGS") == 2
    assert src.count("self._implement_tag_job_assets(") == 1
