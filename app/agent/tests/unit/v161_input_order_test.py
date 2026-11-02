import concurrent.futures
import logging
import re
import threading
import time
import types

import pytest

from v120_run_offline_smoke_test import _build, quiet_root_logger  # noqa: F401


def _reverse_completed(futures, timeout=None, label="", log=None):
    fs = list(futures)
    concurrent.futures.wait(fs)
    yield from reversed(fs)


def _rotated_completed(futures, timeout=None, label="", log=None):
    fs = list(futures)
    concurrent.futures.wait(fs)
    yield from fs[1:] + fs[:1]


def _last_then_timeout(futures, timeout=None, label="", log=None):
    fs = list(futures)
    concurrent.futures.wait(fs)
    yield fs[-1]
    raise concurrent.futures.TimeoutError("forced timeout after the last submitted future")


@pytest.fixture(params=[_reverse_completed, _rotated_completed], ids=["reverse", "rotated"])
def ns(fresh_ns, request):
    fresh_ns["safe_as_completed"] = request.param
    return fresh_ns


@pytest.fixture
def timeout_ns(fresh_ns):
    fresh_ns["safe_as_completed"] = _last_then_timeout
    return fresh_ns


def _log():
    return logging.getLogger("v161_input_order")


def _loader(ns, two_pass):
    return ns["DataLoader"]("", "", "", _log(), enable_two_pass=two_pass, enable_column_sampling=False,
                            max_parallelism=4)


def _columns(table_tuple, n=3):
    c, s, t = table_tuple
    return [(c, s, t, f"col{j}", "int", "") for j in range(n)]


BATCH = [("cat", "sales", "orders"), ("cat", "sales", "items"), ("cat", "ops", "stores"), ("cat", "ops", "trucks")]


@pytest.mark.parametrize("two_pass", [True, False])
def test_getNextTables_rows_follow_the_batch_order_not_the_finish_order(ns, two_pass):
    dl = _loader(ns, two_pass)
    dl._preload_metadata = lambda tuples, max_workers=None: None
    dl._get_table_details = lambda c, s, t, apply_sampling=True: _columns((c, s, t))
    dl._tables_initialized = True
    if two_pass:
        dl._size_analysis_complete = True
        dl.optimized_batches = [list(BATCH)]
        rows = dl.getNextTables()
    else:
        dl.all_table_tuples = list(BATCH)
        rows = dl.getNextTables(len(BATCH))
    assert rows == [r for t in BATCH for r in _columns(t)]


def test_fetch_batch_details_keeps_input_order_around_a_failed_and_an_empty_table(ns):
    dl = _loader(ns, True)
    dl._preload_metadata = lambda tuples, max_workers=None: None

    def details(c, s, t, apply_sampling=True):
        if t == "items":
            raise RuntimeError("DESCRIBE failed")
        if t == "stores":
            return []
        return _columns((c, s, t), n=2)

    dl._get_table_details = details
    rows = dl._fetch_batch_details(list(BATCH), 4, "TestDetails", "Batch 1")
    assert rows == _columns(BATCH[0], n=2) + _columns(BATCH[3], n=2)
    assert set(dl.metadata_unavailable) == {dl._lkey(*BATCH[1]), dl._lkey(*BATCH[2])}


def test_table_size_analysis_parallel_order_matches_the_sequential_order(ns):
    analyzer = ns["TableSizeAnalyzer"](None, _log())
    analyzer._get_column_count_fallback = lambda c, s, t: 10
    tuples = [("cat", "a", "t1"), ("cat", "b", "t2"), ("cat", "a", "t3"), ("cat", "c", "t4")]
    sequential = [(i.catalog, i.schema, i.table) for i in analyzer.analyze_table_sizes_batch(tuples, {}, max_parallelism=1)]
    parallel = [(i.catalog, i.schema, i.table) for i in analyzer.analyze_table_sizes_batch(tuples, {}, max_parallelism=4)]
    assert sequential == [("cat", "a", "t1"), ("cat", "a", "t3"), ("cat", "b", "t2"), ("cat", "c", "t4")]
    assert parallel == sequential


SCHEMA_TABLES = {("cat", "a"): ["a1", "a2", "a3"], ("cat", "b"): ["b1", "b2"], ("cat", "c"): ["c1"]}
DISCOVERED = [("cat", s, t) for (_, s), ts in sorted(SCHEMA_TABLES.items()) for t in ts]


def _no_information_schema(*a, **kw):
    raise RuntimeError("no information_schema offline")


def _discovery_loader(ns, two_pass):
    ns["_metadata_rows"] = _no_information_schema
    dl = _loader(ns, two_pass)
    dl.database_queue = sorted(SCHEMA_TABLES)
    dl.explicit_schemas_set = set(SCHEMA_TABLES)
    dl._fetch_tables_for_schema = lambda cat, sch, limit=None, offset=0: [
        f"{cat}.{sch}.`{t}`" for t in SCHEMA_TABLES[(cat, sch)]]
    return dl


def test_two_pass_discovery_batches_follow_the_schema_queue_order(ns):
    dl = _discovery_loader(ns, True)
    info = ns["TableSizeInfo"]
    dl.size_analyzer.analyze_table_sizes_batch = lambda chunk, caps, max_parallelism=20: [
        info(c, s, t, num_columns=10, size_category="small") for c, s, t in chunk]
    dl.batch_optimizer.max_batch_weight = 20
    dl._initialize_all_tables()
    assert dl.all_table_tuples == DISCOVERED
    assert dl.optimized_batches == [DISCOVERED[i:i + 2] for i in range(0, len(DISCOVERED), 2)]


def test_two_pass_rescued_tables_keep_the_schema_queue_order(ns):
    dl = _discovery_loader(ns, True)
    info = ns["TableSizeInfo"]
    dl.size_analyzer.analyze_table_sizes_batch = lambda chunk, caps, max_parallelism=20: [
        info(c, s, t, num_columns=10, size_category="small") for c, s, t in chunk if not t.endswith("2")]
    dl._initialize_all_tables()
    sized = [t for t in DISCOVERED if not t[2].endswith("2")]
    rescued = [t for t in DISCOVERED if t[2].endswith("2")]
    assert dl.all_table_tuples == sized + rescued


def test_single_pass_discovery_follows_the_schema_queue_order(ns):
    dl = _discovery_loader(ns, False)
    dl._initialize_all_tables()
    assert dl.all_table_tuples == DISCOVERED


def test_batch_optimizer_keeps_input_order_for_equal_weights(agent_ns):
    info = agent_ns["TableSizeInfo"]
    opt = agent_ns["DynamicBatchOptimizer"](_log(), max_batch_weight=400)
    tables = [info("cat", "s", "z_small", num_columns=10, size_category="small"),
              info("cat", "s", "a_small", num_columns=10, size_category="small"),
              info("cat", "s", "wide", num_columns=300, size_category="wide"),
              info("cat", "s", "m_small", num_columns=10, size_category="small")]
    batches = opt.create_optimized_batches(tables)
    assert batches == [[("cat", "s", "wide")],
                       [("cat", "s", "z_small"), ("cat", "s", "a_small"), ("cat", "s", "m_small")]]


def _uc(no, domain):
    return {"No": no, "Name": f"Use case {no}", "Business Domain": domain}


def _dedup_obj(ns, groups, request):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = _log()
    obj.max_parallelism = 4
    obj.llm_timeout_seconds = 300
    obj._dedup_groups = lambda ucs: groups
    obj._build_dedup_markdown = lambda ucs: "| No |"
    obj._prompt_overhead_chars = lambda name: 100
    obj._get_generation_instruction_for_prompt = lambda name: ""
    obj._request_dedup = request
    return obj


def _three_domains():
    return {"Sales": [_uc("N01-U01", "Sales"), _uc("N01-U02", "Sales")],
            "Ops": [_uc("N02-U01", "Ops")],
            "Finance": [_uc("N03-U01", "Finance"), _uc("N03-U02", "Finance")]}


def _keep_first(step, prompt_vars, ucs, label, rank=None):
    return ucs[:1]


def test_domain_dedup_result_follows_the_domain_order(ns):
    groups = _three_domains()
    obj = _dedup_obj(ns, groups, _keep_first)
    out = obj._deduplicate_use_cases_by_domain_parallel([uc for ucs in groups.values() for uc in ucs])
    assert [uc["No"] for uc in out] == ["N01-U01", "N02-U01", "N03-U01"]


def test_domain_dedup_timeout_keeps_originals_in_domain_order(timeout_ns):
    groups = _three_domains()
    obj = _dedup_obj(timeout_ns, groups, _keep_first)
    out = obj._deduplicate_use_cases_by_domain_parallel([uc for ucs in groups.values() for uc in ucs])
    assert [uc["No"] for uc in out] == ["N01-U01", "N01-U02", "N02-U01", "N03-U01"]


def test_domain_dedup_unusable_answer_keeps_that_domain_in_place(ns):
    groups = _three_domains()

    def request(step, prompt_vars, ucs, label, rank=None):
        return None if label == "Domain:Sales" else ucs[:1]

    obj = _dedup_obj(ns, groups, request)
    out = obj._deduplicate_use_cases_by_domain_parallel([uc for ucs in groups.values() for uc in ucs])
    assert [uc["No"] for uc in out] == ["N01-U01", "N01-U02", "N02-U01", "N03-U01"]


def _genie_obj(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = _log()

    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "success" if int(uc["No"][-1]) % 2 == 0 else "failed"
        return uc

    obj._generate_genie_instruction_for_use_case = generate
    obj._deliver_genie_notebook = lambda uc, translations: None
    obj._genie_validation_mode = lambda: "off"
    return obj


GENIE_BACKLOG = [f"N01-U0{i}" for i in range(6)]


def test_genie_wave_lists_follow_the_backlog_order(ns):
    obj = _genie_obj(ns)
    backlog = [{"No": no, "Name": no} for no in GENIE_BACKLOG]
    succeeded, not_emitted = obj._run_genie_wave(1, backlog, [], "", {}, {}, 4)
    assert [uc["No"] for uc in succeeded] == ["N01-U00", "N01-U02", "N01-U04"]
    assert [uc["No"] for uc in not_emitted] == ["N01-U01", "N01-U03", "N01-U05"]


def test_genie_wave_salvaged_futures_keep_the_backlog_order(timeout_ns):
    obj = _genie_obj(timeout_ns)
    backlog = [{"No": no, "Name": no} for no in GENIE_BACKLOG]
    succeeded, not_emitted = obj._run_genie_wave(1, backlog, [], "", {}, {}, 4)
    assert [uc["No"] for uc in succeeded] == ["N01-U00", "N01-U02", "N01-U04"]
    assert [uc["No"] for uc in not_emitted] == ["N01-U01", "N01-U03", "N01-U05"]


def _reverse_chain(n, gap=0.2):
    done = [threading.Event() for _ in range(n)]
    finished = []

    def wait_turn(k):
        if k + 1 < n:
            assert done[k + 1].wait(10), f"item {k + 1} never finished"
            time.sleep(gap)

    def mark(k):
        finished.append(k)
        done[k].set()

    return wait_turn, mark, finished


def test_split_retry_scores_come_back_in_use_case_order(fresh_ns):
    cls = fresh_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = _log()
    ucs = [{"No": f"N01-U0{i}"} for i in range(5)]
    cached = {"N01-U02": {"score": 2}}
    pending = [uc for uc in ucs if uc["No"] not in cached]
    wait_turn, mark, finished = _reverse_chain(len(pending))

    def score_batch(label, chunk, skip_cache):
        k = pending.index(chunk[0])
        wait_turn(k)
        mark(k)
        return {chunk[0]["No"]: {"score": int(chunk[0]["No"][-1])}}

    scores, unscored = obj._score_with_split_retry(ucs, score_batch, 1, "OrderTest", 60, already_scored=cached)
    assert finished == [3, 2, 1, 0]
    assert list(scores) == [uc["No"] for uc in ucs]
    assert scores["N01-U02"] == {"score": 2} and unscored == {}


def test_filter_split_merges_halves_in_table_order(ns):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = _log()
    obj.llm_timeout_seconds = 5
    obj._get_generation_instruction_for_prompt = lambda name: ""
    limit = ns["get_max_context_chars"]("English", "FILTER_BUSINESS_TABLES_PROMPT")
    obj.ai_agent = types.SimpleNamespace(_load_and_format_prompt=lambda name, prompt_vars: "x" * (limit + 1))
    obj._process_filter_batch_recursive = lambda batch_tables, batch_idx, **kw: {
        t: ("BUSINESS", 80, "MASTER") for t in batch_tables}
    tables = [f"cat.sch.t{i}" for i in range(6)]
    out = cls._process_filter_batch_recursive(obj, tables, 1, 1, "Biz", "Retail", "ctx", "Aggressive", "rules")
    assert list(out) == tables


def test_pass1_batches_reach_storage_and_pass2_feedback_in_batch_order(fresh_ns, tmp_path, quiet_root_logger):
    def scorer(uc_id):
        return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
                "quality_summary": "Columns `id` and `amount` aggregated by store give the KPI that drives the outcome."}

    obj = _build(fresh_ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, scorer)
    base = obj._process_batch_with_retry
    batch_tables = {}
    order = []
    wait_turn, mark, finished = _reverse_chain(3, gap=0.3)

    def generate(column_details, batch_id, **kw):
        if not str(batch_id).startswith("P1_"):
            return base(column_details, batch_id, **kw)
        batch_tables[batch_id] = column_details[0][2]
        k = int(str(batch_id).split("_")[1]) - 1
        wait_turn(k)
        out = base(column_details, batch_id, **kw)
        mark(k)
        return out

    obj._process_batch_with_retry = generate
    loaded = obj.storage_manager.load_all_use_cases

    def load_all():
        ucs = loaded()
        order.extend(uc["No"] for uc in ucs)
        return ucs

    obj.storage_manager.load_all_use_cases = load_all
    obj.run()
    assert finished == [2, 1, 0], "the Pass 1 batches must finish in reverse for this test to mean anything"
    expected_tables = [batch_tables[f"P1_{k}"] for k in (1, 2, 3)]
    loaded_tables = [re.search(r"P1_(\d)", no).group(1) for no in order]
    assert loaded_tables == ["1", "1", "2", "2", "3", "3"], order
    feedback = next(kw["previous_use_cases_feedback"] for kw in obj.recorded["gen_kwargs"]
                    if "Already generated" in (kw.get("previous_use_cases_feedback") or ""))
    rows = re.findall(r"^\| \d+ \| Forecast (\w+) demand \d \|", feedback, flags=re.M)
    assert rows == [t for t in expected_tables for _ in (1, 2)]
