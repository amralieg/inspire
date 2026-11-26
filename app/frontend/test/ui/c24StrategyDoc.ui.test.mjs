// C24 (RC7-B-13, REQ-121): a finished run always gets one strategy PDF, built by the App when Results opens and no strategy PDF is listed.
// Every use case of the run, grouped by strategy objective (no objective: "Other use cases"), saved once through the docs save route.
// There is no button and no agent writer (the FX-116 guards stay as they are).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { trackingIdOf } from '../../src/lib/useCaseFields.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const ROOT = `${GENERATED}/acme`;
const sessionsWith = (extra = {}) => REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English', ...extra } : s));
const STRATEGY = { name: 'Acme_strategy.pdf', path: `${ROOT}/Acme_strategy.pdf`, is_directory: false, file_size: 90000, modified_at: Date.UTC(2026, 10, 24) };
const OTHER = { name: 'Acme_use_cases.xlsx', path: `${ROOT}/Acme_use_cases.xlsx`, is_directory: false, file_size: 40000 };
const NAMES = ['Predict churn', 'Score upsell', 'Segment shoppers', 'Price elasticity', 'Forecast stock', 'Spot late suppliers'];
const OBJECTIVES = ['Keep customers', 'Sell more'];
const rowsOf = (results) => results.domains.flatMap((d) => d.use_cases);

function backend({ files = [OTHER], failSave = false } = {}) {
  const calls = { saves: [], lists: 0, failSave };
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.get('/api/workspace/list', (req, res) => { calls.lists += 1; res.json({ files: /\/inspire_out\/acme\/?$/.test(String(req.query.path || '')) ? files : [] }); });
    app.post('/api/inspire/docs/save', (req, res) => {
      calls.saves.push(req.body);
      if (calls.failSave) { res.status(502).json({ error: 'The file could not be saved (HTTP 500).' }); return; }
      res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 });
    });
  };
  return { calls, mount };
}
const openRun = (be, { results = REVIEW_RESULTS, session = {} } = {}) => openUi('results', { ...REVIEW_STATE, sessions: sessionsWith(session), results }, '', { mount: be.mount });
const settle = async (page, calls, ms = 3000) => { await toView(page, 'Assets'); const end = Date.now() + 15000; while (calls.lists < 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, ms)); };
const waitFor = async (check, what, timeout = 30000) => { const end = Date.now() + timeout; while (!check()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 100)); } };

test('(1) a finished run with no strategy PDF listed: exactly one save, a strategy .pdf with every use case and the objective headings', async () => {
  const be = backend();
  const ui = await openRun(be);
  try {
    await toView(ui.page, 'Assets');
    await waitFor(() => be.calls.saves.length > 0, 'the strategy document is saved');
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(be.calls.saves.length, 1, 'one save call');
    const [save] = be.calls.saves;
    assert.match(save.name, /strategy.*\.pdf$/i);
    assert.equal(save.folder, GENERATED, 'saved into the run Assets folder');
    assert.equal(Buffer.from(save.content_base64, 'base64').subarray(0, 4).toString(), '%PDF');
    assert.ok(!save.use_case_ids || save.use_case_ids.length === 0, 'it does not mark use cases as documented');
    // The PDF pages are pictures, so the words are checked on the pages the module draws for the same run.
    const { strategyPagesSvg } = await import('../../src/lib/strategyDoc.js');
    const useCases = rowsOf(REVIEW_RESULTS);
    const svg = strategyPagesSvg({ businessName: 'Acme', useCases, values: {}, summary: [], foundations: REVIEW_RESULTS.foundations }).join('\n');
    for (const n of NAMES) assert.ok(svg.includes(n), `${n} is in the document`);
    for (const o of [...OBJECTIVES, 'Other use cases']) assert.ok(svg.includes(o), `heading ${o}`);
    assert.ok(useCases.every((u) => svg.includes(trackingIdOf(u))), 'every use case id appears');
    assert.ok(/Databricks AI/.test(svg) || !/Genie Code/.test(svg), 'the product wording rule holds');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('(2) a strategy PDF already listed: no save call', async () => {
  const be = backend({ files: [STRATEGY, OTHER] });
  const ui = await openRun(be);
  try {
    await settle(ui.page, be.calls);
    assert.equal(be.calls.saves.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('(3) opening Assets twice and re-rendering still saves once', async () => {
  const be = backend();
  const ui = await openRun(be);
  try {
    await toView(ui.page, 'Assets');
    await waitFor(() => be.calls.saves.length > 0, 'the first save');
    await toView(ui.page, 'Use cases');
    await toView(ui.page, 'Assets');
    await ui.page.setViewportSize({ width: 1100, height: 800 });
    await new Promise((r) => setTimeout(r, 3000));
    assert.equal(be.calls.saves.length, 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('(4) a failed run and a run with zero use cases: no save call', async () => {
  const failed = backend();
  const a = await openRun(failed, { session: { processing_status: 'failed' } });
  try { await settle(a.page, failed.calls); assert.equal(failed.calls.saves.length, 0, 'failed run'); } finally { await a.ui?.close?.(); await a.close(); }
  const none = backend();
  const b = await openRun(none, { results: { ...REVIEW_RESULTS, domains: [] } });
  try { await settle(b.page, none.calls); assert.equal(none.calls.saves.length, 0, 'zero use cases'); } finally { await b.close(); }
});

test('(5) a save that fails shows one Retry line and the page stays usable; Retry saves', async () => {
  const be = backend({ failSave: true });
  const ui = await openRun(be);
  try {
    await toView(ui.page, 'Assets');
    const line = ui.page.locator('[data-strategy-doc-failed]');
    await line.waitFor({ timeout: 30000 });
    assert.equal(await line.count(), 1, 'one line');
    const retry = line.getByRole('button', { name: 'Retry' });
    assert.equal(await retry.count(), 1);
    await toView(ui.page, 'Use cases');
    assert.ok(await ui.page.getByRole('region', { name: 'Use case list' }).isVisible(), 'the page is usable');
    await toView(ui.page, 'Assets');
    be.calls.failSave = false;
    const before = be.calls.saves.length;
    await retry.click();
    await waitFor(() => be.calls.saves.length > before, 'Retry saves again');
    await line.waitFor({ state: 'detached', timeout: 15000 });
    assert.deepEqual(ui.pageErrors.filter((e) => !/502/.test(String(e))), []);
  } finally { await ui.close(); }
});

test('(6) the note that said a run no longer writes a strategy document is gone', () => {
  const src = fs.readFileSync(new URL('../../src/components/results/ResultsAssets.jsx', import.meta.url), 'utf8');
  assert.ok(!/no longer writes one/i.test(src));
});
