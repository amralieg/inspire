"""A pareto across the page's own records, one bar per entity, is the ranking it shows and passes; a chart whose near-unique x is
reason text or any other per-record column still goes back to the builder. The App check keeps what failed to run apart from what
the page shows: only a query that did not run on Lakebase leaves the App on Delta tables, a page problem the check finds on
Lakebase goes back to the builder like any other page check problem, offline."""
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v140_implement_test import _app_flow  # noqa: E402
from v146_lakebase_build_test import FALLBACK, _app_lakebase  # noqa: E402
from v218_kpi_genie_parity_test import RESULT, _checked, _concentration, _queue_page  # noqa: E402

ENTITY_SQL = (f"SELECT record_key, entity_id, entity_label, priority_tier, ai_cat_rule, top_reasons, recommended_action, value_at_stake, "
              f"as_of_date FROM {RESULT} WHERE is_current")
ALIASED_SQL = f"SELECT o.entity_label AS item, o.value_at_stake, o.as_of_date FROM {RESULT} AS o WHERE o.is_current"
CHAINED_SQL = (f"SELECT name AS item, value_at_stake, as_of_date FROM (SELECT `o`.`entity_label` AS name, o.value_at_stake, "
               f"o.as_of_date FROM {RESULT} AS o WHERE o.is_current) AS t")
WRAPPED_SQL = (f"SELECT COALESCE(o.entity_label, CAST(o.entity_id AS STRING)) AS item, o.value_at_stake, o.as_of_date "
               f"FROM {RESULT} AS o WHERE o.is_current")
JOINED_SQL = (f"SELECT concat_ws(' - ', entity_label, entity_id) AS item, value_at_stake, as_of_date FROM {RESULT} WHERE is_current")
DISGUISED_SQL = f"SELECT top_reasons[0] AS entity_label, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"
MIXED_SQL = f"SELECT concat(entity_label, recommended_action) AS item, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"
RECORD_KEY_SQL = f"SELECT customer_name, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"


def _flagged(x_column, dataset_sql, records=None):
    page = _queue_page(x_column, dataset_sql)
    if records is not None:
        page["records"] = dict(page.get("records") or {}, **records)
    return shell_sql.concentration_problems(page, {"drivers": (69, 69)})


@pytest.mark.parametrize("x_column, dataset_sql, records", [
    ("entity_label", ENTITY_SQL, None),
    ("entity_id", ENTITY_SQL, None),
    ("record_key", ENTITY_SQL, None),
    ("item", ALIASED_SQL, None),
    ("item", CHAINED_SQL, None),
    ("item", WRAPPED_SQL, None),
    ("item", JOINED_SQL, None),
    ("customer_name", RECORD_KEY_SQL, {"label": "customer_name"}),
], ids=["entity_label", "entity_id", "record_key", "alias", "alias_chain", "cast_coalesce", "concat_ws", "records_label"])
def test_a_pareto_across_the_records_themselves_passes(x_column, dataset_sql, records, capsys):
    assert _flagged(x_column, dataset_sql, records) == []
    assert "[CONCENTRATION-CHECK SKIPPED]" in capsys.readouterr().out


def test_an_entity_pareto_with_every_bar_unique_passes_the_live_check(tmp_path):
    problems, ws = _checked(tmp_path, _queue_page("entity_label", ENTITY_SQL), 25, (69, 69))
    assert _concentration(problems) == [] and _fanned(problems) == []
    assert [sql for sql, _p, _l in ws.sql if "COUNT(DISTINCT x) AS k" in sql], "the probe still counts the rows behind each record"


def _fanned(problems):
    return [p for p in problems if "adds up a record's numbers more than once" in p]


FANNED_SQL = (f"SELECT o.entity_label, o.value_at_stake, o.as_of_date FROM {RESULT}_reasons r JOIN {RESULT} o "
              f"ON r.entity_id = o.entity_id WHERE r.is_current AND o.is_current")
HISTORY_SQL = f"SELECT entity_label, value_at_stake, as_of_date FROM {RESULT}"


@pytest.mark.parametrize("x_column, dataset_sql", [
    ("entity_label", FANNED_SQL),
    ("entity_label", HISTORY_SQL),
    ("record_key", ENTITY_SQL),
    ("item", WRAPPED_SQL),
], ids=["joined_to_many_reasons", "every_run_kept", "record_key", "cast_coalesce"])
def test_a_pareto_of_records_that_repeat_each_record_goes_back_to_the_builder(x_column, dataset_sql, capsys):
    assert shell_sql.concentration_problems(_queue_page(x_column, dataset_sql), {"drivers": (207, 69)}) == [
        f"chart drivers ranks 69 records by {x_column}, but its dataset holds 207 rows for them at the default filters, so each bar "
        f"adds up a record's numbers more than once; {shell_sql.ONE_ROW_PER_RECORD}"]
    assert "[CONCENTRATION-FANOUT FIRED] page=n01_u05 charts=drivers" in capsys.readouterr().out


def test_a_fanned_out_entity_pareto_is_sent_back_by_the_live_check(tmp_path):
    problems, ws = _checked(tmp_path, _queue_page("entity_label", FANNED_SQL), 25, (207, 69))
    assert _fanned(problems) == [
        f"page n01_u05: chart drivers ranks 69 records by entity_label, but its dataset holds 207 rows for them at the default "
        f"filters, so each bar adds up a record's numbers more than once; {shell_sql.ONE_ROW_PER_RECORD}"]
    assert _concentration(problems) == []


def test_a_few_records_sharing_a_label_is_not_a_fan_out():
    assert shell_sql.concentration_problems(_queue_page("entity_label", ENTITY_SQL), {"drivers": (72, 69)}) == []


def test_asking_for_reason_charts_skips_the_one_bar_rule_but_never_the_fan_out():
    asked = "chart the queue by its reasons"
    text = dict(_queue_page("recommended_action", ENTITY_SQL), reason_charts=asked)
    assert shell_sql.concentration_problems(text, {"drivers": (69, 69)}) == []
    entity = dict(_queue_page("entity_label", FANNED_SQL), reason_charts=asked)
    assert len(_fanned(shell_sql.concentration_problems(entity, {"drivers": (207, 69)}))) == 1
    assert shell_sql.concentration_candidates(text, {"drivers": 25}) == []
    assert shell_sql.concentration_candidates(entity, {"drivers": 25}) == ["drivers"]


@pytest.mark.parametrize("x_column, dataset_sql", [
    ("recommended_action", ENTITY_SQL),
    ("entity_label", DISGUISED_SQL),
    ("item", MIXED_SQL),
    ("customer_name", RECORD_KEY_SQL),
], ids=["free_text_column", "reason_text_named_entity_label", "identity_mixed_with_text", "column_not_named_by_the_records"])
def test_a_near_unique_column_that_is_not_the_record_goes_back_to_the_builder(x_column, dataset_sql):
    assert _flagged(x_column, dataset_sql) == [
        f"chart drivers groups 69 rows into 69 bars by {x_column} at the default filters, so nearly every bar is one record and the "
        f"chart shows no concentration; {shell_sql.CATEGORY_GROUPING}"]


def test_a_near_unique_free_text_column_is_still_sent_back_by_the_live_check(tmp_path):
    problems, ws = _checked(tmp_path, _queue_page("recommended_action", ENTITY_SQL), 25, (69, 69))
    assert len(_concentration(problems)) == 1
    assert [sql for sql, _p, _l in ws.sql if "COUNT(DISTINCT x) AS k" in sql]


def test_reason_text_is_still_sent_back_by_both_checks(tmp_path):
    page = _queue_page("top_reasons", ENTITY_SQL)
    assert any("groups x by the reason text (top_reasons)" in p for p in shell_sql.quality_problems(page))
    assert len(_flagged("top_reasons", ENTITY_SQL)) == 1
    assert any("groups x by the reason text (entity_label)" in p
               for p in shell_sql.quality_problems(_queue_page("entity_label", DISGUISED_SQL)))


def test_the_check_keeps_what_failed_to_run_apart_from_what_the_page_shows(tmp_path):
    def shape(sql):
        if sql.startswith("SELECT COUNT(*) AS n, COUNT(DISTINCT x) AS k"):
            return [{"n": 30, "k": 30}]
        if "FROM (SELECT" in sql and "SUM(y0) OVER" in sql:
            return [{"x": f"cause {i}", "y0": 10.0 - i, "total": 55.0} for i in range(25)]
        if "ORDER BY `rank`" in sql:
            return shell_db.QueryError("relation does not exist")
        return None

    from v141_app_shell_test import ShapedWorkspace, app_dir
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[_queue_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    failed, design = s.check_split({})
    assert "page n01_u05: records:records failed: relation does not exist" in failed
    assert [p for p in design if "nearly every bar is one record" in p] and not [p for p in failed if "nearly every bar" in p]
    assert not [p for p in design if " failed: " in p]
    assert sorted(s.check({})) == sorted(failed + design), "the full check still names every problem"


def test_a_page_problem_found_on_lakebase_keeps_lakebase_and_goes_back_to_the_builder(agent_ns, tmp_path):
    design = ["page n01_u01: chart drivers groups 30 rows into 30 bars by note at the default filters, so nearly every bar is one record"]
    inst, out, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, designs=(design,))
    assert out["kind"] == "lakebase" and out["page_problems"] == design and out["warnings"] == []
    assert [e["status"] for e in inst.emitted] == ["started", "ended_success"]
    warned = [m for kind, m in inst.logger.records if kind == "WARNING"]
    assert any("[LAKEBASE-PAGE-PROBLEMS FIRED]" in m and "not a Lakebase failure" in m for m in warned)
    assert not any("could not set up Lakebase" in m for m in warned)


def test_a_query_that_did_not_run_on_lakebase_still_leaves_the_app_on_delta(agent_ns, tmp_path):
    design = ["page n01_u01: chart drivers groups 30 rows into 30 bars by note at the default filters"]
    _inst, out, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, checks=(["dataset trend: Lakebase could not run it"],),
                                                    designs=(design,))
    assert out["kind"] == "delta" and "page_problems" not in out
    assert out["warnings"] == [FALLBACK.format("these App queries did not run on Lakebase: dataset trend: Lakebase could not run it")]


def test_the_build_sends_a_lakebase_page_problem_back_to_the_builder_and_deploys_nothing(agent_ns, tmp_path):
    problem = "page n01_u01: chart drivers groups 30 rows into 30 bars by note at the default filters"
    inst, context, seen = _app_flow(agent_ns, tmp_path, assets={"genie_space": "g1"})
    inst._implement_app_lakebase = lambda *a, **k: {"kind": "lakebase", "files": {}, "page_problems": [problem]}
    inst._implement_app(context, None)
    assert seen["deployed"] == [] and len(seen["errors"]) == 1 and problem in seen["errors"][0]
    assert "Lakebase" not in seen["errors"][0]


def test_the_real_app_check_splits_on_lakebase_and_names_everything_on_delta(agent_ns, tmp_path):
    from v146_lakebase_build_test import ENV
    from v140_implement_test import _app_shell, _inspire
    from v120_artifacts_support import FakeSpark
    import types
    modules = _app_shell(agent_ns, tmp_path)[1]
    core = modules["shell_core"]
    calls = []

    class Shell:
        def __init__(self, *a, **k):
            pass

        def speed(self, headers):
            return {}

        def check(self, headers):
            calls.append("check")
            return ["ran", "shown"]

        def check_split(self, headers):
            calls.append("split")
            return ["ran"], ["shown"]

        def close(self):
            pass

    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_host = lambda: "https://ws.example"
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(authenticate=lambda: {}))
    patched = dict(modules, shell_core=types.SimpleNamespace(Shell=Shell, HttpError=core.HttpError, SETTINGS_FILE=core.SETTINGS_FILE,
                                                             PAGES_DIR=core.PAGES_DIR))
    files = {core.SETTINGS_FILE: json.dumps({})}
    assert inst._implement_app_check(str(tmp_path / "a"), files, patched, "wh1") == ["ran", "shown"]
    assert inst._implement_app_check(str(tmp_path / "b"), files, patched, "wh1", ENV) == ["ran"]
    assert inst._implement_app_design == ["shown"] and calls == ["check", "split"]


@pytest.mark.parametrize("check", [True, False])
def test_a_redeploy_returns_the_lakebase_page_problems_when_it_checks_its_pages(agent_ns, tmp_path, check):
    from v140_implement_test import _app_shell, _churn_page, _inspire, _output_context
    from v120_artifacts_support import FakeSpark
    payload, modules = _app_shell(agent_ns, tmp_path)
    inst = _inspire(agent_ns, FakeSpark())
    inst.local_log_output_dir = str(tmp_path)
    deployed, problem = [], "page n01_u01: chart drivers groups 30 rows into 30 bars by note at the default filters"
    inst._implement_app_check = lambda work, files, modules, warehouse: []
    inst._implement_app_warehouse = lambda context: "wh1"
    lakebase = {"kind": "lakebase", "files": {}, "page_problems": [problem]}
    inst._implement_app_lakebase = lambda *a, **k: lakebase
    inst._implement_deploy_app = lambda *a, **k: deployed.append(a) or {"app_name": "churn-desk"}
    inst._implement_lakebase_after = lambda context, fields, lakebase: None
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    settings = {"version": modules["shell_core"].SETTINGS_VERSION, "pages": [page["id"]]}
    fields, problems, kept = inst._implement_app_redeploy(_output_context(agent_ns, app_backend="lakebase"), {"name": "churn-desk"},
                                                          settings, [page], payload, modules, "app_restyle", "", check=check)
    if check:
        assert (fields, problems, kept) == (None, [problem], lakebase) and deployed == []
    else:
        assert fields == {"app_name": "churn-desk"} and problems == [] and len(deployed) == 1, "a redeploy that checks nothing deploys"


def test_a_column_filter_that_does_not_fit_its_values_is_a_page_problem_and_one_that_fails_is_a_failure(tmp_path):
    from shell_db import QueryError
    from v161_app_column_filters_test import EDITOR, LISTED, ColumnWorkspace, column_shell
    listed = [dict(c, type="STRING") if c["name"] == "value_at_stake" else c for c in LISTED]

    class Failing(ColumnWorkspace):
        def answer(self, sql, params):
            if sql.startswith("SELECT v FROM") and "`priority_tier`" in sql and "return_lines" not in sql:
                raise QueryError("PERMISSION_DENIED")
            return super().answer(sql, params)

    s, _ws, _made = column_shell(tmp_path, ws=Failing(listed=listed))
    failed, design = s.check_split(EDITOR)
    unfit = [p for p in design if "column filter value_at_stake is a number_range, but value_at_stake holds STRING" in p]
    assert unfit and not [p for p in failed if "holds STRING values" in p]
    assert "page n09_u03: the decision list column filter priority_tier failed: PERMISSION_DENIED" in failed
    assert not [p for p in design if "PERMISSION_DENIED" in p]


def test_a_check_that_stops_on_lakebase_is_reported_as_the_check_and_never_as_a_lakebase_failure(agent_ns, tmp_path, monkeypatch):
    import v146_lakebase_build_test as build
    made, original = [], build._inspire
    monkeypatch.setattr(build, "_inspire", lambda ns, spark: made.append(original(ns, spark)) or made[-1])
    stopped = agent_ns["ImplementAppCheckStopped"]("the App check stopped: unsupported operand type for 'a data value'")
    with pytest.raises(agent_ns["ImplementAppCheckStopped"]) as raised:
        _app_lakebase(agent_ns, tmp_path, checks=(stopped,))
    assert raised.value is stopped and isinstance(stopped, RuntimeError)
    inst = made[-1]
    assert [e["status"] for e in inst.emitted] == ["started", "ended_error"]
    assert "the App check stopped: unsupported operand type" in inst.emitted[-1]["message"]
    logged = [m for _kind, m in inst.logger.records]
    assert not any("could not set up Lakebase" in m for m in logged + [e["message"] for e in inst.emitted])


def test_every_kind_of_check_problem_keeps_its_route(tmp_path):
    def shape(sql):
        if sql.startswith("SELECT COUNT(*) AS n, COUNT(DISTINCT x) AS k"):
            return [{"n": 207, "k": 69}]
        if "FROM (SELECT" in sql and "SUM(y0) OVER" in sql:
            return [{"x": f"cause {i}", "y0": 10.0 - i, "total": 55.0} for i in range(25)]
        return None

    from v141_app_shell_test import ShapedWorkspace, app_dir
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[_queue_page("entity_label", FANNED_SQL)]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                         sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    found = s.checked({})
    assert {kind for kind, _text in found} <= {shell_core.CHECK_FAILED, shell_core.CHECK_DESIGN}
    assert [text for kind, text in found if "adds up a record's numbers more than once" in text and kind == shell_core.CHECK_DESIGN]
    assert all(kind == shell_core.CHECK_FAILED for kind, text in found if " failed: " in text)
