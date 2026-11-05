import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist } from './harness.mjs';
import { formatValue, isMoney, money, savedWords, stakeName, stakeNameOf, stakeWords, unitOf, wholeMoney } from '../src/format.js';
import { estimatedFigure, impactTiles, measuredFigure, figuresOf, reportedFigure, targetKpiView } from '../src/impact.js';
import { couldSaveText, moneyText, pageCurrency, pageKind, savedTile, totals } from '../src/hub.js';
import { recordFormula, savedFormula, sumFormula } from '../src/money.js';
import { actionProblem, columnLabel, doneText, recordView, savingText } from '../src/records.js';
import { couldSaveRunFormula, foundText } from '../src/freshness.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const ENTRY = {
  visible: true, tracked: true, money: true, holds: false, since: '2026-10-01', served: 'delta',
  current: { records: 50, held: 0 },
  estimated: { 'Act now': { n: 4, money: 120 }, Review: { n: 6, money: 30.5 } },
  reported: { n: 1, n_since: 1, money: 8, money_since: 8 },
  measured: { n: 2, n_since: 1, money: 18, money_since: 11 },
  closed: { Done: { n: 3, n_since: 0 }, Dismissed: { n: 1, n_since: 0 }, 'Could not fix': { n: 0, n_since: 0 } },
  outcomes: { left: 1, resolved: 1, flagged: 0, unchecked: 1 }, reasons: [], holdout: null, records: [],
};
const KPI = { kpi_name: 'Analyst hours spent on manual review', kpi_source: 'evaluated', kpi_direction: 'decrease', kpi_unit: 'hours',
  kpi_baseline: 1200, kpi_baseline_on: '2026-10-01', kpi_latest: 1100, kpi_target: 900, kpi_target_text: 'Cut analyst hours to 900',
  kpi_status: 'measured', kpi_reason: null, kpi_measured_at: '2026-10-28T06:00:00' };
const HOURS_RUN = { currency: '', unit: 'hours', impact_kind: 'hours', impact_unit: 'hours', decision_basis: 'measured', as_of_date: '2026-10-20', ...KPI };

test('one formatter shows every amount in its unit: money only with a currency, every other unit after the number', () => {
  assert.equal(wholeMoney(1234.5, 'hours'), '1,234.5 hours');
  assert.equal(wholeMoney(0.4, 'points of churn rate'), '0.4 points of churn rate');
  assert.equal(wholeMoney(1234.5, 'USD'), '$1,235', 'money stays as it was');
  assert.equal(wholeMoney(1234.5, ''), '1,235');
  assert.equal(money(12000, 'hours', 0), '12K hours');
  assert.equal(money(12000, 'USD', 0), '$12K');
  assert.equal(formatValue(40, 'currency', 'late shipments'), '40 late shipments');
  assert.equal(savingText(12.5, 'hours'), '12.5 hours');
  assert.equal(savingText(12, ''), '12');
  assert.equal(savingText(1200, 'USD'), '$1,200');
  assert.deepEqual([stakeName('hours'), stakeName('USD'), stakeName(''), stakeName('late shipments')],
    ['Hours at stake', 'Money at stake', 'Money at stake', 'Late shipments at stake']);
  assert.deepEqual([stakeNameOf(['hours', 'hours']), stakeNameOf(['hours', 'USD']), stakeNameOf([]), stakeNameOf(['USD', 'EUR'])],
    ['Hours at stake', 'At stake', 'Money at stake', 'Money at stake'], 'two currencies are still money');
  assert.deepEqual([unitOf({ unit: 'hours', currency: '' }), unitOf({ currency: 'EUR' }), unitOf(null)], ['hours', 'EUR', '']);
});

test('one helper names what is at stake in the KPI unit with its own capitals, and amount when a use case puts nothing at stake', () => {
  assert.deepEqual([stakeWords('hours'), stakeWords('MWh'), stakeWords('USD'), stakeWords(''), stakeWords(' late  shipments ')],
    ['hours at stake', 'MWh at stake', 'money at stake', 'money at stake', 'late shipments at stake']);
  assert.deepEqual([stakeName('MWh'), stakeName('hours'), stakeName('EUR')], ['MWh at stake', 'Hours at stake', 'Money at stake']);
  assert.ok(savedFormula('5 MWh', 1, '', 'MWh').startsWith('The MWh at stake each fix had'), 'a unit keeps its capitals in a sentence');
  assert.ok(measuredFigure(ENTRY, 'MWh').formula.includes(': MWh at stake when fixed minus'));
  const bare = { ...ENTRY, money: false };
  assert.equal(estimatedFigure(bare, 'hours').how, 'This use case puts no amount at stake on its records');
  assert.equal(measuredFigure(bare, 'hours').how, 'This use case puts no amount at stake on its records');
  assert.equal(savedTile([['n01', { tracked: true, money: false, done: {} }]], [{ id: 'n01' }], {}, 'saved', '').sub,
    'No use case records its fixes and the amount at stake on them yet');
});

test('the KPI kind decides money: FTE, SKU and KWH show their unit, USD, EUR and AED stay money, and an old summary falls back to ISO codes only', () => {
  assert.deepEqual([wholeMoney(1234, 'FTE', 'number'), wholeMoney(1234, 'SKU', 'count'), money(12000, 'KWH', 0, 'number')],
    ['1,234 FTE', '1,234 SKU', '12K KWH']);
  assert.deepEqual([wholeMoney(1234, 'FTE'), wholeMoney(1234, 'SKU'), money(12000, 'KWH', 0)], ['1,234 FTE', '1,234 SKU', '12K KWH'],
    'with no kind stored, three capitals are no currency');
  assert.deepEqual([wholeMoney(1234.5, 'USD', 'money'), wholeMoney(1234.5, 'EUR', 'money'), wholeMoney(1234.5, 'AED', 'money'), wholeMoney(1234.5, 'USD')],
    ['$1,235', '€1,235', 'AED 1,235', '$1,235']);
  assert.deepEqual([stakeName('FTE', 'number'), stakeName('SKU'), stakeName('USD'), stakeName('', 'money'), stakeName('', 'count'), stakeName('TOP', 'count')],
    ['FTE at stake', 'SKU at stake', 'Money at stake', 'Money at stake', 'Count at stake', 'TOP at stake']);
  assert.equal(wholeMoney(5, 'TOP', 'count'), '5 TOP', 'a stored kind wins over a unit spelled like a currency code');
  assert.deepEqual([isMoney('FTE'), isMoney('USD'), isMoney(''), isMoney('USD', 'hours'), isMoney('', 'money')], [false, true, true, false, true]);
  const fte = { run: { ...HOURS_RUN, unit: 'FTE', impact_kind: 'number', impact_unit: 'FTE' } };
  const listed = { records: { columns: [{ column: 'value_at_stake', currency: 'USD', format: 'currency' }] } };
  assert.deepEqual([pageCurrency(listed, fte), pageKind(listed, fte)], ['FTE', 'number'], 'the KPI unit wins over the currency the page names');
  assert.deepEqual([pageCurrency(listed, { run: { currency: 'USD' } }), pageCurrency({}, { run: { currency: 'FTE' } })], ['USD', 'FTE']);
  assert.deepEqual([pageCurrency(listed, { run: { unit: '', impact_kind: 'count' } }), pageCurrency(listed, { run: { unit: '', impact_kind: 'money' } })],
    ['', 'USD'], 'a count with no unit never borrows the page currency');
  assert.equal(savingText(1200, 'FTE', 'number'), '1,200 FTE');
  assert.equal(savingText(1200, 'USD'), '$1,200');
  assert.equal(recordView(USD_LIST, null, { value_at_stake: 40, entity_label: 'Case 7' }, {}, 'FTE', 'number').saving.text, '40 FTE');
  const rows = [{ label: 'A', money: 3, currency: 'FTE', kind: 'number' }, { label: 'B', money: 2, currency: 'FTE', kind: 'number' }];
  assert.equal(couldSaveText(rows), 'FTE at stake on the 2 things to fix, added up');
  assert.equal(sumFormula(rows, 'x'), 'x: A 3 FTE + B 2 FTE = 5 FTE. Open a record to see how it is worked out.');
  assert.equal(moneyText(totals(rows)), '5 FTE');
  assert.equal(estimatedFigure(ENTRY, 'SKU', 'count').value, '150.5 SKU');
  assert.equal(couldSaveRunFormula({ could_save: 40, to_fix: 2, unit: 'FTE', currency: '', impact_kind: 'number' }),
    'FTE at stake on its 2 things to fix in Act now and Review, added up when the run ended = 40 FTE');
});

test('every text about what a fix saved names the KPI unit, and money only for a money KPI', () => {
  assert.deepEqual([savedWords('', ''), savedWords('USD', 'money'), savedWords('hours', 'hours'), savedWords('late shipments', 'count'),
    savedWords('FTE', 'number'), savedWords('points of churn rate', 'percent')],
  ['money it saved', 'money it saved', 'hours it saved', 'late shipments it avoided', 'FTE it saved', 'points of churn rate it moved']);
  assert.equal(actionProblem({ status: 'Done', saved: 'ten', how: '' }, 'hours', 'hours'), 'Enter the hours it saved as a number, 0 or more');
  assert.equal(actionProblem({ status: 'Done', saved: 'ten', how: '' }), 'Enter the money it saved as a number, 0 or more');
  assert.equal(doneText({ action_status: 'Done', realized_value: 3 }, 'late shipments', 'count'),
    'Marked done. The next run checks whether it worked. People reported it avoided 3 late shipments.');
  assert.equal(doneText({ action_status: 'Done', realized_value: 900 }, 'USD'), 'Marked done. The next run checks whether it worked. People reported it saved $900.');
  assert.equal(reportedFigure(ENTRY, 'hours', 'hours').value, '8 hours');
  assert.deepEqual(reportedFigure({ ...ENTRY, closing: false }, 'hours', 'hours'), reportedFigure(ENTRY, 'hours', 'hours'),
    'every result table keeps the amount a fix saved, so no flag hides it');
  assert.deepEqual([columnLabel('realized_value', {}, 'hours', 'hours'), columnLabel('realized_value', {}), columnLabel('realized_value', {}, 'SKU', 'count')],
    ['Hours it saved', 'Money it saved', 'SKU it avoided']);
});

test('a use case counted in hours never shows money, and a money use case still does', () => {
  const hours = estimatedFigure(ENTRY, 'hours');
  assert.deepEqual(hours, { value: '150.5 hours', amount: 150.5, n: 10, how: 'Hours at stake on the 10 open records flagged Act now or Review, added up',
    formula: 'Act now 120 hours + Review 30.5 hours = 150.5 hours' });
  const measured = measuredFigure(ENTRY, 'hours');
  assert.equal(measured.value, '18 hours');
  assert.ok(measured.how.startsWith('Hours at stake when fixed') && measured.formula.includes('hours at stake when fixed minus'));
  const rows = [{ page: { title: 'Review desk' }, currency: 'hours', figures: figuresOf(ENTRY, 'hours') }];
  const tiles = impactTiles(rows);
  assert.equal(tiles[0].value, '150.5 hours');
  assert.equal(tiles[0].sub, 'Hours at stake on the 10 open records flagged Act now or Review across 1 use case, added up');
  for (const text of [JSON.stringify(hours), JSON.stringify(measured), JSON.stringify(tiles)]) {
    assert.ok(!/\$|[Mm]oney at stake/.test(text), 'a productivity use case is never priced in money');
  }
  assert.equal(estimatedFigure(ENTRY, 'USD').how, 'Money at stake on the 10 open records flagged Act now or Review, added up');
  const mixed = impactTiles([...rows, { page: { title: 'Price desk' }, currency: 'USD', figures: figuresOf(ENTRY, 'USD') }]);
  assert.equal(mixed[0].value, '150.5 hours + $151');
  assert.ok(mixed[0].sub.startsWith('At stake on the 20 open records'), 'two units are named for neither');
});

test('the page unit comes from the run summary, the things to fix and the saved tile follow it, and the runs say it too', () => {
  assert.equal(pageCurrency({}, { run: HOURS_RUN }), 'hours');
  assert.equal(pageCurrency({}, { run: { currency: 'EUR' } }), 'EUR', 'a summary from before the impact unit is money');
  assert.equal(pageCurrency({ records: { columns: [{ column: 'value_at_stake', currency: 'AED' }] } }, { run: null }), 'AED');
  const fix = [{ label: 'Case 1', money: 6, currency: 'hours' }, { label: 'Case 2', money: 2.5, currency: 'hours' }];
  assert.equal(couldSaveText(fix), 'Hours at stake on the 2 things to fix, added up');
  assert.equal(sumFormula(fix, 'Hours at stake on the 2 things to fix, added up', 'hours'),
    'Hours at stake on the 2 things to fix, added up: Case 1 6 hours + Case 2 2.5 hours = 8.5 hours. Open a record to see how it is worked out.');
  assert.ok(sumFormula([{ label: 'A', money: 5, currency: 'USD' }], 'x', 'USD').endsWith('how its money is worked out.'));
  const tile = savedTile([['n01', { tracked: true, money: true, done: { saved: 18, saved_n: 2 } }]], [{ id: 'n01' }],
    { n01: { run: HOURS_RUN } }, 'saved', '');
  assert.equal(tile.value, '18 hours');
  assert.ok(tile.sub.startsWith('Hours at stake when fixed') && tile.formula.startsWith('The hours at stake each fix had'));
  assert.equal(savedFormula('$5', 1, ''), 'The money at stake each fix had when it was fixed, less what a later run still finds, added up over the 1 fix a later run confirmed = $5');
  const run = { could_save: 40, to_fix: 2, unit: 'hours', currency: '' };
  assert.equal(couldSaveRunFormula(run), 'Hours at stake on its 2 things to fix in Act now and Review, added up when the run ended = 40 hours');
  assert.equal(foundText(run).split('.')[0], '2 things to fix that could save 40 hours');
  const model = { currency: '', unit: 'hours', inputs: 'columns', columns: ['cases'], parts: [{ column: 'cases', kind: 'number' }, { text: ' cases x 2 hours' }], assumptions: [] };
  assert.equal(recordFormula(model, { _inspire_fx: '3', _inspire_money: 6 }), '3 cases x 2 hours = 6 hours');
});

test('the target KPI shows its baseline, latest value and target, and says not measured with the reason when it is not', () => {
  assert.deepEqual(targetKpiView(HOURS_RUN), {
    name: 'Analyst hours spent on manual review', direction: '\u25bc Decrease', source: 'Inspire chose this KPI for the use case',
    baseline: '1,200 hours', baselineOn: 'Oct 1', latest: '1,100 hours', latestOn: 'Oct 28', target: '900 hours', note: '',
    baselineFlagged: false });
  const text = targetKpiView({ ...HOURS_RUN, kpi_source: 'inspire', kpi_status: 'not_measured', kpi_latest: null, kpi_target: null,
    kpi_reason: 'its definition names no measure, table or column Inspire can aggregate, so it is tracked as text', kpi_unit: '%' });
  assert.equal(text.latest, 'Not measured');
  assert.equal(text.note, 'Not measured: Its definition names no measure, table or column Inspire can aggregate, so it is tracked as text');
  assert.equal(text.target, 'Cut analyst hours to 900', 'a target that is no plain number or percent change is shown as its text');
  assert.equal(text.source, 'This use case\u2019s KPI from Inspire');
  assert.equal(targetKpiView({ ...HOURS_RUN, kpi_unit: '%', kpi_baseline: 12.5 }).baseline, '12.5%');
  assert.equal(targetKpiView({ ...HOURS_RUN, kpi_status: 'failed', kpi_reason: 'its query failed: denied' }).note, 'Not measured: Its query failed: denied');
  assert.equal(targetKpiView({ ...HOURS_RUN, kpi_target: null, kpi_target_text: '' }).target, 'No target set');
  assert.equal(targetKpiView({ currency: 'USD' }), null, 'a run from before the KPI step shows no KPI card');
});

test('the Impact page counts a productivity use case in hours and shows its target KPI', async () => {
  const info = appInfo({}, 1, { ...TABLE, promised: null });
  const routes = { impact: ({ json }) => json(200, ENTRY), summary: ({ json }) => json(200, { run: HOURS_RUN, categories: {}, note: '' }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes });
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact' && document.querySelector('.imp-kpi'));
  await page.waitForFunction(() => !document.querySelector('.kpis .skel, .kpis .skeleton') && /hours/.test(document.querySelector('.kpi .kpi-v')?.innerText || ''));
  const card = page.locator('.imp-kpi');
  const heading = await card.locator('h3').innerText();
  assert.ok(heading.startsWith('Target KPI: Analyst hours spent on manual review') && heading.endsWith('\u25bc Decrease'), heading);
  assert.deepEqual(await card.locator('dl > div').evaluateAll((all) => all.map((d) => [d.querySelector('dt').innerText, d.querySelector('dd').innerText])),
    [['Baseline', '1,200 hours\nMeasured Oct 1'], ['Latest', '1,100 hours\nMeasured Oct 28'], ['Target', '900 hours']]);
  const pageText = await page.locator('.imp-page').innerText();
  assert.ok(pageText.includes('150.5 hours') && !pageText.includes('$'), 'every amount on the page is in hours');
  assert.ok(!/[\u2013\u2014]/.test(pageText), 'the page has no en or em dash');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const USD_LIST = { title: 'Decision list', key: 'entity_id', label: 'entity_label', rank: 'rank', tier: 'priority_tier',
  columns: [{ column: 'value_at_stake', label: 'Could save', format: 'currency', currency: 'USD' }] };
const HOURS_MODEL = { currency: '', unit: 'hours', basis: 'measured', act_now_amount: 30, review_amount: 5, template: '', parts: [], columns: [],
  inputs: '', assumptions: [], expression: null, recomputes: false, changed: false, problem: 'the hours at stake formula of this use case names no assumption' };

test('a record with no formula shows its impact in the KPI unit, and a money page still in its currency', () => {
  const row = { value_at_stake: 1200, entity_label: 'Case 7' };
  assert.equal(recordView(USD_LIST, null, row, {}, 'hours').saving.text, '1,200 hours', 'the KPI unit wins over a currency the page names');
  assert.equal(recordView(USD_LIST, null, row, {}, 'USD').saving.text, '$1,200');
  assert.equal(recordView(USD_LIST, null, row).saving.text, '$1,200', 'a page with no unit keeps the currency it names');
  assert.equal(recordView({ ...USD_LIST, columns: [] }, null, row, {}, '').saving.text, '1,200');
});

test('the decision list and the record panel of a use case counted in hours with no formula show hours, never money', async () => {
  const info = appInfo({}, 1, { ...TABLE, records: USD_LIST });
  const id = info.pages[0].id;
  const routes = {
    summary: ({ json }) => json(200, { run: HOURS_RUN, categories: {}, note: '' }),
    'records/history': ({ json, url }) => json(200, { record_key: url.searchParams.get('record_key'), fields: [], versions: [], current: null,
      deleted: false, truncated: false }),
    records: ({ json }) => json(200, { rows: [{ entity_id: 'c7', record_key: 'c7', entity_label: 'Case 7', rank: 1, priority_tier: 'Act now', value_at_stake: 40 }],
      total: 1, offset: 0, limit: 25, actions: false, changes: false, summary: null, errors: {}, money: HOURS_MODEL }),
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes });
  await page.goto(`${served.base}#/${id}`);
  const row = page.locator('.card--table[aria-label="Decision list"] tbody tr').first();
  await row.waitFor();
  assert.ok((await row.innerText()).includes('40 hours'), await row.innerText());
  await row.locator('.cell-t').click();
  const panel = page.locator('dialog.drawer[open] section[aria-label="Could save"]');
  await panel.waitFor();
  assert.equal(await panel.locator('.save').innerText(), '40 hours');
  assert.ok(!(await page.locator('dialog.drawer[open]').innerText()).includes('$'), 'no amount of this record is priced in money');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case counted in FTE shows FTE on its decision list, record panel and Impact page, never a currency', async () => {
  const fteRun = { ...HOURS_RUN, unit: 'FTE', impact_kind: 'number', impact_unit: 'FTE', kpi_unit: 'FTE' };
  const fteModel = { ...HOURS_MODEL, unit: 'FTE', impact_kind: 'number', problem: 'the FTE at stake formula of this use case names no assumption' };
  const info = appInfo({}, 1, { ...TABLE, records: USD_LIST });
  const id = info.pages[0].id;
  const routes = {
    summary: ({ json }) => json(200, { run: fteRun, categories: {}, note: '' }),
    impact: ({ json }) => json(200, ENTRY),
    'records/history': ({ json, url }) => json(200, { record_key: url.searchParams.get('record_key'), fields: [], versions: [], current: null,
      deleted: false, truncated: false }),
    records: ({ json }) => json(200, { rows: [{ entity_id: 'c7', record_key: 'c7', entity_label: 'Case 7', rank: 1, priority_tier: 'Act now', value_at_stake: 40 }],
      total: 1, offset: 0, limit: 25, actions: false, changes: false, summary: null, errors: {}, money: fteModel }),
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes });
  await page.goto(`${served.base}#/${id}`);
  const row = page.locator('.card--table[aria-label="Decision list"] tbody tr').first();
  await row.waitFor();
  assert.ok((await row.innerText()).includes('40 FTE'), await row.innerText());
  await row.locator('.cell-t').click();
  const panel = page.locator('dialog.drawer[open] section[aria-label="Could save"]');
  await panel.waitFor();
  assert.equal(await panel.locator('.save').innerText(), '40 FTE');
  assert.ok(!/\$|FTE\s?\d|Money at stake/.test(await page.locator('dialog.drawer[open]').innerText()), 'FTE is never read as a currency code');
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact' && /FTE/.test(document.querySelector('.kpi .kpi-v')?.innerText || ''));
  const text = await page.locator('.imp-page').innerText();
  assert.ok(text.includes('150.5 FTE') && !text.includes('$') && !/FTE\s?\d/.test(text) && !/money at stake/i.test(text), text);
  assert.ok(text.includes('FTE at stake'), 'the Impact page names the stake in FTE');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a baseline taken on a table the person swapped is flagged with the reason on the KPI card', async () => {
  const reason = 'its baseline was measured on main.sales.orders, but it is measured now on main.sales.orders_v2, which you chose in its '
    + 'place, so the baseline and the latest value come from different tables';
  const view = targetKpiView({ ...HOURS_RUN, kpi_reason: reason });
  assert.equal(view.latest, '1,100 hours', 'the KPI is still measured');
  assert.equal(view.note, `Baseline: ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`);
  assert.equal(view.baselineFlagged, true);
  assert.equal(targetKpiView(HOURS_RUN).baselineFlagged, false, 'a baseline on the table it is measured on is not flagged');
  const info = appInfo({}, 1, { ...TABLE, promised: null });
  const routes = { impact: ({ json }) => json(200, ENTRY), summary: ({ json }) => json(200, { run: { ...HOURS_RUN, kpi_reason: reason }, categories: {}, note: '' }) };
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes });
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => document.querySelector('.imp-kpi .imp-kpi-note'));
  const card = page.locator('.imp-kpi');
  assert.equal(await card.locator('.imp-kpi-note').innerText(), view.note);
  assert.equal(await card.locator('dd.is-flagged').count(), 1, 'the baseline itself is marked');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
