import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { RUN_GONE_TEXT } from '../../src/lib/monitorState.js';

test.after(closeBrowser);

const RAW = /[A-Z]{2,}_[A-Z_]{2,}|\{"|SQLSTATE|\bHTTP\b|[0-9a-f]{8}-[0-9a-f]{4}-|\b\d{10,}\b/;
const visible = (page) => page.evaluate(() => {
  const root = document.querySelector('main') || document.body;
  const hidden = [...root.querySelectorAll('details')].map((d) => [d, d.style.display]);
  for (const [d] of hidden) d.style.display = 'none';
  const text = root.innerText;
  for (const [d, was] of hidden) d.style.display = was;
  return text;
});

function monitorBackend(runAnswer) {
  return (app) => {
    app.get('/api/run/777', (_req, res) => runAnswer(res));
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', completed_percent: 40, processing_status: 'running' } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  };
}

test('a schema list Databricks refuses says so in one sentence with the code under Details, never "No schemas found"', async () => {
  const mount = (app) => app.get('/api/catalogs/:catalog/schemas', (_req, res) => res.status(403).json({
    error: '{"error_code":"PERMISSION_DENIED","message":"User does not have USE CATALOG on Catalog \'main\'."}' }));
  const ui = await openUi('launch', { catalogs: ['main'] }, '', { mount });
  try {
    await ui.page.locator('button[title="main"]').click();
    await ui.page.getByText('Inspire could not list the schemas. The message above says why.').waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.match(shown, /Inspire cannot list your Unity Catalog data with your sign-in|give you access/);
    assert.doesNotMatch(shown, RAW);
    assert.doesNotMatch(shown, /No schemas found/);
  } finally {
    await ui.close();
  }
});

test('Databricks being busy while Inspire lists catalogs is never shown as a missing permission', async () => {
  const mount = (app) => app.get('/api/catalogs', (_req, res) => res.status(429).json({
    error: '{"error_code":"REQUEST_LIMIT_EXCEEDED","message":"Exceeded rate limit for /api/2.1/unity-catalog/catalogs."}' }));
  const ui = await openUi('launch', {}, '', { mount });
  try {
    await ui.page.getByText(/Databricks is busy right now, so wait a minute and try again/).first().waitFor({ timeout: 20000 });
    assert.equal(await ui.page.locator('[data-uc-permission]').count(), 0);
    const shown = await visible(ui.page);
    assert.doesNotMatch(shown, /permission/i);
    assert.doesNotMatch(shown, RAW);
  } finally {
    await ui.close();
  }
});

test('runs that cannot be read because the warehouse is gone are never shown as "No runs yet"', async () => {
  const mount = (app) => {
    const gone = (_req, res) => res.status(500).json({ error: 'SQL failed (404): {"error_code":"RESOURCE_DOES_NOT_EXIST","message":"SQL warehouse wh1 does not exist."}' });
    app.get('/api/inspire/sessions', gone);
    app.get('/api/inspire/usecases', gone);
  };
  const ui = await openUi('launch', {}, '', { mount });
  try {
    await ui.page.locator('[data-overview-error]').waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.match(shown, /pick another warehouse/);
    assert.doesNotMatch(shown, /No runs yet/);
    assert.doesNotMatch(shown, RAW);
  } finally {
    await ui.close();
  }
});

test('a run that timed out says so in words and never stays on Initializing', async () => {
  const mount = monitorBackend((res) => res.json({ run_id: 777, life_cycle_state: 'TERMINATED', result_state: 'TIMEDOUT', state_message: 'Run timed out after 3600 seconds' }));
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByText(/went past its time limit/).waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.doesNotMatch(shown, /Initializing/);
    assert.doesNotMatch(shown, /TIMEDOUT|TERMINATED/);
  } finally {
    await ui.close();
  }
});

test('a run someone else stopped reads as stopped with what to do next, and the state chip is words', async () => {
  const mount = monitorBackend((res) => res.json({ run_id: 777, life_cycle_state: 'TERMINATED', result_state: 'CANCELED', state_message: 'Run cancelled by other@example.com' }));
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByText(/start a new run on the Start page if you need the rest/).waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.doesNotMatch(shown, /CANCELED|TERMINATED/);
    assert.equal(await ui.page.getByText('Stopped', { exact: true }).count(), 1, 'the state is said once');
  } finally {
    await ui.close();
  }
});

test('a run that no longer exists stops the checks at once, says what to do, and offers no retry', async () => {
  let asks = 0;
  const mount = monitorBackend((res) => { asks += 1; res.status(404).json({ error: 'Run 777000111222 does not exist' }); });
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.locator('[data-poll-problem="stopped"]').waitFor({ timeout: 20000 });
    assert.match(await ui.page.locator('[data-poll-problem]').innerText(), new RegExp(RUN_GONE_TEXT.replace(/[.]/g, '\\.')));
    assert.equal(await ui.page.getByRole('button', { name: 'Check again' }).count(), 0);
    const before = asks;
    await ui.page.waitForTimeout(8000);
    assert.ok(asks - before <= 1, `no more checks after a deterministic failure: ${asks - before}`);
    assert.doesNotMatch(await visible(ui.page), /777000111222/);
  } finally {
    await ui.close();
  }
});

test('a run Databricks cannot answer for right now keeps being checked and says so, instead of a silent spinner', async () => {
  const mount = monitorBackend((res) => res.status(503).json({ error: 'TEMPORARILY_UNAVAILABLE: The service is temporarily unavailable' }));
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.locator('[data-poll-problem="checking"]').waitFor({ timeout: 30000 });
    assert.match(await ui.page.locator('[data-poll-problem]').innerText(), /checks again every few seconds/);
    assert.doesNotMatch(await visible(ui.page), RAW);
  } finally {
    await ui.close();
  }
});

test('Home that cannot read the runs says why once, with what to do, and never claims 0 completed', async () => {
  const BUSY = 'SQL failed (429): {"error_code":"REQUEST_LIMIT_EXCEEDED","message":"Too many requests. Please retry after 60 seconds."}';
  const ui = await openUi('choose', { sessionsErrors: [BUSY, BUSY, BUSY, BUSY] });
  try {
    await ui.page.locator('[data-runs-error]').waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.match(shown, /Inspire could not load your runs, and you can still start a new one: Databricks is busy right now, so wait a minute and try again\./);
    assert.doesNotMatch(shown, /\b0 completed\b/);
    assert.doesNotMatch(shown, RAW);
  } finally {
    await ui.close();
  }
});

test('Launch says a lost connection once, not once per list', async () => {
  const mount = (app) => {
    const down = (_req, res) => res.status(502).json({ error: 'Cannot reach the Databricks workspace (fetch failed; ECONNREFUSED). The workspace did not answer.' });
    app.get('/api/inspire/sessions', down);
    app.get('/api/inspire/usecases', down);
  };
  const ui = await openUi('launch', {}, '', { mount });
  try {
    await ui.page.locator('[data-overview-error]').waitFor({ timeout: 20000 });
    const shown = await visible(ui.page);
    assert.equal(shown.split('Inspire lost its connection to Databricks').length - 1, 1, shown);
  } finally {
    await ui.close();
  }
});

const STAGE_FAILURES = [
  ['Metadata', 'Read the tables', '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`s`.`orders`. SQLSTATE: 42501', /access to table main\.s\.orders was refused, so ask its owner/i, false, 'SELECT on Table'],
  ['Use cases', 'Write the use cases', '{"error_code":"REQUEST_LIMIT_EXCEEDED","message":"Too Many Requests (HTTP 429) for request 0f8c2d1e-9a3b-4c5d-8e7f-1a2b3c4d5e6f"}', /Databricks is busy right now, so wait a minute and try again/i, true, 'Too Many Requests (HTTP 429)'],
  ['Scoring', 'Score the use cases', '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`__inspire_usecases` cannot be found. SQLSTATE: 42P01', /table main\.s\.__inspire_usecases does not exist, so check/i, false, 'cannot be found'],
  ['Artifacts', 'Write the catalog', 'RESOURCE_EXHAUSTED: quota exceeded for workspace 1234567890123456', /reached one of its Databricks limits, so remove what you no longer use/i, false, 'quota exceeded'],
];

for (const [stage, name, message, said, transient, raw] of STAGE_FAILURES) {
  test(`a step that fails in ${stage} reads as one plain sentence in Detailed Steps, with the raw error under Details${transient ? '' : ' and no promise that trying again helps'}`, async () => {
    const mount = (app) => {
      app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, life_cycle_state: 'TERMINATED', result_state: 'FAILED', start_time: Date.now() - 3600000, end_time: Date.now() - 60000, tasks: [] }));
      app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', completed_percent: 40, processing_status: 'failed' } }));
      app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : [{ step_id: '1', session_id: '42', stage_name: stage, step_name: name, sub_step_name: '', status: 'ended_error', message, progress_increment: 0, last_updated: new Date(Date.now() - 120000).toISOString() }] }));
    };
    const ui = await openUi('monitor', {}, '', { mount });
    try {
      await ui.page.getByRole('button', { name: /Detailed Steps/ }).click();
      await ui.page.getByRole('button', { name: new RegExp(`^${stage}`) }).filter({ has: ui.page.locator('h3') }).click();
      await ui.page.getByText(said).first().waitFor({ timeout: 20000 });
      const shown = await visible(ui.page);
      assert.doesNotMatch(shown, RAW);
      if (!transient) assert.doesNotMatch(shown.match(new RegExp(`${said.source}[^\\n]*`, 'i'))[0], /try again/);
      await ui.page.getByText(name, { exact: true }).click();
      const details = ui.page.locator('details[data-technical-details]').filter({ hasText: raw });
      assert.equal(await details.count(), 1, 'the raw error sits once under Details');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

for (const [label, answer, said, transient, statusText] of [
  ['refused', [403, { error: '[PERMISSION_DENIED] User does not have CREATE SCHEMA on Catalog `main`. SQLSTATE: 42501' }], /access to catalog main was refused, so ask its owner or a workspace admin to give you access/i, false, 'Forbidden'],
  ['over a quota', [400, { error: '{"error_code":"QUOTA_EXCEEDED","message":"Workspace 1234567890123456 has reached the quota of jobs"}' }], /reached one of its Databricks limits/i, false, 'Bad Request'],
  ['busy', [429, { error: 'REQUEST_LIMIT_EXCEEDED: Too Many Requests (HTTP 429)' }], /Databricks is busy right now, so wait a minute and try again/i, true, 'Too Many Requests'],
]) {
  test(`Generate data that Databricks answers ${label} says so in one sentence${transient ? '' : ' with no try-again promise'}, the raw error under Details`, async () => {
    const ui = await openUi('generate', { demoAnswer: answer });
    try {
      await ui.page.getByPlaceholder(/./).first().fill('Acme');
      await ui.page.locator('textarea').fill('A retailer with stores and an online shop');
      await ui.page.locator('button[type="submit"]').click();
      await ui.page.getByText(said).first().waitFor({ timeout: 20000 });
      const shown = await visible(ui.page);
      assert.doesNotMatch(shown, RAW);
      if (!transient) assert.doesNotMatch(shown, /try again/i);
      assert.equal(await ui.page.locator('details[data-technical-details]').filter({ hasText: /PERMISSION_DENIED|quota of jobs|REQUEST_LIMIT_EXCEEDED/ }).count(), 1, 'the raw error sits once under Details');
      assert.equal(await ui.page.getByText('Inspire started').count(), 0);
      assert.deepEqual(ui.pageErrors, [`Failed to load resource: the server responded with a status of ${answer[0]} (${statusText})`], 'the refused generate call is the only error');
    } finally {
      await ui.close();
    }
  });
}
