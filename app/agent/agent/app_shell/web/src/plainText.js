const STATEMENT = /\b(?:GRANT|REVOKE)\s+[A-Z_, ]+\s+ON\s+[A-Z_ ]*?[`\w.-]+(?:\.[`\w-]+)*\s+(?:TO|FROM)\s+(?:`[^`]*`|[\w.@-]+)/g;
const API_PATH = /\s*\(?(?:not mocked\s+)?(?:(?:GET|POST|PUT|PATCH|DELETE)\s+)?\/api\/[\w./?=&%-]*[\w/=]\)?/g;
const ERROR_CODE = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?\]|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?:(?=\s)/g;
const HTTP_STATUS = /\s*\banswered HTTP \d{3}:?(?=\s)/g;
const SQLSTATE = /\s*\(?\bSQLSTATE:\s*\w+\)?/g;
const JSON_ERROR = /\{\s*"(?:error|message)"\s*:\s*("(?:[^"\\]|\\.)*")[^{}]*\}/g;
const MACHINE_PATH = /\s*\([^()]*(?:https?:\/\/|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/)[^()]*\)|(?:\s+(?:at|from)(?=\s))?\s*\b(?:https?:\/\/[^\s)]+|(?<![\w.])\/(?:home|tmp|local_disk0|databricks|root)\/[^\s)]*)/g;
const GRANTEE = /\b(?:TO|FROM)\s+`?([^`\s]+)`?$/;
const ASK_TO_RUN = /\b(?:please\s+)?ask\s+(?:the\s+)?owner(?:\s+of\s+[`\w.-]+)?\s+to\s+run:?\s*/i;

export const DETAILS_LABEL = 'Details';
export const ASK_OWNER_TEXT = 'Ask the owner to give you the access listed under Details';
export const ASK_OWNER_APP_TEXT = 'Ask the owner to give the App the access listed under Details';

const forPerson = (statements) => statements.length > 0 && statements.every((s) => (GRANTEE.exec(s)?.[1] || '').includes('@'));

function unwrapJson(text) {
  return text.replace(JSON_ERROR, (whole, literal) => {
    try {
      return JSON.parse(literal);
    } catch {
      return whole;
    }
  });
}

export function splitTechnical(text) {
  const raw = unwrapJson(String(text ?? ''));
  const details = [];
  const keep = (m) => { details.push(m.trim().replace(/^\(|\)$/g, '').replace(/^(?:not mocked|at|from)\s+(?=\/|https?:)/, '').replace(/^\[|\]?:?$/g, '')); return ''; };
  let plain = raw.replace(STATEMENT, keep);
  const asked = forPerson(details) ? ASK_OWNER_TEXT : ASK_OWNER_APP_TEXT;
  plain = plain.replace(API_PATH, keep).replace(MACHINE_PATH, keep).replace(ERROR_CODE, keep).replace(SQLSTATE, keep).replace(HTTP_STATUS, keep);
  if (!details.length) return { plain: raw, details };
  plain = plain.replace(ASK_TO_RUN, (m) => `${m[0] === 'A' ? 'A' : 'a'}${asked.slice(1)} `)
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
