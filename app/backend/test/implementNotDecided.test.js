const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const FIXTURE = require('./fixtures/implement_not_decided_cases.json');

const APP = path.resolve(__dirname, '..', '..');
const lib = (name) => import(pathToFileURL(path.join(APP, 'frontend', 'src', 'lib', name)).href);
const row = (c) => ({ spec_version: c.version, status: 'failed', status_message: c.status_message, spec_json: { vibes: 'x' },
  asset_status: { checklist: c.entries, checklist_summary: c.summary } });

test('every ask the vibe router could not place reads as its own kind with the agent reason, never met, never missed, never counted', async () => {
  const P = await lib('mvpProgress.js');
  assert.equal(P.NOT_DECIDED_KIND, FIXTURE.kind);
  assert.equal(FIXTURE.cases.length, 4);
  for (const c of FIXTURE.cases) {
    const list = P.vibeChecklist(null, row(c));
    assert.deepEqual([list.met, list.total, list.notDecided, list.missed, list.unchecked], [0, 0, c.entries.length, 0, 0], c.name);
    assert.deepEqual([c.summary.met, c.summary.not_decided], [0, c.entries.length], 'the agent counts none of them met');
    assert.equal(P.checklistHeadline(list), c.entries[0].evidence, `${c.name}: the agent reason is the headline`);
    assert.equal(c.entries[0].evidence, [...c.status_message].slice(0, 1500).join(''), 'which is the reason the version failed with, as the entry holds it');
    list.entries.forEach((entry, i) => {
      assert.deepEqual([entry.requirement, entry.evidence], [c.entries[i].requirement, c.entries[i].evidence]);
      assert.deepEqual([P.checklistState(entry), P.checklistStatusText(entry), P.checklistRounds(entry)], ['not_decided', 'Not decided', '']);
    });
    assert.deepEqual([P.notMetAsks(list), P.missedAsks(list), P.rephrasableAsks(list)], [[], [], []]);
    assert.deepEqual(c.unmet, [], 'the agent holds none of them');
    for (const step of c.steps.filter((s) => s.status === 'ended_error')) {
      assert.deepEqual(step.result_json.checklist, c.entries, 'the step carries the same entries the row does');
    }
  }
  const longest = FIXTURE.cases[3].entries[0].evidence;
  assert.ok(longest.includes(`the last with: ${'x'.repeat(500)}, so it built nothing`), 'the agent keeps 500 characters of a longer router failure');
  assert.ok(!longest.includes('x'.repeat(501)), 'and not one more');
});

test('a version whose asks were not decided is no held version and has nothing to rephrase', async () => {
  const C = await lib('implementControl.js');
  const P = await lib('mvpProgress.js');
  for (const c of FIXTURE.cases) {
    assert.equal(C.heldVersion(row(c), []), null);
    assert.deepEqual(C.rephraseOf(P.vibeChecklist(null, row(c)), row(c)), { text: '', replaces: [] });
  }
  const mixed = P.vibeChecklist(null, { spec_version: 3, asset_status: { checklist: [...FIXTURE.cases[2].entries, { n: 2, requirement: 'Weekly bars', status: 'not_met', evidence: 'daily bars' }] } });
  assert.deepEqual([mixed.total, mixed.missed, mixed.notDecided], [1, 1, 1], 'an ask Genie missed still counts and is still missed beside one not decided');
  assert.deepEqual(P.rephrasableAsks(mixed).map((e) => e.requirement), ['Weekly bars']);
});
