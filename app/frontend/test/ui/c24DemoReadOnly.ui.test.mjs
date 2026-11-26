// c24_rc7demo (RC7-A-01, T-DEM-02): a demo session is read-only in Review. Archive, unarchive and rename are refused before they change
// state, with the one demo wording (readOnlyReason); nothing is stored. A non-demo session still archives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { closeReader, openReader } from './reviewRows.mjs';
import { ARCHIVE_STORAGE_KEY } from '../../src/lib/useCaseArchive.js';
import { readOnlyReason } from '../../src/lib/showcase.js';

test.after(closeBrowser);

const REASON = readOnlyReason(true);
const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cardOf = (page, no) => page.locator(`[data-use-case-no="${no}"]`);
const shownNos = (page) => page.locator('[data-use-case-no]').evaluateAll((els) => els.map((el) => el.getAttribute('data-use-case-no')));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), ARCHIVE_STORAGE_KEY);

async function open(query) {
  const posted = [];
  const ui = await openUi('results', REVIEW_STATE, query, { init: async (page) => {
    await page.route('**/api/inspire/usecase-name', async (route) => { posted.push(route.request().postData()); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); });
  } });
  await ui.page.setViewportSize({ width: 1280, height: 800 });
  await cardOf(ui.page, 'N01-U01').waitFor();
  await idle(ui.page);
  return { ui, posted };
}

test('demo session: the row archive icon is refused with the demo message, the row stays Active and nothing is stored', async () => {
  const { ui, posted } = await open('&showcase=acme');
  const { page } = ui;
  try {
    const before = await shownNos(page);
    await cardOf(page, 'N01-U01').locator('[data-row-archive]').click();
    await list(page).locator('..').locator('[data-demo-note]').filter({ hasText: REASON }).first().waitFor();
    assert.deepEqual(await shownNos(page), before, 'the row stays in the Active list');
    assert.equal(await stored(page), null, 'the archive key has no entry');
    await page.reload();
    await cardOf(page, 'N01-U01').waitFor();
    assert.ok((await shownNos(page)).includes('N01-U01'), 'still Active after reload');
    assert.equal(posted.length, 0);
  } finally { await ui.close(); }
});

test('demo session: the reader card archive button is refused the same way', async () => {
  const { ui } = await open('&showcase=acme');
  const { page } = ui;
  try {
    const before = await shownNos(page);
    const reader = await openReader(page, cardOf(page, 'N01-U01'));
    await reader.getByRole('button', { name: 'Archive use case' }).click();
    await page.locator('[data-demo-note]').filter({ hasText: REASON }).first().waitFor();
    if (await page.locator('[data-review-reader]').count()) await closeReader(page);
    assert.deepEqual(await shownNos(page), before);
    assert.equal(await stored(page), null);
  } finally { await ui.close(); }
});

test('demo session: rename is refused with the demo message and sends no write', async () => {
  const { ui, posted } = await open('&showcase=acme');
  const { page } = ui;
  try {
    const title = cardOf(page, 'N01-U01').locator('h3');
    const name = await title.innerText();
    await page.getByRole('button', { name: `Rename ${name}` }).click();
    const field = cardOf(page, 'N01-U01').getByRole('textbox', { name: `Use case name for ${name}` });
    await field.fill('Changed in the demo');
    await field.press('Enter');
    await cardOf(page, 'N01-U01').getByText(REASON).first().waitFor();
    assert.equal(posted.length, 0, 'no rename write was sent');
  } finally { await ui.close(); }
});

test('non-demo session: archive still moves the row to Archived (must-exclude)', async () => {
  const { ui } = await open('');
  const { page } = ui;
  try {
    await cardOf(page, 'N01-U01').locator('[data-row-archive]').click();
    await until(async () => !(await shownNos(page)).includes('N01-U01'));
    assert.match(await stored(page), /N01-U01/);
    assert.equal(await page.locator('[data-demo-note]').count(), 0);
  } finally { await ui.close(); }
});

test('demo session: the favorite star is refused with the demo message and stores nothing', async () => {
  const { ui } = await open('&showcase=acme');
  const { page } = ui;
  try {
    await cardOf(page, 'N01-U01').getByRole('button', { name: /favorites/ }).first().click();
    await page.locator('[data-demo-note]').filter({ hasText: REASON }).first().waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('inspire_favorites_fp')), null);
  } finally { await ui.close(); }
});
