const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = () => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'catalogList.js')).href);

test('the catalog list note says when Unity Catalog cut the list, and a typed name past the cut becomes a choice only then (must-exclude)', async () => {
  const C = await lib();
  const listed = [{ name: 'main' }, 'Sales', null, { name: '' }];
  assert.deepEqual(C.catalogNames(listed), ['main', 'Sales']);
  assert.equal(C.catalogListed(listed, ' sales '), true);
  assert.equal(C.catalogListNote(listed, false), '', 'a whole list needs no note');
  assert.equal(C.catalogListNote(listed, true), 'Inspire listed the first 2 catalogs you can see; type the name of one that is not listed');
  assert.equal(C.catalogListNote(listed, false, 'hr'), 'No catalog named hr is among the 2 you can see');
  assert.equal(C.catalogListNote(listed, true, 'hr'),
    'hr is not among the first 2 catalogs Inspire listed; Inspire checks it with Unity Catalog when it reads its schemas');
  assert.deepEqual(C.typedCatalog(listed, true, ' hr '), { name: 'hr', typed: true });
  for (const [cut, typed] of [[false, 'hr'], [true, 'main'], [true, ''], [true, 'a.b'], [true, 'two words']]) {
    assert.equal(C.typedCatalog(listed, cut, typed), null, `${cut} ${typed}`);
  }
});

test('the catalog pickers hide system and hive_metastore unless the user typed one of them, and keep every other catalog (must-exclude)', async () => {
  const C = await lib();
  const listed = ['main', 'system', { name: 'hive_metastore' }, 'samples', 'sales'];
  assert.deepEqual(C.catalogNames(C.shownCatalogs(listed)), ['main', 'samples', 'sales']);
  assert.deepEqual(C.catalogNames(C.shownCatalogs(listed, ' System ')), ['main', 'system', 'samples', 'sales']);
  assert.deepEqual(C.catalogNames(C.shownCatalogs(listed, 'hive_metastore')), ['main', 'hive_metastore', 'samples', 'sales']);
  assert.deepEqual(C.catalogNames(C.shownCatalogs(listed, 'sys')), ['main', 'samples', 'sales'], 'part of the name is not asking for it');
  assert.deepEqual(C.shownCatalogs(null), []);
});
