"""REQ-531 (server): records/compare returns one reply shape for four views of a record: its own history, a cohort of similar
records, records the user picked, and the whole population. Every number comes from the server's reads, never from a model.
Synthetic neutral rows; execute() is a fake that answers by the shape of the SQL and records every statement it is given."""
import copy
import statistics

import pytest

from v141_app_shell_test import PAGE, shell  # noqa: F401  (loads the shell module path)
import shell_core
import shell_sql

MEASURE, COHORT = "score", "group_name"
PAGE_C = dict(copy.deepcopy(PAGE), result_table="cat.sch.tbl")
PAGE_C["records"] = dict(PAGE_C.get("records") or {}, rank="rank", tier="priority_tier", reasons="", key="record_key",
                         columns=[{"column": "rank", "label": "Rank", "format": "integer"},
                                  {"column": MEASURE, "label": "Score", "format": "number"}])
FIELDS = [{"name": n} for n in ("record_key", "rank", MEASURE, COHORT, "priority_tier", "valid_from", "is_current", "change_source")]
THIS = {"record_key": "R1", "rank": 3, MEASURE: 10.0, COHORT: "g1", "priority_tier": "Monitor"}
ROWS = {  # the current rows of the fixture table
    "R1": THIS,
    "R2": {"record_key": "R2", "rank": 1, MEASURE: 4.0, COHORT: "g1"},
    "R3": {"record_key": "R3", "rank": 2, MEASURE: 8.0, COHORT: "g1"},
    "R4": {"record_key": "R4", "rank": 4, MEASURE: 20.0, COHORT: "g2"},
}
VERSIONS = [  # newest first, as history_query returns them
    {"record_key": "R1", MEASURE: 10.0, "rank": 3, "valid_from": "2026-03-01", "is_current": True, "change_source": "run", shell_sql.VERSION_COLUMN: "3"},
    {"record_key": "R1", MEASURE: 6.0, "rank": 5, "valid_from": "2026-02-01", "is_current": False, "change_source": "run", shell_sql.VERSION_COLUMN: "2"},
    {"record_key": "R1", MEASURE: 2.0, "rank": 7, "valid_from": "2026-01-01", "is_current": False, "change_source": "run", shell_sql.VERSION_COLUMN: "1"},
]
POP = {"n": 4, "mean": 10.5, "sd": 6.7, "above": 1, "below": 2, "flagged": 3}


class Rows:
    def __init__(self, record=THIS):
        self.calls, self.record = [], record

    def __call__(self, ws, sql, params, limit, delta=False, **_):
        self.calls.append((sql, params))
        if "ORDER BY `valid_from` DESC" in sql:
            return {"rows": VERSIONS}
        if "STDDEV_SAMP(d.s)" in sql:
            return {"rows": [POP]}
        if "AS `_inspire_cohort_n`" in sql:
            return {"rows": [{"n": 3, "mean": statistics.mean([10.0, 4.0, 8.0]), "sd": statistics.stdev([10.0, 4.0, 8.0])}]}
        if "AS `x`" in sql:
            asc = "ASC" in sql
            rows = sorted(({"record_key": k, "x": r[MEASURE if MEASURE in sql else "rank"]} for k, r in ROWS.items() if r[COHORT] == "g1"),
                          key=lambda r: r["x"], reverse=not asc)
            return {"rows": rows}
        if "`record_key` IN" in sql:
            wanted = [k for k in (p["value"] for p in params if p["type"] == "STRING")]
            import json
            keys = json.loads(wanted[0])
            return {"rows": [ROWS[k] for k in keys if k in ROWS] if self.record is THIS else [self.record]}
        raise AssertionError(f"unexpected SQL: {sql}")


def make(record=THIS):
    fake = Rows(record)
    s = shell_core.Shell.__new__(shell_core.Shell)
    s.execute = fake
    s.page = lambda ident: PAGE_C
    s.workspace = lambda headers: (object(), "u")
    s.change_table = lambda ws, who, page: FIELDS
    s.history_for = lambda *a, **k: None
    return s, fake


def compare(s, **q):
    return shell_core.Shell.record_compare(s, {}, dict({"page": "p", "record_key": "R1"}, **q))


def hand(xs):
    mean, sd = statistics.mean(xs), statistics.stdev(xs)
    return mean, sd, [mean - sd, mean + sd]


SHAPE = {"mode", "measure", "direction", "this", "points", "band", "n", "note"}


def test_history_mode_gives_versions_in_time_order_with_the_hand_computed_band():
    s, _ = make()
    out = compare(s, mode="history", measure=MEASURE)
    xs = [2.0, 6.0, 10.0]
    mean, sd, band = hand(xs)
    assert set(out) == SHAPE and out["mode"] == "history" and out["measure"] == MEASURE
    assert [p["x"] for p in out["points"]] == xs and [p["t"] for p in out["points"]] == ["2026-01-01", "2026-02-01", "2026-03-01"]
    assert out["band"] == pytest.approx(band) and out["n"] == 3 and out["this"] == {"key": "R1", "x": 10.0}
    assert isinstance(out["note"], str) and out["note"]


def test_cohort_mode_gives_n_mean_sd_and_a_sample_of_the_rows_sharing_the_cohort_value():
    s, fake = make()
    out = compare(s, mode="cohort", measure=MEASURE, cohort_column=COHORT)
    xs = [10.0, 4.0, 8.0]
    mean, sd, band = hand(xs)
    assert set(out) == SHAPE and out["n"] == 3 and out["band"] == pytest.approx(band)
    assert sorted(p["x"] for p in out["points"]) == sorted(xs) and len(out["points"]) <= 20
    assert any(p["value"] == "g1" for _, ps in fake.calls for p in ps), "the cohort value is this record's own, passed as a parameter"
    assert out["direction"] == "higher" and [p["x"] for p in out["points"]] == [10.0, 8.0, 4.0]


def test_a_lower_is_better_measure_reads_lower_and_cohort_points_are_ascending():
    s, _ = make()
    out = compare(s, mode="cohort", measure="rank", cohort_column=COHORT)
    assert out["direction"] == "lower" and [p["x"] for p in out["points"]] == [1, 2, 3]


def test_picked_mode_puts_this_record_first_then_the_picked_ones_in_the_order_given():
    s, _ = make()
    out = compare(s, mode="picked", measure=MEASURE, keys="R3,R2,R4")
    xs = [10.0, 8.0, 4.0, 20.0]
    mean, sd, band = hand(xs)
    assert set(out) == SHAPE and [p["key"] for p in out["points"]] == ["R1", "R3", "R2", "R4"]
    assert out["n"] == 4 and out["band"] == pytest.approx(band) and [p["x"] for p in out["points"]] == [10.0, 8.0, 4.0, 20.0]


def test_picked_with_eleven_keys_is_refused_and_no_sql_runs():
    s, fake = make()
    with pytest.raises(shell_core.HttpError) as e:
        compare(s, mode="picked", measure=MEASURE, keys=",".join(f"K{i}" for i in range(11)))
    assert e.value.status == 400 and not fake.calls


def test_an_unknown_measure_or_cohort_column_is_a_400_naming_it_and_no_sql_runs():
    s, fake = make()
    with pytest.raises(shell_core.HttpError) as e:
        compare(s, mode="history", measure="nope_col")
    assert e.value.status == 400 and "nope_col" in str(e.value.message if hasattr(e.value, "message") else e.value)
    with pytest.raises(shell_core.HttpError) as e:
        compare(s, mode="cohort", measure=MEASURE, cohort_column="bad`col")
    assert e.value.status == 400 and "bad`col" in str(e.value.message if hasattr(e.value, "message") else e.value)
    assert not fake.calls


def test_a_mode_outside_the_four_is_a_400_listing_them():
    s, fake = make()
    with pytest.raises(shell_core.HttpError) as e:
        compare(s, mode="sideways")
    text = str(e.value.message if hasattr(e.value, "message") else e.value)
    assert e.value.status == 400 and all(m in text for m in ("history", "cohort", "picked", "population")) and not fake.calls


def test_a_null_cohort_value_gives_n_zero_and_a_note_without_raising():
    s, _ = make(dict(THIS, **{COHORT: None}))
    out = compare(s, mode="cohort", measure=MEASURE, cohort_column=COHORT)
    assert out["n"] == 0 and out["band"] is None and out["points"] == [] and out["note"]


def test_population_mode_matches_records_population_for_the_same_record():
    s, _ = make()
    pop = shell_core.Shell.record_population(s, {}, {"page": "p", "record_key": "R1"})["compared"]
    out = compare(s, mode="population")
    assert set(out) == SHAPE and out["n"] == pop["n"] and out["direction"] == pop["direction"]
    assert out["band"] == pop["band"] and out["this"]["x"] == pop["x"]
    assert [p["x"] for p in out["points"]] == [p["x"] for p in pop["points"]]
    assert out["points"][1]["x"] == pop["mean"] and out["measure"] == "rank"
