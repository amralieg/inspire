import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STUDIO_STATE } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const ROOT = new URL('../../../', import.meta.url);

// REQ-143: the Genie progress drawer overlays the Build page. The page keeps its full width when the drawer opens.
test('REQ-143 the Build progress drawer overlays the page: the use case pane keeps its width with the drawer open, at 1440x900 and 1920x1080', async () => {
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
      const paddingEnd = await page.locator('[data-implement-page]').evaluate((el) => getComputedStyle(el).paddingRight);
      assert.equal(paddingEnd, '24px', `the page does not reserve a column for the drawer at ${width}px (padding-right ${paddingEnd})`);
      const openPane = await page.locator('[data-use-case-pane]').boundingBox();
      const dock = await page.locator('[data-progress-dock]').evaluate((el) => getComputedStyle(el).position);
      assert.equal(dock, 'fixed', 'the drawer is fixed over the page');
      const box = await dialog.boundingBox();
      assert.ok(openPane.x + openPane.width > box.x, `the drawer sits over the use case pane at ${width}px`);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const closedPane = await page.locator('[data-use-case-pane]').boundingBox();
      assert.ok(Math.abs(openPane.width - closedPane.width) <= 1,
        `the use case pane is as wide with the drawer open (${Math.round(openPane.width)}px) as closed (${Math.round(closedPane.width)}px) at ${width}px`);
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
