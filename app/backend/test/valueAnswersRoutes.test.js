// REQ-435: the answers table. Append-only versions per use case, the latest on read, history newest first, undo as a new version.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const SCOPE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const QS = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const ANSWERS = { drivers: { cost_cut: { spend_per_year: 500000, cut_pct: 10 } }, currency: 'AED', attribution_pct: 100 };
const SECRET = 987654321;
const ANSWERS_2 = { drivers: { cost_cut: { spend_per_year: SECRET, cut_pct: 10 } }, currency: 'AED', attribution_pct: 100 };

// A fake answers table: it records every INSERT by column and answers the reads from what was inserted.
function fakeTable(state = {}) {
  const rows = state.rows || [];
  const handler = (sql, parameters) => {
    if (state.missing) throw new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `__inspire_value_answers` cannot be found.');
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    const bound = Object.fromEntries((parameters || []).map((p) => [p.name, p.value]));
    if (sql.startsWith('INSERT')) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(',').map((c) => c.trim());
      const vals = /VALUES \((.*)\)\s*$/s.exec(sql)[1].split(', ').map((v) => v.trim());
      rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i].startsWith(':') ? bound[vals[i].slice(1)] : vals[i]])));
      return { rows: [] };
    }
    const ids = new Set(rows.map((r) => r.use_case_id));
    const asked = Object.values(bound).find((v) => ids.has(v));
    const mine = rows.filter((r) => asked === undefined || r.use_case_id === asked).map((r) => ({ ...r, version: String(r.version) }));
    if (sql.includes('ROW_NUMBER')) {
      const latest = new Map();
      for (const r of mine) if (!latest.has(r.use_case_id) || Number(r.version) > Number(latest.get(r.use_case_id).version)) latest.set(r.use_case_id, r);
      return { rows: [...latest.values()] };
    }
    if (/MAX\(version\)/.test(sql)) return { rows: [{ latest: mine.length ? String(Math.max(...mine.map((r) => Number(r.version)))) : null }] };
    const limit = Number((/LIMIT (\d+)/.exec(sql) || [])[1] || 1000);
    return { rows: mine.sort((a, b) => Number(b.version) - Number(a.version)).slice(0, limit) };
  };
  return { rows, statements: { __inspire_value_answers: handler } };
}
const appWith = (table) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], statements: table.statements });

async function call(made, method, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}
const put = (made, answers, id = 'N01-U01') => call(made, 'PUT', '/api/inspire/value/answers', { ...SCOPE, use_case_id: id, table: ORDERS, answers });

test('A5: PUT appends a row through a parameterised INSERT and numbers the versions 1, 2', async () => {
  const table = fakeTable();
  const made = appWith(table);
  const first = await put(made, ANSWERS);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.version, 1);
  assert.equal(first.data.yearly.total.amount, 50000);
  assert.ok(String(first.data.disclaimer).length > 20);
  const second = await put(made, ANSWERS_2);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.version, 2);
  assert.equal(table.rows.length, 2);
  const inserts = made.sqlCalls.filter((c) => c.sql.startsWith('INSERT') && c.sql.includes('__inspire_value_answers'));
  assert.equal(inserts.length, 2);
  for (const c of inserts) {
    assert.ok(!c.sql.includes(String(SECRET)) && !c.sql.includes('AED') && !c.sql.includes('N01-U01') && !c.sql.includes('person@example.com'), `no value in the SQL text: ${c.sql}`);
  }
  assert.ok(inserts[1].parameters.some((p) => String(p.value).includes(String(SECRET))), 'the answers travel as a bound parameter');
  assert.equal(table.rows[0].saved_by, 'person@example.com');
  assert.equal(table.rows[0].session_id, '42');
});

test('PUT refuses a bad answer and writes nothing', async () => {
  const table = fakeTable();
  const made = appWith(table);
  const got = await put(made, { drivers: { cost_cut: { spend_per_year: -1, cut_pct: 10 } }, currency: 'AED' });
  assert.equal(got.status, 400);
  assert.equal(made.sqlCalls.filter((c) => c.sql.startsWith('INSERT')).length, 0);
});

test('A6: GET answers returns the latest version of each use case', async () => {
  const table = fakeTable();
  const made = appWith(table);
  await put(made, ANSWERS);
  await put(made, ANSWERS_2);
  await put(made, ANSWERS, 'N02-U01');
  const got = await call(made, 'GET', `/api/inspire/value/answers?${QS}`);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(Object.keys(got.data.answers).sort(), ['N01-U01', 'N02-U01']);
  const one = got.data.answers['N01-U01'];
  assert.equal(one.version, 2);
  assert.equal(one.answers.drivers.cost_cut.spend_per_year, SECRET);
  assert.equal(one.yearly.total.amount, SECRET / 10);
  assert.equal(one.saved_by, 'person@example.com');
  assert.ok(one.saved_at !== undefined);
});

test('A6: a table that does not exist yet is no answers, not an error', async () => {
  const got = await call(appWith(fakeTable({ missing: true })), 'GET', `/api/inspire/value/answers?${QS}`);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data, { answers: {} });
});

test('A7: history lists the versions newest first', async () => {
  const table = fakeTable();
  const made = appWith(table);
  await put(made, ANSWERS);
  await put(made, ANSWERS_2);
  const got = await call(made, 'GET', `/api/inspire/value/answers/history?${QS}&use_case_id=N01-U01`);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.history.map((h) => h.version), [2, 1]);
  assert.equal(got.data.history[1].answers.drivers.cost_cut.spend_per_year, 500000);
});

test('A7: undo appends the previous version as a new one with the note "undo of v2"', async () => {
  const table = fakeTable();
  const made = appWith(table);
  await put(made, ANSWERS);
  await put(made, ANSWERS_2);
  const got = await call(made, 'POST', '/api/inspire/value/answers/undo', { ...SCOPE, use_case_id: 'N01-U01' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.version, 3);
  assert.equal(got.data.answers.drivers.cost_cut.spend_per_year, 500000);
  assert.equal(got.data.yearly.total.amount, 50000);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[2].note, 'undo of v2');
});

test('A7: undo with one version is a 409 and appends nothing', async () => {
  const table = fakeTable();
  const made = appWith(table);
  await put(made, ANSWERS);
  const got = await call(made, 'POST', '/api/inspire/value/answers/undo', { ...SCOPE, use_case_id: 'N01-U01' });
  assert.equal(got.status, 409, JSON.stringify(got.data));
  assert.equal(table.rows.length, 1);
});

test('A8: openapi lists the three new paths and every new route uses requireToken', () => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));
  assert.ok(doc.paths['/api/inspire/value/answers']?.get, 'GET answers');
  assert.ok(doc.paths['/api/inspire/value/answers']?.put, 'PUT answers');
  assert.ok(doc.paths['/api/inspire/value/answers/history']?.get, 'GET history');
  assert.ok(doc.paths['/api/inspire/value/answers/undo']?.post, 'POST undo');
  const source = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  for (const [verb, route] of [['get', '/api/inspire/value/answers'], ['put', '/api/inspire/value/answers'], ['get', '/api/inspire/value/answers/history'], ['post', '/api/inspire/value/answers/undo']]) {
    assert.ok(source.includes(`app.${verb}('${route}', requireToken,`), `${verb} ${route} uses requireToken`);
  }
});
