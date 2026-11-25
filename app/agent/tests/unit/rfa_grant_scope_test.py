"""REQ-408 + REQ-406 (App shell): the Python mirror of backend/lib/grantScope.js and the shell's Request for Access.

The fixture backend/test/support/grantScopeCases.json is the one contract; the JS test reads the same file.
"""
import json
import re
from pathlib import Path

from v141_app_shell_test import shell  # noqa: F401  (v141 puts the App shell server on sys.path)

import shell_core  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[3] / "backend" / "test" / "support" / "grantScopeCases.json"
CASES = json.loads(FIXTURE.read_text())
WHO = "signed-in@example.com"
HOST = "https://workspace.example.com/"
P = "`signed-in@example.com`"
TEN_TABLES = [f"GRANT SELECT ON TABLE `main`.`s`.`t{i}` TO {P}" for i in range(10)]


WIDE = re.compile(r"^GRANT (SELECT|READ METADATA) ON SCHEMA ", re.I)
TABLE_READ = re.compile(r"^GRANT (SELECT|READ METADATA) ON TABLE ", re.I)


def test_the_shared_fixture_matches_the_python_normaliser_for_every_case():
    for case in CASES:
        got = shell_core.coarse_grants(case["input"], case["wholeCatalogs"])
        if any(" ON CATALOG " in g and not g.startswith("GRANT USE") for g in case["expected"]) or not [g for g in case["expected"] if WIDE.match(g)]:
            assert got == case["expected"], case["name"]
            continue
        # REQ-518 (F9): the fixture still collapses reads to the schema; the shell asks SELECT per table instead. Everything else is the fixture's.
        assert [g for g in got if WIDE.match(g)] == [], case["name"]
        assert [g for g in got if not TABLE_READ.match(g)] == [g for g in case["expected"] if not WIDE.match(g)], case["name"]
        assert len([g for g in got if TABLE_READ.match(g)]) == len(
            {g.upper() for g in case["input"] if TABLE_READ.match(g)}), case["name"]
        if case.get("idempotent"):
            assert shell_core.coarse_grants(case["expected"], case["wholeCatalogs"]) == case["expected"], case["name"] + " (idempotent)"


def test_ten_tables_in_one_schema_ask_for_select_per_table_and_the_use_lines_once():
    got = shell_core.coarse_grants([f"GRANT USE CATALOG ON CATALOG `main` TO {P}", f"GRANT USE SCHEMA ON SCHEMA `main`.`s` TO {P}", *TEN_TABLES])
    assert got == [f"GRANT USE CATALOG ON CATALOG `main` TO {P}", f"GRANT USE SCHEMA ON SCHEMA `main`.`s` TO {P}", *TEN_TABLES]


def test_the_request_for_access_asks_for_each_table_securable_not_the_schema():
    requests = shell_core.rfa_requests(TEN_TABLES)
    assert requests == [{"grantee": WHO, "securable": {"type": "TABLE", "full_name": f"main.s.t{i}"}, "permissions": ["SELECT"]} for i in range(10)]


def test_the_explorer_link_is_named_per_securable_and_is_empty_without_a_host():
    assert shell_core.rfa_links(HOST, TEN_TABLES) == [{"type": "TABLE", "full_name": f"main.s.t{i}",
                                                      "url": f"https://workspace.example.com/explore/data/main/s/t{i}"} for i in range(10)]
    assert shell_core.rfa_links("", TEN_TABLES) == []


class RefusingWs:
    """Every call is refused; the check reads no destination, and the send is refused with the workspace reason."""

    def call(self, method, path, body=None, params=None, timeout=60):
        raise RuntimeError("PERMISSION_DENIED: you cannot request this securable")


def test_a_check_that_is_not_offered_still_returns_the_link_so_the_dialog_can_open_the_form():
    got = shell_core.rfa_check(RefusingWs(), WHO, TEN_TABLES, HOST)
    assert got["offered"] is False
    assert got["links"][0]["url"] == "https://workspace.example.com/explore/data/main/s/t0"


def test_a_refused_send_returns_the_links_and_the_reason_for_the_dialog_to_open_the_form():
    got = shell_core.rfa_send(RefusingWs(), WHO, TEN_TABLES, HOST)
    assert got["sent"] is False
    assert got["links"][0]["full_name"] == "main.s.t0"
    assert "PERMISSION_DENIED" in got["reason"]
