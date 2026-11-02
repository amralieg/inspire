"""Inside Inspire, the fourth App placement: the wizard's choice to host a use case's page in Inspire's Run tab instead of a Databricks
App of its own. The spec keeps it only with per-viewer access, Delta tables, no App to join and a SQL warehouse each viewer reads with,
and a move to or from it rebuilds the App part alone, offline."""
import json
import os

import pytest

from v140_implement_test import FIXTURE, VALID

PARITY = os.path.join(os.path.dirname(FIXTURE), "implement_spec_parity.json")
HOSTED = {"app_placement": "inspire", "app_access": "user", "app_backend": "delta", "app_warehouse_id": "wh2"}
ACCESS = "a page inside Inspire shows each viewer only the data they may read, so it always signs viewers in as themselves"
BACKEND = "a page inside Inspire reads Delta tables; Lakebase needs an App of its own"
MERGE = "a page inside Inspire belongs to this use case alone, so it cannot be added to another App; leave outputs.merge.app empty"
WAREHOUSE = ("a page inside Inspire needs outputs.app_warehouse_id, the SQL warehouse each viewer reads with; each viewer needs CAN USE "
             "on it")
ADDRESS = ("outputs.inspire_url must be the https address of the Inspire App with nothing after its host, such as "
           "https://inspire.example.com: every App page and dashboard links to its use case on Inspire's Review page")
PLACEMENTS = ("choose how Inspire organizes Apps: 'domain' (one App per business domain), 'use_case' (one App per use case), "
              "'business' (one App for all use cases) or 'inspire' (Inside Inspire, each use case's page in Inspire's Run tab; not "
              "recommended, only for testing), not {}")
ASSETS = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 9}


def _outputs(**changes):
    return dict(VALID["outputs"], **changes)


def _validated(ns, **changes):
    return ns["validate_implement_spec"](dict(VALID, outputs=_outputs(**changes)))


def test_inside_inspire_is_the_fourth_placement_with_its_label_and_tag(agent_ns):
    assert agent_ns["IMPLEMENT_APP_PLACEMENTS"] == ("domain", "use_case", "business", "inspire")
    assert agent_ns["IMPLEMENT_APP_HOSTED"] == "inspire"
    assert (agent_ns["IMPLEMENT_APP_HOSTED_LABEL"], agent_ns["IMPLEMENT_APP_HOSTED_TAG"]) == ("Inside Inspire",
                                                                                            "Not recommended, only for testing")
    assert agent_ns["IMPLEMENT_APP_HOSTED_ERRORS"] == {"access": ACCESS, "backend": BACKEND, "merge": MERGE, "warehouse": WAREHOUSE,
                                                       "inspire_url": ADDRESS}
    errors = _validated(agent_ns, app_placement="inside")[1]
    assert PLACEMENTS.format("'inside'") in errors, errors


def test_a_page_inside_inspire_with_per_viewer_access_delta_and_a_warehouse_is_kept_and_ignores_the_app_name(agent_ns):
    spec, errors = _validated(agent_ns, app_name="Not_An_App_Name", **HOSTED)
    assert errors == []
    outputs = spec["outputs"]
    assert (outputs["app_placement"], outputs["app_access"], outputs["app_backend"], outputs["app_warehouse_id"]) == (
        "inspire", "user", "delta", "wh2")
    assert outputs["app_name"] == "", "a page inside Inspire has no App, so the App name is not kept"
    assert outputs["merge"]["app"] == "" and agent_ns["implement_app_hosted"](outputs) is True
    assert agent_ns["implement_app_hosted"](_validated(agent_ns)[0]["outputs"]) is False
    assert agent_ns["implement_app_hosted"](dict(outputs, app=False)) is False, "a placement without an App hosts nothing"
    assert outputs["app_options"]["decisions"] is True and outputs["app_options"]["alerts"] is False, (
        "a page inside Inspire records decisions in each viewer's name and sends no alerts")


@pytest.mark.parametrize("changes,problem", [
    ({"app_access": "sp"}, ACCESS),
    ({"app_access": "SP"}, ACCESS),
    ({"app_backend": "lakebase"}, BACKEND),
    ({"merge": {"app": "sales-desk"}}, MERGE),
    ({"app_warehouse_id": ""}, WAREHOUSE),
    ({"app_warehouse_id": "   "}, WAREHOUSE),
    ({"app_warehouse_id": None}, WAREHOUSE),
], ids=["service_principal", "service_principal_capitals", "lakebase", "merge_target", "blank_warehouse", "spaces_warehouse",
        "missing_warehouse"])
def test_a_page_inside_inspire_refuses_what_it_cannot_honor_and_never_coerces_it(agent_ns, changes, problem):
    spec, errors = _validated(agent_ns, **dict(HOSTED, **changes))
    assert errors == [problem], errors
    if "app_access" in changes:
        assert spec["outputs"]["app_access"] == "sp", "the spec keeps what was sent; Inspire refuses it rather than switch it"
    if "app_backend" in changes:
        assert spec["outputs"]["app_backend"] == "lakebase"


def test_a_page_inside_inspire_with_everything_wrong_names_each_problem_once(agent_ns):
    outputs = {k: v for k, v in HOSTED.items() if k != "app_warehouse_id"}
    errors = _validated(agent_ns, merge={"app": "sales-desk"}, **dict(outputs, app_access="sp", app_backend="lakebase"))[1]
    assert sorted(errors) == sorted([ACCESS, BACKEND, MERGE, WAREHOUSE])


def test_a_warehouse_that_is_not_an_id_gets_its_own_error_and_not_a_second_one(agent_ns):
    errors = _validated(agent_ns, **dict(HOSTED, app_warehouse_id="a/b"))[1]
    assert errors == ["outputs.app_warehouse_id 'a/b' must be the id of a SQL warehouse: up to 64 letters, digits, dashes and "
                      "underscores, or empty for the SQL warehouse the build uses"]
    assert _validated(agent_ns, **dict(HOSTED, app_warehouse_id=5))[1] == ["outputs.app_warehouse_id must be text, not 5"]


def test_the_rules_hold_only_for_an_app_inside_inspire(agent_ns):
    assert _validated(agent_ns, app_placement="use_case", app_access="sp", app_backend="lakebase")[1] == []
    spec, errors = agent_ns["validate_implement_spec"](dict(VALID, outputs={"dashboard": True, "app_placement": "inspire", "inspire_url": VALID["outputs"]["inspire_url"],
                                                                            "app_access": "sp"}))
    assert errors == [] and spec["outputs"]["app_placement"] == "", "without an App the placement is not kept or checked"


def test_a_move_to_or_from_inside_inspire_is_an_app_only_change(agent_ns):
    validate, classify, plan_fn = agent_ns["validate_implement_spec"], agent_ns["classify_implement_change"], agent_ns["implement_plan"]
    own = validate(dict(VALID, outputs=_outputs(app_access="user", app_backend="delta", app_warehouse_id="wh2")))[0]
    hosted = validate(dict(VALID, outputs=_outputs(**HOSTED)))[0]
    for before, after in ((own, hosted), (hosted, own)):
        assert classify(before, after) == ["outputs"]
        plan = plan_fn(before, after, dict(ASSETS, app="n01-u01" if before is hosted else "churn-desk"), has_built_notebook=True)
        assert plan["build"] == ["app"] and plan["refresh"] == [] and plan["restyle"] == [] and plan["rollback"] == {}
        assert plan["refill"] is False and plan["preview"] is False and plan["schedule"] is False
        assert plan["delete"] == [] and plan["keep_unmanaged"] == []


def test_inside_inspire_the_app_name_is_no_change_and_a_page_already_hosted_is_not_rebuilt(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before = validate(dict(VALID, outputs=_outputs(app_name="churn-desk", **HOSTED)))[0]
    after = validate(dict(VALID, outputs=_outputs(app_name="other-desk", **HOSTED)))[0]
    assert agent_ns["classify_implement_change"](before, after) == []
    plan = plan_fn(before, dict(after, schedule=dict(after["schedule"], cron="0 0 7 ? * MON")), dict(ASSETS, app="n01-u01"),
                   has_built_notebook=True)
    assert plan["classes"] == ["schedule"] and plan["build"] == [] and plan["refresh"] == []
    restyled = validate(dict(VALID, outputs=_outputs(app_look={"theme": "dark"}, **HOSTED)))[0]
    plan = plan_fn(before, restyled, dict(ASSETS, app="n01-u01"), has_built_notebook=True)
    assert plan["refresh"] == ["app"] and plan["restyle"] == ["app"] and plan["build"] == []


def test_the_shared_fixtures_carry_the_inside_inspire_cases_the_app_checks_too(agent_ns):
    with open(FIXTURE) as handle:
        fixture = json.load(handle)
    names = {case["name"] for case in fixture["cases"]}
    assert {"app moved inside Inspire", "app moved out of Inspire", "app name changed inside Inspire"} <= names
    plans = {entry["name"]: entry for entry in fixture["plans"]}
    for name in ("a move inside Inspire rebuilds only the App", "a move out of Inspire rebuilds only the App"):
        assert plans[name]["summary"]["build"] == ["app"] and plans[name]["summary"]["refill"] is False
    assert fixture["contract_tables"]["IMPLEMENT_APP_PLACEMENTS"] == list(agent_ns["IMPLEMENT_APP_PLACEMENTS"])
    with open(PARITY) as handle:
        parity = json.load(handle)
    hosted = [case for case in parity["cases"] if case["name"].startswith("inside Inspire")]
    assert len(hosted) >= 5
    assert any(case["errors"] == [] for case in hosted) and any(ACCESS in case["errors"] for case in hosted)
    assert any(MERGE in case["errors"] for case in hosted) and any(WAREHOUSE in case["errors"] for case in hosted)
    stale = [case["name"] for case in parity["cases"] if any("'business' (one App for all use cases), not" in e for e in case["errors"])]
    assert stale == [], "every placement error names the four placements"
    assert parity["clean"]["outputs"]["inspire_url"] == "https://inspire.example.com"
    addressed = {case["name"]: case for case in parity["cases"] if "Inspire address" in case["name"]}
    assert len(addressed) >= 19 and sum(case["errors"] == [ADDRESS] for case in addressed.values()) >= 13
    for name in ("inside Inspire with the Inspire address", "inside Inspire with an Inspire address that ends in a slash",
                 "an App of its own with the Inspire address in capitals and a slash"):
        assert addressed[name]["errors"] == [] and not any(path == ["outputs", "inspire_url"] for path, _v in addressed[name]["changes"]), name
    for name in ("an App of its own with no Inspire address", "an App for the domain with no Inspire address",
                 "one App for all use cases with no Inspire address", "a dashboard with no App and no Inspire address",
                 "inside Inspire with a blank Inspire address", "an App of its own refuses an Inspire address with a path"):
        assert addressed[name]["errors"] == [ADDRESS], name
    assert addressed["no App and no dashboard drops the Inspire address"]["errors"] == []
    assert [["outputs", "inspire_url"], ""] in addressed["no App and no dashboard drops the Inspire address"]["changes"]
    assert "the Inspire address set inside Inspire" not in names, "a spec always carries the Inspire address, so none is set later"
    assert next(c for c in fixture["cases"] if c["name"] == "the Inspire address changed inside Inspire")["classes"] == ["outputs"]
    summary = plans["a new Inspire address rebuilds the App with its new Review link"]["summary"]
    assert summary["build"] == [] and "app" in summary["refresh"] and summary["refill"] is False and summary["schedule"] is False
    cases = {case["name"]: case for case in fixture["cases"]}
    validate = agent_ns["validate_implement_spec"]
    assert [entry["relink"] for entry in fixture["relinks"]] == [["alert"], []]
    for entry in fixture["relinks"]:
        case = cases[entry["case"]]
        plan = agent_ns["implement_plan"](validate(case["previous"])[0], validate(case["current"])[0], dict(entry["assets"]),
                                          has_built_notebook=True)
        assert plan["relink"] == entry["relink"] and plans[entry["name"]]["summary"]["build"] == [], entry["name"]
        assert "app" in plans[entry["name"]]["summary"]["refresh"], "the page is rebuilt with its new Review link"
    tables = fixture["contract_tables"]
    assert tables["IMPLEMENT_DIGEST_APP_LINE"] == "Open the Impact page of the App"
    assert tables["IMPLEMENT_APP_HOSTED_ERRORS"]["inspire_url"] == ADDRESS
    assert tables["IMPLEMENT_APP_HOSTED_EMAIL"] == "Open this use case's page in Inspire's Run tab"


@pytest.mark.parametrize("placement", ["inspire", "use_case", "domain", "business"])
@pytest.mark.parametrize("sent,kept", [
    ("https://inspire.example.com", "https://inspire.example.com"),
    ("  HTTPS://Inspire.Example.COM ", "https://inspire.example.com"),
    ("https://inspire.example.com/", "https://inspire.example.com"),
    ("https://inspire-1234.apps.example.org", "https://inspire-1234.apps.example.org"),
], ids=["host", "capitals_and_spaces", "trailing_slash", "app_host"])
def test_every_app_placement_keeps_the_inspire_address_as_its_host_alone(agent_ns, sent, kept, placement):
    outputs = dict(HOSTED, inspire_url=sent) if placement == "inspire" else dict(app_placement=placement, inspire_url=sent)
    spec, errors = _validated(agent_ns, **outputs)
    assert errors == [] and spec["outputs"]["inspire_url"] == kept


@pytest.mark.parametrize("placement", ["inspire", "use_case", "domain", "business", "dashboard alone"])
@pytest.mark.parametrize("sent", [
    "", "   ", None, "https://inspire.example.com//", "https://inspire.example.com/app", "https://inspire.example.com?page=run",
    "https://inspire.example.com#/run", "http://inspire.example.com", "https://inspire.example.com:8443", "https://me@inspire.example.com",
    "inspire.example.com", "https://", "https://-inspire.example.com", "https://inspire..example.com", "https://inspire example.com",
    "https://" + "a" * 64 + ".example.com", 5, ["https://inspire.example.com"],
], ids=["empty", "spaces", "missing", "two_slashes", "path", "query", "fragment", "http", "port", "user", "no_scheme", "no_host",
        "leading_dash", "empty_label", "space", "long_label", "number", "list"])
def test_an_app_or_a_dashboard_refuses_an_inspire_address_that_is_missing_or_anything_but_an_https_host(agent_ns, sent, placement):
    outputs = (dict(HOSTED, inspire_url=sent) if placement == "inspire" else dict(app=False, inspire_url=sent) if placement == "dashboard alone"
               else dict(app_placement=placement, inspire_url=sent))
    spec, errors = _validated(agent_ns, **outputs)
    assert errors == [ADDRESS] and spec["outputs"]["inspire_url"] == ""


def test_the_inspire_address_is_dropped_with_no_app_and_no_dashboard_and_a_new_one_rebuilds_their_review_links(agent_ns):
    spec, errors = _validated(agent_ns, app=False, dashboard=False, app_placement="inspire", inspire_url=7)
    assert errors == [] and spec["outputs"]["inspire_url"] == "", "with nothing that links to Inspire there is no address to keep"
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    for outputs, assets in ((HOSTED, dict(ASSETS, app="n01-u01-5150")), ({"app_placement": "use_case"}, ASSETS),
                            ({"app": False}, ASSETS)):
        before = validate(dict(VALID, outputs=_outputs(**outputs, inspire_url="https://inspire.example.com")))[0]
        after = validate(dict(VALID, outputs=_outputs(**outputs, inspire_url="https://inspire-2.example.com")))[0]
        assert agent_ns["classify_implement_change"](before, after) == ["outputs"], outputs
        plan = plan_fn(before, after, dict(assets), has_built_notebook=True)
        linked = ["app", "dashboard"] if after["outputs"]["app"] else ["dashboard"]
        assert plan["build"] == [] and sorted(plan["refresh"]) == linked and plan["refill"] is False and plan["preview"] is False, outputs
        assert plan["restyle"] == [] and plan["relink"] == [], "with no alert there is no email to point at the new address"


def test_a_new_inspire_address_points_the_weekly_email_at_it_without_rebuilding_the_alert(agent_ns):
    validate, plan_fn = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    alert = {"alert": True, "alert_recipients": ["owner@example.com"]}
    assets = dict(ASSETS, app="n01-u01-5150", alert="al-1")

    def plan(before_url, after_url, **changes):
        before = validate(dict(VALID, outputs=_outputs(**HOSTED, **alert, inspire_url=before_url)))[0]
        after = validate(dict(VALID, outputs=_outputs(**HOSTED, **dict(alert, **changes), inspire_url=after_url)))[0]
        return plan_fn(before, after, dict(assets), has_built_notebook=True)

    moved = plan("https://inspire.example.com", "https://inspire-2.example.com")
    assert moved["relink"] == ["alert"] and moved["build"] == [] and sorted(moved["refresh"]) == ["app", "dashboard"]
    assert moved["classes"] == ["outputs"]
    assert plan("https://inspire.example.com", "https://inspire.example.com")["relink"] == []
    assert plan("https://inspire.example.com", "https://inspire-2.example.com", alert_digest=False)["relink"] == [], \
        "with the weekly email off there is nothing to relink"
    rebuilt = plan("https://inspire.example.com", "https://inspire-2.example.com", alert_name="Churn watch")
    assert "alert" in rebuilt["refresh"] and rebuilt["relink"] == [], "an alert that is rebuilt writes the new link itself"


def test_the_shared_fixture_holds_the_email_lines_the_agent_writes_and_the_relink_plan_text(agent_ns):
    with open(FIXTURE) as handle:
        fixture = json.load(handle)
    lines = fixture["digest_lines"]
    assert len(lines) == 5
    for entry in lines:
        assert agent_ns["implement_digest_page_line"](entry["app_url"], entry["hosted_id"], entry["inspire_url"]) == entry["line"], entry["name"]
    assert fixture["contract_tables"]["IMPLEMENT_DIGEST_RELINK_PLAN"] == agent_ns["IMPLEMENT_DIGEST_RELINK_PLAN"]
    assert [e["line"] for e in lines if e["hosted_id"] and e["inspire_url"]] == [
        f"{agent_ns['IMPLEMENT_APP_HOSTED_EMAIL']}: {e['inspire_url']}/?run={e['hosted_id']}" for e in lines if e["hosted_id"] and e["inspire_url"]]
    assert [e["line"] for e in lines if not (e["inspire_url"] if e["hosted_id"] else e["app_url"])] == ["", ""], \
        "with no address to link to there is no line, never a line without its link"
