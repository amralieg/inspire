// RC6-B-07: the Business tab split names the provisional sum, never a bare $0, and says why a value is not counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'prov-sum-'));
const outfile = path.join(dir, 'panel.cjs');
await build({
  stdin: { contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { RunValuePanel } from './src/components/ValueTotalsPanel';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx' },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);

const RUN = { totals: [{ currency: 'USD', amount: 163000, calculated: 163000, estimated: 0 }], n: 3, n_calculated: 1, n_estimated: 2, n_measured: 0, n_none: 0, n_shared: 0, excluded: [], by_verb: [] };
const names = { A: 'Churn', B: 'Fraud', C: 'Upsell' };
const html = (run, useCases) => bundle.renderToStaticMarkup(bundle.createElement(bundle.RunValuePanel, { run, useCases, nameOf: (id) => names[id] || id }));
const legend = (out) => (out.match(/data-bar-legend="Reviewed calculations vs provisional estimates"[^>]*>(.*?)<\/p>/) || [])[1] || '';

test('1 reviewed and 2 provisional values: the split shows the provisional sum, not $0', () => {
  const out = html(RUN, {
    A: { status: 'calculated', amount: 163000, currency: 'USD', counted: true, counted_amount: 163000 },
    B: { status: 'estimated', amount: 24000, currency: 'USD', counted: false, counted_amount: 0, check: { outside: true } },
    C: { status: 'estimated', amount: 1500, currency: 'USD', counted: false, counted_amount: 0, check: { outside: true } },
  });
  assert.match(legend(out), /Provisional estimate \$25\.5K/);
  assert.doesNotMatch(legend(out), /Provisional estimate \$0</);
  assert.match(out, /data-provisional-note/);
});

test('a shared value counted once reads the plain reason naming the other use case', () => {
  const out = html(RUN, {
    A: { status: 'calculated', amount: 163000, currency: 'USD', counted: true, counted_amount: 163000 },
    B: { status: 'estimated', amount: 24000, currency: 'USD', counted: false, counted_amount: 0, overlap: { counted: false, with: 'A', not_counted: 24000 } },
  });
  assert.match(out, /data-provisional-note[^>]*>[^<]*counted once under Churn/);
  assert.match(legend(out), /Provisional estimate \$24K/);
});
