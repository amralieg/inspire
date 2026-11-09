import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, TABLE, WORKED, WORK_TEAM as TEAM, WORK_WEEK as WEEK, appInfo, openApp, serveDist, tracked, until, workEntry as entry, workMoney as money } from './harness.mjs';
import { closeCompare, falseAlarmFact, outcomeMix, performanceTiles, shareFact, weekTrend, workFacts } from '../src/mywork.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PAGE = { id: 'n01_u05', title: 'Pricing desk', records: { columns: [{ column: 'value_at_stake', currency: 'USD' }] } };
const facts = (e = entry()) => workFacts({ period: WEEK, pages: { n01_u05: e } }, [PAGE], {});
const tile = (tiles, id) => tiles.find((t) => t.id === id);

test('your share is of the items the team closed in the same use case, never a rank, and a team of one says so', () => {
  assert.deepEqual([shareFact(entry()).share, shareFact(entry()).text], [40, '4 of the 10 items the team closed; 3 people closed items']);
  assert.equal(shareFact(entry()).formula, '4 you closed / 10 the team closed x 100 = 40%');
  const alone = shareFact(entry({ team: { ...TEAM, closed: { fixed: 2, dismissed: 1, could_not: 1 }, total: 4, people: 1 } }));
  assert.deepEqual([alone.share, alone.text], [100, '4 of the 4 items the team closed; you were the only person closing items']);
  const idle = shareFact(entry({ worked: { ...WORKED, fixed: 0, dismissed: 0, could_not: 0 }, team: { ...TEAM, total: 2, people: 1 } }));
  assert.deepEqual([idle.share, idle.text], [0, '0 of the 2 items the team closed; one person closed them all'], 'zero share when another person closed everything');
  assert.deepEqual(shareFact(entry({ team: { closed: {}, total: 0, people: 0, close: { n: 0, median_hours: null } } })).share, null, 'no share of nothing');
  assert.deepEqual(shareFact({}).share, null, 'an old server with no team totals shows no share');
});

test('the false-alarm rate is the share you marked not an issue, next to the team rate', () => {
  assert.deepEqual([falseAlarmFact(WORKED).share, falseAlarmFact(WORKED).formula], [25, '1 not an issue / 4 closed x 100 = 25%']);
  assert.equal(falseAlarmFact({}).share, null);
  assert.equal(falseAlarmFact(null).text, 'Nothing closed yet');
  const shown = tile(performanceTiles(facts(), entry()), 'false_alarm');
  assert.deepEqual([shown.value, shown.sub], ['25%', '1 of 4 closed items marked not an issue; the team: 30%']);
});

test('your median time to close reads against the team median, and a team of one has no gap', () => {
  assert.deepEqual(closeCompare({ n: 4, median_hours: 53 }, { n: 10, median_hours: 60 }), { value: '53 hours', sub: 'Over 4 closes, 7 hours faster than the team median of 60 hours' });
  assert.equal(closeCompare({ n: 2, median_hours: 70 }, { n: 5, median_hours: 60 }).sub, 'Over 2 closes, 10 hours slower than the team median of 60 hours');
  assert.equal(closeCompare({ n: 2, median_hours: 60 }, { n: 5, median_hours: 60 }).sub, 'Over 2 closes, the same as the team median');
  assert.equal(closeCompare({ n: 4, median_hours: 53 }, { n: 4, median_hours: 53 }).sub, 'Over 4 closes; nobody else closed an item, so the team median is yours');
  assert.deepEqual(closeCompare({ n: 0, median_hours: null }, { n: 3, median_hours: 8 }), { value: 'None', sub: 'Team median 8 hours' });
  assert.deepEqual(closeCompare(null, null), { value: 'None', sub: 'Nobody closed an item in this period' });
});

test('the weekly trend draws one bar a week, and the outcome mix leaves out what is zero', () => {
  const bars = weekTrend(entry().weeks);
  assert.deepEqual(bars.map((b) => [b.key, b.value, b.text]), [['2026-10-12', 1, '1'], ['2026-10-19', 3, '3']]);
  assert.ok(bars[1].formula.endsWith('= 3'));
  assert.deepEqual(weekTrend(undefined), []);
  const mix = outcomeMix(entry());
  assert.deepEqual(mix.closed.map((b) => [b.key, b.value]), [['fixed', 2], ['dismissed', 1], ['could_not', 1]]);
  assert.deepEqual(mix.found.map((b) => [b.key, b.value]), [['left', 1], ['resolved', 1]], 'an outcome nobody had is not drawn (must-exclude)');
  assert.deepEqual(outcomeMix({}), { closed: [], found: [] });
});

test('the tiles keep measured, reported and estimated apart, and count the overdue items you own', () => {
  const tiles = performanceTiles(facts(), entry());
  assert.deepEqual(tiles.map((t) => [t.id, t.value]), [['measured', '$900'], ['reported', '$500'], ['estimated', '$3,000'], ['cleared', '4 (40%)'],
    ['close', '53 hours'], ['false_alarm', '25%'], ['overdue', '3']]);
  assert.equal(tile(tiles, 'overdue').sub, 'Past their due day and still open; the earliest 2 are listed');
  const none = performanceTiles(facts(entry({ overdue: { n: 0, items: [] }, money: money(0, 0, 0) })), entry({ overdue: { n: 0, items: [] } }));
  assert.deepEqual([tile(none, 'overdue').value, tile(none, 'overdue').sub, tile(none, 'measured').value], ['0', 'Nothing of yours is past due', 'None']);
});

function perfRoutes(seen, body = entry()) {
  const { routes } = tracked({
    my_work: ({ route, json }) => {
      seen.push(route.request().postDataJSON());
      return json(200, { period: WEEK, pages: { n01_u05: body }, activity: [{ page: 'n01_u05', key: 'R002', label: 'Item R002', kind: 'status', status: 'Done', at: '2026-10-22T06:00:00Z' }],
        total: 1, errors: {} });
    },
  });
  return routes;
}

test('Performance shows the person\'s numbers for this use case only, with the weekly trend, the overdue list and Promised and delivered', async () => {
  const asks = [];
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { hash: '#/n01_u05/performance', routes: perfRoutes(asks), ready: '[data-performance] .kpi-v' });
  assert.equal(asks[0].page, 'n01_u05', 'Performance asks for this use case only');
  assert.equal(asks[0].window, 'week');
  const text = await page.locator('[data-performance]').innerText();
  for (const shown of ['Items you cleared', '4 (40%)', 'Median time to close', '7 hours faster than the team median', 'Your false-alarm rate', 'Overdue items you own',
    'Items you closed, by week', 'Your outcome mix', 'Promised and delivered', 'What you did', 'Your best win is']) {
    assert.ok(text.includes(shown), `Performance shows ${shown}`);
  }
  assert.ok(!/rank|leaderboard|#1\b/i.test(text), 'a share, never a rank (must-exclude)');
  assert.equal(await page.locator('[data-overdue-row]').count(), 2);
  assert.equal(await page.locator('[data-my-work], .imp-page').count(), 0, 'the old My work and Impact pages are gone');
  await page.locator('[data-overdue-row="R001"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('rec=R001'));
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the period chips ask again for the same use case, and a person with no history sees the empty states, not a failure', async () => {
  const asks = [];
  const empty = entry({ worked: { fixed: 0, dismissed: 0, could_not: 0, assigned: 0, notes: 0, changes: 0, records: 0 }, money: money(0, 0, 0), best: null, close: { n: 0, median_hours: null },
    team: { closed: { fixed: 0, dismissed: 0, could_not: 0 }, total: 0, people: 0, close: { n: 0, median_hours: null } }, weeks: [], outcomes: {}, overdue: { n: 0, items: [] } });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/performance', routes: perfRoutes(asks, empty), ready: '[data-performance] .kpi-v' });
  const text = await page.locator('[data-performance]').innerText();
  assert.ok(text.includes('Nobody closed an item in this period'));
  assert.ok(text.includes('You closed no item in this period.'));
  assert.equal(await page.locator('[data-overdue], [data-best]').count(), 0, 'nothing overdue and no best win when there is none');
  await page.locator('[data-period] .pick-i', { hasText: 'All time' }).click();
  await until(() => asks.length === 2);
  assert.deepEqual([asks[1].page, asks[1].window], ['n01_u05', 'all']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const DENIED = '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`sales`.`loss`. Ask the owner to run: GRANT SELECT ON TABLE main.sales.loss TO `sam@example.com` SQLSTATE: 42501';

test('a use case or its impact that cannot load on Performance says so in a sentence, with the error code and the grant under Details', async () => {
  const { routes } = tracked({
    my_work: ({ json }) => json(200, { period: WEEK, pages: {}, activity: [], total: 0, errors: { n01_u05: DENIED } }),
    impact: ({ json }) => json(403, { error: DENIED }),
  });
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/performance', routes, ready: '[data-performance] .tile-err' });
  const view = page.locator('[data-performance]');
  await view.locator('[data-promised-delivered] .tile-err').waitFor();
  const said = await view.locator('.tile-err').evaluateAll((els) => els.map((e) => e.innerText));
  assert.ok(said.some((t) => /could not load: Insufficient privileges/.test(t)), said.join(' | '));
  assert.ok(said.some((t) => /^The impact could not load: Insufficient privileges/.test(t)), said.join(' | '));
  for (const text of said) for (const raw of ['INSUFFICIENT_PERMISSIONS', 'GRANT SELECT', 'SQLSTATE']) assert.ok(!text.includes(raw), `${raw} stays out of the sentence: ${text}`);
  assert.ok(await view.locator('[data-technical-details]').count() >= 2, 'each failure keeps its codes under Details');
  await view.locator('[data-technical-details] summary').first().click();
  assert.match(await view.locator('[data-technical-details] pre').first().innerText(), /GRANT SELECT ON TABLE main\.sales\.loss/);
  await context.close();
});
