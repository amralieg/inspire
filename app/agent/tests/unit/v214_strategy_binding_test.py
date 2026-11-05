"""v2.1.4 the customer's sponsors and KPIs bind every aligned use case. A roster sponsor who does not own the strategy
entry the use case serves, and does not report up to its owner, is moved to the owner. A use case aligned to an entry
whose customer KPI it does not carry gets that KPI (from the entry or its nearest ancestor) as a customer KPI it moves;
a use case with no customer KPI that cannot be bound is listed in the coverage report and the log."""
import json
import logging

from v130_strategy_alignment_test import TREE, answer, harness, uc
from v211_strategy_directives_test import FOUR_LEVELS

PROPOSED_ONLY = [{"name": "Buying customers", "kpi_id": None, "direction": "increase", "aggregation": "COUNT_DISTINCT",
                  "table": "c.s.orders", "column": "customer_id"}]


def tree_with(agent_ns, raw, **changes):
    return agent_ns["parse_strategic_context"](json.dumps(dict(raw, **changes)))


def test_a_roster_sponsor_who_does_not_own_the_aligned_entry_moves_to_its_owner(agent_ns):
    answers = {"U1": answer("U1"), "U2": answer("U2", alignments=[])}
    obj = harness(agent_ns, answers=answers)
    ucs = [uc("U1", Sponsor="Head of Supply"), uc("U2", Sponsor="Head of Supply")]
    obj._run_strategy_alignment(ucs)
    assert ucs[0]["Sponsor"] == "Chief Customer Officer", "the Customer entry is owned by the Chief Customer Officer"
    assert ucs[1]["Sponsor"] == "Head of Supply", "an unaligned use case keeps its roster sponsor (must-exclude)"


def test_a_sponsor_who_reports_up_to_the_owner_is_kept(agent_ns):
    sponsors = TREE["sponsors"] + [{"role": "Head of Loyalty", "reports_to": "Chief Customer Officer"},
                                   {"role": "Loyalty Analyst Lead", "reports_to": "Head of Loyalty"},
                                   {"role": "Loop A", "reports_to": "Loop B"}, {"role": "Loop B", "reports_to": "Loop A"}]
    tree = tree_with(agent_ns, TREE, sponsors=sponsors)
    answers = {u: answer(u) for u in ("U1", "U2", "U3")}
    obj = harness(agent_ns, answers=answers, tree=tree)
    ucs = [uc("U1", Sponsor="Head of Loyalty"), uc("U2", Sponsor="Loyalty Analyst Lead"), uc("U3", Sponsor="Loop A")]
    obj._run_strategy_alignment(ucs)
    assert [u["Sponsor"] for u in ucs] == ["Head of Loyalty", "Loyalty Analyst Lead", "Chief Customer Officer"]


def test_the_sponsor_log_counts_the_moves(agent_ns, caplog):
    obj = harness(agent_ns, answers={"U1": answer("U1")})
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment([uc("U1", Sponsor="Head of Supply")])
    assert "[SPONSOR_ROSTER FIRED]" in caplog.text and "'owner': 1" in caplog.text


def test_an_aligned_use_case_without_the_entry_kpi_gets_it(agent_ns):
    answers = {"U1": answer("U1"), "U2": answer("U2", kpis=PROPOSED_ONLY)}
    obj = harness(agent_ns, answers=answers)
    ucs = [uc("U1"), uc("U2")]
    obj._run_strategy_alignment(ucs)
    assert [k.get("kpi_id") for k in ucs[0]["KPIs"]] == ["K1"], "a use case that carries the KPI is left as it is"
    names = [(k["name"], k.get("kpi_id"), k.get("source")) for k in ucs[1]["KPIs"]]
    assert names == [("Buying customers", None, "proposed"), ("Repeat purchase rate", "K1", "strategy")]
    bound = ucs[1]["KPIs"][1]
    assert bound["computable"] is False and bound["query"] is None and bound["baseline"] is None
    assert (bound["direction"], bound["unit"]) == ("increase", "%")
    assert obj.strategy_coverage["kpi_binding"] == {"linked": ["U1"], "bound": ["U2"], "unlinked": []}


def test_the_nearest_ancestor_kpi_binds_a_lower_level_alignment(agent_ns):
    tree = tree_with(agent_ns, FOUR_LEVELS)
    answers = {"U1": answer("U1", alignments=[{"id": "S1.1.1.1", "evidence": "Repeat orders per `customer_id`"}],
                            kpis=PROPOSED_ONLY)}
    obj = harness(agent_ns, answers=answers, tree=tree)
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    assert [(k["name"], k.get("source")) for k in ucs[0]["KPIs"]][-1] == ("Repeat purchase rate", "strategy")


def test_a_use_case_with_no_customer_kpi_to_bind_is_flagged_not_bound(agent_ns, caplog):
    answers = {"U1": answer("U1"), "U2": answer("U2", alignments=[], kpis=PROPOSED_ONLY),
               "U3": answer("U3", alignments=[{"id": "S1", "evidence": "Repeat orders per `customer_id`"}], kpis=PROPOSED_ONLY)}
    obj = harness(agent_ns, answers=answers)
    ucs = [uc("U1"), uc("U2"), uc("U3")]
    with caplog.at_level(logging.INFO):
        obj._run_strategy_alignment(ucs)
    assert [k.get("source") for k in ucs[1]["KPIs"]] == ["proposed"], "an unaligned use case is never bound (must-exclude)"
    assert [k.get("source") for k in ucs[2]["KPIs"]] == ["proposed"], "a KPI below the aligned entry is not taken (must-exclude)"
    assert obj.strategy_coverage["kpi_binding"]["unlinked"] == ["U2", "U3"]
    assert "[STRATEGY-KPI-BIND FIRED]" in caplog.text and "U2" in caplog.text


def test_without_customer_kpis_nothing_is_bound_or_reported(agent_ns):
    builtin = agent_ns["build_builtin_strategy"]("Increase Revenue")
    obj = harness(agent_ns, answers={"U1": answer("U1", alignments=[{"id": "S1", "evidence": "`amount` per order"}])},
                  tree=builtin)
    ucs = [uc("U1")]
    obj._run_strategy_alignment(ucs)
    assert all("source" not in k for k in ucs[0]["KPIs"])
    assert "kpi_binding" not in obj.strategy_coverage
