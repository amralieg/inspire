import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from v192_job_asset_tags_test import VERSION_KEY, _Api, _tagger  # noqa: E402
from v192_job_asset_tags_test import ns  # noqa: E402,F401
from v140_implement_test import VALID  # noqa: E402


def _identity_updates(api):
    return [body for body in api.updates() if body.get("job_id") == 77 and "tags" in (body.get("new_settings") or {})]


def test_a_build_that_fails_at_once_still_tags_its_job_with_the_session_and_use_case(ns):
    api = _Api({"team": "growth", "dbx_inspire_ai_assets": "app"})
    inst = _tagger(ns, api)
    inst.business_name = "Acme"
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "job_id": 77, "spec_json": {}}
    with pytest.raises(ns["ImplementBlocked"]):
        inst._implement_one_locked(target, (5150, "N01-U01", 3))
    [update] = _identity_updates(api)
    tags = update["new_settings"]["tags"]
    assert tags["team"] == "growth" and tags["dbx_inspire_ai_assets"] == "app"
    assert tags["dbx_inspire_ai_session_id"] == "5150" and tags["dbx_inspire_ai_session"] == "5150"
    assert tags["dbx_inspire_ai_usecase_id"] == "N01-U01" and tags["dbx_inspire_ai_business"] == "Acme"
    assert tags["dbx_inspire_ai_run_type"] == "implement" and tags["dbx_inspire_ai_spec_version"] == "3"
    assert tags[VERSION_KEY] == ns["__AGENT_VERSION__"]


def test_a_build_with_no_job_yet_makes_no_tag_call_at_start(ns):
    api = _Api({})
    inst = _tagger(ns, api)
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": {}}
    with pytest.raises(ns["ImplementBlocked"]):
        inst._implement_one_locked(target, (5150, "N01-U01", 3))
    assert not any(path == "/api/2.2/jobs/get" for _m, path, _b, _q in api.calls)


def test_an_identity_tag_failure_is_a_warning_and_never_fails_the_build(ns):
    api = _Api({}, fail={("GET", "/api/2.2/jobs/get"): RuntimeError("jobs/get is down")})
    inst = _tagger(ns, api)
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "job_id": 77, "spec_json": {}}
    with pytest.raises(ns["ImplementBlocked"]):
        inst._implement_one_locked(target, (5150, "N01-U01", 3))
    warnings = [msg for level, msg in inst.logger.records if level == "WARNING"]
    assert any("[IMPLEMENT-IDENTITY-TAGS]" in msg and "job 77" in msg for msg in warnings)
