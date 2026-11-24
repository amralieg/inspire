"""SEC-01 W6 (Build side): the Build writes `sources` into inspire_app.json, the source tables the pages read and never the result table."""
import json

RESULT = "main.inspire.uc01_result"
SUMMARY = "main.inspire.uc01_summary"


def test_the_app_settings_list_the_source_tables_and_not_the_result_table(agent_ns):
    files = {"inspire_app.json": json.dumps({"auth": "sp"})}
    out = agent_ns["implement_app_mark_sources"](files, [RESULT, "main.s.orders", "main.s.customers", "main.s.orders", SUMMARY], [RESULT, SUMMARY])
    settings = json.loads(out["inspire_app.json"])
    assert settings["sources"] == ["main.s.customers", "main.s.orders"]
    assert agent_ns["implement_app_mark_sources"](files, [RESULT], [RESULT]) is files
    assert agent_ns["implement_app_mark_sources"]({}, ["main.s.orders"], []) == {}
