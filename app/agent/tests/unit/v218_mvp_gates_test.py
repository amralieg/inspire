"""v2.1.8 MVP builds that failed for a reason the build could have caught or carried.

1. Inspire sets the App layout from the use case's kind. A network page holds one chart section, yet the page had to carry at
   least 3 charts, so the builder added line and bar charts that only the asked charts section holds, and Inspire refused
   them round after round while the builder's own check, run on the layout it chose, passed. The chart minimum now follows
   the sections the layout has, the builder's check runs on the layout Inspire sets, and after the last round a part the
   layout cannot hold is left out with a warning instead of failing the build.
2. A layout section asks for at least 20 rows. When the data holds 10 records and the page shows all 10, the build warns
   instead of failing; when the default filters hide records, it still goes back to the builder.
3. An ask for columns no source table has ("each driver's name and license number") now names the missing column before
   Genie builds, from the same matcher that checks the other asks.
4. The identity Inspire builds as could not manage the App it was about to change, and found out only at deploy, after the
   whole build. Every output Inspire is about to change is checked before the build, and one it cannot manage stops at
   once, naming the permission and who can grant it.
"""
import json
import os
import subprocess
import sys
import types

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)
ROOT = os.path.dirname(os.path.dirname(TESTS))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v140_implement_test import TRUTH, _app_flow, _app_shell, _churn_page, _inspire, _output_context, _output_inspire  # noqa: E402

with open(os.path.join(SHELL, "examples", "network_explorer.json"), encoding="utf-8") as _handle:
    NETWORK = json.load(_handle)
RECORDS = ("records", "records")


def _monitor(**changes):
    page = {"id": "p1", "layout": "monitor_triage", "records": {"key": "record_key"}}
    page.update(changes)
    return page


def _network_page(ns, section="charts"):
    page = json.loads(json.dumps(NETWORK).replace("main.risk.ring_out", "main.inspire.churn_out"))
    page.pop("fewer_charts", None)
    page["charts"].append({"id": "moved_by_account", "type": "bar", "title": "Money moved by account", "dataset": "links",
                           "hint": "Each bar is one account.", "x": {"column": "src", "kind": "category", "label": "Account"},
                           "y": [{"expression": "SUM(weight)", "label": "Money moved", "format": "number"}], "section": section})
    return page


def test_a_layout_with_one_chart_section_asks_for_one_chart_not_three():
    page = json.loads(json.dumps(NETWORK))
    page.pop("fewer_charts", None)
    assert [c["type"] for c in page["charts"]] == ["graph"]
    assert shell_sql.layout_chart_least("network_explorer") == 1
    assert not [p for p in shell_sql.spec_problems(page) if "charts; it needs" in p]
    assert shell_sql.layout_chart_least("location_view") == 2
    assert shell_sql.layout_chart_least("decision_queue") == 3 and shell_sql.layout_chart_least(shell_sql.DEFAULT_LAYOUT) == 3
    empty = dict(page, charts=[])
    assert [p for p in shell_sql.spec_problems(empty) if "the page has 0 charts; it needs 1 to 8" in p], "the graph is still asked for"


def test_the_layout_message_names_the_types_the_layout_holds():
    page = {"layout": "location_view", "charts": [{"id": "links", "type": "graph", "section": "map"}], "tables": []}
    [found] = [p for p in shell_sql.layout_problems(page, set()) if "links" in p]
    assert "one of the types this layout holds (" in found and "map_points" in found and "heatmap" in found and "line" in found


def test_a_part_named_for_another_layout_moves_to_the_asked_section_it_fits():
    page = {"id": "p", "layout": "network_explorer",
            "charts": [{"id": "fares", "type": "line", "section": "gains_curve"}, {"id": "net", "type": "graph", "section": "graph"}],
            "tables": [{"id": "pairs", "section": "reason_list"}]}
    assert shell_sql.place_items(page) == ["chart fares from 'gains_curve' to charts", "table pairs from 'reason_list' to tables"]
    assert [c["section"] for c in page["charts"]] == ["charts", "graph"] and page["tables"][0]["section"] == "tables"
    assert shell_sql.place_items(page) == [], "a placed part stays where it is"
    plain = {"layout": shell_sql.DEFAULT_LAYOUT, "charts": [{"id": "a", "type": "line", "section": "x"}]}
    assert shell_sql.place_items(plain) == [] and plain["charts"][0]["section"] == "x"


def _run_check(ns, tmp_path, page, layout, asked):
    payload = ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))
    files = ns["implement_app_check_files"](payload["files"], False, (), (), layout, asked)
    for relative, content in files.items():
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    (tmp_path / ns["IMPLEMENT_APP_PAGE_FILE"]).write_text(json.dumps(page), encoding="utf-8")
    script = tmp_path / ns["IMPLEMENT_APP_CHECK_DIR"] / ns["IMPLEMENT_APP_CHECK_SCRIPT"]
    done = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, cwd=str(tmp_path), timeout=120)
    return done.returncode, done.stdout


def test_the_builders_check_runs_on_the_layout_inspire_sets(agent_ns, tmp_path):
    page = dict(_network_page(agent_ns), layout="decision_queue")
    code, out = _run_check(agent_ns, tmp_path / "forced", page, "network_explorer", False)
    assert code == 1 and "chart moved_by_account sits in the charts section" in out and "network_explorer layout" in out
    code, out = _run_check(agent_ns, tmp_path / "asked", page, "network_explorer", True)
    assert "sits in the charts section" not in out, "with asks the builder's check leaves the ask match to Inspire's check"


def _page_file(ns, tmp_path, page, turn):
    inst, _calls = _output_inspire(ns, tmp_path)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(t) for t in TRUTH]
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    shell_sql_module = _app_shell(ns, tmp_path)[1]["shell_sql"]
    context = dict(_output_context(ns), asset_status={}, app_layout="network_explorer")
    context["allowed"] = context["allowed"] + ["main.inspire.churn_out__edges", "main.inspire.churn_out__nodes"]
    if turn:
        context["genie_round"] = {"name": "app", "round": turn[0], "rounds": turn[1]}
    work = tmp_path / "work"
    work.mkdir()
    (work / ns["IMPLEMENT_APP_PAGE_FILE"]).write_text(json.dumps(page))
    return inst._implement_page_file(context, "app", str(work), shell_sql_module, False)


def test_a_misfit_goes_back_to_the_builder_while_rounds_are_left(agent_ns, tmp_path):
    with pytest.raises(RuntimeError) as raised:
        _page_file(agent_ns, tmp_path, _network_page(agent_ns), (1, 3))
    assert "does not fit the App" in str(raised.value) and "chart moved_by_account sits in the charts section" in str(raised.value)


@pytest.mark.parametrize("turn,section", [((3, 3), "charts"), (None, "charts"), ((3, 3), "gains_curve")])
def test_after_the_last_round_the_misfits_are_left_out_and_the_build_goes_on(agent_ns, tmp_path, turn, section):
    page, notes = _page_file(agent_ns, tmp_path, _network_page(agent_ns, section), turn)
    assert [c["id"] for c in page["charts"]] == ["graph"]
    left = [n for n in notes if "was left out because no ask for this page names it" in n]
    assert left == ["App: chart moved_by_account was left out because no ask for this page names it, and Inspire sets the "
                    "network_explorer layout from the use case's kind; ask for it by its type and what it shows to add it in the "
                    "charts section"]


def test_a_misfit_that_is_not_about_the_layout_still_fails_after_the_last_round(agent_ns, tmp_path):
    page = _network_page(agent_ns)
    page["charts"][0]["dataset"] = "nowhere"
    with pytest.raises(RuntimeError) as raised:
        _page_file(agent_ns, tmp_path, page, (3, 3))
    assert "does not fit the App" in str(raised.value)


def test_the_drop_keeps_every_part_an_ask_names(agent_ns):
    page = _network_page(agent_ns)
    moved = page["charts"][-1]
    asks = ["add a bar chart of money moved by account"]
    assert agent_ns["implement_part_ask"](moved, "chart", asks), "the fixture ask must name the bar chart"
    assert agent_ns["implement_drop_misfits"](page, shell_sql, asks) == [] and page["charts"][-1] is moved
    assert len(agent_ns["implement_drop_misfits"](page, shell_sql, [])) == 1 and [c["id"] for c in page["charts"]] == ["graph"]
    stray = dict(_network_page(agent_ns), layout="location_view")
    stray["charts"] = [c for c in stray["charts"] if c["type"] == "graph"]
    [note] = agent_ns["implement_drop_misfits"](stray, shell_sql, ["add a graph of the links"])
    assert "no section of a location_view page draws a graph" in note and stray["charts"] == []


def test_the_record_minimum_follows_the_records_the_data_holds(capsys):
    page = _monitor()
    assert shell_sql.row_shortfalls(page, {RECORDS: 10}, {RECORDS: 10}) == ([], [
        "the triage_queue section of a monitor_triage page is meant to show at least 20 rows, and the decision list shows 10: "
        "every record the data holds, so the page shows them all"])
    assert "[LAYOUT-ROWS-HELD FIRED]" in capsys.readouterr().out
    short, held = shell_sql.row_shortfalls(page, {RECORDS: 10}, {RECORDS: 15})
    assert held == [] and short == ["the triage_queue section of a monitor_triage page shows at least 15 rows; the decision list "
                                    "returned 10 at the default filters of the 15 records the data holds, so widen what it "
                                    f"selects: {shell_sql.section_words('triage_queue')}"]
    assert shell_sql.row_problems(page, {RECORDS: 10}) and shell_sql.row_problems(page, {RECORDS: 10}, {RECORDS: 40})
    assert shell_sql.row_shortfalls(page, {RECORDS: 20}, {RECORDS: 20}) == ([], [])


class _Records:
    def __init__(self, total, more=False, error=None):
        self.total, self.more, self.error, self.asked = total, more, error, []

    def __call__(self, headers, data, probe=None):
        self.asked.append(data)
        if self.error:
            raise self.error
        return {"rows": [{}], "total": self.total, "total_more": self.more}


def _held(counts, defaults, records):
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.records = records
    return shell.check_held_rows({}, _monitor(), defaults, counts, None)


def test_the_check_counts_the_records_with_no_filter_only_when_a_minimum_is_short(capsys):
    records = _Records(10)
    assert _held({RECORDS: 10}, {"region": ["east"]}, records) == {RECORDS: 10}
    assert records.asked == [{"page": "p1", "filters": {}, "limit": 1}]
    untouched = _Records(99)
    assert _held({RECORDS: 10}, {"region": [], "day": None}, untouched) == {RECORDS: 10} and untouched.asked == []
    assert _held({RECORDS: 25}, {"region": ["east"]}, untouched) == {} and untouched.asked == []
    assert _held({RECORDS: 10}, {"region": ["east"]}, _Records(5000, more=True)) == {}
    assert _held({RECORDS: 10}, {"region": ["east"]}, _Records(0, error=shell_core.HttpError(502, "down"))) == {}
    assert "[LAYOUT-ROWS-HELD SKIPPED]" in capsys.readouterr().out
    assert _held({}, {}, untouched) == {}


def test_a_held_note_never_fails_the_check_and_reaches_the_build_warnings(agent_ns, tmp_path):
    class Shell:
        def __init__(self, *args, **kwargs):
            pass

        def speed(self, headers):
            return {}

        def checked(self, headers):
            return [(shell_core.CHECK_FAILED, "ran"), (shell_core.CHECK_DESIGN, "shown"), (shell_core.CHECK_NOTE, "held")]

        def close(self):
            pass

    modules = _app_shell(agent_ns, tmp_path)[1]
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_host = lambda: "https://ws.example"
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(authenticate=lambda: {}))
    core = modules["shell_core"]
    patched = dict(modules, shell_core=types.SimpleNamespace(Shell=Shell, HttpError=core.HttpError, SETTINGS_FILE=core.SETTINGS_FILE,
                                                             PAGES_DIR=core.PAGES_DIR, CHECK_FAILED=core.CHECK_FAILED,
                                                             CHECK_DESIGN=core.CHECK_DESIGN, CHECK_SLOW=core.CHECK_SLOW,
                                                             CHECK_NOTE=core.CHECK_NOTE))
    files = {core.SETTINGS_FILE: json.dumps({})}
    assert inst._implement_app_check(str(tmp_path / "a"), files, patched, "wh1") == ["ran", "shown"]
    assert inst._implement_app_notes == ["held"]
    assert core.Shell.check.__code__.co_names.count("CHECK_NOTE") == 1

    inst, context, seen = _app_flow(agent_ns, tmp_path / "flow")

    def noted(work, files, modules, warehouse):
        inst._implement_app_speeds = {}
        inst._implement_app_notes = ["page n01_u01: the decision list shows every record the data holds"]
        return []

    inst._implement_app_check = noted
    fields = inst._implement_app(context, None)
    assert seen["errors"] == []
    assert "App: page n01_u01: the decision list shows every record the data holds" in fields["_warnings"]


VOCABULARY_SOURCES = {"main.rides.trips": ["pickup_time", "dropoff_time", "trip_distance", "fare_amount", "pickup_zip", "dropoff_zip"]}
RIDE_CASE = {"Name": "Spot implausible fares", "Statement": "Find rides whose fare and distance do not fit together"}
DRIVER_ASK = "show each driver's name and license number next to every flagged trip"


def test_an_ask_for_columns_no_source_has_names_them_before_genie(agent_ns):
    held = agent_ns["implement_vibes_held_terms"](VOCABULARY_SOURCES, RIDE_CASE)
    ask = {"ask": DRIVER_ASK, "draws": "table"}
    assert agent_ns["implement_vibes_unfound"](ask, held) == ["license number"]
    text = agent_ns["implement_vibes_unfound_text"](["license number"], VOCABULARY_SOURCES)
    assert "no column of the tables this use case reads holds license number" in text
    column = {"ask": DRIVER_ASK, "draws": "", "check": {"kind": "column", "value": "license_number"}}
    assert agent_ns["implement_vibes_unfound"](column, held) == ["license number"]
    assert agent_ns["implement_vibes_unfound"]({"ask": DRIVER_ASK, "draws": "chart"}, held) == [], "a chart ask keeps its own matcher"


def test_the_attribute_matcher_passes_what_the_sources_hold_and_ignores_page_words(agent_ns):
    held = agent_ns["implement_vibes_held_terms"](VOCABULARY_SOURCES, RIDE_CASE)
    unfound = lambda text: agent_ns["implement_vibes_unfound"]({"ask": text, "draws": "table"}, held)
    assert unfound("show the fare amount and pickup zip of every flagged ride") == []
    assert unfound("show fewer charts") == [] and unfound("add a table") == []
    assert agent_ns["implement_vibes_attributes"]({"ask": "show each driver's name and license number next to every trip"}) == [
        "driver name", "license number"]
    assert agent_ns["implement_vibes_groupings"]({"ask": "fares by each customer's region"}) == ["region"], \
        "a grouping still reads the owned word"


def test_the_hold_before_genie_names_the_missing_column(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_sources = lambda spec, use_case: dict(VOCABULARY_SOURCES)
    inst._implement_vibes_notes = lambda sources: []
    inst._implement_vibes_result_columns = lambda use_case: (True, [])
    inst._implement_vibes_asks = lambda cache, asset, text, impact=None: [{"ask": DRIVER_ASK, "draws": "table"}]
    judged = []

    def judge(parts, label):
        judged.append([a["ask"] for p in parts for a in p["asks"]])
        return {"checks": [{"n": 1, "status": "no_data", "evidence": "no driver data", "where": ""}]}

    inst._implement_vibes_judge = judge
    spec = {"data": {"notes": ""}, "outputs": {"app": True, "app_vibes": DRIVER_ASK}}
    held = inst._implement_vibes_hold("N01-U01", dict(RIDE_CASE), spec, {})
    assert judged == [[DRIVER_ASK]]
    [(asset, asks)] = held.items()
    assert "license number" in asks[DRIVER_ASK]


class PermissionDenied(Exception):
    pass


class NotFound(Exception):
    pass


def _locked(ns, answers, touched=("app", "dashboard", "genie_space", "alert"), outputs=None):
    inst = _inspire(ns, FakeSpark())
    calls, emitted = [], []

    def api(method, path, body=None, query=None):
        calls.append((method, path))
        answer = answers.get(path)
        if isinstance(answer, Exception):
            raise answer
        return answer or {}

    inst._implement_api = api
    inst._implement_builder_label = lambda: "Build Robot"
    inst._implement_emit = lambda *args, **kwargs: emitted.append(args)
    spec = {"outputs": dict(outputs or {})}
    assets = {"app": "churn-desk", "dashboard": "d1", "genie_space": "g1", "alert": None}
    return inst._implement_manage_locked("N01-U01", (5150, "N01-U01", 2), spec, assets, list(touched)), calls, emitted


def test_an_app_the_builder_cannot_manage_stops_before_the_build_naming_the_grant_and_who_gives_it(agent_ns):
    denied = PermissionDenied("User 1 does not have apps.ruleSets/get on the app")
    locked, calls, emitted = _locked(agent_ns, {"/api/2.0/permissions/apps/churn-desk": denied,
                                                "/api/2.0/apps/churn-desk": {"creator": "App Owner"}})
    assert set(locked) == {"app"}
    assert locked["app"] == ("Inspire builds as Build Robot, which can open the App churn-desk of this use case but cannot change it, "
                             "so Inspire did not change it: ask App Owner, who created it, or a workspace admin to give Build Robot "
                             "Can manage on it, or delete it so Inspire builds a new one, then build again")
    assert ("GET", "/api/2.0/permissions/dashboards/d1") in calls and ("GET", "/api/2.0/permissions/genie/g1") in calls
    assert not [c for c in calls if "alertsv2" in c[1]], "an output with no asset has nothing to check"
    assert len(emitted) == 1 and emitted[0][1] == "App" and emitted[0][3] == "ended_warning"


def test_every_output_kind_is_checked_and_only_a_denial_stops_it(agent_ns):
    denied = PermissionDenied("PERMISSION_DENIED")
    locked, _calls, _emitted = _locked(agent_ns, {"/api/2.0/permissions/dashboards/d1": denied,
                                                  "/api/2.0/permissions/genie/g1": NotFound("does not exist"),
                                                  "/api/2.0/permissions/apps/churn-desk": RuntimeError("server error 500")})
    assert set(locked) == {"dashboard"} and "ask a workspace admin to give Build Robot Can manage on it" in locked["dashboard"]
    locked, calls, _emitted = _locked(agent_ns, {"/api/2.0/permissions/apps/churn-desk": denied}, touched=("dashboard",))
    assert locked == {} and [c[1] for c in calls] == ["/api/2.0/permissions/dashboards/d1"], "an output this version keeps is not checked"
    locked, calls, _emitted = _locked(agent_ns, {}, touched=("dashboard",), outputs={"merge": {"dashboard": "N02-U01"}})
    assert locked == {} and calls == [], "an output added to another use case's keeps its own shared check"
    hosted = {"app": True, "app_placement": agent_ns["IMPLEMENT_APP_HOSTED"]}
    locked, calls, _emitted = _locked(agent_ns, {"/api/2.0/permissions/apps/churn-desk": denied}, touched=("app",), outputs=hosted)
    assert locked == {} and calls == [], "a page Inspire hosts in its own App leaves the standalone App alone"


def test_the_permission_check_runs_before_genie_and_its_stop_comes_before_the_output_build(agent_ns):
    import ast
    from _agentload import method_node
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    assert source.index("self._implement_manage_locked(") < source.index("self._implement_fill_and_preview(")
    assert source.index("raise ImplementBlocked(locked[name])") < source.index("self._implement_part_attempts(")
