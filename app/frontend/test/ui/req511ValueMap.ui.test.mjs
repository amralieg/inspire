// REQ-511 / REQ-512 value map fail-first: Amr's Review pick "in the business page, add the value map graph, I liked it" (wireframe A6, Business tab).
// Contract: the Overview shows [data-value-map] (region "Value map"): one point per use case, x = Inspire score, y = yearly value.
// Each point is a button [data-map-point][data-use-case-no] named "<name>, <$ a year or No value yet>, score <n>"; a point with no value is
// hollow (data-valued="false", transparent fill) and sits on the floor. Domain legend chips (aria-pressed) filter the points.
// Clicking a point goes to that use case in the Use cases view through the existing openUseCase / onRunValueRow props of ResultsBusiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const SCORES = { 'N01-U01': '7.4', 'N01-U02': '8.1', 'N01-U03': '5.2', 'N01-U04': '6.0', 'N02-U01': '9.0', 'N02-U02': '4.5' };
const SCORED = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => ({ ...u, inspire_score: SCORES[u.No] })) })) };
const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 6, n_calculated: 1, n_estimated: 2, n_none: 3, by_verb: [] },
  use_cases: { 'N01-U01': entry('calculated', 'AVOID RISK', 3200000), 'N01-U02': entry('estimated', 'GROW REVENUE', 2400000),
    'N01-U03': entry('estimated', 'REDUCE COST', 1100000), 'N01-U04': entry('none'), 'N02-U01': entry('none'), 'N02-U02': entry('none') },
};
function mount(app) {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
}
async function openMap() {
  const ui = await openUi('results', { ...REVIEW_STATE, results: SCORED }, '', { mount });
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await toView(ui.page, 'Overview');
  const map = ui.page.getByRole('region', { name: 'Value map' });
  await map.locator('[data-map-point]').first().waitFor({ timeout: 15000 });
  return { ui, page: ui.page, map, point: (no) => map.locator(`[data-map-point][data-use-case-no="${no}"]`) };
}

test('1: the Overview shows the value map with one named point per use case, wide enough to read', async () => {
  const { ui, map, point } = await openMap();
  try {
    assert.equal(await map.getAttribute('data-value-map'), '');
    assert.equal(await map.locator('[data-map-point]').count(), 6);
    const name = await point('N01-U01').getAttribute('aria-label');
    assert.match(name, /Predict churn/);
    assert.match(name, /\$3\.2M/);
    assert.match(name, /score 7\.4/);
    assert.match(await point('N01-U04').getAttribute('aria-label'), /Price elasticity.*No value yet.*score 6(\.0)?/);
    const b = await map.boundingBox();
    assert.ok(b.width >= 600, `map width ${b.width} >= 600 at 1440`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: x follows the score and y the value; a use case with no value is a hollow point on the floor', async () => {
  const { ui, point } = await openMap();
  try {
    const c = async (no) => { const r = await point(no).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const top = await c('N02-U01'); const low = await c('N02-U02');
    assert.ok(top.x > low.x, 'score 9.0 sits right of score 4.5');
    const big = await c('N01-U01'); const small = await c('N01-U03');
    assert.ok(big.y < small.y, '$3.2M sits above $1.1M');
    const none = await c('N01-U04');
    assert.ok(none.y > small.y, 'no value sits below every valued point');
    assert.equal(await point('N01-U04').getAttribute('data-valued'), 'false');
    assert.equal(await point('N01-U01').getAttribute('data-valued'), 'true');
    const fill = await point('N01-U04').evaluate((e) => { const s = e.matches('circle, path, rect') ? e : e.querySelector('circle, path, rect') || e; const cs = getComputedStyle(s); return `${cs.fill}|${cs.fillOpacity}|${cs.backgroundColor}`; });
    assert.match(fill, /none|transparent|rgba\(0, 0, 0, 0\)|\|0\|/, `hollow point: ${fill}`);
  } finally { await ui.close(); }
});

test('3: a domain chip filters the points, and a second press shows them all again', async () => {
  const { ui, map } = await openMap();
  try {
    const chip = map.getByRole('button', { name: /^Supply/ });
    await chip.click();
    assert.equal(await chip.getAttribute('aria-pressed'), 'true');
    assert.equal(await map.locator('[data-map-point]:visible').count(), 2, 'only the 2 Supply use cases');
    await chip.click();
    assert.equal(await map.locator('[data-map-point]:visible').count(), 6);
  } finally { await ui.close(); }
});

test('4: clicking a valued point opens that use case in the Use cases view; a point with no value lands on its Calculate value box', async () => {
  const { ui, page, point } = await openMap();
  try {
    await point('N01-U02').click();
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-no="N01-U02"]').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: 'Close the reader' }).click(); // REQ-511 A6: the opened use case sits in the reader over the right of the page and covers the map
    await toView(page, 'Overview');
    await page.getByRole('region', { name: 'Value map' }).locator('[data-map-point][data-use-case-no="N01-U04"]').click();
    const target = list.locator('[data-use-case-no="N01-U04"]').first();
    await target.waitFor({ state: 'visible', timeout: 10000 });
    await target.locator('[data-value-calculate]').waitFor({ state: 'visible', timeout: 10000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
