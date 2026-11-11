#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PERIOD_PICK, apiWatch, recordMvpApp, routeInspireDemo, walkInspireDemo } from './showcaseRecorder.mjs';
import { demoReads, unrecorded } from './showcaseRoutes.mjs';
import { CUSTOM, PERIODS } from '../agent/agent/app_shell/web/src/mywork.js';
import {
  DEMO_CATALOG, DEMO_OWNER, KINDS_DEMO, USE_CASES, exampleName, mvpApi, mvpPage, mvpSettings, rankedUseCases, scenarioEvaluate,
} from './kindsShowcase.mjs';
import { CONTRACT, NO_HUB, NO_IMPACT, NO_MONEY, NO_RUNS, NO_SETTINGS, NO_SUMMARY, appInfo } from '../agent/agent/app_shell/web/test/harness.mjs';
import { closeBrowser, openUi } from '../frontend/test/ui/uiSupport.mjs';
import { STUDIO_STATE, built } from '../frontend/test/ui/implementFixtures.js';
import { defaultSpecFromUseCase } from '../frontend/src/lib/implementWizard.js';
import { computeHighPriorityCount, qualityBarCountsOf } from '../frontend/src/lib/useCaseFields.js';
import redact from '../backend/lib/redact.js';

redact.redactOutput();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const backendRequire = createRequire(path.join(root, 'backend', 'package.json'));
const express = backendRequire('express');
const { chromium } = require(path.join(root, 'frontend/node_modules/playwright'));
const { makeRecorder, showcaseFile, showcaseLeaks, showcaseSizeProblem, showcaseSizes } = require('../backend/lib/showcaseRecord.js');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../backend/lib/appShell.js');
const { assetType } = require('../backend/lib/assetTypes.js');

const out = path.resolve(process.env.OUT || path.join(root, 'backend/showcase', `${KINDS_DEMO.id}.json.gz`));
const log = (line) => console.log(`[kinds demo] ${line}`);
const sid = KINDS_DEMO.sessionId;
const INSPIRE_DATABASE = 'main.inspire';
const WAREHOUSE = 'wh1';
const WORKSPACE = 'https://workspace.example.com';

const KIND_FIELDS = `
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
import _agentload
ns = _agentload.load_agent_namespace()
from v120_gate_recalibration_test import make
agent = make(ns)
done = []
for uc in json.load(open(sys.argv[3], encoding="utf-8")):
    issues = agent._use_case_name_issues(uc)
    if issues:
        raise SystemExit(f"{uc['No']} {uc['Name']!r} fails the name check: {issues}")
    if not ns["inspire_apply_use_case_kind"](uc):
        raise SystemExit(f"{uc['No']} has no use case kind")
    uc["name_with_technique"] = agent._inspire_name_with_technique(uc)
    done.append(uc)
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump(done, handle)
`;

function withKinds(useCases) {
  const tests = path.join(root, 'agent', 'tests');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-kinds-')), 'use_cases.json');
  fs.writeFileSync(file, JSON.stringify(useCases));
  execFileSync('python3', ['-c', KIND_FIELDS, tests, path.join(tests, 'unit'), file], { stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const slugOf = (u) => u.app;
const ucOf = (parameters) => (parameters || []).find((p) => p.name === 'uc')?.value;
const appUrlOf = (u) => `https://${slugOf(u)}-1.aws.databricksapps.com`;

function snakeRow(uc) {
  return {
    session_id: sid, id: uc.No, business_domain: uc['Business Domain'], subdomain: uc.Subdomain, use_case: uc.usecase, description: uc.Name,
    inspire_score: String(uc['Inspire Score']), type: 'Opportunity', analytics_technique: uc['Analytics Technique'], statement: uc.Statement,
    solution: uc.Solution, business_value: uc['Business Value'], beneficiary: uc.Beneficiary, sponsor: uc.Sponsor, tables_involved: uc['Tables Involved'],
    primary_table: uc['Primary Table'], priority_score: String(uc['Priority Score']), quality_score: String(uc['Quality Score']), has_genie_code: 'Y',
    best_of_best: 'Y', best_of_best_rank: uc.best_of_best_rank, bob_score: String(uc.bob_score), use_case_kind: uc.use_case_kind, kind_family: uc.kind_family,
    app_layout: uc.app_layout, serving_summary: uc.serving_summary, method_summary: uc.method_summary, value_source: uc.value_source,
    selection_basis: uc.selection_basis, name_with_technique: uc.name_with_technique, No: uc.No, Name: uc.Name, 'Analytics Technique': uc['Analytics Technique'],
  };
}

const specOf = (u, uc) => defaultSpecFromUseCase(snakeRow(uc), { warehouseId: WAREHOUSE, inspireDatabase: INSPIRE_DATABASE, sessionId: sid, owner: DEMO_OWNER });
const scheduleOf = (spec) => ({ ...spec.schedule, enabled: true, timezone: 'UTC' });

function historyRow(u, uc, i) {
  const spec = specOf(u, uc);
  const { app_access: _access, app_look: _look, app_options: _options, merge: _merge, ...outputs } = spec.outputs;
  const questions = u.genie.map((g) => g.q);
  const result = `${DEMO_CATALOG}.${u.result}`;
  return built({
    session_id: sid, use_case_id: u.no, job_id: String(300 + i), last_preview_run_id: String(9100 + i), result_rows: '120',
    spec_json: JSON.stringify({ ...spec, schedule: scheduleOf(spec), outputs: { ...outputs, genie_space: true, app: true, app_name: slugOf(u), alert: true, alert_recipients: [DEMO_OWNER], genie_questions: questions } }),
    dashboard_id: `d${i + 1}`, dashboard_url: `${WORKSPACE}/dashboardsv3/d${i + 1}/published`,
    genie_space_id: `g${i + 1}`, genie_space_url: `${WORKSPACE}/genie/rooms/g${i + 1}`,
    app_name: slugOf(u), app_url: appUrlOf(u), alert_id: `a${i + 1}`, alert_url: `${WORKSPACE}/sql/alerts-v2/a${i + 1}`,
    genie_widgets: JSON.stringify([{ name: 'result_table', type: 'text', default: result }, { name: 'run_profile', type: 'dropdown', default: 'full', choices: ['preview', 'full'] }]),
    asset_status: JSON.stringify({
      genie_space: { state: 'ready', sample_questions: questions, question_notes: [], check_question: questions[0], check_sql: u.genie[0].sql || `SELECT * FROM ${result} LIMIT 10` },
      app: { state: 'ready', health: 'running', spec_version: 1 },
      alert: { state: 'ready', trigger: 'Act now rows in the latest run are at least 1', check_state: 'OK', subscribers: 1 },
    }),
  });
}

const ALERTS = {
  on: true, reason: '', built: '', unread: 0, caps: { used: 1, app: 20, mine: 1, person: 10 }, schedules: [{ id: 'weekly', label: 'every week' }],
  operators: [{ id: '>=', label: 'is at least' }], baseline_operators: [], operator_words: {}, measures: [{ id: 'act_now', label: 'Act now rows' }],
  admin: false, filters: [], built_alert: null, person: DEMO_OWNER, can_add: true, why: '',
  alerts: [{ id: 'w1', name: 'Act now over 5', state: 'ok', kind: 'watch', rule: 'Act now rows are at least 5', scope: '', schedule: 'weekly',
    checked: '2026-11-02T06:00:00Z', email_count: 1, notify_on_ok: true, by: DEMO_OWNER, can_change: true, url: '' }],
};

function inspireState(useCases) {
  const schedules = USE_CASES.map((u, i) => scheduleOf(specOf(u, useCases[i])));
  const [schedule] = schedules;
  if (schedules.some((s) => s.cron !== schedule.cron || s.timezone !== schedule.timezone || s.enabled !== schedule.enabled)) {
    throw new Error(`the MVP specs state ${new Set(schedules.map((s) => s.cron)).size} schedules, but the one job the demo serves answers with one`);
  }
  const domains = [...new Set(useCases.map((uc) => uc['Business Domain']))];
  const rows = Object.fromEntries(useCases.map((uc) => [uc.No, snakeRow(uc)]));
  const history = USE_CASES.map((u, i) => historyRow(u, useCases[i], i));
  const tables = [...new Set(useCases.flatMap((uc) => uc['Tables Involved'].split(', ')))];
  const bar = qualityBarCountsOf(useCases);
  const run = {
    session_id: sid, processing_status: 'ready', completed_percent: 100, create_at: '2026-11-02T05:00:00Z', last_updated: '2026-11-02T05:58:00Z',
    completed_on: '2026-11-02T05:58:00Z', business_name: KINDS_DEMO.business, inspire_database_name: INSPIRE_DATABASE, operation_mode: 'Discover Use Cases',
    generation_path: '/Workspace/Users/person@example.com/inspire/retail', business_domains: '', catalogs: 'main', business_runs: 1, business_rank: 1,
    widget_values: { business: KINDS_DEMO.business, '00_business_name': KINDS_DEMO.business, inspire_database: INSPIRE_DATABASE, operation_mode: 'Discover Use Cases' },
    usecase_overview: { total: useCases.length, high: computeHighPriorityCount(useCases), meets: bar.meets, below: bar.below, domains: domains.length, unread: {},
      preview_use_cases: useCases.slice(0, 4).map((uc) => ({ Name: uc.Name, name_with_technique: uc.name_with_technique || null })) },
  };
  const counts = { use_cases: String(useCases.length), domains: String(domains.length), subdomains: String(new Set(useCases.map((uc) => uc.Subdomain)).size), best_of_best: String(useCases.length) };
  const mvps = { mvps_started: String(history.length), mvps_live: String(history.length), mvps_building: '0', mvps_failed: '0', apps: String(history.length), dashboards: String(history.length), genie_spaces: String(history.length), alerts: String(history.length) };
  return {
    session: { business_name: KINDS_DEMO.business, discovery_type: 'Deep', catalogs: 'main', schemas_str: 'retail', tables_str: tables.join(','), generation_path: run.generation_path, inspire_database_name: INSPIRE_DATABASE },
    useCase: null,
    statements: {
      'AND id = :uc LIMIT 1': (_sql, parameters) => ({ rows: [rows[ucOf(parameters)]].filter(Boolean) }),
      'AND use_case_id = :uc ORDER BY': (_sql, parameters) => ({ rows: history.filter((h) => h.use_case_id === ucOf(parameters)) }),
    },
    results: {
      discovery_type: 'Deep', business_name: KINDS_DEMO.business, title: KINDS_DEMO.title,
      domains: domains.map((domain_name) => ({ domain_name, use_cases: useCases.filter((uc) => uc['Business Domain'] === domain_name) })),
      delivery_order: [...useCases].sort((a, b) => Number(a.best_of_best_rank) - Number(b.best_of_best_rank)).map((uc) => uc.No),
      data_access: { tables_read: tables, tables_read_count: tables.length, statements: tables.length * 3, pii_columns_excluded: 0, rows_sent_to_ai: 0 },
    },
    useCases: Object.values(rows),
    history,
    appExists: true,
    alert: { display_name: 'Act now rows', lifecycle_state: 'ACTIVE', evaluation: { state: 'OK', last_evaluated_at: '2026-11-02T06:00:00Z' } },
    appsByName: Object.fromEntries(USE_CASES.map((u, i) => [slugOf(u), {
      ...STUDIO_STATE.app, name: slugOf(u), url: appUrlOf(u), description: `Inspire use case ${u.no} (session ${sid}): ${useCases[i].Name}`,
    }])),
    runsByJob: Object.fromEntries(USE_CASES.map((_u, i) => [String(300 + i), { runs: [{
      run_id: 9100 + i, start_time: Date.UTC(2026, 10, 2, 6, 0, 0), run_duration: 95000, trigger: 'PERIODIC',
      state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', state_message: '' }, run_page_url: `${WORKSPACE}/#job/${300 + i}/run/${9100 + i}`,
    }] }])),
    job: { job_id: 300, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: sid }, schedule: { quartz_cron_expression: schedule.cron, timezone_id: schedule.timezone, pause_status: schedule.enabled ? 'UNPAUSED' : 'PAUSED' } } },
    sessions: [run],
    portfolioRuns: [{ runs: '1', businesses: '1' }],
    portfolioUseCases: [{ sid: null, is_total: '1', ...counts }, { sid, is_total: '0', ...counts }],
    portfolioMvps: [{ sid: null, is_total: '1', ...mvps }, { sid, is_total: '0', ...mvps }],
    useCaseAlerts: { listing: async () => ALERTS },
    feedback: { available: true, latest: [], history: [] },
    inspireSession: { ...run, processing_status: 'done', results_json: null },
    runSteps: [
      { step_id: '1', stage_name: 'Discovery', step_name: 'Read the tables', status: 'ended_success', last_updated: '2026-11-02T05:10:00Z', message: `Read ${tables.length} tables`, progress_increment: 20 },
      { step_id: '2', stage_name: 'Use Case Generation', step_name: 'Write the use cases', status: 'ended_success', last_updated: '2026-11-02T05:40:00Z', message: `Wrote ${useCases.length} use cases`, progress_increment: 70 },
      { step_id: '3', stage_name: 'Use Case Generation', step_name: 'Score the use cases', status: 'ended_success', last_updated: '2026-11-02T05:58:00Z', message: `Scored ${useCases.length} use cases`, progress_increment: 10 },
    ],
  };
}

const SHARED = {
  'POST overview': NO_HUB, 'GET summary': NO_SUMMARY, 'GET runs': NO_RUNS, 'GET money': NO_MONEY, 'GET settings': NO_SETTINGS, 'GET impact': NO_IMPACT,
  'GET records/batches': { ...CONTRACT.batches.response, batches: [] },
};

function serveMvp(u, info, shell) {
  const { routes } = mvpApi(u, info, SHARED);
  const app = express();
  app.use(express.json());
  app.all('/api/*rest', (req, res) => {
    const route = `${req.method} ${req.params.rest.join('/')}`;
    const handler = routes[route];
    if (!handler) return res.status(404).json({ error: `the demo MVP has no ${route}` });
    const answer = handler(req.body, new URLSearchParams(req.originalUrl.split('?')[1] || ''));
    return Array.isArray(answer) ? res.status(answer[0]).json(answer[1]) : res.json(answer);
  });
  app.use((req, res) => {
    const name = req.path === '/' ? 'static/index.html' : `static${req.path}`;
    const body = shell[name];
    if (body === undefined) return res.status(404).type('text/plain').send('not found');
    return res.type(assetType(name)).send(Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'));
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }));
  });
}

function scenarioAnswers(u, info, localUrl) {
  if (u.mvp.layout !== 'scenario_lab') return [];
  const page = info.pages[0].id;
  return u.mvp.levers.flatMap(([lever]) => Array.from({ length: 21 }, (_, i) => {
    const values = { [lever]: i - 10 };
    return { method: 'POST', url: `${localUrl}/api/scenario/evaluate`, postData: JSON.stringify({ page, values }), status: 200, body: scenarioEvaluate(u, values) };
  }));
}

const useCases = withKinds(rankedUseCases());
log(`${useCases.length} use cases: ${useCases.map((uc) => `${uc.No} ${uc.use_case_kind}`).join(', ')}`);
const infos = USE_CASES.map((u) => appInfo(mvpSettings(u), 1, mvpPage(u), exampleName(u)));
const shell = appShellFiles(appShellPayload(bundledAppShellText()));

const walkStarted = new Date().toISOString();
const inspire = [];
const blocked = [];
const ui = await openUi('app', inspireState(useCases), '', {
  mount: (app) => app.get('/api/defaults', (_req, res) => res.json({
    envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: WORKSPACE, warehouseId: WAREHOUSE, inspireDatabase: INSPIRE_DATABASE, notebookPath: '/Shared/inspire_ai',
  })),
  init: (page, origin) => routeInspireDemo(page, {
    origin, summary: { ...KINDS_DEMO, session_id: sid, mvps: [] }, real: { inspire_database: INSPIRE_DATABASE, warehouse_id: WAREHOUSE }, exchanges: inspire, blocked,
  }),
});
const mvpExchanges = Object.fromEntries(USE_CASES.map((u) => [u.no, []]));
const servers = [];
const browser = await chromium.launch();
try {
  const settle = apiWatch(ui.page);
  const walk = await walkInspireDemo(ui.page, { settle, log, mvps: true });
  const missed = unrecorded(inspire, demoReads(true, walk));
  if (missed.length) throw new Error(`the walk did not record ${missed.join(', ')}`);
  const writes = ui.made.fetches.filter((f) => String(f.opts.method || 'GET').toUpperCase() !== 'GET').map((f) => f.path);
  if (writes.length || ui.made.jobs.length) throw new Error(`the walk changed the made-up workspace: ${writes.join(', ')}`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  for (const [i, u] of USE_CASES.entries()) {
    const server = await serveMvp(u, infos[i], shell);
    servers.push(server);
    await recordMvpApp(context, { url: `${server.url}/`, exchanges: mvpExchanges[u.no], blocked, periods: true, log: (line) => log(`${u.no} ${line.replace(server.url, u.app)}`) });
    mvpExchanges[u.no].push(...scenarioAnswers(u, infos[i], server.url));
  }

  for (const u of USE_CASES) {
    const exchanges = mvpExchanges[u.no];
    const asked = exchanges.filter((x) => x.url.endsWith('/api/my_work')).map((x) => JSON.parse(x.postData));
    const unasked = PERIODS.filter(([choice]) => !asked.some((b) => (choice === CUSTOM ? b.from === PERIOD_PICK.from && b.to === PERIOD_PICK.to : b.window === choice)));
    if (unasked.length) throw new Error(`${u.no} never recorded My work for ${unasked.map(([, text]) => text).join(', ')}, so its replay would answer 404`);
    const first = exchanges.some((x) => x.url.endsWith('/api/genie/ask') && JSON.parse(x.postData).question === u.genie[0].q);
    if (!first) throw new Error(`${u.no} never recorded its first suggested Genie question, so a visitor's first click would find no answer`);
  }

  const recorder = makeRecorder({
    id: KINDS_DEMO.id, title: KINDS_DEMO.title, business: KINDS_DEMO.business, summary: KINDS_DEMO.summary, sessionId: sid,
    replace: { 'amr@x': 'person@example.com', Amr: 'Demo User' },
    recordedAt: { since: walkStarted, as: KINDS_DEMO.recordedAt },
    mvps: USE_CASES.map((u, i) => ({ id: u.no, title: infos[i].title, url: appUrlOf(u) })),
  });
  for (const x of inspire) recorder.addInspire(x);
  for (const u of USE_CASES) for (const x of mvpExchanges[u.no]) recorder.addMvp(u.no, x);
  const bundle = recorder.bundle();
  const leaks = showcaseLeaks(bundle, ['amr@x', '127.0.0.1', 'databricksapps.com']);
  const tooBig = showcaseSizeProblem(bundle);
  if (tooBig) throw new Error(`the demo is too large for the App: ${tooBig}`);
  if (leaks.length) throw new Error(`the demo still names private details:\n${leaks.slice(0, 40).join('\n')}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, showcaseFile(bundle));
  const sizes = showcaseSizes(bundle);
  log(`wrote ${out}: ${Object.keys(bundle.inspire).length} Inspire answers, ${USE_CASES.length} MVP Apps with ${USE_CASES.map((u) => Object.keys(bundle.mvps[u.no].api).length).join(', ')} answers, ${sizes.gzip} bytes compressed from ${sizes.json}`);
  if (blocked.length) log(`refused ${blocked.length} writes during the walk: ${[...new Set(blocked)].join(', ')}`);
} finally {
  await browser.close();
  for (const server of servers) await server.close();
  await ui.close();
  await closeBrowser();
}
