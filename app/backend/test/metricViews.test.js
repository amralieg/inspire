// rc13 metric views (REQ-128): a metric view is not a table. The App's listing, the tree counts and the schema reads leave
// it out; the route's SQL fallback cannot re-add it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/metricViews');
const U = require('../lib/ucReads');

const ROOT = path.resolve(__dirname, '..');

test('a metric view is recognised by its table type, in either spelling, and kept tables are untouched', () => {
  assert.equal(M.isMetricViewType('METRIC_VIEW'), true);
  assert.equal(M.isMetricViewType('metric view'), true);
  assert.equal(M.isMetricViewType('MANAGED'), false);
  assert.equal(M.isMetricViewType('VIEW'), false);
  const { kept, skipped } = M.splitMetricViews([{ t: 'MANAGED' }, { t: 'METRIC_VIEW' }, { t: 'VIEW' }], (x) => x.t);
  assert.deepEqual(kept, [{ t: 'MANAGED' }, { t: 'VIEW' }]);
  assert.deepEqual(skipped, [{ t: 'METRIC_VIEW' }]);
});

test('the skip line names the count and the metric views left out', () => {
  assert.equal(M.metricViewSkipLine(['main.s.a', 'main.s.b']), '[METRIC-VIEW SKIPPED] 2 metric views left out: main.s.a, main.s.b');
});

test('the table listing returns the tables without the metric views, and names the metric views it left out', async () => {
  const body = {
    tables: [
      { name: 'orders', full_name: 'main.s.orders', table_type: 'MANAGED' },
      { name: 'customer_value_metrics', full_name: 'main.s.customer_value_metrics', table_type: 'METRIC_VIEW' },
    ],
  };
  const dbFetch = async () => ({ ok: true, text: async () => JSON.stringify(body) });
  const logged = [];
  const log = console.log;
  console.log = (line) => logged.push(String(line));
  try {
    const got = await U.listTables(dbFetch, 'host', 'token', 'main', 's');
    assert.deepEqual(got.items.map((t) => t.name), ['orders']);
    assert.deepEqual(got.metricViews, ['main.s.customer_value_metrics']);
    assert.equal(got.truncated, false);
  } finally {
    console.log = log;
  }
  assert.ok(logged.some((line) => line.includes('[METRIC-VIEW SKIPPED] 1 metric views left out: customer_value_metrics')));
});

test('the listing route and its SQL fallback keep the skipped metric views out (wiring)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /metricViews: hiddenMetricViews/, 'the route takes the names the listing left out');
  assert.match(server, /!hidden\.has\(row\.full_name\)/, 'the SQL fallback cannot re-add a metric view');
  assert.match(server, /AND table_type IN \('METRIC_VIEW', 'METRIC VIEW'\)/, 'the fallback asks the catalog which names are metric views');
  assert.match(server, /metricViewNames\.has\(tname\)/, 'and skips them');
});
