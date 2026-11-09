import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';
import { ratio } from './contrast.test.mjs';
import { COPIED_SEND_TEXT, SHARED_CARD_TEXT, cardKeys, pageFailures } from '../src/failures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = JSON.parse(readFileSync(join(HERE, '..', '..', 'example_page.json'), 'utf8'));
const LONG = 'The SQL warehouse answered HTTP 502: [INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`sales`.`loss`, '
  + 'so the statement could not run against the data this card reads. Ask the owner to run: GRANT SELECT ON TABLE main.sales.loss TO `sam@example.com` SQLSTATE: 42501';
const OTHER = 'the warehouse is stopped';
const FAILED = ['kpi:total_loss', 'kpi:loss_rate', 'kpi:items', 'chart:loss_trend', 'chart:by_category', 'chart:channel_mix'];

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

test('one error on several cards is named once for the page, a card with its own error keeps it, and a page that failed whole covers every card', () => {
  const errors = Object.fromEntries([...FAILED.map((k) => [k, LONG]), ['chart:pareto', OTHER], ['records', LONG]]);
  const grouped = pageFailures(EXAMPLE, { errors }, '');
  assert.equal(grouped.shared, LONG);
  assert.equal(grouped.count, FAILED.length, 'only kpi, chart and table cards count');
  assert.equal(grouped.whole, false);
  assert.equal(pageFailures(EXAMPLE, { errors: { 'chart:pareto': LONG } }, '').shared, '', 'an error on one card stays on that card');
  assert.equal(pageFailures(EXAMPLE, { errors: { 'chart:pareto': LONG, 'chart:loss_trend': OTHER } }, '').shared, '', 'two different errors are not one page problem');
  assert.equal(pageFailures(EXAMPLE, { errors: { 'chart:pareto': ' ', 'chart:loss_trend': ' ' } }, '').shared, '', 'blank errors are no problem');
  assert.equal(pageFailures(EXAMPLE, { errors: {} }, LONG).shared, '', 'a refresh that failed over loaded data is not a card problem');
  const whole = pageFailures(EXAMPLE, null, LONG);
  assert.equal(whole.whole, true);
  assert.equal(whole.shared, LONG);
  assert.deepEqual(Object.keys(whole.errors), cardKeys(EXAMPLE));
  assert.equal(cardKeys(EXAMPLE).length, EXAMPLE.kpis.length + EXAMPLE.charts.length + EXAMPLE.tables.length);
  assert.equal(pageFailures(EXAMPLE, null, '').shared, '', 'a page still loading has no problem');
});

async function grouped(scheme = 'light', width = 1440) {
  const errors = Object.fromEntries(FAILED.map((k) => [k, LONG]));
  const opened = await openApp(browser, served.base, appInfo(), { scheme, width, errors, ready: '[data-page-failure]' });
  await opened.page.locator('[data-card="pareto"] canvas').waitFor();
  return opened;
}

test('the same long error on every card shows once at the top with Try again, Copy what to send and See the runs, and each card keeps a short note', async () => {
  const { page, seen, context } = await grouped();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const top = page.locator('[data-page-failure]');
  assert.equal(await top.count(), 1);
  const said = await top.locator('p').innerText();
  assert.match(said, /^6 parts of this page could not load: The SQL warehouse/);
  for (const raw of ['INSUFFICIENT_PERMISSIONS', 'GRANT SELECT', 'SQLSTATE']) assert.ok(!said.includes(raw), `${raw} stays under Details: ${said}`);
  assert.equal(await top.getAttribute('role'), 'alert');
  assert.deepEqual(await top.locator('[data-choices] button').evaluateAll((all) => all.map((b) => b.innerText)), ['Try again', 'Copy what to send', 'See the runs']);
  assert.equal(await page.locator('[data-technical-details]').count(), 1, 'the raw error sits once under Details, at the top');
  const body = await page.locator('.page').innerText();
  assert.equal(body.split('Insufficient privileges').length - 1, 1, 'the long sentence is on the page once');
  const notes = await page.locator('[data-shared-failure]').evaluateAll((all) => all.map((n) => n.innerText));
  assert.deepEqual(notes, FAILED.map(() => SHARED_CARD_TEXT), 'every failed card says it in a short note');
  for (const id of ['loss_trend', 'by_category', 'channel_mix']) assert.equal(await page.locator(`[data-card="${id}"] .ask-genie`).count(), 0, `${id}: no Ask Genie on a card with nothing to ask about`);
  assert.equal(await page.locator('.kpi:has([data-shared-failure]) .ask-genie').count(), 0, 'no Ask Genie on a failed key number');
  assert.equal(await page.locator('[data-card="pareto"] .ask-genie').count(), 1, 'a card that loaded keeps its Ask Genie');
  await top.getByRole('button', { name: 'Copy what to send' }).click();
  await page.waitForFunction((t) => document.querySelector('.toast .toast-t')?.textContent === t, COPIED_SEND_TEXT);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^6 parts of this page could not load: The SQL warehouse/);
  assert.match(copied, /GRANT SELECT ON TABLE main\.sales\.loss/);
  const asked = seen.pages.length;
  await top.getByRole('button', { name: 'Try again' }).click();
  await until(() => seen.pages.length > asked);
  await top.waitFor();
  await top.getByRole('button', { name: 'See the runs' }).click();
  await page.waitForFunction(() => /\/runs/.test(window.location.hash));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the page message keeps its focus ring, contrast and fit in light, dark and right to left at 1280 and 1440', async () => {
  for (const [width, scheme, rtl] of [[1280, 'light', false], [1440, 'dark', false], [1280, 'dark', true]]) {
    const { page, seen, context } = await grouped(scheme, width);
    if (rtl) await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    const at = `${width} ${scheme}${rtl ? ' rtl' : ''}`;
    const wide = await page.evaluate(() => [...document.querySelectorAll('.main, html, [data-page-failure]')].map((el) => el.scrollWidth - el.clientWidth));
    assert.ok(wide.every((d) => d <= 1), `${at}: no sideways scroll (${wide})`);
    await page.locator('[data-page-failure] [data-retry]').focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.dataset.copySend, s.outlineStyle, s.outlineWidth]; });
    assert.equal(ring[0], '', `${at}: Tab moves to Copy what to send`);
    assert.notEqual(ring[1], 'none', `${at}: focus ring`);
    assert.notEqual(ring[2], '0px', `${at}: focus ring`);
    const colors = await page.evaluate(() => {
      const hex = (c) => `#${c.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
      const fill = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return hex(b); } return '#ffffff'; };
      return [document.querySelector('[data-page-failure] p'), document.querySelector('[data-page-failure] [data-retry]'), document.querySelector('.kpi [data-shared-failure]'),
        document.querySelector('[data-card] [data-shared-failure]')].map((el) => [hex(getComputedStyle(el).color), fill(el)]);
    });
    for (const [fg, bg] of colors) assert.ok(ratio(fg, bg) >= 4.5, `${at}: ${fg} on ${bg} reads at ${ratio(fg, bg).toFixed(2)}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a page that cannot load at all says so once, and no card keeps loading beside it', async () => {
  const routes = { page: ({ json }) => json(502, { error: LONG }) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes, ready: '[data-page-failure]' });
  assert.match(await page.locator('[data-page-failure] p').innerText(), /^This page could not load: The SQL warehouse/);
  await page.waitForFunction(() => !document.querySelector('.kpi .skel, [data-card] .chart-skel'));
  const cards = EXAMPLE.kpis.length + EXAMPLE.charts.length;
  assert.equal(await page.locator('[data-shared-failure]').count(), cards, 'every card says it could not load');
  assert.equal(await page.locator('.page').innerText().then((t) => t.split('Insufficient privileges').length - 1), 1);
  assert.equal(await page.locator('[data-page-failure]').count(), 1);
  assert.ok(seen.errors.every((e) => /502/.test(e)), `only the failed read is logged: ${seen.errors}`);
  await context.close();
});
