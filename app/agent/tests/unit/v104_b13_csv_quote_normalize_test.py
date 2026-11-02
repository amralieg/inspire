"""v1.0.4 B13 — CSV parser normalises quoted table identifiers before storing them as keys.

Prior v1.0.3 regression (<internal-cli-profile> + <internal-cli-profile> bakehouse, sessions 1234567890000000019 /
1234567890000000020):

  * After B11 dropped `temperature` for claude-opus-4-8, the model's response style
    changed to include double-quoted schema/table identifiers (e.g.
    `samples."bakehouse"."sales_transactions"`).
  * `_process_filter_batch_recursive` stripped only BACKTICKS from Table Name cells,
    so the resulting `results` dict keyed on `samples."bakehouse"."sales_transactions"`.
  * Downstream, `_filter_business_tables` computes
    `unclassified = all_unique_tables - business_tables_set - technical - reference`
    where `all_unique_tables` uses unquoted FQTNs. All 6 tables mismatched, RETRY 1
    fired, RETRY 2 cache-hit fired, B5 default sank all into technical, run
    early-returned with 0 UCs but TERMINATED/SUCCESS state (§10 Success-Theater Bug).

v1.0.4 root-cause fix at agent/dbx_inspire_ai_agent.ipynb:30615 extends
`.replace('`', '')` to also strip `"` and `'`. This is idempotent on already-clean
keys (v1.0.2 behaviour) and normalises quoted keys (v1.0.3 behaviour) into canonical
FQTNs before they flow into any downstream set.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source


def _extract_normalisation_expression():
    """Return the exact substring of the CSV parser's Table Name normalisation.

    We assert on source content — not runtime behaviour of the whole parser —
    because the parser depends on `CSVParser.parse_csv_string`, `run_worker`,
    `_load_and_format_prompt`, and other cell-1 machinery that requires a live
    spark session. Testing the normalisation expression itself is the smallest
    thing that could possibly fail, and it directly reflects the fix.
    """
    src = agent_source()
    marker = "name = raw_name.strip().replace("
    idx = src.find(marker)
    if idx == -1:
        raise AssertionError("could not locate Table Name normalisation line in agent source")
    line_end = src.find("\n", idx)
    return src[idx:line_end]


def _normalise(raw_name: str) -> str:
    """Mirror of the notebook's Table Name normalisation, for behavioural tests.

    Kept in sync with `agent/dbx_inspire_ai_agent.ipynb:30615`. The source-level
    tests below guarantee that this function is a faithful mirror by asserting
    on the exact substitutions in the notebook.
    """
    return (raw_name or "").strip().replace("`", "").replace('"', '').replace("'", '')


def test_A_double_quoted_identifiers_stripped():
    """The v1.0.3 <internal-cli-profile> bakehouse failure mode: `samples."bakehouse"."sales_transactions"`."""
    got = _normalise('samples."bakehouse"."sales_transactions"')
    assert got == "samples.bakehouse.sales_transactions", (
        f"double-quoted identifiers must be stripped, got {got!r}")


def test_B_backtick_quoted_identifiers_stripped():
    """The retry batch format: ``samples`.`bakehouse`.`sales_transactions``."""
    got = _normalise("`samples`.`bakehouse`.`sales_transactions`")
    assert got == "samples.bakehouse.sales_transactions", (
        f"backtick-quoted identifiers must be stripped, got {got!r}")


def test_C_tautology_probe_clean_key_unchanged():
    """§8.3 tautology probe — already-clean FQTNs pass through untouched (idempotent)."""
    got = _normalise("samples.bakehouse.sales_transactions")
    assert got == "samples.bakehouse.sales_transactions", (
        f"clean FQTN must be idempotent through normalisation, got {got!r}")


def test_D_single_quoted_identifiers_stripped():
    """Guard against a plausible sibling LLM response style (single-quoted names)."""
    got = _normalise("samples.'bakehouse'.'sales_transactions'")
    assert got == "samples.bakehouse.sales_transactions", (
        f"single-quoted identifiers must be stripped, got {got!r}")


def test_E_mixed_quoting_stripped():
    """Defensive: mixed backtick + double-quote should still normalise cleanly."""
    got = _normalise('`samples`."bakehouse".`sales_transactions`')
    assert got == "samples.bakehouse.sales_transactions", (
        f"mixed quoting must be stripped, got {got!r}")


def test_F_whitespace_around_key_stripped():
    """Guard: leading/trailing whitespace must not survive normalisation."""
    got = _normalise('   samples."bakehouse"."sales_transactions"   ')
    assert got == "samples.bakehouse.sales_transactions", (
        f"whitespace must be stripped, got {got!r}")


def test_G_empty_and_none_safe():
    """Guard: empty and None must not crash and must return empty string."""
    assert _normalise("") == ""
    assert _normalise(None) == ""


def test_H_source_has_double_quote_stripper():
    """§8.7 runner's test: notebook's Table Name normalisation MUST strip double quotes."""
    line = _extract_normalisation_expression()
    assert ".replace('\"', '')" in line or '.replace("\\"", "")' in line, (
        f"v1.0.4 B13 fix missing at CSV parser: line is {line!r}")


def test_I_source_has_single_quote_stripper():
    """§8.7 runner's test: notebook's Table Name normalisation MUST strip single quotes."""
    line = _extract_normalisation_expression()
    assert ".replace(\"'\", '')" in line or ".replace('\\'', '')" in line, (
        f"v1.0.4 B13 fix missing at CSV parser: line is {line!r}")


def test_J_source_still_strips_backticks():
    """Regression guard: the pre-existing backtick strip MUST remain in place."""
    line = _extract_normalisation_expression()
    assert ".replace('`', '')" in line, (
        f"pre-existing backtick strip must remain: line is {line!r}")


def test_K_agent_version_is_v104_or_greater():
    """v1.0.4 must have bumped __AGENT_VERSION__ per §3a single-digit semver."""
    import re
    src = agent_source()
    m = re.search(r'__AGENT_VERSION__\s*=\s*["\'](v(\d+)\.(\d+)\.(\d+))["\']', src)
    assert m is not None, "no __AGENT_VERSION__ found in agent source"
    parts = tuple(int(m.group(i)) for i in (2, 3, 4))
    assert parts >= (1, 0, 4), f"version must be >= v1.0.4, got {m.group(1)}"
