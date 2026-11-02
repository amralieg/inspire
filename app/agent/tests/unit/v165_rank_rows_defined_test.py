import pytest

from v140_implement_test import VALID, _FakeRunner, _NotebookWorkspace, _cell, _fill, _flow_inspire, _notebook_inspire, sdk_stub

DEFINE = ("def rank_rows(passes, data_quality_flag, impact, key):\n"
          "    order = sorted(passes.index, key=lambda i: (not passes[i], data_quality_flag[i] != 'ok', -impact[i], key[i]))\n"
          "    return pd.Series(range(1, len(order) + 1), index=order).reindex(passes.index)\n")
USE = ("def build_rank(frame):\n"
       "    frame['rank'] = rank_rows(frame['passes'], frame['data_quality_flag'], frame['value_at_stake'], frame['entity_id'])\n"
       "    return frame\n")
TOP_USE = "scored['rank'] = rank_rows(scored['passes'], scored['flag'], scored['value'], scored['entity_id'])\n"
LAMBDA = "ranker = lambda f: rank_rows(f['passes'], f['flag'], f['value'], f['entity_id'])\n"
OUTER = "def run_use_case(f):\n    return build_rank(f)\n"
TAIL = ("so the run stops with a NameError: no Inspire cell provides rank_rows, so define it yourself at the top level of a cell above "
        "the first cell that calls it, as the rank rule says")


def test_a_notebook_that_calls_rank_rows_without_defining_it_is_sent_back_with_the_cell_and_line(agent_ns):
    check = agent_ns["implement_rank_rows_problems"]
    assert check([("cell 3", "import pandas as pd\n"), ("cell 4", USE)]) == [
        f"cell 4 line 2 calls rank_rows, but no cell defines it, {TAIL}"]


def test_a_call_above_the_definition_is_sent_back_and_names_both_places(agent_ns):
    check = agent_ns["implement_rank_rows_problems"]
    assert check([("cell 3", USE), ("cell 5", DEFINE)]) == [
        f"cell 3 line 2 calls rank_rows above its definition in cell 5 line 1, {TAIL}"]
    assert check([("cell 4", TOP_USE + DEFINE)]) == [f"cell 4 line 1 calls rank_rows above its definition in cell 4 line 2, {TAIL}"]


@pytest.mark.parametrize("cells", [
    [("cell 3", DEFINE), ("cell 4", USE)],
    [("cell 3", DEFINE + USE)],
    [("cell 3", "from helpers import order_rows as rank_rows\n"), ("cell 4", USE)],
    [("cell 3", "rank_rows = make_ranker()\n"), ("cell 4", USE)],
    [("cell 3", "%pip install scikit-learn==1.6.1\n"), ("cell 4", DEFINE), ("cell 5", USE)],
    [("cell 3", "scored['rank'] = ranker.rank_rows(scored)\n")],
    [("cell 3", "def broken(:\n"), ("cell 4", "x = 1\n")],
    [],
])
def test_a_notebook_that_defines_rank_rows_before_it_uses_it_or_never_calls_it_passes(agent_ns, cells):
    assert agent_ns["implement_rank_rows_problems"](cells) == []


TRY_DEFINE = "try:\n    from helpers import rank_rows\nexcept ImportError:\n" + "".join("    " + line + "\n" for line in DEFINE.splitlines())
METHOD = "class Ranker:\n    def rank(self, f):\n        return rank_rows(f['passes'], f['flag'], f['value'], f['entity_id'])\n"


@pytest.mark.parametrize("cells", [
    [("cell 4", USE + DEFINE)],
    [("cell 4", USE + DEFINE + "scored = build_rank(scored)\n")],
    [("cell 3", DEFINE), ("cell 4", USE + OUTER + "run_use_case(scored)\n")],
    [("cell 4", USE + OUTER + DEFINE + "run_use_case(scored)\n")],
    [("cell 4", LAMBDA + DEFINE + "scored = ranker(scored)\n")],
    [("cell 4", METHOD + "ranker = Ranker()\n" + DEFINE + "scored = ranker.rank(scored)\n")],
    [("cell 4", USE + "jobs = [build_rank]\n" + DEFINE)],
    [("cell 3", TRY_DEFINE), ("cell 4", TOP_USE)],
])
def test_a_call_the_run_makes_only_after_the_definition_is_never_sent_back(agent_ns, cells):
    assert agent_ns["implement_rank_rows_problems"](cells) == []


@pytest.mark.parametrize("cells,found", [
    ([("cell 4", USE + "scored = build_rank(scored)\n" + DEFINE)],
     "cell 4 line 4 calls build_rank, which runs rank_rows, above the definition of rank_rows in cell 4 line 5"),
    ([("cell 4", USE + OUTER + "run_use_case(scored)\n" + DEFINE)],
     "cell 4 line 6 calls run_use_case, which runs rank_rows, above the definition of rank_rows in cell 4 line 7"),
    ([("cell 3", USE + OUTER), ("cell 4", "run_use_case(scored)\n"), ("cell 5", DEFINE)],
     "cell 3 line 2 calls rank_rows above its definition in cell 5 line 1"),
    ([("cell 3", DEFINE.replace("rank_rows", "order_rows")), ("cell 4", USE + OUTER + "run_use_case(scored)\n" + DEFINE)],
     "cell 4 line 6 calls run_use_case, which runs rank_rows, above the definition of rank_rows in cell 4 line 7"),
    ([("cell 4", LAMBDA + "scored = ranker(scored)\n" + DEFINE)],
     "cell 4 line 2 calls ranker, which runs rank_rows, above the definition of rank_rows in cell 4 line 3"),
    ([("cell 4", "ranks = [rank_rows(a, b, c, d) for a, b, c, d in parts]\n" + DEFINE)],
     "cell 4 line 1 calls rank_rows above its definition in cell 4 line 2"),
    ([("cell 4", "def score(f, r=rank_rows(a, b, c, d)):\n    return r\n" + DEFINE)],
     "cell 4 line 1 calls rank_rows above its definition in cell 4 line 3"),
    ([("cell 4", "if ready:\n    scored['rank'] = rank_rows(a, b, c, d)\n" + DEFINE)],
     "cell 4 line 2 calls rank_rows above its definition in cell 4 line 3"),
    ([("cell 4", "class Report:\n    ranks = rank_rows(a, b, c, d)\n" + DEFINE)],
     "cell 4 line 2 calls rank_rows above its definition in cell 4 line 3"),
])
def test_a_call_that_runs_before_the_definition_is_sent_back_even_through_the_function_that_holds_it(agent_ns, cells, found):
    assert agent_ns["implement_rank_rows_problems"](cells) == [f"{found}, {TAIL}"]


def test_a_nested_definition_is_not_one_the_run_can_call(agent_ns):
    nested = "def helpers():\n" + "".join("    " + line + "\n" for line in DEFINE.splitlines())
    assert agent_ns["implement_rank_rows_problems"]([("cell 3", nested), ("cell 4", USE)]) == [
        f"cell 4 line 2 calls rank_rows, but no cell defines it, {TAIL}"]


def test_the_cell_check_after_each_genie_round_reports_an_undefined_rank_rows_and_skips_inspire_cells(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"), _cell(None, "import pandas as pd"), _cell(None, USE),
                          _cell(agent_ns["GENIE_NUMBER_HELPERS_TITLE"], DEFINE),
                          _cell("Run controls (Inspire, do not edit)", "def main():\n    inspire_write_summary('f', 't', 'r', 'd')\n")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    problems = [p for p in inst._implement_cell_problems("/W/nb") if "rank_rows" in p]
    assert problems == [f"cell 3 line 2 calls rank_rows, but no cell defines it, {TAIL}"], \
        "a definition in one of Inspire's cells is not one Genie wrote and is not counted"
    notebook["cells"][1] = _cell(None, "import pandas as pd\n" + DEFINE)
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert [p for p in inst._implement_cell_problems("/W/nb") if "rank_rows" in p] == []


def test_the_repair_round_tells_genie_why_and_the_rank_rule_says_to_define_it_first(agent_ns):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 7}, 11, 101)])
    inst.number_reports = [[f"cell 4 line 2 calls rank_rows, but no cell defines it, {TAIL}"], []]
    runner = _FakeRunner([{"exit": 0, "final": _fill()}, {"exit": 0, "final": _fill()}])
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _f = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                         ["result_table", "run_profile"], runner, True)
    assert outcome == {"status": "written", "rows_written": 7} and len(runner.prompts) == 2
    assert "Inspire checked your last attempt and found: cell 4 line 2 calls rank_rows, but no cell defines it" in runner.prompts[1]
    rule = agent_ns["GENIE_RANK_ORDER_RULE"]
    assert rule.startswith("Build `rank` with one function you define yourself, `rank_rows(passes, data_quality_flag, impact, key)`, "
                           "at the top level of a cell above the first cell that calls it: no Inspire cell provides it")
    assert "Inspire sends such a notebook back" in rule
