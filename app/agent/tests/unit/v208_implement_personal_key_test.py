import ast
import json
import os
import shutil
import subprocess

import pytest

from _agentload import method_node
from v120_artifacts_support import make_inspire

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = os.path.dirname(os.path.dirname(ROOT))
PERSONAL_JS = os.path.join(REPO, "app", "frontend", "src", "lib", "personalColumns.js")


class TagSpark:
    def __init__(self, tags=None, fail=False):
        self.tags = tags or {}
        self.fail = fail
        self.calls = []

    def sql(self, statement, args=None, **_kwargs):
        self.calls.append((" ".join(statement.split()), dict(args or {})))
        if self.fail:
            raise PermissionError("User does not have USE SCHEMA on information_schema")
        ref = (args or {})
        rows = self.tags.get(f"{ref.get('s')}.{ref.get('t')}.{ref.get('c')}".lower(), [])
        return type("Rows", (), {"collect": lambda _self: [{"tag_name": n, "tag_value": v} for n, v in rows]})()


def _inspire(agent_ns, spark):
    inst = make_inspire(agent_ns)
    inst.spark = spark
    return inst


def _auto(column):
    return {"elite_assessment": {"entity_key_column": column}}


def test_an_auto_picked_key_with_a_pii_tag_is_refused_before_any_build(agent_ns):
    spark = TagSpark({"s.orders.ref_code": [("Data_Class", "PII")]})
    inst = _inspire(agent_ns, spark)
    reason = inst._implement_personal_key("UC-1", {"data": {}}, _auto("main.s.orders.ref_code"))
    assert reason.startswith("result key main.s.orders.ref_code: ") and "never the key of the result" in reason
    statement, args = spark.calls[0]
    assert "FROM `main`.information_schema.column_tags" in statement and args == {"s": "s", "t": "orders", "c": "ref_code"}


def test_an_auto_picked_personal_name_is_refused_even_when_the_tags_cannot_be_read(agent_ns):
    inst = _inspire(agent_ns, TagSpark(fail=True))
    assert "never the key of the result" in inst._implement_personal_key("UC-1", {"data": {}}, _auto("main.s.payments.cardNumber"))
    assert any(level == "WARNING" and "[IMPLEMENT-PERSONAL-KEY]" in m and "only its name is checked" in m for level, m in inst.logger.records)


def test_an_untagged_ordinary_auto_picked_key_is_kept(agent_ns):
    spark = TagSpark({"s.orders.ref_code": [("Data_Class", "PII")], "s.orders.order_id": [("owner", "sales")]})
    inst = _inspire(agent_ns, spark)
    assert inst._implement_personal_key("UC-1", {"data": {}}, _auto("main.s.orders.order_id")) == ""
    assert inst._implement_personal_key("UC-1", {"data": {}}, {"elite_assessment": {}}) == ""
    assert inst._implement_personal_key("UC-1", {"data": {}}, _auto("order_id")) == ""


def test_the_users_chosen_key_wins_over_the_auto_pick_and_follows_a_swapped_table(agent_ns):
    key = agent_ns["implement_result_key"]
    assert key({"data": {"column_roles": {"entity_id": "`main`.`s`.`orders`.`ref_code`"}}}, {"entity_key_column": "main.s.orders.order_id"}) \
        == "main.s.orders.ref_code"
    assert key({"data": {"tables": {"MAIN.s.returns": "main.s.returns_v2"}}}, {"entity_key_column": "main.s.returns.order_id"}) \
        == "main.s.returns_v2.order_id"
    assert key({}, {"entity_key_column": "main.s.returns.order_id"}) == "main.s.returns.order_id"
    assert key({}, "not a dict") == ""
    spark = TagSpark({"s.returns_v2.card_no": [("x", "y")]})
    inst = _inspire(agent_ns, spark)
    assert "never the key" in inst._implement_personal_key("UC-1", {"data": {"tables": {"main.s.returns": "main.s.returns_v2"}}},
                                                           _auto("main.s.returns.card_no"))
    assert spark.calls[0][1] == {"s": "s", "t": "returns_v2", "c": "card_no"}


def test_the_build_refuses_the_key_before_the_source_checks_and_any_build_step():
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    guard = "personal = self._implement_personal_key(uc_id, spec, use_case)"
    assert guard in source and "raise ImplementBlocked(personal)" in source
    assert source.index(guard) < source.index("self._implement_source_checks(")
    assert source.index(guard) < source.index("self._implement_write_instruction(")
    assert source.index("if spec.get('uninstall'):") < source.index(guard)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_agent_and_the_app_share_one_personal_data_rule(agent_ns):
    script = (f"import * as P from {json.dumps(PERSONAL_JS)};"
              "console.log(JSON.stringify({name: P.PERSONAL_NAME_RE.source, tag: P.PERSONAL_TAG_RE.source, "
              "nameFlags: P.PERSONAL_NAME_RE.flags, tagFlags: P.PERSONAL_TAG_RE.flags, reason: P.PERSONAL_KEY_REASON}))")
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out["name"] == agent_ns["DEEP_PII_NAME_RE"].pattern
    assert out["tag"] == agent_ns["DEEP_PII_TAG_RE"].pattern
    assert out["nameFlags"] == out["tagFlags"] == "i"
    assert out["reason"] == agent_ns["IMPLEMENT_PERSONAL_KEY_REASON"]
