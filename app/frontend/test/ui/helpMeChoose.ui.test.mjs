import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

// REQ-538: Help me choose on the Use cases page: a wizard whose counter falls as the person answers, then the picked list with a banner.
const uc = (no, name, goals, sponsor, type, ttv, extra = {}) => ({
  No: no, Name: name, Statement: `${name} for the business`, Solution: `Build ${name.toLowerCase()}`, 'Business Value': `${name} pays back`,
  'Tables Involved': 'main.s.orders', Priority: 'Medium', Quality: 'Medium', priority_score: '3.0', quality_score: '3.0', inspire_score: '5.0',
  'Strategic Goals Alignment': goals, Sponsor: sponsor, Type: type, 'Time to Value': ttv, 'Data Availability': '4', 'Team Skills': '4', ...extra,
});
const RESULTS = {
  discovery_type: 'Deep',
  title: 'Acme Use Cases Catalog',
  domains: [
    { domain_name: 'Area A', use_cases: [
      uc('N01-U01', 'Case one', 'Grow, Save', 'Sponsor 1', 'Opportunity', '5'), uc('N01-U02', 'Case two', 'Grow', 'Sponsor 1', 'Improvement', '4'),
      uc('N01-U03', 'Case three', 'Grow', 'Sponsor 2', 'Risk', '3'), uc('N01-U04', 'Case four', 'Save', 'Sponsor 2', 'Problem', '2'),
    ] },
    { domain_name: 'Area B', use_cases: [
      uc('N02-U01', 'Case five', 'Save', 'Sponsor 1', 'Opportunity', '5'), uc('N02-U02', 'Case six', 'Save, Comply', 'Sponsor 1', 'Opportunity', '4'),
      uc('N02-U03', 'Case seven', 'Comply', 'Sponsor 2', 'Risk', '3.5'), uc('N02-U04', 'Case eight', 'Comply', 'Sponsor 3', 'Problem', '1'),
    ] },
    { domain_name: 'Area C', use_cases: [
      uc('N03-U01', 'Case nine', 'Grow', 'Sponsor 3', 'Improvement', '4'), uc('N03-U02', 'Case ten', 'Grow', 'Sponsor 3', 'Problem', '5'),
      uc('N03-U03', 'Case eleven', 'Save', 'Sponsor 3', 'Opportunity', '3'), uc('N03-U04', 'Case twelve', 'Comply', 'Sponsor 3', 'Risk', '2'),
    ] },
  ],
};
const N = 12;
const M = 5; // Grow
const K = 3; // Grow and Area A

const rows = (page) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]');
const dialog = (page) => page.getByRole('dialog', { name: 'Help me choose' });
const counter = (page) => dialog(page).locator('[data-help-count]');
const option = (page, label) => dialog(page).locator(`[data-help-option="${label}"]`);
const banner = (page) => page.locator('[data-help-banner]');
async function countIs(page, n) {
  await page.waitForFunction((want) => document.querySelector('[data-help-count]')?.textContent.trim() === String(want), n, { timeout: 15000 });
}
async function openPage() {
  const ui = await openUi('results', { ...REVIEW_STATE, results: RESULTS });
  await rows(ui.page).first().waitFor();
  await idle(ui.page);
  return ui;
}
const open = (page) => page.getByRole('button', { name: 'Help me choose' }).click();

test('the counter falls from N to M to K as two answers are picked, matches the logic, and Done lists exactly K rows under a banner', async () => {
  const ui = await openPage();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    assert.equal(await rows(page).count(), N);
    await open(page);
    await dialog(page).waitFor();
    await countIs(page, N);
    await option(page, 'Grow').click();
    await countIs(page, M);
    await dialog(page).getByRole('button', { name: 'Next' }).click();
    await option(page, 'Area A').click();
    await countIs(page, K);
    assert.match(await dialog(page).locator('[data-help-trail]').innerText(), /12.*5.*Grow.*3.*Area A/s, 'the trail shows each answer and its count');
    const box = await dialog(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    assert.ok(box.sw <= box.cw, 'no inner sideways scroll at 1280x800');
    const body = await dialog(page).locator('[data-help-body]').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    assert.ok(body.sw <= body.cw, 'the question body does not scroll sideways');
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).count(), K);
    assert.match(await banner(page).innerText(), new RegExp(`Picked for you: ${K} of ${N}`));
    assert.match(await banner(page).innerText(), /Grow/);
    assert.match(await banner(page).innerText(), /Area A/);

    await banner(page).getByRole('button', { name: 'Start over' }).click();
    await dialog(page).waitFor();
    await countIs(page, N);
    assert.equal(await dialog(page).locator('[aria-pressed="true"]').count(), 0, 'Start over reopens with nothing picked');
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });

    await banner(page).getByRole('button', { name: 'Show all use cases' }).click();
    await banner(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).count(), N);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('Esc and the X close the dialog and leave the list unchanged', async () => {
  const ui = await openPage();
  const { page } = ui;
  try {
    await open(page);
    await option(page, 'Grow').click();
    await countIs(page, M);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).count(), N);
    assert.equal(await banner(page).count(), 0);
    await open(page);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).count(), N);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('the whole wizard works from the keyboard, and an option that leaves nothing is disabled', async () => {
  const ui = await openPage();
  const { page } = ui;
  try {
    const tabTo = async (selector) => {
      for (let i = 0; i < 40; i++) {
        if (await page.evaluate((s) => Boolean(document.activeElement?.matches(s)), selector)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`could not Tab to ${selector}`);
    };
    await page.getByRole('button', { name: 'Help me choose' }).focus();
    await page.keyboard.press('Enter');
    await dialog(page).waitFor();
    await tabTo('[data-help-option="Grow"]');
    await page.keyboard.press('Enter');
    await countIs(page, M);
    await tabTo('[data-help-next]');
    await page.keyboard.press('Enter');
    assert.equal(await option(page, 'Area B').isDisabled(), true, 'Area B has no Grow use case');
    assert.match(await option(page, 'Area B').innerText(), /No use cases/);
    await tabTo('[data-help-option="Area A"]');
    await page.keyboard.press('Space');
    await countIs(page, K);
    await tabTo('[data-help-done]');
    await page.keyboard.press('Enter');
    await dialog(page).waitFor({ state: 'detached' });
    assert.equal(await rows(page).count(), K);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
