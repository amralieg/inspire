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
    contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { AllRunsValuePanel } from './src/components/ValueTotalsPanel.jsx';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);
rmSync(dir, { recursive: true, force: true });

// FX-34 (REQ-448, W16 D2): the one Start value panel is AllRunsValuePanel (OverallValue is gone); it says when it covers the newest runs only.
const RUN_VALUE = { totals: [{ currency: 'AED', amount: 12000, calculated: 9000, estimated: 3000 }], n: 2, n_calculated: 1, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0 };
const REPLY = { runs: [{ session_id: '42', name: 'Run', ...RUN_VALUE, run_value: RUN_VALUE }], all: RUN_VALUE, cap: 20 };
const render = (props) => bundle.renderToStaticMarkup(bundle.createElement(bundle.AllRunsValuePanel, { reply: { ...REPLY, ...props } }));

test('when the panel covers the latest runs only, it says so', () => {
  const html = render({ truncated: true });
  assert.match(html, /Showing the newest 20 runs only/);
});

test('when every run is covered, the panel names no cap', () => {
  const html = render({ truncated: false });
  assert.doesNotMatch(html, /Showing the newest/);
  assert.match(html, /data-run-value-total/);
});
