import json
import types

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (ALERT, CHURN_UC, LIVE_DENIAL, VALID, _NB_SPEC, _FakeRunner, _FileRunner, _alert_inspire,
                                 _app_flow, _churn_page, _fill, _flow_inspire, _inspire, _output_context, _spec)
from v142_dash_test import _flow as _dash_flow
from v142_dash_test import _runner as _dash_runner

SENTINEL = "ZQV9001QZ"
NUMBER = "70017.125"
DATE = "1911-04-02"
LATER = "1911-04-03"
CAST = (f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"DOUBLE\" because it is malformed. "
        "Correct the value as per the syntax, or change its target type. Use `try_cast` to tolerate malformed input and return NULL "
        "instead. SQLSTATE: 22018")
OVERFLOW = (f"[NUMERIC_VALUE_OUT_OF_RANGE.WITH_SUGGESTION] {NUMBER} cannot be represented as Decimal(4, 2). If necessary set "
            "\"spark.sql.ansi.enabled\" to \"false\" to bypass this error, and return NULL instead. SQLSTATE: 22003")


def _leaks(*texts, extra=()):
    joined = "\n".join(json.dumps(t, default=str) if not isinstance(t, str) else t for t in texts)
    return [token for token in (SENTINEL, NUMBER, DATE, LATER, *extra) if token in joined]


def _raising(message):
    def query(*args, **kwargs):
        raise RuntimeError(message)
    return query


def _texts(inst, *more):
    return [m for _l, m in inst.logger.records] + [json.dumps(e, default=str) for e in inst.emitted] + [str(m) for m in more]


@pytest.mark.parametrize("marker,needle", [("AS y0", "chart "), ("concat_ws", "dataset records failed: ")])
def test_a_dashboard_query_error_reaches_genie_without_the_value_it_quotes(agent_ns, tmp_path, marker, needle):
    inst, context, _seen = _dash_flow(agent_ns, tmp_path)
    real = inst._implement_run_query_check

    def query(sql, require_rows=False, limit=20):
        if marker in sql:
            raise RuntimeError(CAST if marker == "AS y0" else OVERFLOW)
        return real(sql, require_rows, limit)

    inst._implement_run_query_check = query
    runner = _dash_runner(*[_churn_page(agent_ns)] * 3)
    with pytest.raises(RuntimeError) as raised:
        inst._implement_dashboard(context, runner)
    texts = _texts(inst, raised.value, *runner.prompts)
    assert any(needle in t and "a data value" in t for t in texts), [t for t in texts if needle in t][:2]
    assert "Inspire tried to use what you wrote and it failed" in runner.prompts[1]
    assert _leaks(*texts) == []


def test_a_genie_space_check_error_has_no_value(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, FakeSpark())
    monkeypatch.setitem(agent_ns, "implement_genie_space_checks",
                        lambda space, aliases, result_table: [{"label": "example question 1", "sql": "SELECT region FROM main.s.orders"}])
    inst._implement_run_query_check = _raising(CAST)
    problems = inst._implement_genie_space_checks({"data_sources": {"tables": [{"identifier": "main.s.orders"}]}}, ["main.s.orders"],
                                                   "main.inspire.churn_out")
    assert problems == [CAST.replace(f"'{SENTINEL}'", "'a data value'").join(["example question 1 failed: ", ""])]


def test_the_alert_check_of_a_non_boolean_triggered_value_does_not_echo_it(agent_ns, tmp_path):
    inst, _calls, _q = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": SENTINEL}])
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    context = _output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today")
    runner = _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": good}] * 3)
    with pytest.raises(RuntimeError) as raised:
        inst._implement_alert(context, runner)
    assert "whose triggered is a str, not a BOOLEAN" in str(raised.value) and "a data value" not in str(raised.value)
    assert _leaks(*_texts(inst, raised.value, *runner.prompts)) == []


@pytest.mark.parametrize("value,kind", [(None, "whose triggered is NULL"), (1, "whose triggered is a int, not a BOOLEAN")])
def test_a_triggered_that_is_not_boolean_is_named_by_its_type(agent_ns, tmp_path, value, kind):
    inst, _calls, _q = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": value}])
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    runner = _FileRunner([{"exit": 0}] * 3, [{"alert_condition.sql": good}] * 3)
    with pytest.raises(RuntimeError, match=kind):
        inst._implement_alert(_output_context(agent_ns, **ALERT, alert_condition_text="refunds above 10 today"), runner)


def test_the_alert_query_error_has_no_value(agent_ns, tmp_path):
    inst, _calls, _q = _alert_inspire(agent_ns, tmp_path)
    inst._implement_run_query_check = _raising(CAST)
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_alert(_output_context(agent_ns, **ALERT), None)
    assert "the alert query failed on the business output table: [CAST_INVALID_INPUT] The value 'a data value'" in str(raised.value)
    assert _leaks(*_texts(inst, raised.value)) == []


def test_the_records_dataset_error_reaches_genie_without_the_value(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path, _implement_run_query_check=_raising(OVERFLOW))
    assert inst._implement_app(context, None) == {}
    assert seen["errors"] and "dataset records failed: [NUMERIC_VALUE_OUT_OF_RANGE.WITH_SUGGESTION] a data value cannot" in seen["errors"][0]
    assert _leaks(*_texts(inst, *seen["errors"])) == []


def _broken_spark():
    return types.SimpleNamespace(sql=_raising(CAST))


def test_every_read_of_the_run_logs_its_error_without_the_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.spark = _broken_spark()
    use_case, outcome = {"result_table": "main.inspire.churn_out"}, {"run_id": "r-1"}
    assert inst._implement_run_shared_flag("N01-U01", use_case, outcome) == {}
    assert inst._implement_run_stale_flags("N01-U01", use_case, outcome) == {}
    assert inst._implement_run_facts("N01-U01", "main.inspire.churn_out", "r-1") == {}
    assert inst._implement_ai_findings("N01-U01", use_case, outcome)["problems"] == []
    assert inst._implement_run_summary("main.inspire.churn_out", "N01-U01") == {}
    assert inst._implement_tier_warning("N01-U01", "main.inspire.churn_out", "", "r-1") == ""
    inst._implement_tier_counts = lambda table: {"Monitor": 4}
    inst._implement_run_facts = lambda uc, table, run: {}
    assert inst._implement_tier_warning("N01-U01", "main.inspire.churn_out", "", "r-1").startswith("Decision list: no row")
    logged = [m for _l, m in inst.logger.records]
    assert len([m for m in logged if "[CAST_INVALID_INPUT] The value 'a data value'" in m]) >= 8, logged
    assert _leaks(*logged) == []


def test_every_read_behind_genie_and_the_preview_logs_its_error_without_the_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.spark = _broken_spark()
    inst._implement_trains_model = lambda use_case: True
    table, spec_nb = "main.inspire.churn_out", dict(_NB_SPEC, family=sorted(agent_ns["INSPIRE_MODEL_FAMILIES"])[0])
    assert inst._implement_dismissals("N01-U01", table) is None
    assert inst._implement_fallback_warning("N01-U01", table, {"result_table": table}, spec_nb) == ""
    checked = inst._implement_checked_outcome("N01-U01", {"result_table": table}, {"status": "written", "run_id": "r-1", "rows_written": 3})
    inst._implement_drop_undated_rows("N01-U01", table)
    logged = [m for _l, m in inst.logger.records]
    assert checked["status"] == "failed" and "[CAST_INVALID_INPUT] The value 'a data value'" in checked["error"], checked
    assert [tag for tag in ("[IMPLEMENT-FEEDBACK]", "[IMPLEMENT-ACCEPTANCE]", "[IMPLEMENT-KEYS]")
            if not any(m.startswith(tag) and "The value 'a data value'" in m for m in logged)] == [], logged
    assert len([m for m in logged if m.startswith("[IMPLEMENT-KEYS]") and "The value 'a data value'" in m]) == 2, logged
    assert _leaks(checked, *logged) == []


def _preview(agent_ns, waited):
    inst = _inspire(agent_ns, FakeSpark())
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(f)

    class Launcher(agent_ns["JobLauncher"]):
        def launch(self, **kwargs):
            return {"success": True, "job_id": 77, "run_id": 5, "job_url": "u"}

        def wait_for_run(self, run_id, timeout_s=0, poll_s=0, out=None):
            return dict(waited)

    inst._job_launcher_cls = Launcher
    outcome, _job, _run = inst._implement_preview("N01-U01", (5150, "N01-U01", 1), CHURN_UC, _spec(agent_ns)[0],
                                                  {"job_tags": {}, "job_slug": "churn", "schedule_cron": None}, "/W/nb",
                                                  ["result_table", "run_profile"])
    return inst, outcome


@pytest.mark.parametrize("waited,field,expected", [
    ({"status": "FAILED", "error": CAST}, "error", CAST.replace(SENTINEL, "a data value")),
    ({"status": "SUCCESS", "output": f"stopped without writing: region '{SENTINEL}' has 3 closed outcome windows"}, "stop_reason",
     "region 'a data value' has 3 closed outcome windows"),
    ({"status": "SUCCESS", "output": f"finished on '{SENTINEL}'"}, "text", "finished on 'a data value'"),
])
def test_the_preview_run_reaches_the_steps_without_the_value_it_printed(agent_ns, waited, field, expected):
    inst, outcome = _preview(agent_ns, waited)
    assert outcome[field] == expected, outcome
    step = inst.emitted[-1]
    assert step["step_name"] == "Preview run" and step["result_json"][field] == expected, inst.emitted
    assert step["message"] == (expected if field != "text" else "None"), step["message"]
    assert _leaks(outcome, *_texts(inst)) == []


def test_a_preview_denied_a_privilege_keeps_the_names_the_denial_gives(agent_ns):
    _inst, outcome = _preview(agent_ns, {"status": "FAILED", "error": LIVE_DENIAL + f" near '{SENTINEL}'"})
    assert outcome["error"] == LIVE_DENIAL + " near 'a data value'", outcome
    owned = agent_ns["implement_owned_objects"](_spec(agent_ns)[0], [])
    assert agent_ns["implement_privilege_denial"](outcome["error"], owned | {"main.inspire"}).startswith(
        "app-x inspire-ai-implement does not have CREATE MODEL on schema main.inspire")


def test_the_reason_genie_gives_for_a_stop_reaches_the_steps_without_the_value(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    stopped = dict(_fill(), status="stopped", stop_reason=f"History covers 1 closed outcome window for region '{SENTINEL}'")
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {},
                                                                agent_ns["validate_implement_spec"](VALID)[0], None, "/W/nb",
                                                                ["result_table", "run_profile"], _FakeRunner([{"exit": 0, "final": stopped}] * 3),
                                                                True)
    assert {k: outcome[k] for k in ("status", "stop_reason", "stopped_by")} == {
        "status": "stopped", "stop_reason": "History covers 1 closed outcome window for region 'a data value'", "stopped_by": "genie"}
    assert _leaks(outcome, *_texts(inst), agent_ns["implement_stop_message"](outcome, {})) == []


@pytest.mark.parametrize("message", [
    "PERMISSION_DENIED: Principal 'app-x inspire' does not have CREATE TABLE and USE SCHEMA on Schema 'inspire_lakebase.s'",
    "PERMISSION_DENIED: User does not have USE CATALOG on Catalog 'samples'.",
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'MAIN.Inspire.churn_out'.",
])
def test_the_names_a_permission_error_gives_survive_and_a_value_beside_them_does_not(agent_ns, message):
    hide = agent_ns["inspire_redact_text"]
    assert hide(message, set(), "") == message
    assert hide(f"{message} Near '{SENTINEL}'.", set(), "") == f"{message} Near 'a data value'."


def test_a_table_probe_error_is_stored_and_logged_without_a_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.spark = types.SimpleNamespace(sql=_raising(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders` cannot be found, "
                                                    f"near '{SENTINEL}'. SQLSTATE: 42P01"))
    missing = inst._implement_missing_tables(["main.s.orders"])
    assert [m["reason"] for m in missing] and "`main`.`s`.`orders` cannot be found" in missing[0]["error"]
    assert _leaks(*missing, *[m for _l, m in inst.logger.records]) == []


def test_the_notebook_asks_log_a_result_read_error_without_the_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_result_facts = _raising(CAST)
    asks = [{"ask": "Only EMEA rows", "check": [{"kind": "result", "value": {"column": "region", "values": ["EMEA"]}}]}]
    tools = inst._implement_vibes_tools({"result_table": "main.inspire.churn_out", "tools": {}}, asks, {}, "notebook")
    assert "facts" not in tools
    logged = [m for _l, m in inst.logger.records]
    assert any("could not be read for the notebook asks: [CAST_INVALID_INPUT] The value 'a data value'" in m for m in logged), logged
    assert _leaks(*logged) == []


def test_the_weekly_email_warning_has_no_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_app_shell = _raising(CAST)
    before, warning = inst._implement_digest({"uc_id": "N01-U01", "result_table": "main.inspire.churn_out", "asset_status": {}}, "wh1", [])
    assert warning.startswith("Alert: the weekly impact email could not be set up") and "'a data value'" in warning
    assert _leaks(warning) == []


def test_the_preview_gates_send_no_row_value_to_genie(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_ai_findings = lambda uc, use_case, outcome: {"problems": [], "fixable": False}
    inst._implement_run_stale_flags = lambda uc, use_case, outcome: {"n": 3, "ends": DATE, "as_of": LATER}
    inst._implement_run_shared_flag = lambda uc, use_case, outcome: {"n": 5, "flag": SENTINEL}
    inst._implement_run_untested = lambda uc, use_case, outcome: False
    gates = inst._implement_preview_gates("N01-U01", {"result_table": "main.inspire.churn_out"}, {"run_id": "r-1"}, None)
    assert [g["kind"] for g in gates] == ["notebook", "notebook"]
    texts = [json.dumps(g) for g in gates]
    assert "a data_quality_flag that starts with data ends and is dated on or after the as_of_date of its row" in texts[0]
    assert "carry the same data_quality_flag other than 'ok'" in texts[1]
    assert _leaks(*texts) == [] and "a data value" not in "".join(texts)


def test_the_tier_warning_carries_no_value_the_run_wrote(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_tier_counts = lambda table: {"Monitor": 7200}
    inst._implement_run_facts = lambda uc, table, run: {}
    inst._implement_latest_run_profile = lambda table: {"rows": 7200, "valued": 7200, "distinct": 412, "span": 0.415, "flagged": 30,
                                                         "flag_kinds": 1}
    inst._implement_latest_run_methods = lambda table: {"methods": [("ZQVMETHODQZ items", 7200)], "versioned_rows": 0}
    warning = inst._implement_tier_warning("N01-U01", "main.inspire.churn_out", "https://h/r/9", "r-1")
    number = agent_ns["implement_number_text"]
    assert warning.startswith("Decision list: no row of the latest run reached Act now or Review (7,200 Monitor)"), warning
    assert "run: https://h/r/9" in warning and "every row comes from one method in column method" in warning
    assert "a data value" not in warning
    assert _leaks(warning, *[m for _l, m in inst.logger.records],
                  extra=("ZQVTYPEQZ", "ZQVFLAGQZ", "ZQVMETHODQZ", number(70017.125), number(80017.5), "80017.5")) == [], warning


@pytest.mark.parametrize("facts,reached", [
    ({"nothing_to_act": f"no item lost more than {SENTINEL} this week"}, "the reason the run wrote in nothing_to_act"),
    ({"not_reliable": f"the model saw only {SENTINEL}"}, "wrote why in not_reliable of"),
])
def test_the_run_reason_is_not_echoed_into_the_steps(agent_ns, facts, reached):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_tier_counts = lambda table: {"Monitor": 4}
    inst._implement_run_facts = lambda uc, table, run: dict({"nothing_to_act": "", "not_reliable": ""}, **facts)
    warning = inst._implement_tier_warning("N01-U01", "main.inspire.churn_out", "", "r-1")
    texts = _texts(inst, warning)
    assert any(reached in t for t in texts) and not any("a data value" in t for t in texts), texts
    assert _leaks(*texts) == []


def test_the_result_gate_keeps_the_values_the_ask_names_and_hides_the_rest(agent_ns):
    held = {"exists": True, "rows": 10, "non_null": 10, "distinct": 3, "low": "APAC", "high": SENTINEL, "values": ["APAC", "EMEA", SENTINEL]}
    ok, evidence = agent_ns["implement_result_gate"]({"column": "region", "values": ["EMEA"]}, {"region": held}, "notebook")
    assert ok is True and evidence == "column region: 10 rows in the latest run, 10 not empty, 3 distinct"
    assert "APAC" not in evidence and _leaks(evidence) == []
    ok, evidence = agent_ns["implement_result_gate"]({"column": "region", "values": ["LATAM"]}, {"region": held}, "notebook")
    assert ok is False and evidence.endswith(": it never holds LATAM") and _leaks(evidence) == []


def test_the_ai_step_error_the_run_recorded_has_no_value(agent_ns):
    problems = agent_ns["implement_ai_check_problems"]({"error": f"ai_query failed on the facts '{SENTINEL}' of a record"}, "a summary")
    assert problems == ["the AI step of the run failed: ai_query failed on the facts 'a data value' of a record"]


V = "9017.75"
SPARK_ERRORS = {
    "CAST_INVALID_INPUT": (CAST, "The value 'a data value' of the type \"STRING\" cannot be cast to \"DOUBLE\""),
    "CAST_OVERFLOW": (f"[CAST_OVERFLOW] The value {V}D of the type \"DOUBLE\" cannot be cast to \"INT\" due to an overflow. Use `try_cast` "
                      "to tolerate overflow and return NULL instead. If necessary set \"spark.sql.ansi.enabled\" to \"false\" to bypass this "
                      "error. SQLSTATE: 22003", "The value a data value of the type \"DOUBLE\" cannot be cast to \"INT\""),
    "NUMERIC_VALUE_OUT_OF_RANGE.WITH_SUGGESTION": (OVERFLOW, "] a data value cannot be represented as Decimal(4, 2). If necessary set "
                                                             "\"spark.sql.ansi.enabled\" to \"false\""),
    "NUMERIC_VALUE_OUT_OF_RANGE.WITHOUT_SUGGESTION": (
        f"[NUMERIC_VALUE_OUT_OF_RANGE.WITHOUT_SUGGESTION] The {V} rounded half up from {NUMBER} cannot be represented as Decimal(4, 2). "
        "SQLSTATE: 22003", "The a data value rounded half up from a data value cannot be represented as Decimal(4, 2)"),
    "BINARY_ARITHMETIC_OVERFLOW": (f"[BINARY_ARITHMETIC_OVERFLOW] {V}S + {NUMBER}S caused overflow. Use `try_add` to ignore overflow "
                                   "problem and return NULL. SQLSTATE: 22003", "] a data value + a data value caused overflow"),
    "NUMERIC_OUT_OF_SUPPORTED_RANGE": (f"[NUMERIC_OUT_OF_SUPPORTED_RANGE] The value {'9' * 39}{V} cannot be interpreted as a numeric since "
                                       "it has more than 38 digits. SQLSTATE: 22003",
                                       "The value a data value cannot be interpreted as a numeric"),
    "INVALID_ARRAY_INDEX": (f"[INVALID_ARRAY_INDEX] The index {V} is out of bounds. The array has 3 elements. Use the SQL function "
                            "`get()` to tolerate accessing element at invalid index and return NULL instead. SQLSTATE: 22003",
                            "The index a data value is out of bounds. The array has 3 elements."),
    "INVALID_ARRAY_INDEX_IN_ELEMENT_AT": (f"[INVALID_ARRAY_INDEX_IN_ELEMENT_AT] The index {V} is out of bounds. The array has 3 elements. "
                                          "Use `try_element_at` to tolerate accessing element at invalid index and return NULL instead.",
                                          "The index a data value is out of bounds."),
    "INVALID_FRACTION_OF_SECOND": (f"[INVALID_FRACTION_OF_SECOND] Valid range for seconds is [0, 60] (inclusive), but the provided value is "
                                   f"{V}. To avoid this error, use `try_make_timestamp`, which returns NULL on error.",
                                   "but the provided value is a data value. To avoid this error"),
    "INVALID_URL": (f"[INVALID_URL] The url is invalid: https://{SENTINEL}.example/a?b={V}. Use `try_parse_url` to tolerate invalid URL "
                    "and return NULL instead. SQLSTATE: 22P02", "The url is invalid: a data value. Use `try_parse_url`"),
    "CONVERSION_INVALID_INPUT": (f"[CONVERSION_INVALID_INPUT] The value '{SENTINEL}' (yyyy-MM-dd) cannot be converted to \"DATE\" because it "
                                 "is malformed. SQLSTATE: 22018", "The value 'a data value' (yyyy-MM-dd) cannot be converted to \"DATE\""),
    "CANNOT_DECODE_URL": (f"[CANNOT_DECODE_URL] The provided URL cannot be decoded: https://{SENTINEL}%zz. Please ensure that the URL is "
                          "properly formatted and try again. SQLSTATE: 22546", "The provided URL cannot be decoded: a data value. Please"),
    "CANNOT_PARSE_INTERVAL": (f"[CANNOT_PARSE_INTERVAL] Unable to parse {SENTINEL} 3 dayz. Please ensure that the value provided is in a valid "
                              "format for defining an interval. SQLSTATE: 22006", "Unable to parse a data value. Please ensure"),
    "CANNOT_PARSE_JSON_FIELD": (f"[CANNOT_PARSE_JSON_FIELD] Cannot parse the field name {SENTINEL} and the value {V} of the JSON token type "
                                "VALUE_NUMBER_FLOAT to target Spark data type \"INT\". SQLSTATE: 2203G",
                                "Cannot parse the field name a data value and the value a data value of the JSON token type"),
    "CANNOT_PARSE_TIME": (f"[CANNOT_PARSE_TIME] The input string {SENTINEL} cannot be parsed to a TIME value because it does not match to "
                          "the datetime format HH:mm. SQLSTATE: 22010", "The input string a data value cannot be parsed to a TIME value"),
    "COMPARATOR_RETURNS_NULL": (f"[COMPARATOR_RETURNS_NULL] The comparator has returned a NULL for a comparison between {SENTINEL} and {V}. "
                                "It should return a positive integer. SQLSTATE: 22004",
                                "for a comparison between a data value and a data value. It should return"),
    "FAILED_PARSE_STRUCT_TYPE": (f"[FAILED_PARSE_STRUCT_TYPE] Failed parsing struct: {SENTINEL}<x. SQLSTATE: 22018",
                                 "Failed parsing struct: a data value. SQLSTATE"),
    "FAILED_ROW_TO_JSON": (f"[FAILED_ROW_TO_JSON] Failed to convert the row value {SENTINEL} of the class java.lang.String to the target SQL "
                           "type \"INT\" in the JSON format. SQLSTATE: 2203G", "Failed to convert the row value a data value of the class"),
    "ILLEGAL_DAY_OF_WEEK": (f"[ILLEGAL_DAY_OF_WEEK] Illegal input for day of week: {SENTINEL}. SQLSTATE: 22009",
                            "Illegal input for day of week: a data value. SQLSTATE"),
    "INVALID_BOUNDARY": (f"[INVALID_BOUNDARY] The boundary start is invalid: {V}. SQLSTATE: 22003", "The boundary start is invalid: a data value."),
    "INVALID_INTERVAL_FORMAT.INVALID_VALUE": (
        f"[INVALID_INTERVAL_FORMAT.INVALID_VALUE] Error parsing '{SENTINEL}' to interval. Please ensure that the value provided is in a "
        f"valid format for defining an interval. You can reference the documentation for the correct format. Invalid value {V}. "
        "SQLSTATE: 22006", "Invalid value a data value. SQLSTATE"),
    "INVALID_INTERVAL_FORMAT.ARITHMETIC_EXCEPTION": (
        f"[INVALID_INTERVAL_FORMAT.ARITHMETIC_EXCEPTION] Error parsing '{SENTINEL}' to interval. Uncaught arithmetic exception while "
        f"parsing '{SENTINEL}'. SQLSTATE: 22006", "Uncaught arithmetic exception while parsing 'a data value'"),
    "INVALID_INTERVAL_FORMAT.INVALID_PRECISION": (
        f"[INVALID_INTERVAL_FORMAT.INVALID_PRECISION] Error parsing '{SENTINEL}' to interval. Interval can only support nanosecond "
        f"precision, {V} is out of range. SQLSTATE: 22006", "Interval can only support nanosecond precision, a data value is out of range"),
    "INVALID_INTERVAL_FORMAT.UNMATCHED_FORMAT_STRING": (
        f"[INVALID_INTERVAL_FORMAT.UNMATCHED_FORMAT_STRING] Error parsing '{SENTINEL}' to interval. Interval string does not match "
        f"day-time format of `[+|-]d h` when cast to interval day to hour: {SENTINEL}. SQLSTATE: 22006",
        "when cast to interval day to hour: a data value."),
    "INVALID_INTERVAL_FORMAT.UNSUPPORTED_FROM_TO_EXPRESSION": (
        f"[INVALID_INTERVAL_FORMAT.UNSUPPORTED_FROM_TO_EXPRESSION] Error parsing '{SENTINEL}' to interval. Cannot support (interval "
        f"'{SENTINEL}' day to hour) expression. SQLSTATE: 22006", "Cannot support (interval 'a data value' day to hour) expression"),
    "INVALID_JSON_FORMAT_JSON_VALUE": (f"[INVALID_JSON_FORMAT_JSON_VALUE] json_query FORMAT JSON argument at position 1 must contain exactly one "
                                       f"well-formed JSON value, but got {SENTINEL}. SQLSTATE: 22023",
                                       "must contain exactly one well-formed JSON value, but got a data value."),
    "INVALID_PARAMETER_VALUE.BOOLEAN": (f"[INVALID_PARAMETER_VALUE.BOOLEAN] The value of parameter(s) `x` in `f` is invalid: expects a boolean "
                                        f"literal, but got {SENTINEL}. SQLSTATE: 22023", "expects a boolean literal, but got a data value."),
    "INVALID_PARAMETER_VALUE.INTEGER": (f"[INVALID_PARAMETER_VALUE.INTEGER] The value of parameter(s) `x` in `f` is invalid: expects an integer "
                                        f"literal, but got {V}. SQLSTATE: 22023", "expects an integer literal, but got a data value."),
    "INVALID_PARAMETER_VALUE.DATETIME_UNIT": (f"[INVALID_PARAMETER_VALUE.DATETIME_UNIT] The value of parameter(s) `unit` in `f` is invalid: "
                                              f"expects one of the units without quotes YEAR, DAY, but got the string literal {SENTINEL}. "
                                              "SQLSTATE: 22023", "but got the string literal a data value."),
    "INVALID_REGEXP_REPLACE": (f"[INVALID_REGEXP_REPLACE] Could not perform regexp_replace for source = \"{SENTINEL} text\", pattern = "
                               "\"x\", replacement = \"y\" and position = 1. SQLSTATE: 22023",
                               "Could not perform regexp_replace for source = \"a data value\""),
    "INVALID_TIMEZONE": (f"[INVALID_TIMEZONE] The timezone: {SENTINEL}/Nowhere is invalid. The timezone must be either a region-based zone "
                         "ID or a zone offset. SQLSTATE: 22009", "The timezone: a data value is invalid"),
    "INVALID_TIME_TRAVEL_TIMESTAMP_FORMAT": (f"[INVALID_TIME_TRAVEL_TIMESTAMP_FORMAT] The provided timestamp {SENTINEL} doesn't match the "
                                             "expected syntax yyyy-MM-dd. SQLSTATE: 22000",
                                             "The provided timestamp a data value doesn't match the expected syntax"),
    "INVALID_UTF8_STRING": (f"[INVALID_UTF8_STRING] Invalid UTF8 byte sequence found in string: {SENTINEL}. SQLSTATE: 22029",
                            "Invalid UTF8 byte sequence found in string: a data value. SQLSTATE"),
    "INVALID_VARIANT_CAST": (f"[INVALID_VARIANT_CAST] The variant value `{SENTINEL}` cannot be cast into `INT`. Please use `try_variant_get` "
                             "instead. SQLSTATE: 22023", "The variant value `a data value` cannot be cast into `INT`"),
    "MALFORMED_RECORD_IN_PARSING": (f"[MALFORMED_RECORD_IN_PARSING] Malformed records are detected in record parsing: [{SENTINEL},{V}]. Parse "
                                    "Mode: FAILFAST. SQLSTATE: 22023", "Malformed records are detected in record parsing: a data value. Parse Mode:"),
    "MALFORMED_RECORD_IN_PARSING.CANNOT_PARSE_STRING_AS_DATATYPE": (
        f"[MALFORMED_RECORD_IN_PARSING.CANNOT_PARSE_STRING_AS_DATATYPE] Malformed records are detected in record parsing: [{SENTINEL}]. "
        f"Parse Mode: FAILFAST. Cannot parse the value {SENTINEL} of the field {V} as target spark data type \"INT\" from the input type "
        "\"STRING\". SQLSTATE: 22023", "Cannot parse the value a data value of the field a data value as target spark data type"),
}


@pytest.mark.parametrize("error_class", sorted(SPARK_ERRORS))
def test_a_spark_error_that_names_a_value_without_quotes_loses_only_the_value(agent_ns, error_class):
    message, kept = SPARK_ERRORS[error_class]
    hidden = agent_ns["inspire_redact_text"](f"chart by_category failed: {message}", set(), "SELECT category, SUM(loss) FROM t")
    assert f"[{error_class}]" in hidden and kept in hidden, hidden
    assert _leaks(hidden, extra=(V,)) == []


def test_every_documented_template_hides_a_value_put_in_its_slots(agent_ns):
    templates = agent_ns["INSPIRE_SPARK_VALUE_TEMPLATES"]
    assert len(templates) >= 40
    for classes, fragment in templates:
        text = fragment.replace("<v>", f"{SENTINEL} {V}").replace("<w>", V).replace("<t>", "+").replace("<_>", "x").replace(
            "<r>", f"\"{{\"reason\": \"{SENTINEL}; {V}\"}}\"")
        hidden = agent_ns["inspire_redact_text"](f"chart c failed: [{classes.split(',')[0]}] {text} SQLSTATE: 22000", set(), "")
        assert _leaks(hidden, extra=(V,)) == [], (classes, hidden)


@pytest.mark.parametrize("message", [
    "[DATETIME_FIELD_OUT_OF_BOUNDS.WITHOUT_SUGGESTION] Invalid value for MonthOfYear (valid values 1 - 12): 13. SQLSTATE: 22023",
    "[DATETIME_OVERFLOW] Datetime operation overflow: add 1000000 YEAR to TIMESTAMP '2020-01-01 00:00:00'. SQLSTATE: 22008",
])
def test_a_spark_error_whose_text_is_written_in_code_keeps_only_what_no_template_marks(agent_ns, message):
    hidden = agent_ns["inspire_redact_text"](message, set(), "")
    assert hidden.split(":")[0] == message.split(":")[0] and "2020-01-01" not in hidden


@pytest.mark.parametrize("message", [
    "[DIVIDE_BY_ZERO] Division by zero. Use `try_divide` to tolerate divisor being 0 and return NULL instead. If necessary set "
    "\"spark.sql.ansi.enabled\" to \"false\" to bypass this error. SQLSTATE: 22012",
    "[ARITHMETIC_OVERFLOW] integer overflow. If necessary set \"spark.sql.ansi.enabled\" to \"false\" to bypass this error. SQLSTATE: 22003",
    "[INTERVAL_DIVIDED_BY_ZERO] Division by zero. Use `try_divide` to tolerate divisor being 0 and return NULL instead. SQLSTATE: 22012",
])
def test_a_spark_error_that_names_no_value_is_kept_as_it_is(agent_ns, message):
    assert agent_ns["inspire_redact_text"](message, set(), "") == message


@pytest.mark.parametrize("message", [
    "[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `regin` cannot be resolved. Did you mean one "
    "of the following? [`region`, `revenue`]. SQLSTATE: 42703",
    "[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders` cannot be found. SQLSTATE: 42P01",
    "[PARSE_SYNTAX_ERROR] Syntax error at or near 'GROUP'. SQLSTATE: 42601",
    "[CAST_INVALID_INPUT] The value 'refund' of the type \"STRING\" cannot be cast to \"INT\" because it is malformed.",
    "the table 'main.s.orders' has no column 'region'",
])
def test_the_names_the_asset_definition_uses_survive(agent_ns, message):
    definition = json.dumps({"datasets": [{"sql": "SELECT region, revenue FROM main.s.orders WHERE status = 'refund' GROUP BY region"}]})
    assert agent_ns["inspire_redact_text"](message, set(), definition) == message


def test_a_dashboard_error_keeps_the_column_names_of_the_page(agent_ns, tmp_path):
    inst, context, _seen = _dash_flow(agent_ns, tmp_path)
    message = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `loss_amt` cannot be resolved. "
               "Did you mean one of the following? [`loss`, `revenue`]. SQLSTATE: 42703")
    inst._implement_run_query_check = _raising(message)
    runner = _dash_runner(*[_churn_page(agent_ns)] * 3)
    with pytest.raises(RuntimeError) as raised:
        inst._implement_dashboard(context, runner)
    assert message in runner.prompts[1] and message in str(raised.value)
