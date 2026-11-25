// Caps how many listing requests are in flight at once (REQ-378). A whole-catalog pick lists every schema of the catalog; one request
// per schema, all at once, overran the App and the browser gave up on most of them with "Failed to fetch".
export function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    active += 1;
    const { run, resolve, reject } = waiting.shift();
    Promise.resolve().then(run).then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (run) => new Promise((resolve, reject) => {
    waiting.push({ run, resolve, reject });
    next();
  });
}

// A request that never got an answer (the browser's own network failure, not a refusal from the App).
export const isNetworkFailure = (err) => err?.network === true || !err?.status && /^(?:TypeError: )?(?:Failed to fetch|NetworkError|Load failed|network error)/i.test(String(err?.message || ''));

// Runs a listing through the limiter; a network failure is tried once more before it counts as a failure.
export function queuedListing(limit, run) {
  return limit(() => run().catch((e) => (isNetworkFailure(e) ? run() : Promise.reject(e))));
}
