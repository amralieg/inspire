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

const ADVANCED_FILTERS = ['Technique', 'Kind', 'Quality', 'Genie Code instruction', 'MVP', 'Value'];

async function openReview(view) {
  const ui = await openUi('results', REVIEW_STATE);
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.locator('[data-use-case-no="N01-U01"]').waitFor({ timeout: 20000 });
  if (view) await toView(ui.page, view);
  await ui.page.waitForTimeout(1500);
  return ui;
}

test('Review Use cases: at most one primary on the screen and at most 24 controls above the fold', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    const f = await screenFacts(page);
    assert.ok(f.primaries.length <= 1, `at most one primary on Review (${describe(f)})`);
    assert.ok(f.controls.length <= 24, `Review controls above the fold ${f.controls.length} > 24 (${describe(f)})`);
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

test('Review cards: Rename and Archive move into the card More menu; the built card keeps Open MVP and moves its asset links there', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    const card = page.locator('[data-use-case-no="N01-U01"]');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: /^Rename / })), 0, 'no inline Rename button');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: 'Archive use case' })), 0, 'no inline Archive button');
    assert.equal(await shownOutsideMenus(card.getByRole('button', { name: 'Open MVP' })), 1, 'Open MVP stays on the built card');
    const items = await itemsOf(page, card, /^More for /);
    assert.ok(items, 'the card has a "More for <name>" menu');
    for (const want of ['Rename', 'Archive use case', 'Open App', 'Open Dashboard', 'Open Genie Agent', 'Open alert']) {
      assert.ok(items.includes(want), `card More holds "${want}" (got ${JSON.stringify(items)})`);
    }
    assert.equal(await shownOutsideMenus(card.locator('[data-card-asset]')), 0, 'asset links are not inline');
  } finally {
    await ui.close();
  }
});

test('Review Build next: one Start button shows; the other suggestions sit in the panel More menu', async () => {
  const ui = await openReview();
  const { page } = ui;
  try {
    const panel = page.getByRole('region', { name: 'Build next' }).first();
    await panel.waitFor({ timeout: 15000 });
    assert.equal(await shownOutsideMenus(panel.getByRole('button', { name: /^Start use case MVP/i })), 1, 'one visible Start in Build next');
    const items = await itemsOf(page, panel, /^More$/);
    assert.ok(items && items.length >= 2, `Build next More holds the other suggestions (got ${JSON.stringify(items)})`);
  } finally {
    await ui.close();
  }
});

test('Review Business and Assets: at most 60 body words above the fold each', async () => {
  for (const view of ['Business', 'Assets']) {
    const ui = await openReview(view);
    try {
      const f = await screenFacts(ui.page);
      assert.ok(f.bodyWords <= 60, `Review ${view} body words ${f.bodyWords} > 60 (${describe(f)})`);
    } finally {
      await ui.close();
    }
  }
});
