"""Leak gate for the public requirements ledger and CLAUDE.md.

The leak patterns live in app/scripts/ledger_publish.py and are shared with the publisher, so the publisher and this gate
cannot drift apart. The gate fails when app/docs/requirements/ledger.md or the root CLAUDE.md carries a 12-plus digit number, an email
address, a workspace host, a home path, a token-like string, a customer name, a scratch App or catalog name, or a profanity.
Must-fail cases plant each leak and must be caught. Must-keep cases show that public docs URLs and short ids pass.
"""
import pathlib
import sys

import pytest

APP = pathlib.Path(__file__).resolve().parents[3]  # app/
REPO = APP.parent  # the repo root, where CLAUDE.md sits
sys.path.insert(0, str(APP / "scripts"))
import os  # noqa: E402
import tempfile  # noqa: E402

# The gate plants made-up company names; the real list lives outside the repo (INSPIRE_LEDGER_PRIVATE_NAMES).
_NAMES = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
_NAMES.write("contoso\nfabrikam\nnorthwind\n" + (pathlib.Path(os.environ["INSPIRE_LEDGER_PRIVATE_NAMES"]).read_text(encoding="utf-8")
                                                if os.environ.get("INSPIRE_LEDGER_PRIVATE_NAMES") else ""))
_NAMES.close()
os.environ["INSPIRE_LEDGER_PRIVATE_NAMES"] = _NAMES.name
import ledger_publish as lp  # noqa: E402

PUBLIC_FILES = (APP / "docs" / "requirements" / "ledger.md", REPO / "CLAUDE.md")


def kinds(text):
    return sorted({kind for kind, _ in lp.find_leaks(text)})


def test_public_ledger_and_claude_md_have_no_leaks():
    leaks = {}
    for rel in PUBLIC_FILES:
        found = lp.find_leaks(rel.read_text(encoding="utf-8"))
        if found:
            leaks[str(rel)] = found[:10]
    assert leaks == {}


@pytest.mark.parametrize(
    "planted, kind",
    [
        ("run 40478529397665 failed", "12+ digit number"),
        ("job 712d7c96-0000-0000-0000-000000000000 failed", "uuid-like id"),
        ("ask the owner at someone.example@example.com", "email address"),
        ("working in /Users/someone/work/inspire", "home path"),
        ("working in /private/tmp/inspire_scratch/wt/x", "home path"),
        ("reads ~/claude/inspire/notes.md", "home path"),
        ("workspace adb-1234 is up", "workspace host"),
        ("the host name ws.cloud.databricks.com", "workspace host"),
        ("token dapi" + "0123456789abcdef" * 2, "token-like string"),
        ("token ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4", "token-like string"),
        ("key " + "Zm9vYmFyYmF6cXV4" * 3 + "Q1ZyMw==", "token-like string"),
        ("the Contoso programme", "customer name"),
        ("the Fabrikam account", "customer name"),
        ("the Northwind renewal", "customer name"),
        ("the scratch App inspire-customer-fraud-v2", "scratch App name"),
        ("workspace my-uae is up", "scratch workspace name"),
        ("catalog adb_fe_uae_01.default.t", "scratch catalog name"),
        ("the shit design", "profanity"),
        ("you stupid", "profanity"),
    ],
)
def test_must_fail_planted_leak_is_caught(planted, kind):
    assert kind in kinds(planted), f"{kind!r} must be caught in {planted!r}"


@pytest.mark.parametrize(
    "text",
    [
        "see https://docs.databricks.com/en/data-governance/unity-catalog/index.html",
        "see https://learn.microsoft.com/azure/databricks/getting-started",
        "a short id 4321 and a sha f80540dd9 are fine",
        "the version v1.5.3-rc.2 is fine",
        "Tokyo Tidbits and the bakehouse and nyctaxi samples are fine",
        "a plain 11-digit 12345678901 stays",
    ],
)
def test_must_keep_public_text_passes(text):
    assert lp.find_leaks(text) == [], f"must keep {text!r}"


def test_sanitizer_removes_every_planted_leak():
    raw = (
        'REQ-9 | 11-13 | run 40478529397665 by someone@example.com at /Users/someone/x, '
        'host adb-123 is in the notes, token dapi' + "0123456789abcdef" * 2 + ', '
        'catalog amr_ali.sales.orders, app inspire-walk-rc2-planning, workspace my-uae, '
        '"the Contoso programme", "design is shit, remove"'
    )
    clean, counts = lp.sanitize(raw)
    assert lp.find_leaks(clean) == [], clean
    assert counts["12+ digit number"] == 1 and counts["email address"] == 1
    assert counts["paraphrased ask"] == 1


def test_publish_is_deterministic_and_marks_scope():
    ledger = (
        "| REQ | Asked (UTC) | Ask | State | Lane / branch | Evidence | Live acceptance check |\n"
        "|---|---|---|---|---|---|---|\n"
        "| REQ-001 | 11-10 | first ask | DONE (live) | lane a | ev | check |\n"
        "| REQ-002 | 11-10 | second ask | OPEN | lane b | ev 40478529397665 | check |\n"
        "| D-1 | 11-13 | a decision | DONE coordinator | b | c | d |\n"
    )
    rc2, handoff = {"REQ-001"}, {"REQ-002"}
    first, _ = lp.build(ledger, rc2, handoff)
    second, _ = lp.build(ledger, rc2, handoff)
    assert first == second, "the publisher must be deterministic"
    assert "| REQ-001 | 11-10 | first ask | DONE (live) | lane a | ev | check | RC2 |" in first
    assert "| REQ-002 | 11-10 | second ask | OPEN | lane b | ev <id> | check | HANDOFF |" in first
    assert "| D-1 | 11-13 | a decision | DONE coordinator | b | c | d | not in RC2 scope |" in first
    assert "- REQ-002 | HANDOFF | OPEN | second ask" in first, "a HANDOFF row is listed in the hand-off section"
    assert "REQ-001 | RC2 | DONE" not in first.split("## Ledger")[0], "a DONE RC2 row is not handed off"


def test_publish_rejects_a_scope_listing_one_id_twice(tmp_path):
    scope = tmp_path / "scope.txt"
    scope.write_text("RC2: REQ-001\nHANDOFF: REQ-001\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        lp.read_scope(scope)


def test_check_mode_exits_zero_on_the_committed_files():
    assert lp.main(["--check"]) == 0


def test_publish_refuses_without_the_private_names_file(tmp_path, monkeypatch):
    # A publish with no private names file would write customer names into the public ledger unmasked.
    ledger = tmp_path / "ledger.md"
    ledger.write_text("| REQ | Asked (UTC) | Ask | State | Lane / branch | Evidence | Live acceptance check |\n|---|---|---|---|---|---|---|\n", encoding="utf-8")
    scope = tmp_path / "scope.txt"
    scope.write_text("RC2: REQ-001\n", encoding="utf-8")
    out = tmp_path / "out.md"
    monkeypatch.setattr(lp, "CUSTOMER", lp.private_names(None))
    with pytest.raises(SystemExit):
        lp.main(["--ledger", str(ledger), "--scope", str(scope), "--out", str(out)])
    assert not out.exists(), "nothing is written when the names file is missing"
    names = tmp_path / "names.txt"
    names.write_text("planted\n", encoding="utf-8")
    monkeypatch.setattr(lp, "CUSTOMER", lp.private_names(names))
    assert lp.main(["--ledger", str(ledger), "--scope", str(scope), "--out", str(out)]) == 0
    assert out.exists()
