// REQ-574 / REQ-571: layout checks for the infographic gallery, shared by the test and the gallery tool.
// Lays an SVG out in Chromium and returns its problems: text under 20 px, two text lines that overlap, text that leaves the canvas.
// Each line (tspan) is measured on its own, cut to 0.95 em, so a multi-line block is not one tall box.
export const MEASURE = () => {
  const out = []; const root = document.getElementById('host'); const svg = root.querySelector('svg'); const cv = svg.getBoundingClientRect();
  const box = (r, fs) => { const h = Math.min(r.height, fs * 0.95); return { x: r.left - cv.left, y: r.top - cv.top + (r.height - h) / 2, w: r.width, h }; };
  svg.querySelectorAll('text').forEach((el) => {
    const fs = parseFloat(getComputedStyle(el).fontSize) || 0; const spans = [...el.querySelectorAll('tspan')];
    (spans.length ? spans : [el]).forEach((sp) => { const t = sp.textContent.trim(); if (!t) return; const r = sp.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) out.push({ t: t.slice(0, 40), fs, ...box(r, fs) }); });
  });
  return { texts: out, w: cv.width, h: cv.height };
};

export function problems({ texts, w, h }, minPx = 20) {
  const bad = []; const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const a of texts) { if (a.fs < minPx) bad.push(`small ${a.fs}px "${a.t}"`); if (a.x < -1 || a.y < -1 || a.x + a.w > w + 1 || a.y + a.h > h + 1) bad.push(`off canvas "${a.t}"`); }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i]; const b = texts[j]; const ov = inter(a, b);
    if (ov > 4 && ov > 0.05 * Math.min(a.w * a.h, b.w * b.h)) bad.push(`overlap "${a.t}" x "${b.t}"`);
  }
  return bad;
}

export async function checkSvg(page, svg) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  await page.setViewportSize({ width: Number(w) + 40, height: Number(h) + 40 });
  await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
  return problems(await page.evaluate(MEASURE));
}

// C29 phase 4: the largest horizontal band of the page with nothing drawn in it. Panel backdrops (big rects), thin rules and the page
// background do not count as drawn: a half-empty panel is an empty band. Returns { gap, y, h } in px.
export const BANDS = () => {
  const root = document.getElementById('host'); const svg = root.querySelector('svg'); const cv = svg.getBoundingClientRect(); const spans = [];
  const bg = svg.querySelector(':scope > rect');
  svg.querySelectorAll('text, tspan, image, circle, ellipse, polygon, rect, path, line, use').forEach((el) => {
    if (el === bg || el.closest('defs') || el.tagName === 'text' && el.querySelector('tspan')) return;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    if (el.tagName === 'rect' && (r.height <= 4 || (r.width > 300 && r.height > 80))) return;
    if (el.tagName === 'path' && r.height <= 4) return;
    spans.push([r.top - cv.top, r.bottom - cv.top]);
  });
  // A panel (a big rounded rectangle) whose content fills less than half of it is a half-empty box.
  const panels = [...svg.querySelectorAll(':scope rect')].filter((el) => el !== bg && !el.closest('defs') && el.getBoundingClientRect().width > 300 && el.getBoundingClientRect().height > 80 && el.getAttribute('rx'));
  let panelFill = { ratio: 1, y: 0 };
  for (const pn of panels) { const pr = pn.getBoundingClientRect(); let top = Infinity; let bot = -Infinity;
    svg.querySelectorAll('text, tspan, image, circle, path').forEach((el) => { if (el.tagName === 'text' && el.querySelector('tspan')) return; const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.top < pr.top - 2 || r.bottom > pr.bottom + 2 || r.left < pr.left - 2 || r.right > pr.right + 2) return; top = Math.min(top, r.top); bot = Math.max(bot, r.bottom); });
    const ratio = bot > top ? (bot - top) / pr.height : 0; if (ratio < panelFill.ratio) panelFill = { ratio, y: pr.top - cv.top, h: pr.height }; }
  spans.sort((a, b) => a[0] - b[0]); let edge = 0; let worst = { gap: 0, y: 0 };
  for (const [a, z] of spans) { if (a - edge > worst.gap) worst = { gap: a - edge, y: edge }; edge = Math.max(edge, z); }
  if (cv.height - edge > worst.gap) worst = { gap: cv.height - edge, y: edge };
  return { ...worst, h: cv.height, panelFill };
};
export async function bandOf(page, svg) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  await page.setViewportSize({ width: Number(w) + 40, height: Number(h) + 40 });
  await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
  return page.evaluate(BANDS);
}

// ---- text checks (no browser): every <text> element as one phrase ----
const dec = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const texts = (svg) => [...String(svg).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => dec(m[1].replace(/<\/tspan>/g, ' </tspan>').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
export const sourcesOf = (rows) => rows.map((r) => norm(Object.values(r).filter((v) => typeof v === 'string').join(' | ')));
// '/' joins a token (N/A, w/o, and/or): its last letter is not a dangling article.
const DANGLING = /(?<![\w&'/-])(and|or|the|a|an|of|to|for|with|in|on|at|by|from|that|which|is|are|than|as|per|into|its|their|this|these|but|so|if|when|while|between|across|over|under|against|about|before|after|until|each|every)$/i;
export const ellipsisProblems = (svg) => texts(svg).filter((t) => /…|\.\.\./.test(t) || /[,;:(-]$/.test(t) || (t.split(' ').length >= 3 && DANGLING.test(t))).map((t) => `"${t}"`);
// A phrase of 4+ words that starts like a clause of the source and stops before the source does must stop at a clause boundary.
export function cutPhraseProblems(svg, sources) {
  const bad = [];
  for (const raw of texts(svg)) {
    const t = norm(raw).replace(/[.,;:!?]+$/, ''); if (t.split(' ').length < 4) continue;
    const spots = []; for (const src of sources) { let i = src.indexOf(t); while (i >= 0) { spots.push([src, i]); i = src.indexOf(t, i + 1); } }
    const starts = spots.filter(([src, i]) => i === 0 || /[.;:!?|(,]\s$/.test(src.slice(Math.max(0, i - 2), i)));
    if (!starts.length) continue;
    // Whole phrase: it ends the source, or the source goes on with punctuation (a " | " after a whole field), a dash, a clause led by
    // a conjunction or relative word, or a prepositional phrase (coordinator review of c29_infog4, 27 Nov).
    if (!starts.some(([src, i]) => { const rest = src.slice(i + t.length); return rest === '' || /^\s?[.,;:!?)|(]/.test(rest) || /^\s*[-–—]\s/.test(rest) || /^\s(who|which|that|when|where|while|because|so|then|but|and|or|unless|since|to|for|with|by|from|in|on|at|across|before|after|until|using|through|into|over|under|between|within|without|via|toward|towards|around|among|near|instead|above|below|beyond|against|about)\s/.test(rest); })) bad.push(`"${raw}"`);
  }
  return bad;
}
export const flatText = (svg) => texts(svg).join(' ');
