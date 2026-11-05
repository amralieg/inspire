import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const section = (page, title) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('Setup keeps the rc.3 names Unity Catalog Metadata, Generation Instructions, Advanced Settings, Table Election and Generate Use Cases, shows the notebook and warehouse without opening Advanced Settings, and never shows a notebook widget id', async () => {
  const ui = await openUi('launch', { catalogs: ['main', 'system', 'hive_metastore', 'samples'] });
  const { page, pageErrors } = ui;
  try {
    const essentials = section(page, 'Essentials');
    await essentials.waitFor({ timeout: 15000 });
    for (const label of ['Business Priorities', 'Business Domains', 'Strategy (optional)', 'Generation Instructions', 'Unity Catalog Metadata']) {
      assert.ok(await essentials.getByText(label, { exact: false }).count() > 0, `${label} is in Essentials`);
    }
    assert.equal(await essentials.getByText('Inspire Database', { exact: true }).count(), 0, 'admin fields stay out of Essentials');
    const footer = page.locator('[data-admin-footer]');
    assert.equal(await footer.count(), 1, 'the notebook and warehouse line shows with Advanced Settings closed');
    assert.match(await footer.innerText(), /^Notebook: /);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    const admin = section(page, 'Advanced Settings');
    for (const label of ['Inspire Database', 'Operation', 'Generation Path', 'Auto-Genie scope', 'Table Election']) {
      assert.ok(await admin.getByText(label, { exact: true }).count() > 0, `${label} is in Advanced Settings`);
    }
    assert.equal(await admin.getByText('Business Priorities', { exact: true }).count(), 0);
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
