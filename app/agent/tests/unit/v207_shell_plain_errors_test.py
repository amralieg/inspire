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
RAW = ("SQLSTATE", "42501", "INSUFFICIENT_PERMISSIONS", "Traceback", "File \"", "java.", "org.apache")
NO_ACCESS = "No access to main.inspire.churn_out_closed"


def _plain(text):
    return not any(word in text for word in RAW)


def test_a_permission_error_reaches_the_page_as_a_plain_sentence_and_the_log_keeps_the_detail(capsys):
    detail = shell_sql.error_text(shell_db.QueryError(f"the SQL warehouse did not answer: {DENIED}"))
    assert "INSUFFICIENT_PERMISSIONS" in detail, "the build check keeps the error class to repair the page"
    answer = {"rows": [{"note": "SQLSTATE kept in data"}], "errors": {"impact": detail}, "error": detail, "facts": {"reason": "Fine words."},
              "tiles": [{"problem": f"stake failed: {detail}"}]}
    shown = shell_sql.plain_answer(answer)
    assert shown["errors"]["impact"] == shown["error"] == NO_ACCESS and _plain(shown["tiles"][0]["problem"])
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


def test_a_sentence_the_shell_wrote_keeps_its_reason_and_next_step_and_only_the_raw_part_in_brackets_goes(capsys):
    kept = {
        f"The App did not ask Genie about this record: you cannot read it in Unity Catalog ({DENIED})":
            "The App did not ask Genie about this record: you cannot read it in Unity Catalog",
        f"Nothing was saved: you may not change `a`.`b`.`c` in Unity Catalog ({DENIED}). Ask the owner of that table.":
            "Nothing was saved: you may not change `a`.`b`.`c` in Unity Catalog. Ask the owner of that table.",
        "Nothing was saved: you cannot read t (Error: [X_FAILED] at line (3)), so the App records no decision on it":
            "Nothing was saved: you cannot read t, so the App records no decision on it",
    }
    for text, plain in kept.items():
        assert shell_sql.plain_error(text) == plain and _plain(plain), text
    falls_back = {
        f"({DENIED})": "not_allowed",
        f"the SQL warehouse did not answer: {DENIED}": "not_allowed",
        f"stake failed ({DENIED}) and then [TABLE_OR_VIEW_NOT_FOUND] again": "missing_table",
        f"the read stopped ({DENIED}": "not_allowed",
        "it could not read it (warehouse stopped) [DIVIDE_BY_ZERO] Division by zero": "",
    }
    for text, code in falls_back.items():
        assert shell_sql.plain_error(text) == (NO_ACCESS if code == "not_allowed" else shell_sql.PLAIN_ERRORS[code]), text
    assert shell_sql.plain_error("it could not read it (warehouse stopped)") == "it could not read it (warehouse stopped)"
    assert capsys.readouterr().err.count("[PLAIN-ERROR FIRED]") == len(kept) + len(falls_back)


def test_the_run_errors_live_once_and_the_run_page_codes_still_read_the_raw_message():
    assert shell_core.RUN_ERRORS is shell_sql.RUN_ERRORS and shell_core.run_error_code is shell_sql.run_error_code
    assert shell_core.run_error_code(DENIED) == "not_allowed"
    assert set(code for code, _p in shell_sql.RUN_ERRORS) | {""} == set(shell_sql.PLAIN_ERRORS)


def test_a_failed_job_run_message_and_a_failed_genie_answer_are_plain():
    view = shell_core.job_run_view({"run_id": 7, "state": {"life_cycle_state": "TERMINATED", "result_state": "FAILED", "state_message": DENIED},
                                    "start_time": 1, "end_time": 2}, "")
    assert view["result"] == "failed" and view["message"] == DENIED, "the job run keeps its raw message so the run keeps its error class"
    assert shell_core.run_error_code(view["message"]) == "not_allowed"
    assert shell_sql.plain_answer({"runs": [view]})["runs"][0]["message"] == NO_ACCESS, "the answer is plain"
    source = open(os.path.join(SERVER, "shell_db.py")).read()
    assert '"error": plain_error(inspire_redact_text((message.get("error") or {}).get("error")' in source
    core = open(os.path.join(SERVER, "shell_core.py")).read()
    assert core.count("shell_sql.plain_error(inspire_redact_text(") == 1 and core.count("shell_sql.plain_error(f\"Inspire could not read the page files") == 1


def test_a_permission_error_names_the_data_and_never_sends_people_to_rebuild_the_app():
    cases = {
        DENIED: "No access to main.inspire.churn_out_closed",
        "[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on Schema 'main.s'. SQLSTATE: 42501": "No access to main.s",
        "PERMISSION_DENIED: User does not have USE CATALOG on Catalog `main` SQLSTATE: 42501": "No access to main",
        "[INSUFFICIENT_PERMISSIONS] Insufficient privileges SQLSTATE: 42501": shell_sql.PLAIN_ERRORS["not_allowed"],
    }
    for text, said in cases.items():
        assert shell_sql.plain_error(text) == said, text
        assert said.startswith(shell_sql.NO_ACCESS_LEAD)
        assert not any(w in said.lower() for w in ("again with", "build it", "rebuild", "person who built")), said
    assert shell_sql.no_access_text(tables=["`main`.`s`.`a`", "main.s.b", "main.s.a"]) == "No access to main.s.a, main.s.b"
    assert shell_sql.plain_error("[TABLE_OR_VIEW_NOT_FOUND] The table or view `a`.`b`.`c` cannot be found. SQLSTATE: 42P01") == \
        shell_sql.PLAIN_ERRORS["missing_table"], "a missing table is not called a permission problem (must-exclude)"
