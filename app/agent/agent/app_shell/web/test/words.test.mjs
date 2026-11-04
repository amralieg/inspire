import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axisValue, cellText, compact, entityName, formatValue, isCountable, plainChart, plainWords, storyPieces, wholeFormat } from '../src/format.js';
import { columnLabel } from '../src/records.js';
import { paceText } from '../src/genieAsk.js';

const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('an id the user acts on shows the name from its own row, or a readable label when the row has no name', () => {
  assert.equal(entityName({ franchise_id: 3000046, franchise_name: 'Golden Gate Bakery' }, 'franchise_id'), 'Golden Gate Bakery');
  assert.equal(entityName({ franchiseID: '3000046', franchise: 'Sunset Shop' }, 'franchiseID'), 'Sunset Shop');
  assert.equal(entityName({ store_key: 41, store_name: '', store: 'Harbor Store' }, 'store_key'), 'Harbor Store');
  assert.equal(entityName({ franchise_id: 3000046 }, 'franchise_id'), 'Franchise 3000046');
  assert.equal(entityName({ id: 7, name: 'Main warehouse' }, 'id'), 'Main warehouse');
  assert.equal(entityName({ customer_id: 12, region_name: 'North' }, 'customer_id'), 'Customer 12', 'a name of another entity is never taken');
  assert.equal(entityName({ customer_id: 12, customer_name: 99 }, 'customer_id'), 'Customer 12', 'a number is not a name');
  assert.equal(entityName({ sku: 'SKU-881' }, 'sku'), 'SKU-881', 'an id that already reads as words stays');
  assert.equal(entityName({ product: 'Golden Gate Ginger' }, 'product'), 'Golden Gate Ginger');
  assert.equal(entityName({}, 'franchise_id'), '');
});

test('a countable quantity shows whole units, a rate or an average keeps its decimals', () => {
  assert.equal(isCountable('Planned bake units'), true);
  assert.equal(isCountable('P50_BAKE_UNITS'), true);
  assert.equal(isCountable('orderCount'), true);
  assert.equal(isCountable('Average units per order'), false);
  assert.equal(isCountable('Revenue'), false);
  assert.equal(isCountable('backtest_mase'), false);
  assert.equal(formatValue(112.996, wholeFormat('number', 'Planned bake units')), '113');
  assert.equal(formatValue(20.93, wholeFormat(undefined, 'P50 bake units')), '21');
  assert.equal(formatValue(2.45, wholeFormat('number', 'Average units per order')), '2.45');
  assert.equal(wholeFormat('currency', 'Units'), 'currency');
  assert.equal(cellText(20.93, { column: 'p50_bake_units', format: 'number' }), '21');
  assert.equal(cellText(50.7, { column: 'p90_hold_units', type: 'DOUBLE' }), '51');
  assert.equal(cellText(0.38, { column: 'forecast_error', format: 'number' }), '0.38');
  assert.equal(cellText(3000046, { column: 'franchise_id', type: 'BIGINT' }), '3000046');
  assert.equal(compact(112.996), '113', 'a value that rounds to a whole number shows no .00');
  assert.equal(compact(20.5), '20.5');
});

test('a KPI in the headline story shows whole units for a countable measure', () => {
  const kpi = { id: 'planned', label: 'Planned bake units', format: 'number', words: { story_none: 'no earlier run' } };
  const text = storyPieces('The plan calls for {planned} bake units.', [kpi], { planned: { now: 112.996 } }).map((p) => p.text).join('');
  assert.equal(text, 'The plan calls for 113 bake units.');
});

test('statistics jargon and column codes read as plain words in every header', () => {
  assert.equal(plainWords('P50_BAKE_UNITS'), 'Likely bake units');
  assert.equal(plainWords('P90 hold units'), 'High case hold units');
  assert.equal(plainWords('p10_demand'), 'Low case demand');
  assert.equal(plainWords('Error (MASE)'), 'Forecast error vs a simple guess');
  assert.equal(plainWords('backtest_mase'), 'Backtest forecast error vs a simple guess');
  assert.equal(plainWords('DATA_QUALITY_FLAG'), 'Data quality flag');
  assert.equal(plainWords('franchiseID'), 'Franchise id');
  assert.equal(plainWords('Upper quantile'), 'Upper range');
  assert.equal(plainWords('Revenue at risk'), 'Revenue at risk', 'a label already in words stays as it is');
  assert.equal(plainWords('Q3 2024'), 'Q3 2024');
  assert.equal(columnLabel('p50_bake_units', { columns: [] }), 'Likely bake units');
  assert.equal(columnLabel('x', { columns: [{ column: 'x', label: 'P90 hold units' }] }), 'High case hold units');
  const chart = plainChart({ type: 'line', x: { label: 'run_date' }, y: [{ label: 'P50_BAKE_UNITS', format: 'number' }, { label: 'Revenue', format: 'currency' }] });
  assert.deepEqual(chart.y.map((y) => [y.label, y.format]), [['Likely bake units', 'integer'], ['Revenue', 'currency']]);
  assert.equal(chart.x.label, 'Run date');
});

test('axis labels keep one decimal so 1.2K and 1.4K do not both read 1K', () => {
  const labels = [2000, 1800, 1600, 1400, 1200, 1000, 800, 600].map((v) => axisValue(v, 'number'));
  assert.equal(new Set(labels).size, labels.length, labels.join(', '));
  assert.equal(axisValue(1000, 'number'), '1K');
  assert.equal(axisValue(1200, 'currency', 'USD'), '$1.2K');
});

test('the first step and every record title name the entity, not its id', () => {
  assert.match(src('Layouts.jsx'), /Start with \$\{entityName\(first, label\) \|\| recordKeyOf\(first\)\}/);
  const records = src('Records.jsx');
  assert.match(records, /export const recordName = \(row, meta\) => entityName\(row, meta\?\.label\);/);
  assert.doesNotMatch(records, /plainText\((r|row|doomed)\[meta\.label\]\)/);
});

test('the first-run scope shows once above the key numbers, not under every KPI', () => {
  const kpis = src('Kpis.jsx');
  assert.equal((kpis.match(/scope\?\.text &&/g) || []).length, 1);
  assert.match(kpis, /data-scope-banner/);
  assert.doesNotMatch(kpis.slice(kpis.indexOf('entries.map')), /kpi-scope/);
});

test('a Genie answer that is still running says how long it has taken and how long answers usually take', () => {
  assert.equal(paceText(12.4), '12 s so far: answers usually take 20 to 90 seconds');
  assert.equal(paceText(95), '95 s: longer than usual, Genie keeps working for up to 3 minutes');
  assert.equal(paceText(181), '181 s: Genie stops at 3 minutes');
  assert.match(src('Genie.jsx'), /<Pace since=\{m\.n\} \/>/);
  assert.match(src('Genie.jsx'), /label: plainWords\(c\.name\)/);
});

test('a list where every row is low confidence says so once, with why and what would raise it', async () => {
  const { quietList, RAISE_CONFIDENCE } = await import('../src/records.js');
  const meta = { action: 'recommended_action' };
  const row = (level, action = 'No action this cycle', reason = 'the forecast did not beat a simple guess') => ({ _inspire_confidence_level: level, recommended_action: action, ai_confidence_reason: reason });
  const all = Array.from({ length: 48 }, () => row('Low'));
  const out = quietList(all, meta);
  assert.equal(out.title, 'All 48 rows on this list are low confidence, so the suggested action on each one is “No action this cycle”.');
  assert.equal(out.why, 'Why: the forecast did not beat a simple guess');
  assert.equal(out.raise, RAISE_CONFIDENCE);
  assert.equal(quietList([...all.slice(0, 5), row('High')], meta), null, 'one confident row keeps the list as it is');
  assert.equal(quietList(all.slice(0, 2), meta), null, 'two rows are too few to call a wall');
  assert.equal(quietList([row('Low'), row('Low', 'Bake 20'), row('Low')], meta).title, 'All 3 rows on this list are low confidence.');
  assert.equal(quietList([], meta), null);
  assert.match(src('Records.jsx'), /data-quiet-list/);
});

test('a list nobody owns offers one click to take its open records, and never when someone already owns one', async () => {
  const { claimTarget, claimText } = await import('../src/records.js');
  const row = (key, owner = '', status = 'New') => ({ record_key: key, _inspire_version: `17${key}`, _inspire_owner: owner, _inspire_status: status });
  assert.deepEqual(claimTarget([row('a'), row('b'), row('c', '', 'Done')], 'me@x.com'), { record_keys: ['a', 'b'], seen: { a: '17a', b: '17b' } });
  assert.equal(claimTarget([row('a'), row('b', 'sam@x.com')], 'me@x.com'), null);
  assert.equal(claimTarget([row('a')], ''), null);
  assert.equal(claimTarget([], 'me@x.com'), null);
  assert.equal(claimTarget([row('a'), row('b'), row('c')], 'me@x.com', 2).record_keys.length, 2);
  assert.match(claimText(48), /Take the 48 on this page/);
  assert.match(src('Records.jsx'), /actOn\(\{ action_owner: person \}/);
  assert.match(src('Home.jsx'), /Assign them to me/);
});
