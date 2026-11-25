// REQ-512 item 35 (Amr, 11-24 00:06: "I also want all columns to be sortable, at the top"): each Review column header is itself the sort
// control. A click on #, Use case, MVP, Docs, Score or Value sorts the rows ascending and says so in aria-sort; a second click flips it.
// Fail-pre (0289c7e85): ResultsPage.jsx:2151 and :2156 render the six headers as plain <span data-sort-head> labels (REQ-510 L5 moved the sorts
// into the one Sort select). Budget: the page has 16 controls above the fold outside the rows today; six header buttons make 22, inside the
// REQ-516 cap of 24 (req510L5ReviewDeclutter.ui.test.mjs stays green). The Sort select may stay; req511Review tests 6 and 9 use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { SCORES, TOTALS, openReview, order } from './req512Support.mjs';

test.after(closeBrowser);

const HEADS = [['no', '#'], ['name', 'Use case'], ['mvp', 'MVP'], ['docs', 'Docs'], ['score', 'Score'], ['value', 'Value']];
const control = (list, key) => list.locator(`[data-sort-head="${key}"]`).first();
// The header's sort state: aria-sort on the header itself, on its column header ancestor, or on the button inside it.
const sortState = (list, key) => control(list, key).evaluate((el) => (el.closest('[aria-sort]') || el.querySelector('[aria-sort]'))?.getAttribute('aria-sort') ?? null);
async function clickHead(list, key) {
  const clicked = await control(list, key).evaluate((el) => {
    const b = el.matches('button') ? el : el.querySelector('button');
    if (!b) return false;
    b.click();
    return true;
  });
  assert.equal(clicked, true, `header ${key} has a button to click`);
}

test('S1: every column header is a button above the first row', async () => {
  const { ui, list } = await openReview();
  try {
    const firstRow = await list.locator('[data-use-case-row]').first().boundingBox();
    for (const [key, label] of HEADS) {
      const head = control(list, key);
      assert.equal(await head.count(), 1, `header ${label} is on the page`);
      const isButton = await head.evaluate((el) => el.matches('button') || el.querySelector('button') !== null);
      assert.equal(isButton, true, `header ${label} is a button, not a label`);
      const box = await head.boundingBox();
      assert.ok(box && box.y + box.height <= firstRow.y + 1, `header ${label} sits at the top, above the first row`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('S2: a header click sorts ascending with aria-sort, a second click descending; only one header is sorted at a time', async () => {
  const { ui, list } = await openReview();
  try {
    for (const [key, label] of HEADS) {
      await clickHead(list, key);
      await list.page().waitForFunction((k) => {
        const el = document.querySelector(`[data-sort-head="${k}"]`);
        return (el?.closest('[aria-sort]') || el?.querySelector('[aria-sort]'))?.getAttribute('aria-sort') === 'ascending';
      }, key, { timeout: 5000 }).catch(() => {});
      assert.equal(await sortState(list, key), 'ascending', `${label}: first click sorts ascending`);
      for (const [other] of HEADS.filter(([k]) => k !== key)) {
        assert.ok(['none', null].includes(await sortState(list, other)), `${label} sorted: ${other} is not marked sorted`);
      }
      await clickHead(list, key);
      await list.page().waitForTimeout(200);
      assert.equal(await sortState(list, key), 'descending', `${label}: second click flips to descending`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('S3: the Score, Value and # headers put the rows in that order both ways', async () => {
  const { ui, list } = await openReview();
  try {
    const score = (nos) => nos.map((n) => Number(SCORES[n]));
    await clickHead(list, 'score');
    await list.page().waitForTimeout(300);
    const up = score(await order(list));
    assert.deepEqual(up, [...up].sort((a, b) => a - b), 'Score ascending');
    await clickHead(list, 'score');
    await list.page().waitForTimeout(300);
    assert.deepEqual(score(await order(list)), [...up].reverse(), 'Score descending');

    await clickHead(list, 'value');
    await list.page().waitForTimeout(300);
    const amount = (nos) => nos.map((n) => TOTALS.use_cases[n]?.amount || 0);
    const v = amount(await order(list));
    assert.deepEqual(v, [...v].sort((a, b) => a - b), 'Value ascending');

    await clickHead(list, 'no');
    await list.page().waitForTimeout(300);
    const nos = await order(list);
    assert.deepEqual(nos, [...nos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), '# ascending');
    await clickHead(list, 'no');
    await list.page().waitForTimeout(300);
    assert.deepEqual(await order(list), [...nos].reverse(), '# descending');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
