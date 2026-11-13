import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'money-parts-'));
const outfile = path.join(dir, 'parts.cjs');
await build({
  stdin: {
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { MoneyRuleEditor } from './src/components/MoneyRuleEditor.jsx'; export { MONEY_PARTS } from './src/lib/moneyParts.js';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const RENDERS = { method: 'data-measure-value', direction: 'data-measure-direction', currency: 'data-money-convert', window: 'data-money-window', off: 'data-money-off' };
const render = (part) => bundle.renderToStaticMarkup(bundle.createElement(bundle.MoneyRuleEditor, { part, value: undefined, sample: null, table: '', columns: [], api: {} }));

test('the part list names the five Measure parts in the order the stepper will show them', () => {
  assert.deepEqual(bundle.MONEY_PARTS, ['method', 'direction', 'currency', 'window', 'off']);
});

for (const [part, own] of Object.entries(RENDERS)) {
  test(`the ${part} part renders its own controls and none of the other parts’ controls`, () => {
    const html = render(part);
    assert.ok(html.includes(own), `${part} renders ${own}`);
    for (const [other, marker] of Object.entries(RENDERS)) {
      if (other === part || (part === 'window' && other === 'off') || (part === 'off' && other === 'window')) continue;
      assert.ok(!html.includes(marker), `${part} does not render the ${other} control ${marker}`);
    }
  });
}

test('with no part the editor renders every part, as it did before the stepper', () => {
  const html = render(null);
  for (const marker of Object.values(RENDERS)) assert.ok(html.includes(marker), `whole editor renders ${marker}`);
});

test('an unknown part shows the whole editor rather than an empty one', () => {
  const html = render('nonsense');
  for (const marker of Object.values(RENDERS)) assert.ok(html.includes(marker), `unknown part renders ${marker}`);
});

const renderWith = (value) => bundle.renderToStaticMarkup(bundle.createElement(bundle.MoneyRuleEditor, { part: null, value, sample: null, table: '', columns: [], api: {} }));
const gainsInput = (html) => html.match(/<input[^>]*data-money-rule-kind="gains"[^>]*>/)[0];

test('Gains only is disabled, and says why, while no sign is set', () => {
  const html = renderWith({ currency: 'convert', base: 'USD', rates: { USD: 1 }, rule: 'gains' });
  assert.ok(gainsInput(html).includes('disabled=""'), 'the Gains only choice is disabled');
  assert.ok(html.includes('data-money-sign-needed'), 'the editor says a sign is needed');
});

test('Gains only is enabled once a status sign is set, and the explanation goes', () => {
  const html = renderWith({ currency: 'convert', base: 'USD', rates: { USD: 1 }, rule: 'gains', sign: { kind: 'status', column: 'channel', value: 'gain' } });
  assert.ok(!gainsInput(html).includes('disabled=""'), 'the Gains only choice is enabled');
  assert.ok(!html.includes('data-money-sign-needed'), 'no explanation once the sign is set');
});

const radioOf = (html, method) => html.match(new RegExp(`<input[^>]*data-money-method="${method}"[^>]*>`))[0];

test('the method part offers the cost of a lost opportunity beside the fixed, column, equation and describe choices', () => {
  const html = render('method');
  assert.ok(html.includes('data-money-method="lost"'), 'the lost-opportunity choice is offered');
  for (const other of ['fixed', 'column', 'equation', 'describe']) assert.ok(html.includes(`data-money-method="${other}"`), `${other} is still offered`);
});

test('a saved fixed amount with statuses opens on the lost-opportunity choice, with its statuses and status column filled in', () => {
  const html = renderWith({ currency: 'convert', base: 'USD', rates: { USD: 1 }, statuses: ['lost'], status_column: 'stage', value: { method: 'fixed', amount: 120, currency: 'USD' } });
  assert.ok(radioOf(html, 'lost').includes('checked=""'), 'the lost-opportunity choice is checked');
  assert.ok(!radioOf(html, 'fixed').includes('checked=""'), 'the plain fixed choice is not checked');
  assert.ok(html.includes('data-money-lost'), 'the lost block is shown');
  assert.match(html, /<input[^>]*data-money-lost-statuses[^>]*value="lost"/);
  assert.match(html, /<option value="stage" selected=""/);
});

test('a saved fixed amount without statuses stays the plain fixed choice', () => {
  const html = renderWith({ currency: 'convert', base: 'USD', rates: { USD: 1 }, value: { method: 'fixed', amount: 120, currency: 'USD' } });
  assert.ok(radioOf(html, 'fixed').includes('checked=""'), 'the fixed choice is checked');
  assert.ok(!html.includes('data-money-lost'), 'no lost block');
});
