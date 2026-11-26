// REQ-507 L7: the redesigned wizard flow. 5 steps since REQ-544 (Data, Kinds, Each kind, Value story, Terms and accept); the records found
// come first and no money shows before the Data step is done; the case plan is asked only after the Filter step, with the chosen scope;
// "Credit" reads "Share caused by this use case"; the confidence is its own Low/Medium/High question, apart from the money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { goTo507, mountReq507, routesOf, textOf } from './req507Support.mjs';

test.after(closeBrowser);

const STEPS = ['Data', 'Kinds', 'Each kind', 'Value story', 'Terms and accept'];

test('R507-F1: the wizard opens on the records found, asks the scope route first, not the case plan, and shows no money', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    const steps = await dialog.getByRole('list', { name: 'Steps' }).locator('li').allInnerTexts();
    assert.deepEqual(steps.map((s) => s.replace(/^[\d✓]+\s*/, '').trim()), STEPS);
    assert.equal(routesOf(calls)[0], 'scope');
    assert.equal(calls[0].body.use_case_id, 'N01-U01');
    assert.ok(!routesOf(calls).includes('case-plan'), 'no case plan before the scope is chosen');
    assert.match(await textOf(dialog.locator('[data-scope-facts]')), /3,412,880 review cases, 1 Jan 2019 to 30 Sep 2026, dated by created_at/);
    assert.doesNotMatch(await textOf(dialog.locator('[data-wizard-body]')), /\$|USD/, 'no money on the Data step');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-F2: All data, then Next, asks the case plan once with the chosen scope and currency', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    await dialog.locator('[data-wizard-page="scope:choice"]').waitFor();
    await dialog.locator('[data-scope-choice="all"]').click();
    assert.equal(await dialog.locator('[data-scope-choice="all"]').getAttribute('aria-pressed'), 'true');
    assert.doesNotMatch(await textOf(dialog.locator('[data-wizard-body]')), /\$|USD/, 'no money on the scope choice');
    assert.ok(!routesOf(calls).includes('case-plan'), 'no case plan on the Data step');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    const plans = calls.filter((c) => c.route === 'case-plan');
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0].body.scope, { phrase: 'All data', filters: [], window: null, rows_before: 3412880, rows_after: 3412880, first: '2019-01-01', last: '2026-09-30' });
    assert.equal(plans[0].body.currency, 'USD');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-F3: "Share caused by this use case" replaces Credit, and confidence is a Low/Medium/High question that does not move the money', async () => {
  const calls = [];
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ calls, puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'economics:ramp');
    assert.ok(await dialog.getByText('Share caused by this use case').count() > 0);
    await goTo507(dialog, 'economics:cost');
    const confidence = dialog.getByRole('radiogroup', { name: 'How confident are you in this value?' });
    assert.equal(await confidence.getByRole('radio').count(), 3);
    for (const name of ['Low', 'Medium', 'High']) assert.equal(await confidence.getByRole('radio', { name, exact: true }).count(), 1, name);
    assert.equal(await confidence.getByRole('radio', { checked: true }).count(), 0, 'no confidence is picked for the person');
    const before = calls.filter((c) => c.route === 'preview').at(-1)?.body.answers.attribution_pct;
    await confidence.getByRole('radio', { name: 'Medium' }).check();
    const after = calls.filter((c) => c.route === 'preview').at(-1)?.body.answers.attribution_pct;
    assert.equal(after, before, 'the confidence is not the share');
    assert.equal(await dialog.locator('[role=meter][aria-label="Your confidence in this value"]').count(), 0, 'the confidence is no longer drawn from the share');
    assert.doesNotMatch(await textOf(dialog.locator('[data-wizard-body]')), /\bCredit\b/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-F4: without economic factors the Public market data fold is absent, and the saved answers carry scope, economics and confidence', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'economics:cost');
    await dialog.getByRole('radiogroup', { name: 'How confident are you in this value?' }).getByRole('radio', { name: 'High' }).check();
    await goTo507(dialog, 'story:draft');
    assert.equal(await dialog.locator('[data-wizard-page="macro:offer"]').count(), 0);
    await goTo507(dialog, 'terms');
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Accept and save' }).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    const a = puts[0].answers;
    assert.ok(a.scope && Array.isArray(a.scope.filters), 'scope saved');
    assert.deepEqual(a.economics.ramp_pct, [40, 80, 100]);
    assert.equal(a.confidence, 'high');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
