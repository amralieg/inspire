import json

PART = "app:page:n01_u01"
ASK = "On the plan page, sort the bake decisions by planned units, largest first"
SPLIT = {"ask": ASK, "check": [{"kind": "page", "value": "plan"}, {"direction": "desc", "kind": "sort", "value": "planned units"}],
         "draws": "table", "keep": False, "where": "the plan page"}
RECORDS_SQL = "SELECT * FROM main.inspire.n01_u01_out"
V1 = {"version": 1, "id": "n01_u01", "use_case_id": "N01-U01", "title": "Next-week bake planning cockpit",
      "question": "What should each franchise bake for every product next week?",
      "datasets": [{"name": "records", "sql": RECORDS_SQL}],
      "filters": [{"id": "run_date", "type": "date_range", "label": "Run date", "grain": "day", "default": "12m",
                   "columns": {"records": "as_of_date"}}],
      "kpis": [{"id": "planned_units", "label": "Planned bake units", "dataset": "records", "expression": "SUM(value)", "format": "number"}],
      "charts": [{"id": "plan_concentration", "title": "Concentration of the bake plan", "type": "pareto", "dataset": "records",
                  "x": {"column": "entity_label", "label": "Product"}, "y": [{"expression": "SUM(value)", "label": "Share of the plan"}]}],
      "records": {"title": "Next week's bake decisions", "key": "record_key", "label": "entity_label", "rank": "rank",
                  "tier": "priority_tier", "columns": [{"column": "value", "label": "Planned bake units", "format": "number"},
                                                       {"column": "product", "label": "Product", "format": "text"}]}}


def _sorted():
    page = json.loads(json.dumps(V1))
    page["records"]["sort"] = {"dir": "desc", "key": "value"}
    return page


def test_a_page_ask_is_never_pinned_to_a_chart_that_shares_a_word_so_its_table_sort_is_kept(agent_ns):
    targets = agent_ns["implement_untargeted_targets"]("app", [(PART, SPLIT)], V1, _sorted(), "records")
    assert targets is None
    assert agent_ns["implement_untargeted_changes"]("app", V1, _sorted(), targets, "records") == []


def test_a_chart_ask_still_puts_back_the_table_genie_changed_on_the_side(agent_ns):
    chart_ask = {"ask": "Show the Concentration of the bake plan chart as a bar chart", "check": {"kind": "chart_type", "value": "bar"},
                 "keep": False, "where": "the Concentration of the bake plan chart"}
    targets = agent_ns["implement_untargeted_targets"]("app", [(PART, chart_ask)], V1, _sorted(), "records")
    assert targets["keys"] == {"charts:plan_concentration"}
    assert [c["key"] for c in agent_ns["implement_untargeted_changes"]("app", V1, _sorted(), targets, "records")] == ["records"]


def test_the_judge_reads_a_table_sort_by_its_column_label_and_direction(agent_ns):
    fact, label = agent_ns["implement_vibes_fact"], agent_ns["implement_asset_label"](PART)
    check = SPLIT["check"][1]
    assert fact(check, _sorted(), label)[0] == "done"
    missing = fact(check, V1, label)
    assert missing[0] == "missing" and "never by planned units" in missing[1]
    ascending = _sorted()
    ascending["records"]["sort"]["dir"] = "asc"
    assert fact(check, ascending, label)[0] == "missing"
    other = _sorted()
    other["records"]["sort"]["key"] = "product"
    assert fact(check, other, label)[0] == "missing"


def test_a_chart_name_with_no_chart_still_falls_back_to_the_element_that_has_the_name(agent_ns):
    kpi_ask = {"ask": "Change it", "keep": False, "where": "the Planned bake units chart"}
    targets = agent_ns["implement_untargeted_targets"]("app", [(PART, kpi_ask)], V1, _sorted(), "records")
    assert targets["keys"] == {"kpis:planned_units"}
