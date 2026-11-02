import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace

OBSERVED_NOISE = (
    ("urllib3.connectionpool", logging.DEBUG, '"POST /api/2.0/workspace/import HTTP/1.1" 200 None'),
    ("databricks.sdk", logging.DEBUG, "POST /api/2.0/workspace/import"),
    ("databricks.sdk.retries", logging.DEBUG, "Retry attempt 1 of the import"),
    ("fontTools.subset", logging.INFO, "Glyph names: [space, a, b]"),
    ("fontTools.ttLib.ttFont", logging.DEBUG, "Reading 'maxp' table from disk"),
    ("weasyprint.progress", logging.INFO, "Step 2 - Fetching and parsing CSS - CSS string"),
    ("matplotlib.font_manager", logging.DEBUG, "findfont: Matching sans-serif"),
    ("PIL.PngImagePlugin", logging.DEBUG, "STREAM b'IHDR' 16 13"),
    ("mlflow.tracking", logging.INFO, "mlflow tracking store ready"),
    ("py4j.clientserver", logging.DEBUG, "Command to send: c"),
)


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


@pytest.fixture
def run_log(ns, tmp_path):
    root = logging.getLogger()
    saved_handlers, saved_level = list(root.handlers), root.level
    saved_levels = {name: logging.getLogger(name).level for name, _, _ in OBSERVED_NOISE}
    saved_levels.update({name: logging.getLogger(name).level for name in
                         ("urllib3", "databricks.sdk", "fontTools", "weasyprint", "matplotlib", "PIL", "mlflow", "py4j")})

    def read():
        for handler in logging.getLogger().handlers:
            handler.flush()
        with open(os.path.join(out_dir, "log.txt"), encoding="utf-8") as handle:
            return handle.read()

    out_dir = ns["setup_logging"](str(tmp_path))
    yield read
    for handler in list(root.handlers):
        handler.close()
        root.removeHandler(handler)
    for handler in saved_handlers:
        root.addHandler(handler)
    root.setLevel(saved_level)
    for name, level in saved_levels.items():
        logging.getLogger(name).setLevel(level)


def test_library_debug_and_info_records_stay_out_of_the_run_log(run_log):
    for name, level, message in OBSERVED_NOISE:
        logging.getLogger(name).log(level, message)
    text = run_log()
    leaked = [message for _, _, message in OBSERVED_NOISE if message in text]
    assert not leaked, f"library chatter reached the run log: {leaked}"


def test_the_agent_keeps_its_debug_lines_and_library_warnings_still_show(run_log):
    logging.getLogger("DatabricksInspire").debug("agent debug line kept")
    logging.getLogger("AtomicWriterBootstrap").info("writer info line kept")
    logging.getLogger("urllib3.connectionpool").warning("Connection pool is full, discarding connection")
    logging.getLogger("weasyprint").error("Failed to load stylesheet")
    text = run_log()
    for kept in ("agent debug line kept", "writer info line kept", "Connection pool is full", "Failed to load stylesheet"):
        assert kept in text, kept
