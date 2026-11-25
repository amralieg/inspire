// REQ-535 (D-UX-3, D-UX-5): the Genie answer log and its input share one centre line, notices fold into one chip, and a ranked answer reads as steps.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { NO_JOB, TABLE, appInfo, openApp, serveDist, until } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const WIDE = Array.from({ length: 14 }, (_, i) => `measure_number_${i}`);
const COLUMNS = [{ name: 'product', type: 'STRING' }, ...WIDE.map((name) => ({ name, type: 'DOUBLE' }))];
const ROWS = ['Alpha', 'Beta', 'Gamma'].map((product, i) => ({ product, ...Object.fromEntries(WIDE.map((name, j) => [name, (3 - i) * 1000000 + j])) }));
const ACTIVE = { run_id: '9', result: 'running', state: 'running', started: new Date(Date.now() - 60000).toISOString(), stage: 'Running the use case', stage_index: 2, stage_total: 5, rows_done: null, rows_total: null, percent: null, eta_s: null, silent_since: null, source: 'marker' };
const UNKNOWN_RUN = { run_id: '8', status: 'mystery', trigger: 'refresh', by: '' };

function routes(extra = {}) {
  let polls = 0;
  return {
    'genie/ask': ({ json }) => { polls = 0; return json(200, { conversation_id: 'c1', message_id: 'm1' }); },
    'genie/message': ({ json }) => {
      polls += 1;
      if (polls < 2) return json(200, { state: 'running', step: 'Writing the SQL' });
      return json(200, { state: 'done', text: 'Alpha leads.', sql: 'SELECT 1', columns: COLUMNS, rows: ROWS, truncated: false });
    },
    ...extra,
  };
}

async function ask(width, extra) {
  const opened = await openApp(browser, served.base, appInfo({}, 1, TABLE), { width, height: 900, genie: 'open', routes: routes(extra) });
  const { page } = opened;
  const panel = page.locator('[data-genie-full]');
  await panel.waitFor({ state: 'visible', timeout: 20000 });
  await panel.getByLabel('Your question').fill('Which products gained most?');
  await panel.getByRole('button', { name: 'Send' }).click();
  await panel.locator('.msg--genie .msg-t').waitFor({ timeout: 20000 });
  return { ...opened, panel };
}

for (const width of [1440, 2000]) {
  test(`REQ-535: at ${width}px the answer log and the input share one centre line, at most 780px wide`, async () => {
    const { page, context, panel } = await ask(width);
    try {
      const box = async (sel) => panel.locator(sel).first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      });
      const frame = await panel.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
      const log = await box('.g-in').then(async (input) => ({ input, answer: await box('.msg--genie .msg-b') }));
      const gap = (b) => ({ left: b.left - frame.left, right: frame.right - b.right });
      const a = gap(log.input);
      assert.ok(Math.abs(a.left - a.right) < 8, `input sits on the centre line: ${JSON.stringify(a)}`);
      assert.ok(log.input.width <= 780, `input width ${log.input.width}`);
      const col = await panel.locator('[data-genie-column]').first().evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
      const c = gap(col);
      assert.ok(Math.abs(c.left - c.right) < 8, `answer column sits on the centre line: ${JSON.stringify(c)}`);
      assert.ok(Math.abs(c.left - a.left) < 8, `answer column and input share the left edge: ${c.left} vs ${a.left}`);
      assert.ok(col.width <= 780, `answer column width ${col.width}`);
      assert.ok(log.answer.right <= col.right + 1, 'the answer stays inside the column');
    } finally {
      await context.close();
    }
  });
}

test('REQ-535: a wide table scrolls inside its card, never past the column', async () => {
  const { page, context, panel } = await ask(1440);
  try {
    const m = await panel.locator('.msg--genie .msg-t').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, over: getComputedStyle(el).overflowX }));
    assert.ok(m.scroll > m.client, `the table is wider than its card (${m.scroll} vs ${m.client})`);
    assert.ok(['auto', 'scroll'].includes(m.over), `the card scrolls: ${m.over}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the page does not scroll sideways');
  } finally {
    await context.close();
  }
});

test('REQ-535: the grey notice lines fold into one info chip and the "Not recorded" run line is hidden', async () => {
  const { page, context, panel } = await ask(1440, {
    freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, active: ACTIVE }),
  });
  try {
    await until(async () => (await panel.locator('[data-notices]').count()) > 0);
    assert.equal(await panel.locator('[data-notices]').count(), 1, 'one notice chip');
    assert.equal(await panel.locator('.g-note').count(), 0, 'no grey notice lines are left');
    assert.match(await panel.locator('[data-notices]').innerText(), /Step 2 of 5/, 'the chip still carries the build step');
  } finally {
    await context.close();
  }
});

test('REQ-535: a run line that says "Not recorded" is not shown', async () => {
  const { page, context, panel } = await ask(1440, {
    freshness: ({ json }) => json(200, { ...NO_JOB, has_job: true, last_run: UNKNOWN_RUN }),
  });
  try {
    await page.waitForTimeout(800);
    assert.doesNotMatch(await panel.innerText(), /Latest run[^\n]*Not recorded/, 'the run line with no status is hidden');
  } finally {
    await context.close();
  }
});
