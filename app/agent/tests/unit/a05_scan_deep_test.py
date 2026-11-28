"""REQ-573 R9.1-R9.5 (lane a05_scan_deep): SCAN ranks the table domains by measured, fixable losses and picks what DEEP reads.

- R9.2 inspire_domain_ranking(table_domains, pools, choices, loss_status) ranks the domains of inspire_table_domains by the loss
  pools of DeepEvidence.measure_loss_pools (cancelled, returned, refunded, late, discounted, written-off, penalty amounts). A pool
  counts once, in the domain that is its table's home; turnover (the pool's money column total) is context only.
- R9.3 a missing measure is unknown (score None, high uncertainty), never 0; flows are never added (the score is the largest
  single flow) and currencies are never added (the score is in the scope's ranking currency, other currencies are context).
- R9.4 one domain is auto-deepened, up to 5 more are suggested, plus the cross-domain challenger pairs that touch them; every
  domain carries a rank reason and an uncertainty; the person's pins, excludes and launches (runtime domain_choices or
  "- DOMAIN PIN/EXCLUDE/LAUNCH: " lines in the generation instructions) win over the ranking.
- R9.5 when inspire_table_domains sets skip_domain_step (one coherent group), the whole scope is deepened, nothing is suggested.
- Artifact: DatabricksInspire._rank_domains stores self.domain_ranking after the loss pools are collected; results_json carries
  it under "domain_ranking" (the key the App's domain step reads).

All tables and values are synthetic and generic (c.s.t*, c.s.a_*, c.s.b_*). The pure functions get hand-built inputs in the
contract shapes of briefs a04_domain_graph and a04_loss_pools, plus one run over the real inspire_table_domains output."""
import random
import re

import pytest

from _nbload import AGENT_NB, code_cells
from a04_domain_graph_test import HUB, _home, _scope
from v120_artifacts_support import make_inspire

LOW, MEDIUM, HIGH = "low", "medium", "high"


def _rank_fn(ns):
    fn = ns.get("inspire_domain_ranking")
    assert callable(fn), "R9.2: the notebook defines no inspire_domain_ranking(table_domains, pools, choices, loss_status)"
    return fn


def _choices_fn(ns):
    fn = ns.get("inspire_domain_choices")
    assert callable(fn), "R9.4: the notebook defines no inspire_domain_choices(generation_instructions, runtime_choices)"
    return fn


def _td(n, pairs=(), skip=False):
    """n domains D1..Dn, each with one transactional home table c.s.t<i> and one master c.s.m<i>."""
    domains = [{"id": f"D{i}", "tables": [f"c.s.m{i}", f"c.s.t{i}"], "home": [f"c.s.m{i}", f"c.s.t{i}"],
                "primaries": [f"c.s.t{i}"]} for i in range(1, n + 1)]
    memberships = {}
    for d in domains:
        memberships[f"c.s.t{d['id'][1:]}"] = [{"domain": d["id"], "role": "primary"}]
        memberships[f"c.s.m{d['id'][1:]}"] = [{"domain": d["id"], "role": "member"}]
    return {"domains": domains, "memberships": memberships, "hubs": [], "bridges": [],
            "challenger_pairs": [{"domains": list(p[0]), "via": list(p[1])} for p in pairs], "unattached": [], "edges": [],
            "skip_domain_step": skip if skip else n <= 1}


_IDS = iter(range(10 ** 6))


def _pool(table, amount, kind="cancelled", flow="order", currency="EUR", unit="money", share=None, source="status_split",
          money_column="amount", flags=()):
    return {"pool_id": f"lp{next(_IDS)}", "table": table, "money_column": money_column,
            "split_column": "status" if source == "status_split" else None, "split_values": [kind] if source == "status_split" else [],
            "loss_kind": kind, "source": source, "flow": flow, "currency": currency, "unit": unit, "amount": amount,
            "rows": 10, "measured_rows": 0 if amount is None else 10, "share": share, "material": None if amount is None else True,
            "flags": list(flags)}


def _ladder(n=8):
    """Domain Di loses (n + 1 - i) * 100 EUR on cancelled orders: D1 the most, Dn the least, no close calls."""
    return [_pool(f"c.s.t{i}", float((n + 1 - i) * 100)) for i in range(1, n + 1)]


def _by_id(result):
    return {d["id"]: d for d in result["domains"]}


# --- R9.2: rank by measured fixable losses, turnover is context only ---

def test_1_domains_rank_by_measured_fixable_loss_and_turnover_is_context_only(agent_ns):
    pools = [_pool("c.s.t1", 100.0, share=0.001),  # turnover 100,000, loss 100
             _pool("c.s.t2", 500.0, share=0.25)]   # turnover 2,000, loss 500
    result = _rank_fn(agent_ns)(_td(2), pools)
    rows = _by_id(result)
    assert [d["id"] for d in result["domains"]][:2] == ["D2", "D1"], "R9.2: the larger measured loss ranks first, never turnover"
    assert rows["D2"]["score"] == pytest.approx(500.0) and rows["D1"]["score"] == pytest.approx(100.0)
    assert rows["D1"]["loss_rank"] == 2 and rows["D2"]["loss_rank"] == 1
    turnover = {(r["flow"], r["currency"]): r["amount"] for r in rows["D1"]["turnover"]}
    assert turnover[("order", "EUR")] == pytest.approx(100000.0), "turnover is reported per domain as context"


def test_2_a_missing_measure_is_unknown_never_zero(agent_ns):
    pools = [_pool("c.s.t1", 300.0), _pool("c.s.t2", None), _pool("c.s.t2", None, kind="returned")]
    result = _rank_fn(agent_ns)(_td(3), pools)
    rows = _by_id(result)
    assert rows["D2"]["score"] is None, "R9.3: a domain whose loss pools are all unmeasured has an unknown score, never 0"
    assert rows["D2"]["uncertainty"] == HIGH and "unknown_pools" in rows["D2"]["uncertainty_reasons"]
    assert rows["D3"]["score"] is None and "no_loss_pool" in rows["D3"]["uncertainty_reasons"]
    assert [d["id"] for d in result["domains"]] == ["D1", "D2", "D3"], \
        "measured first, then domains with unmeasured pools, then domains with no pool found"
    assert all(d["score"] != 0 for d in result["domains"]), "no unknown is ever written as 0"


def test_3_order_invoice_and_payment_flows_are_never_added(agent_ns):
    pools = [_pool("c.s.t1", 300.0, flow="order"), _pool("c.s.t1", 250.0, kind="refunded", flow="payment"),
             _pool("c.s.t2", 400.0, flow="invoice")]
    result = _rank_fn(agent_ns)(_td(2), pools)
    rows = _by_id(result)
    assert rows["D1"]["score"] == pytest.approx(300.0) and rows["D1"]["flow"] == "order", \
        "R9.3: the score is the largest single flow, never order + payment (550)"
    assert [d["id"] for d in result["domains"]] == ["D2", "D1"]
    flows = sorted((r["flow"], r["amount"]) for r in rows["D1"]["loss_totals"] if r["unit"] == "money")
    assert flows == [("order", 300.0), ("payment", 250.0)], "loss totals stay one row per flow"


def test_4_currencies_are_never_added_without_conversion(agent_ns):
    pools = [_pool("c.s.t1", 200.0, currency="EUR"), _pool("c.s.t1", 900.0, currency="USD"),
             _pool("c.s.t2", 300.0, currency="EUR"), _pool("c.s.t3", 250.0, currency="EUR"),
             _pool("c.s.t4", 5000.0, currency="JPY")]
    result = _rank_fn(agent_ns)(_td(4), pools)
    rows = _by_id(result)
    assert result["ranking_currency"] == "EUR", "the ranking currency is the one most measured pools are in"
    assert rows["D1"]["score"] == pytest.approx(200.0) and rows["D1"]["currency"] == "EUR", \
        "R9.3: 200 EUR and 900 USD are never one number"
    assert "other_currency" in rows["D1"]["uncertainty_reasons"] and rows["D1"]["uncertainty"] == MEDIUM
    assert rows["D4"]["score"] is None and rows["D4"]["uncertainty"] == HIGH and "other_currency" in rows["D4"]["uncertainty_reasons"], \
        "a domain measured only in another currency cannot be compared without conversion: unknown"
    assert [d["id"] for d in result["domains"]] == ["D2", "D3", "D1", "D4"]


def test_5_quantity_only_losses_give_no_money_score(agent_ns):
    pools = [_pool("c.s.t1", 120.0), _pool("c.s.t2", 40.0, kind="scrap", unit="quantity", source="loss_column")]
    rows = _by_id(_rank_fn(agent_ns)(_td(2), pools))
    assert rows["D2"]["score"] is None and "quantity_only" in rows["D2"]["uncertainty_reasons"]
    assert any(r["unit"] == "quantity" and r["amount"] == pytest.approx(40.0) for r in rows["D2"]["loss_totals"])


def test_6_a_pool_counts_once_in_its_home_domain_never_in_context_or_hub(agent_ns):
    td = _td(2)
    td["domains"][1]["tables"].append("c.s.t1")  # c.s.t1 is context in D2
    td["memberships"]["c.s.t1"].append({"domain": "D2", "role": "context"})
    td["domains"][0]["tables"].append("c.s.h")
    td["domains"][1]["tables"].append("c.s.h")
    td["memberships"]["c.s.h"] = [{"domain": "D1", "role": "hub"}, {"domain": "D2", "role": "hub"}]
    td["hubs"] = [{"table": "c.s.h", "share": 0.9, "domains": ["D1", "D2"]}]
    hub_pool = _pool("c.s.h", 999.0)
    pools = [_pool("`C`.`S`.`T1`", 300.0), _pool("c.s.t2", 100.0), hub_pool]
    result = _rank_fn(agent_ns)(td, pools)
    rows = _by_id(result)
    assert rows["D1"]["score"] == pytest.approx(300.0), "the pool table name is matched case- and backtick-insensitively"
    assert rows["D2"]["score"] == pytest.approx(100.0), "a context membership never counts the table's losses again"
    assert result["unattributed_pools"] == [hub_pool["pool_id"]], "a pool on a hub has no home domain and is listed, never dropped"


# --- R9.4: auto-deepen 1, suggest 3-5, why and how uncertain ---

def test_7_one_domain_is_auto_deepened_and_the_next_five_are_suggested(agent_ns):
    result = _rank_fn(agent_ns)(_td(8), _ladder())
    rows = _by_id(result)
    assert result["deepened"] == ["D1"], "R9.4: exactly one domain is auto-deepened, the top-ranked"
    assert result["suggested"] == ["D2", "D3", "D4", "D5", "D6"], "R9.4: the next five are suggested in rank order"
    assert [rows[d]["status"] for d in ("D1", "D2", "D7", "D8")] == ["deepened", "suggested", "ranked", "ranked"]
    assert [rows[f"D{i}"]["rank"] for i in range(1, 9)] == list(range(1, 9))
    assert result["skip_domain_step"] is False and result["loss_pool_status"] == "ok"


def test_8_fewer_domains_give_fewer_suggestions(agent_ns):
    result = _rank_fn(agent_ns)(_td(3), _ladder(3))
    assert result["deepened"] == ["D1"] and result["suggested"] == ["D2", "D3"]


def test_9_every_domain_says_why_it_ranked_there_and_how_uncertain(agent_ns):
    pools = [_pool("c.s.t1", 400.0), _pool("c.s.t1", 100.0, kind="refunded"), _pool("c.s.t2", 50.0)]
    result = _rank_fn(agent_ns)(_td(3), pools)
    for d in result["domains"]:
        assert isinstance(d["reason"], str) and d["reason"].strip(), f"{d['id']} has no rank reason"
        assert d["uncertainty"] in (LOW, MEDIUM, HIGH) and isinstance(d["uncertainty_reasons"], list)
    top = _by_id(result)["D1"]
    assert top["why"] == {"flow": "order", "currency": "EUR", "amount": pytest.approx(500.0),
                          "kinds": {"cancelled": pytest.approx(400.0), "refunded": pytest.approx(100.0)},
                          "pools": 2, "unknown_pools": 0}, top["why"]
    assert "EUR" in top["reason"] and "cancelled" in top["reason"], top["reason"]
    assert top["uncertainty"] == LOW and top["uncertainty_reasons"] == []
    assert _by_id(result)["D3"]["why"] is None


def test_10_a_close_call_is_medium_uncertainty(agent_ns):
    rows = _by_id(_rank_fn(agent_ns)(_td(3), [_pool("c.s.t1", 100.0), _pool("c.s.t2", 95.0), _pool("c.s.t3", 40.0)]))
    assert "close_call" in rows["D1"]["uncertainty_reasons"] and "close_call" in rows["D2"]["uncertainty_reasons"], \
        "scores within 10% of each other are a close call"
    assert rows["D1"]["uncertainty"] == MEDIUM and rows["D3"]["uncertainty"] == LOW


def test_11_partly_missing_measures_raise_the_uncertainty(agent_ns):
    rows = _by_id(_rank_fn(agent_ns)(_td(2), [_pool("c.s.t1", 500.0, flags=["measure_partly_missing"]),
                                               _pool("c.s.t2", 100.0), _pool("c.s.t2", None, kind="late")]))
    assert "partly_missing" in rows["D1"]["uncertainty_reasons"] and rows["D1"]["uncertainty"] == MEDIUM
    assert rows["D2"]["score"] == pytest.approx(100.0) and "unknown_pools" in rows["D2"]["uncertainty_reasons"]
    assert rows["D2"]["why"]["unknown_pools"] == 1


def test_12_cross_domain_pairs_touching_the_picked_domains_are_suggested(agent_ns):
    td = _td(9, pairs=[(("D7", "D8"), ["c.s.y"]), (("D1", "D2"), ["c.s.h"]), (("D3", "D7"), ["c.s.x"]),
                       (("D2", "D4"), ["c.s.z"]), (("D8", "D9"), ["c.s.w"])])
    result = _rank_fn(agent_ns)(td, _ladder(9), {"exclude": ["D4"]})
    assert result["suggested"] == ["D2", "D3", "D5", "D6", "D7"]
    pairs = [tuple(p["domains"]) for p in result["pairs"]]
    assert pairs == [("D1", "D2"), ("D3", "D7"), ("D7", "D8")], \
        "R9.4: pairs that touch a deepened or suggested domain, in rank order; none with an excluded domain or only unpicked ones"
    assert result["pairs"][0]["via"] == ["c.s.h"] and result["pairs"][0]["reason"].strip()


# --- R9.4: the person's choices win ---

def test_13_exclude_and_pin_win_over_the_ranking(agent_ns):
    result = _rank_fn(agent_ns)(_td(8), _ladder(), {"pin": ["D7"], "exclude": ["D1"]})
    rows = _by_id(result)
    assert result["deepened"] == ["D2"], "an excluded domain is never deepened, the next one is"
    assert result["suggested"] == ["D7", "D3", "D4", "D5", "D6", "D8"], \
        "a pinned domain is always suggested, first, on top of the five"
    assert result["excluded"] == ["D1"] and result["pinned"] == ["D7"]
    assert rows["D1"]["status"] == "excluded" and rows["D1"]["rank"] is None and rows["D1"]["loss_rank"] == 1
    assert rows["D7"]["pinned"] is True and "pin" in rows["D7"]["reason"].lower()
    assert [d["id"] for d in result["domains"]][-1] == "D1", "excluded domains are listed last, never dropped"


def test_14_launch_replaces_the_auto_deepened_domain(agent_ns):
    result = _rank_fn(agent_ns)(_td(8), _ladder(), {"launch": ["D5", "D4"]})
    assert result["deepened"] == ["D5", "D4"], "the person's launches are deepened, in their order"
    assert result["suggested"] == ["D1", "D2", "D3", "D6", "D7"]


def test_15_choices_match_ids_or_home_tables_and_unmatched_or_conflicting_ones_are_listed(agent_ns):
    choices = {"pin": ["C.S.T3", "c.s.nothing"], "exclude": ["d2"], "launch": ["c.s.m2"]}
    result = _rank_fn(agent_ns)(_td(4), _ladder(4), choices)
    assert result["pinned"] == ["D3"], "a home table names its domain, case-insensitively"
    assert result["excluded"] == ["D2"] and "D2" not in result["deepened"], "exclude wins over launch for the same domain"
    assert result["choices"]["unmatched"] == ["c.s.nothing"]
    assert result["choices"]["conflicts"] == ["D2"]
    assert result["deepened"] == ["D1"]


# --- R9.5 and degraded inputs ---

def test_16_one_coherent_group_skips_the_domain_step(agent_ns):
    one = _rank_fn(agent_ns)(_td(1), [_pool("c.s.t1", 10.0)])
    assert one["skip_domain_step"] is True and one["whole_scope"] is True
    assert one["deepened"] == ["D1"] and one["suggested"] == [] and one["pairs"] == []
    none = _rank_fn(agent_ns)({**_td(0), "unattached": ["c.s.a", "c.s.b"], "skip_domain_step": True}, [])
    assert none["skip_domain_step"] is True and none["whole_scope"] is True and none["deepened"] == [] and none["domains"] == []


def test_17_pools_not_collected_leave_every_score_unknown(agent_ns):
    result = _rank_fn(agent_ns)(_td(4), [], loss_status="pending")
    assert result["loss_pool_status"] == "pending"
    assert all(d["score"] is None and d["uncertainty"] == HIGH and "loss_pools_pending" in d["uncertainty_reasons"]
               for d in result["domains"]), "R9.3: pools that are not in yet are unknown, never an empty (zero) answer"
    assert [d["id"] for d in result["domains"]] == ["D1", "D2", "D3", "D4"] and result["deepened"] == ["D1"]


def test_18_the_ranking_is_deterministic_under_input_order(agent_ns):
    pools = _ladder() + [_pool("c.s.t3", None, kind="late"), _pool("c.s.t5", 30.0, flow="payment", currency="USD")]
    td = _td(8, pairs=[(("D1", "D2"), ["c.s.h"])])
    first = _rank_fn(agent_ns)(td, pools, {"pin": ["D8"]})
    shuffled = list(pools)
    random.Random(7).shuffle(shuffled)
    assert _rank_fn(agent_ns)(td, shuffled, {"pin": ["D8"]}) == first


def test_19_ranks_the_real_domain_graph_output(agent_ns):
    tables, edges, categories = _scope()
    graph = agent_ns["inspire_table_domains"](tables, edges, categories)
    a, b = _home(graph, "c.s.a_txn"), _home(graph, "c.s.b_txn")
    hub_pool = _pool(HUB, 50.0)
    result = _rank_fn(agent_ns)(graph, [_pool("c.s.a_txn", 100.0), _pool("c.s.b_txn", 900.0, kind="returned"), hub_pool])
    assert result["deepened"] == [b] and result["suggested"] == [a]
    assert any(set(p["domains"]) == {a, b} and HUB in p["via"] for p in result["pairs"])
    assert result["unattributed_pools"] == [hub_pool["pool_id"]]


# --- the person's input reaches the ranking ---

def test_20_runtime_domain_choices_default_and_validation(agent_ns, monkeypatch):
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert rt.get("domain_choices") == {"pin": [], "exclude": [], "launch": []}, \
        "R9.4: TECHNICAL_CONTEXT runtime has no domain_choices default"
    for bad in ({"pin": "D1"}, {"promote": ["D1"]}, ["D1"]):
        monkeypatch.setitem(rt, "domain_choices", bad)
        with pytest.raises((TypeError, ValueError)) as err:
            agent_ns["_validate_runtime_config"]()
        assert "domain_choices" in str(err.value)
    monkeypatch.setitem(rt, "domain_choices", {"pin": ["D1"], "launch": []})
    agent_ns["_validate_runtime_config"]()


def test_21_generation_instruction_lines_and_runtime_choices_merge_and_never_reach_a_prompt(agent_ns):
    text = "Focus on margins.\n- DOMAIN PIN: D2, c.s.t7\n- DOMAIN EXCLUDE: D3\n- DOMAIN PIN: D2\n- DOMAIN LAUNCH:  \n"
    merged = _choices_fn(agent_ns)(text, {"pin": ["D9"], "exclude": [], "launch": ["D4"]})
    assert merged == {"pin": ["D9", "D2", "c.s.t7"], "exclude": ["D3"], "launch": ["D4"]}, merged
    assert _choices_fn(agent_ns)("", None) == {"pin": [], "exclude": [], "launch": []}
    assert agent_ns["without_table_scope_directives"](text).strip() == "Focus on margins.", \
        "the domain choice lines are directives, never prompt text"


def test_22_the_run_reads_the_choices_from_the_raw_generation_instructions():
    source = "\n".join(code_cells(AGENT_NB))
    assert re.search(r"self\.domain_choices\s*=\s*inspire_domain_choices\(\s*generation_instructions_raw", source), \
        "R9.4: __init__ never parses the domain choices from the generation instructions before the directive lines are stripped"


# --- the artifact ---

def test_23_rank_domains_stores_the_artifact_logs_and_never_raises(agent_ns, capsys):
    obj = make_inspire(agent_ns)
    obj.table_domains = _td(3)
    obj.loss_pools = _ladder(3)
    obj.domain_choices = {"pin": [], "exclude": ["D1"], "launch": []}
    assert callable(getattr(obj, "_rank_domains", None)), "DatabricksInspire has no _rank_domains(loss_status)"
    ranking = obj._rank_domains("ok")
    assert ranking is obj.domain_ranking and ranking["deepened"] == ["D2"] and ranking["excluded"] == ["D1"]
    logs = " ".join(m for _l, m in obj.logger.records) + capsys.readouterr().out
    assert "[DOMAIN-RANK FIRED]" in logs
    bare = make_inspire(agent_ns)
    assert bare._rank_domains("off") is None and bare.domain_ranking is None, "no domain graph: no ranking, no raise"
    broken = make_inspire(agent_ns)
    broken.table_domains, broken.loss_pools = {"domains": "not a list"}, None
    assert broken._rank_domains("ok") is None and broken.domain_ranking is None


def test_24_results_json_carries_the_domain_ranking(agent_ns):
    obj = make_inspire(agent_ns, discovery_type="Deep", deep_evidence=None)
    obj.domain_ranking = None
    assert "domain_ranking" not in obj._v130_results_keys()
    obj.domain_ranking = {"deepened": ["D1"], "suggested": [], "domains": []}
    assert obj._v130_results_keys()["domain_ranking"] == obj.domain_ranking, \
        "the App's domain step reads results_json.domain_ranking"


def test_25_the_run_ranks_after_the_pools_are_collected_and_before_the_ledger_proposes():
    source = "\n".join(code_cells(AGENT_NB))
    body = next(chunk for chunk in source.split("\n    def run(self):")[1:] if "PASS 1: Generating initial use cases" in chunk)
    body = body.split("\n    def ")[0]
    collect, rank = body.find("_loss_pools_collect("), body.find("_rank_domains(")
    propose = body.find('InspireCandidateLedger.at(self, "propose"')
    assert 0 <= collect < rank < propose, "R9.2: the domains are ranked once the loss pools are in, before the ledger proposes"
