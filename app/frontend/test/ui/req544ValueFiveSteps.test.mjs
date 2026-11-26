// REQ-544 (D-c20-01): the Calculate value dialog in 5 steps: Data, Kinds, Each kind, Value story, Terms and accept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { mountReq507 } from './req507Support.mjs';

test.after(closeBrowser);

const STEPS = ['Data', 'Kinds', 'Each kind', 'Value story', 'Terms and accept'];
const yearlyOf = (amount) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount }], total: { unit: 'USD', amount } });
const HISTORY = [
  { version: 2, saved_at: '2026-11-20T10:00:00Z', saved_by: 'amr@example.com', note: '', answers: {}, yearly: yearlyOf(777000) },
  { version: 1, saved_at: '2026-11-19T10:00:00Z', saved_by: 'sam@example.com', note: '', answers: {}, yearly: yearlyOf(300000) },
];
const nextBtn = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });
const calcNow = (dialog) => dialog.getByRole('button', { name: 'Calculate now' });
const settle = (dialog) => dialog.locator('[data-wizard-page]').first().waitFor({ timeout: 15000 });

test('R544: the dialog walks Data, Kinds, one page per kind, Value story, Terms and accept', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts, history: HISTORY }));
  try {
    const dialog = await openWizard(page, card);
    await settle(dialog);
    // (a) the stepper
    const steps = await dialog.getByRole('list', { name: 'Steps' }).locator('li').allInnerTexts();
    assert.deepEqual(steps.map((s) => s.replace(/^[\d✓]+\s*/, '').trim()), STEPS);
    // (b) Data: the records found, the scope cards, and the filter editor on the same page
    assert.match(await dialog.locator('[data-scope-facts]').innerText(), /3,412,880/);
    assert.equal(await dialog.locator('[data-scope-choice]').count(), 3);
    assert.equal(await dialog.locator('[data-wizard-page="filter"]').count(), 0);
    await dialog.locator('[data-scope-choice="filter"]').click();
    await dialog.locator('[data-wizard-page="filter"]').waitFor({ timeout: 5000 });
    assert.equal(await nextBtn(dialog).isDisabled(), true, 'a filter needs its count first');
    await dialog.getByLabel('Describe the rows to keep').fill('Exclude cancelled and test records');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    await dialog.locator('[data-scope-count]').waitFor({ timeout: 5000 });
    assert.match(await dialog.locator('[data-scope-count]').innerText(), /1,198,406/);
    assert.ok(await calcNow(dialog).count() > 0, 'Calculate now on step 1');
    await nextBtn(dialog).click();
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    assert.ok(await calcNow(dialog).count() > 0, 'Calculate now on step 2');
    // (c) one page per ticked kind, with its name large at the top
    await dialog.getByLabel('Include Customers kept').uncheck();
    await nextBtn(dialog).click();
    for (const [k, label] of [[1, 'Losses avoided'], [2, 'Analyst time saved']]) {
      const title = dialog.locator('[data-kind-title]');
      await title.waitFor({ timeout: 15000 });
      assert.equal((await title.innerText()).trim(), label);
      assert.ok(parseFloat(await title.evaluate((el) => getComputedStyle(el).fontSize)) >= 22, 'kind title is big');
      assert.match(await dialog.locator('[data-kind-count]').innerText(), new RegExp(`Kind ${k} of 2`));
      assert.ok(await calcNow(dialog).count() > 0, 'Calculate now on step 3');
      await nextBtn(dialog).click();
    }
    // (d) Value story: story text, the params table and a closed Assumptions group
    await dialog.locator('[data-story-headline]').waitFor({ timeout: 15000 });
    assert.ok(await dialog.locator('[data-param]').count() > 0);
    const group = dialog.locator('details[data-assumptions]');
    assert.equal(await group.evaluate((el) => el.open), false);
    await group.locator('summary').first().click();
    assert.equal(await dialog.getByLabel('Year 1 share captured (%)').isVisible(), true);
    assert.ok(await calcNow(dialog).count() > 0, 'Calculate now on step 4');
    await nextBtn(dialog).click();
    // (e) Terms and accept: the one PUT, after the tick
    const accept = dialog.getByRole('button', { name: 'Accept and save' });
    await accept.waitFor({ timeout: 15000 });
    assert.equal(await accept.isDisabled(), true);
    assert.equal(await calcNow(dialog).count(), 0, 'no Calculate now on step 5');
    assert.equal(await nextBtn(dialog).count(), 0);
    await dialog.locator('[data-value-accept]').check();
    assert.equal(await accept.isDisabled(), false);
    await accept.click();
    await dialog.locator('[data-history-row]').first().waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).last().isVisible(), true, 'the footer shows Close after the save');
    assert.equal(await dialog.getByRole('button', { name: 'Accept and save' }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
