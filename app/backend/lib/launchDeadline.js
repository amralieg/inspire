// A launch's read and access checks run before any job exists. When the workspace or the SQL warehouse never answers
// them, the launch must end with a reason instead of holding the request open with no job, no session and no error.
const LAUNCH_CHECK_MS = 120000;

function launchCheckMs(env = process.env) {
  const asked = Number(env.INSPIRE_LAUNCH_CHECK_MS);
  return Number.isFinite(asked) && asked > 0 ? asked : LAUNCH_CHECK_MS;
}

function spanText(ms) {
  if (ms >= 60000) {
    const minutes = Math.round(ms / 60000);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function launchCheckStalled(ms) {
  return Object.assign(new Error(`Inspire did not finish checking what it can read in the tables you picked within ${spanText(ms)}, so nothing was started. `
    + 'The SQL warehouse may be busy or starting. Try again in a minute.'), { statusCode: 504 });
}

// Resolves with the work's value, or rejects with the stalled reason once `ms` passes. The work keeps running in the
// background but starts nothing, because every launch step after this check runs only when the check has answered.
function raceLaunchCheck(work, ms = launchCheckMs()) {
  let timer = null;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(launchCheckStalled(ms)), ms);
  });
  return Promise.race([work, stalled]).finally(() => clearTimeout(timer));
}

module.exports = { LAUNCH_CHECK_MS, launchCheckMs, launchCheckStalled, raceLaunchCheck };
