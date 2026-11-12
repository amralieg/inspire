import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'value-estimate-'));
const outfile = path.join(dir, 'estimate.cjs');
await build({
  stdin: {
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { default as ValueEstimateLine, EstimateTotals } from './src/components/ValueEstimateLine.jsx';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const line = (estimate, extra = {}) => bundle.renderToStaticMarkup(bundle.createElement(bundle.ValueEstimateLine, { estimate, ...extra }));

test('an estimate says Estimated, its amount and currency, and the App whose money rule it uses', () => {
  const html = line({ status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
  assert.match(html, /data-value-estimate="estimated"/);
  assert.match(html, /Estimated 6,000 AED/);
  assert.match(html, /estimated with Sales App&#x27;s money rule|estimated with Sales App's money rule/);
});

test('with no rule, the card asks for a money rule and shows no number', () => {
  const html = line({ status: 'set_rule' }, { onSetRule: () => {} });
  assert.match(html, /data-value-estimate="set-rule"/);
  assert.match(html, /Set a money rule to see its value\./);
  assert.match(html, /data-value-set-rule/);
  assert.doesNotMatch(html, /\d,?\d* AED/);
});

test('the set-rule button only appears when the card can open the wizard', () => {
  assert.doesNotMatch(line({ status: 'set_rule' }), /data-value-set-rule/);
});

test('a column or equation rule says it cannot estimate yet, and shows no number', () => {
  const html = line({ status: 'cannot', app: 'Sales App', method: 'column' });
  assert.match(html, /data-value-estimate="cannot"/);
  assert.match(html, /Cannot estimate yet: Sales App&#x27;s money rule values each record by column/);
  assert.doesNotMatch(html, /Estimated \d/);
});

test('no KPI baseline gives no number, and says why', () => {
  const html = line({ status: 'no_baseline', app: 'Sales App' });
  assert.match(html, /data-value-estimate="no-baseline"/);
  assert.match(html, /No number yet: this use case has no KPI baseline/);
});

test('a card with no estimate falls back to the existing line, and a measured use case gets none', () => {
  assert.equal(line(null), '');
});

test('the totals keep estimated money apart and say so; no estimate, no totals line', () => {
  const html = bundle.renderToStaticMarkup(bundle.createElement(bundle.EstimateTotals, { totals: { estimated: { AED: 6100, USD: 0.5 } } }));
  assert.match(html, /data-value-estimated-total/);
  assert.match(html, /Plus estimated, not measured: 6,100 AED, 1 USD|Plus estimated, not measured: 6,100 AED, 0\.5 USD|Plus estimated, not measured: 6,100 AED, 1 USD/);
  assert.equal(bundle.renderToStaticMarkup(bundle.createElement(bundle.EstimateTotals, { totals: { estimated: {} } })), '');
});
