const test = require('node:test');
const assert = require('node:assert/strict');

const { notebookParamsFromSessionForGenerateRun } = require('../lib/inspireSessionParams');
const { INSPIRE_NOTEBOOK_WIDGET_KEYS, sanitizeInspireNotebookJobParams } = require('../lib/inspireJobParams');

const v121Session = {
  business_name: 'Acme',
  inspire_database_name: 'main._inspire',
  table_election_mode: 'All Tables',
  use_cases_quality: 'Balanced',
  catalogs: 'samples',
  schemas_str: 'samples.tpcds_sf1',
  generate_choices: 'PDF Catalog,Genie Code Instructions',
  output_language: 'English',
  business_priorities: 'Reduce Cost',
};

test('a session with no generation choice starts its Generate run with no documents, and a picked format is kept (REQ-077)', () => {
  const none = notebookParamsFromSessionForGenerateRun({ ...v121Session, generate_choices: '' }, '42');
  assert.equal(none['09_generation_options'], '');
  const picked = notebookParamsFromSessionForGenerateRun({ ...v121Session, generate_choices: 'Presentation' }, '42');
  assert.equal(picked['09_generation_options'], 'Presentation');
});

test('Route 1 on a v1.2.1 session falls back to Standard Discovery and no strategy', () => {
  const params = notebookParamsFromSessionForGenerateRun({ ...v121Session }, '42');
  assert.equal(params['15_operation'], 'Generate Use Cases');
  assert.equal(params['03_discovery_type'], 'Standard Discovery', 'older sessions never show aggregates to the AI');
  assert.equal(params['10_strategic_context'], '');
  assert.equal(params['05_use_cases_quality'], 'Good');
  assert.equal(params['09_generation_options'], 'PDF Catalog');
  assert.equal(params['14_session_id'], '42');
  const sanitized = sanitizeInspireNotebookJobParams({ ...params });
  assert.deepEqual(Object.keys(sanitized), INSPIRE_NOTEBOOK_WIDGET_KEYS.filter((k) => k in sanitized));
  assert.equal(sanitized['03_discovery_type'], 'Standard Discovery');
});

test('Route 1 on a v1.3.0 session carries its discovery type and strategy', () => {
  const tree = '{"source":"customer","levels":["Pillar"],"strategy":[{"id":"S1","name":"Customer"}]}';
  const params = notebookParamsFromSessionForGenerateRun(
    { ...v121Session, discovery_type: 'Deep', strategic_context: `  ${tree}  ` }, '43');
  assert.equal(params['03_discovery_type'], 'AI Enhanced Discovery', 'a stored Deep session keeps its mode under the new name');
  assert.equal(params['10_strategic_context'], tree);
});

test('Route 1 treats SQL NULL columns like a missing value', () => {
  const params = notebookParamsFromSessionForGenerateRun({ ...v121Session, discovery_type: null, strategic_context: null }, '44');
  assert.equal(params['03_discovery_type'], 'Standard Discovery');
  assert.equal(params['10_strategic_context'], '');
});
