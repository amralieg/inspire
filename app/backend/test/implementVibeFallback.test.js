const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const FIXTURE = require('./fixtures/implement_vibe_fallback_cases.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const latestOf = (c, extra = {}) => ({ status: 'ready_with_warnings', spec_version: c.version, created_at: '2026-01-02T10:00:00.000Z',
  spec_json: { vibes: c.record.text, outputs: { dashboard: true } }, asset_status: { vibe: c.record }, ...extra });
const said = (item) => `\u201c${item.ask.replace(/[.!?]+$/, '')}\u201d went here because ${item.reason}, so Genie tries it there.`;
const stepRows = (c) => c.steps.map((s, i) => ({ step_id: i + 1, step_name: s.step_name, status: s.status, message: s.message,
  last_updated: `2026-01-02T10:00:0${i}.000Z`, result_json: s.result_json }));

test('every ask the agent sent to another part than the one it names says, on the route line of that part, where it went and the reason the agent recorded', async () => {
  const { vibeRouting, vibeRoutingLines } = await lib('mvpProgress.js');
  assert.equal(FIXTURE.cases.length, 2);
  for (const c of FIXTURE.cases) {
    assert.ok(c.record.fallback.length > 0 && c.fallback_lines.length === c.record.fallback.length, c.name);
    const lines = vibeRoutingLines(vibeRouting([], latestOf(c)));
    assert.deepEqual(lines.map((l) => l.id).sort(), Object.keys(c.record.routes).sort(), `${c.name}: one line per part the agent sent asks to`);
    const notes = lines.map((l) => l.note).join(' ');
    for (const item of c.record.fallback) {
      const line = lines.find((l) => l.id === item.asset);
      assert.ok(line && line.note.includes(said(item)), `${c.name}: ${JSON.stringify(line)}`);
      assert.equal(notes.split(said(item)).length, 2, 'said once');
      assert.ok(c.fallback_lines.some((agent) => agent.startsWith(`'${item.ask}' went to the `) && agent.includes(`because ${item.reason}, so Genie tries it there`)),
        `the agent line names the same ask and reason: ${FIXTURE.source}`);
    }
    for (const line of lines.filter((l) => !c.record.fallback.some((item) => item.asset === l.id))) {
      assert.ok(!line.note.includes('went here because'), `a part no ask was redirected to says nothing about it: ${line.text}`);
    }
  }
});

test('the reason an ask went elsewhere comes only from the record of this version, never from the prose of the step line', async () => {
  const { vibeRouting, vibeRoutingLines } = await lib('mvpProgress.js');
  const [c] = FIXTURE.cases;
  const live = vibeRoutingLines(vibeRouting(stepRows(c), latestOf(c, { status: 'building_outputs', asset_status: {} })));
  assert.ok(live.length > 0, 'while the version builds the step lines still show where each ask went');
  assert.ok(c.steps.some((s) => String(s.message).includes(c.fallback_lines[0])), 'the step carries the agent prose');
  assert.ok(live.every((l) => !l.note.includes('went here because')), 'and the App never parses it');
  const older = vibeRoutingLines(vibeRouting([], latestOf(c, { spec_version: c.version + 1 })));
  assert.deepEqual(older, [], 'the record of another version is not this one');
  const broken = { ...c.record, fallback: [{ ask: 'Add a map', reason: '', asset: 'notebook' }, { ask: '', reason: 'it names maps', asset: 'notebook' },
    { ask: 'Add a map', reason: 'it names maps', asset: '' }, 'junk', null] };
  const shown = vibeRoutingLines(vibeRouting([], latestOf(c, { asset_status: { vibe: broken } })));
  assert.ok(shown.length > 0 && shown.every((l) => !l.note.includes('went here because')), 'an item missing its ask, reason or part shows nothing');
});
