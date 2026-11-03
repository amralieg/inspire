const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'artifactFiles.js')).href;

test('the artifact browser shows the JSON catalog, hides every other JSON file and keeps folders and documents', async () => {
  const { visibleArtifactFiles } = await import(libUrl);
  const files = [
    { name: 'Acme-dbx_inspire.json', path: '/w/docs/Acme-dbx_inspire.json', is_directory: false },
    { name: 'Acme Corp-DBX_INSPIRE.JSON', path: '/w/docs/Acme Corp-DBX_INSPIRE.JSON', is_directory: false },
    { name: 'ailogs.jsonl', path: '/w/.inspire_logs/ailogs.jsonl', is_directory: false },
    { name: 'REPORT.JSON', path: '/w/docs/REPORT.JSON', is_directory: false },
    { name: 'genie_space.json', path: '/w/n01/genie_space.json', is_directory: false },
    { name: 'dbx_inspire.json', path: '/w/docs/dbx_inspire.json', is_directory: false },
    { name: 'Acme-dbx_inspire.json.bak', path: '/w/docs/Acme-dbx_inspire.json.bak', is_directory: false },
    { name: 'Acme-dbx_inspire_en.pdf', path: '/w/docs/Acme-dbx_inspire_en.pdf', is_directory: false },
    { name: 'Acme-dbx_inspire_ar.json', path: '/w/docs/Acme-dbx_inspire_ar.json', is_directory: false },
    { name: 'Acme-dbx_inspire_arabic.json', path: '/w/docs/Acme-dbx_inspire_arabic.json', is_directory: false },
    { name: 'log.log', path: '/w/.inspire_logs/log.log', is_directory: false },
    { name: 'exports.json', path: '/w/exports.json', is_directory: true },
    null,
  ];
  assert.deepEqual(visibleArtifactFiles(files).map((f) => f.name), ['Acme-dbx_inspire.json', 'Acme Corp-DBX_INSPIRE.JSON',
    'Acme-dbx_inspire.json.bak', 'Acme-dbx_inspire_en.pdf', 'Acme-dbx_inspire_ar.json', 'log.log', 'exports.json']);
  assert.deepEqual(visibleArtifactFiles(undefined), []);
  const agent = require('node:fs').readFileSync(path.resolve(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8');
  assert.ok(agent.includes('f\\"{self.business_name}-dbx_inspire.json\\"'), 'the agent names its JSON catalog with the suffix the browser shows');
  assert.ok(agent.includes('f\\"{self.business_name}-dbx_inspire_{lang_abbr}.json\\"'), 'the agent names each translated JSON catalog the way the browser shows');
});

test('Quick access lists PDF, Excel and CSV files, and leaves CSV out when an Excel file is there', async () => {
  const { quickAccessFiles, fileExtension } = await import(libUrl);
  const f = (name, extra) => ({ name, path: `/w/docs/${name}`, is_directory: false, ...extra });
  const withExcel = [f('Acme-dbx_inspire.pdf'), f('Acme-dbx_inspire.CSV'), f('Acme-dbx_inspire.xlsx'), f('notes.md'), f('data', { is_directory: true }), null];
  assert.deepEqual(quickAccessFiles(withExcel).map((x) => x.name), ['Acme-dbx_inspire.pdf', 'Acme-dbx_inspire.xlsx']);
  assert.deepEqual(quickAccessFiles([f('a.pdf'), f('a.csv')]).map((x) => x.name), ['a.pdf', 'a.csv'], 'with no Excel file the CSV stays');
  assert.deepEqual(quickAccessFiles([f('old.xls'), f('a.csv')]).map((x) => x.name), ['old.xls'], 'an .xls file counts as Excel');
  assert.deepEqual(quickAccessFiles(undefined), []);
  assert.equal(fileExtension({ name: 'README' }), '');
  assert.equal(fileExtension({ name: 'Report.Final.PDF' }), 'pdf');
});

test('an Excel sheet previews as text cells: blanks stay blank, dates read as days, and at most PREVIEW_ROWS rows are read', async () => {
  const A = await import(libUrl);
  assert.equal(typeof A.sheetPreview, 'function');
  const day = new Date(Date.UTC(2026, 9, 31));
  const got = A.sheetPreview([['No', 'Score', null], ['N01-U01', 4.6, day], ['N01-U02', true, new Date('nope')], null]);
  assert.deepEqual(got.headers, ['No', 'Score', '']);
  assert.deepEqual(got.rows, [['N01-U01', '4.6', '2026-10-31'], ['N01-U02', 'true', ''], []]);
  assert.equal(got.totalRows, 3);
  const many = A.sheetPreview([['h'], ...Array.from({ length: A.PREVIEW_ROWS + 80 }, (_, i) => [i])]);
  assert.equal(many.rows.length, A.PREVIEW_ROWS);
  assert.equal(many.totalRows, A.PREVIEW_ROWS + 80);
  assert.ok(A.PREVIEW_ROWS > A.PREVIEW_PAGE_ROWS, 'the preview sorts and filters more rows than one page shows');
  assert.deepEqual(A.sheetPreview(undefined), { headers: [], rows: [], totalRows: 0 });
  assert.doesNotMatch(A.EXCEL_UNREADABLE + A.EXCEL_OLD_FORMAT, /[\u2013\u2014]/);
});

test('a CSV previews with quoted commas, quotes and line breaks kept inside their cell, a byte order mark dropped and blank lines skipped', async () => {
  const A = await import(libUrl);
  const text = '\uFEFFNo,Name,Note\r\nN01-U01,"Churn, early","Say ""hi""\nthen leave"\r\n\r\n N01-U02 ,Upsell,\rN01-U03,Cross sell,last';
  assert.deepEqual(A.csvRows(text), [
    ['No', 'Name', 'Note'],
    ['N01-U01', 'Churn, early', 'Say "hi"\nthen leave'],
    ['N01-U02', 'Upsell', ''],
    ['N01-U03', 'Cross sell', 'last'],
  ]);
  const got = A.csvPreview(text);
  assert.deepEqual(got.headers, ['No', 'Name', 'Note']);
  assert.equal(got.totalRows, 3);
  assert.deepEqual(A.csvRows(''), []);
});

test('a preview grid gives every column a unique key, names blank headers, keeps extra cells and numbers each row from the file', async () => {
  const A = await import(libUrl);
  const { columns, rows } = A.previewGrid({ headers: ['Name', '', 'Name', 'Name (2)'], rows: [['a', 'b', 'c', 'd', 'e'], ['f']], totalRows: 2 });
  assert.deepEqual(columns.map((c) => c.label), ['Name', 'Column 2', 'Name (2)', 'Name (2) (2)', 'Column 5']);
  assert.equal(new Set(columns.map((c) => c.key)).size, 5);
  assert.deepEqual(rows[0], { '#': 1, 'h:Name': 'a', 'h:Column 2': 'b', 'h:Name (2)': 'c', 'h:Name (2) (2)': 'd', 'h:Column 5': 'e' });
  assert.deepEqual(rows[1], { '#': 2, 'h:Name': 'f', 'h:Column 2': '', 'h:Name (2)': '', 'h:Name (2) (2)': '', 'h:Column 5': '' });
  assert.deepEqual(A.previewGrid(undefined), { columns: [], rows: [] });
});

test('the Results page builds Quick access from quickAccessFiles and keeps no extension list of its own', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ResultsPage.jsx'), 'utf8');
  assert.match(src, /const previewableFiles = quickAccessFiles\(artifactFiles\);/);
  assert.doesNotMatch(src, /\['pdf', 'csv', 'xlsx', 'xls'\]\.includes/);
  assert.equal((src.match(/<table/g) || []).length, 0, 'both file previews draw through FilePreview, never a table of their own');
  assert.equal((src.match(/<FilePreview /g) || []).length, 2);
  assert.doesNotMatch(src, /parseCsvLine/);
});
