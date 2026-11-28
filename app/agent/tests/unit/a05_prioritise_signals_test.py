"""REQ-573 R10.7 (lane a04_prioritise review, inspire agent 05): the scheduling priority and the exploration strata must read signals the
run produces. Nothing in the pipeline sets uc["measured_exposure"] or uc["value_mechanism"] before scheduling, so in a real run the
exposure part (weight 0.3) was always 0 and every stratum had an empty mechanism. Contract:
- exposure: uc["measured_exposure"] when set, else the absolute measured amount of the use case's own loss pool (signals["pools"][loss_pool_id]
  ["amount"], code-run SQL); an unknown amount (None) adds 0.
- mechanism of the stratum: uc["value_mechanism"] when set, else from the use case's first KPI with a direction: "cost" when it should fall,
  "revenue" when it should rise; no KPI direction -> "".
"""
from a04_prioritise_test import _fn


def _uc(no, pool_id=None, kpis=None, **extra):
    uc = {"No": no, "Name": f"Plan {no}", "Statement": f"Decide {no}", "Tables Involved": "c.s.alpha", "use_case_kind": "forecast"}
    if pool_id:
        uc["loss_pool_id"] = pool_id
    if kpis is not None:
        uc["KPIs"] = kpis
    uc.update(extra)
    return uc


def _signals(amount):
    return {"pools": {"lp1": {"pool_id": "lp1", "share": 0.3, "unit": "money", "currency": "USD", "amount": amount}}, "table_ready": {}}


def test_1_exposure_comes_from_the_use_cases_own_loss_pool_amount_when_not_set(agent_ns):
    prio = _fn(agent_ns, "inspire_priority")
    uc = _uc("U1", pool_id="lp1")
    assert "measured_exposure" not in uc
    measured = prio(uc, _signals(2_500_000.0))
    assert measured["parts"]["exposure"] > 0, "a measured pool amount must count as the measured exposure"
    assert prio(uc, _signals(-2_500_000.0))["parts"]["exposure"] == measured["parts"]["exposure"], "a loss stored negative counts by its size"
    # must-keep: an unknown amount adds 0; an explicit measured_exposure still wins
    assert prio(uc, _signals(None))["parts"]["exposure"] == 0.0
    assert prio(_uc("U2"), _signals(2_500_000.0))["parts"]["exposure"] == 0.0, "another use case's pool is never read"
    explicit = prio(dict(uc, measured_exposure=10.0), _signals(2_500_000.0))["parts"]["exposure"]
    assert 0 < explicit < measured["parts"]["exposure"]


def test_2_the_stratum_mechanism_comes_from_the_kpi_direction_when_not_set(agent_ns):
    stratum = _fn(agent_ns, "inspire_schedule_stratum")
    down = stratum(_uc("U1", kpis=[{"name": "Lost amount", "direction": "decrease"}]))
    up = stratum(_uc("U2", kpis=[{"name": "Sold amount", "direction": "increase"}]))
    assert down.split("|")[1] == "cost" and up.split("|")[1] == "revenue", (down, up)
    # must-keep: an explicit value_mechanism wins; no KPI direction -> empty
    assert stratum(_uc("U3", kpis=[{"direction": "decrease"}], value_mechanism="risk")).split("|")[1] == "risk"
    assert stratum(_uc("U4", kpis=[{"name": "Count"}])).split("|")[1] == ""
    assert stratum(_uc("U5")).split("|")[1] == ""
