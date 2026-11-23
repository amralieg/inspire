// REQ-510 L3 (declutter after REQ-508): the new-run form (Launch) says less above the fold, keeps one main action (Get Started) and moves
// its extras into one More menu (briefs/req510_spec.md section 2.5). Fail-pre (a037bfdfb): 165 body words and 11 controls above the fold;
// the Discovery Overview list of past runs (a copy of the Start list) is the first thing on the page; the privacy note is an inline
// disclosure; there is no More menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { describe, itemsOf, screenFacts, shownOutsideMenus } from './req510Declutter.mjs';

test.after(closeBrowser);

async function openLaunch() {
  const ui = await openUi('launch');
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.locator('h1').first().waitFor({ timeout: 20000 });
  await ui.page.getByRole('button', { name: 'Get Started', exact: true }).waitFor({ timeout: 20000 });
  await ui.page.waitForTimeout(1500);
  return ui;
}

test('Launch: at most 60 words and 9 controls above the fold, and no more than one primary button', async () => {
  const ui = await openLaunch();
  const { page } = ui;
  try {
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 60, `Launch body words ${f.bodyWords} > 60 (${describe(f)})`);
    assert.ok(f.controls.length <= 9, `Launch controls above the fold ${f.controls.length} > 9 (${describe(f)})`);
    assert.ok(f.primaries.length <= 1, `at most one primary (${describe(f)})`);
    if (f.primaries.length) assert.deepEqual(f.primaries, ['Get Started'], 'the one primary is Get Started');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Launch: "Recent runs" and "How Inspire keeps your data private" live in the More menu, not inline', async () => {
  const ui = await openLaunch();
  const { page } = ui;
  try {
    const items = await itemsOf(page, page, /^More$/);
    assert.ok(items, 'Launch has one More menu');
    for (const want of ['Recent runs', 'How Inspire keeps your data private']) assert.ok(items.includes(want), `More holds "${want}" (got ${JSON.stringify(items)})`);
    assert.equal(await shownOutsideMenus(page.getByRole('region', { name: 'Discovery Overview' })), 0, 'the past-runs overview is not on the form');
    assert.equal(await shownOutsideMenus(page.getByText('How Inspire checks your data and keeps it private')), 0, 'the privacy note is not inline');
  } finally {
    await ui.close();
  }
});

test('Launch: More > Recent runs opens the run overview with its list; More > privacy shows the note (one click each)', async () => {
  const ui = await openLaunch();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Recent runs' }).click();
    const overview = page.getByRole('region', { name: /Recent runs|Discovery Overview/ });
    await overview.waitFor({ timeout: 10000 });
    assert.equal(await overview.locator('[aria-expanded="false"]').count(), 0, 'the overview opens expanded, so its runs show');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'How Inspire keeps your data private' }).click();
    await page.getByText(/private/i).filter({ hasNot: page.getByRole('menuitem') }).first().waitFor({ timeout: 10000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
