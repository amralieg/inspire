// c47 UI lane acceptance (REQ-581 U2): a skipped step is settled at the stage level too. In the Every step dialog each stage shows once in
// the stage list (left) and once as a group header (steps list). A stage whose steps all ended, one of them skipped, reads done (success
// tick, n/n, not a waiting clock); a stage with only skipped steps reads skipped (neutral, n/n); neither spins nor reads as an error.
// Contract: the stage list button carries data-stage-filter="<stage_name>" and the group header button data-stage-group="<stage_name>";
// both carry data-stage-state="<done|skipped|error|running|waiting>" from monitorState.stageProgressOf, and the list button shows
// "<settled>/<total>". Written by the c47 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { MONITOR_MOUNT, RUN_DONE, SESSION_DONE } from './c36Fixtures.mjs';
import { MIXED_STAGE, SKIPPED_STAGE, SKIP_STAGE_STEPS } from './c47Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));

async function openEveryStep(page) {
  const button = page.getByRole('button', { name: /Every step/ });
  await button.waitFor({ timeout: 20000 });
  await button.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10000 });
  return dialog;
}

test('REQ-581 U2: a stage with a skipped step is done, an all-skipped stage is skipped; no waiting clock, spinner or error (must-fail on the base)', async () => {
  const ui = await openUi('monitor', { runRead: RUN_DONE, inspireSession: SESSION_DONE, runSteps: SKIP_STAGE_STEPS }, '', { mount: MONITOR_MOUNT });
  const { page } = ui;
  try {
    const dialog = await openEveryStep(page);
    for (const [stage, state, counts] of [[MIXED_STAGE, 'done', '2/2'], [SKIPPED_STAGE, 'skipped', '1/1']]) {
      const listButton = dialog.locator(`[data-stage-filter="${stage}"]`);
      await listButton.first().waitFor({ timeout: 10000 });
      assert.equal(await listButton.getAttribute('data-stage-state'), state, `${stage} in the stage list is ${state}`);
      assert.ok((await listButton.innerText()).includes(counts), `${stage} counts its skipped step as settled (${counts})`);
      const header = dialog.locator(`[data-stage-group="${stage}"]`);
      await header.first().waitFor({ timeout: 10000 });
      assert.equal(await header.getAttribute('data-stage-state'), state, `${stage} group header is ${state}`);
      for (const el of [listButton, header]) {
        assert.equal(await el.locator('.animate-spin').count(), 0, `${stage}: no spinner`);
        assert.equal(await el.locator('.text-error-fg').count(), 0, `${stage}: nothing in error colour`);
      }
    }
    assert.equal(await dialog.locator('[data-stage-filter="Setup"]').getAttribute('data-stage-state'), 'done', 'an all-success stage stays done');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
