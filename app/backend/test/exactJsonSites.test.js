const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../lib/inspireImplement');
const { parseMaybeJson } = require('../lib/inspireJobParams');
const { parseResultsJson } = require('../lib/runSummary');
const { sourceFiles } = require('./support/sourceFiles');

const SID = '2222222222222222222';
const BACKEND = path.join(__dirname, '..');

test('every App read of agent JSON keeps a 19-digit session id byte for byte', () => {
  const text = `{"_source_session_id": ${SID}, "tables": {"main.s.t": {"columns": ["a"]}}}`;
  assert.equal(parseResultsJson(text)._source_session_id, SID, 'the session results');
  assert.equal(parseMaybeJson(text)._source_session_id, SID, 'job and session JSON values');
  const row = I.parseImplementRow({ spec_json: text, data_profiles: text, suggested_schedule: text, genie_widgets: `[{"name": "sid", "default": ${SID}}]` });
  assert.equal(row.spec_json._source_session_id, SID, 'the implement spec');
  assert.equal(row.data_profiles._source_session_id, SID, 'the implement data profiles');
  assert.equal(row.suggested_schedule._source_session_id, SID, 'the implement schedule');
  const rows = [
    { stage_name: I.IMPLEMENT_OPERATION, step_name: 'Build', result_json: `{"use_case_id": "N01-U01", "_source_session_id": ${SID}}` },
    { stage_name: I.IMPLEMENT_OPERATION, step_name: 'Build', result_json: `{"use_case_id": "N02-U01", "_source_session_id": ${SID}}` },
    { stage_name: I.IMPLEMENT_OPERATION, step_name: 'Build N01-U01', result_json: 'not json' },
  ];
  const steps = I.filterImplementSteps(rows, 'N01-U01');
  assert.deepEqual(steps.map((s) => s.result_json), [{ use_case_id: 'N01-U01', _source_session_id: SID }, 'not json'], 'the step payloads the status route sends');
});

const ALLOWED = [
  ['server.js', 'JSON.parse(errText)', 'the jobs API error text'],
  ['server.js', 'JSON.parse(content)', 'the cells of the agent notebook the App ships, code text only'],
  ['implementRoutes.js', 'JSON.parse(raw)', 'the principals the person sends'],
  ['implementRoutes.js', 'JSON.parse(text)', 'Databricks REST answers'],
  ['lib/ucReads.js', 'JSON.parse(text)', 'Unity Catalog, workspace, permission and SCIM REST answers the person checks read'],
  ['lib/hostedRun.js', 'JSON.parse(text)', 'answers of the hosted App process the App starts'],
  ['lib/showcaseRecord.js', 'JSON.parse(postData)', 'request bodies the recorder sees'],
  ['lib/inspireImplement.js', 'JSON.parse(`"${body}"`)', 'one JSON string literal'],
  ['lib/appShell.js', 'JSON.parse(literal.replace(', 'the App shell catalog literal'],
  ['lib/exactJson.js', 'JSON.parse(', 'the exact reader itself'],
];

const BROWSER = path.join(BACKEND, '..', 'frontend', 'src');
const BROWSER_ALLOWED = [
  ['lib/apiClient.js', 'JSON.parse(errText)', 'an error answer of the App, read for its message'],
  ['lib/ucPermissionErrors.js', 'JSON.parse(raw)', 'an error answer of the App, read for its message'],
  ['lib/strategyContext.js', 'JSON.parse(raw)', 'the strategy text the person types in the widget'],
  ['lib/implementControl.js', 'JSON.parse(storage?.getItem(COLLECTED_VIBES_KEY)', 'the vibes this browser stored itself'],
  ['lib/useCaseFields.js', 'JSON.parse(rawFp)', 'the favorites this browser stored itself'],
  ['lib/useCaseFields.js', "JSON.parse(storage.getItem('inspire_favorites')", 'the favorites this browser stored itself'],
  ['lib/dataGrid.js', 'JSON.parse(storage?.getItem(GRID_ORDER_KEY)', 'the column order this browser stored itself, which names no id'],
  ['lib/useCaseFields.js', 'JSON.parse(flags)', 'the selection flags of a use case, which name no id'],
  ['lib/implementWizard.js', "JSON.parse(String(raw || ''))", 'the elite assessment of a use case, which names no id'],
  ['lib/v130UseCase.js', 'JSON.parse(text)', 'the strategy alignment and data evidence of a use case, which name no id'],
  ['lib/runScope.js', 'JSON.parse(raw)', 'the first run groups the App saved, whose values it writes as text, so a key value never passes through a number'],
];

function sources(dir, ext = ['.js']) {
  return sourceFiles(dir, { ext, skip: ['test', 'showcase'] });
}

function unlisted(root, files, allowed) {
  const left = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/JSON\.parse\(/g)) {
        const rest = line.slice(m.index);
        if (!allowed.some(([f, start]) => f === rel && rest.startsWith(start))) left.push(`${rel}:${i + 1} ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return left;
}

test('the backend reads agent JSON only through parseExactJson; every other JSON.parse is named here with what it reads', () => {
  assert.deepEqual(unlisted(BACKEND, sources(BACKEND), ALLOWED), []);
});

test('the browser receives agent JSON already read; every JSON.parse left in the browser is named here with what it reads, and none reads an id', () => {
  const files = sources(BROWSER, ['.js', '.jsx']);
  assert.ok(files.length > 50, `${files.length} browser files`);
  assert.deepEqual(unlisted(BROWSER, files, BROWSER_ALLOWED), []);
  for (const [file, start] of BROWSER_ALLOWED) {
    assert.ok(fs.readFileSync(path.join(BROWSER, file), 'utf8').includes(start), `${file} no longer has ${start}; drop it from the list`);
  }
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'json-sites-'));
  fs.writeFileSync(path.join(dir, 'steps.js'), 'export const read = (row) => JSON.parse(row.result_json);\n');
  assert.deepEqual(unlisted(dir, [path.join(dir, 'steps.js')], BROWSER_ALLOWED), ['steps.js:1 export const read = (row) => JSON.parse(row.result_json);'], 'an unlisted parse is reported');
  fs.rmSync(dir, { recursive: true, force: true });
});
