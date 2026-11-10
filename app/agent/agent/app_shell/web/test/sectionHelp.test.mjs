import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { helpLine } from '../src/help.js';
import { plainColumns, valueLine } from '../src/impact.js';

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });
const VALUE = { promised: {
  value: 'The desk acts on the channels behind a revenue drop.',
  benefits: ['Recovered revenue from the channels that decline.'],
  estimate: 'Value not measured yet: measure the share of the change by channel from total_amount, distribution_channel.',
} };

test('helpLine joins the parts a section help says, dropping the empty ones', () => {
  assert.equal(helpLine('Revenue by month.', '', null, 'So what: act now.'), 'Revenue by month. So what: act now.');
  assert.equal(helpLine('', undefined), '');
});

test('column ids in the measurement text read as plain words', () => {
  assert.equal(plainColumns('from total_amount, distribution_channel and ticket_status.'), 'from total amount, distribution channel and ticket status.');
  assert.equal(plainColumns('Act now, 5% of revenue'), 'Act now, 5% of revenue');
});

test('valueLine keeps the first sentence of the value and drops the how-to-measure detail', () => {
  assert.equal(valueLine('Value not measured yet: measure the share from total_amount.'), 'Value not measured yet.');
  assert.equal(valueLine('Worth about 1.2M a year. The rest is assumed.'), 'Worth about 1.2M a year.');
  assert.equal(valueLine(''), '');
});

test('the top bar carries the guided tour icon, and it opens the page tour from the first step', async () => {
  const info = appInfo({}, 1, {});
  const { page, context, seen } = await openApp(browser, base, info, { watch: STILL });
  const icon = page.locator('[data-tour-top]');
  await icon.waitFor({ state: 'visible' });
  assert.equal(await icon.getAttribute('aria-label'), 'Take the guided tour');
  await icon.click();
  await page.waitForSelector('.tour-pop');
  assert.equal(await page.locator('#tour-t').textContent(), 'What this App is for');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('each chart card has a ? that walks only that card and says what to do in it, by mouse and by keyboard', async () => {
  const info = appInfo({}, 1, {});
  const { page, context, seen } = await openApp(browser, base, info, { watch: STILL });
  const card = page.locator('article.card[data-card]').first();
  const title = await card.locator('h2').textContent();
  const help = card.locator('[data-section-help]');
  await help.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.tour-pop');
  assert.equal(await page.locator('#tour-t').textContent(), title);
  assert.equal(await page.locator('.tour-step').textContent(), '1 / 1', 'the section walk is one step');
  const inside = await page.evaluate(() => {
    const c = document.querySelector('article.card[data-card]').getBoundingClientRect();
    const h = document.querySelector('.tour-hole').getBoundingClientRect();
    return h.left <= c.left + 2 && h.top <= c.top + 2 && h.right >= c.right - 2 && h.bottom >= c.top + 40;
  });
  assert.ok(inside, 'the spotlight covers the card it explains');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  assert.ok(await page.evaluate(() => document.activeElement?.hasAttribute('data-section-help')), 'focus returns to the ? that opened it');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the dashboard keeps one line about the value and sends how it is measured to Settings', async () => {
  const info = appInfo({}, 1, VALUE);
  const { page, context, seen } = await openApp(browser, base, info, { watch: STILL });
  const line = page.locator('[data-value-estimate]');
  await line.waitFor({ state: 'visible' });
  const text = await line.textContent();
  assert.ok(text.includes('Value not measured yet.'), text);
  assert.ok(!text.includes('total_amount'), 'the long measuring text is not on the dashboard');
  await line.locator('button.link').click();
  await page.waitForFunction(() => /settings/.test(location.hash));
  const group = page.locator('[data-group="measurement"]');
  await group.waitFor({ state: 'visible' });
  assert.match(await group.locator('[data-measure-estimate]').textContent(), /total amount, distribution channel/);
  assert.ok(!(await group.textContent()).includes('total_amount'), 'no raw column id in the measurement text');
  assert.match(await group.textContent(), /Money at stake on the open records flagged Act now or Review/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the filter step names this use case filters in its own words', async () => {
  const info = appInfo({}, 1, {});
  const steps = info.pages[0].tour.languages[0].steps;
  const filters = steps.find((s) => s.anchor === 'filters');
  assert.ok(filters, 'the filters step is in the tour');
  assert.equal(filters.text, 'Use Run date, Category, Channel, Region to see only your part. Every number, chart and list on the page follows them.');
});

test('a saved target changes the gap to go, in the direction the KPI should move', async () => {
  const { kpiGap, kpiGapText } = await import('../src/impact.js');
  const latest = 80;
  assert.equal(kpiGapText(kpiGap({ latest, target: 100, direction: 'increase' }), '%'), '20% to go');
  assert.equal(kpiGapText(kpiGap({ latest, target: 90, direction: 'increase' }), '%'), '10% to go', 'a saved target of 90 changes the gap');
  assert.equal(kpiGapText(kpiGap({ latest, target: 70, direction: 'decrease' }), ''), '10 to go');
  assert.equal(kpiGapText(kpiGap({ latest, target: 80, direction: 'increase' })), 'Target reached');
  assert.equal(kpiGapText(kpiGap({ latest, target: '', direction: 'increase' })), 'Set a target to see the gap', 'an empty target gives no gap');
  assert.equal(kpiGap({ latest: null, target: 90, direction: 'increase' }), null, 'a KPI with no measured value gives no gap');
});

test('the target is not listed under How the impact is worked out, and a refused save keeps the raw error for Details', async () => {
  const { groupsOf } = await import('../src/settings.js');
  const { failureOf } = await import('../src/api.js');
  assert.deepEqual(groupsOf([{ name: 'kpi_target_value', group: 'measurement', value: '90' }]), []);
  assert.equal(failureOf({ message: 'Nothing was saved: plain', detail: { details: 'ModifyTable is not supported' } }).technical, 'ModifyTable is not supported');
});
