// REQ-507 L6 (StepEconomics, StepStory; green once L7 wires them): Ramp and cost, then the value story. The ramp defaults to 40/80/100;
// costs give net, payback and ROI from the server projection; the draft is a headline and 5 lines; every parameter is listed with its source tag
// and an owner; approval needs the terms ticked, sends no who/when, and is cleared by a later change to a parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { goTo507, mountReq507, textOf } from './req507Support.mjs';

test.after(closeBrowser);

const waitFor = async (fn) => {
  for (let i = 0; i < 60 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 100));
};

test('R507-E1: the ramp defaults to 40/80/100; costs show net, payback and ROI from the server and are sent as answers.economics', async () => {
  const calls = [];
  const { ui, card, page } = await openCard(mountReq507({ calls }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'economics:ramp');
    const ramp = [1, 2, 3].map((y) => dialog.getByRole('spinbutton', { name: `Year ${y} share captured (%)` }));
    assert.deepEqual(await Promise.all(ramp.map((r) => r.inputValue())), ['40', '80', '100']);
    assert.equal(await dialog.locator('[data-projection-year]').count(), 3);
    await goTo507(dialog, 'economics:cost');
    assert.match(await textOf(dialog.locator('[data-wizard-body]')), /gross/i, 'with no cost the value is labelled gross');
    // The story table lists the cost too (REQ-544), so the Ramp and cost editor is picked by its section.
    const costSection = dialog.locator('[data-wizard-page="economics:cost"]');
    await costSection.getByRole('spinbutton', { name: 'Build cost (one-off)' }).fill('20000');
    await costSection.getByRole('spinbutton', { name: 'Run cost per year' }).fill('1000');
    await waitFor(() => calls.some((c) => c.route === 'preview' && c.body.answers.economics?.build_cost === 20000 && c.body.answers.economics?.run_cost_per_year === 1000));
    const sent = calls.filter((c) => c.route === 'preview').at(-1).body.answers.economics;
    assert.deepEqual(sent.ramp_pct, [40, 80, 100]);
    await dialog.locator('[data-payback]').filter({ hasText: '6 months' }).waitFor({ timeout: 10000 });
    assert.match(await textOf(dialog.locator('[data-net-3y]')), /\$/);
    assert.match(await textOf(dialog.locator('[data-roi]')), /\d/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-E2: the story draft is a headline and 5 labelled lines; the parameter table tags each source and takes an owner', async () => {
  const { ui, card, page } = await openCard(mountReq507());
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'story:draft');
    assert.ok((await textOf(dialog.locator('[data-story-headline]'))).length > 10);
    assert.deepEqual(await dialog.locator('[data-story-line]').evaluateAll((els) => els.map((e) => e.getAttribute('data-story-line'))), ['Today', 'Data', 'Change', 'Return', 'Ask']);
    assert.match(await textOf(dialog.locator('[data-story-line="Data"]')), /3,412,880/);
    await goTo507(dialog, 'story:params');
    const tags = await dialog.locator('[data-param] [data-source-tag]').allInnerTexts();
    assert.ok(tags.includes('DATA') && tags.includes('AI') && tags.includes('YOU'), tags.join(','));
    assert.ok(tags.every((t) => ['DATA', 'YOU', 'AI', 'PUBLIC'].includes(t.trim())), tags.join(','));
    const owner = dialog.locator('[data-param="reduction_pct"]').getByRole('textbox', { name: /^Owner of / });
    await owner.fill('Finance');
    assert.equal(await owner.inputValue(), 'Finance');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-E3: Accept and save needs the terms; the PUT carries the story with include_in_docs and no browser-stamped who or when', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'story:approve');
    const approve = dialog.getByRole('button', { name: 'Accept and save' });
    assert.equal(await approve.isDisabled(), true, 'the terms come first');
    const include = dialog.getByLabel('Include this story in generated docs');
    assert.equal(await include.isChecked(), true);
    await dialog.getByLabel('I have read and accept these terms').check();
    await approve.click();
    await waitFor(() => puts.length > 0);
    const story = puts[0].answers.story;
    assert.equal(story.approved, true);
    assert.equal(story.include_in_docs, true);
    assert.ok(story.text.length > 10 && typeof story.params_hash === 'string' && story.params_hash.length > 0);
    assert.ok(story.approved_by == null && story.approved_at == null, 'the server stamps the approval');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('R507-E4: a parameter changed after the approval clears it', async () => {
  const { ui, card, page } = await openCard(mountReq507());
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'story:approve');
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.locator('[data-wizard-page="story:params"]').waitFor();
    const value = dialog.locator('[data-param="reduction_pct"]').getByRole('spinbutton');
    await value.fill('35');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.locator('[data-wizard-page="terms"]').waitFor();
    assert.equal(await dialog.getByLabel('I have read and accept these terms').isChecked(), false, 'a changed parameter clears the approval');
    assert.equal(await dialog.getByRole('button', { name: 'Accept and save' }).isDisabled(), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
