"""A chart that shows where records concentrate groups them by a category many records share, and the Genie space answers the
page's KPIs with the page's own expressions. A pareto or Drivers chart whose bars are nearly one record each, or whose x is the
free-text reason column, goes back to the builder; the Genie space carries every page KPI label with its exact query, kept in step
with each rebuilt version and taken out with the use case, offline."""
import contextlib
import copy
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
import shell_sql  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402
from v140_implement_test import _app_shell, _inspire  # noqa: E402
from v141_app_shell_test import PAGE, ShapedWorkspace, app_dir  # noqa: E402

RESULT = "main.ops.queue_out"
QUEUE_SQL = (f"SELECT record_key, entity_id, priority_tier, ai_cat_rule, top_reasons, value_at_stake, as_of_date "
             f"FROM {RESULT} WHERE is_current")
REASONS_SQL = (f"SELECT r.reason, o.value_at_stake, o.as_of_date FROM {RESULT}_reasons r JOIN {RESULT} o "
               f"ON r.entity_id = o.entity_id WHERE r.is_current AND o.is_current")


def _queue_page(x_column="ai_cat_rule", dataset_sql=QUEUE_SQL, kind="pareto", driver=True):
    page = copy.deepcopy(PAGE)
    page["datasets"].append({"name": "queue", "sql": dataset_sql})
    for f in page["filters"]:
        if f["type"] == "date_range":
            f["columns"]["queue"] = "as_of_date"
    page["charts"] = [c for c in page["charts"] if c["id"] != "pareto"] + [{
        "id": "drivers", "title": "Control failures driving the queue", "hint": "Largest first.", "type": kind, "dataset": "queue",
        "x": {"column": x_column, "kind": "category", "label": "Cause"},
        "y": [{"label": "Value at stake", "expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}],
        "limit": 25, "driver": driver}]
    for c in page["charts"]:
        if c["id"] != "drivers":
            c.pop("driver", None)
    return page


def _checked(tmp_path, page, bars, counted):
    def shape(sql):
        if sql.startswith("SELECT COUNT(*) AS n, COUNT(DISTINCT x) AS k"):
            return [{"n": counted[0], "k": counted[1]}]
        if "FROM (SELECT" in sql and "SUM(y0) OVER" in sql:
            return [{"x": f"cause {i}", "y0": 10.0 - i, "total": 55.0} for i in range(bars)]
        return None

    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s.check({}), ws


def _concentration(problems):
    return [p for p in problems if "nearly every bar is one record" in p]


def test_a_pareto_whose_bars_are_one_record_each_goes_back_to_the_builder(tmp_path, capsys):
    problems, ws = _checked(tmp_path, _queue_page(), 25, (30, 30))
    assert _concentration(problems) == [
        "page n01_u05: chart drivers groups 30 rows into 30 bars by ai_cat_rule at the default filters, so nearly every bar is one "
        "record and the chart shows no concentration; " + shell_sql.CATEGORY_GROUPING]
    counted = [sql for sql, _params, _limit in ws.sql if sql.startswith("SELECT COUNT(*) AS n, COUNT(DISTINCT x) AS k")]
    assert len(counted) == 1 and "`ai_cat_rule` AS x" in counted[0] and "CAST(`as_of_date` AS DATE) BETWEEN" in counted[0]
    assert "[CONCENTRATION-CHECK FIRED]" in capsys.readouterr().out


def test_a_categorical_pareto_many_records_share_passes(tmp_path):
    problems, _ws = _checked(tmp_path, _queue_page(), 5, (30, 5))
    assert _concentration(problems) == []


def test_a_chart_of_three_bars_or_fewer_is_never_counted_or_flagged(tmp_path):
    problems, ws = _checked(tmp_path, _queue_page(), 3, (3, 3))
    assert _concentration(problems) == []
    assert not [sql for sql, _p, _l in ws.sql if "COUNT(DISTINCT x) AS k" in sql], "a small chart costs no extra query"


def test_only_a_pareto_or_a_drivers_chart_is_a_concentration_chart():
    assert shell_sql.concentration_charts(_queue_page(kind="horizontal_bar", driver=False)) == []
    assert [c["id"] for c in shell_sql.concentration_charts(_queue_page(kind="horizontal_bar"))] == ["drivers"]
    assert shell_sql.concentration_candidates(_queue_page(kind="pareto", driver=False), {"drivers": 25}) == ["drivers"]


def test_a_pre_grouped_dataset_is_not_counted_as_one_row_per_record():
    page = _queue_page(dataset_sql=f"SELECT ai_cat_rule, SUM(value_at_stake) AS value_at_stake, MAX(as_of_date) AS as_of_date "
                                   f"FROM {RESULT} WHERE is_current GROUP BY ai_cat_rule")
    assert shell_sql.concentration_candidates(page, {"drivers": 25}) == []


@pytest.mark.parametrize("x_column, dataset_sql", [
    ("top_reasons", QUEUE_SQL),
    ("reason", REASONS_SQL),
    ("main_reason", f"SELECT top_reasons[0] AS main_reason, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"),
    ("main_reason", f"SELECT element_at(top_reasons, 1) AS main_reason, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"),
    ("reason", f"SELECT reason, value_at_stake, as_of_date FROM {RESULT} LATERAL VIEW explode(top_reasons) t AS reason WHERE is_current"),
])
def test_a_chart_grouped_by_the_reason_text_goes_back_to_the_builder(x_column, dataset_sql, capsys):
    problems = [p for p in shell_sql.quality_problems(_queue_page(x_column, dataset_sql)) if "groups x by the reason text" in p]
    assert problems == [f"chart drivers groups x by the reason text ({x_column}), which holds each record's own numbers, so every bar "
                        f"is one record and the chart shows no concentration; {shell_sql.CATEGORY_GROUPING}"]
    assert "[REASON-AXIS FIRED]" in capsys.readouterr().out


@pytest.mark.parametrize("x_column, dataset_sql", [
    ("ai_cat_rule", QUEUE_SQL),
    ("priority_tier", REASONS_SQL.replace("r.reason,", "o.priority_tier,")),
    ("cause", f"SELECT CASE WHEN top_reasons[0] LIKE 'payments%' THEN 'Payment' ELSE 'Other' END AS cause, value_at_stake, "
              f"as_of_date FROM {RESULT} WHERE is_current"),
    ("ai_cat_reason", f"SELECT ai_cat_reason, value_at_stake, as_of_date FROM {RESULT} WHERE is_current"),
])
def test_a_chart_grouped_by_a_category_is_not_sent_back(x_column, dataset_sql):
    assert not [p for p in shell_sql.quality_problems(_queue_page(x_column, dataset_sql)) if "groups x by the reason text" in p]


def test_a_user_ask_for_charts_by_reason_wins_over_both_checks(tmp_path, capsys):
    page = dict(_queue_page("top_reasons"), reason_charts="chart the queue by its reasons")
    assert shell_sql.reason_axis_problems(page) == []
    assert shell_sql.concentration_candidates(page, {"drivers": 25}) == []
    assert shell_sql.concentration_problems(page, {"drivers": (30, 30)}) == []
    out = capsys.readouterr().out
    assert "[REASON-AXIS SKIPPED]" in out and "[CONCENTRATION-CHECK SKIPPED]" in out
    problems, _ws = _checked(tmp_path, dict(_queue_page(), reason_charts="chart the queue by its reasons"), 25, (30, 30))
    assert _concentration(problems) == []


def test_the_reason_ask_must_quote_the_users_words(agent_ns):
    page = dict(_queue_page("top_reasons"), reason_charts="chart the queue by its reasons")
    fewer = agent_ns["implement_fewer_problems"]
    args = ("App", "a chart grouped by reason", "group each chart by a categorical column many records share")
    assert fewer(page, "reason_charts", "please chart the queue by its reasons", *args) == []
    assert fewer(page, "reason_charts", "show the top ten records", *args)[0].startswith(
        "reason_charts quotes 'chart the queue by its reasons', which is not in the customer's asks")
    assert ("found += implement_fewer_problems(page, shell_sql.REASON_CHARTS, vibes, label, \"a chart grouped by reason\","
            in _notebook_source())


def test_the_notebook_shell_and_build_prompt_carry_the_category_rule(agent_ns, tmp_path):
    embedded = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    assert embedded.CATEGORY_GROUPING == shell_sql.CATEGORY_GROUPING
    assert embedded.reason_axis_problems(_queue_page("top_reasons")) and not embedded.reason_axis_problems(_queue_page())
    assert "{shell_sql.CATEGORY_GROUPING}, since each bar of such text is one record" in _notebook_source()
    assert "never group a chart by reason; group by a" in _notebook_source()
    drivers = shell_sql.quality_problems({"charts": [], "filters": []})[-1]
    assert drivers.startswith("the page has no Drivers chart") and "the reasons that put them on the list" not in drivers


def _notebook_source():
    path = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(path, encoding="utf-8") as handle:
        return "".join(json.load(handle)["cells"][1]["source"])


KPI_PAGE = {
    "id": "n01_u03", "datasets": [
        {"name": "queue", "sql": f"SELECT record_key, ai_cat_rule, ai_cat_fix, priority_tier, value_at_stake, as_of_date\nFROM {RESULT}\n"
                                 f"WHERE is_current -- the current rows\n\nAND change_source = 'run'"},
        {"name": "trend", "sql": f"SELECT as_of_date, value_at_stake FROM {RESULT}_history;"}],
    "kpis": [
        {"id": "failed_items", "label": "Failed items", "dataset": "queue", "expression": "COUNT_IF(ai_cat_fix = 'Failed')"},
        {"id": "at_stake", "label": "Value at stake", "dataset": "queue", "expression": "SUM(value_at_stake)"},
        {"id": "history", "label": "Value over time", "dataset": "trend", "expression": "SUM(value_at_stake)"}],
    "filters": [{"id": "run_date", "type": "date_range", "label": "Run date", "columns": {"queue": "as_of_date", "trend": "as_of_date"}},
                {"id": "tier", "type": "multi_select", "label": "Tier", "columns": {"queue": "priority_tier"}}]}

OTHER = "For use case N09-U01 Another desk, whose results are in `main.ops.other_out`:\nCount only open rows."


def _space(text=OTHER):
    return {"version": 2, "instructions": {"text_instructions": [{"id": "a" * 32, "content": text.splitlines(keepends=True)}]}}


def _text(space):
    return "".join(space["instructions"]["text_instructions"][0]["content"])


def test_the_space_carries_every_page_kpi_label_with_its_exact_query(agent_ns):
    space, changed = agent_ns["implement_genie_page_kpis"](_space(), "N01-U03", KPI_PAGE)
    text = _text(space)
    assert changed and text.startswith(OTHER + "\n\n"), "the other use case's instructions stay first and whole"
    for kpi in KPI_PAGE["kpis"]:
        assert f"When asked for {kpi['label']}, use exactly: SELECT {kpi['expression']} AS value FROM (" in text
    assert (f"SELECT COUNT_IF(ai_cat_fix = 'Failed') AS value FROM (\nSELECT record_key, ai_cat_rule, ai_cat_fix, priority_tier, "
            f"value_at_stake, as_of_date\nFROM {RESULT}\nWHERE is_current -- the current rows\nAND change_source = 'run'\n) AS d") in text
    assert f"FROM (\nSELECT as_of_date, value_at_stake FROM {RESULT}_history\n) AS d" in text
    assert "The page narrows it with its filters on Run date (as_of_date), Tier (priority_tier)." in text
    assert "never with a count or a sum of every row" in text
    assert "\n\n" not in text[len(OTHER) + 2:], "the KPI block is one block, so it is found and replaced whole"


def test_the_kpi_block_is_idempotent_replaced_on_rebuild_and_taken_out(agent_ns):
    sync = agent_ns["implement_genie_page_kpis"]
    first, _ = sync(_space(), "N01-U03", KPI_PAGE)
    again, changed = sync(first, "N01-U03", KPI_PAGE)
    assert not changed and again == first
    rebuilt = copy.deepcopy(KPI_PAGE)
    rebuilt["kpis"] = [dict(rebuilt["kpis"][0], expression="COUNT_IF(ai_cat_fix = 'Failed' AND priority_tier = 'Act now')")]
    second, changed = sync(first, "N01-U03", rebuilt)
    text = _text(second)
    assert changed and text.count("KPIs of the page of use case N01-U03") == 1
    assert "AND priority_tier = 'Act now')" in text and "Value at stake" not in text
    neighbour, _ = sync(second, "N01-U3", KPI_PAGE)
    assert _text(neighbour).count("KPIs of the page of use case N01-U03") == 1
    taken, changed = sync(neighbour, "N01-U03", None)
    assert changed and "KPIs of the page of use case N01-U03" not in _text(taken) and _text(taken).startswith(OTHER)
    alone, _ = sync({"version": 2}, "N01-U03", KPI_PAGE)
    emptied, changed = sync(alone, "N01-U03", {})
    assert changed and "text_instructions" not in emptied["instructions"]
    untouched, changed = sync({"version": 2}, "N01-U03", None)
    assert not changed and untouched == {"version": 2}


def _sync_inst(agent_ns, current, status=None, page=KPI_PAGE):
    inst = _inspire(agent_ns, FakeSpark())
    patched = []
    inst._implement_genie_read = lambda space_id: {"title": "Desk", "space": copy.deepcopy(current)}
    inst._implement_patch_asset = lambda name, asset_id, body, **kw: patched.append((name, asset_id, json.loads(body["serialized_space"]), kw))
    inst._implement_asset_lock = lambda *a: contextlib.nullcontext()
    context = {"uc_id": "N01-U03", "key": (5150, "N01-U03", 3), "assets": {"genie_space": "01f0space"}, "page_spec": page,
               "asset_status": status or {"genie_space": {"state": "ready", "spec_version": 3},
                                          "app": {"state": "ready", "spec_version": 3, "snapshot": True}}}
    return inst, context, patched


def test_the_build_writes_the_page_kpis_into_the_space_after_the_page(agent_ns):
    inst, context, patched = _sync_inst(agent_ns, _space())
    assert inst._implement_genie_kpi_sync(context, ["genie_space", "app"]) == []
    assert len(patched) == 1 and patched[0][:2] == ("genie_space", "01f0space") and patched[0][3]["joined"] is False
    assert "When asked for Failed items, use exactly: SELECT COUNT_IF(ai_cat_fix = 'Failed')" in _text(patched[0][2])
    current = patched[0][2]
    inst, context, patched = _sync_inst(agent_ns, current)
    assert inst._implement_genie_kpi_sync(context, ["app"]) == [] and patched == [], "an unchanged space is not written again"


def test_a_vibe_rebuild_of_the_space_alone_gets_the_kpis_of_the_page_built_before(agent_ns):
    status = {"genie_space": {"state": "ready", "spec_version": 3}, "app": {"state": "ready", "spec_version": 2, "snapshot": True}}
    inst, context, patched = _sync_inst(agent_ns, _space(), status, page=None)
    context.pop("page_spec")
    asked = []
    inst._implement_snapshot = lambda key, name, version: asked.append((name, version)) or {"artifact": KPI_PAGE}
    assert inst._implement_genie_kpi_sync(context, ["genie_space"]) == []
    assert asked == [("app", 2)] and "When asked for Value at stake" in _text(patched[0][2])


@pytest.mark.parametrize("status, touched", [
    ({"genie_space": {"state": "failed", "spec_version": 3}}, ["genie_space", "app"]),
    ({"genie_space": {"state": "ready", "spec_version": 3}}, ["alert"]),
])
def test_no_space_change_when_the_space_did_not_build_or_nothing_it_reads_changed(agent_ns, status, touched):
    inst, context, patched = _sync_inst(agent_ns, _space(), status)
    assert inst._implement_genie_kpi_sync(context, touched) == [] and patched == []


def test_a_failed_kpi_write_is_a_warning_not_a_failed_build(agent_ns):
    inst, context, _patched = _sync_inst(agent_ns, _space())

    def refuse(*_a, **_k):
        raise RuntimeError("PERMISSION_DENIED")

    inst._implement_patch_asset = refuse
    warnings = inst._implement_genie_kpi_sync(context, ["app"])
    assert len(warnings) == 1 and warnings[0].startswith("Genie Agent: it may answer the page's KPIs differently from the page")


def test_the_build_and_the_take_out_call_the_kpi_sync():
    source = _notebook_source()
    take_out = source[source.index("    def _implement_take_out_genie("):source.index("    def _implement_take_out_app(")]
    assert "space = implement_genie_page_kpis(space, key[1], None)[0]" in take_out
    assert source.count("warnings += self._implement_genie_kpi_sync(context, touched)") == 1
