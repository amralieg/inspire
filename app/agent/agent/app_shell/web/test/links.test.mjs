import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialFilterState } from '../src/filters.js';
import {
  VIEWS_KEY, addView, buildHash, compactState, decodeFilters, describeFilters, encodeFilters, nameProblem, openedLink, parseHash, readLink, readSaved,
  readViews, removeView, restoreFilters, restoreView, sameView, writeViews,
} from '../src/links.js';

const PRESETS = [{ id: '3m', label: 'Last 3 months', from: '2026-08-01', to: '2026-10-15' }, { id: '12m', label: 'Last 12 months', from: '2025-11-01', to: '2026-10-15' },
  { id: 'all', label: 'All time', from: '2024-01-05', to: '2026-10-15' }];
const META = [
  { id: 'run_date', type: 'date_range', label: 'Run date', default: '12m', low: '2024-01-05', high: '2026-10-15', presets: PRESETS },
  { id: 'category', type: 'multi_select', label: 'Category', options: ['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports', 'مكتبة'] },
  { id: 'region', type: 'multi_select', label: 'Region', options: ['North', 'South'] },
];
const VIEWS = ['dashboard', 'runs', 'alerts'];
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
const store = (initial) => {
  const data = new Map(initial == null ? [] : [[VIEWS_KEY, initial]]);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};
const picked = (sel, range = { run_date: { preset: '12m', from: '2025-11-01', to: '2026-10-15' } }) => ({ range, sel });

test('the hash splits into the page, its view and its filters, and old links keep only the page', () => {
  assert.deepEqual(parseHash('#/n01_u05'), { route: 'n01_u05', section: '', tab: '', focus: '', v: null, f: null, rec: null, changed: false, present: false });
  assert.deepEqual(parseHash('#/n01_u05?v=runs&f=abc'), { route: 'n01_u05', section: '', tab: '', focus: '', v: 'runs', f: 'abc', rec: null, changed: false, present: true });
  assert.deepEqual(parseHash('#n01_u05?f=x'), { route: 'n01_u05', section: '', tab: '', focus: '', v: null, f: 'x', rec: null, changed: false, present: true });
  assert.deepEqual(parseHash('#/n01_u05/work?tab=done&f=x'), { route: 'n01_u05', section: 'work', tab: 'done', focus: '', v: null, f: 'x', rec: null, changed: false, present: true });
  assert.equal(parseHash('#/n01_u05/runs').present, false, 'a section alone keeps the filters already picked');
  assert.equal(parseHash('').route, '');
  assert.equal(parseHash(undefined).route, '');
  assert.equal(parseHash('#/home').route, 'home');
  assert.equal(parseHash('#/a%20b').route, 'a b');
  assert.equal(parseHash('#/bad%E0%A4%A').route, 'bad%E0%A4%A');
});

test('filters encode to base64url and decode back, Unicode included', () => {
  const compact = { r: { run_date: ['2025-01-01', '2025-03-31'] }, s: { category: ['مكتبة', 'Books'], region: ['North'] }, x: '🚚?/+' };
  const text = encodeFilters(compact);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeFilters(text), compact);
});

test('a malformed or non-object f decodes to nothing instead of throwing', () => {
  for (const bad of ['%%%', 'a', '', 'ab+/', b64('not json'), b64('[1,2]'), b64('null'), b64('42'), b64('"text"'), null, undefined]) {
    assert.equal(decodeFilters(bad), null, String(bad));
  }
  assert.equal(decodeFilters(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64url')), null, 'invalid UTF-8');
});

test('the compact state keeps only what differs from the defaults', () => {
  assert.deepEqual(compactState(initialFilterState(META), META), {});
  assert.deepEqual(compactState(picked({ category: ['Music'] }), META), { s: { category: ['Music'] } });
  assert.deepEqual(compactState(picked({}, { run_date: { preset: '3m', from: '2026-08-01', to: '2026-10-15' } }), META), { r: { run_date: '3m' } });
  assert.deepEqual(compactState(picked({}, { run_date: { preset: 'custom', from: '2025-02-01', to: '2025-04-30' } }), META), { r: { run_date: ['2025-02-01', '2025-04-30'] } });
  assert.deepEqual(compactState(picked({}, { run_date: { preset: 'custom', from: '', to: '2025-04-30' } }), META), {});
  assert.deepEqual(compactState(picked({ ghost: ['x'], region: [] }), META), {});
  assert.deepEqual(compactState(undefined, META), {});
});

test('a link round trips through the hash', () => {
  const state = picked({ category: ['Music', 'مكتبة'] }, { run_date: { preset: 'custom', from: '2025-02-01', to: '2025-04-30' } });
  const hash = buildHash('n01_u05', 'alerts', state, META);
  assert.match(hash, /^#\/n01_u05\/alerts\?f=[A-Za-z0-9_-]+$/);
  assert.deepEqual(readLink(parseHash(hash), META, VIEWS), { state, view: 'alerts', dropped: false });
  assert.equal(buildHash('n01_u05', 'overview', initialFilterState(META), META), '#/n01_u05/dashboard', 'the old Overview view is the dashboard');
  assert.equal(buildHash('n01_u05', 'runs', initialFilterState(META), META), '#/n01_u05/runs');
  assert.equal(buildHash('n01_u05', 'work', initialFilterState(META), META, null, undefined, 'done'), '#/n01_u05/work?tab=done');
  assert.equal(buildHash('n01_u05', 'runs', initialFilterState(META), META, null, undefined, 'done'), '#/n01_u05/runs', 'only Work keeps a tab');
});

test('a link to one record keeps its key next to the view and filters', () => {
  const state = picked({ category: ['Music'] });
  const hash = buildHash('n01_u05', 'runs', state, META, 'R 7/&x');
  const back = parseHash(hash);
  assert.equal(back.rec, 'R 7/&x');
  assert.equal(back.route, 'n01_u05');
  assert.deepEqual(readLink(back, META, VIEWS), { state, view: 'runs', dropped: false });
  assert.equal(buildHash('n01_u05', 'overview', null, [], 'k1'), '#/n01_u05/dashboard?rec=k1');
  assert.equal(parseHash('#/n01_u05?rec=').rec, '');
  assert.equal(parseHash('#/n01_u05?v=runs').present, true);
  assert.equal(parseHash('#/n01_u05?rec=k1').present, false);
});

test('values that no longer exist are dropped and flagged, the rest still apply', () => {
  const { state, dropped } = restoreFilters({ r: { run_date: '3m' }, s: { category: ['Music', 'Vinyl'], ghost: ['x'] } }, META);
  assert.equal(dropped, true);
  assert.deepEqual(state.sel, { category: ['Music'] });
  assert.deepEqual(state.range.run_date, { preset: '3m', from: '2026-08-01', to: '2026-10-15' });
  const cases = [
    { r: { run_date: ['2023-01-01', '2024-02-01'] } },
    { r: { run_date: ['2026-09-01', '2026-11-01'] } },
    { r: { run_date: ['2026-05-01', '2026-02-01'] } },
    { r: { run_date: ['2026-02-30', '2026-03-01'] } },
    { r: { run_date: ['2026-02-01'] } },
    { r: { run_date: 'custom' } },
    { r: { run_date: '7y' } },
    { r: { category: '3m' } },
    { s: { run_date: ['3m'] } },
    { s: { region: 'North' } },
    { s: { region: [1, true, null] } },
    { r: [] },
    { s: 'x' },
    { t: 1 },
  ];
  for (const compact of cases) {
    const out = restoreFilters(compact, META);
    assert.equal(out.dropped, true, JSON.stringify(compact));
    assert.deepEqual(out.state, initialFilterState(META), JSON.stringify(compact));
  }
});

test('a valid link is not flagged, duplicates collapse, and a filter whose choices failed keeps its values', () => {
  assert.deepEqual(restoreFilters({ s: { region: ['North', 'North'] } }, META), { state: picked({ region: ['North'] }), dropped: false });
  assert.deepEqual(restoreFilters({}, META), { state: initialFilterState(META), dropped: false });
  assert.deepEqual(restoreFilters({ r: { run_date: ['2024-01-05', '2026-10-15'] } }, META).dropped, false);
  const failed = [{ id: 'region', type: 'multi_select', label: 'Region', error: 'timed out' }];
  assert.deepEqual(restoreFilters({ s: { region: ['East'] } }, failed), { state: { range: {}, sel: { region: ['East'] } }, dropped: false });
  assert.deepEqual(restoreFilters({ s: { region: ['East'] } }, [{ id: 'region', type: 'multi_select', label: 'Region' }]).dropped, true);
  assert.deepEqual(restoreFilters({ r: { run_date: ['2001-01-01', '2002-01-01'] } }, [{ id: 'run_date', type: 'date_range', label: 'Run date' }]).dropped, false);
});

test('a link that is not an object or names an unknown view falls back to the defaults', () => {
  assert.deepEqual(restoreFilters(null, META), { state: initialFilterState(META), dropped: true });
  assert.deepEqual(restoreFilters([1], META), { state: initialFilterState(META), dropped: true });
  assert.deepEqual(restoreView('runs', VIEWS), { view: 'runs', dropped: false });
  assert.deepEqual(restoreView(null, VIEWS), { view: 'dashboard', dropped: false });
  assert.deepEqual(restoreView('pivot', VIEWS), { view: 'dashboard', dropped: true });
  assert.deepEqual(restoreView('runs', ['dashboard']), { view: 'dashboard', dropped: true });
  assert.deepEqual(restoreView('trend', VIEWS), { view: 'dashboard', dropped: true }, 'the Trend tab is gone, so an old link to it opens Things to fix');
  assert.deepEqual(readLink(parseHash('#/p?f=%%%'), META, VIEWS), { state: initialFilterState(META), view: 'dashboard', dropped: true });
  assert.deepEqual(readLink(parseHash(`#/p?f=${b64('[1]')}`), META, VIEWS).dropped, true);
  assert.deepEqual(readLink(parseHash('#/p?v='), META, VIEWS).dropped, false, 'an empty view is the dashboard');
  assert.deepEqual(readLink(parseHash('#/p?v=runs'), META, VIEWS), { state: initialFilterState(META), view: 'runs', dropped: false });
  assert.deepEqual(readLink(parseHash(`#/p?v=trend&f=${encodeFilters({ s: { region: ['South'] } })}`), META, VIEWS),
    { state: picked({ region: ['South'] }), view: 'dashboard', dropped: true }, 'an old Trend link keeps its filters and opens Things to fix');
});

test('a saved view restores through the same checks as a link', () => {
  assert.deepEqual(readSaved({ name: 'Mine', view: 'runs', filters: { s: { region: ['South'] } } }, META, VIEWS), { state: picked({ region: ['South'] }), view: 'runs', dropped: false });
  assert.equal(readSaved({ name: 'Old', view: 'runs', filters: { s: { region: ['West'] } } }, META, VIEWS).dropped, true);
  assert.deepEqual(readSaved({ name: 'Old trend', view: 'trend', filters: { s: { region: ['South'] } } }, META, VIEWS),
    { state: picked({ region: ['South'] }), view: 'dashboard', dropped: true }, 'a view saved on the Trend tab opens Things to fix with its filters');
  assert.ok(sameView({ view: 'dashboard', filters: { s: { region: ['South'] } } }, { view: undefined, filters: { s: { region: ['South'] } } }));
  assert.ok(!sameView({ view: 'runs', filters: {} }, { view: 'dashboard', filters: {} }));
});

test('the filters read as words for print', () => {
  assert.equal(describeFilters(picked({ category: ['Music', 'Books'] }), META), 'Run date: last 12 months; Category: Music, Books');
  assert.equal(describeFilters(picked({}, { run_date: { preset: 'custom', from: '2025-02-01', to: '2025-04-30' } }), META), 'Run date: 2025-02-01 to 2025-04-30');
  assert.equal(describeFilters(picked({ category: ['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports', 'مكتبة'] }), META),
    'Run date: last 12 months; Category: Books, Music, Home, Garden, Toys and 2 more');
  assert.equal(describeFilters({ range: {}, sel: {} }, []), 'none');
  assert.equal(describeFilters(undefined, undefined), 'none');
});

test('saved views refuse a blank, a 61-character or a duplicate name, and the 21st view', () => {
  const list = [{ name: 'Weekly review', view: 'overview', filters: {} }];
  assert.equal(nameProblem('', list), 'Give the view a name.');
  assert.equal(nameProblem('   ', list), 'Give the view a name.');
  assert.equal(nameProblem('x'.repeat(61), list), 'Use 60 characters or fewer.');
  assert.equal(nameProblem('x'.repeat(60), list), '');
  assert.equal(nameProblem('🚚'.repeat(60), list), '');
  assert.equal(nameProblem(' weekly REVIEW ', list), 'A view with this name is already saved on this page.');
  const full = Array.from({ length: 20 }, (_, i) => ({ name: `View ${i}`, view: 'overview', filters: {} }));
  assert.equal(nameProblem('One more', full), 'This page already keeps 20 saved views. Delete one to save another.');
  assert.equal(nameProblem('One more', full.slice(1)), '');
  const refused = addView({ p: full }, 'p', { name: 'One more', view: 'overview', filters: {} });
  assert.equal(refused.all.p.length, 20);
  assert.match(refused.problem, /20 saved views/);
  const added = addView({ other: list }, 'p', { name: '  Music  ', view: 'runs', filters: { s: { region: ['North'] } } });
  assert.deepEqual(added, { all: { other: list, p: [{ name: 'Music', view: 'runs', filters: { s: { region: ['North'] } } }] }, problem: '' });
});

test('removing a view keeps the others and drops an empty page', () => {
  const all = { p: [{ name: 'A', view: 'overview', filters: {} }, { name: 'B', view: 'overview', filters: {} }], q: [{ name: 'C', view: 'overview', filters: {} }] };
  assert.deepEqual(removeView(all, 'p', 'A'), { p: [{ name: 'B', view: 'overview', filters: {} }], q: all.q });
  assert.deepEqual(removeView(all, 'q', 'C'), { p: all.p });
  assert.deepEqual(removeView(all, 'zz', 'A'), all);
});

test('corrupt saved views in storage are ignored safely', () => {
  for (const raw of ['{not json', '[1,2]', 'null', '"x"', '42', null]) assert.deepEqual(readViews(store(raw)), {}, String(raw));
  assert.deepEqual(readViews(null), {});
  assert.deepEqual(readViews({ getItem: () => { throw new Error('denied'); } }), {});
  const mixed = JSON.stringify({
    p: [{ name: 'Good', view: 'runs', filters: { s: { region: ['North'] } } }, { name: 5 }, null, 'x', { name: '  ' }, { name: 'good' }, { name: 'Bare' }],
    q: 'not a list',
    r: [],
  });
  assert.deepEqual(readViews(store(mixed)), { p: [{ name: 'Good', view: 'runs', filters: { s: { region: ['North'] } } }, { name: 'Bare', view: 'dashboard', filters: {} }] });
  const many = JSON.stringify({ p: Array.from({ length: 25 }, (_, i) => ({ name: `V${i}` })) });
  assert.equal(readViews(store(many)).p.length, 20);
});

test('writing views stores JSON and reports a refused write', () => {
  const s = store(null);
  assert.equal(writeViews(s, { p: [{ name: 'A', view: 'overview', filters: {} }] }), true);
  assert.deepEqual(JSON.parse(s.data.get(VIEWS_KEY)), { p: [{ name: 'A', view: 'overview', filters: {} }] });
  assert.equal(writeViews({ setItem: () => { throw new Error('QuotaExceededError'); } }, {}), false);
  assert.equal(writeViews(null, {}), false);
});

test('an email link names the screen in the query, which a sign-in keeps, and the App turns it into its own hash route', () => {
  assert.equal(openedLink({ pathname: '/', search: '?open=impact', hash: '' }), '/#/impact');
  assert.equal(openedLink({ pathname: '/run/n01-u05/', search: '?a=1&open=impact&b=2', hash: '#/n01_u05' }), '/run/n01-u05/?a=1&b=2#/impact');
  assert.equal(openedLink({ pathname: '/', search: '?open=%3Cscript%3E', hash: '#/n01_u05' }), '/#/n01_u05', 'a name that is not a route is dropped');
  assert.equal(openedLink({ pathname: '/', search: '?open=', hash: '' }), '/');
  assert.equal(openedLink({ pathname: '/', search: '', hash: '#/impact' }), '', 'no open parameter leaves the address alone');
  assert.equal(openedLink({ pathname: '/', search: '?run=n01-u05', hash: '' }), '');
  assert.equal(openedLink(), '');
});
