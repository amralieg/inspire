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
  assert.deepEqual(R.RUN_SCOPES, ['all', 'groups', 'recent', 'records']);
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

test('First run is the default above 1,000 records: chosen groups, then a recent period, then N records only when each record stands alone', () => {
  assert.equal(R.firstRunDefault({ records: 1000, groups: 900, recent: 10, standalone: true }), 'all', 'at the line everything runs');
  assert.equal(R.firstRunDefault({ records: 1001, groups: 300, recent: 10, standalone: true }), 'groups');
  assert.equal(R.firstRunDefault({ records: 1001, groups: 0, recent: 10, standalone: true }), 'recent');
  assert.equal(R.firstRunDefault({ records: 1001, groups: 0, recent: 0, standalone: true }), 'records');
  assert.equal(R.firstRunDefault({ records: 1001, groups: 0, recent: 0, standalone: false }), 'all',
    'N records is never offered when records depend on each other, so with no group and no time column only everything is left (must-exclude)');
});
