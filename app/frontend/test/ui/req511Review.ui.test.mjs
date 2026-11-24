// REQ-511 / REQ-512 Review fail-first: the Review list as wireframe A6 (~/claude/inspire/wireframes/req511_review_A6.html).
// Contract: each use case is one row [data-use-case-row] in region "Use case list" (data-use-case-no / data-use-case-id kept), in this column order:
// tick | # | favourite | name (>= 17px, Rename pencil, statement, chips) | Build MVP | Generate docs | score box [data-score-box] | value box [data-value-box].
// No Domain or MVP column. Headers are buttons with aria-sort (#, Use case, MVP, Docs, Score, Value); Docs sorts by docs_generated_at (R3 field, mocked). An empty value box is the dashed [data-value-calculate].
// Ticking rows shows role=toolbar "Actions for the selected use cases" with Build MVP / Generate docs / Calculate value for N and Clear.
// The run box [data-run-box] (region "This run") holds the run name and [data-run-total-value]; there is no Build next panel, and the run name/total hooks ([data-run-heading], [data-run-header-value]) only live inside the run box.
// A row click opens the reader [data-review-reader] with the full use case. Nothing overlaps at 1440 and 1280, and no max-width cap below 1300px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const DOCS_MADE = 'N01-U03';
const SCORES = { 'N01-U01': '7.4', 'N01-U02': '8.1', 'N01-U03': '5.2', 'N01-U04': '6.0', 'N02-U01': '9.0', 'N02-U02': '4.5' };
const SCORED = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => ({ ...u, inspire_score: SCORES[u.No] })) })) };
const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 6, n_calculated: 1, n_estimated: 2, n_none: 3,
    by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 3200000 }, { currency: 'USD', verb: 'GROW REVENUE', amount: 2400000 }, { currency: 'USD', verb: 'REDUCE COST', amount: 1100000 }] },
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
const renameRoute = (posted) => async (page) => {
  await page.route('**/api/inspire/usecase-name', async (route) => {
    posted.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, name: posted.at(-1).name }) });
  });
  // R3 field (mocked here): GET /api/inspire/usecases carries docs_generated_at for the use cases that have generated docs.
  await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    const rows = (body.usecases || []).filter((r) => String(r.id) !== DOCS_MADE);
    rows.push({ ...((body.usecases || []).find((r) => String(r.id) === DOCS_MADE) || { id: DOCS_MADE, session_id: 42, use_case: 'Segment shoppers', Name: 'Segment shoppers' }),
      docs_generated_at: '2026-11-23T10:00:00Z' });
    await route.fulfill({ response, json: { ...body, usecases: rows } });
  });
};

async function openReview({ width = 1440, height = 900, posted = [] } = {}) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: SCORED }, '', { mount, init: renameRoute(posted) });
  await ui.page.setViewportSize({ width, height });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
  const row = (no) => list.locator(`[data-use-case-row][data-use-case-no="${no}"]`);
  return { ui, page: ui.page, list, row, posted };
}
const order = (list) => list.locator('[data-use-case-row]').evaluateAll((els) => els.map((e) => e.dataset.useCaseNo));
const box = async (loc) => { const b = await loc.boundingBox(); assert.ok(b, 'element is visible'); return b; };

test('1: every use case is one row with its number and id, the name is at least 17px, and the old cards are gone', async () => {
  const { ui, list } = await openReview();
  try {
    const rows = list.locator('[data-use-case-row]');
    assert.equal(await rows.count(), 6);
    for (const r of await rows.all()) {
      assert.ok(await r.getAttribute('data-use-case-no'), 'data-use-case-no kept');
      assert.ok(await r.getAttribute('data-use-case-id'), 'data-use-case-id kept');
    }
    const font = await rows.first().locator('[data-row-name]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(font >= 17, `name font ${font}px >= 17px`);
    assert.equal(await list.locator('[aria-expanded]').count(), 0, 'no collapsed cards in the list');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: A6 column order: name, Build MVP, Generate docs, score box, value box on one line; no Domain or MVP status column', async () => {
  const { ui, row, list } = await openReview();
  try {
    const r = row('N01-U02');
    const name = await box(r.locator('[data-row-name]'));
    const build = await box(r.getByRole('button', { name: /^Build MVP$/ }));
    const docs = await box(r.getByRole('button', { name: /^Generate docs$/ }));
    const score = await box(r.locator('[data-score-box]'));
    const value = await box(r.locator('[data-value-box]'));
    assert.ok(name.x + name.width <= build.x, 'Build MVP is right of the name');
    assert.ok(build.x + build.width <= docs.x, 'Generate docs is right of Build MVP');
    assert.ok(docs.x + docs.width <= score.x, 'the score box is right of Generate docs');
    assert.ok(score.x + score.width <= value.x, 'the value box is right of the score box');
    const mid = (b) => b.y + b.height / 2;
    for (const [label, b] of [['Build MVP', build], ['Generate docs', docs], ['value box', value]]) {
      assert.ok(Math.abs(mid(b) - mid(score)) <= score.height / 2, `${label} sits on the same line as the score box`);
    }
    assert.ok(build.y >= name.y - 40 && build.y < name.y + name.height + 40, 'Build MVP is in its own column, not stacked under the name');
    const heads = (await list.locator('button[aria-sort]').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, '').trim());
    for (const h of ['#', 'Use case', 'MVP', 'Docs', 'Score', 'Value']) assert.ok(heads.some((t) => t.toLowerCase().startsWith(h.toLowerCase())), `sortable header ${h} in ${JSON.stringify(heads)}`);
    assert.ok(!heads.some((t) => /^domain/i.test(t)), 'no Domain column');
  } finally { await ui.close(); }
});

test('3: the Rename pencil edits the name inline; Enter POSTs the new name and the row shows it', async () => {
  const posted = [];
  const { ui, page, row } = await openReview({ posted });
  try {
    const r = row('N01-U02');
    await r.getByRole('button', { name: 'Rename Score upsell' }).click();
    const field = r.getByRole('textbox', { name: 'Use case name for Score upsell' });
    await field.fill('Upsell propensity');
    await field.press('Enter');
    await until(async () => posted.length === 1, 'the rename POST');
    assert.equal(posted[0].name, 'Upsell propensity');
    await until(async () => (await r.locator('[data-row-name]').innerText()).trim() === 'Upsell propensity', 'the row shows the new name');
    assert.deepEqual(ui.pageErrors, []);
    void page;
  } finally { await ui.close(); }
});

test('4: the row Build MVP opens the Genie MVP wizard and the row Generate docs opens Generate documents for that use case', async () => {
  const { ui, page, row } = await openReview();
  try {
    await row('N01-U02').getByRole('button', { name: /^Build MVP$/ }).click();
    const wizard = page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
    await wizard.waitFor({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await wizard.waitFor({ state: 'hidden' });
    await row('N01-U03').getByRole('button', { name: /^Generate docs$/ }).click();
    const docs = page.getByRole('dialog', { name: 'Generate documents' });
    await docs.waitFor({ timeout: 10000 });
    assert.match(await docs.innerText(), /Segment shoppers|1 use case/);
  } finally { await ui.close(); }
});

test('5: a use case with no value shows the dashed Calculate value box, and it opens the calculator for that use case', async () => {
  const { ui, page, row } = await openReview();
  try {
    const calc = row('N01-U04').locator('[data-value-calculate]');
    await calc.waitFor({ timeout: 10000 });
    assert.equal(await calc.evaluate((e) => getComputedStyle(e).borderTopStyle), 'dashed');
    assert.match(await calc.innerText(), /Calculate value/i);
    assert.equal(await row('N01-U01').locator('[data-value-calculate]').count(), 0, 'a valued use case shows its amount, not Calculate');
    await calc.click();
    await page.getByRole('dialog', { name: /^Calculating Value at Stake for / }).waitFor({ timeout: 10000 });
  } finally { await ui.close(); }
});

test('6: Score and Value headers sort the rows both ways and say so in aria-sort', async () => {
  const { ui, list } = await openReview();
  try {
    const byScore = (nos) => nos.map((n) => Number(SCORES[n]));
    const head = list.locator('button[aria-sort]').filter({ hasText: /^Score/ });
    await head.click();
    const first = await order(list);
    const dir = await head.getAttribute('aria-sort');
    assert.ok(['ascending', 'descending'].includes(dir), `aria-sort ${dir}`);
    const s1 = byScore(first);
    const sorted = [...s1].sort((a, b) => (dir === 'ascending' ? a - b : b - a));
    assert.deepEqual(s1, sorted, `rows follow ${dir} score`);
    await head.click();
    assert.deepEqual(byScore(await order(list)), [...sorted].reverse(), 'a second click reverses');
    const valueHead = list.locator('button[aria-sort]').filter({ hasText: /^Value/ });
    await valueHead.click();
    const amount = (n) => TOTALS.use_cases[n].amount || 0;
    const v = (await order(list)).map(amount);
    const vdir = await valueHead.getAttribute('aria-sort');
    assert.deepEqual(v, [...v].sort((a, b) => (vdir === 'ascending' ? a - b : b - a)), `rows follow ${vdir} value`);
  } finally { await ui.close(); }
});

test('7: ticking 2 rows shows the bulk toolbar with Build MVP, Generate docs and Calculate value for 2, and Clear hides it', async () => {
  const { ui, page, row } = await openReview();
  try {
    await row('N01-U02').getByRole('checkbox').first().check();
    await row('N01-U03').getByRole('checkbox').first().check();
    const bar = page.getByRole('toolbar', { name: 'Actions for the selected use cases' });
    await bar.waitFor({ timeout: 10000 });
    assert.match(await bar.innerText(), /2 selected/);
    for (const name of [/^Build MVP for 2/, /^Generate docs for 2/, /^Calculate value for 2/, /^Clear/]) await bar.getByRole('button', { name }).waitFor();
    await bar.getByRole('button', { name: /^Clear/ }).click();
    await bar.waitFor({ state: 'hidden' });
  } finally { await ui.close(); }
});

test('8: the run box holds the run name and its yearly value; Build next and the old run heading are gone', async () => {
  const { ui, page } = await openReview();
  try {
    const runBox = page.getByRole('region', { name: 'This run' });
    await runBox.locator('[data-run-total-value]').waitFor({ timeout: 10000 });
    assert.equal(await runBox.getAttribute('data-run-box'), '');
    assert.match(await runBox.innerText(), /Acme/);
    assert.match(await runBox.locator('[data-run-total-value]').innerText(), /\$6\.7M/);
    assert.equal(await page.locator('[data-build-next]').count(), 0, 'no Build next panel');
    assert.equal(await page.locator('[data-run-heading], [data-run-header-value]').count(), await runBox.locator('[data-run-heading], [data-run-header-value]').count(),
      'the run name and total left the header: any old hook lives inside the run box');
  } finally { await ui.close(); }
});

const overlapProbe = (page) => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const bad = [];
  for (const row of document.querySelectorAll('[data-use-case-row]')) {
    const leaves = [...row.querySelectorAll('button, input, [data-row-name], [data-score-box] *, [data-value-box] *, span, p, b, small')]
      .filter((e) => vis(e) && !e.closest('svg') && (e.matches('button, input') || (e.children.length === 0 && e.textContent.trim())));
    for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j]; if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) bad.push(`${row.dataset.useCaseNo}: ${a.textContent.trim().slice(0, 20)} x ${b.textContent.trim().slice(0, 20)}`);
    }
    for (const vb of row.querySelectorAll('[data-value-box], [data-score-box]')) {
      const R = vb.getBoundingClientRect();
      for (const c of vb.querySelectorAll('*')) { if (!vis(c)) continue; const r = c.getBoundingClientRect(); if (r.left < R.left - 0.5 || r.right > R.right + 0.5 || r.top < R.top - 0.5 || r.bottom > R.bottom + 0.5) bad.push(`${row.dataset.useCaseNo}: ${c.textContent.trim().slice(0, 20)} leaves its box`); }
    }
  }
  return bad;
});

test('9: nothing overlaps in any row at 1440 and 1280, and the page does not scroll sideways at 1280', async () => {
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    const { ui, page } = await openReview({ width, height });
    try {
      await page.locator('[data-use-case-row] [data-value-box]').first().waitFor({ timeout: 10000 });
      assert.deepEqual(await overlapProbe(page), [], `no overlaps at ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no sideways scroll at ${width}`);
    } finally { await ui.close(); }
  }
});

test('10: the list is full width: no ancestor caps it below 1300px', async () => {
  const { ui, list } = await openReview();
  try {
    const caps = await list.evaluate((el) => { const out = []; for (let p = el; p && p !== document.body; p = p.parentElement) { const m = parseFloat(getComputedStyle(p).maxWidth); if (Number.isFinite(m) && m < 1300) out.push(`${p.tagName}.${p.className}`.slice(0, 80) + ` ${m}px`); } return out; });
    assert.deepEqual(caps, []);
  } finally { await ui.close(); }
});

test('11: a row click opens the reader with the whole use case; Close puts the list back', async () => {
  const { ui, page, row } = await openReview();
  try {
    await row('N01-U02').locator('[data-row-name]').click();
    const reader = page.locator('[data-review-reader]');
    await reader.waitFor({ timeout: 10000 });
    const t = await reader.innerText();
    for (const s of ['Score upsell', 'Score upsell for the business', 'Build score upsell', 'Score upsell pays back']) assert.ok(t.includes(s), `reader shows "${s}"`);
    await reader.getByRole('button', { name: /^Close/ }).click();
    await reader.waitFor({ state: 'hidden' });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('12: the Docs column marks the use cases with generated docs and sorts by it both ways', async () => {
  const { ui, list, row } = await openReview();
  try {
    await row(DOCS_MADE).locator('[data-docs-made]').waitFor({ timeout: 10000 });
    assert.equal(await list.locator('[data-docs-made]').count(), 1, 'only the use case with docs is marked');
    const head = list.locator('button[aria-sort]').filter({ hasText: /^Docs/ });
    await head.click();
    const a = await order(list);
    assert.ok(a[0] === DOCS_MADE || a.at(-1) === DOCS_MADE, `docs first or last: ${a}`);
    await head.click();
    const b = await order(list);
    assert.ok(b[0] === DOCS_MADE ? a.at(-1) === DOCS_MADE : a[0] === DOCS_MADE, `a second click flips: ${a} then ${b}`);
    assert.notEqual(await head.getAttribute('aria-sort'), 'none');
  } finally { await ui.close(); }
});
