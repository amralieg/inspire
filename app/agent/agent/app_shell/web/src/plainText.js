const STATEMENT = /\b(?:GRANT|REVOKE)\s+[A-Z_, ]+\s+ON\s+[A-Z_ ]*?[`\w.-]+(?:\.[`\w-]+)*\s+(?:TO|FROM)\s+(?:`[^`]*`|[\w.@-]+)/g;
const API_PATH = /\s*\(?(?:not mocked\s+)?(?:(?:GET|POST|PUT|PATCH|DELETE)\s+)?\/api\/[\w./?=&%-]*[\w/=]\)?/g;
const ERROR_CODE = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?\]|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?:(?=\s)/g;
const HTTP_STATUS = /\s*\banswered HTTP \d{3}:?(?=\s)/g;
const BARE_CODE = /(^|:\s+)([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?)\s*$/;
const SQLSTATE = /\s*\(?\bSQLSTATE:\s*\w+\)?/g;
const MACHINE_PATH = /\s*\([^()]*(?:https?:\/\/|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/)[^()]*\)|(?:\s+(?:at|from)(?=\s))?\s*\b(?:https?:\/\/[^\s)]+|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/[^\s)]*)/g;
export const MACHINE_ID = /\s*\((?:[^()]*\s)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)|\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\s*(?<![\w.-])\d{10,}(?![\w-])|\s*(?<![\w.-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16}(?![\w-])/gi;
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

let causes = [];

export function setFailureCauses(list) {
  causes = list;
}

export const failureCausesLoaded = () => causes.length > 0;

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
  return causes.find((c) => c.test.test(raw) && !(granted && c.kind === 'denied')) || null;
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
  const prefix = head && head.length <= 160 && !causes.some((c) => c.test.test(head)) && !/[A-Z][A-Z0-9]*_[A-Z0-9_]+|[{}[\]]|\(\d{3}\)|\b(?:SQL|HTTP|API|REST)\b/.test(head) ? head : '';
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
