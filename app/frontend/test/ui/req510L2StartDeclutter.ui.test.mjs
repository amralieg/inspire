// REQ-510 L2 (declutter after REQ-508): Home, Start, Generate data and Setup say less and show one main action each; the extras sit in
// a More menu (briefs/req510_spec.md sections 2.1-2.4). Measured at 1440x900 with screenFacts (req510Declutter.mjs).
// Fail-pre (a037bfdfb): Home 78 body words above the fold; Start 177 words, no primary action, View all and the all-runs panel inline,
// and a bare trash icon on every run row; Generate data 143 words; Setup paints the current step dot in the primary red, so the
// screen shows 2 primaries (Connect and Continue).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_SESSIONS } from './reviewFixtures.js';
import { describe, itemsOf, screenFacts, shownOutsideMenus } from './req510Declutter.mjs';

test.after(closeBrowser);

async function open(name, state = {}, opts = {}) {
  const ui = await openUi(name, state, '', opts);
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.locator('h1').first().waitFor({ timeout: 20000 });
  return ui;
}
const settle = (page) => page.waitForTimeout(1500);

test('Home: at most 60 words of body copy above the fold, and Get Started is the one start button there', async () => {
  const ui = await open('landing');
  const { page } = ui;
  try {
    await settle(page);
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 60, `Home body words ${f.bodyWords} > 60 (${describe(f)})`);
    assert.equal(f.controls.filter((c) => c === 'Get Started').length, 1, `one Get Started above the fold (${describe(f)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start: at most 60 words above the fold and exactly one primary action, "Start New Discovery"', async () => {
  const ui = await open('choose', { sessions: REVIEW_SESSIONS });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await settle(page);
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 60, `Start body words ${f.bodyWords} > 60 (${describe(f)})`);
    assert.equal(f.primaries.length, 1, `exactly one primary on Start (${describe(f)})`);
    assert.match(f.primaries[0], /^Start New Discovery/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start: "View all runs" and "Value across all runs" move into the page More menu; the all-runs panel opens from it', async () => {
  const ui = await open('choose', { sessions: REVIEW_SESSIONS });
  const { page } = ui;
  try {
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    const items = await itemsOf(page, page, /^More$/);
    assert.ok(items, 'Start has one More menu');
    for (const want of ['View all runs', 'Value across all runs']) assert.ok(items.includes(want), `More holds "${want}" (got ${JSON.stringify(items)})`);
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /^View all/ })), 0, 'View all is no longer an inline link');
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /ACROSS ALL RUNS/i })), 0, 'the all-runs panel is folded away');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Value across all runs' }).click();
    await page.getByText(/across all runs/i).first().waitFor({ timeout: 10000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start rows: Delete run (and Quick view where offered) move into the row More menu; delete still confirms or cancels', async () => {
  const ui = await open('choose', { sessions: REVIEW_SESSIONS });
  const { page } = ui;
  try {
    const row = page.locator('[data-run="42"]');
    await row.waitFor({ timeout: 20000 });
    // The bare icon is opacity-0 until hover, so count it in the DOM, not by visibility.
    assert.equal(await page.locator('[data-run] button[title="Delete run"]').count(), 0, 'no bare trash icon on the rows (shown or hover-only)');
    const items = await itemsOf(page, row, /^More for /);
    assert.ok(items && items.includes('Delete run'), `row 42 More holds Delete run (got ${JSON.stringify(items)})`);
    const gamma = await itemsOf(page, page.locator('[data-run="51"]'), /^More for /);
    assert.ok(gamma && gamma.includes('Quick view'), `row 51 More holds Quick view (got ${JSON.stringify(gamma)})`);
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /^Quick View$/ })), 0, 'no inline Quick View button');
    await row.getByRole('button', { name: /^More for / }).click();
    await page.getByRole('menuitem', { name: 'Delete run' }).click();
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await row.waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Generate data: at most 60 words above the fold, one primary "Generate data & run Inspire"', async () => {
  const ui = await open('generate');
  const { page } = ui;
  try {
    await settle(page);
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 60, `Generate data body words ${f.bodyWords} > 60 (${describe(f)})`);
    assert.deepEqual(f.primaries, ['Generate data & run Inspire'], `one primary (${describe(f)})`);
  } finally {
    await ui.close();
  }
});

test('Setup: one primary (Continue); the current step dot is primary-subtle, not a second red button', async () => {
  const ui = await open('setup', {}, { mount: (app) => {
    app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', isDatabricksApp: false }));
  } });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 15000 });
    await settle(page);
    const f = await screenFacts(page);
    assert.deepEqual(f.primaries, ['Continue'], `Setup shows one primary (${describe(f)})`);
    assert.ok(f.bodyWords <= 40, `Setup body words ${f.bodyWords} > 40`);
  } finally {
    await ui.close();
  }
});
