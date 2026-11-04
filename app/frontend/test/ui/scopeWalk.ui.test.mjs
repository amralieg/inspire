import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { closeBrowser, onStep, openUi } from './uiSupport.mjs';
import { checkRunScope, checkScope, checkWizardSteps } from '../../../scripts/scopeWalk.mjs';

test.after(closeBrowser);

const SCOPE_UI = fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'lib', 'runScope.js'));
const skip = SCOPE_UI ? false : 'the Grouping and First run UI is not in this build yet';

const ME = { userName: OWNER, displayName: 'Owner' };
const PERSON = 'person-token';
const PROFILE = {
  table: 'main.sales.orders', records: 48210, applies: true, qualifies: true, reason: 'anomaly detection compares each record with its group', standalone: false,
  columns: [{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 31, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }],
  recommended: ['region', 'country'],
  example: { column: 'country', small_groups: [{ value: 'Cyprus', records: 12 }], moves_to: 'Europe' },
  time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'USA', records: 18200, kind: 'biggest' }, { value: 'Spain', records: 1400, kind: 'typical' }, { value: 'Cyprus', records: 12, kind: 'smallest' }],
  group_column: 'country', group_sizes: [{ value: 'Germany', records: 600 }, { value: 'Ireland', records: 300 }],
  first_run: { all: 48210, groups: 19612, recent: 3120, records: null }, default_scope: 'records', read_at: '2026-11-01T15:00:00Z',
};
const INSTRUCTION = '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n'
  + '| `act_now_share` | text | 0.05 | 0 to 1 | Act now share |\n| `group_by` | text | all | | Grouping |\n| `run_scope` | text | all | | First run |\n';

const profileAt = (calls, answer, { status = 200, after = 0 } = {}) => async (page) => {
  await page.route('**/api/grouping/profile', async (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'));
    if (after) await new Promise((done) => setTimeout(done, after));
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(answer) });
  });
};
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const stepBar = (page) => page.locator('[aria-current="step"]').locator('xpath=..').locator('li').allTextContents();
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

async function toStep(page, label) {
  for (let i = 0; i < 12 && await page.locator('[aria-current="step"]', { hasText: label }).count() === 0; i += 1) {
    const from = await page.locator('[aria-current="step"]').innerText();
    await next(page);
    await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 30000 });
  }
  await onStep(page, label);
}

const SCOPE_MODEL = [
  { name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.05', unit: '%',
    reason: "Inspire's default", help: 'The share that is Act now.', applies: 'run' },
  { name: 'group_by', label: 'Grouping (columns coarse to fine, all, or custom)', group: 'scope', kind: 'text', allowed: 'all, custom or columns', source: 'widget',
    default: 'all', choices: ['region', 'country'], unit: '', reason: '', help: '', applies: 'run' },
  { name: 'run_scope', label: 'First run', group: 'scope', kind: 'choice', choices: ['all', 'groups', 'recent', 'records'], source: 'widget', default: 'all', unit: '',
    reason: '', help: '', applies: 'run' },
  { name: 'scope_groups', label: 'Groups to run on', group: 'scope', kind: 'choice', many: true, choices: [], source: 'widget', default: '', unit: '', reason: '', help: '', applies: 'run' },
  { name: 'scope_days', label: 'Days to run on', group: 'scope', kind: 'days', low: 1, high: null, allowed: 'at least 1', source: 'widget', default: '30', unit: '',
    reason: '', help: '', applies: 'run' },
  { name: 'scope_records', label: 'Records to run on', group: 'scope', kind: 'integer', low: 1, high: null, allowed: 'at least 1', source: 'widget', default: '1000', unit: '',
    reason: '', help: '', applies: 'run' },
];
const SAVED = { act_now_share: '0.08', group_by: 'all', run_scope: 'groups', scope_groups: 'USA, Spain, Cyprus', scope_days: '30', scope_records: '1000' };
const viewOf = (values) => ({
  settings: SCOPE_MODEL.map((s) => ({ ...s, value: values[s.name], saved: false, editable: true })), history: [], editable: true, why: '', can_run: true, job: true,
});
const withScopeModel = () => {
  const row = built();
  return { ...row, notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), notebook: { state: 'ready', spec_version: 1, result_history: 1 }, settings: SCOPE_MODEL }) };
};


const failed = (list) => list.filter((c) => c.ok === false);
const names = async (page) => (await stepBar(page)).map((s) => s.replace(/^\d+\.\s*/, ''));

test('the offline walk checks the wizard of a large table that qualifies', { skip }, async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, PROFILE) });
  const { page } = ui;
  try {
    await toStep(page, 'Grouping');
    const grouping = await checkScope(page, PROFILE, { part: 'grouping' });
    await next(page);
    await onStep(page, 'First run');
    const firstRun = await checkScope(page, PROFILE, { part: 'first_run' });
    const steps = checkWizardSteps(await names(page), PROFILE);
    const all = [...grouping, ...firstRun, ...steps];
    console.log(JSON.stringify(all));
    assert.deepEqual(failed(all), []);
    assert.equal(all.filter((c) => c.ok === true).length, 10);
    assert.deepEqual(all.filter((c) => c.ok === null).map((c) => c.check), ['Custom editor: Run, refusal and Use this grouping']);
    assert.equal(checkWizardSteps(await names(page), { ...PROFILE, applies: false })[0].ok, false, 'a profile where grouping does not apply fails a wizard that asks Grouping');
  } finally {
    await ui.close();
  }
});

test('the offline walk checks the wizard of a small table, no Grouping and Everything by default', { skip }, async () => {
  const calls = [];
  const small = { ...PROFILE, records: 800, applies: false, qualifies: false, standalone: true, default_scope: 'all', first_run: { all: 800, groups: 600, recent: 120, records: 800 }, recent: { days: 30, records: 120 } };
  const ui = await openUi('wizard', { me: ME }, '', { init: profileAt(calls, small) });
  const { page } = ui;
  try {
    await toStep(page, 'First run');
    const all = [...await checkScope(page, small, { part: 'first_run' }), ...checkWizardSteps(await names(page), small)];
    console.log(JSON.stringify(all));
    assert.deepEqual(failed(all), []);
    const lying = await checkScope(page, { ...small, records: 48210 }, { part: 'first_run' });
    assert.deepEqual(failed(lying).map((c) => c.check), ['First run is the default above 1,000 records'], 'Everything picked above 1,000 records fails');
  } finally {
    await ui.close();
  }
});

test('the offline walk checks the Run tab section', { skip }, async () => {
  const calls = [];
  const runs = [
    { run_id: 'r3', status: 'succeeded', scope: { scope: 'groups', key: 'groups|country|USA,Spain' }, scope_text: 'First run: 2 groups of country (USA, Spain)',
      facts: { covered: 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.', everything: 'Run on everything covers all 48,210 records.' } },
  ];
  const values = { ...SAVED };
  const appApi = { 'GET /api/settings': [() => viewOf(values)], 'GET /api/runs': [{ runs, total: 1, offset: 0, limit: 20 }] };
  const row = withScopeModel();
  const registry = [{ ...row, spec_json: JSON.stringify({ ...JSON.parse(row.spec_json), use_case_name: 'Predict churn' }) }];
  const state = { registry, useCaseScope: [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }], history: [row], forwardedToken: PERSON, appApi };
  const ui = await openUi('run', state, '', { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  try {
    const section = page.getByRole('region', { name: 'Grouping and First run of this use case', exact: true });
    await section.locator('[data-scope-part="first_run"] input[type="radio"]').first().waitFor({ timeout: 30000 });
    const all = await checkRunScope(page);
    console.log(JSON.stringify(all));
    assert.deepEqual(failed(all), []);
    assert.equal(all.filter((c) => c.ok === true).length, 2);
    assert.equal(made.appCalls.filter((c) => c.method === 'POST').length, 0, 'the walk changes nothing');
  } finally {
    await ui.close();
  }
});
