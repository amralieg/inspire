// c24_blaunch (RC7-B-05, B-06, B-07): the Start picker lists what the person can use, the basket counts what the person picked, a schema
// list that is dropped never leaves the Tables panel loading, and Monitor names the person who started the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';

// The App answers the same rows with or without include_unreadable: Inspire's own access is marked on each row (REQ-522).
const catalogsWorld = () => (app) => {
  app.get('/api/catalogs', (_req, res) => res.json({ catalogs: [
    { name: 'dim', inspire_readable: null },
    { name: 'main', inspire_readable: true },
    { name: 'ops', inspire_readable: false, partial: { missing: ['GRANT SELECT ON CATALOG `ops` TO `app`'] } },
  ], truncated: false }));
  app.get('/api/catalogs/:catalog/schemas', (req, res) => res.json({ schemas: req.params.catalog !== 'main' ? [] : [
    { name: 'a', full_name: 'main.a', inspire_readable: true },
    { name: 'b', full_name: 'main.b', inspire_readable: false },
    { name: 'c', full_name: 'main.c', inspire_readable: false },
  ] }));
  app.get('/api/tables/:catalog/:schema', (_req, res) => res.json({ tables: [], count: 0, metric_views: [] }));
};

test('B-06: with Show everything off the catalog list holds only catalogs Inspire can use; ticking it reveals the rest (must-exclude, must-keep)', async () => {
  const ui = await openUi('launch', {}, '', { mount: catalogsWorld() });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('button[title="dim"]').count(), 1, 'a catalog whose Inspire access is not known yet is still listed');
    assert.equal(await page.locator('button[title="ops"]').count(), 0, 'a catalog Inspire needs access to is not listed by default');
    await page.getByRole('checkbox', { name: 'Show everything', exact: true }).check();
    await page.locator('button[title="ops"]').waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('B-07: three schemas picked read as "3 schemas" in the basket and the footer, and the one Inspire can read is still the only one the run reads (must-fail, must-keep)', async () => {
  const ui = await openUi('launch', {}, '', { mount: catalogsWorld() });
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.getByRole('checkbox', { name: 'Show everything', exact: true }).check();
    await page.locator('button[title="main"]').click();
    for (const s of ['a', 'b', 'c']) {
      await page.locator(`button[title="${s}"]`).click();
    }
    await idle(page);
    assert.equal(await page.getByText('3 schemas', { exact: true }).count() >= 2, true, 'the basket and the footer chip both say 3 schemas');
    assert.equal(await page.getByText('1 schema', { exact: true }).count(), 0, 'no count says 1 schema');
    assert.match(await page.locator('[data-scope-unread]').innerText(), /2 .*Inspire/, 'the basket says 2 of them are not read until Inspire has access');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    for (let i = 0; i < 100 && made.launches.length === 0; i += 1) await page.waitForTimeout(100);
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.a', 'the run reads only the schema Inspire can read');
  } finally {
    await ui.close();
  }
});

test('B-07: a schema picked then unpicked while its tables load leaves no spinner on the Tables panel (must-fail)', async () => {
  const mount = (app) => {
    catalogsWorld()(app);
    app.get('/api/tables/:catalog/:schema', () => { /* the listing never answers */ });
  };
  const ui = await openUi('launch', {}, '', { mount });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="a"]').click();
    await page.locator('[data-tables-loading]').waitFor({ timeout: 15000 });
    await page.locator('button[title="a"]').click();
    await idle(page);
    assert.equal(await page.locator('[data-tables-loading]').count(), 0, 'with no schema picked nothing is loading');
  } finally {
    await ui.close();
  }
});

test('B-05: Monitor names the person who started the run (the run itself is the App service principal)', async () => {
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: null }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, life_cycle_state: 'RUNNING', result_state: null, state_message: '', tasks: [],
      started_by: 'launcher@example.com' }));
  };
  const ui = await openUi('monitor', {}, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-testid="monitor-status"]').getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
    await page.locator('[data-started-by]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-started-by]').innerText(), /Started by launcher@example\.com/);
  } finally {
    await ui.close();
  }
});
