"""c42_p0_10k (REQ-585 item 2, R15 / R11.2): the 10,000-table P0 scope and its milestone report.

scripts/bench_10k.py
  sql --catalog-prefix P [--catalogs 20 --schemas 10 --tables 50] [--create-catalogs] [--out F]
      Deterministic Serverless-safe SQL for catalogs P_c01..P_c20, schemas s01..s10 in each, 50 empty tables per schema
      (CREATE SCHEMA IF NOT EXISTS + CREATE TABLE IF NOT EXISTS with column COMMENTs and a table COMMENT). Per schema: 20
      transactional, 15 master, 8 reference, 7 technical tables (names say which, columns fit the role). CREATE CATALOG IF NOT
      EXISTS only with --create-catalogs (default: none). Never DROP / DELETE / TRUNCATE / INSERT.
  Python API: generate_sql(catalog_prefix, catalogs=20, schemas=10, tables=50, create_catalogs=False) -> list[str];
              table_roles(catalog_prefix, ...) -> {fqn: role}.
scripts/critical_path_report.py gains milestones(ledger, budget_s, submitted_at=None) -> dict and --budget-min:
  {"domain_list_s", "first_valued_card_s", "final_s", "budget_s", "partial", "partial_reason"} measured from submitted_at (else the
  first ledger start). domain_list_s = first end of a ledger row whose stage is a domains stage; first_valued_card_s = first end of a
  "Scoring" stage row; final_s = last end. A milestone the run never reached is None, never 0. partial is True when final_s > budget_s
  or any ledger row has status "partial" (R11.2: a run that hits its time budget is partial, never complete). build_report(...) gets
  the milestones under "milestones" when budget_s is given and render_md prints a Milestones table that says "PARTIAL" when partial.
"""
import importlib.util
import re
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def creates(stmts, kind):
    return [s for s in stmts if re.match(rf"\s*CREATE {kind} IF NOT EXISTS", s, re.I)]


def test_1_scope_is_20_catalogs_x_10_schemas_x_50_tables():
    b = load("bench_10k")
    stmts = b.generate_sql("p0k")
    tables = creates(stmts, "TABLE")
    assert len(tables) == 10_000 and len(creates(stmts, "SCHEMA")) == 200
    names = {re.search(r"TABLE IF NOT EXISTS\s+(\S+)", s).group(1).replace("`", "") for s in tables}
    assert len(names) == 10_000
    assert {n.split(".")[0] for n in names} == {f"p0k_c{i:02d}" for i in range(1, 21)}


def test_2_catalogs_are_created_only_when_asked_and_nothing_is_ever_dropped():
    b = load("bench_10k")
    assert creates(b.generate_sql("p0k"), "CATALOG") == []
    assert len(creates(b.generate_sql("p0k", create_catalogs=True), "CATALOG")) == 20
    text = "\n".join(b.generate_sql("p0k", create_catalogs=True)).upper()
    for banned in ("DROP ", "DELETE ", "TRUNCATE ", "INSERT ", "CACHE ", "PERSIST"):
        assert banned not in text


def test_3_each_schema_holds_the_role_mix_and_tables_carry_comments():
    b = load("bench_10k")
    roles = b.table_roles("p0k")
    assert len(roles) == 10_000
    per_schema = {}
    for fqn, role in roles.items():
        per_schema.setdefault(fqn.rsplit(".", 1)[0], []).append(role)
    assert len(per_schema) == 200
    for mix in per_schema.values():
        assert (mix.count("transactional"), mix.count("master"), mix.count("reference"), mix.count("technical")) == (20, 15, 8, 7)
    tables = creates(b.generate_sql("p0k"), "TABLE")
    assert all(" COMMENT " in s.upper() for s in tables)


def test_4_small_scope_and_determinism():
    b = load("bench_10k")
    small = b.generate_sql("p0k", catalogs=2, schemas=1, tables=50)
    assert len(creates(small, "TABLE")) == 100
    assert b.generate_sql("p0k", catalogs=2, schemas=1, tables=50) == small


LEDGER = [
    {"stage": "Setup", "step": "settings", "started_at": 100, "ended_at": 130, "status": "ok"},
    {"stage": "Data Preparation", "step": "tables", "started_at": 130, "ended_at": 400, "status": "ok"},
    {"stage": "Business Domain Clustering", "step": "domains", "started_at": 400, "ended_at": 520, "status": "ok"},
    {"stage": "Scoring", "step": "combined", "started_at": 520, "ended_at": 700, "status": "ok"},
    {"stage": "Executive Readout", "step": "readout", "started_at": 700, "ended_at": 900, "status": "ok"},
]


def test_5_milestones_from_submission():
    c = load("critical_path_report")
    m = c.milestones(LEDGER, budget_s=1200, submitted_at=40)
    assert (m["domain_list_s"], m["first_valued_card_s"], m["final_s"]) == (480, 660, 860)
    assert m["partial"] is False and m["budget_s"] == 1200
    m = c.milestones(LEDGER, budget_s=1200)
    assert m["final_s"] == 800, "without a submission time the first ledger start is t0"


def test_6_over_budget_or_partial_status_is_partial_and_missing_milestones_are_none():
    c = load("critical_path_report")
    m = c.milestones(LEDGER, budget_s=600, submitted_at=40)
    assert m["partial"] is True and "budget" in m["partial_reason"].lower()
    short = LEDGER[:2] + [dict(LEDGER[2], status="partial")]
    m = c.milestones(short, budget_s=10_000)
    assert m["partial"] is True and m["first_valued_card_s"] is None and m["domain_list_s"] == 420


def test_7_report_and_markdown_carry_the_milestones():
    c = load("critical_path_report")
    rep = c.build_report(LEDGER, [], [], [], budget_s=600)
    assert rep["milestones"]["partial"] is True
    assert "PARTIAL" in c.render_md(rep) and "Milestones" in c.render_md(rep)
    assert "milestones" not in c.build_report(LEDGER, [], [], [])


def test_8_domain_stages_match_the_notebook(agent_ns):
    c = load("critical_path_report")
    phases = agent_ns["PROGRESS_STAGE_PHASES"]
    assert set(c.DOMAIN_STAGES) == {s for s, p in phases.items() if p == "domains"}
    assert "Scoring" in phases
