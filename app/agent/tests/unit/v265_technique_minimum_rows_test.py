"""The minimum rows a use case needs follow one rule in every notebook gate: the technique's own minimum from
kinds.json technique_min_rows when it has one, else its family's readiness_thresholds min_rows. The backend
(analysisMinimumRows) applies the same rule, and a person's own min_rows setting always wins."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire, make_uc  # noqa: E402

KINDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "app_shell", "kinds.json")


def _kinds():
    with open(KINDS, encoding="utf-8") as handle:
        return json.load(handle)


def _expected_minimum(kinds, technique):
    family = kinds["execution_family"][technique]
    return kinds["technique_min_rows"].get(technique, kinds["readiness_thresholds"][family]["min_rows"])


def test_the_notebook_gives_the_same_minimum_as_kinds_json_for_every_technique(agent_ns):
    kinds = _kinds()
    for technique, family in kinds["execution_family"].items():
        assert agent_ns["analysis_minimum_rows"](technique, family) == _expected_minimum(kinds, technique), technique


def test_a_regression_with_fewer_than_its_own_100_rows_is_refused_by_the_verdict(agent_ns):
    ok, text = agent_ns["deep_signal_verdict"]("F", {"row_count": 50}, technique="Regression Analysis")
    assert ok is False
    assert text == "Too few usable rows were found for this use case (50); at least 100 are needed."


def test_an_entity_matching_with_two_rows_passes_the_verdict(agent_ns):
    ok, _text = agent_ns["deep_signal_verdict"]("K", {"row_count": 2}, technique="Entity Matching")
    assert ok is True


def test_a_person_s_own_minimum_rows_setting_wins_over_the_technique_minimum(agent_ns):
    ok, _text = agent_ns["deep_signal_verdict"]("F", {"row_count": 50}, thresholds={"min_rows": 30},
                                                technique="Regression Analysis")
    assert ok is True


def test_the_genie_run_thresholds_carry_the_technique_minimum_rows(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Regression Analysis", "KPIs": []}))
    assert spec["family"] == "F"
    assert spec["thresholds"]["min_rows"] == 100


SALES = "main.s.web_sales"
DATES = "main.s.date_dim"


def test_the_joined_signal_read_over_a_scoped_source_parses_as_databricks_sql(agent_ns):
    import sqlglot
    data = {"column_roles": {}, "filters": [{"table": SALES, "column": "ws_quantity", "op": "in", "values": ["5"]}]}
    use_case = {"No": "N01-U01", "_implement_data": data}
    scopes = agent_ns["implement_use_case_scopes"](use_case, [SALES], "main.s")
    table_sql = agent_ns["scoped_read_source"](SALES, scopes)
    spec = {"roles": {"time": "inspire_time_date", "measure": "ws_quantity"},
            "date_joins": {"time": {"key": "ws_sold_date_sk", "table": DATES, "ref_column": "d_date_sk", "date": "d_date",
                                    "alias": "inspire_time_date"}}}
    sql, _args = agent_ns["DeepEvidence"].signal_sql("series", table_sql, spec, scopes=scopes)
    tree = sqlglot.parse_one(sql, read="databricks")
    assert list(tree.find_all(sqlglot.exp.Join)), "the date table is joined"
    assert "WHERE `ws_quantity` IN ('5')" in sql, "the Table Scope reaches the joined read"
