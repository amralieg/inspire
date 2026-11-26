// FX-63b (review of FX-63, REQ-472, REQ-473): the Save page has no groups block, Save sends calculated false when the model review did not
// approve, a currency edit saves even when the hidden saved value names a missing column, and a card whose saved value has a review shows its line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onStep, openUi, profileAt, stubMoney } from './uiSupport.mjs';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';
import { PLAN, fakeYearly, goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';
import { openReader, closeReader } from './reviewRows.mjs';
import { initialAnswers } from '../../src/lib/valueWizard.js';

test.after(closeBrowser);

const flat = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

test('S1 (REQ-473): the Save page has no Groups block, no per-group checkboxes and no "N of M groups" note', async () => {
  const { ui, card, page } = await openCard(mountWizard());
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save');
    await dialog.locator('[data-save-total]').waitFor({ timeout: 15000 });
    const text = await flat(dialog.locator('[data-wizard-page="save"]'));
    assert.doesNotMatch(text, /\d+ of \d+ groups/, 'no groups note');
    assert.doesNotMatch(text, /\bGroups\b/, 'no Groups heading');
    for (const g of PLAN.groups) assert.equal(await dialog.getByRole('checkbox', { name: new RegExp(`^${g.g}`) }).count(), 0, `no checkbox for ${g.g}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

const saveWith = async (review) => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, planReply: { plan: { ...PLAN, review } } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save'); // REQ-507: the approval on terms is the one PUT
    for (let i = 0; i < 100 && !puts.length; i += 1) await page.waitForTimeout(100);
    assert.equal(puts.length, 1, 'one save');
    assert.deepEqual(ui.pageErrors, []);
    return puts[0].answers;
  } finally { await ui.close(); }
};

test('S2 (REQ-472 c): a plan the model review did not approve is saved as an estimate (calculated false), as its line says', async () => {
  const sent = await saveWith({ approved: false, model: 'm1', reason: 'too high', amount: 1000, anchor: null, tuned: false });
  assert.equal(sent.calculated, false);
});

test('S2b: an approved plan, and a plan with no review (older server), are saved as calculated', async () => {
  assert.equal((await saveWith({ approved: true, model: 'm1', reason: 'fits', amount: 1000, anchor: null, tuned: false })).calculated, true);
  assert.equal((await saveWith(undefined)).calculated, true);
});

test('S3 (REQ-472 c): a card whose saved value carries a review shows the review line; a card with no saved value shows none', async () => {
  const plan = { ...PLAN, review: { approved: true, model: 'm1', reason: 'fits the business size', amount: 1000, anchor: null, tuned: false } };
  const answers = { ...initialAnswers(plan), calculated: true, plan };
  const saved = { version: 1, answers, yearly: fakeYearly({ plan, answers }, { calculated: true }) };
  const { ui, card, page } = await openCard(mountWizard({ saved }));
  try {
    // REQ-511: the review line lives in the reader (the full card), not the row.
    const reader = await openReader(page, card);
    const line = reader.locator('[data-value-review]');
    await line.waitFor({ timeout: 15000 });
    assert.equal(await flat(line), 'Reviewed by m1: fits the business size');
    await closeReader(page);
    const list = page.getByRole('region', { name: 'Use case list' });
    const other = await openReader(page, list.locator('[data-use-case-row]').filter({ hasText: 'Score upsell' }));
    assert.equal(await other.locator('[data-value-review]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
// The default rule's value reads the amount column, which this table no longer lists.
const GONE_COLUMN_PROFILE = { ...MONEY_PROFILE, money_columns: MONEY_PROFILE.money_columns.filter((c) => c !== 'amount') };

test('S4 (REQ-473): a currency edit saves even when the hidden saved value names a column that is not in the table', async () => {
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], GONE_COLUMN_PROFILE)(page);
      await stubMoney('currency-rates', () => LIVE_RATES, [])(page);
      await stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-rule-editor]').waitFor({ timeout: 15000 });
    while (!(await page.locator('[data-money-currency-mode]').first().isVisible())) await page.locator('[data-money-next]').click();
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-base]').fill('USD');
    await page.locator('[data-money-base]').blur();
    await page.locator('[data-money-rate-row="EUR"]').waitFor({ timeout: 15000 });
    await goToStep(page, 'Run it');
    await onStep(page, 'Run it');
    await goToStep(page, 'Measure');
    while (!(await page.locator('[data-money-currency-mode]').first().isVisible())) await page.locator('[data-money-next]').click();
    assert.equal(await page.locator('[data-money-currency-mode="convert"]').isChecked(), true, 'the convert choice was saved');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
