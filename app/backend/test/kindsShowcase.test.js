const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const { SHOWCASE_MAX_BYTES, showcaseLeaks } = require('../lib/showcaseRecord');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../lib/appShell');

const kinds = () => import('../../scripts/kindsShowcase.mjs');
const FILE = path.join(S.SHOWCASE_DIR, 'kinds-retail.json.gz');
const bundle = () => S.loadShowcases()['kinds-retail'];
const useCases = (b) => b.inspire[`GET /api/inspire/usecases?session_id=${b.session_id}`].body.usecases;
const answersOf = (mvp) => Object.entries(mvp.api);

async function serve() {
  const reached = [];
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { shellFiles: appShellFiles(appShellPayload(bundledAppShellText())), log: { error: (m) => { throw new Error(m); } } });
  app.all('/api/*rest', (req, res) => { reached.push(`${req.method} ${req.path}`); res.json({ real: true }); });
  app.all('/showcase/*rest', (req, res) => { reached.push(`${req.method} ${req.path}`); res.status(418).json({ real: true }); });
  return { srv: await listen(app), reached };
}

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = resp.headers.get('content-type') || '';
  return { status: resp.status, data: type.includes('json') ? await resp.json() : await resp.text() };
}

test('the kinds demo is the first demo, opens with its use cases, and fits the size the App allows', () => {
  assert.equal(S.showcaseProblem(bundle(), FILE), '');
  assert.equal(Object.keys(S.loadShowcases())[0], 'kinds-retail');
  assert.ok(fs.statSync(FILE).size < SHOWCASE_MAX_BYTES, `${fs.statSync(FILE).size} bytes`);
  assert.deepEqual(showcaseLeaks(bundle(), ['databricksapps.com', '127.0.0.1', 'amr', 'Amr']), []);
});

test('every use case of the kinds demo has its own kind, a name without the technique, and the title the one formatter writes', async () => {
  const { USE_CASES } = await kinds();
  const rows = useCases(bundle());
  assert.deepEqual(rows.map((u) => u.id), [...USE_CASES].map((u) => u.no).sort((a, b) => rows.findIndex((r) => r.id === a) - rows.findIndex((r) => r.id === b)));
  assert.equal(new Set(rows.map((u) => u.use_case_kind)).size, rows.length);
  for (const u of rows) {
    const source = USE_CASES.find((x) => x.no === u.id);
    assert.equal(u.use_case_kind, source.kind, u.id);
    assert.equal(u.Name, source.name, u.id);
    assert.equal(u.use_case, source.headline, `${u.id} keeps the old headline in use_case`);
    assert.equal(u['Analytics Technique'], source.technique, u.id);
    assert.ok(!u.Name.toLowerCase().includes(source.technique.toLowerCase()), `${u.id} keeps the technique out of the name`);
    assert.equal(u.name_with_technique, `${u.Name} using ${source.technique.toLowerCase()}`, u.id);
    for (const field of ['serving_summary', 'method_summary', 'value_source', 'kind_family', 'app_layout']) assert.ok(String(u[field] || '').trim(), `${u.id} ${field}`);
    assert.doesNotMatch(JSON.stringify([u.Name, u.use_case, u.serving_summary, u.method_summary, u.value_source]), /[\u2013\u2014]/, `${u.id} has no dash`);
  }
});

test('every use case of the kinds demo has its MVP App, laid out for its kind, with a recorded Genie answer marked as a demo answer', async () => {
  const { DEMO_LAYOUTS, DEMO_RECORDED, USE_CASES } = await kinds();
  const b = bundle();
  assert.deepEqual(Object.keys(b.mvps).sort(), USE_CASES.map((u) => u.no).sort());
  const layouts = new Set();
  for (const u of USE_CASES) {
    const mvp = b.mvps[u.no];
    const app = mvp.api['GET /api/app'];
    assert.equal(app.status, 200, u.no);
    assert.equal(app.body.pages.length, 1, u.no);
    assert.equal(app.body.pages[0].layout.id, u.mvp.layout, u.no);
    layouts.add(app.body.pages[0].layout.id);
    const asked = answersOf(mvp).filter(([key]) => key.startsWith('POST /api/genie/ask '));
    assert.ok(asked.length >= u.genie.length, `${u.no} recorded the suggested questions`);
    for (const g of u.genie) assert.ok(asked.some(([key]) => JSON.parse(key.slice(key.indexOf('{'))).question === g.q), `${u.no} recorded "${g.q}"`);
    const said = answersOf(mvp).filter(([key]) => key.startsWith('GET /api/genie/message'));
    assert.ok(said.length >= u.genie.length, u.no);
    for (const [key, answer] of said) {
      assert.equal(answer.body.state, 'done', key);
      assert.ok(answer.body.text.endsWith(DEMO_RECORDED), `${u.no} ${key} says it is a demo answer`);
      assert.doesNotMatch(answer.body.text, /[*_]{2}|^_|_$/m, `${u.no} ${key} is plain text`);
    }
  }
  assert.deepEqual([...layouts].sort(), [...DEMO_LAYOUTS].sort());
});

test('each kinds demo use case takes its kind from kinds.json and opens the layout the registry serves for that kind', async () => {
  const { USE_CASES } = await kinds();
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'agent', 'agent', 'app_shell', 'kinds.json'), 'utf8'));
  const served = new Set(registry.layouts.filter((l) => l.enabled).map((l) => l.id));
  const b = bundle();
  for (const u of USE_CASES) {
    const kind = registry.kinds.find((k) => k.id === u.kind);
    assert.ok(kind, `${u.no} names a kind of the registry`);
    assert.ok(served.has(kind.layout), `${u.no} ${kind.layout} is served`);
    assert.equal(u.mvp.layout, kind.layout, u.no);
    assert.equal(b.mvps[u.no].api['GET /api/app'].body.pages[0].layout.id, kind.layout, u.no);
  }
});

test('a kinds demo list says no record left it, because the demo has no earlier run', () => {
  const lists = Object.entries(bundle().mvps).flatMap(([no, mvp]) => answersOf(mvp).filter(([key]) => key.startsWith('POST /api/records ')).map(([key, a]) => [`${no} ${key}`, a.body]));
  assert.ok(lists.length >= 10, `${lists.length} recorded lists`);
  for (const [key, body] of lists) {
    assert.equal(body.summary.left, 0, key);
    assert.equal(body.summary.open, body.total, key);
  }
});

test('the Inspire App hosts each kinds demo MVP App: the shell, its reads and Genie come from the file, and a change is refused', async () => {
  const { USE_CASES } = await kinds();
  const { PERIODS, periodBody } = await import('../../agent/agent/app_shell/web/src/mywork.js');
  const { PERIOD_PICK } = await import('../../scripts/showcaseRecorder.mjs');
  const { srv, reached } = await serve();
  try {
    for (const u of USE_CASES) {
      const base = `/showcase/kinds-retail/mvp/${u.no}`;
      const page = await call(srv.url, `${base}/`);
      assert.equal(page.status, 200, u.no);
      assert.match(page.data, /<div id="root">|<script/, u.no);
      const app = await call(srv.url, `${base}/api/app`);
      assert.equal(app.status, 200, u.no);
      assert.equal(app.data.pages[0].layout.id, u.mvp.layout, u.no);
      const id = app.data.pages[0].id;
      const ask = await call(srv.url, `${base}/api/genie/ask`, { method: 'POST', body: { page: id, question: u.genie[0].q } });
      assert.equal(ask.status, 200, u.no);
      const said = await call(srv.url, `${base}/api/genie/message?page=${id}&message_id=${ask.data.message_id}&conversation_id=${ask.data.conversation_id}`);
      assert.equal(said.status, 200, u.no);
      assert.ok(said.data.text.startsWith(u.genie[0].a), u.no);
      for (const [choice] of PERIODS) {
        const work = await call(srv.url, `${base}/api/my_work`, { method: 'POST', body: { page: id, ...periodBody(choice, PERIOD_PICK.from, PERIOD_PICK.to, 'Pacific/Auckland') } });
        assert.equal(work.status, 200, `${u.no} My work for ${choice} replays (no 404)`);
      }
      const change = await call(srv.url, `${base}/api/records/act`, { method: 'POST', body: { page: id, keys: ['K1'], action: 'fixed' } });
      assert.deepEqual([change.status, change.data.error], [403, S.SHOWCASE_READ_ONLY], u.no);
    }
    assert.deepEqual(reached, []);
  } finally {
    await srv.close();
  }
});

test('the demo answers My work and Scenario lab reads, and replays the same answer whatever time zone or Genie conversation the browser sends', () => {
  assert.equal(S.showcaseCanRead('POST', '/api/my_work'), true);
  assert.equal(S.showcaseCanRead('POST', '/api/scenario/evaluate'), true);
  assert.equal(S.showcaseCanRead('POST', '/api/records/act'), false);
  assert.equal(S.showcaseKey('POST', '/api/my_work', {}, { window: 'week', time_zone: 'Asia/Dubai' }), S.showcaseKey('POST', '/api/my_work', {}, { window: 'week', time_zone: 'UTC' }));
  assert.notEqual(S.showcaseKey('POST', '/api/my_work', {}, { window: 'week' }), S.showcaseKey('POST', '/api/my_work', {}, { window: 'month' }));
  assert.equal(S.showcaseKey('GET', '/api/genie/message', { message_id: 'm1', conversation_id: 'c1' }), S.showcaseKey('GET', '/api/genie/message', { message_id: 'm1', conversation_id: 'c2' }));
});

test('the kinds demo holds no time later than its recording time, so no clock of the walk that wrote it is in the file', async () => {
  const { KINDS_DEMO } = await kinds();
  const latest = Date.parse(KINDS_DEMO.recordedAt);
  const text = fs.readFileSync(FILE).length && JSON.stringify(bundle());
  const times = [...text.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g)].map(([t]) => t);
  assert.ok(times.length > 0);
  assert.deepEqual([...new Set(times.filter((t) => Date.parse(t) > latest))], []);
  assert.ok(times.includes(KINDS_DEMO.recordedAt), 'the live checks carry the recording time');
});

const moneyOf = (text) => (String(text || '').match(/\$[\d.,]+[KMB]?/) || [])[0];
const compactMoney = (n) => {
  const a = Math.abs(n);
  const [v, s] = a >= 1e9 ? [a / 1e9, 'B'] : a >= 1e6 ? [a / 1e6, 'M'] : a >= 1e3 ? [a / 1e3, 'K'] : [a, ''];
  return `$${Number(v.toFixed(1))}${s}`;
};

const amountOf = (text) => {
  const m = moneyOf(text);
  if (!m) return null;
  const n = Number(m.replace(/[$,KMB]/g, ''));
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[m.slice(-1)] || 1));
};

test('a kinds demo use case says one amount: the first amount its story states is its stake, and its money tile names the same number', async () => {
  const { USE_CASES } = await kinds();
  const stated = USE_CASES.filter((u) => moneyOf(u.story) || moneyOf(u.stake));
  assert.ok(stated.length >= 12, `${stated.length} use cases state an amount`);
  for (const u of stated) {
    if (moneyOf(u.story)) assert.equal(amountOf(u.story), amountOf(u.stake), `${u.title}: story ${u.story} against the stake ${u.stake}`);
    const money = Array.isArray(u.mvp?.kpis) ? u.mvp.kpis.find((k) => k[1] === 'currency') : null;
    if (money) assert.equal(compactMoney(money[2]), compactMoney(amountOf(u.stake)), `${u.title}: tile ${money[2]} against the stake ${u.stake}`);
  }
});

test('the demo plan lines take decisions: Accept, Override with a reason and Take all answer locally, and nothing reaches a real API', async () => {
  const { USE_CASES } = await kinds();
  const plans = Object.entries(bundle().mvps).filter(([, mvp]) => JSON.parse(JSON.stringify(mvp.api['GET /api/app']?.body || {})).pages?.[0]?.plan);
  assert.ok(plans.length >= 2, `${plans.length} plan MVPs`);
  for (const [, mvp] of plans) {
    const info = mvp.api['GET /api/app'].body;
    assert.equal(info.settings?.options?.decisions ?? info.options?.decisions, true);
    const list = Object.entries(mvp.api).find(([k]) => k.startsWith('POST /api/records '))[1].body;
    assert.equal(list.actions, true);
    assert.ok(list.rows.every((r) => r._inspire_version && r.record_key));
  }
  assert.ok(USE_CASES.some((u) => u.mvp.layout === 'planner'));
  const { srv, reached } = await serve();
  const base = srv.url;
  try {
    const [slug, mvp] = plans[0];
    const url = `${S.showcaseMvpPath('kinds-retail', slug)}api/plan/decide`;
    const rows = Object.entries(mvp.api).find(([k]) => k.startsWith('POST /api/records '))[1].body.rows;
    const accept = await call(base, url, { method: 'POST', body: { page: 'p', record_key: rows[0].record_key, seen: rows[0]._inspire_version, decision: 'accept', recommended: 1 } });
    assert.equal(accept.status, 200);
    assert.deepEqual([accept.data.showcase, accept.data.saved, accept.data.written, accept.data.note], [true, false, [rows[0].record_key], S.SHOWCASE_PLAN_NOTE]);
    assert.deepEqual(accept.data.row, { _inspire_status: 'Done', _inspire_closed_note: 'Accepted the recommended 1' });
    const override = await call(base, url, { method: 'POST', body: { page: 'p', record_key: rows[1].record_key, decision: 'override', value: 12, recommended: 9, reason: ' Store  event this week ' } });
    assert.equal(override.status, 200);
    assert.equal(override.data.row._inspire_closed_note, 'Override to 12 instead of 9: Store event this week');
    const unnamed = await call(base, url, { method: 'POST', body: { page: 'p', record_key: rows[1].record_key, decision: 'accept' } });
    assert.equal(unnamed.status, 400);
    assert.match(unnamed.data.error, /recommended/);
    const bare = await call(base, url, { method: 'POST', body: { page: 'p', record_key: rows[1].record_key, decision: 'override', value: 12, recommended: 9, reason: ' ' } });
    assert.equal(bare.status, 400);
    assert.match(bare.data.error, /reason/);
    const all = await Promise.all(rows.map((r) => call(base, url, { method: 'POST', body: { page: 'p', record_key: r.record_key, seen: r._inspire_version, decision: 'accept', recommended: 1 } })));
    assert.deepEqual([...new Set(all.map((r) => r.status))], [200]);
    const act = await call(base, `${S.showcaseMvpPath('kinds-retail', slug)}api/records/act`, { method: 'POST', body: { record_keys: ['K1'] } });
    assert.equal(act.status, 403);
    assert.deepEqual(reached, []);
  } finally {
    await srv.close();
  }
});

test('the kinds demo shows records in every list and answers a visitor\'s first suggested Genie question with its recorded answer', async () => {
  const { USE_CASES } = await kinds();
  const lists = Object.entries(bundle().mvps).filter(([, mvp]) => Object.keys(mvp.api).some((k) => k.startsWith('POST /api/records ')));
  const empty = lists.flatMap(([slug, mvp]) => Object.entries(mvp.api).filter(([k, v]) => k.startsWith('POST /api/records ') && !(v.body?.rows || []).length).map(([k]) => `${slug} ${k}`));
  assert.deepEqual(empty, [], 'every list in the demo shows its records');
  assert.ok(lists.length >= 3, `${lists.length} lists`);
  for (const u of USE_CASES) {
    const api = bundle().mvps[u.no].api;
    const ask = Object.entries(api).find(([k]) => k.startsWith('POST /api/genie/ask ') && JSON.parse(k.slice('POST /api/genie/ask '.length)).question === u.genie[0].q);
    assert.ok(ask, `${u.no} has no recorded answer to its first suggested question`);
    const said = Object.entries(api).find(([k]) => k.startsWith('GET /api/genie/message') && k.includes(`message_id=${ask[1].body.message_id}&`));
    assert.ok(said?.[1]?.body?.text?.startsWith(u.genie[0].a), `${u.no} answers its first suggested question with the recorded answer`);
  }
});

test('every table and list in the kinds demo carries each column its page shows, so no cell reads Not recorded for a missing column (must-exclude)', () => {
  const missing = [];
  for (const [slug, mvp] of Object.entries(bundle().mvps)) {
    const page = mvp.api['GET /api/app'].body.pages[0];
    for (const [key, answer] of Object.entries(mvp.api)) {
      if (key.startsWith('POST /api/page ')) {
        for (const table of page.tables || []) {
          for (const row of answer.body?.tables?.[table.id]?.rows || []) {
            for (const { column } of table.columns) if (!(column in row)) missing.push(`${slug} table ${table.id}.${column}`);
          }
        }
      }
      if (key.startsWith('POST /api/records ') && page.records) {
        const wanted = [page.records.key, page.records.label, ...(page.records.columns || []).map((c) => c.column)].filter(Boolean);
        for (const row of answer.body?.rows || []) for (const column of wanted) if (!(column in row)) missing.push(`${slug} list ${column}`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('the kinds demo tells one story about its counts, schedule and alerts: the high count is the one the pages compute, each job runs on the schedule its MVP states, and each alert has been checked (must-exclude)', async () => {
  const b = bundle();
  const { computeHighPriorityCount } = await import('../../frontend/src/lib/useCaseFields.js');
  const list = useCases(b);
  for (const key of ['GET /api/inspire/sessions', 'GET /api/inspire/sessions?all=1']) {
    const rows = b.inspire[key].body.sessions || b.inspire[key].body;
    const overview = (Array.isArray(rows) ? rows : []).map((row) => row.usecase_overview).find(Boolean);
    assert.ok(overview, `${key} carries the use case overview`);
    assert.equal(overview.total, list.length);
    assert.equal(overview.high, computeHighPriorityCount(list));
    assert.ok(overview.preview_use_cases.length > 0 && overview.preview_use_cases.every((uc) => uc.Name && !('name' in uc)), 'the preview carries the Name the Start card reads');
  }
  const { FRESHNESS_OPTIONS, FRESH_DEFAULT } = await import('../../frontend/src/lib/implementWizard.js');
  const defaultCron = FRESHNESS_OPTIONS.find((o) => o.id === FRESH_DEFAULT).cron;
  const history = b.inspire[`GET /api/inspire/implement/history?session_id=${b.session_id}`].body.history;
  for (const row of history) {
    const spec = typeof row.spec_json === 'string' ? JSON.parse(row.spec_json) : row.spec_json;
    const live = b.inspire[`GET /api/inspire/implement/live?session_id=${b.session_id}&use_case_id=${row.use_case_id}`].body.assets;
    assert.equal(spec.schedule.enabled, true, `${row.use_case_id} keeps its schedule on`);
    assert.equal(spec.schedule.cron, defaultCron, `${row.use_case_id} keeps the wizard's default freshness`);
    assert.deepEqual([spec.schedule.cron, spec.schedule.timezone], [live.job.schedule.cron, live.job.schedule.timezone], `${row.use_case_id} states the schedule its job runs on`);
    assert.equal(live.job.schedule.paused, false);
    assert.deepEqual([live.alert.ok, live.alert.state, Boolean(live.alert.checked_at), Boolean(live.alert.name)], [true, 'OK', true, true], `${row.use_case_id} alert has been checked`);
  }
  const before = { ok: true, name: '', state: '', checked_at: '', trashed: false };
  assert.notDeepEqual([before.state, Boolean(before.checked_at)], ['OK', true], 'an alert never read reads as not checked');
});

const HEADLINE_TIES = {
  decision_queue: [['total_loss', 'now', 'loss_trend', ['y0'], 'last'], ['total_loss', 'before', 'loss_trend', ['y0'], 'previous'], ['total_loss', 'now', 'by_category', ['y0'], 'sum'],
    ['total_loss', 'now', 'pareto', ['y0'], 'sum']],
  monitor_triage: [['open_n', 'now', 'by_rule', ['y0'], 'sum'], ['open_n', 'now', 'by_age', ['y0'], 'sum'], ['exposure', 'now', 'by_age', ['y1'], 'sum']],
  forecast_cockpit: [['next_forecast', 'now', 'fan', ['y1'], 'sum'], ['last_actual', 'now', 'fan', ['y0'], 'sum'], ['at_risk_n', 'now', 'at_risk', ['series_label'], 'count']],
  performance_explainer: [['plan', 'now', 'walk', ['y0'], 'first'], ['actual', 'now', 'walk', ['y0'], 'last'], ['variance', 'now', 'drivers', ['y0', 'y1'], 'sum']],
  segment_explorer: [['members', 'now', 'worth', ['y0'], 'sum']],
  lift_readout: [['incremental', 'now', 'curves', ['y0'], 'sum'], ['incremental', 'now', 'waterfall', ['y0'], 'first']],
  location_view: [['sites', 'now', 'density', ['y0'], 'sum'], ['demand', 'now', 'countries', ['y0'], 'sum'], ['demand', 'now', 'points', ['y0'], 'sum']],
  dashboard: [['revenue', 'now', 'trend', ['y0'], 'last'], ['prior', 'now', 'trend', ['y0'], 'previous'], ['revenue', 'now', 'by_region', ['y0'], 'sum'],
    ['prior', 'now', 'by_region', ['y1'], 'sum']],
  planner: [], scenario_lab: [], recommendation_desk: [], process_flow: [], network_explorer: [], agent_chat: [],
};

function headlineGaps(layout, data) {
  const gaps = [];
  for (const [kpi, side, chart, series, how] of HEADLINE_TIES[layout]) {
    const rows = (data.charts[chart]?.rows || data.tables?.[chart]?.rows || []).filter((r) => series.some((y) => r[y] != null));
    const value = (r) => series.reduce((s, y) => s + (Number(r[y]) || 0), 0);
    const shown = { sum: () => rows.reduce((s, r) => s + value(r), 0), first: () => value(rows[0]), last: () => value(rows[rows.length - 1]), previous: () => value(rows[rows.length - 2]), count: () => rows.length }[how]();
    const headline = data.kpis[kpi]?.[side];
    if (!rows.length || Math.round(headline) !== Math.round(shown)) gaps.push(`${kpi}.${side} ${Math.round(headline)} but ${chart} ${how} ${Math.round(shown)}`);
  }
  return gaps;
}

test('on every demo page the headline figures equal the chart data they summarize, with and without a filter (must-exclude)', async () => {
  const { DEMO_LAYOUTS, USE_CASES, mvpApi, mvpPage } = await kinds();
  assert.deepEqual(Object.keys(HEADLINE_TIES).sort(), [...DEMO_LAYOUTS].sort(), 'every layout states which charts carry its headline figures');
  const b = bundle();
  const gaps = [];
  let checked = 0;
  for (const u of USE_CASES) {
    const answers = Object.entries(b.mvps[u.no].api).filter(([key]) => key.startsWith('POST /api/page '));
    assert.ok(answers.length > 0, `${u.no} recorded its page`);
    for (const [key, answer] of answers) gaps.push(...headlineGaps(u.mvp.layout, answer.body).map((g) => `${u.no} ${key}: ${g}`));
    const { routes } = mvpApi(u, { pages: [mvpPage(u)] });
    const filters = Object.entries(b.mvps[u.no].api).find(([key]) => key.startsWith('GET /api/filters?'))?.[1].body.filters || [];
    for (const f of filters.filter((x) => x.type === 'multi_select')) {
      for (const option of f.options) {
        gaps.push(...headlineGaps(u.mvp.layout, routes['POST page']({ filters: { [f.id]: [option] } })).map((g) => `${u.no} ${f.id}=${option}: ${g}`));
        checked += 1;
      }
    }
  }
  assert.ok(checked > 20, `${checked} filtered views checked`);
  assert.deepEqual(gaps, []);
  const margin = USE_CASES.find((u) => u.no === 'N12-U01');
  const page = mvpApi(margin, { pages: [mvpPage(margin)] }).routes['POST page']({});
  const off = structuredClone(page);
  off.charts.trend.rows.at(-1).y0 += 200000;
  off.charts.by_region.rows[0].y1 -= 1;
  assert.deepEqual(headlineGaps('dashboard', off), ['revenue.now 4200000 but trend last 4400000', 'prior.now 4600000 but by_region sum 4599999']);
  const forecast = USE_CASES.find((u) => u.no === 'N03-U01');
  const risk = structuredClone(mvpApi(forecast, { pages: [mvpPage(forecast)] }).routes['POST page']({}));
  risk.tables.at_risk.rows.pop();
  assert.deepEqual(headlineGaps('forecast_cockpit', risk), ['at_risk_n.now 5 but at_risk count 4']);
});

function scenarioGaps(u, data, scenarioEvaluate) {
  const gaps = [];
  const rows = data.tables.scenarios?.rows || [];
  if (rows.length !== u.mvp.scenarios.length) gaps.push(`shows ${rows.length} scenarios but the model sets ${u.mvp.scenarios.length}`);
  for (const [id, values] of u.mvp.scenarios) {
    const row = rows.find((r) => r.scenario_id === id);
    const model = scenarioEvaluate(u, values).outcome;
    const expected = { p10: model.p10, p50: model.p50, p90: model.p90, prob_target: model.prob_target, chance_pct: Math.round(model.prob_target * 100) };
    for (const [field, value] of Object.entries(expected)) if (row?.[field] !== value) gaps.push(`${id} ${field} ${row?.[field]} but the model gives ${value}`);
  }
  const bars = data.charts.swing?.rows || [];
  if (bars.length !== u.mvp.levers.length) gaps.push(`shows ${bars.length} swing bars but the model has ${u.mvp.levers.length} levers`);
  for (const [lever, , , name, move] of u.mvp.levers) {
    const bar = bars.find((r) => r.x === name);
    const shift = (value) => scenarioEvaluate(u, { [lever]: value }).outcome.p50 - u.mvp.base;
    for (const [field, value] of [['y0', shift(-move)], ['y1', shift(move)]]) if (bar?.[field] !== value) gaps.push(`swing ${name} ${field} ${bar?.[field]} but the model gives ${value}`);
  }
  return gaps;
}

test('every scenario and swing bar the demo shows states what the scenario model gives for its levers (must-exclude)', async () => {
  const { USE_CASES, mvpApi, mvpPage, scenarioEvaluate } = await kinds();
  const labs = USE_CASES.filter((u) => u.mvp.layout === 'scenario_lab');
  assert.ok(labs.length > 0, 'the demo has a scenario lab');
  const b = bundle();
  const gaps = [];
  for (const u of labs) {
    const answers = Object.entries(b.mvps[u.no].api).filter(([key]) => key.startsWith('POST /api/page '));
    assert.ok(answers.length > 0, `${u.no} recorded its page`);
    for (const [key, answer] of answers) gaps.push(...scenarioGaps(u, answer.body, scenarioEvaluate).map((g) => `${u.no} ${key}: ${g}`));
  }
  assert.deepEqual(gaps, []);
  const lab = labs[0];
  const off = structuredClone(mvpApi(lab, { pages: [mvpPage(lab)] }).routes['POST page']({}));
  off.tables.scenarios.rows.find((r) => r.scenario_id === 'upside').chance_pct = 96;
  assert.deepEqual(scenarioGaps(lab, off, scenarioEvaluate), ['upside chance_pct 96 but the model gives 99']);
  off.charts.swing.rows.find((r) => r.x === 'Price').y1 = 450000;
  assert.deepEqual(scenarioGaps(lab, off, scenarioEvaluate), ['upside chance_pct 96 but the model gives 99', 'swing Price y1 450000 but the model gives 270000']);
  off.charts.swing.rows.find((r) => r.x === 'Price').y1 = 270000;
  off.charts.swing.rows.find((r) => r.x === 'Unit cost').y0 = -350000;
  assert.deepEqual(scenarioGaps(lab, off, scenarioEvaluate), ['upside chance_pct 96 but the model gives 99', 'swing Unit cost y0 -350000 but the model gives 350000']);
  off.charts.swing.rows.find((r) => r.x === 'Unit cost').y0 = 350000;
  off.tables.scenarios.rows.pop();
  assert.deepEqual(scenarioGaps(lab, off, scenarioEvaluate), ['shows 2 scenarios but the model sets 3', 'upside chance_pct 96 but the model gives 99', 'downside p10 undefined but the model gives 3448400',
    'downside p50 undefined but the model gives 3730000', 'downside p90 undefined but the model gives 4011600', 'downside prob_target undefined but the model gives 0.11', 'downside chance_pct undefined but the model gives 11']);
});

const OUT = null;
const out = (...tokens) => Object.fromEntries(tokens.map((t) => [t, OUT]));
const atLeast = (derive) => (d) => ({ atLeast: derive(d) });
const sumOf = (list, f) => list.reduce((s, x) => s + f(x), 0);
const pct = (part, whole) => (100 * part) / whole;
const kpi = (id) => (d) => d.kpis[id].now;
const reason = (label, pattern) => (d) => Number((((d.row(label)?.top_reasons || []).join(' ').match(pattern) || [])[1] || '').replace(/,/g, '') || NaN);
const limit = (name) => (d) => d.chart('worth').find((r) => r.x === name).y0;
const evaluated = (values, field) => (d) => (field === 'prob_target' ? 100 : 1) * d.evaluate(values).outcome[field];
const scenarioRow = (id, field) => (d) => d.tables.scenarios.rows.find((r) => r.scenario_id === id)[field];
const tolerance = (d) => pct(d.rows[0].tolerance, d.rows[0].plan);
const worthOf = (d, segment) => d.chart('worth').find((r) => r.x === segment);
const netLift = (label) => (d) => { const r = d.chart('curves').find((c) => c.x_label === label); return r.y0 - r.x; };
const pathMedian = (variant) => (d) => d.chart('cycle').find((r) => r.x === variant).y2;
const siteDemand = (...ids) => (d) => sumOf(d.chart('points').filter((r) => ids.includes(r.x)), (r) => r.y0);
const shortlisted = (d) => d.rows.filter((r) => r.recommended_action.startsWith('Shortlist'));
const staffOn = (label, field) => (d) => { const r = d.row(label); const [, from, to] = r.entity_label.match(/(\d+) to (\d+)$/); return r[field] / (to - from); };
const lineChange = (pick) => (d) => sumOf(d.tables.rows.rows.filter(pick), (r) => r.change);
const BASE = evaluated({}, 'p50');
const BASE_CHANCE = evaluated({}, 'prob_target');
const DOWNSIDE = { unit_cost: 5, volume: -3 };

const PROSE_FIGURES = {
  'N01-U01': {
    story: { '1,240': kpi('items'), '$3.1M': kpi('total_loss'), ...out('200', '41%') },
    hint: { 8: (d) => d.rows.length, '1,240': kpi('items') },
    'genie 1': { 3: reason('Buyer 10432', /(\d+)x usual/), '40%': reason('Buyer 10432', /down (\d+)%/), ...out('78%') },
    'genie 2': { '$340K': (d) => ((52 - 41) / 100) * d.kpis.total_loss.now, ...out('300', '52%', '41%', '200', '100') },
    'genie 3': out('34%', '22%', '50'),
  },
  'N01-U04': {
    story: { 860: kpi('items'), '$1.9M': kpi('total_loss'), ...out('90', '40', '58%') },
    'genie 1': { 4: reason('INV-20931', /late (\d+) of/), 5: reason('INV-20931', /of the last (\d+)/), 3: reason('INV-20931', /(\d+)x usual/), ...out('90', '7%') },
    'genie 2': { '$1.35M': (d) => 0.71 * d.kpis.total_loss.now, ...out('60', '71%', '58%', '40') },
    'genie 3': out('3', '$410K'),
  },
  'N02-U02': {
    story: { 37: kpi('open_n'), '$412K': kpi('exposure'), 9: (d) => d.chart('by_age')[0].y0, 4: [kpi('old_n'), (d) => d.chart('by_age').at(-1).y0], ...out('2', '30') },
    'genie 1': {
      '$6,980': (d) => reason('INV-8812', /against a \$([\d,]+) contract/)(d) + d.row('INV-8812').value,
      '$4,120': (d) => reason('INV-8812', /Billed \$([\d,]+)/)(d) - d.row('INV-8812').value,
      '69%': (d) => pct(d.row('INV-8812').value, reason('INV-8812', /against a \$([\d,]+) contract/)(d)),
      ...out('2.1', '3%'),
    },
    'genie 2': out('14', '$231K', '5', '$48K', '2', '1'),
    'genie 3': out('6'),
  },
  'N03-U01': {
    story: {
      '6%': (d) => {
        const fan = d.chart('fan');
        return pct(sumOf(fan.filter((r) => r.y1 != null).slice(0, 4), (r) => r.y1), sumOf(fan.filter((r) => r.y0 != null).slice(-4), (r) => r.y0)) - 100;
      },
      2: (d) => d.chart('vs_capacity').filter((r) => r.y1 > r.y2).length, 8: (d) => d.chart('vs_capacity').length, ...out('4'),
    },
    'genie 1': out('34%', '31%', '2'),
    'genie 2': out('80%', '9,100', '10,400', '7%', '13', '6%', '9%'),
    'genie 3': out('210', '340'),
  },
  'N04-U02': {
    story: { '$4.20M': [kpi('base_p50'), BASE], '82%': [kpi('base_chance'), BASE_CHANCE], '$4.0M': (d) => d.page.scenario.outcome.target },
    hint: { '10%': (d) => d.evaluate({ price: 99 }).levers[0].value },
    'genie 1': { '95%': evaluated({ price: 2 }, 'prob_target'), '$40K': (d) => evaluated({ volume: 1 }, 'p50')(d) - BASE(d), ...out('2,400', '2%', '1%') },
    'genie 2': { '$0.35M': (d) => { const [top] = d.chart('swing'); return top.x === 'Unit cost' ? Math.max(Math.abs(top.y0), Math.abs(top.y1)) : NaN; }, '5%': (d) => d.u.mvp.levers.find(([lever]) => lever === 'unit_cost')[4], ...out('3') },
    'genie 3': {
      '$3.73M': [evaluated(DOWNSIDE, 'p50'), scenarioRow('downside', 'p50')], '11%': [evaluated(DOWNSIDE, 'prob_target'), scenarioRow('downside', 'chance_pct')],
      '$4.20M': [kpi('base_p50'), BASE], '82%': [kpi('base_chance'), BASE_CHANCE], ...out('5%', '3%'),
    },
  },
  'N05-U01': {
    story: {
      '1,260': (d) => sumOf(d.rows, (r) => r.recommended_value), 6: (d) => new Set(d.rows.flatMap((r) => r.entity_label.split(' to '))).size,
      '$310K': [(d) => sumOf(d.rows, (r) => r.value), kpi('objective')],
    },
    'genie 1': { '$12': limit('W5 capacity'), '$640': limit('Tuesday truck slots'), '$0.31': limit('Weekly freight budget') },
    'genie 2': { '$12': limit('W5 capacity'), ...out('$26K') },
    'genie 3': out('31', '34', '$268K', '$290K', '3', '$4K'),
  },
  'N05-U03': {
    story: { 410: (d) => sumOf(d.rows, (r) => r.current_value - r.recommended_value), ...out('5', '96%') },
    'genie 1': { 3: staffOn('Store 12, Sat 10 to 14', 'current_value'), 5: staffOn('Store 12, Sat 10 to 14', 'recommended_value'), ...out('1,180', '10', '14', '9', '4.2') },
    'genie 2': { '$1.10': limit('Labor budget') },
    'genie 3': out('4%'),
  },
  'N06-U01': {
    story: {
      '12%': (d) => pct(worthOf(d, 'Costly returners').y0, sumOf(d.chart('worth'), (r) => r.y0)),
      '3%': (d) => -pct(worthOf(d, 'Costly returners').y0 * worthOf(d, 'Costly returners').y1, d.kpis.value.now),
      '48%': (d) => pct(worthOf(d, 'Loyal high value').y0 * worthOf(d, 'Loyal high value').y1, d.kpis.value.now),
    },
    'genie 1': out('38%', '9%', '4'),
    'genie 2': { 312: (d) => d.chart('moves').find((r) => r.x === 'Loyal high value' && r.s === 'Occasional').y0, ...out('5', '41%') },
    'genie 3': out('$1.31', '$0.57'),
  },
  'N06-U04': {
    story: { 1.8: (d) => sumOf(d.chart('lift'), (r) => r.x * r.y0) / sumOf(d.chart('lift'), (r) => r.x), ...out('14%') },
    hint: { 3: (d) => Math.max(...d.rows.map((r) => r.rank)) },
    'genie 1': { '41%': reason('Trail jacket', /(\d+)% of such buyers/), ...out('6', '2') },
    'genie 2': out('14%', '610'),
    'genie 3': out('6,400', '2,100'),
  },
  'N07-U01': {
    story: {
      '$400K': (d) => -d.kpis.variance.now, '8.7%': (d) => pct(-d.kpis.variance.now, d.kpis.plan.now),
      half: (d) => pct(sumOf(d.rows.filter((r) => r.region === 'North' && r.channel === 'Volume'), (r) => r.variance), d.kpis.variance.now),
    },
    hint: { '3%': tolerance },
    'genie 1': out('11%', '9', '6', '5'),
    'genie 2': { 6: kpi('outside_n'), '3%': tolerance, ...out('24', '2', '4') },
    'genie 3': out('31%', '22%', '14%'),
  },
  'N07-U03': {
    story: { 9: kpi('outside_n'), '$2.1M': [(d) => -d.kpis.variance.now, (d) => -sumOf(d.rows, (r) => r.variance)], '$1.05M': (d) => -d.kpis.variance.now / 2, ...out('2') },
    hint: { '3%': tolerance },
    'genie 1': { '22.9%': reason('Store 61', /Margin ([\d.]+)%/), '29.8%': reason('Store 61', /median of ([\d.]+)%/), ...out('3') },
    'genie 2': out('12%', '2'),
    'genie 3': {
      '$410K': (d) => -d.row('Store 61').variance, '$350K': (d) => -d.row('Store 27').variance, '$280K': (d) => -d.row('Store 19').variance,
      half: (d) => pct(sumOf(d.rows.filter((r) => ['Store 61', 'Store 27', 'Store 19'].includes(r.entity_label)), (r) => r.variance), d.kpis.variance.now),
      '$2.1M': (d) => -d.kpis.variance.now,
    },
  },
  'N08-U01': {
    story: { '$212K': netLift('Spring 2-for-1'), '$35K': (d) => -netLift('Clearance week')(d), ...out('$2.8M') },
    'genie 1': {
      '19%': (d) => d.tables.effect.rows.find((r) => r.intervention === 'Spring 2-for-1').effect,
      '$140K': (d) => d.u.mvp.promos.find(([label]) => label === 'Spring 2-for-1')[2], '$280K': (d) => d.u.mvp.promos.find(([label]) => label === 'Spring 2-for-1')[3],
      ...out('95%'),
    },
    'genie 2': {
      '$23K': (d) => d.chart('curves').find((r) => r.x_label === 'Clearance week').y0, '$58K': (d) => d.chart('curves').find((r) => r.x_label === 'Clearance week').x,
      '$35K': (d) => -netLift('Clearance week')(d), ...out('$110K', '$62K', '$25K'),
    },
    'genie 3': out('15%', '20'),
  },
  'N09-U01': {
    story: { 14.6: [(d) => Math.max(...d.chart('map').map((r) => r.y1)), (d) => d.chart('map').find((r) => r.x === 'Packed' && r.s === 'Label printed').y1], 412: kpi('at_risk') },
    hint: out('1', '10'),
    'genie 1': { 14.6: (d) => d.chart('map').find((r) => r.x === 'Packed' && r.s === 'Label printed').y1, ...out('2.3', '2') },
    'genie 2': { 55: pathMedian('Split shipment'), 31: pathMedian('Happy path'), ...out('62%') },
    'genie 3': { 31: pathMedian('Happy path'), 46: pathMedian('With repack') },
  },
  'N10-U01': {
    story: { 5: (d) => shortlisted(d).length, '$7.9M': (d) => sumOf(shortlisted(d), (r) => r.metric), '22%': reason('S3 Bristol East', /Takes (\d+)%/) },
    'genie 1': { '22%': reason('S3 Bristol East', /Takes (\d+)%/), '$1.9M': siteDemand('S3'), '$2.1M': siteDemand('S1'), '4%': reason('S1 Leeds North', /Takes (\d+)%/) },
    'genie 2': out('310,000', '20', '2.1'),
    'genie 3': { '$5.0M': siteDemand('S1', 'S2', 'S4'), ...out('3') },
  },
  'N10-U03': {
    story: { 11: kpi('rings'), 74: kpi('accounts'), '$186K': atLeast((d) => sumOf(d.rows, (r) => r.metric)), ...out('2') },
    'genie 1': {
      4: reason('C-1042', /Same card x(\d+)/), 3: reason('C-1042', /Same address x(\d+)/),
      '$48K': atLeast((d) => sumOf(d.rows.filter((r) => r.community === 'R-07'), (r) => r.metric)), ...out('6', '11'),
    },
    'genie 2': out('2'),
    'genie 3': out('14', '11', '3'),
  },
  'N11-U01': {
    story: out('312', '18', '20'),
    'genie 1': out('$41K', '$28K', '$22K', '$19K', '$12K', '5', '30%'),
    'genie 2': out('$3.4M', '11%', '38%'),
    'genie 3': out('9%', '2%', '21%'),
    'genie 4': out('31', '24', '19', '3'),
    'genie 5': out('27%', '22%', '41%'),
  },
  'N12-U01': {
    story: {
      '$0.40M': (d) => d.kpis.prior.now - d.kpis.revenue.now, '$0.21M': atLeast((d) => -lineChange((r) => r.channel === 'Volume')(d)),
      '$0.12M': atLeast((d) => -lineChange((r) => r.channel === 'Price')(d)), '$0.04M': atLeast(lineChange((r) => r.channel === 'Mix')),
    },
    'genie 1': { '$130K': (d) => -lineChange((r) => r.region === 'North' && r.channel === 'Volume')(d), ...out('$29K', '2') },
    'genie 2': { '$91K': (d) => -lineChange((r) => r.channel === 'Price' && r.segment === 'Apparel')(d), '$120K': atLeast((d) => -lineChange((r) => r.channel === 'Price')(d)) },
    'genie 3': { '$0.22M': (d) => d.chart('trend').at(-2).y1 - d.chart('trend').at(-1).y1 },
  },
};

const ENTITY_NAMES = /\b(?:Store|Buyer|Item|[Ww]eek) \d+/g;
const FIGURE = /(?<![\w$.,-])\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[KMB](?![A-Za-z]))?%?(?![\w-])/g;
const WORD_FIGURES = { half: { value: 50, tolerance: 5 } };
const figuresIn = (text) => [...new Set(String(text || '').replace(ENTITY_NAMES, '').match(FIGURE) || [])];
const stating = (token) => new RegExp(`(?<![\\w$.,-])${token.replace(/[$.]/g, '\\$&')}(?![\\w-])`);

function statedFigure(token, text) {
  if (WORD_FIGURES[token]) return WORD_FIGURES[token];
  const unit = { K: 1e3, M: 1e6, B: 1e9 }[token.replace('%', '').slice(-1)] || 1;
  const digits = token.replace(/[$,%KMB]/g, '');
  const decimals = (digits.split('.')[1] || '').length;
  const zeros = !decimals && text.includes(`about ${token}`) ? digits.length - digits.replace(/0+$/, '').length : 0;
  return { value: Number(digits) * unit, tolerance: (unit * 10 ** (zeros - decimals)) / 2 };
}

function proseOf(u, page) {
  const hints = [page.records?.hint, page.scenario?.hint, page.plan?.hint, ...(page.charts || []).flatMap((c) => [c.hint, c.so_what])];
  return [['story', page.story], ['hint', hints.filter((t) => t && !t.includes(u.story)).join(' ')], ...u.genie.map((g, i) => [`genie ${i + 1}`, g.a])];
}

function proseData(u, mvpApi, mvpPage, scenarioEvaluate) {
  const page = mvpPage(u);
  const { routes, rows } = mvpApi(u, { pages: [page] });
  const data = routes['POST page']({});
  return { ...data, page, rows, u, chart: (id) => data.charts[id]?.rows || [], row: (label) => rows.find((r) => r.entity_label === label), evaluate: (values) => scenarioEvaluate(u, values) };
}

function proseGaps(u, d, spec = PROSE_FIGURES[u.no] || {}) {
  const gaps = [];
  const fields = proseOf(u, d.page);
  for (const field of Object.keys(spec)) if (!fields.some(([name]) => name === field)) gaps.push(`${field} has no text`);
  for (const [field, text] of fields) {
    const claims = spec[field] || {};
    for (const token of figuresIn(text)) if (!(token in claims)) gaps.push(`${field} states ${token}, which is neither checked nor listed as not derivable`);
    for (const [token, derive] of Object.entries(claims)) {
      if (!(WORD_FIGURES[token] ? new RegExp(`\\b${token}\\b`) : stating(token)).test(text.replace(ENTITY_NAMES, ''))) {
        gaps.push(`${field} no longer states ${token}`);
        continue;
      }
      const stated = statedFigure(token, text);
      for (const one of [derive].flat().filter(Boolean)) {
        const got = one(d);
        const floor = got && typeof got === 'object';
        const shown = floor ? got.atLeast : got;
        const ok = Number.isFinite(shown) && (floor ? stated.value + stated.tolerance >= shown : Math.abs(stated.value - shown) < stated.tolerance * (1 - 1e-9));
        if (!ok) gaps.push(`${field} says ${token} but the data gives ${floor ? 'at least ' : ''}${Number.isFinite(shown) ? Number(shown.toFixed(3)) : shown}`);
      }
    }
  }
  return gaps;
}

test('every figure the kinds demo prose states (story, hints, Genie answers) equals the demo data it can be derived from, within its rounding, and the rest is listed as not derivable (must-exclude)', async () => {
  const { USE_CASES, DEMO_RECORDED, mvpApi, mvpPage, scenarioEvaluate } = await kinds();
  assert.deepEqual(Object.keys(PROSE_FIGURES).sort(), USE_CASES.map((u) => u.no).sort(), 'every use case states which of its figures are checked');
  const b = bundle();
  const gaps = [];
  let checked = 0;
  for (const u of USE_CASES) {
    const d = proseData(u, mvpApi, mvpPage, scenarioEvaluate);
    const api = b.mvps[u.no].api;
    assert.equal(api['GET /api/app'].body.pages[0].story, d.page.story, `${u.no} recorded the story it states`);
    assert.deepEqual(api[`POST /api/page ${JSON.stringify({ filters: {}, page: d.page.id })}`]?.body, JSON.parse(JSON.stringify({ kpis: d.kpis, charts: d.charts, tables: d.tables, errors: d.errors })), `${u.no} recorded the data its prose is checked against`);
    const said = new Set(Object.entries(api).filter(([key]) => key.startsWith('GET /api/genie/message')).map(([, a]) => a.body.text));
    for (const g of u.genie) assert.ok(said.has(`${g.a}\n\n${DEMO_RECORDED}`), `${u.no} recorded "${g.q}"`);
    gaps.push(...proseGaps(u, d).map((g) => `${u.no} ${g}`));
    checked += Object.values(PROSE_FIGURES[u.no]).flatMap(Object.values).filter(Boolean).length;
  }
  assert.ok(checked >= 60, `${checked} figures checked against the data`);
  assert.deepEqual(gaps, []);
});

test('the prose figure check fails on a wrong figure, a figure nobody classified, a total smaller than its listed parts, and a halfway figure stated too coarsely', async () => {
  const { USE_CASES, mvpApi, mvpPage, scenarioEvaluate } = await kinds();
  const restated = (no, from, to) => {
    const u = USE_CASES.find((x) => x.no === no);
    const story = Object.fromEntries(Object.entries(PROSE_FIGURES[no].story).map(([token, derive]) => (token === from ? [to, derive] : [token, derive])));
    const changed = { ...u, story: u.story.replace(from, to) };
    assert.notEqual(changed.story, u.story, `${no} states ${from}`);
    return proseGaps(changed, proseData(changed, mvpApi, mvpPage, scenarioEvaluate), { ...PROSE_FIGURES[no], story });
  };
  assert.deepEqual(restated('N03-U01', '6%', '18%'), ['story says 18% but the data gives 5.799']);
  assert.deepEqual(restated('N03-U01', '6%', '5%'), ['story says 5% but the data gives 5.799']);
  assert.deepEqual(restated('N03-U01', '2', '3'), ['story says 3 but the data gives 2']);
  assert.deepEqual(restated('N10-U03', '$186K', '$86K'), ['story says $86K but the data gives at least 110000']);
  assert.deepEqual(restated('N07-U03', '$1.05M', '$1.0M'), ['story says $1.0M but the data gives 1050000']);
  assert.deepEqual(restated('N07-U03', '$1.05M', '$1.1M'), ['story says $1.1M but the data gives 1050000']);
  const forecast = USE_CASES.find((u) => u.no === 'N03-U01');
  const extra = { ...forecast, story: `${forecast.story} 9 more store-items are late.` };
  assert.deepEqual(proseGaps(extra, proseData(extra, mvpApi, mvpPage, scenarioEvaluate)), ['story states 9, which is neither checked nor listed as not derivable']);
  const dropped = { ...forecast, story: forecast.story.replace('6%', 'a little') };
  assert.deepEqual(proseGaps(dropped, proseData(dropped, mvpApi, mvpPage, scenarioEvaluate)), ['story no longer states 6%']);
});

test('every alert rule the kinds demo shows puts a plural count with are, never is (must-exclude)', () => {
  const text = JSON.stringify(bundle());
  const plural = /\b(rows|Records on the list) (is|are) (at least|more than|less than|at most|equal to|not equal to) \d/g;
  const found = [...text.matchAll(plural)].map((m) => m[0]);
  assert.ok(text.includes('Act now rows are at least 5'), 'the demo shows the Act now alert rule');
  assert.deepEqual(found.filter((t) => / is /.test(t)), []);
  assert.deepEqual(['Act now rows is at least 5'].filter((t) => !t.match(plural) || / is /.test(t)), ['Act now rows is at least 5']);
});
