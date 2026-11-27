"""c31_layout: a Dashboard that leaves out a dataset (c29_partial2) closes the empty gap the dropped widgets leave in the layout."""
import copy
import json


def _w(name, dataset, x, y, width=3, height=4, kind="table"):
    return {"widget": {"name": name, "queries": [{"name": f"q_{name}", "query": {"datasetName": dataset}}],
                       "spec": {"widgetType": kind}},
            "position": {"x": x, "y": y, "width": width, "height": height}}


def _dash(*items):
    return {"datasets": [{"name": "A"}, {"name": "B"}, {"name": "C"}], "pages": [{"name": "overview", "layout": list(items)}]}


def _pos(dashboard):
    return {i["widget"]["name"]: (i["position"]["x"], i["position"]["y"]) for i in dashboard["pages"][0]["layout"]}


def _no_overlap(dashboard):
    boxes = [i["position"] for i in dashboard["pages"][0]["layout"]]
    for n, a in enumerate(boxes):
        for b in boxes[n + 1:]:
            apart = (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
                     or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])
            assert apart, (a, b)


def test_a_widget_below_a_dropped_one_rises_into_the_gap(agent_ns):
    dash = _dash(_w("top", "A", 0, 0, 6), _w("mid", "B", 0, 4, 6), _w("low", "C", 0, 8, 6))
    assert agent_ns["implement_dashboard_drop_dataset"](dash, "B")
    assert _pos(dash) == {"top": (0, 0), "low": (0, 4)}
    _no_overlap(dash)


def test_a_dropped_left_widget_leaves_the_right_one_in_place_and_lifts_only_what_has_room(agent_ns):
    dash = _dash(_w("left", "B", 0, 0), _w("right", "A", 3, 0), _w("below_left", "C", 0, 4), _w("below_right", "C", 3, 4))
    agent_ns["implement_dashboard_drop_dataset"](dash, "B")
    pos = _pos(dash)
    assert pos["right"] == (3, 0)
    assert pos["below_left"] == (0, 0)
    assert pos["below_right"] == (3, 4)
    _no_overlap(dash)


def test_nothing_moves_when_nothing_is_dropped(agent_ns):
    dash = _dash(_w("top", "A", 0, 0, 6), _w("gap", "A", 0, 9, 6))
    before = json.dumps(copy.deepcopy(dash), sort_keys=True)
    assert agent_ns["implement_dashboard_drop_dataset"](dash, "unread") == []
    assert json.dumps(dash, sort_keys=True) == before
    assert agent_ns["implement_dashboard_drop_dataset"](dash, "") == []
    assert json.dumps(dash, sort_keys=True) == before


def test_a_filter_that_only_loses_one_query_keeps_its_position(agent_ns):
    filt = _w("flt", "A", 0, 0, 6, 2, "filter-multi-select")
    filt["widget"]["queries"].append({"name": "q_flt_b", "query": {"datasetName": "B"}})
    dash = _dash(filt, _w("mid", "B", 0, 2, 6), _w("low", "C", 0, 6, 6))
    agent_ns["implement_dashboard_drop_dataset"](dash, "B")
    assert _pos(dash) == {"flt": (0, 0), "low": (0, 2)}
    assert len(filt["widget"]["queries"]) == 1
