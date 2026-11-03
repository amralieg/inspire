import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeholderWords, hasUnsetTarget } from '../src/placeholders.js';
import { promisedView, targetKpiView } from '../src/impact.js';

const CASES = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/placeholder_words_cases.json', import.meta.url), 'utf8'));
const LEFTOVER = new RegExp(CASES.leftover_tag, 'i');

test('the use case App words every placeholder exactly as the agent and the Inspire App do', () => {
  for (const c of CASES.cases) assert.equal(placeholderWords(c.text), c.words, c.text);
  for (const c of CASES.unset_target) assert.equal(hasUnsetTarget(c.text), c.unset, c.text);
  const inspire = readFileSync(new URL('../../../../../frontend/src/lib/placeholderWords.js', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../src/placeholders.js', import.meta.url), 'utf8'), inspire, 'one wording, copied byte for byte');
});

test('the target KPI tile and the promise never show a raw placeholder tag', () => {
  const run = { kpi_name: 'Weekly orders', kpi_status: 'not_measured', kpi_target: null,
    kpi_target_text: 'Raise weekly orders from [BASELINE] to [TARGET] within [WINDOW]' };
  assert.equal(targetKpiView(run).target, 'No target set');
  assert.equal(targetKpiView({ ...run, kpi_target_text: 'Hold weekly orders above 4,500 within [WINDOW]' }).target,
    'Hold weekly orders above 4,500 within a time frame the sponsor sets');
  const promised = promisedView({ promised: { value: 'Cuts stockouts from [BASELINE:K1]',
    benefits: ['Margin back, [ASSUMPTION: uplift to be agreed with the sponsor]', '[ESTIMATE]'] } });
  assert.deepEqual(promised, { value: 'Cuts stockouts from the current value',
    benefits: ['Margin back, (assumption: uplift to be agreed with the sponsor)', '(estimate)'] });
  assert.equal(LEFTOVER.test(JSON.stringify(promised) + JSON.stringify(targetKpiView(run))), false);
});
