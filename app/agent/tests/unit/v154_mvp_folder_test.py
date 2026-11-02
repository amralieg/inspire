import base64
import json
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire
from v140_implement_test import TASK_RUN, VALID, _cell, sdk_stub  # noqa: F401

UC = {"No": "N01-U01", "Name": "Predict churn of members", "Business Domain": "Customer Care & Retention"}
APP = "/Workspace/Shared/inspire-ai"
USE_CASE_DIR = f"{APP}/acme/session_5150/customer_care_retention/N01-U01 - predict_churn_of_members"
FILE = "N01-U01 - predict_churn_of_members"
BUILDER = "11111111-2222-3333-4444-555555555555"


def _inspire(agent_ns):
    inst = make_inspire(agent_ns, spark=FakeSpark(), session_id=5150, inspire_database="main.inspire")
    inst.logger = CapturingLogger()
    inst._implement_builder_name = BUILDER
    inst.updates = []
    inst._implement_update = lambda key, **f: inst.updates.append(json.loads(json.dumps(f)))
    return inst


class _Workspace:
    def __init__(self, files=None, object_id=42):
        self.files, self.object_id = dict(files or {}), object_id
        self.calls = []

    def get_status(self, path):
        self.calls.append(("status", path))
        if path not in self.files and not path.startswith(APP):
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path}")
        return types.SimpleNamespace(modified_at=1000, object_id=self.object_id)

    def export(self, path, format=None):
        self.calls.append(("export", path))
        if path not in self.files:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path}")
        return types.SimpleNamespace(content=base64.b64encode(json.dumps(self.files[path]).encode()).decode())

    def import_(self, path, overwrite, format, content):
        self.calls.append(("import", path))
        self.files[path] = json.loads(base64.b64decode(content))

    def mkdirs(self, path):
        self.calls.append(("mkdirs", path))


def test_every_mvp_version_lives_under_business_session_domain_use_case_mvp_and_its_version(agent_ns):
    dirs = agent_ns["implement_mvp_dirs"]("/W/app", "acme", "5150", "sales", "N01-U01 - churn", 3)
    assert dirs == {"use_case": "/W/app/acme/session_5150/sales/N01-U01 - churn", "mvp": "/W/app/acme/session_5150/sales/N01-U01 - churn/mvp",
                    "version": "/W/app/acme/session_5150/sales/N01-U01 - churn/mvp/v3"}
    inst = _inspire(agent_ns)
    assert inst._implement_notebook_paths(UC, (5150, "N01-U01", 3)) == (f"{USE_CASE_DIR}/mvp/v3", f"{USE_CASE_DIR}/mvp/v3/{FILE}")
    assert inst._implement_notebook_paths(UC, (5150, "N01-U01", 4))[1] == f"{USE_CASE_DIR}/mvp/v4/{FILE}", \
        "each spec version gets its own folder, so v3 stays as it was"


def test_a_use_case_with_no_domain_goes_under_other(agent_ns):
    inst = _inspire(agent_ns)
    folder = inst._implement_mvp_dirs({"No": "N02-U01", "Name": "Spot fraud"}, (5150, "N02-U01", 1))["use_case"]
    assert folder.startswith(f"{APP}/acme/session_5150/other/N02-U01")


def test_the_mvps_live_in_the_folder_of_the_inspire_app_s_own_agent_notebook(agent_ns, monkeypatch):
    inst = _inspire(agent_ns)
    inst._implement_root_dir = ""
    monkeypatch.setattr(agent_ns["JobLauncher"], "get_current_notebook_path",
                        staticmethod(lambda: "/Shared/inspire-ai-implement/dbx_inspire_ai_agent"))
    assert inst._implement_root() == agent_ns["canonical_workspace_path"]("/Shared/inspire-ai-implement")
    assert inst._implement_mvp_dirs(UC, (5150, "N01-U01", 1))["use_case"].startswith(inst._implement_root() + "/acme/session_5150/")


def test_without_its_own_notebook_path_inspire_says_it_does_not_know_the_mvp_folder(agent_ns, monkeypatch):
    inst = _inspire(agent_ns)
    inst._implement_root_dir = ""
    monkeypatch.setattr(agent_ns["JobLauncher"], "get_current_notebook_path", staticmethod(lambda: ""))
    with pytest.raises(RuntimeError, match="does not know the folder of the Inspire App that holds every MVP"):
        inst._implement_root()


def test_the_job_keeps_one_name_across_versions_and_each_use_case_has_its_own(agent_ns):
    inst = _inspire(agent_ns)
    name = inst._implement_job_name({"job_slug": "predict_churn"}, UC, (5150, "N01-U01", 3))
    assert name == inst._implement_job_name({"job_slug": "predict_churn"}, UC, (5150, "N01-U01", 4))
    other = dict(UC, No="N01-U02", Name="Predict churn of guests")
    assert name != inst._implement_job_name({"job_slug": "predict_churn"}, other, (5150, "N01-U02", 3))
    assert name != inst._implement_job_name({"job_slug": "predict_churn"}, UC, (6160, "N01-U01", 3)), "another session, another job"


def test_the_edit_check_reads_the_notebook_the_job_runs_today_not_the_new_version(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: TASK_RUN)
    inst = _inspire(agent_ns)
    checked = []
    inst._implement_notebook_edit_state = lambda path, recorded: checked.append(path) or (1000, False)
    status = {"notebook": {"modified_at": 1000, "spec_version": 2}}
    path = inst._implement_claim_notebook(UC, {}, (5150, "N01-U01", 3), status, current=f"{USE_CASE_DIR}/mvp/v2/{FILE}")
    assert path == f"{USE_CASE_DIR}/mvp/v3/{FILE}" and checked == [f"{USE_CASE_DIR}/mvp/v2/{FILE}"]
    assert status["notebook"]["rewriting"] == {"spec_version": 3, "run_id": TASK_RUN}
    checked.clear()
    inst._implement_claim_notebook(UC, {}, (5150, "N01-U01", 1), {"notebook": {}})
    assert checked == [f"{USE_CASE_DIR}/mvp/v1/{FILE}"], "a first build checks the path it is about to write"


def test_an_edited_notebook_blocks_the_build_and_names_the_notebook_the_person_edited(agent_ns):
    inst = _inspire(agent_ns)
    inst._implement_notebook_edit_state = lambda path, recorded: (5000, True)
    old = f"{USE_CASE_DIR}/mvp/v2/{FILE}"
    with pytest.raises(agent_ns["ImplementBlocked"], match=f"the notebook {old} was edited after Inspire last built it"):
        inst._implement_claim_notebook(UC, {}, (5150, "N01-U01", 3), {"notebook": {"modified_at": 1000}}, current=old)
    assert inst.updates[-1]["asset_status"]["notebook"]["state"] == "edited"


def _writer(agent_ns, workspace):
    inst = _inspire(agent_ns)
    inst.w_client = types.SimpleNamespace(workspace=workspace, config=types.SimpleNamespace(host="https://h"))
    inst._genie_notebook_cells = lambda uc, instruction: ([_cell(None, "# header"), _cell("Genie Code instruction", instruction),
                                                          _cell("Run controls (Inspire, do not edit)", "main()")], {})
    inst._genie_notebook_object = lambda cells, name: {"cells": cells}
    inst._implement_dismissals = lambda uc_id, table: None
    return inst


OLD = f"{USE_CASE_DIR}/mvp/v2/{FILE}"
NEW = f"{USE_CASE_DIR}/mvp/v3/{FILE}"
OLD_NOTEBOOK = {"cells": [_cell(None, "# header"), _cell("Genie Code instruction", "old"), _cell("Run controls (Inspire, do not edit)", "old"),
                          _cell("Feature prep", "df = spark.table('main.s.orders')")]}


def test_a_new_version_starts_from_the_notebook_the_job_runs_today_and_is_written_in_its_own_folder(agent_ns, sdk_stub):
    workspace = _Workspace({OLD: OLD_NOTEBOOK})
    inst = _writer(agent_ns, workspace)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    assert inst._implement_write_notebook(dict(UC, genie_instruction="Build"), spec, spec, (5150, "N01-U01", 3), current=OLD) == NEW
    assert ("export", OLD) in workspace.calls and ("mkdirs", f"{USE_CASE_DIR}/mvp/v3") in workspace.calls
    assert [c for c in workspace.calls if c[0] == "import"] == [("import", NEW)]
    assert workspace.files[OLD] == OLD_NOTEBOOK, "the version the job runs today is never touched"
    titles = [agent_ns["implement_cell_title"](c) for c in workspace.files[NEW]["cells"]]
    assert "Feature prep" in titles, "Genie's own cells from the last version carry into the new one"


def test_a_first_build_never_reads_another_notebook(agent_ns, sdk_stub):
    workspace = _Workspace({OLD: OLD_NOTEBOOK})
    inst = _writer(agent_ns, workspace)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    inst._implement_write_notebook(dict(UC, genie_instruction="Build"), spec, None, (5150, "N01-U01", 3), current=OLD)
    assert not [c for c in workspace.calls if c[0] == "export"]
    titles = [agent_ns["implement_cell_title"](c) for c in workspace.files[NEW]["cells"]]
    assert "Feature prep" not in titles


def test_an_unreadable_old_version_is_written_from_the_instruction_with_a_warning(agent_ns, sdk_stub):
    workspace = _Workspace({})
    inst = _writer(agent_ns, workspace)
    inst._implement_notebook_modified_at = lambda path: 1000
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    inst._implement_write_notebook(dict(UC, genie_instruction="Build"), spec, spec, (5150, "N01-U01", 3), current=OLD)
    assert NEW in workspace.files and any("could not be read back" in line for _level, line in inst.logger.records)


def _undo_inspire(agent_ns, job_error=None):
    inst = _inspire(agent_ns)
    calls = []

    def repoint(name, path):
        calls.append(("job", name, path))
        if job_error:
            raise job_error

    inst._implement_job_notebook = repoint
    inst._implement_delete_path = lambda path, label: calls.append(("delete", path)) or ""
    inst._implement_notebook_modified_at = lambda path: 7000
    return inst, calls


def test_a_version_that_did_not_build_hands_the_job_back_to_the_last_version_and_deletes_its_own_notebook(agent_ns):
    inst, calls = _undo_inspire(agent_ns)
    inflight = {"notebook_path": NEW, "notebook_current": OLD, "job_name": "dbx_inspire_ai_predict_churn_1",
                "notebook_before": (None, {"modified_at": 1000, "spec_version": 2, "rewriting": {"spec_version": 3}}),
                "asset_status": {"notebook": {"spec_version": 2}}}
    inst._implement_notebook_undo("N01-U01", inflight)
    assert calls == [("job", "dbx_inspire_ai_predict_churn_1", OLD), ("delete", NEW)]
    assert inflight["notebook_path"] == OLD and inflight["notebook_reset"] == OLD
    fields = inst._implement_stopped_fields((5150, "N01-U01", 3), inflight)
    assert fields["notebook_path"] == OLD
    assert fields["asset_status"]["notebook"] == {"modified_at": 7000, "spec_version": 2}


def test_if_the_job_cannot_be_handed_back_the_new_notebook_it_runs_is_kept(agent_ns):
    inst, calls = _undo_inspire(agent_ns, job_error=RuntimeError("Jobs API refused the update"))
    inflight = {"notebook_path": NEW, "notebook_current": OLD, "job_name": "j", "notebook_before": (None, {})}
    inst._implement_notebook_undo("N01-U01", inflight)
    assert calls == [("job", "j", OLD)] and inflight["notebook_path"] == NEW and "notebook_reset" not in inflight
    assert any(level == "ERROR" and "could not point the job back" in line for level, line in inst.logger.records)


@pytest.mark.parametrize("requester, who", [
    ("someone@example.com", {"type": "user", "name": "someone@example.com"}),
    ("  someone@example.com ", {"type": "user", "name": "someone@example.com"}),
    ("22222222-3333-4444-5555-666666666666", {"type": "service_principal", "name": "22222222-3333-4444-5555-666666666666"}),
    (BUILDER, {}),
    (BUILDER.upper(), {}),
    ("Finance Team", {}),
    ("", {}),
    (None, {}),
])
def test_only_a_named_person_or_service_principal_who_is_not_the_builder_is_given_the_folder(agent_ns, requester, who):
    assert agent_ns["implement_requester_principal"](requester, BUILDER) == who


def _access_inspire(agent_ns, workspace, grant_error=None):
    inst = _inspire(agent_ns)
    inst.w_client = types.SimpleNamespace(workspace=workspace, config=types.SimpleNamespace(host="https://h"))
    grants = []

    def grant(kind, object_id, principals, level):
        grants.append((kind, object_id, principals, level))
        if grant_error:
            raise grant_error

    inst._implement_grant = grant
    return inst, grants


def test_the_person_who_asked_for_the_mvp_can_manage_its_use_case_folder(agent_ns):
    workspace = _Workspace()
    inst, grants = _access_inspire(agent_ns, workspace)
    assert inst._implement_folder_access(UC, (5150, "N01-U01", 3), "someone@example.com") == []
    assert ("mkdirs", USE_CASE_DIR) in workspace.calls
    assert grants == [("directories", 42, [{"type": "user", "name": "someone@example.com"}], "CAN_MANAGE")]


@pytest.mark.parametrize("requester", ["", BUILDER, "Finance Team"])
def test_the_folder_is_made_but_nobody_else_is_given_it_when_there_is_no_one_to_give_it_to(agent_ns, requester):
    workspace = _Workspace()
    inst, grants = _access_inspire(agent_ns, workspace)
    assert inst._implement_folder_access(UC, (5150, "N01-U01", 3), requester) == []
    assert ("mkdirs", USE_CASE_DIR) in workspace.calls and grants == []


def test_a_grant_that_fails_is_a_warning_naming_the_person_and_the_folder(agent_ns):
    inst, _grants = _access_inspire(agent_ns, _Workspace(), grant_error=RuntimeError("PERMISSION_DENIED: not an admin"))
    [warning] = inst._implement_folder_access(UC, (5150, "N01-U01", 3), "someone@example.com")
    assert warning.startswith(f"Folder: someone@example.com may not open this MVP in {USE_CASE_DIR}, because Inspire could not give")
    inst, grants = _access_inspire(agent_ns, _Workspace(object_id=None))
    [warning] = inst._implement_folder_access(UC, (5150, "N01-U01", 3), "someone@example.com")
    assert "did not return an id" in warning and grants == []


def test_the_folders_cleaned_are_the_mvp_folder_and_every_version_in_it(agent_ns):
    inst = _inspire(agent_ns)
    inst._implement_folder_objects = lambda path: [{"path": f"{path}/v3", "object_type": "DIRECTORY"},
                                                   {"path": f"{path}/v1", "object_type": "DIRECTORY"},
                                                   {"path": f"{path}/readme", "object_type": "FILE"}]
    mvp = f"{USE_CASE_DIR}/mvp"
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 3)) == [mvp, f"{mvp}/v1", f"{mvp}/v3"]

    def unlisted(path):
        raise RuntimeError("PERMISSION_DENIED: list")

    inst._implement_folder_objects = unlisted
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 3)) == [mvp]
    assert any("could not be listed" in line for _level, line in inst.logger.records)


def test_an_mvp_built_before_the_mvp_folders_has_its_notebook_folder_cleaned_too_and_a_listed_version_is_not_named_twice(agent_ns):
    inst = _inspire(agent_ns)
    mvp = f"{USE_CASE_DIR}/mvp"
    inst._implement_folder_objects = lambda path: [{"path": f"{mvp}/v1", "object_type": "DIRECTORY"}]
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 2), "/Workspace/out/acme_implemented/Sales/N01-U01 - churn") == \
        [mvp, f"{mvp}/v1", "/Workspace/out/acme_implemented/Sales"]
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 2), f"{mvp}/v1/{FILE}") == [mvp, f"{mvp}/v1"]
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 2), "") == [mvp, f"{mvp}/v1"]
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 2), None) == [mvp, f"{mvp}/v1"]

    def unlisted(path):
        raise RuntimeError("PERMISSION_DENIED: list")

    inst._implement_folder_objects = unlisted
    assert inst._implement_output_dirs(UC, (5150, "N01-U01", 2), f"{mvp}/v2/{FILE}") == [mvp, f"{mvp}/v2"], \
        "a version the listing could not show is still cleaned through its notebook"


@pytest.mark.parametrize("first, second, overlap", [
    ("/Workspace/Shared/inspire-ai/acme", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Workspace/Shared/inspire-ai/acme/", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Workspace/Shared/inspire-ai", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Workspace/Shared/inspire-ai/acme/session_1/acme", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Shared/inspire-ai/acme", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Workspace/Shared/inspire-ai/../inspire-ai/acme", "/Workspace/Shared/inspire-ai/acme", True),
    ("/Workspace/Shared/inspire-ai/acme2", "/Workspace/Shared/inspire-ai/acme", False),
    ("/Workspace/Shared/inspire-ai/other", "/Workspace/Shared/inspire-ai/acme", False),
    ("/Workspace/Shared/demos/acme", "/Workspace/Shared/inspire-ai/acme", False),
    ("", "/Workspace/Shared/inspire-ai/acme", False),
    ("/Workspace/Shared/inspire-ai/acme", None, False),
])
def test_two_folders_overlap_only_when_one_is_the_other_or_holds_it(agent_ns, first, second, overlap):
    assert agent_ns["implement_paths_overlap"](first, second) is overlap
    assert agent_ns["implement_paths_overlap"](second, first) is overlap


def _discover(agent_ns, generation_root, root=APP):
    inst = _inspire(agent_ns)
    inst._implement_root_dir = root
    inst.base_output_dir = inst.session_output_dir = f"{generation_root}/acme"
    inst.notebook_output_dir, inst.docs_output_dir = f"{inst.base_output_dir}/notebooks", f"{inst.base_output_dir}/docs"
    deleted = []
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(delete=lambda path, recursive=False: deleted.append((path, recursive))))
    inst._discover_clean_output()
    warned = [line for level, line in inst.logger.records if level == "WARNING" and "[DISCOVER-CLEAN]" in line]
    return deleted, warned


def test_discover_wipes_its_own_folder_when_it_is_apart_from_the_mvps(agent_ns):
    for generation_root in ("/Workspace/Shared/demos", f"{APP}/output", "/Workspace/Users/me@example.com/inspire"):
        deleted, warned = _discover(agent_ns, generation_root)
        assert deleted == [(f"{generation_root}/acme", True)], generation_root
        assert warned == [], generation_root


def test_discover_in_the_folder_of_the_mvps_deletes_only_its_own_outputs_and_keeps_every_mvp(agent_ns):
    deleted, warned = _discover(agent_ns, APP)
    assert deleted == [(f"{APP}/acme/notebooks", True), (f"{APP}/acme/docs", True), (f"{APP}/acme/log.txt", True)]
    assert (f"{APP}/acme", True) not in deleted, "the folder that holds every MVP of the business is never wiped"
    assert len(warned) == 1 and f"{APP}/acme" in warned[0] and "keeps every MVP" in warned[0]
    deleted, warned = _discover(agent_ns, f"{APP}/acme/session_5150")
    assert all(path.startswith(f"{APP}/acme/session_5150/acme/") for path, _ in deleted) and len(warned) == 1, \
        "a Discover folder inside an MVP tree deletes only its own outputs"
    deleted, warned = _discover(agent_ns, "/Workspace/Shared", root="/Workspace/Shared/acme")
    assert (f"/Workspace/Shared/acme", True) not in deleted and len(warned) == 1, "nor a Discover folder that holds the App folder"


def test_discover_without_the_folder_of_the_inspire_app_wipes_as_before_and_says_why_in_debug(agent_ns, monkeypatch):
    monkeypatch.setattr(agent_ns["JobLauncher"], "get_current_notebook_path", staticmethod(lambda: ""))
    inst = _inspire(agent_ns)
    inst._implement_root_dir = ""
    inst.base_output_dir = inst.session_output_dir = f"{APP}/acme"
    inst.notebook_output_dir, inst.docs_output_dir = f"{APP}/acme/notebooks", f"{APP}/acme/docs"
    deleted = []
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(delete=lambda path, recursive=False: deleted.append(path)))
    inst._discover_clean_output()
    assert deleted == [f"{APP}/acme"]
    assert any(level == "DEBUG" and "folder of the Inspire App is unknown" in line for level, line in inst.logger.records)


def test_a_discover_delete_that_fails_is_logged_and_the_run_goes_on(agent_ns):
    inst = _inspire(agent_ns)
    inst._implement_root_dir = APP
    inst.base_output_dir = inst.session_output_dir = "/Workspace/Shared/demos/acme"

    def refuse(path, recursive=False):
        raise RuntimeError("RESOURCE_DOES_NOT_EXIST: nothing there")

    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(delete=refuse))
    inst._discover_clean_output()
    assert any(level == "DEBUG" and "No existing session directory" in line for level, line in inst.logger.records)


DISCOVERY = "/Workspace/Users/someone@example.com/inspire_out/acme/notebooks"
NOTEBOOKS = f"{APP}/acme/session_7/notebooks"


class _HomeHidden(_Workspace):
    def __init__(self, hidden=DISCOVERY):
        super().__init__()
        self.hidden, self.texts = hidden, {}

    def get_status(self, path):
        self.calls.append(("status", path))
        if path not in self.texts and not path.startswith(APP):
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {path}")
        return types.SimpleNamespace(modified_at=1000, object_id=self.object_id, path=path)

    def mkdirs(self, path):
        self.calls.append(("mkdirs", path))
        if self.hidden and path.startswith(self.hidden):
            raise RuntimeError(f"The parent folder ({path}) does not exist.")

    def import_(self, path, overwrite, format, content):
        self.calls.append(("import", path))
        if self.hidden and path.startswith(self.hidden):
            raise RuntimeError(f"The parent folder ({path.rsplit('/', 1)[0]}) does not exist.")
        self.texts[path] = base64.b64decode(content).decode("utf-8")


def _regenerating(agent_ns, workspace):
    from v120_genie_support import FakeLoader, build_inspire

    def generate(uc, full_schema_details, document_context, schema_index=None):
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate)
    inst.notebook_output_dir, inst._implement_root_dir = DISCOVERY, APP
    inst.w_client = types.SimpleNamespace(workspace=workspace, config=types.SimpleNamespace(host="https://h"))
    inst._genie_notebook_cells = lambda uc, instruction: ([_cell("Genie Code instruction", instruction)], {})
    inst._genie_notebook_object = lambda cells, name: {"cells": cells, "metadata": {}}
    inst._implement_emit = lambda *a, **k: 1
    inst.merged = []
    inst._merge_regenerated_ucs_into_tracking = lambda ucs: inst.merged.extend(ucs) or len(ucs)
    return inst


def test_the_instruction_notebook_a_build_writes_lives_in_the_session_notebooks_folder_of_the_inspire_app(agent_ns, sdk_stub):
    from v120_genie_support import tracking_row
    workspace = _HomeHidden()
    inst = _regenerating(agent_ns, workspace)
    fresh = inst._implement_write_instruction(tracking_row("N01-U01", session_id=7), "N01-U01")
    assert inst._implement_notebooks_dir(7) == NOTEBOOKS
    assert fresh["notebook_path"].startswith(f"{NOTEBOOKS}/sales/retention/") and fresh["notebook_path"].endswith(".ipynb")
    assert ("mkdirs", f"{NOTEBOOKS}/sales/retention") in workspace.calls
    assert [uc["notebook_path"] for uc in inst.merged] == [fresh["notebook_path"]], "the Results page links to the notebook the build wrote"
    assert f"{NOTEBOOKS}/AGENTS.md" in workspace.texts, "Genie Code reads AGENTS.md beside the notebooks it opens"
    assert not [path for _kind, path in workspace.calls if path.startswith(DISCOVERY)], \
        "the builder cannot see the folder of the person who ran Discover, so it never writes there"


def test_a_discover_route_regeneration_still_writes_into_the_discovery_notebooks_folder(agent_ns, sdk_stub):
    from v120_genie_support import tracking_row
    workspace = _HomeHidden(hidden="")
    inst = _regenerating(agent_ns, workspace)
    [regenerated] = inst._regenerate_genie_for_flagged_rows([tracking_row("N01-U01", session_id=7)], "Route 1 (DB flag)")
    assert regenerated["notebook_path"].startswith(f"{DISCOVERY}/sales/retention/")
    assert f"{DISCOVERY}/AGENTS.md" in workspace.texts and f"{NOTEBOOKS}/AGENTS.md" not in workspace.texts
    assert not [path for _kind, path in workspace.calls if path.startswith(f"{APP}/")]


def test_agents_md_is_written_once_for_each_notebooks_folder(agent_ns, sdk_stub):
    workspace = _HomeHidden(hidden="")
    inst = _regenerating(agent_ns, workspace)
    assert inst._write_genie_agents_file(NOTEBOOKS) == f"{NOTEBOOKS}/AGENTS.md"
    assert inst._write_genie_agents_file(NOTEBOOKS) == f"{NOTEBOOKS}/AGENTS.md"
    assert inst._write_genie_agents_file() == f"{DISCOVERY}/AGENTS.md"
    assert [path for kind, path in workspace.calls if kind == "import"] == [f"{NOTEBOOKS}/AGENTS.md", f"{DISCOVERY}/AGENTS.md"]


def test_the_waves_write_agents_md_beside_each_folder_that_got_a_notebook(agent_ns):
    import threading
    from v120_genie_support import FakeLoader, build_inspire, make_uc, schema_details
    roots = []
    last_done = threading.Event()

    def generate(uc, full_schema_details, document_context, schema_index=None):
        if uc.get("_notebook_root"):
            last_done.wait(5)
        else:
            last_done.set()
        uc["genie_instruction_status"] = "success"
        uc["genie_instruction"] = "instruction " + "x" * 200
        return uc

    inst = build_inspire(agent_ns, loader=FakeLoader(), _generate_genie_instruction_for_use_case=generate,
                         _assemble_genie_code_notebook=lambda uc, t: "/nb/g.ipynb",
                         _write_genie_agents_file=lambda root="": roots.append(root) or "")
    ucs = [make_uc("N01-U01", _notebook_root=NOTEBOOKS), make_uc("N01-U02", _notebook_root=NOTEBOOKS), make_uc("N01-U03")]
    inst._run_genie_waves(ucs, schema_details(), "", {}, {})
    assert roots == [NOTEBOOKS, ""]


def test_the_person_who_asked_can_also_manage_the_instruction_notebook_folder_the_build_wrote(agent_ns):
    workspace = _Workspace()
    inst, grants = _access_inspire(agent_ns, workspace)
    notebook = f"{APP}/acme/session_5150/notebooks/customer_care_retention/general/{FILE}.ipynb"
    assert inst._implement_folder_access(dict(UC, notebook_path=notebook), (5150, "N01-U01", 3), "someone@example.com") == []
    who = [{"type": "user", "name": "someone@example.com"}]
    assert grants == [("directories", 42, who, "CAN_MANAGE")] * 2
    assert ("status", f"{APP}/acme/session_5150/notebooks/customer_care_retention/general") in workspace.calls


@pytest.mark.parametrize("notebook", [f"{DISCOVERY}/customer_care_retention/general/{FILE}.ipynb",
                                      f"{APP}/acme/session_6160/notebooks/customer_care_retention/general/{FILE}.ipynb", ""])
def test_a_notebook_outside_this_session_s_notebooks_folder_is_never_given_to_anyone(agent_ns, notebook):
    workspace = _Workspace()
    inst, grants = _access_inspire(agent_ns, workspace)
    assert inst._implement_folder_access(dict(UC, notebook_path=notebook), (5150, "N01-U01", 3), "someone@example.com") == []
    assert len(grants) == 1 and [path for kind, path in workspace.calls if kind == "status"] == [USE_CASE_DIR]


def test_a_failed_grant_on_the_instruction_notebook_folder_is_its_own_warning(agent_ns):
    inst, _grants = _access_inspire(agent_ns, _Workspace(), grant_error=RuntimeError("PERMISSION_DENIED: not an admin"))
    notebook = f"{APP}/acme/session_5150/notebooks/customer_care_retention/general/{FILE}.ipynb"
    first, second = inst._implement_folder_access(dict(UC, notebook_path=notebook), (5150, "N01-U01", 3), "someone@example.com")
    assert first.startswith(f"Folder: someone@example.com may not open this MVP in {USE_CASE_DIR}, because")
    assert second.startswith(f"Folder: someone@example.com may not open the Genie Code instruction notebook {notebook}, because")


def test_uninstall_all_leaves_the_session_notebooks_folder_alone(agent_ns):
    inst = _inspire(agent_ns)
    folder = inst._implement_mvp_dirs(UC, (5150, "N01-U01", 3))["use_case"]
    assert not agent_ns["implement_paths_overlap"](folder, inst._implement_notebooks_dir(5150))
