"""rc13 Data Filters (REQ-119, REQ-021, REQ-100).

The Data Filters the person sets on the Launch page reach the notebook in the Table Scope JSON. The Use case labeling
text rides under the reserved key `use_case_label` of that same JSON. When it is ticked, the generation prompt names it,
every use case that reads a filtered table must carry it in its Name (repaired deterministically when it does not), and
the Implement build keeps the Launch scope as its ceiling (the First run sizing reads the same scope).
"""
import json

import pytest

ORDERS = "main.s.orders"
SCOPE = {
    ORDERS: {
        "columns": ["order_id", "customer_id", "brand"],
        "rows": [{"column": "brand", "op": "=", "values": ["Starbucks"]}],
    },
}


@pytest.fixture
def labelled(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["DATA_FILTER_LABEL"]["text"] = ""
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["DATA_FILTER_LABEL"]["text"] = ""


def _text(scopes, label=None):
    body = dict(scopes)
    if label is not None:
        body["use_case_label"] = label
    return json.dumps(body)


def test_the_label_key_is_not_a_table_so_a_labelled_scope_text_parses(agent_ns):
    scopes = agent_ns["parse_table_scopes"](_text(SCOPE, "Starbucks"))
    assert list(scopes) == [ORDERS], "the reserved label key is read as the label, never as a table"
    assert scopes[ORDERS]["rows"] == [{"column": "brand", "op": "=", "values": ["Starbucks"]}]


def test_the_label_is_read_from_the_same_scope_text_verbatim_and_trimmed(agent_ns):
    assert agent_ns["parse_use_case_label"](_text(SCOPE, "  Starbucks  ")) == "Starbucks"
    assert agent_ns["parse_use_case_label"](_text(SCOPE)) == "", "no label key means no label"
    assert agent_ns["parse_use_case_label"]("") == ""
    assert agent_ns["parse_use_case_label"](_text(SCOPE, "   ")) == ""


def test_the_prompt_directive_names_the_label_and_the_filtered_table_when_ticked(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    labelled["DATA_FILTER_LABEL"]["text"] = "Starbucks"
    lines = labelled["table_scope_directive_lines"]()
    label_lines = [line for line in lines if "USE CASE LABEL" in line]
    assert len(label_lines) == 1
    assert '"Starbucks"' in label_lines[0] and f"`{ORDERS}`" in label_lines[0]
    assert "MUST carry the label" in label_lines[0] and "Name" in label_lines[0]
    assert "user directive WINS" in label_lines[0], "the directive is supreme over guidance, per the user-vibes rule"


def test_the_prompt_directive_has_no_label_when_unticked(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    labelled["DATA_FILTER_LABEL"]["text"] = ""
    assert not [line for line in labelled["table_scope_directive_lines"]() if "USE CASE LABEL" in line]
    assert any("TABLE SCOPE of" in line for line in labelled["table_scope_directive_lines"]()), "the scope itself still reaches the prompt"


def test_a_label_with_no_row_filter_to_name_adds_no_directive(labelled):
    columns_only = {ORDERS: {"columns": ["order_id"], "rows": []}}
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(columns_only)))
    labelled["DATA_FILTER_LABEL"]["text"] = "Starbucks"
    assert not [line for line in labelled["table_scope_directive_lines"]() if "USE CASE LABEL" in line], \
        "a column-only scope filters no rows, so there is no filtered table to name"


@pytest.mark.parametrize("name, label, expected", [
    ("Improve customer experience using segmentation", "Starbucks", "Improve Starbucks customer experience using segmentation"),
    ("Churn", "Starbucks", "Starbucks Churn"),
    ("Reduce  refund   leakage", "Starbucks", "Reduce Starbucks refund leakage"),
])
def test_the_label_is_inserted_after_the_leading_verb_or_before_a_single_word(agent_ns, name, label, expected):
    assert agent_ns["insert_label_into_name"](name, label) == expected


def test_the_name_check_repairs_a_name_without_the_label_and_keeps_one_that_carries_it(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    use_cases = [
        {"Name": "Improve customer experience using segmentation", "Primary Table": ORDERS},
        {"Name": "Forecast STARBUCKS order volume", "Primary Table": ORDERS},
        {"Name": "Track supplier lead times", "Primary Table": "main.s.suppliers"},
    ]
    stats = labelled["ensure_data_filter_labels"](use_cases, lambda uc: [], "Starbucks", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats == {"affected": 2, "carried": 1, "reasked": 0, "fallback": 1, "kept_user_named": 0}
    assert use_cases[0]["Name"] == "Improve Starbucks customer experience using segmentation"
    assert use_cases[1]["Name"] == "Forecast STARBUCKS order volume", "a name that carries the label in any case is kept as written"
    assert use_cases[2]["Name"] == "Track supplier lead times", "a use case on no filtered table is never touched"


def test_the_name_check_also_sees_a_filtered_table_read_through_an_involved_table(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    use_cases = [{"Name": "Rank regions by revenue", "Primary Table": "main.s.regions"}]
    stats = labelled["ensure_data_filter_labels"](use_cases, lambda uc: [ORDERS], "Starbucks", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats["affected"] == 1 and "Starbucks" in use_cases[0]["Name"]


def test_an_empty_label_changes_no_name(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    use_cases = [{"Name": "Improve customer experience", "Primary Table": ORDERS}]
    stats = labelled["ensure_data_filter_labels"](use_cases, lambda uc: [], "", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats == {"affected": 0, "carried": 0, "reasked": 0, "fallback": 0, "kept_user_named": 0}
    assert use_cases[0]["Name"] == "Improve customer experience"


def test_the_implement_build_keeps_the_launch_row_filter_and_bounds_its_columns(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    data = {
        "column_roles": {"entity_id": f"{ORDERS}.order_id", "measure": f"{ORDERS}.total_price"},
        "filters": [{"table": ORDERS, "column": "customer_id", "op": "in", "values": ["c1", "c2"]}],
    }
    text = json.loads(json.dumps(labelled["implement_scope_text"](data, [ORDERS])))
    entry = text[ORDERS]
    assert entry["columns"] == ["order_id"], "the Launch column scope bounds the build: total_price is outside it"
    assert {"column": "brand", "op": "=", "values": ["Starbucks"]} in entry["rows"], "the Launch row filter always applies"
    assert {"column": "customer_id", "op": "in", "values": ["c1", "c2"]} in entry["rows"], "the Implement filter is added on top"


def test_the_implement_build_applies_a_launch_scope_to_a_table_the_wizard_never_touched(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    text = labelled["implement_scope_text"]({"column_roles": {}, "filters": []}, [ORDERS])
    assert text[ORDERS]["columns"] == ["order_id", "customer_id", "brand"]
    assert text[ORDERS]["rows"] == [{"column": "brand", "op": "=", "values": ["Starbucks"]}]


def test_without_a_launch_scope_the_implement_build_is_unchanged(labelled):
    data = {"column_roles": {"entity_id": f"{ORDERS}.order_id"}, "filters": []}
    assert labelled["implement_scope_text"](data, [ORDERS]) == {ORDERS: {"columns": ["order_id"], "rows": []}}
    assert labelled["implement_scope_text"]({"column_roles": {}, "filters": []}, [ORDERS]) == {}, "no role, no filter, no launch scope: read whole"


def test_the_name_check_is_wired_on_the_final_list_after_the_statement_check_and_the_label_is_read_from_the_widget():
    import json as _json
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    notebook = os.path.join(os.path.dirname(os.path.dirname(here)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        source = "".join(_json.load(handle)["cells"][1]["source"])
    statements = source.index("ensure_scope_statements(final_consolidated_use_cases")
    names = source.index("label_stats = ensure_data_filter_labels(")
    assert names > statements, "the name check runs on the final list, after the statement check, before anything is written"
    assert "[DATA-FILTER-LABEL FIRED]" in source and "re-asked" in source, "the check logs the names carried, re-asked and rewritten"
    assert 'DATA_FILTER_LABEL["text"] = parse_use_case_label(table_scope_str)' in source, "the widget fills the label holder"


class _Stub:
    """A stand-in for the agent's run_worker: records each call and returns the scripted answer or raises it."""

    def __init__(self, answer=None, error=None):
        self.calls = []
        self.answer = answer
        self.error = error

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.answer


MISSED = [
    {"No": "1", "Name": "Improve customer experience using segmentation", "Primary Table": ORDERS},
    {"No": "2", "Name": "Forecast order volume", "Primary Table": ORDERS},
]


def test_the_reask_runs_once_for_only_the_missed_names_with_the_cache_bypassed_and_its_answer_is_used(labelled):
    import json as _json

    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    answer = _json.dumps([
        {"Ref": "0", "Name": "Improve Contoso customer experience using segmentation"},
        {"Ref": "1", "Name": "Forecast Contoso order volume"},
    ])
    stub = _Stub(answer=answer)
    use_cases = [dict(uc) for uc in MISSED]
    stats = labelled["ensure_data_filter_labels"](
        use_cases, lambda uc: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"],
        reask=lambda misses: labelled["reask_data_filter_names"](stub, misses, "Contoso"))
    assert stats == {"affected": 2, "carried": 0, "reasked": 2, "fallback": 0, "kept_user_named": 0}
    assert [uc["Name"] for uc in use_cases] == ["Improve Contoso customer experience using segmentation", "Forecast Contoso order volume"]
    assert len(stub.calls) == 1, "one re-ask for all the missed names, never one per name"
    call = stub.calls[0]
    assert call["worker_prompt_path"] == "DATA_FILTER_LABEL_RENAME_PROMPT"
    assert call["skip_cache"] is True, "a re-ask must not replay the answer that missed"
    assert call["prompt_vars"]["label"] == "Contoso"
    assert '"Ref": "0"' in call["prompt_vars"]["names_json"] and "Improve customer experience" in call["prompt_vars"]["names_json"]


def test_the_rename_prompt_is_a_registered_template_with_the_label_and_the_names_as_its_only_placeholders(agent_ns):
    import string

    template = agent_ns["PROMPT_TEMPLATES"]["DATA_FILTER_LABEL_RENAME_PROMPT"]
    fields = {name for _, name, _, _ in string.Formatter().parse(template) if name}
    assert fields == {"label", "names_json"}
    assert "USER DIRECTIVES ARE THE SUPREME AUTHORITY" in template, "every prompt carries the user-vibes preamble"
    assert "the user directive WINS without exception" in template


def test_when_the_reask_still_misses_the_deterministic_rewrite_fires_for_each_name(labelled):
    import json as _json

    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    still_wrong = _Stub(answer=_json.dumps([{"Ref": "0", "Name": "Improve customer experience"}, {"Ref": "1", "Name": "Forecast order volume"}]))
    use_cases = [dict(uc) for uc in MISSED]
    stats = labelled["ensure_data_filter_labels"](
        use_cases, lambda uc: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"],
        reask=lambda misses: labelled["reask_data_filter_names"](still_wrong, misses, "Contoso"))
    assert stats == {"affected": 2, "carried": 0, "reasked": 0, "fallback": 2, "kept_user_named": 0}
    assert use_cases[0]["Name"] == "Improve Contoso customer experience using segmentation"
    assert use_cases[1]["Name"] == "Forecast Contoso order volume"


@pytest.mark.parametrize("failure", [RuntimeError("endpoint timed out"), "garbage"])
def test_a_failed_or_unusable_reask_falls_back_to_the_deterministic_rewrite(labelled, failure):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    stub = _Stub(error=failure) if isinstance(failure, Exception) else _Stub(answer=failure)
    use_cases = [dict(uc) for uc in MISSED]
    stats = labelled["ensure_data_filter_labels"](
        use_cases, lambda uc: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"],
        reask=lambda misses: labelled["reask_data_filter_names"](stub, misses, "Contoso"))
    assert stats == {"affected": 2, "carried": 0, "reasked": 0, "fallback": 2, "kept_user_named": 0}
    assert all("Contoso" in uc["Name"] for uc in use_cases)


def test_a_cancelled_reask_is_not_swallowed(agent_ns):
    stub = _Stub(error=agent_ns["SparkWorkCancelled"]("DataFilterLabel_Reask", "tag"))
    with pytest.raises(agent_ns["SparkWorkCancelled"]):
        agent_ns["reask_data_filter_names"](stub, [dict(uc) for uc in MISSED], "Contoso")


def test_without_a_reask_the_name_check_stays_deterministic_and_makes_no_llm_call(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    use_cases = [dict(uc) for uc in MISSED]
    stats = labelled["ensure_data_filter_labels"](use_cases, lambda uc: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats["reasked"] == 0 and stats["fallback"] == 2


def _composed_name(agent_ns, uc):
    """name_with_technique as the tracking row composes it: the real builder, with the technique and the template stubbed."""
    run = object.__new__(agent_ns["DatabricksInspire"])
    run._doc_technique_label = lambda *args, **kwargs: ("controls testing", False)
    run._doc_text = lambda t, key, language="English", **kw: "{name} using {technique}".format(**kw)
    return run._inspire_name_with_technique(uc)


def test_a_base_name_without_the_label_is_fixed_in_every_name_the_run_derives(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    uc = {"No": "1", "usecase": "Improve customer experience using segmentation",
          "Name": "Improve customer experience using segmentation", "Primary Table": ORDERS}
    stats = labelled["ensure_data_filter_labels"]([uc], lambda u: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats["fallback"] == 1
    assert uc["usecase"] == uc["Name"] == "Improve Contoso customer experience using segmentation", "both fields that name the use case carry it"
    row = labelled["DatabricksInspire"]._uc_to_row(uc, 1, labelled["DatabricksInspire"]._normalize_usecase)
    assert row[4].count("Contoso") == 1, "the tracking use_case column carries the label once"
    assert row[5].count("Contoso") == 1, "the tracking name column carries the label once"


def test_name_with_technique_has_the_label_exactly_once_and_never_doubled(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    uc = {"No": "1", "usecase": "Improve customer experience using segmentation",
          "Name": "Improve customer experience using segmentation", "Primary Table": ORDERS}
    labelled["ensure_data_filter_labels"]([uc], lambda u: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"])
    composed = _composed_name(labelled, uc)
    assert composed == "Improve Contoso customer experience using segmentation using controls testing"
    assert composed.count("Contoso") == 1


def test_a_name_that_already_carries_the_label_is_not_doubled_by_the_check(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    uc = {"No": "1", "usecase": "Improve Contoso customer experience", "Name": "Improve Contoso customer experience", "Primary Table": ORDERS}
    stats = labelled["ensure_data_filter_labels"]([uc], lambda u: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats["carried"] == 1 and stats["fallback"] == 0
    assert _composed_name(labelled, uc).count("Contoso") == 1


def test_a_user_named_use_case_keeps_the_persons_own_words(labelled):
    labelled["INSPIRE_TABLE_SCOPES"].update(labelled["parse_table_scopes"](_text(SCOPE)))
    uc = {"No": "1", "usecase": "Predict churn", "Name": "Predict churn", "user_use_case_name": "Retention radar", "Primary Table": ORDERS}
    stats = labelled["ensure_data_filter_labels"]([uc], lambda u: [], "Contoso", labelled["INSPIRE_TABLE_SCOPES"])
    assert stats == {"affected": 0, "carried": 0, "reasked": 0, "fallback": 0, "kept_user_named": 1}
    assert uc["usecase"] == "Predict churn" and uc["user_use_case_name"] == "Retention radar"


def test_the_fired_line_carries_the_counts_and_is_written_as_a_step_message(agent_ns):
    line = agent_ns["data_filter_label_line"]({"affected": 2, "carried": 1, "reasked": 1, "fallback": 0, "kept_user_named": 0}, "Contoso")
    assert line.startswith('[DATA-FILTER-LABEL FIRED] 1 of 2 names carried the label "Contoso"')
    assert "re-asked 1, deterministic rewrite 0" in line
    import json as _json
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    notebook = os.path.join(os.path.dirname(os.path.dirname(here)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        source = "".join(_json.load(handle)["cells"][1]["source"])
    assert 'step_name="Data Filter Label"' in source and "message=_label_line" in source, "the FIRED line is a step message"
    assert "log_print(_label_line)" in source, "and it is also written to the log"
