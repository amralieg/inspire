"""Fix #3: Log-capture reorder — extract _stop_live_log_stream, finally-wrap
_upload_log_file, reorder end-of-run reports (honesty/summary/manager-stats/
SUCCESS) BEFORE upload, wrap failure paths in try/finally.

Evidence: rescue commit 5a04f0e cited "6/6 v1.5.x runs — the end-of-run banner,
honesty score, manager-stats table and SUCCESS log line were all written AFTER
_upload_log_file had already stopped the live-log daemon; those lines existed
in the local FileHandler but never made it to /Volumes/.../session_<sid>/log.log".

v0.9.0 base bug (agent/dbx_inspire_ai_agent.ipynb line 31356):
    def _upload_log_file(self):
        # stop daemon FIRST -> any log emitted after this point escapes the volume
        _vstop.set(); _vthread.join(timeout=5.0)
        ...read file, upload, done...
And callers (line 17498 docs-only, 19232 normal):
    self._upload_log_file()           # <-- fires first
    AIAgent.get_summary_report()      # <-- these emit AFTER daemon is dead
    self.ai_agent.get_manager_stats_report()
    log_print("SUCCESS: ...")

Fix (single commit, root cause per Section 3):
1. New helper method `_stop_live_log_stream(tag)` — idempotent daemon shutdown
   guarded by `_volume_log_stream_stopped` attribute. Emits
   `[G30 LIVE_LOG_STREAM_STOPPED FIRED] tag=<tag>` once per run.
2. `_upload_log_file` now:
     - idempotent (guarded by `_upload_log_done` attribute),
     - logs `[G28 END_OF_RUN_LOG_CAPTURE FIRED]` at entry,
     - wraps the read/copy/upload work in try/... FINALLY,
     - the finally block calls `_stop_live_log_stream(tag="upload_log_file")`,
       so the daemon is stopped LAST, guaranteeing every line logged during
       the upload itself makes it to the volume.
3. Both docs-only-mode success path (line 17498) and normal success path
   (line 19232) reordered — every SUCCESS-banner / summary / honesty / manager
   log fires BEFORE `_upload_log_file()` at the end of the path.
4. Both failure paths (line 17509 docs-only, 17523 generate-mode) now wrap
   `self._upload_log_file()` in `try/except Exception: pass` after the
   summary/manager reports and BEFORE `raise`, so a FATAL exit still
   propagates the log. Sentinel `[G29 FAILURE_LOG_UPLOAD FIRED] path=<mode>`.
"""
import sys
import os
import re
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _notebook_body():
    return (Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb").read_text()


def test_stop_live_log_stream_method_extracted(ns):
    body = _notebook_body()
    assert "def _stop_live_log_stream(self, tag=" in body, \
        "Fix #3 requires _stop_live_log_stream helper method"


def test_stop_live_log_stream_is_idempotent(ns):
    body = _notebook_body()
    assert "_volume_log_stream_stopped" in body, \
        "_stop_live_log_stream must guard on _volume_log_stream_stopped"
    assert "self._volume_log_stream_stopped = True" in body


def test_g30_sentinel_present(ns):
    body = _notebook_body()
    assert "[G30 LIVE_LOG_STREAM_STOPPED FIRED]" in body


def test_upload_log_file_is_idempotent(ns):
    body = _notebook_body()
    assert '_upload_log_done' in body, \
        "_upload_log_file must guard on _upload_log_done"
    assert 'self._upload_log_done = True' in body


def test_g28_sentinel_present(ns):
    body = _notebook_body()
    assert "[G28 END_OF_RUN_LOG_CAPTURE FIRED]" in body


def test_g29_sentinel_present_in_both_failure_paths(ns):
    body = _notebook_body()
    fired = re.findall(r'\[G29 FAILURE_LOG_UPLOAD FIRED\] path=(\w+)', body)
    assert "docs_only_mode" in fired, "docs-only failure path must fire G29 with tag=docs_only_mode"
    assert "generate_mode" in fired, "generate-mode failure path must fire G29 with tag=generate_mode"


def test_upload_log_file_has_finally_clause(ns):
    body = _notebook_body()
    upload_match = re.search(
        r'"    def _upload_log_file\(self\):\\n"[\s\S]*?"# COMMAND ----------\\n"',
        body
    )
    assert upload_match, "could not locate _upload_log_file body"
    method_body = upload_match.group(0)
    assert '"        finally:\\n"' in method_body, \
        "_upload_log_file must have a finally clause to stop the live-log stream last"
    assert 'self._stop_live_log_stream(tag=\\"upload_log_file\\")' in method_body


def test_upload_log_file_does_not_stop_daemon_first(ns):
    """The v0.9.0 base bug was `_upload_log_file` starting with _vstop.set() /
    _vthread.join. After the fix the shutdown must be in the finally block only."""
    body = _notebook_body()
    m = re.search(
        r'"    def _upload_log_file\(self\):\\n"([\s\S]*?)"        log_file_path = None\\n"',
        body
    )
    assert m, "could not locate the pre-body of _upload_log_file"
    preamble = m.group(1)
    assert '_vstop.set()' not in preamble, \
        "the pre-body of _upload_log_file must not stop the daemon before reading the file"
    assert '_vthread.join' not in preamble, \
        "the pre-body of _upload_log_file must not join the daemon before reading the file"


def test_docs_only_success_path_uploads_last(ns):
    body = _notebook_body()
    docs_success_match = re.search(
        r'"                    f\\"✅ SUCCESS: All artifacts for \{self\.business_name\} generated successfully from JSON\\",\\n"'
        r'[\s\S]{0,500}',
        body
    )
    assert docs_success_match, "docs-only SUCCESS banner not found"
    tail = docs_success_match.group(0)
    idx_success = tail.find('log_print(f\\"{\'=\'*80}\\\\n\\")')
    idx_upload = tail.find('self._upload_log_file()')
    assert idx_success != -1 and idx_upload != -1
    assert idx_upload > idx_success, \
        "docs-only path: _upload_log_file must fire AFTER the SUCCESS banner block"


def test_normal_success_path_uploads_last(ns):
    body = _notebook_body()
    m = re.search(
        r'"        self\._report_processing_honesty\(\)\\n"[\s\S]{0,600}',
        body
    )
    assert m, "normal-path honesty->upload region not found"
    region = m.group(0)
    idx_honesty = region.find('self._report_processing_honesty()')
    idx_summary = region.find('AIAgent.get_summary_report()')
    idx_manager = region.find('self.ai_agent.get_manager_stats_report()')
    idx_upload = region.find('self._upload_log_file()')
    for name, idx in [("honesty", idx_honesty), ("summary", idx_summary),
                      ("manager", idx_manager), ("upload", idx_upload)]:
        assert idx != -1, f"missing {name} call in success region"
    assert idx_honesty < idx_summary < idx_manager < idx_upload, \
        f"normal-mode ordering must be: honesty ({idx_honesty}) < summary ({idx_summary}) < manager ({idx_manager}) < upload ({idx_upload})"


def test_failure_paths_include_upload_log_file(ns):
    body = _notebook_body()
    for banner in [
        "Failed to process in docs-only mode:",
        "Generate Use Cases mode failed:",
    ]:
        pos = body.find(banner)
        assert pos != -1, f"missing banner: {banner}"
        window = body[pos:pos + 2000]
        assert 'self._upload_log_file()' in window, \
            f"failure path for {banner!r} must call _upload_log_file before raise"
        assert 'raise' in window
        upload_idx = window.find('self._upload_log_file()')
        raise_idx = window.find('"                raise\\n"')
        if raise_idx == -1:
            raise_idx = window.rfind('raise')
        assert upload_idx < raise_idx, f"upload must precede raise in {banner!r} failure path"


def test_stop_live_log_stream_marks_flag_once(ns):
    """Runtime probe: instantiate the stop helper on a fake self, verify
    idempotence — second call must be a no-op (no double-join, no double log)."""
    body = _notebook_body()
    match = re.search(
        r'"    def _stop_live_log_stream\(self, tag=\\"finalize\\"\):\\n"([\s\S]*?)"    def _upload_log_file',
        body
    )
    assert match, "could not extract _stop_live_log_stream source"
    lines = []
    for raw in match.group(1).split('\n'):
        stripped = raw.strip()
        if not stripped.startswith('"'):
            continue
        inner = stripped
        if inner.endswith(','):
            inner = inner[:-1]
        if inner.startswith('"') and inner.endswith('"'):
            inner = inner[1:-1]
        inner = inner.encode().decode('unicode_escape')
        if inner.endswith('\n'):
            inner = inner[:-1]
        lines.append(inner)
    src = "def _stop_live_log_stream(self, tag=\"finalize\"):\n" + "\n".join(lines[:20])

    calls = []
    class _FakeSelf:
        _volume_log_stream_stopped = False
        class _Logger:
            def info(self, msg, *a, **k):
                calls.append(("info", msg))
            def warning(self, msg, *a, **k):
                calls.append(("warning", msg))
            def error(self, msg, *a, **k):
                calls.append(("error", msg))
        logger = _Logger()

    ns_local = {}
    exec(src, ns_local)
    fn = ns_local["_stop_live_log_stream"]
    fake = _FakeSelf()
    fn(fake, tag="first")
    fn(fake, tag="second_should_be_noop")
    fired = [c for c in calls if "[G30 LIVE_LOG_STREAM_STOPPED FIRED]" in c[1]]
    assert len(fired) == 1, \
        f"idempotent stop must log G30 once, got {len(fired)}: {fired}"
    assert "tag=first" in fired[0][1]
    assert fake._volume_log_stream_stopped is True
