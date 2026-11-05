from v208_implement_personal_key_test import TagSpark, _auto, _inspire


def test_a_data_classification_tag_with_no_value_marks_the_column_personal(agent_ns):
    pii = agent_ns["deep_column_is_pii"]
    for tag in ("class.email_address", "class.credit_card", "class.name", "CLASS.PHONE_NUMBER"):
        assert pii("contact_ref", {tag: ""}), tag
    assert pii("contact_ref", {"class.location": None})
    for tags in ({"class": "internal"}, {"business.class": "gold"}, {"subclass.tier": ""}, {"owner": "sales"}, {}):
        assert not pii("contact_ref", tags), tags


def test_an_auto_picked_key_data_classification_tagged_is_refused_and_an_unclassified_one_is_kept(agent_ns):
    spark = TagSpark({"s.members.contact_ref": [("class.email_address", "")], "s.members.member_id": [("class", "internal")]})
    inst = _inspire(agent_ns, spark)
    reason = inst._implement_personal_key("UC-1", {"data": {}}, _auto("main.s.members.contact_ref"))
    assert reason == f"result key main.s.members.contact_ref: {agent_ns['IMPLEMENT_PERSONAL_KEY_REASON']}"
    assert inst._implement_personal_key("UC-1", {"data": {}}, _auto("main.s.members.member_id")) == ""


def test_the_users_chosen_key_data_classification_tagged_is_refused(agent_ns):
    spark = TagSpark({"s.members.holder_code": [("class.credit_card", "")]})
    inst = _inspire(agent_ns, spark)
    spec = {"data": {"column_roles": {"entity_id": "main.s.members.holder_code"}}}
    assert "never the key of the result" in inst._implement_personal_key("UC-1", spec, _auto("main.s.members.member_id"))


def test_the_classification_rule_reads_only_a_tag_key_that_starts_with_class(agent_ns):
    assert agent_ns["DEEP_PII_TAG_RE"].search("class.ip_address ")
    assert not agent_ns["DEEP_PII_TAG_RE"].search("tier class.gold")
