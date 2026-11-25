const { ACTIVE_RUN_STATES } = require('./genieJobGuard');
const { int64Id, requireInt64Id } = require('./int64Id');

const LIST_PAGES = 5;

function genieNotebookJobName(sessionId) {
  const sid = int64Id(sessionId);
  if (!sid) throw new Error('session_id must be a numeric Inspire session id.');
  return `Inspire AI - Databricks AI - ${sid}`;
}

// Installs made before REQ-529 named the session job with the old product wording; those jobs are still looked up.
function legacyGenieNotebookJobName(sessionId) {
  const sid = int64Id(sessionId);
  if (!sid) throw new Error('session_id must be a numeric Inspire session id.');
  const LEGACY_JOB_NAME = `Inspire AI - Genie Code - ${sid}`;
  return LEGACY_JOB_NAME;
}

function apiError(what, got) {
  const err = new Error(`${what} failed (${got.status}): ${got.data?.message || got.data?.error_code || got.data?.raw || 'no message'}`);
  err.statusCode = 502;
  return err;
}

async function newestJobNamed(fetchJson, name) {
  let newest = null;
  let pageToken = '';
  for (let page = 0; page < LIST_PAGES; page += 1) {
    const got = await fetchJson(`/api/2.1/jobs/list?name=${encodeURIComponent(name)}&limit=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`);
    if (!got.ok) throw apiError('Listing the Databricks AI notebook jobs', got);
    for (const job of got.data.jobs || []) {
      if (job?.settings?.name !== name) continue;
      if (!newest || Number(job.created_time) > Number(newest.created_time)) newest = job;
    }
    pageToken = String(got.data.next_page_token || '');
    if (!pageToken) break;
  }
  return newest;
}

function notebookRunOf(run) {
  const life = String(run?.state?.life_cycle_state || '');
  const result = String(run?.state?.result_state || '');
  const active = ACTIVE_RUN_STATES.has(life);
  return {
    run_id: run.run_id,
    job_id: run.job_id,
    state: active ? 'running' : result === 'SUCCESS' ? 'succeeded' : 'failed',
    life_cycle_state: life,
    result_state: result,
    message: String(run?.state?.state_message || '').trim(),
    url: run.run_page_url || '',
    started_at: run.start_time ? new Date(Number(run.start_time)).toISOString() : '',
  };
}

// REQ-409 (run-as mode): the Genie runs are runs of the one installed Genie job, shared by every session, so this session's run is found by
// its notebook parameter (14_session_id). The active runs are read in full (every page), so the job's run count does not hide a run.
const INSTALLED_PAGE = 100;
const INSTALLED_MAX_PAGES = 100;

function sessionOfRun(run) {
  return String(run?.overriding_parameters?.notebook_params?.['14_session_id'] ?? '');
}

async function installedActiveGenieRunOf(fetchJson, sessionId, installedJobId) {
  const jobId = requireInt64Id(installedJobId, 'job_id');
  const sid = String(sessionId);
  let pageToken = '';
  for (let page = 0; page < INSTALLED_MAX_PAGES; page += 1) {
    const got = await fetchJson(`/api/2.1/jobs/runs/list?job_id=${jobId}&active_only=true&limit=${INSTALLED_PAGE}`
      + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''));
    if (!got.ok) throw apiError('Reading the Databricks AI notebook runs', got);
    const run = (got.data.runs || []).find((r) => sessionOfRun(r) === sid);
    if (run) return notebookRunOf({ job_id: jobId, ...run });
    pageToken = String(got.data.next_page_token || '');
    if (!pageToken) break;
  }
  return null;
}

// One run of the Genie job, read by its id (the run Inspire recorded for the session).
async function genieRunOf(fetchJson, runId) {
  const got = await fetchJson(`/api/2.1/jobs/runs/get?run_id=${requireInt64Id(runId, 'run_id')}`);
  if (!got.ok) throw apiError('Reading the Databricks AI notebook run', got);
  return notebookRunOf({ job_id: got.data.job_id, ...got.data });
}

// Outside run-as the session's job is found by its name (created for the session). In run-as mode the installed job is the one to read.
async function latestGenieNotebookRun(fetchJson, sessionId, { installedJobId = '' } = {}) {
  if (installedJobId) return installedActiveGenieRunOf(fetchJson, sessionId, installedJobId);
  const job = (await newestJobNamed(fetchJson, genieNotebookJobName(sessionId))) || (await newestJobNamed(fetchJson, legacyGenieNotebookJobName(sessionId)));
  if (!job) return null;
  const got = await fetchJson(`/api/2.1/jobs/runs/list?job_id=${requireInt64Id(job.job_id, 'job_id')}&limit=1`);
  if (!got.ok) throw apiError('Reading the Databricks AI notebook run', got);
  const run = (got.data.runs || [])[0];
  return run ? notebookRunOf({ job_id: job.job_id, ...run }) : null;
}

module.exports = { genieNotebookJobName, legacyGenieNotebookJobName, genieRunOf, latestGenieNotebookRun, newestJobNamed, notebookRunOf };
