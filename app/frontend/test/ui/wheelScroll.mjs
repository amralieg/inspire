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
  const topBy = Date.now() + 4000;
  while (Date.now() < topBy && (await region.evaluate((el) => el.scrollTop)) > 0) {
    await page.mouse.wheel(0, -1000);
    await new Promise((done) => setTimeout(done, 50));
  }
  const start = await region.evaluate((el) => el.scrollTop);
  assert.equal(start, 0, `${name}: the wheel up does not bring the region back to its top`);
  let before = -1;
  let absorbed = 0;
  for (let i = 0; i < 400; i += 1) {
    await page.mouse.wheel(0, 300);
    await frames(page);
    const now = await region.evaluate((el) => el.scrollTop);
    const end = await region.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 2);
    if (end) break;
    if (now === before) {
      absorbed += 1;
      if (absorbed > 12) break;
      await region.evaluate((el, was) => new Promise((done) => {
        const started = performance.now();
        const tick = () => {
          if (el.scrollTop !== was || performance.now() - started > 150) done();
          else requestAnimationFrame(tick);
        };
        tick();
      }), now);
    } else absorbed = 0;
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

export async function wheelReads(page, box, { lines = '', readable = 3, delta = 1200 } = {}) {
  await box.evaluate((el) => { el.scrollTop = 0; });
  await frames(page);
  const at = await where(box);
  assert.ok(at.seen > 0, `the scroll box is on screen ${JSON.stringify(at)}`);
  assert.ok(at.hit, `the scroll box is what the pointer lands on, nothing covers it ${JSON.stringify(at)}`);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, delta);
  await page.waitForFunction((el) => el.scrollTop > 0, await box.elementHandle(), { timeout: 5000 });
  if (!lines) return;
  await frames(page);
  const seen = await box.evaluate((el, sel) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll(sel)].filter((n) => { const b = n.getBoundingClientRect(); return b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }).length;
  }, lines);
  assert.ok(seen >= readable, `the person reads at least ${readable} whole lines in the box after scrolling, not ${seen}`);
}

export async function markScrollRegions(root) {
  return root.evaluate((top) => {
    const all = [top, ...top.querySelectorAll('*')].filter((el) => {
      if (el === document.documentElement || el === document.body) return false;
      const s = getComputedStyle(el);
      const cls = String(el.className);
      if (/\boverflow-x-(auto|scroll)\b/.test(cls) && !/\boverflow-(y-)?(auto|scroll)\b/.test(cls)) return false;
      return /(auto|scroll)/.test(s.overflowY) && el.clientHeight >= 24 && el.getClientRects().length > 0;
    });
    return all.map((el, i) => {
      el.setAttribute('data-wheel-region', String(i));
      return { i, tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label') || '', cls: String(el.className).slice(0, 80) };
    });
  });
}

async function fillRegion(region, copies) {
  return region.evaluate((el, n) => {
    const sample = [...el.children].reverse().find((c) => c.getBoundingClientRect().height > 0 && !/absolute|fixed/.test(getComputedStyle(c).position)) || null;
    for (let i = 0; i < n; i += 1) {
      const copy = sample ? sample.cloneNode(true) : document.createElement('div');
      if (!sample) copy.textContent = el.textContent.split('\n').filter(Boolean).pop() || 'line';
      copy.setAttribute('data-wheel-copy', String(i));
      copy.removeAttribute('id');
      copy.removeAttribute('data-wheel-region');
      copy.querySelectorAll('[data-wheel-region]').forEach((c) => c.removeAttribute('data-wheel-region'));
      if (sample) sample.after(copy); else el.append(copy);
    }
  }, copies);
}

export async function wheelEveryRegion(page, root, name, { min = 1, copies = 40, screens = WHEEL_SCREENS } = {}) {
  const found = await markScrollRegions(root);
  assert.ok(found.length >= min, `${name}: found ${found.length} scroll regions, expected at least ${min} ${JSON.stringify(found)}`);
  const names = [];
  for (const r of found) {
    const region = page.locator(`[data-wheel-region="${r.i}"]`);
    const label = `${name} ${r.label || `${r.tag}.${r.cls}`}`;
    if (!copies) {
      const results = [];
      for (const [width, height] of screens) {
        await page.setViewportSize({ width, height });
        await frames(page);
        if (!(await region.count()) || !(await region.evaluate((el) => el.scrollHeight > el.clientHeight + 1))) {
          results.push('fits');
          continue;
        }
        const marked = await region.evaluate((el) => {
          const leaves = [...el.querySelectorAll('*')].filter((c) => {
            const r = c.getBoundingClientRect();
            if (c.children.length || !(r.width > 0 && r.height > 0) || !c.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
            for (let a = c.parentElement; a && a !== el; a = a.parentElement) {
              if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 1) return false;
            }
            return true;
          });
          const last = leaves.reduce((low, c) => (!low || c.getBoundingClientRect().bottom >= low.getBoundingClientRect().bottom ? c : low), null);
          if (last) last.setAttribute('data-wheel-last', '');
          return last ? 'item' : ((el.value ?? el.textContent).trim() ? 'text' : '');
        });
        assert.ok(marked, `${label} at ${width}x${height}: the region shows no visible item to wheel to`);
        await wheelToEnd(page, region, marked === 'text' ? region : region.locator('[data-wheel-last]').last(), `${label} at ${width}x${height}`);
        await region.evaluate((el) => el.querySelectorAll('[data-wheel-last]').forEach((c) => c.removeAttribute('data-wheel-last')));
        results.push('wheeled');
      }
      names.push(`${label}: ${results.join('/')}`);
      continue;
    }
    await wheelScrolls(page, region, () => region.locator(':scope > [data-wheel-copy]').last(), {
      name: label, screens, fill: () => fillRegion(region, copies), unfill: () => dropCopies(region),
    });
    names.push(`${label}: wheeled`);
  }
  await root.evaluate((el) => el.querySelectorAll('[data-wheel-region]').forEach((c) => c.removeAttribute('data-wheel-region'))).catch(() => null);
  return names;
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

export const STREAMED_ANSWER = Array.from({ length: 300 }, (_, i) => `- line ${i + 1}`).join('\n');

export async function followsOnlyAtBottom(page, log, name) {
  const gap = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  const top = () => log.evaluate((el) => el.scrollTop);
  const said = () => log.evaluate((el) => el.innerText.length);
  const jump = log.getByRole('button', { name: 'New messages' });
  await page.waitForFunction((el) => el.scrollHeight > el.clientHeight + 240, await log.elementHandle(), { timeout: 30000 });
  const before = await said();
  await page.waitForTimeout(1200);
  assert.ok((await said()) > before, `${name}: the answer is still streaming in`);
  assert.ok((await gap()) <= 40, `${name}: at the bottom it follows each new line (must-exclude: never left behind while at the bottom)`);
  assert.equal(await jump.count(), 0, `${name}: no New messages button while following`);
  const box = await log.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(250);
  const at = await top();
  assert.ok((await gap()) > 40, `${name}: wheel up leaves the bottom`);
  const reading = await said();
  await page.waitForTimeout(1500);
  assert.ok((await said()) > reading, `${name}: new lines kept arriving while the person read`);
  assert.ok(Math.abs((await top()) - at) <= 2, `${name}: wheel up during streaming keeps the place, ${await top()} vs ${at}`);
  await jump.waitFor({ timeout: 5000 });
  await jump.click();
  await page.waitForTimeout(250);
  assert.ok((await gap()) <= 40, `${name}: New messages jumps to the latest line`);
  await page.waitForTimeout(800);
  assert.ok((await gap()) <= 40, `${name}: after the jump it follows again`);
  assert.equal(await jump.count(), 0, `${name}: the button goes once the person is back at the bottom`);
}
