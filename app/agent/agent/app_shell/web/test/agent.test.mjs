import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, actBody, appInfo, openApp, serveDist, tracked, until } from './harness.mjs';
import { EMPTY_LOOK, applyActions, changesView, lookChart, routeOf, suggestions } from '../src/agentView.js';
import { initialFilterState } from '../src/filters.js';

const META = [
  { id: 'run_date', type: 'date_range', presets: [{ id: '3m', from: '2026-08-01', to: '2026-10-15' }, { id: '12m', from: '2025-11-01', to: '2026-10-15' }], default: '12m' },
  { id: 'region', type: 'multi_select' },
];

test('applying the agent view changes sets filters, ranges, sorts and charts, and the snapshot undoes them', () => {
  const start = { state: { ...initialFilterState(META), sel: { region: ['South'] } }, look: EMPTY_LOOK };
  const frozen = JSON.stringify(start);
  const next = applyActions(start, [
    { type: 'filter', filter: 'region', values: ['North'] },
    { type: 'range', filter: 'run_date', preset: '3m' },
    { type: 'column_filter', column: 'priority_tier', values: ['Act now'] },
    { type: 'sort', target: 'records', key: 'value', dir: 'desc' },
    { type: 'sort', target: 'worst', key: 'loss', dir: 'asc' },
    { type: 'chart', chart: 'loss_trend', chart_type: 'bar' },
    { type: 'chart', chart: 'loss_trend', series: ['Loss'] },
  ], META);
  assert.deepEqual(next.state.sel, { region: ['North'] });
  assert.deepEqual(next.state.range.run_date, { preset: '3m', from: '2026-08-01', to: '2026-10-15' });
  assert.deepEqual(next.state.columns.list, { priority_tier: ['Act now'] });
  assert.deepEqual(next.look.sorts, { records: { key: 'value', dir: 'desc' }, worst: { key: 'loss', dir: 'asc' } });
  assert.deepEqual(next.look.charts, { loss_trend: { type: 'bar', series: ['Loss'] } });
  assert.equal(next.route, '');
  assert.equal(JSON.stringify(start), frozen, 'the view before stays intact, so undo restores it exactly');
  const custom = applyActions(start, [{ type: 'range', filter: 'run_date', from: '2026-01-01', to: '2026-02-01' }], META);
  assert.deepEqual(custom.state.range.run_date, { preset: 'custom', from: '2026-01-01', to: '2026-02-01' });
  const cleared = applyActions(next, [{ type: 'clear_filters' }], META);
  assert.deepEqual(cleared.state.sel, {});
  assert.deepEqual(cleared.state.columns, { list: {}, tables: {} });
  assert.equal(cleared.state.range.run_date.preset, '3m', 'clearing the filters keeps the time window');
});

test('navigation and record opening become a route, and only they leave the filters alone', () => {
  const nav = applyActions({ state: null, look: null }, [{ type: 'navigate', page: 'impact' }]);
  assert.equal(nav.route, '#/impact');
  const opened = applyActions({ state: null, look: null }, [{ type: 'open_record', page: 'n01_u05', record_key: 'R 1' }]);
  assert.equal(opened.route, routeOf({ type: 'open_record', page: 'n01_u05', record_key: 'R 1' }));
  assert.match(opened.route, /^#\/n01_u05\?rec=R(\+|%20)1$/);
  assert.deepEqual(opened.open, { pageId: 'n01_u05', recordKey: 'R 1' });
  assert.equal(changesView([{ type: 'navigate', page: 'impact' }]), false);
  assert.equal(changesView([{ type: 'navigate', page: 'impact' }, { type: 'filter', filter: 'region', values: ['North'] }]), true);
  assert.deepEqual(applyActions({ state: null, look: null }, [{ type: 'unknown' }]).state, { range: {}, sel: {} }, 'an unknown change does nothing');
});

test('a chart shown with fewer series keeps each value with its own series', () => {
  const chart = { id: 'c', type: 'line', y: [{ label: 'Loss' }, { label: 'Revenue' }, { label: 'Discounts' }] };
  const result = { rows: [{ x: '2026-01', y0: 1, y1: 2, y2: 3 }] };
  const shown = lookChart(chart, result, { series: ['Discounts', 'Loss'], type: 'bar' });
  assert.deepEqual(shown.chart.y.map((y) => y.label), ['Loss', 'Discounts']);
  assert.equal(shown.chart.type, 'bar');
  assert.deepEqual(shown.result.rows, [{ x: '2026-01', y0: 1, y1: 3 }]);
  assert.equal(lookChart(chart, result, undefined).chart, chart);
});

test('suggested questions come from the page and the record, never repeating one already asked', () => {
  const page = { questions: ['Which category lost the most?', 'How did the loss rate move?'], records: { label_title: 'Item' } };
  assert.deepEqual(suggestions(page, null, 'item', ['which category lost the most?']),
    ['How did the loss rate move?', 'Which items should I act on first?', 'Show only the critical items']);
  assert.equal(suggestions(page, { label: 'Item 7' }, 'item')[0], 'Why is Item 7 on the list?');
});

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

const DONE_TURN = {
  turn_id: 't1', state: 'done', answer: 'North lost the most. I filtered the page to North and can mark the two critical ones done.',
  steps: [{ tool: 'ask_genie', text: 'Asked Genie: Which region lost the most?' }, { tool: 'change_view', text: 'Filtered to Region = North' },
    { tool: 'propose_action', text: 'Proposed Mark done for 2 records, waiting for your confirmation' }],
  actions: [{ type: 'filter', filter: 'region', label: 'Region', values: ['North'], text: 'Filtered to Region = North' }],
  confirm: { action: 'done', label: 'Mark done', route: 'records/act', values: { action_status: 'Done' },
    rows: [{ record_key: 'R001', label: 'Item 1' }, { record_key: 'R002', label: 'Item 2' }],
    body: { page: 'n01_u05', record_keys: ['R001', 'R002'], seen: { R001: '100', R002: '101' }, values: { action_status: 'Done' } } },
  genie: { conversation_id: 'c1', message_id: 'm1', sql: 'SELECT region FROM t', columns: [], rows: [], truncated: false },
  model: 'system.ai.claude-sonnet-4-6', refused: false, conversation_id: 'c1', error: '',
};

function agentRoutes(turn = DONE_TURN, extra = {}) {
  const calls = { asks: [], polls: 0, feedback: [], undos: [] };
  const { calls: acted, routes } = tracked({
    'records/undo': ({ route, json }) => { calls.undos.push(route.request().postDataJSON()); return json(200, { undone: ['R001', 'R002'] }); },
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      acted.acts.push(body);
      return json(200, { written: body.record_keys, conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b'.repeat(32) });
    },
  });
  Object.assign(routes, {
    'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: 'n01_u05', genie: true, model: 'system.ai.claude-sonnet-4-6' }),
    'agent/ask': ({ route, json }) => {
      calls.asks.push(route.request().postDataJSON());
      return json(200, { ...turn, state: 'running', steps: turn.steps.slice(0, 1), answer: '', actions: [], confirm: null });
    },
    'agent/turn': ({ json }) => { calls.polls += 1; return json(200, turn); },
    'agent/feedback': ({ route, json }) => { calls.feedback.push(route.request().postDataJSON()); return json(200, { rating: 'POSITIVE', genie: true }); },
    ...extra,
  });
  return { calls, acted, routes };
}

async function askAgent(page, question) {
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const box = page.getByRole('textbox', { name: 'Your question' });
  await box.fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

const lastFilters = (seen) => seen.records[seen.records.length - 1]?.filters || {};

test('the agent chat shows its steps, applies its view change with an undo, and writes only after the person confirms', async () => {
  const { calls, acted, routes } = agentRoutes();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE }), { routes, hash: '#/n01_u05/work' });
  try {
    await askAgent(page, 'Which region lost the most? Mark its critical ones done.');
    await page.getByText('North lost the most', { exact: false }).waitFor();
    assert.equal(calls.asks.length, 1);
    const asked = calls.asks[0];
    assert.equal(asked.page, 'n01_u05');
    assert.ok(Array.isArray(asked.visible) && asked.visible.length > 0, 'the rows the page shows go with the question');
    assert.ok(asked.visible.every((r) => Object.keys(r).every((k) => !k.startsWith('_inspire_') || k === '_inspire_status')));
    assert.ok(asked.view && asked.view.filters && asked.view.look, 'the current filters and look go with the question');
    for (const text of ['Asked Genie: Which region lost the most?', 'Filtered to Region = North']) await page.getByText(text).first().waitFor();
    await until(() => JSON.stringify(lastFilters(seen).region) === JSON.stringify(['North']));
    assert.equal(acted.acts.length, 0, 'nothing is written before the person confirms');
    const card = page.getByRole('group', { name: 'Mark done: 2 records' });
    await card.getByText('Item 1').waitFor();
    await card.getByText('Item 2').waitFor();
    await card.getByRole('button', { name: 'Confirm' }).click();
    await card.getByText('Saved 2 records.').waitFor();
    assert.deepEqual(acted.acts, [DONE_TURN.confirm.body], 'the confirmation posts the same body to records/act');
    await card.getByRole('button', { name: 'Undo' }).click();
    await card.getByText('Undone.', { exact: false }).waitFor();
    assert.deepEqual(calls.undos, [{ page: 'n01_u05', batch_id: 'b'.repeat(32) }]);
    await page.locator('[data-view-undo="ready"]').getByRole('button', { name: 'Undo' }).click();
    await page.locator('[data-view-undo="done"]').waitFor();
    await until(() => lastFilters(seen).region === undefined);
    await page.locator('.genie [data-rating="POSITIVE"]').click();
    await until(() => calls.feedback.length === 1);
    assert.deepEqual(calls.feedback, [{ turn_id: 't1', rating: 'POSITIVE' }]);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('cancelling a confirmation writes nothing', async () => {
  const { acted, routes } = agentRoutes();
  const { page, context } = await openApp(browser, served.base, appInfo({ ...DECIDE }), { routes });
  try {
    await askAgent(page, 'Mark the critical ones done');
    const card = page.getByRole('group', { name: 'Mark done: 2 records' });
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByText('Cancelled. Nothing changed.').waitFor();
    assert.equal(acted.acts.length, 0);
  } finally {
    await context.close();
  }
});

test('without a chat model the panel says so and asks the Genie Agent as before', async () => {
  const note = 'No chat model answers for this App, so Genie answers from the Genie Agent only.';
  const routes = { 'agent/status': ({ json }) => json(200, { mode: 'genie', note, page: 'n01_u05', genie: true, model: '' }) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes });
  try {
    await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
    await page.locator('[data-agent-note]').getByText(note).waitFor();
    await page.getByRole('textbox', { name: 'Your question' }).fill('Which category lost the most?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Books lost the most', { exact: false }).waitFor();
    assert.equal(seen.asks.length, 1, 'the question went to genie/ask');
  } finally {
    await context.close();
  }
});

test('a refused question shows the refusal and offers no rating', async () => {
  const refused = { ...DONE_TURN, answer: 'This is not related to this use case.', steps: [], actions: [], confirm: null, genie: null, refused: true };
  const { routes } = agentRoutes(refused);
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes });
  try {
    await askAgent(page, 'What is the capital of China?');
    await page.getByText('This is not related to this use case.').waitFor();
    assert.equal(await page.locator('.genie [data-rating]').count(), 0);
    assert.equal(seen.records.length > 0 && lastFilters(seen).region, undefined);
  } finally {
    await context.close();
  }
});

test('an answer with a heading, bullets and a markdown table renders as those elements, never as raw pipes or run-on text', async () => {
  const answer = ['Focus on the **7 Paid Late** bills: they hold all **$1,820.24** at stake.', '', '### What it shows',
    'Open billing breaks by age and payment status.', '', '| Age & Status | Bills | Leakage at stake |', '|---|--:|--:|',
    '| 30 days · Paid On Time | 21 | $0 |', '| 30 days · Paid Late | 7 | $1,820.24 |', '', '- Start with Bill 1133.', '- Paid On Time holds no leakage.'].join('\n');
  const { routes } = agentRoutes({ ...DONE_TURN, answer, actions: [], confirm: null, steps: [], genie: null });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes });
  try {
    await askAgent(page, 'Explain the age and status of billing breaks');
    const reply = page.locator('.genie .msg-b').last();
    await reply.locator('table tbody tr').nth(1).waitFor();
    await reply.getByText('Paid On Time holds no leakage.').waitFor();
    await reply.locator('.cursor').waitFor({ state: 'detached' });
    assert.deepEqual(await reply.locator('table thead th').allInnerTexts(), ['Age & Status', 'Bills', 'Leakage at stake']);
    assert.deepEqual(await reply.locator('table tbody tr').first().locator('td').allInnerTexts(), ['30 days · Paid On Time', '21', '$0']);
    assert.equal(await reply.locator('table tbody tr').count(), 2);
    assert.deepEqual(await reply.locator('li').allInnerTexts(), ['Start with Bill 1133.', 'Paid On Time holds no leakage.']);
    assert.equal(await reply.locator('.msg-h').innerText(), 'What it shows');
    assert.equal(await reply.locator('p').first().innerText(), 'Focus on the 7 Paid Late bills: they hold all $1,820.24 at stake.');
    const text = await reply.innerText();
    assert.ok(!text.includes('|') && !text.includes('---') && !text.includes('###') && !text.includes('**'), text);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a multi-bullet answer renders as a list with bold labels, never as bullets run into a sentence', async () => {
  const answer = ['This row is for **franchise 3000046**, showing a sale of **$450 across 3 transactions** on **May 12, 2024** for **Golden Gate Ginger** (paid by Amex, in the Current 7-day window). It appears in this weekly sales driver review because:',
    '', '- It falls within the **current 7-day sales window** being reviewed (May 4-17, 2024).', '- Its **main sales driver is Volume**.', '- It is tagged **Action tier: Monitor**.'].join('\n');
  const { routes } = agentRoutes({ ...DONE_TURN, answer, actions: [], confirm: null, steps: [], genie: null });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes });
  try {
    await askAgent(page, 'Why is this row here?');
    const reply = page.locator('.genie .msg-b').last();
    await reply.locator('li').nth(2).waitFor();
    await reply.locator('.cursor').waitFor({ state: 'detached' });
    assert.deepEqual(await reply.locator('ul > li').allInnerTexts(), ['It falls within the current 7-day sales window being reviewed (May 4-17, 2024).',
      'Its main sales driver is Volume.', 'It is tagged Action tier: Monitor.']);
    assert.deepEqual(await reply.locator('li strong').allInnerTexts(), ['current 7-day sales window', 'main sales driver is Volume', 'Action tier: Monitor']);
    assert.equal(await reply.locator('p').count(), 1);
    assert.ok(!(await reply.locator('p').innerText()).includes(' - '));
    assert.ok(!(await reply.innerText()).includes('**'));
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});
