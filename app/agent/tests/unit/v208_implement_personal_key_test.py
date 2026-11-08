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
    def __init__(self, tags=None, fail=False, columns=None):
        self.tags = tags or {}
        self.fail = fail
        self.columns = columns or {}
        self.calls = []

    def sql(self, statement, args=None, **_kwargs):
        self.calls.append((" ".join(statement.split()), dict(args or {})))
        if self.fail:
            raise PermissionError("User does not have USE SCHEMA on information_schema")
        ref = (args or {})
        table = f"{ref.get('s')}.{ref.get('t')}".lower()
        if "information_schema`.`columns`" in statement:
            rows = [{"column_name": c, "data_type": "string"} for c in self.columns.get(table, [])]
        else:
            rows = [{"column_name": key.rsplit(".", 1)[1], "tag_name": n, "tag_value": v}
                    for key, tags in self.tags.items() if key.rsplit(".", 1)[0] == table for n, v in tags]
        return type("Rows", (), {"collect": lambda _self: rows})()


def _inspire(agent_ns, spark):
    inst = make_inspire(agent_ns)
    inst.spark = spark
    return inst


def _auto(column):
    return {"elite_assessment": {"entity_key_column": column}}


def test_an_auto_picked_key_with_a_pii_tag_is_swapped_for_a_safe_key_of_its_table_and_never_blocks(agent_ns):
    spark = TagSpark({"s.orders.ref_code": [("Data_Class", "PII")], "s.orders.buyer_email_id": [("Data_Class", "PII")]},
                     columns={"s.orders": ["ref_code", "amount", "buyer_email_id", "order_id"]})
    inst = _inspire(agent_ns, spark)
    use_case = _auto("main.s.orders.ref_code")
    assert inst._implement_personal_key("UC-1", {"data": {}}, use_case) == ""
    assert use_case["elite_assessment"]["entity_key_column"] == "main.s.orders.order_id"
    assert use_case["_implement_key_note"] == agent_ns["IMPLEMENT_KEY_SWAPPED"].format(ref="main.s.orders.ref_code", key="main.s.orders.order_id")
    statement, args = spark.calls[0]
    assert "FROM system.information_schema.column_tags WHERE catalog_name = lower(:k)" in statement
    assert args == {"k": "main", "s": "s", "t": "orders"}
    assert agent_ns["implement_result_key"]({"data": {}}, use_case["elite_assessment"]) == "main.s.orders.order_id"


def test_an_auto_picked_personal_key_with_no_other_key_is_hashed_even_when_the_tags_cannot_be_read(agent_ns):
    inst = _inspire(agent_ns, TagSpark(fail=True))
    use_case = _auto("main.s.payments.cardNumber")
    assert inst._implement_personal_key("UC-1", {"data": {}}, use_case) == ""
    assert use_case["_implement_key_note"] == agent_ns["IMPLEMENT_KEY_HASHED"].format(ref="main.s.payments.cardNumber", column="cardNumber")
    assert "sha2(CAST(cardNumber AS STRING), 256)" in use_case["_implement_key_note"]
    assert any(level == "WARNING" and "[IMPLEMENT-PERSONAL-KEY]" in m and "only its name is checked" in m for level, m in inst.logger.records)


def test_a_personal_key_the_user_picked_is_refused(agent_ns):
    inst = _inspire(agent_ns, TagSpark(columns={"s.payments": ["cardNumber", "payment_id"]}))
    use_case = _auto("main.s.payments.payment_id")
    spec = {"data": {"column_roles": {"entity_id": "main.s.payments.cardNumber"}}}
    assert inst._implement_personal_key("UC-1", spec, use_case).startswith("result key main.s.payments.cardNumber: ")
    assert "_implement_key_note" not in use_case


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
    spark = TagSpark({"s.returns_v2.card_no": [("x", "y")]}, columns={"s.returns_v2": ["card_no", "return_id"]})
    inst = _inspire(agent_ns, spark)
    swapped = _auto("main.s.returns.card_no")
    assert inst._implement_personal_key("UC-1", {"data": {"tables": {"main.s.returns": "main.s.returns_v2"}}}, swapped) == ""
    assert spark.calls[0][1] == {"k": "main", "s": "s", "t": "returns_v2"}
    assert swapped["elite_assessment"]["entity_key_column"] == "main.s.returns.return_id"
    assert key({"data": {"tables": {"main.s.returns": "main.s.returns_v2"}}}, swapped["elite_assessment"]) == "main.s.returns_v2.return_id"
    assert "never the key" in inst._implement_personal_key(
        "UC-1", {"data": {"tables": {"main.s.returns": "main.s.returns_v2"}, "column_roles": {"entity_id": "main.s.returns_v2.card_no"}}},
        _auto("main.s.returns.return_id"))


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
