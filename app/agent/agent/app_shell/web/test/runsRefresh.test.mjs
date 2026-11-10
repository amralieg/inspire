import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { bundleEntry, openBundle, serveDist, SRC } from './harness.mjs';

const HOST = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRuns, useTrends } from ${JSON.stringify(join(SRC, 'Freshness.jsx'))};
function Host() {
  const [nonce, setNonce] = useState(0);
  const runs = useRuns('p1', 0, nonce, true);
  const trends = useTrends('p1', nonce, true);
  return h('div', null,
    h('button', { id: 'again', onClick: () => setNonce((n) => n + 1) }, 'again'),
    h('p', { id: 'runs' }, runs.data ? 'runs ' + runs.data.runs.length : 'runs none'),
    h('p', { id: 'runs-err' }, runs.error || ''),
    h('p', { id: 'trends' }, trends.data ? 'trends yes' : 'trends none'),
    h('p', { id: 'trends-err' }, trends.error || ''));
}
createRoot(document.getElementById('root')).render(h(Host));
`;

const RUNS = { runs: [{ run_id: 'r1', trigger: 'run now', state: 'done', started: '2026-10-20T09:00:00Z' }, { run_id: 'r2', trigger: 'schedule', state: 'done', started: '2026-10-19T09:00:00Z' }],
  total: 2, offset: 0, limit: 20, job: null, errors: {} };
const TRENDS = { visible: true, tracked: true, actions: false, note: 'no actions' };

let browser;
let host;
let served;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
  host = await bundleEntry(HOST);
});

after(async () => {
  await browser?.close();
  served?.close();
});

test('a runs timeline and trends that fail to reload after a decision keep the data they showed and name the failure', async () => {
  let broken = false;
  const routes = {
    runs: ({ json }) => (broken ? json(502, { error: 'INSUFFICIENT_PERMISSIONS: the runs view is not granted' }) : json(200, RUNS)),
    trends: ({ json }) => (broken ? json(502, { error: 'INSUFFICIENT_PERMISSIONS: the trends view is not granted' }) : json(200, TRENDS)),
  };
  const { page, context, errors } = await openBundle(browser, host, {}, routes);
  await page.locator('#runs', { hasText: 'runs 2' }).waitFor();
  await page.locator('#trends', { hasText: 'trends yes' }).waitFor();
  broken = true;
  await page.locator('#again').click();
  await page.waitForFunction(() => document.querySelector('#runs-err')?.textContent.length > 0);
  assert.equal(await page.locator('#runs').innerText(), 'runs 2', 'the runs timeline keeps the runs it showed');
  assert.equal(await page.locator('#trends').innerText(), 'trends yes', 'the trends keep the data they showed');
  assert.match(await page.locator('#runs-err').innerText(), /not granted/);
  await context.close();
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
});
