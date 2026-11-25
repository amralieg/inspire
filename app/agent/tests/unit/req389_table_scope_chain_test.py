"""REQ-389 (third reopen): the Table Scope the person chose on the Data step is the scope the build reads, end to end in the notebook.
A walked build chose Whole data: the job parameter 17_table_scope carried the whole-data scope and the readiness count was
the whole table (3,333 rows). But the notebook's spec normaliser dropped spec.data.table_scope, and the Discover run's Table Scope
line, stored in the session's generation-instruction section, was replayed verbatim into the Databricks AI prompt. The generated
notebook then said it covered only the visa and amex rows. These tests fail before the change and pass after it."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v140_implement_test import VALID  # noqa: E402

TABLE = "cat.sch.orders"
SESSION_VISA = {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}}
WHOLE = {TABLE: {"columns": ["id", "paymentMethod"], "rows": []}}
HEADER = "### NON-NEGOTIABLE GENERATION INSTRUCTIONS (MUST FOLLOW STRICTLY)"


class _Frame:
    def __init__(self, log):
        self.log = log

    def where(self, predicate):
        self.log.append(("where", predicate))
        return self

    def select(self, *columns):
        self.log.append(("select", columns))
        return self


class _Session:
    def __init__(self):
        self.log = []

    def table(self, name):
        self.log.append(("table", name))
        return _Frame(self.log)


def _set_session_scope(ns, scopes):
    ns["INSPIRE_TABLE_SCOPES"].clear()
    ns["INSPIRE_TABLE_SCOPES"].update(ns["parse_table_scopes"](json.dumps(scopes), ""))


def _spec_with_scope(ns, table_scope):
    spec = json.loads(json.dumps(VALID))
    spec["data"] = dict(spec["data"], tables={}, filters=[], table_scope=table_scope)
    out, errors = ns["validate_implement_spec"](spec)
    assert errors == [], errors
    return out["data"]


def test_the_validated_spec_keeps_the_table_scope_the_data_step_chose(agent_ns):
    data = _spec_with_scope(agent_ns, WHOLE)
    assert data["table_scope"] == WHOLE


def test_a_table_scope_that_is_not_an_object_is_refused_not_dropped(agent_ns):
    spec = json.loads(json.dumps(VALID))
    spec["data"] = dict(spec["data"], table_scope=["not", "an", "object"])
    _, errors = agent_ns["validate_implement_spec"](spec)
    assert any("table scope must be an object" in e for e in errors), errors


def test_a_whole_data_choice_drops_the_discover_row_filter_from_the_scope_text_and_the_reads(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, SESSION_VISA)
    data = _spec_with_scope(ns, {})
    ns["apply_chosen_table_scope"](data, "")
    assert ns["implement_table_scopes"](data, [TABLE]) == {}, "the scope text names no row filter"
    assert ns["table_scope_directive_lines"]() == [], "the instruction carries no scope line"
    session = _Session()
    ns["inspire_read_source"](TABLE, session)
    assert not [entry for entry in session.log if entry[0] == "where"], session.log
    assert "WHERE" not in ns["inspire_scoped_read_source"](TABLE)


def test_a_chosen_whole_scope_replaces_the_session_scope_and_keeps_its_columns_without_rows(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, SESSION_VISA)
    data = _spec_with_scope(ns, WHOLE)
    ns["apply_chosen_table_scope"](data, "")
    scope = ns["implement_table_scopes"](data, [TABLE])[TABLE.lower()]
    assert scope["columns"] == ["id", "paymentMethod"] and scope["rows"] == []


def test_a_chosen_filter_replaces_the_session_scope_and_its_reads_keep_the_chosen_rows(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, WHOLE)
    chosen = {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "=", "values": ["amex"]}]}}
    data = _spec_with_scope(ns, chosen)
    ns["apply_chosen_table_scope"](data, "")
    assert ns["scope_where_sql"]([{"column": "paymentMethod", "op": "=", "values": ["amex"]}]) == "`paymentMethod` = 'amex'"
    assert ns["implement_table_scopes"](data, [TABLE])[TABLE.lower()]["rows"] == [{"column": "paymentMethod", "op": "=", "values": ["amex"]}]


def test_a_build_with_no_data_step_choice_keeps_the_discover_scope(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, SESSION_VISA)
    ns["apply_chosen_table_scope"]({"filters": []}, "")
    assert ns["INSPIRE_TABLE_SCOPES"][TABLE.lower()]["rows"][0]["values"] == ["visa", "amex"]


def test_a_saved_generation_section_is_read_with_the_scope_in_force_now(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, WHOLE)
    saved = "\n".join([HEADER, "", "The following instructions were provided by the user.", "", "Keep the goal in view.",
                       "", "**Structured user directives (parsed from the user's Generation Instructions):**",
                       f"- TABLE SCOPE of `{TABLE}`: Inspire reads only the columns `id`, `paymentMethod`, and only the rows where "
                       "`paymentMethod` in visa or amex. Every use case that uses this table MUST say so.",
                       "- GOAL: find the repeat buyers"])
    inst = build_inspire(ns, quality="Good")
    inst.parsed_generation_instructions = {"per_prompt_instructions": {"GENIE": saved}}
    text = inst._get_generation_instruction_for_prompt("GENIE")
    assert "visa or amex" not in text, text
    assert f"- TABLE SCOPE of `{TABLE}`: Inspire reads only the columns `id`, `paymentMethod`, and every row" in text
    assert "- GOAL: find the repeat buyers" in text and "Keep the goal in view." in text


def test_a_saved_section_with_no_scope_line_gets_the_current_scope_under_the_directives_heading(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, WHOLE)
    saved = "\n".join([HEADER, "", "Keep the goal in view.", "", "**Structured user directives (parsed from the user's Generation Instructions):**",
                       "- GOAL: find the repeat buyers"])
    text = ns["with_current_table_scope"](saved)
    lines = text.split("\n")
    heading = lines.index("**Structured user directives (parsed from the user's Generation Instructions):**")
    assert lines[heading + 1].startswith(f"- TABLE SCOPE of `{TABLE}`"), lines
    assert "- GOAL: find the repeat buyers" in lines


def test_a_scope_line_in_the_raw_generation_instructions_is_taken_out_and_the_user_text_kept(agent_ns):
    raw = "\n".join(["- GOAL: find the repeat buyers", f"- TABLE SCOPE of `{TABLE}`: Inspire reads only the rows where `x` in a or b.",
                      "- USE CASE LABEL (the user ticked Use case labeling enhanced using filters): every use case carries \"Promo\"."])
    assert agent_ns["without_table_scope_directives"](raw) == "- GOAL: find the repeat buyers"


def test_the_discover_scope_sentence_is_taken_out_of_the_saved_statement_and_the_build_sentence_takes_its_place(fresh_ns):
    ns = fresh_ns
    _set_session_scope(ns, WHOLE)
    saved = f"Find the repeat buyers. Covers only the columns `id`, `paymentMethod` and the rows where `paymentMethod` in visa or amex of {TABLE}."
    statement = ns["without_scope_sentences"](saved)
    assert statement == "Find the repeat buyers.", statement
    use_case = {"Statement": statement, "Primary Table": TABLE}
    ns["ensure_scope_statements"]([use_case])
    assert use_case["Statement"] == f"Find the repeat buyers. Covers only the columns `id`, `paymentMethod` of {TABLE}."


def test_a_statement_without_a_scope_sentence_is_kept_as_written(agent_ns):
    text = "Find the repeat buyers. Track the share of visa payments over time."
    assert agent_ns["without_scope_sentences"](text) == text
