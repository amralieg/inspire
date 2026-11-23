// REQ-506: the Agent page is gone. Its work now happens in Genie mode (Screen | Genie, Genie full height): the box and the chips,
// an ask rendering its blocks, and a write going through the confirm card before anything is saved.
// Old test -> new test: see the comment above each test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, until } from './harness.mjs';

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

const AGENTIC = { options: { modify: false, replace_edits: false, decisions: true, alerts: false, experience: 'agentic' } };
const STATUS = (pageId) => ({ 'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: pageId, genie: true, model: 'x' }) });
const turnOf = (blocks, over = {}) => ({ turn_id: 'a'.repeat(32), state: 'done', steps: [], answer: '', error: '', confirm: null, refused: false, offers: null, next: [],
  conversation_id: '', actions: [], model: 'x', genie: null, blocks, ...over });
const clean = (errors) => errors.filter((e) => !/favicon|Failed to load resource/.test(e));

// The Work list reads its rows first, then the Genie button replaces it with the full-height chat.
async function openGenie(page) {
  await page.locator('.card--table tbody tr').first().waitFor({ state: 'visible' });
  await page.locator('[data-mode-switch] [data-mode="genie"]').click();
  await page.locator('[data-genie-full]').waitFor({ state: 'visible' });
}
const box = (page) => page.getByRole('textbox', { name: 'Your question' });
async function opened(info, routes, hash) {
  const pageId = info.pages[0].id;
  return openApp(browser, served.base, info, { routes: { ...STATUS(pageId), ...routes }, hash: hash || `#/${pageId}/work` });
}

// was: 'an agentic App opens on the Agent page, with the briefing, the box and the chips'
test('Genie mode of an agentic App shows the question box and the suggested questions', async () => {
  const info = appInfo(AGENTIC, 1, { questions: ['Which values break their expected range?', 'What is the value at stake?'] });
  const { page, seen, context } = await opened(info, {});
  try {
    await openGenie(page);
    assert.equal(await box(page).count(), 1, 'the question box is there');
    await page.locator('[data-genie-full] .g-sugg .sugg').first().waitFor();
    assert.ok(await page.getByRole('button', { name: 'Which values break their expected range?' }).count() === 1, 'the page question is a chip');
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: 'a Mark done on a briefing ticket asks for confirmation first, and writes only after Confirm'
test('a Mark done in an answer asks for confirmation first, and writes only after Confirm', async () => {
  const info = appInfo(AGENTIC);
  const pageId = info.pages[0].id;
  const calls = { act: 0, prepare: 0 };
  const routes = {
    'agent/ask': ({ json }) => json(200, turnOf([{ type: 'actions', record_keys: ['r-100'], actions: ['done', 'snooze'] }])),
    'agent/prepare': ({ json }) => { calls.prepare += 1; return json(200, { confirm: { action: 'done', label: 'Mark done', route: 'records/act', rows: [{ record_key: 'r-100', label: 'Unit A' }], values: {}, body: { page: pageId, record_keys: ['r-100'], seen: {}, values: {} } } }); },
    'records/act': ({ json }) => { calls.act += 1; return json(200, { written: ['r-100'], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b'.repeat(32) }); },
  };
  const { page, context } = await opened(info, routes);
  try {
    await openGenie(page);
    await box(page).fill('Mark Unit A done');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-block="actions"] [data-action="done"]').click();
    await page.locator('[data-confirm="ask"]').waitFor({ timeout: 10000 });
    await until(() => calls.prepare === 1, 5000);
    assert.equal(calls.act, 0, 'nothing is written before Confirm');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await until(() => calls.act === 1, 5000);
  } finally {
    await context.close();
  }
});

// was: 'a question renders its answer as blocks: text, a choice, a multi-select, a KPI and an email draft'
test('a question renders its answer as blocks: text, a choice, a multi-select, a KPI and an email draft', async () => {
  const info = appInfo(AGENTIC);
  const turn = turnOf([
    { type: 'text', markdown: 'Act on **Unit A** first.' },
    { type: 'choice', prompt: 'Which owner?', options: [{ id: 'ana', label: 'Ana', ask: 'Show the records for Ana' }, { id: 'bo', label: 'Bo' }] },
    { type: 'multi_select', prompt: 'Which units?', ask: 'Draft a note for', min: 1, max: 2, submit: 'Use these',
      options: [{ id: 'r-100', label: 'Unit A', detail: '$900k' }, { id: 'r-200', label: 'Unit B' }] },
    { type: 'kpi', kpi_id: 'loss', value: '$940k', value_at_stake: '', note: 'Across both units' },
    { type: 'email', to_label: 'Ana', subject: 'Unit A invoices', body: 'Hi Ana,\nPlease check Unit A.', copyable: true },
  ], { steps: [{ tool: 'find_records', text: 'Looked at 2 records of 2' }] });
  const { page, seen, context } = await opened(info, { 'agent/ask': ({ json }) => json(200, turn) });
  try {
    await openGenie(page);
    await box(page).fill('Tell me what to do');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-block="email"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-block="choice"] select').count(), 1, 'the decision is a dropdown');
    assert.equal(await page.locator('[data-block="multi_select"] input[type="checkbox"]').count(), 2, 'the choices are cards');
    assert.match(await page.locator('[data-block="text"]').innerText(), /Act on Unit A first\./);
    assert.match(await page.locator('[data-block="email"]').innerText(), /Unit A invoices/);
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: 'chart, KPI, table, carousel and feedback blocks render, and the carousel and feedback work' (the chart is its own test below)
test('KPI, table, carousel and feedback blocks render, and the carousel and feedback work', async () => {
  const info = appInfo(AGENTIC);
  const answered = [];
  const turn = turnOf([
    { type: 'kpi', kpi_id: 'total_loss', value: '$940,000', value_at_stake: '', note: 'Across both units' },
    { type: 'table', columns: ['category', 'value'], record_keys: ['r-100'], limit: 5, rows: [{ record_key: 'r-100', category: 'North', value: '900' }] },
    { type: 'carousel', items: [
      { type: 'ticket', record_key: 'r-100', label: 'Unit A', value_at_stake: '900000', status: 'Open', why: 'Overdue', tier: '', due: '' },
      { type: 'ticket', record_key: 'r-200', label: 'Unit B', value_at_stake: '40000', status: 'Open', why: 'Small', tier: '', due: '' },
    ] },
    { type: 'feedback' },
  ]);
  const routes = {
    'agent/ask': ({ json }) => json(200, turn),
    'agent/feedback': ({ json, route }) => { answered.push(route.request().postData()); return json(200, {}); },
  };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    await box(page).fill('Show me the loss');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-block="carousel"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-block="kpi"]').count(), 1, 'the KPI tile');
    assert.match(await page.locator('[data-block="kpi"]').innerText(), /\$940,000/);
    assert.equal(await page.locator('[data-block="table"] tbody tr').count(), 1, 'the table row');
    assert.match(await page.locator('[data-block="carousel"]').innerText(), /Unit A/);
    await page.getByRole('button', { name: 'Next record' }).click();
    assert.match(await page.locator('[data-block="carousel"]').innerText(), /Unit B/, 'the carousel moves to the next record');
    await page.locator('[data-block="feedback"]').getByRole('button', { name: 'Helpful', exact: true }).click();
    await until(() => answered.length === 1, 5000);
    assert.match(answered[0], /"rating":"POSITIVE"/);
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: the chart half of 'chart, KPI, table, carousel and feedback blocks render...'. The Genie chat gives a chart block no chart data
// (blocksCtx in src/Genie.jsx sets no `charts`, `app` or `themeKey`, which src/AgentBlocks.jsx:ChartBlock reads), so it stays on "Loading the chart".
test('a chart block in an answer is drawn', async () => {
  const info = appInfo(AGENTIC);
  const turn = turnOf([{ type: 'chart', chart_id: 'by_category', title: 'Loss over time', highlight_keys: [] }]);
  const routes = { 'agent/ask': ({ json }) => json(200, turn) };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    await box(page).fill('Show the loss over time');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-block="chart"]').waitFor({ timeout: 10000 });
    assert.match(await page.locator('[data-block="chart"]').innerText(), /Loss over time/);
    await page.locator('[data-block="chart"] canvas').first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-block="chart"] canvas').count(), 1, 'the chart is drawn');
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: 'an outlier page shows its kind question as the first chip, and clicking it asks that question'
test('a page shows its kind question as the first chip in Genie mode, and clicking it asks that question', async () => {
  const kindQuestion = 'Which values break their expected range, and which ones need someone to look?';
  const info = appInfo(AGENTIC, 1, { questions: [kindQuestion, 'Tell me what to do'] });
  const asked = [];
  const routes = {
    'agent/ask': ({ json, route }) => { asked.push(route.request().postData()); return json(200, turnOf([{ type: 'text', markdown: 'Two values are outside the range.' }])); },
  };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    const chip = page.locator('[data-genie-full] .g-sugg .sugg').first();
    assert.equal((await chip.innerText()).trim(), kindQuestion);
    await chip.click();
    await until(() => asked.length === 1, 5000);
    assert.match(asked[0], /break their expected range/);
    await page.locator('[data-block="text"]').waitFor({ timeout: 10000 });
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// Three records of one franchise, told apart only by their key (the label column is the franchise alone).
const SAME_LABEL = [
  { type: 'ticket', record_key: 'f-1 | 2024-05-19', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
  { type: 'ticket', record_key: 'f-1 | 2024-05-20', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
  { type: 'ticket', record_key: 'f-1 | 2024-05-21', label: 'Franchise 3000000', value_at_stake: '1700', tier: 'Act now', status: 'New', why: 'forecast gap', due: '' },
];

// was: 'three distinct records give three distinct cards on the Agent page, each showing its own key'
test('three distinct records give three distinct ticket cards in an answer, each showing its own key', async () => {
  const info = appInfo(AGENTIC);
  const routes = { 'agent/ask': ({ json }) => json(200, turnOf(SAME_LABEL)) };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    await box(page).fill('Which franchise is most overdue?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-ticket]').nth(2).waitFor({ timeout: 20000 });
    const keys = await page.locator('[data-ticket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ticket')));
    assert.equal(new Set(keys).size, 3, 'three cards for three records, not one record three times');
    const texts = await page.locator('[data-ticket]').evaluateAll((els) => els.map((e) => e.innerText));
    assert.equal(new Set(texts).size, 3, 'each card reads differently, so a person can tell them apart');
    assert.match(texts[0], /2024-05-19/);
    assert.match(texts[2], /2024-05-21/);
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: 'the Agent input takes typing while a question is still running, and Enter sends the next question'.
// The old "Wait for the current answer, then ask again" status line is gone: Send is disabled while Genie answers (PRODUCT GAP, reported).
test('the Genie input takes typing while a question is still running, Send waits, and Enter sends the next question', async () => {
  const info = appInfo(AGENTIC);
  const asked = [];
  const running = turnOf([], { state: 'running', steps: [{ tool: 'find_records', text: 'Looking' }] });
  const done = turnOf([{ type: 'text', markdown: 'Second question answered.' }]);
  let polls = 0;
  const routes = {
    'agent/ask': ({ json, route }) => { asked.push(JSON.parse(route.request().postData()).question); return json(200, asked.length === 1 ? running : done); },
    'agent/turn': ({ json }) => { polls += 1; return json(200, polls < 4 ? running : done); },
  };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    const input = box(page);
    await input.click();
    await input.pressSequentially('Which franchise is most overdue?');
    await input.press('Enter');
    await until(() => asked.length === 1, 5000);
    await page.locator('[data-genie-full] .g-step').waitFor({ timeout: 5000 });
    assert.equal(await input.isEnabled(), true, 'the input is not locked while the first question runs');
    await input.click();
    await input.pressSequentially('Then which one is largest?');
    assert.equal(await input.inputValue(), 'Then which one is largest?', 'typing lands in the box while a question is running');
    assert.equal(await page.getByRole('button', { name: 'Send' }).isDisabled(), true, 'Send waits for the running answer');
    await input.press('Enter');
    assert.equal(asked.length, 1, 'Enter during a running question does not send a second question');
    assert.equal(await input.inputValue(), 'Then which one is largest?', 'the typed question is kept, not dropped');
    await until(() => polls >= 4, 15000);
    await page.locator('[data-genie-full] .g-step').waitFor({ state: 'detached', timeout: 10000 });
    await input.press('Enter');
    await until(() => asked.length === 2, 5000);
    assert.equal(asked[1], 'Then which one is largest?');
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// was: 'the record link on an Agent page card opens that record, with its own key'
test('the record link on a ticket card in an answer opens that record, with its own key', async () => {
  const info = appInfo(AGENTIC);
  const routes = { 'agent/ask': ({ json }) => json(200, turnOf(SAME_LABEL)) };
  const { page, seen, context } = await opened(info, routes);
  try {
    await openGenie(page);
    await box(page).fill('Which franchise is most overdue?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('[data-ticket]').nth(1).waitFor({ timeout: 20000 });
    await page.locator('[data-ticket]').nth(1).getByRole('button', { name: 'Franchise 3000000' }).click();
    await until(() => new URL(page.url()).hash.includes('rec='), 5000);
    const rec = new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '').get('rec');
    assert.equal(rec, 'f-1 | 2024-05-20', 'the link opens the record it sits on, not undefined');
    assert.deepEqual(clean(seen.errors), [], 'no page errors');
  } finally {
    await context.close();
  }
});

// Deleted: 'saved conversations list the person's threads, and a thread opens to its answers'. No equivalent: the Agent page's saved-conversations
// list (agent/threads, details.agp-saved) is not in the new design; src/api.js still has agentThreads but nothing calls it.
