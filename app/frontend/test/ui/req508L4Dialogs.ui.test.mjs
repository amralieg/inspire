// REQ-508 L4 (Art Director pass, "A Calm Console"): drawers and dialogs share one overlay layer (z 50, black/40 scrim), drawers slide in
// over 220 ms, dialogs scale-and-fade in over 200 ms with the lg radius, and focus returns to the trigger on close. Audit
// scratch/req508_art_director.md F26, F27, section 2.2. Fail-pre (15eb146b9): DrawerShell sits on z-[70] with no enter animation
// (DrawerShell.jsx:120) and the centre dialog has a 12px radius (rounded-xl) and no animation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, openFeatures, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');

// The fixed layer that holds a dialog, its scrim colour, and the panel's animation and radius, as computed by the browser.
async function layerOf(dialog) {
  return dialog.evaluate((el) => {
    let layer = el;
    while (layer && getComputedStyle(layer).position !== 'fixed') layer = layer.parentElement;
    const scrims = layer ? [...layer.querySelectorAll('*')].filter((n) => !el.contains(n) && n !== el).map((n) => getComputedStyle(n).backgroundColor) : [];
    const s = getComputedStyle(el);
    return { z: layer ? getComputedStyle(layer).zIndex : null, scrims, animation: s.animationName, duration: s.animationDuration,
      easing: s.animationTimingFunction.replace(/\s+/g, ''), radius: s.borderTopLeftRadius };
  });
}

test('the Use case details drawer opens on the overlay layer (z 50) over a black/40 scrim, slides in over 220 ms, and Escape returns focus', async () => {
  const ui = await openUi('implement', { useCase: HARNESS_USE_CASE });
  const { page } = ui;
  try {
    const trigger = page.getByRole('button', { name: 'Use case details', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: /^Use case details: / });
    await dialog.waitFor({ timeout: 15000 });
    const got = await layerOf(dialog);
    assert.equal(got.z, '50', `the drawer shares the overlay layer (got z ${got.z})`);
    assert.ok(got.scrims.includes('rgba(0, 0, 0, 0.4)'), `a black/40 scrim sits behind the drawer (got ${got.scrims.join(' | ')})`);
    assert.notEqual(got.animation, 'none', 'the drawer has an enter animation');
    assert.equal(got.duration, '0.22s');
    assert.equal(got.easing, 'cubic-bezier(0.16,1,0.3,1)');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(await trigger.evaluate((b) => b === document.activeElement), true, 'focus returns to the button that opened the drawer (must-keep)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the centre dialog (Vibe features) uses the same layer and scrim, the lg radius (14px) and a 200 ms enter animation', async () => {
  const ui = await openUi('implement', { history: [built()], me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await page.locator('[data-asset-tiles]').waitFor({ timeout: 15000 });
    await expandBuild(page);
    const shell = await openFeatures(page);
    const dialog = shell.getByRole('dialog').or(shell.locator('[role="dialog"]')).first();
    const target = (await dialog.count()) ? dialog : shell;
    const got = await layerOf(target);
    assert.equal(got.z, '50', `the dialog sits on the overlay layer (got z ${got.z})`);
    assert.ok(got.scrims.includes('rgba(0, 0, 0, 0.4)'), `a black/40 scrim sits behind the dialog (got ${got.scrims.join(' | ')})`);
    assert.equal(got.radius, '14px', 'dialogs use radius lg');
    assert.notEqual(got.animation, 'none', 'the dialog has an enter animation');
    assert.equal(got.duration, '0.2s');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with prefers-reduced-motion the drawer opens with no motion longer than 80 ms (must-keep)', async () => {
  const ui = await openUi('implement', { useCase: HARNESS_USE_CASE }, '', { init: (page) => page.emulateMedia({ reducedMotion: 'reduce' }) });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Use case details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Use case details: / });
    await dialog.waitFor({ timeout: 15000 });
    const got = await layerOf(dialog);
    assert.ok(got.animation === 'none' || got.duration.split(',').every((d) => parseFloat(d) <= 0.08), `got ${got.animation} ${got.duration}`);
  } finally {
    await ui.close();
  }
});
