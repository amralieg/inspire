// REQ-387: the App reads naming uses the one rule (inspireOwnObjects.js); a person's table named like a working view keeps its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appReadsName } from '../src/lib/implementWizard.js';
import { isInspireOwnName } from '../src/lib/inspireOwnObjects.js';

test('an Inspire working view reads as the working copy, a person table keeps its name (REQ-387)', () => {
  assert.equal(appReadsName('main.s.orders__implement_scope'), "this use case's working copy of its data");
  assert.equal(appReadsName('main.s.__inspire_usecases'), "this use case's working copy of its data");
  assert.equal(appReadsName('main.s.customer_scope'), 'main.s.customer_scope');
  assert.equal(appReadsName('main.s.scope'), 'main.s.scope');
  assert.equal(isInspireOwnName('main.s.scope'), false);
});

// Real names, as the live schemas list them (names only). Each family is named by a notebook function (see inspireOwnObjects.js).
const REAL_OWN = [
  // implement scope views: <catalog>__<schema>__<table>__<tag>__implement_scope, then __candidate and/or __v<N> (scope_named, _implement_view_suffix)
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope__v10',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope__v7',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02_s42__implement_scope__candidate',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02_s42__implement_scope__candidate__v3',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_e2e_walk_n06_u01_n06_u01_results__nodes__n06_u01__implement_scope__v2',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_walk_v153_e2e_n01_u02_n01_u02_results__signal__n01_u02__implement_scope__v9',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_happy_path_bakehouse_2_n01_u01_n01_u01_results__bridge__n01_u01_s42__implement_scope__v4',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7_walk_rc7e_bakehouse_sales_transactions__n01_u01__implement_scope__v2',
  'inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_nyctaxi__trips__n01_u02_s42__implement_scope',
  // control, tracking and feedback tables in the Inspire database schema
  'inspire_kinds_rc7._inspire.__inspire_usecases',
  'inspire_kinds_rc7._inspire.__inspire_session',
  'inspire_kinds_rc7._inspire.__inspire_control_log',
  'inspire_kinds_rc7._inspire.__inspire_app_feedback_abc123',
  'inspire_kinds_rc7._inspire._ailogs',
  // run result tables and their companions, in the use case schemas (inspire_use_case_schema_name)
  'inspire_kinds_rc7._inspire_e2e_walk_n01_u01.n01_u01_results',
  'inspire_kinds_rc7._inspire_e2e_walk_n01_u01.n01_u01_results__lb_signal',
  'inspire_kinds_rc7._inspire_e2e_walk_n01_u01.n01_u01_results_summary',
  'inspire_kinds_rc7._inspire_happy_path_bakehouse_2_n01_u01.n01_u01_results__peers',
  // result table of the database-level layout (compute_result_table_name: _inspire_<id>_<name>_s<session>), and an AI temp view
  'main._inspire._inspire_n01_u02_sales_orders_s42',
  'main._inspire._inspire_ai_0a1b2c3d4e5f',
];

// The person's own data, including plain tables in the Inspire schema.
const PERSON = [
  'inspire_kinds_rc7._inspire.sales_transactions',
  'inspire_kinds_rc7._inspire.sales_customers',
  'inspire_kinds_rc7._inspire.media_customer_reviews',
  'inspire_kinds_rc7._inspire.nyctaxi__trips',
  'inspire_kinds_rc7.walk_rc7e.bakehouse_sales_transactions',
  'main.inspire.bakehouse__sales_transactions',
  'main.s.sales_transactions',
  'main.s.customers',
  'main.s.scope',
  'main.s.customer_scope',
  'main.s.orders__signal',
  'main.s.orders_implement_scope',
  'main.s.implement_scope_log',
  'main.s.inspire_notes',
  'main.s.__inspire',
  'main.s.signal',
];

test('every real name Inspire creates is Inspire-owned (REQ-387)', () => {
  for (const name of REAL_OWN) assert.equal(isInspireOwnName(name), true, `${name} is Inspire's own`);
});

test('every real person table, sample copy and plain Inspire-schema table stays listed (REQ-387)', () => {
  for (const name of PERSON) assert.equal(isInspireOwnName(name), false, `${name} is the person's data`);
});

test('a working view reads as the working copy, including a version or candidate suffix (REQ-387)', () => {
  assert.equal(appReadsName(REAL_OWN[1]), "this use case's working copy of its data");
  assert.equal(appReadsName(REAL_OWN[3]), "this use case's working copy of its data");
  assert.equal(appReadsName('inspire_kinds_rc7._inspire.sales_transactions'), 'inspire_kinds_rc7._inspire.sales_transactions');
});
