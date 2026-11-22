"""REQ-478, REQ-456, REQ-469: a build whose result table sits where the identity Inspire builds as can neither write nor give a new App
access moves the result table to the Inspire-managed schema with one info line, so the App step never stops on a permission."""
import ast

from _agentload import agent_source

PICKED = "`main`.`_inspire_old_n01_u01`.`n01_u01_results`"
MANAGED = "`main`.`inspire`.`_inspire_n01_u01_predict_churn_s42`"
INFO = "Inspire writes the result to main.inspire._inspire_n01_u01_predict_churn_s42, where it can give the new App access"

# What the identity Inspire builds as sees where an earlier install left the schema: the owner is gone, nothing is granted to it.
NOT_MINE = [
    {"level": "catalog", "privilege": "OWNER", "principal": "admins", "mine": "false", "me": "inspire-sp"},
    {"level": "catalog", "privilege": "USE_CATALOG", "principal": "account users", "mine": "true", "me": "inspire-sp"},
    {"level": "catalog", "privilege": "CREATE_SCHEMA", "principal": "inspire-sp", "mine": "true", "me": "inspire-sp"},
    {"level": "schema", "privilege": "OWNER", "principal": "someone-gone", "mine": "false", "me": "inspire-sp"},
]
# It can write there, but cannot share: no MANAGE, and account users lack USE SCHEMA.
WRITES_NO_GRANT = NOT_MINE + [
    {"level": "schema", "privilege": "USE_SCHEMA", "principal": "inspire-sp", "mine": "true", "me": "inspire-sp"},
    {"level": "schema", "privilege": "CREATE_TABLE", "principal": "inspire-sp", "mine": "true", "me": "inspire-sp"},
]
# The Inspire-managed schema: the installer made Inspire's identity its owner and gave account users USE SCHEMA.
MANAGED_ROWS = [
    {"level": "catalog", "privilege": "OWNER", "principal": "admins", "mine": "false", "me": "inspire-sp"},
    {"level": "catalog", "privilege": "USE_CATALOG", "principal": "account users", "mine": "true", "me": "inspire-sp"},
    {"level": "schema", "privilege": "OWNER", "principal": "inspire-sp", "mine": "true", "me": "inspire-sp"},
    {"level": "schema", "privilege": "USE_SCHEMA", "principal": "account users", "mine": "true", "me": "inspire-sp"},
]


def test_a_result_schema_inspire_cannot_write_moves_to_the_managed_schema_with_the_info_line(agent_ns):
    got = agent_ns["implement_managed_result_table"](PICKED, NOT_MINE, MANAGED, app=False)
    assert got == {"table": MANAGED, "note": INFO}


def test_a_result_schema_a_new_app_could_not_read_moves_when_the_build_makes_an_app(agent_ns):
    move = agent_ns["implement_managed_result_table"]
    assert move(PICKED, WRITES_NO_GRANT, MANAGED, app=True) == {"table": MANAGED, "note": INFO}
    # Without an App the result table stays where Inspire can write it.
    assert move(PICKED, WRITES_NO_GRANT, MANAGED, app=False) == {"table": PICKED, "note": ""}


def test_after_the_move_the_new_app_has_no_gap_and_gets_select_on_the_result_table(agent_ns):
    got = agent_ns["implement_managed_result_table"](PICKED, NOT_MINE, MANAGED, app=True)
    plan = agent_ns["implement_access_plan"](got["table"], MANAGED_ROWS, "new-app-sp")
    assert plan["gaps"] == []
    assert {"privilege": "SELECT", "level": "table", "object": MANAGED} in plan["grants"]
    assert agent_ns["implement_access_plan"](got["table"], MANAGED_ROWS)["gaps"] == []


def test_a_result_table_inspire_manages_or_could_not_check_stays(agent_ns):
    move = agent_ns["implement_managed_result_table"]
    owns = NOT_MINE[:3] + [{"level": "schema", "privilege": "OWNER", "principal": "inspire-sp", "mine": "true", "me": "inspire-sp"}]
    assert move(PICKED, owns, MANAGED, app=True) == {"table": PICKED, "note": ""}
    assert move(PICKED, None, MANAGED, app=True) == {"table": PICKED, "note": ""}
    assert move(MANAGED, NOT_MINE, MANAGED, app=True) == {"table": MANAGED, "note": ""}


def _functions_with(text):
    source = agent_source()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.FunctionDef) and node.name != "implement_managed_result_table":
            segment = ast.get_source_segment(source, node) or ""
            if text in segment:
                yield segment


def test_the_build_start_retargets_the_result_table_before_it_writes_the_instruction():
    """The build start, where it reads the default result table, calls the move before implement_retarget_instruction."""
    starts = sorted(_functions_with("implement_result_table_move(previous_spec, spec, default_table)"), key=len)
    assert starts, "the build start reads the default result table"
    text = starts[0]
    assert "implement_managed_result_table(" in text
    assert text.index("implement_managed_result_table(") < text.index("implement_retarget_instruction(")
