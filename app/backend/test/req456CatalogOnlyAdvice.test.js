const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

// REQ-456: when USE CATALOG on the catalog is the only gap, another result table location cannot help,
// so the advice must not send the person to choose another result table.
const USE_CATALOG_GAP = { privilege: 'USE CATALOG', level: 'catalog', object: '`main`', owner: 'owner@example.com' };
const SCHEMA_GAP = { privilege: 'USE SCHEMA', level: 'schema', object: '`main`.`s`' };

test('REQ-456: a catalog-only gap does not suggest choosing another result table', () => {
  const text = I.appAccessMessage('main.s.t', [USE_CATALOG_GAP]);
  assert.match(text, /installer/i);
  assert.doesNotMatch(text, /choose a result table/);
});

test('REQ-456 must-keep: a gap below the catalog still suggests a result table Inspire manages', () => {
  const text = I.appAccessMessage('main.s.t', [USE_CATALOG_GAP, SCHEMA_GAP]);
  assert.match(text, /choose a result table in a catalog and schema Inspire manages/);
});
