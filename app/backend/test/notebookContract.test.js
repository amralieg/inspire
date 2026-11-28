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
const { DISCOVERY_STANDARD, DISCOVERY_AI_ENHANCED, DISCOVERY_TYPE_ALIASES } = require('../../frontend/src/lib/discoveryType.js');

const appRoot = path.resolve(__dirname, '..', '..');
const notebookPath = path.join(appRoot, 'dbx_inspire_ai_agent.ipynb');
const notebookBytes = fs.readFileSync(notebookPath);
const notebook = JSON.parse(notebookBytes.toString('utf8'));
const source = notebook.cells.map((cell) => (cell.source || []).join('')).join('\n');

test(`bundled notebook is a valid ${INSPIRE_AGENT_VERSION} Jupyter notebook`, () => {
  // REQ-103: the App sends the reporting currency and its rates; the notebook must define both widgets to accept them.
  assert.match(source, /dbutils\.widgets\.text\(\s*_name,\s*""/, 'widgets are created by name, with empty defaults');
  assert.match(source, /\("currency", "Reporting currency \(ISO code\)"\)/);
  assert.match(source, /\("currency_rates", "Reporting currency rates \(JSON\)"\)/);
  assert.match(source, /\("currency_default", "Reporting currency is the default \(true\/false\)"\)/);
  assert.ok(INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('currency') && INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('currency_rates'));
  assert.equal(notebook.nbformat, 4);
  assert.match(source, new RegExp(`__AGENT_VERSION__\\s*=\\s*["']${INSPIRE_AGENT_VERSION}["']`));
  assert.match(source, /\[AGENT_VERSION FIRED\]/);
  assert.match(source, /USE_CASES_QUALITY_VALID\s*=\s*\(\s*"Good",\s*"High",\s*"Ultra High"\s*\)/);
  assert.doesNotMatch(source, /weasyprint|pydyf/, 'the agent installs no PDF writer (FX-116)');
  assert.doesNotMatch(source, /discover_auto_genie_top_n/);
  assert.match(source, /dbx_inspire_ai_child_run/);
  assert.match(source, /funnel_ledger/);
  assert.match(source, new RegExp(`DISCOVERY_STANDARD\\s*=\\s*"${DISCOVERY_STANDARD}"`));
  assert.match(source, new RegExp(`DISCOVERY_AI_ENHANCED\\s*=\\s*"${DISCOVERY_AI_ENHANCED}"`));
  assert.match(source, /DISCOVERY_TYPE_VALID\s*=\s*\(DISCOVERY_STANDARD, DISCOVERY_AI_ENHANCED\)/);
  assert.match(source, /DISCOVERY_TYPE_DEFAULT\s*=\s*DISCOVERY_STANDARD\n/);
  const aliases = source.match(/DISCOVERY_TYPE_ALIASES\s*=\s*\{([\s\S]*?)\}/)[1];
  const notebookAliases = Object.fromEntries([...aliases.matchAll(/"([^"]+)":\s*(DISCOVERY_\w+)/g)]
    .map(([, legacy, mode]) => [legacy, mode === 'DISCOVERY_STANDARD' ? DISCOVERY_STANDARD : DISCOVERY_AI_ENHANCED]));
  assert.deepEqual(notebookAliases, DISCOVERY_TYPE_ALIASES, 'the App and the notebook map the same legacy values');
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

test('the notebook has no generation widget: no 09_generation_options widget, no document formats list (FX-116)', () => {
  assert.doesNotMatch(source, /09_generation_options/);
  assert.doesNotMatch(source, /generation_options\s*=\s*\[/);
  assert.equal(INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('09_generation_options'), false);
});

const AGENT_APP_FILES = ['inspire_discover.ipynb', 'inspire_generate.ipynb', 'inspire_lib.py'];

test('the notebooks and lib the App launches are the agent files, byte for byte', () => {
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  for (const name of AGENT_APP_FILES) {
    const appBytes = fs.readFileSync(path.join(appRoot, name));
    const agentBytes = fs.readFileSync(path.join(appRoot, 'agent', 'agent', name));
    assert.equal(sha(appBytes), sha(agentBytes), `app/${name} is not app/agent/agent/${name}; run npm run bundle:agent-notebook in app/`);
  }
});

test('bundle:agent-notebook copies the agent files over drifted App copies, and refuses without the agent files', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nbsync-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.copyFileSync(path.join(appRoot, 'scripts', 'bundle-agent-notebook.mjs'), path.join(tmp, 'scripts', 'bundle-agent-notebook.mjs'));
    const run = () => execFileSync(process.execPath, [path.join(tmp, 'scripts', 'bundle-agent-notebook.mjs')], { stdio: 'pipe' });
    const copies = AGENT_APP_FILES.map((name) => path.join(tmp, name));
    for (const copy of copies) fs.writeFileSync(copy, '{"cells": []}');
    assert.throws(run, 'with no agent files nothing is copied');
    for (const copy of copies) assert.equal(fs.readFileSync(copy, 'utf8'), '{"cells": []}');
    const latest = Buffer.from('{"cells": ["__AGENT_VERSION__ = \\"9.9.9\\""]}\n');
    fs.mkdirSync(path.join(tmp, 'agent', 'agent'), { recursive: true });
    for (const name of AGENT_APP_FILES) fs.writeFileSync(path.join(tmp, 'agent', 'agent', name), latest);
    for (const start of ['a drifted copy', 'no copy', 'a current copy']) {
      if (start === 'no copy') for (const copy of copies) fs.rmSync(copy);
      run();
      for (const copy of copies) assert.ok(fs.readFileSync(copy).equals(latest), `${start}: the App copy of ${path.basename(copy)} is the agent file`);
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
  assert.doesNotMatch(launchPage, /09_generation_options/);
  assert.match(
    launchPage,
    /QUALITY_OPTIONS\s*=\s*\['Good', 'High', 'Ultra High'\]/,
  );
  assert.match(launchPage, /'05_use_cases_quality':\s*'Good'/);
  assert.match(launchPage, /'13_generate_genie_code_for':\s*'0'/);
  const afterDemo = fs.readFileSync(path.join(appRoot, 'dbx_inspire_after_demo.py'), 'utf8');
  assert.match(afterDemo, /"13_generate_genie_code_for":\s*"0"/);
  assert.match(launchPage, /'03_discovery_type':\s*DISCOVERY_RECOMMENDED/);
  assert.doesNotMatch(launchPage, /'03_discovery_type':\s*DISCOVERY_TYPE_DEFAULT/);
  assert.match(launchPage, /'10_strategic_context':\s*''/);
  assert.match(launchPage, /Discovery Type/);
  assert.match(launchPage, /StrategyEditor/);
});

test(`deployment and API surfaces advertise ${INSPIRE_AGENT_VERSION} consistently`, () => {
  const server = fs.readFileSync(path.join(appRoot, 'backend', 'server.js'), 'utf8');
  const bundleConfig = fs.readFileSync(path.join(appRoot, 'databricks.yml'), 'utf8');

  const jobParams = fs.readFileSync(path.join(appRoot, 'backend', 'lib', 'inspireJobParams.js'), 'utf8');

  assert.match(server, /agentVersion:\s*inspireReleaseLabel\(\)/);
  assert.match(server, /tags:\s*inspireJobTags\(/);
  assert.match(jobParams, /inspire_version:\s*INSPIRE_AGENT_VERSION/);
  assert.match(bundleConfig, new RegExp(`inspire_version:\\s*"${INSPIRE_AGENT_VERSION.replace(/\./g, '\\.')}"`));
});

test('all app launch defaults use the installer notebook destination', () => {
  const canonicalPath = '/Shared/inspire-ai/inspire_discover';
  const installer = fs.readFileSync(path.join(appRoot, 'installer', 'inspire_setup.py'), 'utf8');
  assert.match(installer, /notebook_dest = f"\{ctx\['APP_FOLDER'\]\}\/inspire_discover"/);
  assert.match(installer, /"APP_FOLDER": f"\/Shared\/\{app_name\}"/, 'the default install folder is /Shared/<app>');
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
    assert.ok(contents.includes(canonicalPath) || contents.includes('/Shared/inspire-ai/${AGENT_NOTEBOOKS.discover}'), `${relativePath} must use ${canonicalPath}`);
  }
  const server = fs.readFileSync(path.join(appRoot, 'backend', 'server.js'), 'utf8');
  assert.match(server, /\/Shared\/inspire-ai\/\$\{AGENT_NOTEBOOKS\.discover\}/);
});

test('OpenAPI documents v1.2.0 operation and artifact values', () => {
  const openapi = fs.readFileSync(path.join(appRoot, 'backend', 'openapi.yaml'), 'utf8');
  assert.match(openapi, /enum: \[Discover Use Cases, Match Use Cases\]/);
  assert.match(openapi, /enum: \[Good, High, Ultra High\]/);
  assert.doesNotMatch(openapi, /operation_mode:\s*full/);
  assert.doesNotMatch(openapi, /generate_choices:\s*genie,pdf/);
  assert.match(openapi, /03_discovery_type:[\s\S]{0,1000}enum: \[Standard Discovery, AI Enhanced Discovery, Standard, Deep\]\n\s*default: Standard Discovery/);
  assert.match(openapi, /10_strategic_context:/);
  assert.match(openapi, /\/api\/inspire\/feedback:\n    post:[\s\S]*?\n    get:/);
  assert.match(openapi, /enum: \[accepted, rejected, planned, implemented\]/);
});
