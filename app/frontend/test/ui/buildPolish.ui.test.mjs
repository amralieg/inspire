import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STUDIO_STATE } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ROOT = new URL('../../../', import.meta.url);

// REQ-143: the Genie progress drawer overlays the Build page. The page keeps its full width when the drawer opens.
test('REQ-143 / RC7-C-05 the Build progress drawer pushes the page aside: the use case pane gives way to the drawer, never sits under it, at 1440x900 and 1920x1080', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    for (const [width, height] of [[1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const card = page.locator('[data-progress-card]');
      const dialog = page.locator('[data-progress-dock] [data-progress-panel] [role="dialog"]');
      if (width === 1440) assert.equal(await card.getAttribute('data-progress-open'), 'false', 'page load keeps the drawer closed');
      if (await card.getAttribute('data-progress-open') === 'false') await card.locator('[data-progress-show]').click();
      await dialog.waitFor();
      assert.equal(await card.getAttribute('data-progress-open'), 'true', `Show progress opens the drawer at ${width}px`);
      const paddingEnd = await page.locator('[data-implement-page]').evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
      const openPane = await page.locator('[data-use-case-pane]').boundingBox();
      const dock = await page.locator('[data-progress-dock]').evaluate((el) => getComputedStyle(el).position);
      assert.equal(dock, 'fixed', 'the drawer is fixed over the page');
      const box = await dialog.boundingBox();
      assert.ok(openPane.x + openPane.width <= box.x + 1, `the use case pane ends before the drawer at ${width}px`);
      assert.ok(Math.abs(paddingEnd - (24 + box.width)) <= 2, `the page reserves the drawer's width at ${width}px (padding-right ${paddingEnd}, drawer ${box.width})`);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const closedPane = await page.locator('[data-use-case-pane]').boundingBox();
      assert.ok(closedPane.width > openPane.width + 1,
        `the use case pane takes the width back when the drawer closes (open ${Math.round(openPane.width)}px, closed ${Math.round(closedPane.width)}px) at ${width}px`);
      await page.locator('[data-progress-show]').click();
      await dialog.waitFor();
    }
  } finally {
    await ui.close();
  }
});

// REQ-145: the selected use case header wraps cleanly: no overlapping action buttons, a two-line title, and "· v1" on the domain line.
test('REQ-145 the selected use case header: title wraps to two lines with a tooltip, version stays on the domain line, action buttons do not overlap', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const header = page.locator('[data-pinned-name]');
      await header.waitFor();
      const title = header.locator('h2');
      const clamp = await title.evaluate((el) => getComputedStyle(el).webkitLineClamp);
      assert.equal(clamp, '2', `the title wraps to two lines before it truncates at ${width}px`);
      assert.equal(await title.getAttribute('title'), await title.textContent(), 'the full name is a tooltip');
      const version = header.locator('span', { hasText: /^· v\d+$/ });
      if (await version.count()) {
        const [v, meta] = await Promise.all([version.first().boundingBox(), header.locator('[data-use-case-meta]').boundingBox()]);
        assert.ok(v.y >= meta.y - 1 && v.y + v.height <= meta.y + meta.height + 1, `"· v" stays on the domain line at ${width}px`);
      }
      const buttons = await header.locator('button:visible').evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      for (let i = 0; i < buttons.length; i += 1) {
        for (let j = i + 1; j < buttons.length; j += 1) {
          const a = buttons[i];
          const b = buttons[j];
          const overlap = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
          assert.ok(!overlap, `"${a.label}" and "${b.label}" do not overlap at ${width}px`);
        }
      }
    }
  } finally {
    await ui.close();
  }
});

// REQ-146: the Best-of-Best reason names the use cases that meet the quality bar, not the whole catalog.
test('REQ-146 the Best-of-Best short-list label counts only the use cases that meet the quality bar, in both notebook copies', async () => {
  const { readFile } = await import('node:fs/promises');
  const agent = await readFile(new URL('agent/agent/dbx_inspire_ai_agent.ipynb', ROOT), 'utf8');
  const copy = await readFile(new URL('dbx_inspire_ai_agent.ipynb', ROOT), 'utf8');
  assert.equal(agent, copy, 'the bundled notebook is byte-identical to the agent notebook');
  assert.equal(agent.includes('the catalog holds'), false, 'no label says the catalog holds the subset');
  assert.ok(agent.includes("'meets' if len(use_cases) == 1 else 'meet'} the quality bar, not more than"), 'the short-list label says the quality bar');
  const nb = JSON.parse(readFileSync(new URL('dbx_inspire_ai_agent.ipynb', ROOT), 'utf8'));
  assert.ok(nb.cells.some((c) => c.cell_type === 'code' && c.source.join('').includes("'meet'} the quality bar, not more than")), 'the label is in a code cell');
});

// REQ-143 (Amr, verbatim: "Genie progress overlay the page not push it to the side"): the Build progress drawer overlays the page at
// every width. Opening it never squeezes the page: the page box and every card's x position stay the same, the drawer closes with
// its Close button and with Escape, and after it closes the card's Vibe/Add button is clickable.
test('REQ-143 / RC7-C-05 the Build progress drawer pushes the page aside at 1024, 1280, 1440 and 1920: nothing sits under it, and it closes by Close and Escape', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  const boxes = () => page.evaluate(() => {
    const at = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; };
    const pane = document.querySelector('[data-use-case-pane]');
    return {
      page: at(document.querySelector('[data-implement-page]')),
      pane: pane ? at(pane) : null,
      cards: [...document.querySelectorAll('[data-use-case-pane] [data-asset-tile], [data-use-case-pane] button:not([disabled])')]
        .filter((el) => el.getClientRects().length > 0).map((el) => at(el)[0]),
    };
  });
  const dialog = page.locator('[data-progress-dock] [data-progress-panel] [role="dialog"]');
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    for (const [width, height] of [[1024, 700], [1280, 800], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const card = page.locator('[data-progress-card]');
      if (await card.getAttribute('data-progress-open') === 'true') await card.locator('[data-progress-show]').click();
      await page.locator('[data-progress-card][data-progress-open="false"]').waitFor();
      const closed = await boxes();
      await card.locator('[data-progress-show]').click();
      await dialog.waitFor();
      const open = await boxes();
      const drawer = await dialog.boundingBox();
      assert.ok(open.page[0] === closed.page[0], `the page keeps its left edge at ${width}px`);
      assert.ok(open.pane[0] + open.pane[1] <= drawer.x + 1, `the use case pane ends before the drawer at ${width}px (pane ${open.pane}, drawer ${drawer.x})`);
      assert.ok(open.pane[0] === closed.pane[0], `the use case pane keeps its left edge at ${width}px`);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await card.locator('[data-progress-show]').click();
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: 5000 });
      const vibe = page.locator('[data-use-case-pane]').getByRole('button', { name: /^Vibe\/Add/ }).first();
      assert.ok(await vibe.count() > 0, 'the card has a Vibe/Add button');
      await vibe.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const r = await vibe.boundingBox();
      const hit = await vibe.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [r.x + r.width / 2, r.y + r.height / 2]);
      assert.equal(hit, true, `after the drawer closes, the Vibe/Add button is clickable at ${width}px`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
