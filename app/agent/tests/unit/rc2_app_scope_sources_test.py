import types

from v120_genie_support import build_inspire

SALES = "inspire_kinds_rc7._inspire.sales_transactions"
STORES = "main.x.store_locations"


# REQ-354 REQ-011 (734886e3d): the App settings read the siblings through the shell_sql module; no sibling rows here.
NO_SIBLINGS = types.SimpleNamespace(sibling_items=lambda rows, ucs: [])


def _inst(agent_ns):
    inst = build_inspire(agent_ns)
    inst._implement_builder = lambda: "builder@example.com"
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/acme/session_5150/sales/N01-U01", "mvp": "/W/acme/session_5150/sales/N01-U01/mvp",
                                                 "version": f"/W/acme/session_5150/sales/N01-U01/mvp/v{key[2]}"}
    columns = {SALES: ["franchise", "TotalPrice", "transaction_id"], STORES: ["store_id", "city"]}
    inst._implement_scope_columns = lambda table: columns.get(table, [])
    return inst


def test_a_generated_builds_app_settings_carry_every_source_table_with_its_columns(agent_ns):
    inst = _inst(agent_ns)
    use_case = {"Name": "Plan Weekly Product Supply", "Tables Involved": f"{STORES}", "Primary Table": SALES}
    context = {"uc_id": "N05-U02", "key": (5150, "N05-U02", 3), "use_case": use_case, "job_id": 77, "spec": {"outputs": {"app_access": "sp"}}, "urls": {},
               "app_host": {"name": "supply-desk-ab12", "merged": False}}
    core = type("Core", (), {"SETTINGS_VERSION": 2})
    written = inst._implement_app_settings(context, {"shell_core": core, "shell_sql": NO_SIBLINGS}, {"id": "n05_u02"}, None, "off", {"app_access": "sp"})
    assert written["scope_sources"] == [{"table": STORES, "columns": ["store_id", "city"]},
                                        {"table": SALES, "columns": ["franchise", "TotalPrice", "transaction_id"]}]


class _Log:
    def __init__(self):
        self.lines = []

    def info(self, text):
        self.lines.append(text)

    warning = info


def test_a_failed_column_read_lists_the_table_by_name_and_logs_one_plain_line(agent_ns):
    inst = _inst(agent_ns)
    log = _Log()
    inst.logger = log

    def columns(table):
        if table == STORES:
            raise RuntimeError("information_schema is unavailable")
        return {SALES: ["franchise", "TotalPrice", "transaction_id"]}[table]

    inst._implement_scope_columns = columns
    use_case = {"Name": "Plan Weekly Product Supply", "Tables Involved": STORES, "Primary Table": SALES}
    context = {"uc_id": "N05-U02", "key": (5150, "N05-U02", 3), "use_case": use_case, "job_id": 77, "spec": {"outputs": {}}, "urls": {},
               "app_host": {"name": "supply-desk-ab12", "merged": False}}
    core = type("Core", (), {"SETTINGS_VERSION": 2})
    written = inst._implement_app_settings(context, {"shell_core": core, "shell_sql": NO_SIBLINGS}, {"id": "n05_u02"}, None, "off", {"app_access": "sp"})
    assert written["scope_sources"] == [{"table": STORES, "columns": []}, {"table": SALES, "columns": ["franchise", "TotalPrice", "transaction_id"]}]
    named = [line for line in log.lines if "listed by name only" in line]
    assert len(named) == 1 and STORES in named[0] and "\n" not in named[0]


def test_the_producer_never_raises_on_a_failed_read_and_logs_once(fresh_ns):
    log = _Log()

    def boom(table):
        raise ValueError("denied")

    listed = fresh_ns["implement_app_scope_sources"]([SALES], boom, log)
    assert listed == [{"table": SALES, "columns": []}] and len(log.lines) == 1
    assert "listed by name only" in log.lines[0]
