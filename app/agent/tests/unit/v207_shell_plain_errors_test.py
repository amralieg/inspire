import os
import sys

from _nbload import ROOT

SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402

DENIED = ("[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`inspire`.`churn_out_closed`. "
          "SQLSTATE: 42501")
RAW = ("SQLSTATE", "42501", "INSUFFICIENT_PERMISSIONS", "churn_out_closed", "Traceback", "File \"", "java.", "org.apache")


def _plain(text):
    return not any(word in text for word in RAW)


def test_a_permission_error_reaches_the_page_as_a_plain_sentence_and_the_log_keeps_the_detail(capsys):
    detail = shell_sql.error_text(shell_db.QueryError(f"the SQL warehouse did not answer: {DENIED}"))
    assert "INSUFFICIENT_PERMISSIONS" in detail, "the build check keeps the error class to repair the page"
    answer = {"rows": [{"note": "SQLSTATE kept in data"}], "errors": {"impact": detail}, "error": detail, "facts": {"reason": "Fine words."},
              "tiles": [{"problem": f"stake failed: {detail}"}]}
    shown = shell_sql.plain_answer(answer)
    assert shown["errors"]["impact"] == shown["error"] == shell_sql.PLAIN_ERRORS["not_allowed"] and _plain(shown["tiles"][0]["problem"])
    assert shown["facts"]["reason"] == "Fine words." and shown["rows"] == [{"note": shell_sql.plain_error("SQLSTATE kept in data")}]
    assert "[PLAIN-ERROR FIRED] not_allowed" in capsys.readouterr().err
    core = open(os.path.join(SERVER, "shell_core.py"), encoding="utf-8").read()
    assert "        status, answer = self.answer(method, path, query, headers, body)\n        return status, shell_sql.plain_answer(answer)\n" in core


def test_every_sql_error_class_has_a_plain_sentence_with_a_next_step():
    cases = {
        "[TABLE_OR_VIEW_NOT_FOUND] The table or view `a`.`b`.`c` cannot be found. SQLSTATE: 42P01": "missing_table",
        "[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column `x` cannot be resolved. SQLSTATE: 42703": "missing_column",
        "[QUERY_TIMEDOUT] the statement timed out SQLSTATE: HYT00": "timed_out",
        "[DIVIDE_BY_ZERO] Division by zero. SQLSTATE: 22012": "",
        "Traceback (most recent call last):\n  File \"/app/x.py\", line 3, in f\nValueError: boom": "",
        "py4j.protocol.Py4JJavaError: An error occurred while calling o1.sql": "",
    }
    for text, code in cases.items():
        said = shell_sql.plain_error(text)
        assert said == shell_sql.PLAIN_ERRORS[code] and _plain(said), text
        assert said.rstrip().endswith(".") and any(w in said.lower() for w in ("ask ", "try again")), said


def test_plain_words_the_shell_wrote_itself_pass_through_untouched():
    for text in ("no run of this use case has written its results yet", "'2026-13-45' is not a YYYY-MM-DD date",
                 "[KIND-DETECT FIRED] a log tag is not an error class", "the list changed; reload it and try again", ""):
        assert shell_sql.plain_error(text) == text
    assert shell_sql.error_text(ValueError("")) == "ValueError"
    assert shell_sql.plain_answer({"error": "a page named x does not exist"}) == {"error": "a page named x does not exist"}


def test_the_run_errors_live_once_and_the_run_page_codes_still_read_the_raw_message():
    assert shell_core.RUN_ERRORS is shell_sql.RUN_ERRORS and shell_core.run_error_code is shell_sql.run_error_code
    assert shell_core.run_error_code(DENIED) == "not_allowed"
    assert set(code for code, _p in shell_sql.RUN_ERRORS) | {""} == set(shell_sql.PLAIN_ERRORS)


def test_a_failed_job_run_message_and_a_failed_genie_answer_are_plain():
    view = shell_core.job_run_view({"run_id": 7, "state": {"life_cycle_state": "TERMINATED", "result_state": "FAILED", "state_message": DENIED},
                                    "start_time": 1, "end_time": 2}, "")
    assert view["result"] == "failed" and view["message"] == shell_sql.PLAIN_ERRORS["not_allowed"], view
    source = open(os.path.join(SERVER, "shell_db.py")).read()
    assert '"error": plain_error(inspire_redact_text((message.get("error") or {}).get("error")' in source
    core = open(os.path.join(SERVER, "shell_core.py")).read()
    assert core.count("shell_sql.plain_error(inspire_redact_text(") == 2 and core.count("shell_sql.plain_error(f\"Inspire could not read the page files") == 1
