"""Phase L check L3 failed on healthy T1 and T2 portfolios (101 use cases in 21 subdomains, a bar of 101 // 3 = 33): it asked
for about one subdomain per 3 use cases while the subdomain prompt asks for few subdomains of 4 to 5 use cases and the
subdomain validator requires at least 2 subdomains only in a domain of more than 4 use cases. L3 now applies that same
per-domain minimum."""
import v120_gate_recalibration_test as recal
from _agentload import agent_source


class Actions:
    def __init__(self):
        self.added = []

    def add(self, **kw):
        self.added.append(kw)


def _portfolio(layout):
    base = recal.TestPhaseL()._final(recal.strong_corpus()[:1])[0]
    rows, k = [], 0
    for domain, subdomains in layout.items():
        for subdomain, count in subdomains.items():
            for _ in range(count):
                k += 1
                rows.append({**base, "No": f"N01-U{k:03d}", "Name": f"Use case {k} for {domain}",
                             "Business Domain": domain, "Subdomain": subdomain})
    return rows


def _l3(ns, monkeypatch, rows):
    actions = Actions()
    monkeypatch.setitem(ns, "NEXT_ACTIONS", actions)
    result = recal.make(ns)._phaseL_final_gate(rows, recal.SCHEMA)["L3_subdomain_diversity"]
    return result, [a["evidence"] for a in actions.added if a["rule_id"] == "L_L3_subdomain_diversity"]


def test_a_portfolio_of_few_large_subdomains_passes(agent_ns, monkeypatch):
    layout = {f"Domain {d}": {f"Area {d}{s}": 5 for s in range(5)} for d in range(4)}
    layout["Domain 0"]["Area 0x"] = 1
    rows = _portfolio(layout)
    assert len(rows) == 101 and len({r["Subdomain"] for r in rows}) == 21
    result, evidence = _l3(agent_ns, monkeypatch, rows)
    assert result["pass"] is True and evidence == [], (result, evidence)


def test_a_large_domain_with_one_subdomain_fails_and_is_named(agent_ns, monkeypatch):
    rows = _portfolio({"Cards": {"Card Fraud": 12}, "Lending": {"Loan Risk": 3, "Loan Growth": 3}, "Branches": {"Branch Ops": 4}})
    result, evidence = _l3(agent_ns, monkeypatch, rows)
    assert result["pass"] is False
    assert evidence == ["4 distinct subdomains; domains under the subdomain minimum: ['Cards']"]


def test_the_subdomain_validator_and_l3_share_one_minimum(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    assert [cls._min_subdomains(n) for n in (1, 4, 5, 40)] == [1, 1, 2, 2]
    source = agent_source()
    assert "min_subdomains = self._min_subdomains(total_ucs_in_domain)" in source
    assert "1 if total_ucs_in_domain <= 4 else 2" not in source
