import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { DECIDE, PERSON, TABLE, appInfo, openApp, serveDist, toastSays, until } from './harness.mjs';
import {
  CUSTOM, activityText, aiQuestion, checkedAnswer, csvText, factLines, periodBody, periodProblem, periodText, scopeText, templateText, whenText, workFacts,
} from '../src/mywork.js';
import { savedText, settingProblem } from '../src/settings.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const WEEK = { window: 'week', zone: 'Asia/Dubai', today: '2026-10-24', start_day: '2026-10-19', end_day: '2026-10-26' };
const WORKED = { fixed: 2, dismissed: 1, could_not: 1, assigned: 1, notes: 1, changes: 9, records: 6 };
const money = (m, r, e) => ({ measured: { n: m ? 1 : 0, money: m }, reported: { n: r ? 1 : 0, money: r }, estimated: { n: e ? 2 : 0, money: e } });
const entry = (over = {}) => ({
  visible: true, tracked: true, priced: true, worked: WORKED, active_hours: 4, money: money(900, 500, 3000), close: { n: 4, median_hours: 53 },
  best: { key: 'a1', label: 'Item a1', basis: 'measured', money: 900, closed: '2026-10-22T06:00:00Z' }, activity: [], minutes: null, served: 'delta', ...over,
});
const PAGES = [{ id: 'n01_u05', title: 'Pricing desk', records: { columns: [{ column: 'value_at_stake', currency: 'USD' }] } },
  { id: 'n02_u01', title: 'Second desk 1', records: { columns: [{ column: 'value_at_stake', currency: 'EUR' }] } }];

test('a period is refused before any request when it is not one the server takes', () => {
  assert.equal(periodProblem('week'), '');
  assert.equal(periodProblem('hourly'), 'Pick a period');
  assert.equal(periodProblem(CUSTOM, '', '2026-10-02'), 'Pick a first and a last day');
  assert.equal(periodProblem(CUSTOM, '2026-02-30', '2026-03-02'), 'Pick a first and a last day');
  assert.equal(periodProblem(CUSTOM, '2026-10-05', '2026-10-01'), 'The first day must be on or before the last day');
  assert.equal(periodProblem(CUSTOM, '2025-09-30', '2026-10-01'), 'Pick a period of at most 366 days');
  assert.equal(periodProblem(CUSTOM, '2025-10-01', '2026-10-01'), '', '366 days counting both ends, as the server counts them');
  assert.deepEqual(periodBody('week', '', '', 'Asia/Dubai'), { window: 'week', time_zone: 'Asia/Dubai' });
  assert.deepEqual(periodBody(CUSTOM, '2026-10-01', '2026-10-07', ''), { from: '2026-10-01', to: '2026-10-07' });
  assert.ok(!('utc_offset_min' in periodBody('today', '', '', 'Asia/Dubai')), 'a fixed offset is never sent; the server refuses it');
});

test('the period states its days and its time zone, the last day included', () => {
  assert.equal(periodText(WEEK), 'from Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time');
  assert.equal(periodText({ ...WEEK, start_day: '2026-10-24', end_day: '2026-10-25' }), 'on Oct 24, 2026, Asia/Dubai time');
  assert.equal(periodText({ window: 'all', zone: 'UTC', today: '2026-10-24' }), 'over all time');
});

test('money stays in its own unit: two currencies are listed side by side, never added, and no single largest record is picked', () => {
  const data = { period: WEEK, pages: { n01_u05: entry(), n02_u01: entry({ money: money(200, 0, 100), best: { key: 'b7', label: 'Item b7', basis: 'reported', money: 5000 } }) } };
  const facts = workFacts(data, PAGES, {});
  assert.equal(facts.worked.records, 12);
  assert.equal(facts.money.measured.text, '$900 + €200');
  assert.equal(facts.money.reported.text, '$500', 'the page with no reported fix adds nothing');
  assert.equal(facts.money.estimated.n, 4);
  assert.equal(facts.best, null, 'a dollar record and a euro record are not compared');
  assert.deepEqual(facts.rows.map((r) => r.best.text), ['$900', '€5,000']);
  const one = workFacts({ period: WEEK, pages: { n01_u05: entry(), n02_u01: { visible: true, tracked: false, note: 'keeps no actions' } } }, PAGES, {});
  assert.equal(one.rows.length, 1);
  assert.deepEqual([one.best.key, one.best.text, one.best.basis], ['a1', '$900', 'measured']);
});

test('hours saved come only from the minutes an owner set, and the pages without them are named as left out', () => {
  const data = { period: WEEK, pages: { n01_u05: entry({ minutes: 6 }), n02_u01: entry() } };
  const facts = workFacts(data, PAGES, {});
  assert.equal(facts.saved.hours, 0.6);
  assert.deepEqual(facts.saved.missing.map((p) => p.id), ['n02_u01']);
  assert.equal(workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {}).saved, null, 'no minutes set means no hours saved at all');
});

test('the scope line counts its use cases in plain words', () => {
  const two = workFacts({ period: WEEK, pages: { n01_u05: entry(), n02_u01: entry() } }, PAGES, {});
  assert.match(scopeText(two), /in the 2 use cases that keep actions\./);
  assert.match(scopeText(workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {})), /in the 1 use case that keeps actions\./);
});

test('the plain summary reads from the facts, and says so when nothing was done', () => {
  const facts = workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {});
  assert.equal(templateText(facts), 'From Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time, you fixed 2 records, closed 1 as not a real issue, closed 1 as could not fix '
    + 'in 1 use case. Your fixes show $900 measured, $500 reported, $3,000 estimated.');
  const idle = workFacts({ period: WEEK, pages: { n01_u05: entry({ worked: { ...WORKED, records: 0, fixed: 0, dismissed: 0, could_not: 0 } }) } }, PAGES, {});
  assert.equal(templateText(idle), 'You changed no records from Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time.');
});

test('a Genie answer is kept only when every number in it is one of the facts', () => {
  const facts = workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {});
  assert.match(aiQuestion(facts), /Copy every number exactly/);
  assert.ok(factLines(facts).includes('Measured savings on your fixes: $900 on 1 fix'));
  assert.equal(checkedAnswer('You fixed 2 records and saved $900, measured.', facts), 'You fixed 2 records and saved $900, measured.');
  assert.equal(checkedAnswer('You fixed 3 records this week.', facts), '', 'an invented 3 drops the answer');
  assert.equal(checkedAnswer('You saved about $1,000 overall.', facts), '', 'a rounded 1,000 is not a fact');
  assert.equal(checkedAnswer('Nice work this week.', facts), 'Nice work this week.');
  assert.equal(checkedAnswer('', facts), '');
  assert.equal(checkedAnswer('a'.repeat(601), facts), '', 'a long answer is not a short summary');
});

test('the CSV quotes its cells and never lets a cell start a formula', () => {
  const text = csvText([{ at: '2026-10-22T14:30:00Z', page: 'n01_u05', key: 'a8', label: '=HYPERLINK("x")', kind: 'note', status: 'In progress', owner: '', note: 'Called, then "waited"' },
    { at: '2026-10-21T10:00:00Z', page: 'gone', key: '-5', label: '', kind: 'assigned', status: 'New', owner: PERSON, note: null }], PAGES);
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'When (UTC),Use case,Record,What you did,Status,Owner,Note');
  assert.equal(lines[1], '2026-10-22T14:30:00Z,Pricing desk,"\'=HYPERLINK(""x"")",Added a note,In progress,,"Called, then ""waited"""');
  assert.equal(lines[2], `2026-10-21T10:00:00Z,gone,'-5,Assigned to Pat Lee,New,${PERSON},`);
  assert.equal(lines.at(-1), '');
  assert.equal(activityText({ kind: 'assigned', owner: '' }), 'Took the owner off');
  assert.equal(activityText({ kind: 'surprise' }), 'Changed');
  assert.equal(whenText('2026-10-22 14:30:00', 'Asia/Dubai'), 'Oct 22, 6:30 PM');
  assert.equal(whenText('2026-10-22T14:30:00Z', 'Not/AZone'), 'Oct 22, 2:30 PM');
});

test('minutes per record may be left empty, and saving it says My work uses it at once', () => {
  const minutes = { name: 'minutes_per_record', label: 'Minutes a person spends per record without Inspire', kind: 'number', low: 0, low_open: true,
    high: 1440, optional: true, unit: 'minutes', applies: 'app', allowed: 'more than 0 and at most 1,440 minutes, or empty' };
  assert.equal(settingProblem(minutes, ''), '');
  assert.equal(settingProblem({ ...minutes, optional: false }, ''), "minutes_per_record is ''; allowed: more than 0 and at most 1,440 minutes, or empty");
  assert.equal(settingProblem(minutes, '0'), "minutes_per_record is '0'; allowed: more than 0 and at most 1,440 minutes, or empty");
  assert.equal(savedText(minutes, '6'), 'Minutes a person spends per record without Inspire is 6 minutes now. My work uses it at once.');
  assert.equal(savedText(minutes, ''), 'Minutes a person spends per record without Inspire is not set now. My work uses it at once.');
  assert.equal(savedText({ ...minutes, applies: 'run', label: 'Cutoff' }, '6'), 'Cutoff is 6 minutes now. The next run uses it.');
});

const act = (i, page = 'n01_u05') => ({ key: `a${i}`, label: `Item a${i}`, kind: i % 2 ? 'fixed' : 'note', status: i % 2 ? 'Done' : 'In progress', owner: '',
  note: i % 2 ? '' : `note ${i}`, at: new Date(Date.UTC(2026, 9, 24, 8) - i * 60000).toISOString(), page });
const ALL = Array.from({ length: 60 }, (_, i) => act(i + 1));

function workRoutes(seen, { answer } = {}) {
  return {
    my_work: ({ route, json }) => {
      const body = route.request().postDataJSON();
      (seen.work ||= []).push(body);
      const offset = body.offset || 0;
      const size = body.export ? 10000 : 50;
      return json(200, { person: PERSON, period: WEEK, errors: {}, offset, size, total: ALL.length, truncated: false,
        pages: { n01_u05: entry({ worked: { ...WORKED, changes: 60 }, minutes: 6 }), n02_u01: { visible: true, tracked: false, note: 'this use case keeps no actions, so it has no work of yours to show' } },
        activity: ALL.slice(offset, offset + size) });
    },
    'genie/ask': ({ route, json }) => { (seen.asks ||= []).push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1' }); },
    'genie/message': ({ json }) => json(200, { state: 'done', text: answer || 'You fixed 2 records and saved $900, measured.' }),
  };
}

test('My work sits under the Overview in the side panel and shows the person\'s own numbers with their scope', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes: workRoutes(seen), timezone: 'Asia/Dubai' });
  const nav = await page.$$eval('nav.side .nav-i b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(nav.slice(0, 3), ['Overview', 'My work', 'Impact']);
  await page.click('[data-my-work-open]');
  await page.waitForSelector('[data-activity]');
  assert.equal(await page.evaluate(() => window.location.hash), '#/mywork');
  assert.deepEqual(seen.work[0], { window: 'week', time_zone: 'Asia/Dubai' });
  assert.equal(await page.locator('[data-scope]').first().innerText(),
    'Counts only the records you changed yourself, from Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time, in the 1 use case that keeps actions. '
    + 'Money stays in each use case\'s own unit and is never added across units.');
  const tiles = await page.$$eval('[data-my-work] .kpi-v', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tiles, ['6', '900', '500', '3,000', '0.6 h'], 'the example page names no currency, so its amounts carry none');
  assert.match((await page.locator('[data-best]').textContent()).replace(/\s+/g, ' '), /Your largest closed record is Item a1 in Price-loss decision desk: 900 measured\./);
  assert.match(await page.locator('[data-by-use-case]').innerText(), /1\.5 records per active hour/);
  assert.match(await page.locator('[data-quiet="n02_u01"]').innerText(), /keeps no actions/);
  assert.equal(await page.locator('[data-activity] tbody tr').count(), 50);
  await page.click('[data-my-work-more]');
  await until(() => (seen.work || []).length === 2);
  await page.waitForFunction(() => document.querySelectorAll('[data-activity] tbody tr').length === 60);
  assert.equal(seen.work[1].offset, 50);
  assert.equal(await page.locator('[data-my-work-more]').count(), 0, 'nothing more to load once every change is shown');
  const file = page.waitForEvent('download');
  await page.click('[data-my-work-csv]');
  const csv = await readFile(await (await file).path(), 'utf8');
  assert.equal(csv.split('\r\n').length, 62);
  assert.equal(seen.work.at(-1).export, true);
  await toastSays(page, 'Downloaded your 60 changes.');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('Genie writes the summary only with the person\'s own numbers, and an invented number falls back to the plain sentence', async () => {
  for (const [answer, kept] of [['You fixed 2 records and saved $900, measured.', true], ['You fixed 7 records.', false]]) {
    const seen = {};
    const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes: workRoutes(seen, { answer }) });
    await page.evaluate(() => { window.location.hash = '#/mywork'; });
    await page.waitForSelector('[data-summary-ai]');
    const plain = await page.locator('[data-summary-text]').innerText();
    assert.match(plain, /^From Oct 19, 2026 to Oct 25, 2026, Asia\/Dubai time, you fixed 2 records/);
    await page.click('[data-summary-ai]');
    await page.waitForSelector(kept ? '[data-summary-text="ai"]' : '[data-summary-text="plain"]');
    assert.equal(seen.asks[0].page, 'n01_u05');
    assert.match(seen.asks[0].question, /Fixed: 2\n/);
    assert.equal(await page.locator('[data-summary-text]').innerText(), kept ? answer : plain);
    assert.match(await page.locator('[data-summary]').innerText(), kept ? /every number in it is one of them/ : /not one of yours/);
    assert.deepEqual(app.errors, []);
    await context.close();
  }
});

test('a single use case App lists My work under the use case, and the tabs layout shows it as a tab', async () => {
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: workRoutes({}) });
  const nav = await page.$$eval('nav.side .nav-i b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(nav, ['Price-loss decision desk', 'My work', 'Impact']);
  assert.deepEqual(app.errors, []);
  await context.close();
  const tabs = await openApp(browser, served.base, appInfo({ ...DECIDE, layout: 'tabs' }, 2, TABLE), { routes: workRoutes({}) });
  assert.deepEqual((await tabs.page.$$eval('nav.tabs .tab', (els) => els.map((e) => e.textContent))).slice(0, 3), ['Overview', 'My work', 'Impact']);
  await tabs.context.close();
});
