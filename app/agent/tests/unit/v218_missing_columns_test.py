"""v2.1.8 asks and use cases that name a column no source table has.

1. An MVP asked for "driver name" on data that has no such column. The vibe matcher read "driver" and "name" as generic words,
   so the ask was never named as missing before Genie built. A requested attribute is now judged as a phrase (entity and
   attribute) against real column names, table names and column comments: driver_name, a drivers table with a name column,
   or a join key to such a table holds it; a drivers table the use case cannot reach, or a name column of another entity,
   does not.
2. Discovery gate R13 dropped a use case naming an invented column only when it named fewer than 2 real ones, so a design
   naming driver_name next to 2 real columns passed. Any source column no table in scope has now fails the use case unless
   a real column obviously matches it, which Inspire writes in its place. A computed metric or alias the use case defines
   is not a source column.
"""
import logging
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v120_artifacts_support import FakeSpark  # noqa: E402
from v120_gate_recalibration_test import SCHEMA, U, ids, make, reasons  # noqa: E402
from v140_implement_test import _inspire  # noqa: E402

TRIPS = {"main.rides.trips": ["trip_id", "driver_id", "fare_amount", "pickup_time", "dropoff_time"]}
DRIVERS = {"main.rides.drivers": ["driver_id", "name", "license_no"]}
CASE = {"Name": "Spot late drivers", "Statement": "Find the drivers whose trips run late, by driver name"}
ASK = "show the driver name next to every late trip"


def _unfound(ns, ask, sources, comments=None, draws="table"):
    return ns["implement_vibes_unfound"]({"ask": ask, "draws": draws}, ns["implement_vibes_held_terms"](sources, CASE),
                                         ns["implement_vibes_phrase_holders"](sources, comments))


def test_driver_name_is_missing_when_no_column_holds_it(agent_ns):
    assert _unfound(agent_ns, ASK, TRIPS) == ["driver name"]
    assert _unfound(agent_ns, "count late trips by driver name", TRIPS, draws="chart") == ["driver name"]


def test_driver_name_is_held_by_a_drivers_table_with_a_name_column(agent_ns):
    assert _unfound(agent_ns, ASK, dict(TRIPS, **DRIVERS)) == []


def test_driver_name_is_held_by_a_driver_name_column(agent_ns):
    assert _unfound(agent_ns, ASK, {"main.rides.trips": ["trip_id", "driver_name", "fare_amount"]}) == []
    assert _unfound(agent_ns, ASK, {"main.rides.trips": ["trip_id", "DriverName", "fare_amount"]}) == []


def test_driver_name_is_held_by_a_column_comment(agent_ns):
    sources = {"main.rides.trips": ["trip_id", "drv_nm", "fare_amount"]}
    assert _unfound(agent_ns, ASK, sources, {"main.rides.trips": ("", {"drv_nm": "Full name of the driver"})}) == []
    assert _unfound(agent_ns, ASK, sources, {"main.rides.trips": ("", {"drv_nm": "Code of the pickup zone"})}) == ["driver name"]
    people = {"main.rides.people": ["person_id", "name"]}
    assert _unfound(agent_ns, ASK, people, {"main.rides.people": ("Drivers who work for the fleet", {})}) == []
    assert _unfound(agent_ns, ASK, people, {"main.rides.people": ("Passengers who book rides", {})}) == ["driver name"]
    assert _unfound(agent_ns, ASK, {"main.rides.trips": ["trip_id", "drvname"]}) == [], "one column whose name runs both words together"


def test_a_generic_name_ask_is_not_flagged(agent_ns):
    assert _unfound(agent_ns, "show the name", {"main.rides.drivers": ["driver_id", "name"]}) == []
    assert _unfound(agent_ns, "show the name", TRIPS) == []


def test_must_exclude_a_name_column_of_another_entity_or_words_held_apart(agent_ns):
    vehicles = dict(TRIPS, **{"main.rides.vehicles": ["vehicle_id", "name"]})
    assert _unfound(agent_ns, ASK, vehicles) == ["driver name"], "a vehicle's name is not a driver's name"
    assert _unfound(agent_ns, ASK, {"main.rides.trips": ["trip_id", "driver_id"], "main.rides.zones": ["zone_name"]}) == [
        "driver name"], "driver on one column and name on another is not a driver name"
    assert _unfound(agent_ns, ASK, TRIPS) == ["driver name"], "the use case text naming driver names does not hold them"


def test_unread_sources_flag_nothing(agent_ns):
    unread = dict(TRIPS, **{"main.rides.drivers": []})
    assert agent_ns["implement_vibes_phrase_holders"](unread) == ()
    assert _unfound(agent_ns, ASK, unread) == []


def test_a_judge_no_data_verdict_on_driver_name_stays_no_data(agent_ns):
    held = agent_ns["implement_vibes_held_terms"](TRIPS, CASE)
    holders = agent_ns["implement_vibes_phrase_holders"](TRIPS)
    parsed = {"checks": [{"n": 1, "status": "no_data", "evidence": "no column holds driver names", "where": ""}]}
    ask = {"ask": ASK, "draws": "table"}
    [(_n, (status, evidence))] = agent_ns["implement_vibes_judged"](parsed, [ask], {}, "App", None, None, held, holders).items()
    assert status == "missing" and evidence.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"])
    linked = dict(TRIPS, **DRIVERS)
    [(_n, (status, evidence))] = agent_ns["implement_vibes_judged"](
        parsed, [ask], {}, "App", None, None, agent_ns["implement_vibes_held_terms"](linked, CASE),
        agent_ns["implement_vibes_phrase_holders"](linked)).items()
    assert not evidence.startswith(agent_ns["IMPLEMENT_VIBES_NO_DATA"]), "a judge saying no_data on data the sources hold is not trusted"


def _hold_inst(ns, sources, judge):
    inst = _inspire(ns, FakeSpark())
    inst._implement_vibes_sources = lambda spec, use_case: dict(sources)
    inst._implement_vibes_notes = lambda sources: []
    inst._implement_vibes_result_columns = lambda use_case: (True, [])
    inst._implement_vibes_asks = lambda cache, asset, text, impact=None: [{"ask": ASK, "draws": "table"}]
    inst._implement_vibes_judge = judge
    return inst


SPEC = {"data": {"notes": ""}, "outputs": {"app": True, "app_vibes": ASK}}


def test_the_hold_names_driver_name_before_genie_builds(agent_ns):
    judged = []

    def judge(parts, label):
        judged.append([a["ask"] for p in parts for a in p["asks"]])
        return {"checks": [{"n": 1, "status": "no_data", "evidence": "no driver name column", "where": ""}]}

    held = _hold_inst(agent_ns, TRIPS, judge)._implement_vibes_hold("N01-U01", dict(CASE), SPEC, {})
    assert judged == [[ASK]]
    [(_asset, asks)] = held.items()
    assert "driver name" in asks[ASK]


def test_the_hold_skips_the_judge_when_a_joined_drivers_table_holds_the_name(agent_ns):
    judged = []
    held = _hold_inst(agent_ns, dict(TRIPS, **DRIVERS), lambda parts, label: judged.append(parts))._implement_vibes_hold(
        "N01-U01", dict(CASE), SPEC, {})
    assert held == {} and judged == []


def test_a_failed_judge_holds_nothing_and_logs_the_missing_column(agent_ns, caplog):
    def judge(parts, label):
        raise RuntimeError("endpoint timed out")

    inst = _hold_inst(agent_ns, TRIPS, judge)
    inst.logger = logging.getLogger("v218_missing_columns")
    with caplog.at_level(logging.WARNING, logger="v218_missing_columns"):
        held = inst._implement_vibes_hold("N01-U01", dict(CASE), SPEC, {})
    assert held == {}
    [line] = [r.getMessage() for r in caplog.records if "IMPLEMENT-VIBES-HOLD-SKIPPED FIRED" in r.getMessage()]
    assert "held nothing although no source column holds" in line and "driver name" in line


def test_the_sources_add_a_table_the_use_case_joins_to(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, FakeSpark())
    inst._genie_involved_tables = lambda use_case: ["main.rides.trips"]
    inst._ensure_genie_metadata_loader = lambda: None
    evidence = {"main.rides.trips": {"foreign_keys": [{"column": "driver_id", "ref_table": "main.rides.drivers", "ref_column": "driver_id"},
                                                      {"column": "zone_id", "ref_table": "main.rides.zones", "ref_column": "zone_id"}]}}
    inst._genie_table_evidence = lambda tables: evidence if list(tables) == ["main.rides.trips"] else {}
    described = {"main.rides.trips": {"columns": [(c, "STRING", "") for c in TRIPS["main.rides.trips"]], "comment": ""},
                 "main.rides.drivers": {"columns": [("driver_id", "BIGINT", ""), ("name", "STRING", "Driver full name")], "comment": ""}}
    monkeypatch.setitem(agent_ns, "inspire_table_described", lambda spark, table, extended=False: described.get(table))
    sources = inst._implement_vibes_sources({}, dict(CASE))
    assert sources == {"main.rides.trips": TRIPS["main.rides.trips"], "main.rides.drivers": ["driver_id", "name"]}, \
        "an unreadable joined table is left out instead of switching every check off"
    assert agent_ns["implement_vibes_unfound"]({"ask": ASK, "draws": "table"}, agent_ns["implement_vibes_held_terms"](sources, CASE),
                                               inst._implement_vibes_holders(sources)) == []
    removed = inst._implement_vibes_sources({"data": {"removed_tables": ["main.rides.drivers"]}}, dict(CASE))
    assert "main.rides.drivers" not in removed, "a table the user took out of the use case never comes back as a join"


DRIVER_SCHEMA = list(SCHEMA) + [
    ("main", "shop", "trips", "driver_id", "BIGINT", ""),
    ("main", "shop", "trips", "trip_ts", "TIMESTAMP", ""),
    ("main", "shop", "drivers", "driver_id", "BIGINT", ""),
    ("main", "shop", "drivers", "rating", "DOUBLE", ""),
]


def _invented_judge(verdict="invented_source_column"):
    calls = []

    def judge(prompt_name, display_name, prompt, schema, skip_cache=False):
        calls.append({"prompt_name": prompt_name, "prompt": prompt, "skip_cache": skip_cache})
        if isinstance(verdict, Exception):
            raise verdict
        checks = []
        for block in prompt.split("\n### ")[1:]:
            uc_id = block.split(":", 1)[0].strip()
            names = re.search(r"Names to judge: (.*)", block).group(1).split(", ")
            checks += [{"use_case": uc_id, "name": name, "verdict": verdict(uc_id, name) if callable(verdict) else verdict,
                        "reason": "read as stored" if verdict == "invented_source_column" else "the use case computes it"}
                       for name in names]
        return {"checks": checks}
    judge.calls = calls
    return judge


def _r13(ns, *ucs, judge=None):
    o = make(ns, schema=DRIVER_SCHEMA)
    o.data_category_map = dict(o.data_category_map, **{"main.shop.drivers": "MASTER"})
    o.global_table_names = set(o.global_table_names) | {"main.shop.drivers"}
    o._implement_llm_object = judge or _invented_judge()
    return o, o._phaseQ3_validate_relevance(list(ucs), DRIVER_SCHEMA)


def _trend(no, solution, tables="main.shop.trips", **extra):
    return U(no, "Track Weekly Fare Trend By Zone", "Trend Analysis", tables, solution, **extra)


def test_r13_drops_an_invented_column_named_next_to_two_real_ones(agent_ns, caplog):
    uc = _trend("N09-U01", "Trend weekly `fare` and `tip` over `pickup_ts` per `driver_name` to spot zones that lose earnings.")
    with caplog.at_level(logging.WARNING):
        _o, (kept, dropped) = _r13(agent_ns, uc)
    assert ids(kept) == [] and reasons(dropped)["N09-U01"] == "Q3_R13_INVENTED_COLUMN:driver_name"
    assert any("R13-INVENTED-COLUMN FIRED" in r.getMessage() and "driver_name" in r.getMessage() for r in caplog.records)


def test_r13_drops_a_qualified_column_its_table_lacks(agent_ns):
    backticked = _trend("N09-U02", "Trend weekly `fare` and `tip` over `pickup_ts`, labelled with `trips`.`driver_name`.")
    bare = _trend("N09-U03", "Trend weekly `fare` and `tip` over `pickup_ts`, labelled with trips.driver_name per zone.")
    _o, (kept, dropped) = _r13(agent_ns, backticked, bare)
    assert ids(kept) == []
    assert reasons(dropped)["N09-U02"] == "Q3_R13_INVENTED_COLUMN:trips.driver_name"
    assert reasons(dropped)["N09-U03"] == "Q3_R13_INVENTED_COLUMN:trips.driver_name"


def test_r13_keeps_a_computed_alias_the_use_case_defines(agent_ns):
    defined = [
        _trend("N09-U04", "Compute `late_rate` = trips with zero `tip` / all trips, and trend it with `fare` over `pickup_ts`."),
        _trend("N09-U05", "Trend `fare` over `pickup_ts`; `tip_share`, the share of `fare` paid as `tip`, shows generosity."),
        _trend("N09-U06", "Trend `fare` and `tip` over `pickup_ts`.", hld="SELECT zone, AVG(tip) / AVG(fare) AS tip_ratio FROM trips"),
        _trend("N09-U07", "Derive a new column called `peak_flag` from `pickup_ts` and trend `fare` and `tip` by it."),
        _trend("N09-U08", "Trend `fare` and `tip` over `pickup_ts` and alert above the `alert_threshold_pct` setting."),
        _trend("N09-U30", "Trend `fare` over `pickup_ts`; `tip_pct` is the share of `fare` paid as `tip`."),
        _trend("N09-U31", "Trend `fare` and `tip` over `pickup_ts` with `tip_per_fare` (`tip` / `fare`) per zone."),
    ]
    o, (kept, dropped) = _r13(agent_ns, *defined)
    assert ids(kept) == ["N09-U04", "N09-U05", "N09-U06", "N09-U07", "N09-U08", "N09-U30", "N09-U31"], reasons(dropped)
    assert o._implement_llm_object.calls == []


def test_r13_keeps_real_columns_and_names_that_are_not_source_columns(agent_ns):
    real = _trend("N09-U09", "Trend weekly `fare` and `tip` over `pickup_ts` by `zone` and `main.shop.trips`.`driver_id`.")
    library = _trend("N09-U10", "Trend weekly `fare` and `tip` over `pickup_ts` with `prophet`, written with `mlflow.log_metric`.")
    joined = _trend("N09-U11", "Trend weekly `fare` and `tip` over `pickup_ts` with each driver's `rating`.",
                    tables="main.shop.trips, main.shop.drivers")
    _o, (kept, dropped) = _r13(agent_ns, real, library, joined)
    assert ids(kept) == ["N09-U09", "N09-U10", "N09-U11"], reasons(dropped)


def test_r13_writes_the_real_column_when_one_obviously_matches(agent_ns, caplog):
    plural = U("N09-U12", "Forecast Weekly Basket Value", "Forecasting", "main.shop.orders, main.shop.order_items",
               "Forecast weekly `total_amount` over `order_date` with `unit_prices` and `quantity`.")
    typo = _trend("N09-U13", "Trend weekly `fare` and `tip` over `pickup_tss` by `zone`.", hld="Read pickup_tss from trips.")
    with caplog.at_level(logging.WARNING):
        _o, (kept, dropped) = _r13(agent_ns, plural, typo)
    assert ids(kept) == ["N09-U12", "N09-U13"], reasons(dropped)
    assert kept[0]["Solution"] == "Forecast weekly `total_amount` over `order_date` with `unit_price` and `quantity`."
    assert kept[1]["Solution"] == "Trend weekly `fare` and `tip` over `pickup_ts` by `zone`."
    assert kept[1]["High Level Design"] == "Read pickup_ts from trips."
    assert sum("R13-INVENTED-COLUMN FIRED" in r.getMessage() and "repairs" in r.getMessage() for r in caplog.records) == 2


def test_r13_moves_a_column_to_the_one_cited_table_that_has_it(agent_ns):
    uc = U("N09-U14", "Forecast Weekly Basket Value", "Forecasting", "main.shop.orders, main.shop.order_items",
           "Forecast weekly `total_amount` over `order_date` from `orders`.`unit_price` and `quantity`.")
    _o, (kept, dropped) = _r13(agent_ns, uc)
    assert ids(kept) == ["N09-U14"], reasons(dropped)
    assert kept[0]["Solution"] == "Forecast weekly `total_amount` over `order_date` from `order_items`.`unit_price` and `quantity`."


@pytest.mark.parametrize("solution", [
    "Trend weekly `fare` and `tip` over `pickup_ts` per `driver_name` and `driver_rank`.",
    "Trend weekly `fare` and `tip` over `pickup_ts` using the driver_name column.",
])
def test_r13_must_exclude_a_name_that_only_looks_defined(agent_ns, solution):
    _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U15", solution))
    assert ids(kept) == [] and reasons(dropped)["N09-U15"].startswith("Q3_R13_INVENTED_COLUMN:")


UNUSUAL = "Trend weekly `fare` and `tip` over `pickup_ts`, then rank zones by `earnings_momentum` week over week."


def test_r13_keeps_an_unusual_alias_the_judge_reads_as_derived(agent_ns, caplog):
    judge = _invented_judge("derived")
    with caplog.at_level(logging.INFO):
        _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U40", UNUSUAL), judge=judge)
    assert ids(kept) == ["N09-U40"], reasons(dropped)
    [call] = judge.calls
    assert call["prompt_name"] == "q3_r13_invented_columns" and "Names to judge: earnings_momentum" in call["prompt"]
    assert "fare" in call["prompt"] and "pickup_ts" in call["prompt"]
    assert any("R13-JUDGE-DERIVED FIRED" in r.getMessage() and "earnings_momentum" in r.getMessage() for r in caplog.records)


def test_r13_drops_an_unusual_name_the_judge_confirms_is_invented(agent_ns, caplog):
    with caplog.at_level(logging.WARNING):
        _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U41", UNUSUAL))
    assert ids(kept) == [] and reasons(dropped)["N09-U41"] == "Q3_R13_INVENTED_COLUMN:earnings_momentum"
    assert any("R13-INVENTED-COLUMN FIRED" in r.getMessage() and "drops N09-U41" in r.getMessage() for r in caplog.records)


def test_r13_judges_only_the_names_it_names_per_use_case(agent_ns):
    judge = _invented_judge(lambda uc_id, name: "derived" if name == "earnings_momentum" else "invented_source_column")
    _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U42", UNUSUAL),
                               _trend("N09-U43", "Trend weekly `fare` and `tip` over `pickup_ts` per `driver_name`."), judge=judge)
    assert ids(kept) == ["N09-U42"] and reasons(dropped) == {"N09-U43": "Q3_R13_INVENTED_COLUMN:driver_name"}
    assert len(judge.calls) == 1


def test_r13_keeps_and_logs_when_the_judge_fails(agent_ns, caplog):
    judge = _invented_judge(RuntimeError("serving endpoint unavailable"))
    with caplog.at_level(logging.WARNING):
        _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U44", UNUSUAL), judge=judge)
    assert ids(kept) == ["N09-U44"], reasons(dropped)
    assert [c["skip_cache"] for c in judge.calls] == [False, True]
    messages = [r.getMessage() for r in caplog.records]
    assert any("R13-JUDGE-RETRY FIRED" in m for m in messages)
    assert any("R13-JUDGE-UNCHECKED FIRED" in m and "N09-U44" in m and "earnings_momentum" in m and "unavailable" in m for m in messages)
    assert not any("R13-INVENTED-COLUMN FIRED" in m and "drops" in m for m in messages)


def test_r13_skips_the_judge_when_the_use_case_names_no_real_column(agent_ns):
    judge = _invented_judge(RuntimeError("serving endpoint unavailable"))
    _o, (kept, dropped) = _r13(agent_ns, _trend("N09-U45", "Rank zones by `earnings_momentum` and `driver_name`."), judge=judge)
    assert ids(kept) == [] and reasons(dropped)["N09-U45"] == "Q3_R13_SOLUTION_UNDER_GROUNDED:0"
    assert judge.calls == []


def test_j3_counts_names_through_the_one_invented_column_detector(agent_ns):
    o = make(agent_ns, schema=DRIVER_SCHEMA)
    invented = _trend("N09-U46", "Trend `fare` over `pickup_ts` per `driver_name`, `driver_rank` and `shift_code`.")
    defined = _trend("N09-U47", "Trend `fare` over `pickup_ts`; compute `late_rate` = late / all, `tip_pct` = tip / fare and "
                                "`peak_flag` = hour in 7-9.")
    for uc in (invented, defined):
        uc.update({"Primary Table": "main.shop.trips", "result_table": "main.inspire.r", "Inspire Score": 7.5})
    seen = len(agent_ns["NEXT_ACTIONS"].snapshot())
    o._phaseL_final_gate([invented, defined], DRIVER_SCHEMA)
    j3 = {a["evidence"].split(":", 1)[0]: a["evidence"] for a in agent_ns["NEXT_ACTIONS"].snapshot()[seen:]
          if a["rule_id"] == "UC_PRODUCTION_READINESS" and "J3_" in a["evidence"]}
    assert list(j3) == ["UC N09-U46"] and "J3_ungrounded_cols:3" in j3["UC N09-U46"]


def test_the_invented_column_check_is_a_registered_inline_prompt(agent_ns):
    registered = {p["prompt_name"]: p for p in agent_ns["TECHNICAL_CONTEXT"]["prompts_models"]}
    assert registered["q3_r13_invented_columns"]["model_type"] == "worker"
    assert registered["q3_r13_invented_columns"]["temperature"] == 0.0
    assert "q3_r13_invented_columns" in agent_ns["INLINE_PROMPT_NAMES"]
    assert "q3_r13_invented_columns" not in agent_ns["PROMPT_TEMPLATES"]
