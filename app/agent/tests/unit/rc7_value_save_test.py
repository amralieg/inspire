"""The App counts a realized value in the value ledger in the same request as the act that saved it, with the App's identity."""
from v142_edits_test import edit_page
from v144_app_data_test import DECIDE, EDITOR, PERSON, TOKEN, DataWorkspace, act, app_dir, current, shell

import shell_core  # noqa: E402  (sys.path is set by the harness import above)
import shell_db  # noqa: E402

LEDGER = "`main`.`inspire`.`__inspire_value_ledger`"
STAKE_EUR = {"session_id": "42", "run_id": "9001", "kind": "money", "currency": "EUR", "unit": None}
STAKE_HOURS = {"session_id": "42", "run_id": "9001", "kind": "time", "currency": None, "unit": "hours"}


class LedgerWorkspace(DataWorkspace):
    def __init__(self, stake=None, keys=("k1",), fail_insert=None, **kw):
        super().__init__(**kw)
        self.stake, self.keys, self.fail_insert, self.inserts = stake, list(keys), fail_insert, []

    def answer(self, sql, params):
        if LEDGER in sql and sql.startswith("INSERT INTO"):
            if self.fail_insert:
                raise self.fail_insert
            self.inserts.append(sql)
            return {"columns": [], "rows": [{"num_inserted_rows": len(self.keys)}], "truncated": False}
        if LEDGER in sql and "ORDER BY recorded_at DESC LIMIT 1" in sql:
            return {"columns": [], "rows": [self.stake] if self.stake else [], "truncated": False}
        return super().answer(sql, params)


def _page(**changes):
    return edit_page(use_case_id="N01-U05", value_ledger=LEDGER, **changes)


def test_a_realized_value_for_many_records_is_one_insert_that_selects_the_batch_keys_in_sql(tmp_path):
    keys = [f"k{i}" for i in range(200)]
    ws = LedgerWorkspace(stake=STAKE_EUR, keys=keys)
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, keys=keys, values={"action_status": "Done", "realized_value": 300},
                      seen={k: "101" for k in keys})
    assert status == 200, out
    assert out["value_recorded"] == 200 and "value_warning" not in out
    assert len(ws.inserts) == 1, "one statement however many records the act saved"
    (sql,) = ws.inserts
    assert f"SELECT '42', 'main.pricing.loss_desk_out', 'N01-U05', '9001', `record_key`, 'money', 'EUR', NULL, NULL, 300.0, '{PERSON}', " in sql
    assert f"`action_batch` = '{ws.batch}'" in sql and "`change_source` = 'action'" in sql
    assert "k199" not in sql, "the keys stay in the warehouse, not in the statement"


def test_a_saved_hours_value_on_a_time_stake_carries_its_unit_and_no_currency(tmp_path):
    ws = LedgerWorkspace(stake=STAKE_HOURS, keys=("k1",))
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, values={"action_status": "Done", "realized_value": 2.5})
    assert status == 200 and out["value_recorded"] == 1
    (sql,) = ws.inserts
    assert "'time', NULL, 'hours', NULL, 2.5, " in sql


def test_clearing_a_saved_value_with_done_and_null_writes_a_NULL_saved_row(tmp_path):
    ws = LedgerWorkspace(stake=STAKE_EUR, keys=("k1",))
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, values={"action_status": "Done", "realized_value": None})
    assert status == 200 and out["value_recorded"] == 1
    (sql,) = ws.inserts
    assert f"NULL, NULL, '{PERSON}', current_timestamp()" in sql


def test_a_status_change_that_does_not_name_realized_value_writes_no_ledger_row(tmp_path):
    ws = LedgerWorkspace(stake=STAKE_EUR, keys=("k1",))
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, values={"action_status": "In progress"})
    assert status == 200 and "value_recorded" not in out and "value_warning" not in out
    assert ws.inserts == [] and ws.queries(LEDGER) == []


def test_a_use_case_with_no_measured_stake_says_the_value_is_not_counted_and_the_save_still_stands(tmp_path):
    ws = LedgerWorkspace(stake=None, keys=("k1",))
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, values={"action_status": "Done", "realized_value": 40})
    assert status == 200 and ws.inserts == []
    assert "no measured value at stake yet" in out["value_warning"]
    assert ws.queries("MERGE INTO"), "the record itself was still saved"


def test_a_refused_ledger_write_is_reported_and_the_act_still_saves_the_record(tmp_path):
    refused = shell_db.QueryError("PERMISSION_DENIED: User does not have MODIFY on __inspire_value_ledger")
    ws = LedgerWorkspace(stake=STAKE_EUR, keys=("k1",), fail_insert=refused)
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[_page()], ws=ws)
    status, out = act(s, values={"action_status": "Done", "realized_value": 40})
    assert status == 200 and out["written"] == ["k1"]
    assert "not counted in the value ledger" in out["value_warning"] and "PERMISSION_DENIED" in out["value_warning"]


def test_a_page_built_before_the_ledger_names_no_table_and_says_so_only_for_a_real_value(tmp_path):
    ws = LedgerWorkspace(stake=STAKE_EUR, keys=("k1",))
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[edit_page(use_case_id="N01-U05")], ws=ws)
    status, out = act(s, values={"action_status": "Done", "realized_value": 40})
    assert status == 200 and ws.inserts == []
    assert "names no ledger" in out["value_warning"]
    status, out = act(s, values={"action_status": "Done", "realized_value": None})
    assert status == 200 and "value_warning" not in out


def test_the_ledger_write_uses_the_app_identity_not_the_person(tmp_path):
    reader = LedgerWorkspace(current=[current("k1", "run", "run 7")], keys=("k1",))
    writer = LedgerWorkspace(stake=STAKE_EUR, keys=("k1",))
    s = shell_core.Shell(app_dir(tmp_path, settings=dict(DECIDE, auth="user"), pages=[_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: writer, user_factory=lambda host, token: reader)
    status, out = act(s, values={"action_status": "Done", "realized_value": 40}, headers=dict(EDITOR, **TOKEN))
    assert status == 200 and out.get("value_recorded") == 1, out
    assert len(writer.inserts) == 1, "the App's service principal writes the ledger row"
    assert reader.inserts == [], "the person's own sign-in never writes the ledger"
