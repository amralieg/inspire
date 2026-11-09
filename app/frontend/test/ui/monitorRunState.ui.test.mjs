import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const PLATFORM = 'Workload failed, see run output for details';

const step = (id, status, stage, name, at) => ({
  step_id: String(id), session_id: '42', stage_name: stage, step_name: name, sub_step_name: '', status, message: '', progress_increment: 0,
  last_updated: at, result_json: {},
});
const STEPS = [
  step(1, 'ended_success', 'Metadata', 'Read the tables', ago(50 * MINUTE)),
  step(2, 'ended_error', 'Use cases', 'Write the use cases', ago(40 * MINUTE)),
];

function runBackend({ run, session = {}, steps = STEPS }) {
  const reads = { session: 0, steps: 0 };
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => {
      reads.session += 1;
      res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(HOUR), completed_percent: 41, completed_on: null, last_updated: ago(40 * MINUTE), processing_status: 'done', ...session } });
    });
    app.get('/api/inspire/steps', (req, res) => { reads.steps += 1; res.json({ steps: req.query.since ? [] : steps }); });
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', run_page_url: 'https://workspace.example.com/#job/1/run/777', ...run }));
  };
  return { reads, mount };
}

const card = (page) => page.locator('[data-testid="monitor-status"]');
const steps = (page) => page.getByRole('heading', { name: 'Detailed Steps' });

for (const [label, run, title] of [
  ['failed', { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: PLATFORM, start_time: Date.now() - HOUR, end_time: Date.now() - 40 * MINUTE,
    tasks: [{ task_key: 'main', result_state: 'FAILED', error: 'KeyError: domain_name' }] }, 'Failed'],
  ['stopped', { life_cycle_state: 'TERMINATED', result_state: 'CANCELED', state_message: 'Run cancelled.', start_time: Date.now() - HOUR, end_time: Date.now() - 40 * MINUTE, tasks: [] }, 'Stopped'],
  ['ended by the platform', { life_cycle_state: 'INTERNAL_ERROR', state_message: 'Cluster lost', start_time: Date.now() - HOUR, end_time: Date.now() - 40 * MINUTE, tasks: [] }, 'Failed'],
]) {
  test(`a Monitor opened on a run that already ${label} still reads its session and steps, then stops asking`, async () => {
    const backend = runBackend({ run });
    const ui = await openUi('monitor', {}, '', { mount: backend.mount });
    const { page } = ui;
    try {
      await card(page).getByText(title, { exact: true }).waitFor({ timeout: 15000 });
      await steps(page).waitFor({ timeout: 15000 });
      assert.match(await steps(page).locator('xpath=following-sibling::p').innerText(), /2 stages · 2 steps/);
      const read = backend.reads.session;
      assert.ok(read >= 1);
      await page.waitForTimeout(4500);
      assert.equal(backend.reads.session, read, 'a run that ended is read, then never polled again');
      assert.equal(await card(page).getByText('20m 0s', { exact: true }).count(), 1, 'the time from start to end of the run shows');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('a failed run names its reason once, keeps the platform line as a detail, and says what to do next', async () => {
  const backend = runBackend({ run: { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: PLATFORM, start_time: Date.now() - HOUR, run_duration: 3723000,
    tasks: [{ task_key: 'main', result_state: 'FAILED', error: 'KeyError: domain_name' }] } });
  const ui = await openUi('monitor', {}, '', { mount: backend.mount });
  const { page } = ui;
  try {
    await page.locator('[data-testid="monitor-failure-reason"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-testid="monitor-failure-reason"]').innerText(), 'KeyError: domain_name');
    assert.equal(await page.getByText('KeyError: domain_name', { exact: true }).count(), 1, 'the reason shows once');
    assert.equal(await page.getByText(PLATFORM, { exact: true }).isVisible(), false, 'the platform line is a closed detail, never a second reason');
    assert.match(await page.locator('[data-testid="monitor-failure-next"]').innerText(), /^Open the run in Databricks/);
    assert.equal(await page.getByText(/Pipeline/).count(), 0);
    assert.equal(await card(page).getByText('1h 2m', { exact: true }).count(), 1, 'run_duration is the time of a job run with tasks');
  } finally {
    await ui.close();
  }
});

test('a run still going shows the time since it started and keeps counting', async () => {
  const backend = runBackend({ run: { life_cycle_state: 'RUNNING', start_time: Date.now() - 9 * HOUR, execution_duration: 0, run_duration: 0, tasks: [] } });
  const ui = await openUi('monitor', {}, '', { mount: backend.mount });
  const { page } = ui;
  try {
    await card(page).getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
    await card(page).getByText(/^9h 0m$/).waitFor({ timeout: 15000 });
    assert.equal(await card(page).getByText('41% complete', { exact: true }).count(), 1);
  } finally {
    await ui.close();
  }
});

test('a finished run says how long it took in plain words, never "Pipeline" or "execution time"', async () => {
  const backend = runBackend({
    run: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', start_time: Date.now() - HOUR, end_time: Date.now() - 20 * MINUTE, execution_duration: 0, run_duration: 2400000, tasks: [] },
    session: { completed_percent: 100, completed_on: ago(20 * MINUTE), results_json: { run_status: 'success', quality_bar: { found: 3, meets: 3, mode: 'Good' } } },
    steps: [step(1, 'ended_success', 'Metadata', 'Read the tables', ago(50 * MINUTE))],
  });
  const ui = await openUi('monitor', {}, '', { mount: backend.mount });
  const { page } = ui;
  try {
    const detail = page.locator('[data-testid="monitor-complete-detail"]');
    await detail.waitFor({ timeout: 15000 });
    assert.match(await detail.innerText(), /^The use cases are ready to review\. The run took 40m 0s\./);
    assert.equal(await page.getByText(/Pipeline|execution time/).count(), 0);
  } finally {
    await ui.close();
  }
});
