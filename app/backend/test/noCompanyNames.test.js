const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

function offenders() {
  return productFiles().flatMap((rel) => {
    const text = readText(rel);
    if (text === null) return [];
    const names = [...denylisted(text), ...brandedExamples(text)];
    return names.length ? [`${rel}: ${[...new Set(names)].join(', ')}`] : [];
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
