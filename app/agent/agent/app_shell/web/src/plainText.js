const STATEMENT = /\b(?:GRANT|REVOKE)\s+[A-Z_, ]+\s+ON\s+[A-Z_ ]*?[`\w.-]+(?:\.[`\w-]+)*\s+(?:TO|FROM)\s+(?:`[^`]*`|[\w.@-]+)/g;
const API_PATH = /\s*\(?(?:not mocked\s+)?(?:(?:GET|POST|PUT|PATCH|DELETE)\s+)?\/api\/[\w./?=&%-]*[\w/=]\)?/g;
const ERROR_CODE = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?\]|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?:(?=\s)/g;
const HTTP_STATUS = /\s*\banswered HTTP \d{3}:?(?=\s)/g;
const BARE_CODE = /(^|:\s+)([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?)\s*$/;
const SQLSTATE = /\s*\(?\bSQLSTATE:\s*\w+\)?/g;
const MACHINE_PATH = /\s*\([^()]*(?:https?:\/\/|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/)[^()]*\)|(?:\s+(?:at|from)(?=\s))?\s*\b(?:https?:\/\/[^\s)]+|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/[^\s)]*)/g;
const MACHINE_ID = /\s*\((?:[^()]*\s)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)|\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\s*(?<![\w.-])\d{10,}(?![\w-])|\s*(?<![\w.-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16}(?![\w-])/gi;
const GRANTEE = /\b(?:TO|FROM)\s+`?([^`\s]+)`?$/;
const ASK_TO_RUN = /\b(?:please\s+)?ask\s+(?:the\s+)?owner(?:\s+of\s+[`\w.-]+)?\s+to\s+run:?\s*/i;

export const DETAILS_LABEL = 'Details';
export const CODE_ONLY_TEXT = 'Only an error code came back, listed under Details';
export const ASK_OWNER_TEXT = 'Ask the owner to give you the access listed under Details';
export const ASK_OWNER_APP_TEXT = 'Ask the owner to give the App the access listed under Details';
export const RETRY_LABEL = 'Try again';
export const RETRYING_LABEL = 'Trying again…';
export const COPY_SEND_LABEL = 'Copy what to send';
export const COPIED_SEND_TEXT = 'Copied. Paste it to whoever looks after this App.';
export const sendText = (plain, details) => [plain, ...details].filter(Boolean).join('\n');

const OBJECT_ON = /\bon\s+(catalog|schema|table|view|volume|function|warehouse)\s+[`'"]?([\w-]+(?:[`'"]?\.[`'"]?[\w-]+)*)/i;
const OBJECT_NAMED = /\bthe\s+(table|view|table or view|schema|catalog)\s+[`'"]?([\w-]+(?:[`'"]?\.[`'"]?[\w-]+)*)[`'"]?\s+(?:cannot be found|does not exist|was not found)/i;

function objectOf(text, pattern) {
  const m = pattern.exec(text);
  if (!m) return '';
  const kind = m[1].toLowerCase() === 'table or view' ? 'table' : m[1].toLowerCase();
  return `${kind} ${m[2].replace(/[`'"]/g, '')}`;
}

function statedReason(raw) {
  const said = raw.replace(/^\s*(?:\[[A-Z][A-Z0-9_]*\]\s*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+:\s*|Insufficient privileges:\s*)+/, '').split(/(?<=[.!?])\s/)[0].replace(/[.!?\s]+$/, '').trim();
  if (!said || said.length > 140 || /[A-Z][A-Z0-9]*_[A-Z0-9_]+|[{}[\]/\\]|SQLSTATE|\bHTTP\b/.test(said) || new RegExp(MACHINE_ID.source, 'i').test(said)) return '';
  return said;
}

export const FAILURE_CAUSES = [
  { kind: 'network', transient: true, test: /^(?:TypeError:\s*)?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed|network error)$|\b(?:fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up)\b/i,
    text: () => 'Inspire lost its connection to Databricks, so try again in a minute and ask a workspace admin if it keeps happening' },
  { kind: 'signed_out', test: /\bInvalid access token\b|\b(?:access )?token (?:has |is )?expired\b|\bexpired (?:access )?token\b|\bCredential was not sent\b|\bUNAUTHENTICATED\b|\(HTTP 401\)|\bNo authentication token available\b/i,
    text: () => 'your Databricks sign-in has expired, so reload the page to sign in again' },
  { kind: 'app_limit', test: /\bmaximum number of apps\b|\bapps? (?:quota|limit) (?:is |has been )?(?:reached|exceeded)\b|\breached the (?:maximum|limit) (?:number )?of apps\b/i,
    text: () => 'this workspace has reached its limit of Apps, so delete an App you no longer use or ask a workspace admin to raise the limit' },
  { kind: 'quota', test: /\bRESOURCE_EXHAUSTED\b|\bQUOTA_EXCEEDED\b|\bquota (?:is |has been )?(?:exceeded|reached)\b|\b(?:exceeded|reached) (?:the |its |your )?(?:\w+ )?quota\b/i,
    text: () => 'this workspace has reached one of its Databricks limits, so remove what you no longer use or ask a workspace admin to raise the limit' },
  { kind: 'busy', transient: true, test: /\bREQUEST_LIMIT_EXCEEDED\b|\bTOO_MANY_REQUESTS\b|\bTEMPORARILY_UNAVAILABLE\b|\brate limit\b|\bToo Many Requests\b|\(HTTP 429\)|\(HTTP 503\)/i,
    text: () => 'Databricks is busy right now, so wait a minute and try again' },
  { kind: 'warehouse_gone', test: /\b(?:SQL )?warehouse\b[^.]*?\b(?:does not exist|not found|was deleted|has been deleted)\b/i,
    text: () => 'the SQL warehouse Inspire uses no longer exists, so ask whoever installed Inspire to pick another warehouse' },
  { kind: 'warehouse_stopped', test: /\b(?:SQL )?warehouse\b[^.]*?\b(?:is not running|is stopped|is stopping|has stopped|was stopped)\b/i,
    text: () => 'the SQL warehouse is stopped, so start it on the SQL Warehouses page or ask its owner to, then try again' },
  { kind: 'not_found', test: /\b(?:TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND|CATALOG_NOT_FOUND|NO_SUCH_CATALOG_EXCEPTION)\b/,
    text: (raw) => `${objectOf(raw, OBJECT_NAMED) || 'a table it needs'} does not exist, so check that it was not renamed or dropped, or pick another one` },
  { kind: 'denied', test: /\bPERMISSION_DENIED\b|\bINSUFFICIENT_PERMISSIONS\b|\bInsufficient privileges\b|\bUser does not have\b|\(HTTP 403\)/i,
    text: (raw) => {
      const object = objectOf(raw, OBJECT_ON);
      if (object) return `access to ${object} was refused, so ask its owner or a workspace admin to give you access`;
      const reason = statedReason(raw);
      return `${reason || 'access to what it needs was refused'}, so ask its owner or a workspace admin to give you access`;
    } },
  { kind: 'server', transient: true, test: /\bINTERNAL_ERROR\b|\bInternal (?:server )?error\b|\(HTTP 50[0-4]\)|\bBad Gateway\b|\bService Unavailable\b/i,
    text: () => 'Databricks had a problem on its side, so try again in a minute' },
];

const forPerson = (statements) => statements.length > 0 && statements.every((s) => (GRANTEE.exec(s)?.[1] || '').includes('@'));

function jsonObjects(text) {
  const found = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '\\') i += 1;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) {
        found.push([start, i + 1]);
        start = i;
        break;
      }
    }
  }
  return found;
}

function errorTextOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const message = [value.message, value.error, value.error_message, value.detail].find((m) => typeof m === 'string' && m.trim());
  if (!message) return '';
  const code = String(value.error_code || '').trim();
  const inner = unwrapJson(message.trim());
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(code) && !inner.includes(code) ? `${code}: ${inner}` : inner;
}

function unwrapJson(text) {
  let out = '';
  let at = 0;
  for (const [start, end] of jsonObjects(text)) {
    let parsed = null;
    try {
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      parsed = null;
    }
    const message = errorTextOf(parsed);
    if (!message) continue;
    out += text.slice(at, start) + message;
    at = end;
  }
  return out + text.slice(at);
}

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function causeIn(raw) {
  const granted = Boolean(raw.match(STATEMENT)) || ASK_TO_RUN.test(raw);
  return FAILURE_CAUSES.find((c) => c.test.test(raw) && !(granted && c.kind === 'denied')) || null;
}

export function failureCauseOf(text) {
  return causeIn(unwrapJson(String(text ?? '')));
}

function plainCause(raw) {
  const cause = causeIn(raw);
  if (!cause) return null;
  const at = raw.search(cause.test);
  const colon = raw.indexOf(': ');
  const head = colon > 0 && colon < at ? raw.slice(0, colon).trim() : '';
  const prefix = head && head.length <= 160 && !FAILURE_CAUSES.some((c) => c.test.test(head)) && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+|[{}[\]]|\(\d{3}\)|\b(?:SQL|HTTP|API|REST)\b/.test(head) ? head : '';
  const rest = (prefix ? raw.slice(colon + 2) : raw).trim();
  const clause = cause.text(rest);
  return { plain: prefix ? `${prefix}: ${clause}.` : `${capital(clause)}.`, details: [rest], kind: cause.kind };
}

export function splitTechnical(text) {
  const raw = unwrapJson(String(text ?? ''));
  const caused = plainCause(raw);
  if (caused) return { plain: caused.plain, details: caused.details };
  const details = [];
  const keep = (m) => { details.push(m.trim().replace(/^\(|\)$/g, '').replace(/^(?:not mocked|at|from)\s+(?=\/|https?:)/, '').replace(/^\[|\]?:?$/g, '')); return ''; };
  const bare = raw.match(BARE_CODE);
  if (bare) return { plain: `${raw.slice(0, bare.index)}${bare[1]}${bare[1] ? CODE_ONLY_TEXT.charAt(0).toLowerCase() + CODE_ONLY_TEXT.slice(1) : CODE_ONLY_TEXT}`, details: [bare[2]] };
  let plain = raw.replace(STATEMENT, keep);
  const asked = forPerson(details) ? ASK_OWNER_TEXT : ASK_OWNER_APP_TEXT;
  plain = plain.replace(API_PATH, keep).replace(MACHINE_PATH, keep).replace(ERROR_CODE, keep).replace(SQLSTATE, keep).replace(HTTP_STATUS, keep).replace(MACHINE_ID, keep);
  if (!details.length) return { plain: raw, details };
  plain = plain.replace(ASK_TO_RUN, (m) => `${m[0] === 'A' ? 'A' : 'a'}${asked.slice(1)} `)
    .replace(/\(\s*\)/g, '')
    .replace(/(?:\s*[;,])+(\s*(?:[;,]|$))/g, '$1')
    .replace(/(Details)\s*([;,])\s*/g, '$1$2 ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[;,]\s*\./g, '.')
    .replace(/:\s*:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s;,:]+$/, '')
    .trim();
  return { plain, details };
}
