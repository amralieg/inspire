const test = require('node:test');
const assert = require('node:assert/strict');
const LE = require('../lib/lakebaseEnforce');

const REGION = { column: 'region', parameter: 'region_key' };
const MAPPED = 'EXISTS (SELECT 1 FROM main.sec.user_region m WHERE m.region = region_key AND m.user_email = current_user())';

test('the standard user-to-key shapes translate to a mapping the database can enforce', () => {
  assert.deepEqual(LE.rowFilterMapping(`RETURN ${MAPPED}`, REGION),
    { map: 'main.sec.user_region', key: 'region', principal: 'user_email', column: 'region' });
  assert.deepEqual(LE.rowFilterMapping('region_key IN (SELECT m.region FROM main.sec.map m WHERE is_account_group_member(m.grp))', REGION),
    { map: 'main.sec.map', key: 'region', principal: 'grp', column: 'region' }, 'a group column is a principal too');
  assert.deepEqual(LE.rowFilterMapping(
    'exists(select 1 from `main`.`sec`.`map` m where m.region = region_key and (m.grp = current_user() or is_account_group_member(m.grp)))', REGION),
  { map: 'main.sec.map', key: 'region', principal: 'grp', column: 'region' }, 'a user or a group on the same column, quoted names');
});

test('a row filter that is not the mapping shape is refused, so that table reads Delta (must-exclude)', () => {
  const refused = [
    'EXISTS (SELECT 1 FROM main.sec.map m WHERE m.region = region_key AND m.user_email = current_user() AND m.active)',
    'is_account_group_member(\'admins\') OR region_key = \'EU\'',
    'EXISTS (SELECT 1 FROM main.sec.map m WHERE m.region = other AND m.user_email = current_user())',
    'EXISTS (SELECT 1 FROM main.sec.map m WHERE m.region = region_key AND m.a = current_user() OR m.b = current_user())',
    'region_key = current_user()',
    'CASE WHEN is_account_group_member(\'x\') THEN true ELSE region_key = \'EU\' END',
    'EXISTS (SELECT 1 FROM main.sec.map m WHERE m.region = region_key AND m.user_email = current_user() UNION SELECT 1)',
  ];
  for (const body of refused) assert.equal(LE.rowFilterMapping(body, REGION), null, body);
});

test('a table with no row filter and no mask is enforced with no mapping; a masked table is not, whatever its filter', () => {
  assert.deepEqual(LE.tableEnforcement('main.s.t', {}, null), { table: 'main.s.t', enforced: true, mapping: null, column: '', reason: '' });
  const masked = { row_filter: { function_name: 'main.s.fn', input_column_names: ['region'] }, columns: [{ name: 'ssn', mask: { function_name: 'm' } }] };
  const got = LE.tableEnforcement('main.s.t', masked, { body: MAPPED, parameters: ['region_key'] });
  assert.equal(got.enforced, false);
  assert.match(got.reason, /a column mask hides ssn/);
});

test('a row filter Inspire cannot read, or that reads more than one column, is not enforced and says why', () => {
  const filtered = { row_filter: { function_name: 'main.s.fn', input_column_names: ['region'] }, columns: [] };
  assert.equal(LE.tableEnforcement('main.s.t', filtered, null).reason, 'Inspire could not read the row filter main.s.fn');
  const two = { row_filter: { function_name: 'main.s.fn', input_column_names: ['region', 'day'] }, columns: [] };
  const got = LE.tableEnforcement('main.s.t', two, { body: MAPPED, parameters: ['region_key', 'day'] });
  assert.equal(got.enforced, false);
  assert.match(got.reason, /reads more than one column/);
});

test('every table is judged on its own: one that translates does not carry one that does not (must-exclude)', async () => {
  const tables = {
    'main.s.orders': { row_filter: { function_name: 'main.s.orders_fn', input_column_names: ['region'] }, columns: [] },
    'main.s.returns': { row_filter: { function_name: 'main.s.returns_fn', input_column_names: ['region'] }, columns: [] },
    'main.s.plain': { columns: [] },
  };
  const routines = {
    'main.s.orders_fn': { routine_definition: MAPPED, input_params: { parameters: [{ name: 'region_key' }] } },
    'main.s.returns_fn': { routine_definition: 'region_key = \'EU\'', input_params: { parameters: [{ name: 'region_key' }] } },
  };
  const fetched = [];
  const fetchJson = async (path) => {
    fetched.push(path);
    const table = /unity-catalog\/tables\/(.+)$/.exec(path);
    if (table) return tables[decodeURIComponent(table[1])] ? { ok: true, status: 200, data: tables[decodeURIComponent(table[1])] } : { ok: false, status: 404, data: {} };
    const fn = /unity-catalog\/functions\/(.+)$/.exec(path);
    return { ok: true, status: 200, data: routines[decodeURIComponent(fn[1])] };
  };
  const got = await LE.tablesEnforcement(['main.s.orders', 'main.s.returns', 'main.s.plain', 'main.s.gone'], fetchJson);
  assert.equal(got['main.s.orders'].enforced, true);
  assert.equal(got['main.s.orders'].mapping.principal, 'user_email');
  assert.equal(got['main.s.returns'].enforced, false);
  assert.equal(got['main.s.plain'].enforced, true);
  assert.equal(got['main.s.gone'].enforced, false);
  assert.equal(got['main.s.gone'].reason, 'Inspire could not read the table main.s.gone');
  assert.equal(fetched.filter((p) => p.includes('/functions/')).length, 2, 'only tables with a row filter have their function read');
});

test('a fetch that throws marks that table unreadable and leaves the others judged', async () => {
  const fetchJson = async (path) => {
    if (path.includes('bad')) throw new Error('socket hang up');
    return { ok: true, status: 200, data: {} };
  };
  const got = await LE.tablesEnforcement(['main.s.bad', 'main.s.good'], fetchJson);
  assert.deepEqual(got['main.s.bad'], { table: 'main.s.bad', enforced: false, reason: 'Inspire could not read the table main.s.bad' });
  assert.equal(got['main.s.good'].enforced, true);
});
