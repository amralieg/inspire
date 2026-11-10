import re

BARE_IDENTIFIER = re.compile(r"(?<![`\w.])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![\w`])")


def test_bare_column_ids_in_promised_text_read_as_plain_words(agent_ns):
    promised = agent_ns["implement_promised"]({
        "Business Value": "Cut the losses on total_amount.",
        "value_estimate_text": "Value not measured yet: measure the share of the change from total_amount, distribution_channel.",
        "Financial Benefits": ["Recovered revenue from ticket_status."],
    })
    text = " ".join([promised.get("value", ""), promised.get("estimate", ""), *promised.get("benefits", [])])
    assert BARE_IDENTIFIER.findall(text) == []
    assert "from total amount, distribution channel." in promised["estimate"]
    assert promised["benefits"] == ["Recovered revenue from ticket status."]


def test_backticked_and_dotted_identifiers_keep_their_existing_rendering(agent_ns):
    words = agent_ns["inspire_ident_words"]
    assert words("Use `total_amount` and orders.total_amount.") == "Use total amount and orders.total_amount."
    assert words("Plain text, no ids.") == "Plain text, no ids."
