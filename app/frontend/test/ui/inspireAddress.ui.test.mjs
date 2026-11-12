import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { INSIDE_WAREHOUSE_TOGGLE } from '../../src/lib/implementWizard.js';
import { closeBrowser, goToStep, onStep, openAdvanced, openUi, startMvp, until } from './uiSupport.mjs';

test.after(closeBrowser);

const PLACEMENTS = [
  [/^One App per business domain/, 'domain'],
  [/^One App per use case/, 'use_case'],
  [/^One App for all use cases/, 'business'],
  [/^Inside Inspire/, 'inspire'],
];

test('the wizard sends the Inspire address for every App placement, so each App page can link its use case on Review', async () => {
  for (const [label, id] of PLACEMENTS) {
    const ui = await openUi('wizard', { useCase: { ...HARNESS_USE_CASE, business_domain: 'Customer' }, me: { userName: OWNER, displayName: 'Owner' } }, '', {
      init: (page) => page.setExtraHTTPHeaders({ 'x-forwarded-host': 'inspire.example.com' }),
    });
    const { page, made } = ui;
    try {
      await goToStep(page, 'What to build');
      await goToStep(page, 'App placement');
      await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
      await page.getByRole('radio', { name: label }).check();
      if (id === 'inspire') {
        await openAdvanced(page, INSIDE_WAREHOUSE_TOGGLE);
        await page.locator('[data-app-place="inspire"] [data-app-warehouse="pick"]').waitFor();
      }
      await startMvp(page);
      await until(() => made.jobs.length === 1, `the ${id} build`, 20000);
      const [sent] = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
        .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
      assert.deepEqual([sent.outputs.app, sent.outputs.app_placement, sent.outputs.inspire_url], [true, id, 'https://inspire.example.com'], id);
      assert.deepEqual(ui.pageErrors, [], id);
    } finally {
      await ui.close();
    }
  }
});

test('the wizard sends the Inspire address for a dashboard with no App, and none when there is neither a dashboard nor an App', async () => {
  for (const [tick, expected] of [[[/^Dashboard/], [false, true, 'https://inspire.example.com']], [[], [false, false, '']]]) {
    const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } }, '', {
      init: (page) => page.setExtraHTTPHeaders({ 'x-forwarded-host': 'inspire.example.com' }),
    });
    const { page, made } = ui;
    const what = tick.map(String).join(' ') || 'nothing';
    try {
      await goToStep(page, 'What to build');
      await page.getByRole('checkbox', { name: /^App A Databricks/ }).uncheck();
      for (const name of tick) await page.getByRole('checkbox', { name }).check();
      await startMvp(page);
      await until(() => made.jobs.length === 1, `the build with the App off and ${what} ticked`, 20000);
      const [sent] = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
        .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
      assert.deepEqual([sent.outputs.app, sent.outputs.dashboard, sent.outputs.inspire_url], expected, what);
      assert.deepEqual(ui.pageErrors, [], what);
    } finally {
      await ui.close();
    }
  }
});
