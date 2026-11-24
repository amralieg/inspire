// REQ-510 L1 (declutter after REQ-508): one shared More menu, components/ui/MoreMenu.jsx, that every page uses for its secondary
// actions (briefs/req510_spec.md section 1, G3). Fail-pre (a037bfdfb): the file does not exist, so the harness shows "MoreMenu missing".
// Contract: a "More" button (aria-haspopup="menu", aria-expanded) opens role=menu with role=menuitem entries; arrow keys move between
// enabled items; Escape, an outside click or picking an item closes it and focus returns to the trigger; one menu open at a time;
// the panel enters with a short fade (<= 200 ms, 60 ms or less with reduced motion); a danger item is never a filled red button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { SOLID_REDS } from './req510Declutter.mjs';

test.after(closeBrowser);

async function openMenuHarness(opts = {}) {
  const ui = await openUi('moreMenu', {}, '', opts);
  await ui.page.locator('button, [data-more-menu-missing]').first().waitFor({ timeout: 20000 });
  assert.equal(await ui.page.locator('[data-more-menu-missing]').count(), 0, 'components/ui/MoreMenu.jsx exists and default-exports the menu');
  return ui;
}

test('the More button is a menu button; clicking it opens a menu of items with the first one focused', async () => {
  const ui = await openMenuHarness();
  const { page } = ui;
  try {
    const more = page.getByRole('button', { name: 'More', exact: true });
    assert.equal(await more.getAttribute('aria-haspopup'), 'menu');
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('menu').count(), 0, 'no menu before the click');
    await more.click();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    const menu = page.getByRole('menu');
    await menu.waitFor();
    assert.deepEqual((await menu.getByRole('menuitem').allInnerTexts()).map((s) => s.trim()), ['Download profile', 'Go to Build', 'Not now', 'Delete run']);
    assert.equal(await menu.getByRole('menuitem', { name: 'Not now' }).getAttribute('aria-disabled'), 'true', 'a disabled item says so');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Download profile', 'focus moves to the first item');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('keyboard: arrows skip the disabled item, Escape closes and puts focus back on the More button', async () => {
  const ui = await openMenuHarness();
  const { page } = ui;
  try {
    const more = page.getByRole('button', { name: 'More', exact: true });
    await more.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Go to Build');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'Delete run', 'the disabled "Not now" is skipped');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(), 'Go to Build');
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup')), 'menu', 'focus is back on the trigger');
  } finally {
    await ui.close();
  }
});

test('picking an item runs it once and closes the menu; a disabled item does nothing; an outside click closes', async () => {
  const ui = await openMenuHarness();
  const { page } = ui;
  try {
    const more = page.getByRole('button', { name: 'More', exact: true });
    await more.click();
    await page.getByRole('menuitem', { name: 'Not now' }).click({ force: true });
    assert.equal(await page.locator('output[aria-label="More picks"]').textContent(), '', 'the disabled item ran nothing');
    await page.getByRole('menuitem', { name: 'Go to Build' }).click();
    await page.getByRole('menu').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('output[aria-label="More picks"]').textContent(), 'build');
    await more.click();
    await page.getByRole('menu').waitFor();
    await page.mouse.click(1200, 800);
    await page.getByRole('menu').waitFor({ state: 'detached', timeout: 5000 });
  } finally {
    await ui.close();
  }
});

test('one menu at a time, and a named trigger ("More for Acme") works the same way', async () => {
  const ui = await openMenuHarness();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menu').waitFor();
    const named = page.getByRole('button', { name: 'More for Acme', exact: true });
    assert.equal(await named.getAttribute('aria-haspopup'), 'menu');
    await named.click();
    assert.equal(await page.getByRole('menu').count(), 1, 'opening the second menu closed the first');
    await page.getByRole('menuitem', { name: 'Quick view' }).click();
    assert.equal(await page.locator('output[aria-label="More picks"]').textContent(), 'quick');
  } finally {
    await ui.close();
  }
});

test('the menu fades in within 200 ms (60 ms or less with reduced motion); items and the trigger are not filled red', async () => {
  for (const reduced of [false, true]) {
    const ui = await openMenuHarness({ init: reduced ? (page) => page.emulateMedia({ reducedMotion: 'reduce' }) : undefined });
    const { page } = ui;
    try {
      const more = page.getByRole('button', { name: 'More', exact: true });
      await more.click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      const facts = await menu.evaluate((el) => {
        const s = getComputedStyle(el);
        const ms = (v) => Math.max(...String(v).split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000)));
        return { name: s.animationName, ms: ms(s.animationDuration) };
      });
      assert.notEqual(facts.name, 'none', 'the menu panel has an enter animation');
      assert.ok(facts.ms > 0 && facts.ms <= (reduced ? 60 : 200), `enter lasts ${facts.ms} ms (reduced=${reduced})`);
      const fills = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], button[aria-haspopup="menu"]')].map((e) => getComputedStyle(e).backgroundColor));
      for (const bg of fills) assert.ok(!SOLID_REDS.includes(bg), `no filled red trigger or item (got ${bg})`);
    } finally {
      await ui.close();
    }
  }
});
