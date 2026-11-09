import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, openAsset, openUi } from './uiSupport.mjs';
import { COPIED_SEND_TEXT } from '../../src/lib/plainText.js';

test.after(closeBrowser);

const CLIPBOARD = () => {
  window.__copied = [];
  const keep = (text) => { window.__copied.push(String(text)); };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items) => keep(await (await items[0].getType('text/plain')).text()),
      writeText: async (text) => keep(text),
    },
  });
};

function failing(path, { status = 500, error = 'The SQL warehouse did not answer in time' } = {}) {
  const calls = { n: 0, failing: true };
  const init = async (page) => {
    await page.addInitScript(CLIPBOARD);
    await page.route((url) => url.pathname === path, (route) => {
      calls.n += 1;
      if (calls.failing) return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
      return route.continue();
    });
  };
  const heal = () => { calls.failing = false; return calls.n; };
  return { calls, init, heal };
}

test('the Build page says when it could not read how a build is going, and Try again reads it again', async () => {
  const flaky = failing('/api/inspire/implement/status');
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built()] }, '', { init: flaky.init });
  const { page } = ui;
  try {
    const box = page.locator('[data-status-error]');
    await box.waitFor({ timeout: 15000 });
    assert.match(await box.innerText(), /^Inspire could not read how this build is going: The SQL warehouse did not answer in time/);
    await page.waitForTimeout(1500);
    assert.equal(await box.count(), 1, 'the message stays until the person asks again');
    const asked = flaky.heal();
    await box.getByRole('button', { name: 'Try again' }).click();
    await box.waitFor({ state: 'detached', timeout: 15000 });
    assert.ok(flaky.calls.n > asked, 'Try again read the build status again');
    assert.deepEqual(ui.pageErrors.filter((e) => !/500/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('a Build page whose status could not be read offers Copy what to send and the diagnostics', async () => {
  const flaky = failing('/api/inspire/implement/status');
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built()] }, '', { init: flaky.init });
  const { page } = ui;
  try {
    const box = page.locator('[data-status-error]');
    await box.waitFor({ timeout: 15000 });
    await box.getByRole('button', { name: 'Copy what to send' }).click();
    await box.getByText(COPIED_SEND_TEXT).waitFor();
    const copied = await page.evaluate(() => window.__copied);
    assert.equal(copied.length, 1);
    assert.match(copied[0], /^Inspire could not read how this build is going: The SQL warehouse did not answer in time/);
    assert.equal(await box.locator('[data-diagnostics-download]').count(), 1, 'the diagnostics are one click away');
  } finally {
    await ui.close();
  }
});

test('the live status that could not be read offers Try again, which reads it again and clears the message', async () => {
  const flaky = failing('/api/inspire/implement/live');
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built()] }, '', { init: flaky.init });
  const { page } = ui;
  try {
    await openAsset(page, 'job');
    const box = page.locator('[data-live-error]');
    await box.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await box.count(), 1, 'the message stays until the person asks again');
    const asked = flaky.heal();
    await box.getByRole('button', { name: 'Try again' }).click();
    await box.waitFor({ state: 'detached', timeout: 15000 });
    assert.ok(flaky.calls.n > asked, 'Try again read the live status again');
  } finally {
    await ui.close();
  }
});

test('the use case list that could not load offers Try again, which loads the list', async () => {
  const results = failing('/api/inspire/results');
  const usecases = failing('/api/inspire/usecases');
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built()] }, '', {
    init: async (page, origin) => { await results.init(page, origin); await usecases.init(page, origin); },
  });
  const { page } = ui;
  try {
    const msg = page.getByText('The SQL warehouse did not answer in time', { exact: true }).first();
    await msg.waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Predict churn').count(), 0, 'no use case shows while the list failed');
    const asked = results.heal();
    usecases.heal();
    await page.locator('[data-implement-page]').getByRole('button', { name: 'Try again' }).first().click();
    await page.getByText('Predict churn').first().waitFor({ timeout: 15000 });
    assert.ok(results.calls.n > asked, 'Try again read the list again');
  } finally {
    await ui.close();
  }
});

const PLATFORM = 'Workload failed, see run output for details';
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function monitorBackend(run, { refuseFirst = false } = {}) {
  const reads = { run: 0, refusing: refuseFirst };
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: reads.refusing ? null : {
      session_id: '42', business_name: 'Acme Retail', create_at: ago(3600000), completed_percent: 41, completed_on: null, last_updated: ago(60000), processing_status: 'done' } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/run/777', (_req, res) => {
      reads.run += 1;
      if (reads.refusing) return res.status(403).json({ error: 'You do not have permission to view run 777' });
      return res.json({ run_id: 777, run_name: 'Inspire Discover', run_page_url: 'https://workspace.example.com/#job/1/run/777', ...run });
    });
  };
  return { reads, mount };
}

const FAILED_RUN = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: PLATFORM, start_time: Date.now() - 3600000, end_time: Date.now() - 60000,
  tasks: [{ task_key: 'main', result_state: 'FAILED', error: 'KeyError: domain_name' }] };

test('a failed run on Monitor offers to open the run and to copy what to send, with the run and its error', async () => {
  const backend = monitorBackend(FAILED_RUN);
  const ui = await openUi('monitor', {}, '', { mount: backend.mount, init: (page) => page.addInitScript(CLIPBOARD) });
  const { page } = ui;
  try {
    const choices = page.locator('[data-testid="monitor-failure-choices"]');
    await choices.waitFor({ timeout: 15000 });
    assert.deepEqual(await choices.locator('[data-failure-choice]').evaluateAll((els) => els.map((e) => e.dataset.failureChoice)), ['open', 'copy']);
    assert.equal(await choices.getByRole('link', { name: /Open the run in Databricks/ }).getAttribute('href'), 'https://workspace.example.com/#job/1/run/777');
    await choices.getByRole('button', { name: 'Copy what to send' }).click();
    await choices.getByText(COPIED_SEND_TEXT).waitFor();
    const [copied] = await page.evaluate(() => window.__copied);
    assert.match(copied, /^Failed \(Run 777, session 42\): /);
    assert.match(copied, /KeyError: domain_name/);
    assert.match(copied, new RegExp(PLATFORM));
    assert.match(copied, /https:\/\/workspace\.example\.com\/#job\/1\/run\/777/);
  } finally {
    await ui.close();
  }
});

test('a run Monitor could not read offers Check again, which reads the run again once access is given', async () => {
  const backend = monitorBackend({ life_cycle_state: 'RUNNING', start_time: Date.now() - 600000, tasks: [] }, { refuseFirst: true });
  const ui = await openUi('monitor', {}, '', { mount: backend.mount });
  const { page } = ui;
  try {
    const card = page.locator('[data-testid="monitor-status"]');
    await card.getByText('Cannot read this run', { exact: true }).waitFor({ timeout: 15000 });
    const choices = page.locator('[data-testid="monitor-failure-choices"]');
    await choices.locator('[data-failure-choice="read"]').waitFor();
    assert.deepEqual(await choices.locator('[data-failure-choice]').evaluateAll((els) => els.map((e) => e.dataset.failureChoice)), ['read', 'copy']);
    const refused = backend.reads.run;
    await page.waitForTimeout(2500);
    assert.equal(backend.reads.run, refused, 'a refused read is not polled again on its own');
    backend.reads.refusing = false;
    await choices.getByRole('button', { name: 'Check again' }).click();
    await card.getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
    assert.ok(backend.reads.run >= 2);
  } finally {
    await ui.close();
  }
});
