// SEC-02 AT3 (F7; REQ-518): the session check and the launcher's read check fail closed. A scope that cannot be checked (empty, too large
// to probe whole, or a probe that fails for any reason other than success) hides the session from everyone but its launcher.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const EMPTY = '6003';
const WIDE = '6004';
const ONE = (sid) => `/api/inspire/session?${W.DB}&session_id=${sid}`;
const LIST = `/api/inspire/sessions?${W.DB}&all=1`;
const WIDE_TABLES = Array.from({ length: 60 }, (_, i) => `main.s.t${String(i + 1).padStart(2, '0')}`);

async function seedExtra() {
  await W.seed();
  W.world.extraScope = { [EMPTY]: { business_name: 'EmptyCo', tables_str: '' }, [WIDE]: { business_name: 'WideCo', tables_str: WIDE_TABLES.join(',') } };
  S.state.sessionLaunchers = { ...S.state.sessionLaunchers, [EMPTY]: W.LAUNCHER, [WIDE]: W.LAUNCHER };
  S.state.knownSessions = [...S.state.knownSessions, EMPTY, WIDE];
  S.state.ledgerSessions = [...S.state.ledgerSessions, EMPTY, WIDE];
  S.state.sessionList = [...S.state.sessionList,
    { session_id: EMPTY, business_name: 'EmptyCo', completed_percent: 100, create_at: '2026-11-18T10:00:00Z', business_runs: 1, business_rank: 1 },
    { session_id: WIDE, business_name: 'WideCo', completed_percent: 100, create_at: '2026-11-17T10:00:00Z', business_runs: 1, business_rank: 1 }];
}
const listed = (got) => ((got.data && got.data.sessions) || []).map((s) => String(s.session_id));

test('AT3: a session with an empty scope is hidden from a person who did not launch it', async () => {
  await seedExtra();
  const got = await S.request('GET', ONE(EMPTY), { person: W.READER });
  assert.equal(got.status, 403, `AT3: Not implemented: an empty scope is shown to everyone (sessionHiddenFrom returns null when there is nothing to probe): ${got.status} ${got.text.slice(0, 200)}`);
  const list = await S.request('GET', LIST, { person: W.READER });
  assert.ok(!listed(list).includes(EMPTY), `AT3: the empty-scope session is not listed: ${JSON.stringify(listed(list))}`);
});

test('AT3: a scope of 60 tables where the person cannot read the 60th is hidden (no probe limit lets it through)', async () => {
  await seedExtra();
  W.world.probeLimitTable = WIDE_TABLES[59];
  const got = await S.request('GET', ONE(WIDE), { person: W.READER });
  assert.equal(got.status, 403, `AT3: Not implemented: only the first 50 tables are probed, so table 60 is never checked: ${got.status} ${got.text.slice(0, 200)}`);
});

test('AT3: a probe answered TABLE_OR_VIEW_NOT_FOUND (no USE SCHEMA) hides the session', async () => {
  await W.seed();
  W.world.probeError = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`orders` cannot be found. Verify the spelling and correct the schema and catalog.';
  const got = await S.request('GET', ONE(W.SECRET), { person: W.COLLEAGUE });
  assert.equal(got.status, 403, `AT3: Not implemented: a not-found probe counts as readable (only 'no read access' hides): ${got.status} ${got.text.slice(0, 200)}`);
});

test('AT3: a probe that fails for any other reason (the warehouse refuses) hides the session', async () => {
  await W.seed();
  W.world.probeError = 'PERMISSION_DENIED: User does not have CAN_USE on warehouse wh1.';
  const got = await S.request('GET', ONE(W.SECRET), { person: W.COLLEAGUE });
  assert.equal(got.status, 403, `AT3: Not implemented: a probe that could not run counts as readable: ${got.status} ${got.text.slice(0, 200)}`);
  assert.ok(!/SecretCo/.test(got.text), 'AT3: no session content');
});

test('AT3 control: the launcher still opens an empty-scope and a 60-table session', async () => {
  await seedExtra();
  for (const sid of [EMPTY, WIDE]) {
    const got = await S.request('GET', ONE(sid), { person: W.LAUNCHER });
    assert.equal(got.status, 200, `${sid}: ${got.text.slice(0, 200)}`);
  }
});
