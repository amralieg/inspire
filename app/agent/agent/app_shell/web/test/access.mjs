const CONTROL_ROLES = 'button|link|combobox|textbox|searchbox|checkbox|radio|switch|tab|slider|spinbutton|menuitem|option|separator|progressbar|listbox|dialog|img';
const UNNAMED = new RegExp(`^\\s*- (${CONTROL_ROLES})(\\s*\\[[^\\]]*\\])*:?\\s*$`);

export async function unnamedControls(page, root = 'body') {
  const tree = await page.locator(root).ariaSnapshot();
  return tree.split('\n').filter((line) => UNNAMED.test(line)).map((line) => line.trim());
}

export const sideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const STILL = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

async function strongPixels(page, focused, blurred) {
  return page.evaluate(async ([a, b]) => {
    const pixels = async (png) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const lum = (d, i) => [0, 1, 2].map((k) => { const v = d[i + k] / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0);
    const p = await pixels(a);
    const q = await pixels(b);
    let strong = 0;
    for (let i = 0; i < Math.min(p.length, q.length); i += 4) {
      const x = lum(p, i);
      const y = lum(q, i);
      if ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) >= 3) strong += 1;
    }
    return strong;
  }, [focused.toString('base64'), blurred.toString('base64')]);
}

async function ringOf(page, view, box) {
  const pad = 5;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const clip = { x, y, width: Math.min(view.width - x, box.width + 2 * pad), height: Math.min(view.height - y, box.height + 2 * pad) };
  if (clip.width < 2 || clip.height < 2) return { strong: 0, need: 0 };
  const focused = await page.screenshot({ clip });
  await page.evaluate(() => { window.__walked = document.activeElement; window.__walked.blur(); });
  const blurred = await page.screenshot({ clip });
  await page.evaluate(() => window.__walked.focus({ focusVisible: true, preventScroll: true }));
  const wide = Math.min(box.x + box.width, view.width) - Math.max(box.x, 0);
  const tall = Math.min(box.y + box.height, view.height) - Math.max(box.y, 0);
  const edges = [box.y >= pad, box.y + box.height <= view.height - pad].filter(Boolean).length * wide
    + [box.x >= pad, box.x + box.width <= view.width - pad].filter(Boolean).length * tall;
  return { strong: await strongPixels(page, focused, blurred), need: Math.round(edges * 0.8) };
}

export async function weakFocus(page, { max = 60, skip = () => false } = {}) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const weak = [];
  let checked = 0;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const seen = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.dataset.focusWalked) return true;
      el.dataset.focusWalked = '1';
      return false;
    });
    if (seen) break;
    const ring = await activeRing(page);
    if (!ring || skip(ring.what)) continue;
    checked += 1;
    if (!ring.ok) weak.push(`${ring.what} shows ${ring.strong} of ${ring.need} ring pixels`);
  }
  return { checked, weak };
}

export async function activeRing(page) {
  const view = page.viewportSize();
  const at = await page.evaluate((still) => {
    if (!document.getElementById('focus-still')) document.head.insertAdjacentHTML('beforeend', `<style id="focus-still">${still}</style>`);
    const el = document.activeElement;
    if (!el || el === document.body || el.tagName === 'IFRAME') return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const field = el.matches('input:not([type=checkbox]):not([type=radio])') && el.closest('label');
    const boxes = [el, field].filter(Boolean).map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { boxes, what: `${el.tagName.toLowerCase()} "${name}"` };
  }, STILL);
  if (!at) return null;
  const rings = [];
  for (const box of at.boxes.filter((b) => b.width >= 2 && b.height >= 2)) rings.push(await ringOf(page, view, box));
  if (!rings.length) return null;
  return { what: at.what, ok: rings.some((r) => r.strong >= r.need), ...rings[0] };
}
