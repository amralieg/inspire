"""Q3 R14 process-mining data fit.

Process mining rebuilds each case's path from an event log: many rows per case, each with an activity
and a time. A table that keeps one row per case with its current status and a last-change stamp holds no
path, so a Process Mining use case on it cannot be built. The rule reads column roles and keys from the
metadata (and, in Deep runs, whether the case id repeats in the rows); a user who asks for process mining
in the Generation Instructions always wins.
"""
import types

from v120_artifacts_support import make_inspire

SNAPSHOT = [
    ("main", "ops", "booking_tickets", "ticket_id", "BIGINT", ""),
    ("main", "ops", "booking_tickets", "booking_id", "BIGINT", ""),
    ("main", "ops", "booking_tickets", "ticket_status", "STRING", ""),
    ("main", "ops", "booking_tickets", "channel", "STRING", ""),
    ("main", "ops", "booking_tickets", "created_timestamp", "TIMESTAMP", ""),
    ("main", "ops", "booking_tickets", "updated_timestamp", "TIMESTAMP", ""),
]
EVENT_LOG = [
    ("main", "ops", "ticket_events", "event_id", "BIGINT", ""),
    ("main", "ops", "ticket_events", "ticket_id", "BIGINT", ""),
    ("main", "ops", "ticket_events", "activity", "STRING", ""),
    ("main", "ops", "ticket_events", "event_ts", "TIMESTAMP", ""),
]
MILESTONES = [
    ("main", "ops", "orders", "order_id", "BIGINT", ""),
    ("main", "ops", "orders", "order_status", "STRING", ""),
    ("main", "ops", "orders", "ordered_at", "TIMESTAMP", ""),
    ("main", "ops", "orders", "shipped_at", "TIMESTAMP", ""),
    ("main", "ops", "orders", "delivered_at", "TIMESTAMP", ""),
    ("main", "ops", "orders", "updated_at", "TIMESTAMP", ""),
]
SCHEMA = SNAPSHOT + EVENT_LOG + MILESTONES
NO_LOG = "Q3_R14_DATA_FIT_SCALE:R14_PROCESS_NO_EVENT_LOG"


class _Loader:
    def __init__(self, primary_keys=None):
        self.foreign_key_graph = {}
        self.primary_keys = dict(primary_keys or {})

    def get_primary_key(self, catalog, schema, table):
        return list(self.primary_keys.get((catalog, schema, table), []))


def _obj(agent_ns, parsed=None, primary_keys=None, profiles=None):
    tables = {".".join(r[:3]) for r in SCHEMA}
    attrs = {"data_loader": _Loader(primary_keys), "data_category_map": {t: "TRANSACTIONAL" for t in tables},
             "global_table_names": tables, "user_business_domains": [],
             "parsed_generation_instructions": parsed or {"forced_techniques": [], "use_case_kinds": {"asked": [], "excluded": []}}}
    if profiles is not None:
        attrs["discovery_evidence"] = {"profiles": profiles, "join_matches": []}
    return make_inspire(agent_ns, **attrs)


def _uc(no, table, solution, technique="Process Mining"):
    return {"No": no, "Name": "Cut waits between ticket steps", "Analytics Technique": technique,
            "Statement": "The operations team cannot see where tickets wait and acts late.",
            "Solution": solution, "High Level Design": "Directly-follows graph of the case paths.",
            "Business Value": "Fewer tickets waiting past their target time.",
            "Beneficiary": "Head of Operations", "Sponsor": "Chief Operating Officer", "Tables Involved": table}


def _snapshot_uc(no="N01-U01"):
    return _uc(no, "main.ops.booking_tickets",
               "Reconstruct each booking ticket case path from `ticket_status` and `updated_timestamp` per `ticket_id`, "
               "and measure waits and loops.")


def _event_uc(no="N01-U02"):
    return _uc(no, "main.ops.ticket_events",
               "Build each ticket path from `activity` ordered by `event_ts` per `ticket_id`, and measure waits and loops.")


def _milestone_uc(no="N01-U03"):
    return _uc(no, "main.ops.orders",
               "Measure the wait between `ordered_at`, `shipped_at` and `delivered_at` per `order_id` and the share stuck "
               "in each `order_status`.")


def _reasons(dropped):
    return {uc["No"]: reason for uc, reason in dropped}


def test_a_status_snapshot_table_fails_process_mining(agent_ns):
    kept, dropped = _obj(agent_ns)._phaseQ3_validate_relevance([_snapshot_uc()], SCHEMA)
    assert kept == [] and _reasons(dropped) == {"N01-U01": NO_LOG}


def test_a_last_change_stamp_is_not_a_second_milestone(agent_ns):
    only_updated = [r for r in SNAPSHOT if r[3] != "created_timestamp"]
    obj = _obj(agent_ns)
    kept, dropped = obj._phaseQ3_validate_relevance([_snapshot_uc()], only_updated + EVENT_LOG + MILESTONES)
    assert kept == [] and _reasons(dropped) == {"N01-U01": NO_LOG}


def test_a_proper_event_log_passes(agent_ns):
    kept, dropped = _obj(agent_ns)._phaseQ3_validate_relevance([_event_uc()], SCHEMA)
    assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U02"]


def test_a_case_table_with_milestone_times_passes(agent_ns):
    kept, dropped = _obj(agent_ns)._phaseQ3_validate_relevance([_milestone_uc()], SCHEMA)
    assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U03"]


def test_a_composite_primary_key_makes_the_case_table_an_event_log(agent_ns):
    keys = {("main", "ops", "booking_tickets"): ["ticket_id", "updated_timestamp"]}
    kept, dropped = _obj(agent_ns, primary_keys=keys)._phaseQ3_validate_relevance([_snapshot_uc()], SCHEMA)
    assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U01"]


def test_an_event_log_beside_a_snapshot_passes(agent_ns):
    uc = _uc("N01-U04", "main.ops.booking_tickets, main.ops.ticket_events",
             "Build each ticket path from `activity` ordered by `event_ts` per `ticket_id` and show `ticket_status`.")
    obj = _obj(agent_ns)
    obj._find_join_path = lambda tables: {"connected": True}
    kept, dropped = obj._phaseQ3_validate_relevance([uc], SCHEMA)
    assert dropped == [] and [u["No"] for u in kept] == ["N01-U04"]


def test_other_techniques_on_the_snapshot_are_untouched(agent_ns):
    uc = _uc("N01-U05", "main.ops.booking_tickets",
             "Count tickets per `ticket_status` and `channel` by week of `created_timestamp`.", technique="Trend Analysis")
    kept, dropped = _obj(agent_ns)._phaseQ3_validate_relevance([uc], SCHEMA)
    assert dropped == [] and [u["No"] for u in kept] == ["N01-U05"]


def test_the_user_asking_for_process_mining_wins(agent_ns):
    forced = {"forced_techniques": [{"technique": "Process Mining", "context": "ticket handling"}],
              "use_case_kinds": {"asked": [], "excluded": []}}
    asked = {"forced_techniques": [], "use_case_kinds": {"asked": ["process_mining"], "excluded": []}}
    for parsed in (forced, asked):
        obj = _obj(agent_ns, parsed=parsed)
        kept, dropped = obj._phaseQ3_validate_relevance([_snapshot_uc()], SCHEMA)
        assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U01"]
        assert any("Q3 R14 skipped for N01-U01" in m for _lvl, m in obj.logger.records)


def test_the_below_bar_reason_says_why_in_plain_words(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    text = cls._below_bar_gate_text("Q3", NO_LOG)
    assert "current status" in text and "too few columns" not in text and "R14" not in text
    deep = cls._below_bar_gate_text("Q3", "Q3_R14_DATA_FIT_SCALE:R14_PROCESS_CASE_UNIQUE_PER_ROW:main.ops.ticket_events.ticket_id")
    assert "main.ops.ticket_events.ticket_id" in deep and "one row per case" in deep
    assert "too few columns" in cls._below_bar_gate_text("Q3", "Q3_R14_DATA_FIT_SCALE:R14_RECO_UNDER_COLUMNED")


def _profile(rows, distinct):
    return {"main.ops.ticket_events": {"rows": rows, "sampled": False, "columns": {
        "ticket_id": {"null_share": 0.0, "distinct": distinct, "type_family": "numeric"},
        "activity": {"null_share": 0.0, "distinct": 6, "type_family": "string"},
        "event_ts": {"null_share": 0.0, "distinct": rows, "type_family": "temporal"}}}}


def test_deep_data_showing_one_row_per_case_fails_the_event_log(agent_ns):
    obj = _obj(agent_ns, profiles=_profile(5000, 5000))
    kept, dropped = obj._phaseQ3_validate_relevance([_event_uc()], SCHEMA)
    assert kept == [] and _reasons(dropped) == {
        "N01-U02": "Q3_R14_DATA_FIT_SCALE:R14_PROCESS_CASE_UNIQUE_PER_ROW:main.ops.ticket_events.ticket_id"}


def test_deep_data_showing_repeated_cases_keeps_the_event_log(agent_ns):
    obj = _obj(agent_ns, profiles=_profile(5000, 900))
    kept, dropped = obj._phaseQ3_validate_relevance([_event_uc()], SCHEMA)
    assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U02"]


def test_deep_data_too_thin_to_judge_keeps_the_event_log(agent_ns):
    obj = _obj(agent_ns, profiles=_profile(12, 12))
    kept, dropped = obj._phaseQ3_validate_relevance([_event_uc()], SCHEMA)
    assert "R14_PROCESS" not in str(_reasons(dropped))


def test_deep_skips_the_milestone_case_table(agent_ns):
    profiles = {"main.ops.orders": {"rows": 5000, "sampled": False, "columns": {
        "order_id": {"null_share": 0.0, "distinct": 5000, "type_family": "numeric"}}}}
    kept, dropped = _obj(agent_ns, profiles=profiles)._phaseQ3_validate_relevance([_milestone_uc()], SCHEMA)
    assert dropped == [] and [uc["No"] for uc in kept] == ["N01-U03"]


def test_a_flag_column_is_not_an_activity(agent_ns):
    rows = [("main", "ops", "ticket_marks", "mark_id", "BIGINT", ""),
            ("main", "ops", "ticket_marks", "ticket_id", "BIGINT", ""),
            ("main", "ops", "ticket_marks", "is_escalated", "BOOLEAN", ""),
            ("main", "ops", "ticket_marks", "mark_ts", "TIMESTAMP", "")]
    uc = _uc("N01-U06", "main.ops.ticket_marks",
             "Build each ticket path from `is_escalated` ordered by `mark_ts` per `ticket_id`.")
    obj = _obj(agent_ns)
    obj.data_category_map["main.ops.ticket_marks"] = "TRANSACTIONAL"
    kept, dropped = obj._phaseQ3_validate_relevance([uc], SCHEMA + rows)
    assert kept == [] and _reasons(dropped) == {"N01-U06": NO_LOG}
