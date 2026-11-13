# 9A boundary: a user-authorization App reads a source table it reads directly through an App-owned view (the Table Scope
# machinery with all the table's columns and no rows), so the audience is granted that view and never the raw table.
SOURCE = "main.s.orders"
COLUMNS = {SOURCE: ["order_id", "amount"]}


def _scopes(agent_ns, ready=False):
    scopes = agent_ns["implement_app_read_scopes"]([SOURCE], lambda t: COLUMNS.get(t, []), "main.inspire", "N01-U01")
    for entry in scopes.values():
        entry["ready"] = ready
    return scopes


def test_a_directly_read_source_gets_an_app_owned_view_of_all_its_columns_and_no_rows(agent_ns):
    scopes = _scopes(agent_ns)
    entry = scopes[agent_ns["inspire_table_scope_key"](SOURCE)]
    assert entry["view"] == "main.inspire.main_s_orders__n01_u01__implement_scope"
    assert "SELECT `order_id`, `amount` FROM `main`.`s`.`orders`" in entry["view_sql"], entry["view_sql"]
    assert " WHERE " not in entry["view_sql"], "no row filter: the App sees every row of the source through its own view"
    assert entry["ready"] is False


def test_the_page_reads_the_view_once_the_view_exists_through_the_same_rewrite(agent_ns):
    scopes = _scopes(agent_ns, ready=True)
    view = scopes[agent_ns["inspire_table_scope_key"](SOURCE)]["view_ref"]
    page = {"id": "p1", "datasets": [{"name": "d", "sql": f"SELECT amount FROM {SOURCE}"}]}
    rewritten = agent_ns["scope_app_pages"]([page], page, scopes)[0]["datasets"][0]["sql"]
    assert view in rewritten and SOURCE not in rewritten, rewritten


import copy  # noqa: E402
import json  # noqa: E402

OTHER = "main.s.returns"
NEW_PAGE = {"id": "p_new", "datasets": [{"name": "d", "sql": f"SELECT order_id FROM {SOURCE}"}]}
RETAINED_PAGE = {"id": "p_old", "datasets": [{"name": "d", "sql": f"SELECT amount FROM {OTHER}"}]}


def _columns(table):
    return {SOURCE: ["order_id", "amount"], OTHER: ["return_id"]}.get(table, [])


def test_every_page_including_a_retained_page_reads_its_sources_through_app_owned_views(agent_ns):
    pages = [copy.deepcopy(NEW_PAGE), copy.deepcopy(RETAINED_PAGE)]
    scopes = agent_ns["implement_app_read_scopes_for_pages"](pages, {}, (), _columns, "main.inspire", "N01-U01")
    assert set(scopes) == {agent_ns["inspire_table_scope_key"](SOURCE), agent_ns["inspire_table_scope_key"](OTHER)}
    for entry in scopes.values():
        entry["ready"] = True
    rewritten = agent_ns["scope_app_pages"](pages, pages[0], scopes)
    assert agent_ns["implement_app_raw_reads"](rewritten, scopes, ()) == [], "no page keeps a raw source after the rewrite"
    assert all(SOURCE not in p["datasets"][0]["sql"] and OTHER not in p["datasets"][0]["sql"] for p in rewritten)


def test_a_page_source_without_its_view_is_reported_as_raw_so_the_build_can_stop(agent_ns):
    pages = [copy.deepcopy(NEW_PAGE)]
    scopes = agent_ns["implement_app_read_scopes_for_pages"](pages, {}, (), _columns, "main.inspire", "N01-U01")
    assert agent_ns["implement_app_raw_reads"](pages, scopes, ()) == [SOURCE]


def test_a_source_with_a_table_scope_keeps_its_selected_columns_and_row_filters(agent_ns):
    scoped = agent_ns["parse_table_scopes"](json.dumps({SOURCE: {"columns": ["order_id"],
                                                                 "rows": [{"column": "region", "op": "in", "values": ["EU"]}]}}),
                                            "main.inspire", "N01-U01")
    for entry in scoped.values():
        entry["ready"] = True
    assert agent_ns["implement_app_read_scopes_for_pages"]([copy.deepcopy(NEW_PAGE)], scoped, (), _columns, "main.inspire", "N01-U01") == {}
    entry = scoped[agent_ns["inspire_table_scope_key"](SOURCE)]
    assert "SELECT `order_id` FROM `main`.`s`.`orders` WHERE" in entry["view_sql"], entry["view_sql"]
    assert "EU" in entry["view_sql"] and "amount" not in entry["view_sql"], "the selected column and the row filter are kept, nothing wider"
    rewritten = agent_ns["scope_app_pages"]([copy.deepcopy(NEW_PAGE)], NEW_PAGE, scoped)
    assert agent_ns["implement_app_raw_reads"](rewritten, scoped, ()) == []


def _bare_page(sql):
    return [{"id": "p_bare", "datasets": [{"name": "d", "sql": sql}]}]


def test_a_bare_source_after_from_is_read_through_its_view_and_not_left_raw(agent_ns):
    pages = _bare_page(f"SELECT amount FROM {SOURCE.split('.')[-1]}")
    scopes = agent_ns["implement_app_read_scopes_for_pages"](pages, {}, (), _columns, "main.inspire", "N01-U01", [SOURCE])
    for entry in scopes.values():
        entry["ready"] = True
    view = scopes[agent_ns["inspire_table_scope_key"](SOURCE)]["view_ref"]
    rewritten = agent_ns["scope_app_pages"](pages, pages[0], scopes)
    assert view in rewritten[0]["datasets"][0]["sql"], rewritten
    assert agent_ns["implement_app_raw_reads"](rewritten, scopes, (), [SOURCE]) == []


def test_a_backticked_bare_source_after_from_is_read_through_its_view_and_not_left_raw(agent_ns):
    pages = _bare_page("SELECT amount FROM `orders`")
    scopes = agent_ns["implement_app_read_scopes_for_pages"](pages, {}, (), _columns, "main.inspire", "N01-U01", [SOURCE])
    for entry in scopes.values():
        entry["ready"] = True
    rewritten = agent_ns["scope_app_pages"](pages, pages[0], scopes)
    assert "`orders`" not in rewritten[0]["datasets"][0]["sql"], rewritten
    assert agent_ns["implement_app_raw_reads"](rewritten, scopes, (), [SOURCE]) == []


def test_a_page_that_names_only_the_qualified_app_view_is_not_a_raw_read(agent_ns):
    scopes = _scopes(agent_ns, ready=True)
    view = scopes[agent_ns["inspire_table_scope_key"](SOURCE)]["view_ref"]
    pages = [{"id": "p_view", "datasets": [{"name": "d", "sql": f"SELECT amount FROM {view}"}]}]
    assert agent_ns["implement_app_raw_reads"](pages, scopes, (), [SOURCE]) == []


def test_a_bare_source_with_no_view_is_reported_raw_with_its_table_so_the_build_stops(agent_ns):
    pages = _bare_page("SELECT amount FROM orders")
    assert agent_ns["implement_app_raw_reads"](pages, {}, (), [SOURCE]) == [SOURCE]
