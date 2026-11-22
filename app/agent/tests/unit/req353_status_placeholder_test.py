"""REQ-353 part 1: a build failure message never shows a redaction placeholder inside code or a column name.

Genie's fix hint for a grouped build names code: partition with Window.partitionBy("inspire_group"), groupBy("inspire_group") or a pandas
groupby("inspire_group"). The one redaction hid every quoted text that was not a known name, so the hint read
Window.partitionBy("a data value"). A quoted column name inside a column-taking call is schema, not a data value: it stays as written.
A quoted data value (a SQL literal, a value passed to F.lit) is still hidden. Offline, on the real notebook functions (agent_ns)."""
import pytest

PLACEHOLDER = "a data value"
GROUPING = {"applies": True, "columns": ["paymentMethod"], "time_column": None}


def _hint(agent_ns):
    problems = agent_ns["implement_grouping_problems"]([("cell 3", "def score(df, group_by):\n    df = inspire_group_records(df, group_by=group_by)\n    return df.groupBy('region').mean()\n")], GROUPING)
    assert problems and "Window.partitionBy(" in " ".join(problems), problems
    return "; ".join(problems)


def test_the_grouping_fix_hint_keeps_its_code_through_the_redaction(agent_ns):
    text = _hint(agent_ns)
    for shown in (agent_ns["inspire_redact_text"](text, set(), ""), agent_ns["redact_error"](ValueError(text)),
                  agent_ns["implement_status_error"](text)):
        assert PLACEHOLDER not in shown, shown
        assert 'Window.partitionBy("inspire_group")' in shown and 'groupby("inspire_group")' in shown, shown


@pytest.mark.parametrize("code", [
    'Window.partitionBy("paymentMethod")',
    "df.groupBy('paymentMethod', 'region')",
    'df.groupBy("region", "paymentMethod")',
    'F.col("paymentMethod")',
    "df.orderBy('paymentMethod')",
])
def test_a_column_name_inside_a_column_call_is_shown_as_written(agent_ns, code):
    shown = agent_ns["inspire_redact_text"](f"Genie wrote {code} and it failed", set(), "")
    assert PLACEHOLDER not in shown and code in shown, shown


@pytest.mark.parametrize("text,secret", [
    ("the filter was city = 'Zurichville' and it matched nothing", "Zurichville"),
    ('the step used F.lit("Zurichville") as the default', "Zurichville"),
    ("the value 'Zurichville' was not found", "Zurichville"),
])
def test_a_quoted_data_value_is_still_hidden(agent_ns, text, secret):
    shown = agent_ns["inspire_redact_text"](text, set(), "")
    assert secret not in shown and PLACEHOLDER in shown, shown
