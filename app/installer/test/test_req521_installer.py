"""REQ-521 Part A: the installer asks only where Inspire stores its data; the data-catalog pick is advanced, and `_inspire_ai` can be created.

Owner decisions (2026-11-25): keep the data-catalog pick, default All, moved to an advanced place so a normal install never answers it;
the storage pick offers "Create new catalog _inspire_ai"; without CREATE CATALOG the installer names the GRANT and stops before any change.

Each test runs the installer's own code paths (build_runtime_context with fake widgets, run() with the real step_preflight).
"""
import contextlib
import io
import re
import types

import pytest

import support
from test_setup import INSTALL_STEPS, Resp, Workspace, app_exists, context, recording

setup = support.load_setup()

WH = "00_sql_warehouse"
CAT = "01_inspire_catalog"
LEGACY_DATA = "02_data_catalogs_inspire_may_read"
DATA = "99_advanced_data_catalogs_inspire_may_read"
ALL = "All catalogs you can use (default)"
CREATE = "Create new catalog _inspire_ai"
NEW = "_inspire_ai"
ME = "someone@example.com"
CREATE_SQL = re.compile(r"^CREATE CATALOG IF NOT EXISTS `_inspire_ai`( COMMENT '[^']*')?$")


def cat(name, kind="MANAGED_CATALOG"):
    return types.SimpleNamespace(name=name, owner="data-owners", catalog_type=types.SimpleNamespace(value=kind))


@pytest.fixture
def harness():
    saved = (setup.WorkspaceClient, setup._unpack_bundle, getattr(setup, "dbutils", None), getattr(setup, "displayHTML", None))
    shown = []
    setup.displayHTML = shown.append

    def run_context(widgets, catalogs):
        setup.dbutils = types.SimpleNamespace(widgets=widgets)
        me = types.SimpleNamespace(user_name=ME, groups=[])
        wh = types.SimpleNamespace(id="wh1", name="Shared", state=types.SimpleNamespace(value="RUNNING"), enable_serverless_compute=True)

        class Client:
            current_user = types.SimpleNamespace(me=lambda: me)
            config = types.SimpleNamespace(host="https://workspace.example.com", authenticate=lambda: {"Authorization": "Bearer x"})
            warehouses = types.SimpleNamespace(list=lambda: [wh])
            catalogs = types.SimpleNamespace(list=lambda: list(catalogs))

        setup.WorkspaceClient = Client
        setup._unpack_bundle = lambda source, root: f"{root}/bundle_1"
        env = {"manifest": {"version": "v1.3.0"}, "files": {"inspire-app.zip": "/z", "inspire-assets.tar": "/t"}, "folders": {}, "settings": {}}
        with contextlib.redirect_stdout(io.StringIO()):
            return setup.build_runtime_context(env)

    run_context.shown = shown
    yield run_context
    setup.WorkspaceClient, setup._unpack_bundle, setup.dbutils, setup.displayHTML = saved


def first_run(run_context, catalogs, widgets=None):
    widgets = widgets or support.FakeWidgets()
    assert run_context(widgets, catalogs) == {"ready": False}
    return widgets


# ---- A1: the data-catalog pick is advanced, defaults to All, and a normal install never answers it ----

def test_A1_the_data_pick_is_an_advanced_widget_after_the_storage_pick_and_defaults_to_all(harness):
    widgets = first_run(harness, [cat("ops"), cat("sales")])
    assert LEGACY_DATA not in widgets.state, (
        f"REQ-521 A1: Not implemented: the data-catalog pick is still the third main widget {LEGACY_DATA}; it must move to {DATA}")
    assert DATA in widgets.state, f"REQ-521 A1: the advanced data-catalog widget {DATA} is created: {sorted(widgets.state)}"
    data = widgets.state[DATA]
    assert data["kind"] == "multiselect" and data["value"] == ALL, data
    assert data["label"].startswith("Advanced (optional): "), f"the label says it is advanced and optional: {data['label']!r}"
    assert "Data catalogs the Inspire App may read" in data["label"], data["label"]
    assert sorted(widgets.state) == [WH, CAT, DATA], "the widget bar sorts by name, so the advanced pick sits after the two main ones"


def test_A1_a_normal_install_answers_only_warehouse_and_storage_and_reads_all_catalogs(harness):
    catalogs = [cat("ops"), cat("sales"), cat("main")]
    widgets = first_run(harness, catalogs)
    assert DATA in widgets.state, f"REQ-521 A1: Not implemented: no advanced data-catalog widget {DATA}: {sorted(widgets.state)}"
    widgets.pick(WH, "Shared (wh1)")
    widgets.pick(CAT, "ops")
    ctx = harness(widgets, catalogs)
    assert ctx["ready"] is True
    assert ctx["DATA_ALL_PICKED"] is True and ctx["DATA_CATALOGS"] == ["main", "ops", "sales"]


def test_A1_must_keep_a_legacy_data_widget_left_in_the_notebook_keeps_the_persons_narrowed_pick(harness):
    """User input wins: a notebook re-run after an upgrade still holds the old widget, so its narrowed pick is used, never widened to All."""
    catalogs = [cat("ops"), cat("sales"), cat("main")]
    widgets = support.FakeWidgets({
        WH: {"kind": "combobox", "value": "Shared (wh1)", "choices": [], "label": ""},
        CAT: {"kind": "combobox", "value": "ops", "choices": [], "label": ""},
        LEGACY_DATA: {"kind": "multiselect", "value": "sales", "choices": [ALL, "main", "ops", "sales"], "label": ""},
    })
    ctx = harness(widgets, catalogs)
    assert ctx["ready"] is True
    assert ctx["DATA_CATALOGS"] == ["sales"], "the old widget's pick is kept"
    assert DATA not in widgets.state, "no second data-catalog widget is created next to the old one"


# ---- A2: the storage pick offers "Create new catalog _inspire_ai" ----

def test_A2_the_storage_pick_offers_create_new_inspire_ai_first(harness):
    widgets = first_run(harness, [cat("ops"), cat("sales")])
    choices = widgets.state[CAT]["choices"]
    assert CREATE in choices, f"REQ-521 A2: Not implemented: {CAT} has no '{CREATE}' choice: {choices}"
    assert choices[1] == CREATE, f"the create choice is the first one after the placeholder: {choices[:3]}"
    assert widgets.state[CAT]["value"] != CREATE, "the create choice is an option, never the default"


def test_A2_picking_create_makes_inspire_ai_the_storage_catalog_to_create_and_not_a_data_catalog(harness):
    catalogs = [cat("ops"), cat("sales")]
    widgets = first_run(harness, catalogs)
    widgets.pick(WH, "Shared (wh1)")
    widgets.pick(CAT, CREATE)
    ctx = harness(widgets, catalogs)
    assert ctx.get("ready") is True, f"REQ-521 A2: Not implemented: picking '{CREATE}' is refused: {harness.shown[-1:]}"
    assert ctx["CATALOG"] == NEW and ctx["INSPIRE_DB"] == f"{NEW}._inspire"
    assert ctx.get("CREATE_CATALOG") is True, "the context says the installer must create the catalog"
    assert NEW not in ctx["DATA_CATALOGS"] and not setup._customer_catalog(ctx), "Inspire's own catalog holds no customer data"


def test_A2_typing_inspire_ai_when_it_does_not_exist_also_creates_it(harness):
    catalogs = [cat("ops")]
    widgets = first_run(harness, catalogs)
    widgets.pick(WH, "Shared (wh1)")
    widgets.pick(CAT, NEW)
    ctx = harness(widgets, catalogs)
    assert ctx.get("ready") is True, f"REQ-521 A2: Not implemented: typed {NEW} is refused: {harness.shown[-1:]}"
    assert ctx["CATALOG"] == NEW and ctx.get("CREATE_CATALOG") is True


def test_A2_must_keep_an_existing_inspire_ai_is_listed_as_itself_reused_and_never_read_as_data(harness):
    catalogs = [cat("ops"), cat(NEW)]
    widgets = first_run(harness, catalogs)
    assert CREATE not in widgets.state[CAT]["choices"], "no create choice when the catalog already exists"
    assert NEW in widgets.state[CAT]["choices"]
    widgets.pick(WH, "Shared (wh1)")
    widgets.pick(CAT, NEW)
    ctx = harness(widgets, catalogs)
    assert ctx["ready"] is True and ctx["CATALOG"] == NEW
    assert not ctx.get("CREATE_CATALOG"), "an existing catalog is never created again"
    assert ctx["DATA_ALL_PICKED"] is True
    assert NEW not in ctx["DATA_CATALOGS"], (
        f"REQ-521 A2: Not implemented: on a re-run All reads {NEW} as customer data, so its grants differ from the first run: {ctx['DATA_CATALOGS']}")
    assert ctx["DATA_CATALOGS"] == ["ops"]


def test_A2_must_keep_an_existing_catalog_is_still_picked_as_before(harness):
    catalogs = [cat("ops"), cat("sales")]
    widgets = first_run(harness, catalogs)
    widgets.pick(WH, "Shared (wh1)")
    widgets.pick(CAT, "sales")
    ctx = harness(widgets, catalogs)
    assert ctx["ready"] is True and ctx["CATALOG"] == "sales" and not ctx.get("CREATE_CATALOG")


# ---- A3: preflight creates the catalog only with CREATE CATALOG, else stops before any change ----

class MissingCatalogWorkspace(Workspace):
    """`_inspire_ai` does not exist (or exists hidden); CREATE CATALOG can be made to fail."""

    def __init__(self, get_error="NOT_FOUND: Catalog '_inspire_ai' does not exist.", create_error=None):
        super().__init__(owner="someone-else", schema=False)
        outer = self

        def get(name):
            if name == NEW and get_error:
                raise RuntimeError(get_error)
            return types.SimpleNamespace(name=name, owner=ME)

        self.catalogs = types.SimpleNamespace(get=get)
        plain = self.statement_execution

        class Statements:
            def execute_statement(self, warehouse_id, statement, wait_timeout):
                if create_error and statement.startswith("CREATE CATALOG"):
                    outer.statements.append(statement)
                    return types.SimpleNamespace(status=types.SimpleNamespace(state=setup.StatementState.FAILED,
                                                                              error=types.SimpleNamespace(message=create_error)), statement_id="s2")
                return plain.execute_statement(warehouse_id, statement, wait_timeout)

            def get_statement(self, statement_id):
                return plain.get_statement(statement_id)

        self.statement_execution = Statements()


def create_ctx(w, metastore_privileges=(), metastore_owner="metastore-admins", groups=()):
    api, calls = recording(app_exists())
    ctx = context(api, w=w, groups=groups, CATALOG=NEW, INSPIRE_DB=f"{NEW}._inspire", CREATE_CATALOG=True, DATA_CATALOGS=["ops"])
    asked = []

    def api_get(path):
        asked.append(path)
        if path == "/api/2.1/unity-catalog/metastore_summary":
            return {"metastore_id": "ms-1", "owner": metastore_owner}
        if path.startswith("/api/2.1/unity-catalog/effective-permissions/metastore/ms-1"):
            return {"privilege_assignments": [{"principal": ME, "privileges": [{"privilege": p} for p in metastore_privileges]}]}
        if path.startswith(f"/api/2.1/unity-catalog/effective-permissions/catalog/{NEW}"):
            raise AssertionError(f"the catalog does not exist yet, so its rights are not read: {path}")
        raise AssertionError(path)

    ctx["api_get"] = api_get
    return ctx, calls, asked


def preflight(ctx):
    saved = {name: getattr(setup, name) for name in INSTALL_STEPS + ("build_runtime_context",)}
    steps = []
    try:
        for name in INSTALL_STEPS:
            setattr(setup, name, lambda c, n=name: steps.append(n))
        setup.build_runtime_context = lambda env: ctx
        out, error = io.StringIO(), None
        with contextlib.redirect_stdout(out):
            try:
                setup.run({"dbutils": None, "displayHTML": lambda html: None, "manifest": {"version": "v1.3.0"}})
            except RuntimeError as exc:
                error = str(exc)
        return steps, error, out.getvalue()
    finally:
        for name, value in saved.items():
            setattr(setup, name, value)


def test_A3_with_create_catalog_on_the_metastore_the_preflight_creates_inspire_ai_in_the_default_location_then_installs():
    w = MissingCatalogWorkspace()
    ctx, _, _ = create_ctx(w, metastore_privileges=("CREATE_CATALOG",))
    steps, error, _ = preflight(ctx)
    assert error is None, f"REQ-521 A3: Not implemented: the install of a new {NEW} stops: {error}"
    created = [s for s in w.statements if s.startswith("CREATE CATALOG")]
    assert len(created) == 1 and CREATE_SQL.match(created[0]), f"one CREATE CATALOG, no MANAGED LOCATION: {w.statements}"
    assert w.statements.index(created[0]) > w.statements.index("SELECT 1"), "the catalog is created after the rights checks"
    assert steps == list(INSTALL_STEPS), "the install then runs every step (step_schema_and_notebooks creates `_inspire_ai`.`_inspire`)"


def test_A3_a_metastore_admin_needs_no_effective_permission_read():
    w = MissingCatalogWorkspace()
    ctx, _, asked = create_ctx(w, metastore_owner="admins", groups=("admins",))
    steps, error, _ = preflight(ctx)
    assert error is None, f"REQ-521 A3: Not implemented: a metastore admin cannot create {NEW}: {error}"
    assert [s for s in w.statements if CREATE_SQL.match(s)], w.statements
    assert not [p for p in asked if "/effective-permissions/metastore/" in p]


def test_A3_without_create_catalog_the_installer_names_the_grant_and_changes_nothing():
    w = MissingCatalogWorkspace()
    ctx, calls, _ = create_ctx(w, metastore_privileges=())
    steps, error, _ = preflight(ctx)
    assert error is not None, f"REQ-521 A3: Not implemented: the installer went on without CREATE CATALOG: {w.statements}"
    assert error.startswith("Nothing was replaced"), error
    assert f"GRANT CREATE CATALOG ON METASTORE TO `{ME}`" in error, error
    assert "01_inspire_catalog" in error, "the stop says the person can pick an existing catalog instead"
    assert steps == [] and w.statements == ["SELECT 1"], f"no CREATE CATALOG, CREATE SCHEMA or GRANT was sent: {w.statements}"
    assert [c for c in calls if c[0] in ("POST", "PUT", "PATCH", "DELETE")] == [], "no workspace change either"


def test_A3_a_refused_create_stops_before_any_step_with_the_databricks_words():
    w = MissingCatalogWorkspace(create_error="Metastore storage root URL does not exist. Please provide a storage location for the catalog.")
    ctx, _, _ = create_ctx(w, metastore_privileges=("CREATE_CATALOG",))
    steps, error, _ = preflight(ctx)
    assert error is not None and error.startswith("Nothing was replaced"), f"REQ-521 A3: Not implemented: {error!r} {w.statements}"
    assert "Metastore storage root URL does not exist" in error, error
    assert "01_inspire_catalog" in error, "the stop says the person can pick an existing catalog instead"
    assert steps == [], "no install step ran after the refused create"


def test_A3_an_inspire_ai_that_exists_but_you_cannot_use_is_refused_by_name():
    w = MissingCatalogWorkspace(get_error="PERMISSION_DENIED: User does not have USE CATALOG on Catalog '_inspire_ai'.")
    ctx, _, _ = create_ctx(w, metastore_privileges=("CREATE_CATALOG",))
    steps, error, _ = preflight(ctx)
    assert error is not None, f"REQ-521 A3: Not implemented: a hidden existing {NEW} is not caught: {w.statements}"
    assert f"A catalog named `{NEW}` already exists and you cannot use it" in error, error
    assert steps == [] and not [s for s in w.statements if s.startswith("CREATE CATALOG")], w.statements


def test_A3_must_keep_an_existing_storage_catalog_never_sends_create_catalog():
    api, _ = recording(app_exists())
    w = Workspace(owner="someone-else", schema=True)
    steps, error, _ = preflight(context(api, w=w))
    assert error is None and steps == list(INSTALL_STEPS)
    assert not [s for s in w.statements if s.startswith("CREATE CATALOG")], w.statements
