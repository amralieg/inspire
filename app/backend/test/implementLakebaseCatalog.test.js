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

// RC6-C-04b (finding 2): effective permissions list grants only; the metastore owner, or a member of the owning group, creates catalogs too.
const missingWithOwner = (owner) => ({
  [`GET ${UC}/catalogs/${CATALOG}`]: [{ error_code: 'CATALOG_DOES_NOT_EXIST' }, 404],
  [`GET ${UC}/current-metastore-assignment`]: [{ metastore_id: 'ms1' }, 200],
  [`GET ${UC}/effective-permissions/metastore/ms1`]: assignments('CREATE_SCHEMA'),
  [`GET ${UC}/metastores/ms1`]: owner === null ? [{ message: 'no access' }, 403] : [{ metastore_id: 'ms1', owner }, 200],
});

test('RC6-C-04b: the metastore owner, with no listed CREATE_CATALOG and the catalog missing, is offered Lakebase', async () => {
  await withCatalog(missingWithOwner('builder@example.com'), (offer) => assert.equal(offer.state, 'available', offer.detail));
  await withCatalog({ ...missingWithOwner('Metastore Admins'), 'GET /api/2.0/preview/scim/v2/Me': [{ userName: 'builder@example.com', groups: [{ display: 'metastore admins' }] }, 200] },
    (offer) => assert.equal(offer.state, 'available', `a member of the owning group creates catalogs: ${offer.detail}`));
});

test('RC6-C-04b (must-exclude): when the metastore owner cannot be read, the offer is unknown, never no_catalog', async () => {
  await withCatalog(missingWithOwner(null), (offer) => {
    assert.equal(offer.state, 'unknown', offer.detail);
    assert.ok(offer.detail.includes(CATALOG), offer.detail);
  });
  await withCatalog(missingWithOwner('someone-else@example.com'), (offer) => assert.equal(offer.state, 'no_catalog', 'a known other owner is a judged answer'));
});

// RC6-C-04b (finding 1): the build job is created and run with the App's service principal token (startVersion -> triggerInspireNotebookJob, no
// run_as), and the notebook creates the catalog as the job's identity, so the App's principal is probed with its own token, never the request's.
test('RC6-C-04b: the App service principal the build runs as is the identity probed, not the token of the request', async () => {
  const workspace = ({ token, path }) => {
    if (path.includes('/scim/v2/Me')) return token === 'sp-tok' ? [{ applicationId: 'app-sp-id', displayName: 'inspire-app' }, 200] : [{ userName: 'person@example.com' }, 200];
    if (path.startsWith('/api/2.0/postgres/projects')) return OK;
    if (path.startsWith(`${UC}/catalogs/`)) return [{ error_code: 'CATALOG_DOES_NOT_EXIST' }, 404];
    if (path.startsWith(`${UC}/current-metastore-assignment`)) return [{ metastore_id: 'ms1' }, 200];
    if (path.startsWith(`${UC}/metastores/ms1`)) return [{ metastore_id: 'ms1', owner: 'admins' }, 200];
    const asked = /effective-permissions\/metastore\/ms1\?principal=([^&]+)/.exec(path);
    if (asked) {
      const principal = decodeURIComponent(asked[1]);
      return [{ privilege_assignments: [{ principal, privileges: principal === 'person@example.com' ? [{ privilege: 'CREATE_CATALOG' }] : [] }] }, 200];
    }
    return undefined;
  };
  const made = makeApp({ workspace, dbToken: 'person-tok', tokenKind: 'person', appToken: 'sp-tok' });
  const srv = await listen(made.app);
  try {
    const offer = await (await fetch(`${srv.url}/api/inspire/implement/lakebase?catalog_check=1`)).json();
    assert.equal(offer.state, 'no_catalog', offer.detail);
    assert.ok(offer.detail.includes('app-sp-id'), offer.detail);
    const uc = made.fetches.filter((f) => f.path.startsWith(UC));
    assert.ok(uc.length >= 3, 'the probe read Unity Catalog');
    assert.deepEqual([...new Set(uc.map((f) => f.token))], ['sp-tok'], 'every catalog read goes with the App token');
    assert.ok(uc.some((f) => f.path.includes('principal=app-sp-id')), 'the App principal is the one asked about');
  } finally {
    await srv.close();
  }
});
