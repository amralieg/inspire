from v113_joblauncher_tagged_child_test import _Jobs, fake_sdk, ns


def _launch(ns):
    return ns["JobLauncher"]("/Workspace/agent", {"00_business_name": "acme"}, {}).launch(
        job_name="dbx_inspire_ai_acme", run_name="dbx_inspire_ai_acme")


def test_a_created_inspire_job_has_a_run_timeout_so_a_hung_scheduled_run_ends(ns, fake_sdk):
    fake_sdk["jobs"] = _Jobs()
    _launch(ns)
    create = next(c for c in fake_sdk["jobs"].calls if c[0] == "create")[1]
    assert 0 < create["timeout_seconds"] <= 24 * 3600
    assert create["tasks"][0].timeout_seconds == create["timeout_seconds"]


def test_an_updated_inspire_job_keeps_a_run_timeout(ns, fake_sdk):
    fake_sdk["jobs"] = _Jobs(existing=12)
    _launch(ns)
    update = next(c for c in fake_sdk["jobs"].calls if c[0] == "update")[1]
    assert 0 < update["settings"]["timeout_seconds"] <= 24 * 3600
