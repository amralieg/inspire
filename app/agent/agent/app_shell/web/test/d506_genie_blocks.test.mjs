// REQ-506 lane 3 (agentic Genie): the one Genie chat asks as the agent and shows rich blocks (compare, resolve, tickets) with buttons, few words.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, actBody, appInfo, openApp, serveDist, tracked, until } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PAGE = 'n01_u05';
const COMPARE = {
  type: 'compare', title: 'Two ways to fix Item 1',
  options: [
    { id: 'cut', label: 'Cut the discount', detail: 'Faster', facts: [{ label: 'Value', value: '$2,340' }, { label: 'Effort', value: 'Low' }], ask: 'Cut the discount on Item 1' },
    { id: 'move', label: 'Move the stock', detail: 'Slower', facts: [{ label: 'Value', value: '$1,900' }, { label: 'Effort', value: 'High' }], ask: 'Move the stock of Item 1' },
  ],
};
const RESOLVE = { type: 'resolve', record_key: 'R001', label: 'Item 1', value_at_stake: '$2,340', status: 'Open' };
const TICKET = { type: 'ticket', record_key: 'R002', label: 'Item 2', value_at_stake: '$900', tier: 'Act now', status: 'Open', why: 'Deep discount', due: '' };
const TURN = {
  turn_id: 't1', state: 'done', answer: 'Two ways to fix Item 1.', steps: [{ tool: 'render_answer', text: 'Showed 3 blocks' }], actions: [], confirm: null,
  genie: null, next: [], offers: null, blocks: [COMPARE, RESOLVE, TICKET], model: 'system.ai.claude-sonnet-4-6', refused: false, conversation_id: 'c1', error: '',
};
const PREPARED = { confirm: { action: 'done', label: 'Mark done', route: 'records/act', values: { action_status: 'Done' }, rows: [{ record_key: 'R001', label: 'Item 1' }],
  body: { page: PAGE, record_keys: ['R001'], seen: { R001: '100' }, values: { action_status: 'Done' } } } };

function genieRoutes(turn = TURN) {
  const calls = { asks: [], prepared: [] };
  const { calls: acted, routes } = tracked({
    'agent/status': ({ json }) => json(200, { mode: 'agent', note: '', page: PAGE, genie: true, model: 'system.ai.claude-sonnet-4-6' }),
    'agent/ask': ({ route, json }) => { calls.asks.push(route.request().postDataJSON()); return json(200, { ...turn, state: 'running', blocks: [], answer: '' }); },
    'agent/turn': ({ json }) => json(200, turn),
    'agent/prepare': ({ route, json }) => { calls.prepared.push(route.request().postDataJSON()); return json(200, PREPARED); },
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      acted.acts.push(body);
      return json(200, { written: body.record_keys, conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b'.repeat(32) });
    },
  });
  return { calls, acted, routes };
}

// Opens Genie the way the shell offers it: the Screen | Genie switch (lane 1) when it is there, else the Ask Genie button.
async function openGenie(page) {
  const mode = page.locator('[data-mode-switch] [data-mode="genie"]');
  if (await mode.count()) await mode.click();
  else await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
}

async function ask(page, question) {
  await openGenie(page);
  await page.getByRole('textbox', { name: 'Your question' }).fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

const open = (routes) => openApp(browser, served.base, appInfo({ ...DECIDE }), { routes, hash: `#/${PAGE}/work`, ready: '[data-ready]' });

test('the Genie chat asks as the agent surface and draws the typed blocks of the turn', async () => {
  const { calls, routes } = genieRoutes();
  const { page, context, seen } = await open(routes);
  try {
    await ask(page, 'How do I fix Item 1?');
    const genie = page.locator('aside.genie');
    await genie.locator('[data-block="compare"]').waitFor({ state: 'visible' });
    assert.equal(calls.asks[0].surface, 'agent', 'the panel asks for the agentic surface');
    assert.equal(await genie.locator('[data-block="resolve"]').count(), 1);
    assert.equal(await genie.locator('[data-block="ticket"]').count(), 1, 'the existing block catalog renders inside Genie');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a compare block shows the options side by side with their facts, and an option button asks its follow-up', async () => {
  const { calls, routes } = genieRoutes();
  const { page, context, seen } = await open(routes);
  try {
    await ask(page, 'How do I fix Item 1?');
    const card = page.locator('[data-block="compare"]');
    await card.waitFor({ state: 'visible' });
    const options = card.locator('[data-option]');
    assert.equal(await options.count(), 2);
    assert.deepEqual(await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-option'))), ['cut', 'move']);
    const [a, b] = await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    assert.ok(Math.abs(a.top - b.top) < 4 && b.left > a.left, 'the options sit side by side');
    assert.ok((await options.nth(0).innerText()).includes('$2,340') && (await options.nth(1).innerText()).includes('$1,900'), 'each option shows its facts');
    await options.nth(1).getByRole('button', { name: 'Move the stock' }).click();
    await until(() => calls.asks.length === 2);
    assert.equal(calls.asks[1].question, 'Move the stock of Item 1');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a resolve block shows the record and its value; one click resolves it and shows what the business gained', async () => {
  const { calls, acted, routes } = genieRoutes();
  const { page, context, seen } = await open(routes);
  try {
    await ask(page, 'How do I fix Item 1?');
    const card = page.locator('[data-block="resolve"]');
    await card.waitFor({ state: 'visible' });
    assert.ok((await card.innerText()).includes('Item 1'));
    const button = card.getByRole('button', { name: /^Resolve/ });
    assert.match((await button.innerText()).trim(), /^Resolve\s*\+\$2,340$/);
    await button.click();
    await until(() => acted.acts.length === 1);
    assert.deepEqual(calls.prepared, [{ page: PAGE, action: 'done', record_keys: ['R001'] }]);
    assert.deepEqual(acted.acts[0], PREPARED.confirm.body, 'the write is the prepared change, nothing the model wrote');
    await card.locator('[data-gained]').waitFor({ state: 'visible' });
    assert.match((await card.locator('[data-gained]').innerText()).trim(), /\+\$2,340/);
    assert.equal(calls.asks.length, 1, 'the click sends no second question');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('block text is shown as text, never as markup', async () => {
  const evil = { ...COMPARE, options: [{ ...COMPARE.options[0], label: '<img src=x onerror="window.hit=1">Cut' }, COMPARE.options[1]] };
  const { routes } = genieRoutes({ ...TURN, blocks: [evil] });
  const { page, context } = await open(routes);
  try {
    await ask(page, 'How do I fix Item 1?');
    await page.locator('[data-block="compare"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-block="compare"] img').count(), 0);
    assert.equal(await page.evaluate(() => window.hit), undefined);
  } finally {
    await context.close();
  }
});
