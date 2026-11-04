const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../lib/groupingRule');

const FIXTURE = path.resolve(__dirname, '..', '..', 'agent', 'tests', 'fixtures', 'implement_grouping_cases.json');
const bytes = () => fs.readFileSync(FIXTURE);
const data = () => JSON.parse(bytes().toString('utf8'));

test('the App runs the agent own shared grouping cases file, with no App copy of it', () => {
  assert.equal(`${JSON.stringify(data(), null, 2)}\n`, bytes().toString('utf8'), 'json.dumps(indent=2, ensure_ascii=False) plus a new line, as the agent test pins');
  assert.equal(fs.existsSync(path.join(__dirname, 'fixtures', 'implement_grouping_cases.json')), false, 'no second copy that can drift');
});

test('the names, constants, labels and techniques of the shared cases are the ones the App rule uses', () => {
  const { settings, constants, labels, techniques } = data();
  assert.deepEqual([settings.group_by.name, settings.group_by.label, settings.group_by.all, settings.group_by.custom],
    [R.GROUP_BY, R.GROUP_LABEL, R.GROUP_ALL, R.GROUP_CUSTOM]);
  assert.deepEqual(settings.group_by.solo, [R.GROUP_ALL, R.GROUP_CUSTOM]);
  assert.deepEqual([constants.group_min_records, constants.group_min_periods, constants.group_max_groups, constants.group_min_groups],
    [R.GROUP_MIN_RECORDS, R.GROUP_MIN_PERIODS, R.GROUP_MAX_GROUPS, R.GROUP_MIN_GROUPS]);
  assert.deepEqual([labels.global, labels.other, labels.no_group, labels.separator, labels.all_level, labels.custom_level],
    [R.GROUP_GLOBAL, R.GROUP_OTHER, R.GROUP_NONE, R.GROUP_SEPARATOR, R.GROUP_ALL, R.GROUP_CUSTOM]);
  assert.equal(R.groupPart('country', null), labels.missing.replace('{column}', 'country'));
  assert.equal(R.groupPart('country', '  '), 'no country');
  assert.deepEqual(techniques.grouping, R.GROUP_TECHNIQUES);
  assert.deepEqual(techniques.standalone_records, R.STANDALONE_TECHNIQUES);
  assert.deepEqual([R.FIRST_RUN_RECORDS_LINE, R.SUGGESTED_GROUPS, R.SCOPE_DAYS, R.SCOPE_RECORDS], [1000, 3, 30, 1000]);
  assert.deepEqual([constants.first_run_records_line, constants.scope_via_keys_max], [R.FIRST_RUN_RECORDS_LINE, R.SCOPE_VIA_KEYS_MAX]);
  assert.equal(constants.group_max_null_share, R.GROUP_MAX_NULL_SHARE);
  assert.deepEqual(R.RUN_SCOPES, ['all', 'groups', 'recent', 'records', 'custom']);
});

test('the technique decides where grouping applies, and where each record stands alone', () => {
  const { applies } = data();
  for (const c of applies) assert.equal(R.groupingApplies(c.technique), c.applies, c.technique);
  assert.ok(applies.some((c) => c.applies) && applies.some((c) => !c.applies));
  for (const [technique, alone] of [['Text Classification', true], ['Document Summarization', true], ['Named Entity Extraction', true],
    ['Sentiment Analysis', true], ['Anomaly Detection', false], ['Time Series Forecasting', false], ['', false], [null, false]]) {
    assert.equal(R.standaloneRecords(technique), alone, String(technique));
  }
});

test('the Grouping text parses coarse to fine, and all and custom stand alone', () => {
  for (const c of data().parse) {
    assert.equal(R.groupByMode(c.text).mode, c.mode, c.text);
    assert.deepEqual(R.groupByColumns(c.text), c.columns, c.text);
  }
});

test('the recommended columns are usable and nest coarse to fine, exactly as the shared cases say', () => {
  for (const c of data().recommend) assert.deepEqual(R.recommendation(c.columns, c.nests), c.recommended, c.name);
  assert.equal(R.columnUsable({ groups: 2, records: 60 }), true);
  assert.equal(R.columnUsable({ groups: 2, records: 59 }), false, 'an average group under 30 records is refused');
  assert.equal(R.columnUsable({ groups: 501, records: 1e6 }), false, 'more than 500 groups is refused');
  assert.equal(R.columnUsable({ groups: 1, records: 1e6 }), false, 'one group is no grouping');
});

test('small groups move up a level exactly as the shared cases say', () => {
  for (const c of data().effective) assert.deepEqual(R.effectiveGroups(c.group_by, c.groups, c.time_series), c.expected, c.name);
});

test('custom groups under 30 records combine into Other groups, exactly as the shared cases say', () => {
  for (const c of data().custom) {
    const names = R.customGroupNames(c.sizes);
    assert.deepEqual(names, c.expected, c.name);
    assert.equal(new Set(Object.values(names)).size, c.groups, c.name);
    assert.equal(Object.values(c.sizes).filter((size) => size < R.GROUP_MIN_RECORDS).length, c.other_groups, c.name);
  }
});

test('First run defaults to about 1,000 records above 1,000 records, exactly as the shared cases say, never a recent period or everything', () => {
  for (const c of data().first_run.default) assert.equal(R.firstRunDefault({ records: c.records }), c.expected, c.name);
  const cases = [[999, 'all'], [1000, 'all'], [1001, 'records'], [718931, 'records'], [1e9, 'records'], [null, 'all'], [undefined, 'all']];
  assert.deepEqual(cases.map(([records]) => R.firstRunDefault({ records })), cases.map(([, want]) => want));
  for (const records of [1001, 5000, 718931, 1e9]) {
    for (const scope of ['all', 'recent', 'groups', '']) assert.notEqual(R.firstRunDefault({ records }), scope, `${records} records never default to ${scope || 'no pick'} (must-exclude)`);
  }
});

const rows = (pairs) => pairs.map(([column_name, data_type]) => ({ column_name, data_type }));

test('the time column is a dated column or a date key reached through a dated table, exactly as the shared cases say', () => {
  for (const c of data().first_run.time_source) {
    const refs = Object.fromEntries(Object.entries(c.ref_columns).map(([ref, pairs]) => [ref.toLowerCase(), rows(pairs)]));
    assert.deepEqual(R.timeSourceOf(c.named, rows(c.columns), c.joins, refs), c.expected, c.name);
  }
  for (const c of data().first_run.named_time) assert.equal(R.namedTimeColumn(c.roles, c.assessment, c.table), c.expected, c.name);
  for (const c of data().first_run.time_refs) assert.deepEqual(R.timeRefsOf(c.named, rows(c.columns), c.joins), c.expected, c.name);
});

test('a personal column is the same column the agent never profiles: the name and tag patterns match the notebook ones', () => {
  const notebook = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8'));
  const source = notebook.cells.map((c) => [].concat(c.source).join('')).join('\n');
  const raw = (block) => [...block.matchAll(/r"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
  const name = /DEEP_PII_NAME_RE = re\.compile\(([\s\S]*?)re\.IGNORECASE\)/.exec(source);
  const tag = /DEEP_PII_TAG_RE = re\.compile\(([\s\S]*?)re\.IGNORECASE\)/.exec(source);
  assert.ok(name && tag, 'the notebook holds both patterns');
  assert.equal(R.PERSONAL_NAME_RE.source, raw(name[1]));
  assert.equal(R.PERSONAL_TAG_RE.source, raw(tag[1]));
  assert.ok(R.PERSONAL_NAME_RE.flags.includes('i') && R.PERSONAL_TAG_RE.flags.includes('i'));
  for (const personal of ['c_email_address', 'c_first_name', 'c_birth_country', 'customer_phone_sk', 'ip']) assert.equal(R.personalColumn(personal), true, personal);
  for (const plain of ['i_category', 'ss_store_sk', 'region', 'ship_mode']) assert.equal(R.personalColumn(plain), false, `${plain} (must-exclude)`);
  assert.equal(R.personalColumn('i_brand', { class: 'pii' }), true, 'a tag marks a column personal');
});
