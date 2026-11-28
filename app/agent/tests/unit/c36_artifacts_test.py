"""c36_artifacts (R3.6, U4): docs, Genie instructions, notebooks and translation off the Discover critical path.

Contract the tests pin (brief c36_artifacts.md, App contract U4 in c35_ui_interface.md):
* TECHNICAL_CONTEXT.runtime.discover_inline_artifacts, default True (today's behaviour).
* Flag False: a Discover run ends (use cases written, the pipeline completion row written) without producing docs
  (_generate_language_catalogs), translation (_translate_and_prepare_language_pack, non-English translations, the translate
  prompts), Genie instructions (USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT) or use-case notebooks (skeleton or Genie). It
  records them as pending through AtomicWriter.record_pending_artifacts(pending) where pending is a JSON-able list of
  {"kind": "docs|genie_instructions|notebook|translation", "use_case_id": str or None}.
* The session table gains a pending_artifacts STRING column (added by _migrate_session_table_schema for existing tables);
  record_pending_artifacts writes the JSON list to it for the session. Empty list when none: a flag-True Discover run and an
  Implement run that produced everything both record [].
* An Implement Use Cases run for the session loads (pending, saved use cases) with DatabricksInspire._load_pending_artifacts()
  and produces them with the existing writers, so the Genie instructions and notebook content equal the flag-True run's for the
  same fake inputs; with pending artifacts and no queued wizard spec it does not fail.
* Flag True: the prompt sequence and artifact calls are identical to the base (fixture c36_artifacts_base_sequence.json).

Seams: the harness of v120_run_offline_smoke_test runs DatabricksInspire.run() offline. The real Discover skeleton phase, Genie
waves, notebook writers (_write_use_case_notebook, assemble_use_case_notebooks) and _call_genie_instruction_llm run; only the
workspace writes (_assemble_skeleton_notebook, _assemble_genie_code_notebook), the Genie prompt builder
(_generate_genie_instruction_for_use_case, which still calls the model through _call_genie_instruction_llm), the metadata reads
and the docs writer are recording doubles.
"""
import collections
import copy
import json
import os
import re
import sys
import threading
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from v120_run_offline_smoke_test import _Agent, _Writer, _build  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "c36_artifacts_base_sequence.json")
FLAG = "discover_inline_artifacts"
KINDS = {"docs", "genie_instructions", "notebook", "translation"}
GENIE_PROMPT = "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"
TRANSLATE_PROMPTS = {"USE_CASE_TRANSLATE_PROMPT", "KEYWORDS_TRANSLATE_PROMPT"}
ARTIFACT_PROMPTS = {GENIE_PROMPT} | TRANSLATE_PROMPTS
SECOND_LANGUAGE = "French"
GENIE_TOP_N = "2"
CONTEXT = {"business_context": "An organisation with several sites\nand one central team", "strategic_goals": "Reduce Cost",
           "business_priorities": "Grow output, Cut waste", "strategic_initiative": "Site analytics",
           "value_chain": "Plan, make, deliver", "revenue_model": "Direct sales"}


def _scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0,
            "quality_summary": "Columns `id` and `amount` aggregated by site give the KPI that drives the outcome."}


class _Recorder:
    def __init__(self):
        self.lock = threading.Lock()
        self.prompts = []
        self.calls = []
        self.notebooks = []
        self.genie = {}
        self.pending = []
        self.finalized = []
        self.run_thread = None

    def call(self, name, **info):
        with self.lock:
            self.calls.append(dict(info, name=name, thread=threading.get_ident()))


class _RecordingAgent(_Agent):
    def __init__(self, rec):
        super().__init__(_scorer)
        self.rec = rec

    def run_worker(self, step_name, worker_prompt_path, prompt_vars, response_schema=None, **kw):
        with self.rec.lock:
            self.rec.prompts.append(worker_prompt_path)
        if worker_prompt_path == GENIE_PROMPT:
            uc_id = prompt_vars["use_case_id"]
            return (f"Genie instruction for {uc_id}: build the {prompt_vars['name']} analysis on {prompt_vars['tables']} "
                    "and report the weekly outcome to the owner of the decision. " * 2)
        if worker_prompt_path in TRANSLATE_PROMPTS:
            return "{}"
        return super().run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw)


class _RecordingWriter(_Writer):
    def __init__(self, rec):
        super().__init__()
        self.rec = rec

    def record_pending_artifacts(self, pending):
        self.rec.pending.append(json.loads(json.dumps(pending)))
        return True

    def finalize_pipeline(self, message="Completed", final_results_json=None, pipeline_start_step_id=None,
                          status="ended_success"):
        self.rec.finalized.append({"message": message, "status": status})
        self.emit_step(stage_name="Inspire Journey", step_name="Inspire pipeline completed", sub_step_name="Completed",
                       status=status, message=message)

    def flush_pending(self, *a, **kw):
        return 0

    def _ensure_implement_table(self):
        return None


def _make(ns, tmp_path, operation="Discover Use Cases"):
    obj = _build(ns, tmp_path, "Good", {"Medium", "High", "Very High", "Ultra High"}, _scorer)
    rec = _Recorder()
    obj.rec = rec
    obj.business_name = "ExampleOrg"
    obj.operation = operation
    obj.operation_mode = operation
    obj.output_languages = ["English", SECOND_LANGUAGE]
    obj.generate_genie_code_for = GENIE_TOP_N
    obj.ai_agent = _RecordingAgent(rec)
    obj.atomic_writer = _RecordingWriter(rec)
    obj._get_business_context_from_llm = lambda: dict(CONTEXT)

    def get_translations(lang):
        if lang != "English":
            rec.call("get_translations", lang=lang)
        return {}

    obj.translation_service = types.SimpleNamespace(get_translations=get_translations)
    for name in ("_run_discover_skeleton_phase", "assemble_use_case_notebooks", "_generate_language_catalogs"):
        obj.__dict__.pop(name, None)

    def docs(*a, **kw):
        langs = kw.get("languages") or (a[3] if len(a) > 3 else None) or list(obj.output_languages)
        rec.call("_generate_language_catalogs", languages=list(langs))

    obj._generate_language_catalogs = docs
    obj._translate_and_prepare_language_pack = lambda lang, *a, **kw: rec.call("_translate_and_prepare_language_pack", lang=lang)

    obj._ensure_genie_metadata_loader = lambda: None
    obj._build_genie_schema_index = lambda details: {}
    obj._genie_table_evidence = lambda tables: None
    obj._genie_involved_tables = lambda uc: [t.strip() for t in str(uc.get("Tables Involved", "")).split(",") if t.strip()]
    obj._compute_per_uc_genie_fields = lambda uc, details, index=None: {"directly_involved_schema": uc.get("Tables Involved", "")}
    obj._build_notebook_workspace_paths = lambda uc: ("", f"nb/{uc.get('No')}", "")
    obj._write_genie_agents_file = lambda root: None

    def genie_for(uc, full_schema_details, document_context, schema_index=None):
        rec.call("_generate_genie_instruction_for_use_case", use_case_id=uc.get("No"))
        text = obj._call_genie_instruction_llm(uc.get("No"), {"use_case_id": uc.get("No"), "name": uc.get("Name"),
                                                               "tables": uc.get("Tables Involved")}, False)
        uc["genie_instruction"] = text
        uc["genie_instruction_status"] = "success" if text else "failed"
        with rec.lock:
            rec.genie[uc.get("No")] = text
        return uc

    obj._generate_genie_instruction_for_use_case = genie_for

    def write_nb(kind, uc):
        rec.call("notebook_write", kind=kind, use_case_id=uc.get("No"))
        with rec.lock:
            rec.notebooks.append((uc.get("No"), kind, uc.get("Name"), uc.get("Tables Involved"),
                                  str(uc.get("genie_instruction") or "")))
        return f"/Workspace/nb/{kind}/{uc.get('No')}"

    obj._assemble_skeleton_notebook = lambda uc: write_nb("skeleton", uc)
    obj._assemble_genie_code_notebook = lambda uc, translations: write_nb("genie", uc)
    return obj


def _discover(ns, tmp_path, monkeypatch, flag):
    if flag is not None:
        monkeypatch.setitem(ns["TECHNICAL_CONTEXT"]["runtime"], FLAG, flag)
    obj = _make(ns, tmp_path)
    obj.rec.run_thread = threading.get_ident()
    obj.run()
    return obj


def _final_notebooks(rec):
    final = {}
    for uc_id, kind, name, tables, instruction in rec.notebooks:
        final[uc_id] = (kind, name, tables, instruction)
    return final


def _sequence(rec):
    calls = collections.Counter()
    for c in rec.calls:
        key = c["name"] + "|" + ",".join(f"{k}={c[k]}" for k in sorted(c) if k not in ("name", "thread"))
        calls[key] += 1
    return {"prompts": list(rec.prompts), "artifact_calls": dict(sorted(calls.items()))}


@pytest.fixture
def quiet_root_logger():
    import logging
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


def test_0_flag_defaults_to_true(agent_ns):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    assert runtime.get(FLAG) is True, f"TECHNICAL_CONTEXT.runtime.{FLAG} must exist and default to True (today's behaviour)"


def test_1_flag_false_discover_produces_no_artifact_and_still_completes(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    obj = _discover(agent_ns, tmp_path, monkeypatch, False)
    rec = obj.rec
    called = sorted({c["name"] for c in rec.calls})
    assert not called, f"flag false: the Discover run still produced artifacts inline: {called}"
    asked = sorted(set(rec.prompts) & ARTIFACT_PROMPTS)
    assert not asked, f"flag false: Genie instruction or translation prompts were called inside Discover: {asked}"
    assert not rec.notebooks, "flag false: no skeleton or Genie notebook may be written inside Discover"
    final = obj.recorded["tracking"][-1] if obj.recorded["tracking"] else []
    assert len(final) == 4, "the use cases must still be written to the tracking table"
    assert obj.final_inspire_results_json.get("domains"), "the catalog JSON must still be saved"
    obj.finalize_atomic_writer(success=True)
    assert rec.finalized and rec.finalized[-1]["status"] in ("ended_success", "ended_warning"), \
        "the final pipeline Complete row must be written"


def test_2_flag_false_then_implement_produces_same_genie_and_notebooks_as_flag_true(agent_ns, tmp_path, monkeypatch,
                                                                                     quiet_root_logger):
    inline = _discover(agent_ns, tmp_path / "inline", monkeypatch, True)
    want_genie = dict(inline.rec.genie)
    want_notebooks = _final_notebooks(inline.rec)
    assert want_genie and want_notebooks, "fixture sanity: flag true must produce Genie instructions and notebooks"

    deferred = _discover(agent_ns, tmp_path / "deferred", monkeypatch, False)
    assert deferred.rec.pending, "flag false: the Discover run must record its pending artifacts"
    pending = deferred.rec.pending[-1]
    saved = copy.deepcopy(deferred.recorded["tracking"][-1])

    impl = _make(agent_ns, tmp_path / "impl", operation=agent_ns["IMPLEMENT_OPERATION"])
    impl.inspire_database = "inspire_db"
    impl._ensure_inspire_database_exists = lambda: None
    impl._create_tracking_table = lambda: None
    impl._load_feedback = lambda: None
    impl._implement_targets = lambda: []
    impl._implement_requested_row = lambda: None
    loads = []

    def load_pending():
        loads.append(impl.session_id)
        return copy.deepcopy(pending), copy.deepcopy(saved)

    impl._load_pending_artifacts = load_pending
    try:
        impl.run()
    except Exception as err:
        pytest.fail(f"an Implement run for a session with pending artifacts and no wizard spec must produce them, not fail: "
                    f"{type(err).__name__}: {str(err)[:200]}")
    assert loads == [impl.session_id], "the Implement run must load the session's pending artifacts and saved use cases"
    assert impl.rec.genie == want_genie, "Implement must produce the same Genie instructions as the inline (flag true) run"
    assert _final_notebooks(impl.rec) == want_notebooks, "Implement must write the same notebooks as the inline run"
    docs = [c for c in impl.rec.calls if c["name"] == "_generate_language_catalogs"]
    assert docs, "Implement must produce the pending docs with the existing writer"
    translated = SECOND_LANGUAGE in {lang for c in docs for lang in c["languages"]} or any(
        c["name"] == "_translate_and_prepare_language_pack" and c["lang"] == SECOND_LANGUAGE for c in impl.rec.calls)
    assert translated, "Implement must produce the pending translation"
    assert impl.rec.pending and impl.rec.pending[-1] == [], "Implement clears the session's pending_artifacts to []"


def test_3_flag_true_prompt_sequence_identical_to_base(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    obj = _discover(agent_ns, tmp_path, monkeypatch, True)
    got = _sequence(obj.rec)
    if os.environ.get("C36_RECORD_BASE") == "1":
        with open(FIXTURE, "w", encoding="utf-8") as fh:
            json.dump(got, fh, indent=1, sort_keys=True)
            fh.write("\n")
    with open(FIXTURE, encoding="utf-8") as fh:
        base = json.load(fh)
    assert got["prompts"] == base["prompts"], "flag true must call exactly the base prompt sequence"
    assert got["artifact_calls"] == base["artifact_calls"], "flag true must produce exactly the base artifacts"


def test_4a_flag_false_records_pending_artifacts_contract(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    obj = _discover(agent_ns, tmp_path, monkeypatch, False)
    assert obj.rec.pending, "flag false: Discover must record pending artifacts on the session row"
    pending = obj.rec.pending[-1]
    assert isinstance(pending, list) and pending
    for item in pending:
        assert isinstance(item, dict) and set(item) == {"kind", "use_case_id"}, item
        assert item["kind"] in KINDS, item
        assert item["use_case_id"] is None or isinstance(item["use_case_id"], str), item
    assert len({json.dumps(i, sort_keys=True) for i in pending}) == len(pending), "no duplicate pending entries"
    by_kind = collections.defaultdict(set)
    for item in pending:
        by_kind[item["kind"]].add(item["use_case_id"])
    final_ids = {str(u["No"]) for u in obj.recorded["tracking"][-1]}
    assert by_kind["notebook"] == final_ids, "every saved use case has a pending notebook"
    ranked = sorted(obj.recorded["tracking"][-1], key=obj._final_rank_key)
    assert by_kind["genie_instructions"] == {str(u["No"]) for u in ranked[:int(GENIE_TOP_N)]}, \
        "the Genie instruction targets (top-N by final rank) are pending"
    assert by_kind["docs"] == {None}, "docs are session-level: one entry with use_case_id null"
    assert by_kind["translation"] == {None}, "translation is session-level: one entry with use_case_id null"


def test_4b_flag_true_records_empty_pending_list(agent_ns, tmp_path, monkeypatch, quiet_root_logger):
    obj = _discover(agent_ns, tmp_path, monkeypatch, True)
    assert obj.rec.pending and obj.rec.pending[-1] == [], "pending_artifacts is an empty list when nothing is pending"


class _FakeSpark:
    def __init__(self, columns):
        self.columns = columns
        self.sql_text = []

    def sql(self, text):
        self.sql_text.append(" ".join(str(text).split()))
        if str(text).strip().upper().startswith("DESCRIBE"):
            rows = [{"col_name": c} for c in self.columns]
            return types.SimpleNamespace(collect=lambda: rows)
        return types.SimpleNamespace(collect=lambda: [])


def _writer(ns, spark):
    import logging
    cls = ns["AtomicWriter"]
    w = cls.__new__(cls)
    w.spark = spark
    w.logger = logging.getLogger("c36_writer")
    w.inspire_database = "cat.inspire_db"
    w.session_id = 77
    w.enabled = True
    w.session_table = "cat.inspire_db.__inspire_session"
    w._session_writer = None
    w.attached_to_existing_session = False
    return w


def test_4c_session_row_stores_pending_artifacts_json(agent_ns):
    spark = _FakeSpark(["session_id", "business_name", "results_json"])
    w = _writer(agent_ns, spark)
    w._migrate_session_table_schema()
    assert any(s.upper().startswith("ALTER TABLE") and "pending_artifacts" in s for s in spark.sql_text), \
        "the session table must gain a pending_artifacts column on existing tables"
    assert hasattr(w, "record_pending_artifacts"), "AtomicWriter.record_pending_artifacts(pending) writes the session field"
    pending = [{"kind": "docs", "use_case_id": None}, {"kind": "notebook", "use_case_id": "AI01-UC01"},
               {"kind": "genie_instructions", "use_case_id": "O'Neil-1"}]
    spark.sql_text.clear()
    assert w.record_pending_artifacts(pending) is not False
    updates = [s for s in spark.sql_text if "pending_artifacts" in s and s.upper().startswith("UPDATE")]
    assert len(updates) == 1 and "WHERE session_id = 77" in updates[0], spark.sql_text
    m = re.search(r"pending_artifacts\s*=\s*'((?:[^'\\]|\\.)*)'", updates[0])
    assert m, f"pending_artifacts must be set to a JSON string literal: {updates[0][:300]}"
    stored = json.loads(m.group(1).replace("\\'", "'").replace("\\\\", "\\"))
    assert stored == pending
    spark.sql_text.clear()
    w.record_pending_artifacts([])
    m = re.search(r"pending_artifacts\s*=\s*'((?:[^'\\]|\\.)*)'", spark.sql_text[-1])
    assert m and json.loads(m.group(1)) == [], "an empty list is written as [] (never NULL)"
