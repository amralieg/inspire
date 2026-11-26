const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const ask = (n) => ({ requirement: `ask ${n}`, status: 'not_met', part: 'notebook', evidence: 'x' });

// RC6-D-01: a vibe that kept v1 live and published v2 with unmet asks is one state: v2 is published and N asks are not met. Nothing is held.
test('v2 published by a vibe with 4 unmet asks, v1 kept live, is published and unmet, never held', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const latest = { use_case_id: 'N01-U01', spec_version: 2, live_version: 1, status: 'ready_with_warnings', app_url: 'https://a.example.com',
    asset_status: { app: { state: 'ready' }, checklist: [ask(1), ask(2), ask(3), ask(4)] } };
  const state = W.implementState(latest);
  assert.equal(state.group, 'unmet', 'the existing ready rule: open vibe asks are not ready, they are their own published-with-unmet group');
  assert.doesNotMatch(String(state.note || ''), /held/i);
  assert.equal(state.note, 'v2 is published with 4 unmet asks');
  const summary = C.buildSummary([{ state, latest }]);
  assert.equal(summary.held, 0);
  assert.equal(summary.unmet, 1);
  assert.match(C.buildSummaryLines(summary).join(' '), /published, with a vibe ask not met/);
  assert.doesNotMatch(C.buildSummaryLines(summary).join(' '), /held|not published/i);
});

test('must-keep: a newer version a vibe did not publish still says held', async () => {
  const W = await lib('implementWizard.js');
  const latest = { use_case_id: 'N01-U01', spec_version: 2, live_version: 1, status: 'vibe_not_met', asset_status: { held: { reason: 'Notebook: Genie used a method the ask did not allow.' } } };
  assert.match(W.implementState(latest).note, /^Newer version held: /);
});
