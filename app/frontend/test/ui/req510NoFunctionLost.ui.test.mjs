// REQ-510 G5 "no function lost": every function of the REQ-509 checklist (wireframes/req509_coverage.md, F-ids) that the declutter
// touches stays reachable with at most one extra click. Rows marked 'main' must stay visible controls (must-keep: they pass on
// a037bfdfb and must keep passing). Rows marked 'more', { menu } or { disclose } are the moved functions: they fail on a037bfdfb
// because the More menus do not exist yet, and pass once each lane moves the function (and removes the inline copy).
// Rows without an F-id (N-*) are functions the REQ-509 checklist does not list; they are named here so they cannot be dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { reachable } from './req510Declutter.mjs';

test.after(closeBrowser);

const monitorMount = (app) => {
  app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: new Date().toISOString(),
    completed_percent: 40, completed_on: null, last_updated: new Date().toISOString(), processing_status: 'processing' } }));
  app.get('/api/inspire/steps', (_req, res) => res.json({ steps: [] }));
  app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
  app.get('/api/run/777', (_req, res) => res.json({ run_id: 777, run_name: 'Inspire Discover', life_cycle_state: 'RUNNING', start_time: Date.now(), tasks: [] }));
};

const b = (name) => ({ role: 'button', name });
const ROW42 = { menu: /^More for /, scope: '[data-run="42"]' };
const ROW51 = { menu: /^More for /, scope: '[data-run="51"]' };
const CARD = { menu: /^More for /, scope: '[data-use-case-no="N01-U01"]' };

// [screen, open id, state, opts, ready selector, must-keep rows, moved rows]
const SCREENS = [
  ['Home', 'landing', {}, {}, 'h1', [
    ['F012', b(/^Get Started$/), 'main'],
  ], []],
  ['Start', 'choose', { sessions: REVIEW_SESSIONS }, {}, '[data-run="42"]', [
    ['F066', b(/I have data in Unity Catalog/), 'main'],
  ], [
    ['F069', { role: 'menuitem', name: 'View all runs' }, 'more'],
    ['N-value-all-runs', { role: 'menuitem', name: 'Value across all runs' }, 'more'],
    ['F074', { role: 'menuitem', name: 'Download profile' }, ROW42],
    ['F075', { role: 'menuitem', name: 'Go to Build' }, ROW42],
    ['F077', { role: 'menuitem', name: 'Delete run' }, ROW42],
    ['F076', { role: 'menuitem', name: 'Quick view' }, ROW51],
  ]],
  ['Launch', 'launch', {}, {}, 'h1', [
    ['F118', b(/^Get Started$/), 'main'],
    ['F092', { role: 'textbox', name: /Business Name|Acme Corp/i }, 'main'],
  ], [
    ['F088', { role: 'menuitem', name: 'Recent runs' }, 'more'],
    ['N-privacy', { role: 'menuitem', name: 'How Inspire keeps your data private' }, 'more'],
  ]],
  ['Generate data', 'generate', {}, {}, 'h1', [
    ['F086', b(/^Generate data & run Inspire$/), 'main'],
    ['F080', b(/^Back$/), 'main'],
  ], []],
  ['Monitor', 'monitor', {}, { mount: monitorMount }, 'h1', [
    ['F193', b(/Stop this run/), 'main'],
  ], [
    ['F190', { role: 'menuitem', name: 'Run log' }, 'more'],
  ]],
  ['Review', 'results', REVIEW_STATE, {}, '[data-use-case-no="N01-U01"]', [
    ['F211', { role: 'textbox', name: /Search/i }, 'main'],
    ['F220', { role: 'combobox', name: 'Sort' }, 'main'],
    ['F200', b(/^Active/), 'main'],
  ], [
    ['F219', { role: 'combobox', name: 'Value' }, { disclose: /^More filters/ }],
    ['F249', { role: 'button', name: /^Rename / }, 'main'],
    ['F243', { role: 'button', name: 'Move this row to Archived' }, 'main'],
  ]],
  ['Build', 'implement', { useCase: HARNESS_USE_CASE }, {}, 'h1', [
    ['F307', { role: 'searchbox', name: 'Search use cases' }, 'main'],
  ], [
    ['F314', { role: 'menuitem', name: 'Use case details' }, { menu: /^More$/, scope: '[aria-label="Use case"]' }],
  ]],
  ['Run', 'run', REVIEW_STATE, {}, 'h1', [
    ['F457', b(/deployed use cases again/), 'main'],
  ], []],
  ['Build wizard', 'wizard', {}, {}, '[role="dialog"] button', [
    ['F343', b(/^Back$/), 'main'],
    ['F344', b(/^Next$/), 'main'],
  ], []],
];

async function walk(open, state, opts, ready, rows) {
  const ui = await openUi(open, state, '', opts);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(ready).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const misses = [];
    for (const row of rows) {
      const miss = await reachable(page, row);
      if (miss) misses.push(miss);
    }
    return misses;
  } finally {
    await ui.close();
  }
}

for (const [screen, open, state, opts, ready, keep, moved] of SCREENS) {
  test(`${screen}: must-keep functions stay visible (${keep.map((r) => r[0]).join(', ')})`, async () => {
    const misses = await walk(open, state, opts, ready, keep);
    assert.deepEqual(misses, [], misses.join('\n'));
  });
  if (moved.length) {
    test(`${screen}: moved functions are one click away in More (${moved.map((r) => r[0]).join(', ')})`, async () => {
      const misses = await walk(open, state, opts, ready, moved);
      assert.deepEqual(misses, [], misses.join('\n'));
    });
  }
}
