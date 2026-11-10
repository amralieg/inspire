import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceOn } from '../src/modes.js';

test('the Performance rail item shows unless the App turns that screen off', () => {
  assert.equal(performanceOn(undefined), true, 'no App settings: the rail keeps Performance');
  assert.equal(performanceOn({}), true, 'an App with no screens setting keeps Performance');
  assert.equal(performanceOn({ screens: { runs: false } }), true, 'turning Runs off does not hide Performance');
  assert.equal(performanceOn({ screens: { performance: true } }), true);
  assert.equal(performanceOn({ screens: { performance: false } }), false, 'a removed Accuracy screen leaves the rail');
});
