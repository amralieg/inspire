import datetime
import json
import os
import subprocess
import sys

import psycopg
import pytest

from _nbload import ROOT

SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402
from v145_lakebase_test import TREND_VIEW, lakebase, password_service  # noqa: E402

PYTHON_310 = "/opt/homebrew/bin/python3.10"
SENTINEL = "ZQV9180QZ"
TOKEN = "dapi" + "ef" * 16
HOST = "adb-zqv180.example.net"
EMAIL = "rita.ng@example.com"


class Reply:
    def __init__(self, status, body):
        self.status_code, self._body = status, body
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.content = self.text.encode()

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not JSON")
        return self._body


class Session:
    def __init__(self, *replies):
        self.replies = list(replies)

    def request(self, *_args, **_kwargs):
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def workspace(*replies):
    return shell_db.Workspace(f"https://{HOST}", lambda: {"Authorization": f"Bearer {TOKEN}"}, Session(*replies), sleep=lambda _s: None)


def _clean(text):
    assert SENTINEL[:5] not in text and HOST not in text and TOKEN not in text and EMAIL not in text, text
    return text


def test_a_connection_failure_names_the_call_and_hides_the_host_the_token_and_a_value():
    failure = OSError(f"HTTPSConnectionPool(host='{HOST}', port=443): token {TOKEN} for {EMAIL} near '{SENTINEL}'")
    with pytest.raises(shell_db.QueryError) as caught:
        workspace(failure).call("GET", "/api/2.0/sql/warehouses?x=1")
    assert _clean(str(caught.value)).startswith("GET /api/2.0/sql/warehouses did not answer: ")


@pytest.mark.parametrize("body", [
    {"error_code": "BAD_REQUEST", "message": "x" * 392 + f" '{SENTINEL}' was refused for {EMAIL} at https://{HOST}/api"},
    "y" * 392 + f" '{SENTINEL}' at https://{HOST}",
], ids=["json_reply", "text_reply"])
def test_a_refused_call_is_redacted_before_it_is_cut_so_no_part_of_a_value_survives_the_cut(body):
    with pytest.raises(shell_db.QueryError) as caught:
        workspace(Reply(400, body)).call("POST", "/api/2.0/sql/statements")
    text = _clean(str(caught.value))
    assert text.startswith("POST /api/2.0/sql/statements answered HTTP 400: ") and SENTINEL[:3] not in text and "'a data" in text


def test_a_failed_statement_keeps_its_error_class_and_hides_the_value():
    message = f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"INT\". SQLSTATE: 22018"
    reply = Reply(200, {"statement_id": "s1", "status": {"state": "FAILED", "error": {"message": message}}})
    with pytest.raises(shell_db.QueryError) as caught:
        workspace(reply).run_sql("w1", "SELECT 1")
    assert _clean(str(caught.value)).startswith("[CAST_INVALID_INPUT] The value 'a data value'")


def test_a_failed_genie_answer_hides_the_value_it_quotes():
    reply = Reply(200, {"status": "FAILED", "error": {"error": f"Genie could not read '{SENTINEL}' for {EMAIL}"}})
    out = workspace(reply).genie_message("space", "conversation", "message")
    assert out["state"] == "failed" and _clean(out["error"]).startswith("Genie could not read 'a data value'")


def test_a_lakebase_connection_failure_hides_the_host_the_user_and_a_value():
    def refuse(**_kwargs):
        raise psycopg.OperationalError(f"connection to server at \"instance-1.database.example.com\" failed: FATAL: password "
                                       f"authentication failed for user \"app-sp\" near '{SENTINEL}'")

    lb, _made, _clock = lakebase(password_service("t1"), connect=refuse)
    with pytest.raises(shell_db.QueryError) as caught:
        lb.run(f"SELECT `category` FROM {TREND_VIEW}", [], 5)
    text = _clean(str(caught.value))
    assert "could not connect to Lakebase: " in text and "instance-1.database.example.com" not in text and "app-sp" not in text


def test_a_failed_job_run_message_hides_the_value_it_quotes_and_keeps_the_table():
    run = {"run_id": 7, "state": {"life_cycle_state": "TERMINATED", "result_state": "FAILED",
                                  "state_message": f"Cannot read '{SENTINEL}' for {EMAIL} from main.sales.orders"}}
    assert _clean(shell_core.job_run_view(run, "")["message"]) == "Cannot read 'a data value' for <email> from main.sales.orders"


def test_the_shell_keeps_the_words_it_wrote_and_hides_a_value_in_a_builtin_error():
    with pytest.raises(ValueError) as own:
        shell_sql._date("2026-13-45")
    assert shell_sql.error_text(own.value) == "'2026-13-45' is not a YYYY-MM-DD date"
    with pytest.raises(ValueError) as builtin:
        int(f"{SENTINEL} for {EMAIL}")
    assert _clean(shell_sql.error_text(builtin.value)) == "invalid literal for int() with base 10: 'a data value'"
    with pytest.raises(KeyError) as missing:
        {}[SENTINEL]
    assert shell_sql.error_text(missing.value) == "'a data value'"
    assert shell_sql.error_text(shell_db.QueryError(f"the App wrote '{SENTINEL}'")) == f"the App wrote '{SENTINEL}'"
    assert shell_sql.error_text(ValueError("")) == "ValueError"


TIMES = ["2026-11-01T18:00:00Z", "2026-11-01T18:00:00+0400", "2026-11-01T18:00:00-05:30", "2026-11-01 18:00:00.1234567Z",
         "2026-11-01T18:00:00.5z", "2026-11-01T18:00", "2026-11-01", "2026-02-30", "garbage", ""]
STAMPS = ["2026-11-01T18:00:00+00:00", "2026-11-01T14:00:00+00:00", "2026-11-01T23:30:00+00:00", "2026-11-01T18:00:00.123456+00:00",
          "2026-11-01T18:00:00.500000+00:00", "2026-11-01T18:00:00+00:00", "2026-11-01T00:00:00+00:00", None, None, None]


def test_the_shell_reads_a_trailing_z_an_offset_and_any_fraction_the_same_on_this_python():
    assert [None if s is None else s.isoformat() for s in map(shell_db.stamp_of, TIMES)] == STAMPS


@pytest.mark.skipif(not os.access(PYTHON_310, os.X_OK), reason=f"no Python 3.10 interpreter at {PYTHON_310}")
def test_the_shell_reads_a_trailing_z_an_offset_and_any_fraction_the_same_on_python_310():
    script = (f"import json, sys\nsys.path.insert(0, {SERVER!r})\nimport shell_db\n"
              f"print(json.dumps([None if s is None else s.isoformat() for s in map(shell_db.stamp_of, {TIMES!r})]))\n")
    done = subprocess.run([PYTHON_310, "-I", "-c", script], capture_output=True, text=True, timeout=120, check=False)
    assert done.returncode == 0, done.stderr[-2000:]
    assert json.loads(done.stdout) == STAMPS


def test_the_notebook_and_the_shell_parse_times_with_the_one_helper(agent_ns):
    import shell_redact
    assert agent_ns["inspire_parse_time"]("2026-11-01T18:00:00.5+0400") == shell_redact.inspire_parse_time("2026-11-01T18:00:00.5+0400") \
        == datetime.datetime(2026, 11, 1, 14, 0, 0, 500000, tzinfo=datetime.timezone.utc)
    with pytest.raises(ValueError) as caught:
        agent_ns["inspire_parse_time"](f"{SENTINEL}")
    assert SENTINEL not in str(caught.value)
