// REQ-496 item 6 (Amr, 11-23 00:59: "accept tic box, the button ... 'Tic accept to proceed'"): on the last value step, while the terms are not
// ticked, the save button says what to do: a visible "Tick ... accept ... to proceed" line in the button or tied to it by aria-describedby.
// Once ticked, that line goes and the button saves. The button keeps "Approve story and save" in its name (req507Story R507-E3/E4).
// Fail-pre (0289c7e85): StepStory.jsx:88-89 is a disabled "Approve story and save" with no words on why it is disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { openCard, openWizard } from './valueWizardSupport.mjs';
import { goTo507, mountReq507 } from './req507Support.mjs';

test.after(closeBrowser);

const HINT = /tick.{0,40}accept.{0,40}(proceed|continue)/i;
// The words the button carries for the person: its own visible text plus every visible element it names in aria-describedby.
const buttonWords = (button) => button.evaluate((b) => {
  const seen = (el) => el && el.checkVisibility() && el.getBoundingClientRect().width > 0;
  const own = seen(b) ? b.innerText : '';
  const described = (b.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)).filter(seen).map((el) => el.innerText);
  return [own, ...described].join(' ').replace(/\s+/g, ' ').trim();
});

test('T1: unticked, the save button says "Tick accept to proceed"; ticked, the line goes and the button is enabled', async () => {
  const { ui, card, page } = await openCard(mountReq507());
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'story:approve');
    const approve = dialog.getByRole('button', { name: /Approve story and save/ });
    assert.equal(await approve.isDisabled(), true, 'the terms come first');
    const before = await buttonWords(approve);
    assert.match(before, HINT, `the disabled button tells the person to tick accept to proceed, it says: "${before}"`);
    await dialog.getByLabel('I have read and accept these terms').check();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Approve story and save/.test(b.textContent) && b.disabled), null, { timeout: 5000 });
    assert.equal(await approve.isDisabled(), false, 'ticked: the button saves');
    const after = await buttonWords(approve);
    assert.doesNotMatch(after, HINT, `ticked: the tick line is gone, the button says: "${after}"`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
