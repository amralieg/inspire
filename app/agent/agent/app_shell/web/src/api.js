import { CLOSED_STATUSES, CODES } from './records.js';
export const DEMO_NOTE = 'This is a demo, so it is read-only: nothing you do here changes any data.';
export const toneOf = (err) => (err?.calm ? 'info' : 'error');
export const failureOf = (err, text) => ({ text: text ?? (err?.message || ''), calm: !!err?.calm, technical: text == null ? String(err?.detail?.details || '') : '' });
export const retryable = (err) => !err?.calm && !(err?.status >= 400 && err.status < 500 && err.status !== 429);

export const UNREACHABLE_TEXT = 'The App could not be reached. Check your connection, then try again';
export const RETRY_STATUSES = [429, 503, 504];
export const RETRY_WAIT_MS = 700;
const READ_POSTS = new Set(['page', 'records', 'overview', 'my_work']);
export const readsOnly = (method, path) => method === 'GET' || READ_POSTS.has(path);
const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function send(method, path, body, again = readsOnly(method, path)) {
  let response;
  try {
    response = await fetch(`./api/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (again) {
      await pause(RETRY_WAIT_MS);
      return send(method, path, body, false);
    }
    const error = new Error(UNREACHABLE_TEXT);
    error.status = 0;
    error.cause = err;
    throw error;
  }
  if (!response.ok && again && RETRY_STATUSES.includes(response.status)) {
    await pause(RETRY_WAIT_MS);
    return send(method, path, body, false);
  }
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

export const WAITING_FOR_ACCESS_CODE = 'waiting_for_access';
export const WAITING_FOR_ACCESS_TITLE = 'This App is waiting for access to its data';
export const waitingError = (data) => {
  const error = new Error(data.message || WAITING_FOR_ACCESS_TITLE);
  error.status = 200;
  error.calm = true;
  error.code = WAITING_FOR_ACCESS_CODE;
  error.detail = data;
  return error;
};
const json = async (method, path, body) => {
  const data = await (await send(method, path, body)).json();
  if (data && data.state === WAITING_FOR_ACCESS_CODE) throw waitingError(data);
  return data;
};

export const getApp = () => json('GET', 'app');
export const getFilters = (page) => json('GET', `filters?page=${encodeURIComponent(page)}`);
export const getDefaults = (page) => json('GET', `defaults?page=${encodeURIComponent(page)}`);
export const getPage = (page, filters, tables, sorts, searches) => json('POST', 'page', { page, filters, ...(tables && Object.keys(tables).length ? { table_filters: tables } : {}),
  ...(sorts && Object.keys(sorts).length ? { table_sorts: sorts } : {}), ...(searches && Object.keys(searches).length ? { table_search: searches } : {}) });
export const askGenie = (page, question, conversationId, about) =>
  json('POST', 'genie/ask', { page, question, conversation_id: conversationId || '', ...(about ? { record_key: about.recordKey } : {}) });
export const explainGenie = (body) => json('POST', 'genie/explain', { ...body, conversation_id: body.conversation_id || '' });
export const genieMessage = (page, conversationId, messageId) =>
  json('GET', `genie/message?${new URLSearchParams({ page, conversation_id: conversationId, message_id: messageId })}`);
export const genieFeedback = (page, conversationId, messageId, rating) =>
  json('POST', 'genie/feedback', { page, conversation_id: conversationId, message_id: messageId, rating });
export const agentStatus = (page) => json('GET', `agent/status?page=${encodeURIComponent(page)}`);
export const agentAsk = (body) => json('POST', 'agent/ask', body);
export const agentTurn = (turnId) => json('GET', `agent/turn?turn_id=${encodeURIComponent(turnId)}`);
export const agentFeedback = (turnId, rating) => json('POST', 'agent/feedback', { turn_id: turnId, rating });
export const getHistory = (page, ref) => json('GET', `records/history?${new URLSearchParams({ page, ...ref })}`);
export const getFields = (page) => json('GET', `records/fields?page=${encodeURIComponent(page)}`);
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
const filtered = (filters) => Object.values(filters || {}).some((v) => (Array.isArray(v) ? v.length > 0
  : v && typeof v === 'object' ? Object.values(v).some((x) => x != null && x !== '') : v != null && v !== ''));
export const withDemoDecisions = (page, list, filters = {}) => {
  const decided = demoDecided(page);
  const keys = Object.keys(decided);
  if (!list || !Array.isArray(list.rows) || !keys.length) return list;
  const listed = new Map(list.rows.map((r) => [String(r.record_key), r]));
  const moved = keys.filter((k) => (listed.has(k) ? !CLOSED_STATUSES.includes(listed.get(k)._inspire_status) : !filtered(filters))).length;
  const summary = list.summary && moved ? { ...list.summary, open: Math.max(0, (list.summary.open ?? 0) - moved), done: (list.summary.done ?? 0) + moved } : list.summary;
  return { ...list, ...(summary ? { summary } : {}), demo_moved: moved, rows: list.rows.map((r) => (decided[String(r.record_key)] ? { ...r, ...decided[String(r.record_key)] } : r)) };
};
export const getRecords = async (body) => withDemoDecisions(body?.page, await json('POST', 'records', body), body?.filters);
export const getListed = (body, plain = null) => getRecords(body).then((data) => ({ data, unwindowed: false }))
  .catch((e) => (plain && e.code === CODES.noWindow
    ? getRecords(plain).then((data) => { if (data?.actions) throw e; return { data, unwindowed: true }; })
    : Promise.reject(e)));
export const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
export const actRecords = async (body) => {
  const sent = { request_id: requestId(), ...body };
  try {
    return await json('POST', 'records/act', sent);
  } catch (err) {
    if (err?.status) throw err;
    return json('POST', 'records/act', sent);
  }
};
export const writeRecord = (kind, body) => (kind === 'act' ? actRecords(body) : json('POST', `records/${kind}`, body));
export const decidePlan = async (body) => {
  const got = await json('POST', 'plan/decide', body);
  if (got?.showcase === true && got.saved === false && got.row && body?.record_key != null) rememberDemo(body.page, String(body.record_key), got.row);
  return got;
};
export const evaluateScenario = (body) => json('POST', 'scenario/evaluate', body);
export const getPlans = (page) => json('GET', `plans?page=${encodeURIComponent(page)}`);
export const movePlan = (body) => json('POST', 'plans/version', body);
export const getPlanResults = (page) => json('GET', `plans/performance?page=${encodeURIComponent(page)}`);
export const getForecastReview = (page) => json('GET', `forecast/review?page=${encodeURIComponent(page)}`);
export const overrideForecast = (body) => json('POST', 'forecast/override', body);
export const getForecastAccuracy = (page) => json('GET', `forecast/accuracy?page=${encodeURIComponent(page)}`);
export const getSavedScenarios = (page) => json('GET', `scenario/saved?page=${encodeURIComponent(page)}`);
export const saveScenario = (body) => json('POST', 'scenario/save', body);
export const shareScenario = (body) => json('POST', 'scenario/share', body);
export const chooseScenario = (body) => json('POST', 'scenario/choose', body);
export const undoRecords = (body) => json('POST', 'records/undo', body);
export const draftMessage = (body) => json('POST', 'records/draft', body);
export const getBatches = (page) => json('GET', `records/batches?page=${encodeURIComponent(page)}`);
export const getSimilar = (page, recordKey, by) => json('GET', `records/similar?${new URLSearchParams({ page, by: by.join(','),
  ...(Array.isArray(recordKey) ? { record_keys: JSON.stringify(recordKey.map(String)) } : { record_key: recordKey }) })}`);
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
export const saveMoneyRule = (body) => json('POST', 'money/rule', body);
export const previewMoneyRule = (body) => json('POST', 'money/preview', body);
export const getImpact = (page) => json('GET', `impact?page=${encodeURIComponent(page)}`);
export const getTrends = (page) => json('GET', `trends?page=${encodeURIComponent(page)}`);
export const getFeedback = (page) => json('GET', `feedback?page=${encodeURIComponent(page)}`);
export const sendFeedback = (body) => json('POST', 'feedback', body);
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
