const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const PM = require('../lib/permissionError');

// REQ-313, REQ-314: every access denial answers HTTP 403 with the Permission Required payload, never a 500.
const PERSON = 'person-tok';
const TABLE = 'main.s.orders';
const DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges:\nUser does not have SELECT on Table 'main.s.orders'.";
const WAREHOUSE_FAILURE = '[PARSE_SYNTAX_ERROR] Syntax error at or near \'region\'.';
const PERSON_EMAIL = 'amr@example.com';

test('a warehouse or Unity Catalog denial maps to HTTP 403 whatever status the route would have given; any other failure keeps its status (REQ-314)', () => {
  assert.equal(PM.failureStatus(new Error(DENIED)), 403);
  assert.equal(PM.failureStatus(Object.assign(new Error('no grant'), { error_code: 'PERMISSION_DENIED' })), 403);
  assert.equal(PM.failureStatus(Object.assign(new Error('rejected'), { http_status: 403 })), 403);
  assert.equal(PM.failureStatus(new Error(WAREHOUSE_FAILURE)), 500);
  assert.equal(PM.failureStatus(Object.assign(new Error('bad input'), { statusCode: 400 })), 400);
  assert.equal(PM.failureStatus(Object.assign(new Error('gone'), { statusCode: 404 })), 404);
  assert.equal(PM.accessDenied('Table not found: main.s.orders'), false, 'a missing table is not a denial');
});

test('sendFailure answers a denial message with 403 and the payload, and leaves a non-denial failure at the status it was given', () => {
  const sent = [];
  const res = { status(code) { sent.push(code); return this; }, req: { headers: { 'x-forwarded-email': PERSON_EMAIL } }, json(body) { sent.push(body); return this; } };
  PM.sendFailure(res, 500, DENIED);
  assert.equal(sent[0], 403);
  assert.ok(Array.isArray(sent[1].permissions) && sent[1].permissions.length === 1, 'the Permission Required payload is attached');
  const plain = [];
  const res2 = { status(code) { plain.push(code); return this; }, req: {}, json(body) { plain.push(body); return this; } };
  PM.sendFailure(res2, 500, WAREHOUSE_FAILURE);
  assert.equal(plain[0], 500);
  assert.equal(plain[1].permissions, undefined);
});

test('group-counts on a table the person cannot read answers 403 with the Permission Required payload, never 500 (REQ-314)', async () => {
  const made = makeApp({ forwardedToken: PERSON, forwardedEmail: PERSON_EMAIL, sqlErrors: { 'orders': DENIED } });
  const srv = await listen(made.app);
  let resp;
  let body;
  try {
    resp = await fetch(`${srv.url}/api/inspire/implement/group-counts?warehouse_id=wh1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: TABLE, columns: ['region'], filters: [], window: {} }),
    });
    body = await resp.json();
  } finally {
    await srv.close();
  }
  assert.equal(resp.status, 403, JSON.stringify(body));
  assert.ok(Array.isArray(body.permissions) && body.permissions.length > 0, 'the payload is present');
  const statements = body.permissions.flatMap((p) => p.statements || []);
  assert.ok(statements.some((s) => /GRANT SELECT ON TABLE `main`\.`s`\.`orders`/.test(s)), statements.join('\n'));
});

test('a non-denial warehouse failure on group-counts is still a server failure, with no payload invented (must-exclude)', async () => {
  const made = makeApp({ forwardedToken: PERSON, forwardedEmail: PERSON_EMAIL, sqlErrors: { 'orders': WAREHOUSE_FAILURE } });
  const srv = await listen(made.app);
  let resp;
  let body;
  try {
    resp = await fetch(`${srv.url}/api/inspire/implement/group-counts?warehouse_id=wh1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: TABLE, columns: ['region'], filters: [], window: {} }),
    });
    body = await resp.json();
  } finally {
    await srv.close();
  }
  assert.notEqual(resp.status, 403, 'a failure that is not a refusal is not answered as one');
  assert.equal(body.permissions, undefined);
});

// One row per route family that reads a table the person picked. The denial names the table, so every row must answer 403 with the payload.
const FAMILIES = [
  ['Build: picked table columns', 'GET', `/api/inspire/implement/columns?table=${encodeURIComponent(TABLE)}&warehouse_id=wh1`, null],
  ['Build: column values', 'GET', `/api/inspire/implement/values?table=${encodeURIComponent(TABLE)}&column=region&warehouse_id=wh1`, null],
  ['Build: table lookup', 'GET', `/api/inspire/implement/table-lookup?table=${encodeURIComponent(TABLE)}&warehouse_id=wh1`, null],
  ['Build: readiness', 'POST', '/api/inspire/implement/readiness?warehouse_id=wh1', { table: TABLE, columns: ['region'], filters: [], window: {} }],
  ['Data groups: profile', 'POST', '/api/grouping/profile?warehouse_id=wh1', { session_id: '1001', use_case_id: 'N01-U01', inspire_database: 'main.inspire', table: TABLE, columns: ['region'] }],
  ['Money: value preview', 'POST', '/api/money/value-preview?warehouse_id=wh1', { session_id: '1001', use_case_id: 'N01-U01', inspire_database: 'main.inspire', table: TABLE, value: { method: 'column', column: 'region', currency: 'USD' } }],
];

for (const [family, method, url, body] of FAMILIES) {
  test(`${family}: a denied read answers 403 with the Permission Required payload, never 500 (REQ-313, REQ-314)`, async () => {
    const made = makeApp({ forwardedToken: PERSON, forwardedEmail: PERSON_EMAIL, sqlErrors: { 'orders': DENIED } });
    const srv = await listen(made.app);
    let resp;
    let answer;
    try {
      resp = await fetch(`${srv.url}${url}`, {
        method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      answer = await resp.json().catch(() => ({}));
    } finally {
      await srv.close();
    }
    assert.equal(resp.status, 403, `${family}: ${JSON.stringify(answer)}`);
    assert.ok(Array.isArray(answer.permissions) && answer.permissions.length > 0, `${family}: no payload`);
  });
}

// (c) The mapper names the privilege the warehouse refused, not the read set. Each rule has a must-exclude beside it.
const { permissionFor } = PM;
const WHO = 'amr@example.com';

test('CREATE SCHEMA on a catalog maps to GRANT CREATE SCHEMA on the catalog, not USE CATALOG (REQ-313)', () => {
  const p = permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have CREATE SCHEMA on Catalog 'main'.", WHO);
  assert.deepEqual(p.statements, [`GRANT CREATE SCHEMA ON CATALOG \`main\` TO \`${WHO}\``]);
  assert.ok(!p.statements.some((s) => s.includes('USE CATALOG')), 'the read set is not asked for');
});

test('CREATE TABLE on a schema and MODIFY on a table each map to their own GRANT (REQ-313)', () => {
  const create = permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have CREATE TABLE on Schema 'main.inspire'.", WHO);
  assert.deepEqual(create.statements, [`GRANT CREATE TABLE ON SCHEMA \`main\`.\`inspire\` TO \`${WHO}\``]);
  const modify = permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have MODIFY on Table 'main.inspire.churn_out'.", WHO);
  assert.deepEqual(modify.statements, [], 'SEC-01: a MODIFY denial never offers GRANT MODIFY');
  assert.match(modify.instructions[0], /writes only to its own schema.*main\.inspire\.churn_out/);
});

test('a warehouse Can Use refusal carries steps to copy, names the warehouse, and writes no GRANT (REQ-313)', () => {
  const p = permissionFor('no CAN_USE on warehouse wh1', WHO);
  assert.deepEqual(p.statements, []);
  assert.equal(p.steps.length, 1);
  assert.match(p.steps[0], /SQL Warehouses, open wh1 > Permissions, add amr@example\.com with Can Use/);
  assert.match(p.why, /warehouse wh1/);
});

test('must-exclude: a Can Use refusal that names no warehouse, and a write privilege on no object, map to nothing', () => {
  assert.equal(permissionFor('User does not have CAN USE on the App.', WHO), null, 'no warehouse named');
  assert.equal(permissionFor('[INSUFFICIENT_PERMISSIONS] User does not have CREATE SCHEMA.', WHO), null, 'no object named');
  assert.equal(PM.deniedObjectOf('no CAN_USE on warehouse wh1'), null, 'a warehouse is not a SQL securable');
});

test('must-exclude: a read privilege still maps to the read set, unchanged', () => {
  const p = permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on Schema 'main.s'.", WHO);
  assert.ok(p.statements.includes(`GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${WHO}\``));
  assert.ok(p.statements.includes(`GRANT USE CATALOG ON CATALOG \`main\` TO \`${WHO}\``));
});

// (a) An App-identity or tag read that is refused is the Permission Required payload, not a note under the page (REQ-313).
test('an optional tag read refused by Unity Catalog falls back to the name rule with its note, and answers 200 (D-OPTREAD)', async () => {
  const made = makeApp({ forwardedToken: PERSON, forwardedEmail: PERSON_EMAIL, tagsError: DENIED });
  const srv = await listen(made.app);
  let resp;
  let body;
  try {
    resp = await fetch(`${srv.url}/api/inspire/implement/columns?table=${encodeURIComponent(TABLE)}&warehouse_id=wh1`);
    body = await resp.json();
  } finally {
    await srv.close();
  }
  assert.equal(resp.status, 200, JSON.stringify(body));
  assert.equal(body.tags_read, false, 'the name rule is used and the page says so');
  assert.equal(body.permissions, undefined, 'an optional read never raises the dialog');
});

test('must-exclude: a tag read that fails for a reason that is not a refusal still answers with the tags note (must-exclude)', async () => {
  const made = makeApp({ forwardedToken: PERSON, forwardedEmail: PERSON_EMAIL, tagsError: WAREHOUSE_FAILURE });
  const srv = await listen(made.app);
  let resp;
  let body;
  try {
    resp = await fetch(`${srv.url}/api/inspire/implement/columns?table=${encodeURIComponent(TABLE)}&warehouse_id=wh1`);
    body = await resp.json();
  } finally {
    await srv.close();
  }
  assert.equal(resp.status, 200, JSON.stringify(body));
  assert.equal(body.tags_read, false);
  assert.equal(body.permissions, undefined);
});
