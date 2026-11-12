"""v1.7.3 SESSION IDS AS TEXT: a 63-bit Inspire session id reaches every JavaScript reader with its digits.

The Inspire App backend, the App UI and the App shell web parse the agent's JSON with JavaScript, which reads
every JSON number as an IEEE double, so a 19-digit session id written as a number arrives with other digits.
Session ids leave the agent as decimal text through inspire_session_id: the use cases of the JSON catalog and
of results_json, the portfolio history and the pipeline steps. A small whole number, such as a count or a
score, stays a JSON number. Readers that group or compare session ids normalize an int from a tracking table
and the text from JSON to one key, a SQL predicate takes a numeric literal built only from checked digits, and
a catalog that released main wrote with numbers loads with the same digits as text. The App shell server answers
with the same rule for every whole number past 2^53 - 1 that a table, a Lakebase copy or a nested value holds, so
two 19-digit record keys stay two records and a page cursor seeks from the exact key.
"""
import ast
import decimal
import json
import math
import os
import pathlib
import sys
import types

import pytest

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import _agentload  # noqa: E402
import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v120_artifacts_session_test import _session_writes  # noqa: E402
from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire  # noqa: E402
from v120_genie_support import FakeLoader, build_inspire, make_uc, schema_details, tracking_row  # noqa: E402
from v120_genie_tracking_launcher_test import FakeSpark as ViewSpark, _tracking_inst  # noqa: E402
from v130_evidence_test import Row  # noqa: E402
from v130_feedback_test import obj_with  # noqa: E402

SID = 2222222222222222222
SID_TEXT = "2222222222222222222"
DEMOS = pathlib.Path(__file__).resolve().parents[2] / "demos"


def javascript_reads(text):
    return json.loads(text, parse_int=float, parse_float=float)


def _writer(ns, tmp_path, monkeypatch, spark=None):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    return ns["AtomicWriter"](spark or FakeSpark(), CapturingLogger(), "my-cat.inspire", SID, widget_values={})


def _catalog_obj(ns, monkeypatch):
    obj = make_inspire(ns, column_id_map={}, id_column_map={}, table_id_map={}, id_table_map={},
                       catalogs_str="main", schemas_str="", generation_path="/Workspace/out", session_id=SID)
    monkeypatch.setattr(ns["workspace"], "ImportFormat", type("F", (), {"AUTO": "AUTO"}), raising=False)
    return obj


def test_the_javascript_reader_of_this_test_changes_the_digits_of_a_19_digit_number():
    assert int(javascript_reads(str(SID))) != SID
    assert javascript_reads(json.dumps(SID_TEXT)) == SID_TEXT


def test_a_use_case_session_id_reaches_a_javascript_reader_of_the_catalog_and_of_results_json(agent_ns, tmp_path,
                                                                                            monkeypatch):
    obj = _catalog_obj(agent_ns, monkeypatch)
    uc = obj._row_to_uc({"id": "N01-U01", "description": "Demo", "business_domain": "Sales", "elite_score": 7,
                         "session_id": SID})
    obj._save_usecases_catalog_json([uc], {}, summary_dict={"Executive": "x"})
    catalog = javascript_reads(next(iter(obj.w_client.workspace.files.values())))
    card = catalog["domains"][0]["use_cases"][0]
    assert card["_source_session_id"] == SID_TEXT
    assert card["elite_score"] == 7 and isinstance(card["elite_score"], float), "a small whole number stays a JSON number"
    writer = _writer(agent_ns, tmp_path, monkeypatch)
    try:
        results = javascript_reads(writer._safe_json_str(obj._merge_run_outcome_into_results()))
    finally:
        writer._session_writer.stop(drain_timeout=5.0)
    assert results["domains"][0]["use_cases"][0]["_source_session_id"] == SID_TEXT
    assert results["data_access"]["tables_read_count"] == 0 and isinstance(results["data_access"]["tables_read_count"], float)


def test_the_discover_genie_targets_carry_the_session_id_as_text(fresh_ns):
    seen = []

    def wave(wave_id, backlog, full_schema_details, document_context, schema_by_table, translations, wave_workers):
        for uc in backlog:
            seen.append(uc.get("_source_session_id"))
            uc["genie_instruction_status"] = "success"
            uc["notebook_status"] = "written"
        return list(backlog), []

    inst = build_inspire(fresh_ns, loader=FakeLoader(), _run_genie_wave=wave, _assemble_skeleton_notebook=lambda uc: "/nb/x.ipynb",
                         _final_rank_key=lambda uc: (-float(uc.get("elite_score") or 0), str(uc.get("No"))), session_id=SID)
    inst.generate_genie_code_for = "all"
    inst._run_discover_skeleton_phase([make_uc("N02-U01"), make_uc("N02-U02")], schema_details())
    assert seen == [SID_TEXT, SID_TEXT]


def test_the_pipeline_steps_carry_the_session_id_as_text(agent_ns, tmp_path, monkeypatch):
    spark = FakeSpark()
    writer = _writer(agent_ns, tmp_path, monkeypatch, spark)
    emitted = []
    monkeypatch.setattr(writer, "emit_step", lambda **kw: emitted.append(kw) or 1)
    monkeypatch.setattr(writer, "flush_pending", lambda **kw: 0)
    writer.finalize_pipeline("Completed", final_results_json={"completed": True})
    [step] = emitted
    assert javascript_reads(writer._safe_json_str(step["result_json"])) == {"session_id": SID_TEXT}
    assert _session_writes(spark) == []


def test_the_portfolio_history_carries_the_session_id_as_text(agent_ns):
    row = Row(use_case_key="cut waste|c.s.stock", use_case_title="Cut waste", status="implemented", reason="", session_id=SID,
              updated_at="2026-10-01")
    unrecorded = Row(use_case_key="grow|c.s.orders", use_case_title="Grow", status="planned", reason="", session_id=None,
                     updated_at="2026-10-01")
    obj, _spark = obj_with(agent_ns, rows=[row, unrecorded])
    obj._load_feedback()
    history = javascript_reads(json.dumps(obj._merge_run_outcome_into_results()["portfolio_history"]))
    assert {entry["use_case_key"]: entry["session_id"] for entry in history} == {"cut waste|c.s.stock": SID_TEXT,
                                                                                 "grow|c.s.orders": None}


def test_one_session_read_as_a_number_and_as_text_is_one_group_and_one_key(fresh_ns):
    inst = build_inspire(fresh_ns)
    contexts, waves = [], []
    inst._load_session_context = lambda sid: contexts.append(sid) or {"business_name": "Acme"}
    inst._build_schema_details_from_use_cases = lambda ucs: []
    inst._build_genie_schema_index = lambda details: {}
    inst._ensure_genie_metadata_loader = lambda: None
    inst._emit_pipeline_status = lambda **kw: 1
    inst._report_genie_outcome = lambda label, processed: {"validated_ids": [uc["No"] for uc in processed]}

    def run(ucs, *args, **kwargs):
        waves.append([(uc["No"], uc["_source_session_id"]) for uc in ucs])
        for uc in ucs:
            uc["notebook_status"] = "written"

    inst._run_genie_waves = run
    rows = [tracking_row("N01-U01", session_id=SID), tracking_row("N01-U02", session_id=SID_TEXT),
            tracking_row("N01-U01", session_id=f" {SID_TEXT} ")]
    assert len(inst._regenerate_genie_for_flagged_rows(rows, "Route 1 (DB flag)")) == 2
    assert contexts == [SID_TEXT]
    assert waves == [[("N01-U01", SID_TEXT), ("N01-U02", SID_TEXT)]]
    assert any("duplicate tracking row for use case N01-U01" in str(call) for call in inst.logger.warning.call_args_list)


def test_one_session_and_use_case_read_as_a_number_and_as_text_is_one_tracking_row(agent_ns):
    spark = ViewSpark()
    inst = _tracking_inst(agent_ns, spark)
    first = dict(make_uc(), _source_session_id=SID, genie_instruction="first " * 40, notebook_path="/nb/a.ipynb")
    second = dict(make_uc(), _source_session_id=SID_TEXT, genie_instruction="second " * 40, notebook_path="/nb/a.ipynb")
    assert inst._merge_regenerated_ucs_into_tracking([first, second]) == 1
    assert spark.views["_inspire_genie_regen_4242_1"] == [(SID, "N01-U01", "second " * 40, "/nb/a.ipynb")]


def test_route_2_matches_a_marked_session_whether_the_notebook_holds_a_number_or_text(agent_ns):
    spark = ViewSpark()
    inst = _tracking_inst(agent_ns, spark)
    inst._scan_notebooks_for_generation_flag = lambda: [{"notebook_path": "/a", "use_case_id": "N01-U01", "session_id": SID},
                                                        {"notebook_path": "/b", "use_case_id": "N01-U02", "session_id": SID_TEXT},
                                                        {"notebook_path": "/c", "use_case_id": "N01-U03", "session_id": "12 OR 1=1"},
                                                        {"notebook_path": "/d", "use_case_id": "N01-U04", "session_id": None}]
    inst._fetch_flagged_use_cases_route2()
    pairs = next(args for text, args in spark.sql_calls if "AND session_id = :s0" in text)
    assert pairs == {"i0": "N01-U01", "s0": SID, "i1": "N01-U02", "s1": SID}
    assert not any("12 OR 1=1" in text or "12 OR 1=1" in json.dumps(args, default=str) for text, args in spark.sql_calls)
    assert any("N01-U03" in str(call) for call in inst.logger.warning.call_args_list)
    assert any(args.get("u0") == "N01-U04" for _text, args in spark.sql_calls), "a notebook without a session id still matches by id"


@pytest.mark.parametrize("bad", ["12 OR 1=1", "1_000", "", " ", None, "12.0", "-", "+5", "\u0661\u0662", "9" * 20, str(2 ** 63),
                                 True, 12.0, float(SID), [SID]])
def test_a_session_id_that_is_not_a_plain_whole_number_never_becomes_a_sql_literal(agent_ns, bad):
    with pytest.raises(ValueError):
        agent_ns["inspire_session_number"](bad)


def test_session_ids_normalize_to_one_text(agent_ns):
    text = agent_ns["inspire_session_id"]
    assert text(SID) == text(SID_TEXT) == text(f" {SID_TEXT}\n") == SID_TEXT
    assert text("007") == "7" and text(-5) == text("-5") == "-5"
    assert text(None) == "" and text("  ") == ""
    assert agent_ns["inspire_session_number"](SID_TEXT) == SID


def test_the_inspire_review_and_run_links_name_the_session_by_its_exact_digits_and_never_by_a_fraction(agent_ns):
    review, page = agent_ns["implement_review_link"], agent_ns["implement_app_hosted_name"]
    url = "https://inspire.example.com"
    want = f"{url}/?review={SID_TEXT}&uc=N01-U01"
    assert review(url, SID, "N01-U01") == review(url, SID_TEXT, "N01-U01") == review(url, f" {SID_TEXT} ", "N01-U01") == want
    assert page("N01-U01", SID) == page("N01-U01", SID_TEXT) == f"n01-u01-{SID_TEXT}"
    assert review(url, 5150, "N01-U01") == f"{url}/?review=5150&uc=N01-U01" and review(url, None, "N01-U01") == ""
    assert review(url, "run 7", "N01 U01") == f"{url}/?review=run%207&uc=N01%20U01", "a session given as text keeps the text"
    for bad in (float(SID), 5150.0, True):
        with pytest.raises(ValueError):
            review(url, bad, "N01-U01")
        with pytest.raises(ValueError):
            page("N01-U01", bad)


def test_the_session_context_query_takes_only_checked_digits(agent_ns):
    spark = ViewSpark()
    inst = build_inspire(agent_ns, spark=spark,
                         atomic_writer=types.SimpleNamespace(enabled=True, session_table="main.inspire.__inspire_session"))
    for bad in ("1_000", float(SID), "12 OR 1=1"):
        assert inst._load_session_context(bad) == {}
    assert spark.sql_calls == []
    assert inst._load_session_context(SID_TEXT) == {}
    [(statement, _args)] = spark.sql_calls
    assert statement.endswith(f"WHERE session_id = {SID_TEXT} LIMIT 1")


def test_a_catalog_released_main_wrote_with_numbers_loads_with_the_same_digits_as_text(fresh_ns):
    path = DEMOS / "bakehouse" / "docs" / "Samples bakehouse-dbx_inspire.json"
    raw = path.read_text(encoding="utf-8")
    shipped = json.loads(raw)
    expected = {uc["No"]: str(uc["_source_session_id"]) for domain in shipped["domains"] for uc in domain["use_cases"]
                if "_source_session_id" in uc}
    assert len(expected) == 5 and all(isinstance(uc.get("_source_session_id", 0), int)
                                      for domain in shipped["domains"] for uc in domain["use_cases"])
    shipped["portfolio_history"] = [{"use_case_key": "cut waste|c.s.stock", "session_id": SID}, {"use_case_key": "x", "session_id": None}]
    fresh_ns["read_user_text_file"] = lambda name, w_client=None: json.dumps(shipped)
    obj = make_inspire(fresh_ns)
    use_cases, _summary, _grouped = obj._load_usecases_catalog_json(str(path))
    assert {uc["No"]: uc["_source_session_id"] for uc in use_cases if "_source_session_id" in uc} == expected
    results = javascript_reads(json.dumps(obj._merge_run_outcome_into_results(), default=str))
    assert {uc["No"]: uc["_source_session_id"] for d in results["domains"] for uc in d["use_cases"] if "_source_session_id" in uc} == expected
    assert [entry["session_id"] for entry in results["portfolio_history"]] == [SID_TEXT, None]
    assert path.read_text(encoding="utf-8") == raw


def _helper_call(node, name="inspire_session_id"):
    if isinstance(node, ast.BoolOp):
        node = node.values[0]
    return isinstance(node, ast.Call) and getattr(node.func, "id", "") == name


def test_every_session_id_the_agent_puts_in_its_json_goes_through_the_one_helper():
    src = _agentload.agent_source()
    tree = _agentload.agent_ast()
    assert src.count("def inspire_session_id(") == 1 and src.count("def inspire_session_number(") == 1
    use_case_sites = [node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                      and any(isinstance(t, ast.Subscript) and getattr(t.slice, "value", None) == "_source_session_id" for t in node.targets)]
    assert len(use_case_sites) == 3 and all(_helper_call(node.value) for node in use_case_sites)
    step_sites = [value for node in ast.walk(tree) if isinstance(node, ast.keyword) and node.arg == "result_json"
                  and isinstance(node.value, ast.Dict)
                  for key, value in zip(node.value.keys, node.value.values) if getattr(key, "value", None) == "session_id"]
    assert len(step_sites) == 4 and all(_helper_call(value) for value in step_sites)
    history = ast.get_source_segment(src, _agentload.method_node("DatabricksInspire", "_load_feedback"))
    assert '"session_id": inspire_session_id(row.session_id) or None' in history


SHELL_PAGE = {"id": "p", "datasets": [{"name": "records", "sql": "SELECT * FROM main.s.big_keys"}],
              "records": {"key": "id", "label": "label", "rank": "n", "columns": [{"column": "score", "format": "number"}]}}


def _shell_rows(columns, raw):
    manifest = {"schema": {"columns": [{"name": name, "type_name": kind} for name, kind in columns]}}
    return shell_db.rows_of(manifest, [raw], 10)["rows"]


def test_a_19_digit_whole_number_the_app_shell_answers_with_reaches_the_browser_with_its_digits():
    columns = (("id", "LONG"), ("label", "STRING"), ("n", "INT"), ("score", "DOUBLE"), ("wide", "DECIMAL"), ("amount", "DECIMAL"),
               ("tags", "ARRAY"))
    rows = _shell_rows(columns, [[SID_TEXT, "a", "42", "1.5", SID_TEXT, "12.50", f"[{SID_TEXT}, 7]"],
                                 [str(SID + 1), "b", "5555555555555555", "2.5", "3", "0.25", "[]"]])
    seen = javascript_reads(json.dumps(rows))
    assert [row["id"] for row in seen] == [SID_TEXT, str(SID + 1)], "two 19-digit record keys stay two keys"
    assert seen[0]["wide"] == SID_TEXT and seen[0]["tags"] == [SID_TEXT, 7.0]
    assert rows[0]["n"] == 42 and rows[1]["n"] == 5555555555555555 and all(isinstance(row["n"], int) for row in rows)
    assert rows[0]["score"] == 1.5 and rows[0]["amount"] == 12.5 and rows[1]["wide"] == 3.0 and isinstance(rows[1]["wide"], float)


def test_the_largest_whole_number_a_browser_keeps_stays_a_number_and_the_next_one_is_text():
    safe, cell = 2 ** 53 - 1, shell_db.cell_value
    assert float(safe) == safe and float(safe + 1) == float(safe + 2), "past 2^53 - 1 two whole numbers share one double"
    assert cell(str(safe + 1), "LONG") == str(safe + 1) and cell(str(-safe - 1), "LONG") == str(-safe - 1)
    assert cell(str(safe + 1), "DECIMAL") == str(safe + 1) and cell(str(safe), "DECIMAL") == float(safe)
    assert cell(str(safe), "LONG") == safe and cell(str(-safe), "LONG") == -safe and isinstance(cell(str(safe), "LONG"), int)
    assert cell(" 42 ", "INT") == 42 and cell("12.0", "LONG") == 12 and cell("x", "LONG") == "x" and cell(None, "LONG") is None
    assert shell_db.BROWSER_SAFE_WHOLE == safe


def test_a_lakebase_copy_answers_with_the_same_digits_as_the_warehouse():
    assert shell_pg.cell(SID) == SID_TEXT and shell_pg.cell(-SID) == f"-{SID_TEXT}"
    assert shell_pg.cell(42) == 42 and shell_pg.cell(True) is True and shell_pg.cell("x") == "x"
    assert shell_pg.cell(decimal.Decimal(SID_TEXT)) == SID_TEXT and shell_pg.cell(decimal.Decimal("12.50")) == 12.5
    assert shell_pg.cell(decimal.Decimal("3")) == 3.0 and math.isnan(shell_pg.cell(decimal.Decimal("NaN")))
    assert shell_pg.cell({"ids": [SID, 1], "n": {"m": SID}}) == {"ids": [SID_TEXT, 1], "n": {"m": SID_TEXT}}


def test_a_page_cursor_on_a_19_digit_key_seeks_from_the_exact_key_after_a_browser_round_trip():
    columns = {"id": "LONG", "label": "STRING", "n": "INT", "score": "DOUBLE"}
    context = dict(shell_sql.list_context(SHELL_PAGE, columns, None, False), types=columns, money=[])
    rows = _shell_rows(columns.items(), [[SID_TEXT, "a", "1", "0.5"], [str(SID + 1), "b", "2", "1.5"]])
    first = {"page": "p", "sort": {"key": "id", "dir": "asc"}, "offset": 0, "limit": 2}
    cursors = shell_core.list_cursors(shell_sql.list_request(SHELL_PAGE, first, context), context, rows, 5)
    sent = javascript_reads(json.dumps(cursors["next"]))
    sql, params = shell_sql.list_queries(SHELL_PAGE, {}, shell_sql.list_request(SHELL_PAGE, dict(first, offset=2, cursor=sent), context),
                                         context)["rows"]
    assert "OFFSET" not in sql and "CAST(:p1 AS BIGINT)" in sql
    assert [param["value"] for param in params] == [str(SID + 1), str(SID + 1)]
