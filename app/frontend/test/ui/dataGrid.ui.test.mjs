import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, steadyBox } from './uiSupport.mjs';

test.after(closeBrowser);

const grid = (page) => page.getByRole('table', { name: 'Sample use cases' });
const heads = (page) => grid(page).locator('thead th').evaluateAll((ths) => ths.map((th) => th.dataset.col));
const ids = (page) => grid(page).locator('tbody tr td:first-child').allTextContents();
const sortBy = (page, label) => grid(page).locator('th', { has: page.locator('[data-grid-sort]', { hasText: label }) }).locator('[data-grid-sort]');
const filterOf = (page, label) => grid(page).getByRole('button', { name: new RegExp(`^Filter ${label}`) });
const panelOf = (page, label) => page.getByRole('dialog', { name: `Filter ${label}` });

async function open(query = '') {
  const ui = await openUi('grid', {}, query);
  await grid(ui.page).waitFor({ timeout: 15000 });
  return ui;
}

test('each column sorts by its kind, numbers and days biggest first, blanks last, and a third click brings back the first order', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    assert.deepEqual(await ids(page), ['N01-U01', 'N01-U02', 'N01-U03']);
    await sortBy(page, 'Score').click();
    assert.deepEqual(await ids(page), ['N01-U03', 'N01-U01', 'N01-U02'], '10, 4.5 and 2 sort as numbers, not as words');
    assert.equal(await grid(page).locator('th[data-col="score"]').getAttribute('aria-sort'), 'descending');
    await page.getByRole('button', { name: 'Next' }).click();
    assert.deepEqual(await ids(page), ['N02-U01'], 'the row without a score sorts last');
    await sortBy(page, 'Score').click();
    assert.deepEqual(await ids(page), ['N01-U02', 'N01-U01', 'N01-U03'], 'sorting goes back to the first page');
    assert.equal(await grid(page).locator('th[data-col="score"]').getAttribute('aria-sort'), 'ascending');
    await sortBy(page, 'Score').click();
    assert.deepEqual(await ids(page), ['N01-U01', 'N01-U02', 'N01-U03']);
    assert.equal(await grid(page).locator('th[aria-sort]').count(), 0);
    await sortBy(page, 'Due').click();
    assert.deepEqual(await ids(page), ['N02-U01', 'N01-U01', 'N01-U02']);
    await sortBy(page, 'Use case').click();
    assert.deepEqual(await ids(page), ['N02-U01', 'N01-U01', 'N01-U02'], 'Forecast, Predict, Score: A to Z first');
    assert.equal(await page.locator('[data-grid-pager] span').textContent(), 'Rows 1-3 of 4');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a text column filters by its choices with typeahead, a number and a date column by a range, and every filter shows and clears', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await filterOf(page, 'Domain').click();
    const domain = panelOf(page, 'Domain');
    assert.deepEqual(await domain.locator('label').allInnerTexts(), ['Growth', 'Inventory', 'Retention']);
    await domain.getByLabel('Search the Domain choices').fill('inv');
    assert.deepEqual(await domain.locator('label').allInnerTexts(), ['Inventory']);
    await domain.getByLabel('Search the Domain choices').fill('');
    await domain.getByLabel('Growth').check();
    await page.keyboard.press('Escape');
    assert.equal(await domain.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Filter Domain, on', 'Escape gives the focus back to its filter button');
    assert.deepEqual(await ids(page), ['N01-U02', 'N01-U03']);
    assert.equal(await page.locator('[data-grid-filters]').innerText(), '1 column filter on: Domain is Growth');

    await filterOf(page, 'Score').click();
    await panelOf(page, 'Score').getByLabel('Score from').fill('3');
    await page.mouse.click(5, 5);
    assert.equal(await panelOf(page, 'Score').count(), 0, 'a click outside closes the panel');
    assert.deepEqual(await ids(page), ['N01-U03']);
    assert.equal(await page.locator('[data-grid-filters]').innerText(), '2 column filters on: Domain is Growth; Score from 3');

    await page.getByRole('button', { name: 'Clear column filters' }).first().click();
    await filterOf(page, 'Due').click();
    await panelOf(page, 'Due').getByLabel('Due to').fill('2026-09-30');
    await panelOf(page, 'Due').getByRole('button', { name: 'Done' }).click();
    assert.deepEqual(await ids(page), ['N01-U02'], 'the row without a due day fails a day filter');

    await filterOf(page, 'Score').click();
    await panelOf(page, 'Score').getByLabel('Score from').fill('5');
    await panelOf(page, 'Score').getByRole('button', { name: 'Done' }).click();
    assert.equal(await page.locator('[data-grid-none]').innerText(), 'No row matches these column filters. Clear column filters');
    await page.locator('[data-grid-none]').getByRole('button', { name: 'Clear column filters' }).click();
    assert.deepEqual(await ids(page), ['N01-U01', 'N01-U02', 'N01-U03']);
    assert.equal(await page.locator('[data-grid-tools]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the fixed No and Pick columns never move, sort or filter, and their buttons still work', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    for (const col of ['id', 'pick']) {
      const th = grid(page).locator(`th[data-col="${col}"]`);
      assert.equal(await th.locator('button').count(), 0, `${col} has no move, sort or filter button`);
    }
    assert.equal(await grid(page).locator('[data-grid-move]').count(), 4);
    await page.getByRole('button', { name: 'Pick N01-U02' }).click();
    assert.equal(await page.getByLabel('Picked').textContent(), 'N01-U02');
  } finally {
    await ui.close();
  }
});

test('a person moves a column with the keyboard and by dragging, the order stays after a reload and survives a column added or gone, and Reset puts it back', async () => {
  const ui = await open();
  const { page, origin } = ui;
  try {
    const grip = (label) => page.getByRole('button', { name: `Move the ${label} column` });
    await grip('Use case').focus();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await heads(page), ['id', 'domain', 'name', 'score', 'due', 'pick']);
    assert.equal(await page.locator('[data-grid-moved]').textContent(), 'Use case moved to column 2 of 4.');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Move the Use case column', 'the focus stays on the moved column');
    await page.keyboard.press('End');
    assert.deepEqual(await heads(page), ['id', 'domain', 'score', 'due', 'name', 'pick'], 'End moves it to the last place a column can take, before Pick');
    await page.keyboard.press('Home');
    assert.deepEqual(await heads(page), ['id', 'name', 'domain', 'score', 'due', 'pick']);
    assert.equal(await page.locator('[data-grid-reset]').count(), 0, 'the first order offers no reset');

    const from = await steadyBox(grip('Due'));
    const to = await steadyBox(grid(page).locator('th[data-col="name"]'));
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 6 });
    assert.equal(await grid(page).locator('th.bg-db-red-50').getAttribute('data-col'), 'name', 'the column under the pointer shows where it drops');
    await page.mouse.up();
    assert.deepEqual(await heads(page), ['id', 'due', 'name', 'domain', 'score', 'pick']);

    await page.reload();
    await grid(page).waitFor();
    assert.deepEqual(await heads(page), ['id', 'due', 'name', 'domain', 'score', 'pick'], 'the order is kept in this browser');

    await page.goto(`${origin}/test/ui/implement.html?open=grid&step=wide`);
    await grid(page).waitFor();
    assert.deepEqual(await heads(page), ['id', 'due', 'name', 'domain', 'score', 'owner', 'pick'], 'a new column sits after the column before it');
    await grip('Owner').focus();
    await page.keyboard.press('Home');
    assert.deepEqual(await heads(page), ['id', 'owner', 'due', 'name', 'domain', 'score', 'pick']);

    await page.goto(`${origin}/test/ui/implement.html?open=grid`);
    await grid(page).waitFor();
    assert.deepEqual(await heads(page), ['id', 'due', 'name', 'domain', 'score', 'pick'], 'a column that is gone drops out and every other column shows once');

    await page.locator('[data-grid-reset]').click();
    assert.deepEqual(await heads(page), ['id', 'name', 'domain', 'score', 'due', 'pick']);
    assert.equal(await page.locator('[data-grid-moved]').textContent(), 'The columns are back in their first order.');
    await page.reload();
    await grid(page).waitFor();
    assert.deepEqual(await heads(page), ['id', 'name', 'domain', 'score', 'due', 'pick'], 'the reset order is what is kept');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
