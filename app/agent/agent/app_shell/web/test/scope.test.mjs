import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeNoteText, scopedPages } from '../src/hub.js';

const PAGES = [{ id: 'a', title: 'Churn desk' }, { id: 'b', title: 'Loss desk' }, { id: 'c', title: 'Stock' }];
const GROUPS = 'First run: the 2 groups EMEA, AMER of region';

test('the Overview and Impact name each use case whose latest run covered part of the records, and only those', () => {
  const summaries = { a: { run: { scope_text: GROUPS } }, b: { run: { scope_text: '' } }, c: { run: {} } };
  const scoped = scopedPages(PAGES, summaries);
  assert.deepEqual(scoped.map(([page, text]) => [page.id, text]), [['a', GROUPS]]);
  assert.equal(scopeNoteText(scoped), `Churn desk counts only its ${GROUPS}. Run on everything from its Runs tab.`);
});

test('two scoped use cases are both named, and no scope, no summary or no pages says nothing', () => {
  const summaries = { a: { run: { scope_text: GROUPS } }, c: { run: { scope_text: '  First run: part of the records ' } } };
  assert.equal(scopeNoteText(scopedPages(PAGES, summaries)),
    `Churn desk counts only its ${GROUPS}; Stock counts only its First run: part of the records. Run on everything from each Runs tab.`);
  assert.equal(scopeNoteText(scopedPages(PAGES, {})), '');
  assert.equal(scopeNoteText(scopedPages(PAGES, null)), '');
  assert.equal(scopeNoteText(scopedPages(null, summaries)), '');
  assert.equal(scopeNoteText([]), '');
});
