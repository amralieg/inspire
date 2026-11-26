// REQ-507 L4 (StepScope, StepFilter; green once L7 wires them): the Data and Filter steps. Records found and the date column first; three
// cards with Last 12 months recommended for a long history; 5 example phrases; the echo and the SQL from the server; each predicate a chip
// with a remove button that recounts; an unmatched phrase with close columns; the structured builder when the model is down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { FILTER_OK, mountReq507, textOf } from './req507Support.mjs';

test.after(closeBrowser);

async function toChoice(dialog) {
  await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
  await dialog.locator('[data-wizard-page="scope:choice"]').waitFor();
}
async function toFilter(dialog) {
  await toChoice(dialog);
  await dialog.locator('[data-scope-choice="filter"]').click();
  await dialog.locator('[data-wizard-page="filter"]').waitFor();
}

test('R507-S1: the date column can be changed, which asks the scope route again with it', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    const pick = dialog.getByLabel('Date column');
    assert.deepEqual(await pick.locator('option').allInnerTexts(), ['created_at', 'shipped_at']);
    await pick.selectOption('shipped_at');
    await dialog.locator('[data-scope-facts]').filter({ hasText: 'dated by shipped_at' }).waitFor();
    assert.equal(calls.filter((c) => c.route === 'scope').at(-1).body.date_column, 'shipped_at');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-S2: three cards, Last 12 months recommended for 7 years of data; picking it posts a structured window, no phrase', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await toChoice(dialog);
    assert.deepEqual(await dialog.locator('[data-scope-choice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-scope-choice'))), ['all', 'last_12', 'filter']);
    assert.equal(await dialog.locator('[data-scope-choice="last_12"]').getAttribute('data-recommended'), 'true');
    assert.match(await textOf(dialog.locator('[data-scope-choice="last_12"]')), /1 Oct 2025 to 30 Sep 2026/);
    await dialog.locator('[data-scope-choice="last_12"]').click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.locator('[data-wizard-page="kinds"]').waitFor();
    const posted = calls.filter((c) => c.route === 'filter');
    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0].body.window, { column: 'created_at', last_n: 12, unit: 'month' });
    assert.equal(posted[0].body.phrase, undefined);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-S3: an example fills the phrase; Check filter shows the server echo, one chip per predicate and the SQL collapsed', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await toFilter(dialog);
    assert.equal(await dialog.locator('[data-filter-example]').count(), 5);
    await dialog.locator('[data-filter-example]').filter({ hasText: 'Exclude cancelled and test records' }).click();
    const box = dialog.getByRole('textbox', { name: 'Describe the rows to keep' });
    assert.equal(await box.inputValue(), 'Exclude cancelled and test records');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    await dialog.locator('[data-filter-echo]').waitFor();
    assert.equal(calls.filter((c) => c.route === 'filter').at(-1).body.phrase, 'Exclude cancelled and test records');
    assert.equal(await textOf(dialog.locator('[data-filter-echo]')), FILTER_OK.echo);
    assert.deepEqual(await dialog.locator('[data-predicate]').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())),
      ['status is not cancelled or test', 'channel is not test']);
    const sql = dialog.locator('details[data-filter-sql]');
    assert.equal(await sql.getAttribute('open'), null, 'the SQL is collapsed');
    assert.match(await sql.evaluate((d) => d.textContent), /COUNT_IF/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-S4: removing a chip recounts with the structured filters that are left, through the same route', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await toFilter(dialog);
    await dialog.getByRole('textbox', { name: 'Describe the rows to keep' }).fill('Exclude cancelled and test records');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    await dialog.locator('[data-filter-echo]').waitFor();
    await dialog.getByRole('button', { name: 'Remove channel is not test' }).click();
    for (let i = 0; i < 50 && calls.filter((c) => c.route === 'filter').length < 2; i += 1) await new Promise((r) => setTimeout(r, 100));
    const last = calls.filter((c) => c.route === 'filter').at(-1);
    assert.deepEqual(last.body.filters, [{ column: 'status', op: 'not in', values: ['cancelled', 'test'] }]);
    assert.equal(last.body.phrase, undefined, 'a chip edit is structure, not a new phrase for the model');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-S5: an unmatched phrase names close columns; with the model down the structured builder shows', async () => {
  const replies = [
    { scope: { ...FILTER_OK.scope, filters: [] }, echo: 'I kept all 3,412,880 rows.', unmatched: [{ phrase: 'Only the North region', column: 'region_name_x', close: ['region', 'channel'] }], sql: 'SELECT 1' },
    { scope: null, builder: true, reason: 'no AI model' },
  ];
  const { ui, card, page } = await openCard(mountReq507({ filterReply: (_req, res) => res.json(replies.shift() || { scope: null, builder: true }) }));
  try {
    const dialog = await openWizard(page, card);
    await toFilter(dialog);
    const box = dialog.getByRole('textbox', { name: 'Describe the rows to keep' });
    await box.fill('Only the North region');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    await dialog.locator('[data-filter-unmatched]').waitFor();
    assert.match(await textOf(dialog.locator('[data-filter-unmatched]')), /I found no column for 'region_name_x'\. Columns that look close: region, channel\./);
    await box.fill('Only paid ones');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    const builder = dialog.locator('[data-filter-builder]');
    await builder.waitFor();
    for (const name of ['Column', 'Operator', 'Value']) assert.equal(await builder.getByLabel(name).count(), 1, name);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
