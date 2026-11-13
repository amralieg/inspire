import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'overall-cap-'));
const outfile = path.join(dir, 'overall.cjs');
await build({
  stdin: {
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { OverallValue } from './src/components/ValueBadge.jsx';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

const VALUE = { at_stake: [{ kind: 'money', unit: 'AED', amount: 12000 }], saved: [], runs: 6, businesses: 3 };
const render = (props) => bundle.renderToStaticMarkup(bundle.createElement(bundle.OverallValue, { value: VALUE, ...props }));

test('when the estimate covers the latest runs only, the banner says so', () => {
  const html = render({ estimated: { estimated: { AED: 3000 } }, estimateCap: 20 });
  assert.match(html, /Plus estimated, not measured: 3,000 AED/);
  assert.match(html, /data-estimate-cap/);
  assert.match(html, /Estimate covers the latest 20 runs/);
});

test('when every run is covered, the banner names no cap', () => {
  const html = render({ estimated: { estimated: { AED: 3000 } }, estimateCap: null });
  assert.match(html, /Plus estimated, not measured: 3,000 AED/);
  assert.doesNotMatch(html, /data-estimate-cap/);
});
