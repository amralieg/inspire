import { apiErrorDetail, parseApiErrorMessage } from './ucPermissionErrors.js';
import { raisePermissions } from './permissionBus.js';
import { withDeadline } from './startDeadline.js';
import { splitTechnical } from './plainText.js';
import { trackAi } from './aiStatus.js';

export const SHOWCASE_HEADER = 'X-Inspire-Showcase';

// A boot read (the App and Setup page reads that gate the first screen) answers within this bound. One that never answers
// rejects with the bound's error, flagged deadline: true, so the page shows its load error with Try again instead of a spinner forever.
export const BOOT_ANSWER_MS = 20000;
export const BOOT_TIMEOUT_TEXT = `Inspire did not answer within ${BOOT_ANSWER_MS / 1000} seconds while it connected to the workspace.`;
const bootTimedOut = () => Object.assign(new Error(BOOT_TIMEOUT_TEXT), { deadline: true });
// Parsed JSON, or null when the server answers with a failure status. The body is read inside the deadline too.
export const bootRead = (url, init = {}) => withDeadline(async (signal) => {
  const resp = await fetch(url, { ...init, signal });
  return resp.ok ? resp.json() : null;
}, { ms: BOOT_ANSWER_MS, error: bootTimedOut() });

export function requestHeaders(token, databricksHost, extra = {}, showcase = '') {
  const headers = { ...extra };
  if (showcase) {
    headers[SHOWCASE_HEADER] = showcase;
    return headers;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-DB-PAT-Token'] = token;
  }
  if (databricksHost) headers['X-Databricks-Host'] = databricksHost;
  return headers;
}

// raise: false keeps the grants on the error for the caller only, for a check that shows its own grant (the output folder check).
export async function responseError(resp, { raise = true } = {}) {
  const errText = await resp.text().catch(() => '');
  let parsed;
  try {
    parsed = JSON.parse(errText);
  } catch {
    parsed = undefined;
  }
  const message = parsed === undefined || typeof parsed === 'string' ? parseApiErrorMessage(errText) : apiErrorDetail(parsed);
  const err = new Error(message || `The request failed (HTTP ${resp.status})`);
  err.status = resp.status;
  err.body = parsed && typeof parsed === 'object' ? parsed : null;
  err.showcase = resp.status === 403 && err.body?.showcase === true;
  // Every failed request reaches the App-level Permission Required dialog when it carries grants.
  if (raise) raisePermissions(err.body?.permissions);
  // dialog: the Permission Required dialog was raised from this refusal. A page then shows no second message next to it (REQ-220).
  err.dialog = Boolean(raise) && Array.isArray(err.body?.permissions) && err.body.permissions.length > 0;
  return err;
}

// RC3-04: a request that gets no answer rejects with the browser's own TypeError ("Failed to fetch"). It becomes the plain
// network sentence (one source: the network cause), the browser error kept on `cause`. A cancel stays a cancel.
const networkError = (cause) => Object.assign(new Error(splitTechnical('Failed to fetch').plain, { cause }), { status: 0, network: true });
const NETWORK_RETRY_MS = 700;

async function send(url, init, { retry = false } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      if (!retry || attempt > 0) throw networkError(e);
      await new Promise((r) => setTimeout(r, NETWORK_RETRY_MS));
    }
  }
}

export function makeApiFetch({ token, databricksHost, showcase = '' } = {}) {
  // raise: false for a check or probe that shows its own refusal inline, so the App-level dialog does not open over it.
  // A read is tried once more when it gets no answer; a write never is.
  return (url, { raise = true } = {}) => trackAi(url, async () => {
    const resp = await send(url, { headers: requestHeaders(token, databricksHost, {}, showcase) }, { retry: true });
    if (!resp.ok) throw await responseError(resp, { raise });
    return resp.json();
  });
}

const makeApiSendJson = (method) => ({ token, databricksHost, showcase = '' } = {}) => (url, body, { signal, raise = true } = {}) => trackAi(url, async () => {
  const resp = await send(url, {
    method,
    headers: requestHeaders(token, databricksHost, { 'Content-Type': 'application/json' }, showcase),
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw await responseError(resp, { raise });
  return resp.json();
});

export const makeApiPostJson = makeApiSendJson('POST');
// REQ-435: the same call with PUT, for the saved Value at stake answers.
export const makeApiPutJson = makeApiSendJson('PUT');
