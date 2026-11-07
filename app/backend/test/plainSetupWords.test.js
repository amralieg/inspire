const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { unreachableMessage } = require('../lib/unreachable');

const APP = path.join(__dirname, '..', '..');
const DEV_WORDS = /npm run|\.env\b|app\.yaml|DATABRICKS_(HOST|TOKEN)|INSPIRE_DATABASE\b/;
const comment = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sources(full);
  return /\.jsx$/.test(entry.name) ? [full] : [];
});

test('a deployed App that cannot reach its workspace says so in plain words, never .env, VPN or npm', () => {
  const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const said = unreachableMessage('https://workspace.example.com', err, true);
  assert.equal(said, 'Cannot reach the Databricks workspace (fetch failed; ENOTFOUND). The workspace did not answer. Try again in a minute; if it keeps happening, ask a workspace admin to check that this App can reach the workspace.');
  assert.doesNotMatch(said, DEV_WORDS);
});

test('a local run keeps the developer hint with the host it tried (must-exclude)', () => {
  const said = unreachableMessage('http://127.0.0.1:9', new Error('fetch failed'), false);
  assert.match(said, /^Cannot reach Databricks at http:\/\/127\.0\.0\.1:9 \(fetch failed\)\. Check DATABRICKS_HOST in \.env/);
  assert.match(said, /npm run verify:databricks/);
});

test('no page tells a person to edit .env, app.yaml or run npm', () => {
  const hits = sources(path.join(APP, 'frontend', 'src')).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .map((line, i) => (DEV_WORDS.test(line) && !comment(line) && !/\.includes\(/.test(line) && /['"`>]/.test(line) ? `${path.relative(APP, file)}:${i + 1}: ${line.trim()}` : ''))
    .filter(Boolean));
  assert.deepEqual(hits, []);
  const pipeline = fs.readFileSync(path.join(APP, 'backend', 'lib', 'demoDataPipeline.js'), 'utf8');
  assert.doesNotMatch(pipeline, /npm run deploy/);
  const server = fs.readFileSync(path.join(APP, 'backend', 'server.js'), 'utf8');
  assert.match(server, /throw new Error\(unreachableMessage\(host, e, policyEnforced\(\)\)\)/);
});

const RESULT_WORDS = /\bcolours?\b|Execution Complete|elite test|\baggregates\b/;
const pageSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return pageSources(full);
  return /\.jsx?$/.test(entry.name) ? [full] : [];
});

test('pages say Run finished, summary figures, Best of Best check and color, never Execution Complete, aggregates, elite test or colour', () => {
  const hits = pageSources(path.join(APP, 'frontend', 'src')).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .map((line, i) => (RESULT_WORDS.test(line) && !comment(line) ? `${path.relative(APP, file)}:${i + 1}: ${line.trim()}` : ''))
    .filter(Boolean));
  assert.deepEqual(hits, []);
  for (const fine of ['aiSeesAggregates(discovery)', 'colorScheme', 'Run finished']) assert.doesNotMatch(fine, RESULT_WORDS);
  for (const bad of ['read aggregates from', 'a colour line', 'Execution Complete', 'Passed every elite test.']) assert.match(bad, RESULT_WORDS);
});

const EXPERIMENT_WORD = /['"`>][^'"`<{]*\b[Ee]xperiments?\b/;

test('Start and Get Started call a discovery a run, never an experiment or a session', () => {
  const hits = ['ChoosePage.jsx', 'LaunchPage.jsx'].flatMap((name) => fs.readFileSync(path.join(APP, 'frontend', 'src', 'pages', name), 'utf8').split('\n')
    .map((line, i) => ((EXPERIMENT_WORD.test(line) || /load sessions|session tracking/.test(line)) && !comment(line) ? `${name}:${i + 1}: ${line.trim()}` : ''))
    .filter(Boolean));
  assert.deepEqual(hits, []);
  for (const fine of ['onClick={onNewExperiment} title="I have data"', "setExperimentsOverviewExpanded((v) => !v)"]) assert.doesNotMatch(fine, EXPERIMENT_WORD);
  for (const bad of ['title="Delete experiment"', '>Previous Experiments</h2>', "'No experiments yet.'"]) assert.match(bad, EXPERIMENT_WORD);
});
