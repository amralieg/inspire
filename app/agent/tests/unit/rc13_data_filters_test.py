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
    assert stats == {"affected": 2, "carried": 1, "repaired": 1}
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
    assert stats == {"affected": 0, "carried": 0, "repaired": 0}
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
    names = source.index("ensure_data_filter_labels(final_consolidated_use_cases")
    assert names > statements, "the name check runs on the final list, after the statement check, before anything is written"
    assert "[DATA-FILTER-LABEL FIRED]" in source, "the check logs how many names carried the label"
    assert 'DATA_FILTER_LABEL["text"] = parse_use_case_label(table_scope_str)' in source, "the widget fills the label holder"
