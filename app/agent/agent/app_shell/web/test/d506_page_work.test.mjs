// REQ-506 lane 2 (page and work): a 2-line page header, an Overview strip on Work, Resolve (+value) first on every row, 3 visible actions plus More.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, SUMMARY, TABLE, appInfo, lister, openApp, serveDist, tracked, until } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PAGE = 'n01_u05';
const STAKE = [2340, null, 125000];
const VALUED = ROWS.map((r, i) => ({ ...r, value_at_stake: i < STAKE.length ? STAKE[i] : 1000 + i }));
const READY = '.card--table tbody tr';

function routesFor(rows = VALUED) {
  return tracked({ records: lister(rows, { actions: true, changes: true, summary: SUMMARY }) });
}

async function openWork(routes) {
  return openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, hash: `#/${PAGE}/work`, ready: READY });
}

const shownButtons = (scope) => scope.locator('button').evaluateAll((els) => els
  .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0 && !el.closest('[role="menu"]'))
  .map((el) => el.innerText.trim()));

test('the page header is the title, the mission line and one KPI, nothing else', async () => {
  const { routes } = routesFor();
  const info = appInfo(DECIDE, 1, TABLE);
  const { page, context, seen } = await openApp(browser, served.base, info, { routes, hash: `#/${PAGE}/work`, ready: READY });
  try {
    const head = page.locator('header.ph');
    await head.locator('h1').waitFor({ state: 'visible' });
    assert.equal(await head.locator('h1').count(), 1);
    assert.equal((await head.locator('.ph-q').innerText()).trim(), info.pages[0].question, 'the mission line is the use case question, on Work too');
    assert.equal(await head.locator('[data-head-kpi]').count(), 1, 'one KPI in the header');
    for (const gone of ['.style-kicker', '.ph-kicker', '.ph-meta', '.ph-story', '[data-story]', '[data-value-estimate]', '[data-value-strip]', '.value-strip',
      '.ph-sec', '.head-more']) {
      assert.equal(await head.locator(gone).count(), 0, `${gone} is not in the header`);
    }
    const lines = (await head.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(lines.length <= 4, `the header reads in a few lines, saw ${lines.length}: ${JSON.stringify(lines)}`);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('Work opens with a collapsible Overview strip that holds the page KPIs', async () => {
  const { routes } = routesFor();
  const { page, context, seen } = await openWork(routes);
  try {
    const overview = page.locator('[data-overview]');
    await overview.waitFor({ state: 'visible' });
    const toggle = overview.locator('[data-overview-toggle]');
    assert.equal(await toggle.count(), 1, 'the strip has one toggle');
    await overview.locator('.kpi-v').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-overview]').evaluate((el, list) => {
      const rows = document.querySelector(list);
      return !!rows && (el.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }, READY), true, 'the Overview strip sits above the list');
    await toggle.click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-overview] .kpi-v')].every((k) => !k.checkVisibility()));
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('every open row leads with Resolve, showing the value the record brings, and one click writes Done for that record', async () => {
  const { calls, routes } = routesFor();
  const { page, context, seen } = await openWork(routes);
  try {
    const first = page.locator('[data-resolve="R001"]');
    await first.waitFor({ state: 'visible' });
    assert.match((await first.innerText()).trim(), /^Resolve\s*\+\D*2,340$/, 'the button shows the record\'s own value at stake');
    assert.equal((await page.locator('[data-resolve="R002"]').innerText()).trim(), 'Resolve', 'no value at stake: no number is made up');
    assert.match((await page.locator('[data-resolve="R003"]').innerText()).trim(), /^Resolve\s*\+\D*125,000$/);
    assert.equal(await page.locator('[data-resolve]').count(), await page.locator(READY).count(), 'one Resolve per row');
    await first.click();
    await until(() => calls.acts.length === 1);
    assert.deepEqual(calls.acts[0].record_keys, ['R001']);
    assert.equal(calls.acts[0].values.action_status, 'Done');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('the record panel shows 3 actions, Resolve, Not an issue and Later, and keeps the rest under More', async () => {
  const { routes } = routesFor();
  const { page, context, seen } = await openWork(routes);
  try {
    await page.locator('.cell-t').first().click();
    const acts = page.locator('dialog.drawer .dr-act');
    await acts.waitFor({ state: 'visible' });
    const shown = await shownButtons(acts);
    const named = shown.filter((t) => t !== 'More');
    assert.ok(named.length <= 3, `at most 3 visible actions besides More: ${JSON.stringify(shown)}`);
    assert.ok(named.some((t) => /^Resolve/.test(t)), 'Resolve is visible');
    assert.ok(named.includes('Not an issue'), 'Not an issue is visible');
    assert.ok(named.includes('Later'), 'Later is visible');
    assert.ok(shown.includes('More'), 'the rest sits under More');
    await acts.getByRole('button', { name: 'More', exact: true }).click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible' });
    assert.ok(await menu.getByRole('menuitem').count() >= 1, 'More opens the other actions');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('the selection bar shows 3 actions plus More, and its Resolve marks the selected records done', async () => {
  const { calls, routes } = routesFor();
  const { page, context, seen } = await openWork(routes);
  try {
    const boxes = page.locator(`${READY} input[type="checkbox"]`);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    const bar = page.getByRole('region', { name: 'Selected records' });
    await bar.waitFor({ state: 'visible' });
    const shown = await shownButtons(bar);
    const named = shown.filter((t) => t !== 'More');
    assert.ok(named.length <= 3, `at most 3 visible actions besides More: ${JSON.stringify(shown)}`);
    assert.ok(named.some((t) => /^Resolve/.test(t)) && named.includes('Not an issue') && named.includes('Later'), JSON.stringify(shown));
    assert.ok(shown.includes('More'));
    await bar.getByRole('button', { name: /^Resolve/ }).click();
    const confirm = page.getByRole('button', { name: /^Resolve 2 records/ });
    if (await confirm.count()) await confirm.click();
    await until(() => calls.acts.length === 1);
    assert.deepEqual([...calls.acts[0].record_keys].sort(), ['R001', 'R002']);
    assert.equal(calls.acts[0].values.action_status, 'Done');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});
