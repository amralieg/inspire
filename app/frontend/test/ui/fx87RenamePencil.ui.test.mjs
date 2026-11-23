// FX-87 (REQ-485): the rename pencil never sits alone on a line under a long title: it shares the title's last line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const withName = (name) => ({
  ...REVIEW_RESULTS,
  domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((uc) => (uc.No === 'N01-U02' ? { ...uc, Name: name } : uc)) })),
});

test('for a range of title lengths the pencil sits on the last line of the title', async () => {
  const words = 'Rebalance Weekly Frequencies on Mismatched Routes Across The Whole Regional Network Every Planning Cycle Together'.split(' ');
  for (const width of [1280, 1440]) {
    for (let n = 4; n <= words.length; n += 3) {
      const name = words.slice(0, n).join(' ');
      const ui = await openUi('results', { ...REVIEW_STATE, results: withName(name) }, '');
      try {
        await ui.page.setViewportSize({ width, height: 800 });
        const card = ui.page.locator('[data-use-case-no="N01-U02"]');
        await card.locator('h3').waitFor();
        const pencil = await card.getByRole('button', { name: `Rename ${name}` }).boundingBox();
        const lines = await card.locator('h3').evaluate((el) => [...el.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom })));
        const last = lines.reduce((a, b) => (b.bottom > a.bottom ? b : a));
        assert.ok(pencil.y + pencil.height / 2 <= last.bottom + 2, `${width}px, ${n} words: the pencil (${pencil.y}) is on the title's last line (${last.top}-${last.bottom})`);
      } finally {
        await ui.close();
      }
    }
  }
});
