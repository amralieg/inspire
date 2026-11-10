import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appInfo, DECIDE } from './harness.mjs';

const anchorsOf = (info) => info.pages[0].tour.languages[0].steps.map((s) => s.anchor);

test('a tour never names an alerts step while alerts are off, because the rail has no alerts entry to point at', () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/monitor_triage.json');
  assert.ok(!anchorsOf(info).includes('alerts'), `alerts step in ${anchorsOf(info).join(',')}`);
});

test('a tour never names record actions on a page that does not let people record decisions', () => {
  const info = appInfo({ options: { modify: true, replace_edits: false, decisions: false } }, 1, {}, 'examples/scenario_lab.json');
  const got = anchorsOf(info);
  assert.ok(!got.includes('actions') && !got.includes('bulk'), `action steps in ${got.join(',')}`);
});

test('a tour keeps the record action steps on a page that lets people record decisions', () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/monitor_triage.json');
  assert.ok(anchorsOf(info).includes('actions'), `no actions step in ${anchorsOf(info).join(',')}`);
});
