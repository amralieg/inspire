// FX-113 (REQ-503): the PowerPoint deck with pptxgenjs: cover, summary, slides per use case, value roll-up.
import PptxGenJS from 'pptxgenjs';
import { buildDesignDeck } from './designs/pptxDesign.js';
import { LB, withLabels } from './docLabels.js';

const hex = (c) => String(c).replace('#', '');
const has = (m, id) => m.blocks.includes(id);
const NOT_YET = 'not calculated yet';
const NO_CHART = 'Calculate value to add the projection';

export async function buildPptx(m, theme) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  if (m.rtl) pptx.rtlMode = true;
  // REQ-526: the four chosen designs build their own native deck; every other style builds as before.
  withLabels(m.labels, () => { if (theme.design && theme.tokens) buildDesignDeck(pptx, m, theme); else buildClassicDeck(pptx, m, theme); });
  return writePptx(pptx);
}

function buildClassicDeck(pptx, m, theme) {
  const bg = hex(theme.bg); const ink = hex(theme.ink); const muted = hex(theme.muted); const [a0, a1, a2] = theme.accents.map(hex);
  const face = theme.font.split(',')[0];
  const align = m.rtl ? 'right' : 'left';
  const slide = (rawTitle) => {
    const title = LB(rawTitle);
    const s = pptx.addSlide();
    s.background = { color: bg };
    s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: a0 } });
    if (title) s.addText(title, { x: 0.6, y: 0.4, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: ink, fontFace: face, align });
    return s;
  };

  const cover = slide('');
  cover.addText(m.businessName || 'Inspire', { x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontSize: 46, bold: true, color: ink, fontFace: face, align });
  cover.addText(`${LB(`${m.total.n} use cases`)} | ${m.total.nWithValue ? m.total.text : LB(NOT_YET)}`, { x: 0.8, y: 3.7, w: 11.7, h: 0.6, fontSize: 20, color: a0, fontFace: face, align });
  [a0, a1, a2].forEach((c, i) => cover.addShape('rect', { x: 0.8, y: 4.6 + i * 0.3, w: 4 - i * 1.1, h: 0.2, fill: { color: c } }));

  const sum = slide('Summary');
  const head = ['Use case', ...(has(m, 'inspire_score') ? ['Score'] : []), 'Value'].map((t) => ({ text: LB(t), options: { bold: true, color: theme.mode === 'dark' ? ink : 'FFFFFF', fill: { color: theme.mode === 'dark' ? hex(theme.surface) : a2 === bg ? a0 : a2 } } }));
  const rows = m.useCases.map((u) => [u.name, ...(has(m, 'inspire_score') ? [u.score != null ? u.score.toFixed(1) : '-'] : []), u.value ? u.value.text : LB(NOT_YET)].map((t) => ({ text: String(t), options: { color: ink } })));
  sum.addTable([head, ...rows], { x: 0.6, y: 1.5, w: 12.1, fontSize: 14, fontFace: face, border: { type: 'solid', color: muted, pt: 0.5 }, colW: has(m, 'inspire_score') ? [8, 1.6, 2.5] : [9.5, 2.6] });

  m.useCases.forEach((u, i) => {
    const s = slide(u.name);
    const c = hex(theme.accents[i % theme.accents.length]);
    s.addText(`${has(m, 'inspire_score') && u.score != null ? `${LB(`Score ${u.score.toFixed(1)}`)}  |  ` : ''}${u.value ? u.value.text : LB(NOT_YET)}`, { x: 0.6, y: 1.2, w: 12.1, h: 0.5, fontSize: 18, bold: true, color: c, fontFace: face, align });
    const parts = [];
    if (has(m, 'use_case_story')) parts.push({ text: `${LB('Use case')}\n`, options: { bold: true, color: muted, fontSize: 12 } }, { text: `${u.statement || u.solution}\n\n`, options: { color: ink, fontSize: 15 } });
    if (has(m, 'value_story') && u.value?.story) parts.push({ text: `${LB('Value story')}\n`, options: { bold: true, color: muted, fontSize: 12 } }, { text: `${u.value.story}\n\n`, options: { color: ink, fontSize: 15 } });
    if (has(m, 'data_used') && u.tables.length) parts.push({ text: `${LB('Data used')}\n`, options: { bold: true, color: muted, fontSize: 12 } }, { text: u.tables.join(', '), options: { color: ink, fontSize: 14 } });
    if (parts.length) s.addText(parts, { x: 0.6, y: 1.9, w: has(m, 'value_projection') && u.value?.yearly.length ? 6.3 : 12.1, h: 4.9, valign: 'top', fontFace: face, align });
    if (has(m, 'value_projection') && u.value?.yearly.length) {
      const y = u.value.yearly;
      s.addChart(pptx.charts.BAR, [
        { name: LB('Low'), labels: y.map((r) => LB(`Year ${r.year}`)), values: y.map((r) => r.low) },
        { name: LB('Likely'), labels: y.map((r) => LB(`Year ${r.year}`)), values: y.map((r) => r.likely) },
        { name: LB('High'), labels: y.map((r) => LB(`Year ${r.year}`)), values: y.map((r) => r.high) },
      ], { x: 7.1, y: 2.0, w: 5.6, h: 4.5, barDir: 'col', chartColors: [a1, a0, a2], showLegend: true, legendPos: 'b', legendColor: ink, catAxisLabelColor: ink, valAxisLabelColor: ink});
      s.addText(LB('Three-year projection'), { x: 7.1, y: 1.5, w: 5.6, h: 0.4, fontSize: 14, bold: true, color: muted, fontFace: face, align });
    }
  });

  const roll = slide('Value roll-up');
  roll.addText(m.total.nWithValue ? m.total.text : LB(NOT_YET), { x: 0.8, y: 1.8, w: 11.7, h: 1.2, fontSize: 54, bold: true, color: a0, fontFace: face, align });
  roll.addText(LB(`${m.total.nWithValue} of ${m.total.n} use cases have a calculated value.`), { x: 0.8, y: 3.1, w: 11.7, h: 0.6, fontSize: 18, color: muted, fontFace: face, align });
  // RC6-B-12: a document with no calculated value still charts what it has (the Inspire score per use case), else says how to get a chart.
  const scored = m.useCases.filter((u) => Number.isFinite(u.score));
  if (!m.total.nWithValue && has(m, 'inspire_score') && scored.length) {
    roll.addChart(pptx.charts.BAR, [{ name: LB('Inspire score'), labels: scored.map((u) => u.name.slice(0, 28)), values: scored.map((u) => u.score) }], { x: 0.8, y: 3.8, w: 11.7, h: 2.7, barDir: 'bar', catAxisOrientation: 'maxMin', chartColors: [a0], showLegend: false, showValue: true, catAxisLabelColor: ink, valAxisLabelColor: ink, dataLabelColor: ink });
  } else if (!m.total.nWithValue) roll.addText(LB(NO_CHART), { x: 0.8, y: 3.8, w: 11.7, h: 0.5, fontSize: 16, color: muted, fontFace: face, align });
  if (has(m, 'disclaimer')) roll.addText(LB('Estimates are AI-generated from your data and strategy. Treat them as a starting point.'), { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontSize: 12, color: muted, fontFace: face, align });

}

async function writePptx(pptx) {
  // In the browser a blob is the one output pptxgenjs compresses (a byte-array output is stored as is, about 25% larger); Node has no zip blob.
  if (typeof window !== 'undefined') return new Uint8Array(await (await pptx.exportPresentation({ compression: true })).arrayBuffer());
  return new Uint8Array(await pptx.write({ outputType: 'uint8array' }));
}
