const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const USE_CATALOG_GAP = { privilege: 'USE CATALOG', level: 'catalog', object: '`main`' };
const SCHEMA_GAP = { privilege: 'USE SCHEMA', level: 'schema', object: '`main`.`s`' };

test('REQ-456: when the only gap is USE CATALOG, the advice names the exact GRANT and the installer, not another result table', () => {
  const text = I.appAccessMessage('main.s.t', [USE_CATALOG_GAP]);
  assert.doesNotMatch(text, /choose a result table in a catalog and schema Inspire manages/);
  assert.ok(text.includes('GRANT USE CATALOG ON CATALOG `main` TO `account users`'), text);
  assert.match(text, /installer/i);
});

test('REQ-456 must-keep: a gap below the catalog keeps the old advice', () => {
  const text = I.appAccessMessage('main.s.t', [USE_CATALOG_GAP, SCHEMA_GAP]);
  assert.match(text, /choose a result table in a catalog and schema Inspire manages/);
  assert.doesNotMatch(text, /GRANT /);
});
