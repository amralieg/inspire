// REQ-506 lane 4 (value and leaders): the value chip "+$3,000 · #2 of 9" next to the avatar, "Value not set" when there is no basis,
// and a leaderboard where the viewer sees their own name and every other person as User 1, User 2 (Amr, 2026-11-23).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';
import * as words from '../src/valueCounter.js';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const DISCLAIMER = { short: 'Unverified estimate', full: 'A specialist must verify every number.' };
const COUNTER = {
  shown: true, case_noun: 'record', per_case: 1000, currency: 'USD', status: 'calculated', cases_from: 'your data', saved_at: '2026-11-20 10:00:00',
  amount: 1000000, cases_per_year: 1000, mine: { cases: 3, value: 3000 }, team: { cases: 10, value: 10000 }, streak_weeks: 0, badges: [], next_badge: null,
  disclaimer: DISCLAIMER,
};
const LEADERS = {
  shown: true, currency: 'USD', people: 9, me: { rank: 2, value: 3000, records: 3 },
  leaders: [
    { rank: 1, name: 'User 1', value: 9000, records: 5, me: false },
    { rank: 2, name: 'pat.lee', value: 3000, records: 3, me: true },
    { rank: 3, name: 'User 2', value: 2000, records: 2, me: false },
  ],
};

test('chipLines reads the value and the rank in a few characters', () => {
  assert.equal(typeof words.chipLines, 'function', 'valueCounter.js exports chipLines');
  assert.deepEqual(words.chipLines(COUNTER, LEADERS), { value: '+$3,000', rank: '#2 of 9', set: true });
  assert.deepEqual(words.chipLines(COUNTER, null), { value: '+$3,000', rank: '', set: true }, 'no board yet: the value alone');
  assert.deepEqual(words.chipLines(COUNTER, { ...LEADERS, me: { rank: null, value: 0, records: 0 } }), { value: '+$3,000', rank: '', set: true });
  assert.deepEqual(words.chipLines({ shown: false }, null), { value: 'Value not set', rank: '', set: false });
  assert.deepEqual(words.chipLines(null, null), { value: 'Value not set', rank: '', set: false });
  assert.deepEqual(words.chipLines({ ...COUNTER, mine: null }, null), { value: '+$0', rank: '', set: true }, 'a viewer with no email still sees a chip');
});

const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ValueChip } from ${JSON.stringify(join(SRC, 'ValueCounter.jsx'))};
createRoot(document.getElementById('root')).render(h(ValueChip, { page: { id: 'n01_u05' } }));
`;
let bundle;
const chip = async () => (bundle ||= await bundleEntry(ENTRY));

function routes(counter, leaders) {
  const asked = [];
  return {
    asked,
    routes: {
      'value/counter': ({ route, json }) => { asked.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search); return json(200, counter); },
      'value/leaders': ({ route, json }) => { asked.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search); return json(200, leaders); },
    },
  };
}

test('the chip shows my value and my rank, and opens the board with my name and User N for everyone else', async () => {
  const { asked, routes: r } = routes(COUNTER, LEADERS);
  const { page, context, errors } = await openBundle(browser, await chip(), {}, r);
  try {
    const box = page.locator('[data-value-chip]');
    await box.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-chip-rank]')?.textContent.trim() === '#2 of 9');
    assert.equal((await box.locator('[data-chip-value]').innerText()).trim(), '+$3,000');
    assert.ok(asked.some((p) => p.endsWith('/api/value/leaders?page=n01_u05')), `the board is read for this page: ${JSON.stringify(asked)}`);
    await box.click();
    const rows = page.locator('[data-leader]');
    await rows.first().waitFor({ state: 'visible' });
    assert.equal(await rows.count(), 3);
    assert.deepEqual((await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().split(' ')[1]), ['User', 'pat.lee', 'User']);
    assert.equal(await page.locator('[data-leader][data-me]').count(), 1, 'my row is marked');
    assert.ok((await page.locator('[data-leader][data-me]').innerText()).includes('pat.lee'));
    assert.ok((await rows.nth(0).innerText()).includes('User 1') && (await rows.nth(2).innerText()).includes('User 2'));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('with no value basis the chip says Value not set instead of vanishing, and shows no rank', async () => {
  const { routes: r } = routes({ shown: false }, { shown: false });
  const { page, context, errors } = await openBundle(browser, await chip(), {}, r);
  try {
    const box = page.locator('[data-value-chip]');
    await box.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-chip-value]')?.textContent.trim() === 'Value not set');
    assert.equal((await box.locator('[data-chip-rank]').count()) === 0 || (await box.locator('[data-chip-rank]').innerText()).trim() === '', true);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a failed read still shows the chip, as Value not set', async () => {
  const r = { 'value/counter': ({ json }) => json(500, { error: 'boom' }), 'value/leaders': ({ json }) => json(500, { error: 'boom' }) };
  const { page, context } = await openBundle(browser, await chip(), {}, r);
  try {
    await page.waitForFunction(() => document.querySelector('[data-chip-value]')?.textContent.trim() === 'Value not set');
  } finally {
    await context.close();
  }
});
