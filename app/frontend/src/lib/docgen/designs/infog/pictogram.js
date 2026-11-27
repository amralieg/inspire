// REQ-574 / REQ-571: pictogram and unit charts (Isotype style: one unit = one fixed share, rows of 10).
import { f1 } from './shapes.js';

// Filled silhouettes in a 24 box (units, not line icons).
export const UNITS = {
  person: '<circle cx="12" cy="5.5" r="4"/><path d="M4 23v-6.5C4 12.4 7.6 10.5 12 10.5s8 1.9 8 6V23z"/>',
  doc: '<path d="M5 1h10l5 5v17H5z"/>',
  box: '<path d="M12 1l10 5v12l-10 5-10-5V6z"/>',
  coin: '<circle cx="12" cy="12" r="10.5"/>',
  pin: '<path d="M12 23s8-7.4 8-13.5A8 8 0 004 9.5C4 15.6 12 23 12 23z"/>',
  square: '<rect x="2" y="2" width="20" height="20" rx="5"/>',
  hour: '<path d="M4 1h16v4l-6 7 6 7v4H4v-4l6-7-6-7z"/>',
};

// A grid of `total` units, `on` of them filled in colorOn. Returns { svg, w, h }.
export function unitGrid(x, y, cols, total, on, unit, size, gap, colorOn, colorOff, o = {}) {
  let svg = ''; const k = size / 24;
  for (let i = 0; i < total; i++) { const c = i % cols; const r = Math.floor(i / cols); const ux = x + c * (size + gap) + (o.groupGap && c >= cols / 2 ? o.groupGap : 0); const uy = y + r * (size + gap * (o.rowGap || 1));
    svg += `<g transform="translate(${f1(ux)} ${f1(uy)}) scale(${k.toFixed(3)})" fill="${i < on ? colorOn : colorOff}">${UNITS[unit] || UNITS.square}</g>`; }
  const rows = Math.ceil(total / cols);
  return { svg: `<g data-chart="pictogram" data-units="${total}" data-on="${on}">${svg}</g>`, w: cols * (size + gap) - gap + (o.groupGap || 0), h: rows * (size + gap * (o.rowGap || 1)) - gap };
}

// A row of big units for small counts (e.g. "5 sites", "11 rings").
export function unitRow(x, y, n, unit, size, gap, color) {
  let svg = ''; const k = size / 24;
  for (let i = 0; i < n; i++) svg += `<g transform="translate(${f1(x + i * (size + gap))} ${f1(y)}) scale(${k.toFixed(3)})" fill="${color}">${UNITS[unit]}</g>`;
  return { svg: `<g data-chart="unit-row">${svg}</g>`, w: n * (size + gap) - gap };
}
