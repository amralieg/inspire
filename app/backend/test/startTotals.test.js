const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const R = require('../lib/reviewFigures');

const FRONTEND = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const lib = (name) => import(pathToFileURL(path.join(FRONTEND, 'lib', name)).href);
const TABLE = '`main`.`inspire`.`__inspire_session`';

const run = (sid, business, rank) => ({ session_id: sid, business_name: business, business_rank: rank });
const SESSIONS = [run('42', 'Acme', 1), run('41', 'Acme', 2), run('50', 'Beta Foods', 1), run('51', '  ', 1), run('60', '', 1)];
const PORTFOLIO = {
  totals: { businesses: 2, runs: 5, use_cases: 15, domains: 3, best_of_best: 3, mvps_started: 3, mvps_live: 1, apps: 2, dashboards: 1, genie_spaces: 1, alerts: 0 },
  sessions: {
    42: { use_cases: 6, domains: 2, best_of_best: 2, mvps_started: 2, mvps_live: 1, apps: 1, dashboards: 1, genie_spaces: 1, alerts: 0 },
    41: { use_cases: 5, domains: 2, best_of_best: 1, mvps_started: 1, mvps_live: 0, apps: 1, dashboards: 0, genie_spaces: 0, alerts: 0 },
    50: { use_cases: 4, domains: 0, best_of_best: 0, mvps_started: 0, mvps_live: 0, apps: 0, dashboards: 0, genie_spaces: 0, alerts: 0 },
  },
};

test('Start lists up to 1,000 runs with all=1 and Review keeps 20, each read one row past the cap so the App knows when the list is cut', async () => {
  assert.equal(R.sessionListCap(true), R.PORTFOLIO_RUN_CAP);
  assert.equal(R.sessionListCap(false), R.SESSION_LIST_CAP);
  assert.ok(R.sessionListStatement(TABLE, { cap: R.PORTFOLIO_RUN_CAP }).sql.endsWith(`ORDER BY create_at DESC LIMIT ${R.PORTFOLIO_RUN_CAP + 1}`));
  assert.ok(R.sessionListStatement(TABLE).sql.endsWith(`ORDER BY create_at DESC LIMIT ${R.SESSION_LIST_CAP + 1}`));
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ session_id: String(i), business_runs: '1', business_rank: '1' }));
  const full = await R.loadSessionList(async () => rows(R.SESSION_LIST_CAP + 1), TABLE);
  assert.equal(full.sessions.length, R.SESSION_LIST_CAP);
  assert.equal(full.truncated, true, 'one row past the cap means the database holds more runs');
  const exact = await R.loadSessionList(async () => rows(R.SESSION_LIST_CAP), TABLE);
  assert.deepEqual([exact.sessions.length, exact.truncated], [R.SESSION_LIST_CAP, false], 'exactly the cap is the whole list');
  const sent = [];
  await R.loadSessionList(async (statement) => { sent.push(statement.sql); return []; }, TABLE, R.PORTFOLIO_RUN_CAP);
  assert.ok(sent[0].endsWith(`LIMIT ${R.PORTFOLIO_RUN_CAP + 1}`));
});

test('Businesses shows the newest run of each named business, Runs shows every run, and the use case cards show the runs that hold them', async () => {
  const F = await lib('reviewFigures.js');
  const ids = (key) => F.runsOfCard(key, SESSIONS, PORTFOLIO).map((s) => s.session_id);
  assert.deepEqual(ids('businesses'), ['42', '50'], 'an older run of a business, a blank name and no name are not businesses');
  assert.deepEqual(ids('runs'), ['42', '41', '50', '51', '60']);
  assert.deepEqual(ids('use_cases'), ['42', '41', '50']);
  assert.deepEqual(ids('domains'), ['42', '41'], 'a run with use cases but no domain is left out');
  assert.deepEqual(ids('best_of_best'), ['42', '41']);
  for (const key of ['apps', 'alerts', 'nothing']) assert.deepEqual(ids(key), [], `${key} filters no run on Start`);
  assert.deepEqual(F.runsOfCard('runs', null, PORTFOLIO), []);
  assert.deepEqual(F.runsOfCard('use_cases', SESSIONS, null), [], 'no figures, no run with use cases');
});

test('every card with a count says what it does, a 0 card says why it does nothing, and a Build card needs a run it can open', async () => {
  const F = await lib('reviewFigures.js');
  const label = (key, portfolio = PORTFOLIO, sessions = SESSIONS) => F.portfolioCardAction(key, portfolio, sessions);
  assert.deepEqual(label('businesses'), { live: true, label: 'Show the 2 businesses', why: '' });
  assert.deepEqual(label('runs'), { live: true, label: 'Show the 5 runs', why: '' });
  assert.equal(label('use_cases').label, 'Show the runs that found the 15 use cases');
  assert.equal(label('domains').label, 'Show the runs that found the 3 domains');
  assert.equal(label('best_of_best').label, 'Show the runs with the 3 Best of Best use cases');
  assert.equal(label('mvps_started').label, 'Show the 3 MVPs started in Build');
  assert.equal(label('mvps_live').label, 'Show the 1 live MVP in Build');
  assert.equal(label('apps').label, 'Show the 2 Apps in Build');
  assert.equal(label('dashboards').label, 'Show the 1 dashboard in Build');
  assert.equal(label('genie_spaces').label, 'Show the 1 Genie Agent in Build');
  assert.deepEqual(label('alerts'), { live: false, label: '', why: 'No MVP has an alert yet.' });
  const empty = { totals: Object.fromEntries(Object.keys(PORTFOLIO.totals).map((key) => [key, 0])), sessions: {} };
  for (const group of F.PORTFOLIO_GROUPS) {
    for (const card of group.cards) {
      const got = label(card.key, empty);
      assert.equal(got.live, false, `${card.key} at 0 does nothing`);
      assert.equal(got.why, card.none, card.key);
      assert.match(got.why, /^No [a-zA-Z ]+ yet\.$/, card.key);
    }
  }
  const orphan = { ...PORTFOLIO, sessions: {} };
  assert.deepEqual(label('apps', orphan), { live: false, label: '', why: 'The run list holds none of the runs these Apps belong to.' },
    'Apps counted for runs no longer in the list open nothing');
  assert.equal(label('apps', null).live, false, 'no totals yet, nothing to open');
  assert.equal(label('apps', { totals: { apps: 2 } }, []).live, false);
  assert.equal(label('unknown').live, false);
  assert.equal(label('businesses', { ...PORTFOLIO, totals: { ...PORTFOLIO.totals, businesses: 1 } }).label, 'Show the 1 business');
  assert.equal(label('use_cases', { ...PORTFOLIO, totals: { ...PORTFOLIO.totals, use_cases: 1234 } }).label, 'Show the runs that found the 1,234 use cases');
});

test('the filter chip says what the list shows, and says so when the run list is cut at 1,000 runs', async () => {
  const F = await lib('reviewFigures.js');
  assert.equal(F.runFilterText('businesses', 2), 'Showing: the latest run of each of 2 businesses');
  assert.equal(F.runFilterText('businesses', 1), 'Showing: the latest run of each of 1 business');
  assert.equal(F.runFilterText('runs', 25), 'Showing: all 25 runs');
  assert.equal(F.runFilterText('runs', 1), 'Showing: the 1 run');
  assert.equal(F.runFilterText('use_cases', 3), 'Showing: the 3 runs that found use cases');
  assert.equal(F.runFilterText('domains', 1), 'Showing: the 1 run that found domains');
  assert.equal(F.runFilterText('best_of_best', 2), 'Showing: the 2 runs with Best of Best use cases');
  assert.equal(F.runFilterText('runs', 1000, true), 'Showing: all 1,000 runs, from the newest 1,000 runs');
  assert.equal(F.runFilterText('apps', 3), '', 'a Build card has no Start chip');
});

test('a Build card opens Build on the newest run that holds that kind, filtered to it, and lists every run that holds it', async () => {
  const F = await lib('reviewFigures.js');
  const apps = F.buildFilterOf('apps', SESSIONS, PORTFOLIO);
  assert.deepEqual(apps, { key: 'apps', asset: 'app', mvp: '', shows: 'use cases with an App', many: 'Apps',
    runs: [{ session_id: '42', name: 'Acme', count: 1 }, { session_id: '41', name: 'Acme', count: 1 }] });
  assert.deepEqual(F.buildFilterOf('mvps_live', SESSIONS, PORTFOLIO), { key: 'mvps_live', asset: '', mvp: 'live', shows: 'use cases with a live MVP',
    many: 'live MVPs', runs: [{ session_id: '42', name: 'Acme', count: 1 }] });
  assert.equal(F.buildFilterOf('mvps_started', SESSIONS, PORTFOLIO).mvp, 'has');
  for (const [key, asset] of [['dashboards', 'dashboard'], ['genie_spaces', 'genie_space']]) assert.equal(F.buildFilterOf(key, SESSIONS, PORTFOLIO).asset, asset);
  assert.equal(F.buildFilterOf('alerts', SESSIONS, PORTFOLIO), null, 'no run holds an alert');
  assert.equal(F.buildFilterOf('runs', SESSIONS, PORTFOLIO), null, 'a Start card is no Build filter');
  const unnamed = F.buildFilterOf('apps', [run('60', '', 1)], { sessions: { 60: { apps: 2 } } });
  assert.deepEqual(unnamed.runs, [{ session_id: '60', name: 'Run 60', count: 2 }]);
  assert.equal(F.buildFilterText(apps, '41'), 'Showing: use cases with an App in Acme');
  assert.equal(F.buildFilterText(apps, '99'), 'Showing: use cases with an App');
  assert.equal(F.buildFilterText(null, '42'), '');
});

test('Build narrows its list to use cases with an MVP or a live MVP, the way Review filters MVPs', async () => {
  const C = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  const item = (id, latest) => ({ id, latest, state: W.implementState(latest) });
  const groups = [{ id: 'all', items: [item('N01', { status: 'ready' }), item('N02', { status: 'failed' }), item('N03', null), item('N04', { status: 'uninstalled' })] }];
  const ids = (mvp) => C.filterByMvp(groups, mvp)[0].items.map((i) => i.id);
  assert.deepEqual(ids('has'), ['N01', 'N02'], 'an uninstalled MVP and no MVP are not started MVPs');
  assert.deepEqual(ids('live'), ['N01']);
  assert.deepEqual(ids(''), ['N01', 'N02', 'N03', 'N04']);
  assert.equal(C.filterByMvp(groups, ''), groups);
});

test('the totals live on Start alone: Review renders no portfolio cards and Start reads every run', () => {
  const read = (file) => fs.readFileSync(path.join(FRONTEND, file), 'utf8');
  const users = ['pages/ResultsPage.jsx', 'pages/ChoosePage.jsx', 'pages/ImplementPage.jsx', 'components/ResultsInsights.jsx', 'App.jsx']
    .filter((file) => /<PortfolioCards\b/.test(read(file)));
  assert.deepEqual(users, ['pages/ChoosePage.jsx']);
  assert.doesNotMatch(read('components/ResultsInsights.jsx'), /PortfolioCards|Across all runs/);
  assert.match(read('pages/ChoosePage.jsx'), /all: '1'/);
  assert.doesNotMatch(read('pages/ResultsPage.jsx'), /all: '1'/, 'Review keeps its short run list');
});

test('each Start run row counts its use cases, quality, priority and MVPs, numbers first, and says why a count is missing', async () => {
  const { runCounts } = await lib('reviewFigures.js');
  const shown = (c) => c.items.map((i) => `${i.n} ${i.label}`);
  const overview = { total: 8, high: 3, meets: 6, below: 2, domains: 1, unread: {} };
  const portfolio = { sessions: { 42: { mvps_started: 4, mvps_live: 1, mvps_building: 2, mvps_failed: 1 } } };
  assert.deepEqual(shown(runCounts(overview, portfolio, SESSIONS[0])),
    ['8 use cases', '6 high quality', '2 low quality', '3 high priority', '1 domain', '1 MVP built', '2 building', '1 failed']);
  assert.deepEqual(runCounts(overview, portfolio, SESSIONS[0]).why, []);
  const held = { sessions: { 42: { mvps_started: 3, mvps_live: 2, mvps_building: 0, mvps_failed: 0, mvps_held: 1 } } };
  assert.deepEqual(shown(runCounts(overview, held, SESSIONS[0])).slice(-4), ['2 MVPs built', '0 building', '0 failed', '1 vibes not met'],
    'an MVP held for its vibes with nothing live is counted, not lost');
  assert.deepEqual(shown(runCounts(overview, portfolio, SESSIONS[2])).slice(-3), ['0 MVPs built', '0 building', '0 failed'], 'a run with no MVP counts zero');
  assert.deepEqual(shown(runCounts(overview, null, SESSIONS[0])).length, 5, 'no MVP counts before the portfolio loads');
  assert.equal(shown(runCounts(overview, portfolio, SESSIONS[0], { running: true }))[0], '8 use cases so far');
  assert.deepEqual(runCounts({ total: 1, high: 0, meets: 0, below: 1, domains: 1 }, null, SESSIONS[0]).items.map((i) => i.n), [1, 0, 1, 0, 1],
    'a use case below the bar is low quality, never high quality');
  assert.deepEqual(runCounts({ total: 0 }, portfolio, SESSIONS[0], { running: true }), { items: [], note: 'No use cases yet', why: [] });
  assert.deepEqual(shown(runCounts({ total: 0 }, null, SESSIONS[0])), ['0 use cases'], 'a finished run with no use cases says 0, not nothing');
  const denied = runCounts({ error: 'PERMISSION_DENIED on table' }, portfolio, SESSIONS[0]);
  assert.deepEqual(shown(denied), ['1 MVP built', '2 building', '1 failed'], 'no made-up use case zero, and the MVPs still count');
  assert.deepEqual(denied.why, ['Use cases are not counted: PERMISSION_DENIED on table']);
  const older = runCounts({ total: 5, high: 2, meets: null, below: null, domains: 3, unread: { quality: 'the use case table has no elite_status column' } }, null, SESSIONS[0]);
  assert.deepEqual(older.items.map((i) => i.n), [5, null, null, 2, 3], 'an unreadable count is null, never 0');
  assert.deepEqual(older.why, ['Quality is not counted: the use case table has no elite_status column.']);
  const noMvps = runCounts(overview, portfolio, SESSIONS[0], { mvpError: 'the MVP table cannot be read' });
  assert.deepEqual(noMvps.items.at(-1), { key: 'mvps_built', n: null, label: 'MVPs built' });
  assert.deepEqual(noMvps.why, ['MVPs are not counted: the MVP table cannot be read']);
  assert.deepEqual(shown(runCounts(null, portfolio, SESSIONS[0])), ['1 MVP built', '2 building', '1 failed'], 'a run without use case figures still counts its MVPs');
  assert.deepEqual(runCounts(null, null, SESSIONS[0]), { items: [], note: '', why: [] });
});
