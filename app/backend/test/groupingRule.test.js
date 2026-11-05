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
  const { settings, constants, labels } = data();
  assert.deepEqual([settings.group_by.name, settings.group_by.label, settings.group_by.all, settings.group_by.custom],
    [R.GROUP_BY, R.GROUP_LABEL, R.GROUP_ALL, R.GROUP_CUSTOM]);
  assert.deepEqual(settings.group_by.solo, [R.GROUP_ALL]);
  assert.deepEqual([constants.group_min_records, constants.group_min_periods, constants.group_max_groups, constants.group_min_groups],
    [R.GROUP_MIN_RECORDS, R.GROUP_MIN_PERIODS, R.GROUP_MAX_GROUPS, R.GROUP_MIN_GROUPS]);
  assert.deepEqual([labels.global, labels.other, labels.no_group, labels.separator, labels.all_level, labels.custom_level],
    [R.GROUP_GLOBAL, R.GROUP_OTHER, R.GROUP_NONE, R.GROUP_SEPARATOR, R.GROUP_ALL, R.GROUP_CUSTOM]);
  assert.equal(R.groupPart('country', null), labels.missing.replace('{column}', 'country'));
  assert.equal(R.groupPart('country', '  '), 'no country');
  assert.equal('techniques' in data(), false, 'the techniques that need Data groups live in the kinds registry only, never in a second list');
  assert.deepEqual([R.FIRST_RUN_DEFAULT, R.SUGGESTED_GROUPS, R.SCOPE_DAYS, R.SCOPE_RECORDS], ['records', 3, 30, 1000]);
  assert.deepEqual([constants.first_run_records_line, constants.scope_via_keys_max], [R.SCOPE_RECORDS, R.SCOPE_VIA_KEYS_MAX]);
  assert.equal(constants.group_max_null_share, R.GROUP_MAX_NULL_SHARE);
  assert.deepEqual(R.RUN_SCOPES, ['all', 'groups', 'recent', 'records']);
});

test('the technique table of the kinds registry decides where Data groups apply, and where each record stands alone', () => {
  const { applies } = data();
  for (const c of applies) {
    assert.equal(R.groupingApplies(c.technique), c.applies, String(c.technique));
    assert.equal(R.techniqueRecords(c.technique), c.records, String(c.technique));
    assert.equal(R.standaloneRecords(c.technique), c.records === 'alone', String(c.technique));
  }
  assert.ok(applies.some((c) => c.applies) && applies.some((c) => !c.applies && c.records === '') && applies.some((c) => c.records === 'alone'));
  assert.equal(R.groupingApplies('Anomaly Detection for stores'), false, 'free text that only contains a registry label is no registry technique (must-exclude)');
  assert.equal(R.groupingApplies('Forecast'), false, 'a part of a label is no label (must-exclude)');
});

test('every technique of the kinds registry is classified once, as groups, alone or together', () => {
  const kinds = require('../../agent/agent/app_shell/kinds.json');
  const named = new Set([...Object.keys(kinds.technique_kind), ...kinds.kinds.flatMap((k) => k.techniques)]);
  assert.deepEqual([...named].filter((t) => !(t in R.TECHNIQUE_RECORDS)), [], 'a registry technique with no Data groups answer');
  assert.deepEqual(Object.keys(R.TECHNIQUE_RECORDS).filter((t) => !named.has(t)), [], 'a classified technique that is not in the registry');
  assert.deepEqual(Object.entries(R.TECHNIQUE_RECORDS).filter(([, kind]) => !R.TECHNIQUE_RECORD_KINDS.includes(kind)), []);
  const lowered = Object.keys(R.TECHNIQUE_RECORDS).map((t) => t.toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length, 'two labels that differ only by case would make the lookup ambiguous');
  for (const kind of R.TECHNIQUE_RECORD_KINDS) assert.ok(Object.values(R.TECHNIQUE_RECORDS).includes(kind), kind);
});

test('the Data groups text parses coarse to fine, and all and custom stand alone', () => {
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

test('First run defaults to about 1,000 records whatever the table holds, exactly as the shared cases say, never a recent period or everything', () => {
  for (const c of data().first_run.default) assert.equal(c.expected, R.FIRST_RUN_DEFAULT, c.name);
  assert.equal('firstRunDefault' in R, false, 'no second default rule that a record count can turn into everything');
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
