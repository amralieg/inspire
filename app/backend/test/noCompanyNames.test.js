const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SELF = path.relative(REPO, __filename).split(path.sep).join('/');
const SKIPPED = [
  /^app\/agent\/demos\//,
  /(^|\/)node_modules\//,
  /^app\/agent\/tests\//,
  /^app\/backend\/test\//,
  /^app\/frontend\/test\//,
  /^app\/agent\/agent\/app_shell\/web\/test\//,
];
const DENYLIST = [
  /\bqatar(?:[ _-]?airways)?\b/i,
  /(?<!\barab[ _-])\bemirates\b/i,
  /\betihad\b/i,
  /\bflydubai\b/i,
  /\blufthansa\b/i,
  /\bryanair\b/i,
  /\beasyjet\b/i,
  /\bsaudia\b/i,
  /\bbritish[ _-]airways\b/i,
  /\bsingapore[ _-]airlines\b/i,
  /\bturkish[ _-]airlines\b/i,
  /\bcathay[ _-]pacific\b/i,
  /\bfirst[ _-]abu[ _-]dhabi\b/i,
  /(?<![#\w])FAB(?!\w)/,
  /\bmashreq\b/i,
  /\bhsbc\b/i,
  /\bbarclays\b/i,
  /\bcitibank\b/i,
  /\bjp[ _-]?morgan\b/i,
  /\bgoldman[ _-]sachs\b/i,
  /\bsantander\b/i,
  /\bwells[ _-]fargo\b/i,
  /\betisalat\b/i,
  /\bvodafone\b/i,
  /\bverizon\b/i,
  /\booredoo\b/i,
  /\bt-mobile\b/i,
  /\bwalmart\b/i,
  /\bcarrefour\b/i,
  /\btesco\b/i,
  /\bcostco\b/i,
  /\baramco\b/i,
  /\badnoc\b/i,
  /\bexxon(?:mobil)?\b/i,
  /\bstarbucks\b/i,
];
const NEUTRAL = new Set(['regional', 'national', 'retail', 'global', 'local', 'community', 'digital', 'sample', 'demo',
  'example', 'acme', 'contoso', 'your', 'my', 'other', 'commercial']);
const SUFFIXES = ['airways', 'airlines', 'airline', 'air', 'bank', 'telecom', 'telco', 'mobile', 'petroleum', 'motors', 'insurance',
  'energy', 'pharma', 'holdings', 'group', 'corp'];
const EXAMPLE = /e\.g\.([^\n]{0,120})/g;
const TITLED = SUFFIXES.map((word) => word[0].toUpperCase() + word.slice(1)).join('|');
const BRANDS = [new RegExp(`\\b([A-Z][a-z]+) (?:${TITLED})\\b`, 'g'), new RegExp(`\\b([a-z]+)_(?:${SUFFIXES.join('|')})\\b`, 'g')];
const BUNDLE = /^module\.exports = "([A-Za-z0-9+/=]+)";\n?$/;
const SHELL_PAYLOAD = 'app/agent/agent/app_shell/app_shell.b64';
const WORLD_MAPS = new Set(['app/agent/agent/app_shell/web/src/maps/world.json', `${SHELL_PAYLOAD}!static/assets/echartsGeo.js`]);
const COUNTRY = /"name":"([^"]*)","a2":"([A-Z]{2})"/g;
const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });

function isoName(code) {
  try {
    return REGIONS.of(code);
  } catch {
    return null;
  }
}

function withoutCountryNames(label, text) {
  if (!WORLD_MAPS.has(label)) return text;
  return text.replace(COUNTRY, (whole, name, code) => (name === isoName(code) ? `"name":"","a2":"${code}"` : whole));
}

function shellTexts(base64) {
  const payload = JSON.parse(zlib.inflateSync(Buffer.from(base64.trim(), 'base64')).toString('utf8'));
  return Object.entries(payload.files).map(([name, text]) => [`${SHELL_PAYLOAD}!${name}`, String(text)]);
}

function productFiles() {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'app', 'inspire_installer.py'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, `git ls-files failed: ${run.stderr}`);
  return [...new Set(run.stdout.split('\0').filter(Boolean))]
    .filter((rel) => rel !== SELF && !SKIPPED.some((rule) => rule.test(rel)) && fs.existsSync(path.join(REPO, rel)));
}

function readText(rel) {
  const bytes = fs.readFileSync(path.join(REPO, rel));
  if (bytes.subarray(0, 8000).includes(0)) return null;
  const text = bytes.toString('utf8');
  const bundled = text.match(BUNDLE);
  return bundled ? Buffer.from(bundled[1], 'base64').toString('utf8') : text;
}

function denylisted(text) {
  return DENYLIST.flatMap((rule) => {
    const found = text.match(rule);
    return found ? [found[0]] : [];
  });
}

function brandedExamples(text) {
  const found = [];
  for (const [, example] of text.matchAll(EXAMPLE)) {
    for (const brand of BRANDS) {
      for (const [name, head] of example.matchAll(brand)) {
        if (!NEUTRAL.has(head.toLowerCase())) found.push(name);
      }
    }
  }
  return found;
}

function scannedTexts(rel) {
  const text = readText(rel);
  if (text === null) return [];
  return rel === SHELL_PAYLOAD ? shellTexts(text) : [[rel, text]];
}

function namesIn(label, text) {
  const scanned = withoutCountryNames(label, text);
  return [...new Set([...denylisted(scanned), ...brandedExamples(scanned)])];
}

function offenders() {
  return productFiles().flatMap(scannedTexts).flatMap(([label, text]) => {
    const names = namesIn(label, text);
    return names.length ? [`${label}: ${names.join(', ')}`] : [];
  });
}

test('the denylist and the example rule catch a real company name and pass a neutral one', () => {
  for (const text of ['placeholder="e.g. Qatar Airways"', 'e.g. `qatar_airways` -> table base', 'like Emirates NBD',
    'for FAB', 'JP Morgan', 'Vodafone']) {
    assert.ok(denylisted(text).length, `the denylist misses ${text}`);
  }
  for (const text of ['e.g. "Gulfwind Airways"', 'e.g. `skyline_airlines` table', 'e.g. Northbridge Bank', 'e.g. Falcon Telecom']) {
    assert.ok(brandedExamples(text).length, `the example rule misses ${text}`);
  }
  for (const text of ['placeholder="e.g. Regional Airline"', 'e.g. `regional_airline` -> table base `regional_airline_table`',
    'e.g. "Regional Airline", "Retail Sales"', 'United Arab Emirates', 'color: #FAB', 'prefab', 'Acme Corp', 'fabric', 'e.g. "create fake airline bookings"', 'e.g. joins for airlines',
    'e.g. an airline']) {
    assert.deepEqual([...denylisted(text), ...brandedExamples(text)], [], `a neutral text is flagged: ${text}`);
  }
});

test('a country name passes only as the ISO name of its own code inside the bundled world map, and the same word anywhere else still fails', () => {
  const map = 'app/agent/agent/app_shell/web/src/maps/world.json';
  const country = '{"type":"Feature","properties":{"name":"Qatar","a2":"QA","a3":"QAT","n":"634"}}';
  assert.deepEqual(namesIn(map, country), []);
  assert.deepEqual(namesIn(`${SHELL_PAYLOAD}!static/assets/echartsGeo.js`, `JSON.parse('${country}')`), []);
  assert.deepEqual(namesIn('app/agent/agent/app_shell/web/src/maps/other.json', country), ['Qatar']);
  assert.deepEqual(namesIn(`${SHELL_PAYLOAD}!static/assets/app.js`, country), ['Qatar']);
  assert.deepEqual(namesIn('app/frontend/src/pages/StartPage.jsx', 'A run for Qatar'), ['Qatar']);
  assert.deepEqual(namesIn(map, '{"properties":{"name":"Qatar","a2":"AE"}}'), ['Qatar']);
  assert.deepEqual(namesIn(map, '{"properties":{"name":"Qatar Airways","a2":"QA"}}'), ['Qatar Airways']);
  assert.deepEqual(namesIn(map, `{"license":"made for Qatar","features":[${country}]}`), ['Qatar']);
  assert.deepEqual(namesIn(map, '{"properties":{"name":"Qatar","a2":"-99"}}'), ['Qatar']);
  assert.deepEqual(namesIn(map, '{"properties":{"name":"Vodafone","a2":"QA"}}'), ['Vodafone']);
});

test('the scan reads every file inside the compressed App shell payload', () => {
  const planted = zlib.deflateSync(Buffer.from(JSON.stringify({ version: 1, files: { 'static/app.js': 'const brand = "Vodafone";', 'static/index.html': '<p>fine</p>' } }))).toString('base64');
  assert.deepEqual(shellTexts(planted).map(([label, text]) => [label, namesIn(label, text)]),
    [[`${SHELL_PAYLOAD}!static/app.js`, ['Vodafone']], [`${SHELL_PAYLOAD}!static/index.html`, []]]);
  const shipped = scannedTexts(SHELL_PAYLOAD).map(([label]) => label);
  assert.ok(shipped.includes(`${SHELL_PAYLOAD}!static/index.html`) && shipped.includes(`${SHELL_PAYLOAD}!static/assets/echartsGeo.js`),
    'the scan reads the shipped App shell, map chunk included');
});

test('the bundled demo notebook is read as the text it embeds', () => {
  const bundle = readText('app/backend/demo_notebook_bundle.js');
  assert.equal(bundle, fs.readFileSync(path.join(REPO, 'app', 'dbx_generate_demo_data.py'), 'utf8'));
});

test('no product file under app/ names a real company as an example, outside the demo fixtures', () => {
  const files = productFiles();
  assert.ok(files.includes('app/frontend/src/pages/GenerateDataPage.jsx') && files.includes('app/dbx_generate_demo_data.py')
    && files.some((rel) => /^app\/frontend\/dist\/assets\/index-.*\.js$/.test(rel)), 'the scan misses a product file it must read');
  assert.ok(!files.some((rel) => rel.startsWith('app/agent/demos/')), 'the scan reads the demo fixtures');
  assert.deepEqual(offenders(), []);
});
