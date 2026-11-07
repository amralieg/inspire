const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/requestPerson');

const PERSON = ['pat.lee', 'example.com'].join('@');
const SP = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai', applicationId: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d' };

function reader(byToken) {
  const asked = [];
  const read = async (token) => {
    asked.push(token);
    const [status, data] = byToken[token] || [401, { detail: 'Invalid access token' }];
    return { ok: status >= 200 && status < 300, status, data };
  };
  return { read, asked };
}

const req = (headers = {}, dbToken = 'sp-token', dbTokenKind = P.APP_TOKEN) => ({ headers, dbToken, dbTokenKind });

test('the forwarded headers name the person first, by email, then preferred user name, then user id, with no SCIM call', async () => {
  const { read, asked } = reader({});
  const cases = [
    [{ 'x-forwarded-email': ` ${PERSON} `, 'x-forwarded-preferred-username': 'Pat', 'x-forwarded-user': 'u1' }, { username: PERSON, display_name: 'Pat', source: 'forwarded_headers' }],
    [{ 'x-forwarded-preferred-username': PERSON, 'x-forwarded-user': 'u1' }, { username: PERSON, display_name: PERSON, source: 'forwarded_headers' }],
    [{ 'x-forwarded-user': 'u1' }, { username: 'u1', display_name: 'u1', source: 'forwarded_headers' }],
    [{ 'x-forwarded-email': [PERSON, 'other'] }, { username: PERSON, display_name: PERSON, source: 'forwarded_headers' }],
  ];
  for (const [headers, want] of cases) assert.deepEqual(await P.requestPerson(req(headers), read), want, JSON.stringify(headers));
  assert.deepEqual(asked, []);
});

test('with no forwarded headers the forwarded token names the person through SCIM, with or without the Bearer word', async () => {
  for (const sent of ['person-token', 'Bearer person-token', 'bearer  person-token']) {
    const { read, asked } = reader({ 'person-token': [200, { userName: PERSON, displayName: 'Pat Lee' }], 'sp-token': [200, SP] });
    assert.deepEqual(await P.requestPerson(req({ 'x-forwarded-access-token': sent }), read), { username: PERSON, display_name: 'Pat Lee', source: 'forwarded_token' });
    assert.deepEqual(asked, ['person-token']);
  }
});

test('the App\u2019s own token never names a person: the service principal is reported as such, with no user name', async () => {
  const { read } = reader({ 'sp-token': [200, SP] });
  assert.deepEqual(await P.requestPerson(req(), read), { username: '', display_name: '', source: 'service_principal', service_principal: SP.displayName });
  const failing = reader({ 'person-token': [403, { message: 'scope iam.current-user:read is missing' }], 'sp-token': [200, SP] });
  assert.deepEqual(await P.requestPerson(req({ 'x-forwarded-access-token': 'person-token' }), failing.read),
    { username: '', display_name: '', source: 'service_principal', service_principal: SP.displayName });
  assert.deepEqual(failing.asked, ['person-token', 'sp-token']);
  const unknown = reader({});
  assert.deepEqual(await P.requestPerson(req(), unknown.read),
    { username: '', display_name: '', source: 'service_principal', service_principal: '', error: { status: 401, message: 'Invalid access token' } });
});

test('a personal token keeps today\u2019s behavior and says it came from the request token; a service principal behind it is still not a person', async () => {
  const { read } = reader({ pat: [200, { emails: [{ value: PERSON }] }] });
  assert.deepEqual(await P.requestPerson(req({}, 'pat', P.PERSON_TOKEN), read), { username: PERSON, display_name: PERSON, source: 'request_token' });
  assert.deepEqual(await P.requestPerson({ headers: {}, dbToken: 'pat' }, read), { username: PERSON, display_name: PERSON, source: 'request_token' },
    'a token no middleware marked is not the App\u2019s own');
  const sp = reader({ 'sp-oauth': [200, SP] });
  assert.equal((await P.requestPerson(req({}, 'sp-oauth', P.PERSON_TOKEN), sp.read)).source, 'service_principal');
  const bad = reader({});
  assert.deepEqual(await P.requestPerson(req({}, 'pat', P.PERSON_TOKEN), bad.read),
    { username: '', display_name: '', source: 'request_token', error: { status: 401, message: 'Invalid access token' } });
  assert.deepEqual(await P.requestPerson(req({}, '', P.PERSON_TOKEN), bad.read), { username: '', display_name: '', source: 'service_principal', service_principal: '' });
});

test('the person\u2019s token for SQL is the forwarded token, else the request token only when it is not the App\u2019s own', () => {
  assert.equal(P.personTokenOf(req({ 'x-forwarded-access-token': 'Bearer person-token' })), 'person-token');
  assert.equal(P.personTokenOf(req()), '');
  assert.equal(P.personTokenOf(req({}, 'pat', P.PERSON_TOKEN)), 'pat');
  assert.equal(P.forwardedTokenOf(req({}, 'pat', P.PERSON_TOKEN)), '');
});

test('the forwarded token is read by one helper: the Apps header only, its first value, trimmed and without Bearer', () => {
  const cases = [
    [{ 'x-forwarded-access-token': 'Bearer person-token' }, 'person-token'], [{ 'x-forwarded-access-token': '  bearer   person-token  ' }, 'person-token'],
    [{ 'x-forwarded-access-token': 'person-token' }, 'person-token'], [{ 'x-forwarded-access-token': ['Bearer first', 'second'] }, 'first'],
    [{ 'x-forwarded-access-token': 'Bearer ' }, ''], [{ 'x-forwarded-access-token': '' }, ''], [{}, ''],
    [{ authorization: 'Bearer pat', 'x-db-pat-token': 'pat' }, ''],
  ];
  for (const [headers, want] of cases) assert.equal(P.forwardedTokenOf(req(headers, 'pat', P.PERSON_TOKEN)), want, JSON.stringify(headers));
  assert.equal(P.forwardedTokenOf(null), '');
  assert.equal(P.forwardedTokenOf({}), '');
});

test('no backend source reads the forwarded token header except the one helper', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const reads = /(?:headers\s*\[|\.get\(|\bheader\(|headerText\([^,()]*,)\s*['"`]x-forwarded-access-token/gi;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'dist', 'build'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(c?js|mjs)$/.test(entry.name)) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(reads)) found.push(`${path.relative(root, full)}: ${match[0]}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(found, [`${path.join('lib', 'requestPerson.js')}: headerText(req, 'x-forwarded-access-token`]);
  for (const sample of ["req.headers['x-forwarded-access-token']", 'headers["X-Forwarded-Access-Token"]', "req.get('x-forwarded-access-token')",
    "req.header('x-forwarded-access-token')"]) assert.match(sample, new RegExp(reads.source, 'i'), `the sweep sees ${sample}`);
  assert.doesNotMatch("const NAMES = ['x-forwarded-access-token', 'x-forwarded-email'];", new RegExp(reads.source, 'i'), 'a list of names to forward is no read');
});

test('the problem text says why there is no person, and /api/me says where the person came from', () => {
  assert.equal(P.personProblem({ username: PERSON }), '');
  assert.equal(P.personProblem({ username: '', source: 'service_principal' }), P.ONLY_SERVICE_PRINCIPAL);
  assert.equal(P.personProblem({ username: '', error: { status: 401, message: 'Invalid access token' } }), 'your sign-in could not be read: Invalid access token');
  assert.deepEqual(P.meResponse({ username: PERSON, display_name: 'Pat Lee', source: 'forwarded_token' }), { username: PERSON, displayName: 'Pat Lee', source: 'forwarded_token' });
  assert.deepEqual(P.meResponse({ username: '', display_name: '', source: 'service_principal', service_principal: 'sp' }),
    { username: '', displayName: '', source: 'service_principal', service_principal: 'sp', why: P.ONLY_SERVICE_PRINCIPAL });
});
