import re

from v120_artifacts_support import elite_assessment, make_uc

BARE_IDENTIFIER = re.compile(r"(?<![`{\w.])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![\w`}])")


def test_every_kind_value_formula_renders_plain_words_not_raw_identifiers(agent_ns):
    uc = make_uc("N01-U01", elite_assessment=elite_assessment(entity_key_column="main.s.sales.store_id"))
    words = dict(agent_ns["inspire_kind_words"](uc), value_at_stake="a money amount")
    offenders = []
    for kind in agent_ns["_inspire_kinds"]()["kinds"]:
        rendered = agent_ns["inspire_kind_fill"](kind.get("value_formula"), words)
        offenders += [(kind["id"], found) for found in BARE_IDENTIFIER.findall(re.sub(r"`[^`]*`", "", rendered))]
    assert offenders == []
