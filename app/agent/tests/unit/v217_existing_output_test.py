"""A use case whose technique would rebuild an output its main table already holds stays below the bar.

Q5 T3 flags a use case whose technique produces a value (bounds or a band, an anomaly flag, a similarity
match, a recommendation, a cluster, a forecast or a prediction) that a column of its main table already
holds, when its text never uses that column. The use case stays below the bar with a plain reason; it is
never removed. A use case that uses the column, a use case the instructions ask for, and a column that
only shares a word with the technique are not flagged. The generation prompt and the quality gates tell
the model to use those columns instead of rebuilding them.
"""
import pytest

from v120_artifacts_support import make_inspire

VIEW = "main.service.request_insights_vw"
OTHER = "main.service.request_log"
SCHEMA = [
    ("main", "service", "request_insights_vw", "request_id", "string", ""),
    ("main", "service", "request_insights_vw", "request_text", "string", ""),
    ("main", "service", "request_insights_vw", "request_count", "bigint", ""),
    ("main", "service", "request_insights_vw", "similar_sr_id", "string", ""),
    ("main", "service", "request_insights_vw", "similarity_score", "double", ""),
    ("main", "service", "request_insights_vw", "proven_resolution", "string", ""),
    ("main", "service", "request_insights_vw", "lower_bound", "double", ""),
    ("main", "service", "request_insights_vw", "upper_bound", "double", ""),
    ("main", "service", "request_insights_vw", "churn_probability", "double", ""),
    ("main", "service", "request_insights_vw", "credit_score", "double", ""),
    ("main", "service", "request_insights_vw", "price_band", "string", ""),
    ("main", "service", "request_insights_vw", "opened_date", "date", ""),
    ("main", "service", "request_log", "request_id", "string", ""),
    ("main", "service", "request_log", "request_count", "bigint", ""),
    ("main", "service", "request_log", "opened_date", "date", ""),
]


def _inst(agent_ns):
    return make_inspire(agent_ns, parsed_generation_instructions={}, user_business_domains=[], detected_kinds=[])


def _uc(no, name, statement, solution, design, technique, tables=VIEW, **extra):
    uc = {"No": no, "Name": name, "Statement": statement, "Solution": solution, "High Level Design": design,
          "Analytics Technique": technique, "Tables Involved": tables, "Beneficiary": "Service desk lead",
          "Sponsor": "Head of service", "Business Value": "Reduces the repeat request rate each week."}
    uc.update(extra)
    return uc


REUSE_FIXES = ("Reuse Proven Fixes on Each New Request", "Repeat requests take long to resolve.",
               "Embed `request_text` to find similar past requests for each new request and send agents the fix.",
               "Using columns: `request_text`, `request_id`. Embed each request, rank the nearest past requests by "
               "cosine distance, and queue each match daily.", "Recommendation")
FLAG_SURGES = ("Flag Abnormal Request Surges Each Day", "Request surges overload the desk.",
               "Train an Isolation Forest on `request_count` and `opened_date` to learn the expected band and flag "
               "each day outside it.",
               "Using columns: `request_count`, `opened_date`. Train an Isolation Forest daily and send each "
               "flagged day to the desk lead.", "Anomaly Detection")


def _miss(agent_ns, uc):
    inst = _inst(agent_ns)
    columns = inst._gate_schema_index(SCHEMA)["tables"]
    return inst._q5_rebuilt_output_miss(uc, columns)


def test_rebuilding_a_similarity_match_the_view_already_holds_is_flagged(agent_ns):
    assert _miss(agent_ns, _uc("U1", *REUSE_FIXES)) == "Q5_T3_REBUILDS_OUTPUT:similar_sr_id, similarity_score"


def test_rebuilding_an_expected_band_the_view_already_holds_is_flagged(agent_ns):
    assert _miss(agent_ns, _uc("U2", *FLAG_SURGES)) == "Q5_T3_REBUILDS_OUTPUT:lower_bound, upper_bound"


def test_rebuilding_a_prediction_of_the_same_outcome_is_flagged(agent_ns):
    uc = _uc("U3", "Call Customers Likely to Churn This Week", "Lost customers cut revenue.",
             "Train an XGBoost classifier on `request_count` to score each customer's churn risk weekly.",
             "Using columns: `request_count`, `opened_date`. Train XGBoost and rank each customer.", "Classification")
    assert _miss(agent_ns, uc) == "Q5_T3_REBUILDS_OUTPUT:churn_probability"


def test_a_use_case_that_uses_the_existing_columns_is_not_flagged(agent_ns):
    uses = _uc("U4", "Flag Abnormal Request Surges Each Day", "Request surges overload the desk.",
               "Flag each day whose `request_count` falls outside `lower_bound` and `upper_bound`, then rank the "
               "breaches by size.", "Using columns: `request_count`, `lower_bound`, `upper_bound`.", "Anomaly Detection")
    reuse = _uc("U5", "Reuse Proven Fixes on Each New Request", "Repeat requests take long to resolve.",
                "Send agents the `proven_resolution` of `similar_sr_id` when `similarity_score` is high.",
                "Using columns: `similar_sr_id`, `similarity_score`, `proven_resolution`.", "Recommendation")
    assert _miss(agent_ns, uses) == "" and _miss(agent_ns, reuse) == ""


def test_columns_that_only_share_a_word_or_sit_in_another_table_are_not_flagged(agent_ns):
    credit = _uc("U6", "Hold Orders Likely to Default This Week", "Defaults cost cash.",
                 "Train an XGBoost classifier on `request_count` to score each order's default risk weekly.",
                 "Using columns: `request_count`. Train XGBoost and rank each order.", "Classification")
    category = _uc("U7", "Catch Abnormal Price Moves Each Day", "Odd prices lose margin.",
                   "Train an Isolation Forest on `request_count` daily and flag each outlier day.",
                   "Using columns: `request_count`.", "Anomaly Detection", tables=OTHER)
    trend = _uc("U8", "Staff the Desk for Next Month's Requests", "Understaffing slows service.",
                "Compare `request_count` month over month for each desk.", "Using columns: `request_count`.",
                "Trend Analysis")
    assert [_miss(agent_ns, uc) for uc in (credit, category, trend)] == ["", "", ""]


def test_a_text_category_named_band_is_not_an_expected_band(agent_ns):
    schema = [("main", "shop", "items", "item_id", "string", ""), ("main", "shop", "items", "price_band", "string", ""),
              ("main", "shop", "items", "price", "double", "")]
    inst = _inst(agent_ns)
    uc = _uc("U9", "Catch Abnormal Prices on Each Item Daily", "Odd prices lose margin.",
             "Train an Isolation Forest on `price` daily and flag each outlier item.", "Using columns: `price`.",
             "Anomaly Detection", tables="main.shop.items")
    assert inst._q5_rebuilt_output_miss(uc, inst._gate_schema_index(schema)["tables"]) == ""


def test_q5_keeps_the_rebuilt_use_cases_below_the_bar_with_a_plain_reason(agent_ns):
    inst = _inst(agent_ns)
    ucs = [_uc("U1", *REUSE_FIXES), _uc("U2", *FLAG_SURGES)]
    before = list(ucs)
    kept, dropped = inst._phaseQ5_decision_readiness(ucs, SCHEMA)
    reasons = {uc["No"]: reason for uc, reason in dropped}
    assert reasons == {"U1": "Q5_T3_REBUILDS_OUTPUT:similar_sr_id, similarity_score",
                       "U2": "Q5_T3_REBUILDS_OUTPUT:lower_bound, upper_bound"}
    kept, removed, below = inst._keep_below_bar("Q5", before, kept, dropped)
    assert [uc["No"] for uc in kept] == ["U1", "U2"] and removed == [] and len(below) == 2
    assert kept[1]["below_bar_reason"].startswith(
        "its main table already holds what its technique would build (lower_bound, upper_bound)")
    assert "Q5" in kept[1]["below_bar_reason"]


def test_a_use_case_the_instructions_ask_for_may_rebuild_the_output(agent_ns):
    inst = _inst(agent_ns)
    asked = _uc("U1", *REUSE_FIXES, user_request="R1")
    _kept, dropped = inst._phaseQ5_decision_readiness([asked], SCHEMA)
    assert not any(str(reason).startswith("Q5_T3") for _uc_, reason in dropped)


@pytest.mark.parametrize("name", ["BASE_USE_CASE_GEN_PROMPT"])
def test_the_generation_prompt_tells_the_model_to_use_existing_outputs(agent_ns, name):
    text = agent_ns["PROMPT_TEMPLATES"][name]
    assert "already holds a model output" in text
    assert "unless the Generation Instructions ask for that rebuild" in text


def test_the_quality_gates_score_a_rebuilt_output_as_weak_depth(agent_ns):
    for block in ("QUALITY_GATE_RULES", "QUALITY_GATE_HIGH", "QUALITY_GATE_SCORING_BLOCK"):
        assert "rebuilds a model output that a column of its tables already holds" in agent_ns[block]
