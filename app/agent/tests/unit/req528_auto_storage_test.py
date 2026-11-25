"""REQ-528: the person no longer picks Lakebase or Delta. When Lakebase cannot be set up during the build, the App is built on Delta, the build
carries on, and the warning says so without sending the person to a storage choice that no longer exists."""
import pytest

from v140_implement_test import sdk_stub  # noqa: F401  (fixture)
from v146_lakebase_build_test import (APP_LABEL, LAKEBASE_FILES, LIVE, NEW_APP, SP_READS, _app_lakebase, _created, _lakebase,
                                      _lakebase_deploy, _lines)
from v140_implement_test import READS

OLD_CHOICE = "pick Lakebase again in the wizard"


def test_a_lakebase_step_that_fails_in_the_build_leaves_the_app_on_delta_and_never_offers_a_wizard_choice(agent_ns, tmp_path):
    inst, out, _seen, _reader, _pg = _app_lakebase(agent_ns, tmp_path, rounds=("FAILED",))
    assert out["kind"] == "delta" and out["files"] is out["delta_files"], "the build carries on with the Delta App"
    assert [e["status"] for e in inst.emitted] == ["started", "ended_warning"]
    (warning,) = out["warnings"]
    assert warning.startswith(f"{APP_LABEL}: it reads Delta tables, so its pages take a few seconds to load, because Inspire could not set up Lakebase: ")
    assert "the Lakebase sync ended failed" in warning
    assert OLD_CHOICE not in warning and "wizard" not in warning, "the storage is not a choice any more"


def test_an_app_the_workspace_will_not_give_a_database_deploys_on_delta_and_the_warning_has_no_wizard_choice(agent_ns, sdk_stub):  # noqa: F811
    inst, context, _calls, _imported = _lakebase_deploy(
        agent_ns, [NEW_APP, _created(agent_ns, postgres=False), RuntimeError("INVALID_PARAMETER_VALUE: postgres is not enabled")] + LIVE)
    fields = inst._implement_deploy_app(context, "churn-desk", LAKEBASE_FILES, READS, poll_s=0, lakebase=_lakebase())
    assert fields["_asset"] == {"backend": "delta", **SP_READS}
    (warning,) = fields["_warnings"]
    assert "could not give the App its Lakebase database as a resource" in warning
    assert OLD_CHOICE not in warning
    assert all(OLD_CHOICE not in line for line in _lines(inst, "WARNING"))

