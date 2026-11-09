import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { RESULTS } from './implementFixtures.js';
import { NO_USE_CASES_MESSAGE, RUN_FAILED_MESSAGE, runOutcomeOf } from '../../src/lib/runOutcome.js';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const NO_MODEL = 'No AI model can be called from this workspace, so the run stopped before it used any. Tried 6 models: '
  + 'databricks-claude-opus-4-6: Please use Unity Gateway. Ask a workspace admin to let ai_query call a chat model.';
const NO_TABLES = 'Discovery found nothing to analyze in the UC metadata (schemas: retail.w6_empty_retail): no table with columns was found.';
const EMPTY_DOMAINS = { ...RESULTS, domains: [] };

test('runOutcomeOf: a failed run_status is a failure with its kind, title and message', () => {
  const out = runOutcomeOf({ domains: [], run_status: 'failed', run_failure_kind: 'no_model', run_message: NO_MODEL });
  assert.deepEqual([out.failed, out.warning, out.failureKind, out.failureTitle, out.message],
    [true, false, 'no_model', 'No AI model available', NO_MODEL]);
  assert.equal(runOutcomeOf({ run_status: 'failed', run_failure_kind: 'no_tables', run_message: NO_TABLES }).failureTitle, 'Nothing to read');
  assert.equal(runOutcomeOf({ run_status: 'failed' }).message, RUN_FAILED_MESSAGE);
});

test('runOutcomeOf: zero use cases is a failure even when the run said success, and a bar that found nothing too', () => {
  const out = runOutcomeOf({ domains: [], run_status: 'success' });
  assert.deepEqual([out.failed, out.failureKind, out.failureTitle, out.message],
    [true, 'no_use_cases', 'No use cases produced', NO_USE_CASES_MESSAGE]);
  assert.equal(runOutcomeOf({ domains: RESULTS.domains }, { found: 0, meets: 0 }).failed, true);
  assert.equal(runOutcomeOf({ quality_bar: { mode: 'High', found: 0, meets: 0 } }).failed, true);
});

test('runOutcomeOf: real outcomes stay what they are', () => {
  assert.equal(runOutcomeOf({ domains: RESULTS.domains, run_status: 'success' }).failed, false);
  assert.equal(runOutcomeOf({ domains: RESULTS.domains, run_status: 'success' }).warning, false);
  const below = runOutcomeOf({ quality_bar: { mode: 'High', found: 6, meets: 0 } });
  assert.deepEqual([below.failed, below.warning], [false, true]);
  assert.equal(runOutcomeOf({ run_status: 'success' }).failed, false, 'no count known is not a failure');
  assert.equal(runOutcomeOf(null).failed, false);
  assert.equal(runOutcomeOf({}).failed, false);
});

async function banner(page) {
  const done = page.locator('[data-testid="execution-complete"]');
  await done.waitFor({ timeout: 15000 });
  return done;
}

test('Results: a run stopped for want of a model shows the reason, never "Every step of the run finished"', async () => {
  const ui = await openUi('results', {
    results: { ...EMPTY_DOMAINS, run_status: 'failed', run_failure_kind: 'no_model', run_message: NO_MODEL }, useCases: [] });
  const { page } = ui;
  try {
    const done = await banner(page);
    assert.equal(await done.getAttribute('data-status'), 'failed');
    assert.equal(await done.getAttribute('data-failure'), 'no_model');
    assert.match(await done.innerText(), /No AI model available/);
    assert.equal(await page.locator('[data-testid="execution-failure"]').innerText(), NO_MODEL);
    assert.equal(await page.getByText('Every step of the run finished.').count(), 0);
    assert.doesNotMatch(await done.innerText(), /Run finished/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Results: zero use cases from a run that said success is shown as failed with a reason', async () => {
  const ui = await openUi('results', { results: { ...EMPTY_DOMAINS, run_status: 'success' }, useCases: [] });
  const { page } = ui;
  try {
    const done = await banner(page);
    assert.equal(await done.getAttribute('data-status'), 'failed');
    assert.match(await done.innerText(), /No use cases produced/);
    assert.equal(await page.locator('[data-testid="execution-failure"]').innerText(), NO_USE_CASES_MESSAGE);
    assert.equal(await page.getByText('Every step of the run finished.').count(), 0);
  } finally {
    await ui.close();
  }
});

test('Results: an empty schema says there was nothing to read', async () => {
  const ui = await openUi('results', {
    results: { ...EMPTY_DOMAINS, run_status: 'failed', run_failure_kind: 'no_tables', run_message: NO_TABLES }, useCases: [] });
  const { page } = ui;
  try {
    const done = await banner(page);
    assert.equal(await done.getAttribute('data-failure'), 'no_tables');
    assert.match(await done.innerText(), /Nothing to read/);
    assert.equal(await page.locator('[data-testid="execution-failure"]').innerText(), NO_TABLES);
  } finally {
    await ui.close();
  }
});

test('Results: a run with use cases still says every step finished', async () => {
  const ui = await openUi('results', { results: { ...RESULTS, run_status: 'success' }, useCases: [] });
  const { page } = ui;
  try {
    const done = await banner(page);
    assert.equal(await done.getAttribute('data-status'), 'success');
    assert.equal(await page.getByText('Every step of the run finished.').count(), 1);
    assert.equal(await page.locator('[data-testid="execution-failure"]').count(), 0);
  } finally {
    await ui.close();
  }
});

function finishedSession(results) {
  return (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: {
      session_id: '42', business_name: 'Acme Retail', create_at: ago(10 * MINUTE), last_updated: ago(MINUTE),
      completed_on: ago(MINUTE), completed_percent: 100, processing_status: 'ready', results_json: results } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
}

test('Monitor: a finished session with zero use cases is failed with the reason, not "completed successfully"', async () => {
  const ui = await openUi('monitor', {}, '&run=none', { mount: finishedSession({ domains: [], run_status: 'success' }) });
  const { page } = ui;
  try {
    const status = page.locator('[data-testid="monitor-status"]');
    await status.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="monitor-status"]')?.dataset.status === 'failed', null, { timeout: 15000 });
    assert.match(await status.innerText(), /No use cases produced/);
    assert.match(await status.innerText(), /The run produced no use cases/);
    assert.equal(await page.getByText('Run completed', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Inspire finished this run.').count(), 0);
    assert.equal(await page.locator('[data-testid="monitor-failure-reason"]').innerText(), NO_USE_CASES_MESSAGE);
  } finally {
    await ui.close();
  }
});

test('Monitor: a finished session with use cases still completes successfully', async () => {
  const ui = await openUi('monitor', {}, '&run=none', { mount: finishedSession({ domains: RESULTS.domains, run_status: 'success' }) });
  const { page } = ui;
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid="monitor-status"]')?.dataset.status === 'success', null, { timeout: 15000 });
    assert.equal(await page.locator('[data-testid="monitor-failure-reason"]').count(), 0);
  } finally {
    await ui.close();
  }
});
