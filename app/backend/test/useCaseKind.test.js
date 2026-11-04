const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeV130UseCaseFields } = require('../lib/inspireJobParams');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const REGISTRY = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'agent', 'agent', 'app_shell', 'kinds.json'), 'utf8'));

const STORED = {
  use_case_kind: 'forecast', kind_family: 'predict', app_layout: 'forecast_cockpit',
  serving_summary: 'A forecast cockpit for the planner.', method_summary: 'Forecasting: past sales project the next weeks.',
  value_source: 'Better orders: fewer stock-outs.', 'Analytics Technique': 'Classification',
};

test('every family in kinds.json carries a color the chips read', () => {
  assert.equal(REGISTRY.families.length, 10);
  for (const family of REGISTRY.families) assert.match(family.color || '', /^#[0-9a-f]{6}$/, family.id);
  assert.equal(new Set(REGISTRY.families.map((f) => f.color)).size, REGISTRY.families.length, 'each family has its own color');
});

test('a stored kind wins over the technique, and its 3 lines are read in order', async () => {
  const { useCaseKindView } = await lib('useCaseKind.js');
  const view = useCaseKindView(STORED);
  assert.equal(view.id, 'forecast');
  assert.equal(view.family, 'predict');
  assert.equal(view.familyLabel, 'Predict');
  assert.equal(view.color, REGISTRY.families.find((f) => f.id === 'predict').color);
  assert.deepEqual(view.lines.map((l) => [l.key, l.label, l.text]), [
    ['serving', 'What we serve', STORED.serving_summary],
    ['method', 'How it works', STORED.method_summary],
    ['value', 'Where the value comes from', STORED.value_source],
  ]);
});

test('an old row with no kind derives it from the technique, and an unknown technique has none (must-reject)', async () => {
  const { useCaseKindView } = await lib('useCaseKind.js');
  const old = useCaseKindView({ 'Analytics Technique': 'Classification' });
  assert.equal(old.id, 'risk_propensity');
  assert.deepEqual(old.lines, [], 'an old row has no stored lines, and the frontend never invents them');
  assert.equal(useCaseKindView({ analytics_technique: 'clustering' }).id, 'segmentation');
  assert.equal(useCaseKindView({ 'Analytics Technique': 'Basket magic' }), null);
  assert.equal(useCaseKindView({}), null);
  assert.equal(useCaseKindView(null), null);
});

test('the stored kind id resolves through the shared registry helpers, and anything else falls back to the technique', async () => {
  const { useCaseKindView } = await lib('useCaseKind.js');
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseKind.js'), 'utf8');
  const shared = source.match(/import \{([^}]*)\} from '\.\/kinds\.js'/);
  assert.ok(shared && /\bkindOf\b/.test(shared[1]) && /\bkindForTechnique\b/.test(shared[1]) && /\bfamilyOf\b/.test(shared[1]));
  assert.doesNotMatch(source, /KINDS\.kinds\.find|Use Case Kind/, 'the kind is resolved by kindOf and kindForTechnique only');
  assert.equal(useCaseKindView({ use_case_kind: 'forecast', 'Analytics Technique': 'Classification' }).id, 'forecast');
  for (const named of ['Forecast', '5', '5. Forecast', 'Basket magic']) {
    assert.equal(useCaseKindView({ use_case_kind: named, 'Analytics Technique': 'Classification' }).id, 'risk_propensity', named);
    assert.equal(useCaseKindView({ 'Use Case Kind': named, 'Analytics Technique': 'Classification' }).id, 'risk_propensity', named);
  }
  assert.equal(useCaseKindView({ use_case_kind: 'Basket magic' }), null);
});

test('the kind filter keeps a family or a kind and drops the rest (must-keep and must-reject)', async () => {
  const { KIND_FILTER_FAMILY, KIND_FILTER_KIND, matchesKindFilter, useCaseKindView } = await lib('useCaseKind.js');
  const forecast = useCaseKindView(STORED);
  const risk = useCaseKindView({ 'Analytics Technique': 'Classification' });
  assert.equal(matchesKindFilter(forecast, 'all'), true);
  assert.equal(matchesKindFilter(null, 'all'), true, 'no filter keeps a use case with no kind');
  assert.equal(matchesKindFilter(forecast, `${KIND_FILTER_FAMILY}predict`), true);
  assert.equal(matchesKindFilter(risk, `${KIND_FILTER_FAMILY}predict`), true, 'risk and propensity is in the predict family too');
  assert.equal(matchesKindFilter(forecast, `${KIND_FILTER_KIND}forecast`), true);
  assert.equal(matchesKindFilter(risk, `${KIND_FILTER_KIND}forecast`), false);
  assert.equal(matchesKindFilter(forecast, `${KIND_FILTER_FAMILY}detect_protect`), false);
  assert.equal(matchesKindFilter(null, `${KIND_FILTER_FAMILY}predict`), false);
  assert.equal(matchesKindFilter(forecast, 'forecast'), false, 'an unprefixed value is not a filter the page offers');
});

test('the filter options group the kinds present by family in registry order, with counts', async () => {
  const { kindFilterLabel, kindFilterOptions, useCaseKindView } = await lib('useCaseKind.js');
  const views = [STORED, { 'Analytics Technique': 'Classification' }, STORED, { 'Analytics Technique': 'Anomaly Detection' }, {}]
    .map(useCaseKindView);
  const options = kindFilterOptions(views);
  const order = REGISTRY.families.map((f) => f.id);
  assert.deepEqual(options.map((f) => f.value), ['family:predict', 'family:detect_protect'].sort((a, b) =>
    order.indexOf(a.slice(7)) - order.indexOf(b.slice(7))));
  const predict = options.find((f) => f.value === 'family:predict');
  assert.equal(predict.count, 3);
  assert.deepEqual(predict.kinds.map((k) => [k.value, k.count]), [['kind:forecast', 2], ['kind:risk_propensity', 1]]);
  assert.equal(kindFilterLabel('kind:forecast', options), 'Forecast');
  assert.equal(kindFilterLabel('family:predict', options), 'Predict');
  assert.deepEqual(kindFilterOptions([null, undefined]), []);
});

test('the v1.3.0 view carries the kind, and the tracking row copy brings the kind columns onto a results use case', async () => {
  const { copyV130TrackingFields, v130View } = await lib('v130UseCase.js');
  const uc = copyV130TrackingFields({ No: 'N01-U01', 'Analytics Technique': 'Classification' }, STORED);
  assert.equal(uc.use_case_kind, 'forecast');
  assert.equal(v130View(uc).kind.id, 'forecast');
  assert.equal(v130View({ 'Analytics Technique': 'Basket magic' }).kind, null);
});

test('the use case route normalizes the kind columns: blank is null, the selection basis is its text and the score gap a number', () => {
  const row = normalizeV130UseCaseFields({
    use_case_kind: ' forecast ', kind_family: 'predict', app_layout: '', serving_summary: null, method_summary: '  ',
    value_source: 'Fewer stock-outs.', selection_basis: ' kind_floor ', selection_replaced: 'N02-U04', selection_score_gap: '0.4',
  });
  assert.equal(row.use_case_kind, 'forecast');
  assert.equal(row.kind_family, 'predict');
  assert.equal(row.app_layout, null);
  assert.equal(row.serving_summary, null);
  assert.equal(row.method_summary, null);
  assert.equal(row.value_source, 'Fewer stock-outs.');
  assert.equal(row.selection_basis, 'kind_floor');
  assert.equal(row.selection_replaced, 'N02-U04');
  assert.equal(row.selection_score_gap, 0.4);
  assert.equal(normalizeV130UseCaseFields({ selection_basis: '{"basis":"elite"}' }).selection_basis, '{"basis":"elite"}', 'the basis is never parsed as JSON');
  const earned = normalizeV130UseCaseFields({ selection_basis: 'earned', selection_replaced: '', selection_score_gap: '' });
  assert.deepEqual([earned.selection_basis, earned.selection_replaced, earned.selection_score_gap], ['earned', null, null]);
  assert.equal(normalizeV130UseCaseFields({ selection_score_gap: 'about half' }).selection_score_gap, null);
  const old = normalizeV130UseCaseFields({ analytics_technique: 'Classification' });
  assert.equal(old.use_case_kind, null, 'an old row has no stored kind; the page derives it from the technique');
});

test('the list and detail title is the stored name with its technique, and the Name alone when a row has none', async () => {
  const { nameOfUseCase, cardTitlesOfUseCase } = await lib('useCaseFields.js');
  const { copyV130TrackingFields } = await lib('v130UseCase.js');
  const route = normalizeV130UseCaseFields({ Name: 'Forecast demand', name_with_technique: ' Forecast demand using forecasting ' });
  assert.equal(route.name_with_technique, 'Forecast demand using forecasting');
  assert.equal(normalizeV130UseCaseFields({ name_with_technique: '  ' }).name_with_technique, null);
  const uc = { Name: 'Forecast demand' };
  copyV130TrackingFields(uc, route);
  assert.equal(nameOfUseCase(uc), 'Forecast demand using forecasting');
  assert.equal(cardTitlesOfUseCase(uc).title, 'Forecast demand using forecasting');
  assert.equal(nameOfUseCase({ Name: 'Forecast demand', name_with_technique: null }), 'Forecast demand', 'an old row keeps its Name');
});

test('the use case route and the results page carry the Deep grouping and record level, and a blank one is null', async () => {
  const { copyV130TrackingFields } = await lib('v130UseCase.js');
  const route = normalizeV130UseCaseFields({ Name: 'Spot odd sales', suggested_group_by: ' item.category, store_sk ', record_level: ' ticket_number ' });
  assert.deepEqual([route.suggested_group_by, route.record_level], ['item.category, store_sk', 'ticket_number']);
  const blank = normalizeV130UseCaseFields({ suggested_group_by: '  ', record_level: null });
  assert.deepEqual([blank.suggested_group_by, blank.record_level], [null, null]);
  const uc = copyV130TrackingFields({ Name: 'Spot odd sales' }, route);
  assert.deepEqual([uc.suggested_group_by, uc.record_level], ['item.category, store_sk', 'ticket_number']);
});
