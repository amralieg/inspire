import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

function logBackend(answer) {
  const calls = { reads: [] };
  const mount = (app) => {
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING' }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/inspire/session', (_req, res) => res.json({ session: {
      session_id: '42', business_name: 'Acme Retail', completed_percent: 40, processing_status: 'running', completed_on: null,
    } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
    app.get('/api/inspire/log', (req, res) => {
      calls.reads.push(req.query);
      const [status, body] = answer(calls.reads.length);
      res.status(status).json(body);
    });
  };
  return { calls, mount };
}

test('the person who launched a run opens its live log from the Monitor page, and Refresh reads it again', async () => {
  const { calls, mount } = logBackend((n) => [200, { found: true, truncated: n > 1, text: n > 1 ? 'step two\n' : 'step one\n', size: 9 }]);
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    assert.equal(calls.reads.length, 0, 'the log is read only when asked for');
    await ui.page.getByRole('button', { name: 'Show the run log' }).click();
    const pre = ui.page.getByLabel('Run log');
    await pre.waitFor({ timeout: 10000 });
    assert.equal((await pre.innerText()).trim(), 'step one');
    assert.equal(calls.reads[0].session_id, '42');
    await ui.page.getByRole('button', { name: 'Refresh' }).click();
    await until(() => calls.reads.length === 2, 'the second read');
    await ui.page.getByText('step two').waitFor({ timeout: 10000 });
    assert.equal(await ui.page.getByText('Showing the last part of the log.').count(), 1);
  } finally {
    await ui.close();
  }
});

test('someone the App refuses sees the refusal in plain words and no log text', async () => {
  const refusal = 'Only the person who launched session 42, or an App manager, can read its run log.';
  const { mount } = logBackend(() => [403, { error: refusal, policy: { rule: 'launcher' } }]);
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByRole('button', { name: 'Show the run log' }).click();
    const alert = ui.page.getByRole('alert').filter({ hasText: 'Only the person who launched session 42' });
    await alert.waitFor({ timeout: 10000 });
    assert.equal(await ui.page.getByLabel('Run log').count(), 0);
  } finally {
    await ui.close();
  }
});

test('a run that has not written its log yet says so', async () => {
  const { mount } = logBackend(() => [200, { found: false, text: '', truncated: false, size: 0 }]);
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByRole('button', { name: 'Show the run log' }).click();
    await ui.page.getByText('The run has not written its log yet. Refresh in a minute.').waitFor({ timeout: 10000 });
  } finally {
    await ui.close();
  }
});
