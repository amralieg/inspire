// REQ-508 L6a/L6b shared probe (not a test): what the browser computes for a page's header, icon tile and content width.
// Contract (audit scratch/req508_art_director.md F19-F21, section 2.1): the header is [data-page-header] holding the page's one h1
// (text-h1: 28px / 36px, weight 600, no gradient text) and an optional [data-page-icon] tile (40x40, radius md 10px, primary-subtle
// background, primary icon, never a solid red block). The page content sits in a container capped at --w-page 1200px (Setup: 720px).
export async function headerFacts(page) {
  await page.locator('h1').first().waitFor({ timeout: 20000 });
  return page.evaluate(() => {
    const px = (v) => Math.round(parseFloat(v) || 0);
    const header = document.querySelector('[data-page-header]');
    const h1 = (header || document).querySelector('h1');
    const hs = h1 ? getComputedStyle(h1) : null;
    const icon = header?.querySelector('[data-page-icon]');
    const is = icon ? getComputedStyle(icon) : null;
    let widthCap = null;
    for (let el = header; el; el = el.parentElement) {
      const mw = getComputedStyle(el).maxWidth;
      if (mw && mw !== 'none') { widthCap = mw; break; }
    }
    return {
      header: Boolean(header),
      h1Count: document.querySelectorAll('main h1, [data-page-header] h1').length || document.querySelectorAll('h1').length,
      h1: hs ? { size: px(hs.fontSize), lineHeight: px(hs.lineHeight), weight: Number(hs.fontWeight),
        clip: hs.backgroundClip || hs.webkitBackgroundClip || '', text: h1.textContent.trim() } : null,
      icon: is ? { w: px(is.width), h: px(is.height), radius: is.borderTopLeftRadius, bg: is.backgroundColor } : null,
      widthCap,
    };
  });
}

// The solid primary reds (old db-red #FF3621, db-red-solid #D92E1B, new primary #E8311B / #FF4A33): no icon tile is filled with one.
export const SOLID_REDS = ['rgb(255, 54, 33)', 'rgb(217, 46, 27)', 'rgb(232, 49, 27)', 'rgb(255, 74, 51)'];

export function assertHeader(assert, facts, { name, width = '1200px', icon = true } = {}) {
  assert.ok(facts.h1, `${name}: the page renders its h1`);
  assert.equal(facts.header, true, `${name}: the h1 sits in [data-page-header]`);
  assert.deepEqual([facts.h1.size, facts.h1.lineHeight, facts.h1.weight], [28, 36, 600], `${name}: the h1 is text-h1 (28/36, 600)`);
  assert.notEqual(facts.h1.clip, 'text', `${name}: the h1 has no gradient text`);
  if (icon) {
    assert.ok(facts.icon, `${name}: the header has its [data-page-icon] tile`);
    assert.deepEqual([facts.icon.w, facts.icon.h, facts.icon.radius], [40, 40, '10px'], `${name}: the icon tile is 40x40 with radius md`);
    assert.ok(!SOLID_REDS.includes(facts.icon.bg), `${name}: the icon tile is primary-subtle, not solid red (got ${facts.icon.bg})`);
  }
  assert.equal(facts.widthCap, width, `${name}: the page content is capped at ${width}`);
}
