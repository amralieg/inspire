"""REQ-573 R9.5 (lane a05_scan_deep review, inspire agent 05): in skip mode (skip_domain_step) the whole scope is deepened and the
person's domain choices are ignored. A choice given in skip mode must not break the ranking: every domain appears exactly once,
all are deepened, none is excluded, and the ranking is returned (not raised and lost to the caller's warning)."""
from a05_scan_deep_test import _ladder, _rank_fn, _td


def test_1_skip_mode_with_an_exclude_choice_deepens_every_domain_once(agent_ns):
    choices = {"pin": ["D3"], "exclude": ["D2"], "launch": ["D2"]}
    result = _rank_fn(agent_ns)(_td(3, skip=True), _ladder(3), choices, "ok")
    ids = [d["id"] for d in result["domains"]]
    assert sorted(ids) == ["D1", "D2", "D3"], ids
    assert sorted(result["deepened"]) == ["D1", "D2", "D3"]
    assert result["excluded"] == [] and result["suggested"] == [] and result["pinned"] == []
    assert all(d["status"] == "deepened" for d in result["domains"])
    assert all("_pools" not in d for d in result["domains"])
