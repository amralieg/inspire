// c39 (REQ-585 item 8) acceptance, written by the c39 spec writer; the builder may not edit or weaken this file.
// One name-based, industry-agnostic dev-name helper for the App: frontend/src/lib/devNames.js. It matches whole name parts (split on
// anything that is not a letter or digit, trailing digits allowed), never a substring, so "device" or "latest" never read as dev.
import test from 'node:test';
import assert from 'node:assert/strict';
import { devWarningText, looksDev } from '../src/lib/devNames.js';

test('REQ-585 8: looksDev reads dev, test, sandbox, staging, scratch, temp, demo and sample names as dev (must-fail on the base)', () => {
  for (const name of ['dev', 'dev_sales', 'sales_dev', 'DEV-SALES', 'dev2', 'test', 'qa_reports', 'uat', 'sandbox', 'staging', 'stg_orders',
    'scratch', 'tmp', 'demo_retail', 'samples', 'poc_area', 'main.dev_area']) {
    assert.equal(looksDev(name), true, `${name} looks dev`);
  }
});

test('REQ-585 8: looksDev never reads a production or business name as dev (must-keep)', () => {
  for (const name of ['main', 'sales', 'prod', 'production', 'device_events', 'latest_orders', 'contest', 'demographics', 'temperature',
    'attempts', 'developer_portal', 'deal_stage', '', null, undefined]) {
    assert.equal(looksDev(name), false, `${String(name)} is not dev`);
  }
});

test('REQ-585 8: the warning names the catalog or schema and advises production data, without dropping it (must-fail on the base)', () => {
  assert.equal(devWarningText('catalog', 'dev_sales'), 'dev_sales looks like a dev catalog; Inspire advises production data.');
  assert.equal(devWarningText('schema', 'main.dev_area'), 'main.dev_area looks like a dev schema; Inspire advises production data.');
});
