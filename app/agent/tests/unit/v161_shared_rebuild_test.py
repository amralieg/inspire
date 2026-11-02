"""A rebuild of a dashboard, Genie Agent or App that other use cases share replaces only the rebuilding use case's part and keeps
every other use case's part, and when the builder leaves, the dashboard and the Genie Agent are named after the use case that keeps
them, offline."""
import json

import pytest

from v140_implement_test import OURS_APP, _FileRunner, _app_flow, _dashboard, _output_context
from v142_genie_test import COLUMNS as GENIE_COLUMNS, _definition, _rich_space
from v142_merge_test import (DASH, HOST_BOARD, OWN_SOURCE, _dashboard_inspire, _genie_answer, _host_files, _host_page, _normalized,
                             _page_runner, _router, _serve_files)
from v161_shared_take_out_test import HOST, KEY, _sharing, _taker

HOLDERS_SQL = ("(`{column}` = :asset OR CAST(spec_json:outputs.merge.{name} AS STRING) = :asset) "
               "AND NOT (session_id = :sid AND use_case_id = :uc)")
LABEL7 = "For use case N01-U07 Sales, whose results are in `main.inspire.sales_out`:"
LABEL8 = "For use case N01-U08 Stock, whose results are in `main.inspire.stock_out`:"
JOINED = {"session_id": 777, "use_case_id": "N01-U07", "spec_version": 2, "status": "ready",
          "spec_json": {"use_case_name": "Sales", "outputs": {"merge": {"dashboard": "d1", "genie_space": "g1"}}}}
JOINING = {"session_id": 9, "use_case_id": "N02-U01", "spec_version": 4, "status": "building_outputs",
           "spec_json": {"use_case_name": "Forecast demand", "outputs": {"merge": {"dashboard": "d1", "genie_space": "g1"}}}}


def _joiner_board(ns, board, session_id, uc_id, with_filter=True):
    theirs = json.loads(_dashboard(("main.inspire.sales_out",)))
    if with_filter:
        theirs["pages"].append({"name": "gf", "pageType": "PAGE_TYPE_GLOBAL_FILTERS", "layout": [
            {"widget": {"name": "f", "queries": [{"name": "q", "query": {"datasetName": "decision_list"}}]},
             "position": {"x": 0, "y": 0, "width": 2, "height": 2}}]})
    merged, problems = ns["implement_merge_dashboard"](board, theirs, ns["implement_dashboard_prefix"](session_id, uc_id), uc_id)
    assert problems == []
    return merged


def _texts(space, kind="sample_questions"):
    items = space["config"][kind] if kind == "sample_questions" else space["instructions"][kind]
    return sorted("".join(i["question"]) for i in items)


def _content(space):
    return "".join(space["instructions"]["text_instructions"][0]["content"])


def test_the_builder_rebuilding_a_shared_dashboard_replaces_only_its_own_pages_and_keeps_every_other_use_cases_part(agent_ns, tmp_path):
    shared = _joiner_board(agent_ns, _joiner_board(agent_ns, HOST_BOARD, 777, "N01-U07"), 9, "N02-U01")
    current = dict(DASH, dashboard_id="d1", display_name="N01-U01 Predict churn", serialized_dashboard=json.dumps(shared))
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): current, ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): {}}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    _sharing(inst, [JOINED, JOINING], {"N01-U07": ({"dashboard_id": "d1"}, {"dashboard": {"state": "ready", "merged_into": "d1"}})})
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    fields = inst._implement_dashboard(context, _page_runner(agent_ns))
    assert fields["dashboard_id"] == "d1"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/d1"), ("GET", "/api/2.0/lakeview/dashboards/d1"),
                                      ("PATCH", "/api/2.0/lakeview/dashboards/d1"), ("POST", "/api/2.0/lakeview/dashboards/d1/published")]
    assert inst.selected == [(HOLDERS_SQL.format(column="dashboard_id", name="dashboard"), {"asset": "d1", "sid": 5150, "uc": "N01-U01"})]
    patch = calls[2][2]
    assert set(patch) == {"serialized_dashboard", "display_name", "warehouse_id", "etag"} and patch["etag"] == "e1"
    assert (patch["display_name"], patch["warehouse_id"]) == ("N01-U01 Predict churn", "wh1")
    board = json.loads(patch["serialized_dashboard"])
    assert [p["name"] for p in board["pages"]] == ["overview", "run_health", "filters", "s777_n01_u07_p", "s9_n02_u01_p"], \
        "the builder's new pages replace its old ones and come first; the pages of the use cases that share it stay"
    assert [d["name"] for d in board["datasets"]] == ["trend", "records", "run_health", "chart_3_parts", "s777_n01_u07_decision_list",
                                                      "s9_n02_u01_decision_list"]
    assert [i["widget"]["name"] for i in board["pages"][2]["layout"]] == ["s777_n01_u07_f", "s9_n02_u01_f"], \
        "the shared filters keep the other use cases' filters and lose only the builder's old one"
    assert board["pages"][3:] == shared["pages"][2:], "the other use cases' pages come back exactly as they were"
    assert calls[3][2] == {"warehouse_id": "wh1", "embed_credentials": False}


def test_a_builder_that_cannot_check_who_shares_its_dashboard_does_not_rebuild_it(agent_ns, tmp_path):
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, {("GET", "/api/2.0/lakeview/dashboards/d1"): dict(DASH, dashboard_id="d1")})

    def broken(where, args, order=None):
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND: __inspire_implement")

    inst._implement_select = broken
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_dashboard(context, _page_runner(agent_ns))
    assert str(raised.value) == ("Dashboard: Inspire could not check whether other use cases share d1, so it did not rebuild it, which "
                                 "could drop their pages: TABLE_OR_VIEW_NOT_FOUND: __inspire_implement; submit again")
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/lakeview/dashboards/d1")]


def _genie_flow(ns, tmp_path, current, rows, carried):
    routes = {("GET", "/api/2.0/genie/spaces/g1"): _genie_answer("g1", current, "Churn questions"),
              ("PATCH", "/api/2.0/genie/spaces/g1"): {}}
    inst, calls = _dashboard_inspire(ns, tmp_path, routes, recorded=())
    inst._implement_space_columns = lambda tables: {t.lower(): GENIE_COLUMNS.get(t.lower(), []) for t in tables}
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    inst._implement_genie_smoke = lambda space_id, question, **kw: {"attachments": [{"query": {"query": "SELECT 1"}}]}
    _sharing(inst, rows, carried)
    context = _output_context(ns)
    context["assets"] = {"genie_space": "g1"}
    return inst, calls, context, _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}])


def _shared_space(ns):
    old = _normalized(ns, ("main.inspire.churn_out",), "Which stores lag?", "Old churn notes.")
    theirs = _normalized(ns, ("main.inspire.sales_out", "main.inspire.churn_out"), "Which stores lag?", "Sales are in dollars.")
    theirs["config"]["sample_questions"].append({"question": ["Who sells most?"]})
    shared, record, problems = ns["implement_merge_genie_space"](old, theirs, {}, LABEL7)
    assert problems == []
    return shared, dict(record, space_id="g1")


def test_the_builder_rebuilding_a_shared_genie_agent_keeps_every_table_question_and_instruction_the_others_added(agent_ns, tmp_path):
    shared, record = _shared_space(agent_ns)
    status = {"genie_space": {"state": "ready", "merged_into": "g1", "merged": record}}
    inst, calls, context, runner = _genie_flow(agent_ns, tmp_path, shared, [JOINED], {"N01-U07": ({"genie_space_id": "g1"}, status)})
    fields = inst._implement_genie_space(context, runner)
    assert fields["genie_space_id"] == "g1"
    assert [c[:2] for c in calls] == [("GET", "/api/2.0/genie/spaces/g1"), ("PATCH", "/api/2.0/genie/spaces/g1")]
    assert inst.selected == [(HOLDERS_SQL.format(column="genie_space_id", name="genie_space"), {"asset": "g1", "sid": 5150, "uc": "N01-U01"})]
    patch = calls[1][2]
    assert set(patch) == {"title", "description", "warehouse_id", "serialized_space"} and patch["title"] == "Churn desk"
    space = json.loads(patch["serialized_space"])
    assert [t["identifier"] for t in space["data_sources"]["tables"]] == ["main.inspire.churn_out", "main.inspire.sales_out", "main.s.orders"]
    assert _texts(space) == ["Which customers act now?", "Which stores lag?", "Who sells most?"], \
        "the builder's new question is in, and the questions use case N01-U07 added or also asked stay"
    assert _texts(space, "example_question_sqls") == ["Which customers act now?", "Which stores lag?"]
    content = _content(space)
    assert content.startswith("Rank 1 is the most urgent.") and "Old churn notes." not in content
    assert content.endswith(f"\n\n{LABEL7}\nSales are in dollars."), "the other use case's instructions stay word for word"
    assert record["already_held"]["sample_questions"] == ["which stores lag?"]


def test_a_builder_rebuild_that_cannot_tell_another_use_cases_genie_part_apart_changes_nothing_and_says_what_to_build_first(agent_ns,
                                                                                                                          tmp_path):
    shared, _record = _shared_space(agent_ns)
    carried = {"N01-U07": ({"genie_space_id": "g1"}, {"genie_space": {"state": "ready", "merged_into": "g1"}})}
    inst, calls, context, runner = _genie_flow(agent_ns, tmp_path, shared, [JOINED], carried)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_genie_space(context, runner)
    assert str(raised.value) == ("Inspire has no record of which tables, instructions and sample questions use case N01-U07 added to Churn "
                                 "questions (g1), so Inspire did not rebuild it, which would drop their part: build use case N01-U07 and "
                                 "then this use case again with Vibe/Add/Remove Features on the Build page, so Inspire records its part first")
    assert [c[0] for c in calls] == ["GET"]


def test_a_genie_rebuild_that_would_hold_too_many_tables_is_refused_and_says_whose_tables_they_are(agent_ns):
    fresh = {"data_sources": {"tables": [{"identifier": f"main.s.o{i:02d}"} for i in range(45)]}}
    current = {"data_sources": {"tables": [{"identifier": f"main.s.h{i:02d}"} for i in range(8)]}}
    _rebuilt, problems = agent_ns["implement_genie_rebuild"](current, fresh, [{"space_id": "g1", "tables": [f"main.s.h{i:02d}" for i in range(8)]}])
    assert problems == ["it would hold 53 tables, above the 50 a Genie Agent can hold (45 are this use case's, and the use cases that share "
                        "it add 8: main.s.h00, main.s.h01, main.s.h02, main.s.h03, main.s.h04 and 3 more)"]
    rebuilt, problems = agent_ns["implement_genie_rebuild"](current, {"data_sources": {"tables": [{"identifier": "main.s.o00"}]}},
                                                            [{"space_id": "g1", "tables": ["main.s.h00"]}])
    assert problems == [] and [t["identifier"] for t in rebuilt["data_sources"]["tables"]] == ["main.s.h00", "main.s.o00"]


def test_a_joiner_leaving_keeps_what_another_joiner_also_asked_for_and_drops_it_when_no_one_else_did(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    host = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    first = _normalized(agent_ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    second = _normalized(agent_ns, ("main.inspire.stock_out",), "Who leaves next?", "Stock is daily.")
    with_first, record_first, _p = merge(host, first, {}, "For use case N01-U01:")
    both, record_second, _p = merge(with_first, second, {}, LABEL8)
    assert record_second["already_held"] == {"sample_questions": ["who leaves next?"], "example_question_sqls": ["who leaves next?"]}
    left, problems = agent_ns["implement_genie_take_out"](both, record=record_first, keep_records=[record_second])
    assert problems == [] and _texts(left) == ["Which stores lag?", "Who leaves next?"], "the question use case N01-U08 also asked stays"
    assert "main.inspire.churn_out" in [t["identifier"] for t in left["data_sources"]["tables"]], "and so does the table its SQL reads"
    alone, _p = agent_ns["implement_genie_take_out"](with_first, record=record_first)
    assert _texts(alone) == ["Which stores lag?"], "with no one else asking for it, it leaves with the use case that added it"


def test_the_builder_leaving_a_shared_dashboard_names_it_after_the_use_case_whose_pages_now_come_first(agent_ns):
    board = _joiner_board(agent_ns, _joiner_board(agent_ns, HOST_BOARD, 5150, "N01-U08", False), 777, "N01-U07", False)
    current = dict(DASH, dashboard_id="d1", display_name="N01-U01 Predict churn", serialized_dashboard=json.dumps(board))
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): current, ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {},
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): {}}
    stock = {"session_id": 5150, "use_case_id": "N01-U08", "spec_version": 1, "status": "ready",
             "spec_json": {"use_case_name": "Stock", "outputs": {"dashboard_name": "Stock board", "merge": {"dashboard": "d1"}}}}
    held = ({"dashboard_id": "d1"}, {"dashboard": {"state": "ready", "merged_into": "d1"}})
    inst = _taker(agent_ns, routes, [JOINED, stock], {"N01-U07": held, "N01-U08": held})
    outcome = inst._implement_delete_output("dashboard", "d1", KEY, status={"state": "ready"})
    patch = next(c[2] for c in inst.calls if c[0] == "PATCH")
    assert patch["display_name"] == "Stock board", "the name use case N01-U08 chose wins, because its pages now come first"
    assert [p["name"] for p in json.loads(patch["serialized_dashboard"])["pages"]] == ["s5150_n01_u08_p", "s777_n01_u07_p"]
    assert outcome["note"] == ("this use case's pages were taken out of the dashboard N01-U01 Predict churn (d1), which Inspire published "
                               "again; it is now called Stock board, after use case N01-U08; it stays for use case N01-U07, N01-U08")
    builder = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "status": "ready", "spec_json": {"use_case_name": "Predict churn"}}
    joiner = _taker(agent_ns, routes, [builder, stock], {"N01-U01": ({"dashboard_id": "d1"}, {"dashboard": {"state": "ready"}}),
                                                         "N01-U08": held})
    joiner._implement_delete_output("dashboard", "d1", (777, "N01-U07", 2), status={"merged_into": "d1"})
    assert "display_name" not in next(c[2] for c in joiner.calls if c[0] == "PATCH"), "a joiner leaving never renames the builder's dashboard"


def test_the_builder_leaving_a_shared_genie_agent_names_it_after_the_use_case_whose_instructions_now_come_first(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    ours = _normalized(agent_ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    stock = _normalized(agent_ns, ("main.inspire.stock_out",), "What runs out?", "Stock is daily.")
    sales = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    with_stock, record8, _p = merge(ours, stock, {}, LABEL8)
    shared, record7, _p = merge(with_stock, sales, {}, LABEL7)
    routes = {("GET", "/api/2.0/genie/spaces/g1"): _genie_answer("g1", shared, "N01-U01 Predict churn"),
              ("PATCH", "/api/2.0/genie/spaces/g1"): {}}
    rows = [JOINED, {"session_id": 5150, "use_case_id": "N01-U08", "spec_version": 1, "status": "ready",
                     "spec_json": {"use_case_name": "Stock", "outputs": {"merge": {"genie_space": "g1"}}}}]
    status = lambda record: ({"genie_space_id": "g1"}, {"genie_space": {"state": "ready", "merged_into": "g1", "merged": dict(record, space_id="g1")}})
    inst = _taker(agent_ns, routes, rows, {"N01-U07": status(record7), "N01-U08": status(record8)})
    outcome = inst._implement_delete_output("genie_space", "g1", KEY, status={"state": "ready"})
    patch = next(c[2] for c in inst.calls if c[0] == "PATCH")
    assert patch["title"] == "N01-U08 Stock", "use case N01-U08 joined first, so its instructions now come first"
    assert _texts(json.loads(patch["serialized_space"])) == ["What runs out?", "Which stores lag?"]
    assert outcome["note"] == ("this use case's tables, instructions and sample questions were taken out of the Genie Agent N01-U01 Predict "
                               "churn (g1); it is now called N01-U08 Stock, after use case N01-U08; it stays for use case N01-U07, N01-U08")


def test_rebuilding_an_own_app_keeps_the_alerts_built_for_the_pages_merged_into_it(agent_ns, tmp_path, monkeypatch):
    merged_page = _host_page(agent_ns, "N01-U02", "Stock desk")
    own = _host_files(agent_ns, tmp_path, source=OWN_SOURCE, pages=[_host_page(agent_ns, "N01-U01", "Old"), merged_page],
                      title="N01-U01 Predict churn", genie="g1",
                      alerts={"n01_u01": "https://h/sql/alerts/1", "n01_u02": "https://h/sql/alerts/2", "gone": "https://h/sql/alerts/3"})
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    del inst._implement_app_host
    _serve_files(agent_ns, monkeypatch, own)
    inst._implement_api, _calls = _router({("GET", "/api/2.0/apps/churn-desk"): {"description": OURS_APP}})
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst._implement_app(context, None)
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert settings["pages"] == ["n01_u01", "n01_u02"]
    assert settings["alerts"] == {"n01_u02": "https://h/sql/alerts/2"}, \
        "the alert built for the merged page stays; this use case's own link follows its own alert and a page that left takes its link"


def test_a_use_case_still_joining_never_becomes_the_owner_of_a_shared_app(agent_ns):
    pages = [dict(_host_page(agent_ns, "N02-U01", "Demand"), id="n02_u01_s9"), _host_page(agent_ns, "N01-U08", "Stock")]
    holders = [dict(HOST, session_id=9, use_case_id="N02-U01", name="Demand", joining=True),
               dict(HOST, session_id=5150, use_case_id="N01-U08", name="Stock desk")]
    heir = agent_ns["implement_app_next_owner"](pages, holders, "5150")
    assert heir == {"use_case_id": "N01-U08", "session_id": "5150", "name": "Stock desk", "page_id": "n01_u08", "created_by": ""}
    alone = agent_ns["implement_app_next_owner"](pages, holders[:1], "5150")
    assert alone["use_case_id"] == "N02-U01", "when every use case left is still joining, the first page's use case takes it"
