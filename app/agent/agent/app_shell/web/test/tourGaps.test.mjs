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

const stepOf = (info, anchor) => info.pages[0].tour.languages[0].steps.find((s) => s.anchor === anchor);

test('a tour names the runs and settings entries, which the rail always shows', () => {
  const info = appInfo({}, 1, {});
  assert.ok(anchorsOf(info).includes('settings'), `no settings step in ${anchorsOf(info).join(',')}`);
  assert.equal(stepOf(info, 'runs').title, 'Each run');
});

test('a tour leaves out the runs step when the App hides its runs', () => {
  const info = appInfo({ screens: { runs: false } }, 1, {});
  assert.ok(!anchorsOf(info).includes('runs'), `runs step in ${anchorsOf(info).join(',')}`);
});

test('a language without its own words for a step gets the English step, so no step is blank', () => {
  const info = appInfo({}, 1, { tour: { languages: ['French'], steps: { French: [] } } });
  const runs = info.pages[0].tour.languages[0].steps.find((s) => s.anchor === 'runs');
  assert.equal(runs?.title, 'Each run', 'the French runs step falls back to the English words');
});

test('the actions step names the page own choices and says what each one does', () => {
  const statuses = [{ id: 'done', label: 'Done', status: 'Done' }, { id: 'wrong', label: 'Wrong flag', status: 'Dismissed' },
    { id: 'later', label: 'Later', status: 'New' }];
  const info = appInfo(DECIDE, 1, { statuses }, 'examples/monitor_triage.json');
  const text = stepOf(info, 'actions').text;
  assert.ok(text.includes('Done (counts as fixed)'), text);
  assert.ok(text.includes('Wrong flag (counts as not an issue)'), text);
  assert.ok(text.includes('Later (stays on the list)'), text);
  assert.ok(!/[{}]/.test(text), text);
});
