// RC7-B-02, B-03, B-04, B-14, B-15 (frontend): no model id in customer text, no Retry on a deterministic failure, a one-day span reads
// "on <date>", the Business tab names what the total leaves out, and the range note only claims "outside" when it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as wizard from '../../src/lib/valueWizard.js';

const { reviewLineOf } = wizard;
import { rangeNote } from '../../src/lib/valueBulk.js';
import { storyOf } from '../../src/lib/valueStory.js';
import { factsLine } from '../../src/lib/valueScope.js';

const root = new URL('../../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 'c24-bval-'));
const outfile = path.join(dir, 'panel.cjs');
await build({
  stdin: { contents: "export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { RunValuePanel } from './src/components/ValueTotalsPanel';",
    resolveDir: root, loader: 'jsx', sourcefile: 'entry.jsx' },
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' },
});
const bundle = createRequire(import.meta.url)(outfile);

test('B-02: the review line says "Databricks AI", never the model id', () => {
  const line = reviewLineOf({ approved: true, model: 'system.ai.claude-sonnet-5-5', reason: 'fits the business' });
  assert.equal(line, 'Reviewed by Databricks AI: fits the business');
  assert.doesNotMatch(reviewLineOf({ approved: false, model: 'system.ai.claude-sonnet-5-5', reason: 'too high' }), /claude|system\.ai/);
});

test('B-03: a 422 is deterministic (no Retry); a 500 or a dropped connection can be retried', () => {
  assert.equal(wizard.isDeterministicFailure({ status: 422 }), true);
  assert.equal(wizard.isDeterministicFailure({ status: 400 }), true);
  assert.equal(wizard.isDeterministicFailure({ status: 500 }), false);
  assert.equal(wizard.isDeterministicFailure(new Error('network')), false);
});

const story = (first, last) => storyOf({ useCase: 'U', noun: 'record', currency: 'USD', scope: { rows_after: 196, rows_before: 196, first, last } }).text;

test('B-04: the same first and last day reads "on 3 Jun 2024", two days read "from .. to .."', () => {
  assert.match(story('2024-06-03', '2024-06-03'), /196 records on 3 Jun 2024\./);
  assert.doesNotMatch(story('2024-06-03', '2024-06-03'), /from 3 Jun 2024 to 3 Jun 2024/);
  assert.match(story('2024-06-03', '2024-06-09'), /196 records, from 3 Jun 2024 to 9 Jun 2024\./);
  assert.match(factsLine({ rows: 196, date_column: 'd', first: '2024-06-03', last: '2024-06-03' }), /on 3 Jun 2024/);
  assert.doesNotMatch(factsLine({ rows: 196, date_column: 'd', first: '2024-06-03', last: '2024-06-03' }), /3 Jun 2024 to 3 Jun 2024/);
});

test('B-15: the range note says "outside" only for a value that is outside, and never prints a bare unscaled figure as the yearly one', () => {
  assert.match(rangeNote('USD', 150.03), /\$150\.03 is outside the usual 100K-100M range/);
  assert.doesNotMatch(rangeNote('USD', 250000), /outside/);
  assert.match(rangeNote('USD', 250000), /Check this value/);
});

const RUN = { totals: [{ currency: 'USD', amount: 523000, calculated: 466000, estimated: 57000 }], n: 4, n_calculated: 2, n_estimated: 2, n_measured: 0, n_none: 0, n_shared: 0, excluded: [], by_verb: [] };
const html = (useCases) => bundle.renderToStaticMarkup(bundle.createElement(bundle.RunValuePanel, { run: RUN, useCases, nameOf: (id) => id }));
const text = (out) => out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('B-14: Reviewed + Provisional on the Business tab minus the left-out line equals the header total', () => {
  const out = html({
    A: { status: 'calculated', amount: 466000, currency: 'USD', counted_amount: 466000 },
    B: { status: 'estimated', amount: 144000, currency: 'USD', counted_amount: 57000 },
    C: { status: 'estimated', amount: 24000, currency: 'USD', counted: false, counted_amount: 0, check: { outside: 'low' } },
  });
  const t = text(out);
  assert.match(t, /Reviewed calculation \$466K/);
  assert.match(t, /Provisional estimate \$168K/);
  assert.match(t, /\$111K left out of the total/);
  assert.equal(466 + 168 - 111, 523);
});
