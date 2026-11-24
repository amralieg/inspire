// REQ-433 and REQ-434: the Results page asks to refine an out-of-order score, Apply stores it, Undo restores it, Keep dismisses the banner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { VALUE_DISCLAIMER } from '../../src/lib/valueLabels.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const entry = (amount) => ({ verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }],
  basis: { sampled_records: 1200, eligible_records: 48000, days: 90 } });
const results = (belowBar = '') => {
  const out = structuredClone(REVIEW_RESULTS);
  for (const domain of out.domains) {
    for (const u of domain.use_cases) {
      // The pair sits in one tier of the default order: neither is a Best of Best, both meet the bar.
      if (u.No === 'N01-U01' || u.No === 'N01-U02') { u.best_of_best = 'N'; delete u.best_of_best_rank; }
      if (u.No === 'N01-U01') u.inspire_score = '9.0';
      if (u.No === 'N01-U02') u.inspire_score = '8.5';
      if (belowBar && u.No === belowBar) u.meets_quality_bar = 'N';
    }
  }
  return out;
};
const posts = [];
// REQ-433: how the next POST answers: 'ok', 'hold' (stays open until release[kind]() is called) or 'fail' (HTTP 500).
const mode = { apply: 'ok', undo: 'ok' };
const release = {};
const reset = () => { posts.length = 0; mode.apply = 'ok'; mode.undo = 'ok'; };
const answer = async (kind, req, res, ok) => {
  posts.push([kind, req.body]);
  if (mode[kind] === 'hold') await new Promise((resolve) => { release[kind] = resolve; });
  if (mode[kind] === 'fail') return res.status(500).json({ error: 'The warehouse write failed.' });
  return res.json(ok);
};
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: { 'N01-U01': entry(1e6), 'N01-U02': entry(3e6) } }));
  app.post('/api/inspire/score-refine', (req, res) => answer('apply', req, res, { applied: req.body.changes.map((c) => ({ use_case_id: c.use_case_id, score: c.score, from: c.from })) }));
  app.post('/api/inspire/score-refine/undo', (req, res) => answer('undo', req, res, { restored: req.body.use_case_ids }));
};
const open = () => openUi('results', { ...REVIEW_STATE, results: results() }, '', { mount });
const scoreOf = (page, name) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').filter({ hasText: name }).locator('[title^="Inspire composite score"]').first();

test('the banner names the pair, previews old to new, and carries the full disclaimer', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 15000 });
    const text = (await banner.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /Score upsell is worth \$3M a year, 3 times Predict churn \(\$1M a year\)/);
    assert.match(text, /Refine its score to 9\.05 so the order follows the value\?/);
    assert.match(text, /8\.5\s*(→|->)\s*9\.05/);
    assert.ok(text.includes(VALUE_DISCLAIMER), 'the refine banner carries the full disclaimer');
    for (const name of ['Apply', 'Keep']) assert.equal(await banner.getByRole('button', { name, exact: true }).count(), 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Apply stores the new score and shows "Refined from 8.5"; Undo restores it', async () => {
  reset();
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator('[title*="Refined from 8.5"]').first().waitFor({ timeout: 15000 });
    assert.equal(posts.length, 1);
    assert.equal(posts[0][0], 'apply');
    const [change] = posts[0][1].changes;
    assert.deepEqual([change.use_case_id, change.score, change.from], ['N01-U02', 9.05, 8.5]);
    assert.ok(String(change.reason).length > 10, 'the reason travels with the change');
    assert.equal((await scoreOf(page, 'Score upsell').innerText()).replace(/\s+/g, ' ').trim().endsWith('9.05 score'), true, 'REQ-438 v8 score box: INSPIRE / number / score');
    await banner.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[title*="Refined from"]'), null, { timeout: 15000 });
    assert.deepEqual(posts[1], ['undo', { ...posts[1][1], use_case_ids: ['N01-U02'] }]);
    assert.equal((await scoreOf(page, 'Score upsell').innerText()).replace(/\s+/g, ' ').trim().endsWith('8.5 score'), true, 'REQ-438 v8 score box: INSPIRE / number / score');
  } finally {
    await ui.close();
  }
});

test('Keep dismisses the banner and changes no score', async () => {
  reset();
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.getByRole('button', { name: 'Keep', exact: true }).click();
    await banner.waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(posts.length, 0);
    assert.equal(await page.locator('[title*="Refined from"]').count(), 0);
  } finally {
    await ui.close();
  }
});

// REQ-433: after a reload the banner is gone, but the score stays "Refined from 8.5", so the card offers Undo from the stored history.
const openReloaded = () => openUi('results', { ...REVIEW_STATE, results: results(),
  useCases: [{ No: 'N01-U02', id: 'N01-U02', inspire_score: 8.5, refined_score: 9.05, refined_from: 8.5 }] }, '', { mount });

test('after a reload the refined score still offers Undo on its card, and Undo restores the first score', async () => {
  reset();
  const ui = await openReloaded();
  const { page } = ui;
  try {
    await page.locator('[title*="Refined from 8.5"]').first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('region', { name: 'Score refinement' }).count(), 0, 'no banner after a reload');
    const undo = page.getByRole('button', { name: 'Undo refined score', exact: true });
    assert.equal(await undo.count(), 1, 'the refined card offers Undo');
    await undo.click();
    await page.waitForFunction(() => !document.querySelector('[title*="Refined from"]'), null, { timeout: 15000 });
    assert.deepEqual(posts, [['undo', { ...posts[0][1], use_case_ids: ['N01-U02'] }]]);
    assert.equal((await scoreOf(page, 'Score upsell').innerText()).replace(/\s+/g, ' ').trim().endsWith('8.5 score'), true, 'REQ-438 v8 score box: INSPIRE / number / score');
    assert.equal(await page.getByRole('button', { name: 'Undo refined score', exact: true }).count(), 0, 'Undo is gone once restored');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const cardNames = (page) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').allInnerTexts();
const rowOf = (names, name) => names.findIndex((t) => t.includes(name));

test('REQ-433: a pair in different quality-bar tiers shows no banner', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: results('N01-U01') }, '', { mount });
  try {
    await scoreOf(ui.page, 'Score upsell').waitFor({ timeout: 15000 });
    assert.equal(await ui.page.getByRole('region', { name: 'Score refinement' }).count(), 0);
  } finally {
    await ui.close();
  }
});

test('REQ-433: in one tier Apply moves the refined card above its partner', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 15000 });
    const before = await cardNames(page);
    assert.ok(rowOf(before, 'Predict churn') >= 0 && rowOf(before, 'Score upsell') >= 0);
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.locator('[title*="Refined from 8.5"]').first().waitFor({ timeout: 15000 });
    const after = await cardNames(page);
    assert.ok(rowOf(after, 'Score upsell') < rowOf(after, 'Predict churn'), 'the refined card sits above its partner');
  } finally {
    await ui.close();
  }
});

// REQ-433: the cards reorder on the click; the write follows and is undone on screen only if it fails.
const waitPosts = (n) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (posts.length >= n ? resolve() : Date.now() - t0 > 15000 ? reject(new Error('the POST never arrived')) : setTimeout(tick, 25));
  tick();
});
const refinedAbove = (names) => rowOf(names, 'Score upsell') < rowOf(names, 'Predict churn');

test('REQ-433: Apply reorders the cards before the write answers, and the order stays after it answers', async () => {
  reset(); mode.apply = 'hold';
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 15000 });
    assert.equal(refinedAbove(await cardNames(page)), false, 'before Apply the partner is first');
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await waitPosts(1);
    await page.waitForFunction(() => document.querySelector('[title*="Refined from 8.5"]'), null, { timeout: 5000 });
    assert.equal(refinedAbove(await cardNames(page)), true, 'the refined card is above its partner while the write is still open');
    assert.equal(await banner.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'the banner shows it is saving');
    release.apply();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Undo' && !b.disabled), null, { timeout: 15000 });
    assert.equal(refinedAbove(await cardNames(page)), true, 'the order holds after the write answers');
  } finally {
    await ui.close();
  }
});

test('REQ-433: Apply answered with 500 restores the order, shows the error and offers Apply again', async () => {
  reset(); mode.apply = 'fail';
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.waitFor({ timeout: 15000 });
    const before = await cardNames(page);
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await banner.getByRole('alert').waitFor({ timeout: 15000 });
    assert.deepEqual(await cardNames(page), before, 'the order is the one before Apply');
    assert.equal(await page.locator('[title*="Refined from"]').count(), 0, 'no score reads refined');
    assert.match(await banner.getByRole('alert').innerText(), /warehouse write failed/i);
    const again = banner.getByRole('button', { name: 'Apply', exact: true });
    assert.equal(await again.count(), 1);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Apply' && !b.disabled), null, { timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('REQ-433: Undo reorders the cards before the write answers', async () => {
  reset();
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Undo' && !b.disabled), null, { timeout: 15000 });
    const original = await cardNames(page).then((n) => !refinedAbove(n));
    assert.equal(original, false, 'the refined order is showing');
    mode.undo = 'hold';
    await banner.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitPosts(2);
    await page.waitForFunction(() => !document.querySelector('[title*="Refined from"]'), null, { timeout: 5000 });
    assert.equal(refinedAbove(await cardNames(page)), false, 'the order is back while the undo write is still open');
    release.undo();
    await page.waitForFunction(() => !document.querySelector('[title*="Refined from"]'), null, { timeout: 15000 });
    assert.equal(refinedAbove(await cardNames(page)), false, 'the order holds after the undo answers');
  } finally {
    await ui.close();
  }
});

test('REQ-433: Undo answered with 500 brings the refined order back and shows the error', async () => {
  reset();
  const ui = await open();
  const { page } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Score refinement' });
    await banner.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Undo' && !b.disabled), null, { timeout: 15000 });
    mode.undo = 'fail';
    await banner.getByRole('button', { name: 'Undo', exact: true }).click();
    await banner.getByRole('alert').waitFor({ timeout: 15000 });
    assert.equal(refinedAbove(await cardNames(page)), true, 'the refined order is back');
    assert.ok(await page.locator('[title*="Refined from 8.5"]').count() >= 1, 'the score reads refined again');
    assert.match(await banner.getByRole('alert').innerText(), /warehouse write failed/i);
    assert.equal(await banner.getByRole('button', { name: 'Undo', exact: true }).count(), 1, 'the banner offers Undo again');
  } finally {
    await ui.close();
  }
});
