const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const CASES = require('../../agent/tests/fixtures/placeholder_words_cases.json');

const APP = path.resolve(__dirname, '..', '..');
const lib = (name) => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', name)).href);
const LEFTOVER = new RegExp(CASES.leftover_tag, 'i');
const KEY_RESULT = 'Raise weekly orders from [BASELINE] to [TARGET] within [WINDOW]';

test('the App words every placeholder exactly as the agent does, and leaves text that only looks like a tag alone', async () => {
  const { placeholderWords, hasUnsetTarget } = await lib('placeholderWords.js');
  assert.ok(CASES.cases.length >= 10 && CASES.cases.some((c) => c.words === c.text));
  for (const c of CASES.cases) {
    assert.equal(placeholderWords(c.text), c.words, c.text);
    assert.equal(LEFTOVER.test(placeholderWords(c.text)), false, c.text);
  }
  for (const c of CASES.unset_target) assert.equal(hasUnsetTarget(c.text), c.unset, c.text);
  assert.equal(placeholderWords(null), '');
});

test('a target KPI whose target the sponsor has not set reads No target set, never a raw tag', async () => {
  const { targetKpiView } = await lib('targetKpi.js');
  const record = { name: 'Weekly orders', computable: true, target: null, target_text: KEY_RESULT };
  const view = targetKpiView(record, null);
  assert.equal(view.target, 'No target set');
  assert.equal(view.targetText, '');
  const worded = targetKpiView({ ...record, target_text: 'Grow weekly orders from [BASELINE: measured by the KPI query] steadily' }, null);
  assert.equal(worded.target, 'Grow weekly orders from the current value (measured by the KPI query) steadily');
  assert.equal(LEFTOVER.test(JSON.stringify(view) + JSON.stringify(worded)), false);
});

test('a use case full of placeholders shows none of them in the App view', async () => {
  const { v130View } = await lib('v130UseCase.js');
  const view = v130View({
    'Expected Key Results': [{ statement: KEY_RESULT, source: 'proposed' }],
    'Measures of Success': ['Stockouts down from [BASELINE:K1] to [TARGET]'],
    'Financial Benefits': ['Margin back, [ASSUMPTION: uplift to be agreed with the sponsor]'],
    'Non-Financial Benefits': ['Fewer late orders within [WINDOW], [MISSING_DATA: supplier lead times]'],
  });
  assert.equal(view.keyResults[0].statement, 'Raise weekly orders from the current value to a target the sponsor sets within a time frame the sponsor sets');
  assert.deepEqual(view.financial, ['Margin back, (assumption: uplift to be agreed with the sponsor)']);
  assert.equal(LEFTOVER.test(JSON.stringify(view)), false, JSON.stringify(view));
});
