import logging
import os
import types

from v120_artifacts_support import FakeWorkspaceApi, make_inspire

APP_NOTEBOOK = "/Shared/inspire-ai-v130/dbx_inspire_ai_agent"


class DeniedVolumeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement, args=None):
        self.statements.append(statement)
        raise PermissionError("[INSUFFICIENT_PERMISSIONS] User does not have CREATE VOLUME on Schema 'c.s'")


class DeniedWorkspaceApi(FakeWorkspaceApi):
    def mkdirs(self, path):
        raise PermissionError(f"PERMISSION_DENIED: no write access to {path}")


def _client(workspace_api):
    return types.SimpleNamespace(workspace=workspace_api, config=types.SimpleNamespace(host=""))


def test_workspace_paths_get_their_workspace_form(agent_ns):
    canonical = agent_ns["canonical_workspace_path"]
    is_workspace = agent_ns["is_workspace_path"]
    assert canonical("/Shared/demos/tpcds_retail") == "/Workspace/Shared/demos/tpcds_retail"
    assert canonical("/Users/499a2957-8c6d-4253-aa48-d4ac492b1e1b/out") == "/Workspace/Users/499a2957-8c6d-4253-aa48-d4ac492b1e1b/out"
    assert canonical("/Repos/team/inspire/out") == "/Workspace/Repos/team/inspire/out"
    assert canonical(" /Workspace/Users/me@x.com/out ") == "/Workspace/Users/me@x.com/out"
    for path in ("/Volumes/c/s/v/out", "/Volumes/c/s/v/me@x.com/out", "/tmp/out", "relative/out", "", None):
        assert canonical(path) == str(path or "").strip(), path
        assert not is_workspace(path), path
    assert is_workspace("/Shared/demos") and is_workspace("/Workspace/Shared/demos") and is_workspace("/Users/u/x")
    home = os.path.expanduser("~")
    if home.startswith("/Users/"):
        assert canonical(home) == home, "a folder that exists on this machine keeps its path"


def test_the_apps_relative_generation_path_resolves_to_its_workspace_form(agent_ns):
    resolve = agent_ns["resolve_generation_path"]
    assert resolve("./../demos/", APP_NOTEBOOK) == "/Workspace/Shared/demos"
    assert resolve("./out", "/Users/me@x.com/inspire/agent") == "/Workspace/Users/me@x.com/inspire/out"
    assert resolve("./out", "/Workspace/Users/me@x.com/inspire/agent") == "/Workspace/Users/me@x.com/inspire/out"
    assert resolve("/Shared/out") == "/Workspace/Shared/out"
    assert resolve("/Volumes/c/s/v/out/../x") == "/Volumes/c/s/v/x"
    assert resolve("/Workspace/Users/me@x.com/out") == "/Workspace/Users/me@x.com/out"


def test_an_app_run_streams_its_live_log_to_the_generation_path_when_the_volume_is_denied(agent_ns):
    workspace_api = FakeWorkspaceApi()
    spark = DeniedVolumeSpark()
    obj = make_inspire(agent_ns, inspire_database="c.s", base_output_dir="/Shared/demos/tpcds_retail", spark=spark,
                       w_client=_client(workspace_api))
    target = obj._resolve_live_log_target()
    parent = "/Workspace/Shared/demos/tpcds_retail/.inspire_logs/session_4242"
    assert target == {"dst_path": parent + "/log.log", "kind": "workspace", "parent_dir": parent}
    assert workspace_api.dirs == {parent}
    assert spark.statements == ["CREATE VOLUME IF NOT EXISTS `c`.`s`.vol_root"]
    assert obj.logger.records[0][0] == "WARNING" and "UC volume target unavailable" in obj.logger.records[0][1]


def test_a_regeneration_writes_its_logs_beside_the_discover_logs_of_its_session(agent_ns):
    import re
    discover = make_inspire(agent_ns, inspire_database="c.s", base_output_dir="/Shared/demos/tpcds_retail",
                            spark=DeniedVolumeSpark(), w_client=_client(FakeWorkspaceApi()))
    assert [discover._run_log_name(*n) for n in (("log", "log"), ("ailogs", "jsonl"), ("generation_log", "txt"))] == \
        ["log.log", "ailogs.jsonl", "generation_log.txt"], "a Discover run keeps the documented names"
    regen = make_inspire(agent_ns, inspire_database="c.s", base_output_dir="/Shared/demos/tpcds_retail", spark=DeniedVolumeSpark(),
                         w_client=_client(FakeWorkspaceApi()), generate_genie_instructions=True)
    names = [regen._run_log_name(*n) for n in (("log", "log"), ("ailogs", "jsonl"), ("generation_log", "txt"))]
    stamp = re.fullmatch(r"log_generate_(\d{8}_\d{6})\.log", names[0])
    assert stamp, names[0]
    assert names[1:] == [f"ailogs_generate_{stamp.group(1)}.jsonl", f"generation_log_generate_{stamp.group(1)}.txt"], \
        "a Genie regeneration on the session overwrote the Discover run's log.log and docs/generation_log.txt"
    target = regen._resolve_live_log_target()
    assert target["dst_path"] == target["parent_dir"] + "/" + names[0] and target["parent_dir"].endswith("/session_4242")


def test_each_implement_run_writes_its_own_log_named_by_its_job_run_so_no_run_overwrites_another(agent_ns):
    import re
    operation = agent_ns["IMPLEMENT_OPERATION"]
    param = agent_ns["IMPLEMENT_RUN_ID_PARAM"]

    def built(run_id):
        return make_inspire(agent_ns, inspire_database="c.s", base_output_dir="/Shared/demos/tpcds_retail", spark=DeniedVolumeSpark(),
                            w_client=_client(FakeWorkspaceApi()), operation=operation, generate_genie_instructions=False,
                            _implement_params={param: run_id})

    first, second = built("111122223333444"), built("555566667777888")
    assert [first._run_log_name(*n) for n in (("log", "log"), ("ailogs", "jsonl"), ("generation_log", "txt"))] == \
        ["log_implement_111122223333444.log", "ailogs_implement_111122223333444.jsonl", "generation_log_implement_111122223333444.txt"]
    assert second._run_log_name("log", "log") == "log_implement_555566667777888.log"
    assert first._resolve_live_log_target()["dst_path"].endswith("/session_4242/log_implement_111122223333444.log"), \
        "an implement run overwrote the session's log.log, so the Discover log and the other runs' Genie feed were lost"
    for unresolved in ("", "{{job.run_id}}", "12a", "1" * 20):
        name = built(unresolved)._run_log_name("log", "log")
        assert re.fullmatch(r"log_implement_\d{8}_\d{6}\.log", name), (unresolved, name)
    regen = make_inspire(agent_ns, operation="Generate Use Cases", generate_genie_instructions=True,
                         _implement_params={param: "111122223333444"})
    assert re.fullmatch(r"log_generate_\d{8}_\d{6}\.log", regen._run_log_name("log", "log"))
    assert make_inspire(agent_ns, operation="Discover Use Cases", _implement_params={param: "1"})._run_log_name("log", "log") == "log.log"


def test_a_disabled_live_log_names_the_real_reason_for_each_target(agent_ns, tmp_path):
    obj = make_inspire(agent_ns, inspire_database="c.s", base_output_dir="/Workspace/Shared/demos/tpcds_retail",
                       spark=DeniedVolumeSpark(), w_client=_client(DeniedWorkspaceApi()), local_log_output_dir=str(tmp_path))
    obj._start_live_log_flush_thread()
    disabled = [msg for level, msg in obj.logger.records if level == "WARNING" and "Live log streaming DISABLED" in msg]
    assert len(disabled) == 1
    assert "volume c.s.vol_root" in disabled[0] and "CREATE VOLUME" in disabled[0]
    assert "/Workspace/Shared/demos/tpcds_retail/.inspire_logs/session_4242" in disabled[0] and "PERMISSION_DENIED" in disabled[0]
    assert "is not set" not in disabled[0], "the database and the path were both set"
    assert not getattr(obj, "_volume_log_dst", None)

    bare = make_inspire(agent_ns, inspire_database="", base_output_dir="", local_log_output_dir=str(tmp_path))
    bare._start_live_log_flush_thread()
    [message] = [msg for level, msg in bare.logger.records if "Live log streaming DISABLED" in msg]
    assert "02_inspire_database is not set; 11_generation_path is not set" in message


def test_the_end_of_run_log_is_not_copied_with_local_file_calls_into_a_workspace_folder(agent_ns, tmp_path):
    log_file = tmp_path / "log.txt"
    log_file.write_text("run log line\n", encoding="utf-8")
    handler = logging.FileHandler(str(log_file))
    logging.root.handlers.insert(0, handler)
    try:
        obj = make_inspire(agent_ns, base_output_dir="/Shared/demos/tpcds_retail", docs_output_dir="/Workspace/Shared/demos/tpcds_retail/docs",
                           sanitized_customer_name=f"inspire_test_{tmp_path.name}", local_log_output_dir=str(tmp_path),
                           atomic_writer=None)
        obj._upload_log_file()
    finally:
        logging.root.removeHandler(handler)
        handler.close()
    messages = [msg for _level, msg in obj.logger.records]
    assert any(msg.startswith("Skipping local log copy — output is a workspace path: /Shared/demos/tpcds_retail") for msg in messages)
    assert not any("Failed to copy log file to output directory" in msg for msg in messages)
