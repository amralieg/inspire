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
    await page.getByText('No catalogs found', { exact: true }).waitFor();
    assert.equal(await page.getByText('Ask your admin to grant').count(), 0);
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
    assert.equal(await page.getByText('Ask your admin to grant').count(), 0, 'a refusal of the person\u2019s own reads is not a grant problem of the App');
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.salaries');
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
    for (let i = 0; i < 5 && !(await why.count()); i += 1) {
      const next = page.getByRole('button', { name: 'Continue' });
      await next.waitFor();
      await next.click();
      await page.waitForLoadState('networkidle');
    }
    await why.getByText(NO_PERSON_TOKEN, { exact: true }).waitFor({ timeout: 20000 });
    assert.deepEqual(pageErrors.filter((line) => !forbidden(line)), []);
  } finally {
    await ui.close();
  }
});
