// REQ-480 (FX-75): the all-runs panel shows totals only, and any amount of 20M or more reads "20M+".
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'all-runs-'));
const outfile = path.join(dir, 'panel.cjs');
await build({
  stdin: {
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { AllRunsValuePanel, RunValuePanel } from './src/components/ValueTotalsPanel.jsx'; export { moneyText } from './src/components/ValueBox.jsx';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const value = (calculated, estimated, extra = {}) => ({ totals: [{ currency: 'USD', amount: calculated + estimated, calculated, estimated }], n: 3, n_calculated: calculated ? 1 : 0, n_estimated: estimated ? 1 : 0, n_measured: 0, n_none: 0, n_shared: 0, ...extra });
const NONE = { totals: [], n: 2, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 2, n_shared: 0 };
const REPLY = { runs: [
  { session_id: '1', name: 'Calc', ...value(2e6, 0), run_value: value(2e6, 0) },
  { session_id: '2', name: 'Est', ...value(0, 3e6), run_value: value(0, 3e6) },
  { session_id: '3', name: 'Empty', ...NONE, run_value: NONE },
], all: value(2e6, 3e6), cap: 20 };
const html = (props = {}) => bundle.renderToStaticMarkup(bundle.createElement(bundle.AllRunsValuePanel, { reply: { ...REPLY, ...props } }));

test('25,000,000 renders as $20M+, and smaller amounts are unchanged', () => {
  assert.equal(bundle.moneyText('USD', 25000000), '$20M+');
  assert.equal(bundle.moneyText('USD', 20000000), '$20M+');
  assert.notEqual(bundle.moneyText('USD', 19000000), '$20M+');
  const big = value(25e6, 0);
  assert.match(html({ all: big, runs: [{ session_id: '1', name: 'Big', ...big, run_value: big }] }), /\$20M\+/);
  assert.doesNotMatch(html({ all: big, runs: [{ session_id: '1', name: 'Big', ...big, run_value: big }] }), /\$25M/);
});

test('the all-runs panel has no By run bar or legend', () => {
  const out = html();
  assert.doesNotMatch(out, /data-bar-legend="By run"/);
  assert.doesNotMatch(out, />By run</);
  assert.match(out, /data-bar-legend="Calculated vs estimated"/);
  assert.match(out, /ALL RUNS/);
});

test('the run table has three columns and a calculated total is green, an estimated one amber, an empty one grey', () => {
  const out = html();
  assert.equal((out.match(/<th /g) || []).length, 3);
  const row = (id) => out.split(`data-all-runs-row="${id}"`)[1].split('</tr>')[0];
  assert.match(row('1'), /data-run-value-state="calculated"/);
  assert.match(row('2'), /data-run-value-state="estimated"/);
  const empty = row('3');
  assert.match(empty, /data-run-value-state="not-calculated"/);
  assert.match(empty, /text-text-tertiary[^>]*>Not calculated</);
});
