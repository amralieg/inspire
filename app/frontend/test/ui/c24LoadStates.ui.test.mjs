// c24 RC7-A-02 / RC7-A-05: no false "Waiting" or "Connecting" while the first fetch is in flight; the run picker shows the completion date Home shows.
// Semantics: Monitor says "Loading the run..." until a poll has returned; "no saved progress" only after a poll returned no session.
// Review says "Connecting to your workspace" only once the first runs fetch has failed or taken over 10 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const NO_PROGRESS = 'Inspire has saved no progress for this run yet. Each step shows here as soon as it is saved.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (page) => page.locator('body').innerText();

test('Monitor: while the first fetch is in flight it says Loading the run, never the no-progress text', async () => {
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => setTimeout(() => res.json({ session: null }), 4000));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Monitor', exact: true, level: 1 }).waitFor({ timeout: 15000 });
    await sleep(1500);
    const text = await body(page);
    assert.match(text, /Loading the run\.\.\./, 'a neutral loading line is shown');
    assert.doesNotMatch(text, /saved no progress/, 'no false Waiting while the first fetch is in flight');
  } finally {
    await ui.close();
  }
});

test('Monitor: once the first fetch has returned with no saved progress, the no-progress text shows', async () => {
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => setTimeout(() => res.json({ session: null }), 1000));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount });
  const { page } = ui;
  try {
    await page.getByText(NO_PROGRESS).waitFor({ timeout: 15000 });
    assert.doesNotMatch(await body(page), /Loading the run\.\.\./, 'the loading line is gone once the fetch returned');
  } finally {
    await ui.close();
  }
});

test('Review: a runs fetch still in flight under 10 s never says Connecting to your workspace', async () => {
  const mount = (app) => {
    app.get('/api/inspire/sessions', (_req, res) => setTimeout(() => res.json({ sessions: [], truncated: false }), 4000));
  };
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: [] }, '', { mount });
  const { page } = ui;
  try {
    await page.getByText('Fetching your Inspire runs').waitFor({ timeout: 15000 });
    await sleep(1500);
    assert.doesNotMatch(await body(page), /Connecting to your workspace/, 'no Connecting before 10 s');
  } finally {
    await ui.close();
  }
});

test('Run picker: the date is the completion date Home shows, after an answers save moved last_updated', async () => {
  const sessions = [{
    session_id: '42', completed_percent: 100, business_name: 'RC4 Bakehouse', widget_values: { business: 'RC4 Bakehouse' },
    create_at: '2026-11-25T09:00:00Z', completed_on: '2026-11-25T10:30:00Z', last_updated: '2026-11-26T14:46:00Z',
    business_runs: 1, business_rank: 1,
  }];
  const ui = await openUi('results', { ...REVIEW_STATE, sessions });
  const { page } = ui;
  try {
    const head = page.locator('[data-run-heading]');
    await head.getByRole('button', { name: 'Change run' }).waitFor({ timeout: 15000 });
    await head.getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.locator('[data-run="42"]').waitFor();
    const row = await runs.locator('[data-run="42"]').innerText();
    assert.match(row, /Nov 25, 2026/, 'the completion date');
    assert.doesNotMatch(row, /Nov 26/, 'not the last-modified date');
  } finally {
    await ui.close();
  }
});
