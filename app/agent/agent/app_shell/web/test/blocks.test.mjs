import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockPlan, cleanHtml, gridSpans, safeCss, slotsOf, withBlocks } from '../src/blocks.js';
import { fillRows } from '../src/layout.js';
import { linkParts, safeLink } from '../src/markdown.js';

const b = (id, where, of, extra = {}) => ({ id, kind: 'text', place: of ? { where, of } : { where }, width: 'full', align: 'left', content: id, ...extra });
const ids = (list) => list.map((x) => x.id);

test('blocks placed by other blocks line up in the order they name, at the element the first of them names', () => {
  const plan = blockPlan([b('b1', 'after', 'kpis'), b('b2', 'after', 'b1'), b('b3', 'before', 'b1'), b('b4', 'after', 'b2'), b('top', 'top')]);
  assert.deepEqual(ids(plan.kpis.after), ['b3', 'b1', 'b2', 'b4']);
  assert.deepEqual(ids(plan['@top'].after), ['top']);
  assert.deepEqual(plan.kpis.before, []);
});

test('a block beside an element sits on the side its align names', () => {
  const plan = blockPlan([b('l', 'beside', 'records', { width: 'narrow', align: 'left' }), b('r', 'beside', 'records', { width: 'half', align: 'right' })]);
  assert.deepEqual([ids(plan.records.left), ids(plan.records.right)], [['l'], ['r']]);
});

test('a block by an element the page does not draw shows at the page bottom, never dropped', () => {
  const plan = blockPlan([b('kpi', 'before', 'total_loss'), b('gone', 'after', 'nope'), b('kept', 'after', 'charts'), b('end', 'bottom')],
    new Set(['charts', 'kpis']));
  assert.deepEqual(ids(plan.charts.after), ['kept']);
  assert.deepEqual(ids(plan['@bottom'].after), ['kpi', 'gone', 'end']);
  assert.equal(plan.total_loss, undefined);
});

test('blocks that place each other in a circle still show, once each', () => {
  const plan = blockPlan([b('a', 'after', 'b'), b('b', 'after', 'a')]);
  assert.deepEqual(ids(plan['@bottom'].after).sort(), ['a', 'b']);
});

test('a page without blocks plans nothing and its chart grid spans exactly as before', () => {
  const charts = [{ id: 'a', span: 1 }, { id: 'b', span: 2 }, { id: 'c', span: 1 }, { id: 'd', span: 1 }, { id: 'e', span: 1 }];
  const plan = blockPlan([]);
  assert.deepEqual(plan, {});
  assert.deepEqual(slotsOf(plan, 'kpis'), { before: [], after: [], left: [], right: [] });
  const entries = withBlocks(charts, plan);
  assert.deepEqual(entries.map((e) => e.item.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(gridSpans(entries), fillRows(charts));
  assert.deepEqual(blockPlan(undefined), {});
});

test('a block beside a chart shares its row, and the single chart before them gets the full row', () => {
  const charts = [{ id: 'a', span: 1 }, { id: 'b', span: 2 }, { id: 'c', span: 1 }];
  const plan = blockPlan([b('next', 'beside', 'b', { width: 'narrow', align: 'right' }), b('wide', 'after', 'c'), b('half', 'after', 'wide', { width: 'half' })]);
  const entries = withBlocks(charts, plan);
  assert.deepEqual(entries.map((e) => e.block?.id || e.item.id), ['a', 'b', 'next', 'c', 'wide', 'half']);
  assert.deepEqual(gridSpans(entries), [2, 1, 1, 2, 2, 2]);
});

test('a chart pinned to one column keeps it whatever its own span, as the trend chart beside the reason bars always has', () => {
  const lead = [{ key: 'by_reason', item: { id: 'by_reason' }, span: 1 }];
  const trend = withBlocks([{ id: 'trend', span: 2 }], {}).map((entry) => ({ ...entry, span: 1 }));
  assert.deepEqual(gridSpans([...lead, ...trend]), [1, 1]);
  assert.deepEqual(gridSpans([...lead, ...withBlocks([{ id: 'trend', span: 2 }], {})]), [2, 2], 'unpinned, the wide trend would push the bars to a row of their own');
});

test('a link in a text block goes only to http, https, mailto or a page anchor', () => {
  assert.deepEqual(linkParts('See [the guide](https://docs.example.org/g) and [mail](mailto:team@example.org) now'), [
    { kind: 'text', text: 'See ' }, { kind: 'link', text: 'the guide', href: 'https://docs.example.org/g' }, { kind: 'text', text: ' and ' },
    { kind: 'link', text: 'mail', href: 'mailto:team@example.org' }, { kind: 'text', text: ' now' }]);
  assert.deepEqual(linkParts('[go](javascript:alert)'), [{ kind: 'text', text: 'go' }]);
  assert.deepEqual(linkParts('**bold** [x](data:text/html,hi)'), [{ kind: 'strong', text: 'bold' }, { kind: 'text', text: ' ' }, { kind: 'text', text: 'x' }]);
  assert.equal(safeLink('java\tscript:alert(1)'), false);
  assert.equal(safeLink('#top'), true);
  assert.equal(safeLink(`https://x.example.org/${'a'.repeat(2001)}`), false);
});

test('a style loads only data images and never imports, expressions or escapes', () => {
  assert.equal(safeCss('color:red;background:url(data:image/png;base64,AAAA)'), true);
  assert.equal(safeCss('background:url(https://x.example.org/t.gif)'), false);
  assert.equal(safeCss('@import "x.css"'), false);
  assert.equal(safeCss('width:expression(alert(1))'), false);
  assert.equal(safeCss('background:\\75 rl(x)'), false);
});

test('outside a browser the sanitizer draws nothing rather than raw html', () => {
  assert.equal(cleanHtml('<b>hi</b><script>alert(1)</script>'), '');
});
