export const DEMO_NOTE = 'This is a demo, so it is read-only: nothing you do here changes any data.';
export const toneOf = (err) => (err?.calm ? 'info' : 'error');
export const failureOf = (err, text) => ({ text: text ?? (err?.message || ''), calm: !!err?.calm });

async function send(method, path, body) {
  const response = await fetch(`./api/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let message = `The App answered HTTP ${response.status}`;
    let detail = null;
    if ((response.headers.get('content-type') || '').includes('json')) {
      try { detail = await response.json(); message = detail.error || message; } catch { /* the status line is the message */ }
    }
    const calm = response.status >= 400 && response.status < 500 && detail?.showcase === true;
    const error = new Error(calm ? (response.status === 404 && typeof detail.error === 'string' && detail.error ? detail.error : DEMO_NOTE) : message);
    error.status = response.status;
    error.detail = detail;
    error.code = typeof detail?.code === 'string' ? detail.code : '';
    error.calm = calm;
    throw error;
  }
  return response;
}

const json = async (method, path, body) => (await send(method, path, body)).json();

export const getApp = () => json('GET', 'app');
export const getFilters = (page) => json('GET', `filters?page=${encodeURIComponent(page)}`);
export const getDefaults = (page) => json('GET', `defaults?page=${encodeURIComponent(page)}`);
export const getPage = (page, filters, tables, sorts) => json('POST', 'page', { page, filters, ...(tables && Object.keys(tables).length ? { table_filters: tables } : {}),
  ...(sorts && Object.keys(sorts).length ? { table_sorts: sorts } : {}) });
export const askGenie = (page, question, conversationId, about) =>
  json('POST', 'genie/ask', { page, question, conversation_id: conversationId || '', ...(about ? { record_key: about.recordKey } : {}) });
export const explainGenie = (body) => json('POST', 'genie/explain', { ...body, conversation_id: body.conversation_id || '' });
export const genieMessage = (page, conversationId, messageId) =>
  json('GET', `genie/message?${new URLSearchParams({ page, conversation_id: conversationId, message_id: messageId })}`);
export const genieFeedback = (page, conversationId, messageId, rating) =>
  json('POST', 'genie/feedback', { page, conversation_id: conversationId, message_id: messageId, rating });
export const getHistory = (page, ref) => json('GET', `records/history?${new URLSearchParams({ page, ...ref })}`);
export const getFields = (page) => json('GET', `records/fields?page=${encodeURIComponent(page)}`);
export const writeRecord = (kind, body) => json('POST', `records/${kind}`, body);
const DEMO_DECIDED = 'inspire-demo-decisions';
const demoStore = () => { try { return window.sessionStorage; } catch { return null; } };
const demoKey = (page) => `${DEMO_DECIDED}:${typeof location === 'undefined' ? '' : location.pathname}:${page}`;
export function demoDecided(page) {
  try { return JSON.parse(demoStore()?.getItem(demoKey(page)) || '{}') || {}; } catch { return {}; }
}
function rememberDemo(page, key, row) {
  const store = demoStore();
  if (!store) return;
  try { store.setItem(demoKey(page), JSON.stringify({ ...demoDecided(page), [key]: row })); } catch { return; }
}
export const withDemoDecisions = (page, list) => {
  const decided = demoDecided(page);
  if (!list || !Array.isArray(list.rows) || !Object.keys(decided).length) return list;
  return { ...list, rows: list.rows.map((r) => (decided[String(r.record_key)] ? { ...r, ...decided[String(r.record_key)] } : r)) };
};
export const getRecords = async (body) => withDemoDecisions(body?.page, await json('POST', 'records', body));
export const actRecords = (body) => json('POST', 'records/act', body);
export const decidePlan = async (body) => {
  const got = await json('POST', 'plan/decide', body);
  if (got?.showcase === true && got.saved === false && got.row && body?.record_key != null) rememberDemo(body.page, String(body.record_key), got.row);
  return got;
};
export const evaluateScenario = (body) => json('POST', 'scenario/evaluate', body);
export const undoRecords = (body) => json('POST', 'records/undo', body);
export const getBatches = (page) => json('GET', `records/batches?page=${encodeURIComponent(page)}`);
export const getSimilar = (page, recordKey, by) =>
  json('GET', `records/similar?${new URLSearchParams({ page, record_key: recordKey, by: by.join(',') })}`);
export const getFilterOptions = (page, which, q) => json('GET', `filters/options?${new URLSearchParams({ page, ...which, q })}`);
export const getRuns = (page, offset = 0) => json('GET', `runs?${new URLSearchParams({ page, offset })}`);
export const getFreshness = (page) => json('GET', `freshness?page=${encodeURIComponent(page)}`);
export const refreshPage = (page) => json('POST', 'refresh', { page });
export const getOverview = (body = {}) => json('POST', 'overview', body);
export const getMyWork = (body) => json('POST', 'my_work', body);
export const getSummary = (page) => json('GET', `summary?page=${encodeURIComponent(page)}`);
export const getMoney = (page) => json('GET', `money?page=${encodeURIComponent(page)}`);
export const changeAssumption = (body) => json('POST', 'money/assumption', body);
export const getSettings = (page) => json('GET', `settings?page=${encodeURIComponent(page)}`);
export const previewSetting = (body) => json('POST', 'settings/preview', body);
export const saveSetting = (body) => json('POST', 'settings/save', body);
export const runSettingsNow = (page) => json('POST', 'settings/run', { page });
export const getImpact = (page) => json('GET', `impact?page=${encodeURIComponent(page)}`);
export const getUsage = () => json('GET', 'admin/usage');
export const getAlerts = (page) => json('GET', `alerts?page=${encodeURIComponent(page)}`);
export const previewAlert = (body) => json('POST', 'alerts/preview', body);
export const saveAlert = (body) => json('POST', 'alerts/save', body);
export const pauseAlert = (body) => json('POST', 'alerts/pause', body);
export const deleteAlert = (body) => json('POST', 'alerts/delete', body);

export function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function saveDataUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
