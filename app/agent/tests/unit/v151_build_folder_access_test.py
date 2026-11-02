"""A build that cannot open the Inspire App's folder says which folder, which identity and who gives the access, not an object id."""
import json
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire

ROOT = "/Workspace/Users/someone@example.com/inspire_out"
APP_FOLDER = "/Workspace/Shared/inspire-ai"
SP_ID = "11111111-2222-3333-4444-555555555555"
DENIED = f"{SP_ID} does not have View permissions on 1234567890123456. Please contact the owner or an administrator for access"


class PermissionDenied(Exception):
    error_code = "PERMISSION_DENIED"


def _inspire(agent_ns, raised, display_name="app-abc123 inspire-app"):
    inst = make_inspire(agent_ns, spark=FakeSpark(), session_id=5150, inspire_database="main.inspire",
                        base_output_dir=f"{ROOT}/acme")
    me = types.SimpleNamespace(display_name=display_name, user_name=SP_ID)
    inst.w_client = types.SimpleNamespace(workspace=inst.w_client.workspace, config=inst.w_client.config,
                                          current_user=types.SimpleNamespace(me=lambda: me))
    inst._implement_builder_name = SP_ID
    inst._implement_params = {}
    inst.emitted = []
    inst._emit_pipeline_status = lambda **kw: inst.emitted.append(kw) or len(inst.emitted)
    inst.atomic_writer = types.SimpleNamespace(acquire_lock=lambda k, **kw: True, release_lock=lambda k: None)
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    inst._implement_notebook_modified_at = lambda path: None

    def locked(target, key, inflight):
        raise raised

    inst._implement_one_locked = locked
    return inst


def test_a_build_the_folder_refuses_names_the_folder_the_identity_and_the_share_to_make(agent_ns):
    inst = _inspire(agent_ns, PermissionDenied(DENIED))
    assert inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2}) == "failed"
    message = inst.updates[-1]["status_message"]
    assert message == (f"Genie builds as app-abc123 inspire-app, which cannot open {APP_FOLDER}, the folder of the Inspire App that holds "
                       "every MVP: ask a workspace admin to give app-abc123 inspire-app Can manage on that folder, or run the Inspire "
                       "workspace installer again, which gives it that access, then build again")
    assert "1234567890123456" not in message and SP_ID not in message
    step = [e for e in inst.emitted if e.get("status") == "ended_error"]
    assert step and message in json.dumps(step), "the Build page step says the same plain sentence"


def test_without_a_display_name_the_message_names_the_identity_inspire_builds_as(agent_ns):
    inst = _inspire(agent_ns, PermissionDenied(DENIED), display_name="")
    inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2})
    assert inst.updates[-1]["status_message"].startswith(f"Genie builds as {SP_ID}, which cannot open {APP_FOLDER}, ")


@pytest.mark.parametrize("text", [
    "User does not have USE CATALOG privilege on catalog `main`",
    "PERMISSION_DENIED: the model serving endpoint refused the call",
    "the preview run did not write usable rows: boom",
])
def test_other_failures_keep_their_own_words(agent_ns, text):
    inst = _inspire(agent_ns, PermissionDenied(text))
    inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2})
    assert inst.updates[-1]["status_message"] == text


def test_the_same_words_from_a_plain_runtime_error_are_also_translated(agent_ns):
    inst = _inspire(agent_ns, RuntimeError(DENIED))
    inst._implement_one({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2})
    assert inst.updates[-1]["status_message"].startswith("Genie builds as app-abc123 inspire-app, which cannot open ")
