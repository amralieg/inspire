// RC6-B-02: one count-and-unit helper, so a window of 1 day reads "1 day", never "1 days".
import test from 'node:test';
import assert from 'node:assert/strict';
import { plural } from '../src/lib/plural.js';
import { kpiText } from '../src/lib/v130UseCase.js';

const spec = (days, anchor) => ({ name: 'Daily Total Revenue', direction: 'up', baseline: { value: 5646, window_days: days, window_anchor: anchor, measured_on: '2026-11-25' } });

test('plural: 1 day and 2 days', () => {
  assert.equal(plural(1, 'day'), '1 day');
  assert.equal(plural(2, 'day'), '2 days');
});

test('the KPI baseline text for a 1-day window says "last 1 day", for 90 days "last 90 days"', () => {
  assert.match(kpiText(spec(1, 'newest data')), /last 1 day to the newest data/);
  assert.doesNotMatch(kpiText(spec(1, 'newest data')), /1 days/);
  assert.match(kpiText(spec(1)), /last 1 day,/);
  assert.match(kpiText(spec(90)), /last 90 days,/);
});
