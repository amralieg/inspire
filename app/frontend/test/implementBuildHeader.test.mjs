// REQ-295: the Build header and the "Delivered so far" chip read one state. Fixture: the N04-U01 payload from the WH walk, a
// published App (app_url, delivery.delivered has app) whose results are not trusted yet. Fail-pre: before the fix the header said
// "1 not published, because a vibe was not met" next to "1 App".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { implementState, statusReason } from '../src/lib/implementWizard.js';
import { buildSummary, buildSummaryLines, deliveredOutputs } from '../src/lib/implementControl.js';

const latest = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/implement_untrusted_published.json', import.meta.url)), 'utf8'));
const item = (row, extra = {}) => ({ state: implementState(row, null), latest: row, notebook: null, uc: {}, ...extra });

test('the walker payload is a published App whose results are not trusted yet (one state, not a vibe hold)', () => {
  const state = implementState(latest, null);
  assert.equal(state.label, 'MVP built, results not trusted yet');
  assert.equal(state.hold, 'untrusted');
  assert.deepEqual(deliveredOutputs(latest), ['app']);
  assert.match(statusReason(latest, null), /The App is published with a Results not trusted yet banner/);
});

test('the header never says not published for a published App, and counts no vibe hold (must-exclude)', () => {
  const summary = buildSummary([item(latest)]);
  const lines = buildSummaryLines(summary).join(' ');
  assert.equal(summary.vibeHeld, 0, 'an untrusted App is not a vibe hold');
  assert.doesNotMatch(lines, /not published/i);
  assert.doesNotMatch(lines, /vibe was not met/);
  assert.equal(lines, '1 published, with results not trusted yet. Open one to see why.');
});

test('the header and the Delivered chip come from the same payload: the chip says 1 App and the header says the App is published', () => {
  const summary = buildSummary([item(latest)]);
  const app = summary.delivered.find((entry) => entry.id === 'app');
  assert.equal(app?.text, '1 App'); // D-LABEL209: the delivery output reads App on every surface
  assert.match(buildSummaryLines(summary).join(' '), /1 published/);
});

test('an App that is really not published keeps the not published wording, with the untrusted reason', () => {
  const held = { ...latest, app_url: '', asset_status: { ...latest.asset_status, not_reliable: { ...latest.asset_status.not_reliable, app: 'held' } } };
  const summary = buildSummary([item(held)]);
  assert.equal(summary.untrustedPublished, 0);
  assert.equal(buildSummaryLines(summary).join(' '), '1 not published until a run passes, because its results are not trusted yet. Open one to see why.');
});

test('a real vibe hold still reads as not published because a vibe was not met', () => {
  const vibe = { ...latest, status: 'vibe_not_met', asset_status: {} };
  const summary = buildSummary([item(vibe)]);
  assert.equal(summary.vibeHeld, 1);
  assert.match(buildSummaryLines(summary).join(' '), /1 not published, because a vibe was not met/);
});

test('an unmet vibe ask on a published App reads as published, with 1 ask not met', () => {
  const row = { ...latest, status: 'ready_with_warnings', latest_run: null,
    asset_status: { delivery: latest.asset_status.delivery, checklist: [{ status: 'not_met', kind: 'ask', requirement: 'Show flagged records by method', part: 'app', evidence: 'none' }] } };
  const summary = buildSummary([item(row)]);
  assert.equal(summary.unmetPublished, 1);
  assert.equal(buildSummaryLines(summary).join(' '), '1 published, with a vibe ask not met. Open one to see why.');
});
