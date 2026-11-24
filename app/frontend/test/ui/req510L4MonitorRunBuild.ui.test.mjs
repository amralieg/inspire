// REQ-511 repoint (D-c15-01): the Monitor test now follows the REQ-511 design (Stop this run and Run log inside the hero More menu, no standalone
// Stop, body cap 80 measured at 72 with the log open); the Build and Run parts of REQ-510 L4 are unchanged.
// REQ-510 L4 (declutter after REQ-508):Monitor, Build and Run keep one main action each and move their extras into a More menu
// (briefs/req510_spec.md sections 2.6, 2.8, 2.9). Fail-pre (a037bfdfb): Monitor shows "Show the run log" as a second button beside
// Stop; the Build page repeats its counters in a 16-word summary sentence (58 body words) and shows "Use case details" as an inline
// button; there is no More menu on any of the three. Run stays as it is (must-keep: 29 words, one control).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { describe, itemsOf, screenFacts, shownOutsideMenus } from './req510Declutter.mjs';

test.after(closeBrowser);

const monitorMount = (app) => {
  app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: new Date().toISOString(),
    completed_percent: 40, completed_on: null, last_updated: new Date().toISOString(), processing_status: 'processing' } }));
  app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : [{ step_id: '1', session_id: '42', stage_name: 'Setup', step_name: 'Setup step', sub_step_name: '',
    status: 'started', message: 'Setup message', progress_increment: 5, last_updated: new Date().toISOString(), result_json: {} }] }));
  app.get('/api/inspire/log', (_req, res) => res.json({ found: true, truncated: false, text: 'Setup message' }));
  app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
  app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING', start_time: Date.now(), tasks: [] }));
};

async function open(name, state = {}, opts = {}) {
  const ui = await openUi(name, state, '', opts);
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.locator('h1').first().waitFor({ timeout: 20000 });
  await ui.page.waitForTimeout(1500);
  return ui;
}

test('Monitor (REQ-511 design): Stop this run and Run log live in More, no second standalone button; the run log opens from there in one click', async () => {
  const ui = await open('monitor', {}, { mount: monitorMount });
  const { page } = ui;
  try {
    await page.locator('[data-monitor-hero][data-state="running"]').first().waitFor({ timeout: 25000 });
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /Stop this run/ })), 0, 'Stop is not a standalone button');
    assert.equal(await shownOutsideMenus(page.getByRole('button', { name: /^(Show|Hide) the run log$/ })), 0, 'the run log is not a second inline button');
    const items = await itemsOf(page, page, /^More$/);
    assert.ok(items && items.includes('Stop this run'), `Monitor More holds "Stop this run" (got ${JSON.stringify(items)})`);
    assert.ok(items.includes('Run log'), `Monitor More holds "Run log" (got ${JSON.stringify(items)})`);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Run log' }).click();
    await page.locator('pre[aria-label="Run log"]').first().waitFor({ timeout: 10000 });
    const f = await screenFacts(page);
    // Measured on the REQ-511 design with the run log open (one step, running): 72 words, cap 80. The standalone-Stop and run-log-button asserts above are the fail-pre guard.
    assert.ok(f.bodyWords <= 80, `Monitor body words ${f.bodyWords} > 80 (${describe(f)})`);
    assert.ok(f.primaries.length <= 1, `at most one primary on Monitor (${describe(f)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Build: at most 40 words above the fold; "Use case details" moves into the use case More menu; one primary', async () => {
  const ui = await open('implement', { useCase: HARNESS_USE_CASE });
  const { page } = ui;
  try {
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 40, `Build body words ${f.bodyWords} > 40 (${describe(f)})`);
    const pane = page.getByRole('region', { name: 'Use case' });
    if (!(await pane.getByRole('button').count())) await page.getByRole('navigation', { name: 'Use cases' }).getByRole('button', { name: /Predict churn/ }).first().click();
    await pane.getByRole('button').first().waitFor({ timeout: 15000 });
    assert.equal(await shownOutsideMenus(pane.getByRole('button', { name: 'Use case details', exact: true })), 0, 'Use case details is not an inline button');
    const items = await itemsOf(page, pane, /^More$/);
    assert.ok(items && items.includes('Use case details'), `the use case More holds "Use case details" (got ${JSON.stringify(items)})`);
    const after = await screenFacts(page);
    assert.ok(after.primaries.length <= 1, `at most one primary on Build (${describe(after)})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Run (must-keep): at most 30 words, at most one primary, and the refresh control stays reachable', async () => {
  const ui = await open('run', REVIEW_STATE);
  const { page } = ui;
  try {
    const f = await screenFacts(page);
    assert.ok(f.bodyWords <= 30, `Run body words ${f.bodyWords} > 30 (${describe(f)})`);
    assert.ok(f.primaries.length <= 1, describe(f));
    const visible = await shownOutsideMenus(page.getByRole('button', { name: /deployed use cases again|Refresh/ }));
    const inMore = visible ? null : await itemsOf(page, page, /^More$/);
    assert.ok(visible || (inMore || []).some((t) => /Refresh/.test(t)), 'refresh is on the page or in More');
  } finally {
    await ui.close();
  }
});
