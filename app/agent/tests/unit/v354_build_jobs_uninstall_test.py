"""REQ-354: Uninstall all deletes the build launcher jobs of every version of the use case, in this session, and nothing else."""
from v143_vibes_test import BUILT, _locked, _run

SESSION = 5150
UC = "N01-U01"


def _job(job_id, version=None, run_type="implement", session=SESSION, uc=UC, name=None):
    tags = {"dbx_inspire_ai_run_type": run_type, "dbx_inspire_ai_session_id": str(session), "dbx_inspire_ai_usecase_id": uc}
    if version is not None:
        tags["dbx_inspire_ai_spec_version"] = str(version)
    return {"job_id": job_id, "settings": {"name": name or f"Inspire AI - MVP - {uc} - v{version}", "tags": {k: v for k, v in tags.items() if v}}}


class _Jobs:
    """A fake of the Jobs REST calls the uninstall makes. `pages` is a list of job pages; `running` is the job ids with an active run;
    `refuse` maps a job id to the error its delete raises."""

    def __init__(self, pages, running=(), refuse=None):
        self.pages, self.running, self.refuse = pages, set(running), refuse or {}
        self.deleted, self.calls = [], []

    def __call__(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        if method == "GET" and path == "/api/2.2/jobs/list":
            index = int((query or {}).get("page_token") or 0)
            nxt = index + 1 if index + 1 < len(self.pages) else None
            return {"jobs": self.pages[index], **({"next_page_token": str(nxt)} if nxt is not None else {})}
        if method == "GET" and path == "/api/2.2/jobs/runs/list":
            job = int(query["job_id"])
            return {"runs": [{"run_id": 1}] if job in self.running else []}
        if method == "POST" and path == "/api/2.2/jobs/delete":
            job = int(body["job_id"])
            if job in self.refuse:
                raise RuntimeError(self.refuse[job])
            self.deleted.append(job)
            return {}
        return {}


def _inst(agent_ns, jobs):
    inst, _previous = _locked(agent_ns)
    inst._implement_api = jobs
    inst.implement_table = ""  # no implement table in this harness: the launch-record lookup is empty, as when implement is off
    return inst


def test_build_jobs_of_this_use_case_in_this_session_are_all_matched_and_nothing_else(agent_ns):
    pages = [[_job(11, 1), _job(12, 2), _job(13, 2, uc="N01-U02"), _job(14, 2, session=5151), _job(15, 2, run_type="discovery"),
              _job(16, 2, uc="N01-U010"), {"job_id": 17, "settings": {"name": "Inspire AI - MVP - N01-U01 - v3"}}]]
    jobs = _Jobs(pages)
    inst = _inst(agent_ns, jobs)
    assert inst._implement_build_jobs((SESSION, UC, 4)) == [(11, 1), (12, 2)]


def test_every_page_of_the_job_list_is_read(agent_ns):
    jobs = _Jobs([[_job(11, 1)], [_job(12, 2)], [_job(13, 3)]])
    inst = _inst(agent_ns, jobs)
    assert [job for job, _v in inst._implement_build_jobs((SESSION, UC, 4))] == [11, 12, 13]


def test_each_build_job_of_every_version_is_deleted(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 2), _job(13, 3), _job(20, 1, uc="N02-U01")]])
    inst = _inst(agent_ns, jobs)
    warnings, notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert warnings == [] and notes == []
    assert jobs.deleted == [11, 12, 13], "other use cases' jobs stay"


def test_a_build_job_already_gone_is_not_a_warning(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 2)]], refuse={11: "RESOURCE_DOES_NOT_EXIST: Job 11 does not exist"})
    inst = _inst(agent_ns, jobs)
    warnings, _notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert warnings == [] and jobs.deleted == [12]


def test_a_running_build_job_is_not_deleted_and_the_result_says_so(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 2)]], running={11})
    inst = _inst(agent_ns, jobs)
    warnings, _notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert jobs.deleted == [12], "a job with an active run is never deleted under it"
    assert warnings == ["build job 11 (v1) is still running, so Inspire did not delete it; stop it in Jobs, then Uninstall all again."]


def test_a_build_job_the_app_cannot_manage_is_reported_not_swallowed(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 2)]], refuse={11: "PERMISSION_DENIED: User does not have CAN_MANAGE on job 11"})
    inst = _inst(agent_ns, jobs)
    warnings, _notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert jobs.deleted == [12]
    assert len(warnings) == 1 and warnings[0].startswith("build job 11 (v1) could not be deleted: ") and "PERMISSION_DENIED" in warnings[0]
    assert warnings[0].endswith("Delete it in Jobs.")


def test_the_job_running_this_uninstall_is_named_as_a_note_and_never_deleted(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 4)]], running={12})
    inst = _inst(agent_ns, jobs)
    warnings, notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert jobs.deleted == [11], "deleting the job that runs this uninstall would stop it"
    assert warnings == []
    assert notes == ["build job 12 (v4) runs this uninstall, so it stays until the run ends; the App deletes it when it next reads this build."]


def test_uninstall_all_deletes_the_build_jobs_and_says_so_in_the_done_message(agent_ns):
    jobs = _Jobs([[_job(31, 1), _job(32, 2), _job(33, 3, uc="N02-U01")]])
    inst, previous = _locked(agent_ns)
    inst.implement_table = ""
    inst._implement_api = _with_app(jobs)
    inst._implement_carried = lambda target: (dict(BUILT), _left_by_two())
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/impl/N01", "mvp": "/W/impl/N01/mvp", "version": f"/W/impl/N01/mvp/v{key[2]}"}
    inst._implement_folder_objects = lambda folder: []
    inst._implement_delete_digest = lambda uc, digest: []
    assert _run(inst, dict(previous, uninstall=True)) == "uninstalled"
    assert sorted(j for j in jobs.deleted if j != 77) == [31, 32], "the job of another use case is untouched"
    final = inst.updates[-1]
    assert final["status"] == "uninstalled" and final["status_message"] == ""
    done = [e for e in inst.emitted if e.get("step_name") == "Done"][-1]
    assert "build jobs of every version" in done["message"]


def _with_app(jobs):
    """The App's GET answers with the description the uninstall checks, so only the job calls are under test."""
    def api(method, path, body=None, query=None):
        if method == "GET" and path.startswith("/api/2.0/apps/"):
            return {"description": "Inspire use case N01-U01 (session 5150): Predict churn"}
        return jobs(method, path, body, query)
    return api


def _left_by_two():
    return {"notebook": {"modified_at": 1700000000000, "spec_version": 2, "result_history": 1}}


def test_uninstall_all_still_deletes_the_session_job_it_always_deleted(agent_ns):
    jobs = _Jobs([[_job(31, 1)]])
    inst, previous = _locked(agent_ns)
    inst.implement_table = ""
    inst._implement_api = _with_app(jobs)
    inst._implement_carried = lambda target: (dict(BUILT), _left_by_two())
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/impl/N01", "mvp": "/W/impl/N01/mvp", "version": f"/W/impl/N01/mvp/v{key[2]}"}
    inst._implement_folder_objects = lambda folder: []
    inst._implement_delete_digest = lambda uc, digest: []
    _run(inst, dict(previous, uninstall=True))
    posted = [(m, p, b) for m, p, b, _q in jobs.calls if m == "POST" and p == "/api/2.2/jobs/delete"]
    assert {"job_id": 77} in [b for _m, _p, b in posted]
    assert [j for j in jobs.deleted if j != 77] == [31]


def test_a_job_list_the_app_cannot_read_is_reported_and_the_rest_of_the_uninstall_still_runs(agent_ns):
    jobs = _Jobs([[_job(11, 1)]])

    def unreadable(method, path, body=None, query=None):
        if path == "/api/2.2/jobs/list":
            raise RuntimeError("PERMISSION_DENIED: cannot list jobs in this workspace")
        return jobs(method, path, body, query)

    inst = _inst(agent_ns, jobs)
    inst._implement_api = unreadable
    warnings, notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert notes == [] and jobs.deleted == []
    assert len(warnings) == 1 and warnings[0].startswith("Inspire could not list the build jobs of this use case") and "PERMISSION_DENIED" in warnings[0]


def _untagged(job_id, name):
    return {"job_id": job_id, "settings": {"name": name}}


def test_a_job_started_before_the_tags_is_found_through_the_launch_record_and_deleted(agent_ns):
    jobs = _Jobs([[_untagged(22, "Inspire AI - MVP - N01-U01 - v2"), _job(11, 1)]])
    inst = _inst(agent_ns, jobs)
    inst._implement_build_run_jobs = lambda key: ({2: 22}, set())
    warnings, notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert warnings == [] and notes == []
    assert sorted(jobs.deleted) == [11, 22], "the untagged job is found by its run in the launch record, not by its name"


def test_runs_without_a_launch_record_are_counted_in_the_done_note_and_their_jobs_are_left(agent_ns):
    jobs = _Jobs([[_job(11, 1)]])
    inst = _inst(agent_ns, jobs)
    inst._implement_build_run_jobs = lambda key: ({}, {3})
    warnings, notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert warnings == [] and jobs.deleted == [11]
    assert notes == ["1 build run of this use case (v3) started before Inspire recorded launches, so the jobs could not be found "
                     "and stay in Jobs."]


def test_an_unreadable_launch_record_is_reported_and_tagged_jobs_are_still_deleted(agent_ns):
    jobs = _Jobs([[_job(11, 1)]])
    inst = _inst(agent_ns, jobs)

    def unreadable(key):
        raise RuntimeError("PERMISSION_DENIED: cannot read __inspire_launch")

    inst._implement_build_run_jobs = unreadable
    warnings, _notes = inst._implement_delete_build_jobs((SESSION, UC, 4))
    assert jobs.deleted == [11]
    assert len(warnings) == 1 and warnings[0].startswith("Inspire could not read the launch record") and "PERMISSION_DENIED" in warnings[0]


def _kept(inst_ns_key_versions):
    return {"kept": {"state": "kept", "assets": [{"output": "dashboard", "id": f"d{v}", "version": v} for v in inst_ns_key_versions]}}


def test_remove_kept_deletes_the_build_job_of_a_kept_version_whose_outputs_are_all_removed(agent_ns):
    jobs = _Jobs([[_job(11, 1), _job(12, 2)]])
    inst = _inst(agent_ns, jobs)
    inst._implement_build_run_jobs = lambda key: ({}, set())
    inst._implement_delete_output = lambda output, asset_id, key, **kw: {"warnings": [], "refused": False, "grants_left": None}
    status = _kept([1, 2])
    warnings = inst._implement_remove_kept((SESSION, UC, 4), status, [2], {})
    assert warnings == []
    assert jobs.deleted == [12], "v2's job goes with its outputs; v1 is still kept, so its job stays"
    assert [a["version"] for a in status["kept"]["assets"]] == [1]


def test_remove_kept_leaves_the_job_of_a_version_that_still_has_a_kept_output(agent_ns):
    jobs = _Jobs([[_job(12, 2)]])
    inst = _inst(agent_ns, jobs)
    inst._implement_build_run_jobs = lambda key: ({}, set())
    inst._implement_delete_output = lambda output, asset_id, key, **kw: {"warnings": [], "refused": output == "dashboard", "grants_left": None}
    status = _kept([2])
    inst._implement_remove_kept((SESSION, UC, 4), status, [2], {})
    assert jobs.deleted == [], "a refused output keeps its version, so the version's job stays too"


def test_uninstall_sweeps_kept_versions_once_so_remove_kept_with_no_versions_deletes_no_jobs(agent_ns):
    jobs = _Jobs([[_job(12, 2)]])
    inst = _inst(agent_ns, jobs)
    inst._implement_build_run_jobs = lambda key: ({}, set())
    inst._implement_delete_output = lambda output, asset_id, key, **kw: {"warnings": [], "refused": False, "grants_left": None}
    inst._implement_remove_kept((SESSION, UC, 4), _kept([2]), None, {})
    assert jobs.deleted == [], "Uninstall all's own sweep deletes it, once"


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return self.rows


class _Spark:
    def __init__(self, answers):
        self.answers, self.statements = answers, []

    def sql(self, statement, args=None):
        self.statements.append((statement, args))
        for needle, rows in self.answers:
            if needle in statement:
                return _Rows(rows)
        return _Rows([])


def test_the_launch_record_lookup_joins_each_run_to_its_job_for_this_session_and_implement_runs_only(agent_ns):
    inst, _previous = _locked(agent_ns)
    # Live W1 rc.2-e (11-19 17:05): the agent has no implement_table attribute (only the step writer does), so the lookup raised
    # AttributeError. The test used to set the attribute by hand, which hid it; the agent's own table helper is the source now.
    inst.__dict__.pop("implement_table", None)  # the offline harness sets it; the real agent object never has it
    assert not hasattr(inst, "implement_table")
    inst.inspire_database = "main.inspire"
    inst.spark = _Spark([("__inspire_implement", [{"version": 2, "run": "700"}, {"version": 3, "run": "800"}]),
                         ("__inspire_launch", [{"run": "700", "job": 22}])])
    recorded, unrecorded = inst._implement_build_run_jobs((SESSION, UC, 4))
    assert recorded == {2: 22} and unrecorded == {3}
    launch_sql = [st for st, _a in inst.spark.statements if "__inspire_launch" in st]
    assert launch_sql and "`main`.`inspire`.__inspire_launch" in launch_sql[0].replace("`__inspire_launch`", "__inspire_launch")
    assert "run_type = 'implement'" in launch_sql[0] and "session_id = :sid" in launch_sql[0]
