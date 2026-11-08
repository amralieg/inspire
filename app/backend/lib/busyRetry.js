const BUSY_ATTEMPTS = 4;
const BUSY_BASE_MS = 2000;
const BUSY_MAX_MS = 30000;

function busyDelayMs(attempt, retryAfter = '', random = Math.random) {
  const asked = Number(String(retryAfter == null ? '' : retryAfter).trim());
  if (String(retryAfter == null ? '' : retryAfter).trim() && Number.isFinite(asked) && asked >= 0) return Math.min(asked * 1000, BUSY_MAX_MS);
  const wait = Math.min(BUSY_BASE_MS * 2 ** Math.max(attempt - 1, 0), BUSY_MAX_MS);
  return Math.min(wait + random() * wait * 0.25, BUSY_MAX_MS);
}

function isBusy(method, status) {
  return status === 429 || (status === 503 && String(method || 'GET').toUpperCase() === 'GET');
}

async function withBusyRetry(fetchOnce, { method = 'GET', signal = null, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), attempts = BUSY_ATTEMPTS } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const resp = await fetchOnce();
    if (!isBusy(method, resp.status) || attempt >= attempts || (signal && signal.aborted)) return resp;
    const wait = busyDelayMs(attempt, resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '');
    console.warn(`workspace busy (HTTP ${resp.status}); asking again in ${Math.round(wait)} ms (attempt ${attempt + 1}/${attempts})`);
    await sleep(wait);
  }
}

module.exports = { BUSY_ATTEMPTS, BUSY_BASE_MS, BUSY_MAX_MS, busyDelayMs, isBusy, withBusyRetry };
