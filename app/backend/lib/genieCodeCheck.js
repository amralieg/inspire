const crypto = require('crypto');

const UNITY_GATEWAY_CODEX_PATH = '/ai-gateway/codex/v1';
const UNITY_GATEWAY_ANTHROPIC_PATH = '/ai-gateway/anthropic/v1';
const UNITY_GATEWAY_MLFLOW_PATH = '/ai-gateway/mlflow/v1';
const GENIE_CODE_MODEL = 'gpt-5.6-sol';
const GENIE_CODE_MODEL_CHECK = { input: 'Reply with the single word OK.', max_output_tokens: 16, stream: false };
const GENIE_CODE_NO_MODEL = 'Genie Code is not available in this workspace: Unity Gateway serves it no AI model this run can call, so the '
  + 'build stopped before Genie started and did not retry. Tried {tried}. {choices}';
const GENIE_CODE_ADMIN_FIX = 'ask a workspace admin to serve a model to Genie Code through Unity Gateway (a model on its Codex route, or a '
  + "Claude model on its Anthropic route) and give this run's identity permission to query it";
const GENIE_CODE_NO_MODEL_CHOICES = `To build now, choose I will build it myself and run the notebook yourself. To let Inspire build it, ${GENIE_CODE_ADMIN_FIX}, then Rebuild.`;
const GENIE_CODE_MODEL_MISSING = 'Unity Gateway has no such model or endpoint here';
const GENIE_CODE_MODEL_DENIED = "this run's identity may not query it";
const GENIE_CODE_UNFIT_MODEL_PATTERN = 'gpt[-_.]?oss';
const GENIE_CODE_GATEWAYS = [
  { route: 'Codex route', models: `${UNITY_GATEWAY_CODEX_PATH}/models`, base: UNITY_GATEWAY_CODEX_PATH, first: true },
  { route: 'Anthropic route', models: `${UNITY_GATEWAY_ANTHROPIC_PATH}/models`, base: UNITY_GATEWAY_MLFLOW_PATH, first: false },
];
const GENIE_CODE_PROBES_PER_ROUTE = 3;
const GENIE_CODE_CALL_TIMEOUT_MS = 10000;
const GENIE_CODE_CHECK_DEADLINE_MS = 15000;
const GENIE_CODE_CACHE_MS = 10 * 60 * 1000;
const GENIE_CODE_UNCHECKED = 'Inspire could not finish its Genie Code check just now, so it does not block the build; '
  + 'if Genie Code turns out to be unavailable, the build stops before Genie starts and says why';

function listedModels(data) {
  const rows = [...((data && data.models) || []), ...((data && data.data) || [])];
  return [...new Set(rows.map((row) => String((row && (row.slug || row.id)) || '').trim()).filter(Boolean))];
}

function versionOf(name) {
  return (String(name).match(/\d+(?:[.-]\d+)*/g) || []).map((part) => part.split(/[.-]/).map(Number));
}

function newerFirst(a, b) {
  const [x, y] = [versionOf(a).flat(), versionOf(b).flat()];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (y[i] ?? -1) - (x[i] ?? -1);
  }
  return a.localeCompare(b);
}

function candidates(gateway, all) {
  const listed = all.filter((name) => !new RegExp(GENIE_CODE_UNFIT_MODEL_PATTERN, 'i').test(name));
  if (gateway.first) return [GENIE_CODE_MODEL, ...listed.filter((name) => !name.toLowerCase().endsWith(GENIE_CODE_MODEL))];
  const claude = listed.filter((name) => /claude-(?:sonnet|opus)/i.test(name)).sort(newerFirst);
  return [...claude, ...listed.filter((name) => !claude.includes(name))];
}

function refusalOf(got) {
  const text = JSON.stringify(got.data || {});
  if (got.status === 401 || got.status === 403 || /PERMISSION_DENIED/.test(text)) return { why: GENIE_CODE_MODEL_DENIED, transient: false };
  if (got.status === 404 || /RESOURCE_DOES_NOT_EXIST|ENDPOINT_NOT_FOUND|NOT_FOUND/.test(text)) return { why: GENIE_CODE_MODEL_MISSING, transient: false };
  const message = String((got.data && (got.data.message || got.data.error)) || `HTTP ${got.status}`).replace(/\s+/g, ' ').slice(0, 200);
  return { why: message, transient: got.status === 429 || got.status >= 500 };
}

function said(route, model) {
  return `${model} through the ${route}`;
}

function verdictOf(found) {
  if (found.route) return { available: true, route: found.route, model: found.model, reason: '', fix: '' };
  if (found.waiting.length) return { available: null, route: '', model: '', reason: GENIE_CODE_UNCHECKED, fix: '' };
  const empty = Object.entries(found.listed).filter(([, count]) => !count).map(([name]) => name);
  const tried = `${found.refused.length} model${found.refused.length === 1 ? '' : 's'}: `
    + found.refused.map(({ route, model, why }) => `${said(route, model)}: ${why}`).join('; ')
    + (empty.length ? `; the ${empty.join(' and the ')} ${empty.length === 1 ? 'lists' : 'list'} no model` : '');
  return {
    available: false,
    route: '',
    model: '',
    reason: GENIE_CODE_NO_MODEL.replace('{tried}', tried).replace('{choices}', GENIE_CODE_NO_MODEL_CHOICES),
    fix: `${GENIE_CODE_ADMIN_FIX[0].toUpperCase()}${GENIE_CODE_ADMIN_FIX.slice(1)}.`,
  };
}

function needsGenieCode(spec) {
  const s = spec || {};
  return !s.uninstall && !Object.keys(s.rollback_outputs || {}).length;
}

function genieCodeLine(verdict) {
  const v = verdict || {};
  if (v.available === true) return { ok: true, detail: `Genie Code builds with ${said(v.route, v.model)}` };
  if (v.available === false) return { ok: false, detail: v.reason, fix: v.fix };
  return { ok: true, detail: v.reason || GENIE_CODE_UNCHECKED, unchecked: true };
}

async function discoverGenieCodeRoute(call, { deadline = Infinity, now = () => Date.now() } = {}) {
  const found = { route: '', model: '', refused: [], waiting: [], listed: {} };
  for (const gateway of GENIE_CODE_GATEWAYS) {
    if (now() >= deadline) {
      found.waiting.push({ route: gateway.route, model: '', why: 'the check ran out of time' });
      break;
    }
    let listed = [];
    try {
      const got = await call('GET', gateway.models);
      listed = got.ok ? listedModels(got.data) : [];
    } catch {
      listed = [];
    }
    found.listed[gateway.route] = listed.length;
    for (const model of candidates(gateway, listed).slice(0, GENIE_CODE_PROBES_PER_ROUTE)) {
      if (now() >= deadline) {
        found.waiting.push({ route: gateway.route, model, why: 'the check ran out of time' });
        return found;
      }
      let got;
      try {
        got = await call('POST', `${gateway.base}/responses`, { ...GENIE_CODE_MODEL_CHECK, model });
      } catch (err) {
        found.waiting.push({ route: gateway.route, model, why: String(err && err.message ? err.message : err).slice(0, 200) });
        continue;
      }
      if (got.ok) return { ...found, route: gateway.route, model };
      const refusal = refusalOf(got);
      (refusal.transient ? found.waiting : found.refused).push({ route: gateway.route, model, why: refusal.why });
    }
  }
  return found;
}

function createGenieCodeCheck({ now = () => Date.now() } = {}) {
  const cache = new Map();
  return async function genieCodeCheck(host, token, fetchJson) {
    const key = `${host}|${crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16)}`;
    const kept = cache.get(key);
    if (kept && now() - kept.at < GENIE_CODE_CACHE_MS) return kept.verdict;
    cache.delete(key);
    const call = (method, path, body) => fetchJson(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Math.min(GENIE_CODE_CALL_TIMEOUT_MS, GENIE_CODE_CHECK_DEADLINE_MS)),
    });
    const verdict = verdictOf(await discoverGenieCodeRoute(call, { deadline: now() + GENIE_CODE_CHECK_DEADLINE_MS, now }));
    if (verdict.available === true) cache.set(key, { at: now(), verdict });
    return verdict;
  };
}

module.exports = {
  GENIE_CODE_ADMIN_FIX,
  GENIE_CODE_GATEWAYS,
  GENIE_CODE_MODEL,
  GENIE_CODE_MODEL_CHECK,
  GENIE_CODE_MODEL_DENIED,
  GENIE_CODE_MODEL_MISSING,
  GENIE_CODE_NO_MODEL,
  GENIE_CODE_NO_MODEL_CHOICES,
  GENIE_CODE_UNFIT_MODEL_PATTERN,
  GENIE_CODE_UNCHECKED,
  UNITY_GATEWAY_ANTHROPIC_PATH,
  UNITY_GATEWAY_CODEX_PATH,
  UNITY_GATEWAY_MLFLOW_PATH,
  createGenieCodeCheck,
  discoverGenieCodeRoute,
  genieCodeLine,
  listedModels,
  needsGenieCode,
  verdictOf,
};
