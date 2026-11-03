import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, pageData, serveDist, toastSays, until } from './harness.mjs';
import { closedRows, estimatedFigure, figuresOf, heldShare, holdoutOffText, holdoutView, impactTiles, measuredFigure, promisedView, reportedFigure, wrongFigure } from '../src/impact.js';
import { actionForm, actionProblem, actionValues, doneText, statusLabel } from '../src/records.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PERSON = ['pat.lee', 'example.com'].join('@');
const DECIDE = { options: { modify: false, replace_edits: false, decisions: true } };
const closed = (done, dismissed, could) => ({ Done: { n: done, n_since: 0 }, Dismissed: { n: dismissed, n_since: 0 }, 'Could not fix': { n: could, n_since: 0 } });
const ENTRY = {
  visible: true, tracked: true, money: true, holds: true, since: '2026-10-01', served: 'delta',
  current: { records: 200, held: 20 },
  estimated: { 'Act now': { n: 4, money: 12000 }, Review: { n: 6, money: 3000.4 } },
  reported: { n: 3, n_since: 1, money: 2500, money_since: 900 },
  measured: { n: 2, n_since: 1, money: 1800, money_since: 1100 },
  closed: closed(5, 2, 1),
  outcomes: { left: 1, resolved: 1, flagged: 2, unchecked: 1 },
  reasons: [{ reason: 'The store closed', n: 2 }],
  holdout: { shown: { n: 40, hits: 18 }, held: { n: 10, hits: 2 } },
  records: [
    { key: 'k7', label: 'Wool coat, store 4', status: 'Done', state: 'resolved', reason: null, note: 'Repriced on Monday', at_close: 1200, now: 100, measured: 1100,
      reported: 900, closed: '2026-10-06T06:00:00.000Z' },
    { key: 'k6', label: 'Linen trousers', status: 'Dismissed', state: 'unchecked', reason: 'The store closed', note: null, at_close: 2000, now: null, measured: null,
      reported: null, closed: '2026-10-05T09:00:00.000Z' },
  ],
};
const PROMISED = { value: 'The Pricing Manager recovers margin lost to standing discounts.', benefits: ['Recover margin on discounted items [ESTIMATE: depends on value]'] };

test('each figure shows its number with the formula behind it, and the three amounts are never added together', () => {
  assert.deepEqual(estimatedFigure(ENTRY, 'USD'), { value: '$15,000', amount: 15000.4, n: 10, how: 'Money at stake on the 10 open records flagged Act now or Review, added up',
    formula: 'Act now $12,000 + Review $3,000 = $15,000' });
  assert.deepEqual(reportedFigure(ENTRY, 'USD'), { value: '$2,500', amount: 2500, n: 3, how: 'Amounts people entered when they marked 3 records fixed, added up',
    formula: 'The 3 amounts people entered when they marked records fixed, added up = $2,500' });
  assert.deepEqual(measuredFigure(ENTRY, 'USD'), { value: '$1,800', amount: 1800, n: 2,
    formula: 'On each of the 2 fixes a later run confirmed: money at stake when fixed minus what that run still finds, added up = $1,800',
    how: 'Money at stake when fixed, less what a later run still finds, on 2 fixes a later run confirmed. 2 fixes a later run still flags' });
  assert.deepEqual(wrongFigure(ENTRY), { value: '25%', amount: 25, n: 8, formula: '2 not a real issue / 8 closed x 100 = 25%',
    how: 'People marked 2 of 8 closed records not a real issue, so 75% were right' });
  const tiles = impactTiles([{ page: { title: 'Price desk' }, entry: ENTRY, currency: 'USD', figures: figuresOf(ENTRY, 'USD') },
    { page: { title: 'Euro desk' }, entry: ENTRY, currency: 'EUR', figures: figuresOf(ENTRY, 'EUR') }]);
  assert.deepEqual(tiles.map((t) => [t.label, t.value]), [['Estimated', '$15,000 + €15,000'], ['Reported', '$2,500 + €2,500'], ['Measured', '$1,800 + €1,800'],
    ['Said wrong', '25%']], 'amounts add up per figure and per currency, never across figures');
  assert.equal(tiles[2].sub, 'Money at stake when fixed, less what a later run still finds, on 4 fixes across 2 use cases');
  assert.deepEqual(tiles.map((t) => t.formula), ['Price desk $15,000 + Euro desk \u20ac15,000 = $15,000 + \u20ac15,000', 'Price desk $2,500 + Euro desk \u20ac2,500 = $2,500 + \u20ac2,500',
    'Price desk $1,800 + Euro desk \u20ac1,800 = $1,800 + \u20ac1,800', '4 not a real issue / 16 closed x 100 = 25%'], 'every tile shows the arithmetic behind it');
});

test('a use case without money says Not measured yet with why and never shows a number, and every use case keeps actions', () => {
  assert.deepEqual(estimatedFigure({ ...ENTRY, money: false }, 'USD').value, 'Not measured yet');
  assert.equal(measuredFigure({ ...ENTRY, money: false }, 'USD').how, 'This use case puts no amount at stake on its records');
  for (const stale of [{ actions: false }, { closing: false }, { actions: false, closing: false }]) {
    assert.deepEqual([reportedFigure({ ...ENTRY, ...stale }, 'USD'), measuredFigure({ ...ENTRY, ...stale }, 'USD'), wrongFigure({ ...ENTRY, ...stale })],
      [reportedFigure(ENTRY, 'USD'), measuredFigure(ENTRY, 'USD'), wrongFigure(ENTRY)], 'every result table keeps the actions and the amount a fix saved');
  }
  assert.deepEqual(wrongFigure({ ...ENTRY, closed: closed(0, 0, 0) }), { value: 'Not measured yet', amount: null, n: 0, how: 'Nobody has closed a record yet' });
  assert.equal(estimatedFigure({ tracked: false, note: 'no run of this use case has written its results yet' }).how, 'no run of this use case has written its results yet');
  assert.equal(estimatedFigure({ tracked: false, error: 'PERMISSION_DENIED' }).how, 'Could not load: PERMISSION_DENIED');
  const tiles = impactTiles([{ entry: { tracked: false }, currency: 'USD', figures: figuresOf({ tracked: false }, 'USD') }]);
  assert.deepEqual(tiles.map((t) => t.value), ['Not measured yet', 'Not measured yet', 'Not measured yet', 'Not measured yet']);
});

test('the holdout compares the share of flagged records that left the list among those shown and those held back', () => {
  assert.deepEqual(holdoutView(ENTRY), {
    lines: ['18 of 40 flagged records shown to people left the list or stopped being flagged (45%)', '2 of 10 flagged records held back left the list or stopped being flagged (20%)'],
    verdict: 'Records shown to people left the list 25 points more often than records held back', diff: 25 });
  const few = holdoutView({ ...ENTRY, holdout: { shown: { n: 40, hits: 18 }, held: { n: 4, hits: 1 } } });
  assert.equal(few.verdict, 'Too few records to compare yet: it needs at least 5 in each group');
  assert.equal(holdoutView({ ...ENTRY, holdout: null }), null, 'a use case that holds nothing back shows no comparison');
  assert.equal(holdoutOffText(ENTRY), '', 'a running holdout needs no sentence');
  assert.equal(holdoutOffText({ ...ENTRY, holdout: null, holds: false }),
    'Holdout is off for this use case: every flagged record is shown to people, so nothing is held back to compare against.');
  assert.equal(holdoutOffText({ ...ENTRY, holdout: null }), 'Holdout is on, but no run has held a record back yet, so there is nothing to compare.');
  assert.equal(holdoutOffText({ tracked: false }), '', 'a use case that tracks nothing says so elsewhere');
  assert.equal(heldShare(ENTRY), '20 records of 200 (10%) are held back now');
  assert.equal(heldShare({ current: { records: 200, held: 0 } }), '');
});

test('with holdout off the Impact page says plainly that nothing is held back, and shows no comparison', async () => {
  const off = { ...ENTRY, holdout: null, holds: false, current: { records: 200, held: 0 } };
  const routes = { impact: ({ json }) => json(200, off), summary: ({ json }) => json(200, SUMMARY) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, { ...TABLE, promised: PROMISED }), { width: 1440, routes });
  await page.goto(`${served.base}#/impact`);
  const card = page.locator('.imp').first();
  await card.locator('.imp-hold-off').waitFor();
  assert.equal(await card.locator('.imp-hold-off').innerText(),
    'Holdout is off for this use case: every flagged record is shown to people, so nothing is held back to compare against.');
  assert.equal(await card.locator('[aria-label="Shown to people and held back"]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('promised reads the catalog business value and benefits, and each closed record shows how its measured amount was worked out', () => {
  assert.deepEqual(promisedView({ promised: PROMISED }), { value: PROMISED.value, benefits: ['Recover margin on discounted items (estimate: depends on value)'] });
  assert.equal(promisedView({ promised: { value: ' ', benefits: [] } }), null);
  assert.equal(promisedView({}), null);
  assert.deepEqual(closedRows(ENTRY, 'USD'), [
    { key: 'k7', label: 'Wool coat, store 4', outcome: 'Fixed', state: 'No longer flagged', measured: '$1,200 when fixed minus $100 now = $1,100', reported: '$900',
      note: 'Repriced on Monday', closed: 'Oct 6', amounts: { measured: 1100, reported: 900, closed: '2026-10-06T06:00:00.000Z' } },
    { key: 'k6', label: 'Linen trousers', outcome: 'Not a real issue', state: 'The store closed', measured: '', reported: '', note: '', closed: 'Oct 5',
      amounts: { measured: null, reported: null, closed: '2026-10-05T09:00:00.000Z' } }]);
});

test('closing a record as fixed can carry the money it saved and how you know, and only a fix does', () => {
  const current = { action_owner: PERSON, action_status: 'Done', realized_value: 900, realized_note: 'Repriced' };
  const form = actionForm(current, PERSON);
  assert.deepEqual([form.saved, form.how], ['900', 'Repriced']);
  assert.deepEqual(actionValues(current, form), {}, 'nothing changed sends nothing');
  assert.deepEqual(actionValues(current, { ...form, saved: '900.0' }), {}, 'the same amount written another way is no change');
  assert.deepEqual(actionValues(current, { ...form, saved: '1100.5' }), { action_status: 'Done', realized_value: 1100.5, realized_note: 'Repriced' });
  assert.deepEqual(actionValues(current, { ...form, saved: '' }), { action_status: 'Done', realized_value: null, realized_note: 'Repriced' });
  assert.deepEqual(actionValues({ action_status: 'New' }, { ...actionForm({ action_status: 'New' }, PERSON), status: 'Done', saved: '50', how: ' Called ' }),
    { action_owner: PERSON, action_status: 'Done', realized_value: 50, realized_note: 'Called' });
  assert.deepEqual(actionValues(current, { ...form, status: 'Could not fix' }), { action_status: 'Could not fix' }, 'only a fix sends an amount');
  assert.equal(actionProblem({ status: 'Done', saved: '-5', how: '' }), 'Enter the money it saved as a number, 0 or more');
  assert.equal(actionProblem({ status: 'Done', saved: 'ten', how: '' }), 'Enter the money it saved as a number, 0 or more');
  assert.equal(actionProblem({ status: 'Done', saved: '10', how: 'x'.repeat(501) }), 'Keep how you know to 500 characters');
  assert.equal(actionProblem({ status: 'Done', saved: '', how: '' }), '');
  assert.equal(doneText({ action_status: 'Done', realized_value: 900, realized_note: 'Repriced' }, 'USD'),
    'Marked as fixed. The next run checks whether it worked. People reported it saved $900: Repriced.');
  assert.equal(doneText({ action_status: 'Could not fix', action_outcome: 'Resolved' }), 'Marked as could not fix. A later run found it resolved anyway.');
  assert.equal(doneText({ action_status: 'Could not fix' }), 'Marked as could not fix. The next run still checks it.');
  assert.deepEqual(['Done', 'Dismissed', 'Could not fix', 'In progress'].map(statusLabel), ['Fixed', 'Not a real issue', 'Could not fix', 'In progress']);
});

const tile = (page) => page.locator('.kpi').evaluateAll((tiles) => tiles.map((t) => [t.querySelector('.kpi-l').innerText, t.querySelector('.kpi-v').innerText,
  t.querySelector('.kpi-s').innerText]));
const SUMMARY = { run: { currency: 'USD', decision_basis: 'measured', as_of_date: '2026-10-20' }, categories: {}, note: '' };

test('the Impact page shows estimated, reported and measured apart, promised against delivered, the holdout and the closed records', async () => {
  const info = appInfo({}, 2, { ...TABLE, promised: PROMISED });
  const asked = [];
  const routes = {
    impact: ({ json, url }) => { asked.push(url.searchParams.get('page')); return json(200, url.searchParams.get('page') === 'n01_u05' ? ENTRY : { visible: true, tracked: false, note: 'no run of this use case has written its results yet', promised: null }); },
    summary: ({ json }) => json(200, SUMMARY),
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes });
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact' && document.querySelectorAll('.imp').length === 2);
  await page.waitForFunction(() => !document.querySelector('.kpis .skel, .kpis .skeleton'));
  assert.deepEqual(await tile(page), [
    ['Estimated', '$15,000', 'Money at stake on the 10 open records flagged Act now or Review across 1 use case, added up'],
    ['Reported', '$2,500', 'Amounts people entered when they marked 3 records fixed across 1 use case'],
    ['Measured', '$1,800', 'Money at stake when fixed, less what a later run still finds, on 2 fixes across 1 use case'],
    ['Said wrong', '25%', 'People marked 2 of 8 closed records not a real issue, so 75% were right']]);
  assert.deepEqual(asked.sort(), ['n01_u05', 'n02_u01'], 'each use case reads its own impact once');
  const card = page.locator('.imp[data-page="n01_u05"]');
  assert.equal(await card.locator('.imp-promised p').innerText(), PROMISED.value);
  assert.deepEqual(await card.locator('.imp-figs > div').evaluateAll((all) => all.map((d) => [d.dataset.figure, d.querySelector('b').innerText])),
    [['estimated', '$15,000'], ['reported', '$2,500'], ['measured', '$1,800'], ['wrong', '25%']]);
  assert.equal(await card.locator('.imp-verdict').innerText(), 'Records shown to people left the list 25 points more often than records held back');
  assert.equal(await card.locator('.imp-hold .imp-why').innerText(), info.held_meaning, 'the block says what held back means, in the server\'s words');
  assert.ok(info.held_meaning.startsWith('Held back records were flagged Act now or Review but are kept off the to fix list on purpose'));
  assert.equal(await card.locator('.imp-hold > p:not(.imp-why)').first().innerText(), '20 records of 200 (10%) are held back now');
  assert.deepEqual(await card.locator('.imp-reasons li').allInnerTexts(), ['The store closed\n2']);
  const rows = await card.locator('.tbl--closed tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText)));
  assert.deepEqual(rows[0], ['Wool coat, store 4', 'Fixed', 'No longer flagged', '$1,200 when fixed minus $100 now = $1,100', '$900\nRepriced on Monday', 'Oct 6']);
  const other = page.locator('.imp[data-page="n02_u01"]');
  assert.equal(await other.locator('.card-h p').innerText(), 'no run of this use case has written its results yet');
  assert.deepEqual(await other.locator('.imp-figs b').allInnerTexts(), Array(4).fill('Not measured yet'));
  assert.equal(await other.locator('.imp-hold').count(), 0);
  const text = await page.locator('.imp-page').innerText();
  assert.ok(!/[\u2013\u2014]/.test(text), 'the page has no en or em dash');
  assert.equal(await page.locator('.side .nav-i.is-on .nav-t b').innerText(), 'Impact');
  await card.locator('.card-h .lnk').click();
  await page.waitForFunction(() => window.location.hash === '#/n01_u05');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a one use case App opens on its page, and its menu offers that page, My work and the Impact page with no Overview', async () => {
  const routes = { impact: ({ json }) => json(200, ENTRY), summary: ({ json }) => json(200, SUMMARY) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, { ...TABLE, promised: PROMISED }), { width: 1440, routes });
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Price-loss decision desk');
  assert.deepEqual(await page.locator('.side .nav-t b').allInnerTexts(), ['Price-loss decision desk', 'My work', 'Impact']);
  assert.equal(await page.locator('.side .side-h').innerText(), 'USE CASE');
  assert.equal(await page.locator('.side .nav-i.is-on .nav-t b').innerText(), 'Price-loss decision desk');
  await page.locator('.side .nav-i', { hasText: 'Impact' }).click();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact' && document.querySelectorAll('.imp').length === 1);
  assert.equal(await page.evaluate(() => window.location.hash), '#/impact');
  assert.equal(await page.evaluate(() => document.title), 'Impact · Pricing desk');
  await page.locator('.side .nav-i').first().click();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Price-loss decision desk');
  await page.goto(`${served.base}#/results`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a one use case App in the tabs layout has a tab for its page, one for My work and one for Impact', async () => {
  const routes = { impact: ({ json }) => json(200, ENTRY), summary: ({ json }) => json(200, SUMMARY) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ layout: 'tabs' }, 1, TABLE), { width: 1440, routes });
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Price-loss decision desk');
  assert.deepEqual(await page.locator('.tabs .tab').allInnerTexts(), ['Price-loss decision desk', 'My work', 'Impact']);
  await page.locator('.tabs .tab', { hasText: 'Impact' }).click();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the old Results link opens the Impact page', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 2, TABLE), { width: 1280 });
  await page.goto(`${served.base}#/results`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact');
  assert.equal(await page.evaluate(() => document.title), 'Impact · Pricing desk');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const F = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: role === 'business' && kind != null });
const BASE_FIELDS = [F('entity_id', 'text', 'id'), F('entity_label', 'text'), F('priority_tier', 'text'), F('rank', 'integer', 'business', 'INT'),
  F('record_key', 'text', 'history'), F('valid_from', 'timestamp', 'history', 'TIMESTAMP'), F('is_current', 'boolean', 'history', 'BOOLEAN'),
  F('change_source', 'text', 'history'), F('changed_by', 'text', 'history'), F('action_owner', 'text', 'action'), F('action_status', 'text', 'action'),
  F('action_due', 'date', 'action', 'DATE'), F('action_note', 'text', 'action'), F('dismiss_reason', 'text', 'action'), F('action_outcome', 'text', 'action')];
const CLOSE_FIELDS = [...BASE_FIELDS, F('realized_value', 'decimal', 'action', 'DOUBLE'), F('realized_note', 'text', 'action'),
  F('held_back', 'boolean', 'holdout', 'BOOLEAN'), F('run_tier', 'text', 'holdout')];
const ROWS = pageData({}).records.rows.map((r, i) => ({ ...r, record_key: r.entity_id, _inspire_key: r.entity_id, _inspire_version: String(100 + i) }));

function drawerRoutes(fields, current, calls) {
  const now = { ...ROWS[0], valid_from: '2026-10-20T09:00:00.000Z', is_current: true, change_source: 'run', changed_by: 'run 77', valid_from_us: '102',
    action_owner: PERSON, action_status: 'New', action_due: null, action_note: null, dismiss_reason: null, action_outcome: null, ...current };
  return {
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      return json(200, { rows: ROWS.slice(0, 5), total: 5, offset: 0, limit: body.limit, actions: true, changes: false, summary: { open: 1, done: 0, resolved: 0, owners: [PERSON] }, errors: {} });
    },
    'records/fields': ({ json }) => json(200, { fields, key_field: 'entity_id', actions: true }),
    'records/history': ({ json }) => json(200, { record_key: 'R001', fields, versions: [now], current: now, deleted: false, truncated: false }),
    'records/act': ({ route, json }) => { const body = route.request().postDataJSON(); calls.acts.push(body); return json(200, { written: body.record_keys, conflicts: [] }); },
  };
}

test('the record panel closes a record as fixed, not a real issue or could not fix, and a fix can carry the money it saved', async () => {
  const calls = { acts: [] };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: drawerRoutes(CLOSE_FIELDS, {}, calls) });
  await page.goto(`${served.base}#/n01_u05`);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  assert.deepEqual(await drawer.locator('.panel-f > button').allInnerTexts(), ['Fixed', 'Not a real issue', 'Could not fix', 'Snooze…']);
  assert.equal(await drawer.locator('input[name="realized_value"]').count(), 0, 'the amount shows only for a fix');
  await drawer.locator('select[name="action_status"]').selectOption('Done');
  await drawer.locator('input[name="realized_value"]').fill('-3');
  assert.equal(await drawer.locator('.in-err').innerText(), 'Enter the money it saved as a number, 0 or more');
  assert.equal(await drawer.getByRole('button', { name: 'Save action' }).isDisabled(), true);
  await drawer.locator('input[name="realized_value"]').fill('1250');
  await drawer.locator('textarea[name="realized_note"]').fill('Repriced the coat on Monday');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0], { page: 'n01_u05', record_keys: ['R001'], values: { action_status: 'Done', realized_value: 1250, realized_note: 'Repriced the coat on Monday' },
    seen: { R001: '102' } });
  await page.waitForFunction(() => document.querySelector('dialog.drawer select[name="action_status"]')?.value === 'New');
  await drawer.getByRole('button', { name: 'Could not fix' }).click();
  await until(() => calls.acts.length === 2);
  assert.deepEqual(calls.acts[1].values, { action_status: 'Could not fix' });
  await toastSays(page, 'Marked as could not fix. The next run still checks it.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('closing a record from its panel reloads the things to fix, so the tab count drops at once without a reload', async () => {
  const calls = { acts: [] };
  const hub = [];
  const overview = ({ route, json }) => {
    hub.push(route.request().postDataJSON());
    const items = (calls.acts.length ? ['R002'] : ['R001', 'R002']).map((key) => ({ key, label: key, tier: 'Act now', money: null, fx: null, why: null,
      owner: null, status: null, reason: 'Discount too deep', due: null }));
    return json(200, { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: { visible: true, tracked: true,
      money: false, categories: [], served: 'delta', items, total: items.length, truncated: false } } });
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: { ...drawerRoutes(CLOSE_FIELDS, {}, calls), overview } });
  await page.goto(`${served.base}#/n01_u05`);
  const count = page.locator('[role="tab"][data-view="overview"] small');
  await count.filter({ hasText: /^2$/ }).waitFor();
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  const loads = hub.length;
  await drawer.getByRole('button', { name: 'Could not fix' }).click();
  await until(() => calls.acts.length === 1);
  await until(() => hub.length > loads);
  assert.ok(hub.length > loads, 'a close reloads the things to fix');
  await count.filter({ hasText: /^1$/ }).waitFor({ timeout: 5000 });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a table without the close amount offers the outcomes but no money field', async () => {
  const calls = { acts: [] };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: drawerRoutes(BASE_FIELDS, {}, calls) });
  await page.goto(`${served.base}#/n01_u05`);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  await drawer.locator('select[name="action_status"]').selectOption('Done');
  assert.equal(await drawer.locator('input[name="realized_value"]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a held back record says why and offers no action, so the comparison stays clean', async () => {
  const calls = { acts: [] };
  const info = appInfo(DECIDE, 1, TABLE);
  const { page, seen, context } = await openApp(browser, served.base, info,
    { routes: drawerRoutes(CLOSE_FIELDS, { held_back: true, run_tier: 'Act now', priority_tier: 'Held back' }, calls) });
  await page.goto(`${served.base}#/n01_u05`);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.held').waitFor();
  assert.ok(info.held_meaning.startsWith('Held back records were flagged Act now or Review'));
  assert.equal(await drawer.locator('.held').innerText(), `${info.held_meaning} Leave this one as it is.`);
  assert.equal(await drawer.locator('.dr-act').count(), 0);
  assert.deepEqual(await drawer.locator('.panel-f > button').allInnerTexts(), ['Close']);
  assert.equal(calls.acts.length, 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the weekly email link ?open=impact opens the Impact page after sign-in, and the address becomes #/impact so a reload stays there', async () => {
  const routes = { impact: ({ json }) => json(200, ENTRY), summary: ({ json }) => json(200, SUMMARY) };
  const { page, seen, context } = await openApp(browser, `${served.base}?open=impact`, appInfo({}, 1, { ...TABLE, promised: PROMISED }), { width: 1440, routes, ready: '.imp' });
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact' && document.querySelectorAll('.imp').length === 1);
  assert.deepEqual(await page.evaluate(() => [window.location.search, window.location.hash]), ['', '#/impact']);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
