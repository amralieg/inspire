import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist, toastSays, until } from './harness.mjs';
import { CUSTOM_SQL_REFUSED, groupsOf, historyLines, inputText, settingProblem, storedText, valueText } from '../src/settings.js';
import { dayLabel } from '../src/format.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'fixtures', 'implement_change_classes.json');
const OWNER = ['owner', 'example.com'].join('@');

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const BASE = { low: null, high: null, whole: false, low_open: false, high_open: false, choices: [], many: false, unit: '', reason: "Inspire's default",
  help: 'What it does.', applies: 'run', source: 'widget', editable: true };
const SETTINGS = [
  { ...BASE, name: 'PRICE', label: 'Price', group: 'impact', kind: 'money', unit: 'USD', low: 0, allowed: 'at least 0', default: '20', value: '20',
    source: 'assumption', applies: 'app_and_run' },
  { ...BASE, name: 'act_now_amount', label: 'Money at stake to act now', group: 'flagging', kind: 'money', unit: 'USD', low: 0, allowed: 'at least 0',
    default: '800', value: '800' },
  { ...BASE, name: 'act_now_share', label: 'Share of rows to act on now', group: 'flagging', kind: 'percent', unit: '%', low: 0, high: 1,
    allowed: '0 to 1', default: '0.05', value: '0.05' },
  { ...BASE, name: 'lookback_days', label: 'Days of history', group: 'scope', kind: 'days', unit: 'days', low: 1, high: 365, whole: true,
    allowed: 'whole number, 1 to 365', default: '90', value: '90' },
  { ...BASE, name: 'alert_threshold', label: 'Alert threshold', group: 'alerts', kind: 'number', low: 0, allowed: 'at least 0', default: '0', value: '0',
    source: 'alert', applies: 'alert', editable: false },
];
const VIEW = { settings: SETTINGS, history: [], editable: true, why: '', can_run: true, job: true };

test('the App checks a setting exactly as the run and the server do', () => {
  for (const c of JSON.parse(readFileSync(FIXTURE, 'utf8')).setting_values) {
    assert.equal(settingProblem(c.setting, c.value), c.problem, JSON.stringify(c));
  }
  const groupBy = { name: 'group_by', kind: 'choice', many: true, choices: ['region', 'custom'], solo: ['all'] };
  assert.equal(settingProblem(groupBy, 'region, Custom'), `group_by is 'region, Custom': ${CUSTOM_SQL_REFUSED}`, 'custom is refused even when Genie lists it');
  assert.equal(settingProblem({ name: 'run_scope', kind: 'choice', choices: ['all', 'custom'] }, 'custom'), `run_scope is 'custom': ${CUSTOM_SQL_REFUSED}`);
  assert.equal(settingProblem({ name: 'group_sql', kind: 'text' }, 'SELECT 1'), `group_sql: ${CUSTOM_SQL_REFUSED}`);
  assert.equal(settingProblem(groupBy, 'region'), '', 'a column grouping is kept');
  assert.equal(settingProblem({ name: 'group_sql', kind: 'text', optional: true }, ''), '', 'an empty SQL setting carries no SQL');
  const share = SETTINGS[2];
  assert.equal(inputText(share, '0.05'), '5', 'a share is typed as a percent');
  assert.equal(storedText(share, '12.5'), '0.125');
  assert.equal(settingProblem(share, storedText(share, '150')), "act_now_share is '1.5'; allowed: 0 to 1");
  assert.equal(valueText(share, '0.05'), '5%');
  assert.equal(valueText(SETTINGS[1], '1200'), '1,200 USD');
  assert.equal(valueText({ kind: 'choice', many: true }, 'all'), 'every segment');
  assert.deepEqual(groupsOf(SETTINGS).map(([id, , list]) => [id, list.length]), [['impact', 1], ['flagging', 2], ['scope', 1], ['alerts', 1]]);
  assert.deepEqual(historyLines([{ name: 'act_now_amount', value: 1000, changed_by: OWNER, changed_at: '2026-10-28T09:00:00Z', note: 'busy' },
    { name: 'act_now_amount', value: 800, changed_by: OWNER, changed_at: '2026-10-20T09:00:00Z', note: '' }], SETTINGS)[0],
  `${dayLabel('2026-10-28')}, ${OWNER} set Money at stake to act now from 800 USD to 1,000 USD: busy`);
});

function routes(seen) {
  const state = { view: VIEW };
  return {
    settings: ({ json }) => json(200, state.view),
    'settings/preview': ({ route, json }) => {
      (seen.previews ||= []).push(route.request().postDataJSON());
      return json(200, { exact: true, moves: [{ from: 'Act now', to: 'Review', n: 41 }], text: 'If the next run used this value, 41 records from Act now to Review would move.' });
    },
    'settings/save': ({ route, json }) => {
      const body = route.request().postDataJSON();
      (seen.saves ||= []).push(body);
      state.view = { ...state.view, settings: SETTINGS.map((s) => (s.name === body.name ? { ...s, value: body.value } : s)),
        history: [{ name: body.name, value: Number(body.value), changed_by: OWNER, changed_at: '2026-10-30T09:00:00Z', note: body.note }] };
      return json(200, state.view);
    },
    'settings/run': ({ route, json }) => { (seen.runs ||= []).push(route.request().postDataJSON()); return json(200, { run_id: '9000', state: 'queued' }); },
  };
}

test('an owner changes a cutoff with a live preview and a note, and starts a run', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: routes(seen) });
  await page.click('[data-settings-open]');
  await page.waitForSelector('[data-settings]');
  assert.deepEqual(await page.$$eval('[data-settings] [data-group]', (els) => els.map((e) => e.dataset.group)), ['my_view', 'impact', 'flagging', 'scope', 'alerts']);
  assert.match(await page.locator('[data-setting="alert_threshold"]').innerText(), /Change it on the Build page of the Inspire App/);
  await page.click('[data-setting="act_now_amount"] button');
  const input = page.locator('input[name="setting_act_now_amount"]');
  await input.fill('-3');
  await page.waitForSelector('[data-setting="act_now_amount"] .err');
  assert.equal(await page.locator('[data-setting="act_now_amount"] button[type="submit"]').isDisabled(), true, 'an out-of-bounds value cannot be saved');
  await input.fill('1000');
  await page.waitForSelector('[data-preview]');
  assert.equal(await page.locator('[data-preview]').innerText(), 'If the next run used this value, 41 records from Act now to Review would move.');
  await page.fill('input[name="setting_note"]', 'busier quarter');
  await page.click('[data-setting="act_now_amount"] button[type="submit"]');
  await toastSays(page, 'Money at stake to act now is 1,000 USD now. The next run uses it.');
  assert.deepEqual(seen.saves, [{ page: 'n01_u05', name: 'act_now_amount', value: '1000', was: '800', note: 'busier quarter' }]);
  assert.deepEqual(seen.previews.at(-1), { page: 'n01_u05', name: 'act_now_amount', value: '1000' });
  assert.match(await page.locator('[data-settings] .hist').innerText(), /set Money at stake to act now to 1,000 USD: busier quarter/);
  await page.click('[data-setting="act_now_share"] button');
  await page.fill('input[name="setting_act_now_share"]', '10');
  await page.click('[data-setting="act_now_share"] button[type="submit"]');
  await until(() => (seen.saves || []).length === 2);
  assert.equal(seen.saves[1].value, '0.1', 'a percent typed as 10 is saved as the share 0.1');
  await page.click('[data-run-now]');
  await toastSays(page, 'The run is queued; the page shows its progress at the top.');
  assert.deepEqual(seen.runs, [{ page: 'n01_u05' }]);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a viewer who is not an owner gets Settings with only their own My view, and no use-case setting or Run now', async () => {
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE));
  await page.waitForSelector('.top-page [data-settings-open]');
  assert.equal(await page.locator('[data-settings]').count(), 0);
  await page.click('[data-settings-open]');
  await page.waitForSelector('[data-settings]');
  assert.deepEqual(await page.$$eval('[data-settings] [data-group]', (els) => els.map((e) => e.dataset.group)), ['my_view']);
  assert.equal(await page.locator('[data-settings] [data-setting]').count(), 0);
  assert.equal(await page.locator('[data-run-now]').count(), 0);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('an owner changes the alert threshold when the alert reads the App settings', async () => {
  const seen = {};
  const editable = SETTINGS.map((x) => (x.name === 'alert_threshold' ? { ...x, editable: true, reads_setting: true } : x));
  const r = routes(seen);
  const state = { view: { ...VIEW, settings: editable } };
  r.settings = ({ json }) => json(200, state.view);
  const { page, seen: app, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: r });
  await page.click('[data-settings-open]');
  await page.waitForSelector('[data-settings]');
  assert.doesNotMatch(await page.locator('[data-setting="alert_threshold"]').innerText(), /Build page/);
  await page.click('[data-setting="alert_threshold"] button');
  await page.fill('input[name="setting_alert_threshold"]', '-1');
  await page.waitForSelector('[data-setting="alert_threshold"] .err');
  await page.fill('input[name="setting_alert_threshold"]', '5');
  await page.fill('input[name="setting_note"]', 'fewer emails');
  await page.click('[data-setting="alert_threshold"] button[type="submit"]');
  await until(() => (seen.saves || []).length === 1);
  assert.deepEqual(seen.saves, [{ page: 'n01_u05', name: 'alert_threshold', value: '5', was: '0', note: 'fewer emails' }]);
  assert.deepEqual(app.errors, []);
  await context.close();
});
