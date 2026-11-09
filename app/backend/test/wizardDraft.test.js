import test from 'node:test';
import assert from 'node:assert/strict';
import {
  START_DRAFT_PREFIX,
  START_DRAFT_STAMP,
  START_DRAFT_STEP,
  WIZARD_DRAFT_PREFIX,
  WIZARD_DRAFT_VERSION,
  clearWizardDraft,
  draftStampOf,
  readWizardDraft,
  startDraftKey,
  wizardDraftKey,
  writeWizardDraft,
} from '../../frontend/src/lib/wizardDraft.js';

function fakeStorage() {
  const items = new Map();
  return {
    items,
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
  };
}

const where = { host: 'Example.Cloud.Databricks.com', inspireDatabase: 'Cat.Inspire', sessionId: 42, useCaseId: 'N01-U03' };
const uc = { id: 'N01-U03', use_case: 'Forecast demand', tables_involved: 'a.b.c' };

test('the draft key is per workspace, inspire database, session and use case', () => {
  const key = wizardDraftKey(where);
  assert.ok(key.startsWith(WIZARD_DRAFT_PREFIX));
  assert.equal(key, wizardDraftKey({ ...where, host: 'example.cloud.databricks.com', inspireDatabase: 'cat.inspire' }));
  assert.notEqual(key, wizardDraftKey({ ...where, host: 'other.cloud.databricks.com' }));
  assert.notEqual(key, wizardDraftKey({ ...where, useCaseId: 'N01-U04' }));
  assert.notEqual(key, wizardDraftKey({ ...where, sessionId: 43 }));
  assert.notEqual(key, wizardDraftKey({ ...where, inspireDatabase: 'cat.other' }));
  assert.equal(wizardDraftKey({ ...where, useCaseId: '' }), '');
});

test('the stamp changes when the use case or its latest build changes', () => {
  const a = draftStampOf(uc, null);
  assert.equal(a, draftStampOf({ ...uc }, null));
  assert.notEqual(a, draftStampOf({ ...uc, use_case: 'Forecast demand by zone' }, null));
  assert.notEqual(a, draftStampOf(uc, { spec_version: 1, created_at: 't1', status: 'SUCCESS' }));
  assert.notEqual(draftStampOf(uc, { spec_version: 1, created_at: 't1', status: 'SUCCESS' }), draftStampOf(uc, { spec_version: 2, created_at: 't2', status: 'SUCCESS' }));
});

test('a written draft reads back with its step and visited steps', () => {
  const store = fakeStorage();
  const key = wizardDraftKey(where);
  const spec = { use_case_id: 'N01-U03', outputs: { app: true } };
  assert.equal(writeWizardDraft(key, { stamp: 's1', spec, step: 'grouping', visited: ['use_case', 'data'] }, store), true);
  assert.deepEqual(readWizardDraft(key, 's1', store), { spec, step: 'grouping', visited: ['use_case', 'data'] });
});

test('a draft from before the use case changed is ignored and cleared', () => {
  const store = fakeStorage();
  const key = wizardDraftKey(where);
  writeWizardDraft(key, { stamp: 's1', spec: { use_case_id: 'N01-U03' }, step: 'data' }, store);
  assert.equal(readWizardDraft(key, 's2', store), null);
  assert.equal(store.items.has(key), false);
});

test('a draft of another version, a broken draft or one without a spec is ignored and cleared', () => {
  const store = fakeStorage();
  const key = wizardDraftKey(where);
  store.setItem(key, JSON.stringify({ version: WIZARD_DRAFT_VERSION + 1, stamp: 's1', spec: {}, step: 'data' }));
  assert.equal(readWizardDraft(key, 's1', store), null);
  assert.equal(store.items.has(key), false);
  store.setItem(key, '{not json');
  assert.equal(readWizardDraft(key, 's1', store), null);
  assert.equal(store.items.has(key), false);
  store.setItem(key, JSON.stringify({ version: WIZARD_DRAFT_VERSION, stamp: 's1', step: 'data' }));
  assert.equal(readWizardDraft(key, 's1', store), null);
});

test('clearing removes only that use case draft', () => {
  const store = fakeStorage();
  const key = wizardDraftKey(where);
  const other = wizardDraftKey({ ...where, useCaseId: 'N01-U04' });
  writeWizardDraft(key, { stamp: 's1', spec: {}, step: 'data' }, store);
  writeWizardDraft(other, { stamp: 's1', spec: {}, step: 'data' }, store);
  assert.equal(clearWizardDraft(key, store), true);
  assert.equal(readWizardDraft(key, 's1', store), null);
  assert.ok(readWizardDraft(other, 's1', store));
});

test('no storage or a storage that throws never breaks the wizard', () => {
  const key = wizardDraftKey(where);
  assert.equal(readWizardDraft(key, 's1', null), null);
  assert.equal(writeWizardDraft(key, { stamp: 's1', spec: {}, step: 'data' }, null), false);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(readWizardDraft(key, 's1', broken), null);
  assert.equal(writeWizardDraft(key, { stamp: 's1', spec: {}, step: 'data' }, broken), false);
  assert.equal(clearWizardDraft(key, broken), false);
  assert.equal(readWizardDraft('', 's1', fakeStorage()), null);
});

test('the Start form draft is one per workspace, apart from every wizard draft, and goes through the same read, write and clear', () => {
  const store = fakeStorage();
  const key = startDraftKey({ host: 'Example.Cloud.Databricks.com/' });
  assert.ok(key.startsWith(START_DRAFT_PREFIX));
  assert.ok(!key.startsWith(WIZARD_DRAFT_PREFIX), 'a Start draft is never listed as a wizard draft (must-exclude)');
  assert.equal(key, startDraftKey({ host: 'example.cloud.databricks.com' }));
  assert.notEqual(key, startDraftKey({ host: 'other.cloud.databricks.com' }));
  assert.equal(startDraftKey({ host: '' }), '', 'no workspace, no draft');
  const form = { params: { '00_business_name': 'Acme' }, selectedCatalogs: ['main'] };
  assert.equal(writeWizardDraft(key, { stamp: START_DRAFT_STAMP, spec: form, step: START_DRAFT_STEP }, store), true);
  assert.deepEqual(readWizardDraft(key, START_DRAFT_STAMP, store), { spec: form, step: START_DRAFT_STEP, visited: [] });
  assert.equal(readWizardDraft(startDraftKey({ host: 'other.cloud.databricks.com' }), START_DRAFT_STAMP, store), null, 'another workspace reads nothing');
  assert.equal(readWizardDraft(key, 'start:0', store), null, 'a draft of an older form is dropped');
  assert.equal(store.items.size, 0);
  writeWizardDraft(key, { stamp: START_DRAFT_STAMP, spec: form, step: START_DRAFT_STEP }, store);
  assert.equal(clearWizardDraft(key, store), true);
  assert.equal(readWizardDraft(key, START_DRAFT_STAMP, store), null);
});
