import json

import pytest

RESULT = "main.inspire.risk_out"
EVENTS = "main.s.events"
SITES = "main.s.sites"
COLUMNS = {RESULT: [("as_of_date", "date", "the date"), ("entity_id", "string", "the site key"), ("entity_label", "string", "the site"),
                    ("priority_tier", "string", "the tier"), ("value", "double", "the risk"), ("value_at_stake", "double", "the stake"),
                    ("expected_count", "double", "the expected events")],
           EVENTS: [("event_id", "bigint", "the event key"), ("entity_key", "string", "the site key"), ("cause", "string", "the cause"),
                    ("amount", "double", "the event cost")],
           SITES: [("site_id", "string", "the site key"), ("region", "string", "the region")]}
LATEST = "as_of_date = (SELECT MAX(as_of_date) FROM `main`.`inspire`.`risk_out`)"
FANNED = (f"SELECT i.cause, SUM(o.expected_count) AS expected FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.entity_key "
          "GROUP BY i.cause")
SPLIT = (f"WITH c AS (SELECT entity_key, cause, COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY entity_key) AS share FROM {EVENTS} "
         f"GROUP BY entity_key, cause) SELECT c.cause, SUM(o.expected_count * c.share) AS expected FROM {RESULT} o JOIN c "
         "ON o.entity_id = c.entity_key GROUP BY c.cause")


def _join(left, right, tag, condition="`o`.`entity_id` = `i`.`entity_key`"):
    return {"left": {"identifier": left, "alias": "o" if left == RESULT else "i"},
            "right": {"identifier": right, "alias": "o" if right == RESULT else "i"},
            "sql": [condition, f"--rt=FROM_RELATIONSHIP_TYPE_{tag}--"]}


def _space(joins, examples=(), benchmarks=()):
    return {"config": {"sample_questions": [{"question": ["Which sites act now?"]}]},
            "data_sources": {"tables": [{"identifier": RESULT}, {"identifier": EVENTS}]},
            "instructions": {"text_instructions": [{"id": "2" * 32, "content": ["Rank 1 is the most urgent.\n"]}],
                             "example_question_sqls": [{"question": [q], "sql": [s]} for q, s in examples],
                             "join_specs": list(joins)},
            "benchmarks": {"questions": [{"question": [q], "answer": [{"format": "SQL", "content": [s]}]} for q, s in benchmarks]}}


def _grounding(ns, raw):
    space = json.loads(json.dumps(raw))
    problems = ns["implement_genie_space_grounding"](space, {k.lower(): v for k, v in COLUMNS.items()}, RESULT, [RESULT, EVENTS, SITES],
                                                     ns["DatabricksInspire"]._TEXT_NAME_TOKENS, LATEST)
    text = "".join("".join(t.get("content") or []) for t in space["instructions"].get("text_instructions") or [])
    return space, [p for p in problems if " adds up " in p], text


def _fanout(ns, sql, tables=None, benchmark=False):
    space = _space([], benchmarks=[("How many events?", sql)] if benchmark else (), examples=() if benchmark else [("Why?", sql)])
    real = {k.lower(): {n.lower(): (n, t, c) for n, t, c in v} for k, v in COLUMNS.items()}
    return ns["implement_genie_fanout_problems"](space, RESULT, tables or [EVENTS], real)


@pytest.mark.parametrize("join", [_join(RESULT, EVENTS, "MANY_TO_MANY"), _join(RESULT, EVENTS, "ONE_TO_MANY"),
                                  _join(EVENTS, RESULT, "MANY_TO_ONE"), _join(EVENTS, RESULT, "MANY_TO_MANY")])
def test_a_join_to_a_many_row_table_adds_the_grain_instruction(agent_ns, join):
    space, _problems, text = _grounding(agent_ns, _space([join]))
    fact = agent_ns["implement_genie_grain_fact"](RESULT, [EVENTS])
    assert fact in text and text.startswith("Rank 1 is the most urgent.")
    assert f"never SUM or AVG a measure of `{RESULT}` over that join" in fact and f"`{EVENTS}` holds many rows per entity" in fact
    assert "first aggregate" in fact and f"A count of the rows of `{EVENTS}` comes from `{EVENTS}` alone." in fact
    again, _p, text_again = _grounding(agent_ns, space)
    assert text_again.count(fact) == 1, "grounding twice keeps one copy of the instruction"


@pytest.mark.parametrize("joins", [[], [_join(RESULT, EVENTS, "MANY_TO_ONE")], [_join(RESULT, EVENTS, "ONE_TO_ONE")],
                                   [_join(EVENTS, RESULT, "ONE_TO_MANY")], [_join(EVENTS, SITES, "MANY_TO_MANY")]])
def test_no_join_to_a_many_row_table_adds_no_grain_instruction(agent_ns, joins):
    _space_out, problems, text = _grounding(agent_ns, _space(joins, [("Why?", FANNED)]))
    assert "holds one value per entity" not in text and problems == []
    assert agent_ns["implement_genie_many_sides"](_space(joins)["instructions"], RESULT) == []


def test_many_sides_lists_each_many_row_table_once(agent_ns):
    sides = agent_ns["implement_genie_many_sides"]
    joins = [_join(RESULT, EVENTS, "ONE_TO_MANY"), _join(EVENTS, RESULT, "MANY_TO_MANY"), _join(RESULT, SITES, "MANY_TO_ONE"),
             {"left": "bad", "right": None, "sql": []}, "bad"]
    assert sides({"join_specs": joins}, "`main`.`inspire`.`risk_out`") == [EVENTS]
    two = agent_ns["implement_genie_grain_fact"](RESULT, [EVENTS, SITES])
    assert f"`{EVENTS}`, `{SITES}` each hold many rows per entity" in two and "that table" in two


def test_grounding_rejects_a_sum_of_a_result_measure_over_a_many_row_join(agent_ns):
    _space_out, problems, _text = _grounding(agent_ns, _space([_join(RESULT, EVENTS, "MANY_TO_MANY")], [("Why?", FANNED)]))
    assert problems == [f"the example SQL for 'Why?' adds up expected_count of the business output table {RESULT} over a join to "
                        f"{EVENTS}, which holds many rows per entity, so each entity's value is counted once per matched row: "
                        f"aggregate {EVENTS} to one row per entity in a subquery first, then join that and add each entity's value once"]
    _space_out, problems, _text = _grounding(agent_ns, _space([_join(RESULT, EVENTS, "MANY_TO_MANY")], [("Why?", SPLIT)]))
    assert problems == []


@pytest.mark.parametrize("sql", [
    FANNED,
    f"SELECT i.cause, SUM(expected_count) FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.entity_key GROUP BY 1",
    f"SELECT i.cause, ROUND(SUM(o.value_at_stake), 2) FROM `main`.`inspire`.`risk_out` AS o INNER JOIN `main`.`s`.`events` i "
    "ON o.entity_id = i.entity_key GROUP BY 1",
    f"SELECT events.cause, SUM(risk_out.expected_count) FROM {EVENTS} JOIN {RESULT} ON risk_out.entity_id = events.entity_key GROUP BY 1",
    f"SELECT i.cause, SUM(o.expected_count) OVER (PARTITION BY i.cause) FROM {RESULT} o LEFT JOIN {EVENTS} i ON o.entity_id = i.entity_key",
    f"SELECT 1 AS a; SELECT i.cause, SUM(o.value) FROM {RESULT} o, {EVENTS} i WHERE o.entity_id = i.entity_key GROUP BY 1",
])
def test_the_check_flags_a_result_measure_summed_over_the_many_side(agent_ns, sql):
    problems = _fanout(agent_ns, sql)
    assert len(problems) == 1 and problems[0].startswith("the example SQL for 'Why?' adds up "), problems
    assert _fanout(agent_ns, sql, benchmark=True)[0].startswith("the benchmark SQL for 'How many events?' adds up ")


@pytest.mark.parametrize("sql", [
    SPLIT,
    f"SELECT o.entity_label, SUM(o.expected_count) FROM {RESULT} o WHERE {LATEST} GROUP BY 1",
    f"SELECT i.cause, COUNT(*), SUM(i.amount) FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.entity_key GROUP BY 1",
    f"SELECT i.cause, SUM(o.expected_count) FROM {RESULT} o JOIN (SELECT entity_key, MAX(cause) AS cause FROM {EVENTS} GROUP BY 1) i "
    "ON o.entity_id = i.entity_key GROUP BY 1",
    f"SELECT SUM(o.expected_count) FROM {RESULT} o LEFT SEMI JOIN {EVENTS} i ON o.entity_id = i.entity_key",
    f"SELECT o.entity_label, (SELECT SUM(o2.value) FROM {RESULT} o2) FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.entity_key",
    f"SELECT SUM(amount) FROM {RESULT} o JOIN {EVENTS} i ON o.entity_id = i.entity_key",
    "SELECT ((( FROM nowhere",
])
def test_the_check_passes_sums_that_count_each_entity_once(agent_ns, sql):
    assert _fanout(agent_ns, sql) == []


def test_the_check_needs_a_many_row_join_and_reads_only_that_table(agent_ns):
    assert agent_ns["implement_genie_fanout_problems"](_space([], [("Why?", FANNED)]), RESULT, [], {}) == []
    assert _fanout(agent_ns, FANNED, tables=[SITES]) == []


def test_the_build_prompt_states_the_grain_rule(agent_ns):
    rules = agent_ns["DatabricksInspire"]._implement_genie_rules(None, {"allowed": [RESULT, EVENTS], "result_table": RESULT})
    assert (f"Inspire rejects a SUM of a measure of `{RESULT}` over a join tagged ONE_TO_MANY or MANY_TO_MANY to another table"
            in rules)


def _built_space(sql, joined=True):
    from v140_implement_test import _space as base_space
    tables = ("main.inspire.churn_out", "main.s.orders") if joined else ("main.inspire.churn_out",)
    space = json.loads(base_space(tables, sql=sql, grounded=True))
    if joined:
        space["serialized_space"]["instructions"]["join_specs"] = [{
            "left": {"identifier": "main.s.orders", "alias": "o"}, "right": {"identifier": "main.inspire.churn_out", "alias": "c"},
            "sql": ["`o`.`customer_id` = `c`.`entity_id`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"]}]
    return json.dumps(space)


@pytest.mark.parametrize("joined", [True, False])
def test_the_build_loads_the_parser_rejects_a_fanned_sum_and_saves_the_grain_instruction(agent_ns, tmp_path, joined):
    from v140_implement_test import GENIE_CHECKED, SPACE_COLUMNS, _FileRunner, _output_context, _output_inspire
    inst, calls = _output_inspire(agent_ns, tmp_path, GENIE_CHECKED)
    loaded = []
    inst._require_asset_package = lambda module, purpose: loaded.append(module)
    orders = [("order_id", "bigint", "the order key"), ("customer_id", "string", "the customer key"), ("status", "string", "the state")]
    inst._implement_space_columns = lambda tables: {**{k.lower(): v for k, v in SPACE_COLUMNS.items()}, "main.s.orders": orders}
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    fanned = ("SELECT o.status, SUM(c.value) FROM main.inspire.churn_out c JOIN main.s.orders o ON o.customer_id = c.entity_id "
              "GROUP BY 1")
    fixed = _built_space("SELECT COUNT(*) FROM main.inspire.churn_out", joined)
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"genie_space.json": _built_space(fanned, joined) if joined else fixed},
                                                      {"genie_space.json": fixed}])
    context = dict(_output_context(agent_ns), allowed=["main.inspire.churn_out", "main.s.orders"])
    assert inst._implement_genie_space(context, runner)["genie_space_id"] == "s9"
    saved = json.loads(next(c[2] for c in calls if c[:2] == ("POST", "/api/2.0/genie/spaces"))["serialized_space"])
    text = "".join(saved["instructions"]["text_instructions"][0]["content"])
    fact = agent_ns["implement_genie_grain_fact"]("main.inspire.churn_out", ["main.s.orders"])
    if joined:
        assert len(runner.prompts) == 2
        assert "the example SQL for 'Which customers act now?' adds up value of the business output table" in runner.prompts[1]
        assert fact in text
    else:
        assert loaded == [] and len(runner.prompts) == 1 and fact not in text
