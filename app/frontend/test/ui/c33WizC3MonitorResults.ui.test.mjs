// c33 lane C acceptance (REQ-579): a Match run on the Monitor shows one box per input use case from the start, each with its progress
// (Waiting, Matching, Matched, Partly matched, Not matched) from the agent's step rows; the run's Results page holds the per-piece review
// (why, evidence tables and columns, gap, confidence, keep / drop / use known data, latest decision wins) and Accept. A run that is not a
// Match run shows neither. Written by the c33 planner; the lane C builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { DECISION_TEXT, MATCH_ACCEPT, MATCH_REVIEW_TITLE, ROUTES, VERDICT_TEXT } from '../../src/lib/startWizard.js';
import { MATCH_DONE, MATCH_EXPECTED_STATUS, MATCH_PROGRESS_INPUTS, MATCH_STEP_ROWS } from './c33WizFixtures.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const SESSION = { session_id: '42', business_name: 'Example Co', processing_status: 'running', completed_percent: 40, create_at: '2026-11-28T09:00:00Z' };
const RUNNING = { state: 'running', inputs: MATCH_PROGRESS_INPUTS, reports: [], decisions: [] };
// The Monitor reads the run's job (GET /api/run/777); the harness answers it so a missing route is not a console 404.
const RUN_READ = { status: 200, body: { run_id: 777, life_cycle_state: 'RUNNING', tasks: [] } };
// The Stop control asks GET /api/run/777/cancel whether this person may stop the run; answer it the way the backend does.
const MONITOR = { mount: (app) => app.get('/api/run/:runId/cancel', (_req, res) => res.json({ allowed: true })) };

test('REQ-579: the Monitor of a Match run shows every input use case in a box with its match progress (must-fail on the base)', async () => {
  const ui = await openUi('monitor', { runRead: RUN_READ, inspireSession: SESSION, runSteps: MATCH_STEP_ROWS, matchResult: RUNNING }, '', MONITOR);
  const { page } = ui;
  try {
    const boxes = page.locator('[data-match-box]');
    await boxes.first().waitFor({ timeout: 20000 });
    await until(async () => (await boxes.count()) === 5, 'one box per input use case');
    assert.deepEqual(await boxes.evaluateAll((els) => els.map((el) => el.getAttribute('data-match-box'))), ['1', '2', '3', '4', '5'], 'boxes in input order');
    for (let i = 0; i < 5; i += 1) {
      const box = boxes.nth(i);
      assert.ok((await box.innerText()).includes(MATCH_PROGRESS_INPUTS[i].name), `box ${i + 1} names its use case`);
      await until(async () => (await box.locator('[data-match-status]').innerText()).trim() === MATCH_EXPECTED_STATUS[i], `box ${i + 1} is ${MATCH_EXPECTED_STATUS[i]}`, 15000);
    }
    assert.match(await boxes.nth(0).innerText(), /92/, 'a matched box shows its confidence');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-579: before any step row every box is Waiting; a run that is not a Match run shows no boxes (must-fail on the base)', async () => {
  const waiting = await openUi('monitor', { runRead: RUN_READ, inspireSession: SESSION, runSteps: [], matchResult: RUNNING }, '', MONITOR);
  try {
    const boxes = waiting.page.locator('[data-match-box]');
    await boxes.first().waitFor({ timeout: 20000 });
    assert.deepEqual((await waiting.page.locator('[data-match-status]').allInnerTexts()).map((t) => t.trim()), Array(5).fill('Waiting'));
    assert.deepEqual(errors(waiting), []);
  } finally { await waiting.close(); }
  const plain = await openUi('monitor', { runRead: RUN_READ, inspireSession: SESSION, runSteps: [] }, '', MONITOR);
  try {
    await plain.page.waitForTimeout(3000);
    assert.equal(await plain.page.locator('[data-match-box]').count(), 0, 'match/result state none: no boxes');
    assert.deepEqual(errors(plain), []);
  } finally { await plain.close(); }
});

function resultsMount() {
  const decisions = [];
  const accepts = [];
  const mount = (app) => {
    app.post(ROUTES.matchDecision, (req, res) => { decisions.push(req.body); res.json({ ok: true }); });
    app.post(ROUTES.matchAccept, (req, res) => { accepts.push(req.body); res.json({ session_id: '42', run_id: 89 }); });
  };
  return { decisions, accepts, mount };
}

test('REQ-579: the Results page of a Match run reviews each use case: verdict, pieces, evidence, gap and confidence (must-fail on the base)', async () => {
  const m = resultsMount();
  const ui = await openUi('results', { ...REVIEW_STATE, matchResult: MATCH_DONE }, '', { mount: m.mount });
  const { page } = ui;
  try {
    await page.locator('[data-run-box]').waitFor({ timeout: 20000 });
    const panel = page.locator('[data-match-panel]');
    await panel.getByText(MATCH_REVIEW_TITLE).waitFor({ timeout: 15000 });
    const reports = panel.locator('[data-match-report]');
    assert.equal(await reports.count(), 3);
    assert.deepEqual(await reports.evaluateAll((els) => els.map((el) => el.getAttribute('data-match-verdict'))), ['full', 'partial', 'none']);
    const [full, partial, none] = [reports.nth(0), reports.nth(1), reports.nth(2)];
    assert.ok((await full.innerText()).includes(VERDICT_TEXT.full));
    assert.ok((await partial.innerText()).includes(VERDICT_TEXT.partial));
    assert.ok((await none.innerText()).includes(VERDICT_TEXT.none));
    const piece = full.locator('[data-match-piece="1"]');
    for (const want of ['Units sold per store and week', 'main.sales.order_items', 'store_id', 'qty', 'order_date', 'Item lines carry store, quantity and date', '94'])
      assert.ok((await piece.innerText()).includes(want), `the full match piece shows ${want}`);
    const gap = partial.locator('[data-match-piece="2"]');
    for (const want of ['Cancellation events', 'No table records when a customer stops buying', '45', 'main.crm.contact_status'])
      assert.ok((await gap.innerText()).includes(want), `the partial piece shows ${want}`);
    assert.ok((await none.innerText()).includes('No table holds drone or flight data'), 'a no-match report shows its gap');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-579: decisions POST match/decision, the latest decision shows, and Accept POSTs match/accept (must-fail on the base)', async () => {
  const m = resultsMount();
  const ui = await openUi('results', { ...REVIEW_STATE, matchResult: MATCH_DONE }, '', { mount: m.mount });
  const { page } = ui;
  try {
    const panel = page.locator('[data-match-panel]');
    await panel.getByText(MATCH_REVIEW_TITLE).waitFor({ timeout: 20000 });
    const piece = panel.locator('[data-match-report]').nth(1).locator('[data-match-piece="2"]');
    assert.equal(await piece.locator('[data-match-decision="keep"]').getAttribute('aria-pressed'), 'true', 'the latest decision (keep) wins over the older drop');
    assert.equal(await piece.locator('[data-match-decision="drop"]').getAttribute('aria-pressed'), 'false');
    assert.ok((await piece.locator('[data-match-decision="use_known_data"]').innerText()).includes(DECISION_TEXT.use_known_data));
    await piece.locator('[data-match-decision="use_known_data"]').click();
    await until(() => m.decisions.length === 1, 'one decision sent');
    const { session_id, input_no, piece_no, decision, inspire_database, warehouse_id } = m.decisions[0];
    assert.deepEqual({ session_id, input_no, piece_no, decision, inspire_database, warehouse_id },
      { session_id: '42', input_no: 2, piece_no: 2, decision: 'use_known_data', inspire_database: 'main.inspire', warehouse_id: 'wh1' });
    await until(async () => (await piece.locator('[data-match-decision="use_known_data"]').getAttribute('aria-pressed')) === 'true', 'the new decision shows');
    assert.equal(await panel.locator('[data-match-report]').nth(2).locator('[data-match-decision="use_known_data"]').count(), 0, 'no known-data option where the report has none');
    await panel.getByRole('button', { name: MATCH_ACCEPT }).click();
    await until(() => m.accepts.length === 1, 'Accept sends phase 2');
    assert.equal(m.accepts[0].session_id, '42');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-579 regression: a run that is not a Match run shows no match panel on Results (must-keep)', async () => {
  const ui = await openUi('results', REVIEW_STATE, '');
  const { page } = ui;
  try {
    await page.locator('[data-run-box]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-match-panel]').count(), 0);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
