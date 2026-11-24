// REQ-506 lane 1 (shell): Mission Control top bar, no side rail, avatar menu, first-open welcome card, Work as home, Screen | Genie switch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const INFO = () => appInfo(DECIDE, 1, TABLE);
const PAGE = 'n01_u05';
// The shell is up: the app root is mounted (the default ready selector waits for dashboard KPIs, which Work-as-home does not show first).
const READY = '[data-ready]';
const open = (hash = '', info = INFO()) => openApp(browser, served.base, info, { hash, ready: READY });
const hashOf = (page) => page.evaluate(() => location.hash);
const visibleControls = (scope) => scope.locator('button, a[href], select, input, [role="button"], [role="tab"]').evaluateAll(
  (els) => els.filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0).length);

test('the top bar has at most 5 controls: use case, Screen | Genie, the value chip right before the avatar menu', async () => {
  const { page, context, seen } = await open(`#/${PAGE}/work`);
  try {
    const top = page.locator('header.top');
    await top.locator('[data-mode-switch]').waitFor({ state: 'visible' });
    assert.equal(await top.locator('[data-switcher]').count(), 1, 'one use case picker');
    assert.deepEqual(await top.locator('[data-mode-switch] [data-mode]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mode'))), ['screen', 'genie']);
    assert.deepEqual(await top.locator('[data-mode-switch] [data-mode]').allInnerTexts(), ['Screen', 'Genie']);
    assert.equal(await top.locator('[data-top-value]').count(), 1, 'the value chip slot is in the top bar');
    assert.equal(await top.locator('[data-avatar-menu]').count(), 1, 'one avatar menu');
    assert.equal(await top.locator('[data-top-value]').evaluate((el) => el.nextElementSibling?.matches('[data-avatar-menu]') === true), true,
      'the value chip sits right before the avatar');
    assert.ok(await visibleControls(top) <= 5, `the top bar shows at most 5 controls, saw ${await visibleControls(top)}`);
    for (const gone of ['nav.side', '[data-rail]', '.genie-btn', '[data-use-cases]', '[data-tour-top]', '.menu-btn']) {
      assert.equal(await page.locator(gone).count(), 0, `${gone} is gone`);
    }
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('the avatar menu holds the theme, the tour and Settings; Settings and the old deep links still open', async () => {
  const { page, context, seen } = await open(`#/${PAGE}/work`);
  try {
    await page.locator('[data-avatar-menu] button').first().click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible' });
    const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    for (const want of [/theme|dark|light/i, /tour|help/i, /^settings$/i]) {
      assert.ok(items.some((t) => want.test(t)), `the avatar menu has ${want}: ${JSON.stringify(items)}`);
    }
    await menu.getByRole('menuitem', { name: /^settings$/i }).click();
    await page.locator('[data-group="measurement"]').waitFor({ state: 'visible' });
    assert.match(await hashOf(page), /settings/);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
  const deep = await open(`#/${PAGE}/settings`);
  try {
    await deep.page.locator('[data-group="measurement"]').waitFor({ state: 'visible' });
    assert.equal(await deep.page.locator('nav.side').count(), 0, 'a deep link opens the place without bringing the rail back');
    assert.deepEqual(deep.seen.errors, []);
  } finally {
    await deep.context.close();
  }
});

test('the first open shows the mission card once per person, with 3 steps and the two ways to work', async () => {
  const info = INFO();
  const { page, context, seen } = await open('', info);
  try {
    const card = page.locator('[data-welcome]');
    await card.waitFor({ state: 'visible' });
    assert.ok((await card.innerText()).includes(info.pages[0].question), 'the card says the mission in the use case words');
    assert.equal(await card.locator('[data-welcome-step]').count(), 3);
    assert.equal(await card.locator('[data-welcome-choice="screen"]').count(), 1);
    assert.equal(await card.locator('[data-welcome-choice="genie"]').count(), 1);
    assert.notEqual(await card.evaluate((el) => el.closest('dialog[open], [aria-modal="true"]') !== null), true, 'the card is not a modal that blocks the list');
    await card.locator('[data-welcome-choice="screen"]').click();
    await card.waitFor({ state: 'detached' });
    assert.match(await hashOf(page), new RegExp(`^#/${PAGE}/work`), 'Use the screen lands on the Work list');
    await page.reload();
    await page.locator('[data-ready]').waitFor({ state: 'attached' });
    await page.locator('[data-mode-switch]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-welcome]').count(), 0, 'the card is remembered for this person');
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('Talk to Genie on the welcome card opens the full Genie pane', async () => {
  const { page, context, seen } = await open('');
  try {
    await page.locator('[data-welcome-choice="genie"]').click();
    await page.locator('[data-genie-full]').waitFor({ state: 'visible' });
    assert.match(await hashOf(page), new RegExp(`^#/${PAGE}/genie`));
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('Work is the home, and the Screen | Genie switch moves between the list and the full Genie pane', async () => {
  const { page, context, seen } = await open('');
  try {
    await page.waitForFunction((p) => location.hash.startsWith(`#/${p}/work`), PAGE);
    await page.locator('.card--table tbody tr').first().waitFor({ state: 'visible' });
    const screen = page.locator('[data-mode-switch] [data-mode="screen"]');
    const genie = page.locator('[data-mode-switch] [data-mode="genie"]');
    assert.equal(await screen.getAttribute('aria-pressed'), 'true');
    await genie.click();
    await page.locator('[data-genie-full]').waitFor({ state: 'visible' });
    assert.equal(await genie.getAttribute('aria-pressed'), 'true');
    assert.equal(await screen.getAttribute('aria-pressed'), 'false');
    assert.match(await hashOf(page), new RegExp(`^#/${PAGE}/genie`));
    await screen.click();
    await page.locator('[data-genie-full]').waitFor({ state: 'detached' });
    assert.match(await hashOf(page), new RegExp(`^#/${PAGE}/work`));
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('a genie deep link opens the full pane; old inbox and agent links fall back to Work; there is no dock', async () => {
  const genie = await open(`#/${PAGE}/genie`);
  try {
    await genie.page.locator('[data-genie-full]').waitFor({ state: 'visible' });
    assert.deepEqual(genie.seen.errors, []);
  } finally {
    await genie.context.close();
  }
  for (const old of ['inbox', 'agent']) {
    const { page, context, seen } = await open(`#/${PAGE}/${old}`);
    try {
      await page.locator('.card--table tbody tr').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-dock], .dock-tabs, [data-dock-tab]').count(), 0, 'one Genie surface, no dock');
      assert.equal(await page.locator('[data-page-section="inbox"], [data-agent-page]').count(), 0, `${old} is not a place any more`);
      assert.deepEqual(seen.errors, []);
    } finally {
      await context.close();
    }
  }
});
