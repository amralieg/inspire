"""c36_flags (R5.1, P1): every critical-path step the deletion gate may remove can be switched off from TECHNICAL_CONTEXT.runtime.

Harness: the offline DatabricksInspire.run() of tests/scripts/v120_speed_profile.py (built on v120_run_offline_smoke_test._build), with the
real domain clustering restored and the AI agent answered per prompt name, so a test counts the prompts a run sends."""
import collections
import csv
import io
import json
import logging
import os
import pathlib
import random
import re
import sys
import threading

import pytest

UNIT = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(UNIT)
for _p in (UNIT, TESTS, os.path.join(TESTS, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import v120_speed_profile as sp  # noqa: E402
from c35_steplog_test import LedgerSpark  # noqa: E402

BASE_SEQUENCE = pathlib.Path(UNIT) / "c36_flags_base_sequence.json"
DOMAIN_STEPS = ["SUBDOMAIN_DETECTOR", "DOMAINS_MERGER", "SUBDOMAINS_MERGER", "DOMAIN_SPLITTER", "PlaceholderDomainRename",
                "Assign_User_Domains"]
STEP_PROMPT = {"SUBDOMAIN_DETECTOR": "SUBDOMAIN_DETECTOR_PROMPT", "DOMAINS_MERGER": "DOMAINS_MERGER_PROMPT",
               "SUBDOMAINS_MERGER": "SUBDOMAINS_MERGER_PROMPT", "DOMAIN_SPLITTER": "DOMAIN_SPLITTER_PROMPT",
               "PlaceholderDomainRename": "PlaceholderDomainRename", "Assign_User_Domains": "Assign_User_Domains"}
BOOL_FLAGS = {"discover_elite_judge": "ULTRA_HIGH_ELITE_JUDGE_PROMPT", "discover_best_of_best": "BEST_OF_BEST_SCORING_PROMPT",
              "discover_review_dedup": "REVIEW_USE_CASES_PROMPT", "discover_goal_filter_second": "GOAL_ALIGNMENT_FILTER_PROMPT"}
ALL_FLAGS = list(BOOL_FLAGS) + ["discover_domain_steps"]
ID_RE = re.compile(r"^AI\d+-UC\d+$")
GOAL = {"goal_setting": {"has_goal": True, "goal_description": "Cut the cost of late operational decisions"}}
USER_DOMAINS = ["Sales", "Finance"]
N_TABLES = 12


def _csv_ids(text):
    return [r.get("No", "").strip() for r in csv.DictReader(io.StringIO(text or "")) if r.get("No", "").strip()]


def _table_index(uc_tables):
    first = str(uc_tables or "").split(",")[0].strip().split(".")[-1]
    return int(first[1:]) if first[1:].isdigit() else 0


def _wrapped(data):
    return json.dumps({"honesty_score": 90, "honesty_justification": "test", "data": data})


# Primary-table index -> domain: one oversized domain (split), one placeholder (rename), one tiny domain (merge).
def _domain_for(no, tables):
    i = _table_index(tables)
    if i <= 4:
        return "Sales"
    if i <= 6:
        return "Finance"
    if i <= 8:
        return "Logistics"
    if i == 9:
        return "Domain1"
    if i == 11 and int(str(no).rsplit("U", 1)[-1] or 0) % 3 == 0:
        return "Tiny"
    return "Workforce"


class Recorder:
    """The run's AI agent answers by prompt name; `calls` lists every prompt name in the order it was answered."""

    def __init__(self, ns, agent, by_no):
        self.ns, self.agent, self.by_no = ns, agent, by_no
        self.calls = []
        self.goal_stage = None
        self.second_goal_calls = 0
        self._lock = threading.Lock()
        self._real_run_worker = agent.run_worker

    def _note(self, name):
        with self._lock:
            self.calls.append(name)
            if name == "GOAL_ALIGNMENT_FILTER_PROMPT" and self.goal_stage == "goal_alignment_post_catchall":
                self.second_goal_calls += 1

    def _tables(self, no):
        return (self.by_no.get(no) or {}).get("Tables Involved", "")

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, *args, **kw):
        name = worker_prompt_path
        if name == "DOMAIN_FINDER_PROMPT":
            self._note(name)
            ids = _csv_ids(prompt_vars.get("use_cases_csv", ""))
            return "use_case_id,domain\n" + "\n".join(f"{i},{_domain_for(i, self._tables(i))}" for i in ids)
        if name == "SUBDOMAIN_DETECTOR_PROMPT":
            self._note(name)
            ids = _csv_ids(prompt_vars.get("use_cases_csv", ""))
            return "use_case_id,subdomain\n" + "\n".join(
                f"{i},{'Core Planning' if n % 2 else 'Demand Signals'}" for n, i in enumerate(ids))
        if name == "DOMAINS_MERGER_PROMPT":
            self._note(name)
            return _wrapped({"Tiny": "Workforce"})
        if name == "SUBDOMAINS_MERGER_PROMPT":
            self._note(name)
            return _wrapped({})
        if name == "DOMAIN_SPLITTER_PROMPT":
            self._note(name)
            ids = re.findall(r"^  - (\S+?): ", self.agent.prompt_templates.get(name, ""), re.M)
            return _wrapped({i: ("Pricing" if n % 2 else "Revenue") for n, i in enumerate(ids)})
        return self._real_run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, *args, **kw)

    def call_ai_query(self, prompt, prompt_name, *args, **kw):
        self._note(prompt_name)
        if prompt_name == "PlaceholderDomainRename":
            return "Treasury"
        if prompt_name == "Assign_User_Domains":
            ids = re.findall(r"^(AI[^,\s]*?-U\d+),", prompt, re.M)
            return "use_case_id,domain\n" + "\n".join(
                f"{i},{USER_DOMAINS[_table_index(self._tables(i)) % len(USER_DOMAINS)]}" for i in ids)
        if prompt_name == "GOAL_ALIGNMENT_FILTER_PROMPT":
            ids = re.findall(r"^\| (\S+) \|", prompt, re.M)[1:]
            return "\n".join(f"{i},YES" for i in ids if not i.startswith("-"))
        if prompt_name == "STRATEGY_ALIGNMENT_PROMPT":
            ids = re.findall(r'"use_case_id": "([^"]+)"', prompt)
            return json.dumps([{"use_case_id": i, "alignments": [], "priority_alignment": [], "strategic_alignment": 1.0,
                                "kpis": [], "key_result_ids": [], "proposed_key_results": [],
                                "measures_of_success": ["The weekly planning review uses the output"],
                                "financial_benefits": ["Cost avoided"], "non_financial_benefits": ["Faster planning"],
                                "sponsor_id": None} for i in dict.fromkeys(ids)])
        if sp.prompt_name(prompt) == "OTHER":
            return ""
        return sp.respond({"args": {"prompt_text": prompt}})


def offline_run(ns, tmp, mode="Good", user_domains=None, flags=None, expect_error=None):
    """One offline Discover run; returns a namespace with calls, final use cases, ledger rows and the run object."""
    import types
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    saved = {k: rt[k] for k in (flags or {}) if k in rt}
    added = [k for k in (flags or {}) if k not in rt]
    saved_n = sp.N_TABLES
    rt.update(flags or {})
    sp.N_TABLES = N_TABLES
    random.seed(0)
    try:
        obj, _spark = sp.build(ns, tmp, mode)
        for name in ("_cluster_domains_and_subdomains", "_assign_to_user_domains"):
            if name in vars(obj):
                delattr(obj, name)
        obj.user_business_domains = list(user_domains or [])
        obj.max_retry_attempts = 1
        obj.atomic_writer.spark = LedgerSpark()
        obj.atomic_writer.inspire_database = "cat.db"
        obj.session_id = 77
        obj.industries = []
        obj.parsed_generation_instructions = json.loads(json.dumps(GOAL))
        obj._interpret_generation_instructions = lambda: obj.parsed_generation_instructions
        by_no = {}
        real_generate = obj._process_batch_with_retry

        def generate(column_details, batch_id, **kw):
            out = real_generate(column_details, batch_id, **kw)
            for uc in out:
                by_no[uc["No"]] = uc
            return out

        obj._process_batch_with_retry = generate
        rec = Recorder(ns, obj.ai_agent, by_no)
        obj.ai_agent.run_worker = rec.run_worker
        obj.ai_agent._call_ai_query = rec.call_ai_query
        real_goal = obj._filter_use_cases_by_goal_alignment

        def goal_filter(use_cases, stage="goal_alignment"):
            rec.goal_stage = stage
            try:
                return real_goal(use_cases, stage=stage)
            finally:
                rec.goal_stage = None

        obj._filter_use_cases_by_goal_alignment = goal_filter
        logging.disable(logging.CRITICAL)
        error = None
        try:
            obj.run()
        except Exception as exc:  # noqa: BLE001 - a refused flag is an accepted outcome for some tests
            if expect_error is None:
                raise
            error = exc
        finally:
            logging.disable(logging.NOTSET)
        final = (obj.recorded["tracking"] or [[]])[-1]
        ledger = getattr(ns.get("StepLedger"), "last", None)
        rows = list(getattr(ledger, "written", None) or [])
        return types.SimpleNamespace(obj=obj, calls=rec.calls, rec=rec, final=final, rows=rows, error=error)
    finally:
        sp.N_TABLES = saved_n
        rt.update(saved)
        for k in added:
            rt.pop(k, None)


def collapse(names):
    """Run-length collapse: parallel batches of one prompt make the count order-free, the phase order is kept."""
    out = []
    for n in names:
        if not out or out[-1] != n:
            out.append(n)
    return out


ALL_ON = {**{flag: True for flag in BOOL_FLAGS}, "discover_domain_steps": list(DOMAIN_STEPS)}
DOMAIN_PROMPTS = {"DOMAIN_FINDER_PROMPT"} | set(STEP_PROMPT.values())


def _signature(run):
    return {"sequence": collapse(run.calls), "counts": dict(sorted(collections.Counter(run.calls).items()))}


def _record_base(ns, tmp):
    out = {}
    for key, domains in (("default", None), ("user_domains", USER_DOMAINS)):
        out[key] = _signature(offline_run(ns, tmp / key, user_domains=domains, flags=ALL_ON))
    return out


def _assert_declared(ns, flag):
    rt = ns["TECHNICAL_CONTEXT"]["runtime"]
    assert flag in rt, f"TECHNICAL_CONTEXT.runtime declares no '{flag}' flag"
    default = list(DOMAIN_STEPS) if flag == "discover_domain_steps" else True
    got = sorted(rt[flag]) if isinstance(rt[flag], list) else rt[flag]
    assert got == (sorted(default) if isinstance(default, list) else default), f"'{flag}' default must be today's behaviour, got {rt[flag]!r}"


def _assert_complete(run):
    assert run.final, "the run produced no use case with the step switched off"
    for uc in run.final:
        assert str(uc.get("Business Domain") or "").strip(), f"{uc.get('No')} has no domain"
        assert ID_RE.match(str(uc.get("No") or "")), f"{uc.get('No')!r} is not an AIx-UCx id"


OFF_CASES = ([(flag, {flag: False}, prompt, None, "Good") for flag, prompt in BOOL_FLAGS.items()]
             + [("discover_elite_judge", {"discover_elite_judge": False}, "ULTRA_HIGH_ELITE_JUDGE_PROMPT", None, "Ultra High")]
             + [("discover_domain_steps", {"discover_domain_steps": [s for s in DOMAIN_STEPS if s != step]}, STEP_PROMPT[step],
                 USER_DOMAINS if step == "Assign_User_Domains" else None, "Good") for step in DOMAIN_STEPS])
OFF_IDS = ([f"{f}-off" for f in BOOL_FLAGS] + ["discover_elite_judge-off-ultra_high"]
           + [f"domain_step-{s}-off" for s in DOMAIN_STEPS])


@pytest.mark.parametrize("flag,flags,prompt,user_domains,mode", OFF_CASES, ids=OFF_IDS)
def test_1_flag_off_calls_its_prompt_zero_times_and_the_run_completes(agent_ns, tmp_path, flag, flags, prompt, user_domains, mode):
    _assert_declared(agent_ns, flag)
    refusable = prompt == "Assign_User_Domains"
    run = offline_run(agent_ns, tmp_path, mode=mode, user_domains=user_domains, flags=flags,
                      expect_error=Exception if refusable else None)
    if run.error is not None:
        assert "Assign_User_Domains" in str(run.error), f"Assign_User_Domains off with user domains must be refused with a clear error, got {run.error!r}"
        return
    if prompt == "GOAL_ALIGNMENT_FILTER_PROMPT":
        assert run.rec.second_goal_calls == 0, f"second goal filter sent {run.rec.second_goal_calls} prompt(s) with {flag} off"
        assert run.calls.count(prompt) >= 1, "the first goal filter pass must still run"
    else:
        n = run.calls.count(prompt)
        assert n == 0, f"{prompt} was called {n} time(s) with {flags} set"
    _assert_complete(run)
    if refusable:
        domains = {uc["Business Domain"] for uc in run.final}
        assert set(USER_DOMAINS) <= domains, f"user domains {USER_DOMAINS} must survive verbatim (exact name match), got {sorted(domains)}"


def test_2_all_flags_on_prompt_sequence_equals_the_base(agent_ns, tmp_path):
    base = json.loads(BASE_SEQUENCE.read_text(encoding="utf-8"))
    assert _record_base(agent_ns, tmp_path) == base


def test_3_empty_domain_steps_runs_domain_finder_only_and_default_subdomains(agent_ns, tmp_path):
    _assert_declared(agent_ns, "discover_domain_steps")
    run = offline_run(agent_ns, tmp_path, flags={"discover_domain_steps": []})
    domain_calls = collections.Counter(c for c in run.calls if c in DOMAIN_PROMPTS)
    assert set(domain_calls) == {"DOMAIN_FINDER_PROMPT"}, f"discover_domain_steps=[] sent {dict(domain_calls)}"
    _assert_complete(run)
    by_domain = collections.defaultdict(list)
    for uc in run.final:
        by_domain[uc["Business Domain"]].append(uc)
    for domain, ucs in by_domain.items():
        expected = {u["No"]: u["Subdomain"] for u in run.obj._assign_default_subdomains([dict(u) for u in ucs], domain)}
        got = {u["No"]: u["Subdomain"] for u in ucs}
        assert got == expected, f"{domain}: subdomains must come from _assign_default_subdomains"


OFF_ALL = {**{flag: False for flag in BOOL_FLAGS}, "discover_domain_steps": []}
SKIPPED_ITEMS = {"discover_elite_judge": ["ULTRA_HIGH_ELITE_JUDGE_PROMPT"], "discover_best_of_best": ["BEST_OF_BEST_SCORING_PROMPT"],
                 "discover_review_dedup": ["REVIEW_USE_CASES_PROMPT"], "discover_goal_filter_second": ["goal_alignment_post_catchall"],
                 **{step: [STEP_PROMPT[step]] for step in DOMAIN_STEPS if step != "Assign_User_Domains"}}


def _names_item(ns, row, item, names):
    step = str(row.get("step") or "")
    labelled = {ns["step_ledger_labels"](n)[1] for n in names} - {ns["STEP_LEDGER_UNATTRIBUTED"][1]}
    return step in labelled or any(n.lower() in step.lower() for n in [item] + names)


def test_4_skipped_steps_have_skipped_ledger_rows_and_flags_json_lists_every_off_flag(agent_ns, tmp_path):
    for flag in ALL_FLAGS:
        _assert_declared(agent_ns, flag)
    run = offline_run(agent_ns, tmp_path, flags=OFF_ALL)
    assert run.rows, "the step ledger wrote no rows"
    skipped = [r for r in run.rows if r.get("status") == "skipped"]
    missing = [item for item, names in SKIPPED_ITEMS.items() if not any(_names_item(agent_ns, r, item, names) for r in skipped)]
    assert not missing, f"no ledger row with status 'skipped' for {missing}; skipped rows: {[(r['stage'], r['step']) for r in skipped]}"
    for row in run.rows:
        flags = json.loads(row.get("flags_json") or "{}")
        for flag, value in OFF_ALL.items():
            assert flag in flags and flags[flag] == value, f"flags_json of {row['stage']}/{row['step']} lacks {flag}={value!r}: {flags}"


def test_5_unknown_domain_step_fails_config_validation_with_the_bad_name(agent_ns, monkeypatch):
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    monkeypatch.setitem(rt, "discover_domain_steps", ["SUBDOMAIN_DETECTOR", "NOT_A_DOMAIN_STEP"])
    with pytest.raises((ValueError, TypeError)) as err:
        agent_ns["_validate_runtime_config"]()
    assert "NOT_A_DOMAIN_STEP" in str(err.value)


def test_5_known_domain_steps_pass_config_validation(agent_ns, monkeypatch):
    rt = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    for value in (list(DOMAIN_STEPS), [], ["SUBDOMAIN_DETECTOR"]):
        monkeypatch.setitem(rt, "discover_domain_steps", value)
        agent_ns["_validate_runtime_config"]()


@pytest.mark.parametrize("flag", list(BOOL_FLAGS))
def test_5_non_boolean_flag_fails_config_validation(agent_ns, monkeypatch, flag):
    monkeypatch.setitem(agent_ns["TECHNICAL_CONTEXT"]["runtime"], flag, "yes")
    with pytest.raises((ValueError, TypeError)) as err:
        agent_ns["_validate_runtime_config"]()
    assert flag in str(err.value)


if __name__ == "__main__" and "--record" in sys.argv:
    import tempfile
    import _agentload
    with tempfile.TemporaryDirectory(prefix="c36_flags_") as _tmp:
        _base = _record_base(_agentload.load_agent_namespace(), pathlib.Path(_tmp))
    BASE_SEQUENCE.write_text(json.dumps(_base, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"recorded {BASE_SEQUENCE}")
