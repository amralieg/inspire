const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const FIXTURE = require('./fixtures/implement_self_fix_cases.json');

const APP = path.resolve(__dirname, '..', '..');
const lib = (name) => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', name)).href);
const named = (prefix) => FIXTURE.cases.find((c) => c.name.startsWith(prefix));
const TWO_FIXED = named('Inspire put back two');
const MIXED = named('Inspire put back one');
const NO_ROUND = named('Inspire could not put back');
const row = (c, extra = {}) => ({ spec_version: c.version, status: 'ready', asset_status: { checklist: c.entries, checklist_summary: c.summary }, ...extra });
const agentLine = (met, total, fixed) => `${met} of ${total} ${total === 1 ? 'vibe requirement' : 'vibe requirements'} met`
  + `${fixed ? `; Inspire put back ${fixed} ${fixed === 1 ? 'element' : 'elements'} no ask targets` : ''}`;

test('every self-fix and unrequested change the agent writes is counted as the agent counts it and reads with its own state words', async () => {
  const P = await lib('mvpProgress.js');
  assert.deepEqual([P.SELF_FIX_KIND, P.UNREQUESTED_KIND, P.SELF_FIX_PHASE, P.VIBE_CHECKLIST_PHASE],
    [FIXTURE.self_fix_kind, FIXTURE.unrequested_kind, FIXTURE.self_fix_step, FIXTURE.checklist_step]);
  assert.equal(FIXTURE.cases.length, 4);
  for (const c of FIXTURE.cases) {
    const list = P.vibeChecklist(null, row(c));
    assert.deepEqual({ met: list.met, total: list.total, ...(list.selfFixed ? { self_fixed: list.selfFixed } : {}) }, c.summary, c.name);
    assert.equal(list.entries.length, c.entries.length);
    list.entries.forEach((entry, i) => {
      const raw = c.entries[i];
      const fixed = raw.kind === FIXTURE.self_fix_kind;
      assert.deepEqual([entry.requirement, entry.evidence], [raw.requirement, raw.evidence], 'the agent words, as written');
      assert.deepEqual([P.checklistState(entry), P.checklistStatusText(entry)], fixed ? ['self_fixed', 'Put back by Inspire'] : ['unrequested', 'Changed with no ask'],
        `${c.name}: ${raw.requirement}`);
    });
  }
  const [fixedEntry] = P.vibeChecklist(null, row(MIXED)).entries;
  assert.equal(fixedEntry.requirement, 'Keep the Buffer priority chart as v3 built it: no ask of v4 targets it');
  assert.equal(fixedEntry.evidence, 'Genie removed the Buffer priority chart; Inspire put it back as v3 built it');
  const held = P.vibeChecklist(null, row(MIXED)).entries[1];
  assert.equal(held.evidence, 'Genie removed the Cash buffer by action tier chart, and Inspire could not put it back because its dataset outlook is gone for the asks '
    + 'of the Fourteen-day takings outlook chart', 'the rounds are said once, in the held reason');
  assert.equal(held.rounds, 3);
  assert.equal(P.checklistRounds(held), '', 'the agent says the rounds in its own words, so the state word never repeats them');
  const unnamed = P.vibeChecklist(null, row(NO_ROUND)).entries[0];
  assert.equal(unnamed.requirement, 'Keep the Late orders counter as the version before built it: no ask of v4 targets it');
  assert.equal(unnamed.evidence, 'Genie moved the Late orders counter, and Inspire could not put it back because it now sits where an ask placed a new chart');
});

test('a self-fix is never an ask: it is not counted, not missed, and the headline adds the agent words about it', async () => {
  const P = await lib('mvpProgress.js');
  for (const c of FIXTURE.cases) {
    const message = c.steps.find((s) => s.step_name === FIXTURE.checklist_step).message;
    assert.equal(message, agentLine(c.summary.met, c.summary.total, c.summary.self_fixed), `the agent template: ${message}`);
  }
  const two = P.vibeChecklist(null, row(TWO_FIXED));
  assert.deepEqual([P.missedAsks(two), P.notMetAsks(two)], [[], []]);
  for (const c of FIXTURE.cases) {
    const message = c.steps.find((s) => s.step_name === FIXTURE.checklist_step).message;
    assert.equal(P.checklistHeadline(P.vibeChecklist(null, row(c))), message, `${c.name}: the headline is the agent message, byte for byte`);
  }
  assert.equal(P.checklistHeadline(two), '0 of 0 vibe requirements met; Inspire put back 2 elements no ask targets');
  const mixed = P.vibeChecklist(null, row(MIXED));
  assert.equal(P.checklistHeadline(mixed), '0 of 1 vibe requirement met; Inspire put back 1 element no ask targets');
  const many = { ...mixed, met: 2, total: 3, missed: 1, selfFixed: 4 };
  assert.equal(P.checklistHeadline(many), agentLine(2, 3, 4), 'word for word with the agent');
  assert.equal(P.checklistHeadline({ ...many, unchecked: 1, missed: 0 }), agentLine(2, 3, 4), 'an ask Inspire could not check is said on its row, not in the agent count');
  assert.equal(P.checklistHeadline({ met: 1, total: 2 }), agentLine(1, 2, 0));
});

test('an unrequested change holds the version with the agent reason, never goes back in the vibe box, and the held text counts only the asks', async () => {
  const P = await lib('mvpProgress.js');
  const C = await lib('implementControl.js');
  assert.ok(MIXED.held_reason.startsWith('1 ask is not met, so nothing of v4 is published and v3 stays live: App (the Cash buffer'), MIXED.held_reason);
  assert.equal((MIXED.held_reason.match(/round/g) || []).length, 1, 'the agent says the rounds once');
  assert.match(MIXED.held_reason, /Genie could not do it in 3 build rounds: /);
  const latest = { ...row(MIXED), status: 'vibe_not_met', spec_json: { vibes: '', outputs: { app: true } },
    asset_status: { ...row(MIXED).asset_status, held: { parts: ['app'], reason: MIXED.held_reason, unmet: MIXED.unmet } } };
  const list = P.vibeChecklist(null, latest);
  assert.deepEqual(P.notMetAsks(list).map((e) => e.requirement), MIXED.unmet.map((e) => e.requirement), 'what holds the version is what the agent holds it for');
  assert.deepEqual(P.missedAsks(list).map((e) => e.requirement), MIXED.unmet.map((e) => e.requirement));
  assert.deepEqual(P.rephrasableAsks(list), []);
  assert.deepEqual(C.rephraseOf(list, latest), { text: '', replaces: [] });
  const held = C.heldVersion(latest, [{ spec_version: 3, status: 'ready' }, latest]);
  assert.deepEqual([held.version, held.before, held.reason], [4, 3, MIXED.held_reason]);
  const asked = { ...list, entries: [...list.entries, { ...list.entries[1], unrequested: false, requirement: 'Make the tier chart blue' }] };
  assert.equal(C.rephraseOf(asked, latest).text, 'Make the tier chart blue', 'an ask that was not met still goes back in the vibe box');
});

const PLAN = {
  build: [], classes: ['outputs', 'vibe'], delete: [], keep_unmanaged: [], preview: false, refill: false, refresh: ['app'], repoint: [], restyle: [],
  rollback: {}, rollback_built: {}, schedule: false, sharing: true,
};
const step = (phase, status, time, payload = {}, message = '') => ({
  step_id: 1, stage_name: 'Implement Use Cases', step_name: phase, sub_step_name: 'n02-u01', status, message, last_updated: `2026-01-02T${time}.000Z`,
  result_json: ({ use_case_id: 'N02-U01', phase, spec_version: 4, event_at: `2026-01-02T${time}+00:00`, ...payload }),
});

test('a Self-fix step adds a done Self-fix stage before Done in the run log, and a version with none has no such stage', async () => {
  const P = await lib('mvpProgress.js');
  const latest = { status: 'ready', spec_version: 4, spec_json: { vibes: 'make the outlook a globe', outputs: { app: true } }, asset_status: {} };
  const fix = MIXED.steps.find((s) => s.step_name === FIXTURE.self_fix_step);
  const base = [step('Vibe', 'ended_success', '10:00:01'), step('Plan', 'ended_success', '10:00:02', { plan: PLAN }), step('App', 'ended_success', '10:03:00')];
  const steps = [...base, step(FIXTURE.checklist_step, 'ended_warning', '10:03:10', { checklist: MIXED.entries }),
    step(fix.step_name, fix.status, '10:03:11', { self_fixed: fix.result_json.self_fixed }, fix.message)];
  const stages = P.mvpStages(steps, latest, { now: Date.parse('2026-01-02T10:05:00Z') });
  assert.deepEqual(stages.map((s) => s.id).slice(-2), ['Self-fix', 'Done']);
  assert.deepEqual(stages.filter((s) => s.id === 'Self-fix').map((s) => [s.label, s.state]), [['Self-fix', 'done']], 'a fix is green, never a warning');
  assert.equal(P.mvpStages(base, latest, { now: Date.parse('2026-01-02T10:05:00Z') }).some((s) => s.id === 'Self-fix'), false);
  const other = [...base, step(fix.step_name, fix.status, '10:03:11', { spec_version: 3 })];
  assert.equal(P.mvpStages(other, latest, { now: Date.parse('2026-01-02T10:05:00Z') }).some((s) => s.id === 'Self-fix'), false, 'another version\u2019s fix');
  const live = P.vibeChecklist(steps, { ...latest, asset_status: {} });
  assert.deepEqual([live.live, live.selfFixed, live.total], [true, 1, 1], 'the live step fills the checklist with the fix before the record lands');
});
