// Every call to a service answers within `ms` (time to headers) or fails with a reason. Without a bound, one call that never
// returns holds the whole request open, with no job, no session and no error.
const DEFAULT_ANSWER_MS = 120000;

function answerMs(env = process.env) {
  const asked = Number(env.INSPIRE_DB_ANSWER_MS);
  return Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_ANSWER_MS;
}

function spanText(ms) {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} seconds`;
}

// The timer stops once headers arrive, so a large body still downloads in full.
function fetchWithin(url, init = {}, { ms = answerMs(), label = 'The request' } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(url, { ...init, signal: controller.signal })
    .catch((e) => {
      if (timedOut) throw Object.assign(new Error(`${label} did not answer within ${spanText(ms)}`), { timedOut: true });
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

module.exports = { DEFAULT_ANSWER_MS, answerMs, fetchWithin };
