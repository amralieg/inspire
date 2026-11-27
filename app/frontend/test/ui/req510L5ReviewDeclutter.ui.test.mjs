// REQ-510 L5 (declutter after REQ-508): the Review page keeps one main action and folds the rest into More menus and one
// "More filters" disclosure (briefs/req510_spec.md section 2.7). Fail-pre (a037bfdfb): Use cases shows 6 primaries (5 "Start Use Case
// MVP with Genie" on cards plus Open MVP) and 40 controls above the fold; Build next lists 3 rows each with its own Start button; the six
// advanced filters are always shown; every card shows Rename and Archive inline; Business shows 158 body words, Assets 78.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { describe, itemsOf, screenFacts, shownOutsideMenus } from './req510Declutter.mjs';

test.after(closeBrowser);

const ADVANCED_FILTERS = ['Technique', 'Kind', 'Quality', 'Databricks AI instruction', 'MVP', 'Value'];

async function openReview(view) {
  const ui = await openUi('results', REVIEW_STATE);
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.locator('[data-use-case-no="N01-U01"]').waitFor({ timeout: 20000 });
  if (view) await toView(ui.page, view);
  await ui.page.waitForTimeout(1500);
  return ui;
}

test('Review Use cases: at most one primary, at most 24 controls above the fold outside the rows, and at most 7 inside each row', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    const f = await screenFacts(page);
    assert.ok(f.primaries.length <= 1, `at most one primary on Review (${describe(f)})`);
    // REQ-516 (Amr, 19:10Z, "Cap 24 outside rows"): each row carries up to 7 controls by design, so the cap counts the page chrome and each row on its own.
    const inRows = await page.locator('[data-use-case-row]').evaluateAll((rows) => rows.map((row) => row.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]').length));
    assert.ok(inRows.length > 0, 'the rows are on screen');
    for (const n of inRows) assert.ok(n <= 7, `a row has ${n} controls > 7 (${inRows})`);
    const outside = f.controls.length - await page.locator('[data-use-case-row]').evaluateAll((rows) => rows.reduce((sum, row) => {
      const r = row.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0 ? sum + row.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]').length : sum;
    }, 0));
    assert.ok(outside <= 24, `Review controls above the fold outside rows ${outside} > 24 (${describe(f)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review: the six advanced filters sit behind one "More filters" button and show after one click', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    for (const name of ADVANCED_FILTERS) assert.equal(await shownOutsideMenus(page.getByRole('combobox', { name, exact: true })), 0, `filter ${name} is folded away`);
    const more = page.getByRole('button', { name: /^More filters/ });
    assert.equal(await more.count(), 1, 'one "More filters" button');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    await more.click();
    for (const name of ADVANCED_FILTERS) assert.equal(await shownOutsideMenus(page.getByRole('combobox', { name, exact: true })), 1, `filter ${name} shows after one click`);
    assert.equal(await shownOutsideMenus(page.getByRole('combobox', { name: 'Sort', exact: true })), 1, 'Sort stays on the page');
  } finally {
    await ui.close();
  }
});

test('Review rows (REQ-516): the name carries a rename pencil, Open MVP stays on the built row, and no asset links sit inline', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    const card = page.locator('[data-use-case-no="N01-U01"]');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: /^Rename / })), 1, 'one rename pencil beside the big title (REQ-516)');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: 'Move this row to Archived' })), 1, 'one archive icon at the far right of the row (REQ-516)');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: 'Open MVP' })), 1, 'Open MVP stays on the built row');
    assert.equal(await shownOutsideMenus(card.locator('[data-card-asset]')), 0, 'asset links are not inline');
    // REQ-516: the built row keeps its assets one click away, in the row More menu, and each item opens its asset.
    assert.deepEqual(await itemsOf(page, card), ['Generate docs', 'Open App', 'Open Dashboard', 'Open Genie Agent', 'Open alert'], 'the built row More menu');
    const URLS = { 'Open App': 'churn-desk-1.aws.databricksapps.com', 'Open Dashboard': '/dashboardsv3/d1', 'Open Genie Agent': '/genie/rooms/g1', 'Open alert': '/sql/alerts-v2/a1' };
    for (const [label, part] of Object.entries(URLS)) {
      await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
      await card.getByRole('button', { name: /^More$/ }).click();
      await page.getByRole('menuitem', { name: label }).click();
      const opened = await page.evaluate(() => window.__opened);
      assert.equal(opened.length, 1, `${label} opens one window`);
      assert.ok(opened[0].includes(part), `${label} opens its asset: ${opened[0]}`);
    }
  } finally {
    await ui.close();
  }
});

test('Review has one main action: the Build next panel is gone (REQ-511 D3) and only the built row carries the primary-filled button', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    assert.equal(await page.locator('[data-build-next]').count(), 0, 'no Build next panel on Review');
    const primary = page.locator('button.bg-primary-solid');
    assert.deepEqual(await primary.allInnerTexts(), ['Open MVP'], 'exactly one primary-filled button: Open MVP');
  } finally {
    await ui.close();
  }
});

test('Review Overview: at most 60 body words above the fold each', async () => {
  for (const view of ['Overview']) {
    const ui = await openReview(view);
    try {
      const f = await screenFacts(ui.page);
      assert.ok(f.bodyWords <= 60, `Review ${view} body words ${f.bodyWords} > 60 (${describe(f)})`);
    } finally {
      await ui.close();
    }
  }
});
