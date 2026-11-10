def test_removing_a_part_the_built_app_does_not_have_is_already_done(agent_ns):
    ask = {"ask": "Remove the Accuracy page from the App.", "where": "the Accuracy page"}
    removal, verdict = agent_ns["implement_vibes_taken_out"](ask, {}, {}, "App")
    assert removal is True
    assert verdict is not None and verdict[0] == "done", verdict
    assert "Accuracy" in verdict[1]


def test_a_removal_with_no_named_part_still_takes_the_ordinary_path(agent_ns):
    removal, verdict = agent_ns["implement_vibes_taken_out"]({"ask": "Remove it."}, {}, {}, "App")
    assert removal is False or verdict is None, verdict
