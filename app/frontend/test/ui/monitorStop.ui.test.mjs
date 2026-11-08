import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { staysInShowcase } from '../../src/lib/showcase.js';

test.after(closeBrowser);

const REFUSAL = 'Only the person who launched run 777, or an App manager, can cancel it. launcher@example.com launched it; ask them or an App manager.';
const besides403 = (errors) => errors.filter((e) => !/status of 403/.test(e));

function runBackend({ verdict = { allowed: true }, finished = false } = {}) {
  const calls = { posts: 0, checks: 0 };
  let run = finished ? { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } : { life_cycle_state: 'RUNNING' };
  const mount = (app) => {
    app.get('/api/run/777/cancel', (_req, res) => { calls.checks += 1; res.json(verdict); });
    app.post('/api/run/777/cancel', (_req, res) => {
      calls.posts += 1;
      run = { life_cycle_state: 'TERMINATED', result_state: 'CANCELED' };
      res.json({ ok: true });
    });
    app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', ...run }));
    app.get('/api/inspire/session', (_req, res) => res.json({ session: {
      session_id: '42', business_name: 'Acme Retail', completed_percent: finished ? 100 : 40,
      processing_status: finished ? 'done' : 'running', completed_on: finished ? '2026-11-01T00:00:00Z' : null,
    } }));
    app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  };
  return { calls, mount };
}

test('the person who launched a running Discover run stops it after one confirm that names the business, and the page shows it stopped', async () => {
  const { calls, mount } = runBackend();
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByRole('button', { name: 'Stop this run' }).click();
    const confirm = ui.page.getByRole('group', { name: 'Stop this run' });
    assert.match(await confirm.innerText(), /Stop the Discover run for Acme Retail\? What the run already wrote stays\./);
    assert.equal(calls.posts, 0, 'nothing is sent before the confirm');
    await confirm.getByRole('button', { name: 'Stop the run' }).click();
    await until(() => calls.posts === 1, 'the stop request');
    await ui.page.getByText('Stopped', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await ui.page.getByText('The run was stopped. What it already wrote stays.').count(), 1);
    assert.equal(await ui.page.getByRole('button', { name: 'Stop this run' }).count(), 0);
    assert.equal(calls.posts, 1);
    assert.deepEqual(besides403(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('a double click on Stop the run sends one request', async () => {
  const { calls, mount } = runBackend();
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByRole('button', { name: 'Stop this run' }).click();
    await ui.page.getByRole('button', { name: 'Stop the run' }).dblclick();
    await ui.page.getByText('Stopped', { exact: true }).waitFor({ timeout: 10000 });
    await idle(ui.page);
    assert.equal(calls.posts, 1);
  } finally {
    await ui.close();
  }
});

test('someone who did not launch the run sees why in the words the cancel route returns, and no Stop control or request', async () => {
  const { calls, mount } = runBackend({ verdict: { allowed: false, error: REFUSAL, policy: { route: 'POST /api/run/:runId/cancel', rule: 'launcher' } } });
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    const why = ui.page.getByRole('status').filter({ hasText: 'Only the person who launched run 777' });
    await why.waitFor({ timeout: 10000 });
    assert.equal(await why.innerText(), REFUSAL);
    assert.equal(await ui.page.getByRole('button', { name: 'Stop this run' }).count(), 0);
    assert.equal(calls.posts, 0);
  } finally {
    await ui.close();
  }
});

test('a finished run offers no Stop and never asks whether it may be stopped', async () => {
  const { calls, mount } = runBackend({ finished: true });
  const ui = await openUi('monitor', {}, '', { mount });
  try {
    await ui.page.getByText('Completed', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await ui.page.getByRole('button', { name: 'Stop this run' }).count(), 0);
    assert.equal(calls.checks, 0);
    assert.equal(calls.posts, 0);
  } finally {
    await ui.close();
  }
});

test('the demo shows the recorded Monitor page but never offers Stop on it', () => {
  assert.equal(staysInShowcase('monitor'), true, 'the demo walks through its recorded Monitor page');
  const src = (name) => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', name), 'utf8');
  assert.match(src('App.jsx'), /runId=\{inDemo \? null : runId\}/, 'a demo hands Monitor no run to stop');
  assert.match(src('pages/MonitorPage.jsx'), /\{!showcase && runId && runInfo && \(isPending \|\| isRunning\) && <StopRunControl /, 'Monitor offers Stop only outside a demo');
});
