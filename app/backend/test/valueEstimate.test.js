const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeV130UseCaseFields } = require('../lib/inspireJobParams');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'v130UseCase.js')).href;
const load = () => import(libUrl);

const MEASURED = {
  status: 'measured', value_low: 2432.0, value_high: 6080.0, currency: 'AED', kpi: 'Weekly sales value',
  text: 'AED 2.4K–6K a year, if weekly sales value rises 2–5% (measured: 29,589 AED Weekly sales value in the last 90 days, from amount in c.s.orders; the percentages are an assumption)',
  measured_from: { table: 'c.s.orders', column: 'amount', window_days: 90 },
};

test('a stored money range reaches the use-case view with its text, currency and measured flag', async () => {
  const lib = await load();
  const row = normalizeV130UseCaseFields({ id: 'N01-U01', value_estimate: JSON.stringify(MEASURED), value_estimate_text: ` ${MEASURED.text} ` });
  assert.equal(row.value_estimate.value_high, 6080);
  assert.equal(row.value_estimate_text, MEASURED.text);
  assert.ok(lib.V130_TRACKING_FIELDS.includes('value_estimate') && lib.V130_TRACKING_FIELDS.includes('value_estimate_text'));
  const view = lib.v130View(row);
  assert.deepEqual(view.valueEstimate, { text: MEASURED.text, measured: true, currency: 'AED' });
  assert.equal(view.hasValue, true);
});

test('a use case with no measured baseline shows not measured yet and no number, and an old row shows nothing', async () => {
  const lib = await load();
  const text = 'Value not measured yet: measure Weekly sales value with its KPI query (Deep discovery reads it).';
  const view = lib.v130View(normalizeV130UseCaseFields({ id: 'N01-U02', value_estimate: JSON.stringify({ status: 'not measured yet', text }) }));
  assert.deepEqual(view.valueEstimate, { text, measured: false, currency: null });
  assert.doesNotMatch(view.valueEstimate.text, /\d/);
  assert.equal(lib.v130View(normalizeV130UseCaseFields({ id: 'N01-U03' })).valueEstimate, null);
  assert.equal(lib.v130View({ value_estimate_text: text }).valueEstimate.text, text);
});
