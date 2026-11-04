const { parseExactJson } = require('./exactJson');
const { int64Id } = require('./int64Id');

const JOB_VIEW_LEVEL = 'CAN_VIEW';
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

module.exports = { JOB_VIEW_LEVEL, NO_LAUNCHER_VIEW, launcherName, grantJobViewer };
