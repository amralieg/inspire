from v140_implement_test import FakeSpark, _inspire, _spec, VALID  # noqa: F401

SOURCE = "main.sales.orders"
RESULT = "main.inspire.churn_out"
PER_USER = {"app": True, "app_access": "user", "app_backend": "lakebase"}
FILTER = {"table": SOURCE, "column": "region", "parameter": "region_key", "body": "x"}


def _inst(agent_ns, filters):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_lakebase_filter = lambda table: next((f for f in filters if f["table"] == table), None)
    return inst


def _use_case():
    return {"result_table": RESULT, "Tables Involved": SOURCE}


def _spec_of(agent_ns, **outputs):
    spec = _spec(agent_ns)[0]
    return dict(spec, outputs=dict(spec["outputs"], **outputs), data=dict(spec.get("data") or {}, tables={}, removed_tables=[]))


def test_the_key_ask_names_the_result_table_the_column_and_the_source_unchanged(agent_ns):
    text = agent_ns["implement_key_asks"]([{"table": SOURCE, "column": "region", "result_table": RESULT}])
    assert text == [("the result table main.inspire.churn_out must carry the column region from main.sales.orders unchanged, with one "
                     "region value for each row, because a row filter keeps each person to their rows through region")]


def test_the_choices_prompt_asks_for_the_key_columns_only_when_there_are_some(agent_ns):
    spec = _spec_of(agent_ns, **PER_USER)
    keys = [{"table": SOURCE, "column": "region", "result_table": RESULT}]
    with_keys = agent_ns["implement_choices_markdown"](spec, keys=keys)
    assert "must carry these columns unchanged" in with_keys and "from main.sales.orders unchanged" in with_keys
    assert "must carry these columns" not in agent_ns["implement_choices_markdown"](spec)


def test_a_per_user_lakebase_app_asks_for_each_filter_key_before_its_first_generation(agent_ns):
    inst = _inst(agent_ns, [FILTER])
    spec = _spec_of(agent_ns, **PER_USER)
    assert inst._implement_key_requirements(spec, _use_case()) == [{"table": SOURCE, "column": "region", "result_table": RESULT}]


def test_no_key_is_asked_for_a_shared_app_a_delta_app_or_an_unreadable_filter(agent_ns):
    filters = [FILTER]
    inst = _inst(agent_ns, filters)
    assert inst._implement_key_requirements(_spec_of(agent_ns, app=True, app_access="sp", app_backend="lakebase"), _use_case()) == []
    assert inst._implement_key_requirements(_spec_of(agent_ns, **dict(PER_USER, app_backend="delta")), _use_case()) == []
    unreadable = _inst(agent_ns, [{"table": SOURCE, "unreadable": True}])
    assert unreadable._implement_key_requirements(_spec_of(agent_ns, **PER_USER), _use_case()) == []


def test_the_key_ask_is_a_forced_ask_of_the_notebook_round_word_for_word(agent_ns):
    inst = _inst(agent_ns, [FILTER])
    inst._implement_vibes_asks = lambda cache, asset, text, impact=None: []
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": "", "forced": agent_ns["implement_key_asks"](
        [{"table": SOURCE, "column": "region", "result_table": RESULT}]), "retry": None, "asked_before": None, "impact": None}
    asks = inst._implement_round_asks({}, item)
    assert [a["ask"] for a in asks] == agent_ns["implement_key_asks"]([{"table": SOURCE, "column": "region", "result_table": RESULT}])


def test_a_result_without_the_key_column_is_a_deterministic_miss_and_a_present_one_is_left_to_the_judge(agent_ns):
    key = {"table": SOURCE, "column": "region", "result_table": RESULT}
    verdict = agent_ns["implement_key_presence"](["value", "channel"], key)
    assert verdict == ("missing", "main.inspire.churn_out has no region column, so it cannot carry the row filter of main.sales.orders")
    assert agent_ns["implement_key_presence"](["value", "REGION"], key) is None


def test_the_key_verdicts_of_a_build_name_only_the_keys_a_result_misses(agent_ns, monkeypatch):
    inst = _inst(agent_ns, [FILTER])
    monkeypatch.setitem(agent_ns, "inspire_table_schema", lambda spark, table: [("value", "double")])
    keys = [{"table": SOURCE, "column": "region", "result_table": RESULT}]
    verdicts = inst._implement_key_verdicts(keys)
    assert list(verdicts) == agent_ns["implement_key_asks"](keys)
    assert verdicts[agent_ns["implement_key_asks"](keys)[0]][0] == "missing"
    monkeypatch.setitem(agent_ns, "inspire_table_schema", lambda spark, table: [("region", "string")])
    assert inst._implement_key_verdicts(keys) == {}


def test_a_missed_key_ask_goes_back_as_unmet_and_the_judge_is_never_asked_about_it(agent_ns, monkeypatch):
    inst = _inst(agent_ns, [FILTER])
    keys = [{"table": SOURCE, "column": "region", "result_table": RESULT}]
    ask = agent_ns["implement_key_asks"](keys)[0]
    asked = []
    inst._implement_vibes_asks = lambda cache, asset, text, impact=None: []
    inst._implement_vibes_judge = lambda parts, where: asked.append([a["ask"] for p in parts for a in p["asks"]]) or {"checks": []}
    item = {"asset": agent_ns["IMPLEMENT_NOTEBOOK"], "text": "", "forced": [ask], "retry": None, "asked_before": None, "impact": None,
            "artifact": [{"x": 1}], "failure": "", "key_verdicts": {ask: ("missing", "no region column")}, "tools": {}, "held_asks": {}}
    found = inst._implement_vibes_round({}, [item], "test round")
    assert all(ask not in names for names in asked), "a deterministic miss is not sent to the judge"
    assert "no region column" in str(found)
