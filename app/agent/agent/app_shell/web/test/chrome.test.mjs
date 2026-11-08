import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { TABLE, appInfo, bundleEntry, chartsDrawn, openApp, openBundle, pageData, resizeTo, serveDist, steadyBox, until } from './harness.mjs';
import { ratio } from './contrast.test.mjs';
import { SERIES_TOKENS, themeTokens } from '../src/tokens.js';
import { EXPLAIN_CONTEXT_CHARS, EXPLAIN_ROWS, chartContext, chartRow, cutText, explainBody, filterWords } from '../src/explain.js';
import { GENIE_DEFAULT, GENIE_MIN, MAIN_MIN, clampGenie, genieMax, keyWidth } from '../src/genieWidth.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PALETTES = JSON.parse(readFileSync(join(SRC, 'palettes.json'), 'utf8'));
const ORDER = [...readFileSync(join(SRC, 'theme.js'), 'utf8').match(/PALETTE_ORDER = \[([^\]]+)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const NAMES = ORDER.map((p) => (p === 'default' ? 'Databricks' : p[0].toUpperCase() + p.slice(1)));
const token = (palette, theme, name) => themeTokens(PALETTES, palette, theme)[name];
const BAR = { id: 'by_category', title: 'Where the loss sits', hint: 'Categories ranked by discount loss.', type: 'horizontal_bar', x: { kind: 'category', label: 'Category' }, y: [{ label: 'Loss' }] };
const EXAMPLE = JSON.parse(readFileSync(join(SRC, '..', '..', 'example_page.json'), 'utf8'));
const STYLES = ['shell', 'looks', 'app', 'edits', 'daily', 'data', 'chrome', 'ops'].map((s) => `import ${JSON.stringify(join(SRC, 'styles', `${s}.css`))};`).join('\n');
const ASK_HOST = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
${STYLES}
import DataTable from ${JSON.stringify(join(SRC, 'DataTable.jsx'))};
import GeniePanel, { useGenie } from ${JSON.stringify(join(SRC, 'Genie.jsx'))};
import { askGenie } from ${JSON.stringify(join(SRC, 'genieAsk.js'))};
window.opened = [];
function Host() {
  const { app, rows, asks } = window.props;
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const page = app.pages[at];
  const genie = useGenie(app, page.id, () => setOpen(true));
  const columns = [{ key: 'entity_label', label: 'Item', render: (r) => r.entity_label }];
  return h('div', { className: 'stage' }, h('div', { className: 'app' }, h('div', { className: 'body' },
    h('main', { className: 'main' },
      h(DataTable, { label: 'Decision list', columns, rows, rowKey: (r) => r.record_key, onRow: (r) => window.opened.push(r.record_key),
        askAbout: (r) => ({ pageId: page.id, recordKey: r.record_key, label: r.entity_label }) }),
      h(DataTable, { label: 'Plain table', columns, rows: rows.slice(0, 2), onRow: (r) => window.opened.push(r.record_key) }),
      asks.map((detail, i) => h('button', { key: i, type: 'button', onClick: () => askGenie(detail) }, 'Panel ask ' + (i + 1))),
      h('button', { type: 'button', onClick: () => setAt(1) }, 'Go to the second page')),
    open && h(GeniePanel, { app, genie, page, pages: app.pages, onClose: () => setOpen(false) }))));
}
createRoot(document.getElementById('root')).render(h(Host));
`;
const ASK_ROWS = [1, 2, 3].map((n) => ({ record_key: `R00${n}`, entity_label: `Item number ${n}` }));
const RECORD_QUESTIONS = ['Show the history of this item', 'Are there others like this?', 'What happens if we do nothing?'];
let served;
let browser;
let askHost;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
  askHost = await bundleEntry(ASK_HOST);
});

after(async () => {
  await browser?.close();
  served?.close();
});

const open = (info, options) => openApp(browser, served.base, info, options);

function chartColor(page, card) {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-card="${id}"] canvas`);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255) {
        const k = `#${[d[i], d[i + 1], d[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    return [...seen].sort((a, b) => b[1] - a[1])[0][0];
  }, card);
}

async function drawnIn(page, card, color) {
  const end = Date.now() + 4000;
  let now = await chartColor(page, card);
  while (now !== color && Date.now() < end) {
    await page.waitForTimeout(100);
    now = await chartColor(page, card);
  }
  return now;
}

const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const hexOf = (css) => `#${css.match(/\d+/g).slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (theme, name) => {
  const hex = token('default', theme, name).slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `rgb(${[0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16)).join(', ')})`;
};
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

function menuColors(page) {
  return page.evaluate(() => {
    const hex = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map((s) => s.trim());
      if (Number(a) < 1) return null;
      return `#${[r, g, b].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
    };
    const behind = (el) => {
      for (let at = el; at; at = at.parentElement) {
        const bg = hex(getComputedStyle(at).backgroundColor);
        if (bg) return bg;
      }
      return '#ffffff';
    };
    const out = [];
    document.querySelectorAll('[role="radiogroup"][aria-label="Colors"] [role="radio"]').forEach((item) => {
      const name = item.querySelector('span:not(.swatches)');
      out.push({ where: `${name.textContent} name`, fg: hex(getComputedStyle(name).color), bg: behind(name) });
      const note = item.querySelector('small');
      if (note) out.push({ where: `${name.textContent} note "${note.textContent}"`, fg: hex(getComputedStyle(note).color), bg: behind(note) });
    });
    return out;
  });
}

const lowContrast = (pairs) => pairs.filter((p) => ratio(p.fg, p.bg) < 4.5).map((p) => `${p.where} is ${ratio(p.fg, p.bg).toFixed(2)}:1 (${p.fg} on ${p.bg})`);
const colors = (page) => page.getByRole('radiogroup', { name: 'Colors' });
async function toSettings(page) {
  await page.locator('[data-rail="settings"]').click();
  await colors(page).waitFor();
}
async function toDashboard(page) {
  await page.locator('[data-rail="dashboard"]').click();
  await page.waitForFunction(chartsDrawn, 4);
}
async function darkTheme(page) {
  await toSettings(page);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
}

test('Settings lists the 13 palettes with their series colors, marks the one in use and the one built, and the top bar has no palette button', async () => {
  const { page, seen, context } = await open(appInfo({ palette: 'berry' }));
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.getByRole('button', { name: 'Change the colors' }).count(), 0);
  await toSettings(page);
  const items = colors(page).getByRole('radio');
  assert.equal(await items.count(), 13);
  assert.deepEqual(await items.locator('span:not(.swatches)').allInnerTexts(), NAMES);
  assert.deepEqual(await items.evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked'))), ORDER.map((p) => String(p === 'berry')));
  assert.deepEqual(await colors(page).locator('small').allInnerTexts(), ['as built']);
  assert.match(await colors(page).getByRole('radio', { name: /Berry/ }).innerText(), /as built/);
  for (const [i, palette] of ORDER.entries()) {
    const shown = await items.nth(i).locator('.swatches i').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    const want = SERIES_TOKENS.map((t) => token(palette, 'light', t)).map((h) => `rgb(${[1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)).join(', ')})`);
    assert.deepEqual(shown, want, palette);
  }
  await colors(page).getByRole('radio', { name: /^Pop/ }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await colors(page).getByRole('radio', { name: /^Pop/ }).getAttribute('aria-checked'), 'true', 'the keyboard picks a palette');
  const tabbable = () => items.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).map((e) => e.textContent.trim()));
  assert.deepEqual(await tabbable(), ['Pop'], 'only the checked palette takes Tab');
  const at = ORDER.indexOf('pop');
  await page.keyboard.press('ArrowRight');
  assert.equal(await items.nth((at + 1) % ORDER.length).getAttribute('aria-checked'), 'true', 'an arrow key moves to the next palette and picks it');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await items.nth(at).getAttribute('aria-checked'), 'true', 'the other arrow moves back');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('choosing a palette recolors the App and the charts, and the choice is remembered', async () => {
  const { page, seen, context } = await open(appInfo({ palette: 'default' }));
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await drawnIn(page, 'by_category', token('default', 'light', 'blue-line')), token('default', 'light', 'blue-line'));
  await toSettings(page);
  await colors(page).getByRole('radio', { name: /^Ocean/ }).click();
  assert.equal(await cssVar(page, '--blue-line'), token('ocean', 'light', 'blue-line'));
  assert.equal(await stored(page, 'inspire-app-palette'), 'ocean');
  await toDashboard(page);
  assert.equal(await drawnIn(page, 'by_category', token('ocean', 'light', 'blue-line')), token('ocean', 'light', 'blue-line'));
  await page.reload();
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await cssVar(page, '--blue-line'), token('ocean', 'light', 'blue-line'));
  await darkTheme(page);
  assert.equal(await cssVar(page, '--blue-line'), token('ocean', 'dark', 'blue-line'));
  const swatch = await colors(page).getByRole('radio', { name: /^Ocean/ }).locator('.swatches i').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const dark = token('ocean', 'dark', 'blue-line');
  assert.equal(swatch, `rgb(${[1, 3, 5].map((k) => parseInt(dark.slice(k, k + 2), 16)).join(', ')})`);
  assert.equal(await colors(page).getByRole('radio', { name: /^Ocean/ }).getAttribute('aria-checked'), 'true');
  await toDashboard(page);
  assert.equal(await drawnIn(page, 'by_category', token('ocean', 'dark', 'blue-line')), token('ocean', 'dark', 'blue-line'));
  await toSettings(page);
  await colors(page).getByRole('radio', { name: /^Databricks/ }).click();
  assert.equal(await cssVar(page, '--blue-line'), token('default', 'dark', 'blue-line'));
  assert.equal(await stored(page, 'inspire-app-palette'), null, 'going back to the built palette forgets the choice');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('switching to dark redraws the charts in the dark colors', async () => {
  const { page, seen, context } = await open(appInfo());
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await drawnIn(page, 'by_category', token('default', 'light', 'blue-line')), token('default', 'light', 'blue-line'));
  await darkTheme(page);
  await toDashboard(page);
  assert.equal(await drawnIn(page, 'by_category', token('default', 'dark', 'blue-line')), token('default', 'dark', 'blue-line'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an unknown remembered palette falls back to the palette the App was built with', async () => {
  const { page, seen, context } = await open(appInfo({ palette: 'jewel' }));
  await page.evaluate(() => localStorage.setItem('inspire-app-palette', 'rainbow'));
  await page.reload();
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await cssVar(page, '--blue-line'), token('jewel', 'light', 'blue-line'));
  await toSettings(page);
  assert.equal(await colors(page).getByRole('radio', { name: /^Jewel/ }).getAttribute('aria-checked'), 'true');
  await page.evaluate(() => localStorage.setItem('inspire-app-palette', 'nordic'));
  await page.reload();
  await colors(page).waitFor();
  assert.equal(await cssVar(page, '--blue-line'), token('nordic', 'light', 'blue-line'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the palette text in Settings passes 4.5:1 in light and dark, and the check catches text that does not', async () => {
  const { page, seen, context } = await open(appInfo({ palette: 'vivid' }));
  await toSettings(page);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    const pairs = await menuColors(page);
    assert.equal(pairs.length, 14, theme);
    assert.deepEqual(lowContrast(pairs), [], theme);
  }
  await page.addStyleTag({ content: '.set-pal small{color:var(--line)!important}' });
  const broken = lowContrast(await menuColors(page));
  assert.equal(broken.length, 1, broken.join('\n'));
  assert.match(broken[0], /^Vivid note "as built" is /);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Genie window resizes by drag, keys, double-click and the maximize button, within 320 pixels and 60% of the window', async () => {
  const { page, seen, context } = await open(appInfo(), { width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const panel = page.locator('aside.genie');
  const handle = page.getByRole('separator', { name: 'Resize Ask Genie' });
  const width = () => panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const now = () => handle.getAttribute('aria-valuenow');
  assert.deepEqual([await handle.getAttribute('aria-orientation'), await now(), await handle.getAttribute('aria-valuemin'), await handle.getAttribute('aria-valuemax')],
    ['vertical', '400', '320', '864']);
  assert.equal(await width(), 400);
  const geometry = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const [aside, edge, grip] = [r('aside.genie'), r('.g-resize'), r('.g-grip')];
    return { full: [edge.top === aside.top, edge.height === aside.height], straddles: edge.left < aside.left && edge.right > aside.left,
      grip: [grip.width, grip.height], gripMiddle: [grip.top + grip.height / 2 - (aside.top + aside.height / 2), grip.left + grip.width / 2 - aside.left].map((d) => Math.abs(d) <= 1),
      cursor: getComputedStyle(document.querySelector('.g-resize')).cursor, shown: getComputedStyle(document.querySelector('.g-grip')).borderTopColor };
  });
  assert.deepEqual(geometry, { full: [true, true], straddles: true, grip: [8, 44], gripMiddle: [true, true], cursor: 'col-resize', shown: rgbOf('light', 'faint') });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual([await now(), await width()], ['432', 432]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await now(), '368');
  await page.keyboard.press('Home');
  assert.equal(await now(), '320');
  await page.keyboard.press('End');
  assert.deepEqual([await now(), await width()], ['864', 864]);
  await handle.dblclick();
  assert.deepEqual([await now(), await width()], ['400', 400]);
  const box = await steadyBox(page, handle);
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  assert.equal(await handle.getAttribute('class'), 'g-resize is-dragging');
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + 200, { steps: 6 });
  await page.mouse.up();
  assert.equal(await handle.getAttribute('class'), 'g-resize');
  assert.deepEqual([await now(), await width()], ['550', 550]);
  assert.equal(await stored(page, 'inspire-app-genie-width'), '550');
  await page.mouse.move(box.x - 150 + box.width / 2, box.y + box.height - 12);
  await page.mouse.down();
  await page.mouse.move(box.x - 150 + box.width / 2 - 100, box.y + box.height - 12, { steps: 4 });
  await page.mouse.up();
  assert.deepEqual([await now(), await width()], ['650', 650], 'the whole height of the edge drags, not only the grip');
  await page.mouse.move(box.x - 250 + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 900, box.y + 200, { steps: 4 });
  await page.mouse.up();
  assert.equal(await now(), '320', 'a drag past the edge stops at the least width');
  const max = page.getByRole('button', { name: 'Maximize Ask Genie' });
  assert.equal(await max.getAttribute('aria-pressed'), 'false');
  await max.click();
  assert.deepEqual([await max.getAttribute('aria-pressed'), await width()], ['true', 864]);
  await max.click();
  assert.deepEqual([await max.getAttribute('aria-pressed'), await width()], ['false', 320]);
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  assert.equal(await width(), 320, 'the width is remembered');
  await handle.focus();
  await page.keyboard.press('End');
  await resizeTo(page, 1000);
  assert.deepEqual([await handle.getAttribute('aria-valuemax'), await now(), await width()], ['600', '600', 600]);
  assert.equal(await page.getByRole('button', { name: 'Maximize Ask Genie' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('on a phone the Genie window stays full screen with no resize handle', async () => {
  const { page, seen, context } = await open(appInfo(), { width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('inspire-app-genie-width', '900'));
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.locator('aside.genie').waitFor();
  const m = await page.evaluate(() => ({
    panel: Math.round(document.querySelector('aside.genie').getBoundingClientRect().width),
    stage: Math.round(document.querySelector('.stage').getBoundingClientRect().width),
    scroll: document.documentElement.scrollWidth - window.innerWidth,
  }));
  assert.deepEqual(m, { panel: m.stage, stage: 390, scroll: 0 });
  assert.equal(await page.getByRole('separator', { name: 'Resize Ask Genie' }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Maximize Ask Genie' }).isVisible(), false);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the resize grip shows at rest and turns the brand color on hover and focus, with 3:1 contrast in light and dark', async () => {
  const { page, seen, context } = await open(appInfo(), { width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const handle = page.getByRole('separator', { name: 'Resize Ask Genie' });
  const look = () => page.evaluate(() => {
    const solid = (c) => c.replace(/^rgba\((\d+), (\d+), (\d+), 1\)$/, 'rgb($1, $2, $3)');
    const grip = getComputedStyle(document.querySelector('.g-grip'));
    return { edge: solid(grip.borderTopColor), fill: solid(grip.backgroundColor), dots: solid(grip.backgroundImage.match(/rgba?\([^)]+\)/)[0]),
      line: solid(getComputedStyle(document.querySelector('.g-resize'), '::before').backgroundColor),
      behind: [getComputedStyle(document.querySelector('.stage')).backgroundColor, getComputedStyle(document.querySelector('.g-log')).backgroundColor] };
  });
  const settle = (edge, line, fill) => page.waitForFunction(([e, l, f]) => {
    const solid = (c) => c.replace(/^rgba\((\d+), (\d+), (\d+), 1\)$/, 'rgb($1, $2, $3)');
    const grip = getComputedStyle(document.querySelector('.g-grip'));
    return solid(grip.borderTopColor) === e && solid(grip.backgroundColor) === f
      && solid(getComputedStyle(document.querySelector('.g-resize'), '::before').backgroundColor) === l;
  }, [edge, line, fill]);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await darkTheme(page);
    await page.mouse.move(20, 600);
    await handle.evaluate((el) => el.blur());
    await settle(rgbOf(theme, 'faint'), 'rgba(0, 0, 0, 0)', rgbOf(theme, 'card'));
    const rest = await look();
    assert.deepEqual([rest.edge, rest.fill, rest.dots, rest.line], [rgbOf(theme, 'faint'), rgbOf(theme, 'card'), rgbOf(theme, 'muted'), 'rgba(0, 0, 0, 0)'], theme);
    for (const bg of rest.behind) assert.ok(ratio(hexOf(rest.edge), hexOf(bg)) >= 3, `${theme}: the grip edge ${rest.edge} on ${bg}`);
    assert.ok(ratio(hexOf(rest.dots), hexOf(rest.fill)) >= 3, `${theme}: the grip dots`);
    for (const how of ['hover', 'focus']) {
      if (how === 'hover') await handle.hover();
      else {
        await page.mouse.move(20, 600);
        await page.keyboard.press('Shift');
        await handle.focus();
      }
      await settle(rgbOf(theme, 'btn-bg'), rgbOf(theme, 'brand'), rgbOf(theme, 'btn-bg'));
      const on = await look();
      assert.deepEqual([on.edge, on.fill, on.dots, on.line], [rgbOf(theme, 'btn-bg'), rgbOf(theme, 'btn-bg'), rgbOf(theme, 'btn-fg'), rgbOf(theme, 'brand')], `${theme} ${how}`);
      for (const bg of on.behind) {
        assert.ok(ratio(hexOf(on.fill), hexOf(bg)) >= 3, `${theme} ${how}: the grip ${on.fill} on ${bg}`);
        assert.ok(ratio(hexOf(on.line), hexOf(bg)) >= 3, `${theme} ${how}: the edge line ${on.line} on ${bg}`);
      }
      assert.ok(ratio(hexOf(on.dots), hexOf(on.fill)) >= 3, `${theme} ${how}: the grip dots`);
    }
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const sideways = (page) => page.evaluate(() => {
  const main = document.querySelector('.main');
  const edge = main.getBoundingClientRect().right;
  const scrolls = (el) => {
    for (let at = el.parentElement; at && at !== main; at = at.parentElement) if (getComputedStyle(at).overflowX !== 'visible') return true;
    return false;
  };
  const out = [...main.querySelectorAll('*')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > edge + 1 && !scrolls(e));
  return { page: document.documentElement.scrollWidth - window.innerWidth, main: main.scrollWidth - main.clientWidth, out: out.map((e) => e.className || e.tagName),
    width: Math.round(main.getBoundingClientRect().width), container: getComputedStyle(main).containerName,
    charts: getComputedStyle(document.querySelector('.charts')).gridTemplateColumns.split(' ').length };
});

test('with Genie at its widest the page beside it reflows with nothing cut off, and keeps its own layout while Genie is closed or laid over it', async () => {
  for (const [vw, layout, genie] of [[1440, 'sidebar', 864], [1280, 'sidebar', 768], [1920, 'sidebar', 1152], [1440, 'tabs', 864]]) {
    const where = `${vw} ${layout}`;
    const { page, seen, context } = await open(appInfo({ layout }, 2, TABLE), { width: vw, height: 900 });
    await page.goto(`${served.base}#/n01_u05`);
    await page.waitForFunction(chartsDrawn, 4);
    const closed = await sideways(page);
    assert.deepEqual([closed.page, closed.out, closed.container], [0, [], 'main'], where);
    await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
    const handle = page.getByRole('separator', { name: 'Resize Ask Genie' });
    assert.equal(await handle.getAttribute('aria-valuemax'), String(genie), where);
    await handle.focus();
    await page.keyboard.press('End');
    await page.waitForFunction((w) => Math.round(document.querySelector('aside.genie').getBoundingClientRect().width) === w, genie);
    await page.waitForFunction(chartsDrawn, 4);
    await page.waitForFunction(() => { const m = document.querySelector('.main'); return m.scrollWidth <= m.clientWidth; }, null, { timeout: 10000 });
    const wide = await sideways(page);
    assert.deepEqual([wide.page, wide.main, wide.out, wide.container, wide.charts], [0, 0, [], 'app main', 1], where);
    assert.ok(wide.width >= MAIN_MIN, `${where}: the page beside Genie is ${wide.width} pixels`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
  const { page, seen, context } = await open(appInfo({ layout: 'sidebar' }, 2, TABLE), { width: 1000, height: 900 });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(chartsDrawn, 4);
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize Ask Genie' }).focus();
  await page.keyboard.press('End');
  const over = await sideways(page);
  assert.deepEqual([over.page, over.container], [0, 'main'], 'a Genie window laid over the page leaves its layout alone');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

function explainRoutes(question = 'The exact question the App sent.') {
  const calls = { explain: [] };
  let release = false;
  const routes = {
    'genie/explain': ({ route, json }) => { calls.explain.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: `m${calls.explain.length}`, question }); },
    'genie/message': ({ json }) => json(200, release
      ? { state: 'done', text: 'Books stand out.', sql: 'SELECT 1', columns: [], rows: [], truncated: false }
      : { state: 'running', step: 'Writing the SQL' }),
  };
  return { calls, routes, release: () => { release = true; } };
}

test('Explain on a chart sends what the chart drew with the filters in words, and Genie answers in the same conversation', async () => {
  const { calls, routes, release } = explainRoutes();
  const { page, seen, context } = await open(appInfo(), { routes });
  await page.waitForFunction(chartsDrawn, 4);
  const buttons = page.locator('.explain-btn');
  assert.deepEqual(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
    ['Explain Loss to discounts by month', 'Explain Loss by channel over time', 'Explain How concentrated the loss is', 'Explain Where the loss sits'],
    'the Drivers chart comes last, under its heading');
  assert.deepEqual(await buttons.allInnerTexts(), ['Explain', 'Explain', 'Explain', 'Explain']);
  await page.getByRole('button', { name: /^All/ }).first().click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Music').click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Books').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('aside.genie').count(), 0);
  await page.getByRole('button', { name: 'Explain Where the loss sits' }).click();
  await until(() => calls.explain.length === 1);
  const body = calls.explain[0];
  const drawn = pageData({ category: ['Music', 'Books'] }).charts.by_category.rows;
  assert.deepEqual(body, {
    kind: 'chart', page: 'n01_u05', title: 'Where the loss sits', conversation_id: '',
    context: {
      hint: 'Categories of the listed items, ranked by their loss.', type: 'horizontal_bar', x: 'Category', measures: ['Loss'],
      rows: drawn.map((r) => ({ Category: r.x, Loss: r.y0 })), row_count: 2, truncated: false,
      filters: 'Run date: Nov 1, 2025 to Oct 15, 2026; Category: Music, Books',
    },
  });
  await page.locator('aside.genie .g-step').waitFor();
  const bubble = page.locator('.msg--you').last();
  assert.equal(await bubble.locator('p').innerText(), 'Explain \u201cWhere the loss sits\u201d');
  await bubble.locator('summary').click();
  assert.equal(await bubble.locator('summary').innerText(), 'What the App sent Genie');
  assert.equal(await bubble.locator('pre').innerText(), 'The exact question the App sent.');
  const states = await buttons.evaluateAll((els) => els.map((e) => [e.disabled, e.title]));
  assert.deepEqual(states, Array(4).fill([true, 'Genie is still answering']));
  release();
  await page.locator('.msg-sql').waitFor({ timeout: 15000 });
  assert.deepEqual(await buttons.evaluateAll((els) => els.map((e) => e.disabled)), [false, false, false, false]);
  await page.getByRole('button', { name: 'Explain Loss to discounts by month' }).click();
  await until(() => calls.explain.length === 2);
  assert.equal(calls.explain[1].conversation_id, 'c1');
  assert.equal(calls.explain[1].context.rows.length, 12);
  assert.deepEqual(Object.keys(calls.explain[1].context.rows[0]), ['Month', 'Loss']);
  await page.waitForFunction(() => document.querySelectorAll('.msg-sql').length === 2, null, { timeout: 15000 });
  await page.locator('.g-in input').fill('And by channel?');
  await page.locator('.g-in button').click();
  await until(() => seen.asks.length === 1);
  assert.equal(seen.asks[0].conversation_id, 'c1');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Explain shows only on charts that drew data, and not at all when Ask Genie is off', async () => {
  const routes = { page: ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.pages.push(body);
    const data = pageData(body.filters);
    return json(200, { ...data, charts: { ...data.charts, by_category: { columns: [], rows: [], truncated: false } }, errors: { 'chart:pareto': 'TABLE_OR_VIEW_NOT_FOUND' } });
  } };
  const { page, seen, context } = await open(appInfo(), { routes });
  await page.waitForFunction(chartsDrawn, 2);
  await page.locator('[data-card="pareto"] .tile-err').waitFor();
  assert.deepEqual(await page.locator('.explain-btn').evaluateAll((els) => els.map((e) => e.closest('[data-card]').dataset.card)), ['loss_trend', 'channel_mix']);
  assert.deepEqual(seen.errors, []);
  await context.close();
  const off = await open(appInfo({ genie: null, genie_note: 'The Genie Agent did not build.' }));
  await off.page.waitForFunction(chartsDrawn, 4);
  assert.equal(await off.page.locator('.explain-btn').count(), 0);
  assert.equal(await off.page.getByRole('button', { name: /^Explain / }).count(), 0);
  await off.context.close();
});

test('the To fix per run chart explains the runs it drew, oldest first, without the page filters the runs ignore', async () => {
  const run = (run_id, started, to_fix) => ({ run_id, job_run_id: null, url: '', started, ended: null, duration_s: 60, status: 'done', trigger: 'schedule', by: '',
    segments: [], tables: null, records: 50, to_fix, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '' });
  const { calls, routes } = explainRoutes();
  routes.runs = ({ json }) => json(200, { runs: [run('81', '2026-10-17T06:00:00Z', 12), run('80', '2026-09-26T06:00:00Z', null), run('79', '2026-09-15T06:00:00Z', 20)],
    total: 3, offset: 0, limit: 20, job: null, errors: {} });
  const { page, seen, context } = await open(appInfo({}, 1, TABLE), { routes, clock: Date.parse('2026-10-27T09:30:00Z') });
  await page.locator('[data-rail="runs"]').click();
  await page.locator('[data-bars="to_fix_runs"] .vb-c').first().waitFor();
  assert.deepEqual(await page.locator('.explain-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Explain To fix per run']);
  await page.getByRole('button', { name: 'Explain To fix per run' }).click();
  await until(() => calls.explain.length === 1);
  assert.deepEqual(calls.explain[0], { kind: 'chart', page: 'n01_u05', title: 'To fix per run', conversation_id: '', context: {
    hint: 'Each bar is a run listed below, oldest on the left.', type: 'bar', x: 'Run', measures: ['To fix'], row_count: 2, truncated: false, filters: '',
    rows: [{ Run: 'Sep 15, 06:00 AM UTC', 'To fix': 20, 'Shown as': '20' }, { Run: 'Oct 17, 06:00 AM UTC', 'To fix': 12, 'Shown as': '12' }] } });
  assert.deepEqual(seen.errors, []);
  await context.close();
  const off = await open(appInfo({ genie: null, genie_note: 'The Genie Agent did not build.' }, 1, TABLE), { routes });
  await off.page.locator('[data-rail="runs"]').click();
  await off.page.locator('[data-bars="to_fix_runs"] .vb-c').first().waitFor();
  assert.equal(await off.page.locator('.explain-btn').count(), 0, 'no Explain while Ask Genie is off');
  await off.context.close();
});

function askRoutes() {
  const calls = { asks: [], refuse: '' };
  let hold = false;
  const routes = {
    'genie/ask': ({ route, json }) => {
      const body = route.request().postDataJSON();
      calls.asks.push(body);
      if (calls.refuse) return json(403, { error: calls.refuse });
      return json(200, { conversation_id: 'c1', message_id: `m${calls.asks.length}`, ...(body.record_key ? { question: `Full text for ${body.record_key}: ${body.question}` } : {}) });
    },
    'genie/message': ({ json }) => json(200, hold ? { state: 'running', step: 'Writing the SQL' }
      : { state: 'done', text: 'Genie answered.', sql: 'SELECT 1', columns: [], rows: [], truncated: false }),
  };
  return { calls, routes, hold: (on) => { hold = on; } };
}

const recordInfo = (overrides = {}) => appInfo(overrides, 2, { records: { ...EXAMPLE.records, label_title: 'Item' } });
const realErrors = (errors) => errors.filter((e) => !/status of 403/.test(e));

test('the row Ask Genie button opens Genie about that record without opening it, and every question carries the record until the chip is cleared', async () => {
  const { calls, routes } = askRoutes();
  const { page, context, errors } = await openBundle(browser, askHost, { app: recordInfo(), rows: ASK_ROWS, asks: [] }, routes);
  const list = page.getByRole('table', { name: 'Decision list' });
  assert.deepEqual(await list.locator('.row-ask').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))),
    ASK_ROWS.map((r) => `Ask Genie about ${r.entity_label}`));
  assert.deepEqual(await list.locator('.row-ask').allInnerTexts(), ASK_ROWS.map(() => 'Ask Genie'), 'each row button reads Ask Genie');
  assert.equal(await page.getByRole('table', { name: 'Plain table' }).locator('.row-ask').count(), 0, 'only a table that names its records asks Genie');
  assert.equal(await page.locator('aside.genie').count(), 0);
  await page.getByRole('button', { name: 'Ask Genie about Item number 2' }).click();
  await page.locator('aside.genie').waitFor();
  assert.deepEqual(await page.evaluate(() => window.opened), [], 'the record panel stays closed');
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Item number 2');
  const sugg = page.locator('aside.genie .g-sugg .sugg');
  assert.deepEqual(await sugg.allInnerTexts(), RECORD_QUESTIONS);
  assert.equal(await page.getByLabel('Your question').getAttribute('placeholder'), 'Ask about Item number 2');
  assert.deepEqual(calls.asks, [], 'a row ask with no question sends nothing yet');
  await sugg.nth(1).click();
  await until(() => calls.asks.length === 1);
  assert.deepEqual(calls.asks[0], { question: 'Are there others like this?', conversation_id: '', page: 'n01_u05', record_key: 'R002' });
  await page.locator('.msg-sql').waitFor();
  const bubble = page.locator('.msg--you').last();
  assert.equal(await bubble.locator('p').innerText(), 'Are there others like this?');
  assert.equal(await bubble.locator('.msg-about').innerText(), 'About: Item number 2');
  await bubble.locator('summary').click();
  assert.equal(await bubble.locator('summary').innerText(), 'What the App sent Genie');
  assert.equal(await bubble.locator('pre').innerText(), 'Full text for R002: Are there others like this?');
  await page.getByLabel('Your question').fill('Why this one?');
  await page.getByRole('button', { name: 'Send' }).click();
  await until(() => calls.asks.length === 2);
  assert.deepEqual(calls.asks[1], { question: 'Why this one?', conversation_id: 'c1', page: 'n01_u05', record_key: 'R002' });
  await page.waitForFunction(() => document.querySelectorAll('.msg-sql').length === 2);
  await page.getByRole('button', { name: 'Stop asking about Item number 2' }).click();
  await page.locator('.g-chip').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.g-chip').count(), 0);
  assert.equal(await sugg.count(), 0, 'the page questions show again only on a new chat');
  assert.equal(await page.getByLabel('Your question').getAttribute('placeholder'), 'Ask about the data in this use case');
  await page.getByLabel('Your question').fill('And across the page?');
  await page.getByRole('button', { name: 'Send' }).click();
  await until(() => calls.asks.length === 3);
  assert.deepEqual(calls.asks[2], { question: 'And across the page?', conversation_id: 'c1', page: 'n01_u05' }, 'a page question asks the Genie Agent of its page');
  await page.waitForFunction(() => document.querySelectorAll('.msg-sql').length === 3);
  assert.equal(await page.locator('.msg--you').last().locator('details, .msg-about').count(), 0, 'a page question sends only what was typed');
  await page.getByRole('button', { name: 'New chat' }).click();
  assert.deepEqual(await sugg.allInnerTexts(), EXAMPLE.questions);
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a narrow screen the row Ask Genie button shows only the Genie mark and keeps its name, and a printout leaves it out', async () => {
  const { page, context, errors } = await openBundle(browser, askHost, { app: recordInfo(), rows: ASK_ROWS, asks: [] }, askRoutes().routes);
  const first = page.getByRole('table', { name: 'Decision list' }).locator('.row-ask').first();
  assert.equal(await first.innerText(), 'Ask Genie');
  await page.setViewportSize({ width: 480, height: 900 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.row-ask span')).display === 'none');
  assert.equal(await first.innerText(), '');
  assert.equal(await first.evaluate((el) => el.getBoundingClientRect().width <= 30), true, 'the mark-only button drops the wide padding');
  assert.match(await first.getAttribute('aria-label'), /^Ask Genie about /);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await first.isVisible(), false, 'the printout has no Ask Genie buttons');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a record panel ask with a question asks at once, waits in the box while Genie answers, and a refusal says why', async () => {
  const { calls, routes, hold } = askRoutes();
  const asks = [{ pageId: 'n01_u05', recordKey: 'R003', label: 'Item number 3', question: 'What happens if we do nothing?' },
    { pageId: 'n01_u05', recordKey: 'R001', label: 'Item number 1', question: 'Show the history of this item' },
    { pageId: 'n01_u05', recordKey: 'R009', label: ' ', question: '' }, { pageId: '', recordKey: 'R001', label: 'No page', question: 'Why?' }];
  const { page, context, errors } = await openBundle(browser, askHost, { app: recordInfo(), rows: ASK_ROWS, asks }, routes);
  hold(true);
  await page.getByRole('button', { name: 'Panel ask 1' }).click();
  await until(() => calls.asks.length === 1);
  assert.deepEqual(calls.asks[0], { question: 'What happens if we do nothing?', conversation_id: '', page: 'n01_u05', record_key: 'R003' });
  await page.locator('aside.genie .g-step').waitFor();
  assert.deepEqual(await page.locator('aside.genie .g-sugg .sugg').evaluateAll((els) => els.map((e) => e.disabled)), [true, true, true]);
  await page.getByRole('button', { name: 'Panel ask 2' }).click();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Item number 1');
  await page.waitForFunction(() => document.querySelector('.g-in input').value === 'Show the history of this item');
  await page.waitForTimeout(300);
  assert.equal(calls.asks.length, 1, 'a second question waits in the box while Genie is answering');
  hold(false);
  await page.locator('.msg-sql').waitFor();
  await page.getByRole('button', { name: 'Send' }).click();
  await until(() => calls.asks.length === 2);
  assert.deepEqual(calls.asks[1], { question: 'Show the history of this item', conversation_id: 'c1', page: 'n01_u05', record_key: 'R001' });
  await page.waitForFunction(() => document.querySelectorAll('.msg-sql').length === 2);
  await page.getByRole('button', { name: 'Panel ask 4' }).click();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Item number 1', 'an ask that names no page changes nothing');
  assert.equal(calls.asks.length, 2);
  calls.refuse = 'The App did not ask Genie about this record: you cannot read it, or it is no longer on the list';
  await page.getByRole('button', { name: 'Panel ask 3' }).click();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: R009', 'a record without a label is named by its key');
  await page.locator('aside.genie .g-sugg .sugg').first().click();
  await page.locator('aside.genie .g-err').waitFor();
  assert.equal(await page.locator('aside.genie .g-err').innerText(), calls.refuse);
  assert.deepEqual(calls.asks[2], { question: 'Show the history of this item', conversation_id: 'c1', page: 'n01_u05', record_key: 'R009' });
  assert.deepEqual(realErrors(errors), []);
  await context.close();
});

test('the record chip clears when the person opens another page, and with Genie off an ask opens Genie on the reason with no chip', async () => {
  const { calls, routes } = askRoutes();
  const on = await openBundle(browser, askHost, { app: recordInfo(), rows: ASK_ROWS, asks: [] }, routes);
  await on.page.getByRole('button', { name: 'Ask Genie about Item number 1' }).click();
  await on.page.locator('.g-chip').waitFor();
  await on.page.getByRole('button', { name: 'Go to the second page' }).click();
  await on.page.locator('.g-chip').waitFor({ state: 'detached' });
  assert.equal(await on.page.getByLabel('Your question').getAttribute('placeholder'), 'Ask about the data in this use case');
  assert.deepEqual(on.errors, []);
  await on.context.close();
  const off = await openBundle(browser, askHost, { app: recordInfo({ genie: null, genie_note: 'The Genie Agent did not build.' }), rows: ASK_ROWS,
    asks: [{ pageId: 'n01_u05', recordKey: 'R001', label: 'Item number 1', question: 'Why?' }] }, routes);
  await off.page.getByRole('button', { name: 'Panel ask 1' }).click();
  await off.page.locator('aside.genie .g-off').waitFor();
  assert.equal(await off.page.locator('.g-chip').count(), 0);
  assert.equal(calls.asks.length, 0);
  assert.deepEqual(off.errors, []);
  await off.context.close();
});
