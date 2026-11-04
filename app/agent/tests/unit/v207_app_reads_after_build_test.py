import json
import pathlib

NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
RESULT = "main.inspire.churn_out"
SP = "1f0e-app-sp"


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
    plan = agent_ns["inspire_share_plan"](RESULT, ["churn_out", "churn_out_closed", "churn_out_closes", "churn_out_acted"], grants)
    assert sorted(plan) == sorted([
        f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `{SP}`", "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `analysts`",
        f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closes` TO `{SP}`", "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closes` TO `analysts`",
        "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_acted` TO `analysts`"]), plan


def test_no_grant_for_a_missing_table_a_held_grant_an_unread_result_or_a_bad_name(agent_ns):
    plan = agent_ns["inspire_share_plan"]
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": SP}, {"t": "churn_out_closed", "p": SP}]) == []
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "other_out", "p": SP}]) == [], "nobody reads the result table, so nobody is added"
    assert plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": "x` TO `y"}]) == []
    assert plan("not a table", ["churn_out_closed"], [{"t": "churn_out", "p": SP}]) == []
    assert all("churn_out_changes" not in s for s in plan(RESULT, ["churn_out", "churn_out_closed"], [{"t": "churn_out", "p": SP}]))


def test_every_table_the_app_reads_beside_the_result_is_covered_by_the_one_list(agent_ns):
    reads = agent_ns["implement_app_result_reads"](RESULT)
    closed = agent_ns["inspire_closed_table"](RESULT)
    assert closed in reads and agent_ns["inspire_closes_table"](RESULT) in reads
    present = [n.split(".")[-1] for n in reads]
    plan = agent_ns["inspire_share_plan"](RESULT, present, [{"t": "churn_out", "p": SP}])
    assert len(plan) == len(reads) - 1, plan


def test_the_run_grants_them_and_says_so(agent_ns):
    said = []
    spark = Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}])
    done = agent_ns["inspire_share_outputs"](spark, RESULT, said.append)
    assert spark.ran == [f"GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_closed` TO `{SP}`"] == done
    assert said and said[0].startswith("[APP-READS FIRED]") and "1 grant made" in said[0]


def test_a_refused_grant_is_said_plainly_and_the_run_goes_on(agent_ns):
    said = []
    spark = Spark({"churn_out", "churn_out_closed"}, [{"t": "churn_out", "p": SP}], refuse=("churn_out_closed",))
    agent_ns["inspire_share_outputs"](spark, RESULT, said.append)
    assert "0 grants made; 1 failed" in said[0], said


def test_both_merge_branches_share_the_outputs_before_the_run_ends():
    src = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    body = src[src.index("def inspire_merge_run("):src.index("def inspire_share_reads_sql(")]
    assert body.count("inspire_share_outputs(spark, table, out)\n") == 2
    assert body.count("inspire_share_outputs(spark, table, out)\n        inspire_cluster_run(") == 1
    assert body.count("inspire_share_outputs(spark, table, out)\n    inspire_cluster_run(") == 1
