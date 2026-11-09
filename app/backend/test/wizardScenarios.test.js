const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/groupingRule');
const GP = require('../lib/groupingProfile');

const TABLE = 'main.retail.sales';

function storeView(groups, perGroup, { type = 'STRING', name = 'store', technique = 'Anomaly Detection', approx = groups, extra = [] } = {}) {
  const columns = [{ column_name: name, data_type: type }, ...extra.map((c) => ({ column_name: c.name, data_type: 'STRING' }))];
  const candidates = R.groupingCandidates(columns, {}, TABLE);
  const values = [];
  const stats = { records: String(groups * perGroup) };
  const sample = [];
  candidates.forEach((column, at) => {
    const own = column === name ? { groups, approx, per: perGroup } : extra.find((c) => c.name === column);
    stats[`d${at}`] = String(own.approx ?? own.groups);
    stats[`n${at}`] = '0';
    sample.push({ kind: 'size', coarse: String(at), fine: '-1', groups: String(own.groups), records: String(own.groups * own.per) });
    if ((own.approx ?? own.groups) <= GP.PROFILE_APPROX_MAX) {
      for (let i = 0; i < own.groups; i += 1) values.push({ col: String(at), value: `${column}-${i}`, records: String(own.per) });
    }
  });
  return GP.profileView({ table: TABLE, technique, columns, candidates, stats, sample, values, paths: null, time: null, days: 30, readAt: 'now' });
}

test('Data groups scale: 2, 31 and 500 groups are offered and counted, 1 group is no split (must-exclude)', () => {
  for (const groups of [2, 31, R.GROUP_MAX_GROUPS]) {
    const view = storeView(groups, 40);
    assert.deepEqual([view.qualifies, view.recommended, view.group_count, view.group_list.length], [true, ['store'], groups, groups], `${groups} groups`);
    assert.equal(view.reason, `Inspire recommends store because Anomaly Detection works out what is normal inside each group, and store splits ${TABLE} `
      + `into ${groups} groups.`);
  }
  const one = storeView(1, 40);
  assert.deepEqual([one.qualifies, one.recommended, one.columns, one.group_count], [false, [], [], 0]);
});

test('a column with more groups than Inspire models is named in the reason with its count, exact when counted, about when estimated (must-exclude)', () => {
  const many = storeView(540, 40, { approx: 520 });
  assert.deepEqual([many.qualifies, many.columns, many.group_count], [false, [], 0], 'a 540-group column is never offered');
  assert.equal(many.reason, `Inspire recommends the whole data as one group because no column of ${TABLE} or of a table it joins splits it into 2 to 500 `
    + 'groups with 30 records each on average. store makes 540 groups, more than the 500 Inspire models one by one.');
  const huge = storeView(4000, 40, { approx: 4100 });
  assert.match(huge.reason, / store makes about 4,100 groups, more than the 500 Inspire models one by one\.$/);
  const beside = storeView(540, 40, { approx: 540, extra: [{ name: 'region', groups: 5, per: 4320 }] });
  assert.deepEqual(beside.recommended, ['region']);
  assert.equal(beside.reason, `Inspire recommends region because Anomaly Detection works out what is normal inside each group, and region splits ${TABLE} `
    + 'into 5 groups. store makes 540 groups, more than the 500 Inspire models one by one.');
  assert.doesNotMatch(storeView(31, 40).reason, /more than the/, 'no column over the limit, no extra sentence');
  assert.doesNotMatch(storeView(1, 40).reason, /more than the/, 'one group is too few, not too many');
});

test('an empty table says it holds no records yet, never that no column splits it', () => {
  const empty = storeView(0, 40);
  assert.equal(empty.records, 0);
  assert.equal(empty.reason, `Inspire recommends the whole data as one group because ${TABLE} holds no records yet, so no column can split it into groups.`);
  const alone = storeView(0, 40, { technique: 'Sentiment Analysis' });
  assert.match(alone.reason, /^Data groups do not apply: Sentiment Analysis looks at each record on its own/, 'a technique that does not group keeps its own reason');
});

test('a segment column only groups the data when Databricks can group by its type, in the App and the agent alike (must-exclude)', () => {
  const roles = { segment: `${TABLE}.tier` };
  const offered = (type) => R.groupingCandidates([{ column_name: 'tier', data_type: type }, { column_name: 'region', data_type: 'STRING' }], roles, TABLE);
  for (const type of ['STRING', 'string collate UTF8_LCASE', 'VARCHAR(20)', 'BOOLEAN', 'INT', 'BIGINT', 'DECIMAL(10,2)', 'DATE', 'TIMESTAMP', 'TIMESTAMP_NTZ']) {
    assert.deepEqual(offered(type), ['tier', 'region'], type);
  }
  for (const type of ['MAP<STRING,STRING>', 'map<string, int>', 'VARIANT', 'ARRAY<STRING>', 'STRUCT<a: INT>', 'BINARY', 'GEOGRAPHY(4326)', 'INTERVAL DAY', 'DOUBLE', '']) {
    assert.deepEqual(offered(type), ['region'], `${type || 'no type'} is never a Data groups column`);
  }
});

test('group values in other scripts, with commas, slashes or quotes reach the list as they are', () => {
  const columns = [{ column_name: 'city', data_type: 'STRING' }];
  const odd = ['دبي', 'Abu Dhabi, Al Ain', 'A / B', "O'Hare", '東京', 'ﺍﻟﺸﺎﺭﻗﺔ'];
  const values = odd.map((value) => ({ col: '0', value, records: '40' }));
  const view = GP.profileView({ table: TABLE, technique: 'Anomaly Detection', columns, candidates: R.groupingCandidates(columns, {}, TABLE),
    stats: { records: String(odd.length * 40), d0: String(odd.length), n0: '0' }, sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: String(odd.length), records: '240' }],
    values, paths: null, time: null, days: 30, readAt: 'now' });
  assert.deepEqual(view.group_list.map((g) => g.value).sort(), [...odd].sort());
  assert.ok(view.group_list.every((g) => g.parts.length === 1 && g.parts[0].column === 'city' && g.parts[0].value === g.value));
});
