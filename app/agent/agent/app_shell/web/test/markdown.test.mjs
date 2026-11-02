import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOpenMarks, inlineParts, markdownBlocks } from '../src/markdown.js';

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
