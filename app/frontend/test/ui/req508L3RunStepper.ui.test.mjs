// REQ-508 L3 (Amr: "7 phases" with the parallel pair, driven by the real backend status; skipped phases show as skipped, never green).
// The Monitor and the Review page show one run stepper built by src/lib/runPhases.js. Audit scratch/req508_art_director.md F5, F6, section 3.
// Fail-pre (15eb146b9): neither page renders [data-run-stepper]; the Review bar paints every stage green (ResultsAssets.jsx:73-85) and the
// Monitor log shows "+N%" per step (MonitorPage.jsx:1111-1113).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let n = 0;
const step = (stage, status, extra = {}) => ({ step_id: String(++n), session_id: '42', stage_name: stage, step_name: `${stage} step`, sub_step_name: '',
  status, message: '', progress_increment: 5, last_updated: ago((60 - n) * MINUTE), result_json: {}, ...extra });
const ENDED = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', start_time: Date.now() - 60 * MINUTE, end_time: Date.now() - MINUTE, tasks: [] };
const LIVE = { life_cycle_state: 'RUNNING', start_time: Date.now() - 30 * MINUTE, tasks: [] };
const FAILED = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: 'Workload failed', start_time: Date.now() - 60 * MINUTE,
  end_time: Date.now() - MINUTE, tasks: [] };

function monitorBackend(steps, run) {
  return (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(60 * MINUTE),
      completed_percent: 50, completed_on: null, last_updated: ago(MINUTE), processing_status: run === LIVE ? 'processing' : 'done' } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', run_page_url: 'https://workspace.example.com/#job/1/run/777', ...run }));
  };
}

const stepper = (page) => page.locator('[data-run-stepper]');
async function stepStates(page) {
  await stepper(page).first().waitFor({ timeout: 20000 });
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-run-stepper] [data-run-step]')]
    .map((el) => [el.getAttribute('data-run-step'), el.getAttribute('data-state')])));
}
async function greenSteps(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-run-stepper] [data-run-step]')].filter((el) => {
    const st = el.getAttribute('data-state');
    if (st === 'done' || st === 'warning') return false;
    const icon = el.querySelector('svg') || el;
    const rgb = getComputedStyle(icon).color.match(/\d+/g)?.map(Number) || [0, 0, 0];
    return rgb[1] > 120 && rgb[1] > rgb[0] * 1.4 && rgb[1] > rgb[2] * 1.2;
  }).map((el) => el.getAttribute('data-run-step')));
}

async function openMonitor(steps, run) {
  return openUi('monitor', {}, '', { mount: monitorBackend(steps, run) });
}

test('Monitor: a live run shows the 7-phase stepper above the status card, with the parallel pair in one column', async () => {
  const ui = await openMonitor([step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'started')], LIVE);
  const { page } = ui;
  try {
    const got = await stepStates(page);
    assert.deepEqual(got, { setup: 'done', context: 'done', tables: 'active', generation: 'todo', domains: 'todo', prioritization: 'todo',
      implementation: 'todo', readout: 'todo' });
    const list = stepper(page).first();
    assert.equal(await list.getAttribute('role'), 'list');
    assert.equal(await list.getAttribute('aria-label'), 'Run steps');
    assert.equal(await list.locator('[data-run-step-column="7"] [data-run-step]').count(), 2, 'Build Genie instructions and Write documents share column 7');
    assert.match(String(await list.locator('[data-run-step="tables"]').getAttribute('aria-label')), /Read the data.*running/i);
    assert.match(String(await list.locator('[data-run-step="generation"]').getAttribute('aria-label')), /Write use cases.*not started/i);
    const above = await page.evaluate(() => {
      const s = document.querySelector('[data-run-stepper]');
      const c = document.querySelector('[data-testid="monitor-status"]');
      return Boolean(s && c && (s.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.ok(above, 'the stepper sits above the status card');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Monitor: a from-json run marks phases 2-6 and Build Genie instructions skipped, labelled "skipped" and never green', async () => {
  const ui = await openMonitor([step('Setup', 'ended_success'), step('Executive Readout', 'ended_success'), step('Localization', 'ended_success')], ENDED);
  const { page } = ui;
  try {
    const got = await stepStates(page);
    assert.deepEqual(got, { setup: 'done', context: 'skipped', tables: 'skipped', generation: 'skipped', domains: 'skipped', prioritization: 'skipped',
      implementation: 'skipped', readout: 'done' });
    assert.match(String(await stepper(page).first().locator('[data-run-step="context"]').getAttribute('aria-label')), /skipped/i);
    assert.deepEqual(await greenSteps(page), [], 'no skipped step is painted green');
  } finally {
    await ui.close();
  }
});

test('Monitor: a failed run paints the failed phase red, leaves later phases not started, and the log shows no "+N%" per step', async () => {
  const ui = await openMonitor([step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'ended_success'),
    step('Use Cases Generation', 'ended_error')], FAILED);
  const { page } = ui;
  try {
    const got = await stepStates(page);
    assert.equal(got.generation, 'error');
    for (const k of ['domains', 'prioritization', 'implementation', 'readout']) assert.equal(got[k], 'todo', k);
    assert.match(String(await stepper(page).first().locator('[data-run-step="generation"]').getAttribute('aria-label')), /failed/i);
    const rgb = await stepper(page).first().locator('[data-run-step="generation"]').evaluate((el) =>
      (getComputedStyle(el.querySelector('svg') || el).color.match(/\d+/g) || []).map(Number));
    assert.ok(rgb[0] > 150 && rgb[0] > rgb[1] * 1.6, `the failed step is red (got rgb ${rgb})`);
    assert.equal(await page.locator('main').getByText(/^\+\d+%$/).count(), 0, 'the log rows carry no "+N%"');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const reviewMount = (steps) => (app) => { app.get('/api/inspire/steps', (_req, res) => res.json({ steps })); };
async function openReview(steps) {
  return openUi('results', { ...REVIEW_STATE, results: { ...REVIEW_STATE.results, run_status: 'success' } }, '', { mount: reviewMount(steps) });
}

test('Review: the same stepper shows above the section tabs on the default tab, built from the run\'s steps', async () => {
  const ui = await openReview(['Setup', 'Business Understanding', 'Data Preparation', 'Use Cases Generation', 'Domain Mapping', 'Use Case Prioritization',
    'Implement Use Cases', 'Executive Readout'].map((s) => step(s, 'ended_success')));
  const { page } = ui;
  try {
    const got = await stepStates(page);
    assert.deepEqual(new Set(Object.values(got)), new Set(['done']));
    assert.equal(Object.keys(got).length, 8);
    const above = await page.evaluate(() => {
      const s = document.querySelector('[data-run-stepper]');
      const nav = document.querySelector('[aria-label="Results sections"]');
      return Boolean(s && nav && (s.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.ok(above, 'the stepper sits above the Results sections tabs');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Review: an implement-only run shows the discovery phases skipped, not green (the Assets bar no longer marks every stage done)', async () => {
  const ui = await openReview([step('Setup', 'ended_success'), step('Implement Use Cases', 'ended_success')]);
  const { page } = ui;
  try {
    const got = await stepStates(page);
    assert.equal(got.implementation, 'done');
    for (const k of ['context', 'tables', 'generation', 'domains', 'prioritization', 'readout']) assert.equal(got[k], 'skipped', k);
    assert.deepEqual(await greenSteps(page), []);
  } finally {
    await ui.close();
  }
});
