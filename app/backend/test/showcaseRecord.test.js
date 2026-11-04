const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const express = require('express');
const { listen } = require('./support/implementApp');
const S = require('../lib/showcase');
const R = require('../lib/showcaseRecord');

const joined = (...parts) => parts.join('');
const SID = joined('2026', '0000', '1111', '2222', '333');
const HOST = `https://${['dbc-1a2b3c4d-5e6f', 'cloud', 'databricks', 'com'].join('.')}`;
const MVP_URL = `https://inspire-n01-u01-${joined('4455', '6677', '8899', '0011')}.${['aws', 'databricksapps', 'com'].join('.')}`;
const JANE = ['jane.doe', 'corp.io'].join('@');
const BOB = ['bob', 'corp.io'].join('@');
const SP_ID = ['5d1e7c3a', '9b2f', '4e6a', '8c4d', '1f2e3a4b5c6d'].join('-');
const SP_NAME = 'app-q7k2m9';
const ASSET = joined('01f0aabbccddeeff', '00112233445566');
const LONG = joined('9876543', '210123');
const JOB_ID = Number(joined('4321', '0987', '6543', '2109'));

function recorder(extra = {}) {
  return R.makeRecorder({
    id: 'taxi',
    title: 'NYC Taxi Operations',
    business: 'NYC Taxi Operations',
    sessionId: SID,
    replace: { acme_catalog: 'demo_catalog', 'Jane Analyst': 'Demo User' },
    mvps: [{ id: 'N01-U01', title: 'Fare desk', url: MVP_URL }],
    ...extra,
  });
}

test('the sanitizer replaces workspace hosts, emails, ids and service principal names, and keeps times and ordinary words', () => {
  const clean = R.makeSanitizer({ replace: { acme_catalog: 'demo_catalog', acme: 'demo' }, sessionId: SID });
  assert.equal(clean.text(`${HOST}/#job/1/run/2`), `${R.DEMO_HOST}/#job/1/run/2`);
  assert.equal(clean.text(`${JANE} and ${JANE}, ${BOB}`), 'person1@example.com and person1@example.com, person2@example.com');
  assert.equal(clean.text('kept@example.com'), 'kept@example.com');
  assert.equal(clean.text(`/Workspace/Shared/x/session_${SID}/v3`), '/Workspace/Shared/x/session_1001/v3');
  assert.equal(clean.text(`${SID}|${LONG}`), '1001|1002');
  assert.equal(clean.text(SP_ID), '00000000-0000-4000-8000-aaaa00000001');
  assert.equal(clean.text(`${ASSET}77`), 'demoxxxxxxxxxxxxxxxxxxxx00000001');
  assert.equal(clean.text(`runs as ${SP_NAME} inspire-ai-implement`), 'runs as app-demo00 inspire-ai-implement');
  assert.equal(clean.text('app-access and app-config stay'), 'app-access and app-config stay');
  assert.equal(clean.text('acme_catalog.acme.trips'), 'demo_catalog.demo.trips');
  assert.equal(clean.text('12345678901 stays'), '12345678901 stays');
  assert.deepEqual(clean.value({ start_time: 1761764657000, created_at: '1761764657000', job_id: JOB_ID, n: 42 }),
    { start_time: 1761764657000, created_at: '1761764657000', job_id: 1003, n: 42 });
  assert.deepEqual(clean.value({ created_at: JANE }), { created_at: 'person1@example.com' });
});

test('the sanitizer never rewrites its own fakes, so the same id stays the same everywhere', () => {
  const clean = R.makeSanitizer({ sessionId: SID });
  const once = clean.text(`${SP_ID} ${ASSET}77 ${SID} ${JANE}`);
  assert.equal(once, '00000000-0000-4000-8000-aaaa00000001 demoxxxxxxxxxxxxxxxxxxxx00000001 1001 person1@example.com');
  assert.equal(clean.text(once), once);
  assert.deepEqual(R.showcaseLeaks({ once }), []);
});

test('the sanitizer stays fast on long runs of letters and digits', () => {
  const clean = R.makeSanitizer({ sessionId: SID });
  const blob = 'QUJDRA0K'.repeat(250000);
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const started = process.hrtime.bigint();
    assert.equal(clean.text(blob), blob);
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  assert.ok(Math.min(...times) < 2000, `sanitizing 2MB took ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
  assert.deepEqual(R.showcaseLeaks({ blob }), [], 'the leak check reads the same blob as clean');
});

test('an email with a local part longer than 64 characters is replaced whole, and the leak check still finds it', () => {
  const local = 'q'.repeat(70);
  const email = `${local}@${['corp', 'example', 'org'].join('.')}`;
  const clean = R.makeSanitizer({ sessionId: SID });
  assert.equal(clean.text(`owner ${email} wrote`), 'owner person1@example.com wrote');
  assert.equal(clean.text(`x/${email}`), 'x/person1@example.com', 'the same address keeps the same fake');
  assert.equal(R.showcaseLeaks({ owner: email }).length, 1, 'a raw over-long address is a leak');
  assert.deepEqual(R.showcaseLeaks({ owner: clean.text(email) }), []);
  assert.equal(clean.text(`${local}x`), `${local}x`, 'letters with no @ stay as they are');
});

test('the sanitizer drops workspace links and points a use case MVP at the App Inspire hosts', () => {
  const hosted = S.showcaseMvpPath('taxi', 'N01-U01');
  const clean = R.makeSanitizer({ sessionId: SID, mvpUrls: { 'N01-U01': MVP_URL }, hostedPaths: { 'N01-U01': hosted } });
  assert.deepEqual(clean.value({
    use_case_id: 'N01-U01',
    app_url: `${MVP_URL}/`,
    dashboard_url: `${HOST}/dashboardsv3/${ASSET}77/published`,
    genie_space_url: `${HOST}/genie/rooms/${ASSET}78`,
    alert_url: `${HOST}/sql/alerts-v2/9`,
    job_url: `${HOST}/#job/77`,
    message: `See ${HOST}/#job/77 for details`,
  }), {
    use_case_id: 'N01-U01',
    app_url: hosted,
    dashboard_url: hosted,
    genie_space_url: hosted,
    alert_url: '',
    job_url: '',
    message: `See ${R.DEMO_HOST}/#job/77 for details`,
  });
  assert.deepEqual(clean.value({ use_case_id: 'N01-U01', app_url: MVP_URL, dashboard_url: '' }), { use_case_id: 'N01-U01', app_url: hosted, dashboard_url: '' });
  assert.deepEqual(clean.value({ use_case_id: 'N09-U09', app_url: 'https://other-1.aws.databricksapps.com' }), { use_case_id: 'N09-U09', app_url: '' });
  assert.equal(clean.text(`${MVP_URL}/#/records`), `${hosted}#/records`);
});

test('a recording pins every time stamped during its walk to the demo time, so two walks write the same bytes, and keeps the times of its data', () => {
  const walk = (since, offset) => {
    const at = (s) => new Date(Date.parse(since) + s * 1000 + offset).toISOString();
    const rec = recorder({ recordedAt: { since, as: '2026-11-02T06:05:00.000Z' } });
    rec.addInspire({
      method: 'GET', url: '/api/inspire/implement/live?use_case_id=N01-U01', status: 200,
      body: { checked_at: at(3), polled_ms: Date.parse(at(4)), updated_at: '2026-10-25T08:00:00Z', duration_ms: 3000,
        assets: { alert: { checked_at: '2026-11-02T06:00:00Z' } } },
    });
    rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
    rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/freshness`, status: 200, body: { last_run: at(9), data_through: '2026-11-02' } });
    return rec.bundle();
  };
  const first = walk('2026-11-04T06:00:00.000Z', 0);
  const second = walk('2026-12-09T17:30:00.000Z', 777);
  assert.ok(R.showcaseFile(first).equals(R.showcaseFile(second)), 'two walks at different times write different bytes');
  const live = Object.values(first.inspire)[0].body;
  assert.equal(live.checked_at, '2026-11-02T06:05:00.000Z');
  assert.equal(live.polled_ms, Date.parse('2026-11-02T06:05:00.000Z'));
  assert.equal(live.updated_at, '2026-10-25T08:00:00Z');
  assert.equal(live.duration_ms, 3000);
  assert.equal(live.assets.alert.checked_at, '2026-11-02T06:00:00Z');
  assert.equal(first.mvps['N01-U01'].api['GET /api/freshness'].body.last_run, '2026-11-02T06:05:00.000Z');
  assert.equal(first.mvps['N01-U01'].api['GET /api/freshness'].body.data_through, '2026-11-02');
  const unpinned = recorder();
  unpinned.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  unpinned.addInspire({ method: 'GET', url: '/api/inspire/implement/live?use_case_id=N01-U01', status: 200, body: { checked_at: '2026-11-04T06:00:03.000Z' } });
  assert.equal(Object.values(unpinned.bundle().inspire)[0].body.checked_at, '2026-11-04T06:00:03.000Z');
  assert.throws(() => recorder({ recordedAt: { since: 'soon', as: '2026-11-02T06:05:00.000Z' } }), /ISO since and as/);
});

test('a recorded answer is keyed the way the demo frontend asks for it', () => {
  const rec = recorder();
  const key = rec.addInspire({
    method: 'GET',
    url: `https://inspire.example/api/inspire/implement/status?session_id=${SID}&use_case_id=N01-U01&inspire_database=acme_catalog._inspire&warehouse_id=0ece`,
    status: 200,
    body: { latest: { use_case_id: 'N01-U01', app_url: MVP_URL, notebook_path: `/Workspace/Users/${JANE}/session_${SID}/nb` } },
  });
  assert.equal(key, S.showcaseKey('GET', '/api/inspire/implement/status', { session_id: '1001', use_case_id: 'N01-U01', inspire_database: 'showcase', warehouse_id: 'showcase' }));
  const post = rec.addInspire({
    method: 'POST', url: '/api/inspire/implement/readiness', status: 200,
    postData: JSON.stringify({ session_id: SID, use_case_id: 'N01-U01', inspire_database: 'acme_catalog._inspire', warehouse_id: '0ece' }),
    body: { ok: true },
  });
  assert.equal(post, S.showcaseKey('POST', '/api/inspire/implement/readiness', {}, { session_id: '1001', use_case_id: 'N01-U01' }));
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const bundle = rec.bundle();
  assert.equal(bundle.session_id, '1001');
  assert.deepEqual(bundle.inspire[key].body.latest, {
    use_case_id: 'N01-U01', app_url: '/showcase/taxi/mvp/N01-U01/', notebook_path: '/Workspace/Users/person1@example.com/session_1001/nb',
  });
});

test('the recording keeps only the demo session, skips server errors and pages, and keeps the last answer per request', () => {
  const rec = recorder();
  rec.addInspire({
    method: 'GET', url: '/api/inspire/sessions?inspire_database=x.y&warehouse_id=w', status: 200,
    body: { sessions: [{ session_id: SID, business_name: 'NYC Taxi Operations' }, { session_id: joined('7000', '1111', '2222', '3333', '444'), business_name: 'Other Corp' }] },
  });
  assert.equal(rec.addInspire({ method: 'GET', url: '/api/inspire/feedback', status: 502, body: { error: 'down' } }), '');
  assert.equal(rec.addInspire({ method: 'GET', url: '/index.html', status: 200, body: '<html>' }), '');
  rec.addInspire({ method: 'GET', url: '/api/inspire/implement/live?use_case_id=N01-U01', status: 200, body: { state: 'RUNNING' } });
  rec.addInspire({ method: 'GET', url: '/api/inspire/implement/live?use_case_id=N01-U01', status: 200, body: { state: 'SUCCESS' } });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk', owner: 'Jane Analyst' } });
  assert.throws(() => rec.addMvp('N09-U09', { method: 'GET', url: '/api/app', status: 200, body: {} }), /N09-U09 is not in this recording/);
  const bundle = rec.bundle();
  assert.deepEqual(bundle.inspire['GET /api/inspire/sessions'].body.sessions, [{ session_id: '1001', business_name: 'NYC Taxi Operations' }]);
  assert.equal(JSON.stringify(bundle).includes('Other Corp'), false);
  assert.equal(Object.keys(bundle.inspire).some((k) => k.includes('feedback') || k.includes('index')), false);
  assert.deepEqual(bundle.inspire['GET /api/inspire/implement/live?use_case_id=N01-U01'].body, { state: 'SUCCESS' });
  assert.deepEqual(bundle.mvps['N01-U01'], { title: 'Fare desk', api: { 'GET /api/app': { status: 200, body: { title: 'Fare desk', owner: 'Demo User' } } } });
  assert.deepEqual(R.showcaseLeaks(bundle, ['Jane Analyst', 'acme_catalog']), []);
});

test('the recording never keeps an answer about another run, and keeps only the demo run in the per-run figures', () => {
  const rec = recorder();
  const OTHER = joined('7000', '1111', '2222', '3333', '444');
  assert.equal(rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${OTHER}`, status: 200, body: { results: { business_name: 'Other Corp' } } }), '');
  assert.equal(rec.addInspire({ method: 'POST', url: '/api/inspire/implement/readiness', postData: JSON.stringify({ session_id: OTHER }), status: 200, body: { ok: true } }), '');
  assert.notEqual(rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}`, status: 200, body: { results: { business_name: 'NYC Taxi Operations' } } }), '');
  rec.addInspire({
    method: 'GET', url: '/api/inspire/portfolio', status: 200,
    body: { totals: { runs: 2 }, sessions: { [SID]: { use_cases: 6 }, [OTHER]: { use_cases: 4 } } },
  });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const bundle = rec.bundle();
  assert.deepEqual(bundle.inspire['GET /api/inspire/portfolio'].body, { totals: { runs: 1, use_cases: 6, businesses: 1 }, sessions: { 1001: { use_cases: 6 } }, truncated: false });
  assert.deepEqual(Object.keys(bundle.inspire).sort(), ['GET /api/inspire/portfolio', 'GET /api/inspire/results?session_id=1001']);
  assert.equal(JSON.stringify(bundle).includes('Other Corp'), false);
  assert.deepEqual(R.onlySession({ sessions: [{ session_id: SID }, { session_id: OTHER }] }, SID), { sessions: [{ session_id: SID }] });
  assert.deepEqual(R.onlySession({ results: { x: 1 } }, SID), { results: { x: 1 } });
});

test('an answer the App sent as text stays text, with its private details replaced, and a JSON answer stays JSON', () => {
  const rec = recorder();
  const key = rec.addInspire({ method: 'GET', url: '/api/workspace/export?path=/Workspace/Shared/n01.py', status: 200, type: 'application/octet-stream',
    body: `# owner ${JANE}\nSELECT * FROM acme_catalog.s.trips` });
  rec.addInspire({ method: 'GET', url: '/api/inspire/results', status: 200, body: 'a JSON string' });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const bundle = rec.bundle();
  assert.deepEqual(bundle.inspire[key], { status: 200, body: '# owner person1@example.com\nSELECT * FROM demo_catalog.s.trips', text: true });
  assert.deepEqual(bundle.inspire['GET /api/inspire/results'], { status: 200, body: 'a JSON string' });
  assert.deepEqual(R.showcaseLeaks(bundle, ['acme_catalog']), []);
});

const bigStep = (i) => ({
  step_id: String(i), session_id: SID, last_updated: `2026-10-31T09:${String(i % 60).padStart(2, '0')}:00Z`, stage_name: 'Use Case Generation',
  step_name: `Batch ${i}`, sub_step_name: 'Pass 2', progress_increment: 1, message: `Wrote batch ${i}`, status: 'ended_success',
  result_json: {
    prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases_count: 10, is_truncated: false, prompt: 'p'.repeat(20000), response: 'r'.repeat(30000),
    use_cases: Array.from({ length: 10 }, (_, j) => ({ No: `N0${i}-U0${j}`, Name: `Use case ${i}.${j}`, 'Business Domain': 'Operations', Priority: 'High',
      Statement: 's'.repeat(600), Solution: 'o'.repeat(900), 'Business Value': 'v'.repeat(400), SQL: 'SELECT 1 '.repeat(200) })),
    sql_preview: 'SELECT trips '.repeat(500), json: { business_context: 'c'.repeat(3000), strategic_goals: ['Cut idle time'], raw: 'w'.repeat(5000) },
  },
});

test('the recording keeps from each Monitor step and from the run only what Monitor shows, so the steps shrink and still read the same', (t) => {
  const steps = Array.from({ length: 120 }, (_, i) => bigStep(i));
  const raw = { steps, count: steps.length };
  const rec = recorder();
  const key = rec.addInspire({ method: 'GET', url: `/api/inspire/steps?session_id=${SID}`, status: 200, body: raw });
  rec.addInspire({
    method: 'GET', url: `/api/inspire/session?session_id=${SID}`, status: 200,
    body: { session: { session_id: SID, processing_status: 'done', completed_percent: 100, completed_on: '2026-10-31T10:00:00Z', create_at: '2026-10-31T09:00:00Z',
      last_updated: '2026-10-31T10:00:00Z', business_name: 'NYC Taxi Operations', results_json: { domains: ['x'.repeat(200000)] }, inspire_json: { a: 'b'.repeat(50000) },
      widget_values: { discovery_type: 'Deep', strategic_context: 'Grow > Cut idle time', generation_path: `/Workspace/Users/${JANE}/out`, enriched_business_context: 'e'.repeat(9000) } } },
  });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const bundle = rec.bundle();
  const kept = bundle.inspire[key].body;
  const before = Buffer.byteLength(JSON.stringify(raw));
  const after = Buffer.byteLength(JSON.stringify(kept));
  t.diagnostic(`120 Monitor steps: ${before} bytes as the App sends them, ${after} bytes recorded`);
  assert.ok(after * 20 < before, `${after} of ${before} bytes`);
  assert.deepEqual(Object.keys(kept.steps[0]).sort(), ['last_updated', 'message', 'progress_increment', 'result_json', 'stage_name', 'status', 'step_id', 'step_name', 'sub_step_name']);
  assert.deepEqual(Object.keys(kept.steps[0].result_json).sort(), ['is_truncated', 'json', 'prompt_name', 'sql_preview', 'use_cases', 'use_cases_count']);
  assert.deepEqual(kept.steps[7].result_json.use_cases[3], { No: 'N07-U03', Name: 'Use case 7.3', 'Business Domain': 'Operations', Priority: 'High' });
  assert.equal(kept.steps[0].result_json.use_cases.length, 10, 'Monitor still counts every use case of the step');
  assert.equal(kept.steps[0].result_json.sql_preview.length, 201, 'Monitor shows 200 characters of the SQL and an ellipsis after them');
  assert.deepEqual(kept.steps[0].result_json.json, { business_context: 'c'.repeat(201), strategic_goals: ['Cut idle time'] });
  const session = bundle.inspire['GET /api/inspire/session?session_id=1001'].body.session;
  assert.deepEqual(session, { session_id: '1001', processing_status: 'done', completed_percent: 100, completed_on: '2026-10-31T10:00:00Z',
    create_at: '2026-10-31T09:00:00Z', last_updated: '2026-10-31T10:00:00Z', widget_values: { discovery_type: 'Deep', strategic_context: 'Grow > Cut idle time' } });
  assert.equal(R.showcaseSizeProblem(bundle), '');
  assert.deepEqual(R.monitorStep({ step_id: '1', result_json: null, extra: 'x' }), { step_id: '1', result_json: null });
});

test('the demo totals count the demo run alone: a workspace with 2 businesses and 3 runs records the totals of the one demo run', () => {
  const OTHER = joined('7000', '1111', '2222', '3333', '444');
  const THIRD = joined('7000', '1111', '2222', '3333', '555');
  const figures = (useCases, mvps) => ({ use_cases: useCases, domains: 2, subdomains: 3, best_of_best: 1, mvps_started: mvps, mvps_live: mvps, apps: mvps,
    dashboards: mvps, genie_spaces: mvps, alerts: mvps, live_assets: 4 * mvps });
  const body = {
    totals: { businesses: 2, runs: 3, use_cases: 21, domains: 6, subdomains: 9, best_of_best: 3, mvps_started: 4, mvps_live: 3, apps: 4, dashboards: 4, genie_spaces: 4,
      alerts: 4, live_assets: 15 },
    sessions: { [SID]: figures(6, 1), [OTHER]: figures(8, 2), [THIRD]: figures(7, 1) },
    truncated: true, missing: [],
  };
  const rec = recorder();
  rec.addInspire({ method: 'GET', url: '/api/inspire/portfolio', status: 200, body });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const shown = rec.bundle().inspire['GET /api/inspire/portfolio'].body;
  assert.deepEqual(shown.totals, { businesses: 1, runs: 1, ...figures(6, 1) });
  assert.deepEqual(Object.keys(shown.sessions), ['1001']);
  assert.equal(shown.truncated, false);
  const none = R.demoView('GET', '/api/inspire/portfolio', { totals: body.totals, sessions: { [OTHER]: figures(8, 2) } }, SID);
  assert.deepEqual(none.totals, { businesses: 1, runs: 1, use_cases: 0, domains: 0, subdomains: 0, best_of_best: 0, mvps_started: 0, mvps_live: 0, apps: 0,
    dashboards: 0, genie_spaces: 0, alerts: 0, live_assets: 0 }, 'a demo run with no figures counts nothing, never another run');
});

test('a bundle over the size cap is refused with its largest answers named, and the cap measures the compressed file the recorder writes', () => {
  const rec = recorder();
  const noise = crypto.randomBytes(Math.ceil(R.SHOWCASE_MAX_BYTES * 1.2)).toString('base64');
  rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}`, status: 200, body: { results: { text: noise } } });
  rec.addInspire({ method: 'GET', url: `/api/inspire/usecases?session_id=${SID}`, status: 200, body: { usecases: [{ id: 'N01-U01' }] } });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk', notes: 'n'.repeat(1000) } });
  const bundle = rec.bundle();
  const problem = R.showcaseSizeProblem(bundle);
  const sizes = R.showcaseSizes(bundle);
  assert.deepEqual(sizes, { json: Buffer.byteLength(R.showcaseText(bundle)), gzip: R.showcaseFile(bundle).length });
  assert.ok(sizes.gzip > R.SHOWCASE_MAX_BYTES && sizes.gzip < sizes.json, JSON.stringify(sizes));
  assert.match(problem, new RegExp(`^the demo is ${sizes.gzip} bytes compressed \\(${sizes.json} bytes of JSON\\), over the cap of ${R.SHOWCASE_MAX_BYTES} bytes; the largest answers are `
    + 'GET /api/inspire/results\\?session_id=1001 \\(\\d+ bytes\\), MVP N01-U01 GET /api/app \\(\\d+ bytes\\), GET /api/inspire/usecases'));
  assert.equal(R.showcaseSizeProblem(bundle, sizes.gzip), '', 'a bundle exactly at the cap passes');
  const repeated = recorder();
  repeated.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}`, status: 200, body: { results: { text: 'q'.repeat(R.SHOWCASE_MAX_BYTES) } } });
  repeated.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  assert.equal(R.showcaseSizeProblem(repeated.bundle()), '', 'JSON over the cap that compresses under it is kept');
  assert.equal(R.SHOWCASE_MAX_BYTES, 5000000);
});

test('a bundle without the MVP App home answer is refused, and a recording needs the session id', () => {
  assert.throws(() => recorder().bundle(), /MVP N01-U01 has no answer for GET \/api\/app/);
  assert.throws(() => recorder({ sessionId: '' }), /needs the session id/);
});

test('the leak check finds every kind of leak and passes a clean bundle', () => {
  const leaks = R.showcaseLeaks({
    a: `${HOST}/x`,
    b: JANE,
    c: `run ${SID}`,
    d: SP_ID,
    e: `${SP_NAME} inspire`,
    f: 'acme_catalog.s.t',
    [`k_${SID}`]: 1,
    start_time: 1761764657000,
    created_at: '2026-10-29T19:04:17.000Z',
  }, ['acme_catalog']);
  const kinds = leaks.map((l) => l.replace(/ in \.\.\..*/, ''));
  assert.deepEqual(kinds, [
    'bundle.a: a workspace host',
    'bundle.a: a workspace name',
    'bundle.b: an email outside example.com',
    'bundle.c: a number of 12 or more digits',
    'bundle.d: an id that is not a demo id',
    'bundle.e: an App service principal name',
    'bundle.f: the text "acme_catalog"',
    'bundle key: a number of 12 or more digits',
  ]);
  assert.deepEqual(R.showcaseLeaks({ a: R.DEMO_HOST, b: 'person1@example.com', d: '00000000-0000-4000-8000-aaaa00000001', e: 'app-demo00 x', g: 'app-access' }), []);
});

test('the leak check finds a Mac or Linux home folder and passes the demo person workspace folder', () => {
  const kinds = R.showcaseLeaks({ m: 'read /Users/jane.analyst/Downloads/x.csv', l: 'at /home/jane/run.log' }).map((l) => l.replace(/ in \.\.\..*/, ''));
  assert.deepEqual(kinds, ['bundle.m: a home folder outside /Workspace', 'bundle.l: a home folder outside /Workspace']);
  assert.deepEqual(R.showcaseLeaks({ w: '/Workspace/Users/person@example.com/inspire', s: '/Workspace/Shared/inspire-ai', v: '/Volumes/demo_catalog/s/v' }), []);
});

test('the sanitizer and the leak check cover warehouse ids, Databricks object ids and bare workspace names, and leave short hex, words and their own fakes alone', () => {
  const WAREHOUSE = joined('a1b2', 'c3d4', 'e5f6', '0718');
  const WORKSPACE = ['dbc', '1a2b3c4d', '5e6f'].join('-');
  const OBJECT = joined('01f0aabbccddeeff', '00112233aabbccdd');
  const SHA = 'ab'.repeat(32);
  const clean = R.makeSanitizer({ sessionId: SID });
  const once = clean.text(`warehouse ${WAREHOUSE} in ${WORKSPACE} serves ${OBJECT} and ${OBJECT.toUpperCase()}; commit deadbeef, facadeabcdefface and ${SHA} stay`);
  assert.equal(once, `warehouse demowhxx00000001 in demo-workspace serves demoxxxxxxxxxxxxxxxxxxxx00000001 and demoxxxxxxxxxxxxxxxxxxxx00000001; commit deadbeef, facadeabcdefface and ${SHA} stay`);
  assert.equal(clean.text(once), once, 'the fakes are never replaced again');
  assert.equal(clean.text(`/sql/warehouses/${WAREHOUSE}`), '/sql/warehouses/demowhxx00000001', 'the same warehouse keeps the same fake');
  assert.deepEqual(R.showcaseLeaks({ once }), []);
  const kinds = R.showcaseLeaks({ w: `on ${WAREHOUSE}`, o: `id ${OBJECT}`, n: `at ${WORKSPACE}`, short: 'deadbeef facadeabcdefface' }).map((l) => l.replace(/ in \.\.\..*/, ''));
  assert.deepEqual(kinds, ['bundle.w: a warehouse id', 'bundle.o: a Databricks object id', 'bundle.n: a workspace name']);
});

test('a session id and a run id that JSON rounded past safe integers are replaced, and the leak check finds them before the scrub', () => {
  const sid = '2222222222222222222';
  const answer = JSON.parse(`{"_source_session_id": ${sid}, "run_id": ${Number('5555555555555555') * 1000}}`);
  assert.equal(Number.isSafeInteger(answer._source_session_id), false, 'the agent wrote the session id as a JSON number');
  const out = R.makeSanitizer({ sessionId: sid }).value(answer);
  assert.deepEqual(out, { _source_session_id: 1001, run_id: 1002 });
  assert.deepEqual(R.showcaseLeaks(out), []);
  assert.deepEqual(R.showcaseLeaks(answer).map((l) => l.replace(/ in \.\.\..*/, '')),
    ['bundle._source_session_id: a number of 12 or more digits', 'bundle.run_id: a number of 12 or more digits'], 'the rounded ids are still leaks before the scrub');
});

test('a decimal with 12 or more digits after the point is kept as written and is never read as an id or a leak', () => {
  const baseline = Math.PI * 4;
  const answer = { baseline, note: `baseline ${baseline}`, share: -Math.E / 10 };
  assert.deepEqual(R.makeSanitizer({ sessionId: '2222222222222222222' }).value(answer), answer);
  assert.deepEqual(R.showcaseLeaks(answer), []);
});

test('the recording refuses an API answer that is not JSON and names its route, and keeps JSON answers and the notebook file download', () => {
  const page = '<!doctype html><html><body>Inspire</body></html>';
  const rec = recorder();
  assert.equal(rec.addInspire({ method: 'GET', url: `/api/inspire/portfolio`, status: 200, type: 'text/html; charset=utf-8', body: page }), '');
  assert.equal(rec.addInspire({ method: 'GET', url: `/api/inspire/implement/alerts?session_id=${SID}&use_case_id=N01-U01`, status: 200, unparsed: true, body: `  ${page}` }), '');
  assert.equal(rec.addInspire({ method: 'GET', url: '/api/inspire/implement/tables', status: 200, body: page }), '');
  assert.equal(rec.addInspire({ method: 'GET', url: '/api/workspace/export?path=/Workspace/Shared/n02.py', status: 200, type: 'text/html', body: page }), '');
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  rec.addMvp('N01-U01', { method: 'POST', url: `${MVP_URL}/api/page`, postData: JSON.stringify({ page: 'home' }), status: 200, type: 'text/plain', body: 'Not Found' });
  assert.throws(() => rec.bundle(), (e) => {
    assert.match(e.message, /answered 5 API routes with something other than JSON/);
    for (const route of ['GET /api/inspire/portfolio (text/html; charset=utf-8)', 'GET /api/inspire/implement/alerts?session_id=1001&use_case_id=N01-U01 (markup)',
      'GET /api/inspire/implement/tables (markup)', 'MVP N01-U01 POST /api/page']) {
      assert.ok(e.message.includes(route), route);
    }
    assert.match(e.message, /GET \/api\/workspace\/export\?path=[^ ]*n02\.py \(text\/html\)/);
    return true;
  });

  const good = recorder();
  assert.ok(good.addInspire({ method: 'GET', url: '/api/inspire/portfolio', status: 200, body: { totals: { runs: 1 } } }));
  const file = good.addInspire({ method: 'GET', url: '/api/workspace/export?path=/Workspace/Shared/n01.py', status: 200, type: 'application/octet-stream', body: '<b>SELECT 1</b>' });
  assert.ok(good.addInspire({ method: 'GET', url: '/api/inspire/results', status: 404, type: 'application/json; charset=utf-8', body: { error: 'none' } }));
  good.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const bundle = good.bundle();
  assert.deepEqual(Object.keys(bundle.inspire).sort(), ['GET /api/inspire/portfolio', 'GET /api/inspire/results', file]);
  assert.deepEqual(bundle.inspire[file], { status: 200, body: '<b>SELECT 1</b>', text: true });
});

test('a recorded bundle replays through the demo routes', async () => {
  const rec = recorder();
  rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}&inspire_database=acme_catalog._inspire`, status: 200, body: { results: { title: 'Taxi' } } });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  rec.addMvp('N01-U01', { method: 'POST', url: `${MVP_URL}/api/page`, postData: JSON.stringify({ page: 'home', filters: {} }), status: 200, body: { kpis: [3] } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-rec-'));
  fs.writeFileSync(path.join(dir, 'taxi.json'), JSON.stringify(rec.bundle()));
  const app = express();
  app.use(express.json());
  S.registerShowcaseRoutes(app, { dir, shellFiles: { 'static/index.html': '<html>' }, log: { error: () => {} } });
  const srv = await listen(app);
  try {
    const list = await (await fetch(`${srv.url}/api/showcase`)).json();
    assert.equal(list.showcases[0].session_id, '1001');
    const results = await fetch(`${srv.url}/api/inspire/results?session_id=1001&inspire_database=showcase&warehouse_id=showcase`, { headers: { 'X-Inspire-Showcase': 'taxi' } });
    assert.equal(results.status, 200);
    assert.deepEqual(await results.json(), { results: { title: 'Taxi' } });
    const page = await fetch(`${srv.url}/showcase/taxi/mvp/N01-U01/api/page`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: {}, page: 'home' }),
    });
    assert.deepEqual(await page.json(), { kpis: [3] });
  } finally {
    await srv.close();
  }
});

test('the recording keeps the use case fields a screen reads and leaves out the fields no screen reads, in the use cases and in the results', () => {
  const rec = recorder();
  const unread = Object.fromEntries(R.UNREAD_USE_CASE_FIELDS.map((k) => [k, `${k} text`]));
  const row = { id: 'N01-U01', use_case: 'Spot fare outliers', genie_instruction: 'Rank by fare', ...unread };
  const resultRow = { No: 'N01-U01', Name: 'Spot fare outliers', 'Tables Involved': 'samples.nyctaxi.trips', ...unread };
  rec.addInspire({ method: 'GET', url: `/api/inspire/usecases?session_id=${SID}`, status: 200, body: { usecases: [row], count: 1 } });
  rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}`, status: 200,
    body: { results: { title: 'Taxi', domains: [{ domain_name: 'Fares', use_cases: [resultRow] }, 'not a domain'] }, found: true } });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const saved = rec.bundle().inspire;
  assert.deepEqual(saved['GET /api/inspire/usecases?session_id=1001'].body,
    { usecases: [{ id: 'N01-U01', use_case: 'Spot fare outliers', genie_instruction: 'Rank by fare' }], count: 1 });
  assert.deepEqual(saved['GET /api/inspire/results?session_id=1001'].body, {
    results: { title: 'Taxi', domains: [{ domain_name: 'Fares', use_cases: [{ No: 'N01-U01', Name: 'Spot fare outliers', 'Tables Involved': 'samples.nyctaxi.trips' }] }, 'not a domain'] },
    found: true,
  });
  assert.deepEqual(R.UNREAD_USE_CASE_FIELDS, ['code_structure_mandate', 'available_tables_listing', 'directly_involved_schema', 'directly_involved_tables',
    'foreign_key_relationships', 'table_joins', 'technique_implementation_guidance', 'verified_tables', 'high_level_design', 'High Level Design', 'Technical Design']);
  const frontend = path.join(__dirname, '..', '..', 'frontend', 'src');
  const source = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? source(path.join(dir, e.name))
    : /\.(jsx?|mjs)$/.test(e.name) ? [fs.readFileSync(path.join(dir, e.name), 'utf8')] : []));
  const text = source(frontend).join('\n');
  assert.deepEqual(R.UNREAD_USE_CASE_FIELDS.filter((k) => text.includes(k)), [], 'no screen of the App names a field the recording leaves out');
});

test('the history answer of a demo carries no error about the access of whoever recorded it, and keeps the notebook run', () => {
  const rec = recorder();
  rec.addInspire({ method: 'GET', url: `/api/inspire/implement/history?session_id=${SID}`, status: 200,
    body: { history: [], latest: [], notebook_run: { run_id: 7 }, notebook_run_error: 'Listing the Genie Code notebook jobs failed (403): no jobs scope' } });
  rec.addInspire({ method: 'GET', url: `/api/inspire/implement/history?session_id=${SID}&use_case_id=N01-U01`, status: 200, body: { history: [] } });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  const saved = rec.bundle().inspire;
  assert.deepEqual(saved['GET /api/inspire/implement/history?session_id=1001'].body, { history: [], latest: [], notebook_run: { run_id: 7 }, notebook_run_error: '' });
  assert.deepEqual(saved['GET /api/inspire/implement/history?session_id=1001&use_case_id=N01-U01'].body, { history: [] });
});

test('a replaced name is replaced, and caught by the leak check, also where a step message spells its underscores as spaces', () => {
  const clean = R.makeSanitizer({ replace: { acme_lake: 'demo_catalog', 'Jane Analyst': 'Demo User' } });
  assert.equal(clean.text('In progress: acme lake. inspire, then acme_lake._inspire, by Jane Analyst'),
    'In progress: demo catalog. inspire, then demo_catalog._inspire, by Demo User');
  const bundle = { title: 'Taxi', steps: [{ sub_step_name: 'In progress: acme lake. inspire' }] };
  assert.equal(R.showcaseLeaks(bundle, ['acme_lake']).length, 1);
  assert.match(R.showcaseLeaks(bundle, ['acme_lake'])[0], /the text "acme lake"/);
  assert.deepEqual(R.showcaseLeaks({ title: 'Taxi', steps: [{ sub_step_name: clean.text('In progress: acme lake. inspire') }] }, ['acme_lake']), []);
});

test('the recording refuses build steps whose payload the App sent as JSON text, as an older App does, with one plain message, and keeps object payloads', () => {
  const status = (useCaseId, resultJson) => ({ method: 'GET', url: `/api/inspire/implement/status?session_id=${SID}&use_case_id=${useCaseId}`, status: 200,
    body: { latest: null, steps: [{ step_name: 'Build', result_json: resultJson }] } });
  const app = { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } };
  const old = recorder();
  old.addInspire(status('N01-U01', '{"phase": "Plan", "spec_version": 2}'));
  old.addInspire(status('N02-U01', ' [1]'));
  old.addMvp('N01-U01', app);
  assert.throws(() => old.bundle(), (err) => err.message === 'the App sent the build steps of 2 answers as JSON text inside JSON, as an App older than this build does, '
    + 'so the demo would show no build stages; install this build first: GET /api/inspire/implement/status?session_id=1001&use_case_id=N01-U01, '
    + 'GET /api/inspire/implement/status?session_id=1001&use_case_id=N02-U01');
  const current = recorder();
  current.addInspire(status('N01-U01', { phase: 'Plan', spec_version: 2 }));
  current.addInspire(status('N02-U01', 'the step wrote no JSON'));
  current.addMvp('N01-U01', app);
  const kept = current.bundle().inspire;
  assert.deepEqual(kept['GET /api/inspire/implement/status?session_id=1001&use_case_id=N01-U01'].body.steps[0].result_json, { phase: 'Plan', spec_version: 2 });
  assert.equal(kept['GET /api/inspire/implement/status?session_id=1001&use_case_id=N02-U01'].body.steps[0].result_json, 'the step wrote no JSON',
    'text that is not JSON is a payload as written');
});

test('every recorded answer replays byte for byte the same from the compressed demo file and from its raw JSON', async () => {
  const rec = recorder();
  rec.addInspire({ method: 'GET', url: `/api/inspire/results?session_id=${SID}`, status: 200, body: { results: { title: 'Taxi', fares: [12.5, 9], note: 'caf\u00e9 \u2192 ok' } } });
  rec.addInspire({ method: 'GET', url: `/api/inspire/session?session_id=${SID}`, status: 404, body: { error: 'no session' } });
  rec.addInspire({ method: 'POST', url: '/api/inspire/implement/plan', postData: JSON.stringify({ session_id: SID, spec: { use_case_id: 'N01-U01' } }), status: 200, body: { plan: ['notebook'] } });
  rec.addInspire({ method: 'GET', url: '/api/workspace/export?path=%2FWorkspace%2Fdemo%2Fn01.py', status: 200, type: 'text/plain', body: 'print("fares")\n' });
  rec.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Fare desk' } });
  rec.addMvp('N01-U01', { method: 'POST', url: `${MVP_URL}/api/records`, postData: JSON.stringify({ page: 'home', filters: { zone: ['JFK'] } }), status: 200, body: { rows: [{ zone: 'JFK', fare: 61 }] } });
  const bundle = rec.bundle();
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-raw-'));
  const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-gz-'));
  fs.writeFileSync(path.join(raw, 'taxi.json'), R.showcaseText(bundle));
  fs.writeFileSync(path.join(packed, 'taxi.json.gz'), R.showcaseFile(bundle));
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(packed, 'taxi.json.gz'))).toString('utf8'), R.showcaseText(bundle));
  const serve = async (dir) => {
    const app = express();
    app.use(express.json());
    S.registerShowcaseRoutes(app, { dir, shellFiles: { 'static/index.html': '<html>' }, log: { error: (m) => { throw new Error(m); } } });
    return listen(app);
  };
  const ask = async (base, where, key) => {
    const method = key.slice(0, key.indexOf(' '));
    const rest = key.slice(key.indexOf(' ') + 1);
    const at = rest.indexOf(' ');
    const target = at < 0 ? rest : rest.slice(0, at);
    const body = at < 0 ? undefined : rest.slice(at + 1);
    const resp = await fetch(`${base}${where}${target}`, { method, headers: { 'X-Inspire-Showcase': 'taxi', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
    return { status: resp.status, type: resp.headers.get('content-type'), bytes: Buffer.from(await resp.arrayBuffer()).toString('base64') };
  };
  const a = await serve(raw);
  const b = await serve(packed);
  try {
    const routes = [...Object.keys(bundle.inspire).map((k) => ['', k]), ...Object.keys(bundle.mvps['N01-U01'].api).map((k) => ['/showcase/taxi/mvp/N01-U01', k])];
    assert.equal(routes.length, 6);
    for (const [where, key] of routes) {
      const fromRaw = await ask(a.url, where, key);
      const fromPacked = await ask(b.url, where, key);
      assert.deepEqual(fromPacked, fromRaw, key);
      const saved = where ? bundle.mvps['N01-U01'].api[key] : bundle.inspire[key];
      assert.equal(fromRaw.status, saved.status, `${key} replayed its own answer`);
    }
    const listed = [await (await fetch(`${a.url}/api/showcase`)).json(), await (await fetch(`${b.url}/api/showcase`)).json()];
    assert.deepEqual(listed[1], listed[0]);
  } finally {
    await a.close();
    await b.close();
  }
  const both = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-both-'));
  fs.writeFileSync(path.join(both, 'taxi.json'), R.showcaseText(bundle));
  fs.writeFileSync(path.join(both, 'taxi.json.gz'), R.showcaseFile(bundle));
  assert.throws(() => S.loadShowcases(both), /the demo taxi is saved twice, as taxi\.json and taxi\.json\.gz; keep one/);
  fs.writeFileSync(path.join(packed, 'taxi.json.gz'), 'not gzip');
  assert.throws(() => S.loadShowcases(packed), /the demo taxi\.json\.gz is not gzip-compressed JSON: /);
});
