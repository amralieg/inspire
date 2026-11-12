import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onStep, openRow, openUi, wizardInScreen, openFolded } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const VIEWPORTS = [[1280, 800], [1440, 900]];
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const body = (page) => page.locator('[data-wizard-body]');
const openDecisions = (page) => body(page).evaluate((el) => [...el.querySelectorAll('[data-choice]')]
  .filter((c) => c.getClientRects().length > 0).map((c) => c.getAttribute('data-choice')));
const changeRow = (page, what) => page.getByRole('button', { name: `Change ${what}`, exact: true });

test('Data and results opens on the source tables, and Keep it fresh sits behind a Change row', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await openFolded(page, 'Source tables');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Keep it fresh is behind its Change row');
    assert.equal(await changeRow(page, 'Keep it fresh').getAttribute('aria-expanded'), 'false', 'the Keep it fresh row is closed');
    assert.equal((await openDecisions(page)).includes('freshness'), false, 'Keep it fresh is not open on Data and results before its Change row is opened');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a blocked Next opens the result table row, so the message sits beside the field it is about', async () => {
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }] }) },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await openRow(page, 'result table');
    const place = page.getByRole('region', { name: 'Where the result table lives' });
    await place.getByLabel('Table name').fill('bad name!');
    await page.getByRole('button', { name: 'Close result table', exact: true }).click();
    assert.equal(await place.count(), 0, 'the row closes when the person closes it');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await place.getByLabel('Table name').waitFor();
    await page.getByText('can only use catalog, schema and table names', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close result table', exact: true }).count(), 1, 'the blocked Next leaves the row open');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a blocked Next opens the delivery settings that hold the alert problem', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'What to deliver');
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await openRow(page, 'delivery settings');
    await page.getByLabel('Email recipients (comma separated)').fill('not-an-email');
    await page.getByRole('button', { name: 'Close delivery settings', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Close delivery settings', exact: true }).count(), 0, 'the delivery settings are closed before Next');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Close delivery settings', exact: true }).waitFor();
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
    await page.getByRole('region', { name: 'App access' }).waitFor();
    await goToStep(page, 'Page storage');
    await page.getByRole('group', { name: 'How fast do the App\'s pages open?' }).waitFor();
    await goToStep(page, 'Who uses the App');
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
        if (!(await stepLabels(page)).includes(label)) continue;
        await goToStep(page, label);
        await wizardInScreen(page, `${label} ${width}x${height}`, height);
        const problems = await body(page).evaluate((el) => {
          const dialog = el.closest('[role="dialog"]').getBoundingClientRect();
          const shown = (c) => {
            let r = c.getBoundingClientRect();
            for (let p = c.parentElement; p; p = p.parentElement) {
              const o = getComputedStyle(p);
              if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
              const pr = p.getBoundingClientRect();
              r = { left: Math.max(r.left, pr.left), right: Math.min(r.right, pr.right), top: Math.max(r.top, pr.top), bottom: Math.min(r.bottom, pr.bottom) };
            }
            return r;
          };
          const items = [...el.querySelectorAll('button, input:not([type=hidden]), select, textarea')]
            .filter((c) => c.getClientRects().length > 0 && c.getBoundingClientRect().width > 2 && !c.closest('.sr-only'))
            .map((c) => ({ name: (c.getAttribute('aria-label') || c.textContent || c.name || c.tagName).trim().slice(0, 40), raw: c.getBoundingClientRect(), r: shown(c) }))
            .filter((i) => i.r.right > i.r.left && i.r.bottom > i.r.top);
          const clipped = items.filter(({ raw }) => raw.left < dialog.left - 1 || raw.right > dialog.right + 1).map((i) => i.name);
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
