// REQ-408: the App's read offer in the Permission Required dialog asks at catalog level when the run picked the whole catalog, and at
// schema level otherwise. The grant the person runs (the offer's exact statements) is not changed by the scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceAccess } = require('../lib/sourceAccess');

const APP = 'app-sp-id';
const PERSON = 'person-tok';
const TABLE = 'main.s.orders';
// The person owns the schema and the table, and the App holds nothing: the App's read set is what the offer asks for.
const ROWS = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'owner@example.com' },
  { level: 'schema', privilege: 'OWNER', principal: 'owner@example.com', mine: 'true', me: 'owner@example.com' },
  { level: 'table', privilege: 'OWNER', principal: 'owner@example.com', mine: 'true', me: 'owner@example.com' },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: 'owner@example.com' },
];

function sourceAccessFor() {
  const executeSql = async (host, token, wh, sql) => {
    if (/LIMIT 0/.test(sql) && token === APP_TOKEN) throw new Error(`[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${TABLE}'.`);
    if (/information_schema/.test(sql)) return { rows: ROWS };
    return { rows: [] };
  };
  const dbFetch = async (host, token, path) => {
    if (String(path).includes('/Me')) return { ok: true, status: 200, text: async () => JSON.stringify({ applicationId: APP, displayName: 'riverside-assets' }) };
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };
  return createSourceAccess({
    executeSql,
    sqlResultToObjects: (result) => (result && result.rows) || [],
    dbFetch,
    appToken: async () => APP_TOKEN,
  });
}
const APP_TOKEN = 'app-token';
const REQ = { dbHost: 'h.example.com', dbToken: PERSON, dbTokenKind: 'person', headers: { 'x-forwarded-access-token': PERSON } };

test('SEC-01 (W3): a whole-catalog pick asks the App read at table level in the offer dialog, never on the catalog', async () => {
  const sa = sourceAccessFor();
  const got = await sa.sourceAccess(REQ, 'wh', [TABLE], 'discover', { wholeCatalogs: ['main'] });
  const statements = got.app_unreadable.permissions[0].statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
  assert.equal(statements.filter((sql) => /^GRANT (SELECT|READ METADATA) ON (CATALOG|SCHEMA) /.test(sql)).length, 0, `no catalog or schema read: ${JSON.stringify(statements)}`);
});

test('SEC-01 (W3): without a picked whole catalog the offer asks at table level too', async () => {
  const sa = sourceAccessFor();
  const got = await sa.sourceAccess(REQ, 'wh', [TABLE], 'discover');
  const statements = got.app_unreadable.permissions[0].statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
});
