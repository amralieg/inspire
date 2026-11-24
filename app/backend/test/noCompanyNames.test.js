const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SELF = path.relative(REPO, __filename).split(path.sep).join('/');
const SKIPPED = [/(^|\/)node_modules\//];
const SHELL_PAYLOAD = 'app/agent/agent/app_shell/app_shell.b64';
const WORLD_MAPS = new Set(['app/agent/agent/app_shell/web/src/maps/world.json', `${SHELL_PAYLOAD}!static/assets/echartsGeo.js`]);
const COUNTRY = /"name":"([^"]*)","a2":"([A-Z]{2})"/g;
const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });
const EXAMPLE = /e\.g\.([^\n]{0,120})/g;
const NEUTRAL = new Set(['regional', 'national', 'retail', 'global', 'local', 'community', 'digital', 'sample', 'demo',
  'example', 'acme', 'contoso', 'your', 'my', 'other', 'commercial']);
const SUFFIXES = ['airways', 'airlines', 'airline', 'air', 'bank', 'telecom', 'telco', 'mobile', 'petroleum', 'motors', 'insurance',
  'energy', 'pharma', 'holdings', 'group', 'corp'];
const TITLED = SUFFIXES.map((word) => word[0].toUpperCase() + word.slice(1)).join('|');
const BRANDS = [new RegExp(`\\b([A-Z][a-z]+) (?:${TITLED})\\b`, 'g'), new RegExp(`\\b([a-z]+)_(?:${SUFFIXES.join('|')})\\b`, 'g')];
const BUNDLE = /^module\.exports = "([A-Za-z0-9+/=]+)";\n?$/;

// REQ-335: the denylist holds only SHA-256 digests, so no company name is readable in this file.
// A name's digest is taken over its lower-case letters and digits with separators removed, so "Name Words", "name_words",
// "name-words" and "namewords" share one digest. EXACT_DIGESTS holds the digest of a token that must match its exact case
// (an upper-case acronym, not in a colour code). Regenerate by hashing the normalized names; never add a readable name here.
const NAME_DIGESTS = new Set([
  '05f84363a37b42906a9b2bc8de3fc38cab17c76fa7605c03eb950d49aa56f846',
  '0ba6cd006d0d664f06fb75ee2c4443b32d8b1c08646e41cc9e5242e0058ca7c9',
  '0fdfe0f20c4e35bcb960913cfc58fb29dcb989517c8e0597868069a07b598d22',
  '138df632fd0de2067dfcd75b6dbc543d8d66da31a79a39358216aa6ef63ad437',
  '16b4ceef84eec6d6a927b90911c3cca3d2ce9d718be1fcd1aadd7a9cd4a268b9',
  '1a99ed672ed4cbae867251807c1f691517bb2df694123a0ba7864bd065fd5de4',
  '1db9967e1f18f6301a3b7b5c17d2fc00a81ffbfb33da307bd1bdcb86c325f788',
  '22ffba7a86ea9919593ce4de083c392f0f43149668d89d968da1d70fad195740',
  '245a5591f1a714d1eca6835bb4f8cc244439e23eb8741f516345862aa3ef09d5',
  '25a89501122fbd332d8166134a164f99eaf3b96e4b9defe091a93fa8466feb84',
  '38e9adc257dab8ad18442ac95e1cccf5d95eb719f859039f63906ab5a0eabc6f',
  '3fc81a2348ee6614856d39e6fc60a7308cbeab7cf222f1e03e1d1b70c6661dd9',
  '4b1f6f530975ef68d8f30d663efe02fb1e20ca2fdde8c5416ecfeb21fb881e96',
  '4ef9bfe6a5402861fd19b51cdbe76e50ac1cd3cf36e3d20530d57f5dd13ab60e',
  '5e41133f00a54dde180d32c8b23eeb475efeb807fafc733a13f1861039020a61',
  '60ed7ee39a4a772da6e5ac9ea6e310dcebd6b32888b86426b6acd22b44ed5efd',
  '62fd6c7860342a316c30c63d12f860125feccbf30e914d51dee6c2fdced4f606',
  '6919ef3b7ee715652c1b08c8586bba352a649dd0466124e40dc785e028060e2e',
  '6b8fc06e8f6237d7f799169e49b534e5cc7ceef9ef982a2d2a0b8de7521c95b6',
  '71f566aba763fb7636f03bfeb321c6d4934d4a6d5cb777c49b1c1595260c573b',
  '803bd65441cc811070ad7391f855454b4953cbbd5c15f4757658e32bb6377ce0',
  '8417bed310833297d586cc6747ebc0d8da64a30b75946e3cced61f621f55e43a',
  '88545174e9ec81694c080da9837c723eeb425e97e7077187705c332ad0a95a28',
  '8a1328167b2d247deb84b5bd506973762288f8ab2efac9ffaa3ceb539f05d044',
  '943c3eeb252dbd176df2295566dad51a65ddc81165de0df9873a4ae9f7bf09bd',
  '9626660ad7ab9b143dbbca4462c6a6bffa8aae95bf0bc69f67d1ac21c399aeb4',
  '97a6eb426111984bea4e6346d4381bf7265c1acb864ff88aa65e3cacbf698d9e',
  '98855d98ea530c88ae9563163718fab2e780cfca017c59bf6a21d9a23e36b569',
  'a8c05092f80a979f6c16351e5bf06136f8fa09696500ca04236c7493f123d493',
  'aacca8bcb37aefa0c533aaf84f4bcdb9c15dfbf7175da4c6c1ce9d3ec5ba4a02',
  'b21492b15d85500ef49e5ad990ec8a530c27772b9a3d129770fd6c733257c19b',
  'b922b7e0ba4cfdb9d843570dfde0af429181655f71f76fb45ffc923f074adfbc',
  'ba2436bd25a09dd572c044797e6978eaa9c498fb36fa0f59fb672ca03cc3faf7',
  'bbc82f0150a7aa55859e297884782964f4b971ca6d3895affd0efbcb6420c71e',
  'bf35b3e3b9bb3050f1b5e904bcbb425985adecec6ac26ac4b471936e9425ca02',
  'c09dee99967309b12c066143a662efd5fc01f4b628d337037dcdf3931c0661bc',
  'c1aeddf7704ad846b255ab83457cb7ffc8925f79f398301904ab12b7b0d31708',
  'ce749e840dcada0f9196edd49327ae5b3ab16f1d0405e72c1cb7d62b04538a42',
  'cf10c29dc1ecd5c894448294aaa49e12f6a8c6569e0e709f2291bc4d86d7a66a',
  'd2aa18ee67ea4a858754d3cf655738b6fd1c6e41200805ae1909aa707fe25a67',
  'd3b81f57e600bad8c39a587fc829280cf3f0c74bc5c89790d1720798802c2f37',
  'e224e66fb84c63ed3295f06f9e1075e2b3967d54de1b2de2010cfdb54a03a891',
  'ec647b5d5ef393bc23ce35cf49e166d2b62eecccc0ecd2e9e317bbbf22de484e',
  'ed4df47ae8851cb4106a17387fa562183a94230b6639de20229bfa2e29e83917',
]);
const EXACT_DIGESTS = new Set([
  '36f8a538dbf6ab65941ffe3bdc3f35e35780611d4bb010508659b2574e715dee',
]);
const NEUTRAL_PREFIX = 'arab';
const WORD = /[A-Za-z0-9]/;
const SEPARATOR = /^[ _-]$/;
const digestCache = new Map();

function digestOf(token) {
  let digest = digestCache.get(token);
  if (digest === undefined) {
    digest = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    digestCache.set(token, digest);
  }
  return digest;
}

// Word-boundary matching over alphanumeric words. A name is one word or up to three words joined by one space, underscore or hyphen.
// A name must not sit inside a longer word (a trailing underscore counts as part of a word, as \b does), and an upper-case acronym
// must not follow "#". A country name that follows "Arab" is a country, not a company.
function denylistHits(text, names = NAME_DIGESTS, exact = EXACT_DIGESTS) {
  const hits = [];
  const words = [...text.matchAll(/[A-Za-z0-9]+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
  for (let i = 0; i < words.length; i++) {
    const first = words[i];
    const before = first.start > 0 ? text[first.start - 1] : '';
    if (before === '_') continue;
    const after = text[first.end] || '';
    if (exact.size && before !== '#' && !WORD.test(before || ' ') && after !== '_' && !WORD.test(after || ' ') && exact.has(digestOf(first.word))) {
      hits.push(first.start);
    }
    const arabPrefixed = i > 0 && words[i - 1].word.toLowerCase() === NEUTRAL_PREFIX
      && SEPARATOR.test(text.slice(words[i - 1].end, first.start));
    let key = '';
    for (let j = i; j < Math.min(words.length, i + 3); j++) {
      if (j > i && !SEPARATOR.test(text.slice(words[j - 1].end, words[j].start))) break;
      key += words[j].word.toLowerCase();
      const end = text[words[j].end] || '';
      if (end === '_' || WORD.test(end || ' ')) continue;
      if (!arabPrefixed && names.has(digestOf(key))) hits.push(first.start);
    }
  }
  return hits;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isoName(code) {
  try {
    return REGIONS.of(code);
  } catch {
    return null;
  }
}

// The jsPDF library inside the dist pdfDoc bundle ships its language table ("ar-QA": "Arabic (<country>)"); a country there is the ISO region name, never a company.
const LOCALE_LIST = /^app\/frontend\/dist\/assets\/pdfDoc-[\w-]+\.js$/;
const LOCALE_ENTRY = /"[a-z]{2,3}-([A-Z]{2})":"([^"(]*) \(([^)"]*)\)"/g;

function withoutCountryNames(label, text) {
  if (LOCALE_LIST.test(label)) return text.replace(LOCALE_ENTRY, (whole, code, language, region) => (region === isoName(code) ? `"locale":"${language}"` : whole));
  if (!WORLD_MAPS.has(label)) return text;
  return text.replace(COUNTRY, (whole, name, code) => (name === isoName(code) ? `"name":"","a2":"${code}"` : whole));
}

// A branded example is an "e.g." phrase that names a brand with a company suffix. Returns the index of each one.
function brandedExamples(text) {
  const found = [];
  for (const example of text.matchAll(EXAMPLE)) {
    for (const brand of BRANDS) {
      for (const [, head] of example[1].matchAll(brand)) {
        if (!NEUTRAL.has(head.toLowerCase())) found.push(example.index);
      }
    }
  }
  return found;
}

function shellTexts(base64) {
  const payload = JSON.parse(zlib.inflateSync(Buffer.from(base64.trim(), 'base64')).toString('utf8'));
  return Object.entries(payload.files).map(([name, text]) => [`${SHELL_PAYLOAD}!${name}`, String(text)]);
}

function trackedFiles(repo = REPO, pathspec = []) {
  const run = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspec],
    { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, `git ls-files failed: ${run.stderr}`);
  return [...new Set(run.stdout.split('\0').filter(Boolean))]
    .filter((rel) => rel !== SELF && !SKIPPED.some((rule) => rule.test(rel)) && Boolean(fs.lstatSync(path.join(repo, rel), { throwIfNoEntry: false })?.isFile()));
}

function productFiles(repo = REPO) {
  return trackedFiles(repo, ['app', 'inspire_installer.py']);
}

function readText(rel) {
  const bytes = fs.readFileSync(path.join(REPO, rel));
  if (bytes.subarray(0, 8000).includes(0)) return null;
  const text = bytes.toString('utf8');
  const bundled = text.match(BUNDLE);
  return bundled ? Buffer.from(bundled[1], 'base64').toString('utf8') : text;
}

function scannedTexts(rel) {
  const text = readText(rel);
  if (text === null) return [];
  return rel === SHELL_PAYLOAD ? shellTexts(text) : [[rel, text]];
}

// Each hit is reported as file:line only. The matched text is never printed, so a failure does not repeat a name.
function hitsIn(label, text, names = NAME_DIGESTS, exact = EXACT_DIGESTS) {
  const scanned = withoutCountryNames(label, text);
  return [...denylistHits(scanned, names, exact), ...brandedExamples(scanned)].map((index) => lineOf(scanned, index));
}

function offenders(files = trackedFiles()) {
  return files.flatMap((rel) => scannedTexts(rel)).flatMap(([label, text]) => {
    return hitsIn(label, text).map((line) => `${label}:${line}`);
  });
}

const PLANTED = 'zqxplant';
const PLANTED_NAMES = new Set([...NAME_DIGESTS, digestOf(PLANTED)]);

test('a planted denylisted name is caught in every spelling and position, and a neutral look-alike passes', () => {
  for (const text of [`for ${PLANTED}`, 'Zqx Plant', 'zqx_plant', 'zqx-plant', 'ZQX-PLANT lands here', 'e.g. "Zqx Plant" table']) {
    assert.ok(denylistHits(text, PLANTED_NAMES).length > 0, `a planted name is missed: ${text}`);
  }
  for (const text of ['zqx plantation', 'my_zqxplant', 'zqxplants', 'Arab zqxplant', 'a zqx']) {
    assert.deepEqual(denylistHits(text, PLANTED_NAMES), [], `a neutral text is flagged: ${text}`);
  }
});

test('an upper-case acronym matches only in its exact case, outside a colour code and a longer word', () => {
  const exact = new Set([digestOf('ZQX')]);
  assert.ok(denylistHits('the ZQX team', NAME_DIGESTS, exact).length > 0, 'the exact-case acronym is missed');
  for (const text of ['color: #ZQX', 'zqx team', 'ZQX_ID', 'ZQXS', 'prezqx']) {
    assert.deepEqual(denylistHits(text, NAME_DIGESTS, exact), [], `a neutral text is flagged: ${text}`);
  }
});

test('base64 and sha512 text is not flagged: a digest or an encoded blob is one long word, not a name', () => {
  const sha512 = crypto.createHash('sha512').update('inspire').digest('hex');
  const blob = Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + 11) & 255)).toString('base64');
  const lines = `integrity "sha512-${Buffer.from(sha512, 'hex').toString('base64')}"\n${blob}\n${sha512}\n`;
  assert.deepEqual(hitsIn('package-lock.json', lines, PLANTED_NAMES), []);
  assert.deepEqual(hitsIn('x.js', `const b = "${blob}";`, PLANTED_NAMES), []);
});

test('a country name passes only as the ISO name of its own code inside the bundled world map, and a planted name anywhere else still fails', () => {
  const map = 'app/agent/agent/app_shell/web/src/maps/world.json';
  const iso = isoName('QA');
  assert.ok(iso, 'Intl has no country name for the test code');
  const record = (name, code) => `{"type":"Feature","properties":{"name":"${name}","a2":"${code}","a3":"XXX","n":"634"}}`;
  assert.deepEqual(hitsIn(map, record(iso, 'QA'), PLANTED_NAMES), [], 'the ISO name of its own code passes');
  assert.ok(hitsIn(map, record(iso, 'AE'), PLANTED_NAMES).length > 0, 'the ISO name under another code is flagged');
  assert.ok(hitsIn(map, record(PLANTED, 'QA'), PLANTED_NAMES).length > 0, 'a planted name in the map is flagged');
  assert.ok(hitsIn('app/agent/agent/app_shell/web/src/maps/other.json', record(iso, 'QA'), PLANTED_NAMES).length > 0,
    'the same country record outside the world map is flagged');
  assert.ok(hitsIn(`${SHELL_PAYLOAD}!static/assets/echartsGeo.js`, `JSON.parse('${record(iso, 'QA')}')`, PLANTED_NAMES).length === 0,
    'the ISO name passes inside the shell map chunk too');
});

test('the jsPDF language table passes only with the ISO name of its own code, and a planted name there or elsewhere still fails', () => {
  const bundle = 'app/frontend/dist/assets/pdfDoc-AbC123.js';
  const iso = isoName('QA');
  const entry = (region, code) => `{"ar-${code}":"Arabic (${region})"}`;
  assert.deepEqual(hitsIn(bundle, entry(iso, 'QA'), PLANTED_NAMES), [], 'the ISO name of its own code passes');
  assert.ok(hitsIn(bundle, entry(iso, 'AE'), PLANTED_NAMES).length > 0, 'the ISO name under another code is flagged');
  assert.ok(hitsIn(bundle, entry(PLANTED, 'QA'), PLANTED_NAMES).length > 0, 'a planted name in the table is flagged');
  assert.ok(hitsIn('app/frontend/dist/assets/index-AbC123.js', entry(iso, 'QA'), PLANTED_NAMES).length > 0, 'the same entry in another file is flagged');
});

test('the scan reads every file inside the compressed App shell payload', () => {
  const planted = zlib.deflateSync(Buffer.from(JSON.stringify({ version: 1, files: { 'static/app.js': `const brand = "${PLANTED}";`, 'static/index.html': '<p>fine</p>' } }))).toString('base64');
  assert.deepEqual(shellTexts(planted).map(([label, text]) => [label, hitsIn(label, text, PLANTED_NAMES).length]),
    [[`${SHELL_PAYLOAD}!static/app.js`, 1], [`${SHELL_PAYLOAD}!static/index.html`, 0]]);
  const shipped = scannedTexts(SHELL_PAYLOAD).map(([label]) => label);
  assert.ok(shipped.includes(`${SHELL_PAYLOAD}!static/index.html`) && shipped.includes(`${SHELL_PAYLOAD}!static/assets/echartsGeo.js`),
    'the scan reads the shipped App shell, map chunk included');
});

test('the example rule catches a branded example and passes a neutral one', () => {
  for (const text of ['e.g. `skyline_airlines` table', 'e.g. Northbridge Bank', 'e.g. Falcon Telecom']) {
    assert.ok(brandedExamples(text).length, `the example rule misses ${text}`);
  }
  for (const text of ['placeholder="e.g. Regional Airline"', 'e.g. `regional_airline` -> table base `regional_airline_table`',
    'e.g. "Regional Airline", "Retail Sales"', 'e.g. "create fake airline bookings"', 'e.g. joins for airlines', 'e.g. an airline']) {
    assert.deepEqual(brandedExamples(text), [], `a neutral example is flagged: ${text}`);
  }
});

test('the bundled demo notebook is read as the text it embeds', () => {
  const bundle = readText('app/backend/demo_notebook_bundle.js');
  assert.equal(bundle, fs.readFileSync(path.join(REPO, 'app', 'dbx_generate_demo_data.py'), 'utf8'));
});

test('the scan lists only real files: an untracked symlinked node_modules folder, a symlink to a file and a listed path that is gone are left out', () => {
  const os = require('node:os');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-names-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-names-target-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
    fs.mkdirSync(path.join(repo, 'app', 'web'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'app', 'kept.js'), 'const fine = 1;\n');
    fs.writeFileSync(path.join(target, 'brand.js'), `const brand = "${PLANTED}";\n`);
    fs.symlinkSync(target, path.join(repo, 'app', 'web', 'node_modules'), 'dir');
    fs.symlinkSync(path.join(target, 'brand.js'), path.join(repo, 'app', 'linked.js'));
    fs.writeFileSync(path.join(repo, 'app', 'gone.js'), 'const gone = 1;\n');
    assert.equal(spawnSync('git', ['add', 'app/gone.js'], { cwd: repo }).status, 0);
    fs.rmSync(path.join(repo, 'app', 'gone.js'));
    const listed = spawnSync('git', ['ls-files', '--others', '--', 'app'], { cwd: repo, encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(listed, ['app/kept.js', 'app/linked.js', 'app/web/node_modules'], 'git lists the symlinks as untracked paths, so the scan must sort them out');
    const files = productFiles(repo);
    assert.deepEqual(files, ['app/kept.js']);
    assert.deepEqual(files.map((rel) => fs.readFileSync(path.join(repo, rel), 'utf8')), ['const fine = 1;\n']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('the scan covers every tracked file, demo fixtures and tests included, and names no company in any of them', () => {
  const files = trackedFiles();
  assert.ok(files.includes('app/frontend/src/pages/GenerateDataPage.jsx') && files.includes('app/dbx_generate_demo_data.py')
    && files.some((rel) => /^app\/frontend\/dist\/assets\/index-.*\.js$/.test(rel)), 'the scan misses a product file it must read');
  assert.ok(files.some((rel) => rel.startsWith('app/agent/demos/')) && files.includes('app/backend/test/noCompanyNames.test.js') === false,
    'the scan must read the demo fixtures, and must leave out this file');
  assert.deepEqual(offenders(files), []);
});
