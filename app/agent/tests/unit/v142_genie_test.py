import copy
import json
import sqlite3
import statistics
import types

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (ALERT, GENIE_CHECKED, SHELL_ALERTS, SHELL_SQL, SPACE_COLUMNS, VALID, _alert_inspire, _calls_to, _FileRunner,
                                 _inspire, _output_context, _output_inspire, _space, _spec, sdk_stub)

RESULT = "main.inspire.churn_out"
ORDERS = "main.s.orders"
COLUMNS = {RESULT: [("as_of_date", "date", "the date"), ("entity_id", "string", "the customer key"),
                    ("entity_label", "string", "the customer name"), ("priority_tier", "string", "the tier"),
                    ("value", "double", "the churn probability"), ("explanation", "string", ""), ("top_reasons", "array<string>", "")],
           ORDERS: [("order_id", "bigint", "the order key"), ("customer_id", "string", "the customer key"),
                    ("amount", "double", "the order value"), ("status", "string", "the order status"),
                    ("customer_email", "string", "the customer's email"), ("note_text", "string", "a free text note")]}
LATEST = "as_of_date = (SELECT MAX(as_of_date) FROM `main`.`inspire`.`churn_out`)"


def _grounding(ns, raw, columns=None, allowed=(RESULT, ORDERS)):
    space = json.loads(json.dumps(raw))
    problems = ns["implement_genie_space_grounding"](space, {k.lower(): v for k, v in (columns or COLUMNS).items()}, RESULT,
                                                     list(allowed), ns["DatabricksInspire"]._TEXT_NAME_TOKENS, LATEST)
    return space, problems


def _result_configs(**overrides):
    descriptions = {"explanation": "why the row is on the list", "top_reasons": "the main reasons"}
    return [dict({"column_name": n, "description": [descriptions.get(n, c)]}, **overrides.get(n, {})) for n, _t, c in COLUMNS[RESULT]]


def _rich_space():
    return {
        "config": {"sample_questions": [{"id": "1" * 32, "question": ["Which customers act now?"]}]},
        "data_sources": {"tables": [{"identifier": RESULT, "column_configs": _result_configs(
            priority_tier={"synonyms": ["urgency", "Urgency", "priority tier", "value", "x" * 61]})},
            {"identifier": ORDERS, "description": "One row per order.",
             "column_configs": [{"column_name": "STATUS", "description": ["order state"], "synonyms": ["state"],
                                                       "enable_entity_matching": False},
                                                      {"column_name": "amount", "enable_entity_matching": True}]}]},
        "instructions": {
            "text_instructions": [{"id": "2" * 32, "content": ["Rank 1 is the most urgent.\n"]}],
            "example_question_sqls": [{"id": "3" * 32, "question": ["Which customers act now?"],
                                       "sql": [f"SELECT entity_label FROM {RESULT} WHERE priority_tier = 'Act now'"]}],
            "join_specs": [{"id": "4" * 32, "left": {"identifier": ORDERS, "alias": "o"}, "right": {"identifier": RESULT, "alias": "c"},
                            "sql": ["`o`.`customer_id` = `c`.`entity_id`\n", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--"]}],
            "sql_snippets": {
                "measures": [{"id": "5" * 32, "alias": "act_now_rows", "display_name": "Act now rows",
                              "sql": ["COUNT_IF(`churn_out`.`priority_tier` = 'Act now')"], "synonyms": ["urgent rows"]}],
                "filters": [{"id": "6" * 32, "alias": "x", "display_name": "open orders", "sql": ["`orders`.`status` = 'open'"],
                             "instruction": "Apply when a question asks only about open orders."}],
                "expressions": [{"id": "7" * 32, "alias": "order_month", "sql": ["DATE_TRUNC('MONTH', `churn_out`.`as_of_date`)"]}]}},
        "benchmarks": {"questions": [{"id": str(i) * 32, "question": [q], "answer": [{"format": "SQL", "content": [
            f"SELECT COUNT(*)", f"FROM {RESULT} WHERE priority_tier = 'Review'"]}]}
            for i, q in ((8, "How many customers are in Review?"), (9, "How many rows are in the latest run?"),
                         ("a", "Which segment has the most Act now rows?"))]},
    }


def test_column_configs_keep_real_columns_and_reject_invented_ones(agent_ns):
    raw = _rich_space()
    raw["data_sources"]["tables"][1]["column_configs"].append({"column_name": "zz_not_a_column", "description": ["x"]})
    space, problems = _grounding(agent_ns, raw)
    assert any(p.startswith(f"the Genie Agent configures column zz_not_a_column of {ORDERS}, which {ORDERS} does not have") for p in problems)
    orders = space["data_sources"]["tables"][1]["column_configs"]
    assert [c["column_name"] for c in orders] == ["amount", "customer_email", "status"], "real casing, sorted, invented one gone"
    assert orders[0]["description"] == ["the order value"], "a blank description falls back to the column's own comment"
    assert orders[2]["description"] == ["order state"], "Genie's description wins over the comment"
    result = {c["column_name"]: c for c in space["data_sources"]["tables"][0]["column_configs"]}
    assert set(result) == {n for n, _t, _c in COLUMNS[RESULT]}, "every column of the business output table is configured"
    raw = _rich_space()
    raw["data_sources"]["tables"][0]["column_configs"] = [c for c in _result_configs() if c["column_name"] != "explanation"]
    _space_out, problems = _grounding(agent_ns, raw)
    assert (f"describe every column of the business output table {RESULT} in business terms, in its column_configs: explanation "
            "has no description") in problems


def test_example_values_and_entity_matching_follow_the_column_kind(agent_ns):
    flags = agent_ns["implement_genie_column_flags"]
    tokens = agent_ns["DatabricksInspire"]._TEXT_NAME_TOKENS
    assert flags("priority_tier", "string", tokens) == (True, True)
    assert flags("value", "double", tokens) == (True, False), "entity matching is for STRING columns only"
    assert flags("entity_id", "string", tokens) == (True, False), "a key is matched by value, not as an entity list"
    assert flags("as_of_date", "date", tokens) == (True, False)
    assert flags("customer_email", "string", tokens) == (False, False), "personal data never becomes shared example values"
    assert flags("explanation", "string", tokens) == (False, False) and flags("note_text", "string", tokens) == (False, False)
    assert flags("top_reasons", "array<string>", tokens) == (False, False)
    space, _problems = _grounding(agent_ns, _rich_space())
    result = {c["column_name"]: c for c in space["data_sources"]["tables"][0]["column_configs"]}
    orders = {c["column_name"]: c for c in space["data_sources"]["tables"][1]["column_configs"]}
    assert (result["priority_tier"]["enable_format_assistance"], result["priority_tier"]["enable_entity_matching"]) == (True, True)
    assert orders["amount"]["enable_entity_matching"] is False, "Genie's entity matching on a number is overruled"
    assert orders["status"]["enable_entity_matching"] is True
    assert orders["customer_email"] == {"column_name": "customer_email", "description": ["the customer's email"],
                                        "enable_format_assistance": False, "enable_entity_matching": False}, \
        "an unconfigured personal-data column still gets example values switched off"
    assert "note_text" not in orders, "other unconfigured input columns keep Genie's own defaults"


def test_entity_matching_stops_at_the_api_limit_of_columns(agent_ns):
    wide = {RESULT: COLUMNS[RESULT], ORDERS: [(f"category_{i}", "string", f"category {i}") for i in range(150)]}
    raw = _rich_space()
    raw["data_sources"]["tables"][1]["column_configs"] = [{"column_name": f"category_{i}"} for i in range(150)]
    raw["instructions"]["join_specs"][0]["sql"] = ["`o`.`category_1` = `c`.`entity_id`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--"]
    raw["instructions"]["sql_snippets"]["filters"][0]["sql"] = ["`orders`.`category_2` = 'open'"]
    space, _problems = _grounding(agent_ns, raw, wide)
    matched = [c for t in space["data_sources"]["tables"] for c in t["column_configs"] if c["enable_entity_matching"]]
    assert len(matched) == agent_ns["IMPLEMENT_GENIE_MAX_ENTITY_COLUMNS"] == 120
    assert all(c["enable_entity_matching"] for c in space["data_sources"]["tables"][0]["column_configs"]
               if c["column_name"] in ("priority_tier", "entity_label")), "the business output table is served first"


def test_synonyms_are_cleaned_and_never_name_another_column(agent_ns):
    clean = agent_ns["implement_genie_synonyms"]
    assert clean([" urgency ", "Urgency", "priority tier", "Priority_Tier", "value", "x" * 61, "", None, 3], "priority_tier",
                 ["value", "rank"]) == ["urgency", "3"]
    assert clean("tier", "priority_tier") == ["tier"] and clean(None, "x") == [] and clean({"a": 1}, "x") == []
    assert len(clean([f"word {i}" for i in range(30)], "x")) == agent_ns["IMPLEMENT_GENIE_MAX_SYNONYMS"]
    space, _problems = _grounding(agent_ns, _rich_space())
    tier = next(c for c in space["data_sources"]["tables"][0]["column_configs"] if c["column_name"] == "priority_tier")
    assert tier["synonyms"] == ["urgency"]
    label = next(c for c in space["data_sources"]["tables"][0]["column_configs"] if c["column_name"] == "entity_label")
    assert "synonyms" not in label, "no empty synonym list is sent"


@pytest.mark.parametrize("change,needle", [
    (lambda j: j["left"].update(identifier="hr.s.salaries"), "a join spec joins hr.s.salaries, which is not a table of the Genie Agent"),
    (lambda j: j.update(sql=["`o`.`zz_key` = `c`.`entity_id`", j["sql"][1]]), f"the join spec o to c reads zz_key, which {ORDERS} does not have"),
    (lambda j: j.update(sql=["`x`.`customer_id` = `c`.`entity_id`", j["sql"][1]]), "the join spec o to c reads x.customer_id: qualify"),
    (lambda j: j.update(sql=["customer_id = entity_id", j["sql"][1]]), "the join spec o to c names no column"),
    (lambda j: j["right"].update(alias="o"), "each join spec joins two tables of the Genie Agent with two different aliases"),
])
def test_a_join_spec_must_join_tables_of_the_space_on_their_real_columns(agent_ns, change, needle):
    raw = _rich_space()
    change(raw["instructions"]["join_specs"][0])
    _space_out, problems = _grounding(agent_ns, raw)
    assert any(needle in p for p in problems), problems


def test_every_input_table_joins_the_space_and_the_business_output_table_is_in_it(agent_ns):
    raw = _rich_space()
    raw["instructions"]["join_specs"] = []
    _s, problems = _grounding(agent_ns, raw)
    assert (f"{ORDERS} joins no other table of the Genie Agent: add a join spec for each, on the keys the notebook joins them by"
            in problems)
    _s, problems = _grounding(agent_ns, _rich_space())
    assert problems == [], problems
    alone = _rich_space()
    alone["data_sources"]["tables"] = alone["data_sources"]["tables"][1:]
    _s, problems = _grounding(agent_ns, alone)
    assert f"the Genie Agent must hold the business output table {RESULT}, the first of its tables" in problems


ALIASES = {RESULT: "churn_out", ORDERS: "orders"}


def _join_checks(ns, space, tag=None, condition=None):
    tagged = copy.deepcopy(space)
    join = tagged["instructions"]["join_specs"][0]
    join["sql"] = [condition or join["sql"][0], f"--rt=FROM_RELATIONSHIP_TYPE_{tag}--" if tag else join["sql"][1]]
    return [c for c in ns["implement_genie_space_checks"](tagged, ALIASES, RESULT) if c["label"].startswith("the join spec")]


def test_a_join_compiles_and_only_the_business_output_table_side_of_its_tag_is_read(agent_ns):
    space, _p = _grounding(agent_ns, _rich_space())
    (compiled,) = _join_checks(agent_ns, space)
    assert compiled == {"label": "the join spec o to c", "limit": 0, "sql": (
        "SELECT 1 AS joined FROM `main`.`s`.`orders` AS `o` JOIN `main`.`inspire`.`churn_out` AS `c` "
        "ON `o`.`customer_id` = `c`.`entity_id` LIMIT 0")}, "MANY_TO_MANY calls no side unique, so the join is only compiled"
    composite = "`o`.`customer_id` = `c`.`entity_id` AND `c`.`as_of_date` = `o`.`d`\n"
    for tag in ("MANY_TO_ONE", "ONE_TO_ONE"):
        (_compiled, repeats) = _join_checks(agent_ns, space, tag, composite)
        assert repeats["sql"] == ("SELECT 1 AS repeated FROM `main`.`inspire`.`churn_out` WHERE `entity_id` IS NOT NULL AND "
                                  "`as_of_date` IS NOT NULL GROUP BY `entity_id`, `as_of_date` HAVING COUNT(*) > 1"), tag
        assert repeats["expect"] == "none"
    assert len(_join_checks(agent_ns, space, "ONE_TO_MANY", composite)) == 1, \
        "a tag that calls an input table's key unique is left to Genie: Inspire never reads input-table rows"
    assert len(_join_checks(agent_ns, space, "ONE_TO_ONE", "`o`.`customer_id` LIKE `c`.`entity_id`")) == 1, \
        "a condition that is not key equality is only compiled"
    flipped = copy.deepcopy(space)
    flipped["instructions"]["join_specs"][0].update(left={"identifier": "main.inspire.churn_out_reasons", "alias": "r"},
                                                    right={"identifier": RESULT, "alias": "c"})
    (_compiled, reasons) = _join_checks(agent_ns, flipped, "ONE_TO_MANY", "`r`.`entity_id` = `c`.`entity_id`")
    assert reasons["sql"].startswith("SELECT 1 AS repeated FROM `main`.`inspire`.`churn_out_reasons` WHERE `entity_id` IS NOT NULL")


def test_no_check_reads_rows_of_an_input_table(agent_ns):
    space, _p = _grounding(agent_ns, _rich_space())
    space["instructions"]["join_specs"][0]["sql"][1] = "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_ONE--"
    for check in agent_ns["implement_genie_space_checks"](space, ALIASES, RESULT):
        if check["label"].startswith("the example SQL"):
            continue
        reads_result_only = check["sql"].startswith("SELECT 1 AS repeated FROM `main`.`inspire`.`churn_out` ")
        assert check.get("limit") == 0 or reads_result_only, check
        assert check["sql"].endswith(" LIMIT 0") or reads_result_only or check["label"].startswith("the benchmark"), check


@pytest.mark.parametrize("kind,item,needle", [
    ("measures", {"alias": "m", "sql": ["SUM(`orders`.`zz_amount`)"]}, f"reads zz_amount, which {ORDERS.lower()} does not have"),
    ("measures", {"alias": "m", "sql": ["SUM(`o`.`amount`)"]}, "reads o.amount: name each column as `table`.`column` with one of"),
    ("measures", {"alias": "m", "sql": ["(SELECT SUM(amount) FROM main.s.orders)"]}, "must be one SQL expression"),
    ("measures", {"alias": "m", "sql": ["SUM(`orders`.`amount`) / COUNT(`churn_out`.`entity_id`)"]}, "reads more than one table"),
    ("measures", {"sql": ["SUM(`orders`.`amount`)"]}, "needs its own alias"),
    ("measures", {"alias": "m", "sql": ["SUM(amount)"]}, "names no column"),
    ("filters", {"sql": ["`orders`.`status` = 'open'"]}, "needs a display_name"),
    ("filters", {"display_name": "f", "sql": ["`orders`.`status` = 'open'; DELETE FROM main.s.orders"]}, "never a query or a statement"),
    ("dimensions", {"alias": "d", "sql": ["`orders`.`status`"]}, "sql_snippets.dimensions is not one of filters, expressions, measures"),
])
def test_a_sql_expression_that_names_an_unknown_column_or_table_is_blocked(agent_ns, kind, item, needle):
    raw = _rich_space()
    raw["instructions"]["sql_snippets"].setdefault(kind, []).append(dict(item, id="b" * 32))
    _s, problems = _grounding(agent_ns, raw)
    assert any(needle in p for p in problems), problems


def test_sql_expressions_are_run_on_their_own_table_before_publish(agent_ns):
    space, problems = _grounding(agent_ns, _rich_space())
    assert problems == []
    snippets = space["instructions"]["sql_snippets"]
    assert "alias" not in snippets["filters"][0], "a filter carries no alias"
    assert snippets["expressions"][0]["display_name"] == "order month"
    checks = {c["label"]: c for c in agent_ns["implement_genie_space_checks"](space, ALIASES, RESULT)}
    assert checks["the measure 'Act now rows'"] == {"label": "the measure 'Act now rows'", "limit": 0, "sql": (
        "SELECT COUNT_IF(`churn_out`.`priority_tier` = 'Act now') AS inspire_check FROM `main`.`inspire`.`churn_out` AS `churn_out` "
        "LIMIT 0")}
    assert checks["the filter 'open orders'"]["sql"] == ("SELECT 1 AS matched FROM `main`.`s`.`orders` AS `orders` WHERE "
                                                         "`orders`.`status` = 'open' LIMIT 0")
    assert checks["the expression 'order month'"]["sql"] == ("SELECT DATE_TRUNC('MONTH', `churn_out`.`as_of_date`) AS inspire_check "
                                                             "FROM `main`.`inspire`.`churn_out` AS `churn_out` LIMIT 0")
    assert checks["the benchmark SQL for 'How many customers are in Review?'"]["limit"] == 0, "a benchmark is compiled, never read"


def test_every_sample_question_has_an_example_sql(agent_ns):
    raw = _rich_space()
    raw["config"]["sample_questions"].append({"id": "c" * 32, "question": ["Who left last month?"]})
    _s, problems = _grounding(agent_ns, raw)
    assert ("the sample question 'Who left last month?' has no example SQL: give each sample question an example question SQL "
            "with the same question that answers it") in problems


@pytest.mark.parametrize("change,needle", [
    (lambda b: b.pop(), "has 2 benchmark questions with a gold SQL answer; write at least 3"),
    (lambda b: b[0].update(question=["which customers act NOW?"]), "repeats a sample question or an example SQL question"),
    (lambda b: b[0].update(answer=[]), "needs exactly one answer of format SQL"),
    (lambda b: b[0].update(answer=[{"format": "SQL", "content": ["SELECT 1"]}] * 2), "needs exactly one answer of format SQL"),
    (lambda b: b[1].update(question=b[0]["question"]), "is asked twice"),
    (lambda b: b[0].update(answer=[{"format": "SQL", "content": ["DELETE FROM main.inspire.churn_out"]}]), "writes data"),
    (lambda b: b[0].update(answer=[{"format": "SQL", "content": ["SELECT * FROM hr.s.salaries"]}]), "outside the Genie Agent: hr.s.salaries"),
])
def test_benchmarks_need_gold_sql_answers_that_differ_from_the_examples(agent_ns, change, needle):
    raw = _rich_space()
    change(raw["benchmarks"]["questions"])
    _s, problems = _grounding(agent_ns, raw)
    assert any(needle in p for p in problems), problems


def test_benchmark_sql_lines_are_joined_with_newlines(agent_ns):
    space, _p = _grounding(agent_ns, _rich_space())
    answer = space["benchmarks"]["questions"][0]["answer"]
    assert answer == [{"format": "SQL", "content": ["SELECT COUNT(*)\n", f"FROM {RESULT} WHERE priority_tier = 'Review'"]}]


def test_the_latest_run_comes_from_the_shared_filter_and_is_written_once(fresh_ns):
    fresh_ns["implement_latest_run_filter"] = lambda table: f"<<current rows of {table}>>"
    inst = _inspire(fresh_ns, FakeSpark())
    seen = {}
    inst._genie_decision_contract = lambda uc: []
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy: seen.update(prompt=prompt, deploy=deploy) or {}
    inst._implement_genie_space(_output_context(fresh_ns), None)
    assert f"is its rows where <<current rows of {RESULT}>>; questions about the current results read those rows." in seen["prompt"]
    space = _rich_space()
    problems = fresh_ns["implement_genie_space_grounding"](space, {k.lower(): v for k, v in COLUMNS.items()}, RESULT, [RESULT, ORDERS],
                                                           (), fresh_ns["implement_latest_run_filter"](RESULT))
    text = "".join(space["instructions"]["text_instructions"][0]["content"])
    assert text.startswith("Rank 1 is the most urgent.\n\nThe latest run of `main.inspire.churn_out` is its rows where "
                           "<<current rows of main.inspire.churn_out>>;") and problems == []
    again = json.loads(json.dumps(space))
    fresh_ns["implement_genie_space_grounding"](again, {k.lower(): v for k, v in COLUMNS.items()}, RESULT, [RESULT, ORDERS], (),
                                                fresh_ns["implement_latest_run_filter"](RESULT))
    assert again["instructions"]["text_instructions"] == space["instructions"]["text_instructions"], "the fact is never repeated"
    query = fresh_ns["implement_alert_query"](SHELL_SQL, RESULT, dict(fresh_ns["validate_implement_spec"](
        dict(VALID, outputs={**VALID["outputs"], **ALERT, "alert_threshold_basis": "baseline"}))[0]["outputs"]), columns=RUN_TABLE)["query"]
    assert fresh_ns["INSPIRE_CURRENT_ROWS"] == SHELL_SQL.CURRENT_ROWS, "the agent and the App shell name the current rows the same way"
    assert query.startswith(f"WITH runs AS (SELECT * FROM ({SHELL_SQL.runs_compare_sql(SHELL_SQL.records_sql(RESULT), RESULT, RUN_TABLE, range(31))}"
                            f") AS d)") and "MAX(as_of_date) FROM `main`" not in query


def test_the_genie_space_prompt_asks_for_configs_expressions_and_benchmarks(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    seen = {}
    inst._genie_decision_contract = lambda uc: []
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy: seen.update(prompt=prompt) or {}
    inst._implement_genie_space(_output_context(agent_ns), None)
    prompt = seen["prompt"]
    assert "with these names: `churn_out` for main.inspire.churn_out, `orders` for main.s.orders." in prompt
    assert "- Benchmarks: at least 3 more questions a decision owner asks, worded differently from the sample questions" in prompt
    assert "it sets example values and entity matching itself" in prompt
    assert prompt.count("- Test every ") == 1 and ("- Test every example SQL, benchmark SQL and SQL expression on SQL warehouse wh1 "
                                                   "with `databricks api post /api/2.0/sql/statements`; each must succeed") in prompt
    assert "Where these rules conflict with what the user chose (the questions or the title), the user's choice wins." in prompt
    fmt = json.loads(agent_ns["DatabricksInspire"]._GENIE_SPACE_FORMAT)["serialized_space"]
    assert set(fmt["instructions"]["sql_snippets"]) == set(agent_ns["IMPLEMENT_GENIE_SNIPPET_KINDS"])
    assert fmt["benchmarks"]["questions"][0]["answer"][0]["format"] == "SQL"


def test_aliases_follow_the_table_name_and_tell_apart_two_tables_of_the_same_name(agent_ns):
    assert agent_ns["implement_genie_aliases"](["main.s.orders", "Main.S.Orders", "other.t.orders", "main.inspire.churn_out"]) == {
        "main.inspire.churn_out": "churn_out", "main.s.orders": "orders", "other.t.orders": "t_orders"}


def test_column_refs_skip_strings_comments_and_three_part_names_keep_their_parts(agent_ns):
    refs = agent_ns["implement_sql_column_refs"]
    assert refs("`a`.`b` = c.d AND x = 'p.q' -- r.s\n AND 1.5 > 0 AND f(e.g)") == [("a", "b"), ("c", "d"), ("e", "g")]
    assert refs("main.s.orders") == [("main", "s", "orders")] and refs("COUNT(*)") == []


def _describe_rows(*names):
    return [types.SimpleNamespace(col_name=n, data_type="string", comment=f"c {n}") for n in names] + [
        types.SimpleNamespace(col_name="# Partition Information", data_type="", comment="")]


def test_the_space_columns_come_from_describe_and_an_unreadable_table_is_an_error(agent_ns):
    def respond(statement):
        if "hr" in statement:
            raise RuntimeError("PERMISSION_DENIED: no access")
        return _describe_rows("a", "b")
    inst = _inspire(agent_ns, FakeSpark(responder=respond))
    assert inst._implement_space_columns(["Main.S.Orders"]) == {"main.s.orders": [("a", "string", "c a"), ("b", "string", "c b")]}
    assert inst.spark.statements == ["DESCRIBE TABLE `Main`.`S`.`Orders`"]
    with pytest.raises(RuntimeError, match="the columns of hr.s.x could not be read: PERMISSION_DENIED"):
        inst._implement_space_columns(["hr.s.x"])


def _deploy_inspire(ns, tmp_path, failing=()):
    inst, calls = _output_inspire(ns, tmp_path, GENIE_CHECKED)
    inst._implement_space_columns = lambda tables: {t.lower(): COLUMNS.get(t.lower()) or SPACE_COLUMNS.get(t.lower(), []) for t in tables}
    ran = []

    def check(sql, require_rows=False, limit=20):
        ran.append(sql)
        if any(f in sql for f in failing) and len([s for s in ran if s == sql]) == 1:
            raise RuntimeError("[UNRESOLVED_COLUMN] zz cannot be resolved")
        return [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]

    inst._implement_run_query_check = check
    return inst, calls, ran


def _definition(space):
    return json.dumps({"title": "Churn desk", "description": "d", "serialized_space": space})


def _posted_space(calls):
    (body, _q), = _calls_to(calls, "POST", "/api/2.0/genie/spaces")
    return json.loads(body["serialized_space"])


def test_the_published_space_carries_the_grounded_content(agent_ns, tmp_path):
    inst, calls, ran = _deploy_inspire(agent_ns, tmp_path)
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(_rich_space())}])
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    assert fields["genie_space_id"] == "s9"
    posted = _posted_space(calls)
    tables = {t["identifier"]: t for t in posted["data_sources"]["tables"]}
    assert [c["column_name"] for c in tables[RESULT]["column_configs"]] == sorted(n for n, _t, _c in COLUMNS[RESULT])
    assert posted["instructions"]["sql_snippets"]["measures"][0]["sql"] == ["COUNT_IF(`churn_out`.`priority_tier` = 'Act now')"]
    assert posted["instructions"]["sql_snippets"]["filters"][0]["instruction"] == ["Apply when a question asks only about open orders."]
    assert tables[ORDERS]["description"] == ["One row per order."], "the API takes descriptions and instructions as lists of text"
    assert len(posted["benchmarks"]["questions"]) == 3
    assert "The latest run of `main.inspire.churn_out` is its rows where" in "".join(posted["instructions"]["text_instructions"][0]["content"])
    assert any(s.startswith("SELECT entity_label FROM main.inspire.churn_out") for s in ran), "the example SQL ran"
    assert sum(s.startswith("SELECT COUNT(*)\nFROM main.inspire.churn_out") for s in ran) == 3, "each benchmark SQL ran"
    assert any(s.startswith("SELECT 1 AS joined FROM `main`.`s`.`orders` AS `o` JOIN") and s.endswith(" LIMIT 0") for s in ran), \
        "the join was compiled"
    assert sum("AS inspire_check FROM" in s or s.startswith("SELECT 1 AS matched FROM") for s in ran) == 3, \
        "each SQL expression was compiled on its own table"
    assert [c[:2] for c in calls][-2:] == [("POST", "/api/2.0/genie/spaces/s9/start-conversation"),
                                           ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1")]


@pytest.mark.parametrize("failing,needle", [
    ("WHERE priority_tier = 'Review'", "the benchmark SQL for 'How many customers are in Review?' failed: [UNRESOLVED_COLUMN]"),
    ("COUNT_IF(`churn_out`.`priority_tier`", "the measure 'Act now rows' failed: [UNRESOLVED_COLUMN]"),
    ("WHERE priority_tier = 'Act now'", "the example SQL for 'Which customers act now?' failed: [UNRESOLVED_COLUMN]"),
])
def test_a_check_that_fails_on_the_warehouse_is_not_published_and_goes_back_to_genie(agent_ns, tmp_path, failing, needle):
    inst, calls, _ran = _deploy_inspire(agent_ns, tmp_path, failing=(failing,))
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"genie_space.json": _definition(_rich_space())}] * 2)
    assert inst._implement_genie_space(_output_context(agent_ns), runner)["genie_space_id"] == "s9"
    assert needle in runner.prompts[1]
    assert len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1, "nothing is saved until every check passes"


def test_a_join_whose_business_output_side_repeats_goes_back_to_genie(agent_ns, tmp_path):
    inst, calls, _ran = _deploy_inspire(agent_ns, tmp_path)
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [{"n": 1}] if limit else []
    tagged = _rich_space()
    tagged["instructions"]["join_specs"][0]["sql"][1] = "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"
    runner = _FileRunner([{"exit": 0}] * 3, [{"genie_space.json": _definition(tagged)}] * 3)
    with pytest.raises(RuntimeError, match="the join spec o to c is tagged MANY_TO_ONE, so each entity_id of main.inspire.churn_out "
                                           "must be on one row, but some repeat across its rows and runs"):
        inst._implement_genie_space(_output_context(agent_ns), runner)
    assert _calls_to(calls, "POST", "/api/2.0/genie/spaces") == []
    tagged["instructions"]["join_specs"][0]["sql"][1] = "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--"
    read = []
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: read.append((sql, limit)) or ([{"n": 1}] if limit else [])
    inst._implement_genie_space(_output_context(agent_ns), _FileRunner([{"exit": 0}], [{"genie_space.json": _definition(tagged)}]))
    assert len(_calls_to(calls, "POST", "/api/2.0/genie/spaces")) == 1, "an input table's key is Genie's to check"
    assert not any("`main`.`s`.`orders`" in sql and limit for sql, limit in read), "no row of an input table is read"


def test_invented_columns_never_reach_the_api(agent_ns, tmp_path):
    inst, calls, _ran = _deploy_inspire(agent_ns, tmp_path)
    invented = _rich_space()
    invented["instructions"]["sql_snippets"]["measures"][0]["sql"] = ["SUM(`churn_out`.`zz_revenue`)"]
    runner = _FileRunner([{"exit": 0}, {"exit": 0}], [{"genie_space.json": _definition(invented)},
                                                      {"genie_space.json": _definition(_rich_space())}])
    inst._implement_genie_space(_output_context(agent_ns), runner)
    assert f"the measure 'Act now rows' reads zz_revenue, which {RESULT} does not have" in runner.prompts[1]
    assert "zz_revenue" not in json.dumps(_posted_space(calls))


BASELINE = {**ALERT, "alert_threshold_basis": "baseline"}
RUN_TABLE = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "as_of_date", "priority_tier"]


def _outputs(ns, **changes):
    spec, errors = _spec(ns, outputs={**VALID["outputs"], **changes})
    assert errors == [], errors
    return spec["outputs"]


@pytest.mark.parametrize("changes,needle", [
    ({"alert_threshold_basis": "median"}, "alert_threshold_basis 'median' must be one of fixed, baseline"),
    ({"alert_threshold_basis": "baseline", "alert_operator": "="}, "a baseline threshold fires on a rise or a fall"),
    ({"alert_threshold_basis": "baseline", "alert_operator": "!="}, "alert_operator must be one of >= > <= <, not '!='"),
])
def test_a_baseline_threshold_needs_a_rise_or_a_fall(agent_ns, changes, needle):
    errors = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT, **changes})[1]
    assert any(needle in e for e in errors), errors


def test_the_threshold_basis_defaults_to_the_users_number_and_a_change_refreshes_the_alert(agent_ns):
    assert _outputs(agent_ns, **ALERT)["alert_threshold_basis"] == "fixed"
    assert _outputs(agent_ns, **ALERT, alert_threshold_basis=" Baseline ")["alert_threshold_basis"] == "baseline"
    before = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]
    after = _spec(agent_ns, outputs={**VALID["outputs"], **BASELINE})[0]
    assert agent_ns["classify_implement_change"](before, after) == ["outputs"]
    plan = agent_ns["implement_plan"](before, after, {"alert": "al-1", "dashboard": "d", "genie_space": "g", "app": "churn-desk",
                                                      "preview_run_id": 5}, has_built_notebook=True)
    assert plan["refresh"] == ["alert"] and plan["refill"] is False


class _CountIf:
    def __init__(self):
        self.n = 0

    def step(self, value):
        self.n += 1 if value else 0

    def finalize(self):
        return self.n


class _StddevSamp:
    def __init__(self):
        self.values = []

    def step(self, value):
        if value is not None:
            self.values.append(float(value))

    def finalize(self):
        return statistics.stdev(self.values) if len(self.values) > 1 else None


def test_the_baseline_reads_each_earlier_run_as_it_left_the_decision_list_never_a_later_change_or_the_latest_run(agent_ns):
    sql = agent_ns["implement_alert_query"](SHELL_SQL, RESULT, _outputs(agent_ns, **BASELINE), columns=RUN_TABLE)["query"].replace(
        "`main`.`inspire`.`churn_out`", "churn_out")
    db = sqlite3.connect(":memory:")
    db.create_aggregate("COUNT_IF", 1, _CountIf)
    db.create_aggregate("STDDEV_SAMP", 1, _StddevSamp)
    db.execute(f"CREATE TABLE churn_out ({', '.join(RUN_TABLE)})")
    rows = [(f"k{d}_{i}", f"2026-10-0{d} 06:00", f"2026-10-0{d} 09:00" if (d, i) == (6, 0) else f"2026-10-0{d + 1} 06:00", 0, "run", "job",
             f"r{d}", f"2026-10-0{d}", "Act now") for d in range(1, 7) for i in range(d)]
    rows += [("k6_0", "2026-10-06 09:00", "2026-10-07 06:00", 0, "edit", "sam", "r6", "2026-10-06", "Monitor")]
    rows += [(f"n{i}", "2026-10-07 06:00", None, 1, "run", "job", "r7", "2026-10-07", "Act now") for i in range(20)]
    db.executemany(f"INSERT INTO churn_out VALUES ({', '.join('?' for _ in RUN_TABLE)})", rows)
    cursor = db.execute(sql)
    row = dict(zip([c[0] for c in cursor.description], cursor.fetchone()))
    assert (row["history_runs"], row["baseline_mean"], row["previous_run_value"]) == (6, 3.5, 6), \
        "each earlier run as it ended: a person's change after a run ended is not that run's, and the latest run is not an earlier one"
    assert row["tier_rows"] == 20 and row["threshold_basis"] == "baseline" and row["alert_value"] == 1, row


def test_the_baseline_alert_compares_the_latest_run_with_up_to_30_earlier_runs(agent_ns):
    query = agent_ns["implement_alert_query"](SHELL_SQL, RESULT, _outputs(agent_ns, **BASELINE), columns=RUN_TABLE)
    assert (query["column"], query["operator"], query["threshold"]) == ("alert_value", "GREATER_THAN_OR_EQUAL", 1.0)
    sql, measure, backs = query["query"], "COUNT_IF(priority_tier IN ('Act now'))", range(1, 31)
    listed = SHELL_SQL.records_sql(RESULT)
    assert sql.startswith(f"WITH runs AS (SELECT * FROM ({SHELL_SQL.runs_compare_sql(listed, RESULT, RUN_TABLE, range(31))}) AS d),\n")
    assert (f"tier_rows AS (SELECT {SHELL_SQL.run_measure(measure, SHELL_SQL.RUN_LATEST)} AS tier_rows, "
            f"{SHELL_SQL.run_measure('COUNT(*)', SHELL_SQL.RUN_LATEST)} AS run_rows") in sql
    assert f"{', '.join(f'{SHELL_SQL.previous_run_measure(measure, back)} AS v{back}' for back in backs)} FROM runs)" in sql
    assert sql.count("ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)") == 1 and "`_inspire_nth` IN (2, 3, " in sql
    assert sql == SHELL_SQL.alert_query(measure, ">=", 1.0, "baseline", source=listed, table=RESULT, columns=RUN_TABLE, name="tier_rows",
                                        extra=agent_ns["IMPLEMENT_ALERT_RUN_COLUMNS"])["query"], "one builder makes the App's and the agent's alerts"
    assert ("COUNT(`_inspire_value`) AS history_runs, AVG(`_inspire_value`) AS baseline_mean, COALESCE(STDDEV_SAMP(`_inspire_value`), 0) "
            "AS baseline_sd FROM history") in sql
    assert sql.count("FROM tier_rows") == 1 and "FROM tier_rows t CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 AS n" in sql
    assert ("CASE WHEN CASE WHEN t.history_runs >= 5 THEN t.tier_rows > t.baseline_mean + 2 * t.baseline_sd ELSE "
            "t.tier_rows >= 1.0 END THEN 1 ELSE 0 END AS alert_value") in sql
    assert "CASE WHEN t.history_runs >= 5 THEN 'baseline' ELSE 'fixed' END AS threshold_basis" in sql
    assert sql.endswith("t.v1 AS previous_run_value FROM baseline t")
    fall = agent_ns["implement_alert_query"](SHELL_SQL, RESULT, _outputs(agent_ns, **BASELINE, alert_operator="<", alert_threshold=2),
                                             columns=RUN_TABLE)["query"]
    assert "THEN t.tier_rows < t.baseline_mean - 2 * t.baseline_sd ELSE t.tier_rows < 2.0 END" in fall
    both = agent_ns["implement_alert_query"](SHELL_SQL, RESULT, _outputs(agent_ns, **BASELINE), "SELECT TRUE AS triggered",
                                             columns=RUN_TABLE)["query"]
    assert "ELSE t.tier_rows >= 1.0 END OR COALESCE(c.triggered, FALSE) THEN 1 ELSE 0 END AS alert_value" in both
    assert both.index("baseline AS (") < both.index("user_condition AS (")
    assert both.endswith("FROM baseline t LEFT JOIN (SELECT triggered FROM user_condition LIMIT 1) c ON TRUE")
    fixed = agent_ns["implement_alert_query"](SHELL_SQL, RESULT, _outputs(agent_ns, **ALERT))["query"]
    assert "history" not in fixed and "baseline" not in fixed, "the user's fixed number keeps the plain query"


def test_a_baseline_with_no_history_falls_back_to_the_number_set_in_the_wizard(agent_ns, tmp_path):
    outputs = _outputs(agent_ns, **BASELINE)
    now = agent_ns["implement_alert_baseline_now"]
    short = {"alert_value": 1, "tier_rows": 3, "history_runs": 0, "baseline_mean": None, "baseline_sd": None, "alert_threshold": 1.0,
             "threshold_basis": "fixed"}
    assert now(outputs, [short]) == {"threshold_basis": "fixed", "history_runs": 0, "baseline_mean": None, "baseline_sd": None,
                                     "alert_threshold": 1.0, "previous": None}
    assert now(_outputs(agent_ns, **ALERT), [short]) == {} and now(outputs, []) == {}

    def describe(statement, logged=False):
        if statement.startswith("DESCRIBE") and "churn_out_run_log" in statement and not logged:
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] not found")
        return [{"col_name": c, "data_type": "string"} for c in RUN_TABLE] if statement.startswith("DESCRIBE") else []

    described = FakeSpark(responder=describe)
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[short])
    inst.spark = described
    fields = inst._implement_alert(_output_context(agent_ns, **BASELINE), None)
    assert fields["_asset"]["baseline"]["threshold_basis"] == "fixed"
    assert fields["_asset"]["trigger"] == ("Act now rows in the latest run rise above the mean plus 2 standard deviations of up to 30 "
                                           "earlier runs (at least 1 until 5 earlier runs exist)")
    assert inst.logger.matching("threshold now fixed at 1.0 from 0 earlier runs; No earlier run to compare")
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["evaluation"]["source"]["name"] == "alert_value" and "history AS (" in alert["query_text"]
    assert f"WITH runs AS (SELECT * FROM ({SHELL_SQL.runs_compare_sql(SHELL_SQL.records_sql(RESULT), RESULT, RUN_TABLE, range(31))})" in \
        alert["query_text"], "the build reads the result table's columns so each earlier run is read as it ended"
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, rows=[short])
    inst.spark = FakeSpark(responder=lambda statement: describe(statement, logged=True))
    inst._implement_alert(_output_context(agent_ns, **BASELINE), None)
    [(logged, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert "FROM `main`.`inspire`.`churn_out_run_log` AS l" in logged["query_text"] and "LEFT ANTI JOIN" in logged["query_text"], \
        "a table that keeps a run log reads each earlier run from the log, since a run that changed nothing wrote no version"
    assert "ON t.`valid_from` <= e.`_inspire_ended`" not in logged["query_text"]
    enough = dict(short, history_runs=12, baseline_mean=4.0, baseline_sd=1.5, alert_threshold=7.0, threshold_basis="baseline",
                  previous_run_value=5)
    inst, _c, _q = _alert_inspire(agent_ns, tmp_path, rows=[enough])
    inst.spark = described
    assert inst._implement_alert(_output_context(agent_ns, **BASELINE), None)["_asset"]["baseline"] == {
        "threshold_basis": "baseline", "history_runs": 12, "baseline_mean": 4.0, "baseline_sd": 1.5, "alert_threshold": 7.0, "previous": 5}
    assert inst.logger.matching("from 12 earlier runs; 5 in the previous run")


def test_the_alert_runbook_says_what_it_means_what_to_do_and_when_it_clears(agent_ns):
    texts, shell_alerts = agent_ns["implement_alert_texts"], SHELL_ALERTS
    use_case = {"Name": "Predict churn", "Statement": "Customers leave",
                "elite_assessment": {"decision": "Call at-risk customers", "decision_owner": "Retention lead", "kpi": "churn rate"}}
    _s, text = texts(shell_alerts, "N01-U01", use_case, _outputs(agent_ns, **BASELINE), "https://h/d", "https://h/genie/rooms/s9",
                     {"cron": "0 0 6 ? * MON", "timezone": "Asia/Dubai", "enabled": True})
    lines = text.splitlines()
    assert lines[0] == ("What fired: Act now rows in the latest run rise above the mean plus 2 standard deviations "
                        "of up to 30 earlier runs (at least 1 until 5 earlier runs exist).")
    assert "5. Ask the Genie Agent (https://h/genie/rooms/s9) why a row is on the list or how it compares with earlier runs." in lines
    assert ["Where to look:", "Dashboard: https://h/d", "Genie Agent: https://h/genie/rooms/s9"] == lines[lines.index("Where to look:"):][:3]
    assert "When it clears: you get one more email when it returns to OK." in lines
    threshold = next(line for line in lines if line.startswith("Why this threshold: "))
    assert threshold.startswith("Why this threshold: the mean plus 2 standard deviations of the Act now rows of up to 30 earlier runs")
    assert "a percentile of so few runs is one of the top runs" in threshold
    assert "With fewer than 5 earlier runs the alert uses the number set in the wizard (Act now rows are at least 1)" in threshold
    assert ("How often it checks: after each scheduled run of the job (at 06:00 every Monday, Asia/Dubai), once its notebook task has written the "
            "results.") in lines
    cadence = agent_ns["implement_alert_cadence_text"]
    assert cadence({"cron": "0 0 6 ? * MON", "timezone": "UTC", "enabled": False}) == (
        "after each run of the job; its schedule (at 06:00 every Monday, UTC) is paused, so only when someone runs the job")
    assert cadence({}) == "after each run of the job; the job has no schedule, so only when someone runs it"
    falling = agent_ns["implement_alert_threshold_reason"](_outputs(agent_ns, **BASELINE, alert_operator="<="))
    assert falling.startswith("the mean minus 2 standard deviations")
    assert len(texts(shell_alerts, "N01-U01", {"Name": "x" * 900, "Statement": "y" * 900}, _outputs(agent_ns, **BASELINE))[1]) <= 4000


def test_the_alert_schedule_follows_the_job_and_stays_paused_for_the_job_task(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["schedule"] == {"quartz_cron_schedule": "0 0 6 ? * MON", "timezone_id": "Asia/Dubai", "pause_status": "PAUSED"}
    assert "How often it checks: after each scheduled run of the job (at 06:00 every Monday, Asia/Dubai)" in alert["custom_description"]
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    job = types.SimpleNamespace(settings=types.SimpleNamespace(schedule=types.SimpleNamespace(quartz_cron_expression="0 30 7 * * ?")))
    inst.w_client.jobs = types.SimpleNamespace(get=lambda job_id: job)
    context = _output_context(agent_ns, **ALERT)
    context["spec"]["schedule"] = {"enabled": False, "cron": "", "timezone": "UTC", "failure_emails": []}
    inst._implement_alert(context, None)
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["schedule"] == {"quartz_cron_schedule": "0 30 7 * * ?", "timezone_id": "UTC", "pause_status": "PAUSED"}
    assert "its schedule (at 07:30 every day, UTC) is paused" in alert["custom_description"]
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    inst._implement_alert(context, None)
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert alert["schedule"]["quartz_cron_schedule"] == agent_ns["IMPLEMENT_ALERT_IDLE_CRON"]
    assert "the job has no schedule" in alert["custom_description"]
    assert inst.logger.matching("could not read the schedule of job 77, so the alert follows the wizard's schedule only")


def test_a_schedule_only_edit_refreshes_the_alert_and_the_job_uses_the_same_cadence(agent_ns, sdk_stub):
    before = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]
    after = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT}, schedule=dict(VALID["schedule"], cron="0 0 9 ? * FRI"))[0]
    assets = {"alert": "al-1", "dashboard": "d", "genie_space": "g", "app": "churn-desk", "preview_run_id": 5}
    plan = agent_ns["implement_plan"](before, after, assets, has_built_notebook=True)
    assert plan["classes"] == ["schedule"] and plan["refresh"] == ["alert"] and plan["schedule"] is True
    assert agent_ns["implement_plan"](before, after, {**assets, "alert": None}, has_built_notebook=True)["build"] == ["alert"]
    no_alert = _spec(agent_ns, schedule=dict(VALID["schedule"], cron="0 0 9 ? * FRI"))[0]
    assert agent_ns["implement_plan"](_spec(agent_ns)[0], no_alert, assets, has_built_notebook=True)["refresh"] == []
    cadence = agent_ns["implement_job_cadence"]
    current = types.SimpleNamespace(quartz_cron_expression="0 30 7 * * ?")
    assert cadence({"cron": "", "enabled": True, "timezone": "Asia/Dubai"}, current) == {
        "cron": "0 30 7 * * ?", "timezone": "Asia/Dubai", "enabled": True}
    assert cadence({"cron": "0 0 9 ? * FRI", "enabled": False}, current) == {"cron": "0 0 9 ? * FRI", "timezone": "UTC", "enabled": False}
    assert cadence({"enabled": True}, None) == {"cron": "", "timezone": "UTC", "enabled": False}
    inst = _inspire(agent_ns, FakeSpark())
    updated = []
    job = types.SimpleNamespace(settings=types.SimpleNamespace(schedule=current))
    inst.w_client = types.SimpleNamespace(jobs=types.SimpleNamespace(
        get=lambda job_id: job, update=lambda job_id, new_settings: updated.append(new_settings)))
    inst._implement_schedule("N01-U01", 77, {"cron": "", "enabled": True, "timezone": "Asia/Dubai"})
    assert updated[0].schedule.quartz_cron_expression == "0 30 7 * * ?" and updated[0].schedule.timezone_id == "Asia/Dubai"


def test_the_alert_notifies_when_it_returns_to_ok(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path, {("PATCH", "/api/2.0/alerts/al-1"): {"id": "al-1", "lifecycle_state": "ACTIVE"}})
    inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    inst._implement_alert(dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}), None)
    [(created, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    [(patched, query)] = _calls_to(calls, "PATCH", "/api/2.0/alerts/al-1")
    for body in (created, patched):
        assert body["evaluation"]["notification"] == {"notify_on_ok": True, "retrigger_seconds": 60, "subscriptions": []}
        assert "When it clears: you get one more email when it returns to OK." in body["custom_description"]
    assert "evaluation" in query["update_mask"].split(",") and "schedule" in query["update_mask"].split(",")


def _holding(ns, **holdout):
    context = _output_context(ns)
    if holdout:
        context["spec"] = dict(context["spec"], holdout=holdout)
    return context


def test_a_genie_agent_of_a_use_case_that_holds_records_back_is_told_what_held_back_means(agent_ns, tmp_path):
    import shell_alerts
    for holdout, told in (({"enabled": True, "share": 0.1}, True), ({"enabled": False, "share": 0.1}, False), ({}, False)):
        answers = {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"},
                   ("POST", "/api/2.0/genie/spaces/s9/start-conversation"): {"conversation_id": "c1", "message_id": "m1"},
                   ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1"): {
                       "status": "COMPLETED", "attachments": [{"query": {"query": "SELECT COUNT(*) FROM main.inspire.churn_out"}}]}}
        inst, calls = _output_inspire(agent_ns, tmp_path / str(told) / str(bool(holdout)), answers)
        inst._implement_app_shell = lambda: (None, {"shell_sql": SHELL_SQL, "shell_alerts": shell_alerts})
        inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
        runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}])
        inst._implement_genie_space(_holding(agent_ns, **holdout), runner)
        [(body, _q)] = _calls_to(calls, "POST", "/api/2.0/genie/spaces")
        text = "".join(json.loads(body["serialized_space"])["instructions"]["text_instructions"][0]["content"])
        assert ("comparing the flagged records shown to people (held_back = FALSE) with the records held back (held_back = TRUE)" in text) is told
        assert ("priority_tier 'Held back'" in runner.prompts[0]) is told, "the brief Genie Code writes from says it too"
        assert (SHELL_SQL.HELD_MEANING in text and SHELL_SQL.HELD_MEANING in runner.prompts[0]) is told, holdout


def test_the_held_back_fact_is_written_once_next_to_the_latest_run_fact(agent_ns):
    fact = agent_ns["implement_held_back_fact"](SHELL_SQL)
    space = _rich_space()
    problems = agent_ns["implement_genie_space_grounding"](space, {k.lower(): v for k, v in COLUMNS.items()}, RESULT, [RESULT, ORDERS], (),
                                                           LATEST, fact)
    again = json.loads(json.dumps(space))
    agent_ns["implement_genie_space_grounding"](again, {k.lower(): v for k, v in COLUMNS.items()}, RESULT, [RESULT, ORDERS], (), LATEST, fact)
    text = "".join(again["instructions"]["text_instructions"][0]["content"])
    assert problems == [] and text.count(SHELL_SQL.HELD_MEANING) == 1 and text.endswith(fact)
    assert text.index("The latest run of") < text.index(SHELL_SQL.HELD_MEANING)
    assert not any(ch in fact for ch in "\u2013\u2014")
