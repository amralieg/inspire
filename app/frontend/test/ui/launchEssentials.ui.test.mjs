import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const section = (page, title) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('Setup asks for the business context in Essentials, keeps admin fields under Admin settings, and never shows a notebook widget id', async () => {
  const ui = await openUi('launch', { catalogs: ['main', 'system', 'hive_metastore', 'samples'] });
  const { page, pageErrors } = ui;
  try {
    const essentials = section(page, 'Essentials');
    await essentials.waitFor({ timeout: 15000 });
    for (const label of ['Business Priorities', 'Business Domains', 'Strategy and organization', "Describe your business and this year's goals", 'Which data should Inspire look at?']) {
      assert.ok(await essentials.getByText(label, { exact: false }).count() > 0, `${label} is in Essentials`);
    }
    assert.equal(await essentials.getByText('Inspire Database', { exact: true }).count(), 0, 'admin fields stay out of Essentials');
    await page.getByRole('button', { name: /Admin settings/ }).click();
    const admin = section(page, 'Admin settings');
    for (const label of ['Inspire Database', 'Operation', 'Generation Path', 'Auto-Genie scope', 'Which tables to use']) {
      assert.ok(await admin.getByText(label, { exact: true }).count() > 0, `${label} is in Admin settings`);
    }
    assert.equal(await admin.getByText('Business Priorities', { exact: true }).count(), 0);
    assert.deepEqual(await admin.locator('select option').allInnerTexts().then((all) => all.filter((t) => /Inspire decide|Rewrite Genie/.test(t))),
      ['Rewrite Genie instructions for flagged use cases', 'Let Inspire decide']);
    const body = await page.locator('body').innerText();
    assert.doesNotMatch(body, /\bwidget\b/i);
    assert.doesNotMatch(body, /\b\d\d_[a-z]+_[a-z_]+\b/, 'no notebook widget id such as 03_discovery_type');
    assert.doesNotMatch(body, /Let Inspire Decides|Table Election|Advanced Settings/);
    assert.deepEqual(pageErrors.filter((line) => !/status of 40[13]/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('the Setup catalog list hides system and hive_metastore, and shows one again when the user types its name (must-exclude)', async () => {
  const ui = await openUi('launch', { catalogs: ['main', 'system', 'hive_metastore', 'samples'] });
  const { page } = ui;
  try {
    await page.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('button[title="samples"]').count(), 1);
    assert.equal(await page.locator('button[title="system"]').count(), 0);
    assert.equal(await page.locator('button[title="hive_metastore"]').count(), 0);
    await page.getByPlaceholder(/catalog/i).first().fill('system');
    await page.locator('button[title="system"]').waitFor({ timeout: 5000 });
  } finally {
    await ui.close();
  }
});
