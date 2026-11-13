import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'build-next-estimate-'));
const outfile = path.join(dir, 'build-next.cjs');
await build({
  stdin: {
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { RunValue } from './src/components/BuildNext.jsx';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const render = (row, onMeasure = null) => bundle.renderToStaticMarkup(bundle.createElement(bundle.RunValue, { row, onMeasure }));

test('a Build next sibling with a rule shows its own estimate, labelled with the App whose rule it is', () => {
  const html = render({ id: 'N01-U02', estimate: { status: 'estimated', app: 'Sales App', currency: 'AED', amount: 6000 } });
  assert.match(html, /data-value-estimate="estimated"/);
  assert.match(html, /Estimated 6,000 AED/);
  assert.match(html, /estimated with Sales App/);
});

test('a sibling with no rule says so and offers the Measure step for its use case, with no number', () => {
  const html = render({ id: 'N01-U02', estimate: { status: 'set_rule' } }, () => {});
  assert.match(html, /data-value-estimate="set-rule"/);
  assert.match(html, /data-value-set-rule/);
  assert.doesNotMatch(html, /AED \d/);
});

test('a sibling with no estimate keeps the existing Value at stake line', () => {
  const html = render({ id: 'N01-U02' }, () => {});
  assert.match(html, /data-value-estimate="not-calculated"/);
  assert.match(html, /Value at stake: Not calculated/);
});
