// c23: the Permission Required dialog's request links hold only what this run needs, and only what the signed-in person can see.
const test = require('node:test');
const assert = require('node:assert/strict');
const AR = require('../lib/accessRequest');

const WHO = 'signed-in@example.com';
const HOST = 'workspace.example.com';
const grant = (catalog, table) => `GRANT SELECT ON TABLE \`${catalog}\`.\`s\`.\`${table}\` TO \`${WHO}\``;
const grantCatalog = (catalog) => `GRANT USE CATALOG ON CATALOG \`${catalog}\` TO \`${WHO}\``;
const empty = { ok: true, status: 200, data: {} };

// Answers every rfa destination with none, and the person's own catalog listing with `visible` (null: the listing fails).
function fakeCall(visible) {
  return async (path) => {
    if (path.startsWith('/api/2.1/unity-catalog/catalogs')) {
      return visible ? { ok: true, status: 200, data: { catalogs: visible.map((name) => ({ name })) } } : { ok: false, status: 500, data: {} };
    }
    return empty;
  };
}

const statements = [
  ...Array.from({ length: 12 }, (_v, i) => grant('sales', `t${i}`)),
  ...Array.from({ length: 12 }, (_v, i) => grant('ops', `t${i}`)),
  grantCatalog('finance'), grantCatalog('not_in_run'), grantCatalog('hidden_from_person'),
];

test('c23: links never include a catalog outside the run\'s picked scope', async () => {
  const got = await AR.checkAccessRequest({ call: fakeCall(null), who: WHO, statements, host: HOST, scope: ['sales', 'ops.s', 'finance'] });
  const names = got.links.map((l) => l.full_name);
  assert.equal(names.some((n) => n.startsWith('not_in_run')), false, names.join(','));
  assert.equal(names.some((n) => n.startsWith('hidden_from_person')), false);
  assert.ok(names.includes('finance') && names.includes('sales.s.t0'));
});

test('c23: links never include a catalog the person\'s own token cannot see', async () => {
  const got = await AR.checkAccessRequest({ call: fakeCall(['sales', 'ops', 'finance', 'not_in_run']), who: WHO, statements, host: HOST });
  const names = got.links.map((l) => l.full_name);
  assert.equal(names.some((n) => n.startsWith('hidden_from_person')), false, names.join(','));
  assert.ok(names.includes('not_in_run'), 'visible catalogs stay when no scope is given');
});

test('c23: the scope names a whole catalog, a schema, or a table, and matches nothing else', () => {
  assert.equal(AR.inScope('a.b.c', ['a']), true);
  assert.equal(AR.inScope('a.b.c', ['a.b']), true);
  assert.equal(AR.inScope('a.b.c', ['a.b.c']), true);
  assert.equal(AR.inScope('ab.c', ['a']), false);
  assert.equal(AR.inScope('a.x', ['a.b']), false);
});
