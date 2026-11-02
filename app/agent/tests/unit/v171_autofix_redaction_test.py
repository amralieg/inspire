import os

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

SENTINEL = "ZQV9101QZ"
TOKEN = "dapi" + "cd" * 16
HOST = "adb-zqv.example.net"
EMAIL = "ana.lopez@example.com"
SECRETS = f" while calling https://{HOST}/api/2.0/serving-endpoints for {EMAIL} with {TOKEN}"
WRITTEN = "SELECT customer_id, churn_score, churn_band, segment, revenue, units FROM main.retention.scores"
SPARK = {
    "UNRESOLVED_COLUMN": (
        "[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `churn_scor` cannot be resolved. Did "
        "you mean one of the following? [`churn_score`, `churn_band`, `customer_id`]. SQLSTATE: 42703; line 3 pos 11;\n"
        "'Project ['churn_scor]\n+- SubqueryAlias spark_catalog.main.retention\n   +- Relation main.retention[customer_id#12] parquet\n",
        ["[UNRESOLVED_COLUMN.WITH_SUGGESTION]", "with name `churn_scor` cannot be resolved",
         "Did you mean one of the following? [`churn_score`, `churn_band`, `customer_id`]", "SQLSTATE: 42703; line 3 pos 11"], []),
    "CAST_INVALID_INPUT": (
        f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"INT\" because it is malformed. Correct "
        "the value as per the syntax, or change its target type. Use `try_cast` to tolerate malformed input and return NULL instead. "
        "SQLSTATE: 22018\n== SQL (line 2, position 8) ==\nSELECT CAST(segment AS INT) AS seg FROM main.retention.scores\n"
        "       ^^^^^^^^^^^^^^^^^^^^\n",
        ["[CAST_INVALID_INPUT] The value 'a data value' of the type \"STRING\" cannot be cast to \"INT\"", "`try_cast`",
         "== SQL (line 2, position 8) ==", "CAST(segment AS INT)"], [SENTINEL]),
    "DIVIDE_BY_ZERO": (
        "[DIVIDE_BY_ZERO] Division by zero. Use `try_divide` to tolerate divisor being 0 and return NULL instead. If necessary set "
        "\"spark.sql.ansi.enabled\" to \"false\" to bypass this error. SQLSTATE: 22012\n== SQL (line 4, position 15) ==\n"
        f"SELECT revenue / units FROM main.retention.scores WHERE customer_name = '{SENTINEL}'\n               ^^^^^^^^^^^^^^^\n",
        ["[DIVIDE_BY_ZERO] Division by zero.", "`try_divide`", "\"spark.sql.ansi.enabled\" to \"false\"", "== SQL (line 4, position 15) ==",
         "SELECT revenue / units FROM main.retention.scores WHERE customer_name = 'a data value'"], [SENTINEL]),
    "AI_FUNCTION_HTTP_PARSE_CAST_ERROR": (
        "[AI_FUNCTION_HTTP_PARSE_CAST_ERROR] Failed to parse model output when casting to the specified returnType: "
        f"\"STRUCT<reason: STRING>\", response JSON was: \"{{\"reason\": \"{SENTINEL} asked for a refund twice; then left\"}}\". Please "
        "update the returnType to match the contents of the type represented by the response JSON and then retry the query again. "
        "Exception: Cannot parse the response. SQLSTATE: 2203G",
        ["[AI_FUNCTION_HTTP_PARSE_CAST_ERROR]", "returnType: \"STRUCT<reason: STRING>\"", "response JSON was: \"a data value\". Please update",
         "Exception: Cannot parse the response"], [SENTINEL, "refund twice", "then left"]),
    "AI_INVALID_ARGUMENT_VALUE_ERROR": (
        f"[AI_INVALID_ARGUMENT_VALUE_ERROR] Provided value \"{SENTINEL} Lopez\" is not supported by argument \"labels\". Supported values "
        "are: churn, stay SQLSTATE: 22032",
        ["[AI_INVALID_ARGUMENT_VALUE_ERROR] Provided value \"a data value\" is not supported by argument \"labels\""], [SENTINEL]),
    "DELTA_EXCEED_CHAR_VARCHAR_LIMIT": (
        f"[DELTA_EXCEED_CHAR_VARCHAR_LIMIT] Value \"{SENTINEL} Lopez\" exceeds char/varchar type length limitation. Failed check: "
        "(length(customer_name) <= 10). SQLSTATE: 22001",
        ["[DELTA_EXCEED_CHAR_VARCHAR_LIMIT] Value \"a data value\" exceeds char/varchar type length limitation",
         "Failed check: (length(customer_name) <= 10)"], [SENTINEL]),
    "METRIC_STORE_INVALID_ARGUMENT_VALUE_ERROR": (
        f"[METRIC_STORE_INVALID_ARGUMENT_VALUE_ERROR] Provided value \"{SENTINEL}\" is not supported by argument \"window\" for the "
        "`METRIC_STORE` table function. SQLSTATE: 22023",
        ["Provided value \"a data value\" is not supported by argument \"window\" for the `METRIC_STORE` table function"], [SENTINEL]),
    "DATATYPE_MISMATCH": (
        "[DATATYPE_MISMATCH.BINARY_OP_DIFF_TYPES] Cannot resolve \"(revenue + segment)\" due to data type mismatch: the left and right "
        f"operands of the binary operator have incompatible types (\"DOUBLE\" and \"STRING\"). SQLSTATE: 42K09; line 1 pos 7",
        ["Cannot resolve \"(revenue + segment)\" due to data type mismatch", "(\"DOUBLE\" and \"STRING\")", "line 1 pos 7"], []),
    "DATATYPE_MISMATCH_WITH_A_LITERAL": (
        f"[DATATYPE_MISMATCH.BINARY_OP_DIFF_TYPES] Cannot resolve \"(revenue + '{SENTINEL}')\" due to data type mismatch: the left and "
        "right operands of the binary operator have incompatible types (\"DOUBLE\" and \"STRING\"). SQLSTATE: 42K09; line 1 pos 7",
        ["Cannot resolve \"(revenue + 'a data value')\" due to data type mismatch"], [SENTINEL]),
    "PARSE_SYNTAX_ERROR": (
        "[PARSE_SYNTAX_ERROR] Syntax error at or near 'GROUP'. SQLSTATE: 42601 (line 3, pos 2)\n\n== SQL ==\nSELECT x\nFROM t\nGROUP\n",
        ["[PARSE_SYNTAX_ERROR] Syntax error at or near 'GROUP'", "(line 3, pos 2)"], []),
}


def _checked(text, kept, hidden):
    for part in kept:
        assert part in text, (part, text)
    assert [s for s in hidden + [SENTINEL, TOKEN, HOST, EMAIL] if s in text] == [], text


class _Writer:
    def __init__(self, written):
        self.written, self.prompts = written, []

    def run(self, prompt, work, schema, label=None):
        self.prompts.append(prompt)
        os.makedirs(work, exist_ok=True)
        with open(os.path.join(work, "alert_condition.sql"), "w", encoding="utf-8") as handle:
            handle.write(self.written)
        return {}


@pytest.mark.parametrize("case", sorted(SPARK))
def test_genie_is_sent_the_class_names_suggestions_and_position_it_needs_and_no_value(agent_ns, tmp_path, case):
    message, kept, hidden = SPARK[case]
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    runner, calls = _Writer(WRITTEN), []

    def deploy(work):
        calls.append(work)
        if len(calls) == 1:
            raise RuntimeError(message + SECRETS)
        return {"alert_id": "a1"}

    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3)}
    assert inst._implement_genie_loop(context, runner, "Alert", "Build the weekly alert.", deploy) == {"alert_id": "a1"}
    feedback = runner.prompts[1].split("Inspire tried to use what you wrote and it failed: ", 1)[1]
    _checked(feedback, kept, hidden)
    shown = [str(item.get("message")) for item in inst.emitted if "sent back to Genie" in str(item.get("message"))]
    assert len(shown) == 1
    _checked(shown[0], kept[:1], hidden)


@pytest.mark.parametrize("case", sorted(SPARK))
def test_the_repair_model_reads_the_class_and_names_and_no_value(agent_ns, case):
    message, kept, hidden = SPARK[case]
    inst = _inspire(agent_ns, FakeSpark())
    failure = inst._implement_failure_message(RuntimeError(message + SECRETS), WRITTEN)
    prompt = agent_ns["implement_repair_prompt"]("the notebook build", failure, 1, [], list(agent_ns["IMPLEMENT_REPAIRS"]))
    _checked(prompt, kept, hidden)
