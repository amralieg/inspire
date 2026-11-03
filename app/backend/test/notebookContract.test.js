const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  GENIE_CODE_DEFAULT_COUNT,
  INSPIRE_AGENT_VERSION,
  INSPIRE_NOTEBOOK_WIDGET_KEYS,
} = require('../lib/inspireJobParams');

const appRoot = path.resolve(__dirname, '..', '..');
const notebookPath = path.join(appRoot, 'dbx_inspire_ai_agent.ipynb');
const notebookBytes = fs.readFileSync(notebookPath);
const notebook = JSON.parse(notebookBytes.toString('utf8'));
const source = notebook.cells.map((cell) => (cell.source || []).join('')).join('\n');

test(`bundled notebook is a valid ${INSPIRE_AGENT_VERSION} Jupyter notebook`, () => {
  assert.equal(notebook.nbformat, 4);
  assert.match(source, new RegExp(`__AGENT_VERSION__\\s*=\\s*["']${INSPIRE_AGENT_VERSION}["']`));
  assert.match(source, /\[AGENT_VERSION FIRED\]/);
  assert.match(source, /USE_CASES_QUALITY_VALID\s*=\s*\(\s*"Good",\s*"High",\s*"Ultra High"\s*\)/);
  assert.match(source, /"weasyprint":\s*\(\s*"weasyprint",\s*"pydyf"/);
  assert.doesNotMatch(source, /discover_auto_genie_top_n/);
  assert.match(source, /dbx_inspire_ai_child_run/);
  assert.match(source, /funnel_ledger/);
  assert.match(source, /DISCOVERY_TYPE_VALID\s*=\s*\(\s*"Deep",\s*"Standard"\s*\)/);
  assert.match(source, /DISCOVERY_TYPE_DEFAULT\s*=\s*"Deep"/);
  assert.equal(GENIE_CODE_DEFAULT_COUNT, '0');
  assert.match(source, new RegExp(`GENIE_CODE_DEFAULT_COUNT\\s*=\\s*"${GENIE_CODE_DEFAULT_COUNT}"`));
  assert.match(source, /"13_generate_genie_code_for", GENIE_CODE_DEFAULT_COUNT,/);
  assert.match(source, /FEEDBACK_STATUSES\s*=\s*\(\s*"accepted",\s*"rejected",\s*"planned",\s*"implemented"\s*\)/);
  assert.equal(notebook.cells.length, 3);
});

test('backend widget allowlist matches the notebook contract', () => {
  const match = source.match(/_NOTEBOOK_WIDGET_NAMES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, '_NOTEBOOK_WIDGET_NAMES must exist');
  const notebookKeys = [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
  assert.deepEqual(notebookKeys, INSPIRE_NOTEBOOK_WIDGET_KEYS);
});

test('v1.2.0 generation widget only offers PDF and Presentation', () => {
  assert.match(source, /dbutils\.widgets\.multiselect\(\s*"09_generation_options"/);
  assert.doesNotMatch(source, /dbutils\.widgets\.multiselect\(\s*"09_generation_options"[\s\S]{0,400}Genie Code Instructions/);
});

test('embedded backend fallback is byte-identical to the physical notebook', () => {
  const embedded = Buffer.from(require('../notebook_bundle'), 'base64');
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(embedded), sha(notebookBytes), 'notebook_bundle.js is not the bundled notebook; run npm run bundle:agent-notebook');
  assert.equal(embedded.length, notebookBytes.length);
});

test('the notebook the App launches and its embedded fallback are the agent notebook, byte for byte', () => {
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const agentBytes = fs.readFileSync(path.join(appRoot, 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'));
  const embedded = Buffer.from(require('../notebook_bundle'), 'base64');
  const fix = 'run npm run bundle:agent-notebook in app/';
  assert.equal(sha(notebookBytes), sha(agentBytes), `app/dbx_inspire_ai_agent.ipynb is not app/agent/agent/dbx_inspire_ai_agent.ipynb; ${fix}`);
  assert.equal(sha(embedded), sha(agentBytes), `backend/notebook_bundle.js is not app/agent/agent/dbx_inspire_ai_agent.ipynb; ${fix}`);
});

test('bundle:agent-notebook copies the agent notebook over a drifted App copy and embeds it, and refuses without the agent notebook', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nbsync-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'backend'));
    fs.copyFileSync(path.join(appRoot, 'scripts', 'bundle-agent-notebook.mjs'), path.join(tmp, 'scripts', 'bundle-agent-notebook.mjs'));
    const run = () => execFileSync(process.execPath, [path.join(tmp, 'scripts', 'bundle-agent-notebook.mjs')], { stdio: 'pipe' });
    const copy = path.join(tmp, 'dbx_inspire_ai_agent.ipynb');
    const bundle = path.join(tmp, 'backend', 'notebook_bundle.js');
    fs.writeFileSync(copy, '{"cells": []}');
    assert.throws(run, 'with no agent notebook nothing is bundled');
    assert.equal(fs.existsSync(bundle), false);
    const latest = Buffer.from('{"cells": ["__AGENT_VERSION__ = \\"9.9.9\\""]}\n');
    fs.mkdirSync(path.join(tmp, 'agent', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), latest);
    for (const start of ['a drifted copy', 'no copy', 'a current copy']) {
      if (start === 'no copy') fs.rmSync(copy);
      run();
      assert.ok(fs.readFileSync(copy).equals(latest), `${start}: the App copy is the agent notebook`);
      const embedded = Buffer.from(require(bundle), 'base64');
      delete require.cache[require.resolve(bundle)];
      assert.ok(embedded.equals(latest), `${start}: the embedded fallback is the agent notebook`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('launch UI exposes v1.2.0 quality modes and Auto-Genie widget 13', () => {
  const launchPage = fs.readFileSync(
    path.join(appRoot, 'frontend', 'src', 'pages', 'LaunchPage.jsx'),
    'utf8',
  );
  assert.doesNotMatch(launchPage, /key:\s*['"]Genie Code Instructions['"]/);
  assert.doesNotMatch(launchPage, /discover_auto_genie_top_n/);
  assert.match(launchPage, /'09_generation_options':\s*'PDF Catalog'/);
  assert.match(
    launchPage,
    /QUALITY_OPTIONS\s*=\s*\['Good', 'High', 'Ultra High'\]/,
  );
  assert.match(launchPage, /'05_use_cases_quality':\s*'Good'/);
  assert.match(launchPage, /'13_generate_genie_code_for':\s*'0'/);
  const afterDemo = fs.readFileSync(path.join(appRoot, 'dbx_inspire_after_demo.py'), 'utf8');
  assert.match(afterDemo, /"13_generate_genie_code_for":\s*"0"/);
  assert.match(launchPage, /'03_discovery_type':\s*'Deep'/);
  assert.match(launchPage, /'10_strategic_context':\s*''/);
  assert.match(launchPage, /Discovery Type/);
  assert.match(launchPage, /StrategyEditor/);
});

test(`deployment and API surfaces advertise ${INSPIRE_AGENT_VERSION} consistently`, () => {
  const server = fs.readFileSync(path.join(appRoot, 'backend', 'server.js'), 'utf8');
  const bundleConfig = fs.readFileSync(path.join(appRoot, 'databricks.yml'), 'utf8');

  const jobParams = fs.readFileSync(path.join(appRoot, 'backend', 'lib', 'inspireJobParams.js'), 'utf8');

  assert.match(server, /agentVersion:\s*INSPIRE_AGENT_VERSION/);
  assert.match(server, /tags:\s*inspireJobTags\(/);
  assert.match(jobParams, /inspire_version:\s*INSPIRE_AGENT_VERSION/);
  assert.match(bundleConfig, new RegExp(`inspire_version:\\s*"${INSPIRE_AGENT_VERSION.replace(/\./g, '\\.')}"`));
});

test('all app launch defaults use the installer notebook destination', () => {
  const canonicalPath = '/Shared/inspire-ai/dbx_inspire_ai_agent';
  const installer = fs.readFileSync(path.join(appRoot, 'installer', 'inspire_setup.py'), 'utf8');
  assert.match(installer, /notebook_dest = f"\/Shared\/\{app_name\}\/dbx_inspire_ai_agent"/);
  const files = [
    'backend/lib/demoDataPipeline.js',
    'databricks.yml',
    'dbx_inspire_after_demo.py',
    'frontend/src/App.jsx',
    'frontend/src/pages/ConfigPage.jsx',
    'frontend/src/pages/GenerateDataPage.jsx',
  ];

  for (const relativePath of files) {
    const contents = fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
    assert.ok(contents.includes(canonicalPath), `${relativePath} must use ${canonicalPath}`);
  }
  const server = fs.readFileSync(path.join(appRoot, 'backend', 'server.js'), 'utf8');
  assert.match(server, /\/Shared\/inspire-ai\/dbx_inspire_ai_agent/);
});

test('OpenAPI documents v1.2.0 operation and artifact values', () => {
  const openapi = fs.readFileSync(path.join(appRoot, 'backend', 'openapi.yaml'), 'utf8');
  assert.match(openapi, /enum: \[Discover Use Cases, Generate Use Cases\]/);
  assert.match(openapi, /enum: \[Good, High, Ultra High\]/);
  assert.doesNotMatch(openapi, /operation_mode:\s*full/);
  assert.doesNotMatch(openapi, /generate_choices:\s*genie,pdf/);
  assert.match(openapi, /03_discovery_type:[\s\S]{0,800}enum: \[Deep, Standard\]/);
  assert.match(openapi, /10_strategic_context:/);
  assert.match(openapi, /\/api\/inspire\/feedback:\n    post:[\s\S]*?\n    get:/);
  assert.match(openapi, /enum: \[accepted, rejected, planned, implemented\]/);
});
