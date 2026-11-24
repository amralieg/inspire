import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stakeCurrency, stakeText, AGENT_ACTION_IDS, askText, columnHeads, copyText, multiAsk, multiValid, valuesFor, actionLabel, chartOf, kpiName } from '../src/agentBlocks.js';

test('the Agent page offers every registry action, and an action without a label shows its id', () => {
  assert.deepEqual([...AGENT_ACTION_IDS].sort(), ['add_note', 'assign', 'done', 'not_an_issue', 'override', 'reopen', 'run_again', 'set_target', 'skip', 'snooze']);
  assert.equal(actionLabel('done'), 'Mark done');
  assert.equal(actionLabel('nope'), 'nope', 'an action without an agent label shows its id, never a made-up name');
});

test('snooze needs a day and assign needs a person: nothing is prepared without them', () => {
  assert.equal(valuesFor('snooze', {}).error, 'Pick the day to snooze until.');
  assert.equal(valuesFor('assign', { owner: '   ' }).error, 'Name the person to assign it to.');
  assert.deepEqual(valuesFor('snooze', { until: '2026-12-01' }).values, { until: '2026-12-01' });
  assert.deepEqual(valuesFor('assign', { owner: ' Ana ' }).values, { owner: 'Ana' });
  assert.deepEqual(valuesFor('done', {}), { values: {} }, 'Mark done needs no value');
});

test('a multi-select asks with the picked labels in the order shown, and is valid only inside min and max', () => {
  const block = { prompt: 'Which owners?', ask: 'Show the records for', min: 1, max: 2,
    options: [{ id: 'a', label: 'Ana' }, { id: 'b', label: 'Bo' }, { id: 'c', label: 'Cy' }] };
  assert.equal(multiAsk(block, ['c', 'a']), 'Show the records for Ana, Cy');
  assert.equal(multiValid(block, []), false, 'below min');
  assert.equal(multiValid(block, ['a', 'b', 'c']), false, 'above max');
  assert.equal(multiValid(block, ['b']), true);
  assert.equal(multiAsk({ ...block, ask: '' }, ['b']), 'Which owners? Bo', 'falls back to the prompt');
});

test('a choice sends its own ask text, or its label', () => {
  assert.equal(askText({ id: 'x', label: 'Top 5', ask: 'Show the top 5 by value at stake' }), 'Show the top 5 by value at stake');
  assert.equal(askText({ id: 'x', label: 'Top 5' }), 'Top 5');
  assert.equal(askText(undefined), '');
});

test('an email copies as a subject line, a blank line and the body', () => {
  assert.equal(copyText({ subject: 'Unit 7', body: 'Hi Ana,\nPlease check.' }), 'Subject: Unit 7\n\nHi Ana,\nPlease check.');
});

test('table headers come from the page columns and fall back to the id', () => {
  const page = { records: { columns: [{ column: 'category', label: 'Category' }] } };
  assert.deepEqual(columnHeads(page, ['category', 'value']), [{ id: 'category', label: 'Category' }, { id: 'value', label: 'value' }]);
});

test('a KPI and a chart resolve from the page, and an unknown id is not invented', () => {
  const page = { kpis: [{ id: 'loss', label: 'Total loss' }], charts: [{ id: 'trend', title: 'Trend' }] };
  assert.equal(kpiName(page, 'loss'), 'Total loss');
  assert.equal(kpiName(page, 'other'), 'other');
  assert.equal(chartOf(page, 'trend').title, 'Trend');
  assert.equal(chartOf(page, 'nope'), null);
});

test('value at stake reads in the App currency through the shared formatter, and a non-number is shown as given', () => {
  const page = { records: { columns: [{ column: 'value', currency: 'USD' }] } };
  assert.equal(stakeCurrency(page), 'USD');
  assert.equal(stakeText('900000', page), '$900,000');
  assert.equal(stakeText('lots', page), 'lots');
  assert.equal(stakeText('', page), '');
});

test('an App that names no currency shows the number without a symbol, never an invented one', () => {
  assert.equal(stakeCurrency({ records: { columns: [] } }), '');
  assert.equal(stakeText(1200, { records: { columns: [] } }), '1,200');
});
