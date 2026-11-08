import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOpenMarks, inlineParts, markdownBlocks, tableCells } from '../src/markdown.js';

test('inline marks become bold, italic and code, and the rest stays text', () => {
  assert.deepEqual(inlineParts('Top offer is **Books**, score `0.95`, *Monitor* tier'), [
    { kind: 'text', text: 'Top offer is ' },
    { kind: 'strong', text: 'Books' },
    { kind: 'text', text: ', score ' },
    { kind: 'code', text: '0.95' },
    { kind: 'text', text: ', ' },
    { kind: 'em', text: 'Monitor' },
    { kind: 'text', text: ' tier' },
  ]);
});

test('stars that are not marks stay as text', () => {
  assert.deepEqual(inlineParts('2 * 3 * 4 = 24'), [{ kind: 'text', text: '2 * 3 * 4 = 24' }]);
  assert.deepEqual(inlineParts('a ** b'), [{ kind: 'text', text: 'a ** b' }]);
  assert.deepEqual(inlineParts('* starts a list'), [{ kind: 'text', text: '* starts a list' }]);
  assert.deepEqual(inlineParts(''), []);
  assert.deepEqual(inlineParts(null), []);
});

test('blocks split into paragraphs, bullet lists, numbered lists and headings', () => {
  const text = '### Strongest offers\nThese anchors lead:\n- **A** with `0.95`\n* B\n• C\n\n1. first\n2) second\n\nAll are in the Monitor tier.\nSecond line.';
  assert.deepEqual(markdownBlocks(text), [
    { type: 'h', text: 'Strongest offers' },
    { type: 'p', text: 'These anchors lead:' },
    { type: 'ul', items: ['**A** with `0.95`', 'B', 'C'] },
    { type: 'ol', items: ['first', 'second'] },
    { type: 'p', text: 'All are in the Monitor tier.\nSecond line.' },
  ]);
});

test('a line that only looks like a list or heading stays a paragraph', () => {
  assert.deepEqual(markdownBlocks('**Bold** opens this line'), [{ type: 'p', text: '**Bold** opens this line' }]);
  assert.deepEqual(markdownBlocks('2024. Sales rose'), [{ type: 'p', text: '2024. Sales rose' }]);
  assert.deepEqual(markdownBlocks('#hashtag is not a heading'), [{ type: 'p', text: '#hashtag is not a heading' }]);
  assert.deepEqual(markdownBlocks('-5% versus last year'), [{ type: 'p', text: '-5% versus last year' }]);
  assert.deepEqual(markdownBlocks('## Closed heading ##'), [{ type: 'h', text: 'Closed heading' }]);
});

test('Windows line ends and blank text are handled', () => {
  assert.deepEqual(markdownBlocks('- a\r\n- b\r\n\r\nend'), [{ type: 'ul', items: ['a', 'b'] }, { type: 'p', text: 'end' }]);
  assert.deepEqual(markdownBlocks(''), []);
  assert.deepEqual(markdownBlocks('\n\n'), []);
  assert.deepEqual(markdownBlocks(undefined), []);
});

test('a half-typed bold or code mark is closed so it never shows raw while Genie types', () => {
  assert.equal(closeOpenMarks('the top item is **Boo'), 'the top item is **Boo**');
  assert.equal(closeOpenMarks('run `SELECT'), 'run `SELECT`');
  assert.equal(closeOpenMarks('**done** and `x`'), '**done** and `x`');
  assert.equal(closeOpenMarks(''), '');
  assert.deepEqual(inlineParts(closeOpenMarks('the top item is **Boo')), [{ kind: 'text', text: 'the top item is ' }, { kind: 'strong', text: 'Boo' }]);
});

const BREAKS = [
  '**What it shows**',
  'Open billing exceptions by age and payment status.',
  '',
  '| Age & Status | Bills | Leakage at stake |',
  '|---|--:|:-:|',
  '| 30 days · Paid On Time | 21 | $0 |',
  '| 30 days · Paid Late | 7 | **$1,820.24** |',
  '30 days · In Arrears | 1 | $0',
  '',
  '- All 7 Paid Late bills hold the leakage.',
  '- Start with Bill 1133.',
].join('\n');

test('a markdown table becomes a table block with its header, alignment and rows, and the text around it keeps its own blocks', () => {
  assert.deepEqual(markdownBlocks(BREAKS), [
    { type: 'p', text: '**What it shows**\nOpen billing exceptions by age and payment status.' },
    { type: 'table', head: ['Age & Status', 'Bills', 'Leakage at stake'], align: ['', 'right', 'center'],
      rows: [['30 days · Paid On Time', '21', '$0'], ['30 days · Paid Late', '7', '**$1,820.24**'], ['30 days · In Arrears', '1', '$0']] },
    { type: 'ul', items: ['All 7 Paid Late bills hold the leakage.', 'Start with Bill 1133.'] },
  ]);
});

test('table rows are fitted to the header, escaped pipes stay in the cell, and a table ends at the first line without a pipe', () => {
  assert.deepEqual(tableCells('| a \\| b | c |'), ['a | b', 'c']);
  assert.deepEqual(tableCells('a | b'), ['a', 'b']);
  assert.deepEqual(markdownBlocks('| A | B |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |\nAfter it.'), [
    { type: 'table', head: ['A', 'B'], align: ['', ''], rows: [['1', ''], ['1', '2']] },
    { type: 'p', text: 'After it.' },
  ]);
});

test('pipes without a separator row, a lone rule and a horizontal rule are not tables', () => {
  assert.deepEqual(markdownBlocks('Revenue | cost is up'), [{ type: 'p', text: 'Revenue | cost is up' }]);
  assert.deepEqual(markdownBlocks('|---|---|'), [{ type: 'p', text: '|---|---|' }]);
  assert.deepEqual(markdownBlocks('Above\n\n---\n\nBelow'), [{ type: 'p', text: 'Above' }, { type: 'hr' }, { type: 'p', text: 'Below' }]);
  assert.deepEqual(markdownBlocks('- - -'), [{ type: 'hr' }]);
});

const SHAPED_ROW = ['This row is for **franchise 3000046**, showing a sale of **$450 across 3 transactions** on **May 12, 2024** for **Golden Gate Ginger** (paid by Amex, in the Current 7-day window). It appears in this weekly sales driver review because:',
  '', '- It falls within the **current 7-day sales window** being reviewed (May 4-17, 2024).', '- Its **main sales driver is Volume**.', '- It is tagged **Action tier: Monitor**.'].join('\n');

test('a shaped answer with bold labels in its bullets reads as one paragraph and one list', () => {
  const blocks = markdownBlocks(SHAPED_ROW);
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ul']);
  assert.deepEqual(blocks[1].items, ['It falls within the **current 7-day sales window** being reviewed (May 4-17, 2024).',
    'Its **main sales driver is Volume**.', 'It is tagged **Action tier: Monitor**.']);
  assert.deepEqual(inlineParts(blocks[1].items[2]), [{ kind: 'text', text: 'It is tagged ' }, { kind: 'strong', text: 'Action tier: Monitor' }, { kind: 'text', text: '.' }]);
});
