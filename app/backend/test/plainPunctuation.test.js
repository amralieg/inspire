const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const { FRONTEND, SRC, relative, sourceFiles, withoutComments } = require('./support/frontendSource');

const DASH = /[\u2013\u2014]|&[mn]dash;|&#821[12];/;
const BACKEND = path.resolve(__dirname, '..');
const APP = path.resolve(BACKEND, '..');
const DEMO_DATA_PROMPT = [
  '**Fixed Unity Catalog location (MANDATORY \u2014 do not change):**',
  '- catalog_name = "{catalog_name}"  (already exists \u2014 NEVER create a catalog)',
  'OUTPUT FORMAT (STRICT) \u2014 return EXACTLY ONE JSON object:',
  '- Build {num_tables} related pandas DataFrames (realistic domain data; ~80\u2013200 rows on larger fact tables, fewer on dimensions).',
];

function dashLines(text, label) {
  return text.split('\n').flatMap((line, i) => (DASH.test(line) ? [`${label}:${i + 1}: ${line.trim().slice(0, 120)}`] : []));
}

test('the comment stripper keeps strings and JSX text and drops only comments', () => {
  const kept = withoutComments("const a = 'x — y'; // gone — here\n/* gone — too */ <p>{/* gone — also */}Shown — text</p>\nconst u = 'https://a.b/c';");
  assert.equal((kept.match(/—/g) || []).length, 2, 'the string and the JSX text keep their dashes, the three comments do not');
  assert.ok(kept.includes("'https://a.b/c'"), 'a URL inside a string is not a comment');
  assert.equal(kept.split('\n').length, 3, 'line numbers stay put');
});

test('the comment stripper stays in step after a nested template literal and a regex literal holding a quote', () => {
  const src = "const a = `x ${b ? `; ${c}` : ''} y`;\nconst q = s.replace(/`/g, '').split(/['\"]/);\n// gone — here\nconst d = n / 2; // gone — too\nconst s = 'kept — here';";
  const kept = withoutComments(src);
  assert.equal((kept.match(/—/g) || []).length, 1, kept);
  assert.ok(kept.includes("'kept — here'"));
  assert.equal(kept.split('\n').length, 5);
});

test('no user-visible text in the frontend uses an em or en dash', () => {
  const hits = [];
  for (const file of sourceFiles(SRC, ['.js', '.jsx'])) hits.push(...dashLines(withoutComments(fs.readFileSync(file, 'utf8')), relative(file)));
  hits.push(...dashLines(fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8'), 'index.html'));
  assert.deepEqual(hits, []);
});

test('no user-visible text in the App shell web pages uses an em or en dash', () => {
  const web = path.join(APP, 'agent', 'agent', 'app_shell', 'web');
  const hits = [];
  for (const file of sourceFiles(path.join(web, 'src'), ['.js', '.jsx', '.mjs'])) hits.push(...dashLines(withoutComments(fs.readFileSync(file, 'utf8')), path.relative(APP, file)));
  hits.push(...dashLines(fs.readFileSync(path.join(web, 'index.html'), 'utf8'), 'app_shell/web/index.html'));
  assert.ok(sourceFiles(path.join(web, 'src'), ['.js', '.jsx', '.mjs']).some((file) => file.endsWith('kindCharts.js')), 'the scan reads the chart sources');
  assert.deepEqual(hits, []);
});

test('no message the backend sends or prints, and no API doc page, uses an em or en dash', () => {
  const hits = [];
  const top = fileNames(BACKEND).filter((name) => name.endsWith('.js') && !name.endsWith('_bundle.js')).map((name) => path.join(BACKEND, name));
  for (const file of [...top, ...sourceFiles(path.join(BACKEND, 'lib'), ['.js'])]) {
    hits.push(...dashLines(withoutComments(fs.readFileSync(file, 'utf8')), path.relative(BACKEND, file)));
  }
  for (const rel of ['openapi.yaml', 'api-docs.html']) hits.push(...dashLines(fs.readFileSync(path.join(BACKEND, rel), 'utf8'), rel));
  for (const rel of ['dbx_generate_demo_data.py', 'backend/dbx_generate_demo_data.py', 'dbx_inspire_after_demo.py']) {
    const text = fs.readFileSync(path.join(APP, rel), 'utf8');
    const shown = text.split('\n').filter((line) => !DEMO_DATA_PROMPT.includes(line.trim())).join('\n');
    hits.push(...dashLines(shown, rel));
  }
  assert.deepEqual(hits, []);
  const demo = fs.readFileSync(path.join(APP, 'dbx_generate_demo_data.py'), 'utf8').split('\n').map((line) => line.trim());
  assert.deepEqual(DEMO_DATA_PROMPT.filter((line) => !demo.includes(line)), [], 'every allowed prompt line is still in the demo-data prompt');
});
