"""Shared doubles for the v1.2.0 GENIE lane tests (Genie Code grounding, validation, notebooks)."""
import types
from unittest.mock import MagicMock

ORDERS = "main.sales.orders"
CUSTOMERS = "main.sales.customers"
STORES = "main.sales.stores"
RESULT = "main.inspire.n01_u01_churn_out"

TABLES = {
    ORDERS: [("order_id", "BIGINT", "order key"), ("customer_id", "BIGINT", "buyer"),
             ("store_id", "BIGINT", ""), ("amount", "DECIMAL(12,2)", "order value"),
             ("order_ts", "TIMESTAMP", "when the order was placed")],
    CUSTOMERS: [("customer_id", "BIGINT", "customer key"), ("segment", "STRING", "marketing segment"),
                ("signup_date", "DATE", "")],
    STORES: [("store_id", "BIGINT", "store key"), ("region", "STRING", "")],
}

RELATIONS = {
    ORDERS: [("customer_id", CUSTOMERS, "customer_id", "declared"), ("store_id", STORES, "store_id", "inferred")],
}


class FakeLoader:
    def __init__(self, tables=None, relations=None):
        self.tables = {k.lower(): list(v) for k, v in (TABLES if tables is None else tables).items()}
        self.relations = RELATIONS if relations is None else relations
        self.calls = []
        self.join_calls = []

    def infer_scope_joins(self, fqns):
        self.join_calls.append(sorted(fqns))
        return 0

    def get_metadata_evidence(self, fqns):
        self.calls.append(sorted(fqns))
        out = {}
        for fqn in fqns:
            key = str(fqn).replace("`", "").lower()
            if key not in self.tables:
                continue
            out[key] = {
                "comment": f"comment of {key}", "table_type": "MANAGED", "tags": {},
                "columns": {c.lower(): {"name": c, "type": t, "comment": d, "nullable": True, "tags": {}}
                            for c, t, d in self.tables[key]},
                "primary_key": [],
                "foreign_keys": [{"column": c, "ref_table": rt, "ref_column": rc, "source": s, "confidence": 1.0}
                                 for c, rt, rc, s in self.relations.get(key, [])],
            }
        return out

    def get_table_comment(self, catalog, schema, table):
        return ""

    def metadata_unavailable_report(self):
        return {"count": 0, "tables": []}

    def get_primary_key(self, catalog, schema, table):
        return []

    def get_table_relations(self, catalog, schema, table):
        return []

    def get_sampling_info(self, catalog, schema, table):
        return None


def schema_details(tables=None):
    rows = []
    for fqn, cols in (TABLES if tables is None else tables).items():
        cat, sch, tbl = fqn.split(".")
        rows.extend((cat, sch, tbl, c, t, d) for c, t, d in cols)
    return rows


def long_instruction(body):
    return "## 1. Persona\nYou are a senior analyst. " + body + "\n" + ("Grounded detail. " * 12)


class FakeAgent:
    def __init__(self, responses):
        self.responses = list(responses) if not callable(responses) else responses
        self.calls = []

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema, model_override=None,
                   timeout_override=None, max_retries_override=None, start_from_model=None, skip_cache=False,
                   temperature_override=None):
        self.calls.append({"step": step_name, "prompt": worker_prompt_path, "vars": dict(prompt_vars),
                           "skip_cache": skip_cache, "timeout": timeout_override})
        if callable(self.responses):
            return self.responses(prompt_vars, skip_cache)
        return self.responses.pop(0) if self.responses else ""


def make_uc(uc_id="N01-U01", **fields):
    uc = {
        "No": uc_id, "Name": f"Use case {uc_id}", "usecase": f"Use case {uc_id}",
        "Business Domain": "Sales", "Subdomain": "Retention", "type": "Risk",
        "Analytics Technique": "Classification", "Priority": 7.0, "Inspire Score": 4.0,
        "Statement": "s", "Solution": "sol", "Business Value": "v", "Quality": "High",
        "Tables Involved": f"{ORDERS}, {CUSTOMERS}", "Primary Table": ORDERS,
        "result_table": RESULT, "High Level Design": "hld",
    }
    uc.update(fields)
    return uc


def tracking_row(uc_id="N01-U01", session_id=7, **columns):
    row = {
        "session_id": session_id, "id": uc_id, "description": f"Use case {uc_id}", "use_case": f"Use case {uc_id}",
        "business_domain": "Sales", "subdomain": "Retention", "type": "Risk", "analytics_technique": "Classification",
        "statement": "s", "solution": "sol", "business_value": "v", "tables_involved": f"{ORDERS}, {CUSTOMERS}",
        "primary_table": ORDERS, "result_database": RESULT, "priority_score": 7.0, "inspire_score": 4.0,
        "directly_involved_schema": "- `main.sales.orders` (persisted)", "generate_genie_code_instruction": "Yes",
    }
    row.update(columns)
    return row


def build_inspire(ns, loader=None, quality="Good", agent=None, **attrs):
    DI = ns["DatabricksInspire"]
    inst = DI.__new__(DI)
    inst.logger = MagicMock()
    inst.data_loader = loader
    inst.use_cases_quality = quality
    inst.session_id = 4242
    inst._user_provided_session_id = False
    inst.business_name = "Acme"
    inst.inspire_database = "main.inspire"
    inst.notebook_output_dir = "/Workspace/out/notebooks"
    inst.max_retry_attempts = 0
    inst.max_parallelism = 4
    inst.atomic_writer = None
    inst.generate_genie_code_for = "5"
    inst.merged_business_context = {
        "business_context": "A business context that is long enough to avoid every fallback path in the prompt builder.",
        "strategic_goals": ["grow retained revenue"], "business_priorities": ["reduce churn across segments"],
        "strategic_initiative": "retention", "value_chain": "sell", "revenue_model": "orders",
    }
    inst.parsed_generation_instructions = {}
    inst._notebook_object_ids = {}
    inst.w_client = MagicMock()
    inst.ai_agent = agent or FakeAgent([])
    inst.translation_service = types.SimpleNamespace(get_translations=lambda language: {})
    inst._build_use_case_step_payload = lambda uc: {"use_case_id": uc.get("No")}
    for key, value in attrs.items():
        setattr(inst, key, value)
    return inst


class StatusRecorder:
    def __init__(self):
        self.events = []

    def __call__(self, **kwargs):
        self.events.append(kwargs)
        return len(self.events)

    def find(self, step_name, sub_step_name="Complete"):
        return [e for e in self.events if e.get("step_name") == step_name and e.get("sub_step_name") == sub_step_name]
