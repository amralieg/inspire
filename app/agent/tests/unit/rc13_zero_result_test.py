"""REQ-147 item 3 (Amr decision 2A): a chart whose measure is zero for every group is accepted only when the rule has no
exception in its scope (the same chart with no filter applied is zero too). When the rule still finds exceptions, the check
stays strict and sends the flat chart back, so a real bug is not hidden."""
from v141_app_shell_test import checked


def _flat_shape(calls):
    def shape(sql):
        if "`category`" in sql and "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql:
            calls.append(sql)
            return [{"x": "Books", "y0": 0.0}, {"x": "Music", "y0": 0.0}, {"x": "Home", "y0": 0.0}]
        return None
    return shape


def test_an_all_zero_chart_whose_rule_finds_nothing_is_accepted(tmp_path):
    calls = []
    problems, _ws = checked(tmp_path, _flat_shape(calls))
    assert [p for p in problems if "ranks nothing" in p] == [], problems
    assert len(calls) >= 2, "the rule's total is counted with no filter applied, not only at the default filters"


def test_an_all_zero_chart_whose_rule_still_finds_exceptions_stays_strict(tmp_path):
    state = {"n": 0}

    def shape(sql):
        if "`category`" in sql and "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql:
            state["n"] += 1
            value = 0.0 if state["n"] == 1 else 7.0
            return [{"x": "Books", "y0": value}, {"x": "Music", "y0": value}, {"x": "Home", "y0": value}]
        return None

    problems, _ws = checked(tmp_path, shape)
    flat = [p for p in problems if "ranks nothing" in p]
    assert len(flat) == 1 and "gives every group the same Loss (0)" in flat[0], problems
