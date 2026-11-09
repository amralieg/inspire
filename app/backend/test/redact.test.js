const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');
const { redactSecrets, redactedText } = require('../lib/redact');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, 'scripts');
const FAKE_JWT = ['eyJ' + 'hbGciOiJub25lIn0', 'eyJzdWIiOiJmYWtlLXVzZXIifQ', 'ZmFrZS1zaWduYXR1cmU'].join('.');
const FAKE_PAT = `dapi${'0123456789abcdef'.repeat(2)}`;
const FAKE_COOKIE = 'session=fake-cookie-value-123';
const SECRETS = [FAKE_JWT, FAKE_PAT, FAKE_COOKIE, 'fake-cookie-value-123', 'fake-org-secret'];

const callLog = () => [
  'apiRequestContext.fetch: read ECONNRESET',
  'Call log:',
  '  - → GET https://inspire.example/api/inspire/results?session_id=1',
  `    - Authorization: Bearer ${FAKE_JWT}`,
  `    - cookie: ${FAKE_COOKIE}`,
  '  - ← 200 OK',
  `    - set-cookie: ${FAKE_COOKIE}; Path=/; HttpOnly`,
  '    - x-databricks-org-id: fake-org-secret',
  `    - x-forwarded-access-token: ${FAKE_PAT}`,
].join('\n');

const leaked = (text) => SECRETS.filter((s) => text.includes(s));

test('redactSecrets hides every token header and token string a request, response or error can carry, and keeps the rest', () => {
  const text = redactSecrets(callLog());
  assert.deepEqual(leaked(text), []);
  assert.match(text, /Authorization: \[redacted\]/);
  assert.match(text, /set-cookie: \[redacted\]/);
  assert.match(text, /x-databricks-org-id: \[redacted\]/);
  assert.match(text, /GET https:\/\/inspire\.example\/api\/inspire\/results\?session_id=1/, 'the request line stays readable (must-exclude: no over-redaction)');
  const headers = { Authorization: `Bearer ${FAKE_JWT}`, Cookie: FAKE_COOKIE, 'Set-Cookie': [FAKE_COOKIE], 'X-Databricks-Org-Id': 'fake-org-secret', accept: 'application/json' };
  const inspected = redactedText('request', { headers });
  assert.deepEqual(leaked(inspected), []);
  assert.match(inspected, /accept: 'application\/json'/);
  assert.deepEqual(leaked(redactedText(new Error(`token=${FAKE_PAT} and ${FAKE_JWT.split('.')[0]}${FAKE_JWT.split('.')[1]}`))), []);
  assert.equal(redactSecrets('[record] Review: opened 15 of 15 use cases'), '[record] Review: opened 15 of 15 use cases');
  assert.equal(redactSecrets('Authorization failed for this user'), 'Authorization failed for this user', 'a word is not a header (must-exclude)');
});

const TALKS = /\bfetch\(|'auth', 'token'|Authorization|chromium|DATABRICKS_TOKEN/;
const ENTRY_SCRIPTS = fs.readdirSync(SCRIPTS).filter((f) => /\.m?js$/.test(f)).filter((f) => {
  const text = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
  return text.startsWith('#!/usr/bin/env node') && TALKS.test(text);
});

test('every runnable script under app/scripts that reads a token, sends a request or drives a browser routes its console and its crashes through the one redact helper', () => {
  assert.deepEqual(ENTRY_SCRIPTS, ['offline-walk.mjs', 'record-kinds-showcase.mjs', 'record-showcase.mjs', 'verify-app-ui.mjs', 'verify-local-databricks.mjs']);
  const bare = ENTRY_SCRIPTS.filter((f) => !/\bredactOutput\(\)/.test(fs.readFileSync(path.join(SCRIPTS, f), 'utf8')));
  assert.deepEqual(bare, []);
});

function crash(script, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-redact-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const preload = path.join(dir, 'crash.cjs');
  fs.writeFileSync(preload, [
    "const cp = require('node:child_process');",
    "const { syncBuiltinESMExports } = require('node:module');",
    `cp.execFileSync = () => { const err = new Error(${JSON.stringify(callLog())}); err.headers = { Authorization: ${JSON.stringify(`Bearer ${FAKE_JWT}`)}, cookie: ${JSON.stringify(FAKE_COOKIE)} }; throw err; };`,
    'syncBuiltinESMExports();',
  ].join('\n'));
  try {
    const run = spawnSync(process.execPath, ['--require', preload, path.join(SCRIPTS, script)], {
      cwd: APP, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, INSPIRE_URL: 'http://127.0.0.1:9', DATABRICKS_PROFILE: 'fake', SESSION_ID: '1', SHOWCASE_ID: 'fake', SHOWCASE_TITLE: 'Fake', OUT: path.join(dir, 'out'), DIST: dist, ...env },
    });
    return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const script of ['record-showcase.mjs', 'offline-walk.mjs']) {
  test(`${script} crashes with an error that carries a bearer token, a cookie and a token header, and prints none of them`, () => {
    const { status, output } = crash(script);
    assert.equal(status, 1, 'the crash still fails the run');
    assert.match(output, /apiRequestContext\.fetch: read ECONNRESET/, 'the crash still says what failed');
    assert.deepEqual(leaked(output), []);
  });
}

test('the hosted run keeps its own long-string rule on top of the shared one', () => {
  const { redactSecrets: hosted } = require('../lib/hostedRun');
  assert.equal(hosted(`key ${'A'.repeat(48)} end`), 'key [redacted] end');
  assert.equal(redactSecrets(`key ${'A'.repeat(48)} end`), `key ${'A'.repeat(48)} end`, 'only the hosted run hides long strings');
  assert.deepEqual(leaked(hosted(callLog())), []);
  assert.equal(util.isDeepStrictEqual(hosted('plain'), 'plain'), true);
});
