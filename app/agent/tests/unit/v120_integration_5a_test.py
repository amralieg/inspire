"""v1.2.0 INTEGRATION-5a (FINAL-INTEGRATION-B1): SQL quoting, the Volume live log, em dashes, final status.

1. Bound parameters are never escaped. `_ai_query_rows` doubled every apostrophe of a prompt it then bound as
   `:prompt_text`, so the model received `product''s` and wrote it back. Values that must be interpolated into
   SQL text use one escaper, `inspire_sql_literal`, defined in the Genie harness (which Inspire executes) and
   reused by the tracking writer. It escapes with a backslash, which every Spark version reads; `''` is chained
   into nothing by the Spark 3.5 and 4.0 lexers, so the tracking tables silently lost apostrophes there. The
   harness prompts no longer strip apostrophes, backslashes and percent signs.
2. A UC Volume file accepts one sequential write from a fresh open: append and seek fail with `[Errno 29]
   Illegal seek` (58 live-log flush failures in one live run). Every changed snapshot is written whole, and the
   end-of-run copy to a Volume output no longer calls utime or chmod.
3. Prompts whose output is customer-facing prose carry no em dash and the shared NO_EM_DASH_RULE.
4. The final status of a failed run still carries failed steps, lost tables and endpoint health.

Every behavioural fix has a case that fails on 6a3a9cb and a must-exclude case.
"""
import ast
import builtins
import errno
import json
import logging
import os
import re
import shutil
import sys
import threading
import types
import uuid

import pytest

os.environ.setdefault("MPLBACKEND", "Agg")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_ast  # noqa: E402
from v120_artifacts_support import CapturingLogger, make_inspire  # noqa: E402
from v120_integration_3_test import LOST, _ReportingLoader  # noqa: E402
from v120_prompt_calibration_test import _render  # noqa: E402
from v120_runtime_reliability_test import FakeConnectSpark, RecordingLogger, make_agent, use_roster  # noqa: E402

EM = "\u2014"


# ---------------------------------------------------------------- Spark string literal lexer


SPARK_BACKSLASH_ESCAPES = {"0": "\x00", "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a", "%": "\\%", "_": "\\_"}


def spark_literals(sql, quote_quote_is_escape):
    """Spark's STRING_LITERAL token plus unescapeSQLString. Spark 3.5 and 4.0 end a literal at the second quote of
    `''` and chain adjacent literals ('a''b' reads ab); Spark 4.1 reads `''` as one quote. Backslash escapes are
    read by every version."""
    found, i = [], 0
    while i < len(sql):
        ch = sql[i]
        if ch == "`":
            i = sql.index("`", i + 1) + 1
            continue
        if ch != "'":
            i += 1
            continue
        start, j, buf = i, i + 1, []
        while True:
            c = sql[j]
            if c == "\\":
                nxt = sql[j + 1]
                if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", sql[j + 2:j + 6]):
                    buf.append(chr(int(sql[j + 2:j + 6], 16)))
                    j += 6
                elif re.fullmatch(r"[01][0-7]{2}", sql[j + 1:j + 4]):
                    buf.append(chr(int(sql[j + 1:j + 4], 8)))
                    j += 4
                else:
                    buf.append(SPARK_BACKSLASH_ESCAPES.get(nxt, nxt))
                    j += 2
                continue
            if c == "'":
                if quote_quote_is_escape and sql[j + 1:j + 2] == "'":
                    buf.append("'")
                    j += 2
                    continue
                break
            buf.append(c)
            j += 1
        value, end = "".join(buf), j + 1
        if found and not sql[found[-1][2]:start].strip():
            found[-1] = (found[-1][0] + value, found[-1][1], end)
        else:
            found.append((value, start, end))
        i = end
    return found


def literal_values(sql, quote_quote_is_escape):
    return [value for value, _, _ in spark_literals(sql, quote_quote_is_escape)]


def literal_by_alias(sql, quote_quote_is_escape):
    out = {}
    for value, _, end in spark_literals(sql, quote_quote_is_escape):
        m = re.match(r"\)?\s+AS\s+(\w+)", sql[end:])
        if m:
            out[m.group(1)] = value
    return out


BOTH_LEXERS = pytest.mark.parametrize("quote_quote_is_escape", [False, True], ids=["spark-3.5-4.0", "spark-4.1"])

SQL_TEXTS = [
    "plain words",
    "the product's owner",
    "''already doubled''",
    "one \\ backslash",
    "two \\\\ backslashes",
    "\\'",
    "C:\\new\\table",
    "line\nbreak\ttab",
    "\u0645\u0646\u062a\u062c \u0627\u0644\u0639\u0645\u064a\u0644's",
    "caf\u00e9 \U0001F4C8 \u4e2d\u6587",
    "50% {x} ${y} %s",
    "\\u0041 \\012",
    "",
    "ends with a backslash \\",
]


def test_the_lexer_reads_doubled_quotes_the_way_each_spark_version_does():
    assert literal_values("SELECT 'it''s'", False) == ["its"]
    assert literal_values("SELECT 'it''s'", True) == ["it's"]
    assert literal_values("SELECT 'a' 'b'", False) == ["ab"]
    assert literal_values("SELECT 'it\\'s'", False) == ["it's"]
    assert literal_values("SELECT 'a\\b'", False) == ["a\b"]
    assert literal_values("SELECT `x'y`, 'z'", False) == ["z"]


@BOTH_LEXERS
@pytest.mark.parametrize("text", SQL_TEXTS)
def test_sql_literal_round_trips_under_every_spark_lexer(agent_ns, text, quote_quote_is_escape):
    literal = agent_ns["inspire_sql_literal"](text)
    assert literal_values("SELECT " + literal, quote_quote_is_escape) == [text]


def test_sql_literal_treats_none_as_empty(agent_ns):
    assert agent_ns["inspire_sql_literal"](None) == "''"


# ---------------------------------------------------------------- 1. bound parameters are never escaped


class BindingSpark:
    def __init__(self):
        self.calls = []

    def sql(self, query, args=None):
        self.calls.append({"query": query, "args": dict(args or {})})
        return types.SimpleNamespace(collect=lambda: [types.SimpleNamespace(ai_response="ok")])


@pytest.mark.parametrize("text", [t for t in SQL_TEXTS if t])
@pytest.mark.parametrize("response_format", [None, '{"type": "json_schema"}'])
def test_ai_query_binds_the_prompt_byte_for_byte(agent_ns, text, response_format):
    spark = BindingSpark()
    agent_ns["_ai_query_rows"](spark, "databricks-x", text, 64, response_format=response_format)
    call = spark.calls[0]
    assert call["args"]["prompt_text"] == text
    assert call["args"]["prompt_text"].encode("utf-8") == text.encode("utf-8")
    assert ":prompt_text" in call["query"]
    if response_format:
        assert call["args"]["resp_fmt"] == response_format


def test_the_prompt_never_appears_in_the_sql_text(agent_ns):
    spark = BindingSpark()
    text = "Rank the product's renewals by risk"
    agent_ns["_ai_query_rows"](spark, "databricks-x", text, 64)
    assert text not in spark.calls[0]["query"] and "product" not in spark.calls[0]["query"]


def test_call_ai_query_sends_the_rendered_prompt_unchanged(fresh_ns):
    use_roster(fresh_ns, "databricks-x")
    spark = FakeConnectSpark(lambda op: "ok")
    agent = make_agent(fresh_ns, spark, RecordingLogger())
    prompt = "The product's owner said \"it's done\" \\ C:\\tmp \u0645\u0646\u062a\u062c 50%"
    assert agent._call_ai_query(prompt, "SUMMARY_GEN_PROMPT") == "ok"
    sent = [op["args"]["prompt_text"] for op in spark.ops]
    assert sent == [fresh_ns["with_user_directive_preamble"](prompt)]
    assert "product's" in sent[0] and "product''s" not in sent[0]


def test_startup_probe_binds_its_prompt_verbatim(fresh_ns):
    fresh_ns["_LLM_ENDPOINT_PROBE_PROMPT"] = "Reply with the word OK; it's a probe."
    spark = BindingSpark()
    assert fresh_ns["_probe_llm_endpoint"](spark, "databricks-x", RecordingLogger()) == "usable"
    assert spark.calls[0]["args"]["prompt_text"] == "Reply with the word OK; it's a probe."


ESCAPERS = {"replace_single_quote", "_escape_sql_str", "inspire_sql_literal", "_inspire_sql_text"}


def _escaping_calls(node):
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            func = sub.func
            name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
            if name in ESCAPERS or name == "replace":
                yield sub


def _bound_escapes(tree):
    offenders = []
    for func in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        dicts = {}
        for node in ast.walk(func):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict):
                dicts.update({t.id: node.value for t in node.targets if isinstance(t, ast.Name)})
        for node in ast.walk(func):
            if not isinstance(node, ast.Call):
                continue
            bound = [kw.value for kw in node.keywords if kw.arg == "args"]
            if isinstance(node.func, ast.Attribute) and node.func.attr == "sql" and len(node.args) >= 2:
                bound.append(node.args[1])
            for value in bound:
                target = dicts.get(value.id) if isinstance(value, ast.Name) else value
                if isinstance(target, ast.Dict) and any(next(_escaping_calls(v), None) for v in target.values):
                    offenders.append((func.name, node.lineno))
    return offenders


def test_the_bound_escape_scanner_catches_an_escaped_bound_value():
    tree = ast.parse("def f(spark, p):\n    a = {'p': p.replace(\"'\", \"''\")}\n    spark.sql('SELECT :p', args=a)\n"
                     "def g(spark, p):\n    spark.sql('SELECT :p', {'p': inspire_sql_literal(p)})\n"
                     "def h(spark, p):\n    spark.sql('SELECT :p', args={'p': p})\n")
    assert [name for name, _ in _bound_escapes(tree)] == ["f", "g"]


def test_no_sql_call_binds_an_escaped_value(agent_ns):
    assert _bound_escapes(agent_ast()) == []
    assert _bound_escapes(ast.parse(agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE)) == []


def test_one_sql_escaper_in_the_agent(agent_ns):
    src = ast.unparse(agent_ast())
    assert "def replace_single_quote(" not in src and "_escape_sql_str" not in src
    assert "chr(39)" not in src
    assert src.count("def inspire_sql_literal(") == 1 and "_inspire_sql_text" not in src
    assert "GENIE_HARNESS_SOURCE" not in agent_ns


# ---------------------------------------------------------------- 1. tracking SQL keeps quotes and backslashes


class RawSpark:
    def __init__(self, holders=()):
        self.statements = []
        self.holders = list(holders)
        self._lock = threading.Lock()

    def sql(self, statement, args=None):
        with self._lock:
            self.statements.append(statement)
        rows = list(self.holders) if statement.lstrip().startswith("SELECT DISTINCT session_id") else []
        return types.SimpleNamespace(collect=lambda: rows)


def _raw_writer(ns, spark, tmp_path, monkeypatch, **widget_values):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    writer = ns["AtomicWriter"](spark, CapturingLogger(), "my-cat.inspire", 5150, widget_values=widget_values)
    writer._session_writer.stop(drain_timeout=5.0)
    writer._session_writer = None
    return writer


NAME = "O'Brien \\ S\u00f6hne"


@BOTH_LEXERS
def test_lock_literals_keep_the_business_name(agent_ns, tmp_path, monkeypatch, quote_quote_is_escape):
    spark = RawSpark()
    writer = _raw_writer(agent_ns, spark, tmp_path, monkeypatch)
    spark.holders = [(5150, "it's the op" + writer._lock_holder)]
    assert writer.acquire_lock(f"  {NAME}  ", ttl_seconds=60, holder_note="it's the op") is True
    merge = next(s for s in spark.statements if s.startswith("MERGE INTO"))
    aliases = literal_by_alias(merge, quote_quote_is_escape)
    assert aliases["business_name"] == NAME and aliases["holder_note"] == "it's the op" + writer._lock_holder
    holders = next(s for s in spark.statements if s.startswith("SELECT DISTINCT session_id"))
    assert literal_values(holders, quote_quote_is_escape) == [NAME]
    writer.release_lock(f"  {NAME}  ")
    delete = next(s for s in spark.statements if s.startswith("DELETE FROM"))
    assert literal_values(delete, quote_quote_is_escape) == [NAME, "%" + writer._lock_holder]


@BOTH_LEXERS
def test_session_row_keeps_widget_text(agent_ns, tmp_path, monkeypatch, quote_quote_is_escape):
    spark = RawSpark()
    writer = _raw_writer(agent_ns, spark, tmp_path, monkeypatch, business="Acme's",
                         generation_instructions="Don't use C:\\temp; keep 'quotes'", business_domains="R&D, Sales")
    writer.initialize_session()
    merge = next(s for s in spark.statements if "MERGE INTO" in s)
    aliases = literal_by_alias(merge, quote_quote_is_escape)
    assert aliases["business_name"] == "Acme's"
    assert aliases["strategic_goals"] == "Don't use C:\\temp; keep 'quotes'"
    assert aliases["business_domains"] == "R&D, Sales"
    assert json.loads(aliases["inspire_json"]) == {}


@BOTH_LEXERS
def test_prompt_context_update_keeps_the_text(agent_ns, tmp_path, monkeypatch, quote_quote_is_escape):
    spark = RawSpark()
    writer = _raw_writer(agent_ns, spark, tmp_path, monkeypatch)
    context = "The firm's data \\ lake, \u0628\u064a\u0627\u0646\u0627\u062a 'raw'"
    writer.update_session_prompt_context({"enriched_business_context": context})
    update = next(s for s in spark.statements if s.startswith("UPDATE"))
    assert literal_values(update, quote_quote_is_escape) == [context]


@BOTH_LEXERS
def test_final_results_json_survives_the_sql_literal(agent_ns, tmp_path, monkeypatch, quote_quote_is_escape):
    spark = RawSpark()
    writer = _raw_writer(agent_ns, spark, tmp_path, monkeypatch)
    payload = {"note": "it's done", "path": "C:\\x\\n", "lang": "\u0639\u0631\u0628\u064a", "failed_steps": [{"error": "can't import"}]}
    writer._finalize_session("2026-10-05 05:00:00", final_results_json=payload)
    finalize = next(s for s in spark.statements if "results_json = parse_json(" in s)
    parsed = [json.loads(v) for v in literal_values(finalize, quote_quote_is_escape) if v.startswith("{")]
    assert parsed == [payload, payload]
    writer._update_session_ready("2026-10-05 05:00:00", 1.0)
    ready = spark.statements[-1]
    assert [json.loads(v) for v in literal_values(ready, quote_quote_is_escape) if v.startswith("{")] == [
        {"last_flush": "2026-10-05 05:00:00"}]


# ---------------------------------------------------------------- 1. harness prompts keep the text


def _harness_prompt_literal(sql, needle):
    for quote_quote_is_escape in (False, True):
        values = [v for v in literal_values(sql, quote_quote_is_escape) if needle in v]
        assert len(values) == 1, (quote_quote_is_escape, values)
        yield values[0]


# ---------------------------------------------------------------- 2. the live log on a UC Volume


class SequentialVolumeFile:
    def __init__(self, volume, path, binary):
        self.volume, self.path, self.binary = volume, path, binary
        self.chunks = []
        self.closed = False
        builtins.open(path, "wb").close()

    def write(self, data):
        self.chunks.append(data)
        return len(data)

    def _illegal(self, name):
        self.volume.violations.append((name, self.path))
        raise OSError(errno.ESPIPE, "Illegal seek", self.path)

    def seek(self, *a):
        self._illegal("seek")

    def tell(self):
        self._illegal("tell")

    def truncate(self, *a):
        self._illegal("truncate")

    def flush(self):
        return None

    def close(self):
        if not self.closed:
            self.closed = True
            data = (b"" if self.binary else "").join(self.chunks)
            with builtins.open(self.path, "wb" if self.binary else "w") as fh:
                fh.write(data)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FuseVolume:
    """UC Volume FUSE semantics: one sequential write from a fresh open, which leaves the file empty to every reader
    until it closes; append, seek, tell and metadata calls fail with the errors the mount returns."""

    def __init__(self, root):
        self.root = os.path.realpath(str(root))
        self.violations = []
        os.makedirs(self.root, exist_ok=True)

    def owns(self, path):
        return os.path.realpath(str(path)).startswith(self.root + os.sep)

    def open(self, path, mode="r", *args, **kwargs):
        if not self.owns(path) or ("r" in mode and "+" not in mode):
            return builtins.open(path, mode, *args, **kwargs)
        if "a" in mode or "+" in mode:
            self.volume_violation("open:" + mode, path)
        return SequentialVolumeFile(self, str(path), "b" in mode)

    def volume_violation(self, name, path):
        self.violations.append((name, str(path)))
        raise OSError(errno.ESPIPE, "Illegal seek", str(path))

    def guard(self, real):
        def guarded(path, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)) and self.owns(path):
                self.violations.append((real.__name__, str(path)))
                raise PermissionError(errno.EPERM, "Operation not permitted", str(path))
            return real(path, *args, **kwargs)
        return guarded


def test_the_fake_volume_rejects_append_and_seek(tmp_path):
    volume = FuseVolume(tmp_path / "vol")
    with pytest.raises(OSError, match="Illegal seek"):
        volume.open(os.path.join(volume.root, "x.log"), "ab")
    with volume.open(os.path.join(volume.root, "x.log"), "wb") as fh:
        fh.write(b"a")
        with pytest.raises(OSError, match="Illegal seek"):
            fh.tell()
    assert open(os.path.join(volume.root, "x.log"), "rb").read() == b"a"


def test_volume_live_log_is_rewritten_whole_and_never_appended(fresh_ns, tmp_path):
    volume = FuseVolume(tmp_path / "vol")
    fresh_ns["open"] = volume.open
    obj = make_inspire(fresh_ns)
    src = tmp_path / "log.txt"
    dst = os.path.join(volume.root, "logs", "session_1", "log.log")
    os.makedirs(os.path.dirname(dst))
    state = {}
    src.write_bytes(b"line1\n")
    assert obj._flush_live_log_once(str(src), dst, "volume", state) == "rewritten"
    assert obj._flush_live_log_once(str(src), dst, "volume", state) == "unchanged"
    for n in range(2, 5):
        with builtins.open(src, "ab") as fh:
            fh.write(f"line{n} \u0645\u0646\u062a\u062c\n".encode("utf-8"))
        assert obj._flush_live_log_once(str(src), dst, "volume", state) == "rewritten"
        assert builtins.open(dst, "rb").read() == src.read_bytes()
    src.write_bytes(b"restarted\n")
    assert obj._flush_live_log_once(str(src), dst, "volume", state) == "rewritten"
    assert builtins.open(dst, "rb").read() == b"restarted\n"
    assert volume.violations == []


def test_the_fake_volume_file_reads_empty_while_it_is_written(tmp_path):
    volume = FuseVolume(tmp_path / "vol")
    path = os.path.join(volume.root, "x.log")
    builtins.open(path, "wb").write(b"old\n")
    with volume.open(path, "wb") as fh:
        fh.write(b"new\n")
        assert builtins.open(path, "rb").read() == b""
    assert builtins.open(path, "rb").read() == b"new\n"


def _live_log_reads_while_rewritten(fresh_ns, tmp_path, monkeypatch, dst_name):
    volume = FuseVolume(tmp_path / "vol")
    fresh_ns["open"] = volume.open
    obj = make_inspire(fresh_ns)
    src = tmp_path / "log.txt"
    dst = os.path.join(volume.root, "logs", "session_1", dst_name)
    os.makedirs(os.path.dirname(dst))
    state = {}
    src.write_bytes(b"line1\n")
    assert obj._flush_live_log_once(str(src), dst, "volume", state) == "rewritten"
    seen = []
    real = shutil.copyfileobj

    def copy_while_a_reader_polls(fsrc, fdst, length=0):
        seen.append(builtins.open(dst, "rb").read())
        real(fsrc, fdst, length)
        seen.append(builtins.open(dst, "rb").read())

    monkeypatch.setattr(shutil, "copyfileobj", copy_while_a_reader_polls)
    for n in range(2, 5):
        with builtins.open(src, "ab") as fh:
            fh.write(f"line{n}\n".encode())
        assert obj._flush_live_log_once(str(src), dst, "volume", state) == "rewritten"
        assert builtins.open(dst, "rb").read() == src.read_bytes()
    return volume, dst, seen


@pytest.mark.parametrize("dst_name", ["log.log", "log_implement_111122223333444.log"])
def test_a_reader_never_sees_the_live_log_empty_or_cut_while_it_is_rewritten(fresh_ns, tmp_path, monkeypatch, dst_name):
    volume, dst, seen = _live_log_reads_while_rewritten(fresh_ns, tmp_path, monkeypatch, dst_name)
    assert seen == [b"line1\n", b"line1\n", b"line1\nline2\n", b"line1\nline2\n", b"line1\nline2\nline3\n", b"line1\nline2\nline3\n"]
    assert all(seen), "every read during a rewrite returns the whole earlier log"
    assert sorted(os.listdir(os.path.dirname(dst))) == [dst_name], "the finished copy replaced the live file and left no part file"
    assert volume.violations == []


def test_a_failed_live_log_rewrite_keeps_the_last_whole_log_and_leaves_no_part_file(fresh_ns, tmp_path, monkeypatch):
    volume = FuseVolume(tmp_path / "vol")
    fresh_ns["open"] = volume.open
    obj = make_inspire(fresh_ns)
    src = tmp_path / "log.txt"
    dst = os.path.join(volume.root, "logs", "session_1", "log.log")
    os.makedirs(os.path.dirname(dst))
    src.write_bytes(b"line1\n")
    obj._flush_live_log_once(str(src), dst, "volume", {})

    def broken(fsrc, fdst, length=0):
        fdst.write(b"line1\nli")
        raise OSError(errno.EIO, "Input/output error")

    monkeypatch.setattr(shutil, "copyfileobj", broken)
    src.write_bytes(b"line1\nline2\n")
    with pytest.raises(OSError, match="Input/output error"):
        obj._flush_live_log_once(str(src), dst, "volume", {})
    assert builtins.open(dst, "rb").read() == b"line1\n"
    assert os.listdir(os.path.dirname(dst)) == ["log.log"]


def test_volume_live_log_reports_a_real_write_failure(fresh_ns, tmp_path):
    volume = FuseVolume(tmp_path / "vol")
    fresh_ns["open"] = volume.open
    obj = make_inspire(fresh_ns)
    src = tmp_path / "log.txt"
    src.write_bytes(b"x\n")
    with pytest.raises(OSError):
        obj._flush_live_log_once(str(src), os.path.join(volume.root, "missing_dir", "log.log"), "volume", {})


def test_end_of_run_log_copy_to_a_volume_output_succeeds(fresh_ns, tmp_path, monkeypatch):
    volume = FuseVolume(tmp_path / "vol")
    fresh_ns["open"] = volume.open
    monkeypatch.setattr(os, "utime", volume.guard(os.utime))
    monkeypatch.setattr(os, "chmod", volume.guard(os.chmod))
    log_path = tmp_path / "log.txt"
    log_path.write_text("run log line \u0645\u0646\u062a\u062c\n", encoding="utf-8")
    handler = logging.FileHandler(str(log_path))
    logging.root.handlers.insert(0, handler)
    name = f"inspire_volume_copy_test_{uuid.uuid4().hex}"
    out_dir = os.path.join(volume.root, "out")
    try:
        obj = make_inspire(fresh_ns, base_output_dir=out_dir, sanitized_customer_name=name)
        obj._upload_log_file()
        copied = [m for _, m in obj.logger.records if "Log file copied to output directory" in m]
        failed = [m for _, m in obj.logger.records if "Failed to copy log file" in m]
        assert copied and not failed, obj.logger.records
        assert builtins.open(os.path.join(out_dir, "log.txt"), "rb").read() == log_path.read_bytes()
        assert volume.violations == []
    finally:
        logging.root.removeHandler(handler)
        handler.close()
        backup = os.path.join("/tmp", name)
        if os.path.isdir(backup):
            for leaf in os.listdir(backup):
                os.unlink(os.path.join(backup, leaf))
            os.rmdir(backup)


# ---------------------------------------------------------------- 3. no em dash in customer-facing prompts


NARRATIVE_PROMPTS = (
    "BUSINESS_CONTEXT_WORKER_PROMPT",
    "BASE_USE_CASE_GEN_PROMPT",
    "SUMMARY_GEN_PROMPT",
    "USE_CASE_TRANSLATE_PROMPT",
    "COMBINED_VALUE_QUALITY_SCORE_PROMPT",
    "BEST_OF_BEST_SCORING_PROMPT",
    "ULTRA_HIGH_ELITE_JUDGE_PROMPT",
    "USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT",
)
SHARED_PROMPT_BLOCKS = ("QUALITY_GATE_RULES", "QUALITY_GATE_HIGH", "QUALITY_GATE_SCORING_BLOCK", "ASSUMED_CONTEXT_RULE",
                        "USER_DIRECTIVE_SUPREMACY_PREAMBLE", "HONESTY_CHECK_CSV", "HONESTY_CHECK_JSON")


def em_dash_problems(text, rule):
    problems = []
    if EM in text:
        problems.append(f"{text.count(EM)} em dash(es)")
    if rule not in text:
        problems.append("no em dash rule")
    return problems


def test_em_dash_check_flags_a_dash_and_a_missing_rule():
    assert em_dash_problems("a \u2014 b RULE", "RULE") == ["1 em dash(es)"]
    assert em_dash_problems("a, b", "RULE") == ["no em dash rule"]
    assert em_dash_problems("a, b RULE", "RULE") == []


def test_the_em_dash_rule_names_the_character_without_using_it(agent_ns):
    rule = agent_ns["NO_EM_DASH_RULE"]
    assert "em dash" in rule and "U+2014" in rule and EM not in rule and "{" not in rule


@pytest.mark.parametrize("name", NARRATIVE_PROMPTS)
def test_customer_facing_prompt_has_no_em_dash_and_carries_the_rule(agent_ns, name):
    template = agent_ns["PROMPT_TEMPLATES"][name]
    rendered = _render(template, {"quality_gate_block": agent_ns["QUALITY_GATE_HIGH"]})
    assert em_dash_problems(rendered, agent_ns["NO_EM_DASH_RULE"]) == [], name
    assert rendered.count(agent_ns["NO_EM_DASH_RULE"]) == 1, name


@pytest.mark.parametrize("name", SHARED_PROMPT_BLOCKS)
def test_blocks_rendered_into_those_prompts_have_no_em_dash(agent_ns, name):
    assert EM not in agent_ns[name], name


def test_genie_instruction_prompt_no_longer_asks_for_double_hyphens(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT"]
    assert "`--` instead of long dashes" not in template and "plain ASCII characters" in template


PROMPT_FRAGMENT_LISTS = {"feedback_lines", "table_lines"}
PROMPT_FRAGMENT_NAMES = {"_catchall_instruction", "_known_bad_block"}


def _fragment_em_dashes(tree):
    hits = []
    for node in ast.walk(tree):
        exprs = []
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("append", "extend")
                and isinstance(node.func.value, ast.Name) and node.func.value.id in PROMPT_FRAGMENT_LISTS):
            exprs = node.args
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in PROMPT_FRAGMENT_NAMES for t in node.targets):
            exprs = [node.value]
        for expr in exprs:
            hits += [sub.lineno for sub in ast.walk(expr)
                     if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and EM in sub.value]
    return hits


def test_fragment_scanner_finds_a_dash_in_a_prompt_fragment():
    tree = ast.parse("table_lines = []\ntable_lines.append(f'- {t} (PRIMARY \u2014 X)')\n_known_bad_block = 'a \u2014 b'\n"
                     "other = []\nother.append('c \u2014 d')\n")
    assert sorted(_fragment_em_dashes(tree)) == [2, 3]


def test_generation_prompt_fragments_have_no_em_dash():
    assert _fragment_em_dashes(agent_ast()) == []


def test_generation_rejection_feedback_has_no_em_dash(agent_ns):
    obj = make_inspire(agent_ns, registry_lock=threading.Lock(), _known_hallucinated_tables=set())
    text = obj._build_generation_rejection_feedback([
        {"hallucination_reason": "Tables not found in schema: cat.sch.ghost"},
        {"hallucination_reason": "Reference-only use case"},
    ])
    assert "`cat.sch.ghost`" in text and "DOES NOT EXIST" in text and EM not in text


# ---------------------------------------------------------------- 4. final status of a failed run


class _FailureRecorder:
    def __init__(self):
        self.steps = []
        self.flushes = []

    def emit_step(self, **kw):
        self.steps.append(kw)
        return len(self.steps)

    def flush_pending(self, **kw):
        self.flushes.append(kw)


def test_failed_run_final_status_carries_failed_steps_lost_tables_and_endpoint_health(fresh_ns):
    fresh_ns["LLM_ENDPOINT_HEALTH"].mark_unusable("databricks-x", "not supported for batch inference")
    obj = make_inspire(fresh_ns, data_loader=_ReportingLoader(LOST))
    obj._record_failed_step("PDF Catalog", "Arabic", RuntimeError("workspace import limit exceeded"))
    obj.atomic_writer = _FailureRecorder()
    obj.finalize_atomic_writer(success=False, error_message="boom")
    final = obj.atomic_writer.flushes[-1]
    assert final["finalize"] is True
    results = final["final_results_json"]
    assert [(f["step"], f["language"]) for f in results["failed_steps"]] == [("PDF Catalog", "Arabic")]
    assert results["metadata_unavailable"] == {"count": 2, "tables": LOST}
    assert results["llm_endpoint_health"]["unusable"] == {"databricks-x": "not supported for batch inference"}
    assert obj.atomic_writer.steps[-1]["status"] == "ended_error"
