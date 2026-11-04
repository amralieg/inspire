"""The segment explorer, recommendation desk and lift readout layouts of the App shell: their examples, their sections, their companion
tables, the segments and recs sections, the choices each decision list offers and the chart types they draw, offline."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402

LAYOUTS = ("segment_explorer", "recommendation_desk", "lift_readout")


def example(name):
    with open(os.path.join(SHELL, "examples", f"{name}.json"), encoding="utf-8") as handle:
        return json.load(handle)


SEGMENT, RECS, LIFT = (example(n) for n in LAYOUTS)


def problems(page):
    return shell_sql.spec_problems(page) or shell_sql.quality_problems(page)


def changed(page, change):
    out = copy.deepcopy(page)
    change(out)
    return out


def table(page, section):
    return next(t for t in page["tables"] if t["section"] == section)


def chart(page, section):
    return next(c for c in page["charts"] if c["section"] == section)


def dataset(page, name):
    return next(d for d in page["datasets"] if d["name"] == name)


@pytest.mark.parametrize("name", LAYOUTS)
def test_each_layout_is_served_opens_with_what_to_do_now_and_its_example_passes(name):
    layout = shell_sql.layouts()[name]
    assert layout["enabled"] is True and name in shell_sql.enabled_layouts()
    assert layout["sections"][0] == "todo"
    page = example(name)
    assert page["layout"] == name and problems(page) == []
    assert all(c.get("section") in layout["sections"] and c.get("so_what") for c in page["charts"])


@pytest.mark.parametrize("page, section, fragment", [
    (SEGMENT, "segment_cards", "needs a table: a card per segment"),
    (LIFT, "effect_card", "needs a table: the effect with its interval"),
])
def test_a_page_missing_its_card_table_is_refused_with_the_section_it_misses(page, section, fragment):
    found = problems(changed(page, lambda p: p.update(tables=[t for t in p["tables"] if t["section"] != section])))
    assert any(f"the {section} section" in p and fragment in p for p in found), found


@pytest.mark.parametrize("page, section, column", [
    (SEGMENT, "segment_cards", "size"), (SEGMENT, "segment_cards", "segment_id"),
    (LIFT, "effect_card", "roi"), (LIFT, "effect_card", "p_value"),
])
def test_a_card_table_must_show_the_columns_of_its_companion_table(page, section, column):
    def drop(p):
        t = table(p, section)
        t["columns"] = [c for c in t["columns"] if c["column"] != column]
    found = problems(changed(page, drop))
    assert any(f"in {section} shows the columns" in p and p.endswith(f"add {column}") for p in found), found


@pytest.mark.parametrize("page, section, companion", [
    (SEGMENT, "segment_cards", "main.sales.customer_segments_out__segments"),
    (LIFT, "effect_card", "main.marketing.promo_lift_out__effect"),
])
def test_a_card_table_must_read_its_companion_table(page, section, companion):
    def point_away(p):
        d = dataset(p, table(p, section)["dataset"])
        d["sql"] = d["sql"].replace(companion, "main.sales.somewhere_else")
    found = problems(changed(page, point_away))
    assert any(f"reads {companion}; point its dataset at that table" in p for p in found), found


@pytest.mark.parametrize("change, fragment", [
    (lambda p: p.pop("segments"), "needs a segments section"),
    (lambda p: p["segments"].update(filter="nowhere"), "must be a multi_select filter"),
    (lambda p: p["filters"][1]["columns"].pop("segments"), "must map the records dataset and the segment_id column of the segment cards dataset"),
    (lambda p: p["filters"][1]["columns"].pop("records"), "must map the records dataset and the segment_id column of the segment cards dataset"),
    (lambda p: p["filters"][1]["columns"].update(segments="label"), "so picking a card marks its segment"),
    (lambda p: p["records"].update(column_filters=False), "so its decision list keeps its column filters"),
    (lambda p: p["segments"].update(treatments=["Only one"]), "needs 2 to 6 treatments; it has 1"),
    (lambda p: p["segments"].update(treatments=[f"T{i}" for i in range(7)]), "needs 2 to 6 treatments; it has 7"),
    (lambda p: p["segments"].update(treatments=["Win back", "win back"]), "each segment treatment is named once"),
    (lambda p: p["segments"].update(treatments=["Win back", ""]), "a segment treatment"),
    (lambda p: p["segments"].update(suggest="not_shown"), "must be a column the segment cards table shows"),
    (lambda p: p["segments"].update(suggest="bad name;"), "must be a column the segment cards table shows"),
])
def test_the_segments_section_names_a_filter_reaching_every_member_and_two_to_six_treatments(change, fragment):
    found = problems(changed(SEGMENT, change))
    assert any(fragment in p for p in found), found


def test_the_segments_section_may_leave_out_its_suggestion():
    assert problems(changed(SEGMENT, lambda p: p["segments"].pop("suggest"))) == []


@pytest.mark.parametrize("change, fragment", [
    (lambda p: p.pop("recs"), "needs a recs section"),
    (lambda p: p["recs"].update(entity=""), "the recs entity must be a column"),
    (lambda p: p["recs"].update(score="1 score"), "the recs score must be a column"),
    (lambda p: p["recs"].update(per_entity=0), "per_entity must be a whole number from 1 to 5"),
    (lambda p: p["recs"].update(per_entity=6), "per_entity must be a whole number from 1 to 5"),
    (lambda p: p["recs"].update(per_entity=2.5), "per_entity must be a whole number from 1 to 5"),
    (lambda p: p["records"].pop("reasons"), "its decision list needs a reasons column"),
    (lambda p: p["records"].pop("action"), "its decision list needs an action column"),
])
def test_the_recommendation_desk_names_its_entity_score_reasons_and_action(change, fragment):
    found = problems(changed(RECS, change))
    assert any(fragment in p for p in found), found


def test_the_recs_section_takes_three_per_entity_when_it_names_none():
    assert problems(changed(RECS, lambda p: p["recs"].pop("per_entity"))) == []


def test_the_recs_entity_must_be_a_name_the_lookup_finds():
    found = problems(changed(RECS, lambda p: p["recs"].update(entity="customer_id")))
    assert "the recs entity customer_id must be the label, sublabel or key of the decision list, so a person can look an entity up by name" in found
    assert problems(changed(RECS, lambda p: p["recs"].update(entity="item"))) == []
    assert problems(changed(RECS, lambda p: p["recs"].update(entity="entity_id"))) == []


def promotion(p):
    return next(f for f in p["filters"] if f["id"] == "promotion")


@pytest.mark.parametrize("change", [
    lambda p: p.update(filters=[f for f in p["filters"] if f["id"] != "promotion"]),
    lambda p: promotion(p)["columns"].update(effects="metric"),
    lambda p: promotion(p).update(type="text"),
])
def test_a_lift_readout_effect_card_needs_a_filter_that_picks_one_intervention(change):
    found = problems(changed(LIFT, change))
    assert any("in effect_card needs a multi_select filter on the intervention column of its effects dataset" in p for p in found), found


def test_the_lift_readout_promotion_filter_reaches_the_cards_the_list_the_waterfall_and_the_curves():
    assert promotion(LIFT)["columns"] == {"records": "entity_id", "effects": "intervention", "curves": "promo_id", "steps": "intervention"}
    assert shell_sql.pick_filter(LIFT, "effects", "intervention") == "promotion"
    assert shell_sql.pick_filter(LIFT, "effects", "metric") is None
    assert shell_sql.effect_problems(LIFT) == []
    assert not any("intervention column" in p for p in problems(changed(SEGMENT, lambda p: p["filters"].pop(1))))


@pytest.mark.parametrize("page, key, layout", [
    (LIFT, "recs", "recommendation_desk"), (SEGMENT, "recs", "recommendation_desk"),
    (RECS, "segments", "segment_explorer"), (LIFT, "segments", "segment_explorer"),
])
def test_a_segments_or_recs_section_on_another_layout_is_refused(page, key, layout):
    found = problems(changed(page, lambda p: p.update({key: copy.deepcopy((SEGMENT if key == "segments" else RECS)[key])})))
    assert f"only a {layout} page has a {key} section" in found, found


def test_the_lift_readout_needs_the_action_its_suggested_choice_reads_and_a_keep_scale_stop_list():
    found = problems(changed(LIFT, lambda p: p["records"].pop("action")))
    assert "a lift_readout page marks a suggested choice on each row, so its decision list needs an action column" in found
    bare = changed(LIFT, lambda p: p.pop("records"))
    assert any("keep_scale_stop section" in p for p in shell_sql.spec_problems(bare)), shell_sql.spec_problems(bare)
    assert not any("action column" in p for p in problems(changed(SEGMENT, lambda p: p["records"].pop("action"))))


@pytest.mark.parametrize("page, section, kind, fragment", [
    (SEGMENT, "segment_profile", "x", "goes in one of"),
    (SEGMENT, "size_value_treemap", "scatter", "goes in one of: projection"),
    (SEGMENT, "migration_flow", "treemap", "goes in one of: size_value_treemap"),
    (RECS, "affinity_heatmap", "sankey", "goes in one of: no section"),
    (LIFT, "response_curves", "radar", "goes in one of: no section"),
])
def test_each_chart_type_goes_only_in_a_section_that_draws_it(page, section, kind, fragment):
    if kind == "x":
        found = problems(changed(page, lambda p: chart(p, section).update(section="projection")))
    else:
        found = problems(changed(page, lambda p: chart(p, section).update(type=kind)))
    assert any(fragment in p for p in found), found


@pytest.mark.parametrize("section, change, fragment", [
    ("size_value_treemap", lambda c: c.update(y=c["y"][:1]), "y holds exactly 2 measures in this order: size, value"),
    ("size_value_treemap", lambda c: c["x"].update(kind="time"), "x kind must be category"),
    ("segment_profile", lambda c: c.pop("series"), "is a radar, so it needs a series column"),
    ("segment_profile", lambda c: c["y"].append(dict(c["y"][0], label="Again")), "is a radar, so it shows one measure"),
    ("migration_flow", lambda c: c.pop("series"), "is a sankey, so it needs a series column"),
    ("migration_flow", lambda c: c["y"].append(dict(c["y"][0], label="Again")), "is a sankey, so it shows one measure"),
])
def test_a_treemap_needs_size_then_value_and_a_radar_or_sankey_one_measure_split_by_series(section, change, fragment):
    found = problems(changed(SEGMENT, lambda p: change(chart(p, section))))
    assert any(fragment in p for p in found), found


def test_the_new_chart_types_are_registered_and_each_layout_section_draws_only_known_types():
    assert {"treemap", "radar", "sankey"} <= set(shell_sql.CHART_TYPES)
    assert shell_sql.LAYOUT_CHARTS["treemap"] == ("category", ("size", "value"))
    assert {"radar", "sankey"} <= set(shell_sql.SERIES_CHARTS)
    for name in LAYOUTS:
        for section in shell_sql.layouts()[name]["sections"]:
            kinds = (shell_sql.SECTIONS.get(section) or {}).get("charts") or ()
            assert set(kinds) <= set(shell_sql.CHART_TYPES), (name, section)



def queue_page(page):
    out = changed(page, lambda p: p.update(layout="decision_queue"))
    for key in ("segments", "recs"):
        out.pop(key, None)
    for group in ("charts", "tables"):
        for item in out.get(group) or []:
            item.pop("section", None)
    return out


@pytest.mark.parametrize("kind", ["treemap", "radar", "sankey"])
def test_a_chart_from_the_layout_chart_chunk_is_refused_on_a_decision_queue_page_and_in_a_plain_charts_section(kind):
    queue = queue_page(SEGMENT)
    found = shell_sql.spec_problems(queue)
    assert any(f"is a {kind}, which only a laid-out page draws" in p for p in found), found
    assert not shell_sql._section_fits("charts", "charts", kind)
    assert kind in shell_sql.LAYOUT_ONLY_CHARTS and kind in shell_sql.LAZY_CHARTS


def test_a_decision_queue_page_keeps_its_core_charts_and_refuses_a_segments_section():
    queue = queue_page(SEGMENT)
    for c in queue["charts"]:
        c["type"] = {"treemap": "bar", "radar": "stacked_bar", "sankey": "stacked_bar"}.get(c["type"], c["type"])
    assert shell_sql.spec_problems(queue) == []
    assert shell_sql._section_fits("charts", "charts", "scatter")
    queue["segments"] = copy.deepcopy(SEGMENT["segments"])
    assert "only a segment_explorer page has a segments section" in shell_sql.spec_problems(queue)


def test_the_app_waits_for_the_layout_chart_chunk_for_exactly_the_charts_the_server_calls_lazy():
    with open(os.path.join(SHELL, "web", "src", "KindParts.jsx"), encoding="utf-8") as handle:
        source = handle.read()
    line = next(l for l in source.splitlines() if l.startswith("export const LAZY_CHARTS = "))
    assert tuple(json.loads(line.split(" = ", 1)[1].rstrip(";").replace("'", '"'))) == shell_sql.LAZY_CHARTS
    with open(os.path.join(SHELL, "web", "src", "echartsKinds.js"), encoding="utf-8") as handle:
        chunk = handle.read()
    for kind in shell_sql.LAZY_CHARTS:
        assert {"gantt": "CustomChart"}.get(kind, f"{kind.capitalize()}Chart") in chunk, kind

@pytest.mark.parametrize("name, expected", [
    ("recommendation_desk", [("send", "Done"), ("skip", "Dismissed")]),
    ("lift_readout", [("scale", "Done"), ("keep", "Done"), ("change", "In progress"), ("stop", "Done")]),
    ("segment_explorer", []),
])
def test_each_choice_writes_a_status_the_record_decision_path_accepts(name, expected):
    choices = shell_sql.layout_choices(name)
    assert [(c["id"], c["status"]) for c in choices] == expected
    for c in choices:
        values = ({"action_status": "Dismissed", "dismiss_reason": f"{c['label']}: Bad timing"} if c["status"] == "Dismissed"
                  else {"action_status": c["status"], "note": c["label"]})
        assert shell_sql.action_values(values)["action_status"] == c["status"]
    if any(c["status"] == "Dismissed" for c in choices):
        with pytest.raises(ValueError, match="needs a dismiss_reason"):
            shell_sql.action_values({"action_status": "Dismissed"})
    assert shell_sql.action_values({"action_status": "In progress", "note": "Treatment: Win-back offer"})["action_status"] == "In progress"


def test_the_public_page_carries_the_segments_and_recs_sections_and_the_layout_choices():
    segment = shell_core.public_page(SEGMENT)
    assert segment["segments"] == SEGMENT["segments"] and segment["recs"] is None and segment["choices"] == []
    assert segment["layout"]["holds"]["segment_cards"] == "records"
    recs = shell_core.public_page(RECS)
    assert recs["recs"] == {"entity": "customer_name", "score": "score", "per_entity": 3} and recs["segments"] is None
    assert [c["id"] for c in recs["choices"]] == ["send", "skip"]
    assert [c["id"] for c in shell_core.public_page(LIFT)["choices"]] == ["scale", "keep", "change", "stop"]


def test_the_recs_entity_and_score_must_be_columns_the_decision_list_returns(capsys):
    columns = {"record_key": "STRING", "customer_name": "STRING", "score": "DOUBLE", "item": "STRING"}
    assert shell_sql.part_column_problems(RECS, columns) == []
    found = shell_sql.part_column_problems(RECS, {k: v for k, v in columns.items() if k != "score"})
    assert found == ["the recs score column score is not a column of the records dataset, so the desk cannot group or rank its offers"]
    assert "[LAYOUT-PARTS FIRED] page=n04_u02 missing=1" in capsys.readouterr().out
    assert shell_sql.part_column_problems(SEGMENT, {}) == [] and shell_sql.part_column_problems(RECS, None) == []
    assert "LAYOUT-PARTS FIRED" not in capsys.readouterr().out


def test_the_segment_and_lift_sections_need_their_minimum_rows_at_the_default_filters(capsys):
    assert shell_sql.row_minimums(SEGMENT) == [("segment_cards", 3, ("records", "records")), ("segment_cards", 3, ("table", "cards"))]
    found = shell_sql.row_problems(SEGMENT, {("records", "records"): 40, ("table", "cards"): 2})
    assert len(found) == 1 and "table cards returned 2" in found[0]
    assert "[LAYOUT-ROWS FIRED]" in capsys.readouterr().out
    assert ("keep_scale_stop", 3, ("records", "records")) in shell_sql.row_minimums(LIFT)
    assert ("rec_list", 20, ("records", "records")) in shell_sql.row_minimums(RECS)
    assert shell_sql.row_problems(RECS, {("records", "records"): 20}) == []


@pytest.mark.parametrize("name", LAYOUTS)
def test_the_layout_brief_tells_the_page_author_the_sections_and_companion_tables(agent_ns, name):
    tables = agent_ns["implement_layout_tables"](example(name)["result_table"], name)
    contract = shell_sql.layout_contract({"layout": name})
    assert sorted(tables) == sorted(f"{example(name)['result_table']}{s}" for s in contract)
    brief = agent_ns["implement_layout_brief"](name, tables, shell_sql)
    assert f'Inspire sets layout to "{name}"' in brief
    for section in shell_sql.layouts()[name]["min_items"]:
        assert section in brief
    if name == "segment_explorer":
        assert "segments section" in brief and "charts of type treemap" in brief
    if name == "recommendation_desk":
        assert "recs section" in brief


def test_the_dashboard_draws_the_new_chart_types_as_the_nearest_dashboard_chart(agent_ns):
    widgets = agent_ns["IMPLEMENT_DASHBOARD_CHART_WIDGETS"]
    assert {t: widgets[t] for t in ("treemap", "radar", "sankey")} == {"treemap": "bar", "radar": "heatmap", "sankey": "heatmap"}
    assert set(shell_sql.CHART_TYPES) <= set(widgets)


def where_of(page, ident, values):
    sql, params = shell_sql.table_query(page, ident, values)
    return sql.split(" AS d", 1)[1], [p["value"] for p in params]


@pytest.mark.parametrize("page, ident, own, other, other_column", [
    (SEGMENT, "cards", {"segment": ["S2"]}, None, None),
    (LIFT, "effect", {"promotion": ["Spring bundle"]}, {"channel": ["Online"]}, "`channel`"),
])
def test_a_card_picker_table_is_never_narrowed_by_its_own_pick_and_still_follows_every_other_filter(page, ident, own, other, other_column, capsys):
    where, values = where_of(page, ident, own)
    assert list(own.values())[0][0] not in values and "WHERE" not in where
    assert f"[CARD-PICK FIRED] page={page['id']} table={ident} filter={list(own)[0]}" in capsys.readouterr().out
    if other:
        where, values = where_of(page, ident, dict(own, **other))
        assert other_column in where and list(other.values())[0][0] in values and list(own.values())[0][0] not in values
    capsys.readouterr()
    where_of(page, ident, {})
    assert "CARD-PICK FIRED" not in capsys.readouterr().out


def test_only_the_card_picker_tables_skip_their_pick_and_every_chart_and_the_list_still_follow_it():
    assert shell_sql.card_picks(SEGMENT) == {"cards": "segment"} and shell_sql.card_picks(LIFT) == {"effect": "promotion"}
    assert shell_sql.card_picks(RECS) == {}
    unmapped = changed(LIFT, lambda p: next(f for f in p["filters"] if f["id"] == "promotion")["columns"].pop("effects"))
    assert shell_sql.card_picks(unmapped) == {}
    where, values = where_of(unmapped, "effect", {"promotion": ["Spring bundle"]})
    assert "WHERE" not in where and values == []
    queries = {(kind, ident): (sql, params) for kind, ident, sql, params in shell_sql.page_queries(LIFT, {"promotion": ["Spring bundle"]})}
    steps = next(sql for (kind, ident), (sql, _p) in queries.items() if kind == "chart" and "`intervention`" in sql)
    assert "`intervention`" in steps.split(" AS d", 1)[1]
    records_sql, records_params = shell_sql.records_query(SEGMENT, {"segment": ["S2"]})
    assert "S2" in [p["value"] for p in records_params]



@pytest.mark.parametrize("page, values, treatment, status, fragment", [
    ("plain", {"action_status": "In progress", "note": "Treatment: Win-back offer"}, "Win-back offer", 400, "has no segment treatments"),
    ("segment", {"action_status": "In progress", "note": "Treatment: Upsell"}, "Upsell", 400, "must be one of this page's segment treatments"),
    ("segment", {"action_status": "In progress"}, "win-back offer", 400, "must be one of this page's segment treatments"),
    ("segment", {"action_status": "Done"}, "Win-back offer", 400, "goes with action_status In progress"),
    ("segment", {"action_status": "In progress", "note": "Treatment: Win-back offer"}, "Win-back offer", 200, None),
    ("segment", {"action_status": "In progress", "note": "Treatment: Win-back offer"}, None, 200, None),
])
def test_an_act_records_its_treatment_only_when_the_page_offers_it_and_work_starts(tmp_path, page, values, treatment, status, fragment):
    from v141_app_shell_test import call
    from v142_edits_test import edit_page
    from v144_app_data_test import DECIDE, EDITOR, shell
    target = SEGMENT if page == "segment" else edit_page()
    s, ws, _made = shell(tmp_path, settings=dict(DECIDE, pages=[target["id"]]), pages=[target])
    body = {"page": target["id"], "record_keys": ["k1"], "seen": {"k1": "101"}, "values": values,
            **({"treatment": treatment} if treatment is not None else {})}
    got, out = call(s, "POST", "records/act", headers=EDITOR, body=body)
    assert got == status, out
    if fragment:
        assert fragment in out["error"] and ws.queries("MERGE INTO") == []
        return
    (_sql, params), = ws.queries("MERGE INTO")
    written = [json.loads(p["value"]) for p in params if str(p["value"]).startswith('{"action_status"')]
    assert written == [{"action_status": "In progress", **({"treatment": treatment} if treatment else {})}]


def test_the_batch_values_name_the_treatment_beside_the_values_sent_and_never_the_note():
    values = {"action_status": "In progress", shell_sql.BATCH_NOTE: "Treatment: Win-back offer"}
    sent = {"action_status": "In progress", "note": "Treatment: Win-back offer"}
    assert json.loads(shell_core.batch_values(sent, values, "Win-back offer")) == {"action_status": "In progress", "treatment": "Win-back offer"}
    assert json.loads(shell_core.batch_values(sent, values)) == {"action_status": "In progress"}


def test_only_a_list_with_a_segments_section_and_recorded_batches_counts_treatments():
    from v144_app_data_test import TRACKED
    names = {"record_key", "entity_id", "segment", "segment_label"}
    fields = shell_sql.change_fields(TRACKED)
    context = shell_sql.list_context(SEGMENT, names, fields, True)
    assert context["treatments"] == "segment"
    without = shell_sql.change_fields([c for c in TRACKED if c["name"] != shell_sql.BATCH_VALUES])
    assert shell_sql.list_context(SEGMENT, names, without, True)["treatments"] is None
    assert shell_sql.list_context(SEGMENT, names, fields, False)["treatments"] is None
    assert shell_sql.list_context(changed(SEGMENT, lambda p: p.pop("segments")), names, fields, True)["treatments"] is None
    assert shell_sql.list_context(RECS, {"record_key", "customer_name"}, fields, True)["treatments"] is None
    assert "treatments" not in shell_sql.list_queries(SEGMENT, {}, shell_sql.list_request(SEGMENT, {}, context), context, "p")
    with pytest.raises(ValueError, match="treatments takes true or false"):
        shell_sql.list_request(SEGMENT, {"treatments": "yes"}, context)


def segment_workspace():
    from v148_app_hub_test import COLUMNS, PERSON, SqliteWorkspace, version
    pytest.importorskip("sqlglot")
    win = '{"action_status": "In progress", "treatment": "Win-back offer"}'
    rows = [
        version("k1", "Act now", 900.0, action_status="In progress", action_batch_values=win),
        version("k2", "Act now", 800.0, action_status="In progress", action_batch_values=win, changed_by=PERSON),
        version("k3", "Review", 300.0, action_status="In progress",
                action_batch_values='{"action_status": "In progress", "treatment": "Leave as is"}'),
        version("k4", "Review", 200.0, current=False, ends="2026-10-21 06:00:00", action_status="In progress", action_batch_values=win),
        version("k4", "Review", 200.0, at="2026-10-21 06:00:00", action_status="New"),
        version("k5", "Monitor", 100.0, action_status="In progress", action_note="Treatment: Win-back offer",
                action_batch_note="Treatment: Win-back offer", action_batch_values='{"action_status": "In progress"}'),
        version("k6", "Monitor", 100.0, source="delete", action_batch_values=win),
    ]
    ws = SqliteWorkspace(tables={})
    extra = ("top_reasons", "recommended_action", "value")
    quoted = ", ".join(f'"{c}"' for c in COLUMNS + extra)
    ws.db.execute(f'CREATE TABLE "customer_segments_out" ({quoted})')
    ws.db.executemany(f'INSERT INTO "customer_segments_out" VALUES ({", ".join("?" for _ in COLUMNS + extra)})',
                      [tuple(r[c] for c in COLUMNS) + ("Spend fell", "Win back", r["value_at_stake"]) for r in rows])
    segment_of = {"k1": "S1", "k2": "S1", "k3": "S2", "k4": "S2", "k5": "S1", "k6": "S1"}
    ws.db.execute('CREATE TABLE "customer_segments_out__assign" ("entity", "segment", "x", "y")')
    ws.db.executemany('INSERT INTO "customer_segments_out__assign" VALUES (?, ?, 0, 0)', list(segment_of.items()))
    ws.db.execute('CREATE TABLE "customer_segments_out__segments" ("segment_id", "label", "size", "value", "profile")')
    ws.db.executemany('INSERT INTO "customer_segments_out__segments" VALUES (?, ?, 4, 1, ?)', [("S1", "Loyal", "{}"), ("S2", "Lapsing", "{}")])
    ws.db.execute('CREATE TABLE "customers" ("customer_id", "region", "channel", "plan_type")')
    ws.db.executemany('INSERT INTO "customers" VALUES (?, ?, ?, ?)', [(k, "North", "Web", "Basic") for k in segment_of])
    return ws


def segment_records(tmp_path, page=None, fail=None, **body):
    from v141_app_shell_test import SETTINGS, call
    from v148_app_hub_test import PERSON, hub_shell
    page = page or SEGMENT
    ws = segment_workspace()
    ws.fail.update(fail or {})
    s, _ws, _made = hub_shell(tmp_path, settings=dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True)), pages=[page], ws=ws)
    status, out = call(s, "POST", "records", headers={"x-forwarded-email": PERSON}, body=dict({"page": page["id"], "limit": 25}, **body))
    assert status == 200, out
    return out


def test_a_reload_counts_each_segments_treatments_from_the_current_recorded_decisions_not_from_note_text(tmp_path):
    out = segment_records(tmp_path, treatments=True)
    assert out["treatments"] == [{"segment": "S1", "treatment": "Win-back offer", "n": 2},
                                 {"segment": "S2", "treatment": "Leave as is", "n": 1}], out.get("errors")
    picked = segment_records(tmp_path / "b", treatments=True, filters={"segment": ["S2"]})
    assert picked["treatments"] == [{"segment": "S2", "treatment": "Leave as is", "n": 1}]
    assert "treatments" not in segment_records(tmp_path / "c")


def test_a_treatment_count_that_fails_is_reported_by_name_while_the_rows_are_still_served(tmp_path):
    out = segment_records(tmp_path, fail={"_inspire_treatment": shell_db.QueryError("[SQL_ERROR] the count failed")}, treatments=True)
    assert "treatments" in out["errors"] and "the count failed" in out["errors"]["treatments"]
    assert out.get("treatments") is None and out["total"] == 5 and len(out["rows"]) == 5
    assert "treatments" not in segment_records(tmp_path / "b", treatments=True)["errors"]
