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
