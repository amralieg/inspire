import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { SETTINGS_TECHNICAL_NOTE } from '../../src/lib/useCaseSettings.js';
import { wheelScrolls } from './wheelScroll.mjs';
import { closeBrowser, lowContrast, onStep, openAsset, openBuild, openUi, setDark, settled, toVibes, until, wizardFits, goToStep, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const PERSON = 'person-token';
const APP_URL = 'https://churn-desk-1.aws.databricksapps.com';
const MODEL = [
  { name: 'WEEKS_LEFT', label: 'Weeks left', group: 'impact', kind: 'number', low: 1, high: 52, allowed: '1 to 52', source: 'assumption', default: 12, unit: '',
    reason: 'the value the notebook defines', help: 'An assumption of the money at stake formula.', applies: 'app_and_run' },
  { name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.05', unit: '%',
    reason: "Inspire's default: the top 5% of the records that pass the decision test are Act now and the next 15% Review",
    help: 'The share of the records that pass the decision test, the highest ranked, that are Act now.', applies: 'run' },
  { name: 'review_share', label: 'Review share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.15', unit: '%',
    reason: "Inspire's default", help: 'The share of those records, the next ones by rank, that are Review.', applies: 'run' },
  { name: 'alert_threshold', label: 'Alert threshold', group: 'alerts', kind: 'number', low: 0, high: null, allowed: 'at least 0', source: 'alert', default: '1',
    unit: 'records', reads_setting: true, reason: 'set when the use case was built', help: 'The alert emails when the number of act now records is >= this.', applies: 'alert' },
];
const WIDGETS = [{ name: 'act_now_share', type: 'text', default: '0.05', allowed: '0 to 1' }, { name: 'review_share', type: 'text', default: '0.15', allowed: '0 to 1' }];
const withModel = (model = MODEL) => {
  const row = built();
  return { ...row, notebook_path: '/W/impl/N01-U01', genie_widgets: JSON.stringify(WIDGETS), asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), notebook: { state: 'ready', spec_version: 1, result_history: 1 }, settings: model }) };
};
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

async function toStep(page, label) {
  for (let i = 0; i < 9 && await page.locator('[aria-current="step"]', { hasText: label }).count() === 0; i += 1) {
    const from = await page.locator('[aria-current="step"]').innerText();
    await next(page);
    await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 15000 });
  }
  await onStep(page, label);
}

const settingRow = (page, name) => page.locator(`[data-setting="${name}"]`);

test('all settings has a Settings step with the settings the built notebook reads, their ranges, and the agent\u2019s refusal; the values go where the agent reads them and rebuild nothing', async () => {
  const ui = await openUi('wizard', { me: ME, history: [withModel()] });
  const { page, made } = ui;
  try {
    await toStep(page, 'Settings');
    const step = page.getByRole('region', { name: 'Use case settings', exact: true });
    await step.waitFor();
    assert.deepEqual(await step.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.dataset.setting)), ['WEEKS_LEFT', 'act_now_share', 'review_share', 'alert_threshold']);
    assert.deepEqual(await step.locator('[data-setting-group]').evaluateAll((g) => g.map((x) => x.querySelector('h4').textContent)),
      ['How the money at stake is counted', 'How records are flagged', 'Alerts']);
    assert.equal(await settingRow(page, 'WEEKS_LEFT').getByRole('textbox', { name: 'Weeks left' }).inputValue(), '12');
    assert.equal(await settingRow(page, 'WEEKS_LEFT').locator('[data-setting-allowed]').textContent(), 'Allowed: 1 to 52');
    assert.deepEqual(await step.locator('[data-setting-group]').evaluateAll((g) => g.map((x) => x.querySelector('[data-setting-group-change]')?.textContent || '')),
      ['Saved as a setting, no rebuild', 'Saved as a setting, no rebuild', 'Rebuilds the alert']);
    assert.equal(await step.locator('[data-setting-change]').count(), 0, 'a group whose settings change the same way says it once');
    await settingRow(page, 'WEEKS_LEFT').getByRole('textbox', { name: 'Weeks left' }).fill('60');
    await settingRow(page, 'WEEKS_LEFT').getByText("WEEKS_LEFT is '60'; allowed: 1 to 52", { exact: true }).waitFor();
    await next(page);
    await page.getByRole('alert').filter({ hasText: "WEEKS_LEFT is '60'; allowed: 1 to 52" }).waitFor();
    await onStep(page, 'Settings');
    await settingRow(page, 'WEEKS_LEFT').getByRole('textbox', { name: 'Weeks left' }).fill('20');
    await settingRow(page, 'act_now_share').getByRole('textbox', { name: 'Act now share' }).fill('0.1');
    assert.equal(await step.locator('[data-setting-problem]').count(), 0);
    const note = step.getByRole('textbox', { name: 'Note for the settings change', exact: true });
    assert.equal(await note.inputValue(), '', 'each change starts with no note');
    await note.fill('  more to act on this quarter  ');
    const contrast = await lowContrast(page, ['[aria-label="Use case settings"]']);
    assert.ok(contrast.checked >= 12, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await goToStep(page, 'Vibes');
    await toSummary(page);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 15000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the settings version');
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.config.widgets.act_now_share, sent.config.assumptions, sent.config.settings_note], ['0.1', { WEEKS_LEFT: 20 }, 'more to act on this quarter'],
      'the note goes with the settings, for the agent to save in place of its own');
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    const classes = insert.parameters.find((p) => p.name === 'classes').value.split(',');
    assert.ok(classes.includes('settings') && !classes.includes('config') && !classes.includes('data'), `a settings change, never a rebuild: ${classes.join(',')}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a first build lists the instruction\u2019s widgets as settings with their ranges, says the assumptions come with the first run, and the Data step no longer repeats them', async () => {
  const instruction = '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n'
    + '| `act_now_share` | text | 0.05 | 0 to 1 | Act now share |\n| `top_k` | text | 25 | whole number, at least 1 | Top K |\n| `model_name` | text | m | | Model |\n';
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: instruction } });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    await goToStep(page, 'Data');
    await page.getByRole('button', { name: /Advanced/ }).first().click();
    await page.getByText('The rules that flag records and the use case\u2019s own settings are on the Settings step.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: /Top K/ }).count(), 0, 'top_k is a setting, so the Data step does not edit it');
    await toStep(page, 'Settings');
    const step = page.getByRole('region', { name: 'Use case settings', exact: true });
    assert.deepEqual(await step.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.dataset.setting)), ['act_now_share'],
      'top_k and model_name are technical, so they keep the values Genie declared and the wizard does not ask them');
    assert.equal(await page.locator('[data-settings-technical]').textContent(), SETTINGS_TECHNICAL_NOTE);
    await step.getByText('Genie proposes the assumptions of what is at stake on each record, with their lowest and highest values, when the notebook first runs; '
      + 'you set them here after that run.', { exact: true }).waitFor();
    assert.equal(await step.locator('[data-setting-change], [data-setting-group-change]').count(), 0, 'nothing is built yet, so nothing rebuilds');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a group whose settings change differently names the change on each row: a widget the built notebook does not read as a setting rebuilds it', async () => {
  const ui = await openUi('wizard', { me: ME, history: [withModel(MODEL.filter((s) => s.name !== 'review_share'))] });
  const { page } = ui;
  try {
    await toStep(page, 'Settings');
    const step = page.getByRole('region', { name: 'Use case settings', exact: true });
    await settingRow(page, 'review_share').waitFor();
    const flagging = step.locator('[data-setting-group="flagging"]');
    assert.equal(await flagging.locator('[data-setting-group-change]').count(), 0);
    assert.deepEqual(await flagging.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => [r.dataset.setting, r.querySelector('[data-setting-change]')?.textContent])),
      [['act_now_share', 'Saved as a setting, no rebuild'], ['review_share', 'Rebuilds the notebook']]);
    assert.equal(await step.locator('[data-setting-group="impact"] [data-setting-group-change]').textContent(), 'Saved as a setting, no rebuild');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const CONSTANTS = ['AVG_MONTHLY_REVENUE', 'RETENTION_OFFER_COST', 'GROSS_MARGIN_RATE', 'EXPECTED_RECOVERY_RATE_AFTER_OUTREACH', 'WEEKS_LEFT',
  'SERVICE_CALL_COST', 'CONTRACT_MONTHS_REMAINING', 'DISCOUNT_RATE'];
const assumptionRow = (name, at) => ({
  name, label: name.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), group: 'impact', kind: at % 3 === 2 ? 'percent' : 'money',
  low: 0, high: at % 3 === 2 ? 1 : 5000, allowed: at % 3 === 2 ? '0 to 1' : '0 to 5000', source: 'assumption', default: at % 3 === 2 ? 0.3 : 120 + at,
  unit: at % 3 === 2 ? '%' : 'USD', reason: 'the value the notebook defines', help: 'An assumption of the money at stake formula.', applies: 'app_and_run',
});
const widgetRow = (name, label, group, allowed, low, high, whole) => ({ name, label, group, kind: whole ? 'integer' : 'number', low, high, whole, allowed,
  source: 'widget', default: String(low), unit: '', reason: 'Genie Code chose it when it built the notebook', help: `${label}.`, applies: 'run' });
const fullModel = (assumptions) => [
  ...Array.from({ length: assumptions }, (_, at) => assumptionRow(at < CONSTANTS.length ? CONSTANTS[at] : `EXTRA_RATE_${at + 1}`, at)),
  MODEL[1], MODEL[2],
  widgetRow('alert_quantile', 'Alert quantile', 'flagging', '0 to 1', 0, 1, false),
  widgetRow('max_alerts_per_run', 'Most alerts per run', 'flagging', 'whole number, at least 1', 1, null, true),
  widgetRow('top_k', 'Top K', 'scope', 'whole number, at least 1', 1, null, true),
  widgetRow('lookback_days', 'Lookback days', 'scope', 'whole number, 1 to 365', 1, 365, true),
  widgetRow('min_tenure_months', 'Minimum tenure months', 'scope', 'whole number, at least 0', 0, null, true),
  widgetRow('min_orders', 'Minimum orders', 'scope', 'whole number, at least 1', 1, null, true),
  widgetRow('history_weeks', 'History weeks', 'scope', 'whole number, 4 to 104', 4, 104, true),
  widgetRow('max_rows_per_segment', 'Most rows per segment', 'scope', 'whole number, at least 1', 1, null, true),
  MODEL[3],
];

test('the Settings step fits 1440x900 with nothing to scroll at the most settings the agent builds, with every value refused too, and past that the list scrolls inside while the wizard never does', async () => {
  for (const [assumptions, listScrolls] of [[CONSTANTS.length, false], [30, true]]) {
    const ui = await openUi('wizard', { me: ME, history: [withModel(fullModel(assumptions))] });
    const { page } = ui;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await toStep(page, 'Settings');
      const step = page.getByRole('region', { name: 'Use case settings', exact: true });
      await step.locator('[data-setting="alert_threshold"]').waitFor({ state: 'attached' });
      assert.equal(await step.locator('[data-setting]').count(), assumptions + 5);
      assert.equal(await step.locator('[data-setting="top_k"], [data-setting="lookback_days"], [data-setting="history_weeks"]').count(), 0,
        'the technical settings keep the values Genie declared and are not asked');
      const where = `${assumptions} assumptions`;
      const fits = (what) => wizardFits(page, `${where}, ${what}`);
      const fit = await fits('as built');
      const list = await step.locator('[data-settings-list]').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
      console.log(`settings step at 1440x900 with ${where}: ${JSON.stringify({ body: [fit.scroll, fit.client], list: [list.scroll, list.client] })}`);
      assert.equal(list.scroll > list.client + 1, listScrolls, `${where}: the list ${listScrolls ? 'scrolls inside' : 'shows every setting'} ${JSON.stringify(list)}`);
      if (!listScrolls) {
        for (const dark of [false, true]) {
          await setDark(page, dark);
          const contrast = await lowContrast(page, ['[aria-label="Use case settings"]']);
          assert.ok(contrast.checked >= 40, `measured ${contrast.checked}`);
          assert.deepEqual(contrast.low, [], dark ? 'dark' : 'light');
        }
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        for (const name of CONSTANTS) await settingRow(page, name).getByRole('textbox').fill('-1');
        await settingRow(page, CONSTANTS[CONSTANTS.length - 1]).locator('[data-setting-problem]').waitFor();
        assert.equal(await step.locator('[data-setting-problem]').count(), CONSTANTS.length);
        await fits('every assumption refused');
      } else {
        const last = settingRow(page, 'EXTRA_RATE_30').getByRole('textbox');
        const list = step.locator('[data-settings-list]');
        await wheelScrolls(page, list, () => settingRow(page, 'EXTRA_RATE_30'), { name: 'Use case settings list' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await last.fill('7');
        assert.equal(await last.inputValue(), '7');
        await fits('the last setting typed in');
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('the step bar keeps all twelve steps on one line: at 1440x900 every step shows, and on a phone the bar scrolls so the current step is in view', async () => {
  const ui = await openUi('wizard', { me: ME });
  const { page } = ui;
  try {
    const bar = page.locator('[data-wizard-header] ol');
    const shown = () => bar.evaluate((ol) => {
      const box = ol.getBoundingClientRect();
      const current = ol.querySelector('[aria-current="step"]').getBoundingClientRect();
      return { overflow: ol.scrollWidth > ol.clientWidth + 1, rows: new Set([...ol.children].map((li) => Math.round(li.getBoundingClientRect().top))).size,
        inView: current.left >= box.left - 1 && current.right <= box.right + 1 };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await toVibes(page);
    assert.equal(await bar.locator('li').count(), 12);
    assert.deepEqual(await shown(), { overflow: false, rows: 1, inView: true }, 'every step on one line at 1440x900');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Settings');
    await settled(page, '[data-wizard-header] ol');
    assert.deepEqual(await shown(), { overflow: true, rows: 1, inView: true }, 'a phone keeps one line and scrolls the current step into view');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const VIEW = {
  settings: [
    { ...MODEL[0], value: '12', saved: false, editable: true },
    { ...MODEL[1], value: '0.08', saved: true, editable: true },
    { ...MODEL[2], value: '0.15', saved: false, editable: true },
  ],
  history: [{ name: 'act_now_share', value: 0.08, changed_by: OWNER, changed_at: '2026-10-29T09:00:00Z', note: 'more to act on', kind: 'percent' }],
  editable: true, why: '', can_run: true, job: true,
};

test('an owner changes a setting on the Build page through the App: a live preview of the tier moves, a note, the history, and Run now', async () => {
  const appApi = {
    'GET /api/settings': [VIEW],
    'POST /api/settings/preview': [{ exact: true, moves: [{ from: 'Review', to: 'Act now', n: 4 }], text: '4 records from Review to Act now.' }],
    'POST /api/settings/save': [{ ...VIEW, settings: [VIEW.settings[0], { ...VIEW.settings[1], value: '0.1' }, VIEW.settings[2]] }],
    'POST /api/settings/run': [{ ok: true, run_id: 12 }],
  };
  const ui = await openBuild({ history: [withModel()], forwardedToken: PERSON, appApi });
  const { page, made } = ui;
  try {
    const panel = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
    await panel.locator('[data-setting="act_now_share"]').waitFor({ timeout: 15000 });
    assert.equal(await panel.locator('[data-setting="act_now_share"] [data-setting-value]').textContent(), '8%');
    assert.equal(await panel.locator('[data-setting="act_now_share"] [data-setting-source]').textContent(), 'Saved by an owner');
    assert.deepEqual(await panel.getByRole('list', { name: 'Setting changes' }).getByRole('listitem').allTextContents(),
      [`${OWNER} set Act now share to 8%: more to act on`]);
    await panel.getByText('Stored results follow at the next run.', { exact: true }).waitFor();
    const input = panel.locator('[data-setting="act_now_share"]').getByRole('textbox', { name: 'Act now share' });
    await input.fill('0.1');
    await panel.locator('[data-setting-preview]').getByText('4 records from Review to Act now.', { exact: true }).waitFor({ timeout: 15000 });
    await panel.getByRole('textbox', { name: 'Note for the change' }).fill('more to act on');
    await panel.getByRole('button', { name: 'Save Act now share', exact: true }).click();
    await until(() => made.appCalls.some((c) => c.url.endsWith('/api/settings/save')), 'the save');
    await panel.locator('[data-setting="act_now_share"] [data-setting-value]').getByText('10%', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Run now', exact: true }).click();
    await until(() => made.appCalls.some((c) => c.url.endsWith('/api/settings/run')), 'Run now');
    const save = made.appCalls.find((c) => c.url.endsWith('/api/settings/save'));
    assert.deepEqual(save.body, { page: 'n01_u01', name: 'act_now_share', value: '0.1', was: '0.08', note: 'more to act on' });
    assert.ok(made.appCalls.every((c) => c.headers.Authorization === `Bearer ${PERSON}`));
    const contrast = await lowContrast(page, ['[aria-label="Settings"]']);
    assert.ok(contrast.checked >= 10, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build page shows the settings as built, read only, with the reason, when the App says the person is not an owner, when there is no sign-in and when there is no App', async () => {
  const refusal = 'Only the owners of this use case can change its settings';
  const cases = [
    ['not an owner', { forwardedToken: PERSON, appApi: { 'GET /api/settings': [{ settings: [], history: [], editable: false, why: refusal, can_run: false }] } }, refusal],
    ['no sign-in', {}, 'Inspire reaches the App\u2019s settings with your own sign-in, and this request carries none, so they show here as built. Open the App to change them.'],
  ];
  for (const [name, state, why] of cases) {
    const ui = await openBuild({ history: [withModel()], ...state });
    try {
      const panel = (await openAsset(ui.page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
      await panel.locator('[data-settings-why]').waitFor({ timeout: 15000 });
      assert.equal(await panel.locator('[data-settings-why]').textContent(), why, name);
      assert.equal(await panel.getByRole('textbox').count(), 0, `${name}: nothing to type in`);
      assert.equal(await panel.getByRole('button', { name: 'Run now' }).count(), 0, `${name}: no Run now`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
  const noApp = { ...withModel(), app_url: null, app_name: null };
  const ui = await openBuild({ history: [noApp], forwardedToken: PERSON });
  try {
    const panel = (await openAsset(ui.page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
    await panel.locator('[data-setting="act_now_share"]').waitFor({ timeout: 15000 });
    assert.equal(await panel.locator('[data-settings-why]').textContent(),
      'This MVP has no App, so its settings change in all settings (Vibe/Add/Remove Features, then Open all settings), where the Settings step saves them without rebuilding the notebook.');
    assert.equal(await panel.locator('[data-setting="act_now_share"] [data-setting-value]').textContent(), '5%');
    assert.equal(await panel.locator('[data-setting="act_now_share"] [data-setting-source]').textContent(),
      "Inspire's default: the top 5% of the records that pass the decision test are Act now and the next 15% Review");
    await panel.getByRole('button', { name: 'Change them in all settings', exact: true }).waitFor();
    assert.equal(ui.made.appCalls.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
