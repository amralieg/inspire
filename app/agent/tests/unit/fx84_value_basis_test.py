"""FX-84a: the build reads the user's saved Calculate answer and puts a value basis in the App settings."""
import json
import math
import os
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _row(amount=1_000_000, currency="USD", calculated=True, noun="claim", groups=(600, 400), typed=(), version=3, saved_at="2026-11-20 10:00:00"):
    inputs = [{"id": i, "source": s, "value": v} for i, s, v in typed]
    yearly = {"total": {"amount": amount}, "currency": currency, "calculated": calculated, "case_noun": noun,
              "parts": [{"inputs": inputs}]}
    yearly["total"]["currency"] = currency
    answers = {"plan": {"groups": [{"records_per_year": g} for g in groups]}}
    return {"answers": answers, "yearly": yearly, "version": version, "saved_at": saved_at}


def test_groups_give_cases_from_your_data(agent_ns):
    got = agent_ns["inspire_value_basis"](_row())
    assert got["amount"] == 1_000_000 and got["currency"] == "USD" and got["status"] == "calculated"
    assert got["cases_per_year"] == 1000 and got["cases_from"] == "your data" and got["case_noun"] == "claim"
    assert got["version"] == 3 and got["saved_at"] == "2026-11-20 10:00:00"
    assert "disclaimer" not in got


def test_a_typed_case_count_wins(agent_ns):
    got = agent_ns["inspire_value_basis"](_row(typed=[("incidents_per_year", "typed", 250)]))
    assert got["cases_per_year"] == 250 and got["cases_from"] == "your answer"


def test_typed_counts_that_disagree_fall_back_to_the_groups(agent_ns):
    got = agent_ns["inspire_value_basis"](_row(typed=[("incidents_per_year", "typed", 250), ("events_per_year", "typed", 300)]))
    assert got["cases_per_year"] == 1000 and got["cases_from"] == "your data"


def test_data_sourced_inputs_are_not_typed(agent_ns):
    got = agent_ns["inspire_value_basis"](_row(typed=[("events_per_year", "data", 77)]))
    assert got["cases_per_year"] == 1000 and got["cases_from"] == "your data"


def test_estimated_and_default_noun(agent_ns):
    got = agent_ns["inspire_value_basis"](_row(calculated=False, noun=""))
    assert got["status"] == "estimated" and got["case_noun"] == "record"


@pytest.mark.parametrize("row", [
    _row(amount=0), _row(amount=-5), _row(amount=float("nan")), _row(amount=float("inf")), _row(currency="usd1"), _row(currency="usd"),
    _row(groups=()), _row(groups=(0, 0)), {"answers": {}, "yearly": None, "version": 1, "saved_at": ""}, None,
])
def test_no_basis_when_the_answer_cannot_back_a_number(agent_ns, row):
    assert agent_ns["inspire_value_basis"](row) is None


def _settings(agent_ns, **extra):
    return agent_ns["implement_app_settings"](1, "T", ["p1"], None, "", "2026-11-22T00:00:00Z", {}, **extra)


def test_settings_emit_value_basis_by_page_id(agent_ns):
    basis = {"amount": 5.0, "currency": "USD"}
    assert _settings(agent_ns, value_basis={"p1": basis})["value_basis"] == {"p1": basis}
    assert "value_basis" not in _settings(agent_ns)
    assert "value_basis" not in _settings(agent_ns, value_basis=None)


def test_a_missing_table_gives_no_basis_and_does_not_fail(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.inspire_database = "cat.db"
    obj.logger = agent_ns["logging"].getLogger("fx84-value-basis")

    class Spark:
        def sql(self, text, args=None):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cat.db.__inspire_value_answers cannot be found")
    obj.spark = Spark()
    assert obj._implement_value_basis({"key": (7,), "uc_id": "N01-U01"}) is None


def test_the_read_is_parameterized_and_returns_the_basis(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.inspire_database = "cat.db"
    obj.logger = agent_ns["logging"].getLogger("fx84-value-basis")
    seen = []
    row = _row()

    class Row:
        def __getitem__(self, i):
            return [json.dumps(row["answers"]), json.dumps(row["yearly"]), row["version"], row["saved_at"]][i]

    class Spark:
        def sql(self, text, args=None):
            seen.append((text, args))
            return types.SimpleNamespace(collect=lambda: [Row()])
    obj.spark = Spark()
    got = obj._implement_value_basis({"key": (7,), "uc_id": "N01-U01"})
    assert got["cases_per_year"] == 1000
    text, args = seen[0]
    assert "__inspire_value_answers" in text and ":sid" in text and ":uc" in text and "N01-U01" not in text
    assert args == {"sid": "7", "uc": "N01-U01"}
