// REQ-311: Request for Access sends each grant as the person it is for, only where a destination is set, and says plainly when it cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const AR = require('../lib/accessRequest');

const WHO = 'signed-in@example.com';
const APP_ID = '11111111-2222-3333-4444-555555555555';
const APP_SCIM = 'sp-scim-id-1';
const GRANTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${WHO}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${WHO}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${WHO}\``,
];
const EMAIL_DEST = { destinations: [{ destination_id: 'owner@example.com', destination_type: 'EMAIL', special_destination: 'SPECIAL_DESTINATION_CATALOG_OWNER' }] };
const DESTINATIONS = {
  'GET /api/3.0/rfa/destinations/catalog/main': { ok: true, status: 200, data: EMAIL_DEST },
  'GET /api/3.0/rfa/destinations/schema/main.s': { ok: true, status: 200, data: EMAIL_DEST },
  'GET /api/3.0/rfa/destinations/table/main.s.orders': { ok: true, status: 200, data: EMAIL_DEST },
};
// The result fields the send and check tests do not assert on; the links are asserted in their own tests.
const strip = ({ links, ...rest }) => rest;
const scim = (resources) => ({ ok: true, status: 200, data: { Resources: resources } });

// A fake of the one call the module makes. Keys are "METHOD path" (path includes any query); every call is recorded.
function fakeCall(answers) {
  const calls = [];
  const call = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = answers[`${method} ${path}`];
    if (typeof hit === 'function') return hit();
    return hit || { ok: false, status: 404, data: { message: `no fake for ${path}` } };
  };
  return { call, calls };
}

test('the requestable grants are read per grantee and securable, privileges once each, and other securable types are left out', () => {
  const got = AR.requestsOf([...GRANTS, `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${WHO}\``, `GRANT CAN_USE ON WAREHOUSE \`w\` TO \`${WHO}\``]);
  // SEC-01 W3: the table SELECT asks for the table itself; it is never widened to the schema.
  assert.deepEqual(got, [
    { grantee: WHO, securable: { type: 'CATALOG', full_name: 'main' }, permissions: ['USE_CATALOG'] },
    { grantee: WHO, securable: { type: 'SCHEMA', full_name: 'main.s' }, permissions: ['USE_SCHEMA'] },
    { grantee: WHO, securable: { type: 'TABLE', full_name: 'main.s.orders' }, permissions: ['SELECT'] },
  ]);
  assert.deepEqual(AR.requestsOf([]), []);
});

test('success: destinations are read, then one request goes out as the person with no behalf_of, and the result names where it went', async () => {
  const { call, calls } = fakeCall({ ...DESTINATIONS, 'POST /api/3.0/rfa/requests': { ok: true, status: 200, data: { responses: [] } } });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(strip(got), { sent: true, destinations: ['owner@example.com'], reason: '' });
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/api/3.0/rfa/requests');
  assert.equal(post.body.requests.length, 1, 'one request object for the one principal');
  assert.equal(Object.hasOwn(post.body.requests[0], 'behalf_of'), false, 'no behalf_of: the requester is the signed-in person');
  assert.equal(post.body.requests[0].comment, AR.COMMENT);
  assert.ok(AR.COMMENT.length <= 200 && /^[A-Za-z0-9 .,'!?-]+$/.test(AR.COMMENT), 'the comment fits the API rule');
  assert.deepEqual(post.body.requests[0].securable_permissions.map((p) => p.securable.full_name), ['main', 'main.s', 'main.s.orders']);
});

test('no destination set: the check says not offered with a plain reason, and no request is sent', async () => {
  const empty = { ok: true, status: 200, data: {} };
  const { call, calls } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': empty,
    'GET /api/3.0/rfa/destinations/schema/main.s': empty,
    'GET /api/3.0/rfa/destinations/table/main.s.orders': empty,
  });
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(strip(check), { offered: false, destinations: [], reason: AR.NO_DESTINATION, pending: [] });
  const sent = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.equal(sent.sent, false);
  assert.equal(sent.reason, check.reason);
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'nothing is posted where no destination is set');
});

test('denied: the workspace refuses the request, and the refusal is the reason', async () => {
  const { call } = fakeCall({
    ...DESTINATIONS,
    'POST /api/3.0/rfa/requests': { ok: false, status: 403, data: { message: 'PERMISSION_DENIED: you cannot request this securable' } },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.deepEqual(strip(got), { sent: false, destinations: [], reason: 'PERMISSION_DENIED: you cannot request this securable' });
});

test('the API is unreachable for this App (missing scope): the check is not offered and the workspace message is kept', async () => {
  const scopeMessage = "Provided OAuth token does not have required scopes: 'unity-catalog'";
  const refused = { ok: false, status: 403, data: { message: scopeMessage } };
  const { call } = fakeCall({
    'GET /api/3.0/rfa/destinations/catalog/main': refused,
    'GET /api/3.0/rfa/destinations/schema/main.s': refused,
    'GET /api/3.0/rfa/destinations/table/main.s.orders': refused,
  });
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS });
  assert.equal(check.offered, false);
  assert.equal(check.reason, scopeMessage);
});

test('an App grant is resolved to its service principal and sent as its own request, next to the person own request', async () => {
  const appGrants = GRANTS.slice(0, 1).concat(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP_ID}\``);
  const { call, calls } = fakeCall({
    ...DESTINATIONS,
    [`GET /api/2.0/preview/scim/v2/ServicePrincipals?filter=${encodeURIComponent(`applicationId eq "${APP_ID}"`)}`]: scim([{ id: APP_SCIM }]),
    'POST /api/3.0/rfa/requests': { ok: true, status: 200, data: {} },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: appGrants });
  assert.equal(got.sent, true);
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.requests.length, 2, 'the person and the App are two principals, so two request objects');
  const forApp = post.body.requests.find((r) => r.behalf_of);
  assert.deepEqual(forApp.behalf_of, { id: APP_SCIM, principal_type: 'SERVICE_PRINCIPAL' });
  assert.deepEqual(forApp.securable_permissions.map((p) => p.securable.full_name), ['main.s.orders']);
  assert.equal(post.body.requests.find((r) => !r.behalf_of).securable_permissions[0].securable.full_name, 'main');
});

test('a grantee that no SCIM lookup finds is copy-only: nothing is sent for it and the reason says so', async () => {
  const unknown = ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `ghost-principal`'];
  const { call, calls } = fakeCall({
    ...DESTINATIONS,
    [`GET /api/2.0/preview/scim/v2/Users?filter=${encodeURIComponent('userName eq "ghost-principal"')}`]: scim([]),
    [`GET /api/2.0/preview/scim/v2/Groups?filter=${encodeURIComponent('displayName eq "ghost-principal"')}`]: scim([]),
  });
  const check = await AR.checkAccessRequest({ call, who: WHO, statements: unknown });
  assert.equal(check.offered, false);
  assert.equal(check.reason, AR.NO_PRINCIPAL);
  assert.equal(calls.some((c) => c.method === 'POST'), false);
});

test('a group grant resolves by its display name when no user has the name', async () => {
  const group = ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `analysts`'];
  const { call, calls } = fakeCall({
    ...DESTINATIONS,
    [`GET /api/2.0/preview/scim/v2/Users?filter=${encodeURIComponent('userName eq "analysts"')}`]: scim([]),
    [`GET /api/2.0/preview/scim/v2/Groups?filter=${encodeURIComponent('displayName eq "analysts"')}`]: scim([{ id: 'group-id-7' }]),
    'POST /api/3.0/rfa/requests': { ok: true, status: 200, data: {} },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: group });
  assert.equal(got.sent, true);
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.requests[0].behalf_of, { id: 'group-id-7', principal_type: 'GROUP_PRINCIPAL' });
});

test('no signed-in person: nothing is read or sent, and the reason says so', async () => {
  const { call, calls } = fakeCall({});
  const got = await AR.sendAccessRequest({ call, who: '', statements: GRANTS });
  assert.equal(got.sent, false);
  assert.match(got.reason, /cannot tell who is signed in/);
  assert.equal(calls.length, 0);
});

test('a destination with no address names the owner of the securable', () => {
  assert.equal(AR.destinationLabel({ special_destination: 'SPECIAL_DESTINATION_SCHEMA_OWNER' }, { type: 'SCHEMA', full_name: 'main.s' }), 'the owner of schema main.s');
  assert.equal(AR.destinationLabel({ destination_id: 'a@b.c' }, { type: 'TABLE', full_name: 'x' }), 'a@b.c');
});

test('REQ-315: a table with no destination of its own falls back to its schema, then its catalog, and names the level it used', async () => {
  const none = { ok: true, status: 200, data: {} };
  const { call, calls } = fakeCall({
    'GET /api/3.0/rfa/destinations/table/main.s.orders': none,
    'GET /api/3.0/rfa/destinations/schema/main.s': none,
    'GET /api/3.0/rfa/destinations/catalog/main': { ok: true, status: 200, data: EMAIL_DEST },
    'POST /api/3.0/rfa/requests': { ok: true, status: 200, data: {} },
  });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: [GRANTS[2]] });
  assert.deepEqual(strip(got), { sent: true, destinations: ['owner@example.com'], reason: '' });
  // SEC-01 W3: the table read asks for the table, so the chain starts at the table, then the schema, then the catalog.
  assert.deepEqual(calls.filter((c) => c.method === 'GET').map((c) => c.path), [
    '/api/3.0/rfa/destinations/table/main.s.orders', '/api/3.0/rfa/destinations/schema/main.s', '/api/3.0/rfa/destinations/catalog/main',
  ]);
});

// REQ-406: the check always names the Catalog Explorer page of each securable it would ask for, so the dialog can open it when the send
// is not offered or fails. Without a host there is no link to open.
test('REQ-406: a check that is not offered still returns the Catalog Explorer page of each requestable securable', async () => {
  const empty = { ok: true, status: 200, data: {} };
  const { call } = fakeCall({
    'GET /api/3.0/rfa/destinations/schema/main.s': empty,
    'GET /api/3.0/rfa/destinations/catalog/main': empty,
  });
  const got = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS, host: 'workspace.example.com/' });
  assert.equal(got.offered, false);
  assert.deepEqual(got.links, [
    { type: 'CATALOG', full_name: 'main', url: 'https://workspace.example.com/explore/data/main' },
    { type: 'SCHEMA', full_name: 'main.s', url: 'https://workspace.example.com/explore/data/main/s' },
    { type: 'TABLE', full_name: 'main.s.orders', url: 'https://workspace.example.com/explore/data/main/s/orders' },
  ]);
});

test('REQ-406: no host set means no link, so the dialog has nothing to open and shows the copy text', async () => {
  const { call } = fakeCall({});
  const got = await AR.checkAccessRequest({ call, who: WHO, statements: GRANTS, host: '' });
  assert.deepEqual(got.links, []);
});

test('REQ-406: a send the workspace refuses still returns the links, so the dialog opens the form instead of ending at a raw error', async () => {
  const { call } = fakeCall({ ...DESTINATIONS, 'POST /api/3.0/rfa/requests': { ok: false, status: 403, data: { message: 'PERMISSION_DENIED' } } });
  const got = await AR.sendAccessRequest({ call, who: WHO, statements: GRANTS, host: 'https://workspace.example.com' });
  assert.equal(got.sent, false);
  assert.equal(got.links[0].url, 'https://workspace.example.com/explore/data/main');
});

test('REQ-406: a table or volume link names its full path, and the names are encoded', () => {
  assert.equal(AR.explorerUrl('h.example.com', { type: 'TABLE', full_name: 'main.s.orders' }), 'https://h.example.com/explore/data/main/s/orders');
  // REQ-406: a volume links to its schema page, the documented Catalog Explorer pattern (no documented volume path).
  assert.equal(AR.explorerUrl('h.example.com', { type: 'VOLUME', full_name: 'main.s.v' }), 'https://h.example.com/explore/data/main/s');
  assert.equal(AR.explorerUrl('h.example.com', { type: 'SCHEMA', full_name: 'main.my schema' }), 'https://h.example.com/explore/data/main/my%20schema');
});
