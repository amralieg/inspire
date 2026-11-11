"""A generated MVP App reads in business words: the page spec Genie writes carries one business-words rule, and the App shell
formats ids, counts, statistics codes and the scope line the same way for every App, offline."""
import os
import re

from v120_artifacts_support import FakeSpark  # noqa: F401
from v140_implement_test import _app_flow

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "agent", "app_shell", "web", "src")


def _read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


def test_the_page_spec_prompt_carries_the_business_words_rule_once(agent_ns, tmp_path):
    rule = agent_ns["IMPLEMENT_BUSINESS_WORDS_RULE"]
    assert rule.startswith("- Business words:") and rule.endswith("\n")
    for words in ("likely for P50", "high case for P90", "low case for P10", "forecast error vs a simple guess for MASE",
                  "never write quantile", "entity's name", "Store 41", "whole number", "shows once on the page"):
        assert words in rule, words
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    assert seen["prompt"].count(rule) == 1


def test_the_shell_maps_every_statistics_code_the_rule_names_to_the_same_words(agent_ns):
    rule, source = agent_ns["IMPLEMENT_BUSINESS_WORDS_RULE"], _read("format.js")
    found = re.findall(r"(?:write |, (?:and )?)([a-z ]+?) for (P\d+|MASE)", rule)
    assert len(found) == 4, found
    for words, code in found:
        assert f"'{words}'" in source, f"format.js does not turn {code} into {words}"
    assert "export function plainWords(" in source and "export function entityName(" in source and "export function isCountable(" in source


def test_every_header_label_and_record_name_goes_through_the_one_formatter():
    assert "label: plainWords(c.label)" in _read("DataTable.jsx")
    assert "label: answerLabel(c.name)" in _read("Genie.jsx")
    assert "const chart = plainChart(given);" in _read("charts.js")
    assert "wholeFormat(kpi.format, kpi.label, kpi.unit, kpi.id)" in _read("Kpis.jsx")
    records = _read("Records.jsx")
    assert "entityName(row, meta?.label)" in records
    assert not re.search(r"plainText\((r|row|doomed)\[meta\.label\]\)", records), "a record title shows its raw id"
