import ast
import os
import re
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import _agentload  # noqa: E402
import shell_agent  # noqa: E402
import shell_alerts  # noqa: E402
import shell_core  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402

SQL_WORDS = re.compile(r"\b(SELECT|WHERE|LIMIT|CAST\(|INSERT|UPDATE |MERGE|JOIN|GROUP BY|ORDER BY|ALTER TABLE|CREATE |VALUES|"
                       r"timestamp_micros|COUNT_IF|NULLIF|HAVING|INTERVAL|DATE_SUB|VERSION AS OF|TBLPROPERTIES|CASE WHEN|LAG\(|"
                       r"COALESCE|DISTINCT_STEPS)\b")
LOG_CALLS = re.compile(r"(^|\.)(logger\.\w+|_logger\.\w+|log_print|print|debug|info)$")
FORMATTERS = {"implement_number_text", "inspire_number_text", "inspire_plural", "shown_number", "plural", "number_text",
              "fmt_num", "fmt_count", "implement_share_text", "inspire_listing"}
NOT_COUNTS = re.compile(r"(VERSION|YEAR|_ID$|PORT|CODE|HASH|BUCKETS|SEED|_S$|_US$|_MS$|TIMEOUT)")
SINK_CALLS = {"_emit_pipeline_status", "_record_failed_step", "_implement_emit", "_pipeline_step", "_check", "out", "note",
              "ImplementBlocked", "HttpError", "QueryError"}
TOKEN_BEFORE = re.compile(r"[\w)][=:]$")
SINK_LISTS = {"problems", "warnings", "notes", "facts", "errors", "failures", "missed", "parts", "issues", "reasons"}


def _cell_source():
    return _agentload.agent_source()


def _result_history_source():
    tree = ast.parse(_cell_source())
    for node in tree.body:
        if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == "IMPLEMENT_RESULT_HISTORY_SOURCE":
            return node.value.value
    raise AssertionError("IMPLEMENT_RESULT_HISTORY_SOURCE is missing")


def _sources():
    yield "cell 1", _cell_source()
    yield "result history", _result_history_source()
    for name in ("shell_agent", "shell_alerts", "shell_core", "shell_pg", "shell_sql", "shell_facts", "shell_db"):
        with open(os.path.join(SERVER, f"{name}.py"), encoding="utf-8") as handle:
            yield name, handle.read()


def _parents(tree):
    up = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            up[child] = node
    return up


def _call_name(call):
    return ast.unparse(call.func)


def _sink(node, up):
    while node in up:
        node = up[node]
        if isinstance(node, ast.Call):
            name = _call_name(node)
            if LOG_CALLS.search(name):
                return None
            short = name.rsplit(".", 1)[-1]
            if short in FORMATTERS:
                return None
            if short in SINK_CALLS:
                return name
            if short == "append" and name.split(".")[0] in SINK_LISTS:
                return name
            if short in ("raise_", "ValueError", "RuntimeError"):
                return name
        if isinstance(node, ast.keyword) and node.arg == "message":
            return "message="
        if isinstance(node, ast.Assign):
            target = ast.unparse(node.targets[0])
            return target if re.search(r"(message|reason|drop_reason|_reason\"\])$", target) else None
        if isinstance(node, ast.AugAssign):
            return ast.unparse(node.target) if ast.unparse(node.target) in SINK_LISTS else None
        if isinstance(node, (ast.FunctionDef, ast.Lambda)):
            return None
    return None


def _bare_counts(label, source):
    tree = ast.parse(source)
    up = _parents(tree)
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.JoinedStr):
            continue
        words = "".join(v.value for v in node.values if isinstance(v, ast.Constant))
        if SQL_WORDS.search(words):
            continue
        for at, value in enumerate(node.values):
            if not isinstance(value, ast.FormattedValue) or value.format_spec is not None or value.conversion != -1:
                continue
            before = node.values[at - 1].value if at and isinstance(node.values[at - 1], ast.Constant) else ""
            if TOKEN_BEFORE.search(before):
                continue
            expr = value.value
            counted = (isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id == "len") or (
                isinstance(expr, ast.BinOp) and any(isinstance(n, ast.Call) and getattr(n.func, "id", "") == "len"
                                                    for n in ast.walk(expr)))
            if counted and _sink(node, up):
                found.append(f"{label}:{value.lineno}: {{{ast.unparse(expr)}}} in {_sink(node, up)}")
    return found


def test_inspire_plural_groups_every_whole_count_and_keeps_its_noun(agent_ns):
    plural = agent_ns["inspire_plural"]
    assert plural(1000, "record") == "1,000 records"
    assert plural(1234567, "row") == "1,234,567 rows"
    assert plural(1234567.0, "row") == "1,234,567 rows"
    assert plural(-2500, "change") == "-2,500 changes"
    assert plural(1234.5, "hour") == "1,234.5 hours"
    assert plural(1, "record") == "1 record"
    assert plural(999, "record") == "999 records"
    assert plural(0.5, "day") == "0.5 days"
    assert plural(None, "record") == "an unknown number of records"
    assert plural("many", "record") == "many records"
    assert plural(1000, "record", grouped=False) == "1000 records"


def test_a_setting_value_stays_plain_so_it_reads_back_and_grouping_is_opt_in(agent_ns):
    text = agent_ns["inspire_number_text"]
    assert text(1234567) == "1234567"
    assert text(2500.25) == "2500.25"
    assert text(1234567, grouped=True) == "1,234,567"
    assert text(2500.25, grouped=True) == "2,500.25"
    assert agent_ns["inspire_setting_text"](50000) == "50000"
    assert shell_sql.number_text(1234567) == "1234567"


@pytest.mark.parametrize("n", [0, 7, 999, 1000, 1001, 65536, 1234567, 10 ** 9, -1000, -98765])
def test_the_result_history_text_and_fmt_num_write_a_whole_number_the_same_way(agent_ns, n):
    assert agent_ns["inspire_number_text"](n, grouped=True) == agent_ns["implement_number_text"](n) == shell_sql.shown_number(n)


def test_a_long_listing_groups_how_many_more_it_leaves_out(agent_ns):
    items = [f"t{i}" for i in range(1025)]
    assert agent_ns["inspire_listing"](items, ", ", 20).endswith(", and 1,005 more")
    assert agent_ns["inspire_listing"](["a", "b"], ", ", 20) == "a, b"


def test_the_tier_mix_warning_groups_its_counts_and_keeps_the_run_url(agent_ns):
    warn = agent_ns["implement_tier_mix_warning"]
    url = "https://h/jobs/7/runs/1234567890123"
    text = warn({"Monitor": 1000, "no tier": 2500}, url)
    assert "(2,500 no tier, 1,000 Monitor)" in text and text.endswith(f"; run: {url}")
    profile = {"rows": 2000, "valued": 2000, "distinct": 1500, "span": 12500.0, "flagged": 1200, "flag_kinds": 1}
    text = warn({"Monitor": 2000}, "", profile)
    assert "column value holds 1,500 distinct values spanning 12,500" in text
    assert "1,200 of 2,000 rows (60%) carry a data_quality_flag other than ok, in 1 kind" in text
    methods = {"methods": [["xgboost", 1500], ["rules", 500]], "kinds": 1200, "versioned_rows": 1}
    assert "its rows come from 1,200 methods in column method" in warn({"Monitor": 2000}, "", None, methods)


def test_the_ai_check_problems_group_the_flagged_and_missing_records(agent_ns):
    problems = agent_ns["implement_ai_check_problems"]({"records": 2000, "flagged": 1500, "missing": 1200,
                                                        "kinds": {"number_mismatch": 1500}}, "summary")
    assert problems[0].startswith("1,500 of the 2,000 records flagged 'Act now' or 'Review'")
    assert problems[0].endswith("(1,500 number_mismatch)")
    assert problems[1].startswith("1,200 records flagged")


class _Frame:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)


class _Spark:
    def __init__(self, *answers):
        self.answers, self.sqls = list(answers), []

    def sql(self, text):
        self.sqls.append(text)
        return _Frame(self.answers.pop(0) if self.answers else [])


def test_the_run_output_lines_group_their_counts(agent_ns):
    fact = agent_ns["inspire_summary_decision_fact"](_Spark([{"act_now_records": 1200, "review_records": 3400, "records": 56000,
                                                              "nothing_to_act": ""}]), "main.s.t", "N01-U01", "r1")
    assert fact.endswith(": 1,200 Act now and 3,400 Review of 56,000 current records")
    kept = agent_ns["inspire_mark_kept"](_Spark([], [{"kept": 1500, "missing": 1100}]), "main.s.t", "main.s.t_stage", ["k"],
                                         "N01-U01", "r1", out=lambda *_: None)
    assert kept.startswith("kept 1,500 records people changed in the App") and "; 1,100 of them are not in this run" in kept
    nothing = agent_ns["inspire_nothing_to_act"]({"records": 5000, "held_records": 5000}, {}, "")
    assert "(5,000 of them)" in nothing
    assert agent_ns["inspire_ai_one_level_text"](4000, "High").startswith("all 4,000 'Act now' and 'Review' records")
    age = agent_ns["inspire_data_age_fact"]("2026-01-01", agent_ns["_inspire_datetime"].date(2029, 6, 1))
    assert age == "The run is as of 2026-01-01, 1,247 days before the day it ran."


@pytest.mark.parametrize("rows,entities", [("12,345", "20,000"), ("12345", "20000"), ("999", "7")])
def test_the_agent_reads_back_a_run_outcome_whether_its_counts_are_grouped_or_not(agent_ns, rows, entities):
    text = (f"wrote {rows} rows for as_of_date 2026-10-01 with run_id 5f0c1d2e; "
            f"the model trained on a preview sample of {entities} entities")
    assert agent_ns["parse_use_case_outcome"](text) == {
        "status": "written", "rows_written": int(rows.replace(",", "")), "as_of_date": "2026-10-01", "run_id": "5f0c1d2e",
        "preview_sample_entities": int(entities.replace(",", ""))}


@pytest.mark.parametrize("rows", ["1,00", "12,3456", ",123", "1,,000"])
def test_a_count_with_misplaced_commas_is_not_read_as_a_run_outcome(agent_ns, rows):
    text = f"wrote {rows} rows for as_of_date 2026-10-01 with run_id 5f0c1d2e"
    assert agent_ns["parse_use_case_outcome"](text)["status"] == "unknown"


def test_ids_years_versions_and_run_ids_are_never_grouped(agent_ns, tmp_path):
    assert agent_ns["implement_session_dir"]("/r", "biz", 1234567890123).endswith("/session_1234567890123")
    assert agent_ns["implement_mvp_dirs"]("/r", "biz", 98765, "d", "u", 1024)["version"].endswith("/v1024")
    restored = agent_ns["inspire_restore_table"](_Spark([{"version": 5}]), "main.s.t", 12345)
    assert restored == "main.s.t is back at its version 12345"
    assert "2026-01-01" in agent_ns["inspire_data_age_fact"]("2026-01-01", agent_ns["_inspire_datetime"].date(2026, 1, 3))
    warning = agent_ns["implement_tier_mix_warning"]({"Monitor": 5}, "https://h/jobs/1234567/runs/9876543210")
    assert warning.endswith("; run: https://h/jobs/1234567/runs/9876543210")


def test_the_app_shell_groups_counts_and_caps_it_writes_into_text():
    assert shell_sql.plural(1234, "row") == "1,234 rows"
    assert shell_sql.plural(1234.0, "row") == "1,234 rows"
    assert shell_sql.plural(2.5, "hour") == "2.5 hours"
    assert shell_sql.plural("some", "row") == "some rows"
    assert shell_sql.plural(1, "record") == "1 record"
    assert shell_core.preview_text([{"n": 1200, "from": "Review", "to": "Act now"}, {"n": 1, "from": "Monitor", "to": "Review"}]) == (
        "If the next run used this value, 1,200 records from Review to Act now and 1 record from Monitor to Review would move.")
    with pytest.raises(ValueError, match=r"from 1 to 1,000$"):
        shell_sql.window_params({"window": shell_sql.WINDOWS[0], "window_limit": 5000}, shell_sql.datetime.datetime(2026, 1, 1))
    with pytest.raises(shell_agent.HttpError, match="at most 1,000 characters"):
        shell_agent.clean_question("x" * 1001)
    assert shell_alerts.folder_problems({"alert_folder": "nope"}) == [
        "the App alert_folder must be a workspace folder path of at most 1,000 characters, not 'nope'"]
    assert shell_sql._count_problem("charts", list(range(1200))) == ["the page has 1,200 charts; it needs 3 to 8"]


def test_every_cap_of_a_thousand_or_more_reads_grouped_in_a_message():
    for name, value in (("ASK_CHARS", shell_core.ASK_CHARS), ("EXPLAIN_CONTEXT_CHARS", shell_core.EXPLAIN_CONTEXT_CHARS),
                        ("CONTEXT_CHARS", shell_agent.CONTEXT_CHARS), ("QUESTION_CHARS", shell_agent.QUESTION_CHARS),
                        ("FOLDER_CHARS", shell_alerts.FOLDER_CHARS), ("OVERLAY_ROWS", shell_pg.OVERLAY_ROWS)):
        assert value >= 1000, name
    found = []
    for label, source in _sources():
        module = {"shell_agent": shell_agent, "shell_alerts": shell_alerts, "shell_core": shell_core, "shell_pg": shell_pg,
                  "shell_sql": shell_sql}.get(label)
        if module is None:
            continue
        tree = ast.parse(source)
        up = _parents(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.JoinedStr) or SQL_WORDS.search("".join(v.value for v in node.values if isinstance(v, ast.Constant))):
                continue
            for value in node.values:
                if not isinstance(value, ast.FormattedValue) or value.format_spec is not None:
                    continue
                expr = ast.unparse(value.value)
                if NOT_COUNTS.search(expr) or any(isinstance(n, ast.Call) for n in ast.walk(value.value)):
                    continue
                try:
                    held = eval(expr, vars(module))
                except Exception:
                    continue
                if isinstance(held, int) and not isinstance(held, bool) and abs(held) >= 1000 and _sink(node, up):
                    found.append(f"{label}:{value.lineno}: {{{expr}}} = {held}")
    assert found == [], found


def test_the_bare_count_scan_flags_a_sentence_count_and_spares_tokens_logs_sql_and_formatted_counts():
    flagged = ('problems.append(f"the page has {len(a)} rows")\n'
               'self._emit_pipeline_status(message=f"Trim: {len(a) - 1} kept")\n'
               'out(f"kept {len(a)} records")\n')
    assert len(_bare_counts("seed", flagged)) == 3
    spared = ('problems.append(f"rows={len(a)}")\nissues.append(f"words:{len(a)}")\nself.logger.info(f"kept {len(a)} rows")\n'
              'problems.append(f"SELECT * FROM t LIMIT {len(a)}")\nproblems.append(f"kept {implement_number_text(len(a))} rows")\n'
              'problems.append(f"kept {len(a):,} rows")\nlabel = f"{len(a)} rows"\n')
    assert _bare_counts("seed", spared) == []


def test_no_user_facing_message_interpolates_a_bare_len_count():
    found = [line for label, source in _sources() for line in _bare_counts(label, source)]
    assert found == [], "\n".join(found)


GROUPING_CALLS = {"implement_number_text", "inspire_plural", "plural", "shown_number"}
APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(TESTS)))
JS_ROOTS = [os.path.join(APP_ROOT, "frontend", "src"), os.path.join(APP_ROOT, "backend", "lib"),
            os.path.join(APP_ROOT, "agent", "agent", "app_shell", "web", "src")]
JS_BARE_OF = re.compile(r"\$\{(?!(?:grouped|shown|plural|counted|integer)\()(?![A-Z][A-Z0-9_]*\})([^{}]+)\} of \$\{(?:plural|counted)\(")


def _plain_count(expr):
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id in ("len", "sum"):
        return True
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, (ast.Add, ast.Sub)):
        sides = (expr.left, expr.right)
        return all(_plain_count(side) or (isinstance(side, ast.Constant) and type(side.value) is int) for side in sides) \
            and any(_plain_count(side) for side in sides)
    return False


def _mixed_counts(label, source):
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.JoinedStr):
            continue
        values = [v for v in node.values if isinstance(v, ast.FormattedValue)]
        if not any(isinstance(v.value, ast.Call) and _call_name(v.value).rsplit(".", 1)[-1] in GROUPING_CALLS for v in values):
            continue
        for at, value in enumerate(node.values):
            before = node.values[at - 1].value if at and isinstance(node.values[at - 1], ast.Constant) else ""
            if isinstance(value, ast.FormattedValue) and value.format_spec is None and value.conversion == -1 \
                    and _plain_count(value.value) and not TOKEN_BEFORE.search(before):
                found.append(f"{label}:{value.lineno}: {{{ast.unparse(value.value)}}}")
    return found


def _js_bare_of(text):
    return [m.group(1) for m in JS_BARE_OF.finditer(text)]


def test_the_mixed_count_scan_flags_a_bare_count_beside_a_grouped_one_and_spares_formatted_or_lone_counts():
    flagged = ('logger.info(f"{len(a)} of {inspire_plural(n, \'row\')} read")\n'
               'x = f"kept {len(a) - len(b)}/{implement_number_text(n)}"\n'
               'y = f"{sum(1 for _ in a)} of {plural(n, \'record\')}"\n')
    assert len(_mixed_counts("seed", flagged)) == 3
    spared = ('logger.info(f"{implement_number_text(len(a))} of {inspire_plural(n, \'row\')} read")\n'
              'x = f"kept {len(a)} rows"\ny = f"{len(a):,} of {plural(n, \'record\')}"\nz = f"batch {i + 1}/{inspire_plural(n, \'batch\')}"\n'
              'w = f"levers={len(a)} p50={shown_number(p)}"\n')
    assert _mixed_counts("seed", spared) == []
    assert _js_bare_of("`${dropped} of ${plural(rows.length, 'row')}` `${a.hits} of ${counted(n, 'x')}`") == ["dropped", "a.hits"]
    assert _js_bare_of("`${grouped(d)} of ${plural(n, 'row')}` `${shown(m)} of ${plural(n, 'MVP')}` `${CHOICES_SHOWN} of ${plural(n, 'c')}`") == []


def test_no_sentence_puts_a_bare_count_beside_a_grouped_one():
    found = [line for label, source in _sources() for line in _mixed_counts(label, source)]
    for root in JS_ROOTS:
        for folder, _dirs, files in os.walk(root):
            for name in files:
                if name.endswith((".js", ".jsx", ".mjs")):
                    path = os.path.join(folder, name)
                    with open(path, encoding="utf-8") as handle:
                        found += [f"{os.path.relpath(path, APP_ROOT)}: ${{{bare}}}" for bare in _js_bare_of(handle.read())]
    assert found == [], "\n".join(found)
