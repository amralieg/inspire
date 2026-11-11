import builtins
import json
import pathlib
import symtable

import pytest

NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
RESULT = "main.inspire.churn_out"
SP = "1f0e-app-sp"
READS = [RESULT, "main.inspire.churn_out_closed", "main.inspire.churn_out_closes", "main.inspire.churn_out_acted",
         "main.inspire.churn_out_changes"]


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
            asked = set((args or {}).values())
            return _Rows([{"t": n} for n in sorted(self.present & asked)])
        if "information_schema.table_privileges" in text:
            return _Rows(self.grants)
        self.ran.append(text)
        if any(r in text for r in self.refuse):
            raise RuntimeError("[INSUFFICIENT_PERMISSIONS] User does not have MANAGE on Table SQLSTATE: 42501")
        return _Rows([])


def test_a_table_made_after_the_build_is_read_by_whoever_reads_the_result_table(agent_ns):
    grants = [{"t": "churn_out", "p": SP}, {"t": "churn_out", "p": "analysts"}, {"t": "churn_out_acted", "p": SP}]
    plan = agent_ns["inspire_share_plan"](RESULT, ["churn_out", "churn_out_closed", "churn_out_closes", "churn_out_acted"], grants, READS)
    assert sorted(plan) == sorted([
        f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `{SP}`", "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `analysts`",
        f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closes` TO `{SP}`", "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closes` TO `analysts`",
        "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_acted` TO `analysts`"]), plan


def test_no_grant_for_a_missing_table_a_held_grant_an_unread_result_or_a_bad_name(agent_ns):
    plan = agent_ns["inspire_share_plan"]
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": SP}, {"t": "churn_out_closed", "p": SP}], READS) == []
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "other_out", "p": SP}], READS) == [], "nobody reads the result table, so nobody is added"
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": "x` TO `y"}], READS) == []
    assert plan("not a table", ["churn_out_closed"], [{"t": "churn_out", "p": SP}], READS) == []
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": SP}], []) == [], "no list from the build, no grant"
    assert plan(RESULT, ["churn_out"], [{"t": "churn_out", "p": SP}], [RESULT, "other.inspire.churn_out_closed"]) == []
    assert all("churn_out_changes" not in s for s in plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": SP}], READS))


def test_every_table_the_app_reads_beside_the_result_is_covered_by_the_one_list(agent_ns):
    reads = agent_ns["implement_app_result_reads"](RESULT)
    closed = agent_ns["inspire_closed_table"](RESULT)
    assert closed in reads and agent_ns["inspire_closes_table"](RESULT) in reads
    present = [n.split(".")[-1] for n in reads]
    plan = agent_ns["inspire_share_plan"](RESULT, present, [{"t": "churn_out", "p": SP}], reads)
    assert len(plan) == len(reads) - 1, plan


def test_the_run_grants_them_and_says_so(agent_ns):
    said = []
    spark = Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}])
    done = agent_ns["inspire_share_outputs"](spark, RESULT, said.append, run={"app_reads": READS})
    assert spark.ran == [f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `{SP}`"] == done
    assert said and said[0].startswith("[APP-READS FIRED]") and "1 grant made" in said[0]


def test_a_refused_grant_is_said_plainly_and_the_run_goes_on(agent_ns):
    said = []
    spark = Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}], refuse=("churn_out_closed",))
    agent_ns["inspire_share_outputs"](spark, RESULT, said.append, run={"app_reads": READS})
    assert "0 grants made; 1 failed" in said[0], said


def test_both_merge_branches_share_the_outputs_before_the_run_ends():
    src = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    body = src[src.index("def inspire_merge_run("):src.index("def inspire_share_reads_sql(")]
    assert body.count("inspire_share_outputs(spark, table, out)\n") == 2
    assert body.count("inspire_share_outputs(spark, table, out)\n        inspire_cluster_run(") == 1
    assert body.count("inspire_share_outputs(spark, table, out)\n    inspire_cluster_run(") == 1


def _inlined(agent_ns):
    facts = (pathlib.Path(__file__).resolve().parents[2] / "agent" / "app_shell" / "server" / "shell_facts.py").read_text(encoding="utf-8")
    return "\n".join([agent_ns["REDACT_SOURCE"], agent_ns["implement_shell_facts_snippet"](facts), agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]])


def test_the_sources_a_generated_notebook_inlines_name_nothing_only_the_agent_defines(agent_ns):
    top = symtable.symtable(_inlined(agent_ns), "inlined", "exec")
    defined = {s.get_name() for s in top.get_symbols() if s.is_assigned() or s.is_imported() or s.is_namespace()}
    used = set()

    def walk(table):
        used.update(s.get_name() for s in table.get_symbols() if s.is_global() or (table.get_type() == "module" and s.is_referenced()))
        for child in table.get_children():
            walk(child)
    walk(top)
    assert sorted(n for n in used - defined if not hasattr(builtins, n)) == []
    assert "implement_app_result_reads" in agent_ns and "implement_app_result_reads" not in agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]


def test_a_generated_notebook_shares_the_tables_its_build_listed_without_the_agent(agent_ns):
    said, notebook = [], {"__name__": "generated"}
    exec(compile(_inlined(agent_ns), "<generated>", "exec"), notebook)
    notebook["INSPIRE_RUN"] = {"app_reads": agent_ns["implement_app_result_reads"](RESULT)}
    spark = Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}])
    assert notebook["inspire_share_outputs"](spark, RESULT, said.append) == [f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `{SP}`"]
    assert said[0].startswith("[APP-READS FIRED]")
    notebook["INSPIRE_RUN"], quiet = {}, Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}])
    assert notebook["inspire_share_outputs"](quiet, RESULT, said.append) == [] and quiet.ran == []


def test_the_build_writes_the_list_of_tables_the_app_reads_into_the_run():
    src = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    assert ('"app_reads": implement_app_result_reads(".".join(inspire_table_parts(spec["result_table"]))),' in
            src[src.index("def _genie_run_controls_source("):src.index("def _assemble_genie_code_notebook(")])


class ScopedFrame:
    def __init__(self, name, log):
        self.name, self.log = name, log
        self.columns = ["order_id", "region", "amount"]

    def where(self, condition):
        self.log.append(("where", self.name, condition))
        return self

    def select(self, *columns):
        self.log.append(("select", self.name, columns))
        return self

    def limit(self, n):
        return self

    def orderBy(self, *args):
        return self


class ScopedSpark:
    def __init__(self):
        self.reads = []
        self.ops = []

    def table(self, name):
        self.reads.append(name)
        return ScopedFrame(name, self.ops)


SCOPED = "main.s.orders"
SCOPE_VIEW = "main.inspire_scope.orders_scoped"


def _scoped_run(agent_ns, **run):
    notebook = {"__name__": "generated"}
    exec(compile(_inlined(agent_ns), "<generated>", "exec"), notebook)
    notebook["INSPIRE_RUN"] = dict(run)
    return notebook


def test_a_scoped_table_is_read_through_its_ready_scope_view_in_a_generated_notebook(agent_ns):
    scope = {"table": SCOPED, "view": SCOPE_VIEW, "ready": True, "where": "region = 'EU'", "columns": ["order_id", "region"]}
    notebook = _scoped_run(agent_ns, table_scopes={"main.s.orders": scope}, scoped_tables=["main.s.orders"])
    spark = ScopedSpark()
    frame = notebook["inspire_read_source"](SCOPED, spark, purpose=notebook["INSPIRE_READ_PURPOSES"][0])
    assert spark.reads == ["`main`.`inspire_scope`.`orders_scoped`"], (
        "the scoped read goes to the scope view, which already applies the Table Scope, never the whole base table")
    assert frame is not None


def test_a_scoped_table_whose_scope_is_missing_from_the_run_is_refused_and_never_read_whole(agent_ns):
    notebook = _scoped_run(agent_ns, table_scopes={}, scoped_tables=["main.s.orders"])
    spark = ScopedSpark()
    with pytest.raises(ValueError, match="has a Table Scope, but this run does not carry its scope"):
        notebook["inspire_read_source"](SCOPED, spark, purpose=notebook["INSPIRE_READ_PURPOSES"][0])
    assert spark.reads == [], "a refused read never touches the base table"


def test_a_scope_whose_view_is_not_ready_reads_the_base_table_with_its_rows_and_its_columns(agent_ns):
    scope = {"table": SCOPED, "view": SCOPE_VIEW, "ready": False, "where": "region = 'EU'", "columns": ["order_id", "region"]}
    notebook = _scoped_run(agent_ns, table_scopes={"main.s.orders": scope}, scoped_tables=["main.s.orders"])
    spark = ScopedSpark()
    notebook["inspire_read_source"](SCOPED, spark, purpose=notebook["INSPIRE_READ_PURPOSES"][0])
    assert spark.reads == ["`main`.`s`.`orders`"], "a not-ready view falls back to the base table, never to a whole unfiltered read"
    assert ("where", "`main`.`s`.`orders`", "region = 'EU'") in spark.ops, "the row filter of the scope is applied"
    assert ("select", "`main`.`s`.`orders`", ("`order_id`", "`region`")) in spark.ops, (
        "the column list of the scope is applied too (REQ-022: selected columns and rows)")
