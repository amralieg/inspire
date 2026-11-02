"""A samples.wanderbricks Discover run cut the Guest Experience dedup at 390 s while its own LLM call still had time: the
overall budget gave every domain a flat 300 s, whatever the size of its prompt, so the large domain kept all its duplicates.
The budget now gives the largest domain the same per-call budget the scoring stages use for a prompt of that size."""
import re

from v120_elite_dedup_test import inspire, nos, uc


def _portfolio():
    big = [uc(f"G{i:03d}", f"Guest experience idea {i} " + "x" * 60, tables=f"c.s.t{i % 7}", domain="Guest Experience")
           for i in range(260)]
    big = [{**row, "Statement": "A guest who waits for support " + "y" * 150} for row in big]
    small = [uc("B001", "Booking idea", domain="Booking Operations"), uc("B002", "Booking twin", domain="Booking Operations"),
             uc("H001", "Host idea", domain="Host Management"), uc("H002", "Host twin", domain="Host Management")]
    return big + small


def _run(agent_ns, monkeypatch, ucs):
    printed = []
    monkeypatch.setitem(agent_ns, "log_print", lambda message, level="INFO", flush=True: printed.append(str(message)))
    obj = inspire(agent_ns)
    kept = obj._deduplicate_use_cases_by_domain_parallel(ucs)
    timeout = int(re.search(r"Overall timeout: (\d+)s", "\n".join(printed)).group(1))
    return obj, kept, timeout


def test_the_largest_domain_gets_the_per_call_budget_of_its_prompt(agent_ns, monkeypatch):
    ucs = _portfolio()
    obj, kept, timeout = _run(agent_ns, monkeypatch, ucs)
    assert sorted(nos(kept)) == sorted(nos(ucs))
    overhead = obj._prompt_overhead_chars("REVIEW_USE_CASES_PROMPT") + 1000
    big_prompt = overhead + len(obj._build_dedup_markdown([u for u in ucs if u["Business Domain"] == "Guest Experience"]))
    per_call = obj._scoring_task_timeout(300, big_prompt)
    assert big_prompt > 80000 and per_call >= 1300, (big_prompt, per_call)
    assert timeout >= per_call + 120, (timeout, per_call)
    assert timeout > 3 * 300 + 300, "the old flat budget for three domains at any parallelism"


def test_small_domains_get_one_call_budget_and_single_use_case_domains_cost_nothing(agent_ns, monkeypatch):
    ucs = [uc("B001", "Booking idea", domain="Booking"), uc("B002", "Booking twin", domain="Booking"),
           uc("H001", "Host idea", domain="Host")]
    obj, kept, timeout = _run(agent_ns, monkeypatch, ucs)
    assert sorted(nos(kept)) == ["B001", "B002", "H001"]
    assert [call["step"] for call in obj.ai_agent.calls] == ["Deduplicate_Domain_Booking"]
    overhead = obj._prompt_overhead_chars("REVIEW_USE_CASES_PROMPT") + 1000
    per_call = obj._scoring_task_timeout(300, overhead + len(obj._build_dedup_markdown(ucs[:2])))
    assert per_call + 120 <= timeout <= 2 * per_call + 120, (timeout, per_call)
