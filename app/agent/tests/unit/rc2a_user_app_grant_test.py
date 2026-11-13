import json
import logging

ANA, BOB = "ana@example.com", "bob@example.com"
CATALOG, SCHEMA_NAME = "main", "sales"
VIEW = f"{CATALOG}.{SCHEMA_NAME}.orders_scope_view"
REASONS = f"{CATALOG}.{SCHEMA_NAME}.reasons_scope_view"
OWNER_ROWS = [
    {"level": "catalog", "privilege": "OWNER", "principal": "builder@example.com", "mine": "true"},
    {"level": "schema", "privilege": "OWNER", "principal": "builder@example.com", "mine": "true"},
    {"level": "table", "privilege": "OWNER", "principal": "builder@example.com", "mine": "true"},
]
APP_ACL = {"access_control_list": [
    {"user_name": ANA, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"group_name": "admins", "all_permissions": [{"permission_level": "IS_OWNER"}]},
    {"group_name": "readers", "all_permissions": [{"permission_level": "CAN_VIEW"}]},
    {"service_principal_name": "app-sp", "all_permissions": [{"permission_level": "CAN_MANAGE"}]},
]}


class FakeSpark:
    def __init__(self, refuse=()):
        self.statements, self.refuse = [], tuple(refuse)

    def sql(self, statement):
        self.statements.append(statement)
        if any(r in statement for r in self.refuse):
            raise RuntimeError("[PERMISSION_DENIED] User does not have MANAGE")
        return None


def _build(agent_ns, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2a-test")
    obj._implement_access_rows = lambda view: OWNER_ROWS
    return obj


def test_the_audience_of_an_app_is_its_can_use_or_higher_people_and_groups_and_never_its_service_principal(agent_ns):
    audience = agent_ns["implement_app_audience"](APP_ACL)
    assert sorted((p["type"], p["name"]) for p in audience) == [("group", "admins"), ("user", ANA)]


def test_every_audience_principal_is_granted_use_catalog_use_schema_and_select_on_each_scope_view(agent_ns):
    spark = FakeSpark()
    obj = _build(agent_ns, spark)
    ran = []
    for principal in (ANA, BOB):
        assert obj._implement_app_principal_grants(principal, [VIEW], "", ran) == []
    assert spark.statements == [
        f"GRANT USE CATALOG ON CATALOG `{CATALOG}` TO `{ANA}`",
        f"GRANT USE SCHEMA ON SCHEMA `{CATALOG}`.`{SCHEMA_NAME}` TO `{ANA}`",
        f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`orders_scope_view` TO `{ANA}`",
        f"GRANT USE CATALOG ON CATALOG `{CATALOG}` TO `{BOB}`",
        f"GRANT USE SCHEMA ON SCHEMA `{CATALOG}`.`{SCHEMA_NAME}` TO `{BOB}`",
        f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`orders_scope_view` TO `{BOB}`",
    ]


def test_a_grant_the_build_identity_cannot_run_comes_back_with_its_exact_sql_for_the_entry(agent_ns):
    spark = FakeSpark(refuse=[f"TO `{BOB}`"])
    obj = _build(agent_ns, spark)
    denied = obj._implement_app_principal_grants(BOB, [VIEW], "", [])
    assert denied == [f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`orders_scope_view` TO `{BOB}`"]
    entry = agent_ns["implement_permission_entry"](BOB, denied, "why")
    assert entry["principal"] == BOB and entry["statements"] == denied


def test_the_reasons_view_is_granted_to_the_same_principal_through_the_same_path(agent_ns):
    spark = FakeSpark()
    obj = _build(agent_ns, spark)
    ran = []
    assert obj._implement_app_principal_grants(ANA, [VIEW], REASONS, ran) == []
    assert f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`reasons_scope_view` TO `{ANA}`" in spark.statements


def test_a_refused_reasons_grant_is_listed_not_raised(agent_ns):
    spark = FakeSpark(refuse=["reasons_scope_view"])
    obj = _build(agent_ns, spark)
    denied = obj._implement_app_principal_grants(ANA, [], REASONS, [])
    assert denied == [f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`reasons_scope_view` TO `{ANA}`"]


def test_a_user_app_record_marks_its_views_as_user_reads_so_the_app_checks_each_viewer(agent_ns):
    reads = {VIEW: {"grants": [f"GRANT SELECT ON TABLE `{CATALOG}`.`{SCHEMA_NAME}`.`orders_scope_view` TO `{ANA}`"],
                    "owner": "builder@example.com"}}
    record = agent_ns["implement_app_unread_record"]("", reads, "user")
    assert record == {"app": "", "mode": "user", "tables": [{"table": VIEW, "owner": record["tables"][0]["owner"],
                                                             "grants": reads[VIEW]["grants"]}]}
    files = {agent_ns["IMPLEMENT_APP_SETTINGS_FILE"]: json.dumps({"auth": "user"})}
    settings = json.loads(agent_ns["implement_app_mark_unread"](files, reads)[agent_ns["IMPLEMENT_APP_SETTINGS_FILE"]])
    assert settings["unread"] == {VIEW: reads[VIEW]["grants"]}
    assert set(settings["unread_owners"]) == {VIEW} and settings["unread_owners"][VIEW].strip()


def test_the_service_principal_record_keeps_its_shape(agent_ns):
    record = agent_ns["implement_app_unread_record"]("app-sp", {VIEW: {"grants": ["GRANT SELECT ON TABLE x TO `app-sp`"], "owner": ""}})
    assert record == {"app": "app-sp", "tables": [{"table": VIEW, "owner": record["tables"][0]["owner"],
                                                   "grants": ["GRANT SELECT ON TABLE x TO `app-sp`"]}]}
    assert "mode" not in record
