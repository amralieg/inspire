import copy
import json

from v140_implement_test import SHELL_SQL, _calls_to, _FileRunner, _output_context, _output_inspire, _space
from v142_genie_test import COLUMNS, LATEST, ORDERS, RESULT, _rich_space

import shell_core

TAG = "Not in the latest run"
SPACE_ANSWERS = {("POST", "/api/2.0/genie/spaces"): {"space_id": "s9"},
                 ("POST", "/api/2.0/genie/spaces/s9/start-conversation"): {"conversation_id": "c1", "message_id": "m1"},
                 ("GET", "/api/2.0/genie/spaces/s9/conversations/c1/messages/m1"): {
                     "status": "COMPLETED", "attachments": [{"query": {"query": "SELECT COUNT(*) FROM main.inspire.churn_out"}}]}}


def _keeping(ns, replace_edits):
    context = _output_context(ns)
    spec = copy.deepcopy(context["spec"])
    spec.setdefault("outputs", {})["app_options"] = dict(spec["outputs"].get("app_options") or {}, modify=True,
                                                         replace_edits=replace_edits)
    return dict(context, spec=spec)


def _posted_text(ns, tmp_path, replace_edits):
    import shell_alerts
    inst, calls = _output_inspire(ns, tmp_path / str(replace_edits), SPACE_ANSWERS)
    inst._implement_app_shell = lambda: (None, {"shell_sql": SHELL_SQL, "shell_alerts": shell_alerts})
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    runner = _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}])
    inst._implement_genie_space(_keeping(ns, replace_edits), runner)
    [(body, _q)] = _calls_to(calls, "POST", "/api/2.0/genie/spaces")
    return "".join(json.loads(body["serialized_space"])["instructions"]["text_instructions"][0]["content"])


def test_the_kept_records_fact_names_the_tag_column_what_it_means_and_how_to_answer(agent_ns):
    fact = agent_ns["implement_kept_records_fact"]("`main`.`inspire`.`churn_out`")
    assert fact == (
        "In `main.inspire.churn_out`, a current record whose not_listed_since is set is one the App tags 'Not in the latest run': the "
        "runs stopped listing it at not_listed_since, and it stays because a person changed or added it in the App (edited_by_person = "
        "TRUE) and this use case's runs keep people's changes. It is still a current record people act on. Answer what the latest run "
        "found from the current rows WHERE not_listed_since IS NULL, and when a question is about a record whose not_listed_since is "
        "set, say the latest run did not list it and since when.")
    assert agent_ns["INSPIRE_NOT_IN_RUN"] == TAG == SHELL_SQL.NOT_IN_RUN
    assert agent_ns["INSPIRE_KEPT_NAMES"] == ("edited_by_person", SHELL_SQL.KEPT_SINCE)
    assert not any(ch in fact for ch in "\u2013\u2014")


def test_the_genie_agent_of_a_use_case_that_keeps_edits_is_told_the_tag_and_one_that_replaces_them_is_not(agent_ns, tmp_path):
    fact = agent_ns["implement_kept_records_fact"](RESULT)
    kept = _posted_text(agent_ns, tmp_path, replace_edits=False)
    assert fact in kept and kept.count("not_listed_since IS NULL") == 1
    assert kept.index("The latest run of") < kept.index(fact)
    replaced = _posted_text(agent_ns, tmp_path, replace_edits=True)
    assert "not_listed_since" not in replaced and TAG not in replaced, "runs that replace edits keep no record out of the run"
    assert "The latest run of" in replaced


def test_the_kept_fact_is_written_once_after_the_held_back_fact(agent_ns):
    held, kept = agent_ns["implement_held_back_fact"](SHELL_SQL), agent_ns["implement_kept_records_fact"](RESULT)
    columns = {k.lower(): v for k, v in COLUMNS.items()}
    space = _rich_space()
    problems = agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, held, kept)
    agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, held, kept)
    text = "".join(space["instructions"]["text_instructions"][0]["content"])
    assert problems == [] and text.count(kept) == 1 and text.endswith(kept)
    assert text.index(SHELL_SQL.HELD_MEANING) < text.index(kept)
    alone = _rich_space()
    alone["data_sources"]["tables"] = [t for t in alone["data_sources"]["tables"] if t["identifier"] != RESULT]
    agent_ns["implement_genie_space_grounding"](alone, columns, RESULT, [ORDERS], (), LATEST, "", kept)
    assert kept not in "".join(alone["instructions"]["text_instructions"][0]["content"]), \
        "a space without the business output table is not told about its tag"


def _ask(current):
    page = {"id": "p1", "title": "Churn desk", "records": {"key": "entity_id", "label": "entity_label", "tier": "priority_tier"}}
    fields = [{"name": n} for n in ("record_key", "entity_id", "entity_label", "priority_tier", "edited_by_person", "not_listed_since")]
    return shell_core.record_ask_question("Pricing desk", page, fields, {"current": current, "record_key": "k1"}, "", "Why is it here?")


def test_a_question_about_a_tagged_record_tells_genie_the_runs_stopped_listing_it():
    current = {"record_key": "k1", "entity_id": "k1", "entity_label": "Acme", "priority_tier": "Act now", "edited_by_person": True,
               "not_listed_since": "2026-10-20 08:00:00"}
    text = _ask(current)
    assert ("- Not in the latest run (not_listed_since): the runs stopped listing this record at 2026-10-20 08:00:00, and it stays "
            "because a person changed or added it") in text
    assert text.index("- Tier (priority_tier)") < text.index("- Not in the latest run") < text.index("Question: Why is it here?")
    for listed in (dict(current, not_listed_since=None), {k: v for k, v in current.items() if k != "not_listed_since"}):
        assert TAG not in _ask(listed), "a record the latest run lists carries no tag line"
