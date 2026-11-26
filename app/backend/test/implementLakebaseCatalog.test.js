const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { lakebaseCatalogOf } = require('../lib/appShell');
const { makeApp, listen } = require('./support/implementApp');

const CATALOG = lakebaseCatalogOf();
const UC = '/api/2.1/unity-catalog';
const OK = [{ projects: [] }, 200];
const ME = [{ userName: 'builder@example.com' }, 200];
const withCatalog = async (responses, fn) => {
  const made = makeApp({ responses: { 'GET /api/2.0/postgres/projects': OK, 'GET /api/2.0/preview/scim/v2/Me': ME, ...responses } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/lakebase?catalog_check=1`);
    await fn(await resp.json(), made);
  } finally {
    await srv.close();
  }
};
const assignments = (...privileges) => [{ privilege_assignments: [{ principal: 'builder@example.com', privileges: privileges.map((privilege) => ({ privilege })) }] }, 200];

test('the notebook names the Lakebase catalog, and the offer reads it from there', () => {
  assert.match(CATALOG, /^[a-z0-9_]+$/);
});

test('RC6-C-04: the API answers but the catalog is missing and the build identity has no CREATE CATALOG, so Lakebase is not offered', async () => {
  await withCatalog({
    [`GET ${UC}/catalogs/${CATALOG}`]: [{ error_code: 'CATALOG_DOES_NOT_EXIST' }, 404],
    [`GET ${UC}/current-metastore-assignment`]: [{ metastore_id: 'ms1' }, 200],
    [`GET ${UC}/effective-permissions/metastore/ms1`]: assignments('CREATE_SCHEMA'),
  }, (offer) => {
    assert.notEqual(offer.state, 'available');
    assert.ok(offer.detail.includes(CATALOG), offer.detail);
    assert.ok(offer.detail.includes('CREATE CATALOG'), offer.detail);
    assert.match(offer.detail, /run the Inspire installer again/);
  });
});

test('RC6-C-04 (must-keep): the catalog exists, or the identity can create it, so Lakebase is offered', async () => {
  await withCatalog({ [`GET ${UC}/catalogs/${CATALOG}`]: [{ name: CATALOG }, 200] }, (offer, made) => {
    assert.equal(offer.state, 'available');
    assert.equal(made.fetches.some((f) => (f.opts.method || 'GET') !== 'GET'), false, 'the probe creates nothing');
  });
  await withCatalog({
    [`GET ${UC}/catalogs/${CATALOG}`]: [{}, 404],
    [`GET ${UC}/current-metastore-assignment`]: [{ metastore_id: 'ms1' }, 200],
    [`GET ${UC}/effective-permissions/metastore/ms1`]: assignments('CREATE_CATALOG'),
  }, (offer) => assert.equal(offer.state, 'available'));
});

test('RC6-C-04: Review reads Delta with the reason that names the catalog', async () => {
  const w = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
  const detail = `the catalog ${CATALOG} does not exist and builder@example.com has no CREATE CATALOG on the metastore`;
  const text = w.appStorageText({ outputs: { app: true } }, { state: 'no_catalog', detail });
  assert.ok(text.startsWith('Delta, because'), text);
  assert.ok(text.includes(CATALOG), text);
});
