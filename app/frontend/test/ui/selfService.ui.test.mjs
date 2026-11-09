import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, goToStep, openAdvanced, openAsset, openUi, until } from './uiSupport.mjs';
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
    assert.deepEqual(await choices.locator('[data-failure-choice]').evaluateAll((els) => els.map((e) => e.dataset.failureChoice)), ['again', 'open', 'copy']);
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

test('Run again on a failed Monitor run starts it again in a new session and Monitor follows the new run; a refusal says why', async () => {
  const backend = monitorBackend(FAILED_RUN);
  const asked = [];
  let refuse = true;
  const mount = (app) => {
    app.post('/api/run/777/again', (req, res) => {
      asked.push(req.body);
      if (refuse) return res.status(403).json({ error: 'Only the person who launched run 777, or an App manager, can run it again. someone@example.com launched it.' });
      return res.json({ run_id: 888 });
    });
    app.get('/api/run/888', (_req, res) => res.json({ run_id: 888, life_cycle_state: 'RUNNING', start_time: Date.now() - 1000, tasks: [] }));
    backend.mount(app);
  };
  const ui = await openUi('monitor', {}, '', { mount, init: (page) => page.addInitScript(CLIPBOARD) });
  const { page } = ui;
  try {
    const choices = page.locator('[data-testid="monitor-failure-choices"]');
    await choices.getByRole('button', { name: 'Run again' }).click();
    const refused = choices.locator('[data-run-again-error]');
    await refused.waitFor({ timeout: 15000 });
    assert.match(await refused.innerText(), /^Inspire could not run it again: Only the person who launched run 777, or an App manager, can run it again\./);
    refuse = false;
    await choices.getByRole('button', { name: 'Run again' }).click();
    await page.locator('[data-testid="monitor-status"]').getByText('Running', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(asked.length, 2);
    assert.match(asked[1].session_id, /^\d{13,19}$/);
    assert.notEqual(asked[1].session_id, '42', 'a new session, never the failed one (must-exclude)');
    assert.equal(await page.locator('[data-run-again-error]').count(), 0);
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

const ME = { me: { userName: ['owner', 'example.com'].join('@'), displayName: 'Owner' } };
const sentence = (box) => box.evaluate((el) => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('details, button, [role="status"]').forEach((d) => d.remove());
  return copy.innerText.trim();
});

test('a wizard warehouse list Databricks refused says so in plain words with the code under Details, and Try again lists the warehouses', async () => {
  const flaky = failing('/api/warehouses', { status: 403, error: 'PERMISSION_DENIED: User is not allowed to list SQL warehouses.' });
  const ui = await openUi('wizard', ME, '', { init: flaky.init });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await openAdvanced(page);
    const box = page.locator('[data-build-warehouse-error]');
    await box.waitFor({ timeout: 15000 });
    assert.equal(await sentence(box), 'Inspire could not list the SQL warehouses: User is not allowed to list SQL warehouses, so ask its owner or a workspace admin to give you access. Type the warehouse id instead.');
    await box.locator('summary').click();
    assert.match(await box.locator('[data-technical-details] pre').innerText(), /PERMISSION_DENIED/);
    assert.equal(await page.locator('[data-build-warehouse="typed"]').count(), 1);
    const asked = flaky.heal();
    await box.getByRole('button', { name: 'Try again' }).click();
    await page.locator('[data-build-warehouse="pick"]').waitFor({ timeout: 15000 });
    assert.equal(await box.count(), 0, 'the message goes once the list is read');
    assert.ok(flaky.calls.n > asked, 'Try again read the warehouses again');
  } finally {
    await ui.close();
  }
});

test('a wizard step check that could not run offers Try again and Copy what to send, and Try again runs the checks again', async () => {
  const flaky = failing('/api/inspire/implement/preflight', { error: 'The SQL warehouse did not answer in time' });
  const ui = await openUi('wizard', ME, '', { init: flaky.init });
  const { page } = ui;
  try {
    await goToStep(page, 'Deliver');
    const box = page.getByRole('alert').filter({ hasText: 'The SQL warehouse did not answer in time' });
    await box.waitFor({ timeout: 15000 });
    await box.getByRole('button', { name: 'Copy what to send' }).click();
    await box.getByText(COPIED_SEND_TEXT).waitFor();
    const [copied] = await page.evaluate(() => window.__copied);
    assert.match(copied, /The SQL warehouse did not answer in time/);
    const asked = flaky.heal();
    await box.getByRole('button', { name: 'Try again' }).click();
    await until(() => flaky.calls.n > asked, 'Try again runs the checks again');
    await page.getByText('The SQL warehouse did not answer in time').waitFor({ state: 'detached', timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('the App placement step that could not list the Apps Inspire built says so with Try again, and Try again lists them', async () => {
  const flaky = failing('/api/inspire/implement/merge-targets', { error: 'The SQL warehouse did not answer in time' });
  const ui = await openUi('wizard', ME, '', { init: flaky.init });
  const { page } = ui;
  try {
    await goToStep(page, 'App placement');
    const box = page.locator('[data-app-targets-error]');
    await box.waitFor({ timeout: 15000 });
    assert.match(await sentence(box), /^Inspire could not list the Apps it built: .*\. Genie creates a new one\.$/);
    assert.equal(await page.locator('[data-app-place="join"] input[type="radio"]').isDisabled(), true, 'nothing to add to while the list failed (must-exclude)');
    const asked = flaky.heal();
    await box.getByRole('button', { name: 'Try again' }).click();
    await box.waitFor({ state: 'detached', timeout: 15000 });
    assert.ok(flaky.calls.n > asked, 'Try again listed the Apps again');
  } finally {
    await ui.close();
  }
});

test('Setup checks that failed offer Check again, which runs them again, and Copy what to send with every failed check', async () => {
  let verifies = 0;
  const ui = await openUi('setup', {}, '', {
    init: (page) => page.addInitScript(CLIPBOARD),
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: false }));
      app.get('/api/health', (_req, res) => res.json({ isDatabricksApp: false }));
      app.post('/api/setup/create-database', (_req, res) => res.json({ ok: true }));
      app.post('/api/setup/verify', (_req, res) => {
        verifies += 1;
        if (verifies === 1) return res.json({ ok: false, checks: { warehouse: { ok: false, message: 'The SQL warehouse is stopped' }, database: { ok: true, message: 'The Inspire database is ready' } } });
        return res.json({ ok: true, checks: { warehouse: { ok: true, message: 'The warehouse answers' } } });
      });
    },
  });
  const { page } = ui;
  try {
    for (let i = 0; i < 4; i += 1) {
      const next = page.getByRole('button', { name: 'Continue' });
      await next.waitFor();
      await next.click();
    }
    await page.getByRole('button', { name: 'Run Verification' }).click();
    const again = page.locator('[data-verify-again]');
    await again.waitFor({ timeout: 15000 });
    await again.getByRole('button', { name: 'Copy what to send' }).click();
    await again.getByText(COPIED_SEND_TEXT).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__copied), ['warehouse: The SQL warehouse is stopped']);
    await again.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('button', { name: 'Publish Notebook to Workspace' }).waitFor({ timeout: 15000 });
    assert.equal(verifies, 2);
    assert.equal(await again.count(), 0, 'checks that pass offer no Check again (must-exclude)');
  } finally {
    await ui.close();
  }
});
