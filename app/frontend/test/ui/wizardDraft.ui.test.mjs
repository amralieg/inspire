import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { DRAFT_BACK_NOTE, WIZARD_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';
import { BUILD_IT, closeBrowser, goToStep, onStep, openRow, openUi, profileAt, settleChoices, stepsAre } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const STATE = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };
const WITH_APP = ['1. What to deliver', '2. Data & results', '3. Data groups', '4. First run', '5. Measure', '6. Where it lives', '7. Who uses the App', '8. App look', '9. Run it', '10. Review & build'];
const next = async (page) => {
  while (await page.locator('[data-money-next]').count() && await page.locator('[data-money-next]').isVisible()) await page.locator('[data-money-next]').click();
  await page.getByRole('button', { name: 'Next' }).click();
};
const drafts = (page) => page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)), WIZARD_DRAFT_PREFIX);
const draftNote = (page) => page.locator('[data-wizard-draft]');
const checked = (page, selector) => page.locator(selector).evaluateAll((all) => all.filter((i) => i.checked).map((i) => i.value));
const pressed = (page, choice) => page.locator(`[data-choice="${choice}"] [data-option][aria-pressed="true"]`).evaluateAll((all) => all.map((b) => b.dataset.option));

async function pickOther(page, name) {
  const radios = page.locator(`input[type="radio"][name="${name}"]:not(:checked):not(:disabled)`);
  await radios.first().waitFor();
  const value = await radios.first().getAttribute('value');
  await radios.first().check();
  return value;
}

const PICKS = {
  'Data groups': {
    pick: (page) => pickOther(page, 'inspire-grouping'),
    read: (page) => checked(page, 'input[type="radio"][name="inspire-grouping"]'),
  },
  'First run': {
    pick: async (page) => { await page.locator('[data-first-run-choice="all"] input[type="radio"]').check(); return 'all'; },
    read: (page) => checked(page, 'input[type="radio"][name="inspire-first-run"]'),
  },
  'What to deliver': {
    pick: async (page) => { await page.locator('[data-output="dashboard"] input').setChecked(true); return 'on'; },
    read: async (page) => [(await page.locator('[data-output="dashboard"] input').isChecked()) ? 'on' : 'off'],
  },
  'Who uses the App': {
    pick: (page) => pickOther(page, 'app-access'),
    read: (page) => checked(page, 'input[type="radio"][name="app-access"]'),
  },
  'App look': {
    pick: (page) => pickOther(page, 'app-style'),
    read: (page) => checked(page, 'input[type="radio"][name="app-style"]'),
  },
  'Data & results': {
    pick: async (page) => { await openRow(page, 'Keep it fresh'); await page.locator('[data-choice="freshness"] [data-option="weekly"]').click(); return 'weekly'; },
    read: async (page) => { await openRow(page, 'Keep it fresh'); return pressed(page, 'freshness'); },
  },
  'Review & build': {
    pick: async (page) => { await page.getByRole('region', { name: 'Vibes' }).locator('textarea').first().fill('keep the draft words'); return 'keep the draft words'; },
    read: async (page) => [await page.getByRole('region', { name: 'Vibes' }).locator('textarea').first().inputValue()],
  },
};

async function reloadOn(page, label) {
  await page.reload();
  await onStep(page, label);
  await settleChoices(page);
}

test('a person\u2019s own picks on every step survive a reload, the wizard reopens on the same step, and building clears the draft', async () => {
  const ui = await openUi('wizard', STATE, '', { init: profileAt([], GROUPING_PROFILE) });
  const { page, made } = ui;
  try {
    assert.deepEqual(await drafts(page), [], 'nothing is kept before the person does anything (must-exclude)');
    await goToStep(page, 'Data');
    await stepsAre(page, WITH_APP);
    await page.reload();
    await onStep(page, 'What to deliver');
    assert.equal(await draftNote(page).count(), 0, 'no draft note without unsaved changes (moving between steps is not a change)');
    await goToStep(page, 'Data');
    const kept = {};
    await goToStep(page, 'What to deliver');
    for (const step of WITH_APP.map((s) => s.replace(/^\d+\.\s*/, ''))) {
      await onStep(page, step);
      await settleChoices(page);
      if (PICKS[step]) kept[step] = await PICKS[step].pick(page);
      if (PICKS[step]) {
        await reloadOn(page, step);
        assert.equal(await draftNote(page).locator('span').first().innerText(), DRAFT_BACK_NOTE, `${step}: the wizard says the picks are back`);
        await stepsAre(page, WITH_APP);
        if (PICKS[step]) assert.deepEqual(await PICKS[step].read(page), [kept[step]], `${step}: the pick survives the reload`);
        assert.equal((await drafts(page)).length, 1, 'one draft for this use case');
      }
      if (step !== 'Review & build') await next(page);
    }
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    const spec = JSON.parse(inserts.at(-1).parameters.find((p) => p.name === 'spec').value);
    assert.equal(spec.outputs.dashboard, true, 'the build sends the restored Deliver pick');
    assert.equal(spec.outputs.app_access, kept['Who uses the App']);
    assert.equal(spec.outputs.app_look.style, kept['App look']);
    assert.deepEqual([spec.config.widgets.group_by, spec.config.widgets.run_scope], [kept['Data groups'], 'all'], 'and the restored Data groups and First run picks');
    assert.equal(spec.schedule.cron, '0 0 6 ? * MON', 'and the restored Weekly');
    assert.match(JSON.stringify(spec), /keep the draft words/, 'and the restored Vibes words');
    assert.deepEqual(await drafts(page), [], 'starting the build clears the draft');
    await reloadOn(page, 'What to deliver');
    assert.equal(await draftNote(page).count(), 0, 'and the reopened wizard starts fresh (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Close and Start over drop the draft, and a draft from before the use case changed is ignored (must-exclude)', async () => {
  const ui = await openUi('wizard', STATE, '', { init: profileAt([], GROUPING_PROFILE) });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await next(page);
    await onStep(page, 'Data groups');
    await goToStep(page, 'Review & build');
    await page.getByRole('region', { name: 'Vibes' }).locator('textarea').first().fill('draft words');
    await goToStep(page, 'First run');
    await reloadOn(page, 'First run');
    await draftNote(page).waitFor();
    await page.locator('[data-wizard-start-over]').click();
    await onStep(page, 'What to deliver');
    assert.equal(await draftNote(page).count(), 0);
    assert.deepEqual(await drafts(page), [], 'Start over clears the draft');
    await goToStep(page, 'Data');
    await next(page);
    await onStep(page, 'Data groups');
    assert.equal((await drafts(page)).length, 0, 'moving between steps with no change keeps no draft');
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
    assert.deepEqual(await drafts(page), [], 'Close clears the draft');
    await reloadOn(page, 'What to deliver');
    assert.equal(await draftNote(page).count(), 0, 'a closed wizard reopens fresh (must-exclude)');
    await goToStep(page, 'Data');
    await next(page);
    await onStep(page, 'Data groups');
    const [key] = await drafts(page);
    await page.evaluate((k) => { const d = JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify({ ...d, stamp: 'an-older-use-case' })); }, key);
    await reloadOn(page, 'What to deliver');
    assert.equal(await draftNote(page).count(), 0, 'a draft of the use case as it was before is ignored');
    assert.deepEqual(await drafts(page), [], 'and dropped');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
