const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib');
const lib = (name) => import(pathToFileURL(path.join(SRC, name)).href);

test('the feedback notes say what turns feedback on in plain words, the server and the App say it the same way, and neither names a version', async () => {
  const V = await lib('v130UseCase.js');
  const { FEEDBACK_NOT_AVAILABLE } = require('../lib/inspireFeedback');
  assert.equal(FEEDBACK_NOT_AVAILABLE, V.FEEDBACK_OFF_TEXT, 'the 409 a person can see on a card reads like the panel');
  for (const note of [V.FEEDBACK_OFF_TEXT, V.FEEDBACK_EMPTY_TEXT]) {
    assert.doesNotMatch(note, /\bv?\d+\.\d+|__inspire|table|[\u2013\u2014]/i, note);
    assert.match(note, /Accepted, Planned, Implemented or Reject/, 'it names the buttons a person presses');
  }
  const insights = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'ResultsInsights.jsx'), 'utf8');
  assert.doesNotMatch(insights, /v1\.3\.0|feedback\.message/, 'the panel never shows a version or the raw server text');
});

test('a summary splits into its paragraphs, from the HTML the agent writes or from plain text', async () => {
  const F = await lib('reviewFigures.js');
  assert.deepEqual(F.paragraphsOf('<p>One <b>bold</b> line.</p><p>Two.</p>'), ['One bold line.', 'Two.']);
  assert.deepEqual(F.paragraphsOf('First.<br/>Second.'), ['First.', 'Second.']);
  assert.deepEqual(F.paragraphsOf('First.\n\nSecond.\nstill second.'), ['First.', 'Second. still second.']);
  assert.deepEqual(F.paragraphsOf('<p> </p>'), []);
  assert.deepEqual(F.paragraphsOf(null), []);
});

test('Latest Run marks the newest run of a named business that has 2 or more runs, and never a lone run or an unnamed one', async () => {
  const F = await lib('reviewFigures.js');
  assert.equal(F.LATEST_RUN_LABEL, 'Latest Run');
  const run = (business, runs, rank) => ({ business_name: business, business_runs: runs, business_rank: rank });
  assert.equal(F.isLatestRun(run('Acme', 2, 1)), true, 'two runs label the newest');
  assert.equal(F.isLatestRun(run('Acme', 2, 2)), false, 'and not the older one');
  assert.equal(F.isLatestRun(run('Acme', 5, 1)), true);
  assert.equal(F.isLatestRun(run('Beta Foods', 1, 1)), false, 'a business with one run gets no label');
  assert.equal(F.isLatestRun(run('', 2, 1)), false, 'a run with no business name gets no label');
  assert.equal(F.isLatestRun(run('   ', 3, 1)), false);
  assert.equal(F.isLatestRun({ widget_values: { business: 'Acme' }, business_runs: 2, business_rank: 1 }), false,
    'the name is the session row business_name the agent always writes, never a widget copy');
  for (const not of [{ latest_run: true }, { business_name: 'Acme' }, {}, null]) assert.equal(F.isLatestRun(not), false, JSON.stringify(not));
  assert.equal(F.runDate({ last_updated: 'b', completed_on: 'c', create_at: 'a' }), 'b');
  assert.equal(F.runDate({ last_updated: null, completed_on: 'c', create_at: 'a' }), 'c');
  assert.equal(F.runDate({ create_at: 'a' }), 'a');
  assert.equal(F.runDate(null), '');
});

test('a run is named by the business_name of its session row alone, everywhere the App names it', async () => {
  const F = await lib('reviewFigures.js');
  assert.equal(F.runBusiness({ business_name: '  Acme  ' }), 'Acme');
  assert.equal(F.runBusiness({ business_name: '', widget_values: { business: 'Acme', '00_business_name': 'Acme' } }), '');
  for (const none of [null, {}, { business_name: 7 }, { business_name: null }]) assert.equal(F.runBusiness(none), '', JSON.stringify(none));
  const src = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const pages = ['pages/ChoosePage.jsx', 'pages/LaunchPage.jsx', 'pages/ResultsPage.jsx', 'lib/reviewFigures.js'];
  for (const page of pages) {
    const text = fs.readFileSync(path.join(src, page), 'utf8');
    assert.doesNotMatch(text, /widget_values\?\.(business|\['00_business_name'\])/, `${page} reads no business from the widgets`);
  }
  for (const page of pages.slice(0, 3)) assert.match(fs.readFileSync(path.join(src, page), 'utf8'), /runBusiness\(/, page);
});

test('the figures of a run come from the portfolio, else from the run list overview, else there are none', async () => {
  const F = await lib('reviewFigures.js');
  const portfolio = { sessions: { 42: { use_cases: 1, domains: 1, subdomains: 1, best_of_best: 0, mvps_started: 1, mvps_live: 0, live_assets: 1 } } };
  assert.equal(F.runFiguresOf({ session_id: 42 }, portfolio), portfolio.sessions[42]);
  assert.deepEqual(F.runFiguresOf({ session_id: '43', usecase_overview: { total: 7, domains: 2 } }, portfolio), { use_cases: 7, domains: 2 });
  assert.equal(F.runFiguresOf({ session_id: '43' }, portfolio), null);
  assert.equal(F.runFiguresOf({ session_id: '43', usecase_overview: { total: 'x' } }, null), null);
  assert.deepEqual(F.runFigureParts(portfolio.sessions[42]), ['1 use case', '1 domain', '1 subdomain', '0 Best of Best', '1 MVP, 0 live', '1 live asset']);
  assert.deepEqual(F.runFigureParts({ use_cases: 7, domains: 2 }), ['7 use cases', '2 domains']);
  assert.deepEqual(F.runFigureParts(null), []);
  assert.equal(F.scoreText(4.56), '4.6');
  assert.equal(F.scoreText(null), '');
  assert.equal(F.scoreText('n/a'), '');
  assert.deepEqual(F.PORTFOLIO_GROUPS.flatMap((g) => g.cards.map((c) => c.key)),
    ['businesses', 'runs', 'use_cases', 'domains', 'best_of_best', 'mvps_started', 'mvps_live', 'apps', 'dashboards', 'genie_spaces', 'alerts']);
});

test('the demo Run tab lists the demo MVP Apps and frames only their own demo paths', async () => {
  const P = await lib('runPages.js');
  const showcase = { id: 'acme', business: 'Acme', mvps: [
    { id: 'N01-U01', title: 'Predict churn', url: '/showcase/acme/mvp/N01-U01/' },
    { id: 'N01-U02', title: 'Score upsell', url: 'https://evil.example.com/' },
    { id: 'N01-U03', title: 'Segment', url: '/showcase/acme/mvp/N01-U03/../../x/' },
    { title: 'No id', url: '/showcase/acme/mvp/x/' },
  ] };
  const pages = P.demoRunPages(showcase);
  assert.deepEqual(pages, [{ kind: P.RUN_DEMO_KIND, id: 'N01-U01', use_case_id: 'N01-U01', name: 'Predict churn', domain: 'Acme', path: '/showcase/acme/mvp/N01-U01/' }]);
  assert.equal(P.runKey(pages[0]), 'demo:N01-U01');
  assert.equal(P.runFrameSrc(pages[0]), '/showcase/acme/mvp/N01-U01/');
  assert.equal(P.runFrameSrc({ ...pages[0], path: '/run/n01-u01-a/#/n01_u01' }), '', 'a demo page never frames a live page');
  assert.equal(P.runFrameSrc({ kind: 'inspire', path: '/showcase/acme/mvp/N01-U01/' }), '', 'a live page never frames a demo path');
  assert.equal(P.runPicked(pages, ''), pages[0]);
  assert.equal(P.runPolling(pages, 'demo:N01-U01'), false, 'a demo page never polls');
  assert.deepEqual(P.demoRunPages({ mvps: 'x' }), []);
  assert.deepEqual(P.demoRunPages(null), []);
});
