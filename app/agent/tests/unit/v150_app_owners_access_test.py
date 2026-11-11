import importlib.util
import json
import os
import sys

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import (CHURN_TABLES, OURS_APP, READS, SHELL_FILES, _app_flow, _deploy_inspire, _feedback_writes, _not_access_reads, _spec,
                                  _without_feedback,  # noqa: F401
                                 sdk_stub)
from v142_scd_test import _describe

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
from v141_app_shell_test import call  # noqa: E402
from v149_app_money_test import OWNER, MoneyWorkspace, _shell  # noqa: E402

RESULT = "main.inspire.churn_out"
ASSUMPTIONS = "main.inspire.churn_out_assumptions"
CREATE = ("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_assumptions` (use_case_id STRING, name STRING, value DOUBLE, "
          "changed_by STRING, changed_at TIMESTAMP, note STRING, text_value STRING)")
GRANT = "GRANT {} ON {} TO `sp-1`"
MONEY_SCHEMA = [("entity_id", "string"), ("value_at_stake", "double"), ("units", "bigint")]
NEW_APP = [RuntimeError("RESOURCE_DOES_NOT_EXIST: app churn-desk"), {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"},
           {"deployment_id": "dep1", "status": {"state": "SUCCEEDED"}}, {"url": "https://churn-desk.example/"}]
OWNERS = ["@".join([name, "example.com"]) for name in ("pat.lee", "sam.ortiz", "ana.diaz")]


class Catalog(FakeSpark):
    def __init__(self, managed=("main",), schema=MONEY_SCHEMA, fail=None):
        super().__init__()
        self.managed, self.schema, self.fail, self.held = set(managed), schema, dict(fail or {}), set()

    def sql(self, statement, *args, **kwargs):
        text = " ".join(str(statement).split())
        for marker, error in self.fail.items():
            if text.startswith(marker):
                self.statements.append(text)
                raise error
        if text.startswith("GRANT "):
            privilege, rest = text[len("GRANT "):].split(" ON ", 1)
            level, target = rest.split(" ", 1)
            self.held.add((privilege, target.split(" TO ")[0].replace("`", "")))
        if text.startswith("SELECT level, privilege, principal"):
            a = kwargs.get("args") or {}
            self.statements.append(text)
            return _Rows(self._access(a["c"], a["s"], a["t"]))
        if text == f"DESCRIBE TABLE `main`.`inspire`.`churn_out`":
            self.statements.append(text)
            return _Rows(_describe(self.schema) if self.schema else [])
        return super().sql(statement, *args, **kwargs)

    def _access(self, c, s, t):
        rows = [{"level": "catalog", "privilege": "OWNER", "principal": "inspire-sp" if c in self.managed else "data-eng",
                 "mine": c in self.managed, "me": "inspire-sp"},
                {"level": "table", "privilege": "OWNER", "principal": "inspire-sp", "mine": True, "me": "inspire-sp"}]
        for privilege, target in sorted(self.held):
            level = {1: "catalog", 2: "schema", 3: "table"}[len(target.split("."))]
            if target in (c, f"{c}.{s}", f"{c}.{s}.{t}"):
                rows.append({"level": level, "privilege": privilege.replace(" ", "_"), "principal": "sp-1", "mine": False, "me": "inspire-sp"})
        return rows


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)


def _deploy(ns, spark, outputs=None, answers=NEW_APP):
    inst, context, _calls, _imported = _deploy_inspire(ns, list(answers))
    inst.spark = spark
    if outputs:
        context["spec"] = dict(context["spec"], outputs=dict(context["spec"]["outputs"], **outputs))
    return inst, inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)


def test_a_shared_app_gets_select_and_modify_on_the_assumptions_table_it_writes(agent_ns, sdk_stub):
    spark = Catalog()
    inst, fields = _deploy(agent_ns, spark)
    assert "_warnings" not in fields and fields["app_url"] == "https://churn-desk.example"
    shell_facts = agent_ns["inspire_shell_facts"]
    ledger = shell_facts.ledger_table("main.inspire")
    ledger_sql = [shell_facts.ledger_create_sql(ledger)] + shell_facts.ledger_grant_sqls(ledger, "sp-1")
    assert _not_access_reads(spark.statements) == [
        GRANT.format("USE CATALOG", "CATALOG `main`"), GRANT.format("USE SCHEMA", "SCHEMA `main`.`inspire`"),
        GRANT.format("SELECT", "TABLE `main`.`inspire`.`churn_out`"), GRANT.format("USE CATALOG", "CATALOG `main`"),
        GRANT.format("USE SCHEMA", "SCHEMA `main`.`s`"), GRANT.format("SELECT", "TABLE `main`.`s`.`orders`"),
        GRANT.format("READ METADATA", "TABLE `main`.`s`.`orders`"), GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`"), "DESCRIBE TABLE `main`.`inspire`.`churn_out`", CREATE, "DESCRIBE TABLE `main`.`inspire`.`churn_out_assumptions`",
        GRANT.format("SELECT", "TABLE `main`.`inspire`.`churn_out_assumptions`"),
        GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out_assumptions`")] + _feedback_writes(agent_ns) + ledger_sql, \
        "the assumptions and feedback tables are read after the result table's grants, so their catalog and schema are not granted again"
    reading = Catalog()
    _deploy(agent_ns, reading, {"app_options": {"modify": False, "decisions": False}})
    assert not any("MODIFY" in s and "`churn_out`" in s for s in reading.statements), \
        "the App only reads its records unless edits or decisions are on"


def test_a_table_without_money_at_stake_gets_no_assumptions_table(agent_ns, sdk_stub):
    spark = Catalog(schema=[("entity_id", "string"), ("priority_tier", "string")])
    _inst, fields = _deploy(agent_ns, spark, {"app_options": {"modify": False, "decisions": False}})
    assert "_warnings" not in fields
    ledger = agent_ns["inspire_shell_facts"].ledger_table("main.inspire")
    assert not any(s.startswith("CREATE TABLE") or "assumptions" in s or "MODIFY" in s for s in _without_feedback(spark.statements)
                   if ledger not in s), "only the value ledger, which every App with a database gets, is created here"
    assert [s for s in spark.statements if s.startswith(("CREATE TABLE", "DESCRIBE TABLE `main`.`inspire`.`churn_out_f", "GRANT")) and ledger not in s][-4:] == \
        _feedback_writes(agent_ns), "every App takes reported issues, so its feedback table is built and granted even with nothing at stake"


def test_a_per_user_app_gets_a_service_principal_grant_only_on_the_table_it_records_decisions_in(agent_ns, sdk_stub):
    answers = [NEW_APP[0], NEW_APP[1], dict(NEW_APP[1], user_api_scopes=["sql:restricted-query", "genie"])] + NEW_APP[2:]
    spark = Catalog()
    _inst, fields = _deploy(agent_ns, spark, {"app_access": "user", "app_options": {"decisions": False}}, answers)
    assert fields["app_url"] == "https://churn-desk.example"
    assert [s for s in spark.statements if s.startswith(("GRANT", "CREATE TABLE", "DESCRIBE"))] == _feedback_writes(agent_ns, fresh=True), \
        "a per-user App stores reported issues as its service principal, so the feedback table is all it gets"
    spark = Catalog()
    _inst, fields = _deploy(agent_ns, spark, {"app_access": "user"}, answers)
    assert "_warnings" not in fields
    assert [s for s in spark.statements if s.startswith(("GRANT", "CREATE TABLE", "DESCRIBE"))] == [
        GRANT.format("USE CATALOG", "CATALOG `main`"), GRANT.format("USE SCHEMA", "SCHEMA `main`.`inspire`"),
        GRANT.format("SELECT", "TABLE `main`.`inspire`.`churn_out`"), GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`")] + \
        _feedback_writes(agent_ns), \
        "a per-user App records decisions and reported issues as its service principal, so it gets the result and feedback tables only"


@pytest.mark.parametrize("fail,reason", [
    ({"GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_assumptions`": RuntimeError("PERMISSION_DENIED: not a manager")},
     "Inspire could not grant it: GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `sp-1` failed: "
     "PERMISSION_DENIED: not a manager"),
    ({"CREATE TABLE IF NOT EXISTS `main`.`inspire`.`churn_out_assumptions`": RuntimeError("PERMISSION_DENIED: no CREATE TABLE")},
     "Inspire could not create it: main.inspire.churn_out_assumptions: PERMISSION_DENIED: no CREATE TABLE"),
])
def test_an_assumptions_grant_that_fails_is_a_plain_warning_and_the_app_still_ships(agent_ns, sdk_stub, fail, reason):
    spark = Catalog(fail=fail)
    _inst, fields = _deploy(agent_ns, spark)
    assert fields["app_url"] == "https://churn-desk.example"
    assert fields["_warnings"] == [
        f"App: the owners of this use case cannot change its money at stake assumptions in the App until its service principal sp-1 "
        f"can read and change the result table. {reason}"]


def test_an_assumptions_table_inspire_cannot_manage_names_the_grants_to_ask_for(agent_ns, sdk_stub):
    spark = Catalog(managed=())
    spark._access = lambda c, s, t: [{"level": "catalog", "privilege": "OWNER", "principal": "data-eng", "mine": False, "me": "inspire-sp"},
                                     {"level": "schema", "privilege": "OWNER", "principal": "data-eng", "mine": False, "me": "inspire-sp"},
                                     {"level": "catalog", "privilege": "USE_CATALOG", "principal": "account users", "mine": True,
                                      "me": "inspire-sp"},
                                     {"level": "schema", "privilege": "USE_SCHEMA", "principal": "account users", "mine": True,
                                      "me": "inspire-sp"},
                                     {"level": "table", "privilege": "OWNER", "principal": "data-eng", "mine": False,
                                      "me": "inspire-sp"}] + ([] if str(t).endswith("_assumptions") else [
                                     {"level": "table", "privilege": "SELECT", "principal": "account users", "mine": True,
                                      "me": "inspire-sp"},
                                     {"level": "table", "privilege": "MANAGE", "principal": "inspire-sp", "mine": True,
                                      "me": "inspire-sp"}])
    inst, fields = _deploy(agent_ns, spark, answers=[{"description": OURS_APP, "compute_status": {"state": "ACTIVE"},
                                                      "service_principal_client_id": "sp-1"}] + NEW_APP[2:])
    owners_warning = [w for w in fields["_warnings"] if "money at stake assumptions" in w]
    assert owners_warning == [
        f"App: the owners of this use case cannot change its money at stake assumptions in the App until its service principal sp-1 "
        "can read and change the result table. Inspire cannot grant these accesses, because it neither owns nor holds MANAGE on them. "
        "If sp-1 does not have them yet, ask the owner to run: GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_assumptions` TO "
        "`sp-1`; GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out_assumptions` TO `sp-1`"]
    assert not any(s.startswith("GRANT") and "assumptions" in s for s in spark.statements)


@pytest.mark.parametrize("options,what", [({"modify": True}, "change its records"), ({"decisions": True}, "record decisions on its records"),
                                          ({"modify": True, "decisions": True}, "change its records or record decisions on its records")])
def test_an_app_that_writes_its_records_gets_modify_on_the_result_table(agent_ns, sdk_stub, options, what):
    spark = Catalog(schema=[("entity_id", "string")])
    _inst, fields = _deploy(agent_ns, spark, {"app_options": dict({"modify": False, "decisions": False}, **options)})
    assert GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`") in spark.statements and "_warnings" not in fields
    failing = Catalog(schema=[("entity_id", "string")],
                      fail={"GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out`": RuntimeError("PERMISSION_DENIED: no MANAGE")})
    _inst, fields = _deploy(agent_ns, failing, {"app_options": dict({"modify": False, "decisions": False}, **options)})
    assert fields["_warnings"] == [
        f"App: people cannot {what} in this App until its service principal sp-1 can read and change the result table. Inspire could not "
        "grant it: GRANT MODIFY ON TABLE `main`.`inspire`.`churn_out` TO `sp-1` failed: PERMISSION_DENIED: no MANAGE"]


def test_a_hub_page_writes_with_the_hub_s_own_options(agent_ns, sdk_stub):
    spark = Catalog(schema=[("entity_id", "string")])
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, [{"description": OURS_APP, "compute_status": {"state": "ACTIVE"},
                                                                    "service_principal_client_id": "sp-1"}] + NEW_APP[2:])
    inst.spark = spark
    inst._implement_owns_app = lambda uc_id, app: True
    context["app_host"] = {"merged": True, "settings": {"auth": "sp", "options": {"modify": False, "decisions": True}},
                           "source": "/W/acme_implemented/Sales/apps/sales-desk"}
    context["spec"] = dict(context["spec"], outputs=dict(context["spec"]["outputs"], app_options={"modify": False, "decisions": False}))
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`") in spark.statements


def test_the_access_plan_grants_modify_only_when_asked_and_only_where_inspire_manages(agent_ns):
    plan, need = agent_ns["implement_access_plan"], agent_ns["IMPLEMENT_MODIFY_NEED"]
    mine = [{"level": "catalog", "privilege": "OWNER", "principal": "inspire-sp", "mine": True, "me": "inspire-sp"}]
    modify = {"privilege": "MODIFY", "level": "table", "object": "`main`.`inspire`.`churn_out`"}
    assert plan(RESULT, mine, "sp-1")["grants"][-1]["privilege"] == "SELECT", "reading needs no MODIFY"
    assert plan(RESULT, mine, "sp-1", (need,)) == {"grants": [modify], "gaps": [], "me": "inspire-sp"}
    held = mine + [{"level": "schema", "privilege": "MODIFY", "principal": "sp-1", "mine": False}]
    assert plan(RESULT, held, "sp-1", (need,))["grants"] == [], "MODIFY held on the schema is not granted again"
    theirs = [{"level": "catalog", "privilege": "OWNER", "principal": "data-eng", "mine": False, "me": "inspire-sp"},
              {"level": "table", "privilege": "OWNER", "principal": "data-eng", "mine": False, "me": "inspire-sp"}]
    assert plan(RESULT, theirs, "sp-1", (need,)) == {"grants": [], "gaps": [dict(modify, owner="data-eng")], "me": "inspire-sp"}
    assert plan(RESULT, None, "sp-1", (need,))["grants"] == [modify]


def test_the_build_spec_owners_follow_the_wizard_rules(agent_ns):
    out, errors = _spec(agent_ns)
    assert errors == [] and out["outputs"]["app_owners"] == [], "no owners named means only the admin"
    spec = dict(json.loads(json.dumps(out)))
    smile = "\U0001F600" * 125 + "@x.io"
    for owners, kept, problems in (([OWNERS[0], OWNERS[0].upper(), " " + OWNERS[1]], OWNERS[:2], []),
                                   ([smile], [], [f"App owner '{smile}' is not an email address"]),
                                   (["a" * 249 + "@x.io"], ["a" * 249 + "@x.io"], []),
                                   (["a" * 250 + "@x.io"], [], [f"App owner '{'a' * 250}@x.io' is not an email address"])):
        spec["outputs"] = dict(out["outputs"], app_owners=owners)
        cleaned, errors = agent_ns["validate_implement_spec"](spec)
        assert (cleaned["outputs"]["app_owners"], errors) == (kept, problems), owners
    spec["outputs"] = dict(out["outputs"], app=False, app_owners=["not an email"])
    cleaned, errors = agent_ns["validate_implement_spec"](spec)
    assert cleaned["outputs"]["app_owners"] == [] and errors == [], "owners matter only when an App is built"


def test_changing_the_owners_rebuilds_the_app(agent_ns):
    before, _ = _spec(agent_ns)
    after, _ = _spec(agent_ns, outputs=dict(before["outputs"], app_owners=OWNERS[:1]))
    plan = agent_ns["implement_plan"](before, after, {"app": "churn-desk", "dashboard": "d1", "genie_space": "g1"}, True)
    assert (plan["classes"], plan["refresh"], plan["build"], plan["refill"]) == (["outputs"], ["app"], [], False)
    assert plan["restyle"] == [], "the restyle path keeps the owners the App already holds, so new owners need the App build"
    restyled = dict(after, outputs=dict(after["outputs"], app_look={"palette": "ocean"}))
    assert agent_ns["implement_plan"](after, restyled, {"app": "churn-desk"}, True)["restyle"] == ["app"]


def _settings(ns, owners=None, page="n01_u01", admin="builder@example.com", **outputs):
    return ns["implement_app_settings"](1, "N01-U01 Predict churn", [page], None, "off", "t1",
                                       dict({"app_access": "sp"}, **({"app_owners": owners} if owners is not None else {}), **outputs),
                                       admin=admin)


def _hub(ns, held, pages, merged=True):
    host = ns["implement_app_host"]("sales-desk")
    host.update(merged=merged, owner=("N01-U07", "777"), settings=held, pages=[{"id": p, "use_case_id": p.upper()} for p in pages])
    return host


def _owners(ns, by="", named=()):
    return ns["implement_owners"]({"created_by": by, "spec_json": {"outputs": {"app_owners": list(named)}}})


def test_an_app_records_the_owners_of_its_use_case_as_inspire_names_them(agent_ns):
    assert not {"owners", "page_owners", "use_case_owners"} & set(_settings(agent_ns, OWNERS[:2])), "only the merge records owners"
    owners = _owners(agent_ns, OWNERS[2].upper(), [OWNERS[0], OWNERS[0].upper(), " " + OWNERS[1]])
    merged, _pages, _page = agent_ns["implement_app_merge"](agent_ns["implement_app_host"]("churn-desk"), _settings(agent_ns, OWNERS[:2]),
                                                           {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {}, "", "", owners)
    assert merged["use_case_owners"] == {"n01_u01": [OWNERS[2], OWNERS[0], OWNERS[1]]}
    assert not {"owners", "page_owners"} & set(merged), "the App keeps one record of who owns each use case"
    problems = shell_core.settings_problems(dict(merged, version=shell_core.SETTINGS_VERSION), [{"id": "n01_u01"}])
    assert not any("owners" in p for p in problems), problems
    broken = shell_core.settings_problems(dict(merged, use_case_owners={"n01_u01": OWNERS[0]}), [{"id": "n01_u01"}])
    assert any("use_case_owners" in p for p in broken), "the check above can see an owners problem"


def test_a_hub_app_records_the_owners_of_each_use_case_on_its_own_page(agent_ns):
    held = dict(_settings(agent_ns, page="n01_u07"), use_case_owners={"n01_u07": [OWNERS[0]], "gone_page": [OWNERS[2]]})
    merged, pages, page = agent_ns["implement_app_merge"](_hub(agent_ns, held, ["n01_u07"]), _settings(agent_ns),
                                                         {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {}, "", "",
                                                         _owners(agent_ns, OWNERS[0].upper(), [OWNERS[1]]))
    assert page["id"] == "n01_u01_s5150" and [p["id"] for p in pages] == ["n01_u07", "n01_u01_s5150"]
    assert merged["use_case_owners"] == {"n01_u07": [OWNERS[0]], "n01_u01_s5150": [OWNERS[0], OWNERS[1]]}, \
        "each use case keeps its own owners, and a page the hub no longer holds names no owner"
    again, _pages, _page = agent_ns["implement_app_merge"](_hub(agent_ns, merged, ["n01_u07", "n01_u01_s5150"]), _settings(agent_ns),
                                                          {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {}, "", "", [])
    assert again["use_case_owners"] == {"n01_u07": [OWNERS[0]]}, "an owner taken out is out"
    own = dict(_settings(agent_ns), use_case_owners={"n01_u01": [OWNERS[2]], "n01_u02": [OWNERS[1]]}, pages=["n01_u01", "n01_u02"])
    rebuilt, _pages, _page = agent_ns["implement_app_merge"](_hub(agent_ns, own, ["n01_u01", "n01_u02"], merged=False),
                                                            _settings(agent_ns), {"id": "n01_u01", "use_case_id": "N01-U01"},
                                                            5150, {}, "", "", _owners(agent_ns, OWNERS[0]))
    assert rebuilt["use_case_owners"] == {"n01_u01": [OWNERS[0]], "n01_u02": [OWNERS[1]]}, \
        "the use case that owns the hub keeps the owners of the pages merged into it"


def test_a_hub_whose_use_cases_name_more_than_fifty_owners_lets_each_of_them_change_their_own_use_case(agent_ns):
    first = [f"a{i:02d}@example.com" for i in range(30)]
    second = [f"b{i:02d}@example.com" for i in range(30)]
    held = dict(_settings(agent_ns, page="n01_u07"), use_case_owners={"n01_u07": first})
    owners = _owners(agent_ns, "c@example.com", second + first[:5] + [f"d{i:02d}@example.com" for i in range(15)])
    merged, _pages, page = agent_ns["implement_app_merge"](_hub(agent_ns, held, ["n01_u07"]), _settings(agent_ns),
                                                          {"id": "n01_u01", "use_case_id": "N01-U01"}, 5150, {}, "", "", owners)
    assert merged["use_case_owners"] == {"n01_u07": first, page["id"]: owners}
    assert len(owners) == 51 == shell_core.USE_CASE_OWNERS_MAX == agent_ns["IMPLEMENT_APP_OWNERS_MAX"] + 1
    problems = shell_core.settings_problems(dict(merged, version=shell_core.SETTINGS_VERSION), [{"id": "n01_u07"}, {"id": page["id"]}])
    assert not any("owners" in p for p in problems), "the App accepts every owner list Inspire writes"


def _disk_shell(ns, tmp_path):
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed_v150", os.path.join(ROOT, "agent", "app_shell", "embed.py"))
    embed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(embed)
    payload = embed.payload(static=False)
    payload["files"]["static/index.html"] = "<html></html>\n"
    return payload, ns["implement_app_shell_modules"](str(tmp_path / "_disk_shell"), payload["files"])


def test_the_built_app_names_its_owners_and_the_app_lets_them_change_assumptions(agent_ns, tmp_path):
    payload, modules = _disk_shell(agent_ns, tmp_path)
    page = json.loads(json.dumps(payload["example"]))
    for dataset in page["datasets"]:
        for old, new in CHURN_TABLES.items():
            dataset["sql"] = dataset["sql"].replace(old, new)
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=page, outputs={"app_owners": [OWNERS[1].upper()]})
    inst._implement_app_shell = lambda: (payload, modules)
    inst.spark = FakeSpark(responder=lambda s: [{"me": "builder@example.com"}] if s == "SELECT current_user() AS me" else [])
    inst._implement_app(context, None)
    assert seen["errors"] == []
    settings = json.loads(seen["deployed"][0][1]["inspire_app.json"])
    assert "owners" not in settings and settings["admin"] == "builder@example.com"
    assert settings["use_case_owners"] == {settings["pages"][0]: [OWNERS[1]]}, "the run names no requester, so only its App owner, as "\
                                                                              "Inspire names them"
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.settings = settings
    assert shell.page_editors({"id": settings["pages"][0]}) == {OWNERS[1]}


def test_an_owner_whose_app_may_not_write_the_assumptions_gets_a_plain_refusal(tmp_path):
    class Denied(MoneyWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if sql.startswith("INSERT INTO"):
                raise shell_db.QueryError("PERMISSION_DENIED: User does not have MODIFY on Table 'main.pricing.loss_desk_out_assumptions'")
            return super().run_sql(warehouse, sql, params, limit)

    s, ws, _made = _shell(tmp_path, Denied())
    status, out = call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "PRICE", "value": 24, "was": 20})
    assert status == 403 and out["error"] == shell_core.REFUSED_WRITE
    assert "main.pricing.loss_desk_out_assumptions" in out["details"]
    assert "again" not in out["error"], "a permission error never sends people to rebuild the App"

    class Broken(MoneyWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if sql.startswith("INSERT INTO"):
                raise shell_db.QueryError("INTERNAL_ERROR: the warehouse stopped")
            return super().run_sql(warehouse, sql, params, limit)

    (tmp_path / "broken").mkdir()
    s, _ws, _made = _shell(tmp_path / "broken", Broken())
    status, out = call(s, "POST", "money/assumption", headers={"x-forwarded-email": OWNER},
                       body={"page": "n01_u05", "name": "PRICE", "value": 24, "was": 20})
    assert status == 502 and out["error"] == "INTERNAL_ERROR: the warehouse stopped", "only a missing privilege is a refusal"


def test_a_refused_write_names_who_lacks_the_privilege():
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.settings = {"auth": "user"}
    error = shell.write_refused("`main`.`s`.`t`", "PERMISSION_DENIED: no MODIFY")
    assert (error.status, error.message) == (403, shell_core.REFUSED_WRITE)
    assert error.extra["details"] == "`main`.`s`.`t`: PERMISSION_DENIED: no MODIFY"
    shell.settings = {"auth": "sp"}
    assert shell.write_refused("`main`.`s`.`t`", "x").message == shell_core.REFUSED_WRITE


class OutputsCatalog(Catalog):
    def __init__(self, present, **kwargs):
        super().__init__(**kwargs)
        self.present = set(present)

    def sql(self, statement, *args, **kwargs):
        text = " ".join(str(statement).split())
        if text.startswith("SELECT lower(table_name) AS t FROM system.information_schema.tables"):
            self.statements.append(text)
            asked = set((kwargs.get("args") or {}).values())
            return _Rows([{"t": name} for name in sorted(self.present & asked)])
        return super().sql(statement, *args, **kwargs)


def test_the_app_service_principal_reads_every_output_table_the_run_wrote_and_nothing_that_does_not_exist(agent_ns, sdk_stub):
    present = {"churn_out_closed", "churn_out_closes", "churn_out_acted", "churn_out__series"}
    spark = OutputsCatalog(present)
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(NEW_APP))
    inst.spark = spark
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0, page_tables=[RESULT])
    assert fields["app_url"] == "https://churn-desk.example"
    granted = {target for privilege, target in spark.held if privilege == "SELECT"}
    assert {f"main.inspire.{name}" for name in present} <= granted, granted
    assert not {t for t in granted if t.endswith(("_out_changes", "_out__geo", "_out__nodes", "_out_ai_summary"))}, \
        "a companion table the run never wrote gets no grant"
    needs = inst._implement_app_needs([{"id": "p1", "result_table": RESULT}], {})[0]
    assert {"main.inspire.churn_out__series", "main.inspire.churn_out_closed"} <= needs, \
        "the revoke side counts the same output tables the grant side reads"


def test_a_per_user_app_never_asks_which_output_tables_exist(agent_ns, sdk_stub):
    answers = [NEW_APP[0], NEW_APP[1], dict(NEW_APP[1], user_api_scopes=["sql:restricted-query", "genie"])] + NEW_APP[2:]
    spark = OutputsCatalog({"churn_out_closed"})
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(answers))
    inst.spark = spark
    context["spec"] = dict(context["spec"], outputs=dict(context["spec"]["outputs"], app_access="user", app_options={"decisions": False}))
    inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0, page_tables=[RESULT])
    assert not any(s.startswith("SELECT lower(table_name)") for s in spark.statements)
    assert [s for s in spark.statements if s.startswith("GRANT")] == _feedback_writes(agent_ns, fresh=True)[2:]
