from v153_signal_check_test import FLAT_PRICE, answer, deep_inspire, uc

STRONG = dict(FLAT_PRICE, pooled=0.4)
REQUESTS = [{"id": "R1", "ask": "pricing use cases", "minimum": 3}]


def _respond(statement):
    if "AS pooled" in statement:
        return [FLAT_PRICE if "CAST(`sales_price` AS DOUBLE) AS l" in statement else STRONG]
    raise AssertionError(statement)


def _run(agent_ns, passing, failing, extra=0):
    ucs, results = [], []
    for index in range(passing + failing + extra):
        uc_id = f"N01-U{index + 1:02d}"
        case = uc(uc_id, "Optimization", score=9.0 - index * 0.1)
        if index < passing + failing:
            case["user_request"] = "R1"
        lever = "net_profit" if index < passing else "sales_price"
        ucs.append(case)
        results.append(answer(uc_id, {"lever": lever, "outcome": "quantity"}, user_requested=index < passing + failing))
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": results}], _respond,
                                        parsed_generation_instructions={"use_case_requests": REQUESTS})
    kept, dropped = inst._check_data_signal(ucs, [])
    return inst, ucs, kept, dropped


def test_past_the_minimum_a_requested_use_case_without_a_signal_drops_like_any_other(agent_ns):
    inst, ucs, kept, dropped = _run(agent_ns, passing=4, failing=3)
    assert [u["No"] for u in dropped] == ["N01-U05", "N01-U06", "N01-U07"]
    assert all(u["data_signal"]["status"] == "passed" for u in kept)
    messages = [str(call.args[0]) for call in inst.logger.info.call_args_list if call.args]
    assert any("request R1" in m and "0 kept with thin data" in m and "3 dropped like any other" in m for m in messages)


def test_under_the_minimum_the_best_failing_ones_ship_with_thin_data_and_the_rest_drop(agent_ns):
    _inst, ucs, kept, dropped = _run(agent_ns, passing=1, failing=3)
    assert [u["No"] for u in kept] == ["N01-U01", "N01-U02", "N01-U03"]
    assert [u["No"] for u in dropped] == ["N01-U04"]
    for case in kept[1:]:
        assert case["data_signal"]["status"] == "no_signal"
        assert case["data_signal"]["reason"].endswith("Inspire kept it because the instructions ask for pricing use cases "
                                                      "(at least 3) and only 1 of 4 such use cases is kept on the data, so it "
                                                      "ships with thin data.")
        assert case["Data Evidence"]["signal"]["status"] == "no_signal"


def test_an_untagged_use_case_is_never_protected_by_a_request(agent_ns):
    _inst, ucs, _kept, dropped = _run(agent_ns, passing=3, failing=0, extra=2)
    assert [u["No"] for u in dropped] == ["N01-U04", "N01-U05"]


def test_the_signal_prompt_no_longer_marks_requests(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["SIGNAL_CHECK_PROMPT"]
    assert "user_requested" not in template and "user_request" not in template
