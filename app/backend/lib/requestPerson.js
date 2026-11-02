const SCIM_ME_PATH = '/api/2.0/preview/scim/v2/Me';
const APP_TOKEN = 'app';
const PERSON_TOKEN = 'person';
const FROM_HEADERS = 'forwarded_headers';
const FROM_FORWARDED_TOKEN = 'forwarded_token';
const FROM_REQUEST_TOKEN = 'request_token';
const FROM_SERVICE_PRINCIPAL = 'service_principal';
const ONLY_SERVICE_PRINCIPAL = 'this request names no signed-in person, only the App\u2019s own service principal';

function headerText(req, name) {
  const raw = req && req.headers ? req.headers[name] : undefined;
  return String((Array.isArray(raw) ? raw[0] : raw) ?? '').trim();
}

function bearerText(value) {
  return String(value ?? '').trim().replace(/^bearer(?:\s+|$)/i, '').trim();
}

function forwardedTokenOf(req) {
  return bearerText(headerText(req, 'x-forwarded-access-token'));
}

function isAppToken(req) {
  return Boolean(req) && req.dbTokenKind === APP_TOKEN;
}

function personTokenOf(req) {
  const forwarded = forwardedTokenOf(req);
  if (forwarded) return forwarded;
  return isAppToken(req) ? '' : String((req && req.dbToken) || '').trim();
}

function principalOf(me) {
  const data = me && typeof me === 'object' ? me : {};
  const email = Array.isArray(data.emails) && data.emails[0] && typeof data.emails[0] === 'object' ? data.emails[0].value : '';
  const username = String(data.userName || email || '').trim();
  return {
    username,
    display_name: String(data.displayName || '').trim() || username,
    service: String(data.applicationId || '').trim() !== '',
  };
}

function forwardedPerson(req) {
  const email = headerText(req, 'x-forwarded-email');
  const preferred = headerText(req, 'x-forwarded-preferred-username');
  const user = headerText(req, 'x-forwarded-user');
  const username = email || preferred || user;
  return username ? { username, display_name: preferred || username, source: FROM_HEADERS } : null;
}

function failureText(got) {
  const data = got && got.data && typeof got.data === 'object' ? got.data : {};
  return String(data.detail || data.message || data.error || data.raw || `the workspace answered ${got ? got.status : 0} for the signed-in identity`);
}

function noPerson(service = '', error = null) {
  return { username: '', display_name: '', source: FROM_SERVICE_PRINCIPAL, service_principal: service, ...(error ? { error } : {}) };
}

async function requestPerson(req, readMe) {
  const headers = forwardedPerson(req);
  if (headers) return headers;
  const forwarded = forwardedTokenOf(req);
  const token = String((req && req.dbToken) || '').trim();
  const tries = [];
  if (forwarded) tries.push([forwarded, FROM_FORWARDED_TOKEN]);
  if (token && token !== forwarded) tries.push([token, isAppToken(req) ? FROM_SERVICE_PRINCIPAL : FROM_REQUEST_TOKEN]);
  let failed = null;
  for (const [asked, source] of tries) {
    const got = await readMe(asked);
    if (!got || !got.ok) {
      failed = { source, error: { status: got ? got.status : 0, message: failureText(got) } };
      continue;
    }
    const who = principalOf(got.data);
    if (source === FROM_SERVICE_PRINCIPAL || who.service || !who.username) return noPerson(who.display_name || who.username);
    return { username: who.username, display_name: who.display_name, source };
  }
  if (!failed) return noPerson();
  if (failed.source === FROM_SERVICE_PRINCIPAL) return noPerson('', failed.error);
  return { username: '', display_name: '', source: failed.source, error: failed.error };
}

function personProblem(person) {
  if (person && person.username) return '';
  if (person && person.error) return `your sign-in could not be read: ${person.error.message}`;
  return ONLY_SERVICE_PRINCIPAL;
}

function meResponse(person) {
  return {
    username: person.username,
    displayName: person.display_name,
    source: person.source,
    ...(person.source === FROM_SERVICE_PRINCIPAL ? { service_principal: person.service_principal || '', why: personProblem(person) } : {}),
  };
}

module.exports = {
  SCIM_ME_PATH,
  APP_TOKEN,
  PERSON_TOKEN,
  FROM_HEADERS,
  FROM_FORWARDED_TOKEN,
  FROM_REQUEST_TOKEN,
  FROM_SERVICE_PRINCIPAL,
  ONLY_SERVICE_PRINCIPAL,
  forwardedTokenOf,
  personTokenOf,
  principalOf,
  requestPerson,
  personProblem,
  meResponse,
};
