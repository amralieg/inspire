// SEC-02 AT5 (F2, F5, F9 class closure; REQ-518): a static scan so a new route cannot reintroduce the defect class.
// (a) A route whose handler takes a table, column, path, catalog or schema from the caller reads as the person, unless it is on the frozen
//     list of App reads below (each one writes or checks what the App itself owns).
// (b) No handler falls back from the person's token to the App's ("personToken || req.dbToken").
// (c) A schema-level read refusal never asks for SELECT on the whole schema or catalog: read grants are table level only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RP = require('../lib/routePolicy');
const PM = require('../lib/permissionError');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['server.js', 'implementRoutes.js'];
const CALLER_INPUT = /req\.(query|body\??|params)\.(table|tables|path|rate_table|column|catalog|schema)\b|q\(req, '(table|path|column|catalog|schema)'\)|req\.body\?\.\w*table|const \{ catalog(, schema)? \} = req\.params/;
// Frozen: the App reads these as itself because it creates or checks its own objects. Adding to this list needs a spec change.
const APP_READS = new Set([
  'GET /api/inspire/implement/output-check', // the Build's output table, which the App writes
]);

function routes(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /\bapp\.(get|post|put|patch|delete|all)\(\s*(['"`])((?:(?!\2)[^\n])*)\2/g;
  const found = [...text.matchAll(re)];
  return found.map((m, i) => ({ file, key: RP.routeKey(m[1], m[3]), body: text.slice(m.index, (found[i + 1] || { index: text.length }).index) }));
}

test('AT5a: every route that reads a caller-named table, path, catalog or schema is person identity', () => {
  const offenders = SOURCES.flatMap(routes).filter((r) => CALLER_INPUT.test(r.body) && !APP_READS.has(r.key) && RP.identityFor(r.key) !== 'person');
  assert.deepEqual(offenders.map((r) => `${r.file} ${r.key}`), [],
    `AT5a: Not implemented: ${offenders.length} routes read a caller-named object as the App service principal`);
});

test('AT5b: no handler falls back from the person token to the App token', () => {
  const hits = SOURCES.flatMap((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => [file, i + 1, line]).filter(([, , line]) => /(personToken(Of\(req\))?|forwardedTokenOf\(req\))\s*\|\|\s*req\.dbToken/.test(line)));
  assert.deepEqual(hits.map(([f, n, l]) => `${f}:${n}: ${l.trim()}`), [], 'AT5b: Not implemented: a person-token read falls back to the App token');
});

test('AT5b: the policy table keeps no "reads with the App service principal" justification for a data read', () => {
  const sp = Object.entries(RP.ROUTE_POLICY).filter(([key, e]) => e.identity === 'app' && /same for every person/.test(String(e.why || '')) && !APP_READS.has(key)
    && !/run\/check|output-folder\/check|samples\/copy|warehouses|serving-endpoints|app-reads/.test(key));
  assert.deepEqual(sp.map(([k]) => k), [], `AT5b: Not implemented: ${sp.length} routes still read data as the App (SP_READS)`);
});

const WHO = 'ana@example.com';
test('AT5c: a SELECT refusal on a schema maps to USE grants and a table-level ask, never SELECT ON SCHEMA', () => {
  const p = PM.permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Schema 'main.s'.", WHO);
  const statements = (p && p.statements) || [];
  assert.deepEqual(statements.filter((s) => /SELECT ON (SCHEMA|CATALOG)/.test(s)), [], `AT5c: Not implemented: schema-wide read grant offered: ${JSON.stringify(statements)}`);
  assert.ok(statements.includes(`GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${WHO}\``), `AT5c: the USE grants stay: ${JSON.stringify(p)}`);
});

test('AT5c control: a table refusal still maps to GRANT SELECT ON TABLE; a warehouse refusal names the warehouse and no GRANT', () => {
  const t = PM.permissionFor("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.s.orders'.", WHO);
  assert.ok(t.statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${WHO}\``), JSON.stringify(t));
  const w = PM.permissionFor('no CAN_USE on warehouse wh1', WHO);
  assert.deepEqual(w.statements, []);
  assert.match(w.why, /warehouse wh1/);
});
