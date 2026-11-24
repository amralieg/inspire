// REQ-510 shared probe (not a test): what one screen shows above the fold, measured in the browser.
// Contract (briefs/req510_spec.md section 1):
// - Body words: visible words above the fold that are not inside a control and not inside the page h1. The app header, the
//   demo bar, open menus and dialogs are not part of a page.
// - Controls: visible interactive elements above the fold (buttons, links, inputs, selects, tabs, switches, checkboxes).
// - Primary buttons: visible buttons anywhere on the screen (not only above the fold) whose fill is the primary red, or that carry
//   data-variant="primary". A disabled primary still counts: one main action per screen.
// - The More menu: one button named "More" with aria-haspopup="menu" and aria-expanded; clicking it opens role=menu with
//   role=menuitem entries. The page's secondary actions live there.
export const SOLID_REDS = ['rgb(255, 54, 33)', 'rgb(217, 46, 27)', 'rgb(232, 49, 27)', 'rgb(255, 74, 51)'];

export async function screenFacts(page, { root = '' } = {}) {
  return page.evaluate(([rootSel, reds]) => {
    const CONTROL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="switch"], '
      + '[role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], summary';
    const OUTSIDE = 'header, [data-harness-header], [data-showcase-bar], [role="menu"], [role="dialog"], [aria-modal="true"], .sr-only, output';
    const base = rootSel ? document.querySelector(rootSel) : document.body;
    const fold = window.innerHeight;
    const shown = (el) => {
      if (!el || !el.isConnected) return false;
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const aboveFold = (el) => { const r = el.getBoundingClientRect(); return r.top < fold && r.bottom > 0; };
    const outside = (el) => !rootSel && Boolean(el.closest(OUTSIDE));
    let bodyWords = 0;
    const sample = [];
    if (base) {
      const walk = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        const text = n.textContent.replace(/\s+/g, ' ').trim();
        if (!text || !el || outside(el) || el.closest(CONTROL) || el.closest('h1, script, style, noscript, svg')) continue;
        if (!shown(el)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (!(r.top < fold && r.bottom > 0) || r.width === 0) continue;
        const words = text.split(' ').filter((w) => /[A-Za-z0-9]/.test(w)).length;
        bodyWords += words;
        if (sample.length < 80) sample.push(text.slice(0, 80));
      }
    }
    const controls = [];
    const primaries = [];
    for (const el of base ? base.querySelectorAll(CONTROL) : []) {
      if (outside(el) || !shown(el)) continue;
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (aboveFold(el)) controls.push(label);
      const isButton = el.matches('button, [role="button"], a[href]');
      if (isButton && (el.getAttribute('data-variant') === 'primary' || reds.includes(getComputedStyle(el).backgroundColor))) primaries.push(label);
    }
    const more = [...(base || document.body).querySelectorAll('button[aria-haspopup="menu"]')]
      .filter((el) => !outside(el) && shown(el) && /^More\b/.test((el.getAttribute('aria-label') || el.innerText || '').trim()));
    return { bodyWords, controls, primaries, moreCount: more.length, sample };
  }, [root, SOLID_REDS]);
}

// Opens the page's More menu and returns its item names. Fails loudly when there is no menu.
export async function moreItems(page, scope = page) {
  const trigger = scope.getByRole('button', { name: /^More\b/ }).first();
  await trigger.waitFor({ timeout: 15000 });
  const expanded = await trigger.getAttribute('aria-expanded');
  if (expanded !== 'true') await trigger.click();
  const menu = page.getByRole('menu').last();
  await menu.waitFor({ timeout: 5000 });
  return menu.getByRole('menuitem').allInnerTexts().then((list) => list.map((s) => s.replace(/\s+/g, ' ').trim()));
}

// Formats facts for an assertion message, so a red run says exactly what the screen shows today.
export const describe = (f) => `bodyWords=${f.bodyWords}, controls=${f.controls.length} [${f.controls.join(' | ')}], `
  + `primaries=${f.primaries.length} [${f.primaries.join(' | ')}], more=${f.moreCount}`;

// How many of the matches are on screen as standalone controls (not inside an open menu, not hidden).
export const shownOutsideMenus = (loc) => loc.evaluateAll((els) => els.filter((e) => e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })
  && !e.closest('[role="menu"]')).length);

// Opens the More menu named `trigger` inside `scope`, returns its items, then closes it with Escape (one click to reach, no navigation).
export async function itemsOf(page, scope, trigger = /^More$/) {
  const button = scope.getByRole('button', { name: trigger }).first();
  if (!(await button.count())) return null;
  if ((await button.getAttribute('aria-haspopup')) !== 'menu') return null;
  await button.click();
  const menu = page.getByRole('menu').last();
  await menu.waitFor({ timeout: 5000 });
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
  return items;
}

// One checklist row: [id, how to find it, where it must live]. `where` is 'main' (a visible control on the screen),
// 'more' (an item of the screen's More menu) or { menu: <trigger name>, scope: <css> } (an item of a row or card More menu),
// or { disclose: <button name> } (one click on that button shows it).
export async function reachable(page, [id, find, where]) {
  const { role, name } = find;
  if (where === 'main') {
    const loc = page.getByRole(role, { name });
    const n = await loc.count();
    if (!n) return `${id}: no ${role} named ${name} on the screen`;
    await loc.first().scrollIntoViewIfNeeded().catch(() => null);
    return (await shownOutsideMenus(loc)) > 0 ? '' : `${id}: ${role} ${name} is not visible`;
  }
  if (where && where.disclose) {
    const loc = page.getByRole(role, { name });
    if ((await shownOutsideMenus(loc)) > 0) return `${id}: ${role} ${name} is still shown before "${where.disclose}" is clicked`;
    const toggle = page.getByRole('button', { name: where.disclose }).first();
    if (!(await toggle.count())) return `${id}: no "${where.disclose}" button`;
    await toggle.click();
    const shown = (await shownOutsideMenus(loc)) > 0;
    await toggle.click();
    return shown ? '' : `${id}: "${where.disclose}" does not show ${role} ${name}`;
  }
  const scope = where && where.scope ? page.locator(where.scope).first() : page;
  const trigger = where === 'more' ? /^More$/ : where.menu;
  const items = await itemsOf(page, scope, trigger);
  if (!items) return `${id}: no More menu (${trigger}) to hold ${name}`;
  if (!items.some((t) => (name instanceof RegExp ? name.test(t) : t === name))) return `${id}: More (${trigger}) has [${items.join(', ')}], not ${name}`;
  const standalone = await shownOutsideMenus(scope.getByRole(role === 'menuitem' ? 'button' : role, { name }));
  return standalone ? `${id}: ${name} is in More but also still a standalone ${role} on the screen` : '';
}
