import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const RENAMED = 'Churn early warning';
const cardOf = (page) => page.locator('[data-use-case-no="N01-U01"]');
const FONT_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color'];

function routes(posted, { hold = null } = {}) {
  let renamed = '';
  return async (page) => {
    await page.route('**/api/inspire/usecase-name', async (route) => {
      posted.rename.push(JSON.parse(route.request().postData() || '{}'));
      if (hold) await hold;
      renamed = posted.rename.at(-1).name;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, name: renamed }) });
    });
    await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const stored = (body.usecases || []).filter((row) => String(row.id) !== 'N01-U01');
      if (renamed) stored.push({ id: 'N01-U01', session_id: 42, use_case: 'Predict churn', Name: renamed, original_name: 'Predict churn', user_use_case_name: renamed });
      await route.fulfill({ response, json: { ...body, usecases: renamed ? stored : (body.usecases || []) } });
    });
  };
}

const computed = (locator) => locator.evaluate((el, props) => {
  const style = getComputedStyle(el);
  return Object.fromEntries(props.map((p) => [p, style[p]]));
}, FONT_PROPS);

test('the pencil turns the name into an inline field in the same font; Enter saves the name, Esc cancels with no write (must-exclude)', async () => {
  const posted = { rename: [] };
  const ui = await openUi('results', REVIEW_STATE, '', { init: routes(posted) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const title = cardOf(page).locator('h3');
    const before = await title.innerText();
    const titleFont = await computed(title);
    const expandedBefore = await cardOf(page).locator('[aria-expanded]').first().getAttribute('aria-expanded');

    await page.getByRole('button', { name: `Rename ${before}` }).click();
    const field = cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` });
    await field.waitFor();
    assert.deepEqual(await computed(field), titleFont, 'the field has the same computed font as the name');
    assert.equal(await cardOf(page).locator('[aria-expanded]').first().getAttribute('aria-expanded'), expandedBefore, 'the pencil does not expand or collapse the card');

    await field.fill('Esc draft');
    await field.press('Escape');
    await title.waitFor();
    assert.equal(await title.innerText(), before, 'Esc puts the name back');
    assert.equal(posted.rename.length, 0, 'Esc sends no write');

    await page.getByRole('button', { name: `Rename ${before}` }).click();
    await cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` }).fill(RENAMED);
    await cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` }).press('Enter');
    await until(async () => posted.rename.length === 1);
    assert.deepEqual(posted.rename[0].name, RENAMED);
    await until(async () => (await cardOf(page).locator('h3').innerText()) === RENAMED);
    assert.deepEqual(await computed(cardOf(page).locator('h3')), titleFont, 'the saved name keeps the same font');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a slow rename shows Saving… with a spinner in place, the field is disabled until the server answers (must-exclude)', async () => {
  const posted = { rename: [] };
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const ui = await openUi('results', REVIEW_STATE, '', { init: routes(posted, { hold }) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const before = await cardOf(page).locator('h3').innerText();
    await page.getByRole('button', { name: `Rename ${before}` }).click();
    const field = cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` });
    await field.fill(RENAMED);
    await field.press('Enter');
    const saving = cardOf(page).locator('[data-use-case-name-editor] [data-saving]');
    await saving.waitFor();
    assert.equal(await saving.innerText(), 'Saving…');
    assert.ok(await saving.locator('svg.animate-spin').count() === 1, 'the spinner shows');
    assert.equal(await field.isDisabled(), true, 'the field is disabled while saving');
    release();
    await until(async () => posted.rename.length === 1);
    await until(async () => (await cardOf(page).locator('h3').innerText()) === RENAMED);
    assert.equal(await cardOf(page).locator('[data-use-case-name-editor]').count(), 0, 'the field closes after the save');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

test('REQ-098 Tab to the pencil and press Enter or Space opens the rename field and leaves the card as it was (must-exclude)', async () => {
  const posted = { rename: [] };
  const ui = await openUi('results', REVIEW_STATE, '', { init: routes(posted) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const toggle = cardOf(page).locator('[aria-expanded]').first();
    const before = await cardOf(page).locator('h3').innerText();
    const expandedBefore = await toggle.getAttribute('aria-expanded');
    const field = () => cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` });

    await page.getByRole('button', { name: `Rename ${before}` }).focus();
    await page.keyboard.press('Enter');
    await field().waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), expandedBefore, 'Enter on the pencil does not expand or collapse the card');

    await field().press('Escape');
    await cardOf(page).locator('h3').waitFor();
    await page.getByRole('button', { name: `Rename ${before}` }).focus();
    await page.keyboard.press('Space');
    await field().waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), expandedBefore, 'Space on the pencil does not expand or collapse the card');
    assert.equal(posted.rename.length, 0, 'opening the field sends no write');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an empty name is refused: the field stays open with a message, no write is sent, and Esc keeps the name (must-exclude)', async () => {
  const posted = { rename: [] };
  const ui = await openUi('results', REVIEW_STATE, '', { init: routes(posted) });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cardOf(page).locator('[aria-expanded]').first().waitFor();
    await idle(page);
    const before = await cardOf(page).locator('h3').innerText();
    await page.getByRole('button', { name: `Rename ${before}` }).click();
    const field = cardOf(page).getByRole('textbox', { name: `Use case name for ${before}` });
    await field.waitFor();
    await field.fill('   ');
    await field.press('Enter');
    const alert = cardOf(page).locator('[data-use-case-name-editor] [role="alert"]');
    await alert.waitFor();
    assert.match(await alert.innerText(), /A use case needs a name/);
    assert.equal(await field.count(), 1, 'the field stays open so the person can type a name');
    assert.equal(posted.rename.length, 0, 'an empty name sends no write');
    await field.press('Escape');
    await cardOf(page).locator('h3').waitFor();
    assert.equal(await cardOf(page).locator('h3').innerText(), before, 'Esc keeps the current name');
    assert.equal(posted.rename.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
