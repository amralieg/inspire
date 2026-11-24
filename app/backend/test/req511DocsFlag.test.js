// REQ-511 / REQ-512 (A6 "Sort by docs made"): POST /api/inspire/docs/save records which use cases a saved file covers, so the Review list can
// show and sort the Docs column. The flag is the column docs_generated_at (TIMESTAMP) on __inspire_usecases, set for the run's session and the
// sent use_case_ids after the file is saved. Must-fail: a save with ids writes no flag today. Must-keep: a save without ids, a refused save and a
// bad id write no flag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const GEN = '/Workspace/Users/me@example.com/inspire_out';
const FOLDER = `${GEN}/acme`;
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: GEN, table_scope: JSON.stringify({}) };
const BASE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600, 32)]);

function harness() {
  const imports = [];
  const workspace = ({ path: p, method, body }) => (p.startsWith('/api/2.0/workspace/import') && method === 'POST' ? (imports.push(body), [{}, 200]) : undefined);
  const made = makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: [], workspace });
  return { made, imports };
}
async function save(srv, over) {
  const resp = await fetch(`${srv.url}/api/inspire/docs/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' },
    body: JSON.stringify({ ...BASE, folder: FOLDER, name: 'Acme_brief.pdf', content_base64: PDF.toString('base64'), ...over }) });
  return { status: resp.status, data: await resp.json().catch(() => null) };
}
const flagWrites = (made) => made.sqlCalls.filter((c) => /UPDATE/i.test(c.sql) && /__inspire_usecases/.test(c.sql) && /docs_generated_at/.test(c.sql));
const bound = (call) => `${call.sql} ${JSON.stringify(call.parameters || [])}`;

test('1 (must-fail): a saved file with use_case_ids sets docs_generated_at on those use cases of this run only', async () => {
  const h = harness();
  const srv = await listen(h.made.app);
  try {
    const r = await save(srv, { use_case_ids: ['N01-U01', 'N02-U02'] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(h.imports.length, 1, 'the file is saved first');
    const writes = flagWrites(h.made);
    assert.equal(writes.length, 1, `one flag write, got ${writes.length}`);
    const text = bound(writes[0]);
    for (const needle of ['N01-U01', 'N02-U02', '42']) assert.ok(text.includes(needle), `the write names ${needle}: ${text}`);
    assert.match(writes[0].sql, /session_id/);
    assert.ok(!/N01-U01'|N02-U02'/.test(writes[0].sql), 'ids are bound parameters, not spliced into the SQL');
    assert.deepEqual(r.data.use_case_ids, ['N01-U01', 'N02-U02'], 'the reply echoes the flagged ids');
  } finally { await srv.close(); }
});

test('2 (must-keep): a save with no use_case_ids writes no flag and replies as before', async () => {
  const h = harness();
  const srv = await listen(h.made.app);
  try {
    const r = await save(srv, {});
    assert.equal(r.status, 200);
    assert.deepEqual({ path: r.data.path, name: r.data.name }, { path: `${FOLDER}/Acme_brief.pdf`, name: 'Acme_brief.pdf' });
    assert.equal(flagWrites(h.made).length, 0);
  } finally { await srv.close(); }
});

test('3: a refused save (folder outside the run) and a bad use case id write no flag', async () => {
  const h = harness();
  const srv = await listen(h.made.app);
  try {
    const outside = await save(srv, { folder: '/Workspace/Users/other', use_case_ids: ['N01-U01'] });
    assert.notEqual(outside.status, 200);
    const bad = await save(srv, { use_case_ids: ["N01-U01'; DROP TABLE x; --"] });
    assert.equal(bad.status, 400, 'a bad id is refused');
    assert.equal(h.imports.length, 0, 'a bad id is refused before the file is saved');
    assert.equal(flagWrites(h.made).length, 0);
  } finally { await srv.close(); }
});
