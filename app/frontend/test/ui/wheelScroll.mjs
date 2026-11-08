import assert from 'node:assert/strict';

export const WHEEL_SCREENS = [[1280, 800], [1024, 700]];

const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

export async function fillWithCopies(region, itemSelector, copies = 40) {
  return region.evaluate((el, [sel, n]) => {
    const items = sel ? [...el.querySelectorAll(sel)] : [...el.children];
    const sample = items[items.length - 1];
    if (!sample) throw new Error(`no item ${sel || '(child)'} to copy in the scroll region`);
    for (let i = 0; i < n; i += 1) {
      const copy = sample.cloneNode(true);
      copy.setAttribute('data-wheel-copy', String(i));
      copy.removeAttribute('id');
      sample.parentElement.append(copy);
    }
    return n;
  }, [itemSelector, copies]);
}

export async function dropCopies(region) {
  await region.evaluate((el) => el.querySelectorAll('[data-wheel-copy]').forEach((c) => c.remove()));
}

async function where(region, over) {
  const aim = over ? await over.elementHandle() : null;
  const found = await region.evaluate((el, target) => {
    const view = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const r = !target && el === document.scrollingElement ? view : (target || el).getBoundingClientRect();
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);
    const left = Math.max(r.left, 0);
    const right = Math.min(r.right, window.innerWidth);
    const x = left + (right - left) / 2;
    const y = top + Math.min(bottom - top, 240) / 2;
    const hit = document.elementFromPoint(x, y);
    const s = getComputedStyle(el);
    return {
      x, y, seen: bottom - top, top: Math.round(el.scrollTop), scroll: el.scrollHeight, client: el.clientHeight, overflow: s.overflowY,
      hit: !!hit && el.contains(hit), cover: hit && !el.contains(hit) ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : '',
    };
  }, aim);
  if (aim) await aim.dispose();
  return found;
}

async function reach(page, region) {
  for (let i = 0; i < 30; i += 1) {
    const r = await region.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, h: window.innerHeight, w: window.innerWidth, left: b.left };
    });
    const seen = Math.min(r.bottom, r.h) - Math.max(r.top, 0);
    if (seen >= Math.min(160, r.bottom - r.top)) return;
    await page.mouse.move(Math.max(r.left - 8, 4), r.h / 2);
    await page.mouse.wheel(0, r.top > 0 ? 300 : -300);
    await frames(page);
  }
}

export async function wheelToEnd(page, region, last, name, over = null) {
  await frames(page);
  await reach(page, over || region);
  const at = await where(region, over);
  assert.ok(at.scroll > at.client + 1, `${name}: the content does not overflow the region, so the wheel cannot be tested ${JSON.stringify(at)}`);
  assert.ok(at.seen >= 40, `${name}: the region shows ${at.seen} px on screen, too little to scroll ${JSON.stringify(at)}`);
  assert.ok(at.hit, `${name}: something covers the region where the pointer sits (${at.cover}) ${JSON.stringify(at)}`);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 400 && (await region.evaluate((el) => el.scrollTop)) > 0; i += 1) {
    await page.mouse.wheel(0, -1000);
    await frames(page);
  }
  const start = await region.evaluate((el) => el.scrollTop);
  assert.equal(start, 0, `${name}: the wheel up does not bring the region back to its top`);
  let before = -1;
  for (let i = 0; i < 400; i += 1) {
    await page.mouse.wheel(0, 300);
    await frames(page);
    const now = await region.evaluate((el) => el.scrollTop);
    const end = await region.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 2);
    if (end) break;
    if (now === before) {
      await page.waitForTimeout(60);
      if ((await region.evaluate((el) => el.scrollTop)) === now) break;
    }
    before = now;
  }
  const after = await where(region, over);
  assert.ok(after.top > 0, `${name}: the mouse wheel over the region did not scroll it ${JSON.stringify(after)}`);
  assert.ok(after.scroll - after.client - after.top <= 2, `${name}: the mouse wheel stopped before the end of the region ${JSON.stringify(after)}`);
  await last.waitFor({ state: 'attached' });
  const box = await region.elementHandle();
  const look = () => last.evaluate((item, holder) => {
    const r = item.getBoundingClientRect();
    const b = holder === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : holder.getBoundingClientRect();
    const floor = Math.min(b.bottom, window.innerHeight);
    const y = Math.max(Math.min(r.bottom, floor) - 3, r.top + 1);
    const x = r.left + Math.min(Math.max(r.width, 2), 40) / 2;
    const hit = document.elementFromPoint(x, y);
    return { bottom: Math.round(r.bottom), floor: Math.round(floor), top: Math.round(r.top), boxTop: Math.round(b.top), hit: !!hit && (item.contains(hit) || hit.contains(item)),
      cover: hit && !item.contains(hit) ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : '' };
  }, box);
  const shown = (s) => s.bottom <= s.floor + 2 && s.bottom > s.boxTop && s.hit;
  let seen = await look();
  for (let i = 0; i < 40 && !shown(seen); i += 1) {
    await page.mouse.wheel(0, 300);
    await frames(page);
    const next = await look();
    if (next.bottom === seen.bottom && next.floor === seen.floor) {
      seen = next;
      break;
    }
    seen = next;
  }
  await box.dispose();
  assert.ok(seen.bottom <= seen.floor + 2 && seen.bottom > seen.boxTop && seen.hit, `${name}: the last item is not visible after wheeling to the end ${JSON.stringify(seen)}`);
  return after;
}

export async function wheelScrolls(page, region, last, { name, screens = WHEEL_SCREENS, fill, unfill, over = null } = {}) {
  const results = [];
  for (const [width, height] of screens) {
    await page.setViewportSize({ width, height });
    await frames(page);
    if (fill) await fill();
    await frames(page);
    results.push(await wheelToEnd(page, region, typeof last === 'function' ? last() : last, `${name} at ${width}x${height}`, typeof over === 'function' ? over() : over));
    if (unfill) await unfill();
  }
  return results;
}
