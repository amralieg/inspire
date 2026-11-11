import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onStep, openUi, wizardInScreen } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const VIEWPORTS = [[1280, 800], [1440, 900]];
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const body = (page) => page.locator('[data-wizard-body]');
const openDecisions = (page) => body(page).evaluate((el) => [...el.querySelectorAll('[data-choice]')]
  .filter((c) => c.getClientRects().length > 0).map((c) => c.getAttribute('data-choice')));
const changeRow = (page, what) => page.getByRole('button', { name: `Change ${what}`, exact: true });

test('Data and results opens on the source tables, and the result table and Keep it fresh sit behind Change rows', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    assert.equal(await page.getByRole('radiogroup', { name: 'Where the tables go' }).count(), 0, 'the result table is behind its Change row');
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Keep it fresh is behind its Change row');
    assert.equal(await changeRow(page, 'result table').getAttribute('aria-expanded'), 'false', 'the result table row is closed');
    assert.equal(await changeRow(page, 'Keep it fresh').getAttribute('aria-expanded'), 'false', 'the Keep it fresh row is closed');
    assert.deepEqual(await openDecisions(page), [], 'no decision group is open on Data and results before a Change row is opened');
    await changeRow(page, 'result table').click();
    await page.getByRole('radiogroup', { name: 'Where the tables go' }).waitFor();
    assert.deepEqual(await openDecisions(page), ['result-table'], 'opening the result table shows only that decision');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a result table problem keeps its row open, so the message sits beside the field it is about', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await openRow(page, 'result table');
    const place = page.getByRole('region', { name: 'Where the result table lives' });
    await place.getByLabel('Table name').fill('bad name!');
    await page.getByRole('button', { name: 'Close result table', exact: true }).click();
    await place.getByLabel('Table name').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close result table', exact: true }).count(), 1, 'the row stays open while its table name is not valid');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('can only use catalog, schema and table names', { exact: false }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Where it lives opens the App placement, and App pages sit behind a Change row', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Where it lives');
    await page.getByRole('radio', { name: /^One App per use case/ }).waitFor();
    assert.equal(await page.locator('[data-app-page]').count(), 0, 'no App page card is open before its Change row is opened');
    assert.equal(await changeRow(page, 'App pages').getAttribute('aria-expanded'), 'false', 'the App pages row is closed');
    await changeRow(page, 'App pages').click();
    await page.locator('[data-app-page]').first().waitFor();
    assert.ok(await page.locator('[data-app-page]').count() >= 2, 'the App pages open once the row is opened');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Who uses the App opens who sees which rows, and what people can do in the App sits behind a Change row', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Who uses the App');
    await page.getByRole('group', { name: 'How fast do the App\'s pages open?' }).waitFor();
    assert.equal(await page.locator('[data-choice="app-options"]').count(), 0, 'the App features are behind their Change row');
    assert.equal(await changeRow(page, 'what people can do in the App').getAttribute('aria-expanded'), 'false', 'the App features row is closed');
    await changeRow(page, 'what people can do in the App').click();
    await page.locator('[data-choice="app-options"]').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the first page is What to deliver, and each step fits the screen at 1280x800 and 1440x900 with no control clipped or overlapping', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    const labels = await stepLabels(page);
    assert.equal(labels[0], 'What to deliver', labels.join(' | '));
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      const list = await page.evaluate(() => {
        const ol = document.querySelector('[data-wizard-header] ol');
        const box = ol.getBoundingClientRect();
        return { hidden: ol.scrollWidth - ol.clientWidth, outside: [...ol.querySelectorAll('li')].filter((li) => {
          const r = li.getBoundingClientRect();
          return r.right > box.right + 1 || r.left < box.left - 1;
        }).length };
      });
      assert.deepEqual(list, { hidden: 0, outside: 0 }, `${width}x${height}: every step is on screen in the step list`);
      for (const label of labels.filter((l) => l !== 'Measure')) {
        await goToStep(page, label);
        await wizardInScreen(page, `${label} ${width}x${height}`, height);
        const problems = await body(page).evaluate((el) => {
          const dialog = el.closest('[role="dialog"]').getBoundingClientRect();
          const items = [...el.querySelectorAll('button, input:not([type=hidden]), select, textarea')]
            .filter((c) => c.getClientRects().length > 0 && c.getBoundingClientRect().width > 2 && !c.closest('.sr-only'))
            .map((c) => ({ name: (c.getAttribute('aria-label') || c.textContent || c.name || c.tagName).trim().slice(0, 40), r: c.getBoundingClientRect() }));
          const clipped = items.filter(({ r }) => r.left < dialog.left - 1 || r.right > dialog.right + 1).map((i) => i.name);
          const overlaps = [];
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const a = items[i].r;
              const b = items[j].r;
              const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (w > 2 && h > 2) overlaps.push(`${items[i].name} / ${items[j].name}`);
            }
          }
          return { clipped, overlaps };
        });
        assert.deepEqual(problems.clipped, [], `${label} ${width}x${height}: no control clipped by the dialog`);
        assert.deepEqual(problems.overlaps, [], `${label} ${width}x${height}: no two controls overlap`);
      }
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the step list jumps to a finished step and Back returns to the step before', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await goToStep(page, 'Who uses the App');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Where it lives');
    await page.locator('[data-step-go="delivery"]').click();
    await onStep(page, 'What to deliver');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
