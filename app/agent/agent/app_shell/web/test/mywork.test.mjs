import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ASK_GROUPS, DECIDE, PERSON, TABLE, appInfo, askAudit, openApp, serveDist, until } from './harness.mjs';
import {
  CUSTOM, activityText, aiQuestion, checkedAnswer, factLines, notableOf, periodBody, periodProblem, periodText, scopeText, templateText, whenText, workFacts,
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
  assert.equal(templateText(facts), 'From Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time, you fixed 2 records, closed 1 as not an issue, closed 1 as could not fix '
    + 'in 1 use case. Your fixes show $900 measured, $500 reported, $3,000 estimated.');
  const idle = workFacts({ period: WEEK, pages: { n01_u05: entry({ worked: { ...WORKED, records: 0, fixed: 0, dismissed: 0, could_not: 0 } }) } }, PAGES, {});
  assert.equal(templateText(idle), 'You changed no records from Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time.');
});

test('a Genie answer is kept only when every number in it is one of the facts', () => {
  const facts = workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {});
  assert.match(aiQuestion(facts), /Copy every number exactly/);
  assert.ok(factLines(facts).includes('Measured savings on your fixes: $900 on 1 fix'));
  assert.equal(checkedAnswer('You fixed 2 records and saved $900 on Item a1, measured.', facts), 'You fixed 2 records and saved $900 on Item a1, measured.');
  assert.equal(checkedAnswer('You fixed 3 records this week, Item a1 among them.', facts), '', 'an invented 3 drops the answer');
  assert.equal(checkedAnswer('You saved about $1,000 overall, most on Item a1.', facts), '', 'a rounded 1,000 is not a fact');
  assert.equal(checkedAnswer('Nice work this week.', facts), '', 'an answer that names no notable example is not the summary asked for');
  assert.equal(checkedAnswer('', facts), '');
  assert.equal(checkedAnswer('a'.repeat(601), facts), '', 'a long answer is not a short summary');
});

test('the Genie summary praises the person and names one notable example: the largest closed record, else the use case they fixed most in', () => {
  const facts = workFacts({ period: WEEK, pages: { n01_u05: entry() } }, PAGES, {});
  assert.deepEqual(notableOf(facts), { name: 'Item a1', line: 'Item a1 in Pricing desk, $900 measured' });
  const asked = aiQuestion(facts);
  assert.match(asked, /praises? (the person|them|their work)/i);
  assert.match(asked, /names? this one notable example: Item a1 in Pricing desk, \$900 measured/);
  assert.ok(factLines(facts).includes('Notable example: Item a1 in Pricing desk, $900 measured'));
  const good = 'Great work this week: you fixed 2 records and saved $900, measured. Item a1 in Pricing desk stands out, with $900 measured.';
  assert.equal(checkedAnswer(good, facts), good);
  assert.equal(checkedAnswer('Great work: you fixed 2 records and saved $900, measured.', facts), '', 'praise alone, with no example, falls back');
  const mixed = workFacts({ period: WEEK, pages: { n01_u05: entry({ worked: { ...WORKED, fixed: 1 } }), n02_u01: entry({ best: { key: 'b7', label: 'Item b7', basis: 'reported', money: 5000 } }) } }, PAGES, {});
  assert.equal(mixed.best, null);
  assert.deepEqual(notableOf(mixed), { name: 'Item b7', line: 'Item b7 in Second desk 1, €5,000 reported' }, 'two currencies: the use case with the most fixes gives its largest record');
  const unpriced = workFacts({ period: WEEK, pages: { n01_u05: entry({ best: null }), n02_u01: entry({ best: null, worked: { ...WORKED, fixed: 4 } }) } }, PAGES, {});
  assert.deepEqual(notableOf(unpriced), { name: 'Second desk 1', line: '4 records fixed in Second desk 1' });
  assert.equal(checkedAnswer('Well done. Second desk 1 is where you fixed 4 records.', unpriced), 'Well done. Second desk 1 is where you fixed 4 records.');
  const noFix = workFacts({ period: WEEK, pages: { n01_u05: entry({ best: null, worked: { ...WORKED, fixed: 0 } }) } }, PAGES, {});
  assert.deepEqual(notableOf(noFix), { name: 'Pricing desk', line: '6 records changed in Pricing desk' });
  const idle = workFacts({ period: WEEK, pages: { n01_u05: entry({ best: null, worked: { ...WORKED, records: 0, fixed: 0 } }) } }, PAGES, {});
  assert.equal(notableOf(idle), null);
});

test('each change reads as what the person did, and its time reads in their zone', () => {
  assert.equal(activityText({ kind: 'assigned', owner: PERSON }), 'Assigned to Pat Lee');
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
      const size = 50;
      return json(200, { person: PERSON, period: WEEK, errors: {}, offset, size, total: ALL.length,
        pages: { n01_u05: entry({ worked: { ...WORKED, changes: 60 }, minutes: 6 }), n02_u01: { visible: true, tracked: false, note: 'this use case keeps no actions, so it has no work of yours to show' } },
        activity: ALL.slice(offset, offset + size) });
    },
    'genie/ask': ({ route, json }) => { (seen.asks ||= []).push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1' }); },
    'genie/message': ({ json }) => json(200, { state: 'done', text: answer || 'Great work: you fixed 2 records. Item a1 stands out.' }),
  };
}

test('My work sits under the Overview in the side panel and shows the person\'s own numbers with their scope', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes: workRoutes(seen), timezone: 'Asia/Dubai' });
  const nav = await page.$$eval('nav.side .nav-i b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(nav.slice(0, 3), ['My work', 'Impact', 'Overview']);
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
  assert.equal(await page.locator('[data-my-work] button, [data-my-work] a').filter({ hasText: /download|csv|export/i }).count(), 0,
    'My work offers no download of the activity');
  assert.equal(await page.locator('a[download], [data-my-work-csv]').count(), 0);
  assert.ok(seen.work.every((body) => !('export' in body)), 'the page never asks the server for an export');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('Genie writes the summary only with the person\'s own numbers, and an invented number falls back to the plain sentence', async () => {
  for (const [answer, kept, why] of [['Great work this week: you fixed 2 records and saved 900, measured. Item a1 stands out, with 900 measured.', true, /every number in it is one of them/],
    ['You fixed 7 records, and Item a1 stands out.', false, /not one of yours/], ['Great work: you fixed 2 records and saved 900, measured.', false, /did not name your notable example, Item a1/]]) {
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
    assert.match(seen.asks[0].question, /praises their work/);
    assert.match(seen.asks[0].question, /names this one notable example: Item a1 in Price-loss decision desk, 900 measured\./);
    assert.equal(await page.locator('[data-summary-text]').innerText(), kept ? answer : plain);
    assert.match(await page.locator('[data-summary]').innerText(), why);
    assert.deepEqual(app.errors, []);
    await context.close();
  }
});

test('a period with no work of the person offers no Genie praise and names no example', async () => {
  const seen = {};
  const idle = { fixed: 0, dismissed: 0, could_not: 0, assigned: 0, notes: 0, changes: 0, records: 0 };
  const routes = {
    ...workRoutes(seen),
    my_work: ({ route, json }) => {
      (seen.work ||= []).push(route.request().postDataJSON());
      return json(200, { person: PERSON, period: WEEK, errors: {}, offset: 0, size: 50, total: 0,
        pages: { n01_u05: entry({ worked: idle, active_hours: 0, money: money(0, 0, 0), close: { n: 0, median_hours: null }, best: null }), n02_u01: entry({ worked: idle, active_hours: 0, money: money(0, 0, 0), close: { n: 0, median_hours: null }, best: null }) },
        activity: [] });
    },
  };
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes });
  await page.evaluate(() => { window.location.hash = '#/mywork'; });
  await page.waitForSelector('[data-summary-text]');
  await until(() => (seen.work || []).length > 0);
  const said = await page.locator('[data-summary-text]').innerText();
  assert.equal(said, 'You changed no records from Oct 19, 2026 to Oct 25, 2026, Asia/Dubai time.');
  assert.doesNotMatch(said, /Item a1|stands out|great|well done/i);
  assert.equal(await page.locator('[data-summary-ai]').count(), 0, 'no Write it with Genie button when there is nothing to praise');
  await page.waitForTimeout(500);
  assert.equal((seen.asks || []).length, 0, 'Genie is never asked to praise an idle period');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a single use case App lists My work above the use case, and the tabs layout shows it as a tab', async () => {
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: workRoutes({}) });
  const nav = await page.$$eval('nav.side .nav-i b', (els) => els.map((e) => e.textContent));
  assert.deepEqual(nav, ['My work', 'Impact', 'Price-loss decision desk']);
  assert.deepEqual(app.errors, []);
  await context.close();
  const tabs = await openApp(browser, served.base, appInfo({ ...DECIDE, layout: 'tabs' }, 2, TABLE), { routes: workRoutes({}) });
  assert.deepEqual((await tabs.page.$$eval('nav.tabs .tab', (els) => els.map((e) => e.textContent))).slice(0, 3), ['My work', 'Impact', 'Overview']);
  await tabs.context.close();
});

function askWork(seen) {
  return {
    ...workRoutes(seen),
    'genie/explain': ({ route, json }) => { (seen.explain ||= []).push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1', question: 'Sent.' }); },
    'genie/message': ({ json }) => json(200, { state: 'done', text: 'Genie answered.', sql: 'SELECT 1', columns: [], rows: [], truncated: false }),
  };
}

async function askBox(page, name, question) {
  await page.getByRole('button', { name: `Ask Genie about ${name}`, exact: true }).first().click();
  await page.getByLabel(`Your question about ${name}`).fill(question);
  await page.locator('form.ask-box button[type="submit"]').click();
}

test('every card, key number and row on My work shows a visible Ask Genie, and a use case row sends its own numbers to that use case Genie', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes: askWork(seen) });
  await page.click('[data-my-work-open]');
  await page.waitForSelector('[data-activity] tbody tr');
  const found = await page.evaluate(askAudit, ASK_GROUPS);
  assert.deepEqual([found.missing, found.hidden], [[], []], 'My work: 0 missing, 0 hidden');
  assert.ok(found.counts.row >= 51 && found.counts.kpi === 5, JSON.stringify(found.counts));
  assert.equal(await page.locator('[data-activity] tbody tr .row-ask').count(), 50, 'with Genie on, each change asks about its record');
  await askBox(page, 'Price-loss decision desk', 'Why so many notes?');
  await until(() => (seen.explain || []).length === 1);
  const sent = seen.explain[0];
  assert.deepEqual([sent.kind, sent.page, sent.title, sent.question, sent.context.hint], ['record', 'n01_u05', 'Price-loss decision desk', 'Why so many notes?', 'What you did in this use case.']);
  assert.deepEqual([sent.context.fields.Changed, sent.context.fields.Fixed, sent.context.fields['Could not fix'], sent.context.fields['Largest closed']], [6, 2, 1, 'Item a1, 900 measured']);
  await page.locator('aside.genie .msg-sql').waitFor({ timeout: 15000 });
  assert.match(await page.locator('aside.genie .g-h small').innerText(), /^Answers from the Genie Agent/, 'the panel shows the answer of that use case');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('in a single use case App a My work number asks the My work screen, which the server answers with that use case Genie', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: askWork(seen) });
  await page.evaluate(() => { window.location.hash = '#/mywork'; });
  await page.waitForSelector('[data-my-work] .kpi .ask-genie');
  const name = (await page.locator('[data-my-work] .kpi .ask-genie').first().getAttribute('aria-label')).replace('Ask Genie about ', '');
  await askBox(page, name, 'Is this a lot?');
  await until(() => (seen.explain || []).length === 1);
  assert.deepEqual([seen.explain[0].kind, seen.explain[0].page], ['kpi', 'mywork']);
  await page.locator('aside.genie .msg-sql').waitFor({ timeout: 15000 });
  assert.deepEqual(app.errors, []);
  await context.close();
});
