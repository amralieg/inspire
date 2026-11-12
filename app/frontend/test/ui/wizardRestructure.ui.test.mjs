import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openRow, openUi, shot } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STEPS = ['What to deliver', 'Data & results', 'First run', 'Measure', 'Where it lives', 'Who uses the App', 'Page storage', 'App look', 'Run it', 'Review & build'];
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const viewports = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }];
const snap = async (page, name) => {
  for (const v of viewports) {
    await page.setViewportSize(v);
    await shot(page, `${name}-${v.width}x${v.height}`, false);
  }
  await page.setViewportSize(viewports[0]);
};

test('the step count reads the same total on every step for a fixed scope', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'How will people use this use case?' }).waitFor();
    const count = async () => (await page.locator('.sr-only', { hasText: /^Step \d+ of \d+$/ }).first().textContent()).trim();
    const totals = [];
    totals.push(await count());
    for (const step of ['Data & results', 'Measure', 'Where it lives', 'Who uses the App', 'Run it', 'Review & build', 'What to deliver']) {
      await goToStep(page, step);
      totals.push(await count());
    }
    const all = new Set(totals.map((t) => t.split(' of ')[1]));
    assert.equal(all.size, 1, `the total never changes: ${totals.join(' | ')}`);
    assert.match(totals[0], /^Step 1 of 10$/, 'What to deliver is step 1 of 10 with the App on');
  } finally {
    await ui.close();
  }
});

test('What to deliver is the first step, Data and results is one page, and Where it lives holds the App pages', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'How will people use this use case?' }).waitFor();
    assert.deepEqual(await stepLabels(page), STEPS, 'the steps read in this order, with no separate Results or App pages step');
    await snap(page, 'restructure-deliver');

    await goToStep(page, 'Data & results');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    await openRow(page, 'result table');
    await page.getByRole('region', { name: 'Where the result table lives' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Where the result table lives' }).count(), 1, 'the result table sits on the same page as the data');
    await snap(page, 'restructure-data-results');

    await goToStep(page, 'Measure');
    const measure = page.getByRole('region', { name: 'Measure' });
    await measure.waitFor();
    assert.equal(await measure.locator('[data-money-rule-editor]').count(), 1, 'Measure holds the money rule editor, so the person defines how money at stake is counted');
    assert.match(await measure.locator('[data-money-base-needed]').innerText(), /Pick the reporting currency/, 'without a currency column the Measure step asks for the reporting currency in plain words');
    await snap(page, 'restructure-measure');

    await goToStep(page, 'Where it lives');
    await page.getByRole('region', { name: 'App placement' }).waitFor();
    await openRow(page, 'App pages');
    await page.getByRole('region', { name: 'App pages' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'App features' }).count(), 0, 'the App pages are picked on Where it lives, not with who uses the App');
    assert.equal(await page.getByRole('tab', { name: 'Pages', exact: true }).count(), 0, 'App look no longer holds a Pages tab');
    await snap(page, 'restructure-where');

    await goToStep(page, 'Who uses the App');
    await page.getByRole('region', { name: 'App access' }).waitFor();
    await openRow(page, 'what people can do in the App');
    await page.getByRole('region', { name: 'App features' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'App pages' }).count(), 0, 'Who uses the App no longer holds the pages');
    await snap(page, 'restructure-who');

    await goToStep(page, 'App look');
    await page.getByRole('region', { name: 'App look' }).waitFor();
    await snap(page, 'restructure-look');

    await goToStep(page, 'Run it');
    await page.getByRole('group', { name: 'Keep it fresh' }).waitFor().catch(() => {});
    await snap(page, 'restructure-run');

    await goToStep(page, 'Review & build');
    const vibes = page.getByRole('region', { name: 'Vibes' });
    await vibes.waitFor();
    for (const v of viewports) {
      await page.setViewportSize(v);
      const box = await vibes.boundingBox();
      assert.ok(box && box.y + box.height <= v.height, `the vibes box is in view without scrolling at ${v.width}x${v.height}`);
    }
    await page.setViewportSize(viewports[0]);
    const picked = page.getByRole('region', { name: 'What Inspire picked' });
    const pickedStyle = await picked.evaluate((el) => ({ overflowY: getComputedStyle(el).overflowY, height: getComputedStyle(el).height }));
    assert.equal(pickedStyle.overflowY, 'auto', 'the chosen options scroll inside their own area');
    assert.equal(pickedStyle.height, '192px', 'the chosen options have a fixed height');
    assert.ok(await picked.locator('[data-picked-change]').first().count(), 'Edit links stay');
    await snap(page, 'restructure-review');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Rebuild as is: an unchanged version is refused until the person picks Rebuild as is, and the build then sends it', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await page.route('**/api/inspire/implement/plan**', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({ response, json: { ...json, unchanged: true, based_on_version: 1, spec_version: 2 } });
    });
    await goToStep(page, 'Review & build');
    const footer = page.getByRole('button', { name: 'All Good, Build it Now', exact: true });
    const choice = page.locator('[data-rebuild-as-is]');
    await choice.waitFor();
    assert.equal(await choice.isChecked(), false, 'Rebuild as is starts off');
    assert.equal(await footer.isDisabled(), true, 'an unchanged version cannot be built until the person asks for a rebuild');
    await page.getByText('Rebuild as is: build the current choices again', { exact: false }).click();
    assert.equal(await choice.isChecked(), true);
    assert.equal(await footer.isDisabled(), false, 'Rebuild as is enables the build');
    const submit = page.waitForRequest((r) => r.url().includes('/api/inspire/implement/submit') && r.method() === 'POST');
    await footer.click();
    const body = JSON.parse((await submit).postData() || '{}');
    assert.equal(body.rebuild_as_is, true, 'the build sends rebuild_as_is');
    assert.deepEqual(ui.pageErrors.filter((e) => !/409|Conflict/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('Keep it fresh sits on Data & results, and Run it keeps the Measure impact and schedule settings', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data & results');
    await openRow(page, 'Keep it fresh');
    await page.getByRole('group', { name: 'Keep it fresh' }).waitFor();
    await goToStep(page, 'Run it');
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Run it no longer holds Keep it fresh');
    await page.getByRole('group', { name: 'Measure impact' }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
