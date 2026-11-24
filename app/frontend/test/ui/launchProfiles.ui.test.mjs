import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main', 'samples'],
  schemas: { main: ['s', 'x'], samples: ['bakehouse'] },
  tables: { 'main.s': ['orders', 'customers'], 'main.x': ['stock'], 'samples.bakehouse': ['sales'] },
};
const dialog = (page) => page.locator('[data-launch-save-profile]');
const picker = (page) => page.locator('[data-launch-profile]');
const pickedLine = (page) => page.getByText('Selected Metadata', { exact: true }).locator('xpath=..');
const getStarted = (page) => page.getByRole('button', { name: 'Get Started' });

// The form a profile saved from the Start page carries: every key the draft carries (a missing one would read as the default), plus the touch flags.
const SAVED_SPEC = {
  params: {
    '00_business_name': 'Acme', '03_discovery_type': 'AI Enhanced Discovery', '04_table_election': 'Let Inspire Decides', '05_use_cases_quality': 'Good',
    '06_business_domains': 'customer, order', '08_generation_instructions': 'Focus on churn', '11_generation_path': '', '12_documents_languages': 'English',
    '13_generate_genie_code_for': '0', '15_operation': 'Discover Use Cases', '16_best_of_best_count': '',
  },
  genChecks: { 'PDF Catalog': true, Presentation: true, Excel: false },
  priorityChecks: {},
  customPriorities: ['Zed priority'],
  strategyBase: '',
  selectedCatalogs: ['main'],
  wholeCatalogs: [],
  selectedSchemas: [],
  selectedTables: ['main.s.orders'],
  tableScopes: {},
  dataFilterLabel: { on: false, text: null },
  electionTouched: true,
  discoveryTouched: true,
  strategyTouched: true,
  prioritiesTouched: true,
};
const SAVED_PROFILE = { profile_id: 'profile-1', name: 'Acme retail', business_name: 'Acme', updated_by: 'amr@x', updated_at: '2026-11-16T09:00:00Z', spec: SAVED_SPEC };

async function fillForm(page, business = 'Draft Corp') {
  await page.getByPlaceholder(BUSINESS).fill(business);
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
}

test('Get Started on a new form asks to save it as a business profile, named after the business, and Save and run saves then runs with that profile', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await fillForm(page);
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    assert.equal(await page.getByText('Save these settings as a business profile?', { exact: true }).count(), 1);
    assert.equal(await page.locator('[data-launch-profile-name]').inputValue(), 'Draft Corp', 'the name defaults to the business name');
    assert.equal(made.launches.length, 0, 'nothing runs before the answer');

    await page.locator('[data-launch-save-run]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.deepEqual(made.state.profileSaves.map((b) => [b.name, b.business_name, b.overwrite]), [['Draft Corp', 'Draft Corp', false]]);
    assert.equal(made.state.profileSaves[0].spec.params['00_business_name'], 'Draft Corp', 'the saved settings are the form');
    assert.equal(made.launches[0].profile_id, 'profile-1', 'the run is linked to the profile it saved');
    assert.equal(made.launches[0].params['00_business_name'], 'Draft Corp', 'the run starts with the form');
    await until(async () => (await dialog(page).count()) === 0, 'the dialog closes once the run starts');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of (403|404)/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('Run without saving starts the same run with no profile and saves nothing (must-exclude)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await fillForm(page);
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.launches[0].profile_id, undefined, 'no profile id is sent');
    assert.equal(made.launches[0].params['00_business_name'], 'Draft Corp');
    assert.deepEqual(made.state.profileSaves || [], [], 'no profile was saved');
  } finally {
    await ui.close();
  }
});

test('replacing a listed name needs a second confirm that names the profile, who updated it and when, and only then sends the overwrite (must-fail before the confirm)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await fillForm(page, 'Acme retail');
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.getByText('already exists. Saving replaces it.').waitFor({ timeout: 10000 });
    await page.locator('[data-launch-save-run]').click();
    // The first click only asks. Nothing is saved or run yet.
    const question = page.locator('[data-launch-profile-replace-confirm]');
    await question.waitFor({ timeout: 10000 });
    assert.match(await question.innerText(), /^Replace the profile Acme retail saved by amr@x on .+\?$/);
    assert.equal(made.state.profileSaves, undefined, 'no save was sent before the confirm');
    assert.equal(made.launches.length, 0, 'no run was sent before the confirm');
    assert.equal(await page.locator('[data-launch-save-run]').innerText(), 'Replace and run');
    await page.locator('[data-launch-save-run]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.state.profileSaves[0].overwrite, true);
    assert.equal(made.launches[0].profile_id, 'profile-1', 'the replaced profile is the one linked');
  } finally {
    await ui.close();
  }
});

test('picking a saved profile restores every setting exactly, so Get Started runs with no question (must-fail if one key is lost)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    await until(async () => /1 table/.test(await pickedLine(page).innerText()), 'the picked table is restored');
    assert.match(await page.locator('[data-launch-profile-note]').innerText(), /This run uses the profile Acme retail\./);

    await getStarted(page).click();
    await until(() => made.launches.length === 1, 'the run was sent once, with no question');
    assert.equal(await dialog(page).count(), 0, 'an unchanged profile is not asked to save again');
    const sent = made.launches[0];
    assert.equal(sent.profile_id, 'profile-1');
    assert.equal(sent.params['06_business_domains'], 'customer, order', 'a parameter the profile saved');
    assert.equal(sent.params['08_generation_instructions'], 'Focus on churn');
    assert.equal(sent.params['01_uc_metadata'], 'main.s.orders', 'the picked table reaches the run');
    assert.match(sent.params['10_strategic_context'], /Zed priority/, 'a custom priority is restored');
    assert.equal(Object.hasOwn(sent.params, '09_generation_options'), false, 'a profile saved with document ticks (before FX-116) sends no generation option');
  } finally {
    await ui.close();
  }
});

test('changing a setting after picking a profile asks to save again and says the profile changed (must-fail on a silent run)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    await page.getByPlaceholder(BUSINESS).fill('Acme Two');
    await until(async () => /You changed the profile Acme retail/.test(await page.locator('[data-launch-profile-note]').innerText()), 'the note says the profile changed');
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    assert.equal(made.launches.length, 0, 'nothing runs before the answer');
    assert.equal(await page.locator('[data-launch-profile-name]').inputValue(), 'Acme Two');
  } finally {
    await ui.close();
  }
});

test('choosing No profile clears the link and keeps every value on the form (must-keep)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    await picker(page).selectOption('');
    await idle(page);
    assert.equal(await page.locator('[data-launch-profile-note]').count(), 0, 'no profile is loaded');
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), 'Acme', 'the values stay');
    assert.match(await pickedLine(page).innerText(), /1 table/);
  } finally {
    await ui.close();
  }
});

test('the profile list shows each profile with who saved it and when', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    const label = await page.locator('[data-launch-profile] option', { hasText: 'Acme retail' }).textContent();
    assert.match(label, /^Acme retail: updated by amr@x on /);
    assert.doesNotMatch(label, /—/);
  } finally {
    await ui.close();
  }
});

test('Start over after picking a profile clears the form and the profile link, so the next Get Started asks to save again (must-fail if the link stays)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    assert.match(await page.locator('[data-launch-profile-note]').innerText(), /This run uses the profile Acme retail\./, 'a reload keeps the profile link');
    await page.locator('[data-launch-start-over]').click();
    await idle(page);
    assert.equal(await page.getByPlaceholder(BUSINESS).inputValue(), '');
    assert.equal(await page.locator('[data-launch-profile-note]').count(), 0, 'no profile is loaded after Start over');
    assert.equal(await picker(page).inputValue(), '');
    await fillForm(page, 'Fresh Co');
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.launches[0].profile_id, undefined, 'the run after Start over is not linked to the old profile');
  } finally {
    await ui.close();
  }
});

test('a reload keeps the picked profile: the run after it still uses the profile and does not ask to save an unchanged form (must-fail if the link is lost)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    assert.equal(await picker(page).inputValue(), 'profile-1');
    await getStarted(page).click();
    await until(() => made.launches.length === 1, 'the run was sent once, with no question');
    assert.equal(await dialog(page).count(), 0);
    assert.equal(made.launches[0].profile_id, 'profile-1');
  } finally {
    await ui.close();
  }
});

const pickedOption = (page) => picker(page).evaluate((el) => el.selectedOptions[0]?.textContent ?? '');

test('a catalog picked whole stops being whole once a table under it is picked, so the saved profile omits it and restore reads the same two tables (REQ-388, must-fail before)', async () => {
  let savedSpec = null;
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await page.getByPlaceholder(BUSINESS).fill('Basket Co');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.locator('button[title="customers"]').click();
    await idle(page);
    await getStarted(page).click();
    await dialog(page).waitFor({ timeout: 10000 });
    await page.locator('[data-launch-save-run]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    const saved = made.state.profileSaves[0].spec;
    savedSpec = saved;
    assert.deepEqual(saved.wholeCatalogs, [], 'the catalog is not whole once tables under it are picked');
    assert.deepEqual(saved.selectedTables, ['main.s.orders', 'main.s.customers']);
    assert.equal(made.launches[0].params['01_uc_metadata'], 'main.s.orders,main.s.customers', 'the run reads the two tables only');

  } finally {
    await ui.close();
  }
  // Restore the saved profile on a fresh form: it reads the same two tables, and no catalog comes back as whole.
  const again = await openUi('launch', { ...STATE, profiles: [{ ...SAVED_PROFILE, profile_id: 'profile-1', name: 'Basket Co', business_name: 'Basket Co', spec: savedSpec }] });
  try {
    await getStarted(again.page).waitFor({ timeout: 20000 });
    await picker(again.page).selectOption('profile-1');
    await until(async () => /2 tables/.test(await pickedLine(again.page).innerText()), 'the restored profile reads the two tables');
    assert.doesNotMatch(await pickedLine(again.page).innerText(), /catalog/, 'no catalog is restored as whole');
    await getStarted(again.page).click();
    await until(() => again.made.launches.length === 1, 'the run was sent once, with no question');
    assert.equal(again.made.launches[0].params['01_uc_metadata'], 'main.s.orders,main.s.customers');
  } finally {
    await again.close();
  }
});

test('after a profile restore the picker shows the profile name, then "(changed)" once a setting changes (REQ-390, must-fail before)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    assert.equal(await picker(page).inputValue(), 'profile-1');
    assert.equal(await pickedOption(page), 'Acme retail', 'the restored profile is named, not "No profile"');
    await page.getByPlaceholder(BUSINESS).fill('Acme Two');
    await until(async () => (await pickedOption(page)) === 'Acme retail (changed)', 'the picker says the profile changed');
    await picker(page).selectOption('');
    await until(async () => (await pickedOption(page)) === 'No profile', 'clearing the picker shows No profile');
  } finally {
    await ui.close();
  }
});

test('a restored profile keeps its name in the picker even when the profile list does not carry it after a reload (REQ-390, must-fail before)', async () => {
  const ui = await openUi('launch', { ...STATE, profiles: [SAVED_PROFILE] });
  const { page, made } = ui;
  try {
    await getStarted(page).waitFor({ timeout: 20000 });
    await picker(page).selectOption('profile-1');
    await until(async () => (await page.getByPlaceholder(BUSINESS).inputValue()) === 'Acme', 'the business name is restored');
    made.state.profiles = [];
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
    assert.equal(await picker(page).inputValue(), 'profile-1', 'the picker still points at the restored profile');
    assert.equal(await pickedOption(page), 'Acme retail', 'the label is the profile name, not "No profile"');
  } finally {
    await ui.close();
  }
});
