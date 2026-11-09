import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { NO_JOB, TABLE, appInfo, openApp, serveDist } from './harness.mjs';
import { topFit } from '../src/topbar.js';
import { latestRunText } from '../src/freshness.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const SHOTS = process.env.INSPIRE_SHOTS || '';
const LAST = { run_id: '101', trigger: 'scheduled', by: 'the schedule', started: '2026-11-04T04:48:00Z', ended: '2026-11-04T04:53:00Z', result: 'succeeded', message: '' };
const FRESH = { ...NO_JOB, has_job: true, source: 'job', last_success: LAST, last_run: LAST, data_through: '2026-11-03', cadence_days: 1, can_refresh: true, reason: '' };
const run = (extra) => ({ run_id: 'u1', job_run_id: '501', url: '', started: '2026-11-04T04:48:00Z', duration_s: 300, status: 'done', trigger: 'schedule', by: '',
  segments: [], tables: [], records: 40, to_fix: 0, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '', ...extra });
const RUNS = { runs: [run({}), run({ run_id: 'u2', started: '2026-11-03T04:48:00Z', to_fix: 2 }), run({ run_id: 'u3', started: '2026-11-02T04:48:00Z', to_fix: 4 })],
  total: 3, offset: 0, limit: 20, job: null, errors: {} };
const EMPTY = { visible: true, tracked: true, money: false, categories: [], served: 'delta', items: [], total: 0, truncated: false,
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
  weeks: [], runs: { updated: '2026-11-04T04:53:00Z', as_of: '2026-11-03', cadence_days: 1, next: '2026-11-05', stale: false, count: 3, failed: false } };
const SUMMARY = { run: { summary: null, nothing_to_act: null, decision_basis: 'measured', currency: '', as_of_date: '2026-11-03' }, categories: {}, note: '' };

function info(pages = 1, extra = {}) {
  const base = appInfo({ business: 'Contoso Retail', ...extra }, pages, TABLE);
  return { ...base, is_owner: true, pages: base.pages.map((p) => ({ ...p, review: 'https://ws.example.com/inspire/review' })) };
}

function routes(pageIds) {
  return {
    freshness: ({ json }) => json(200, FRESH),
    runs: ({ json }) => json(200, RUNS),
    summary: ({ json }) => json(200, SUMMARY),
    overview: ({ json }) => json(200, { today: '2026-11-04', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: Object.fromEntries(pageIds.map((id) => [id, EMPTY])) }),
  };
}

async function openPage(width, { scheme = 'light', hash = '#/n01_u05', pages = 1, extra = {}, ready = '.top .fresh-t' } = {}) {
  const app = info(pages, { theme: scheme, ...extra });
  const opened = await openApp(browser, served.base, app, { width, scheme, routes: routes(app.pages.map((p) => p.id)), ready: '.top .mark' });
  await opened.page.goto(`${served.base}${hash}`);
  await opened.page.locator(ready).waitFor();
  return { ...opened, app };
}

const rowFacts = (page) => page.evaluate(() => {
  const top = document.querySelector('.top');
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const items = [...top.children].flatMap((el) => (el.classList.contains('top-page') ? [...el.children] : [el])).filter(shown).filter((el) => !el.classList.contains('sp'));
  const boxes = items.map((el) => el.getBoundingClientRect());
  const centers = boxes.map((b) => Math.round(b.top + b.height / 2));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1));
  const page = document.querySelector('main .page');
  return {
    height: Math.round(top.getBoundingClientRect().height),
    spread: Math.max(...centers) - Math.min(...centers),
    overflow: top.scrollWidth - top.clientWidth,
    right: Math.round(Math.max(...boxes.map((b) => b.right))),
    width: Math.round(top.getBoundingClientRect().width),
    overlap,
    clipped: items.filter((el) => el.matches('.btn, .ibtn, .genie-btn, .auth, .admin-link') && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    toolbars: page ? page.querySelectorAll('.hdr-act, .ptools, nav.views, [role="tablist"]').length : -1,
    names: items.map((el) => el.getAttribute('aria-label') || el.textContent.trim()),
  };
});

test('topFit picks the row layout from the width of the top row', () => {
  assert.deepEqual([1920, 1600, 1440, 1280, 1101, 1100, 1024, 861, 860, 390].map(topFit),
    ['full', 'mid', 'mid', 'mid', 'mid', 'tight', 'tight', 'tight', 'narrow', 'narrow']);
});

test('latestRunText says when the latest run ran, how it ended and what it found', () => {
  assert.equal(latestRunText(null), 'No run is recorded yet.');
  assert.equal(latestRunText(run({}), Date.parse('2026-11-04T09:00:00Z')), 'Latest run, Nov 4, 04:48 AM UTC: Done. Nothing to fix. It covered all the data, 40 records.');
  assert.equal(latestRunText(run({ status: 'failed', error_code: 'missing_table' }), Date.parse('2026-11-04T09:00:00Z')),
    'Latest run, Nov 4, 04:48 AM UTC: Failed. A table this use case reads is missing.');
});

for (const width of [1280, 1024]) {
  for (const scheme of ['light', 'dark']) {
    test(`at ${width}px in ${scheme} the use case page has exactly one top row that does not wrap, overflow or overlap`, async () => {
      const { page, seen, context } = await openPage(width, { scheme });
      await page.locator('[data-nothing-fix]').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), scheme);
      const facts = await rowFacts(page);
      assert.ok(facts.height <= 60, `one row high: ${facts.height}px`);
      assert.ok(facts.spread <= 2, `every item sits on the same line: ${facts.spread}px`);
      assert.ok(facts.overflow <= 0, `nothing overflows the row: ${facts.overflow}px`);
      assert.ok(facts.right <= facts.width, `the last item ends inside the row: ${facts.right} of ${facts.width}`);
      assert.equal(facts.overlap, false, 'no two items overlap');
      assert.deepEqual(facts.clipped, [], 'no button clips its label');
      assert.equal(facts.toolbars, 0, 'the page body has no second toolbar or tab row');
      for (const name of ['Runs (3)', 'Views', 'Refresh now', 'Ask Genie']) assert.ok(facts.names.includes(name), `${name} is in the row: ${facts.names.join(' | ')}`);
      assert.equal(await page.locator('.mark-t small').innerText(), 'Pricing › Markdown control');
      assert.equal(await page.locator('.ph h1').innerText(), await page.locator('.page .ph h1').innerText());
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `top_${width}_${scheme}.png`) });
      }
      assert.deepEqual(seen.errors, []);
      await context.close();
    });
  }
}

for (const width of [1280, 1024]) {
  test(`at ${width}px every top-row button, link and badge has an accessible name, and an icon-only one is named by its label`, async () => {
    for (const auth of ['sp', 'user']) {
      const { page, seen, context } = await openPage(width, { extra: { auth } });
      await page.locator('[data-nothing-fix]').waitFor();
      const tree = await page.locator('.top').ariaSnapshot();
      const controls = tree.split('\n').map((l) => l.trim()).filter((l) => /^- (button|link|img)\b/.test(l));
      assert.ok(controls.length >= 8, tree);
      const unnamed = controls.filter((l) => !/^- (button|link|img) "[^"]+"/.test(l));
      assert.deepEqual(unnamed, [], `${auth} at ${width}: every control has a name\n${tree}`);
      const icons = await page.evaluate(() => [...document.querySelectorAll('.top .top-ic, .top .top-ic2')]
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none')
        .map((el) => ({ label: el.querySelector(':scope > span')?.textContent || '', name: el.getAttribute('aria-label') || '',
          hidden: getComputedStyle(el.querySelector(':scope > span')).display === 'none' })));
      assert.ok(icons.some((i) => i.hidden), `${auth} at ${width}: some items show as icons only`);
      for (const i of icons) {
        const expect = i.label.startsWith('Runs') ? /^Runs \(\d+\)$/ : new RegExp(`^${i.label.replace(/[()]/g, '\\$&')}$`);
        assert.match(i.name, expect, `${auth} at ${width}: the item labelled ${i.label} is named ${i.name}`);
      }
      const named = icons.map((i) => i.name);
      const want = ['Views', 'Settings', auth === 'user' ? 'Your view' : 'Shared view', ...(width === 1280 ? ['Open in Inspire Review', 'Admin'] : [])];
      for (const name of want) assert.ok(named.includes(name), `${auth} at ${width}: ${name} is named: ${named.join(' | ')}`);
      const badge = auth === 'user' ? 'Your view' : 'Shared view';
      assert.equal(await page.getByRole('img', { name: badge, exact: true }).count(), 1, `${badge} badge has its name`);
      assert.deepEqual(seen.errors, []);
      await context.close();
    }
  });
}

test('Views sits right before Refresh now, and the page has no Copy link or Print button', async () => {
  const { page, seen, context } = await openPage(1280);
  const order = await page.evaluate(() => [...document.querySelectorAll('.top-page > *')].map((el) => el.getAttribute('aria-label') || el.className));
  const views = order.indexOf('Views');
  assert.ok(views > 0 && order[views + 1] === 'Refresh now', order.join(' | '));
  assert.ok(order.indexOf('Runs (3)') === views - 1, order.join(' | '));
  assert.equal(await page.getByRole('button', { name: 'Copy link' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Print' }).count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the left panel lists My work, then Impact, then the use cases under their label', async () => {
  for (const pages of [1, 3]) {
    const { page, seen, context } = await openPage(1280, { pages });
    const side = await page.evaluate(() => [...document.querySelectorAll('.side > *')].map((el) => (el.matches('.side-h') ? `#${el.textContent}`
      : el.matches('.side-sep') ? '-' : el.querySelector('.nav-t b').textContent)));
    const label = pages === 1 ? '#Use case' : '#Use cases';
    assert.deepEqual(side.slice(0, 4), ['My work', 'Impact', '-', label], side.join(' | '));
    assert.ok(side.length >= 5 && side.slice(4).every((t) => !['My work', 'Impact'].includes(t)), side.join(' | '));
    if (pages > 1) assert.equal(side[4], 'Overview');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('Things to fix is the page body with no tab row, and with nothing to fix it says so with the latest run and a link to the runs', async () => {
  const { page, seen, context } = await openPage(1280);
  const card = page.locator('[data-nothing-fix]');
  await card.waitFor();
  assert.equal(await page.locator('[role="tab"], nav.views').count(), 0);
  assert.equal(await card.locator('h2').innerText(), 'Nothing to fix');
  await page.waitForFunction(() => document.querySelector('[data-latest-run]')?.textContent.startsWith('Latest run, Nov 4'));
  assert.match(await card.locator('[data-latest-run]').innerText(), /^Latest run, Nov 4, 04:48 AM UTC: Done\. Nothing to fix\./);
  await card.getByRole('button', { name: 'See the runs' }).click();
  await page.locator('.runs .runs-tbl').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Runs (3)' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-nothing-fix]').count(), 0);
  assert.equal(new URL(page.url()).hash, '#/n01_u05?v=runs');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Runs button opens the runs and closes them again, the back link returns, and an old Runs link still opens them', async () => {
  const { page, seen, context } = await openPage(1280);
  const button = page.getByRole('button', { name: 'Runs (3)' });
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await button.click();
  await page.locator('.runs .runs-tbl').waitFor();
  assert.equal(await page.locator('.runs-tbl > tbody > tr:not(.runs-d)').count(), 3);
  assert.equal(new URL(page.url()).hash, '#/n01_u05?v=runs');
  await button.click();
  await page.locator('[data-nothing-fix]').waitFor();
  assert.equal(await page.locator('.runs').count(), 0);
  await button.click();
  await page.getByRole('button', { name: 'Back to things to fix' }).click();
  await page.locator('[data-nothing-fix]').waitFor();
  assert.equal(new URL(page.url()).hash, '#/n01_u05');
  await context.close();
  const old = await openPage(1280, { hash: '#/n01_u05?v=runs' });
  await old.page.locator('.runs .runs-tbl').waitFor();
  assert.equal(await old.page.getByRole('button', { name: 'Runs (3)' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...seen.errors, ...old.seen.errors], []);
  await old.context.close();
});

test('on a narrow screen the lower-priority items move into the More menu and still work', async () => {
  const { page, seen, context } = await openPage(800);
  const facts = await rowFacts(page);
  assert.ok(facts.height <= 60 && facts.spread <= 2 && facts.overflow <= 0 && !facts.overlap, JSON.stringify(facts));
  for (const gone of ['Change the colors', 'Admin', 'Settings', 'Open in Inspire Review', 'Notify me']) assert.ok(!facts.names.includes(gone), `${gone} left the row: ${facts.names.join(' | ')}`);
  await page.getByRole('button', { name: 'More' }).click();
  const items = await page.locator('[role="menu"] [role="menuitem"]').evaluateAll((els) => els.map((el) => el.textContent));
  assert.deepEqual(items, ['Open in Inspire Review', 'Settings', 'Notify me', 'Change the colors', 'Switch to dark theme', 'Admin']);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  assert.equal(await page.locator('[data-settings-open]').getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Switch to dark theme' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('every screen keeps a single top row: the Overview puts its Settings in it and My work, Impact and Admin add no toolbar', async () => {
  const { page, seen, context } = await openPage(1024, { pages: 3, hash: '#/overview', ready: 'main h1' });
  for (const hash of ['#/overview', '#/mywork', '#/impact', '#/n01_u05']) {
    await page.goto(`${served.base}${hash}`);
    await page.locator('main h1').first().waitFor();
    const facts = await rowFacts(page);
    assert.ok(facts.height <= 60 && facts.spread <= 2 && facts.overflow <= 0 && !facts.overlap, `${hash}: ${JSON.stringify(facts)}`);
    assert.equal(facts.toolbars, 0, hash);
  }
  await page.goto(`${served.base}#/overview`);
  await page.locator('.top [data-settings-open]').waitFor();
  assert.equal(await page.locator('main [data-settings-open]').count(), 0);
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  await context.close();
});

test('the tabs layout keeps the use case tabs and the page tools on one row', async () => {
  const { page, seen, context } = await openPage(1280, { pages: 3, extra: { layout: 'tabs' } });
  const facts = await rowFacts(page);
  assert.ok(facts.height <= 60 && facts.spread <= 2 && facts.overflow <= 0 && !facts.overlap, JSON.stringify(facts));
  assert.deepEqual((await page.locator('.top .tabs .tab').allTextContents()).slice(0, 3), ['My work', 'Impact', 'Overview']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
