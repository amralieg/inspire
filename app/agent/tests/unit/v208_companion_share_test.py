import json
import pathlib

from v140_implement_test import _inspire

RESULT = "inspire_kinds._inspire.n02_u01_s1793835077878779514_out"
SERIES = f"{RESULT}__series"
OWNER = "1f0e-owner-sp"
VIEWER = "viewer@example.com"
NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


def _quoted(name):
    return ".".join(f"`{p}`" for p in name.split("."))


def _grant(name, who):
    return f"GRANT SELECT ON TABLE {_quoted(name)} TO `{who}`"


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)


class Spark:
    def __init__(self, present, grants, refuse=()):
        self.present, self.grants, self.refuse, self.ran = set(present), list(grants), set(refuse), []

    def sql(self, statement, args=None):
        text = " ".join(str(statement).split())
        if text.startswith("SELECT lower(table_name) AS t FROM system.information_schema.tables"):
            return _Rows([{"t": n} for n in sorted(self.present & set((args or {}).values()))])
        if "information_schema.table_privileges" in text:
            return _Rows(self.grants)
        self.ran.append(text)
        if any(r in text for r in self.refuse):
            raise RuntimeError("[INSUFFICIENT_PERMISSIONS] User does not have MANAGE on Table SQLSTATE: 42501")
        return _Rows([])


def _short(name):
    return name.split(".")[-1]


def _live_present():
    return {_short(RESULT)} | {_short(RESULT) + s for s in ("_summary", "_reasons", "_assumptions", "_run_log", "_acted", "_closed",
                                                             "_run_changes", "_closes", "__series")}


def _inst(agent_ns, spark):
    inst = _inspire(agent_ns, spark)
    inst.logger = type("L", (), {"info": lambda self, m: None, "warning": lambda self, m: None})()
    return inst


def test_the_sharing_step_lets_the_viewer_read_the_kind_companion_the_dashboard_reads(agent_ns):
    spark = Spark(_live_present(), [{"t": _short(RESULT), "p": OWNER}])
    assert _inst(agent_ns, spark)._implement_share_reads(RESULT, [VIEWER]) == []
    assert _grant(SERIES, VIEWER) in spark.ran, spark.ran
    assert _grant(f"{RESULT}_acted", VIEWER) in spark.ran and _grant(f"{RESULT}_closed", VIEWER) in spark.ran


def test_every_table_the_outputs_read_beside_the_result_is_shared_through_the_one_list(agent_ns):
    reads = agent_ns["implement_app_result_reads"](RESULT)
    present = {_short(n) for n in reads}
    spark = Spark(present, [])
    assert _inst(agent_ns, spark)._implement_share_reads(RESULT, [VIEWER]) == []
    assert sorted(spark.ran) == sorted(_grant(n, VIEWER) for n in reads if n != RESULT)
    assert SERIES in reads


def test_a_table_the_viewer_already_reads_or_that_does_not_exist_gets_no_grant(agent_ns):
    spark = Spark({_short(RESULT), _short(SERIES)}, [{"t": _short(SERIES), "p": VIEWER}])
    assert _inst(agent_ns, spark)._implement_share_reads(RESULT, [VIEWER, "", "bad`name"]) == []
    assert spark.ran == []


def test_a_refused_grant_is_a_sharing_warning(agent_ns):
    spark = Spark({_short(RESULT), _short(SERIES)}, [], refuse=("__series",))
    warnings = _inst(agent_ns, spark)._implement_share_reads(RESULT, [VIEWER])
    assert len(warnings) == 1 and warnings[0].startswith(f"Sharing: {_grant(SERIES, VIEWER)} failed: [INSUFFICIENT_PERMISSIONS]")


def test_the_sharing_step_runs_the_one_share_path_once_for_every_principal(agent_ns):
    inst = _inst(agent_ns, Spark(set(), []))
    seen = []
    inst._implement_access_rows = lambda table, warnings: []
    inst._implement_share_reads = lambda table, names: seen.append((table, list(names))) or []
    inst._implement_share_tables(RESULT, [{"type": "user", "name": VIEWER}, {"type": "group", "name": "planners"}, {"name": ""}])
    assert seen == [(RESULT, [VIEWER]), (RESULT, ["planners"])]


def _inlined(agent_ns):
    facts = (pathlib.Path(__file__).resolve().parents[2] / "agent" / "app_shell" / "server" / "shell_facts.py").read_text(encoding="utf-8")
    return "\n".join([agent_ns["REDACT_SOURCE"], agent_ns["implement_shell_facts_snippet"](facts), agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]])


class _Field:
    def __init__(self, name):
        self.name = name
        self.dataType = type("T", (), {"typeName": lambda self: "string"})()


class _Frame:
    def __init__(self, columns, saved):
        self.schema = type("S", (), {"fields": [_Field(c) for c in columns]})()
        self.saved = saved
        self.write = self

    def count(self):
        return 3

    def mode(self, _m):
        return self

    def option(self, *_a):
        return self

    def saveAsTable(self, name):
        self.saved.append(name)


def test_a_companion_written_after_the_result_is_shared_with_whoever_reads_the_result_in_the_same_run(agent_ns):
    notebook = {"__name__": "generated"}
    exec(compile(_inlined(agent_ns), "<generated>", "exec"), notebook)
    notebook["INSPIRE_RUN"] = {"app_reads": agent_ns["implement_app_result_reads"](RESULT)}
    spark, saved, said = Spark({_short(RESULT), _short(SERIES)}, [{"t": _short(RESULT), "p": VIEWER}]), [], []
    columns = ["series_id", "period", "actual", "forecast", "lower", "upper", "is_future", "method", "backtest_mase"]
    assert notebook["inspire_write_companion"](_Frame(columns, saved), RESULT, "__series", columns, spark, said.append) == 3
    assert saved == [_quoted(SERIES)]
    assert spark.ran == [_grant(SERIES, VIEWER)], spark.ran
    assert any(s.startswith("[APP-READS FIRED]") for s in said)


def test_the_build_shares_tables_through_no_grant_helper_but_the_one_share_path():
    src = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    start = src.index("    def _implement_share_tables(")
    body = src[start:src.index("    def _implement_hub_shut_out(")]
    assert "GRANT SELECT ON TABLE" not in body
    assert body.count("inspire_share_outputs(self.spark, result_table,") == 1


def test_every_table_a_kind_layout_or_alert_reads_is_on_the_one_read_list(agent_ns):
    reads = {n.lower() for n in agent_ns["implement_app_result_reads"](RESULT)}
    kinds = agent_ns["_inspire_kinds"]()
    for layout in kinds["layouts"]:
        tables = agent_ns["implement_layout_tables"](RESULT, layout["id"])
        assert tables or not (kinds["contracts"].get(layout["contract"]) or {}).get("suffixes"), layout["id"]
        assert {t.lower() for t in tables} <= reads, (layout, sorted(set(tables) - reads))
    for contract in kinds["contracts"].values():
        assert {f"{RESULT}{s}".lower() for s in contract.get("suffixes") or {}} <= reads
    assert agent_ns["inspire_ai_summary_table"](RESULT).lower() in reads
    assert agent_ns["implement_reasons_view"](RESULT).lower() in reads
    assert agent_ns["inspire_run_log_table"](RESULT).lower() in reads
