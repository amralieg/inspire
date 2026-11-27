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
