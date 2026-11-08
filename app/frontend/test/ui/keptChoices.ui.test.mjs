import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const HOST = 'https://adb-xxxx.xx.azuredatabricks.net';

function gate() {
  let open;
  const shut = new Promise((resolve) => { open = resolve; });
  return { shut, open: () => open() };
}

test('a table the person picked stays picked when a later listing of its schema fails', async () => {
  let failListing = false;
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s', 't'] }, tables: { 'main.s': ['orders', 'salaries'], 'main.t': ['stock'] } }, '', {
    init: (page) => page.route((url) => url.pathname === '/api/tables/main/s', (route) => (failListing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'listing failed' }) })
      : route.continue())),
  });
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="salaries"]').click();
    failListing = true;
    await page.locator('button[title="t"]').click();
    await page.locator('button[title="t.stock"]').waitFor();
    await idle(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.salaries', 'a failed re-listing never drops a table the person picked');
  } finally {
    await ui.close();
  }
});

test('a discovery type the person picks while the last session is still being read is kept, and the rest still prefills', async () => {
  const first = gate();
  const asked = [];
  let listed = 0;
  const sessions = [{ session_id: '6001', business_name: 'Acme', completed_percent: 100 }];
  const ui = await openUi('launch', { sessions, catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } }, '', {
    init: (page) => page.on('response', (r) => { if (new URL(r.url()).pathname === '/api/inspire/sessions') listed += 1; }),
    mount: (app) => {
      app.get('/api/inspire/session', async (req, res) => {
        asked.push(String(req.query.session_id));
        if (asked.length === 1) await first.shut;
        res.json({ session: { session_id: req.query.session_id, widget_values: { discovery_type: 'Deep', strategic_context: '/Workspace/Users/someone/strategy.json' } } });
      });
    },
  });
  const { page, made } = ui;
  try {
    await until(() => listed >= 1, 'the sessions are listed');
    await idle(page);
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await until(() => asked.length === 1, 'the last session is asked');
    await page.getByRole('button', { name: /^Standard Discovery/ }).click();
    first.open();
    await page.getByText("Prefilled from this business's last session (6001).").waitFor({ timeout: 20000 });
    await idle(page);
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['03_discovery_type'], 'Standard Discovery', 'the last session never overrides what the person picked');
  } finally {
    first.open();
    await ui.close();
  }
});

test('a workspace URL the person types while the App defaults load is kept, and an empty field still takes the default', async () => {
  const defaults = gate();
  const ui = await openUi('setup', {}, '&step=blank', {
    mount: (app) => {
      app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: true }));
      app.get('/api/defaults', async (_req, res) => {
        await defaults.shut;
        res.json({ envSkipsSetupWizard: false, databricksHost: 'https://env.example.com', warehouseId: 'wh-env' });
      });
    },
  });
  const { page } = ui;
  try {
    const host = page.getByPlaceholder(HOST);
    await host.fill('https://typed.example.com');
    defaults.open();
    const settings = page.getByLabel('Setup settings');
    await until(async () => JSON.parse(await settings.textContent()).warehouseId === 'wh-env', 'the defaults fill what the person left empty');
    await idle(page);
    assert.equal(await host.inputValue(), 'https://typed.example.com', 'the defaults never replace what the person typed');
    assert.equal(JSON.parse(await settings.textContent()).databricksHost, 'https://typed.example.com');
  } finally {
    defaults.open();
    await ui.close();
  }
});
