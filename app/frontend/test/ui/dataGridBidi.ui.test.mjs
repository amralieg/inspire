import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'index.css');

function columns() {
  const table = document.querySelector('table[aria-label="Mixed use cases"]');
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.dataset.col);
  const rows = [...table.querySelectorAll('tbody tr')];
  const edge = (td) => {
    const range = document.createRange();
    range.selectNodeContents(td);
    const text = range.getBoundingClientRect();
    const box = td.getBoundingClientRect();
    const cs = getComputedStyle(td);
    return { start: Math.round(text.left - box.left - parseFloat(cs.paddingLeft)), end: Math.round(box.right - parseFloat(cs.paddingRight) - text.right) };
  };
  const style = (el) => { const cs = getComputedStyle(el); return `${cs.unicodeBidi} ${cs.direction}`; };
  const column = (col) => rows.map((tr) => tr.children[heads.indexOf(col)]);
  const digitsFirst = (td) => {
    const node = td.firstChild;
    const range = document.createRange();
    const at = (i) => { range.setStart(node, i); range.setEnd(node, i + 1); return range.getBoundingClientRect().left; };
    return at(0) < at(node.data.length - 1);
  };
  return {
    units: column('units').map((td) => ({ style: style(td), num: td.hasAttribute('data-num'), digitsFirst: digitsFirst(td), ...edge(td) })),
    score: column('score').map((td) => ({ style: style(td), num: td.hasAttribute('data-num'), ...edge(td) })),
    name: column('name').map((td) => ({ style: style(td), rtl: (td.querySelector('bdi') || td).matches(':dir(rtl)'), ...edge(td) })),
    sql: column('sql').map((td) => ({ rtl: (td.querySelector('bdi') || td).matches(':dir(rtl)'), ...edge(td) })),
    head: style(table.querySelector('thead th[data-col="units"]')),
  };
}

test('a grid mixing Arabic and English rows keeps one alignment per column, isolates every cell, and lines up its numbers (must-exclude)', async () => {
  const ui = await openUi('grid', {}, '&step=bidi');
  const { page } = ui;
  try {
    await page.getByRole('table', { name: 'Mixed use cases' }).waitFor({ timeout: 15000 });
    const got = await page.evaluate(columns);
    assert.deepEqual(got.units.map((u) => [u.style, u.num]), Array(4).fill(['isolate ltr', true]), 'a number with an Arabic or English unit is a number cell, isolated and left to right');
    assert.deepEqual(got.units.map((u) => u.digitsFirst), [true, true, true, true], 'each number shows before its unit, Arabic or English');
    assert.deepEqual([...new Set(got.units.map((u) => u.start))], [0], `the numbers start at the same side of their column: ${JSON.stringify(got.units)}`);
    assert.deepEqual(got.score.map((u) => [u.style, u.num]), Array(4).fill(['isolate ltr', true]));
    assert.deepEqual([...new Set(got.score.map((u) => u.start))], [0], `plain numbers line up too: ${JSON.stringify(got.score)}`);
    assert.equal(got.head, 'isolate ltr', 'the heading of a number column is a number cell too');
    assert.deepEqual([...new Set(got.name.map((n) => n.style))], ['isolate ltr'], 'a text cell isolates and follows the table direction, it never picks its own');
    assert.deepEqual(got.name.map((n) => n.rtl), [true, false, true, false], 'only the Arabic names read right to left, inside their bdi');
    assert.deepEqual([...new Set(got.name.map((n) => n.start))], [0], `Arabic and English names start at the same side: ${JSON.stringify(got.name)}`);
    assert.deepEqual(got.sql.map((n) => n.rtl), [false, true, false, false], 'SQL reads left to right next to an Arabic cell in the same column');
    assert.deepEqual([...new Set(got.sql.map((n) => n.start))], [0]);
    const order = await page.locator('td bdi', { hasText: /^SELECT churn/ }).evaluate((el) => {
      const node = el.firstChild;
      const range = document.createRange();
      const at = (i) => { range.setStart(node, i); range.setEnd(node, i + 1); return range.getBoundingClientRect().left; };
      return [at(0), at(node.data.indexOf('FROM')), at(node.data.indexOf('WHERE'))];
    });
    assert.ok(order[0] < order[1] && order[1] < order[2], `the SQL keeps its order from left to right: ${order}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the base styles isolate table cells instead of letting each cell pick its own direction, and keep code left to right (must-exclude)', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  const plaintext = css.match(/:where\(([^)]*)\)\s*\{\s*unicode-bidi: plaintext/)[1].split(',').map((s) => s.trim());
  assert.ok(!plaintext.includes('td') && !plaintext.includes('th'), plaintext.join());
  assert.ok(plaintext.includes('p') && plaintext.includes('li'));
  assert.match(css, /:where\(td, th\) \{\s*unicode-bidi: isolate;/);
  assert.match(css, /:where\(td\[data-num\], th\[data-num\]\) \{\s*unicode-bidi: isolate;\s*direction: ltr;/);
  assert.match(css, /:where\(code, pre, kbd, samp\) \{\s*unicode-bidi: isolate;\s*direction: ltr;/);
});
