// Solution architecture diagram: every drawn arrow goes left to right through fixed stages, a backwards flow is listed as a feedback
// loop instead of drawn, governance and the build tool sit outside the flow, and long source lists are capped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, iconUrl, layoutArchitecture, shortName, stageOf, usd } from '../src/lib/architectureLayout.js';

const DESIGN = {
  components: [
    { id: 'lakeflow_jobs', lane: 'transform' },
    { id: 'mlflow', lane: 'ai' },
    { id: 'lakebase', lane: 'serve' },
    { id: 'databricks_app', lane: 'use' },
    { id: 'unity_catalog', lane: 'govern' },
    { id: 'genie_code', lane: 'build' },
  ],
  flows: [
    { from: 'lakeflow_jobs', to: 'mlflow' },
    { from: 'mlflow', to: 'lakebase' },
    { from: 'lakebase', to: 'databricks_app' },
    { from: 'databricks_app', to: 'mlflow', label: 'retrain' },
    { from: 'lakebase', to: 'unity_catalog' },
  ],
  sources: ['main.s.orders', 'main.s.customers'],
};

test('components sit in their stage column, and governance and the build tool are not drawn in the flow', () => {
  const L = layoutArchitecture(DESIGN);
  assert.deepEqual([...L.pos.keys()].sort(), ['databricks_app', 'lakebase', 'lakeflow_jobs', 'mlflow']);
  const x = (id) => L.pos.get(id).x;
  assert.ok(x('lakeflow_jobs') < x('mlflow') && x('mlflow') < x('lakebase') && x('lakebase') < x('databricks_app'));
  assert.equal(stageOf('ingest'), stageOf('transform'), 'ingest and transform share a stage');
  assert.equal(stageOf('unknown-lane'), 1);
  assert.equal(STAGES[0].label, 'Your data');
});

test('a flow pointing back is a feedback loop, not a drawn arrow, and a flow to a component outside the flow is dropped', () => {
  const L = layoutArchitecture(DESIGN);
  assert.deepEqual(L.loops.map((e) => `${e.from}>${e.to}`), ['databricks_app>mlflow']);
  assert.ok(L.forward.every((e) => L.pos.get(e.to).x > L.pos.get(e.from).x), 'every drawn arrow goes left to right');
  assert.ok(![...L.forward, ...L.same].some((e) => e.to === 'unity_catalog'));
});

test('the use case tables enter at the first stage, short names, and the source list is capped with a count of the rest', () => {
  const L = layoutArchitecture(DESIGN);
  assert.deepEqual(L.srcBoxes.map((s) => s.name), ['orders', 'customers']);
  assert.deepEqual(L.entries, ['lakeflow_jobs']);
  const many = layoutArchitecture({ ...DESIGN, sources: Array.from({ length: 9 }, (_, i) => `main.s.t${i}`) });
  assert.equal(many.srcBoxes.length, 6);
  assert.equal(many.more, 3);
  assert.deepEqual(layoutArchitecture({ ...DESIGN, sources: [] }).entries, [], 'no tables, no entry arrows');
});

test('an empty or broken design lays out without a crash', () => {
  for (const bad of [null, {}, { components: 'x', flows: null }]) {
    const L = layoutArchitecture(bad);
    assert.equal(L.pos.size, 0);
    assert.ok(L.height > 0);
  }
});

test('names, icons and money read as the diagram shows them', () => {
  assert.equal(shortName('AI Functions (ai_query, ai_classify, ai_forecast)'), 'AI Functions');
  assert.equal(shortName('Lakebase (Postgres)'), 'Lakebase');
  assert.equal(iconUrl('model_serving'), '/icons/databricks/model-serving.svg');
  assert.equal(iconUrl('not_in_catalogue'), '/icons/databricks/delta-lake-mark.svg');
  assert.equal(usd(1234.6), '$1,235');
  assert.equal(usd('x'), '$0');
});
