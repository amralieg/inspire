import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, FILTERS, openApp, pageData, serveDist } from './harness.mjs';
import { groupsOf } from '../src/filters.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const TIERS = ['Act now', 'Review', 'Monitor'];
const ACTIONS = Array.from({ length: 61 }, (_, i) => `Action ${String(i).padStart(2, '0')}`);
const COLUMNS = {
  list: [{ column: 'priority_tier', type: 'multi_select', label: 'Tier', options: TIERS, searchable: false }],
  tables: {},
};

function lister({ route, json, seen }) {
  const body = route.request().postDataJSON();
  seen.records.push(body);
  const rows = pageData(body.filters).records.rows;
  return json(200, { rows, total: rows.length, offset: 0, limit: body.limit || 25, actions: false, changes: false, summary: null, errors: {} });
}

test('the group list is one list: the top bar and the Work list read the same groups, and high-cardinality groups sit behind More filters', () => {
  const meta = { filters: FILTERS.filters, columns: { list: COLUMNS.list, tables: { t: [{ column: 'recommended_action', label: 'Recommended action', type: 'multi_select', options: ACTIONS, searchable: true }] } } };
  const groups = groupsOf(meta);
  const labels = groups.map((g) => [g.label, g.high]);
  assert.deepEqual(labels.filter(([, high]) => !high).map(([l]) => l), ['Category', 'Channel', 'Region', 'Tier'], 'low-cardinality groups come first');
  assert.deepEqual(labels.filter(([, high]) => high).map(([l]) => l), ['Recommended action'], 'the 61-value group is behind More filters');
  assert.equal(groupsOf({ filters: FILTERS.filters, columns: { list: [{ column: 'category', type: 'multi_select', label: 'Category', options: [] }], tables: {} } })
    .filter((g) => g.label === 'Category').length, 1, 'a group named like a page filter is shown once');
});

test('the top bar shows the same Tier group the Work list filters on, and More filters opens the high-cardinality groups', async () => {
  const info = appInfo({}, 1, {});
  const table = info.pages[0].tables?.[0]?.id || 'channel_actions';
  const columns = { list: COLUMNS.list, tables: { [table]: [{ column: 'recommended_action', label: 'Recommended action', type: 'multi_select', options: ACTIONS, searchable: true }] } };
  const routes = { filters: ({ json }) => json(200, { ...FILTERS, columns }), records: lister };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, hash: `#/${info.pages[0].id}/dashboard` });
  const bar = page.locator('section.fbar');
  await bar.waitFor();
  const top = await bar.locator('.fld > span').allTextContents();
  assert.ok(top.some((t) => t.trim().toUpperCase() === 'TIER'), `the top bar offers Tier: ${top.join(' | ')}`);
  assert.ok(!top.some((t) => t.trim().toUpperCase() === 'RECOMMENDED ACTION'), 'the 61-value group is not inline');
  await page.getByRole('button', { name: /More filters \(1\)/ }).click();
  await bar.locator('.fld > span', { hasText: /Recommended action/i }).first().waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});
