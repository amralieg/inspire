import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const section = (page, title) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('Setup keeps the rc.3 names Unity Catalog Metadata, Generation Instructions, Advanced Settings, Table Election and Generate Use Cases, shows the notebook and warehouse without opening Advanced Settings, and never shows a notebook widget id', async () => {
  const ui = await openUi('launch', { catalogs: ['main', 'system', 'hive_metastore', 'samples'] });
  const { page, pageErrors } = ui;
  try {
    const essentials = section(page, 'Essentials');
    await essentials.waitFor({ timeout: 15000 });
    for (const label of ['Business Name', 'Unity Catalog Metadata', 'Discovery Type', 'Generation Instructions']) {
      assert.ok(await essentials.getByText(new RegExp(`^${label}`)).count() > 0, `${label} is in Essentials`);
    }
    for (const label of ['Inspire Database', 'Business Priorities', 'Business Domains', 'Strategy (optional)']) {
      assert.equal(await essentials.getByText(label, { exact: true }).count(), 0, `${label} stays out of Essentials (must-exclude)`);
    }
    const footer = page.locator('[data-admin-footer]');
    assert.equal(await footer.count(), 1, 'the notebook and warehouse line shows with Advanced Settings closed');
    assert.match(await footer.innerText(), /^Notebook: /);
    const toggle = page.getByRole('button', { name: /Advanced Settings/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Advanced Settings starts closed');
    assert.equal(await page.getByText('Business Priorities', { exact: true }).count(), 0, 'nothing inside it shows while closed (must-exclude)');
    await toggle.click();
    const admin = section(page, 'Advanced Settings');
    for (const label of ['Business Priorities', 'Business Domains', 'Strategy (optional)', 'Inspire Database', 'Operation', 'Generation Path', 'Auto-Genie scope', 'Table Election']) {
      assert.ok(await admin.getByText(label, { exact: true }).count() > 0, `${label} is in Advanced Settings`);
    }
    const options = await admin.locator('select option').allInnerTexts();
    for (const name of ['Generate Use Cases', 'Let Inspire Decides']) assert.ok(options.includes(name), `${name} keeps its rc.3 name`);
    assert.equal(options.some((t) => /Rewrite Genie|Let Inspire decide$/.test(t)), false, 'no renamed option (must-exclude)');
    assert.equal(await page.getByText(/Which data should Inspire look at|this year's goals|Admin settings|Which tables to use/).count(), 0, 'no renamed label (must-exclude)');
    const body = await page.locator('body').innerText();
    assert.doesNotMatch(body, /\bwidget\b/i);
    assert.doesNotMatch(body, /\b\d\d_[a-z]+_[a-z_]+\b/, 'no notebook widget id such as 03_discovery_type');
    assert.deepEqual(pageErrors.filter((line) => !/status of 40[13]/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('the Setup catalog list shows system and hive_metastore next to every other catalog, as in rc.3', async () => {
  const ui = await openUi('launch', { catalogs: ['main', 'system', 'hive_metastore', 'samples'] });
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('button[title="samples"]').count(), 1);
    assert.equal(await page.locator('button[title="system"]').count(), 1);
    assert.equal(await page.locator('button[title="hive_metastore"]').count(), 1);
  } finally {
    await ui.close();
  }
});

test('a Get Started that cannot start yet says what is missing next to it, and the note goes once everything is set (must-exclude)', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } });
  const { page, pageErrors, made } = ui;
  try {
    const start = page.getByRole('button', { name: 'Get Started' });
    const note = page.locator('[data-launch-block]');
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await start.isDisabled(), true);
    assert.equal(await note.innerText(), 'Enter a Business Name to get started.');
    assert.equal(await start.getAttribute('aria-describedby'), 'launch-block');
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    assert.equal(await note.innerText(), 'Pick at least one catalog, schema or table under Unity Catalog Metadata to get started.');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await note.waitFor({ state: 'detached' });
    await until(async () => !(await start.isDisabled()));
    assert.equal(await start.getAttribute('aria-describedby'), null);
    await start.click();
    await until(() => made.launches.length === 1);
    assert.deepEqual(pageErrors.filter((line) => !/status of 40[13]/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('Advanced Settings stays closed by default, keeps what was set in it after closing, and the launch sends those values', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } });
  const { page, pageErrors, made } = ui;
  try {
    const toggle = page.getByRole('button', { name: /Advanced Settings/ });
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'no problem, so it stays closed (must-exclude)');
    assert.equal(await page.locator('[data-launch-advanced-problem]').count(), 0);
    await toggle.click();
    await page.getByRole('button', { name: /Reduce Cost/ }).click();
    await page.getByPlaceholder('Sales, Marketing, Finance, Operations, Supply Chain...').fill('Sales, Finance');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await page.getByPlaceholder('Sales, Marketing, Finance, Operations, Supply Chain...').inputValue(), 'Sales, Finance', 'closing keeps the domains');
    await toggle.click();
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.getByRole('button', { name: 'Get Started' }).click();
    await until(() => made.launches.length === 1, 'the launch was sent once');
    assert.equal(made.launches[0].params['06_business_domains'], 'Sales, Finance');
    assert.match(made.launches[0].params['07_business_priorities'], /Reduce Cost/, 'closing keeps the priority');
    assert.deepEqual(pageErrors.filter((line) => !/status of 40[13]/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('Advanced Settings opens by itself when a field inside it has a problem, and the problem shows under its title', async () => {
  const mount = (app) => {
    app.post('/api/output-folder/check', (_req, res) => res.status(403).json({ error: 'You cannot write to /Shared/demos.', unwritable: ['/Shared/demos'] }));
  };
  const ui = await openUi('launch', { catalogs: ['main'] }, '', { mount });
  const { page } = ui;
  try {
    const toggle = page.getByRole('button', { name: /Advanced Settings/ });
    await until(async () => (await toggle.getAttribute('aria-expanded')) === 'true', 'Advanced Settings opens for the refused output folder', 15000);
    assert.equal(await page.getByLabel('Generation Path').count(), 1, 'the field with the problem is on screen');
    await toggle.click();
    assert.equal(await page.locator('[data-launch-advanced-problem]').innerText(), 'Change the Generation Path: Inspire cannot write to it.',
      'closed again, the title still names the problem');
  } finally {
    await ui.close();
  }
});
