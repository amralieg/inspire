"""C25 (RC7-B-12): use-case text the agent stores for business readers is plain: no [ESTIMATE: ...] tags, no backticks."""
from v120_artifacts_support import make_inspire

TAGGED = "Cut churn [ESTIMATE: depends on `totalPrice`, `order_count`] each year [BASELINE: current churn rate] with [TARGET: 5%]."
BANNED = ("[", "]", "`")


def _context():
    return {"tree": {"source": "customer"}, "catalog": {"kpis": {}}, "priority_hits": {}, "sponsor_picks": {}}


def _plain(value):
    text = repr(value)
    return not any(mark in text for mark in BANNED) and "ESTIMATE" not in text


def test_a_model_alignment_answer_with_tags_is_stored_plain(agent_ns):
    obj = make_inspire(agent_ns)
    uc = {"No": "U1"}
    record = {"alignments": [], "priorities": [], "strategic_alignment": 1.0, "kpis": [], "sponsor_id": None,
              "key_results": [{"statement": "Reach [TARGET: 5%] on `churn_rate`", "kpi": "Churn"}],
              "measures": ["[ESTIMATE: depends on `orders.totalPrice`]"],
              "financial": ["Saves money [ESTIMATE: depends on `totalPrice`]"],
              "non_financial": ["Better service [ASSUMPTION: `nps` is tracked]"]}
    obj._apply_alignment_record(uc, record, _context())
    for field in ("Expected Key Results", "Measures of Success", "Financial Benefits", "Non-Financial Benefits"):
        assert _plain(uc[field]), (field, uc[field])
    assert "depends on orders.totalPrice" in repr(uc["Measures of Success"])


def test_the_fallback_alignment_stored_for_a_use_case_is_plain(agent_ns):
    obj = make_inspire(agent_ns)
    uc = {"No": "U1", "Primary Table": "main.sales.orders"}
    record = obj._fallback_alignment(uc, "model unavailable")
    obj._apply_alignment_record(uc, record, _context())
    for field in ("Measures of Success", "Financial Benefits", "Non-Financial Benefits"):
        assert _plain(uc[field]), (field, uc[field])
    assert _plain(uc["KPIs"][0]["name"]), uc["KPIs"][0]["name"]


def test_the_final_text_pass_makes_statement_solution_and_business_value_plain(agent_ns):
    obj = make_inspire(agent_ns)
    ucs = [{"No": "U1", "Statement": "Find `risky_orders` [ASSUMPTION: daily load]", "Solution": "Score `orders`",
            "Business Value": TAGGED, "value_estimate_text": "Value [ESTIMATE: depends on `price`]"}]
    obj._plain_use_case_text(ucs)
    value = ucs[0]["Business Value"]
    assert value == "Cut churn (estimate: depends on totalPrice, order_count) each year the current value with 5%."
    for field in ("Statement", "Solution", "Business Value", "value_estimate_text"):
        assert _plain(ucs[0][field]), (field, ucs[0][field])


def test_no_prompt_asks_the_model_to_write_an_estimate_tag(agent_ns):
    templates = agent_ns["PROMPT_TEMPLATES"]
    asking = [key for key, text in templates.items() if "[ESTIMATE" in str(text).upper()]
    assert asking == [], asking
