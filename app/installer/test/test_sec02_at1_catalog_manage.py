"""SEC-02 D6 (REQ-518): the installer never asks for MANAGE ON CATALOG on a catalog that holds customer data.

When Inspire is installed into a schema of an existing catalog (SCHEMA_MODE), or its catalog is also a catalog the App reads
(DATA_CATALOGS), that catalog is the customer's. MANAGE on it would let Inspire's service principal (or the installing person, through
the App) grant anything in it. The installer asks only for what opens no data (USE CATALOG for account users, CREATE SCHEMA) and never
prints a GRANT MANAGE ON CATALOG line. A dedicated Inspire catalog (neither case) keeps today's ask.

Seams: _new_apps_probe, _new_apps_access_check, _catalog_access_for_new_apps, _rights_unread, _grant_refusal.
"""
import re
import types

import pytest

import support

setup = support.load_setup()

MANAGE_CATALOG = re.compile(r"GRANT\s+MANAGE\s+ON\s+CATALOG", re.I)
SP = "sp-1111"
CUSTOMER = [("schema mode", {"SCHEMA_MODE": True, "SCHEMA": "inspire", "DATA_CATALOGS": []}),
            ("catalog also read as data", {"SCHEMA_MODE": False, "SCHEMA": "inspire", "DATA_CATALOGS": ["main", "finance"]})]
DEDICATED = {"SCHEMA_MODE": False, "SCHEMA": "inspire", "DATA_CATALOGS": ["finance"]}


def ctx_for(extra, users=(), inspire=()):
    held = {"account users": set(users), SP: set(inspire)}

    def api_get(path):
        who = path.split("principal=")[-1].replace("%20", " ")
        return {"privilege_assignments": [{"privileges": [{"privilege": p} for p in held.get(who, ())]}]}

    w = types.SimpleNamespace(catalogs=types.SimpleNamespace(get=lambda name: types.SimpleNamespace(owner="data-owners")))
    return {"w": w, "WAREHOUSE_ID": "wh", "CATALOG": "main", "USER_EMAIL": "ana@example.com", "USER_GROUPS": [],
            "NEW_APPS_CATALOG_ACCESS": setup.NEW_APPS_ACCOUNT_USERS, "api_get": api_get, **extra}


@pytest.fixture
def no_rows(monkeypatch):
    monkeypatch.setattr(setup, "_statement_rows", lambda w, warehouse_id, sql: [])
    monkeypatch.setattr(setup, "_catalog_privileges", lambda ctx, catalog: (False, set()))


@pytest.mark.parametrize("label,extra", CUSTOMER)
def test_D6_the_new_apps_probe_asks_no_manage_on_a_customer_catalog(label, extra):
    ok, line, statements = setup._new_apps_probe(ctx_for(extra), SP)
    assert not ok
    assert [s for s in statements if MANAGE_CATALOG.search(s)] == [], (
        f"D6 {label}: Not implemented: the probe asks for MANAGE on customer catalog `main`: {statements}")
    assert "GRANT USE CATALOG ON CATALOG `main` TO `account users`" in statements, f"D6 {label}: the no-data ask stays: {statements}"


@pytest.mark.parametrize("label,extra", CUSTOMER)
def test_D6_the_stop_message_names_no_manage_on_a_customer_catalog(label, extra):
    with pytest.raises(RuntimeError) as stop:
        setup._new_apps_access_check(ctx_for(extra), SP)
    assert not MANAGE_CATALOG.search(str(stop.value)), f"D6 {label}: Not implemented: the stop message offers MANAGE ON CATALOG: {stop.value}"
    assert "GRANT USE CATALOG ON CATALOG `main` TO `account users`" in str(stop.value)


@pytest.mark.parametrize("label,extra", CUSTOMER)
def test_D6_the_new_apps_catalog_line_names_no_manage_on_a_customer_catalog(label, extra, no_rows):
    said = setup._catalog_access_for_new_apps(dict(ctx_for(extra), NEW_APPS_CATALOG_ACCESS=setup.NEW_APPS_OFF), SP)
    assert "USE CATALOG" in said, said
    assert not MANAGE_CATALOG.search(said), f"D6 {label}: Not implemented: the new-Apps line offers MANAGE ON CATALOG: {said}"


@pytest.mark.parametrize("label,extra", CUSTOMER)
def test_D6_unreadable_rights_and_the_grant_refusal_ask_no_manage_on_a_customer_catalog(label, extra):
    refused = Exception("403")
    refused.response = types.SimpleNamespace(status_code=403)
    for said in (setup._rights_unread(refused, ctx_for(extra)), setup._grant_refusal(ctx_for(extra), {"USE_CATALOG"})):
        assert not MANAGE_CATALOG.search(said), f"D6 {label}: Not implemented: the installer asks the person for MANAGE ON CATALOG: {said}"


def test_D6_control_a_dedicated_inspire_catalog_keeps_its_manage_ask():
    _ok, _line, statements = setup._new_apps_probe(ctx_for(DEDICATED), SP)
    assert f"GRANT MANAGE ON CATALOG `main` TO `{SP}`" in statements, statements


def test_D6_control_nothing_is_asked_when_account_users_and_inspire_already_hold_what_they_need():
    for _label, extra in CUSTOMER:
        ok, _line, statements = setup._new_apps_probe(ctx_for(extra, users={"USE_CATALOG"}, inspire={"USE_CATALOG", "CREATE_SCHEMA"}), SP)
        assert ok and statements == []


def test_D6_scopes_the_app_asks_for_the_person_scopes_the_data_reads_need():
    # REQ-518 reverses REQ-418's scope drop: data is read with the person's own token, so the App's user authorization carries the
    # Unity Catalog and Files scopes v1.3.0 asked for (the Apps API accepted them then). "unity-catalog" stays out (REQ-320).
    missing = [s for s in ("catalog.catalogs:read", "catalog.schemas:read", "catalog.tables:read", "files", "sql", "workspace.workspace")
               if s not in setup.INSPIRE_APP_OWN_SCOPES]
    assert missing == [], f"D6: Not implemented: the App asks for no person scope for {missing}, so every person read is refused"
    assert "unity-catalog" not in setup.INSPIRE_APP_OWN_SCOPES
