from v143_vibes_test import _locked, _run
from v169_green_hub_test import NOT_RELIABLE

REASON = "the data ends on 2024-05-17, so this run has no recent records to judge"


class _Row(dict):
    def asDict(self):
        return dict(self)


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return self.rows


def _latest(inst, reason, asked):
    plain = inst.spark.sql

    def sql(text, *args, **kw):
        if "ORDER BY updated_at DESC NULLS LAST LIMIT 1" in text and "not_reliable" in text:
            asked.append((text, kw.get("args")))
            return _Rows([_Row(not_reliable=reason)] if reason is not None else [])
        return plain(text, *args, **kw)
    inst.spark.sql = sql


def _build(agent_ns, tier, facts, asked=None):
    inst, previous = _locked(agent_ns)
    built = []
    inst._implement_runner = lambda uc: "genie"
    inst._implement_tier_warning = lambda uc_id, table, url, run_id=None: tier
    inst._implement_run_facts = lambda uc_id, table, run_id: {}
    _latest(inst, facts.get("not_reliable"), [] if asked is None else asked)
    inst._implement_dashboard = lambda context, runner: built.append("dashboard") or {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    inst._implement_app = lambda context, runner: built.append("app") or {"app_name": "a", "app_url": "https://h/a"}
    status = _run(inst, dict(previous, retry_outputs=["dashboard", "app"]))
    return status, inst.updates[-1], inst.emitted, built


def test_an_app_whose_run_is_not_reliable_is_not_published_and_says_why_and_the_next_step(agent_ns):
    status, final, emitted, built = _build(agent_ns, NOT_RELIABLE, {"not_reliable": REASON, "nothing_to_act": ""})
    assert "app" not in built and "dashboard" in built, built
    assert final["asset_status"][agent_ns["IMPLEMENT_NOT_RELIABLE"]] == {"reason": REASON, "spec_version": 3}
    said = agent_ns["implement_unreliable_app_text"](REASON)
    assert said in final["status_message"] and said.startswith("App: not published, because the latest run marked its results not reliable")
    assert said.endswith("build it again with Vibe/Add/Remove Features on the Build page")
    assert any("[UNRELIABLE-HOLD FIRED]" in str(e.get("message") or e.get("result_json") or e) for e in emitted if e.get("step_name") == "App")
    assert status != "ready"


def test_a_reliable_run_publishes_the_app_and_records_no_hold(agent_ns):
    status, final, _emitted, built = _build(agent_ns, "", {"not_reliable": "", "nothing_to_act": ""})
    assert "app" in built and agent_ns["IMPLEMENT_NOT_RELIABLE"] not in final["asset_status"]


def test_a_rebuild_that_runs_nothing_still_holds_the_app_when_the_latest_run_is_not_reliable(agent_ns):
    asked = []
    live = ("Not reliable yet: run 333333333333333 stopped before it wrote any record: the newest pickup is 2016-02-29, older than the "
            "freshness limit")
    status, final, _emitted, built = _build(agent_ns, "", {"not_reliable": live}, asked)
    assert asked and asked[0][1] == {"uc": "N01-U01"} and "summary" in asked[0][0], asked
    assert "app" not in built and status != "ready"
    assert final["asset_status"][agent_ns["IMPLEMENT_NOT_RELIABLE"]]["reason"].startswith("Not reliable yet: run")


def test_a_summary_with_no_row_holds_nothing(agent_ns):
    status, final, _emitted, built = _build(agent_ns, "", {"not_reliable": None})
    assert "app" in built and agent_ns["IMPLEMENT_NOT_RELIABLE"] not in final["asset_status"]
