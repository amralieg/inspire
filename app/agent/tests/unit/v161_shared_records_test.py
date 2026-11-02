"""Every holder of a shared Genie Agent has its part recorded before the asset lock is released, the builder's own rebuild takes that
lock, a holder leaving or rebuilding keeps what another holder still has, the description and the App admin follow the new owner,
and every message about a shared asset Inspire cannot change or cannot leave says what to do without hurting the others, offline."""
import contextlib
import json

import pytest

from v140_implement_test import OURS_APP, _output_context
from v142_merge_test import DASH, HOST_BOARD, _dashboard_inspire, _genie_answer, _host_files, _host_page, _normalized, _page_runner, _serve_files
from v161_shared_rebuild_test import JOINED, JOINING, LABEL7, LABEL8, _genie_flow, _joiner_board, _texts
from v161_shared_take_out_test import HOST, KEY, _app_taker, _hub, _sharing, _taker

LABEL1 = "For use case N01-U01 Predict churn, whose results are in `main.inspire.churn_out`:"
BUILDER = "app-abc123 inspire-app"
LOCKED = "User 11111111-2222-3333-4444-555555555555 does not have edit permission for node with aclPath /workspace/1111/2222"
SALES = dict(JOINED, spec_json={"use_case_name": "Sales"})


def _record_locks(inst, events):
    real = inst._implement_asset_lock

    @contextlib.contextmanager
    def lock(kind, asset, uc_id, spec_version):
        events.append(("lock", kind, str(asset or "")))
        with real(kind, asset, uc_id, spec_version):
            yield
        events.append(("unlock", kind, str(asset or "")))

    inst._implement_asset_lock = lock
    inst._implement_update = lambda key, **fields: events.append(("update", fields))


def _held(events):
    return [e for e in events if e[0] != "update" or "genie_space_id" in e[1]]


def _builder_also_asks(ns):
    builder = _normalized(ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    ours = _normalized(ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    shared, record, _p = ns["implement_merge_genie_space"](builder, ours, {}, LABEL1)
    own = {"space_id": "g1", "tables": ["main.inspire.sales_out"], "uses": ["main.inspire.sales_out"],
           "sample_questions": ["which stores lag?", "who leaves next?"]}
    return shared, dict(record, space_id="g1"), {"N01-U07": ({"genie_space_id": "g1"}, {"genie_space": {"state": "ready", "own": own}})}


def test_the_builder_s_own_genie_build_takes_the_asset_lock_and_records_its_part_before_releasing_it(agent_ns, tmp_path):
    old = _normalized(agent_ns, ("main.inspire.churn_out",), "Which stores lag?", "Old churn notes.")
    inst, _calls, context, runner = _genie_flow(agent_ns, tmp_path, old, [], {})
    events = []
    _record_locks(inst, events)
    fields = inst._implement_genie_space(context, runner)
    held = _held(events)
    assert [e[0] for e in held] == ["lock", "update", "unlock"] and held[0] == ("lock", "genie_space", "g1"), \
        "the builder's rebuild holds the lock every use case joining it takes, and records its part before letting go"
    write = held[1][1]
    assert write["genie_space_id"] == "g1" and write["genie_space_url"] == "https://h/genie/rooms/g1"
    own = write["asset_status"]["genie_space"]["own"]
    assert own["space_id"] == "g1" and own["sample_questions"] == ["which customers act now?"]
    assert own["tables"] == own["uses"] == ["main.inspire.churn_out", "main.s.orders"]
    assert fields["_asset"]["own"] == own


def test_the_builder_s_own_dashboard_rebuild_takes_the_asset_lock_of_that_dashboard(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): dict(DASH, dashboard_id="d1"), ("PATCH", "/api/2.0/lakeview/dashboards/d1"): {},
              ("POST", "/api/2.0/lakeview/dashboards/d1/published"): {}}
    inst, _calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    events = []
    _record_locks(inst, events)
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    inst._implement_dashboard(context, _page_runner(agent_ns))
    assert [e for e in events if e[0] != "update"] == [("lock", "dashboard", "d1"), ("unlock", "dashboard", "d1")]


def test_a_joiner_rebuilding_keeps_a_question_the_builder_also_asks_and_records_its_part_before_releasing_the_lock(agent_ns, tmp_path):
    shared, record, carried = _builder_also_asks(agent_ns)
    inst, calls, _context, runner = _genie_flow(agent_ns, tmp_path, shared, [SALES], carried)
    context = _output_context(agent_ns, merge={"genie_space": "g1"})
    context.update(assets={"genie_space": "g1"}, asset_status={"genie_space": {"state": "ready", "merged_into": "g1", "merged": record}})
    events = []
    _record_locks(inst, events)
    fields = inst._implement_genie_space(context, runner)
    space = json.loads(next(c[2] for c in calls if c[0] == "PATCH")["serialized_space"])
    assert _texts(space) == ["Which customers act now?", "Which stores lag?", "Who leaves next?"], \
        "the question it asked before and no longer asks stays, because the builder asks it too"
    held = _held(events)
    assert [e[0] for e in held] == ["lock", "update", "unlock"] and held[0] == ("lock", "genie_space", "g1")
    part = held[1][1]["asset_status"]["genie_space"]
    assert part["merged_into"] == "g1" and part["merged"]["space_id"] == "g1" and part["merged"]["description"] == "d"
    assert "own" not in part and fields["_asset"]["merged"] == part["merged"]


def test_a_joiner_leaving_keeps_a_question_the_builder_also_asks(agent_ns):
    shared, record, carried = _builder_also_asks(agent_ns)
    routes = {("GET", "/api/2.0/genie/spaces/g1"): _genie_answer("g1", shared), ("PATCH", "/api/2.0/genie/spaces/g1"): {}}
    inst = _taker(agent_ns, routes, [SALES], carried)
    inst._implement_delete_output("genie_space", "g1", KEY, status={"merged_into": "g1", "merged": record})
    space = json.loads(next(c[2] for c in inst.calls if c[0] == "PATCH")["serialized_space"])
    assert _texts(space) == ["Which stores lag?", "Who leaves next?"]
    assert "".join(space["instructions"]["text_instructions"][0]["content"]) == "Sales are in dollars."


def test_a_joiner_rebuilding_keeps_its_own_tables_on_record_and_takes_out_one_it_no_longer_uses(agent_ns):
    merge = agent_ns["implement_merge_genie_space"]
    tables = lambda space: [t["identifier"] for t in space["data_sources"]["tables"]]
    host = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    first = _normalized(agent_ns, ("main.inspire.churn_out", "main.s.orders"), "Who leaves next?", "Churn is monthly.")
    joined, record, _p = merge(host, first, {}, LABEL1)
    assert record["tables"] == ["main.inspire.churn_out", "main.s.orders"]
    again, record2, _p = merge(joined, first, record, LABEL1)
    assert record2["tables"] == ["main.inspire.churn_out", "main.s.orders"], "a rebuild keeps on record the tables this use case added"
    fewer = _normalized(agent_ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    third, record3, _p = merge(again, fewer, record2, LABEL1)
    assert tables(third) == ["main.inspire.churn_out", "main.inspire.sales_out"] and record3["tables"] == ["main.inspire.churn_out"], \
        "a table this use case added and no longer uses goes"
    kept, _r, _p = merge(again, fewer, record2, LABEL1, keep_records=[{"space_id": "g1", "uses": ["main.s.orders"]}])
    assert "main.s.orders" in tables(kept), "a table another use case still uses stays"


def test_a_builder_rebuild_goes_ahead_while_another_use_case_is_joining_because_a_join_records_its_part_under_the_lock(agent_ns, tmp_path):
    old = _normalized(agent_ns, ("main.inspire.churn_out",), "Which stores lag?", "Old churn notes.")
    inst, calls, context, runner = _genie_flow(agent_ns, tmp_path, old, [JOINING], {})
    assert inst._implement_genie_space(context, runner)["genie_space_id"] == "g1"
    space = json.loads(next(c[2] for c in calls if c[0] == "PATCH")["serialized_space"])
    assert _texts(space) == ["Which customers act now?"], "a use case still joining has nothing in it yet, so nothing of it is lost"


@pytest.mark.parametrize("described,expected", [("Stock levels by store, every day", "Stock levels by store, every day"),
                                                ("", "N01-U08 Stock")])
def test_the_builder_leaving_a_shared_genie_agent_describes_it_the_way_the_new_owner_does(agent_ns, described, expected):
    merge = agent_ns["implement_merge_genie_space"]
    ours = _normalized(agent_ns, ("main.inspire.churn_out",), "Who leaves next?", "Churn is monthly.")
    stock = _normalized(agent_ns, ("main.inspire.stock_out",), "What runs out?", "Stock is daily.")
    sales = _normalized(agent_ns, ("main.inspire.sales_out",), "Which stores lag?", "Sales are in dollars.")
    with_stock, record8, _p = merge(ours, stock, {}, LABEL8)
    shared, record7, _p = merge(with_stock, sales, {}, LABEL7)
    answer = dict(_genie_answer("g1", shared, "N01-U01 Predict churn"), description="Churn risk by customer")
    routes = {("GET", "/api/2.0/genie/spaces/g1"): answer, ("PATCH", "/api/2.0/genie/spaces/g1"): {}}
    rows = [JOINED, {"session_id": 5150, "use_case_id": "N01-U08", "spec_version": 1, "status": "ready",
                     "spec_json": {"use_case_name": "Stock", "outputs": {"merge": {"genie_space": "g1"}}}}]
    status = lambda record: ({"genie_space_id": "g1"}, {"genie_space": {"state": "ready", "merged_into": "g1", "merged": record}})
    inst = _taker(agent_ns, routes, rows, {"N01-U07": status(dict(record7, space_id="g1", description="Sales by store")),
                                           "N01-U08": status(dict(record8, space_id="g1", **({"description": described} if described else {})))})
    inst._implement_delete_output("genie_space", "g1", KEY, status={"state": "ready"})
    patch = next(c[2] for c in inst.calls if c[0] == "PATCH")
    assert (patch["title"], patch["description"]) == ("N01-U08 Stock", expected)


def test_the_owner_leaving_a_shared_app_makes_the_person_behind_the_new_owner_its_admin(agent_ns, tmp_path, monkeypatch):
    joiner = dict(_host_page(agent_ns, "N01-U08", "Stock desk"), id="n01_u08_s5150")
    _core, app = _hub(agent_ns, tmp_path, monkeypatch, owner=OURS_APP, ours_id="n01_u01", extra=[joiner])
    files = _host_files(agent_ns, tmp_path, pages=[_host_page(agent_ns, "N01-U01", "Churn desk"), _host_page(agent_ns, "N01-U07", "Sales desk"),
                                                    joiner], title="N01-U01 Predict churn", admin="churn.builder@example.com")
    _serve_files(agent_ns, monkeypatch, files)
    heirs = [dict(HOST, session_id=5150, use_case_id="N01-U07", name="Sales desk", created_by="sales.planner@example.com",
                  status={"merged_into": "sales-desk", "page": "n01_u07"})]
    inst = _app_taker(agent_ns, tmp_path, monkeypatch, app, heirs)
    inst._implement_delete_output("app", "sales-desk", KEY, status={"state": "ready"})
    settings = json.loads(inst.deployed[0][1]["inspire_app.json"])
    assert (settings["title"], settings["admin"]) == ("N01-U07 Sales desk", "sales.planner@example.com")
    nobody = _app_taker(agent_ns, tmp_path, monkeypatch, app, [dict(heirs[0], created_by="")])
    nobody._implement_delete_output("app", "sales-desk", KEY, status={"state": "ready"})
    assert json.loads(nobody.deployed[0][1]["inspire_app.json"])["admin"] == "churn.builder@example.com", \
        "with no one recorded for the new owner, the admin the App had stays"


def test_the_sharing_check_carries_who_asked_for_each_holder_s_newest_version(agent_ns):
    rows = [dict(SALES, spec_version=1, created_by="old.planner@example.com"), dict(SALES, spec_version=2, created_by=" sales.planner@example.com ")]
    inst = _taker(agent_ns, {}, rows, {"N01-U07": ({"dashboard_id": "d1"}, {})})
    [holder] = inst._implement_output_holders("dashboard", "d1", KEY)
    assert (holder["created_by"], holder["title"]) == ("sales.planner@example.com", "N01-U07 Sales")


def test_a_builder_that_cannot_change_its_shared_dashboard_is_told_to_ask_its_owner_and_never_to_delete_it(agent_ns, tmp_path):
    shared = _joiner_board(agent_ns, HOST_BOARD, 777, "N01-U07")
    routes = {("GET", "/api/2.0/lakeview/dashboards/d1"): dict(DASH, dashboard_id="d1", serialized_dashboard=json.dumps(shared)),
              ("PATCH", "/api/2.0/lakeview/dashboards/d1"): RuntimeError(LOCKED)}
    inst, calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    inst._implement_builder_label = lambda: BUILDER
    _sharing(inst, [JOINED], {"N01-U07": ({"dashboard_id": "d1"}, {"dashboard": {"state": "ready", "merged_into": "d1"}})})
    context = _output_context(agent_ns)
    context["assets"] = {"dashboard": "d1"}
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_dashboard(context, _page_runner(agent_ns))
    assert str(raised.value) == (f"Inspire builds as {BUILDER}, which can open the dashboard d1 of this use case, which use case N01-U07 also "
                                 f"uses, but cannot change it, so Inspire did not change it: ask its owner in the workspace to give {BUILDER} "
                                 "Can manage on it, then build again, or turn the dashboard off for this use case and keep it unmanaged, "
                                 "which leaves it as it is for use case N01-U07")
    assert len([c for c in calls if c[0] == "PATCH"]) == 1


def test_every_cannot_change_message_for_a_shared_asset_names_who_else_uses_it_and_never_says_delete(agent_ns):
    message = agent_ns["implement_locked_asset_message"]
    holders = [dict(HOST, use_case_id="N01-U07"), dict(HOST, session_id=9, use_case_id="N02-U01")]
    ask = f"ask its owner in the workspace to give {BUILDER} Can manage on it"
    joined = message(BUILDER, "Genie Agent", "gA", True, holders=holders)
    assert joined == (f"Inspire builds as {BUILDER}, which can open the Genie Agent gA this use case is added to, which use case N01-U07, "
                      f"N02-U01 also uses, but cannot change it, so Inspire did not change it: {ask}, then build again, or add this use case "
                      "to another one, which leaves it as it is for use case N01-U07, N02-U01")
    leaving = message(BUILDER, "dashboard", "dA", leaving=True, holders=holders)
    assert leaving == (f"Inspire builds as {BUILDER}, which can open the dashboard dA that use case N01-U07, N02-U01 also uses but cannot "
                       f"change it, so Inspire did not take this use case's part out of it: {ask}, then uninstall it again")
    unknown = message(BUILDER, "dashboard", "d1", holders=None)
    assert unknown == (f"Inspire builds as {BUILDER}, which can open the dashboard d1 of this use case, which other use cases may also use, "
                       f"but cannot change it, so Inspire did not change it: {ask}, then build again, or turn the dashboard off for this use "
                       "case and keep it unmanaged")
    assert message(BUILDER, "dashboard", "dA", leaving=True, holders=None).startswith(
        f"Inspire builds as {BUILDER}, which can open the dashboard dA that other use cases share but cannot change it")
    assert all("delete" not in text for text in (joined, leaving, unknown))
    assert message(BUILDER, "dashboard", "d1").endswith("give app-abc123 inspire-app Can manage on it, or delete it so Inspire builds a new "
                                                        "one, then build again"), "an asset only this use case uses may still be rebuilt anew"


@pytest.mark.parametrize("name,asset_id,routes,refused", [
    ("dashboard", "d1", {("GET", "/api/2.0/lakeview/dashboards/d1"): dict(DASH, dashboard_id="d1", display_name="N01-U01 Predict churn")},
     "this use case was not taken out of the dashboard N01-U01 Predict churn: no page of the other use cases would be left in it"),
    ("genie_space", "g1", {("GET", "/api/2.0/genie/spaces/g1"): {"space_id": "g1", "title": "N01-U01 Predict churn", "serialized_space": json.dumps(
        {"data_sources": {"tables": [{"identifier": "main.inspire.churn_out"}]}, "config": {"sample_questions": [
            {"id": "a" * 32, "question": ["Who leaves next?"]}]}})}},
     "this use case was not taken out of the Genie Agent N01-U01 Predict churn (g1): no table of the other use cases would be left in it"),
])
def test_a_builder_leaving_an_asset_only_a_joining_use_case_shares_says_exactly_when_to_uninstall_again(agent_ns, name, asset_id, routes, refused):
    inst = _taker(agent_ns, routes, [JOINING], {})
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_delete_output(name, asset_id, KEY, status={"state": "ready"})
    assert str(raised.value) == f"{refused}; use case N02-U01 is adding itself to it right now, so uninstall it again once its build ends"
    assert not [c for c in inst.calls if c[0] in ("PATCH", "DELETE")]
