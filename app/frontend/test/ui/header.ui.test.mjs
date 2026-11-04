import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const TABS = ['01 Start', '02 Monitor', '03 Review', '04 Build', '05 Run'];

async function headerAt(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.getByRole('navigation').waitFor();
  return page.evaluate(() => {
    const brand = [...document.querySelectorAll('header span')].find((s) => s.textContent.trim() === 'Inspire AI');
    const line = parseFloat(getComputedStyle(brand).lineHeight);
    return {
      scroll: document.documentElement.scrollWidth,
      brandLines: Math.round(brand.getBoundingClientRect().height / line),
      tabs: [...document.querySelectorAll('nav button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { inside: r.left >= 0 && r.right <= window.innerWidth, current: b.getAttribute('aria-current'), labelShown: [...b.querySelectorAll('span')].filter((s) => !s.children.length && s.getBoundingClientRect().width > 1).map((s) => s.textContent.trim()).filter(Boolean).join(' ') };
      }),
    };
  });
}

test('the header fits a 390 px phone with the brand on one line and every tab on screen, and names the open page to screen readers (must-exclude: no other tab is current)', async () => {
  const ui = await openUi('header');
  const { page } = ui;
  try {
    for (const tab of TABS) await page.getByRole('button', { name: tab }).waitFor();
    const phone = await headerAt(page, 390);
    assert.ok(phone.scroll <= 390, `the page scrolls sideways to ${phone.scroll} px`);
    assert.equal(phone.brandLines, 1);
    assert.deepEqual(phone.tabs.map((t) => t.inside), [true, true, true, true, true]);
    assert.deepEqual(phone.tabs.map((t) => t.current), [null, null, 'page', null, null]);
    assert.deepEqual(phone.tabs.map((t) => t.labelShown), ['01', '02', '03', '04', '05']);
    assert.equal(await page.getByRole('button', { name: '03 Review' }).getAttribute('aria-current'), 'page');
    const desk = await headerAt(page, 1440);
    assert.ok(desk.scroll <= 1440);
    assert.deepEqual(desk.tabs.map((t) => t.labelShown), TABS);
    assert.deepEqual(desk.tabs.map((t) => t.current), [null, null, 'page', null, null]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
