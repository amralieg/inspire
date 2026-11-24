import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const SAVED = {
  params: { '00_business_name': 'Acme retail', '06_business_domains': 'customer' },
  genChecks: { 'PDF Catalog': true, Excel: true }, priorityChecks: {}, customPriorities: [], strategyBase: '',
  selectedCatalogs: [], wholeCatalogs: [], selectedSchemas: [], selectedTables: [], tableScopes: {}, dataFilterLabel: { on: false, text: null },
  electionTouched: true, discoveryTouched: true, strategyTouched: true, prioritiesTouched: true,
};
const SESSIONS = [
  { session_id: '42', completed_percent: 100, business_name: 'Acme', profile_id: 'profile-1', profile_name: 'Acme retail', create_at: '2026-11-16T09:00:00Z', widget_values: { business: 'Acme' } },
  { session_id: '43', completed_percent: 100, business_name: 'Beta', create_at: '2026-11-15T09:00:00Z', widget_values: { business: 'Beta' } },
];
const PROFILES = [{ profile_id: 'profile-1', name: 'Acme retail', business_name: 'Acme', updated_by: 'amr@x', updated_at: '2026-11-16T09:00:00Z', spec: SAVED }];

test('a run started with a profile shows the profile name on Start, and a run without one shows none (must-exclude)', async () => {
  const ui = await openUi('choose', { sessions: SESSIONS, profiles: PROFILES });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-run="42"] [data-run-profile]').innerText(), 'Profile: Acme retail');
    assert.equal(await page.locator('[data-run="43"] [data-run-profile]').count(), 0);
    await page.locator('[data-run="43"]').getByRole('button', { name: /^More for / }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Download profile' }).getAttribute('aria-disabled'), 'true', 'no download for a run with no profile');
  } finally {
    await ui.close();
  }
});

test('Download profile saves the profile as inspire_profile_<name>.json with its settings', async () => {
  const ui = await openUi('choose', { sessions: SESSIONS, profiles: PROFILES });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-run="42"]').getByRole('button', { name: /^More for / }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download profile' }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'inspire_profile_Acme_retail.json');
    const text = await (await import('node:fs')).promises.readFile(await download.path(), 'utf8');
    const body = JSON.parse(text);
    assert.deepEqual([body.format, body.name, body.updated_by], ['inspire_profile', 'Acme retail', 'amr@x']);
    assert.deepEqual(body.spec, SAVED, 'the file carries the settings the profile stored');
  } finally {
    await ui.close();
  }
});

test('a Download that the App refuses says so on that run, and downloads nothing', async () => {
  const ui = await openUi('choose', { sessions: SESSIONS, profiles: [] });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-run="42"]').getByRole('button', { name: /^More for / }).click();
    await page.getByRole('menuitem', { name: 'Download profile' }).click();
    await until(async () => (await page.locator('[data-run-profile-error]').count()) === 1, 'the refusal is shown on the run');
    assert.match(await page.locator('[data-run-profile-error]').innerText(), /business profile was not found/);
  } finally {
    await ui.close();
  }
});

// REQ-313, REQ-220: a Download the workspace refuses opens Permission Required, and the run shows no second message beside it.
const REFUSED_PERMISSION = {
  statements: ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `11111111-2222-3333-4444-555555555555`;'],
  principal: '11111111-2222-3333-4444-555555555555',
  why: 'Start reads the profile as the App, and the App cannot read it yet.',
};

test('a Download the workspace refuses opens Permission Required and shows no second message on the run (REQ-313, REQ-220)', async () => {
  const ui = await openUi('choose', { sessions: SESSIONS, profiles: PROFILES, profileRefusal: { message: 'User does not have SELECT', permissions: [REFUSED_PERMISSION] } });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-run="42"]').getByRole('button', { name: /^More for / }).click();
    await page.getByRole('menuitem', { name: 'Download profile' }).click();
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-run-profile-error]').count(), 0, 'the dialog carries the reason, so no second message shows on the run');
  } finally {
    await ui.close();
  }
});
