import ast
import hashlib
import json
import os

import pytest

from _agentload import agent_source

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "implement_grouping_sql_cases.json")
with open(FIXTURE, encoding="utf-8") as _fh:
    CASES = json.load(_fh)["cases"]
CONTRACT_KEYWORDS = ("INSERT UPDATE DELETE MERGE DROP CREATE ALTER TRUNCATE REPLACE GRANT REVOKE COPY REFRESH OPTIMIZE VACUUM CALL EXECUTE EXEC SET "
                     "RESET USE MSCK REPAIR CACHE UNCACHE ANALYZE LOAD PUT GET REMOVE LIST DECLARE BEGIN COMMIT ROLLBACK").split()
CONTRACT_FUNCTIONS = ("secret try_secret http_request ai_query vector_search read_files read_kafka read_kinesis read_pubsub read_pulsar read_statestore "
                      "remote_query java_method reflect identifier").split()
RULES = {"character", "empty", "first_keyword", "function", "keyword", "number", "parameter", "parentheses", "script", "statements", "substitution",
         "table_function", "table_name", "too_long", "unterminated"}


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_the_agent_gives_every_shared_grouping_sql_case_the_verdict_the_app_gives(agent_ns, case):
    check = agent_ns["implement_grouping_sql_check"]
    got = check(case["sql"])
    if case["ok"]:
        digest = hashlib.sha256(case["sql_out"].encode("utf-8")).hexdigest()
        assert got == {"ok": True, "sql": case["sql_out"], "tables": case["tables"], "hash": digest, "rule": "", "at": None, "text": ""}
        assert check(got["sql"]) == got, "checking the SQL Inspire stores gives the same verdict, tables and hash"
    else:
        assert got == {"ok": False, "sql": "", "tables": [], "hash": "", "rule": case["rule"], "at": case["at"], "text": case["text"]}


def test_the_shared_cases_cover_every_rule_and_at_least_half_must_be_refused():
    refused = [c for c in CASES if not c["ok"]]
    assert len(CASES) >= 80 and len(refused) * 2 >= len(CASES)
    assert {c["rule"] for c in refused} == RULES
    assert len({c["id"] for c in CASES}) == len(CASES)


@pytest.mark.parametrize("word", CONTRACT_KEYWORDS + ["TABLE"])
def test_every_word_the_contract_refuses_is_refused_outside_a_string_and_allowed_inside_one(agent_ns, word):
    check = agent_ns["implement_grouping_sql_check"]
    bare = check(f"SELECT k, g AS group_name FROM a.b.c WHERE {word.lower()}")
    assert (bare["ok"], bare["rule"]) == (False, "keyword") and word in bare["text"]
    quoted = check(f"SELECT k, '{word}' AS group_name, `{word.lower()}` AS c FROM a.b.c -- {word}")
    assert quoted["ok"] is True and quoted["sql"].endswith("FROM a.b.c"), "the comment that names the word is removed"


@pytest.mark.parametrize("name", CONTRACT_FUNCTIONS + ["ai_extract", "try_reflect", "from_avro", "to_protobuf"])
def test_every_function_the_contract_refuses_is_refused_as_a_call_and_not_as_a_column(agent_ns, name):
    check = agent_ns["implement_grouping_sql_check"]
    called = check(f"SELECT k, {name}(g) AS group_name FROM a.b.c")
    assert (called["ok"], called["rule"]) == (False, "function"), called
    assert check(f"SELECT k, {name} AS group_name FROM a.b.c")["ok"] is True


def test_the_run_wraps_the_sql_with_a_new_line_before_the_closing_parenthesis_so_a_trailing_comment_cannot_eat_it(agent_ns):
    statement = agent_ns["inspire_group_sql_statement"]
    assert statement({"sql": "SELECT 1 -- note"}) == "SELECT * FROM (SELECT 1 -- note\n) AS _inspire_custom_groups"
    checked = agent_ns["implement_grouping_sql_check"]("SELECT k, g AS group_name FROM a.b.c -- note")
    assert statement(checked) == "SELECT * FROM (SELECT k, g AS group_name FROM a.b.c\n) AS _inspire_custom_groups"


def test_the_check_reads_only_the_text_it_is_given_and_calls_no_spark_no_sql_and_no_model(agent_ns):
    source = agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]
    tree = ast.parse(source)
    mine = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
            and ("grouping_sql" in n.name.lower() or n.name.startswith("_inspire_group_sql_") or n.name == "InspireGroupSqlRefused")]
    assert len(mine) >= 20
    assert not [n.name for n in ast.parse(agent_source()).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
                and "grouping_sql" in n.name.lower()], "the agent and the run notebook share the one check in the Run controls source"
    names = {x.id for n in mine for x in ast.walk(n) if isinstance(x, ast.Name)}
    attrs = {x.attr for n in mine for x in ast.walk(n) if isinstance(x, ast.Attribute)}
    assert not {"spark", "dbutils", "requests", "open", "exec", "eval", "w_client"} & names
    assert not {"sql", "execute_statement", "query", "chat", "invoke"} & attrs
    assert not any("llm" in n.lower() or "model" in n.lower() for n in names | attrs)
