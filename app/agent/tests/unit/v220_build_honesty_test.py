import ast
import json
import logging
import os
import re
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for path in (os.path.dirname(HERE), SERVER):
    if path not in sys.path:
        sys.path.insert(0, path)

from _agentload import agent_source  # noqa: E402

DQ_REASON = "Every record has a data quality issue, most often: franchiseID differs across chunks."


def inspire(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v220")
    return obj


def method_source(name):
    tree = ast.parse(agent_source())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(agent_source(), node)
    raise AssertionError(name)


def test_a_held_app_leads_the_status_with_a_short_plain_reason(agent_ns):
    delivery = agent_ns["implement_delivery"](["dashboard", "app"], {"dashboard": {"state": "ready"}}, {"app": DQ_REASON}, 3)
    assert delivery["delivered"] == ["dashboard"] and delivery["spec_version"] == 3
    assert delivery["not_delivered"] == [{"output": "app", "label": "App",
                                          "reason": "Every record has a data quality issue, most often: franchiseID differs across chunks"}]
    assert agent_ns["implement_delivery_lead"](delivery) == ("App not published: Every record has a data quality issue, most often: "
                                                              "franchiseID differs across chunks")


def test_a_failed_genie_agent_is_reported_not_built_with_a_bounded_reason(agent_ns):
    error = "the Genie Agent still failed after 3 Genie rounds: " + "x y " * 400
    delivery = agent_ns["implement_delivery"](["genie_space"], {"genie_space": {"state": "failed", "error": error}}, {}, 2)
    lead = agent_ns["implement_delivery_lead"](delivery)
    assert lead.startswith("Genie Agent not built: the Genie Agent still failed after 3 Genie rounds")
    assert len(delivery["not_delivered"][0]["reason"]) <= agent_ns["IMPLEMENT_SHORT_REASON_CHARS"] + 4


def test_everything_delivered_gives_no_lead_must_exclude(agent_ns):
    delivery = agent_ns["implement_delivery"](["dashboard", "genie_space"], {"dashboard": {"state": "ready"},
                                                                            "genie_space": {"state": "ready", "error": "old"}}, {}, 1)
    assert delivery["not_delivered"] == [] and agent_ns["implement_delivery_lead"](delivery) == ""


def test_the_short_reason_keeps_decimals_and_stops_at_the_first_sentence(agent_ns):
    short = agent_ns["implement_short_reason"]
    assert short("The share is 3.5 percent. Then more.") == "The share is 3.5 percent"
    assert short("") == "no reason was given"


def test_the_build_writes_the_delivery_record_and_puts_its_lead_first():
    source = agent_source()
    assert "asset_status[IMPLEMENT_DELIVERY] = implement_delivery(asked, asset_status, held_outputs, key[2])" in source
    assert "told = implement_undelivered_lines(asset_status)" in source
    assert 'said_status = "; ".join(p for p in (undelivered, implement_compose([w for w in warnings if w not in told])) if p)' in source
    assert "status_message=(said_status or (" in source and '"Done", said_status if warnings else' in source


def test_a_failure_already_named_in_the_lead_is_not_repeated(agent_ns):
    status = {"dashboard": {"state": "failed", "error": "the warehouse is stopped"}, "app": {"state": "ready"},
              "delivery": {"spec_version": 3, "not_delivered": [{"output": "dashboard", "label": "Dashboard", "reason": "the warehouse is stopped"}]}}
    assert agent_ns["implement_undelivered_lines"](status) == {"Dashboard: the warehouse is stopped"}
    assert agent_ns["implement_undelivered_lines"]({"dashboard": {"state": "ready"}}) == set()


def test_a_redaction_placeholder_stays_as_it_is_in_every_namespace(agent_ns):
    import shell_redact
    text = "could not read 'alice@example.com' from main.sales.orders"
    assert agent_ns["inspire_redact_text"](text, set(), "") == shell_redact.inspire_redact_text(text, set(), "") == \
        "could not read '<email>' from main.sales.orders"


def test_genie_exhaustion_is_a_genie_failure_not_a_platform_one(agent_ns):
    error = agent_ns["ImplementGenieExhausted"]("Genie Agent", 3, "bad join")
    assert agent_ns["implement_failure_origin"](error) == "genie"
    assert agent_ns["implement_failure_origin"](RuntimeError("timeout")) == "platform"


def test_every_failure_origin_has_the_text_the_failure_log_names_it_by(agent_ns):
    body = re.search(r"def implement_failure_origin\(error\) -> str:\n((?:    .*\n)+)", agent_source()).group(1)
    origins = set(re.findall(r'return "(\w+)"', body))
    assert "genie" in origins and len(origins) >= 5
    assert origins <= set(agent_ns["IMPLEMENT_ORIGIN_TEXT"]), origins - set(agent_ns["IMPLEMENT_ORIGIN_TEXT"])


def test_a_genie_exhaustion_is_logged_with_its_own_origin_and_never_as_a_key_error(agent_ns, caplog):
    obj = inspire(agent_ns)
    obj._implement_redacted = lambda text, known="": text
    with caplog.at_level(logging.WARNING, logger="v220"):
        obj._implement_log_failure("N01-U01", "the Alert", 3, agent_ns["ImplementGenieExhausted"]("Alert", 3, "bad join"))
    assert "failed in the Genie build rounds" in caplog.text and "KeyError" not in caplog.text


class _GrowingRows(set):
    def __iter__(self):
        for value in set.__iter__(self):
            self.add(f"{value}-later")
            yield value


@pytest.mark.parametrize("where", ["notebook", "app_shell"])
def test_a_row_value_set_that_grows_while_an_error_is_redacted_never_breaks_the_redaction(agent_ns, where):
    import shell_redact
    redact = agent_ns["inspire_redact_text"] if where == "notebook" else shell_redact.inspire_redact_text
    seen = _GrowingRows({"Acme Corp"})
    assert redact("the App check stopped on Acme Corp", seen, "") == \
        f"the App check stopped on {agent_ns['INSPIRE_REDACTED_VALUE']}"


def test_a_single_source_table_needs_no_join_but_two_sources_still_must_join(agent_ns):
    check = agent_ns["_implement_genie_join_problems"]
    tables = {"c.s.result": "c.s.result", "c.s.a": "c.s.a", "c.s.b": "c.s.b"}
    real = {key: {} for key in tables}
    aliases = {"c.s.result": "r", "c.s.a": "a", "c.s.b": "b"}
    assert check({}, tables, real, aliases, ["c.s.a"]) == []
    problems = check({}, tables, real, aliases, ["c.s.a", "c.s.b"])
    assert len(problems) == 1 and "joins no other table" not in problems[0] and "join no other table" in problems[0]


def test_the_run_log_table_is_a_companion_of_the_result(agent_ns):
    source = method_source("implement_genie_space_grounding")
    assert "inspire_run_log_table(result_table)" in source


def test_redaction_keeps_the_agents_own_words_and_hides_real_values(agent_ns):
    message = ("ValueError: with 14 rows, a row whose data_quality_flag is 'ok' is 'Act now' at rank 0, 'Review' at rank 3, and "
               "every other row is 'Monitor' | value 'Franchise 3000000' \x1b[0;31mBoom\x1b[0m")
    said = agent_ns["inspire_redact_text"](message, set(), "")
    assert "'ok'" in said and "'Act now'" in said and "'Review'" in said and "'Monitor'" in said
    assert "Franchise 3000000" not in said and "a data value" in said
    assert "\x1b" not in said and "Boom" in said
    assert "'a data value' is 'a data value'" not in said


def test_the_ansi_strip_removes_only_escape_codes(agent_ns):
    assert agent_ns["inspire_strip_ansi"]("\x1b[1mbold\x1b[0m plain") == "bold plain"
    assert agent_ns["inspire_strip_ansi"]("no codes [0m here") == "no codes [0m here"


def test_the_redaction_source_matches_the_app_shell_module(agent_ns):
    with open(os.path.join(SERVER, "shell_redact.py")) as handle:
        assert agent_ns["REDACT_SOURCE"].strip() == handle.read().strip()


def test_a_hard_vetoed_use_case_never_keeps_a_high_quality_badge(agent_ns):
    obj = inspire(agent_ns)
    uc = {"No": "N01-U01", "Quality": "Very High", "Quality Score": 4.2, "Priority Score": 4.0, "bob_hard_veto_gate": "D5"}
    assert obj._cap_failed_gate_quality(uc) is True
    assert uc["Quality"] == "Low" and uc["Quality Score"] == 2.0


@pytest.mark.parametrize("uc", [
    {"No": "N01-U02", "Quality": "Very High", "Quality Score": 4.2, "bob_hard_veto_gate": "None"},
    {"No": "N01-U03", "Quality": "Very High", "Quality Score": 4.2},
    {"No": "N01-U04", "Quality": "Very Low", "Quality Score": 1.0, "below_bar_gate": "D2"},
])
def test_a_use_case_with_no_failed_gate_or_already_low_keeps_its_label_must_exclude(agent_ns, uc):
    before = dict(uc)
    assert inspire(agent_ns)._cap_failed_gate_quality(uc) is False
    assert uc == before


def test_below_bar_use_cases_get_their_best_of_best_score(agent_ns):
    obj = inspire(agent_ns)
    seen = []

    def score(items, schema, **kw):
        seen.extend(items)
        for uc in items:
            uc["bob_status"], uc["bob_score"] = "scored", 6.0

    obj._score_best_of_best = score
    obj._grading_context = lambda context: {}
    selected = [{"No": "A", "bob_status": "scored", "bob_score": 8.0}]
    waiting = {"No": "B", "bob_status": None, "scoring_status": "scored"}
    removed = {"No": "C", "bob_status": None, "scoring_status": "scored", "selection_removed": "duplicate"}
    done = obj._score_below_bar_use_cases(selected, selected + [waiting, removed], [], {})
    assert done == [waiting] and waiting["bob_score"] == 6.0 and removed not in seen


def test_no_below_bar_scoring_when_best_of_best_never_ran_must_exclude(agent_ns):
    obj = inspire(agent_ns)
    obj._score_best_of_best = lambda *a, **k: pytest.fail("scored without a Best-of-Best run")
    assert obj._score_below_bar_use_cases([{"No": "A"}], [{"No": "A"}, {"No": "B"}], [], {}) == []


def test_the_selection_scores_below_bar_use_cases_before_attaching_them():
    source = agent_source()
    at = source.index("selected, below = self._attach_below_bar_use_cases(selected, universe, mode)")
    assert "self._score_below_bar_use_cases(" in source[at - 400:at]


def test_two_use_cases_with_the_same_shown_name_keep_only_the_better(agent_ns):
    obj = inspire(agent_ns)
    obj._final_rank_key = lambda uc: (-uc["Inspire Score"],)
    better = {"No": "N07-U05", "Name": "Cut waste", "usecase": "Cut Daily Waste to Protect Margin", "Inspire Score": 4.0}
    worse = {"No": "N07-U06", "Name": "Cut waste too", "usecase": "cut daily waste, to protect margin!", "Inspire Score": 3.0}
    selected, below = obj._drop_same_name_twins([better], [worse])
    assert selected == [better] and below == []
    assert worse["selection_removed"] == "duplicate" and "N07-U05" in worse["selection_drop_reason"]


def test_different_names_are_never_deduplicated_must_exclude(agent_ns):
    obj = inspire(agent_ns)
    obj._final_rank_key = lambda uc: (-uc["Inspire Score"],)
    one = {"No": "A", "Name": "a", "usecase": "Cut Daily Waste to Protect Margin", "Inspire Score": 4.0}
    two = {"No": "B", "Name": "b", "usecase": "Cut Weekly Waste to Protect Margin", "Inspire Score": 3.0}
    assert obj._drop_same_name_twins([one], [two]) == ([one], [two])
    assert "selection_removed" not in two


def test_a_user_named_use_case_wins_its_name_even_when_ranked_lower(agent_ns):
    obj = inspire(agent_ns)
    obj._final_rank_key = lambda uc: (-uc["Inspire Score"],)
    mine = {"No": "U", "Name": "Cut Daily Waste", "user_named": "Cut Daily Waste", "usecase": "x", "Inspire Score": 1.0}
    other = {"No": "G", "Name": "g", "usecase": "Cut Daily Waste", "Inspire Score": 5.0}
    selected, below = obj._drop_same_name_twins([other], [mine])
    assert selected == [] and below == [mine] and other["selection_removed"] == "duplicate"


def test_a_headline_without_an_outcome_is_no_longer_a_name_issue(agent_ns):
    """REQ-175 dropped the "to <verb>" headline rule: a name is judged by its own words and length, not its headline."""
    obj = inspire(agent_ns)
    issues = obj._use_case_name_issues({"Name": "Reduce Unsold Waste", "usecase": "Align Daily Production"})
    assert "headline_no_outcome" not in issues and issues == []


def test_the_outcome_headline_pattern_is_gone_from_the_notebook(agent_ns):
    assert "USE_CASE_HEADLINE_OUTCOME_RE" not in agent_source()


def test_constant_columns_reach_the_notebook_rules(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    flags = json.dumps({"gate_flags": ["Q3_R24_CONSTANT_COLUMN:review_uri", "Q3_R23_THIN_TIME_COVERAGE:1_days"]})
    assert cls._genie_constant_columns({"selection_flags": flags}) == ["review_uri"]
    assert cls._genie_constant_columns({"gate_flags": ["Q3_R24_CONSTANT_COLUMN:a"], "selection_flags": {"gate_flags": []}}) == ["a"]
    rule = agent_ns["genie_constant_columns_rule"](["review_uri"])
    assert "`review_uri`" in rule and "Never group" in rule
    assert 'genie_constant_columns_rule(spec["constant_columns"])' in method_source("_genie_platform_rules")


def test_no_constant_flag_adds_no_rule_or_spec_key_must_exclude(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert cls._genie_constant_columns({"selection_flags": "not json"}) == []
    assert cls._genie_constant_columns({"gate_flags": ["Q3_R24_CONSTANT_COLUMN: "]}) == []
    assert '**({"constant_columns": constant} if (constant := self._genie_constant_columns(use_case)) else {})' in agent_source()


def test_the_genie_space_states_scope_and_answers_what_to_do(agent_ns):
    facts = agent_ns["implement_genie_answer_facts"]("c.s.result", {"rank": 1, "recommended_action": 1})
    assert any("names the rows it counts" in fact for fact in facts)
    assert any("`recommended_action`" in fact and "by `rank`" in fact for fact in facts)


def test_no_action_fact_without_an_action_column_must_exclude(agent_ns):
    facts = agent_ns["implement_genie_answer_facts"]("c.s.result", {"rank": 1})
    assert len(facts) == 1 and "recommended_action" not in facts[0]


def test_the_genie_round_counter_has_a_fixed_ceiling(agent_ns):
    budget = agent_ns["implement_repair_budget"]
    rounds, data_rounds = 3, 2
    total = rounds + data_rounds
    for _ in range(4):
        rounds, data_rounds = budget("data", rounds, data_rounds)
        assert rounds + data_rounds == total
    source = method_source("_implement_fill_and_preview")
    assert "most = rounds + data_rounds + IMPLEMENT_TIMEOUT_RESUME_ROUNDS" in source
    assert "{round_no}/{rounds}" not in source and '"rounds": rounds' not in source
    assert source.count("{round_no} of up to {most}") >= 5
    loop = method_source("_implement_genie_loop")
    assert "most = rounds + IMPLEMENT_TIMEOUT_RESUME_ROUNDS" in loop and "{round_no}/{rounds}" not in loop
    assert loop.count("{round_no} of up to {most}") >= 6


def test_kpi_scope_names_caption_and_filters():
    import shell_agent
    page = {"filters": [{"id": "region", "label": "Region"}, {"id": "when", "label": "Date"}]}
    scope = shell_agent.Agent.kpi_scope(page, {"caption": "latest run"}, {"region": ["East", "West"],
                                                                               "when": {"from": "2024-01-01", "to": "2024-02-01"}})
    assert scope == "latest run; Region: East, West; Date: 2024-01-01 to 2024-02-01"
    assert shell_agent.Agent.kpi_scope(page, {}, {"region": []}) == "every row the page reads, with no filter"
    assert "names the rows it counts" in shell_agent.BRIEF


def test_a_first_app_published_with_the_banner_is_delivered_and_never_called_held(agent_ns):
    from v221_test_run_training_test import REASON, _first_build
    status, final, emitted, built = _first_build(agent_ns, REASON, {"act_now_records": 0, "review_records": 0, "records": 940})
    delivery = final["asset_status"][agent_ns["IMPLEMENT_DELIVERY"]]
    assert "app" in built and "app" in delivery["delivered"], delivery
    assert all(item["output"] != "app" for item in delivery["not_delivered"])
    assert not final["status_message"].startswith("App not published")
    assert agent_ns["implement_untrusted_app_text"](REASON, True) in final["status_message"]


PANDAS_TRACE = ("\x1b[0;31mKeyError\x1b[0m                                  Traceback (most recent call last)\n"
                "File \x1b[0;32m<command-4155>, line 12\x1b[0m\n"
                "\x1b[1;32m     10\x1b[0m frame = spark.table(\"main.billing.bills\").toPandas()\n"
                "\x1b[0;32m---> 12\x1b[0m features = frame[['bill_amount', 'autopay_enrolled']]\n"
                "File \x1b[0;32m/databricks/python/lib/python3.12/site-packages/pandas/core/frame.py:4108\x1b[0m, in "
                "\x1b[0;36mDataFrame.__getitem__\x1b[0;34m(self, key)\x1b[0m\n"
                "\x1b[0;32m-> 4108\x1b[0m     indexer = self.columns._get_indexer_strict(key, \"columns\")[1]\n"
                "\x1b[0;31mKeyError\x1b[0m: \"['autopay_enrolled'] not in index\"")


def test_a_column_name_in_a_pandas_key_error_is_kept_as_metadata(agent_ns):
    import shell_redact
    message = "KeyError: \"['autopay_enrolled'] not in index\""
    for redact in (agent_ns["inspire_redact_text"], shell_redact.inspire_redact_text):
        assert redact(message, set(), "") == message
        said = redact(PANDAS_TRACE, set(), "")
        assert "\x1b" not in said and "a data value" not in said
        assert said.endswith(message)
        assert "_get_indexer_strict(key, \"columns\")" in said and "frame[['bill_amount', 'autopay_enrolled']]" in said
        assert 'spark.table("main.billing.bills")' in said
    assert agent_ns["redact_error"](KeyError("['autopay_enrolled'] not in index")) == message
    for kept in ("KeyError: \"None of [Index(['autopay_enrolled', 'plan'], dtype='object')] are in the [columns]\"",
                 "KeyError: \"Column(s) ['autopay_enrolled'] do not exist\"", "KeyError: \"['autopay_enrolled'] not found in axis\"",
                 "ValueError: column 'autopay_enrolled' is empty"):
        assert agent_ns["inspire_redact_text"](kept, set(), "") == kept
    assert agent_ns["inspire_redact_text"]("KeyError: 'Plan Tier'", set(), "main.billing.bills: customer_id, Plan Tier") == "KeyError: 'Plan Tier'"


def test_a_data_value_in_an_error_is_still_redacted_must_exclude(agent_ns):
    redact = agent_ns["inspire_redact_text"]
    assert redact("KeyError: \"['Franchise 3000000'] not in index\"", set(), "") == "KeyError: \"['a data value'] not in index\""
    assert redact("KeyError: 'Alice Smith'", set(), "") == "KeyError: 'a data value'"
    assert redact("ValueError: column 'autopay_enrolled' has bad value 'Franchise 3000000'", set(), "") == \
        "ValueError: column 'autopay_enrolled' has bad value 'a data value'"
    assert redact("ValueError: bad row 'alice@example.com' and '3000000' and 'Alice Smith'", set(), "") == \
        "ValueError: bad row '<email>' and 'a data value' and 'a data value'"
    assert redact("KeyError: \"None of [Index(['Alice Smith'], dtype='object')] are in the [index]\"", set(), "") == \
        "KeyError: \"None of [Index(['a data value'], dtype='object')] are in the [index]\""
    assert redact('note "a row said \'Alice Smith\'" here', set(), "") == 'note "a data value" here'
    assert redact("\x1b[0;31mKeyError\x1b[0m: 'Alice Smith'", set(), "") == "KeyError: 'a data value'"
