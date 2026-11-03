import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { closeBrowser, lowContrast, onStep, openAsset, openBuild, openUi, setDark, until } from './uiSupport.mjs';
import { checkGroupingSql } from '../../src/lib/groupingSql.js';
import { GROUPING_CUSTOM_UNSAVED } from '../../src/lib/runScope.js';

test.after(closeBrowser);

const PERSON = 'person-token';
const PREFILL = 'SELECT o.order_id, o.country AS group_name FROM main.sales.orders o';
const GOOD = 'SELECT o.order_id, coalesce(c.segment, \'None\') AS group_name FROM main.sales.orders o LEFT JOIN main.crm.customers c ON o.cid = c.id';
const HIDDEN = 'SELECT o.order_id, s.band AS group_name FROM main.sales.orders o JOIN main.hr.salaries s ON o.rep = s.rep';
const DENIED = '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table \'main.hr.salaries\'.';
const PROFILE = {
  table: 'main.sales.orders', records: 48210, qualifies: true, reason: 'anomaly detection compares each record with its group', standalone: false,
  columns: [{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 31, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }],
  recommended: ['region', 'country'], example: null, time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'USA', records: 18200, kind: 'biggest' }], first_run: { all: 48210, groups: 18200, recent: 3120, records: null },
  default_scope: 'all', read_at: '2026-11-01T15:00:00Z', prefill: { key_columns: ['order_id'], joins: [], sql: PREFILL },
};
const INSTRUCTION = '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n'
  + '| `group_by` | text | all | | Grouping |\n| `run_scope` | text | all | | First run |\n';
const REFUSED = [
  'DROP TABLE main.sales.orders',
  'CREATE TABLE main.sales.copy AS SELECT * FROM main.sales.orders',
  'DELETE FROM main.sales.orders WHERE 1 = 1',
  'UPDATE main.sales.orders SET country = NULL',
  'MERGE INTO main.sales.orders t USING main.sales.orders s ON t.order_id = s.order_id WHEN MATCHED THEN DELETE',
  `${PREFILL}; DROP TABLE main.sales.orders`,
  `${PREFILL} /* ; */; DELETE FROM main.sales.orders`,
  `${PREFILL} WHERE o.country = 'x'; DROP TABLE main.sales.orders --'`,
  'WITH x AS (SELECT 1) INSERT INTO main.sales.orders SELECT * FROM x',
];

function warehouse(sql, _parameters, token) {
  if (token !== PERSON) throw new Error('the App token must never run a grouping SQL');
  if (sql.includes('main`.`hr`.`salaries') || sql.includes('main.hr.salaries')) throw new Error(DENIED);
  if (sql.endsWith('LIMIT 0')) return { rows: [], manifest: { schema: { columns: [{ name: 'order_id' }, { name: 'group_name' }] } } };
  if (sql.startsWith('SELECT group_name, COUNT(*) AS records')) {
    return { rows: [{ group_name: 'Enterprise', records: '700' }, { group_name: 'SMB', records: '480' }, { group_name: null, records: '20' }], manifest: {} };
  }
  if (sql.startsWith('WITH inspire_grouping AS')) {
    return { rows: [{ row_count: '1200', record_keys: '1200', group_count: '2', smallest_group: '480', small_groups: '0', null_groups: '20', no_group: '3' }], manifest: {} };
  }
  throw new Error(`unexpected grouping statement ${sql}`);
}

const profileAt = (calls) => async (page) => {
  await page.route('**/api/grouping/profile', async (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE) });
  });
};
const sqlRuns = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('AS group_name'));
const saves = (made) => made.sqlCalls.filter((c) => String(c.sql).startsWith('INSERT INTO') && String(c.sql).includes('_assumptions`'));
const editorText = (scope) => scope.locator('.cm-content').evaluate((el) => [...el.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
const next = (page) => page.getByRole('button', { name: 'Next' }).click();

async function typeSql(page, scope, sql) {
  await scope.getByRole('textbox', { name: 'Grouping SQL' }).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
  await until(async () => (await editorText(scope)) === sql, `the editor holds ${sql}`, 10000);
}

async function toStep(page, label) {
  for (let i = 0; i < 12 && await page.locator('[aria-current="step"]', { hasText: label }).count() === 0; i += 1) {
    const from = await page.locator('[aria-current="step"]').innerText();
    await next(page);
    await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 30000 });
  }
  await onStep(page, label);
}

async function refusesEach(page, editor, made) {
  const preview = editor.getByRole('button', { name: 'Preview', exact: true });
  for (const sql of REFUSED) {
    const want = checkGroupingSql(sql);
    assert.equal(want.ok, false, `the shared check refuses ${sql}`);
    await typeSql(page, editor, sql);
    const line = editor.locator('[data-grouping-sql-check]');
    await page.waitForFunction(([el, rule]) => el.getAttribute('data-grouping-sql-check') === rule, [await line.elementHandle(), want.rule]);
    assert.equal(await line.textContent(), want.text, sql);
    assert.equal(await preview.isDisabled(), true, `Preview stays off for ${sql}`);
  }
  assert.deepEqual(sqlRuns(made), [], 'a refused SQL never reaches the warehouse');
}

test('the wizard Grouping step: Custom opens a SQL editor prefilled from the table, refuses what the shared check refuses, previews and saves with the person token, and the build runs it', async () => {
  const calls = [];
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: PERSON, forwardedEmail: OWNER, statements: { 'AS group_name': warehouse },
    useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION },
  }, '', { init: profileAt(calls) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Grouping');
    const grouping = page.getByRole('region', { name: 'Compare like with like?', exact: true });
    assert.equal(await grouping.locator('[data-grouping-sql]').count(), 0, 'no editor until Custom is picked');
    await grouping.locator('[data-grouping-choice="custom"] input').check();
    const editor = grouping.locator('[data-grouping-sql]');
    await editor.locator('.cm-content').waitFor();
    assert.equal(await editorText(editor), PREFILL, 'the editor starts from the SQL Inspire wrote from the table');
    assert.equal(await editor.locator('[data-grouping-sql-check]').getAttribute('data-grouping-sql-check'), 'ok');
    assert.equal(await editor.locator('[data-grouping-sql-check]').textContent(), 'A single SELECT that reads main.sales.orders.');
    assert.ok((await editor.locator('.cm-content .cm-line span').count()) > 0, 'SQL words are colored');
    assert.equal(await editor.getByRole('button', { name: 'Use this grouping', exact: true }).isDisabled(), true, 'nothing to use before a preview');
    await next(page);
    await page.getByRole('alert').getByText(GROUPING_CUSTOM_UNSAVED).first().waitFor();
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '3. Grouping', 'an unsaved custom grouping keeps the person on Grouping');

    await refusesEach(page, editor, made);

    await typeSql(page, editor, GOOD);
    await editor.getByRole('button', { name: 'Preview', exact: true }).click();
    const shown = editor.locator('[data-grouping-sql-preview]');
    await shown.waitFor({ timeout: 30000 });
    assert.deepEqual(await shown.locator('[data-grouping-sql-rule]').evaluateAll((rows) => rows.map((r) => [r.dataset.groupingSqlRule, r.dataset.ok])),
      [['one_row_per_record', 'yes'], ['group_count', 'yes'], ['small_groups', 'yes'], ['no_group', 'yes']]);
    assert.deepEqual(await shown.locator('[data-grouping-sql-group]').evaluateAll((rows) => rows.map((r) => r.innerText.split('\t').map((s) => s.trim()))),
      [['Enterprise', '700 records'], ['SMB', '480 records'], ['No group', '20 records']]);
    for (const name of ['Move the Group column', 'Move the Records column', 'Filter Group', 'Filter Records']) {
      assert.equal(await shown.getByRole('button', { name, exact: true }).count(), 1, `the preview offers ${name}`);
    }
    await shown.locator('th[data-col="records"] [data-grid-sort]').click();
    assert.deepEqual(await shown.locator('[data-grouping-sql-group] td:first-child').allInnerTexts(), ['Enterprise', 'SMB', 'No group'],
      'records sort biggest first');
    await shown.locator('th[data-col="records"] [data-grid-sort]').click();
    assert.deepEqual(await shown.locator('[data-grouping-sql-group] td:first-child').allInnerTexts(), ['No group', 'SMB', 'Enterprise']);
    assert.deepEqual(sqlRuns(made).map((c) => c.token), [PERSON, PERSON, PERSON], 'the preview runs with the person token only');

    await typeSql(page, editor, `${GOOD} WHERE o.order_id IS NOT NULL`);
    await editor.locator('[data-grouping-sql-stale]').waitFor();
    assert.equal(await editor.getByRole('button', { name: 'Use this grouping', exact: true }).isDisabled(), true, 'a changed SQL needs a new preview');
    await typeSql(page, editor, GOOD);
    await editor.getByRole('button', { name: 'Use this grouping', exact: true }).click();
    await editor.locator('[data-grouping-sql-saved]').waitFor({ timeout: 30000 });
    const [insert] = saves(made);
    assert.ok(insert, 'one insert into the assumptions table');
    assert.equal(insert.token, PERSON);
    const table = /INSERT INTO `([^`]+)`\.`([^`]+)`\.`([^`]+)_assumptions`/.exec(insert.sql).slice(1).join('.');
    assert.equal(await editor.locator('[data-grouping-sql-saved]').textContent(), `Saved for ${table}; its runs group records with this SQL.`);
    assert.equal(insert.parameters.find((p) => p.value === GOOD)?.value, GOOD, 'the checked SQL is what is stored');
    assert.equal(await page.locator('[data-scope-problem]').count(), 0);

    for (const dark of [false, true]) {
      await setDark(page, dark);
      const contrast = await lowContrast(page, ['[data-grouping-sql]']);
      assert.ok(contrast.checked >= 8, `measured ${contrast.checked}`);
      assert.deepEqual(contrast.low, [], dark ? 'dark' : 'light');
    }
    await setDark(page, false);

    await next(page);
    await onStep(page, 'First run');
    await toStep(page, 'Vibes');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start MVP' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const sent = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
    assert.equal(sent[0].config.widgets.group_by, 'custom', 'the build asks the agent for the custom grouping');
    assert.equal(sent[0].config.result_table, table, 'the grouping was saved where the build writes its results');
    assert.equal(saves(made).length, 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const SCOPE_MODEL = [
  { name: 'group_by', label: 'Grouping', group: 'scope', kind: 'text', allowed: 'all, custom or columns', source: 'widget', default: 'all', choices: ['region', 'country'],
    unit: '', reason: '', help: '', applies: 'run' },
  { name: 'run_scope', label: 'First run', group: 'scope', kind: 'choice', choices: ['all', 'groups', 'recent', 'records'], source: 'widget', default: 'all', unit: '',
    reason: '', help: '', applies: 'run' },
];
const viewOf = (values) => ({ settings: SCOPE_MODEL.map((s) => ({ ...s, value: values[s.name], saved: false, editable: true })), history: [], editable: true, why: '', can_run: true, job: true });
const withScopeModel = () => {
  const row = built();
  return { ...row, notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), notebook: { state: 'ready', spec_version: 1, result_history: 1 }, settings: SCOPE_MODEL }) };
};

test('Build settings: Custom cannot be saved until its SQL is previewed and used, a refused or unreadable SQL says why, and Save then sends custom', async () => {
  const calls = [];
  let values = { group_by: 'all', run_scope: 'all' };
  const appApi = {
    'GET /api/settings': [() => viewOf(values)],
    'POST /api/settings/save': [(call) => { values = { ...values, [call.body.name]: call.body.value }; return viewOf(values); }],
  };
  const ui = await openBuild({ history: [withScopeModel()], forwardedToken: PERSON, forwardedEmail: OWNER, me: { userName: OWNER, displayName: 'Owner' },
    statements: { 'AS group_name': warehouse }, appApi }, { init: profileAt(calls) });
  const { page, made } = ui;
  try {
    const scope = (await openAsset(page, 'notebook')).locator('[data-setting-group="run_scope"]');
    await scope.locator('[data-grouping-choice="custom"]').waitFor({ timeout: 30000 });
    await scope.locator('[data-grouping-choice="custom"] input').check();
    const editor = scope.locator('[data-grouping-sql]');
    await editor.locator('.cm-content').waitFor();
    const saveScope = scope.getByRole('button', { name: 'Save Grouping and First run', exact: true });
    assert.equal(await saveScope.isDisabled(), true, 'custom without a used SQL cannot be saved');
    assert.equal(await scope.locator('[data-scope-problem]').textContent(), GROUPING_CUSTOM_UNSAVED);

    await refusesEach(page, editor, made);

    await typeSql(page, editor, HIDDEN);
    await editor.getByRole('button', { name: 'Preview', exact: true }).click();
    const refusal = editor.locator('[data-grouping-sql-error]');
    await refusal.waitFor({ timeout: 30000 });
    assert.match(await refusal.textContent(), /main\.hr\.salaries/, 'the platform reason for the table the person cannot read');
    assert.equal(await editor.getByRole('button', { name: 'Use this grouping', exact: true }).isDisabled(), true);

    await typeSql(page, editor, GOOD);
    await editor.getByRole('button', { name: 'Preview', exact: true }).click();
    await editor.locator('[data-grouping-sql-preview]').waitFor({ timeout: 30000 });
    await editor.getByRole('button', { name: 'Use this grouping', exact: true }).click();
    await editor.locator('[data-grouping-sql-saved]').waitFor({ timeout: 30000 });
    const [insert] = saves(made);
    const spec = JSON.parse(withScopeModel().spec_json);
    const [catalog, schema, name] = spec.config.result_table.split('.');
    assert.ok(insert.sql.startsWith(`INSERT INTO \`${catalog}\`.\`${schema}\`.\`${name}_assumptions\``), 'saved next to the results the built use case writes');
    assert.equal(await saveScope.isDisabled(), false);
    await saveScope.click();
    await until(() => made.appCalls.some((c) => c.url.endsWith('/api/settings/save')), 'the save', 30000);
    assert.deepEqual(made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).map((c) => [c.body.name, c.body.value]), [['group_by', 'custom']]);
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 403 \(Forbidden\)/.test(e)), [], 'only the unreadable table answered 403');
  } finally {
    await ui.close();
  }
});

test('leaving Custom while a preview runs cancels the request in the browser', async () => {
  const appApi = { 'GET /api/settings': [() => viewOf({ group_by: 'all', run_scope: 'all' })] };
  const failed = [];
  const ui = await openBuild({ history: [withScopeModel()], forwardedToken: PERSON, forwardedEmail: OWNER, me: { userName: OWNER, displayName: 'Owner' }, appApi }, {
    init: async (page) => {
      await profileAt([])(page);
      await page.route('**/api/grouping/preview', () => {});
      page.on('requestfailed', (r) => { if (r.url().endsWith('/api/grouping/preview')) failed.push(r.failure()?.errorText || ''); });
    },
  });
  const { page } = ui;
  try {
    const scope = (await openAsset(page, 'notebook')).locator('[data-setting-group="run_scope"]');
    await scope.locator('[data-grouping-choice="custom"]').waitFor({ timeout: 30000 });
    await scope.locator('[data-grouping-choice="custom"] input').check();
    const editor = scope.locator('[data-grouping-sql]');
    await editor.getByRole('button', { name: 'Preview', exact: true }).click();
    await editor.getByRole('button', { name: 'Preview', exact: true }).locator('.animate-spin').waitFor();
    await scope.locator('[data-grouping-choice="all"] input').check();
    await until(() => failed.length === 1, 'the cancelled preview', 10000);
    assert.match(failed[0], /ERR_ABORTED|aborted/i);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
