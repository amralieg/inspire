import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, SUMMARY, TABLE, actBody, appInfo, lister, openApp, pageData, serveDist, tracked } from './harness.mjs';
import { readsOnly, retryable, RETRY_STATUSES, UNREACHABLE_TEXT } from '../src/api.js';

const DENIED = '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table `main`.`sales`.`loss`. Ask the owner to run: GRANT SELECT ON TABLE main.sales.loss TO `sam@example.com` SQLSTATE: 42501';
const CLOCK = new Date('2026-10-27T09:30:00Z');
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);
const label = (n) => `Item number ${n} with a long descriptive name`;

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const failing = (times, fail) => {
  let left = times;
  return (route, ok) => {
    if (left > 0) {
      left -= 1;
      return fail(route);
    }
    return ok();
  };
};

test('reads retry once on their own, writes and lasting refusals do not', () => {
  assert.equal(readsOnly('GET', 'records/history'), true);
  for (const path of ['page', 'records', 'overview', 'my_work']) assert.equal(readsOnly('POST', path), true, path);
  for (const path of ['records/act', 'records/undo', 'alerts/save', 'genie/ask', 'refresh', 'settings/save']) assert.equal(readsOnly('POST', path), false, path);
  assert.deepEqual(RETRY_STATUSES, [429, 503, 504]);
  assert.equal(retryable({ status: 500 }), true);
  assert.equal(retryable({ status: 0 }), true);
  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 403 }), false);
  assert.equal(retryable({ status: 409 }), false);
  assert.equal(retryable({ status: 503, calm: true }), false);
});

test('a network blip while the App starts recovers on its own, and a second one shows Try again that starts it', async () => {
  const info = appInfo();
  let asked = 0;
  const blip = failing(1, (route) => route.abort('internetdisconnected'));
  const once = await openApp(browser, served.base, info, {
    routes: { app: ({ route, json }) => { asked += 1; return blip(route, () => json(200, info)); } },
  });
  assert.equal(asked, 2, 'the App asked again after the blip');
  assert.equal(await once.page.locator('.fatal').count(), 0);
  await once.context.close();

  asked = 0;
  const down = failing(2, (route) => route.abort('internetdisconnected'));
  const { page, context } = await openApp(browser, served.base, info, {
    ready: '.fatal', routes: { app: ({ route, json }) => { asked += 1; return down(route, () => json(200, info)); } },
  });
  assert.equal(asked, 2);
  assert.match(await page.locator('.fatal p').first().innerText(), new RegExp(`^${UNREACHABLE_TEXT}`));
  const again = page.locator('.fatal [data-retry]');
  assert.equal(await again.innerText(), 'Try again');
  await again.click();
  await page.waitForSelector('.kpi-v, .hcard');
  assert.equal(asked, 3, 'Try again asked the App again');
  assert.equal(await page.locator('.fatal').count(), 0);
  await context.close();
});

function pageFailingOnce(errors) {
  const reads = [];
  const route = ({ route: r, json }) => {
    const body = r.request().postDataJSON();
    reads.push(body);
    return json(200, { ...pageData(body.filters), errors: reads.length === 1 ? errors : {} });
  };
  return { reads, route };
}

test('a chart that could not load offers Try again, which reads the page again and draws the chart', async () => {
  const flaky = pageFailingOnce({ 'chart:pareto': 'the warehouse is stopped' });
  const { page, context } = await openApp(browser, served.base, appInfo(), { routes: { page: flaky.route } });
  const card = page.locator('[data-card="pareto"]');
  await card.locator('.tile-err').waitFor();
  const retry = card.locator('.tile-err [data-retry]');
  assert.equal(await retry.innerText(), 'Try again');
  await retry.click();
  await page.waitForFunction(() => !document.querySelector('[data-card="pareto"] .tile-err') && document.querySelector('[data-card="pareto"] canvas, [data-card="pareto"] svg, [data-card="pareto"] .hbar'));
  assert.equal(flaky.reads.length, 2, 'Try again read the page a second time');
  await context.close();
});

test('a key number that could not load reads again on Try again', async () => {
  const kpi = Object.keys(pageData({}).kpis)[0];
  const flaky = pageFailingOnce({ [`kpi:${kpi}`]: 'the warehouse is stopped' });
  const { page, context } = await openApp(browser, served.base, appInfo(), { ready: '.kpi .tile-err', routes: { page: flaky.route } });
  await page.locator('.kpi .tile-err [data-retry]').first().click();
  await page.waitForFunction(() => !document.querySelector('.kpi .tile-err'));
  assert.equal(flaky.reads.length, 2);
  await context.close();
});

test('a page whose data could not load reads again on Try again and shows its key numbers', async () => {
  const reads = [];
  const { page, context } = await openApp(browser, served.base, appInfo(), {
    ready: '.tile-err',
    routes: {
      page: ({ route, json }) => {
        const body = route.request().postDataJSON();
        reads.push(body);
        return reads.length === 1 ? json(500, { error: 'the warehouse did not answer in time' }) : json(200, { ...pageData(body.filters), errors: {} });
      },
    },
  });
  const err = page.locator('.tile-err', { hasText: 'the warehouse did not answer in time' }).first();
  await err.locator('[data-retry]').click();
  await page.waitForSelector('.kpi-v');
  assert.equal(reads.length, 2, 'Try again sent the page read again');
  assert.equal(await page.locator('.tile-err', { hasText: 'the warehouse did not answer in time' }).count(), 0);
  await context.close();
});

test('an error that carries a grant offers Copy what to send with the sentence and the grant', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { errors: { 'chart:pareto': DENIED } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: served.base });
  const card = page.locator('[data-card="pareto"]');
  await card.locator('.tile-err').waitFor();
  await card.locator('[data-copy-send]').click();
  await page.waitForFunction(() => /Copied/.test(document.querySelector('.toast .toast-t')?.textContent || ''));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^This chart could not load: /);
  assert.match(copied, /GRANT SELECT ON TABLE main\.sales\.loss TO `sam@example\.com`/);
  await context.close();
});

test('the list that could not load reads again on Try again', async () => {
  let reads = 0;
  let failing = true;
  const rows = lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF });
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), {
    clock: CLOCK, hash: '#/n01_u05/work', ready: '.tile-err',
    routes: tracked({
      records: (args) => { reads += 1; return failing ? args.json(500, { error: 'the warehouse did not answer in time' }) : rows(args); },
    }).routes,
  });
  const err = page.locator('.tile-err', { hasText: 'The list could not load' });
  await err.waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await err.count(), 1, 'the list stays failed until the person asks again');
  const asked = reads;
  failing = false;
  await err.locator('[data-retry]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0
    && ![...document.querySelectorAll('.tile-err')].some((e) => /The list could not load/.test(e.textContent)));
  assert.ok(reads > asked, 'Try again read the list again');
  await context.close();
});

test('a record action that failed on the server offers Try again in its message, which sends the action again', async () => {
  const acts = [];
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), {
    clock: CLOCK, timezone: 'Asia/Dubai', hash: '#/n01_u05/work',
    routes: tracked({
      records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
      'records/act': ({ route, json }) => {
        const body = actBody(route);
        acts.push(body);
        return acts.length === 1 ? json(500, { error: 'The SQL warehouse did not answer in time' })
          : json(200, { written: body.record_keys || [], conflicts: [], batch_id: `b${'0'.repeat(31)}` });
      },
    }).routes,
  });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  await page.getByRole('button', { name: 'Mark done…' }).click();
  await page.locator('.pop button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'The SQL warehouse did not answer in time');
  const again = page.locator('.toast .toast-a button', { hasText: 'Try again' });
  await again.click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent !== 'The SQL warehouse did not answer in time');
  assert.equal(acts.length, 2, 'Try again sent the action a second time');
  assert.deepEqual(acts[1].record_keys, acts[0].record_keys);
  await context.close();
});

test('a refused record action offers no Try again, because it would fail the same way', async () => {
  const acts = [];
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), {
    clock: CLOCK, timezone: 'Asia/Dubai', hash: '#/n01_u05/work',
    routes: tracked({
      records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
      'records/act': ({ route, json }) => { acts.push(actBody(route)); return json(403, { error: 'You may not change these records' }); },
    }).routes,
  });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  await page.getByRole('button', { name: 'Mark done…' }).click();
  await page.locator('.pop button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'You may not change these records');
  assert.equal(await page.locator('.toast .toast-a button', { hasText: 'Try again' }).count(), 0);
  assert.equal(acts.length, 1);
  await context.close();
});

test('an Ask Genie question that failed offers Try again, which asks the same question again and shows the answer', async () => {
  const asks = [];
  let polls = 0;
  const info = appInfo();
  const { page, context } = await openApp(browser, served.base, info, {
    routes: {
      'genie/ask': ({ route, json }) => {
        asks.push(route.request().postDataJSON());
        return asks.length === 1 ? json(502, { error: 'Genie did not answer in time' }) : json(200, { conversation_id: 'c1', message_id: 'm1' });
      },
      'genie/message': ({ json }) => {
        polls += 1;
        return polls < 2 ? json(200, { state: 'running', step: 'Writing the SQL' })
          : json(200, { state: 'done', text: 'Books lost the most.', sql: 'SELECT 1', columns: [], rows: [], truncated: false });
      },
    },
  });
  await page.goto(`${served.base}#/${info.pages[0].id}`);
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByLabel('Your question').fill('Which category lost the most?');
  await page.getByRole('button', { name: 'Send' }).click();
  const err = page.locator('.g-err').first();
  await err.waitFor();
  await err.locator('[data-retry]').click();
  await page.locator('aside.genie', { hasText: 'Books lost the most.' }).waitFor({ timeout: 15000 });
  assert.equal(asks.length, 2, 'Try again asked Genie a second time');
  assert.equal(asks[1].question, asks[0].question);
  assert.equal(await page.locator('.g-err').count(), 0, 'the failed answer is replaced by the new one');
  await context.close();
});

test('owner settings that could not load say so and read again on Try again', async () => {
  let reads = 0;
  const info = appInfo();
  const { page, context } = await openApp(browser, served.base, info, {
    hash: `#/${info.pages[0].id}/settings`, ready: '[data-settings]',
    routes: {
      settings: ({ json }) => {
        reads += 1;
        return reads === 1 ? json(500, { error: 'the settings table could not be read' }) : json(200, { settings: [], history: [], owner: false, can_run: false });
      },
    },
  });
  const err = page.locator('[data-settings] .tile-err');
  await err.waitFor();
  assert.match(await err.innerText(), /^The settings of this use case could not load: the settings table could not be read/);
  await err.locator('[data-retry]').click();
  await page.waitForFunction(() => !document.querySelector('[data-settings] .tile-err'));
  assert.ok(reads >= 2, 'Try again read the settings again');
  await context.close();
});
