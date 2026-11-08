const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const OWNER = ['owner', 'example.com'].join('@');
const APP_OWNER = ['lee', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');
const VIBE = 'Put the riskiest customers first';
const HELD = 'vibe_not_met';
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const HELD_CASES = require('./fixtures/implement_held_cases.json');
const HELD_REASON = HELD_CASES.cases.find((c) => c.name.startsWith('one ask missed on v2 while v1 stays live')).held_reason;

const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [APP_OWNER], inspire_url: 'https://inspire.example.com' },
};

function clean(top = {}) {
  const out = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), ...top });
  assert.deepEqual(out.errors, [], JSON.stringify(top));
  return out.spec;
}

const live = (version) => ({ state: 'ready', spec_version: version });
const PAGE = 'app:page:n01_u01';
const LIVE_ASSETS = { dashboard: live(1), genie_space: live(1), app: live(1), notebook: live(1), [PAGE]: { ...live(1), name: 'Decisions' } };

function row(version, status, extra = {}) {
  return {
    session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, created_by: OWNER, spec_json: clean(),
    notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', dashboard_url: 'https://w/d1', genie_space_id: 'g1', genie_space_url: 'https://w/g1',
    app_name: 'churn-desk', app_url: 'https://churn-desk.example.com',
    asset_status: LIVE_ASSETS,
    updated_at: `2026-10-2${version}T04:00:00Z`,
    ...extra,
  };
}

const SENT = clean({ vibes: `${VIBE}\nCount returns by week`, vibe_previous: 'keep', based_on_version: 1, retry_outputs: ['dashboard'],
  outputs: { ...BASE.outputs, dashboard_vibes: 'Weekly bars' } });
const STORED = {
  ...SENT,
  outputs: { ...SENT.outputs, dashboard_vibes: `Weekly bars\n${VIBE}`, [`${PAGE}_vibes`]: VIBE },
  data: { ...SENT.data, notes: 'Count returns by week' },
  retry_outputs: ['dashboard', PAGE],
};

const heldRow = (version, extra = {}) => row(version, HELD, {
  spec_json: JSON.parse(JSON.stringify(STORED)),
  asset_status: { ...LIVE_ASSETS, held: { parts: ['dashboard'], reason: HELD_REASON }, checklist: [{ n: 1, requirement: VIBE, status: 'not_met' }],
    checklist_summary: { met: 1, total: 2 } },
  ...extra,
});

function leafDiff(want, got, at = []) {
  if (want && typeof want === 'object' && !Array.isArray(want)) return Object.keys(want).flatMap((key) => leafDiff(want[key], got?.[key], [...at, key]));
  return JSON.stringify(want) === JSON.stringify(got) ? [] : [at.join('.')];
}

const HELD_HISTORY = [heldRow(2), row(1, 'ready')];
const stored = (rows) => rows.map((r) => ({ ...r, spec_json: JSON.stringify(r.spec_json), asset_status: JSON.stringify(r.asset_status) }));

async function call(base, url, { method = 'GET', body, who } = {}) {
  const resp = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { 'x-forwarded-email': who } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

const inserts = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => ({ spec: JSON.parse(c.parameters.find((p) => p.name === 'spec').value), by: (c.parameters.find((p) => p.name === 'by') || {}).value,
    version: (c.parameters.find((p) => p.name === 'v') || {}).value }));

const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const PUBLISH = '/api/inspire/implement/publish?use_case_id=N01-U01';

test('the stored held spec the agent writes re-validates clean, and the one helper builds Try again, Vibe/Add/Remove Features and Publish anyway from it as stored', async () => {
  const W = await lib('implementWizard.js');
  assert.deepEqual(I.validateImplementSpec(STORED).errors, [], 'a held spec as stored re-validates clean');
  const held = heldRow(2);
  const again = W.specFromHeld(held);
  assert.deepEqual(again, STORED, 'Try again sends the held spec exactly as stored');
  assert.notEqual(again, held.spec_json, 'a copy, so an edit never changes the history row');
  assert.deepEqual(W.specFromHeld(held, { publish: true }), { ...STORED, publish_held: 2, based_on_version: 2 });
  for (const status of ['ready', 'ready_with_warnings', 'failed', 'filling', 'uninstalled']) assert.equal(W.specFromHeld({ ...held, status }), null, status);
  const fallback = W.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: OWNER });
  const edit = W.specFromLatest(held, fallback);
  assert.deepEqual(leafDiff(STORED, edit), [], 'Vibe/Add/Remove Features starts from every stored leaf, retry_outputs included');
  const stripped = JSON.parse(JSON.stringify(edit));
  delete stripped.retry_outputs;
  assert.deepEqual(leafDiff(STORED, stripped), ['retry_outputs'], 'a key stripped from the stored spec fails the comparison');
  delete stripped.outputs[`${PAGE}_vibes`];
  assert.deepEqual(leafDiff(STORED, stripped), [`outputs.${PAGE}_vibes`, 'retry_outputs']);
  const built = W.specFromLatest({ ...held, status: 'ready_with_warnings' }, fallback);
  assert.ok(!Object.hasOwn(built, 'retry_outputs') && !Object.hasOwn(built, 'vibes'), 'a version that is not held still starts without its one-time asks');
});

test('an owner publishes the held latest version anyway, as the next version through the same start path as every build', async () => {
  const W = await lib('implementWizard.js');
  for (const who of [OWNER, APP_OWNER.toUpperCase()]) {
    await withApp({ history: stored(HELD_HISTORY) }, async (url, made) => {
      const got = await call(url, PUBLISH, { method: 'POST', body: { ...DB, spec: W.specFromHeld(heldRow(2), { publish: true }) }, who });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal(got.data.spec_version, 3);
      assert.equal(made.jobs.length, 1, 'one job run, started the way submit starts one');
      assert.equal(made.jobs[0].params['15_operation'], 'Implement Use Cases');
      const [sent] = inserts(made);
      assert.deepEqual([sent.version, sent.spec.publish_held, sent.spec.based_on_version], ['3', 2, 2]);
      assert.deepEqual(leafDiff({ ...STORED, publish_held: 2, based_on_version: 2 }, sent.spec), [], 'the held spec goes in as stored, with the version to publish');
      const writes = made.sqlCalls.filter((c) => /^(INSERT|UPDATE)/.test(String(c.sql))).map((c) => String(c.sql).split(' ')[0]);
      assert.deepEqual(writes, ['INSERT', 'UPDATE'], 'the run id is recorded on the new version as for every build');
    });
  }
  await withApp({ history: stored(HELD_HISTORY) }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: W.specFromHeld(heldRow(2)) }, who: OTHER });
    assert.equal(got.status, 200, `Try again is a plain build anyone with access may start: ${JSON.stringify(got.data)}`);
    const [again] = inserts(made);
    assert.deepEqual(leafDiff(STORED, again.spec), [], 'Try again goes in as stored');
    assert.equal(Object.hasOwn(again.spec, 'publish_held'), false);
  });
});

test('a person who does not own the MVP cannot publish a held version, through the publish route or through submit', async () => {
  const W = await lib('implementWizard.js');
  const body = { ...DB, spec: W.specFromHeld(heldRow(2), { publish: true }) };
  await withApp({ history: stored(HELD_HISTORY) }, async (url, made) => {
    const got = await call(url, PUBLISH, { method: 'POST', body, who: OTHER });
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.equal(got.data.error, 'only the owners of this MVP can publish v2 anyway: the person who asked for v2 and the App owners it names');
    const sneak = await call(url, '/api/inspire/implement/submit', { method: 'POST', who: OTHER, body });
    assert.equal(sneak.status, 403, 'submit runs the same owner check');
    assert.equal(inserts(made).length, 0, 'nothing is written');
    assert.equal(made.jobs.length, 0, 'nothing is started');
  });
  await withApp({ history: stored(HELD_HISTORY), me: {} }, async (url, made) => {
    const got = await call(url, PUBLISH, { method: 'POST', body });
    assert.equal(got.status, 403);
    assert.equal(got.data.error, 'Inspire could not tell who you are, so it cannot check that you own this MVP');
    assert.equal(made.jobs.length, 0);
  });
});

test('publish anyway is refused for a version that is not held, not the latest or not there, for a spec that is not the held one, and for a version number that is not one', async () => {
  const W = await lib('implementWizard.js');
  const publishing = (version) => ({ ...W.specFromHeld(heldRow(2), { publish: true }), publish_held: version, based_on_version: version });
  const cases = [
    ['a built version', [row(2, 'ready'), row(1, 'ready')], 2, 409, 'v2 is ready, not held for vibes that were not met, so there is nothing to publish anyway'],
    ['a failed version', [row(2, 'failed'), row(1, 'ready')], 2, 409, 'v2 is failed, not held for vibes that were not met, so there is nothing to publish anyway'],
    ['a held version that is no longer the latest', [row(3, 'failed'), heldRow(2), row(1, 'ready')], 2, 409,
      'v2 is no longer the latest version (v3 is), so it cannot be published anyway'],
    ['a version that does not exist', HELD_HISTORY, 7, 404, 'there is no v7 to publish'],
  ];
  for (const [name, history, version, status, error] of cases) {
    await withApp({ history: stored(history) }, async (url, made) => {
      const got = await call(url, PUBLISH, { method: 'POST', body: { ...DB, spec: publishing(version) }, who: OWNER });
      assert.deepEqual([got.status, got.data.error], [status, error], name);
      assert.equal(made.jobs.length, 0, `${name}: nothing is started`);
      assert.equal(inserts(made).length, 0, `${name}: nothing is written`);
    });
  }
  const changed = 'the spec sent to publish v2 anyway is not v2 as it was held; reload the page and press Publish anyway again';
  const stripped = publishing(2);
  delete stripped.retry_outputs;
  const reworded = publishing(2);
  reworded.outputs = { ...reworded.outputs, [`${PAGE}_vibes`]: 'Something else' };
  for (const [name, spec, status, error] of [
    ['a stripped retry list', stripped, 409, changed],
    ['an ask changed on the way', reworded, 409, changed],
    ['no publish_held', W.specFromHeld(heldRow(2)), 400, 'Publish anyway sends the held spec with publish_held set to the held version'],
    ['publish_held that is not a number', { ...publishing(2), publish_held: 'x' }, 400, "publish_held 'x' must be a version number, 1 or more"],
    ['publish_held 0', { ...publishing(2), publish_held: 0 }, 400, 'publish_held 0 must be a version number, 1 or more'],
  ]) {
    await withApp({ history: stored(HELD_HISTORY) }, async (url, made) => {
      const got = await call(url, PUBLISH, { method: 'POST', body: { ...DB, spec }, who: OWNER });
      assert.deepEqual([got.status, got.data.error], [status, error], name);
      assert.equal(made.jobs.length, 0, `${name}: nothing is started`);
    });
  }
  await withApp({ history: stored(HELD_HISTORY) }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/publish?use_case_id=N09-U09', { method: 'POST', body: { ...DB, spec: publishing(2) }, who: OWNER });
    assert.deepEqual([got.status, got.data.error], [400, 'the spec is for use case N01-U01, not N09-U09']);
    assert.equal(made.jobs.length, 0);
  });
});

test('the address Inspire stamps is no edit: a held version stored with no address or another one publishes with the current one, and an edited ask is still refused', async () => {
  const W = await lib('implementWizard.js');
  const heldAt = (address) => heldRow(2, { spec_json: { ...JSON.parse(JSON.stringify(STORED)), outputs: { ...STORED.outputs, inspire_url: address } } });
  for (const address of ['', 'https://old-inspire.example.com']) {
    const history = [heldAt(address), row(1, 'ready')];
    await withApp({ history: stored(history) }, async (url, made) => {
      const got = await call(url, PUBLISH, { method: 'POST', body: { ...DB, spec: W.specFromHeld(heldAt(address), { publish: true }) }, who: OWNER });
      assert.equal(got.status, 200, `${JSON.stringify(address)}: ${JSON.stringify(got.data)}`);
      const [sent] = inserts(made);
      assert.equal(sent.spec.outputs.inspire_url, 'https://inspire.example.com', `${JSON.stringify(address)}: the version goes live with the current address`);
      assert.deepEqual(leafDiff({ ...STORED, publish_held: 2, based_on_version: 2 }, sent.spec), [], `${JSON.stringify(address)}: every other leaf as held`);
    });
    const edited = W.specFromHeld(heldAt(address), { publish: true });
    edited.outputs = { ...edited.outputs, [`${PAGE}_vibes`]: 'Something else' };
    await withApp({ history: stored(history) }, async (url, made) => {
      const got = await call(url, PUBLISH, { method: 'POST', body: { ...DB, spec: edited }, who: OWNER });
      assert.deepEqual([got.status, got.data.error], [409, 'the spec sent to publish v2 anyway is not v2 as it was held; reload the page and press Publish anyway again'],
        `${JSON.stringify(address)}: an edited ask`);
      assert.equal(made.jobs.length, 0);
    });
  }
});

test('the status route tells the signed-in person whether they may press Publish anyway, through the same owner check', async () => {
  const flag = async (history, who, me) => {
    let out;
    await withApp({ history: stored(history), ...(me ? { me } : {}) }, async (url) => {
      const got = await call(url, `/api/inspire/implement/status?${Q}`, { who });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      out = got.data.can_publish_held;
    });
    return out;
  };
  assert.equal(await flag(HELD_HISTORY, OWNER), true, 'the person who asked for the held version');
  assert.equal(await flag(HELD_HISTORY, APP_OWNER.toUpperCase()), true, 'an App owner it names, in any case');
  assert.equal(await flag(HELD_HISTORY, OTHER), false, 'a person who owns nothing of it');
  assert.equal(await flag(HELD_HISTORY, '', {}), false, 'a person Inspire cannot name');
  assert.equal(await flag([row(2, 'ready'), row(1, 'ready')], OWNER), false, 'the latest version is not held');
  assert.equal(await flag([row(3, 'failed'), heldRow(2), row(1, 'ready')], OWNER), false, 'a held version that is no longer the latest');
});

test('the plan check refuses publish_held the same way whatever route sent it, and lets an owner or an App owner through', () => {
  const asked = (who, history = HELD_HISTORY) => () => I.planSubmission(history, { ...HELD_HISTORY[0].spec_json, publish_held: 2 }, null, { requester: who });
  assert.doesNotThrow(asked(OWNER));
  assert.doesNotThrow(asked(` ${APP_OWNER.toUpperCase()} `), 'an App owner named in the held version, in any case');
  assert.throws(asked(OTHER), (err) => err.statusCode === 403);
  assert.throws(asked(''), (err) => err.statusCode === 403 && /could not tell who you are/.test(err.message));
  assert.throws(asked(null), (err) => err.statusCode === 403, 'a caller that passes no person never gets through');
  const plan = I.planSubmission(HELD_HISTORY, { ...HELD_HISTORY[0].spec_json, publish_held: 2 }, null, { requester: OWNER });
  assert.deepEqual([plan.nextVersion, plan.built.spec_version, plan.unchanged], [3, 1, false], 'the version before stays the built one');
  assert.deepEqual(I.implementOwners(HELD_HISTORY[0]), [OWNER, APP_OWNER]);
  assert.deepEqual(I.implementOwners({ spec_json: { outputs: { app_owners: 'not a list' } } }), [], 'no owner named, nobody owns it');
});

test('vibe_not_met is terminal and never counts as built, ready or failed in any backend list', () => {
  assert.equal(I.IMPLEMENT_VIBE_NOT_MET, HELD);
  assert.ok(I.IMPLEMENT_STATUSES.includes(HELD));
  assert.ok(!I.IMPLEMENT_ACTIVE_STATUSES.includes(HELD), 'a held version is over, so the next edit can start');
  assert.ok(!I.IMPLEMENT_DONE_STATUSES.includes(HELD), 'nothing of a held version is published');
  const next = I.planSubmission(HELD_HISTORY, { ...clean({ vibes: `${VIBE} and show the region`, vibe_previous: 'keep' }), based_on_version: 2 }, null);
  assert.deepEqual([next.nextVersion, next.built.spec_version, next.unchanged], [3, 1, false], 'a rephrased vibe after a hold builds on the live version');
  const again = I.planSubmission(HELD_HISTORY, { ...HELD_HISTORY[0].spec_json }, null);
  assert.equal(again.unchanged, false, 'retrying the same asks after a hold is never refused as no change');
  const first = I.planSubmission([heldRow(1, { dashboard_id: null, genie_space_id: null, app_name: null })], { ...clean({ vibes: VIBE }), based_on_version: 1 }, null);
  assert.equal(first.built, null, 'a held first build leaves nothing built');
  const renamed = [heldRow(2, { spec_json: { ...HELD_HISTORY[0].spec_json, use_case_name: 'Held draft name' } }), row(1, 'ready')];
  assert.equal(I.mergeRegistry(renamed, { sessionId: '1', useCaseId: 'N09-U09' }).app[0].holders[0].use_case_name, 'Predict churn',
    'the App registry reads the built version, never the held one');
});

test('vibe_not_met never counts as failed or ready in the use case lists, the tiles, the chip, the stepper or the history', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const P = await lib('mvpProgress.js');
  const held = { ...HELD_HISTORY[0] };
  const state = W.implementState(held);
  assert.deepEqual(state, { group: 'held', label: 'MVP vibes not met', tone: 'warning', kind: 'mvp' });
  const groups = W.implementGroups([{ id: 'N01-U01', Name: 'Predict churn' }], [held], null);
  assert.deepEqual(groups.map((g) => [g.id, g.items.length]), [['in_progress', 0], ['attention', 1], ['ready', 0], ['not_started', 0]],
    'a held use case needs attention, next to a failed one');
  const readyOnly = W.implementGroups([{ id: 'N01-U01', Name: 'Predict churn' }], [row(1, 'ready')], null);
  assert.deepEqual(readyOnly.map((g) => [g.id, g.items.length]), [['in_progress', 0], ['attention', 0], ['ready', 1], ['not_started', 0]]);
  const counts = W.mvpCounts([state, W.implementState(row(1, 'ready')), W.implementState(row(1, 'failed'))]);
  assert.deepEqual(counts, { useCases: 3, has: 3, none: 0, live: 1, building: 0, held: 1, failed: 1 });
  assert.equal(W.mvpBucketOf(state), 'held');
  for (const other of ['live', 'building', 'failed']) assert.equal(W.mvpFilterMatches(other, state), false, `never in ${other}`);
  assert.equal(W.mvpFilterMatches('held', state), true);
  assert.ok(W.MVP_FILTERS.some((f) => f.id === 'held'));
  assert.deepEqual(W.statusChip(HELD), { label: 'Vibes not met', tone: 'warning' });
  assert.equal(W.versionActive(held), false);
  assert.ok(!W.IMPLEMENT_DONE_STATUSES.includes(HELD));
  assert.equal(W.IMPLEMENT_VIBE_NOT_MET, HELD);
  assert.equal(W.statusReason(held, null, HELD_HISTORY), HELD_REASON, 'the agent reason says what is not published and what stays live, once');
  const noReason = W.statusReason({ ...held, asset_status: { held: { parts: ['dashboard'] } } });
  assert.equal(noReason, 'Inspire held v2 but wrote no reason, so this page cannot say what was not met or what stays live: press Try again to build it again');
  assert.equal(W.statusReason({ ...held, asset_status: {} }), noReason, 'a held row with no held record reads the same');
  assert.equal(W.statusReason({ ...held, asset_status: { held: { reason: '   ' } } }), noReason, 'a blank reason is no reason');
  assert.ok(!noReason.includes(W.VIBE_NOT_MET_WORDS), 'nothing is filled in for the reason the agent did not write');
  assert.equal(W.statusReason(held), HELD_REASON);
  for (const c of HELD_CASES.cases) {
    const reason = W.statusReason({ status: HELD, spec_version: c.version, asset_status: { held: { reason: c.held_reason } } }, null, HELD_HISTORY);
    assert.equal(reason, c.held_reason, `${c.name}: ${HELD_CASES.source}`);
    assert.equal(reason.split('is published').length, 2, `not published is said once: ${reason}`);
  }
  assert.equal(W.historyStatus(held, held), 'vibes not met, not published');
  assert.equal(W.builtVersion(HELD_HISTORY), 1);
  assert.equal(C.liveVersion(HELD_HISTORY), 1, 'the version before stays the live one');
  assert.equal(C.buildSummary([{ state, latest: held }]).ready + C.buildSummary([{ state, latest: held }]).failed, 0);
  const tiles = C.controlTiles({ targets: { dashboard: 'd1' }, assets: { dashboard: { ok: true, published: true } } },
    { ...held, spec_json: { outputs: { dashboard: true, alert: true } } }).tiles;
  assert.deepEqual(tiles.map((t) => `${t.output.id}:${t.kind}`), ['dashboard:live', 'genie_space:off', 'app:off', 'alert:held']);
  assert.equal(tiles[3].note, 'Vibes not met, not published: nothing is live yet');
  const stages = P.mvpStages([{ step_id: 1, step_name: 'Inspire is working on done', status: 'ended_success', last_updated: '2026-10-29T04:00:00.000Z',
    result_json: JSON.stringify({ use_case_id: 'N01-U01', phase: 'Done', spec_version: 2 }) }], held);
  assert.equal(stages.at(-1).state, 'warning', 'the Done stage of a held version never reads done');
  assert.ok(!stages.some((s) => s.state === 'error'), 'and nothing of it reads failed');
});

test('the next Vibe/Add/Remove Features after a hold starts from the held version, so no ask is dropped, and publish_held never carries over', async () => {
  const W = await lib('implementWizard.js');
  const fallback = W.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: OWNER });
  const asks = { vibes: VIBE, vibe_previous: 'keep', retry_outputs: ['dashboard'], retry_asks: { dashboard: ['Arabic labels'] } };
  const held = { spec_version: 2, status: HELD, spec_json: { ...fallback, ...asks, based_on_version: 1, confirm_notebook_overwrite: true } };
  const next = W.specFromLatest(held, fallback);
  assert.deepEqual([next.vibes, next.vibe_previous, next.retry_outputs, next.retry_asks, next.based_on_version], [VIBE, 'keep', ['dashboard'], { dashboard: ['Arabic labels'] }, 1],
    'every key as stored, the version it was based on too');
  assert.equal(next.confirm_notebook_overwrite, true, 'no key of the held spec is stripped');
  for (const status of ['ready', 'ready_with_warnings', 'failed']) {
    const after = W.specFromLatest({ ...held, status }, fallback);
    for (const key of Object.keys(asks)) assert.ok(!Object.hasOwn(after, key), `${status} does not carry ${key}`);
  }
  const published = { spec_version: 3, status: 'ready_with_warnings', spec_json: { ...fallback, ...asks, publish_held: 2 } };
  assert.ok(!Object.hasOwn(W.specFromLatest(published, fallback), 'publish_held'));
  assert.ok(!Object.hasOwn(W.nextSpecFrom(published, {}), 'publish_held'));
  assert.ok(!Object.hasOwn(W.buildAgainChanges({ ...published, status: 'failed' }), 'publish_held'), 'Try again of a failed publish builds, it never publishes a version that is gone');
});

const UNCHECKED = 'Inspire could not check this ask: the App page did not load in time. Nothing shows the ask was missed: press Try again to check it again';
const entries = {
  met: { n: 1, requirement: 'Put the riskiest customers first', part: PAGE, status: 'met', evidence: 'The decision list sorts by risk', rounds: 1 },
  missed: { n: 2, requirement: 'Answer in euros', part: 'genie_space', status: 'not_met', evidence: 'The answers are in dollars', rounds: 3 },
  unchecked: { n: 3, requirement: 'Rows to act on first', part: PAGE, status: 'not_met', unchecked: true, evidence: UNCHECKED, rounds: 3 },
};
const checklistRow = (...items) => ({ ...heldRow(2), asset_status: { ...heldRow(2).asset_status, checklist: items } });

test('an ask Inspire could not check reads as could not be checked, never as missed, and the headline is the agent count of met asks', async () => {
  const P = await lib('mvpProgress.js');
  const C = await lib('implementControl.js');
  const only = P.vibeChecklist(null, checklistRow(entries.met, entries.unchecked));
  assert.deepEqual([only.met, only.missed, only.unchecked, only.total], [1, 0, 1, 2]);
  assert.equal(P.checklistHeadline(only), '1 of 2 vibe requirements met', 'the agent message; the row says it could not be checked');
  const [, entry] = only.entries;
  assert.deepEqual([entry.unchecked, P.checklistState(entry), P.checklistStatusText(entry), entry.evidence], [true, 'unchecked', 'Could not be checked after 3 rounds', UNCHECKED]);
  assert.equal(P.checklistStatusText({ ...entry, rounds: null }), 'Could not be checked');
  assert.deepEqual(P.missedAsks(only), [], 'nothing was missed');
  assert.deepEqual(P.notMetAsks(only).map((e) => e.n), [3], 'it is still open, so Publish anyway names it');
  assert.deepEqual(C.rephraseOf(only, checklistRow(entries.met, entries.unchecked)).text, '', 'Rephrase never offers an ask that was not missed');
  const missed = P.vibeChecklist(null, checklistRow(entries.met, entries.missed));
  assert.equal(P.checklistHeadline(missed), '1 of 2 vibe requirements met');
  assert.equal(P.checklistStatusText(missed.entries[1]), 'Not met after 3 rounds');
  const mixed = P.vibeChecklist(null, checklistRow(entries.met, entries.missed, entries.unchecked));
  assert.deepEqual([mixed.missed, mixed.unchecked], [1, 1]);
  assert.equal(P.checklistHeadline(mixed), '1 of 3 vibe requirements met');
  assert.deepEqual(C.rephraseOf(mixed, checklistRow(entries.met, entries.missed, entries.unchecked)).text, 'Answer in euros', 'Rephrase offers only the missed ask');
  const forged = P.vibeChecklist(null, checklistRow({ ...entries.met, unchecked: true }));
  assert.deepEqual([forged.entries[0].unchecked, forged.unchecked], [false, 0], 'a met ask is met, whatever else it carries');
  const anyway = P.vibeChecklist(null, checklistRow({ ...entries.unchecked, published_anyway: { by: OWNER, at: '2026-10-31T05:00:00Z' } }));
  assert.deepEqual([anyway.unchecked, P.checklistState(anyway.entries[0])], [0, 'anyway'], 'once published anyway it is no longer open');
});

test('Publish anyway of a held version makes no claim about what is live before the history loads, and names the version it replaces after', async () => {
  const C = await lib('implementControl.js');
  const unknown = C.heldVersion(heldRow(2), null);
  assert.equal(unknown.before, undefined);
  assert.equal(C.publishHeldText(unknown), 'Inspire puts the Dashboard of v2 live, with no Genie round, and marks each ask above as published anyway by you.');
  assert.equal(C.heldVersion(heldRow(2), undefined).before, undefined);
  const first = C.heldVersion(heldRow(2), []);
  assert.equal(first.before, null);
  assert.equal(C.publishHeldText(first), 'Inspire puts the Dashboard of v2 live for the first time, with no Genie round, and marks each ask above as published anyway by you.');
  const later = C.heldVersion(heldRow(2), HELD_HISTORY);
  assert.ok(!Object.hasOwn(C, 'heldText'), 'no App text stands in for the reason the agent writes');
  assert.equal(C.publishHeldText(later), 'Inspire puts the Dashboard of v2 live in place of v1, with no Genie round, and marks each ask above as published anyway by you.');
});

test('an MVP whose newest version is held, failed or building while an older version stays live counts as live on Choose, Results and the Build filters, and only a never-live MVP counts as held, failed or building (must-exclude)', async () => {
  const W = await lib('implementWizard.js');
  await withApp({ history: stored([heldRow(3), row(2, 'failed'), row(1, 'ready')]) }, async (url) => {
    const got = await call(url, '/api/inspire/implement/history?inspire_database=main.inspire&warehouse_id=wh1&session_id=42', { who: OWNER });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.latest.map((r) => [r.spec_version, r.status, r.live_version]), [[3, HELD, 1]], 'the newest row says which version is live');
  });
  await withApp({ history: stored([row(2, 'uninstalled'), row(1, 'ready')]) }, async (url) => {
    const got = await call(url, '/api/inspire/implement/history?inspire_database=main.inspire&warehouse_id=wh1&session_id=42', { who: OWNER });
    assert.deepEqual(got.data.latest.map((r) => r.live_version), [null], 'an uninstall leaves nothing live');
  });
  const states = {
    held: W.implementState({ ...heldRow(2), live_version: 1 }),
    failed: W.implementState({ ...row(3, 'failed'), live_version: 2 }),
    building: W.implementState({ ...row(2, 'filling'), live_version: 1 }),
    newestLive: W.implementState({ ...row(2, 'ready'), live_version: 2 }),
    heldAlone: W.implementState({ ...heldRow(1), live_version: null }),
    failedAlone: W.implementState({ ...row(1, 'failed'), live_version: null }),
  };
  assert.deepEqual(states.held, { group: 'held', label: 'MVP vibes not met', tone: 'warning', kind: 'mvp', live: 1 }, 'the newest version still needs attention');
  assert.deepEqual(states.failed, { ...W.implementState(row(3, 'failed')), live: 2 });
  assert.deepEqual(states.building, { ...W.implementState(row(2, 'filling')), live: 1 });
  assert.deepEqual(states.newestLive, { group: 'ready', label: 'MVP ready', tone: 'success', kind: 'mvp' });
  assert.deepEqual(states.heldAlone, { group: 'held', label: 'MVP vibes not met', tone: 'warning', kind: 'mvp' }, 'nothing live: the held version counts on its own');
  assert.equal(states.failedAlone.group, 'failed');
  assert.deepEqual(W.mvpCounts(Object.values(states)), { useCases: 6, has: 6, none: 0, live: 4, building: 0, held: 1, failed: 1 });
  assert.equal(W.mvpFilterMatches('live', states.held), true);
  assert.equal(W.mvpFilterMatches('held', states.held), false, 'a live MVP never lands in the held filter');
  assert.equal(W.mvpFilterMatches('live', states.heldAlone), false, 'must-exclude: a held first build is not live');
  const groups = W.implementGroups([{ id: 'N01-U01', Name: 'Predict churn' }], [{ ...heldRow(2), live_version: 1 }], null);
  assert.deepEqual(groups.map((g) => [g.id, g.items.length]), [['in_progress', 0], ['attention', 1], ['ready', 0], ['not_started', 0]],
    'the Choose page still lists it under Needs attention, where its held version is acted on');
});
