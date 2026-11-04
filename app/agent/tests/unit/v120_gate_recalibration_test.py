"""v1.2.0 GATES lane: recalibrated G/Q gates, the Q/G runners and Phase L.

Once K1 lands, the G+Q gates filter production output for the first time since 81d4ed3, so every
rule that still DROPS must be safe on realistic UC dicts, and every rule that cannot be made safe
becomes a flag. UC dicts below mirror `_parse_llm_csv_response` output at gate time: the parser
keys (`High Level Design`, not `high_level_design`), `Priority` still 0.0 (combined scoring runs
after the gates) and no `Inspire Score` / `Quality` yet.

Each rule has a must-drop case and a must-keep case (CLAUDE.md §8.3).
"""
import ast
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace, method_node  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


SCHEMA = [
    ("main", "shop", "orders", "order_id", "BIGINT", ""),
    ("main", "shop", "orders", "customer_id", "BIGINT", ""),
    ("main", "shop", "orders", "store_id", "BIGINT", ""),
    ("main", "shop", "orders", "order_date", "DATE", ""),
    ("main", "shop", "orders", "order_status", "STRING", ""),
    ("main", "shop", "orders", "total_amount", "DECIMAL(12,2)", ""),
    ("main", "shop", "orders", "channel", "STRING", ""),
    ("main", "shop", "order_items", "order_id", "BIGINT", ""),
    ("main", "shop", "order_items", "product_id", "BIGINT", ""),
    ("main", "shop", "order_items", "quantity", "INT", ""),
    ("main", "shop", "order_items", "unit_price", "DOUBLE", ""),
    ("main", "shop", "order_items", "discount_pct", "DOUBLE", ""),
    ("main", "shop", "customers", "customer_id", "BIGINT", ""),
    ("main", "shop", "customers", "signup_date", "DATE", ""),
    ("main", "shop", "customers", "segment", "STRING", ""),
    ("main", "shop", "customers", "birth_year", "INT", ""),
    ("main", "shop", "customers", "churned", "BOOLEAN", ""),
    ("main", "shop", "products", "product_id", "BIGINT", ""),
    ("main", "shop", "products", "category", "STRING", ""),
    ("main", "shop", "products", "brand", "STRING", ""),
    ("main", "shop", "products", "list_price", "DOUBLE", ""),
    ("main", "shop", "stores", "store_id", "BIGINT", ""),
    ("main", "shop", "stores", "region", "STRING", ""),
    ("main", "shop", "reviews", "review_id", "BIGINT", ""),
    ("main", "shop", "reviews", "product_id", "BIGINT", ""),
    ("main", "shop", "reviews", "review_text", "STRING", ""),
    ("main", "shop", "reviews", "rating", "INT", ""),
    ("main", "shop", "reviews", "review_date", "DATE", ""),
    ("main", "shop", "web_events", "session_id", "STRING", ""),
    ("main", "shop", "web_events", "customer_id", "BIGINT", ""),
    ("main", "shop", "web_events", "event_type", "STRING", ""),
    ("main", "shop", "web_events", "event_ts", "TIMESTAMP", ""),
    ("main", "shop", "web_logistics", "shipment_id", "BIGINT", ""),
    ("main", "shop", "web_logistics", "carrier", "STRING", ""),
    ("main", "shop", "web_logistics", "ship_date", "DATE", ""),
    ("main", "shop", "web_logistics", "freight_cost", "DOUBLE", ""),
    ("main", "shop", "fx_rates", "rate_date", "DATE", ""),
    ("main", "shop", "fx_rates", "currency", "STRING", ""),
    ("main", "shop", "fx_rates", "usd_rate", "DOUBLE", ""),
    ("main", "shop", "trips", "pickup_ts", "TIMESTAMP", ""),
    ("main", "shop", "trips", "fare", "DOUBLE", ""),
    ("main", "shop", "trips", "tip", "DOUBLE", ""),
    ("main", "shop", "trips", "zone", "STRING", ""),
    ("main", "shop", "etl_audit_log", "job_id", "STRING", ""),
    ("main", "shop", "etl_audit_log", "run_ts", "TIMESTAMP", ""),
    ("main", "shop", "etl_audit_log", "rows_written", "BIGINT", ""),
]

CATEGORY = {
    "main.shop.orders": "TRANSACTIONAL", "main.shop.order_items": "TRANSACTIONAL",
    "main.shop.customers": "MASTER", "main.shop.products": "MASTER", "main.shop.stores": "MASTER",
    "main.shop.reviews": "TRANSACTIONAL", "main.shop.web_events": "TRANSACTIONAL",
    "main.shop.web_logistics": "TRANSACTIONAL", "main.shop.fx_rates": "REFERENCE",
    "main.shop.trips": "TRANSACTIONAL", "main.shop.etl_audit_log": "TECHNICAL",
}

FKS = [
    ("main", "shop", "order_items", "order_id", "main", "shop", "orders", "order_id"),
    ("main", "shop", "order_items", "product_id", "main", "shop", "products", "product_id"),
    ("main", "shop", "orders", "customer_id", "main", "shop", "customers", "customer_id"),
    ("main", "shop", "orders", "store_id", "main", "shop", "stores", "store_id"),
    ("main", "shop", "reviews", "product_id", "main", "shop", "products", "product_id"),
    ("main", "shop", "web_events", "customer_id", "main", "shop", "customers", "customer_id"),
]


class FakeStorage:
    def __init__(self, rows):
        self.rows = list(rows)

    def load_schema_details(self, name="all_columns_for_sql"):
        return [tuple(r) for r in self.rows]


class FakeLoader:
    def __init__(self, rels, schema):
        self.foreign_key_graph = {}
        for rel in rels:
            self.foreign_key_graph.setdefault(tuple(rel[:3]), []).append(tuple(rel))
        self.all_table_tuples = sorted({tuple(r[:3]) for r in schema})

    def get_foreign_key_relations(self, table_tuples):
        out = []
        for t in table_tuples:
            out.extend(self.foreign_key_graph.get(t, []))
        return out

    def infer_foreign_keys_by_naming(self, rows):
        return {}


def make(ns, schema=SCHEMA, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_recal")
    obj.processing_honesty = {}
    obj.data_loader = FakeLoader(FKS, schema)
    obj.data_category_map = dict(CATEGORY)
    obj.global_table_names = {k for k, v in CATEGORY.items() if v != "TECHNICAL"}
    obj.user_business_domains = []
    obj.storage_manager = FakeStorage(schema)
    obj.ai_agent = None
    for k, v in attrs.items():
        setattr(obj, k, v)
    return obj


def U(no, name, tech, tables, solution, bv="", hld="", statement=None, **extra):
    d = {
        "No": no, "Name": name, "usecase": name, "type": "Problem", "Analytics Technique": tech,
        "Statement": statement or f"{name}: the team cannot see which records drive the outcome today and acts late.",
        "Solution": solution,
        "Business Value": bv or "Gives the owning team an earlier, evidence-based decision on where to act.",
        "Beneficiary": "Head of Operations", "Sponsor": "Chief Operating Officer",
        "Tables Involved": tables, "High Level Design": hld,
        "Business Domain": "Sales", "Subdomain": "Demand Planning",
        "Value": 0.0, "Feasibility": 0.0, "Priority": 0.0, "Quality": "Pending",
    }
    d.update(extra)
    return d


def strong_corpus():
    return [
        U("N01-U01", "Forecast Weekly Store Demand to Reduce Stockouts", "Forecasting",
          "main.shop.orders, main.shop.order_items, main.shop.stores",
          "Aggregate `quantity` by `store_id` and ISO week of `order_date`; fit a Prophet model per store and publish an 8-week forecast table.",
          bv="Reduces stockout exposure and lowers excess carrying cost; measurable as `quantity` shortfall by `order_date` [ESTIMATE: depends on quantity].",
          hld="Prophet per store on weekly quantity; backtest on the last 12 weeks."),
        U("N01-U02", "Predict Customer Churn Risk to Prioritize Retention Outreach", "Classification",
          "main.shop.customers, main.shop.orders",
          "Build recency and frequency features from `order_date`, `order_id` and `total_amount`; train an XGBoost classifier against `churned` and rank accounts weekly.",
          bv="Increases retention, reduces revenue leakage and saves outreach effort by focusing the retention team on the riskiest accounts first.",
          hld="XGBoost binary classifier, monthly retrain, SHAP explanations for each flagged account."),
        U("N01-U03", "Detect Anomalous Discount Usage to Prevent Margin Leakage", "Anomaly Detection",
          "main.shop.order_items, main.shop.orders",
          "Train an Isolation Forest on discount_pct, unit_price and quantity per order, then route the top outliers to finance for review.",
          bv="Protects margin by catching discount abuse before month end."),
        U("N01-U04", "Segment Customers by Purchase Behavior to Tailor Promotions", "Clustering",
          "main.shop.customers, main.shop.orders",
          "Compute spend from `total_amount`, cadence from `order_date` and tenure from `signup_date`; run K-Means and profile each cluster by `segment`.",
          hld="K-Means with silhouette-based k selection."),
        U("N01-U05", "Analyze Checkout Funnel Drop-Off to Recover Abandoned Sessions", "Funnel Analysis",
          "main.shop.web_events",
          "Order `event_type` stages by `event_ts` within each `session_id`, compute stage-to-stage conversion and surface the largest drop-off step.",
          hld="SQL funnel over ordered event stages with conversion rates per step."),
        U("N01-U06", "Monitor Product Review Sentiment to Flag Quality Issues", "Sentiment Analysis",
          "main.shop.reviews, main.shop.products",
          "Score each review with ai_analyze_sentiment and roll the negative share up by `product_id` and `category` weekly.",
          hld="ai_analyze_sentiment over the review body; weekly negative-share alert per product."),
        U("N01-U07", "Rank Stores by Revenue Concentration", "Pareto Analysis",
          "main.shop.orders, main.shop.stores",
          "Sum `total_amount` by `store_id` and `region`, sort descending and compute the cumulative share curve.",
          hld="Cumulative share over ranked store revenue."),
        U("N01-U08", "Track Customer Cohort Retention by Signup Month", "Cohort Analysis",
          "main.shop.customers, main.shop.orders",
          "Form cohorts by `signup_date` month and track average order value and repeat-purchase retention per cohort over `order_date`.",
          hld="Cohort matrix of retention by months since signup."),
        U("N01-U09", "Simulate Promotional Discount Scenarios to Set Price Floors", "Monte Carlo Simulation",
          "main.shop.order_items, main.shop.products",
          "Run a Monte Carlo simulation over hypothetical price changes using `unit_price`, `discount_pct` and `quantity` elasticity estimated per `category`.",
          hld="Monte Carlo over elasticity draws per category."),
        U("N01-U10", "Estimate Customer Lifetime Value to Guide Acquisition Spend", "Regression Analysis",
          "main.shop.customers, main.shop.orders",
          "Regress 12-month `total_amount` on tenure from `signup_date`, `segment` and early order cadence from `order_date`.",
          hld="Ridge regression with cross-validated alpha."),
        U("N01-U11", "Forecast Fare Revenue by Zone", "Forecasting",
          "main.shop.trips",
          "Aggregate `fare` and `tip` by `zone` and hour of `pickup_ts`; fit ai_forecast per zone.",
          hld="ai_forecast per zone on hourly revenue."),
        U("N01-U12", "Rank Zones by Fare Concentration", "Pareto Analysis",
          "main.shop.trips",
          "Sum `fare` by `zone`, rank and compute the cumulative revenue share to isolate the top zones.",
          hld="Pareto curve over zone revenue."),
        U("N01-U13", "Forecast Daily Currency Rates to Hedge Supplier Payments", "Forecasting",
          "main.shop.fx_rates",
          "Fit ARIMA on `usd_rate` by `currency` over `rate_date` and publish a 30-day forecast.",
          hld="ARIMA per currency."),
        U("N01-U14", "Optimize Carrier Selection to Cut Freight Cost", "Optimization",
          "main.shop.web_logistics",
          "Score each `carrier` on `freight_cost` per shipment over `ship_date`; solve a linear program assigning shipments to carriers.",
          hld="Linear program with cost minimization."),
        U("N01-U15", "Improve Customer Retention through Personalized Offers", "Classification",
          "main.shop.customers, main.shop.orders",
          "Train an XGBoost classifier on `order_date` recency, `total_amount` and `segment` to choose the offer each at-risk customer receives.",
          hld="XGBoost propensity per offer."),
    ]


def ids(ucs):
    return [u["No"] for u in ucs]


def reasons(dropped):
    return {u["No"]: r for u, r in dropped}


class TestQ5DecisionReadiness:
    def test_strong_corpus_survives_q5_with_pre_scoring_zero_priority(self, ns):
        o = make(ns)
        corpus = strong_corpus()
        kept, dropped = o._phaseQ5_decision_readiness(corpus, SCHEMA)
        assert reasons(dropped) == {}
        assert ids(kept) == ids(corpus)

    def test_r17_score_floor_no_longer_exists(self, ns):
        o = make(ns)
        u = strong_corpus()[0]
        u["Priority"] = 1.5
        kept, dropped = o._phaseQ5_decision_readiness([u], SCHEMA)
        assert dropped == [] and ids(kept) == ["N01-U01"]
        src = ast.unparse(method_node("DatabricksInspire", "_phaseQ5_decision_readiness"))
        assert "R17" not in src and "7.0" not in src

    def test_r15_non_decision_verb_is_a_flag_not_a_drop(self, ns):
        o = make(ns)
        corpus = strong_corpus()
        kept, dropped = o._phaseQ5_decision_readiness(corpus, SCHEMA)
        flagged = {u["No"] for u in kept if u.get("decision_verb_flag") is True}
        assert flagged == {"N01-U05", "N01-U06", "N01-U08"}
        assert all("decision_verb_flag" not in u for u in kept if u["No"] not in flagged)

    def test_r16_text_column_check_lives_once_in_q3_r14(self, ns):
        o = make(ns)
        drop = U("N02-U01", "Detect Negative Sentiment in Order Notes", "Sentiment Analysis",
                 "main.shop.orders",
                 "Apply ai_analyze_sentiment to order notes and alert on negative share by `store_id` and `order_date`.",
                 hld="ai_analyze_sentiment")
        kept5, dropped5 = o._phaseQ5_decision_readiness([drop], SCHEMA)
        assert ids(kept5) == ["N02-U01"] and dropped5 == []
        kept3, dropped3 = o._phaseQ3_validate_relevance([strong_corpus()[5], drop], SCHEMA)
        assert ids(kept3) == ["N01-U06"]
        assert reasons(dropped3)["N02-U01"] == "Q3_R14_DATA_FIT_SCALE:R14_TEXT_NO_TEXT_COLUMN"

    def test_r18_flags_label_drift_reads_high_level_design_and_never_drops(self, ns):
        o = make(ns)
        hld_only = U("N02-U02", "Project Weekly Units by Category", "Forecasting",
                     "main.shop.order_items, main.shop.products",
                     "Aggregate `quantity` by `category` per week and order categories with dense_rank for planning.",
                     hld="Prophet per category with weekly seasonality.")
        contradiction = U("N02-U03", "Detect Unusual Refund Accounts", "Anomaly Detection",
                          "main.shop.orders, main.shop.customers",
                          "Train an XGBoost classifier on `total_amount` and `order_status` to predict refund default; logistic regression baseline.",
                          hld="Supervised XGBoost classification with logistic baseline.")
        silent = U("N02-U04", "Rank Categories by Margin Concentration", "Pareto Analysis",
                   "main.shop.order_items, main.shop.products",
                   "Sum `unit_price` times `quantity` by `category` and sort descending.",
                   hld="Sorted aggregation.")
        generic_learner = U("N02-U06", "Project Next Week Store Sales", "Forecasting",
                            "main.shop.orders, main.shop.stores",
                            "Train XGBoost on lagged weekly `total_amount` per `store_id` to project next week.",
                            hld="Gradient boosted trees on lag features.")
        kept, dropped = o._phaseQ5_decision_readiness([hld_only, contradiction, silent, generic_learner], SCHEMA)
        assert dropped == []
        flags = {u["No"]: [f for f in u.get("gate_flags", []) if not f.startswith("Q5_R20_NAME_STYLE:")] for u in kept}
        assert flags["N02-U03"] == ["Q5_R18_TECHNIQUE_LABEL_DRIFT:anomaly"]
        assert flags["N02-U02"] == [] and flags["N02-U04"] == [] and flags["N02-U06"] == []

    def test_r19_drops_vacuous_generic_title_but_keeps_generic_title_with_concrete_method(self, ns):
        o = make(ns)
        vacuous = U("N02-U05", "Improve Customer Experience to Grow Revenue", "Trend Analysis",
                    "main.shop.customers, main.shop.orders",
                    "Look at customer information and `total_amount` and `order_date` to find opportunities.",
                    hld="Dashboards.")
        concrete = strong_corpus()[14]
        kept, dropped = o._phaseQ5_decision_readiness([vacuous, concrete], SCHEMA)
        assert ids(kept) == ["N01-U15"]
        assert reasons(dropped)["N02-U05"] == "Q5_R19_GENERIC_TITLE"
        assert "Q5_R19_GENERIC_TITLE" in kept[0].get("gate_flags", [])


class TestQ3Relevance:
    def test_strong_corpus_survives_q3(self, ns):
        o = make(ns)
        corpus = strong_corpus()
        kept, dropped = o._phaseQ3_validate_relevance(corpus, SCHEMA)
        assert reasons(dropped) == {}
        assert ids(kept) == ids(corpus)

    def test_r14_a_text_word_inside_a_key_name_is_not_a_text_column(self, ns):
        schema = SCHEMA + [("main", "shop", "ticket_notes", "note_id", "STRING", ""),
                           ("main", "shop", "ticket_notes", "store_id", "BIGINT", ""),
                           ("main", "shop", "ticket_notes", "note_date", "DATE", ""),
                           ("main", "shop", "ticket_notes", "resolution_minutes", "INT", "")]
        o = make(ns, schema=schema)
        keyed = U("N02-U02", "Detect Negative Sentiment in Ticket Notes", "Sentiment Analysis", "main.shop.ticket_notes",
                  "Apply ai_analyze_sentiment to `note_id` per `store_id` and `note_date` and alert on the negative share.",
                  hld="ai_analyze_sentiment")
        texted = U("N02-U03", "Detect Negative Sentiment in Product Reviews", "Sentiment Analysis", "main.shop.reviews",
                   "Apply ai_analyze_sentiment to `review_text` per `product_id` and `review_date` and alert on the negative share.",
                   hld="ai_analyze_sentiment")
        kept, dropped = o._phaseQ3_validate_relevance([keyed, texted], schema)
        assert reasons(dropped) == {"N02-U02": "Q3_R14_DATA_FIT_SCALE:R14_TEXT_NO_TEXT_COLUMN"}
        assert ids(kept) == ["N02-U03"]

    def test_r1_uses_the_agents_own_table_classification(self, ns):
        o = make(ns)
        technical = U("N03-U01", "Detect Failed Pipeline Runs", "Anomaly Detection", "main.shop.etl_audit_log",
                      "Score `rows_written` per `job_id` over `run_ts` with an Isolation Forest.")
        business_with_log_substring = strong_corpus()[13]
        kept, dropped = o._phaseQ3_validate_relevance([technical, business_with_log_substring], SCHEMA)
        assert ids(kept) == ["N01-U14"]
        assert reasons(dropped)["N03-U01"] == "UC_NOT_RELEVANT:R1_TECHNICAL_ONLY"

    def test_r2_funnel_requires_stage_or_status_evidence(self, ns):
        o = make(ns)
        no_stage = U("N03-U02", "Analyze Category Purchase Funnel", "Funnel Analysis", "main.shop.products",
                     "Build a funnel over `category` and `brand` with `list_price` bands.")
        kept, dropped = o._phaseQ3_validate_relevance([strong_corpus()[4], no_stage], SCHEMA)
        assert ids(kept) == ["N01-U05"]
        assert reasons(dropped)["N03-U02"].startswith("UC_NOT_RELEVANT:R2_TECHNIQUE_DATA_MISMATCH")

    def test_r2_still_drops_forecast_without_date(self, ns):
        o = make(ns)
        u = U("N03-U03", "Forecast Brand Price Levels", "Forecasting", "main.shop.products",
              "Fit a model on `list_price` by `brand` and `category`.")
        kept, dropped = o._phaseQ3_validate_relevance([u], SCHEMA)
        assert kept == [] and reasons(dropped)["N03-U03"].startswith("UC_NOT_RELEVANT:R2")

    def test_r5_reference_table_forecast_is_flagged_not_dropped(self, ns):
        o = make(ns)
        u = strong_corpus()[12]
        kept, dropped = o._phaseQ3_validate_relevance([u], SCHEMA)
        assert ids(kept) == ["N01-U13"] and dropped == []
        assert "Q3_R5_REFERENCE_AS_FACT" in kept[0]["gate_flags"]

    def test_r7_prose_value_statement_kept_and_invented_figures_dropped(self, ns):
        o = make(ns)
        prose = strong_corpus()[1]
        invented = U("N03-U04", "Predict High Value Basket Upsell", "Classification",
                     "main.shop.orders, main.shop.order_items",
                     "Train an XGBoost classifier on `quantity`, `unit_price` and `total_amount` per `order_id`.",
                     bv="Delivers $2.4M in new revenue, a 15% lift in basket size and 3x ROI within a year.")
        tagged = U("N03-U05", "Predict Low Margin Orders", "Classification",
                   "main.shop.orders, main.shop.order_items",
                   "Train an XGBoost classifier on `discount_pct`, `unit_price` and `quantity`.",
                   bv="Could protect $1M, 10% margin and 2x faster review [ESTIMATE: depends on discount_pct].")
        kept, dropped = o._phaseQ3_validate_relevance([prose, invented, tagged], SCHEMA)
        assert ids(kept) == ["N01-U02", "N03-U05"]
        assert reasons(dropped)["N03-U04"].startswith("Q3_R7_BV_UNGROUNDED_QUANTITIES")

    def test_r8_label_definition_is_not_leakage_and_real_leakage_is_flagged_not_dropped(self, ns):
        o = make(ns)
        label_only = U("N03-U06", "Predict Churned Accounts for Win-Back", "Classification",
                       "main.shop.customers, main.shop.orders",
                       "Predict churned customers. Label: `churned`. Features: `segment`, `signup_date`, `total_amount`.")
        leaking = U("N03-U13", "Predict Churned Accounts from Prior Month", "Classification",
                    "main.shop.customers, main.shop.orders",
                    "Predict `churned` using `segment`, `total_amount` and `churned` from the prior month.")
        kept, dropped = o._phaseQ3_validate_relevance([label_only, leaking], SCHEMA)
        assert ids(kept) == ["N03-U06", "N03-U13"] and dropped == []
        assert "gate_flags" not in kept[0]
        assert kept[1]["gate_flags"] == ["Q3_R8_TARGET_LEAKAGE:churned"]

    def test_r9_simulation_may_use_hypothetical_inputs_other_techniques_may_not(self, ns):
        o = make(ns)
        sim = strong_corpus()[8]
        invented = U("N03-U07", "Predict Unprofitable Orders", "Classification",
                     "main.shop.orders, main.shop.order_items",
                     "Combine `quantity` and `unit_price` with an assumed cost per unit to label unprofitable `order_id` rows.")
        parameter = U("N03-U16", "Flag Low Margin Orders for Review", "Classification",
                      "main.shop.orders, main.shop.order_items",
                      "Train an XGBoost classifier on `discount_pct`, `unit_price` and `quantity` with an assumed threshold of the top decile.")
        kept, dropped = o._phaseQ3_validate_relevance([sim, invented, parameter], SCHEMA)
        assert ids(kept) == ["N01-U09", "N03-U16"]
        assert reasons(dropped)["N03-U07"] == "Q3_R9_SIMULATED_INPUT:assumed_cost"
        assert kept[1]["gate_flags"] == ["Q3_R9_ASSUMED_PARAMETER:threshold"]

    def test_r11_cohort_average_is_not_a_biographical_anchor(self, ns):
        o = make(ns)
        bio = U("N03-U08", "Compare Customer Cohort Spend", "Cohort Analysis",
                "main.shop.customers, main.shop.orders",
                "Group customers into cohorts by `birth_year` and compare `total_amount` over `order_date`.")
        age_as_dimension = U("N03-U17", "Compare Retention Cohorts Across Age Bands", "Cohort Analysis",
                             "main.shop.customers, main.shop.orders",
                             "Compare retention cohorts across age bands and track repeat purchases over `order_date` and `total_amount`.")
        age_cohorts = U("N03-U18", "Compare Age Cohort Spend", "Cohort Analysis",
                        "main.shop.customers, main.shop.orders",
                        "Build age cohorts and compare `total_amount` over `order_date`.")
        kept, dropped = o._phaseQ3_validate_relevance([strong_corpus()[7], bio, age_as_dimension, age_cohorts], SCHEMA)
        assert ids(kept) == ["N01-U08", "N03-U17"]
        assert reasons(dropped)["N03-U08"] == "Q3_R11_COHORT_BIOGRAPHICAL_ANCHOR"
        assert reasons(dropped)["N03-U18"] == "Q3_R11_COHORT_BIOGRAPHICAL_ANCHOR"

    def test_r13_counts_real_columns_without_backticks_and_drops_invented_ones(self, ns):
        o = make(ns)
        bare = strong_corpus()[2]
        invented = U("N03-U09", "Optimize Store HVAC Energy Use", "Optimization", "main.shop.stores",
                     "Minimize `hvac_kwh` by tuning `thermostat_setpoint` per store hour.")
        one_real_one_invented = U("N03-U14", "Optimize Store HVAC Load", "Optimization", "main.shop.stores",
                                  "Minimize `hvac_kwh` per `store_id` across opening hours.")
        one_real = U("N03-U15", "Forecast Hourly Fares", "Forecasting", "main.shop.trips",
                     "Forecast hourly `fare` with Prophet and publish the result.")
        kept, dropped = o._phaseQ3_validate_relevance([bare, invented, one_real_one_invented, one_real], SCHEMA)
        assert ids(kept) == ["N01-U03", "N03-U15"]
        assert reasons(dropped)["N03-U09"] == "Q3_R13_SOLUTION_UNDER_GROUNDED:0"
        assert reasons(dropped)["N03-U14"] == "Q3_R13_SOLUTION_UNDER_GROUNDED:1"
        assert kept[1]["gate_flags"] == ["Q3_R13_THIN_GROUNDING"]

    def test_r14_pareto_on_untyped_measure_names_and_count_based_pareto_are_kept(self, ns):
        o = make(ns)
        kept, dropped = o._phaseQ3_validate_relevance([strong_corpus()[11]], SCHEMA)
        assert ids(kept) == ["N01-U12"] and dropped == []
        text_schema = [r for r in SCHEMA if r[2] != "reviews"] + [
            ("main", "shop", "reviews", "review_text", "STRING", ""),
            ("main", "shop", "reviews", "review_ref", "STRING", ""),
            ("main", "shop", "reviews", "theme", "STRING", "")]
        o2 = make(ns, schema=text_schema)
        by_count = U("N03-U10", "Rank Complaint Themes by Frequency", "Pareto Analysis", "main.shop.reviews",
                     "Count `review_ref` per `theme`, sort descending and take the cumulative share of complaints.")
        kept2, dropped2 = o2._phaseQ3_validate_relevance([by_count], text_schema)
        assert ids(kept2) == ["N03-U10"] and dropped2 == []

    def test_r2_untyped_string_schema_and_count_based_ranking_are_not_rejected(self, ns):
        untyped = [("ext", "share", "events", "event_date", "STRING", ""), ("ext", "share", "events", "region", "STRING", ""),
                   ("ext", "share", "events", "channel", "STRING", ""), ("ext", "share", "events", "theme", "STRING", "")]
        o = make(ns, schema=untyped, data_category_map={}, global_table_names={"ext.share.events"})
        forecast = U("N03-U18", "Forecast Daily Event Volume by Region", "Forecasting", "ext.share.events",
                     "Count events per `region` per day of `event_date` and fit Prophet.")
        ranking = U("N03-U19", "Rank Themes by Event Count", "Ranking", "ext.share.events",
                    "Count rows per `theme` and `channel` and rank descending.")
        kept, dropped = o._phaseQ3_validate_relevance([forecast, ranking], untyped)
        assert ids(kept) == ["N03-U18", "N03-U19"] and dropped == []

    def test_r2_typed_table_without_any_measure_still_rejects_regression(self, ns):
        typed = [("c", "s", "labels", "label_date", "DATE", ""), ("c", "s", "labels", "label_name", "STRING", ""),
                 ("c", "s", "labels", "label_group", "STRING", "")]
        o = make(ns, schema=typed, data_category_map={}, global_table_names={"c.s.labels"})
        u = U("N03-U20", "Estimate Label Effects", "Regression Analysis", "c.s.labels",
              "Regress `label_group` on `label_name` over `label_date`.")
        kept, dropped = o._phaseQ3_validate_relevance([u], typed)
        assert kept == [] and reasons(dropped)["N03-U20"].startswith("UC_NOT_RELEVANT:R2_TECHNIQUE_DATA_MISMATCH")

    def test_r14_geospatial_needs_a_geographic_column(self, ns):
        o = make(ns)
        no_geo = U("N03-U11", "Map Brand Price Hotspots", "Geospatial Analysis", "main.shop.products",
                   "Plot `list_price` by `brand` and `category` hotspots.")
        zoned = U("N03-U12", "Map Fare Hotspots by Pickup Zone", "Geospatial Analysis", "main.shop.trips",
                  "Aggregate `fare` by `zone` and hour of `pickup_ts` and map the hotspots.")
        kept, dropped = o._phaseQ3_validate_relevance([no_geo, zoned], SCHEMA)
        assert ids(kept) == ["N03-U12"]
        assert reasons(dropped)["N03-U11"] == "Q3_R14_DATA_FIT_SCALE:R14_GEO_NO_GEOGRAPHIC_COLUMN"


class TestQ1Grounding:
    def test_fail_closed_when_no_table_universe(self, ns, caplog):
        o = make(ns, data_loader=None, global_table_names=set())
        corpus = strong_corpus()[:3]
        with caplog.at_level(logging.ERROR, logger="v120_recal"):
            kept, dropped = o._phaseQ1_validate_grounding(corpus, [])
        assert kept == []
        assert [r for _, r in dropped] == ["Q1_UNCHECKABLE:NO_SCHEMA"] * 3
        assert o.processing_honesty.get("q1_grounding_unchecked") is True
        assert any("[Q1 FAIL_CLOSED FIRED]" in r.getMessage() for r in caplog.records)

    def test_table_universe_alone_is_enough_to_check(self, ns):
        o = make(ns)
        u = U("N04-U01", "Rank Stores by Revenue", "Ranking", "main.shop.stores", "Rank `store_id` by `region`.")
        kept, dropped = o._phaseQ1_validate_grounding([u], [])
        assert ids(kept) == ["N04-U01"] and dropped == []

    def test_backticked_parts_and_unique_two_part_names_resolve_and_canonicalize(self, ns):
        o = make(ns)
        u = U("N04-U02", "Rank Stores by Revenue", "Ranking", "`main`.`shop`.`stores`; shop.orders",
              "Rank `store_id` by `total_amount`.")
        kept, dropped = o._phaseQ1_validate_grounding([u], SCHEMA)
        assert ids(kept) == ["N04-U02"] and dropped == []
        assert kept[0]["Tables Involved"] == "main.shop.stores, main.shop.orders"

    def test_ambiguous_and_hallucinated_tables_are_dropped(self, ns):
        schema = SCHEMA + [("other", "shop", "orders", "order_id", "BIGINT", "")]
        o = make(ns, schema=schema)
        amb = U("N04-U03", "Rank Orders", "Ranking", "shop.orders", "Rank `order_id`.")
        fake = U("N04-U04", "Predict Loyalty Points Burn", "Forecasting", "main.shop.loyalty_points",
                 "Forecast `points` by `burn_date`.")
        kept, dropped = o._phaseQ1_validate_grounding([amb, fake], schema)
        assert kept == []
        assert reasons(dropped)["N04-U03"].startswith("UC_NOT_GROUNDED")
        assert reasons(dropped)["N04-U04"].startswith("UC_NOT_GROUNDED")

    def test_volume_paths_pass_and_mixed_refs_are_still_checked(self, ns):
        o = make(ns)
        vol = U("N04-U05", "Extract Contract Terms", "Information Extraction", "/Volumes/main/shop/docs",
                "Parse PDFs.")
        mixed_bad = U("N04-U06", "Extract Order Terms", "Information Extraction",
                      "/Volumes/main/shop/docs, main.shop.ghost", "Parse PDFs.")
        kept, dropped = o._phaseQ1_validate_grounding([vol, mixed_bad], SCHEMA)
        assert ids(kept) == ["N04-U05"]
        assert reasons(dropped)["N04-U06"].startswith("UC_NOT_GROUNDED")


class TestGGates:
    def test_g_runner_keeps_strong_corpus(self, ns):
        o = make(ns)
        corpus = strong_corpus()
        out = o._phaseG_run_quality_gates(corpus, SCHEMA)
        assert ids(out) == ids(corpus)

    def test_schema_completeness_handles_non_string_values(self, ns):
        o = make(ns)
        bad = strong_corpus()[0]
        bad["Solution"] = None
        odd = strong_corpus()[1]
        odd["Statement"] = 12345
        kept = o._phaseG_validate_schema_completeness([bad, odd])
        assert ids(kept) == ["N01-U02"]

    def test_catchall_technique_relabelled_from_design_or_dropped(self, ns):
        o = make(ns)
        relabel = strong_corpus()[1]
        relabel["Analytics Technique"] = "AI Analysis"
        vague = U("N05-U01", "Use AI on Customer Data", "AI Analysis", "main.shop.customers",
                  "Apply AI to `segment` and `signup_date` to find insights.", hld="AI.")
        kept = o._phaseG_validate_no_catchall_technique([relabel, vague])
        assert ids(kept) == ["N01-U02"]
        assert kept[0]["Analytics Technique"] == "Classification"

    def test_column_grounding_stays_advisory(self, ns):
        o = make(ns)
        u = strong_corpus()[0]
        u["Solution"] += " Also uses `ghost_column`."
        out = o._phaseG_validate_column_grounding([u], SCHEMA)
        assert ids(out) == ["N01-U01"]

    def test_g_runner_survives_a_raising_gate_and_marks_unverified(self, ns, caplog):
        o = make(ns)

        def boom(ucs, *a):
            raise ValueError("synthetic G failure")
        o._phaseG_validate_column_grounding = boom
        corpus = strong_corpus()[:2]
        with caplog.at_level(logging.WARNING, logger="v120_recal"):
            out = o._phaseG_run_quality_gates(corpus, SCHEMA)
        assert ids(out) == ["N01-U01", "N01-U02"]
        assert all("G2_column_grounding" in u["gate_unverified"] for u in out)
        msgs = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
        assert any("G2_column_grounding" in m and "ValueError" in m and "synthetic G failure" in m for m in msgs)


class TestQRunner:
    def test_runner_keeps_strong_corpus_and_records_ledger(self, ns):
        o = make(ns)
        o._canonicalize_sponsor_beneficiary_roles = lambda ucs: ucs
        corpus = strong_corpus()
        out = o._phaseQ_run_integrity_gates(corpus, SCHEMA)
        assert ids(out) == ids(corpus)
        ph = o.processing_honesty
        assert ph["q1_grounding_dropped"] == 0 and ph["q2_dedup_dropped"] == 0
        assert ph["q3_relevance_dropped"] == 0 and ph["q5_decision_dropped"] == 0
        assert ph["q5_decision_verb_flagged"] == 3
        assert set(ph["gate_ledger"]) >= {"Q1", "Q2", "Q3", "Q5"}
        assert ph["gate_ledger"]["Q5"]["in"] == len(corpus)

    def test_runner_records_q5_drops_by_reason(self, ns):
        o = make(ns)
        o._canonicalize_sponsor_beneficiary_roles = lambda ucs: ucs
        vacuous = U("N02-U05", "Improve Customer Experience to Grow Revenue", "Trend Analysis",
                    "main.shop.customers, main.shop.orders",
                    "Look at customer information and `total_amount` and `order_date` to find opportunities.",
                    hld="Dashboards.")
        out = o._phaseQ_run_integrity_gates(strong_corpus()[:2] + [vacuous], SCHEMA)
        assert ids(out) == ["N01-U01", "N01-U02"]
        assert o.processing_honesty["q5_decision_dropped"] == 1
        assert o.processing_honesty["q5_drop_reasons"] == {"Q5_R19_GENERIC_TITLE": 1}

    def test_runner_logs_gate_exception_with_traceback_and_marks_unverified(self, ns, caplog):
        o = make(ns)
        o._canonicalize_sponsor_beneficiary_roles = lambda ucs: ucs

        def boom(ucs, schema):
            raise KeyError("synthetic Q3 failure")
        o._phaseQ3_validate_relevance = boom
        corpus = strong_corpus()[:3]
        with caplog.at_level(logging.WARNING, logger="v120_recal"):
            out = o._phaseQ_run_integrity_gates(corpus, SCHEMA)
        assert ids(out) == ids(corpus)
        assert all(u["gate_unverified"] == ["Q3"] for u in out)
        warn = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING and "Q3" in r.getMessage()]
        assert warn and "KeyError" in warn[0] and "boom" in warn[0]
        assert o.processing_honesty["gate_exceptions"][0]["gate"] == "Q3"

    def test_two_failing_gates_accumulate_unverified_names(self, ns):
        o = make(ns)
        o._canonicalize_sponsor_beneficiary_roles = lambda ucs: ucs

        def boom(*a, **k):
            raise RuntimeError("x")
        o._phaseQ2_canonical_dedup = boom
        o._phaseQ5_decision_readiness = boom
        out = o._phaseQ_run_integrity_gates(strong_corpus()[:2], SCHEMA)
        assert all(u["gate_unverified"] == ["Q2", "Q5"] for u in out)

    def test_q2c_dead_pass_is_gone(self, ns):
        assert not hasattr(ns["DatabricksInspire"], "_phaseQ2c_verb_object_cluster")
        src = ast.unparse(method_node("DatabricksInspire", "_phaseQ_run_integrity_gates"))
        assert "q2c" not in src.lower()


class TestPhaseL:
    def _final(self, corpus):
        for u in corpus:
            u["Primary Table"] = u["Tables Involved"].split(",")[0].strip()
            u["result_table"] = "main.inspire._inspire_" + u["No"].lower().replace("-", "_")
            u["Inspire Score"] = 7.5
            u["Priority"] = 7.0
        return corpus

    def test_results_exposed_on_instance_and_input_never_filtered(self, ns):
        o = make(ns)
        corpus = self._final(strong_corpus())
        before = list(corpus)
        res = o._phaseL_final_gate(corpus, SCHEMA)
        assert o.phase_l_results == res
        assert corpus == before
        assert "L16_q5_drop_under_50pct" in res

    def test_l9_flags_signature_duplicates_not_same_name_on_other_tables(self, ns):
        o = make(ns)
        a = self._final([U("N06-U01", "Forecast Weekly Store Demand", "Forecasting", "main.shop.orders",
                           "Aggregate `quantity` by `order_date`.")])[0]
        b = self._final([U("N06-U02", "Predict Store Weekly Demand", "Time-Series Forecasting", "main.shop.orders",
                           "Aggregate `quantity` by `order_date`.")])[0]
        c = self._final([U("N06-U03", "Forecast Weekly Store Demand", "Forecasting",
                           "main.shop.orders, main.shop.stores", "Aggregate `quantity` by `store_id`.")])[0]
        assert o._phaseL_final_gate([a, b], SCHEMA)["L9_no_duplicate_names"]["pass"] is False
        assert o._phaseL_final_gate([a, c], SCHEMA)["L9_no_duplicate_names"]["pass"] is True

    def test_l5_treats_na_primary_table_as_missing(self, ns):
        o = make(ns)
        u = self._final(strong_corpus()[:1])[0]
        u["Primary Table"] = "N/A"
        assert o._phaseL_final_gate([u], SCHEMA)["L5_every_uc_has_primary_table"]["pass"] is False

    def test_l15_flags_placeholder_domains(self, ns):
        o = make(ns)
        corpus = self._final(strong_corpus()[:2])
        corpus[0]["Business Domain"] = "Domain3"
        assert o._phaseL_final_gate(corpus, SCHEMA)["L15_no_placeholder_domains"]["pass"] is False
        corpus[0]["Business Domain"] = "Uncategorized"
        assert o._phaseL_final_gate(corpus, SCHEMA)["L15_no_placeholder_domains"]["pass"] is False
        corpus[0]["Business Domain"] = "Sales"
        assert o._phaseL_final_gate(corpus, SCHEMA)["L15_no_placeholder_domains"]["pass"] is True

    def test_l19_backticked_table_names_are_grounded_and_invented_names_are_not(self, ns):
        o = make(ns)
        corpus = self._final(strong_corpus()[:1])
        corpus[0]["Solution"] += " It joins `orders`, `order_items`, `stores` and `products` and reads `main.shop.stores`."
        o._phaseL_final_gate(corpus, SCHEMA)
        assert o.processing_honesty["phase_L_production_ready_count"] == 1
        corpus[0]["Solution"] += " It also scores `churn_index`, `loyalty_band` and `margin_rank`."
        o._phaseL_final_gate(corpus, SCHEMA)
        assert o.processing_honesty["phase_L_production_ready_count"] == 0

    def test_l19_estimate_tag_is_not_a_placeholder_but_missing_data_is(self, ns):
        o = make(ns)
        corpus = self._final(strong_corpus()[:1])
        o._phaseL_final_gate(corpus, SCHEMA)
        assert o.processing_honesty["phase_L_production_ready_count"] == 1
        corpus[0]["Solution"] += " [MISSING_DATA: supplier lead times]"
        o._phaseL_final_gate(corpus, SCHEMA)
        assert o.processing_honesty["phase_L_production_ready_count"] == 0
