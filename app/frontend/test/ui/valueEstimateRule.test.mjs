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
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { default as ValueEstimateLine } from './src/components/ValueEstimateLine.jsx';\nexport { UseCaseStrategyDetail } from './src/components/UseCaseStrategyDetail.jsx';\nexport { v130View } from './src/lib/v130UseCase.js';",
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
  assert.match(html, /Set a money rule to see the value at stake\./);
  assert.match(html, /data-value-set-rule/);
  assert.doesNotMatch(html, /\d,?\d* AED/);
});

test('the set-rule button only appears when the card can open the wizard', () => {
  assert.doesNotMatch(line({ status: 'set_rule' }), /data-value-set-rule/);
});

test('an own column or equation rule says it cannot estimate yet and what to set, and shows no number', () => {
  const html = line({ status: 'cannot', app: 'Sales App', method: 'column', borrowed: false });
  assert.match(html, /data-value-estimate="cannot"/);
  assert.match(html, /Cannot estimate yet: this use case&#x27;s money rule values each record by column\. Set a fixed amount to estimate\./);
  assert.doesNotMatch(html, /borrows|Estimated \d/);
});

test('a borrowed rule that cannot estimate names the rule it borrows from and gives the action (REQ-078 walk defect 4)', () => {
  const html = line({ status: 'cannot', app: 'Sales App', method: 'column', borrowed: true });
  assert.match(html, /data-value-estimate="cannot"/);
  assert.match(html, /this use case has no money rule of its own\. It borrows Sales App&#x27;s money rule, which values each record by column\./);
  assert.match(html, /Set a fixed amount, or this use case&#x27;s own money rule, to estimate\./);
  assert.doesNotMatch(html, /Estimated \d/);
});

test('the Set rule button does not repeat the sentence before it (REQ-078 walk defect 6)', () => {
  const html = line({ status: 'set_rule' }, { onSetRule: () => {} });
  assert.match(html, /Set a money rule to see the value at stake\./);
  assert.match(html, />Set rule<\/button>/);
  assert.equal((html.match(/Set a money rule/g) || []).length, 1, 'the words appear once');
});

test('no KPI baseline gives no number, and says why', () => {
  const html = line({ status: 'no_baseline', app: 'Sales App' });
  assert.match(html, /data-value-estimate="no-baseline"/);
  assert.match(html, /No number yet: this use case has no KPI baseline/);
});

test('a card with no estimate falls back to the existing line, and a measured use case gets none', () => {
  assert.equal(line(null), '');
});

// FX-34 (REQ-448): EstimateTotals is gone; every run total is the one run value (ValueTotalsPanel RunValueLine, valueOneTruth.ui).
// REQ-078 rc7 walk: the Build page passed no route estimate, so 18 cards read "Value not measured yet" and 6 measured cards
// could be overwritten by a rule line. A card's own measured figure must win; an unmeasured card shows the route's line.
const lineUc = (uc, estimate) => bundle.renderToStaticMarkup(bundle.createElement(bundle.ValueEstimateLine, { uc, estimate }));
const measuredUc = {
  value_estimate_text: 'USD 77.1K-231.4K a year (reporting currency USD (default)), if weekly recorded sales revenue rises 5-15%',
  value_estimate: JSON.stringify({ status: 'measured', currency: 'USD', text: 'USD 77.1K-231.4K a year' }),
};
const notMeasuredUc = {
  value_estimate_text: 'Value not measured yet: measure losses caught early: flagged anomalies confirmed × average value, from the source columns.',
  value_estimate: JSON.stringify({ status: 'not measured yet', text: 'Value not measured yet: measure losses caught early.' }),
};

test('a measured card keeps its measured figure even when the route says set a rule for it', () => {
  const html = lineUc(measuredUc, { status: 'set_rule' });
  assert.match(html, /data-value-estimate="measured"/);
  assert.match(html, /USD 77\.1K-231K a year/, 'FX-34 (W16 D4): one precision in the Discover sentence');
  assert.doesNotMatch(html, /Set a money rule/);
});

test('an unmeasured card shows the route estimate, not the Discover "Value not measured yet" line, once the route answers', () => {
  const html = lineUc(notMeasuredUc, { status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
  assert.match(html, /Estimated 6,000 AED/);
  assert.doesNotMatch(html, /Value not measured yet/);
});

test('an unmeasured card with no route answer yet keeps the Discover line', () => {
  const html = lineUc(notMeasuredUc, null);
  assert.match(html, /Value not measured yet/);
});

test('an unmeasured card with no money rule says so in one line, with no number', () => {
  const html = lineUc(notMeasuredUc, { status: 'set_rule' });
  assert.match(html, /data-value-estimate="set-rule"/);
  assert.doesNotMatch(html, /Value not measured yet/);
  assert.doesNotMatch(html, /\d,?\d* AED/);
});

// The drawer's "Value estimate" section reads the same route answer as the card, so the two cannot disagree (REQ-078).
const drawer = (props) => bundle.renderToStaticMarkup(bundle.createElement(bundle.UseCaseStrategyDetail, props));
const info = (uc) => bundle.v130View(uc);

test('the drawer value section shows the route line for an unmeasured use case, the same as its card', () => {
  const html = drawer({ info: info(notMeasuredUc), uc: notMeasuredUc, valueEstimate: { status: 'set_rule' } });
  assert.match(html, /data-value-estimate="set-rule"/);
  assert.match(html, /Set a money rule to see the value at stake\./);
  assert.doesNotMatch(html, /Value not measured yet/);
});

test('the drawer value section keeps a measured figure over a route answer', () => {
  const html = drawer({ info: info(measuredUc), uc: measuredUc, valueEstimate: { status: 'set_rule' } });
  assert.match(html, /data-value-estimate="measured"/);
  assert.doesNotMatch(html, /Set a money rule/);
});
