import json

import pytest

from v167_untargeted_guard_test import PART, V3, _Runner, _copy, _page_inspire

HOUR_ASK = "Add a bar chart of trips by hour of day (0-23) to the App page, under Key numbers, titled Trips by pickup hour"
HOUR_SQL = "SELECT as_of_date, HOUR(pickup_at) AS pickup_hour, COUNT(*) AS trips FROM main.inspire.n02_u01_out GROUP BY 1, 2"
HOUR_CHART = {"id": "trips_by_pickup_hour", "title": "Trips by pickup hour", "type": "bar", "dataset": "hourly_pickups",
              "x": {"column": "pickup_hour", "label": "Hour of day"}, "y": [{"expression": "SUM(trips)", "label": "Trips"}]}
HOUR_SPLIT = [{"ask": HOUR_ASK, "check": {"kind": "chart_type", "value": "bar"}, "keep": False, "where": "Key numbers"}]


def _with_hour_chart(prior, label=None):
    page = _copy(prior)
    page["datasets"].append({"name": "hourly_pickups", "sql": HOUR_SQL})
    page["charts"].append(HOUR_CHART)
    run_date = page["filters"][0]
    run_date["columns"]["hourly_pickups"] = "as_of_date"
    if label:
        run_date["label"] = label
    return page


def _targets(agent_ns, new):
    return agent_ns["implement_untargeted_targets"]("app", [(PART, dict(HOUR_SPLIT[0]))], V3, new, "records")


def test_wiring_a_new_chart_s_dataset_into_a_kept_filter_is_part_of_the_ask_not_an_untargeted_change(agent_ns):
    new = _with_hour_chart(V3)
    changes = agent_ns["implement_untargeted_changes"]("app", V3, new, _targets(agent_ns, new), "records")
    assert [c["key"] for c in changes] == [], "the run date filter only gained the new dataset, which v3 did not have"


def test_a_filter_genie_also_changed_is_put_back_and_keeps_the_new_dataset_wiring(agent_ns):
    new = _with_hour_chart(V3, label="Pickup date")
    targets = _targets(agent_ns, new)
    changes = agent_ns["implement_untargeted_changes"]("app", V3, new, targets, "records")
    assert [(c["key"], c["change"]) for c in changes] == [("filters:run_date", "changed")]
    merged, restored, blocked = agent_ns["implement_restore_untargeted"]("app", V3, new, changes, targets, "records")
    run_date = merged["filters"][0]
    assert run_date["label"] == "Run date", "the label no ask names goes back to what v3 built"
    assert run_date["columns"] == {"records": "as_of_date", "hourly_pickups": "as_of_date"}, \
        "the filter still reaches the chart the ask added"
    assert blocked == [] and [c["key"] for c in restored] == ["filters:run_date"]
    stale = _copy(V3)["filters"][0]
    merged["filters"][0] = stale
    assert "hourly_pickups" not in merged["filters"][0]["columns"], "the probe: without the wiring the chart is unreached"


class _Shell:
    def __init__(self, problems):
        self.problems = problems

    def spec_problems(self, page):
        return []

    def quality_problems(self, page, event_date=False):
        return self.problems(page)


def _unreached(page):
    covered = {d for f in page.get("filters") or [] for d in f.get("columns") or {}}
    return [f"no filter reaches chart {c['id']} (dataset {c['dataset']}), so the filters would not change it"
            for c in page.get("charts") or [] if c.get("dataset") == "hourly_pickups" and c["dataset"] not in covered]


def test_a_put_back_that_breaks_the_page_checks_fails_inside_the_genie_round_not_at_publish(agent_ns):
    checked = agent_ns["implement_put_back_checked"]
    genie = _with_hour_chart(V3)
    broken = _copy(genie)
    broken["filters"][0]["columns"].pop("hourly_pickups")
    with pytest.raises(RuntimeError) as raised:
        checked(genie, broken, _Shell(_unreached), False, "App")
    assert "no filter reaches chart trips_by_pickup_hour (dataset hourly_pickups)" in str(raised.value)
    assert "once Inspire put back the parts of the App no ask targets" in str(raised.value)
    assert checked(genie, genie, _Shell(_unreached), False, "App") is genie
    fine = _copy(genie)
    assert checked(genie, fine, _Shell(_unreached), False, "App") == fine
    same = _copy(broken)
    assert checked(broken, same, _Shell(_unreached), False, "App") == same, \
        "a problem Genie's own page already had is the page check's to report, not the put-back's"
    assert checked(genie, broken, _Shell(_unreached), False, "App", prior=broken) == broken, \
        "a problem the version before already had and published is not one the put-back made"


def test_the_hour_chart_ask_reaches_publish_with_its_filter_wiring(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=HOUR_ASK, splits={HOUR_ASK: HOUR_SPLIT})
    inst._implement_page_spec(context, _Runner([_with_hour_chart(V3, label="Pickup date")]), "app", deploy)
    page = deployed[-1]
    assert page["filters"][0]["columns"]["hourly_pickups"] == "as_of_date"
    assert page["filters"][0]["label"] == "Run date"
    assert "trips_by_pickup_hour" in [c["id"] for c in page["charts"]]


def _status():
    return {"app": {"state": "ready", "spec_version": 3},
            PART: {"state": "ready", "spec_version": 4,
                   "vibes_checks": [{"ask": HOUR_ASK, "status": "done", "evidence": "the chart is there",
                                     "checks": [{"name": "chart_type", "passed": True}]}],
                   "vibes_split": {"text": HOUR_ASK, "asks": HOUR_SPLIT}},
            "genie_space": {"state": "ready", "vibes_checks": [{"ask": "Answer in Arabic", "status": "done", "evidence": "ok"}]}}


def test_an_ask_whose_part_failed_to_publish_is_not_met_with_the_plain_reason(agent_ns):
    status = _status()
    reason = "page.json does not fit the App: no filter reaches chart trips_by_pickup_hour (dataset hourly_pickups)"
    assert agent_ns["implement_publish_missed"](status, "app", 4, reason) == 1
    [check] = status[PART]["vibes_checks"]
    assert check["status"] == "missing"
    assert check["evidence"].startswith(agent_ns["IMPLEMENT_PUBLISH_MISSED"])
    assert "publishing the App failed, so the live App does not have it" in check["evidence"] and reason in check["evidence"]
    assert status[PART]["state"] == "failed"
    assert status["genie_space"]["vibes_checks"][0]["status"] == "done", "another part's published ask stays met"
    spec = {"outputs": {"app": True, f"{PART}_vibes": HOUR_ASK, "genie_space": True}}
    unmet = agent_ns["implement_live_unmet"](status, spec)
    assert unmet.get(PART) == [HOUR_ASK], "the ask stays waiting for the next build"
    assert "genie_space" not in unmet


def test_the_checklist_after_a_failed_publish_lists_the_ask_as_not_met(agent_ns, tmp_path):
    inst, context, _deployed, _deploy = _page_inspire(agent_ns, tmp_path, ask_text=HOUR_ASK, splits={HOUR_ASK: HOUR_SPLIT})
    context["asset_status"] = _status()
    context["spec"]["outputs"].pop("genie_space", None)
    context["vibes_checked"] = {PART: HOUR_ASK}
    context["vibes_split"] = {(PART, HOUR_ASK): HOUR_SPLIT}
    agent_ns["implement_publish_missed"](context["asset_status"], "app", 4, "the v4 App no longer passes its checks")
    entries = inst._implement_vibe_checklist(context)
    hour = [e for e in entries if e["requirement"] == HOUR_ASK]
    assert hour and hour[0]["status"] == "not_met"
    assert context["asset_status"]["checklist_summary"]["met"] == 0
    assert agent_ns["implement_unmet_asks"](context["asset_status"]), "a not-met ask keeps the version from reading as all met"
