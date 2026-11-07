"""A preview of a model whose user set no bound on its training data trains on a fixed sample of at most 20 x the preview's
entity cap, picked by a stable hash of the entity key; a full run trains on every row; the run summary, the outcome text and the
ready message say when a preview trained on a sample; and a build whose cells never pass the training rows through the sample
helper goes back to Genie, offline."""
import hashlib
import json
import sqlite3
import types

import pytest

from v120_artifacts_support import FakeSpark
from v130_genie_run_controls_test import _controls, _dbutils, _launcher
from v140_implement_test import (VALID, _cell, _fill, _FakeRunner, _flow_inspire, _notebook_inspire, _NotebookWorkspace,  # noqa: F401
                                 _probe_inspire, sdk_stub)
from v142_scd_test import TABLE, _Frame
from v148_record_ai_fields_test import MEASURED

TPCDS_PROFILES = {"full_load": {}, "preview": {"entity_cap": 1000}, "retrain": {}, "training": {}}
SAMPLE_LINE = "- Preview training sample: "
SAMPLED = 20000


def _spec(ns, data=None, profiles=None, widgets=None):
    raw = json.loads(json.dumps(VALID))
    raw["data"] = dict({"tables": {}, "filters": [], "run_profile": "preview", "window": {"start": "", "end": ""}}, **(data or {}))
    raw["config"] = dict(raw["config"], profiles=TPCDS_PROFILES if profiles is None else profiles, widgets=widgets or {})
    spec, errors = ns["validate_implement_spec"](raw)
    assert errors == [], errors
    return spec


def _hash(*parts):
    text = "\x1f".join("" if p is None else str(p) for p in parts)
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big", signed=True)


class _LiteFrame:
    def __init__(self, db, sql, write=True):
        self.db, self.sql = db, sql
        if write:
            self.write = object()

    @property
    def columns(self):
        return [d[0] for d in self.db.execute(self._lite() + " LIMIT 0").description]

    def _lite(self):
        sqlglot = pytest.importorskip("sqlglot")
        return sqlglot.transpile(self.sql, read="databricks", write="sqlite")[0]

    def _next(self, sql):
        return _LiteFrame(self.db, sql)

    def where(self, condition):
        return self._next(f"SELECT * FROM ({self.sql}) AS w WHERE {condition}")

    def selectExpr(self, *exprs):
        return self._next(f"SELECT {', '.join(exprs)} FROM ({self.sql}) AS e")

    def distinct(self):
        return self._next(f"SELECT DISTINCT * FROM ({self.sql}) AS d")

    def orderBy(self, *columns):
        frame = self._next(f"SELECT * FROM ({self.sql}) AS o ORDER BY {', '.join(columns)}")
        frame.ordered = (self.sql, columns)
        return frame

    def limit(self, n):
        source, columns = getattr(self, "ordered", (self.sql, ()))
        order = f" ORDER BY {', '.join(columns)}" if columns else ""
        return self._next(f"SELECT * FROM ({source}) AS l{order} LIMIT {int(n)}")

    def collect(self):
        cursor = self.db.execute(self._lite())
        names = [d[0] for d in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]

    def toPandas(self):
        import pandas
        return pandas.DataFrame(self.collect())


def _rows(entities, per_entity=3, key="customer_id"):
    db = sqlite3.connect(":memory:")
    db.create_function("XXHASH64", -1, _hash)
    db.execute(f"CREATE TABLE training ({key} TEXT, store TEXT, amount REAL)")
    rows = [(f"c{n:03d}", f"s{n % 4}", float(n * 10 + i)) for n in range(entities) for i in range(per_entity)]
    rows += [(None, "s0", 1.0)]
    db.executemany("INSERT INTO training VALUES (?, ?, ?)", rows)
    return db, _LiteFrame(db, "SELECT * FROM training")


def _sampler(ns, profile="preview", cap=SAMPLED):
    ns["INSPIRE_RUN"] = {"preview_training_entities": cap} if cap else {}
    ns["dbutils"] = _dbutils(run_profile=profile)
    ns.pop("INSPIRE_PREVIEW_SAMPLE", None)
    printed = []
    return printed


def test_no_bound_on_the_training_data_means_a_preview_trains_on_twenty_times_the_entity_cap(agent_ns):
    cap = agent_ns["implement_preview_training_cap"]
    assert agent_ns["IMPLEMENT_PREVIEW_TRAINING_FACTOR"] == 20 and agent_ns["IMPLEMENT_PREVIEW_ENTITY_CAP"] == 1000
    assert cap(_spec(agent_ns)) == SAMPLED, "the live TPC-DS build: empty profiles, an empty window, no filter"
    assert cap(_spec(agent_ns, profiles=dict(TPCDS_PROFILES, preview={"entity_cap": 250}))) == 5000
    assert cap(_spec(agent_ns, profiles={})) == SAMPLED, "no preview cap set means the preview's default cap"
    for unbounding in ({"training": {"stratify_by": "region"}}, {"full_load": {"window_days": 30}}, {"retrain": {"every_runs": 4}}):
        assert cap(_spec(agent_ns, profiles=dict(TPCDS_PROFILES, **unbounding))) == SAMPLED, unbounding
    assert cap(_spec(agent_ns, data={"notes": "use the champion threshold"})) == SAMPLED, \
        "notes are the customer's words, which Genie reads; the rule tells Genie they win"


@pytest.mark.parametrize("data,profiles", [
    ({"window": {"start": "2024-01-01", "end": ""}}, None),
    ({"window": {"start": "", "end": "2025-06-30"}}, None),
    ({"filters": [{"table": "main.s.orders", "column": "region", "op": "in", "values": ["EU"]}]}, None),
    (None, dict(TPCDS_PROFILES, training={"window_days": 365})),
    (None, dict(TPCDS_PROFILES, training={"sample_entities": 5000})),
], ids=["window_start", "window_end", "filter", "training_window", "training_sample"])
def test_a_bound_the_user_set_wins_and_the_preview_trains_on_it(agent_ns, data, profiles):
    assert agent_ns["implement_preview_training_cap"](_spec(agent_ns, data=data, profiles=profiles)) is None


def test_a_use_case_that_trains_no_model_has_no_training_sample(agent_ns):
    assert agent_ns["implement_preview_training_cap"](_spec(agent_ns), trains_model=False) is None
    lines = agent_ns["_implement_choice_lines"](_spec(agent_ns), trains_model=False)
    assert not any(line.startswith(SAMPLE_LINE) for line in lines)
    assert any("With `preview`, cover at most 1,000 entities" in line for line in lines)


def test_the_choices_tell_genie_to_train_a_preview_on_the_sample_only_when_the_user_set_no_bound(agent_ns):
    lines = agent_ns["_implement_choice_lines"](_spec(agent_ns))
    [sample] = [line for line in lines if line.startswith(SAMPLE_LINE)]
    assert ("the user set no data window, training profile or row filter, so the training profile is the whole history, and a "
            "preview trains on at most 20,000 of its entities, 20 times the 1,000 it scores") in sample
    assert "through `inspire_training_sample(frame, key)`, which the Run controls cell defines" in sample
    assert "in a `full` run it returns every row, so a full run trains on all of them" in sample
    assert ("If the customer's asks for this notebook, or a widget value the user set above, say how much history or which entities "
            "the model trains on, they are explicit user directives and win: train on what they say, without inspire_training_sample.") \
        in sample
    [profile] = [line for line in lines if "dropdown widget `run_profile`" in line]
    assert "as usual" not in profile, "a preview with no bound trained on the whole history 'as usual' for over 25 minutes"
    assert ("With `preview`, train on the training profile and score at most 1,000 entities, so a run finishes in minutes; with `full`, "
            "train on the whole training profile and score the whole full-load profile.") in profile
    bounded = agent_ns["_implement_choice_lines"](_spec(agent_ns, data={"window": {"start": "2024-01-01", "end": ""}}))
    assert not any(line.startswith(SAMPLE_LINE) for line in bounded)
    assert "- Read history from 2024-01-01 to the latest date only." in bounded
    notes = agent_ns["_implement_choice_lines"](_spec(agent_ns, data={"notes": "train on the last two years"}))
    assert [i for i, l in enumerate(notes) if l.startswith(SAMPLE_LINE)][0] < [i for i, l in enumerate(notes) if "word for word" in l][0]


def test_withdrawing_the_sample_when_the_user_adds_a_window_tells_genie_to_take_it_out(agent_ns):
    before, after = _spec(agent_ns), _spec(agent_ns, data={"window": {"start": "2024-01-01", "end": ""}})
    text = agent_ns["implement_choices_markdown"](after, before)
    assert "- Withdrawn since the earlier version: Preview training sample: the user set no data window" in text


def test_a_preview_keeps_the_entities_with_the_lowest_hash_and_every_row_of_each(fresh_ns):
    printed = _sampler(fresh_ns, cap=10)
    db, frame = _rows(30)
    sampled = fresh_ns["inspire_training_sample"](frame, "customer_id", out=printed.append)
    rows = sampled.collect()
    kept = sorted({r["customer_id"] for r in rows})
    lowest = sorted(sorted({f"c{n:03d}" for n in range(30)}, key=_hash)[:10])
    assert kept == lowest and len(rows) == 30, "10 entities, all 3 rows of each"
    assert fresh_ns["inspire_preview_sample_entities"]() == 10
    assert printed == ["Preview sample: this preview trains on 10 entities of the training rows, which hold more, picked by a stable "
                       "hash of customer_id so every preview of the same data trains on the same ones; a full run trains on every training row"]
    db.execute("DELETE FROM training")
    db.executemany("INSERT INTO training VALUES (?, ?, ?)",
                   [(f"c{n:03d}", f"s{n % 4}", float(n * 10 + i)) for n in reversed(range(30)) for i in range(3)])
    again = fresh_ns["inspire_training_sample"](frame, "customer_id", out=lambda *_a: None)
    assert sorted({r["customer_id"] for r in again.collect()}) == lowest, "every preview of the same data trains on the same entities"


def test_a_composite_key_and_a_pandas_frame_are_sampled_the_same_way(fresh_ns):
    import pandas
    _sampler(fresh_ns, cap=4)
    db, frame = _rows(12)
    session = types.SimpleNamespace(createDataFrame=lambda pdf: _LiteFrame(db, "SELECT * FROM training"))
    from_pandas = fresh_ns["inspire_training_sample"](pandas.DataFrame(frame.collect()), "customer_id", spark_session=session,
                                                     out=lambda *_a: None)
    assert isinstance(from_pandas, pandas.DataFrame) and from_pandas["customer_id"].nunique() == 4
    pairs = fresh_ns["inspire_training_sample"](frame, ["customer_id", "store"], out=lambda *_a: None)
    assert len({(r["customer_id"], r["store"]) for r in pairs.collect()}) == 4


def test_a_full_run_an_unbounded_spec_off_or_few_entities_train_on_every_row(fresh_ns):
    db, frame = _rows(30)
    for profile, cap in (("full", 10), ("preview", 0)):
        _sampler(fresh_ns, profile=profile, cap=cap)
        assert fresh_ns["inspire_training_sample"](frame, "customer_id", out=pytest.fail) is frame, (profile, cap)
        assert fresh_ns["inspire_preview_sample_entities"]() is None
    printed = _sampler(fresh_ns, cap=30)
    assert fresh_ns["inspire_training_sample"](frame, "customer_id", out=printed.append) is frame
    assert fresh_ns["inspire_preview_sample_entities"]() is None, "a sample that keeps every entity is no sample"
    assert printed == ["Preview sample: the training rows hold 30 entities by customer_id, no more than the 30 a preview trains on, "
                       "so this preview trains on all of them"]


def test_a_missing_key_is_refused_with_the_column_it_needs(fresh_ns):
    _sampler(fresh_ns, cap=10)
    _db, frame = _rows(5)
    with pytest.raises(ValueError, match="inspire_training_sample: the training rows have no account_id column"):
        fresh_ns["inspire_training_sample"](frame, "account_id")
    with pytest.raises(ValueError, match=r"inspire_training_sample\(frame, key\) needs the entity key column"):
        fresh_ns["inspire_training_sample"](frame, [])


def test_the_sample_expressions_are_databricks_sql(agent_ns):
    sqlglot = pytest.importorskip("sqlglot")
    present, hashed = agent_ns["inspire_training_sample_sql"](["customer_id", "store id"])
    assert hashed == "xxhash64(CAST(`customer_id` AS STRING), CAST(`store id` AS STRING))"
    assert present == "`customer_id` IS NOT NULL AND `store id` IS NOT NULL"
    sqlglot.parse_one(f"SELECT {hashed} AS h FROM t WHERE {present}", read="databricks")


def test_the_run_summary_records_the_sample(agent_ns):
    assert agent_ns["INSPIRE_VALUE_COLUMNS"][-1] == ("preview_sample_entities", "BIGINT")
    assert ("accepted BOOLEAN, preview_sample_entities BIGINT, passing_records BIGINT, act_now_share DOUBLE, review_share DOUBLE, "
            "impact_kind STRING, ") in agent_ns["inspire_ai_summary_create_sql"](TABLE)
    assert agent_ns["inspire_ai_summary_create_sql"](TABLE).endswith(
        "act_now_capacity BIGINT, over_capacity_records BIGINT, not_reliable STRING, run_facts STRING, updated_at TIMESTAMP)")
    columns = agent_ns["inspire_value_columns_sql"]
    assert columns(dict(MEASURED, accepted=True, preview_sample_entities=SAMPLED), None, None)["preview_sample_entities"] == "20000"
    assert columns(dict(MEASURED, accepted=True, preview_sample_entities=None), None, None)["preview_sample_entities"] == "NULL"
    assert columns(dict(MEASURED, accepted=None), None, None)["preview_sample_entities"] == "NULL"


def test_the_write_hands_this_run_s_sample_to_the_summary(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"decision_basis": "predicted"}
    fresh_ns["dbutils"] = types.SimpleNamespace(widgets=types.SimpleNamespace(get={"currency": "USD", "run_profile": "preview"}.__getitem__))
    seen = []
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, out=print, ai=None, ai_cap=None, value=None, nothing_to_act=None, \
        accepted=None: seen.append(value) or 3
    frame = _Frame([("entity_id", "string"), ("value_at_stake", "double")])
    fresh_ns["INSPIRE_PREVIEW_SAMPLE"] = SAMPLED
    fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None, accepted=True)
    assert seen[-1]["preview_sample_entities"] == SAMPLED and seen[-1]["accepted"] is True
    fresh_ns.pop("INSPIRE_PREVIEW_SAMPLE")
    fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None, accepted=True)
    assert seen[-1]["preview_sample_entities"] is None


def _run_main(ns, use_case, **widgets):
    dbu = _dbutils(**{ns["INSPIRE_RUN"]["marker"]: "1", **widgets})
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["dbutils"] = dbu
    ns["spark"] = FakeSpark()
    ns["run_use_case"] = use_case
    launcher, _calls = _launcher(ns)
    return ns["inspire_main"](dbu=dbu, launcher_cls=launcher, out=lambda *_a: None), dbu


def test_the_outcome_says_the_model_trained_on_a_preview_sample_and_the_agent_reads_it(agent_ns):
    ns, _call = _controls(agent_ns)
    ns["INSPIRE_RUN"] = dict(ns["INSPIRE_RUN"], preview_training_entities=10)
    _db, frame = _rows(30)
    written = {"status": "written", "rows_written": 1000, "as_of_date": "2026-10-01", "run_id": "5f0c1d2e"}

    def trains():
        ns["inspire_training_sample"](frame, "customer_id", out=lambda *_a: None)
        return written

    gate, dbu = _run_main(ns, trains, run_profile="preview")
    text = "wrote 1,000 rows for as_of_date 2026-10-01 with run_id 5f0c1d2e; the model trained on a preview sample of 10 entities"
    assert gate["outcome"] == text and dbu.notebook.exits == [text]
    parsed = agent_ns["parse_use_case_outcome"](f"Job run finished: {text}\n\nPrinted log of this run:\nPreview sample: this preview ...")
    assert parsed == dict(written, preview_sample_entities=10)
    gate, _dbu = _run_main(ns, lambda: written, run_profile="preview")
    assert gate["outcome"] == "wrote 1,000 rows for as_of_date 2026-10-01 with run_id 5f0c1d2e", \
        "the next run in the same session starts with no sample"
    assert agent_ns["parse_use_case_outcome"](gate["outcome"]) == written
    gate, _dbu = _run_main(ns, trains, run_profile="full")
    assert gate["outcome"] == "wrote 1,000 rows for as_of_date 2026-10-01 with run_id 5f0c1d2e", "a full run trains on every row"


def test_the_run_controls_carry_the_sample_size_only_when_a_preview_samples(agent_ns):
    import ast
    from v120_genie_support import build_inspire, make_uc
    inst, uc = build_inspire(agent_ns), make_uc()
    spec = inst._genie_notebook_spec(uc)

    def run(use_case):
        source = inst._genie_run_controls_source(use_case, spec, str(uc.get("genie_instruction") or ""))
        return ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])

    assert run(dict(uc, _implement_preview_training=SAMPLED))["preview_training_entities"] == SAMPLED
    assert "preview_training_entities" not in run(dict(uc, _implement_preview_training=None))
    assert "preview_training_entities" not in run(uc)


def test_a_build_whose_cells_never_pass_the_training_rows_through_the_sample_is_sent_back(agent_ns):
    check = agent_ns["implement_training_sample_problems"]
    missing = ("no cell calls inspire_training_sample: the user set no data window, training profile, row filter, widget value or asks "
               "for this notebook, so a preview trains on the sample it keeps, as the Implementation Choices say: pass the training rows "
               "through inspire_training_sample(frame, key) right before the model reads them")
    assert check([("cell 4", "model.fit(train)\n")], required=True) == [missing]
    assert check([("cell 4", "train = inspire_training_sample(rows, 'customer_id')\nmodel.fit(train)\n")], required=True) == []
    assert check([("cell 4", "model.fit(train)\n")], required=False) == []
    assert check([("cell 4", "def inspire_training_sample(frame, key):\n    return frame\n"), ("cell 5", "x = inspire_training_sample(r, 'k')")],
                 required=True) == ["cell 4 defines inspire_training_sample, which Inspire's Run controls cell defines: delete that "
                                    "definition and call Inspire's"]
    assert check([("cell 4", "def broken(:\n")], required=False) == []


def test_the_cell_check_asks_for_the_sample_only_in_genie_cells_and_only_when_it_applies(agent_ns, sdk_stub):
    notebook = {"cells": [_cell("Genie Code instruction", "# instruction"),
                          _cell(agent_ns["GENIE_NUMBER_HELPERS_TITLE"], agent_ns["GENIE_NUMBER_TEXT_SOURCE"]),
                          _cell(None, "z = fmt_num(3)\nmodel.fit(rows)\ninspire_write_summary(spark, table, facts, run_id, as_of_date)"),
                          _cell("Run controls (Inspire, do not edit)", "x = inspire_training_sample(rows, 'k')")]}
    inst = _notebook_inspire(agent_ns, _NotebookWorkspace(notebook, modified_at=5))
    assert inst._implement_cell_problems("/W/nb") == []
    assert [p.split(":")[0] for p in inst._implement_cell_problems("/W/nb", training_sample=True)] == [
        "no cell calls inspire_training_sample"], "Inspire's own Run controls cell does not count as Genie's call"


@pytest.mark.parametrize("changes,trains,required", [
    ({}, True, True),
    ({"data": {"notes": "train on 2025 only"}}, True, False),
    ({"widgets": {"lookback_weeks": "12"}}, True, False),
    ({"data": {"window": {"start": "2024-01-01", "end": ""}}}, True, False),
    ({}, False, False),
], ids=["no_bound", "notes", "widget_value", "window", "no_model"])
def test_the_build_round_checks_the_sample_call_only_when_no_user_directive_can_bound_the_training(agent_ns, changes, trains, required):
    spec = _spec(agent_ns, **changes)
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 102)])
    asked = []
    inst._implement_cell_problems = lambda path, training_sample=False, grouping=None, sources=(): asked.append(training_sample) or []
    runner = _FakeRunner([{"exit": 0, "final": _fill()}])
    use_case = {"_implement_preview_training": agent_ns["implement_preview_training_cap"](spec, trains)}
    inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), use_case, spec, None, "/W/nb", ["result_table", "run_profile"],
                                     runner, True)
    assert asked == [required]


def test_the_ready_message_says_the_model_was_checked_on_a_preview_sample(agent_ns):
    inst = _probe_inspire(agent_ns, lambda s: None, {"dashboard": {"state": "ready", "spec_version": 2}})
    inst._implement_runner = lambda uc: "runner"
    inst._implement_trains_model = lambda uc: True
    handed = []

    def fill(uc_id, key, use_case, *rest):
        handed.append(use_case.get("_implement_preview_training"))
        return {"status": "written", "rows_written": 1000, "run_id": "r-9", "preview_sample_entities": SAMPLED}, 77, {}

    inst._implement_fill_and_preview = fill
    inst._implement_dashboard = lambda c, r: {"dashboard_id": "d1", "dashboard_url": "https://h/d1"}
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "churn-desk", "app_url": "https://churn-desk.example", "app_health": "running"}
    raw = json.loads(json.dumps(VALID))
    raw["data"] = {"tables": {}, "filters": [], "run_profile": "preview"}
    raw["config"] = dict(raw["config"], profiles=TPCDS_PROFILES)
    previous = dict(raw, outputs={**raw["outputs"], "genie_space": False, "app": False})
    inst._implement_previous = lambda t: {"spec_version": 2, "spec_json": previous}
    status = inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": raw},
                                        (5150, "N01-U01", 3))
    assert status == "ready", inst.updates[-1]
    assert handed == [SAMPLED]
    assert inst.updates[-1]["status_message"] == (
        "ready: preview wrote 1,000 rows; the model was checked on a preview sample of 20,000 entities, and the scheduled full run "
        "trains on every entity")
    assert agent_ns["implement_preview_sample_text"]({"status": "written", "rows_written": 3}) == ""
    assert agent_ns["implement_preview_sample_text"]({"status": "stopped", "preview_sample_entities": 5}) == ""
