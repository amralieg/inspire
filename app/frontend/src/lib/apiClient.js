import { apiErrorDetail, parseApiErrorMessage } from './ucPermissionErrors.js';
import { raisePermissions } from './permissionBus.js';

export const SHOWCASE_HEADER = 'X-Inspire-Showcase';

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
  return err;
}

export function makeApiFetch({ token, databricksHost, showcase = '' } = {}) {
  // raise: false for a check or probe that shows its own refusal inline, so the App-level dialog does not open over it.
  return async (url, { raise = true } = {}) => {
    const resp = await fetch(url, { headers: requestHeaders(token, databricksHost, {}, showcase) });
    if (!resp.ok) throw await responseError(resp, { raise });
    return resp.json();
  };
}

export function makeApiPostJson({ token, databricksHost, showcase = '' } = {}) {
  return async (url, body, { signal, raise = true } = {}) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: requestHeaders(token, databricksHost, { 'Content-Type': 'application/json' }, showcase),
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) throw await responseError(resp, { raise });
    return resp.json();
  };
}
