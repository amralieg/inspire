import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

const { NO_PERSON_TOKEN } = createRequire(import.meta.url)('../../../backend/lib/routePolicy.js');

test.after(closeBrowser);

const REFUSED = 'You cannot read main.s.salaries with your own sign-in, and Inspire never reads for you what you cannot read: '
  + 'choose only tables and files you can read, or ask their owner for access';
const forbidden = (line) => /status of 40[13]/.test(line);

test('with no sign-in the Launch page lists no catalog and shows the sign-in refusal as it came, asked once, with no grant advice', async () => {
  const ui = await openUi('launch', { noPersonToken: true });
  const { page, pageErrors, made } = ui;
  try {
    await page.locator('[data-uc-why]').getByText(NO_PERSON_TOKEN, { exact: true }).waitFor({ timeout: 20000 });
    await page.getByText('Inspire could not list the catalogs. The message above says why.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-uc-permission]').count(), 0);
    assert.ok(made.catalogLists.length >= 1 && made.catalogLists.length <= 2,
      `a sign-in refusal is asked once per mount (React mounts twice in development), not retried: ${made.catalogLists.length} asks`);
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});

test('a run refused for a table the person cannot read shows the reason as it came, and the picker lists what the person sees', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders', 'salaries'] },
    runAnswer: [403, { error: REFUSED, unreadable: ['main.s.salaries'] }] });
  const { page, pageErrors, made } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="salaries"]').click();
    assert.equal(await page.locator('[data-uc-why]').count(), 0, 'no reason while the person can list');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByText(REFUSED, { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-uc-permission]').count(), 0, 'a refusal of the person\u2019s own reads is not a grant problem of the App');
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.salaries');
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});

test('Launch prefills a business from its last run that wrote rows, never from a run still starting (must-exclude)', async () => {
  const asked = [];
  const sessions = [
    { session_id: '7001', run_id: '701', starting: true, business_name: 'Acme', completed_percent: 0 },
    { session_id: '6001', business_name: 'Acme', completed_percent: 100 },
  ];
  const ui = await openUi('launch', { sessions }, '', {
    mount: (app) => {
      app.get('/api/inspire/session', (req, res) => {
        asked.push(String(req.query.session_id));
        res.json({ session: { session_id: req.query.session_id, widget_values: { discovery_type: 'Deep' } } });
      });
    },
  });
  const { page, pageErrors } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.getByText(/^Prefilled from this business's last run/).waitFor({ timeout: 20000 });
    assert.deepEqual([...new Set(asked)], ['6001']);
    assert.doesNotMatch(await page.getByText(/^Prefilled from this business's last run/).innerText(), /6001/, 'the note names the run by when it started, never by its internal number');
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});

test('with no sign-in the Setup page shows the sign-in refusal under the catalog picker', async () => {
  const ui = await openUi('setup', { noPersonToken: true }, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
      app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: false }));
    },
  });
  const { page, pageErrors } = ui;
  try {
    const why = page.locator('[data-uc-why]');
    const next = page.getByRole('button', { name: 'Continue' });
    for (let i = 0; i < 5; i += 1) {
      await why.or(next).first().waitFor();
      if (await why.count()) break;
      await next.click();
      await page.waitForLoadState('networkidle');
    }
    await why.getByText(NO_PERSON_TOKEN, { exact: true }).waitFor({ timeout: 20000 });
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});

test('a launch whose App auto-grant succeeded shows no sign-in or grant notice on Launch or Monitor (REQ-138)', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] },
    runAnswer: [200, { run_id: 99, session_id: 1, warnings: [] }] });
  const { page, pageErrors, made } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    await page.getByRole('status').filter({ hasText: /Launched|started/i }).first().waitFor({ timeout: 15000 }).catch(() => null);
    assert.equal(await page.locator('[data-testid="launch-notes"]').count(), 0, 'a successful auto-grant leaves no launch note');
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /with your sign-in, because Discover runs as the App|Inspire granted the App read/, 'no grant notice is shown');
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});
