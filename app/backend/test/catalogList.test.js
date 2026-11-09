const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('the catalog pickers list system and hive_metastore with every other catalog, and no catalog is hidden by name', async () => {
  const C = await lib();
  const listed = ['main', 'system', { name: 'hive_metastore' }, 'samples', 'sales'];
  assert.deepEqual(C.catalogNames(listed), ['main', 'system', 'hive_metastore', 'samples', 'sales']);
  assert.equal('shownCatalogs' in C || 'HIDDEN_CATALOGS' in C, false, 'no hidden-catalog filter');
  const picker = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'CatalogPicker.jsx'), 'utf8');
  const launch = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'LaunchPage.jsx'), 'utf8');
  assert.match(picker, /const names = catalogNames\(catalogs\);/);
  assert.match(launch, /\.\.\.catalogs\.filter\(\(c\) => !catalogSearch/);
});

test('the picked scope keeps every branch at its most specific level, so a whole catalog or schema next to a narrower pick is never dropped (must-exclude)', async () => {
  const C = await lib();
  const scope = C.pickedScope(['main', 'samples'], ['main.s', 'main.x'], ['main.s.orders', 'main.s.customers']);
  assert.deepEqual(scope.entries, ['main.s.orders', 'main.s.customers', 'main.x', 'samples']);
  assert.deepEqual(scope.tables, ['main.s.orders', 'main.s.customers']);
  assert.deepEqual(scope.schemas, ['main.x']);
  assert.deepEqual(scope.catalogs, ['samples']);
  assert.equal(C.scopeSummary(scope), '2 tables, 1 schema, 1 catalog');
  assert.deepEqual(C.pickedScope(['main'], ['main.s'], []).entries, ['main.s'], 'a schema replaces its own catalog only');
  assert.deepEqual(C.pickedScope(['ma', 'main'], ['main.s'], []).entries, ['ma', 'main.s'], 'a catalog whose name starts another is not taken as its parent');
  assert.deepEqual(C.pickedScope([], [], []).entries, []);
  assert.equal(C.scopeSummary(C.pickedScope([], [], [])), '');
});
