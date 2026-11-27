// REQ-545 c30_menu: the More menu panel is never covered or clipped, on every page, in both directions and at two sizes.
// For each More site the harness can reach: open the menu, then for EVERY item the element at the item's centre is the item itself,
// and the item box lies fully inside the viewport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const SIZES = [{ width: 1024, height: 768 }, { width: 1440, height: 900 }];
const DIRS = ['ltr', 'rtl'];
const SESSION = { session_id: '1001', business_name: 'Acme Retail', completed_percent: 100, processing_status: 'done', created_at: '2026-10-01T09:00:00Z' };

// Opens the menu named by `trigger` (a role=button name matcher inside optional scope) and returns what covers or clips each item.
async function probe(page, trigger, scope) {
  const root = scope ? page.locator(scope) : page;
  await root.getByRole('button', { name: trigger }).first().click();
  await page.getByRole('menu').first().waitFor();
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const out = [];
    const menu = document.querySelector('[role="menu"]');
    for (const item of menu.querySelectorAll('[role="menuitem"]')) {
      const r = item.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.push({
        item: item.textContent.trim(),
        covered: !(at && (at === item || item.contains(at))) ? (at ? `${at.tagName.toLowerCase()}${at.getAttribute('role') ? `[role=${at.getAttribute('role')}]` : ''} ${at.getAttribute('aria-label') || ''}` : 'nothing') : '',
        outside: r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight
          ? `box ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} in ${window.innerWidth}x${window.innerHeight}` : '',
      });
    }
    return out;
  });
}

function assertClear(found, where) {
  assert.ok(found.length > 0, `${where}: the menu has items`);
  for (const f of found) {
    assert.equal(f.covered, '', `${where}: "${f.item}" is covered by ${f.covered}`);
    assert.equal(f.outside, '', `${where}: "${f.item}" is clipped, ${f.outside}`);
  }
}

const SITES = [
  { name: 'Choose header', open: ['choose', {}, ''], trigger: /^More$/ },
  { name: 'Choose run row', open: ['choose', {}, '', { mount: (app) => app.get('/api/inspire/sessions', (_req, res) => res.json({ sessions: [SESSION] })) }], wait: (p) => p.getByText('Acme Retail').first().waitFor(), trigger: /^More for /, scope: undefined },
  { name: 'Launch', open: ['launch', {}, ''], trigger: /^More$/ },
  { name: 'Monitor', open: ['monitor', {}, '&run=none'], trigger: /^More$/ },
  { name: 'Implement', open: ['implement', STUDIO_STATE, ''], trigger: /^More$/, scope: '[aria-label="Use case"]' },
  // The pane is only ~250 px wide here, so the 12rem panel reaches back over the rail resizer unless the menu is placed by the viewport.
  { name: 'Implement, narrow window, rail at its widest', sizes: [{ width: 800, height: 700 }], open: ['implement', STUDIO_STATE, ''], trigger: /^More$/, scope: '[aria-label="Use case"]',
    prep: async (page) => { const bar = page.getByRole('separator', { name: 'Resize the use case list' }); await bar.focus(); await page.keyboard.press('End'); } },
  { name: 'Implement, nothing built yet', open: ['implement', { ...STUDIO_STATE, history: [] }, ''], trigger: /^More$/, scope: '[aria-label="Use case"]' },
  { name: 'Implement, nothing built yet, rail at its widest', open: ['implement', { ...STUDIO_STATE, history: [] }, ''], trigger: /^More$/, scope: '[aria-label="Use case"]',
    prep: async (page) => { const bar = page.getByRole('separator', { name: 'Resize the use case list' }); await bar.focus(); await page.keyboard.press('End'); } },
  { name: 'Implement, rail at its widest', open: ['implement', STUDIO_STATE, ''], trigger: /^More$/, scope: '[aria-label="Use case"]',
    prep: async (page) => { const bar = page.getByRole('separator', { name: 'Resize the use case list' }); await bar.focus(); await page.keyboard.press('End'); } },
];

for (const site of SITES) {
  for (const size of site.sizes || SIZES) {
    for (const dir of DIRS) {
      test(`${site.name}: every More item is reachable at ${size.width}x${size.height} ${dir}`, async () => {
        const ui = await openUi(...site.open);
        const { page } = ui;
        try {
          await page.setViewportSize(size);
          if (dir === 'rtl') await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; });
          await site.wait?.(page);
          await site.prep?.(page);
          const found = await probe(page, site.trigger, site.scope);
          assertClear(found, `${site.name} ${size.width}x${size.height} ${dir}`);
        } finally {
          await ui.close();
        }
      });
    }
  }
}
