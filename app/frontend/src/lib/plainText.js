const STATEMENT = /\b(?:GRANT|REVOKE)\s+[A-Z_, ]+\s+ON\s+[A-Z_ ]*?[`\w.-]+(?:\.[`\w-]+)*\s+(?:TO|FROM)\s+(?:`[^`]*`|[\w.@-]+)/g;
const API_PATH = /\s*\(?(?:not mocked\s+)?\/api\/[\w./?=&%-]*[\w/=]\)?/g;
const ERROR_CODE = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?\]|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\.[A-Z0-9_]+)?:(?=\s)/g;
const SQLSTATE = /\s*\(?\bSQLSTATE:\s*\w+\)?/g;
const JSON_ERROR = /\{\s*"(?:error|message)"\s*:\s*("(?:[^"\\]|\\.)*")[^{}]*\}/g;
const ASK_TO_RUN = /\b(?:please\s+)?ask\s+(?:the\s+)?owner(?:\s+of\s+[`\w.-]+)?\s+to\s+run:?\s*/i;

export const DETAILS_LABEL = 'Details';
export const ASK_OWNER_TEXT = 'Ask the owner to give you the access listed under Details';

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
  const keep = (m) => { details.push(m.trim().replace(/^\(|\)$/g, '').replace(/^not mocked\s+/, '').replace(/^\[|\]?:?$/g, '')); return ''; };
  let plain = raw.replace(STATEMENT, keep).replace(API_PATH, keep).replace(ERROR_CODE, keep).replace(SQLSTATE, keep);
  if (!details.length) return { plain: raw, details };
  plain = plain.replace(ASK_TO_RUN, (m) => `${m[0] === 'A' ? 'A' : 'a'}${ASK_OWNER_TEXT.slice(1)} `)
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
