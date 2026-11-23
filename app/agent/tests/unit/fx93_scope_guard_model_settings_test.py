"""FX-93 (REQ-471, REQ-483): the build scope guard refused model settings as if they were row filters. A cell that wrote
DummyClassifier(strategy=...) or RandomForestClassifier(n_estimators=...) next to a WHERE text, or compared a local variable in a
filter, was refused for filtering `strategy` / `n_estimators`, which are no column of any table the person chose. The guard now
refuses a row condition only when its column is a real column of a table the build reads (the `columns` argument, lower case)."""
CHOSEN_COLUMNS = {"paymentmethod", "amount", "customerid", "region"}
KEPT_VISA = {"paymentmethod": ["visa"]}
MODEL_CELL = 'model = RandomForestClassifier(n_estimators=100)\nbase = DummyClassifier(strategy="most_frequent")'
SQL_TEXT_CELL = ("q = \"SELECT customerID FROM main.sales.orders WHERE amount > 5\"\n"
                 "note = \"fit with strategy='most_frequent' and n_estimators=100\"")
WHERE_TEXT_CELL = "note = \"WHERE the model uses strategy='most_frequent', n_estimators=100\""
COMPARE_CELL = "df = spark.table('main.sales.orders').filter(strategy == 'most_frequent')"
SUBSCRIPT_CELL = "keep = settings[n_estimators == 100]"


def _problems(agent_ns, source, allowed=None, columns=CHOSEN_COLUMNS):
    allowed = {} if allowed is None else allowed
    return agent_ns["implement_row_filter_problems"]([("cell 3", source)], allowed, columns)


def test_model_keyword_settings_are_no_row_filter(agent_ns):
    assert _problems(agent_ns, MODEL_CELL) == []


def test_model_settings_written_as_text_are_no_row_filter(agent_ns):
    assert _problems(agent_ns, WHERE_TEXT_CELL) == []
    assert _problems(agent_ns, SQL_TEXT_CELL) == []


def test_comparing_a_local_variable_is_no_row_filter(agent_ns):
    assert _problems(agent_ns, COMPARE_CELL) == []
    assert _problems(agent_ns, SUBSCRIPT_CELL) == []


def test_a_scoped_column_filtered_to_an_out_of_scope_value_is_still_refused(agent_ns):
    cell = "df = spark.table('main.sales.orders').filter(col('paymentMethod') == 'cash')"
    problems = _problems(agent_ns, cell, KEPT_VISA)
    assert len(problems) == 1 and "filters `paymentMethod` to 'cash'" in problems[0], problems
    assert _problems(agent_ns, cell.replace("cash", "visa"), KEPT_VISA) == []


def test_a_real_column_the_scope_does_not_keep_is_still_refused(agent_ns):
    cell = "df = spark.table('main.sales.orders').where(col('region') == 'north')"
    problems = _problems(agent_ns, cell, KEPT_VISA)
    assert len(problems) == 1 and "does not keep `region`" in problems[0], problems


def test_model_settings_do_not_hide_a_real_refused_condition_in_the_same_cell(agent_ns):
    cell = MODEL_CELL + "\ndf = spark.table('main.sales.orders').where(col('region') == 'north')"
    problems = _problems(agent_ns, cell, KEPT_VISA)
    assert len(problems) == 1 and "`region`" in problems[0], problems
