// FX-114 (REQ-503): the App's value ledger mapped onto the doc model's `values` contract, the wizard's default language, and the doc
// libraries (PowerPoint, Excel, PDF) loaded only when a person generates, so the main bundle does not grow. Pure, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { docValuesOf, docLanguageOf } from '../../src/lib/docgen/docValues.js';
import { buildDocModel } from '../../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../../src/lib/docgen/docOptions.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

// calculated.byId (useCalculatedValues) and valueTotals.use_cases (GET /api/inspire/value/totals), as the Results page holds them.
const BY_ID = {
  'N01-U01': { status: 'ready', version: 2, yearly: { verb: 'REDUCE COST', period: 'Per Year', currency: 'USD', total: { unit: 'USD', amount: 2400000 },
    calculated: true, estimated: false, attribution_pct: 100,
    parts: [{ id: 'payouts', label: 'Delay payouts', amount: 1488000 }, { id: 'seats', label: 'Seat fill', amount: 744000 }, { id: 'demand', label: 'Market demand', amount: 168000 }] } },
  'N02-U01': { status: 'ready', version: 1, yearly: { verb: 'GROW REVENUE', currency: 'EUR', total: { unit: 'EUR', amount: 500000 }, calculated: false, estimated: true, parts: [] } },
  'N02-U02': { status: 'ready', version: 1, yearly: { verb: 'REDUCE COST', currency: 'USD', total: { unit: 'USD', amount: 'n/a' }, parts: [] } },
};
const TOTALS = { run: { totals: [] }, use_cases: {
  'N01-U01': { status: 'estimated', amount: 9, currency: 'USD', verb: 'REDUCE COST' },
  'N01-U02': { status: 'estimated', amount: 1100000, currency: 'USD', verb: 'GROW REVENUE' },
  'N01-U03': { status: 'not_estimated' },
  'N01-U04': { status: 'no_data' },
} };

test('docValuesOf: a calculated value from the ledger, its parts as factors, a story naming the biggest part; the ledger wins over the run totals', () => {
  const v = docValuesOf({ byId: BY_ID, totals: TOTALS });
  const a = v['N01-U01'];
  assert.ok(a, 'N01-U01 has a value');
  assert.equal(a.amount, 2400000, 'the saved Calculate value, not the run totals estimate');
  assert.equal(a.currency, 'USD');
  assert.equal(a.status, 'calculated');
  assert.deepEqual(a.factors.map((f) => f.name), ['Delay payouts', 'Seat fill', 'Market demand']);
  assert.ok(Math.abs(a.factors.reduce((s, f) => s + f.share, 0) - 1) < 0.01, 'factor shares add up to the whole');
  assert.ok(Math.abs(a.factors[0].share - 0.62) < 0.01, `first share ${a.factors[0].share}`);
  assert.equal(typeof a.story, 'string');
  assert.match(a.story, /Delay payouts/, 'the value story names where the money comes from');
});

test('docValuesOf: an estimate only in the run totals is an estimated value; not estimated, no data and an unreadable amount give no value', () => {
  const v = docValuesOf({ byId: BY_ID, totals: TOTALS });
  assert.deepEqual({ amount: v['N01-U02'].amount, currency: v['N01-U02'].currency, status: v['N01-U02'].status }, { amount: 1100000, currency: 'USD', status: 'estimated' });
  assert.deepEqual(v['N01-U02'].factors, []);
  assert.equal(v['N02-U01'].status, 'estimated', 'a ledger value not marked calculated is an estimate');
  assert.equal(v['N02-U01'].currency, 'EUR');
  for (const id of ['N01-U03', 'N01-U04', 'N02-U02', 'N09-U09']) assert.equal(v[id], undefined, `${id} has no value`);
});

test('docValuesOf: a projection, when given, is three years, finite, low <= likely <= high, and year 1 likely is the value itself (no invented year-1 figure)', () => {
  const v = docValuesOf({ byId: BY_ID, totals: TOTALS });
  for (const [id, val] of Object.entries(v)) {
    assert.ok(Array.isArray(val.yearly), `${id} yearly is a list`);
    if (!val.yearly.length) continue;
    assert.deepEqual(val.yearly.map((r) => Number(r.year)), [1, 2, 3], id);
    for (const r of val.yearly) {
      for (const k of ['low', 'likely', 'high']) assert.ok(Number.isFinite(r[k]), `${id} year ${r.year} ${k}`);
      assert.ok(r.low <= r.likely && r.likely <= r.high, `${id} year ${r.year}: ${r.low} <= ${r.likely} <= ${r.high}`);
    }
    assert.equal(val.yearly[0].likely, val.amount, `${id}: year 1 likely is the value`);
  }
});

test('docValuesOf feeds buildDocModel: the selected use cases carry their values and the same-currency total adds up', () => {
  const values = docValuesOf({ byId: BY_ID, totals: TOTALS });
  const ucs = ['N01-U01', 'N01-U02', 'N01-U03'].map((No) => ({ No, Name: No, Statement: 's', inspire_score: '8' }));
  const m = buildDocModel({ businessName: 'Acme', useCases: ucs, values, options: defaultDocOptions('English') });
  assert.equal(m.total.amount, 3500000);
  assert.equal(m.total.nWithValue, 2);
  assert.equal(m.useCases[2].value, null, 'not estimated shows "not calculated yet"');
  assert.deepEqual(docValuesOf({}), {}, 'nothing read yet is no values');
  assert.deepEqual(docValuesOf({ byId: null, totals: null }), {});
});

test("docLanguageOf: the wizard starts in the run's language: the first of output_language or its documents-languages widget, else English", () => {
  assert.equal(docLanguageOf({ output_language: 'Arabic,English' }), 'Arabic');
  assert.equal(docLanguageOf({ widget_values: { '12_documents_languages': 'French, German' } }), 'French');
  assert.equal(docLanguageOf({}), 'English');
  assert.equal(docLanguageOf(null), 'English');
  assert.equal(docLanguageOf({ output_language: '  ' }), 'English');
});

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const SOURCES = walk(SRC).filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.includes(`${path.sep}lib${path.sep}docgen${path.sep}`));

test('the doc libraries load only when a person generates: no static import of pptxDoc, xlsxDoc, pdfDoc or their packages outside lib/docgen; the wizard imports them dynamically', () => {
  const STATIC = /^\s*import\s[^;]*?from\s+['"]([^'"]*(?:docgen\/(?:pptxDoc|xlsxDoc|pdfDoc)(?:\.js)?|pptxgenjs|jspdf|write-excel-file[^'"]*))['"]/gm;
  const found = [];
  for (const f of SOURCES) for (const m of fs.readFileSync(f, 'utf8').matchAll(STATIC)) found.push(`${path.relative(SRC, f)}: ${m[1]}`);
  assert.deepEqual(found, [], 'static imports that would put the doc libraries in the main bundle');
  const dynamic = SOURCES.filter((f) => /import\(\s*['"][^'"]*docgen\/(pptxDoc|xlsxDoc|pdfDoc)/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(dynamic.length >= 1, 'a component imports the doc writers with import()');
});
