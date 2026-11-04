const { parseExactJson } = require('./exactJson');
const { int64Id } = require('./int64Id');

const JOB_VIEW_LEVEL = 'CAN_VIEW';
const VIEW_LEVELS = ['CAN_VIEW', 'CAN_MANAGE_RUN', 'CAN_MANAGE', 'IS_OWNER'];
const REMEMBERED_RUNS = 1000;
const runNotes = new Map();
const NO_LAUNCHER_VIEW = 'no signed-in person launched this run, so only workspace admins and the App can open it in Databricks';

function launcherName(launchedBy) {
  const value = launchedBy && typeof launchedBy === 'object' ? launchedBy.username : launchedBy;
  return String(value ?? '').trim();
}

async function grantJobViewer(dbFetch, host, token, jobId, launchedBy) {
  const person = launcherName(launchedBy);
  if (!person) return { granted: false, note: NO_LAUNCHER_VIEW };
  const job = int64Id(jobId);
  const cannot = (why) => ({ granted: false, note: `Inspire could not let ${person} view job ${job || String(jobId ?? '')} in Databricks: ${why}` });
  if (!job) return cannot('the job id is missing');
  if (await canAlreadyView(dbFetch, host, token, job, person)) return { granted: true, note: '', already: true };
  try {
    const resp = await dbFetch(host, token, `/api/2.0/permissions/jobs/${job}`, {
      method: 'PATCH',
      body: JSON.stringify({ access_control_list: [{ user_name: person, permission_level: JOB_VIEW_LEVEL }] }),
    });
    if (resp.ok) return { granted: true, note: '' };
    const text = await resp.text().catch(() => '');
    let message = text;
    try { message = parseExactJson(text).message || text; } catch { message = text; }
    return cannot(String(message || `HTTP ${resp.status}`).trim());
  } catch (err) {
    return cannot(err && err.message ? err.message : String(err));
  }
}

async function canAlreadyView(dbFetch, host, token, job, person) {
  try {
    const resp = await dbFetch(host, token, `/api/2.0/permissions/jobs/${job}`);
    if (!resp.ok) return false;
    const acl = parseExactJson(await resp.text());
    const entries = Array.isArray(acl && acl.access_control_list) ? acl.access_control_list : [];
    const me = person.toLowerCase();
    return entries.some((e) => String(e.user_name || '').trim().toLowerCase() === me
      && (Array.isArray(e.all_permissions) ? e.all_permissions : []).some((p) => VIEW_LEVELS.includes(String(p.permission_level || '').toUpperCase())));
  } catch {
    return false;
  }
}

function rememberViewer(runId, viewer) {
  const id = int64Id(runId);
  if (!id) return;
  runNotes.delete(id);
  if (viewer && viewer.note) runNotes.set(id, viewer.note);
  while (runNotes.size > REMEMBERED_RUNS) runNotes.delete(runNotes.keys().next().value);
}

function viewerNoteOf(runId) {
  const id = int64Id(runId);
  return (id && runNotes.get(id)) || '';
}

module.exports = { JOB_VIEW_LEVEL, VIEW_LEVELS, NO_LAUNCHER_VIEW, REMEMBERED_RUNS, launcherName, grantJobViewer, rememberViewer, viewerNoteOf };
