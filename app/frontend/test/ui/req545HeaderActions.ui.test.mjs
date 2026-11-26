// REQ-545: the use case header on the Implement page. One left-aligned, wrapping action row under the name and the meta row
// (Vibe, Uninstall, More last), the value line after it, and no boxed score tile: the score is plain text in the meta row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { HARNESS_USE_CASE, STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

const SCORED = { ...HARNESS_USE_CASE, inspire_score: '8.9' };

const probe = (page) => page.evaluate(() => {
  const header = document.querySelector('header[data-pinned-name]');
  const box = (el) => { const r = el?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
  const byText = (re) => [...header.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
  const score = header.querySelector('[data-score-inline]');
  return {
    scoreBoxes: header.querySelectorAll('[data-score-box]').length,
    scoreText: score ? score.textContent : null,
    scoreTitle: score ? score.getAttribute('title') : null,
    h2: box(header.querySelector('h2')),
    meta: box(header.querySelector('[data-use-case-meta]')),
    vibe: box(header.querySelector('[data-vibe-features]')),
    uninstall: box(byText(/Uninstall this use case/)),
    start: box(byText(/Start Use Case MVP/)),
    more: box(byText(/^More/)),
    value: box(header.querySelector('[data-value-estimate]')),
  };
});

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`built use case at ${width}x${height}: no score box, an inline score, one left-aligned row Vibe, Uninstall, More under the name and above the value line`, async () => {
    const ui = await openUi('implement', { ...STUDIO_STATE, useCase: SCORED });
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height });
      await page.locator('header[data-pinned-name] [data-vibe-features]').waitFor({ timeout: 20000 });
      const f = await probe(page);
      assert.equal(f.scoreBoxes, 0, 'a) no [data-score-box] in the header');
      assert.ok(f.scoreText && f.scoreText.includes('8.9'), `a) [data-score-inline] shows the score, got ${f.scoreText}`);
      assert.equal(f.scoreTitle, 'Inspire composite score');
      for (const [name, b] of [['Vibe', f.vibe], ['Uninstall', f.uninstall]]) {
        assert.ok(b, `${name} button exists`);
        assert.ok(b.top >= f.h2.bottom, `b) ${name} is below the name`);
        assert.ok(b.top >= f.meta.bottom, `b) ${name} is below the meta row`);
        if (f.value) assert.ok(b.top < f.value.top, `b) ${name} is above the value line`);
      }
      assert.ok(f.more, 'More exists');
      const tops = [f.vibe.top, f.uninstall.top, f.more.top];
      assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `c) one row, tops ${tops}`);
      assert.ok(f.vibe.left < f.uninstall.left && f.uninstall.left < f.more.left, 'c) order Vibe, Uninstall, More');
      assert.ok(Math.abs(f.vibe.left - f.h2.left) <= 8, `d) left-aligned, vibe ${f.vibe.left} h2 ${f.h2.left}`);
      assert.ok(f.uninstall.left - f.vibe.right <= 16, `e) gap Vibe to Uninstall ${f.uninstall.left - f.vibe.right}`);
      assert.ok(f.more.left - f.uninstall.right <= 16, `e) gap Uninstall to More ${f.more.left - f.uninstall.right}`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('not built: Start MVP sits below the name and the meta row, and More comes after it on the same row', async () => {
  const ui = await openUi('implement', { useCase: SCORED });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('header[data-pinned-name]').getByRole('button', { name: /Start Use Case MVP/ }).waitFor({ timeout: 20000 });
    const f = await probe(page);
    assert.ok(f.start.top >= f.h2.bottom && f.start.top >= f.meta.bottom, 'Start MVP is below the name and the meta row');
    assert.ok(f.more, 'More exists');
    assert.ok(f.start.left < f.more.left, 'More comes after Start MVP');
    assert.ok(Math.abs(f.start.top - f.more.top) <= 4, 'same row');
    assert.ok(Math.abs(f.start.left - f.h2.left) <= 8, 'left-aligned');
    assert.equal(f.scoreBoxes, 0);
  } finally {
    await ui.close();
  }
});
