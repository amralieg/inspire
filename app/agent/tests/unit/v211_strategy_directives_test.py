"""v2.1.1 strategy directives: the customer's own level names, sponsors and KPIs bind the alignment. A sponsor outside
the customer's roster is repaired onto it, a KPI named like a customer KPI is linked to it and any other KPI is
flagged as a proposed new KPI, the priority level of the tree folds into the business priorities next to the
07_business_priorities picks, and every export names one column per customer level. With no strategy the output
is unchanged. The app's KPI name check reads a negated sign word (non-positive) exactly as the agent does."""
import base64
import csv
import io
import json
import os

import pytest

from v120_artifacts_support import make_inspire
from v130_outputs_test import docs, foundations, labels, value_uc  # noqa: F401
from v130_strategy_alignment_test import answer, harness, uc

PARITY = os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "test", "fixtures", "kpi_filter_parity.json")

FOUR_LEVELS = {
    "levels": ["Theme", "Ambition", "Outcome", "Focus Area"],
    "labels": {"priority": "Focus Area"},
    "strategy": [
        {"name": "Customer", "children": [
            {"name": "Win loyalty", "children": [
                {"name": "Grow repeat purchases",
                 "kpis": [{"name": "Repeat purchase rate", "unit": "%", "direction": "increase"}],
                 "children": [{"name": "Repeat buyers"}, {"name": "Basket growth"}]}]}]},
        {"name": "Operations", "children": [{"name": "Run lean", "children": [{"name": "Cut stockouts"}]}]},
    ],
    "sponsors": [{"role": "Group CEO"},
                 {"role": "Customer Director", "reports_to": "Group CEO", "owns": ["Customer"]},
                 {"role": "Supply Director", "reports_to": "Group CEO", "owns": ["Supply"]}],
}


def four_level_tree(agent_ns):
    return agent_ns["parse_strategic_context"](json.dumps(FOUR_LEVELS))


def test_the_priority_level_folds_into_the_priorities_and_keeps_the_widget_picks(agent_ns):
    tree = four_level_tree(agent_ns)
    assert tree["levels"] == ["Theme", "Ambition", "Outcome", "Focus Area"]
    assert tree["priorities"] == ["Repeat buyers", "Basket growth"] and tree["priority_level"] == "Focus Area"
    merge = agent_ns["strategy_business_priorities"]
    assert merge(tree, ["Increase Revenue", "repeat buyers"]) == ["Repeat buyers", "Basket growth", "Increase Revenue"]
    plain = agent_ns["parse_strategic_context"](json.dumps(dict(FOUR_LEVELS, labels={}, priorities=["Grow margin"])))
    assert plain["priorities"] == ["Grow margin"] and "priority_level" not in plain
    assert merge(plain, ["Increase Revenue"]) == ["Grow margin"], "explicit priorities still replace the widget (must-exclude)"
    renamed = agent_ns["parse_strategic_context"](json.dumps(dict(FOUR_LEVELS, labels={"priority": "Initiative"})))
    assert renamed["priorities"] == [] and "priority_level" not in renamed, "a label that names no level folds nothing"


def test_the_app_names_the_priority_level_without_renaming_any_header(agent_ns):
    sent = dict(FOUR_LEVELS, labels={}, priority_level="focus area")
    tree = agent_ns["parse_strategic_context"](json.dumps(sent))
    assert tree["priority_level"] == "Focus Area" and tree["priorities"] == ["Repeat buyers", "Basket growth"]
    assert tree["labels"] == {}
    assert not any("unknown key" in w for w in tree.get("warnings", [])), "the App's own key is not reported as unknown"
    wrong = agent_ns["parse_strategic_context"](json.dumps(dict(sent, priority_level="Initiative")))
    assert "priority_level" not in wrong and wrong["priorities"] == []
    assert any("priority_level 'Initiative' ignored" in w for w in wrong["warnings"])


def test_a_named_level_with_no_entries_gets_no_column(agent_ns):
    obj = make_inspire(agent_ns)
    obj.strategy_tree = agent_ns["parse_strategic_context"](json.dumps(
        {"levels": ["Pillar", "Goal", "Objective", "Priority"], "priority_level": "Priority",
         "strategy": [{"name": "Customer", "children": ["Win loyalty"]}]}))
    assert [header for header, _get, _numeric in obj._strategy_level_columns()] == ["Pillar", "Goal"]
    assert agent_ns["strategy_level_names"](obj.strategy_tree, [{"id": "S1.1"}]) == {"Pillar": "Customer", "Goal": "Win loyalty"}


def test_a_sponsor_outside_the_customer_roles_is_repaired_onto_the_roster(agent_ns):
    answers = {"U1": answer("U1", alignments=[{"id": "S1.1.1", "evidence": "Repeat orders per `customer_id` move it"}],
                            sponsor_id="SP42"),
               "U2": answer("U2", alignments=[], sponsor_id=None)}
    obj = harness(agent_ns, answers=answers, tree=four_level_tree(agent_ns))
    ucs = [uc("U1", Sponsor="Chief Operating Officer"), uc("U2", Sponsor="VP Invented", **{"Business Domain": "Supply"})]
    obj._run_strategy_alignment(ucs)
    roles = {s["role"] for s in obj.strategy_tree["sponsors"]}
    assert [u["Sponsor"] for u in ucs] == ["Customer Director", "Supply Director"]
    assert all(u["Sponsor"] in roles for u in ucs)


def test_customer_kpis_are_linked_by_name_and_other_kpis_are_flagged_as_proposed(agent_ns):
    renamed = dict(answer("U1")["kpis"][0], name="repeat purchase rate", kpi_id=None)
    invented = dict(answer("U1")["kpis"][0], name="Weekly buyers", kpi_id="K77")
    answers = {"U1": answer("U1", alignments=[{"id": "S1.1.1", "evidence": "Repeat orders per `customer_id` move it"}],
                            kpis=[renamed, invented])}
    obj = harness(agent_ns, answers=answers, tree=four_level_tree(agent_ns))
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    linked, other = ucs[0]["KPIs"]
    assert (linked["name"], linked["kpi_id"], linked["source"]) == ("Repeat purchase rate", "K1", "strategy")
    assert (other["kpi_id"], other["source"]) == (None, "proposed")


def test_a_failed_answer_keeps_a_proposed_placeholder_kpi_and_a_roster_sponsor(agent_ns):
    obj = harness(agent_ns, answers={}, tree=four_level_tree(agent_ns))
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    assert [k["source"] for k in ucs[0]["KPIs"]] == ["proposed"]
    assert ucs[0]["Sponsor"] in {s["role"] for s in obj.strategy_tree["sponsors"]}


def test_with_no_strategy_the_alignment_output_is_unchanged(agent_ns):
    builtin = agent_ns["build_builtin_strategy"]("Increase Revenue, Reduce Cost")
    obj = harness(agent_ns, answers={"U1": answer("U1", alignments=[{"id": "S1", "evidence": "`amount` per order"}])},
                  tree=builtin)
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    assert all("source" not in k for k in ucs[0]["KPIs"]), "no customer KPIs, so no KPI is called proposed (must-exclude)"
    assert ucs[0]["Sponsor"] == "Chief Operating Officer", "no roster, so the generated sponsor stays"
    assert "Strategy Levels" not in ucs[0]
    assert obj._strategy_level_columns() == []


def test_the_prompt_binds_the_sponsor_to_the_roster_and_flags_other_kpis_under_the_user_preamble(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"]
    assert "never name a role that is not on it" in template
    assert "proposed new KPI" in template
    rendered = agent_ns["with_user_directive_preamble"](template)
    assert agent_ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"].strip()[:80] in rendered


def portfolio():
    paths = {"S1.1.1.1": ["Customer", "Win loyalty", "Grow repeat purchases", "Repeat buyers"],
             "S2.1.1": ["Operations", "Run lean", "Cut stockouts"]}

    def aligned(sid):
        return {"Strategy Alignment": [{"id": sid, "path": " > ".join(paths[sid]), "evidence": "`units_sold`"}],
                "Strategy Path": " > ".join(paths[sid]), "Strategic Goals Alignment": " > ".join(paths[sid])}
    return {"Sales": [value_uc("N01-U01", **aligned("S1.1.1.1"), **{"Inspire Score": 9.0}),
                      value_uc("N01-U02", **aligned("S2.1.1"), **{"Inspire Score": 6.3})]}


def level_obj(ns):
    obj = make_inspire(ns)
    obj.strategy_tree = four_level_tree(ns)
    obj.data_foundations = foundations()
    obj.delivery_order = ["N01-U01", "N01-U02"]
    return obj


def written(obj, suffix):
    files = obj.w_client.workspace.files
    path = next(p for p in files if str(p).endswith(suffix))
    data = files[path]
    return data.decode("utf-8") if isinstance(data, bytes) else str(data)


def test_csv_and_excel_name_one_column_per_customer_level(docs):
    obj = level_obj(docs)
    headers, rows, _numeric = obj._catalog_export_table(portfolio())
    at = headers.index("Strategic Goals Alignment")
    assert headers[at + 1:at + 5] == ["Theme", "Ambition", "Outcome", "Focus Area"]
    first, second = dict(zip(headers, rows[0])), dict(zip(headers, rows[1]))
    assert (first["Theme"], first["Focus Area"]) == ("Customer", "Repeat buyers")
    assert (second["Outcome"], second["Focus Area"]) == ("Cut stockouts", "")
    obj._generate_csv_catalog("English", "en", portfolio())
    table = list(csv.reader(io.StringIO(written(obj, ".csv").lstrip("\ufeff"))))
    assert {"Theme", "Ambition", "Outcome", "Focus Area"} <= set(table[0])
    assert dict(zip(table[0], table[1]))["Ambition"] == "Win loyalty"


def test_markdown_and_pdf_views_carry_each_customer_level(docs):
    obj = level_obj(docs)
    t = labels(docs)
    model = obj._document_model("English", t, {}, portfolio(), "Acme")
    facts = [(key, label, value) for key, label, value in obj._use_case_view(model["ranked"][0], model, t)["facts"]]
    keys = [key for key, _l, _v in facts]
    at = keys.index("strategic_goals_alignment")
    assert [(label, value) for _k, label, value in facts[at + 1:at + 5]] == [
        ("Theme", "Customer"), ("Ambition", "Win loyalty"), ("Outcome", "Grow repeat purchases"), ("Focus Area", "Repeat buyers")]
    second = obj._use_case_view(model["ranked"][1], model, t)["facts"]
    assert "Focus Area" not in [label for _k, label, _v in second], "an empty level is left out of the card"
    obj._generate_markdown_catalog("English", "en", portfolio(), {"Executive": "Exec"}, "Acme")
    text = written(obj, ".md")
    assert "**Theme:** Customer" in text and "**Focus Area:** Repeat buyers" in text


def test_json_catalog_carries_a_strategy_levels_field_per_use_case(docs):
    obj = level_obj(docs)
    obj.docs_output_dir = "/Workspace/out"
    obj._generate_json_catalog("English", "en", portfolio(), {"Executive": "Exec"}, "Acme")
    raw = written(obj, ".json")
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = json.loads(base64.b64decode(raw).decode("utf-8"))
    levels = {u["No"]: u["Strategy Levels"] for u in _use_cases(payload)}
    assert levels["N01-U01"] == {"Theme": "Customer", "Ambition": "Win loyalty", "Outcome": "Grow repeat purchases",
                                 "Focus Area": "Repeat buyers"}
    assert levels["N01-U02"]["Focus Area"] == ""


def test_exports_without_a_customer_tree_have_no_level_columns_or_field(docs):
    obj = make_inspire(docs)
    obj.strategy_tree = docs["build_builtin_strategy"]("Increase Revenue")
    obj.docs_output_dir = "/Workspace/out"
    headers, _rows, _numeric = obj._catalog_export_table(portfolio())
    assert not {"Theme", "Ambition", "Outcome", "Focus Area"} & set(headers)
    obj._generate_json_catalog("English", "en", portfolio(), {"Executive": "Exec"}, "Acme")
    raw = written(obj, ".json")
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = json.loads(base64.b64decode(raw).decode("utf-8"))
    assert all("Strategy Levels" not in u for u in _use_cases(payload))


def _use_cases(node):
    if isinstance(node, dict):
        if "No" in node and "Name" in node:
            return [node]
        return [u for value in node.values() for u in _use_cases(value)]
    if isinstance(node, list):
        return [u for value in node for u in _use_cases(value)]
    return []


def test_the_app_kpi_check_fixture_matches_the_agent_and_covers_negated_sign_words(agent_ns):
    with open(PARITY, encoding="utf-8") as handle:
        fixture = json.load(handle)
    for case in fixture["comparisons"]:
        spec = case["spec"]
        assert agent_ns["kpi_comparison_problem"](spec, case.get("definition") or "", case.get("distinct")) == case["problem"], case["name"]
        assert agent_ns["kpi_filter_mismatch"](spec) == case["mismatch"], case["name"]
    named = {case["name"]: case for case in fixture["comparisons"]}
    assert named["a negated sign word: non-positive amounts filtered with <= 0"]["problem"] == ""
    assert named["a negated sign word: non-positive amounts filtered with > 0"]["problem"].endswith("keeps the rows above 0")
    assert named["a negated sign word: non-positive amounts filtered with < 1"]["problem"].endswith("non positive needs amount <= 0")
    assert named["a positive word kept: positive amounts filtered with >= 0"]["problem"], "a bare positive still compares (must-exclude)"


def test_the_excel_workbook_opens_with_one_filled_column_per_customer_level(docs):
    import openpyxl
    obj = level_obj(docs)
    obj._generate_use_case_excel("English", "en", portfolio())
    path = next(p for p in obj.w_client.workspace.files if str(p).endswith(".xlsx"))
    data = obj.w_client.workspace.files[path]
    book = openpyxl.load_workbook(io.BytesIO(data))
    sheet = book.worksheets[0]
    rows = [[cell.value for cell in row] for row in sheet.iter_rows()]
    header_at = next(i for i, row in enumerate(rows) if "Strategic Goals Alignment" in row)
    headers = rows[header_at]
    at = headers.index("Strategic Goals Alignment")
    assert headers[at + 1:at + 5] == ["Theme", "Ambition", "Outcome", "Focus Area"]
    first = dict(zip(headers, rows[header_at + 1]))
    second = dict(zip(headers, rows[header_at + 2]))
    assert (first["Theme"], first["Ambition"], first["Outcome"], first["Focus Area"]) == (
        "Customer", "Win loyalty", "Grow repeat purchases", "Repeat buyers")
    assert (second["Theme"], second["Outcome"], second["Focus Area"]) == ("Operations", "Cut stockouts", None)


def test_a_level_named_like_a_built_in_column_keeps_its_name_and_the_built_in_takes_a_number(docs):
    import openpyxl
    obj = level_obj(docs)
    obj.strategy_tree = docs["parse_strategic_context"](json.dumps(
        dict(FOUR_LEVELS, levels=["Theme", "Ambition", "Outcome", "Priority"], labels={})))
    headers, _rows, _numeric = obj._catalog_export_table(portfolio())
    at = headers.index("Strategic Goals Alignment")
    assert headers[at + 1:at + 5] == ["Theme", "Ambition", "Outcome", "Priority"], headers
    assert headers.count("Priority") == 1 and "Priority (2)" in headers
    obj._generate_use_case_excel("English", "en", portfolio())
    path = next(p for p in obj.w_client.workspace.files if str(p).endswith(".xlsx"))
    sheet = openpyxl.load_workbook(io.BytesIO(obj.w_client.workspace.files[path])).worksheets[0]
    book_headers = [cell.value for cell in sheet[1]]
    assert book_headers[at + 1:at + 5] == ["Theme", "Ambition", "Outcome", "Priority"]
    level_at = book_headers.index("Priority", at)
    assert [sheet.cell(row=2, column=level_at + 1).value] == ["Repeat buyers"]


def test_a_strategy_typed_in_and_a_strategy_file_give_the_same_user_levels(agent_ns):
    text = json.dumps(FOUR_LEVELS)
    typed = agent_ns["parse_strategic_context"](text)
    from_file = agent_ns["parse_strategic_context"]("/Workspace/Users/me/strategy.json", read_file=lambda path: text)
    assert typed["levels"] == from_file["levels"] == ["Theme", "Ambition", "Outcome", "Focus Area"]
    assert typed["source"] == from_file["source"] == "customer"
    assert [(n["id"], n["level"]) for n, _p in agent_ns["iter_strategy_entries"](typed)] == \
        [(n["id"], n["level"]) for n, _p in agent_ns["iter_strategy_entries"](from_file)]
