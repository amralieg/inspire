"""v1.0.7 B19 — inspire_database schema pre-flight at widget-validation time.

Customer reproducer on <internal-cli-profile> workspace (job 1234567890000026 attempt 0):

    [TABLE_OR_VIEW_NOT_FOUND] The table or view `inspire_cat`.`_inspire`.`__inspire_step` cannot be found.

Root cause: widget `02_inspire_database='inspire_cat._inspire'` targets a schema
that doesn't exist on the workspace. The pipeline ran ~70s of useful work then
crashed at finalize_atomic_writer when it tried to INSERT into `__inspire_step`.
The downstream TABLE_OR_VIEW_NOT_FOUND masks the real root cause — the operator
sees a table-missing error and doesn't know all they had to do was
`CREATE SCHEMA inspire_cat._inspire`.

v1.0.7 B19 fix: new top-level helper `_ensure_inspire_database_ready(spark,
inspire_database, log_print_fn)` called from widget validation
BEFORE any DatabricksInspire instantiation. Behavior:

  - inspire_database empty                    → (True, None) — no-op
  - schema already exists                     → (True, None)
  - schema missing, CREATE SCHEMA succeeds    → (True, None) + [B19] log line
  - schema missing, catalog missing           → (False, actionable_msg naming catalog)
  - schema missing, CREATE fails generically  → (False, actionable_msg naming both)

The two success branches ('schema exists' vs 'auto-created') are §8.3-non-tautological:
'auto-created' logs a distinctive [B19] marker that 'schema exists' does not.

Fix location:
  - agent/dbx_inspire_ai_agent.ipynb (impl cell) — new helper function after setup_logging
  - agent/dbx_inspire_ai_agent.ipynb (main() function) — call in widget validation right
    after the existing format check for `inspire_database`.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class _MockSparkOK:
    """DESCRIBE SCHEMA succeeds → schema exists."""
    def __init__(self):
        self.calls = []
    def sql(self, q):
        self.calls.append(q)
        return _MockDF()

class _MockSparkSchemaMissingCreateOK:
    """DESCRIBE SCHEMA raises; CREATE SCHEMA succeeds."""
    def __init__(self):
        self.calls = []
    def sql(self, q):
        self.calls.append(q)
        if q.startswith("DESCRIBE SCHEMA"):
            raise Exception("[SCHEMA_NOT_FOUND] Schema `foo`.`bar` cannot be found")
        return _MockDF()

class _MockSparkCatalogMissing:
    """DESCRIBE fails AND CREATE SCHEMA fails with CATALOG_NOT_FOUND."""
    def __init__(self):
        self.calls = []
    def sql(self, q):
        self.calls.append(q)
        if q.startswith("DESCRIBE SCHEMA"):
            raise Exception("[SCHEMA_NOT_FOUND] Schema does not exist")
        if q.startswith("CREATE SCHEMA"):
            raise Exception("[CATALOG_NOT_FOUND] The catalog `inspire_cat` cannot be found")
        return _MockDF()

class _MockSparkGenericCreateFailure:
    """CREATE SCHEMA fails with a generic (non-catalog-missing) error."""
    def __init__(self):
        self.calls = []
    def sql(self, q):
        self.calls.append(q)
        if q.startswith("DESCRIBE SCHEMA"):
            raise Exception("[SCHEMA_NOT_FOUND] Schema does not exist")
        if q.startswith("CREATE SCHEMA"):
            raise Exception("[INSUFFICIENT_PRIVILEGES] User lacks CREATE SCHEMA privilege on catalog inspire_cat")
        return _MockDF()

class _MockDF:
    def collect(self):
        return []


def test_A_empty_inspire_database_is_noop(ns):
    """No inspire_database → return (True, None), zero SQL calls."""
    spark_mock = _MockSparkOK()
    ok, err = ns["_ensure_inspire_database_ready"](spark_mock, "")
    assert ok is True and err is None
    assert spark_mock.calls == []
    # Also whitespace-only
    ok, err = ns["_ensure_inspire_database_ready"](spark_mock, "   ")
    assert ok is True and err is None
    assert spark_mock.calls == []


def test_B_malformed_inspire_database_is_noop(ns):
    """Bad format (no dot, or too many dots) → return (True, None). Format
    validation lives upstream at the format check in widget validation; B19
    must not double-report."""
    spark_mock = _MockSparkOK()
    for bad in ("no_dot", "too.many.dots.here", ".missing_catalog", "missing_schema.", "."):
        ok, err = ns["_ensure_inspire_database_ready"](spark_mock, bad)
        assert ok is True and err is None, f"malformed {bad!r} MUST no-op, got ({ok}, {err})"
    assert spark_mock.calls == []


def test_C_schema_exists_returns_ok(ns):
    """DESCRIBE SCHEMA succeeds → schema present → return (True, None). No CREATE issued."""
    spark_mock = _MockSparkOK()
    logs = []
    ok, err = ns["_ensure_inspire_database_ready"](
        spark_mock, "inspire_cat._inspire", log_print_fn=logs.append
    )
    assert ok is True and err is None
    assert len(spark_mock.calls) == 1
    assert spark_mock.calls[0].startswith("DESCRIBE SCHEMA")
    assert "inspire_cat" in spark_mock.calls[0] and "_inspire" in spark_mock.calls[0]
    # §8.3 non-tautology: 'schema exists' branch MUST NOT emit [B19] marker
    assert not any("[B19]" in m for m in logs), (
        "B19 §8.3: 'schema exists' branch MUST NOT emit [B19] auto-create marker — "
        "otherwise the two success branches are indistinguishable"
    )


def test_D_schema_auto_created_returns_ok_with_marker(ns):
    """Schema missing but CREATE SCHEMA IF NOT EXISTS succeeds → (True, None)
    AND [B19] log line. §8.3 non-tautology: this branch is observably different
    from 'schema exists'."""
    spark_mock = _MockSparkSchemaMissingCreateOK()
    logs = []
    ok, err = ns["_ensure_inspire_database_ready"](
        spark_mock, "inspire_cat._inspire", log_print_fn=logs.append
    )
    assert ok is True and err is None
    # DESCRIBE first, then CREATE SCHEMA
    assert len(spark_mock.calls) == 2
    assert spark_mock.calls[0].startswith("DESCRIBE SCHEMA")
    assert spark_mock.calls[1].startswith("CREATE SCHEMA IF NOT EXISTS")
    # §8.3 non-tautology: auto-created branch MUST emit [B19] marker
    b19_lines = [m for m in logs if "[B19]" in m]
    assert len(b19_lines) == 1, (
        f"B19: auto-created branch MUST emit exactly one [B19] line, got {b19_lines}"
    )
    assert "Auto-created" in b19_lines[0]
    assert "inspire_cat._inspire" in b19_lines[0]


def test_E_catalog_missing_returns_actionable_error(ns):
    """CREATE fails with CATALOG_NOT_FOUND → (False, msg) naming the catalog and
    the user's action."""
    spark_mock = _MockSparkCatalogMissing()
    ok, err = ns["_ensure_inspire_database_ready"](spark_mock, "inspire_cat._inspire")
    assert ok is False, "catalog-missing MUST fail early"
    assert err is not None
    # Message must name the catalog, name the user action, and start with the ❌ marker.
    assert err.startswith("❌"), f"error msg must start with ❌ marker, got {err!r}"
    assert "inspire_cat" in err, (
        f"error msg MUST name the missing catalog 'inspire_cat', got {err!r}"
    )
    assert "CREATE CATALOG" in err, (
        f"error msg MUST name the fix action 'CREATE CATALOG …', got {err!r}"
    )
    # Root cause must be included so the operator can trace it.
    assert "CATALOG_NOT_FOUND" in err or "cannot be found" in err.lower()


def test_F_generic_create_failure_returns_actionable_error(ns):
    """CREATE fails with non-catalog-missing error → (False, msg) with the raw
    root-cause verbatim so the operator can fix it (e.g. missing privilege)."""
    spark_mock = _MockSparkGenericCreateFailure()
    ok, err = ns["_ensure_inspire_database_ready"](spark_mock, "inspire_cat._inspire")
    assert ok is False
    assert err is not None
    assert err.startswith("❌")
    assert "inspire_cat._inspire" in err
    assert "CREATE SCHEMA" in err, (
        f"error msg MUST name the fix action 'CREATE SCHEMA …', got {err!r}"
    )
    # Root cause (privilege error) must be surfaced so the operator can act.
    assert "INSUFFICIENT_PRIVILEGES" in err or "privilege" in err.lower()


def test_G_source_contains_B19_marker_and_create_schema():
    """§8.7 runner's test: [B19] marker + `CREATE SCHEMA IF NOT EXISTS` must
    appear in `_ensure_inspire_database_ready` body; the helper must be defined
    and the call site in `main()` widget validation must exist."""
    src = agent_source()
    idx_fn = src.find("def _ensure_inspire_database_ready(")
    assert idx_fn != -1, (
        "B19: `_ensure_inspire_database_ready` top-level helper MUST be defined "
        "in the impl cell (grep-verifiable at deploy time)"
    )
    # Body extends to the next `def ` at column 0
    idx_end = src.find("\ndef ", idx_fn + 1)
    body = src[idx_fn:idx_end]
    assert "[B19]" in body, (
        "B19: `_ensure_inspire_database_ready` MUST emit `[B19]` log marker"
    )
    assert "CREATE SCHEMA IF NOT EXISTS" in body, (
        "B19: helper MUST call `CREATE SCHEMA IF NOT EXISTS …`"
    )
    assert "DESCRIBE SCHEMA" in body, (
        "B19: helper MUST call `DESCRIBE SCHEMA` first to detect the exists case "
        "(so the exists/auto-created branches are §8.3-non-tautological)"
    )
    # Call site in main() — inside widget validation, right after format check.
    assert "_ensure_inspire_database_ready(" in src.replace(
        "def _ensure_inspire_database_ready(", ""
    ), (
        "B19: helper MUST be CALLED from at least one site (not dead code per §8.4)"
    )
    assert "spark, inspire_database" in src or "spark_session, inspire_database" in src, (
        "B19: call site must pass spark + inspire_database"
    )
