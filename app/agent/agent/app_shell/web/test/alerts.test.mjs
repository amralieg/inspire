import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { actBody, ASK_GROUPS, TABLE, appInfo, askAudit, openApp, pageData, serveDist, until } from './harness.mjs';
import {
  blankForm, capText, capped, defaultName, filtersText, formFrom, formProblem, operatorLabel, parseEmails, previewText, ruleText, stateFlag, watchOf,
  withNotice,
} from '../src/alerts.js';
import { stampText } from '../src/freshness.js';

const NOW = Date.parse('2026-10-27T09:30:00Z');
const { vs, marks, words } = appInfo().pages[0].kpis[0];
const SHOWN = { vs, marks, words };
const PERSON = ['pat.lee', 'example.com'].join('@');
const SAM = ['sam.roe', 'example.com'].join('@');
const FOLDER = '/Workspace/Shared/acme_implemented/alerts/loss-desk';
const ON = { options: { modify: false, replace_edits: false, decisions: true, alerts: true }, alert_folder: FOLDER };
const BUILT = 'https://example.com/sql/alerts-v2/55';
const SCHEDULES = [{ id: 'hourly', label: 'every hour' }, { id: 'daily', label: 'every day at 08:00 UTC' }, { id: 'weekly', label: 'every Monday at 08:00 UTC' }];
const MEASURES = [
  { id: 'records', label: 'Records on the list', format: 'integer', currency: '', filters: ['category', 'channel'], baseline: true, baseline_filters: ['category'],
    baseline_note: '' },
  { id: 'total_loss', label: 'Total loss', format: 'currency', currency: 'USD', filters: ['category'], baseline: false, baseline_filters: [],
    baseline_note: 'earlier runs do not carry what this measure reads' },
];
const MINE = { id: '9001', kind: 'watch', page: 'n01_u05', name: 'Books pile up', by: PERSON, owner: '', schedule: 'daily', state: 'triggered',
  watch: { what: 'records', filters: { category: ['Books'] }, operator: '>=', threshold: 5, basis: 'fixed' }, checked: '2026-10-27T08:00:05Z',
  emails: [PERSON], email_count: 1, can_change: true, url: 'https://example.com/sql/alerts-v2/9001' };
const THEIRS = { ...MINE, id: '9002', name: 'Loss jumps', by: SAM, state: 'ok', emails: [], email_count: 3, can_change: false,
  watch: { what: 'total_loss', filters: {}, operator: '>', threshold: 250000, basis: 'fixed' } };
const NOTICE = { id: '9003', kind: 'assigned', page: 'n01_u05', name: `Assigned to ${PERSON}`, by: SAM, owner: PERSON, schedule: null, state: 'paused',
  watch: null, checked: null, emails: [PERSON], email_count: 1, can_change: true, url: '' };
const LISTING = { on: true, reason: '', built: BUILT, unread: 0, admin: false, caps: { app: 20, person: 10, used: 2, mine: 1 }, schedules: SCHEDULES,
  operators: ['>=', '>', '=', '!=', '<', '<='], baseline_operators: ['>=', '>', '<=', '<'], measures: MEASURES, alerts: [MINE, THEIRS, NOTICE] };

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

function alertRoutes(listing = LISTING, overrides = {}) {
  const calls = { lists: 0, previews: [], saves: [], pauses: [], deletes: [] };
  const body = (route) => route.request().postDataJSON();
  const routes = {
    alerts: ({ json }) => { calls.lists += 1; return json(200, listing); },
    'alerts/preview': ({ route, json }) => {
      const sent = body(route);
      calls.previews.push(sent);
      return json(200, sent.watch.basis === 'baseline' ? { value: 14, fires: false, threshold: 20.5, basis: 'baseline', history_runs: 12 }
        : { value: 14, fires: true, threshold: sent.watch.threshold, basis: 'fixed', history_runs: null });
    },
    'alerts/save': ({ route, json }) => { calls.saves.push(body(route)); return json(200, { alert: { ...MINE, id: '9100' } }); },
    'alerts/pause': ({ route, json }) => { calls.pauses.push(body(route)); return json(200, { alert: { ...MINE, state: 'paused' } }); },
    'alerts/delete': ({ route, json }) => { calls.deletes.push(body(route)); return json(200, { deleted: body(route).id }); },
    ...overrides,
  };
  return { calls, routes };
}

const open = (info, routes, options = {}) => openApp(browser, served.base, info, { clock: NOW, ...options, routes });

async function alertsTab(page) {
  await page.goto(`${served.base}#/n01_u05?v=alerts`);
  await page.locator('section.alerts').waitFor();
}

test('the alert words read like a person wrote them and say what fires, in plain sentences', () => {
  assert.equal(ruleText(MINE.watch, MEASURES), 'Records on the list is at least 5');
  assert.equal(ruleText({ what: 'total_loss', operator: '<', threshold: 2.5, basis: 'fixed' }, MEASURES), 'Total loss is below 2.5');
  assert.equal(ruleText({ what: 'records', operator: '<=', threshold: 1, basis: 'baseline' }, MEASURES), 'Records on the list falls below the usual range of earlier runs');
  assert.equal(ruleText({ what: 'total_loss', operator: '>=', threshold: 1060, basis: 'fixed' }, MEASURES), 'Total loss is at least 1,060');
  assert.equal(ruleText({ what: 'total_loss', operator: '>=', threshold: 1234567.891, basis: 'fixed' }, MEASURES), 'Total loss is at least 1,234,567.891');
  assert.equal(ruleText({ what: 'total_loss', operator: '<', threshold: 0.0000001234, basis: 'fixed' }, MEASURES), 'Total loss is below 0.0000001234');
  assert.equal(operatorLabel('>', 'baseline'), 'rises above the usual range, until then is above the number');
  assert.equal(operatorLabel('!=', 'fixed'), 'is not');
  assert.equal(filtersText({ filters: { category: ['Books', 'Music'], channel: [] } }, [{ id: 'category', label: 'Category' }]), 'Category: Books, Music');
  assert.deepEqual(parseEmails(`${PERSON}, ${SAM.toUpperCase()};\n${SAM}  ,,`), [PERSON, SAM.toUpperCase()]);
  assert.equal(capText(LISTING.caps), '2 of 20 alerts in this App. You set up 1 of your 10.');
  assert.equal(capped({ app: 20, person: 10, used: 20, mine: 0 }), true);
  assert.equal(capped({ app: 20, person: 10, used: 12, mine: 10 }), true);
  assert.equal(capped(LISTING.caps), false);
  assert.deepEqual([stateFlag('triggered').text, stateFlag('paused').text, stateFlag('weird').text], ['Firing', 'Paused', 'Not checked yet']);
  assert.equal(withNotice('Saved.', { notice: `${SAM} gets an email about it within the hour.` }), `Saved. ${SAM} gets an email about it within the hour.`);
  assert.equal(withNotice('Saved.', { written: [] }), 'Saved.');
  const fmt = (v) => String(v);
  assert.equal(previewText({ value: 14, fires: true, basis: 'fixed', history_runs: null }, fmt), 'Now: 14. It would send an email.');
  assert.equal(previewText({ value: 3, fires: false, basis: 'fixed', history_runs: 2 }, fmt),
    'Now: 3. It would not send an email. There are 2 earlier runs, so it uses your number until 5 exist.');
  assert.equal(previewText({ value: null, fires: false, basis: 'baseline', threshold: 9, history_runs: 7 }, fmt),
    'Now: no value. It would not send an email. The line is 9, from 7 earlier runs.');
  for (const text of [ruleText(MINE.watch, MEASURES), operatorLabel('<', 'baseline'), capText(LISTING.caps), previewText({ value: 1, fires: true, basis: 'baseline', threshold: 1, history_runs: 6 }, fmt)]) {
    assert.doesNotMatch(text, /[\u2013\u2014]/);
  }
});

test('the preview says how the value moved since the previous run, or that there is no earlier run, in the tile words', () => {
  const fmt = (v) => String(v);
  assert.equal(previewText({ ...SHOWN, value: 9, fires: false, basis: 'fixed', history_runs: 0, previous: null }, fmt),
    `Now: 9. ${words.none}. It would not send an email. There are 0 earlier runs, so it uses your number until 5 exist.`);
  assert.equal(previewText({ ...SHOWN, value: 75.7, fires: false, basis: 'baseline', threshold: 80, history_runs: 8, previous: 73.5 }, fmt),
    `Now: 75.7, up 3.0% ${vs}. It would not send an email. The line is 80, from 8 earlier runs.`);
  assert.equal(previewText({ ...SHOWN, value: 4, fires: true, basis: 'baseline', threshold: 1, history_runs: 6, previous: 0 }, fmt),
    `Now: 4, up ${words.from_zero} ${vs}. It would send an email. The line is 1, from 6 earlier runs.`);
  assert.equal(previewText({ ...SHOWN, value: 250.0000001, fires: false, basis: 'baseline', threshold: 300, history_runs: 6, previous: 250 }, fmt),
    `Now: 250.0000001, ${words.same} ${vs}. It would not send an email. The line is 300, from 6 earlier runs.`);
  assert.equal(previewText({ ...SHOWN, value: null, fires: false, basis: 'baseline', threshold: 9, history_runs: 7, previous: 3 }, fmt),
    'Now: no value. It would not send an email. The line is 9, from 7 earlier runs.');
});

test('the form keeps only filters that reach what it watches and refuses what cannot be sent', () => {
  const form = { ...blankForm(LISTING, { email: PERSON }), filters: { category: ['Books'], channel: ['Store'], region: ['North'] }, threshold: '3' };
  assert.deepEqual(form.emails, PERSON);
  assert.deepEqual(watchOf(LISTING, form), { what: 'records', filters: { category: ['Books'], channel: ['Store'] }, operator: '>=', threshold: 3, basis: 'fixed' });
  assert.deepEqual(watchOf(LISTING, { ...form, basis: 'baseline' }).filters, { category: ['Books'] }, 'earlier runs filter only on what they carry');
  assert.equal(defaultName(LISTING, form), 'Records on the list is at least 3');
  assert.equal(formProblem(LISTING, form), '');
  assert.equal(formProblem(LISTING, { ...form, threshold: '' }), 'Type the number to compare with.');
  assert.equal(formProblem(LISTING, { ...form, threshold: 'abc' }), 'Type the number to compare with.');
  assert.equal(formProblem(LISTING, { ...form, emails: ' , ' }), 'Add at least one email address.');
  assert.equal(formProblem(LISTING, { ...form, basis: 'baseline', operator: '=' }), 'Pick how to compare.');
  assert.equal(formProblem(LISTING, { ...form, what: 'gone' }), 'Pick what to watch.');
  assert.deepEqual(formFrom(MINE), { id: '9001', name: 'Books pile up', what: 'records', filters: { category: ['Books'] }, operator: '>=', threshold: '5',
    basis: 'fixed', schedule: 'daily', emails: PERSON, paused: false, notify: true });
  assert.equal(blankForm(LISTING, { email: PERSON }).notify, true, 'a new alert emails again when it clears unless the person says otherwise');
  assert.equal(formFrom({ ...MINE, notify_on_ok: false }).notify, false);
  assert.equal(formFrom({ ...MINE, watch: { ...MINE.watch, threshold: 1234.5678 } }).threshold, '1234.5678');
});

test('the Alerts tab lists each alert with its state, last check, schedule and owner, and only its owner can change it', async () => {
  const { calls, routes } = alertRoutes();
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await until(() => calls.lists === 1);
  await page.locator('.alerts-tbl tbody tr').nth(2).waitFor();
  const rows = await page.locator('.alerts-tbl tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 5).map((td) => td.innerText.trim())));
  assert.deepEqual(rows, [
    ['Books pile up\nRecords on the list is at least 5 (Category: Books)', 'Firing', stampText(MINE.checked, NOW), 'Every day at 08:00 UTC', `${PERSON}\n1 person`],
    ['Loss jumps\nTotal loss is above 250,000', 'OK', stampText(MINE.checked, NOW), 'Every day at 08:00 UTC', `${SAM}\n3 people`],
    [`Assigned to ${PERSON}\nEmails ${PERSON} when records are assigned to them`, 'Paused', 'Not yet', 'Every hour', 'The App\n1 person'],
  ]);
  assert.equal(await page.getByRole('button', { name: 'Change Books pile up' }).count(), 1);
  assert.equal(await page.locator('.alerts-tbl td.act').getByRole('button', { name: /Loss jumps$/ }).count(), 0, 'someone else\u2019s alert offers no buttons to change it');
  assert.equal(await page.getByRole('button', { name: `Change Assigned to ${PERSON}` }).count(), 0, 'an assignment email is paused or deleted, never edited');
  assert.equal(await page.getByRole('button', { name: `Resume Assigned to ${PERSON}` }).count(), 1);
  assert.equal(await page.locator('.alerts-foot').innerText(),
    '2 of 20 alerts in this App. You set up 1 of your 10. The alert set up when the App was built opens in Databricks; the App does not change it.');
  assert.equal(await page.locator('.alerts-foot a').getAttribute('href'), BUILT);
  assert.equal(await page.locator('.fbar').count(), 0, 'alerts carry their own filters, so the page filter bar is hidden');
  assert.doesNotMatch(await page.locator('section.alerts').innerText(), /[\u2013\u2014]/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('every alert and the Alerts card show a visible Ask Genie, and an alert sends Genie what it checks, its state and its owner', async () => {
  const { routes } = alertRoutes();
  const explained = [];
  routes['genie/explain'] = ({ route, json }) => { explained.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1', question: 'Sent.' }); };
  routes['genie/message'] = ({ json }) => json(200, { state: 'done', text: 'Genie answered.', sql: 'SELECT 1', columns: [], rows: [], truncated: false });
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await page.locator('.alerts-tbl tbody tr').nth(2).waitFor();
  const found = await page.evaluate(askAudit, { card: 'section.card--table', row: '.alerts-tbl tbody tr' });
  assert.deepEqual([found.missing, found.hidden, found.counts], [[], [], { card: 1, row: 3 }]);
  await page.getByRole('button', { name: 'Ask Genie about Loss jumps', exact: true }).click();
  await page.getByLabel('Your question about Loss jumps').fill('Why is it OK?');
  await page.locator('form.ask-box button[type="submit"]').click();
  await until(() => explained.length === 1);
  const sent = explained[0];
  assert.deepEqual([sent.kind, sent.page, sent.title, sent.context.hint], ['record', 'n01_u05', 'Loss jumps', 'An alert of this use case.']);
  assert.deepEqual([sent.context.fields.Alert, sent.context.fields.State, sent.context.fields['What it checks']], ['Loss jumps', 'OK', 'Total loss is above 250,000']);
  await page.getByRole('button', { name: 'Ask Genie about Alerts', exact: true }).click();
  assert.match(await page.locator('form.ask-box [data-receives]').innerText(), /3 rows/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a new alert picks what to watch, its segments, a number or earlier runs, a schedule and emails, checks the value now, then saves', async () => {
  const { calls, routes } = alertRoutes();
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await page.getByRole('button', { name: 'New alert' }).click();
  const form = page.getByRole('form', { name: 'New alert' });
  assert.equal(await form.getByLabel('Email addresses').inputValue(), PERSON, 'the signed-in person is the first recipient');
  assert.deepEqual(await form.locator('.alert-opts legend').allInnerTexts(), ['Category', 'Channel']);
  await form.locator('.alert-opts').nth(0).getByLabel('Books').check();
  await form.locator('.alert-opts').nth(1).getByLabel('Store').check();
  await form.getByLabel('How to compare').selectOption('>');
  await form.getByLabel('Number', { exact: true }).fill('12');
  await form.getByLabel('Check it').selectOption('weekly');
  await form.getByLabel('Email addresses').fill(`${PERSON}, ${SAM}`);
  await form.getByRole('button', { name: 'Check the value now' }).click();
  await form.locator('.alert-preview').waitFor();
  assert.deepEqual(calls.previews[0], { page: 'n01_u05', watch: { what: 'records', filters: { category: ['Books'], channel: ['Store'] }, operator: '>', threshold: 12, basis: 'fixed' } });
  assert.equal(await form.locator('.alert-preview').innerText(), 'Now: 14. It would send an email.');
  await form.getByLabel('Earlier runs').check();
  assert.deepEqual(await form.locator('.alert-opts legend').allInnerTexts(), ['Category'], 'earlier runs filter only on what they carry');
  assert.equal(await form.locator('.alert-preview').count(), 0, 'a change clears the old preview');
  await form.getByRole('button', { name: 'Check the value now' }).click();
  await until(() => calls.previews.length === 2);
  await page.waitForFunction(() => /line is 20\.5/.test(document.querySelector('.alert-preview')?.textContent || ''));
  assert.equal(await form.locator('.alert-preview').innerText(), 'Now: 14. It would not send an email. The line is 20.5, from 12 earlier runs.');
  const lists = calls.lists;
  await form.getByRole('button', { name: 'Set up the alert' }).click();
  await until(() => calls.saves.length === 1);
  assert.deepEqual(calls.saves[0], { page: 'n01_u05', name: 'Records on the list rises above the usual range of earlier runs',
    watch: { what: 'records', filters: { category: ['Books'] }, operator: '>', threshold: 12, basis: 'baseline' }, schedule: 'weekly', emails: [PERSON, SAM], paused: false,
    notify_on_ok: true });
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast').innerText(), 'Alert set up. It checks on its schedule.');
  await until(() => calls.lists > lists);
  assert.equal(await page.getByRole('form', { name: 'New alert' }).count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a measure without earlier runs says why, and a refused save shows the reason in the form', async () => {
  const refused = 'zz@example.com is not a user of this workspace; alerts go only to workspace users';
  const { calls, routes } = alertRoutes(LISTING, { 'alerts/save': ({ route, json }) => { calls.saves.push(route.request().postDataJSON()); return json(400, { error: refused }); } });
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await page.getByRole('button', { name: 'New alert' }).click();
  const form = page.getByRole('form', { name: 'New alert' });
  await form.getByLabel('What to watch').selectOption('total_loss');
  assert.equal(await form.getByLabel('Earlier runs').isDisabled(), true);
  assert.equal(await form.locator('.alert-basis small').innerText(), 'Earlier runs are not available: earlier runs do not carry what this measure reads.');
  const save = form.getByRole('button', { name: 'Set up the alert' });
  assert.equal(await save.isDisabled(), true, 'no number yet');
  assert.equal(await form.locator('.hint').innerText(), 'Type the number to compare with.');
  await form.getByLabel('Number', { exact: true }).fill('100');
  await form.getByLabel('Email addresses').fill('zz@example.com');
  await save.click();
  await form.locator('.tile-err').waitFor();
  assert.equal(await form.locator('.tile-err').innerText(), refused);
  assert.equal(calls.saves[0].watch.what, 'total_loss');
  assert.deepEqual(seen.errors.filter((e) => !/400/.test(e)), []);
  await context.close();
});

test('the owner changes, pauses and deletes an alert, and a full App offers no new alert', async () => {
  const { calls, routes } = alertRoutes();
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await page.getByRole('button', { name: 'Change Books pile up' }).click();
  const form = page.getByRole('form', { name: 'Change the alert' });
  assert.equal(await form.getByLabel('Name').inputValue(), 'Books pile up');
  assert.equal(await form.getByLabel('Number', { exact: true }).inputValue(), '5');
  assert.equal(await form.locator('.alert-opts').nth(0).getByLabel('Books').isChecked(), true);
  await form.getByLabel('Number', { exact: true }).fill('6');
  await form.getByRole('button', { name: 'Save the alert' }).click();
  await until(() => calls.saves.length === 1);
  assert.equal(calls.saves[0].id, '9001');
  assert.equal(calls.saves[0].watch.threshold, 6);
  assert.equal(calls.saves[0].notify_on_ok, true);
  await page.getByRole('button', { name: 'Pause Books pile up' }).click();
  await until(() => calls.pauses.length === 1);
  assert.deepEqual(calls.pauses[0], { id: '9001', paused: true });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete Books pile up' }).click();
  await until(() => calls.deletes.length === 1);
  assert.deepEqual(calls.deletes[0], { id: '9001' });
  await context.close();
  const full = alertRoutes({ ...LISTING, caps: { app: 20, person: 10, used: 20, mine: 3 } });
  const second = await open(appInfo(ON, 1, TABLE), full.routes);
  await alertsTab(second.page);
  await second.page.getByRole('button', { name: 'New alert' }).waitFor();
  assert.equal(await second.page.getByRole('button', { name: 'New alert' }).isDisabled(), true);
  assert.deepEqual([...seen.errors, ...second.seen.errors], []);
  await second.context.close();
});

test('Notify me opens the alerts when alerts are on, Back returns to Things to fix, and an App without alerts shows no Notify me', async () => {
  const { routes } = alertRoutes();
  const { page, context } = await open(appInfo(ON, 1, TABLE), routes);
  await page.goto(`${served.base}#/n01_u05`);
  await page.getByRole('button', { name: 'Notify me' }).click();
  await page.locator('section.alerts').waitFor();
  assert.match(new URL(page.url()).hash, /[?&]v=alerts/);
  await page.getByRole('button', { name: 'Back to things to fix' }).click();
  await page.locator('section.alerts').waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).hash, '#/n01_u05');
  await context.close();
  const off = await open(appInfo({}, 1, TABLE), {});
  await off.page.goto(`${served.base}#/n01_u05?v=alerts`);
  await off.page.locator('.top-runs').waitFor();
  await off.page.waitForFunction(() => location.hash === '#/n01_u05');
  assert.equal(await off.page.locator('section.alerts').count(), 0, 'an App built without alerts opens no alerts, even from an old link');
  assert.equal(await off.page.getByRole('button', { name: 'Notify me' }).count(), 0);
  await off.context.close();
});

test('Notify me opens a new alert ready to fill in, a link to the alerts alone does not, and a full App opens none (must-exclude)', async () => {
  const empty = alertRoutes({ ...LISTING, alerts: [], caps: { ...LISTING.caps, used: 0, mine: 0 } });
  const { page, context, seen } = await open(appInfo(ON, 1, TABLE), empty.routes);
  await page.goto(`${served.base}#/n01_u05`);
  await page.getByRole('button', { name: 'Notify me' }).click();
  const form = page.getByRole('form', { name: 'New alert' });
  await form.waitFor();
  assert.equal(await page.getByText('No alerts on this page yet.').count(), 0, 'the person lands on the form, not on an empty list');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await page.getByText('No alerts on this page yet.').waitFor();
  await page.goto(`${served.base}#/n01_u05?v=alerts`);
  await page.reload();
  await page.getByText('No alerts on this page yet.').waitFor();
  assert.equal(await form.count(), 0, 'opening the alerts from a link shows the list');
  await page.getByRole('button', { name: 'Notify me' }).click();
  await form.waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
  const full = alertRoutes({ ...LISTING, caps: { app: 2, person: 10, used: 2, mine: 1 } });
  const capped = await open(appInfo(ON, 1, TABLE), full.routes);
  await capped.page.goto(`${served.base}#/n01_u05`);
  await capped.page.getByRole('button', { name: 'Notify me' }).click();
  await capped.page.getByRole('table', { name: 'Alerts of this use case' }).waitFor();
  assert.equal(await capped.page.getByRole('form', { name: 'New alert' }).count(), 0, 'no form opens when the App already holds its most alerts');
  assert.deepEqual(capped.seen.errors, []);
  await capped.context.close();
});

test('an App where each person signs in as themselves shows no Alerts tab and no Notify me, and never asks for alerts', async () => {
  const { calls, routes } = alertRoutes();
  const tracked = { visible: true, tracked: true, money: false, categories: [], served: 'delta', items: [], total: 0, truncated: false, done: {},
    weeks: [], runs: { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false } };
  routes.overview = ({ json }) => json(200, { today: '2026-10-27', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: tracked } });
  const info = appInfo({ auth: 'user', alerts: { n01_u05: BUILT } }, 1, TABLE);
  assert.equal(info.alerting.on, false);
  assert.match(info.alerting.reason, /^This App shows each person only their own data, so it sends no alerts/, 'the server still says why, for the 409 it answers');
  assert.equal(info.alerts.n01_u05, BUILT, 'the alert set up at build is there, so only the per-person rule keeps Notify me away');
  const { page, seen, context } = await open(info, routes);
  await page.goto(`${served.base}#/n01_u05?v=alerts`);
  await page.locator('.kpi-l', { hasText: 'To fix' }).waitFor();
  assert.equal(await page.locator('section.alerts').count(), 0);
  assert.equal(await page.locator('[role="tab"]').count(), 0);
  assert.equal(await page.getByText('Notify me').count(), 0, 'neither the Alerts button nor the link to the built alert');
  await page.locator('.top-runs').click();
  await page.locator('section.runs').waitFor();
  assert.equal(await page.getByText('Notify me').count(), 0);
  assert.equal(await page.locator('section.alerts').count(), 0);
  assert.equal(calls.lists, 0, 'the App never lists alerts it cannot send');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('assigning records tells the person who assigned them that the owner gets an email', async () => {
  const notice = `${SAM} gets an email about it within the hour.`;
  const rows = pageData({}).records.rows.map((r, i) => ({ ...r, record_key: r.entity_id, _inspire_key: r.entity_id, _inspire_version: String(100 + i),
    _inspire_owner: null, _inspire_status: null }));
  const acts = [];
  const routes = {
    ...alertRoutes().routes,
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      return json(200, { rows: rows.slice(body.offset, body.offset + body.limit), total: rows.length, offset: body.offset, limit: body.limit, actions: true,
        changes: false, summary: { open: 0, done: 0, resolved: 0, owners: [] }, errors: {} });
    },
    'records/act': ({ route, json }) => { const body = actBody(route); acts.push(body); return json(200, { written: body.record_keys, conflicts: [], notice }); },
  };
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody input[type="checkbox"]').length === 25);
  await page.getByRole('checkbox', { name: 'Select Item number 1 with a long descriptive name' }).check();
  await page.getByRole('button', { name: 'Assign to…' }).click();
  await page.locator('input[name="bulk_owner"]').fill(SAM);
  await page.getByRole('button', { name: 'Assign 1 record' }).click();
  await until(() => acts.length === 1);
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast .toast-t').innerText(), `1 record given to ${SAM}. ${notice}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the person can turn off the email an alert sends when it clears, and an edit keeps what they chose', async () => {
  const quiet = { ...MINE, notify_on_ok: false };
  const { calls, routes } = alertRoutes({ ...LISTING, alerts: [quiet, THEIRS, NOTICE] });
  const { page, seen, context } = await open(appInfo(ON, 1, TABLE), routes);
  await alertsTab(page);
  await page.getByRole('button', { name: 'New alert' }).click();
  const form = page.getByRole('form', { name: 'New alert' });
  const clears = form.getByLabel('Email again when it clears');
  assert.equal(await clears.isChecked(), true, 'on by default, so the owner hears when the number recovers');
  await clears.uncheck();
  await form.getByLabel('Number', { exact: true }).fill('3');
  await form.getByRole('button', { name: 'Set up the alert' }).click();
  await until(() => calls.saves.length === 1);
  assert.equal(calls.saves[0].notify_on_ok, false);
  await page.getByRole('button', { name: 'Change Books pile up' }).click();
  const edit = page.getByRole('form', { name: 'Change the alert' });
  assert.equal(await edit.getByLabel('Email again when it clears').isChecked(), false, 'the edit form shows what the alert does now');
  await edit.getByRole('button', { name: 'Save the alert' }).click();
  await until(() => calls.saves.length === 2);
  assert.equal(calls.saves[1].notify_on_ok, false);
  assert.doesNotMatch(await edit.innerText().catch(() => ''), /[\u2013\u2014]/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
