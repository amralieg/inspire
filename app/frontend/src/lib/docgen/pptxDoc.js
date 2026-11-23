// FX-113 (REQ-503): the PowerPoint deck with pptxgenjs: cover, summary, slides per use case, value roll-up.
import PptxGenJS from 'pptxgenjs';

const hex = (c) => String(c).replace('#', '');
const has = (m, id) => m.blocks.includes(id);
const NOT_YET = 'not calculated yet';

export async function buildPptx(m, theme) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  if (m.rtl) pptx.rtlMode = true;
  const bg = hex(theme.bg); const ink = hex(theme.ink); const muted = hex(theme.muted); const [a0, a1, a2] = theme.accents.map(hex);
  const face = theme.font.split(',')[0];
  const align = m.rtl ? 'right' : 'left';
  const slide = (title) => {
    const s = pptx.addSlide();
    s.background = { color: bg };
    s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: a0 } });
    if (title) s.addText(title, { x: 0.6, y: 0.4, w: 12.1, h: 0.8, fontSize: 28, bold: true, color: ink, fontFace: face, align });
    return s;
  };

  const cover = slide('');
  cover.addText(m.businessName || 'Inspire', { x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontSize: 46, bold: true, color: ink, fontFace: face, align });
  cover.addText(`${m.total.n} use cases | ${m.total.nWithValue ? m.total.text : NOT_YET}`, { x: 0.8, y: 3.7, w: 11.7, h: 0.6, fontSize: 20, color: a0, fontFace: face, align });
  [a0, a1, a2].forEach((c, i) => cover.addShape('rect', { x: 0.8, y: 4.6 + i * 0.3, w: 4 - i * 1.1, h: 0.2, fill: { color: c } }));

  const sum = slide('Summary');
  const head = ['Use case', ...(has(m, 'inspire_score') ? ['Score'] : []), 'Value'].map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: a2 === bg ? a0 : a2 } } }));
  const rows = m.useCases.map((u) => [u.name, ...(has(m, 'inspire_score') ? [u.score != null ? u.score.toFixed(1) : '-'] : []), u.value ? u.value.text : NOT_YET].map((t) => ({ text: String(t), options: { color: ink } })));
  sum.addTable([head, ...rows], { x: 0.6, y: 1.5, w: 12.1, fontSize: 14, fontFace: face, border: { type: 'solid', color: muted, pt: 0.5 }, colW: has(m, 'inspire_score') ? [8, 1.6, 2.5] : [9.5, 2.6] });

  m.useCases.forEach((u, i) => {
    const s = slide(u.name);
    const c = hex(theme.accents[i % theme.accents.length]);
    s.addText(`${has(m, 'inspire_score') && u.score != null ? `Score ${u.score.toFixed(1)}  |  ` : ''}${u.value ? u.value.text : NOT_YET}`, { x: 0.6, y: 1.2, w: 12.1, h: 0.5, fontSize: 18, bold: true, color: c, fontFace: face, align });
    const parts = [];
    if (has(m, 'use_case_story')) parts.push({ text: 'Use case\n', options: { bold: true, color: muted, fontSize: 12 } }, { text: `${u.statement || u.solution}\n\n`, options: { color: ink, fontSize: 15 } });
    if (has(m, 'value_story') && u.value?.story) parts.push({ text: 'Value story\n', options: { bold: true, color: muted, fontSize: 12 } }, { text: `${u.value.story}\n\n`, options: { color: ink, fontSize: 15 } });
    if (has(m, 'data_used') && u.tables.length) parts.push({ text: 'Data used\n', options: { bold: true, color: muted, fontSize: 12 } }, { text: u.tables.join(', '), options: { color: ink, fontSize: 14 } });
    if (parts.length) s.addText(parts, { x: 0.6, y: 1.9, w: has(m, 'value_projection') && u.value?.yearly.length ? 6.3 : 12.1, h: 4.9, valign: 'top', fontFace: face, align });
    if (has(m, 'value_projection') && u.value?.yearly.length) {
      const y = u.value.yearly;
      s.addChart(pptx.charts.BAR, [
        { name: 'Low', labels: y.map((r) => `Year ${r.year}`), values: y.map((r) => r.low) },
        { name: 'Likely', labels: y.map((r) => `Year ${r.year}`), values: y.map((r) => r.likely) },
        { name: 'High', labels: y.map((r) => `Year ${r.year}`), values: y.map((r) => r.high) },
      ], { x: 7.1, y: 2.0, w: 5.6, h: 4.5, barDir: 'col', chartColors: [a1, a0, a2], showLegend: true, legendPos: 'b', legendColor: ink, catAxisLabelColor: ink, valAxisLabelColor: ink});
      s.addText('Three-year projection', { x: 7.1, y: 1.5, w: 5.6, h: 0.4, fontSize: 14, bold: true, color: muted, fontFace: face, align });
    }
  });

  const roll = slide('Value roll-up');
  roll.addText(m.total.nWithValue ? m.total.text : NOT_YET, { x: 0.8, y: 1.8, w: 11.7, h: 1.2, fontSize: 54, bold: true, color: a0, fontFace: face, align });
  roll.addText(`${m.total.nWithValue} of ${m.total.n} use cases have a calculated value.`, { x: 0.8, y: 3.1, w: 11.7, h: 0.6, fontSize: 18, color: muted, fontFace: face, align });
  if (has(m, 'disclaimer')) roll.addText('Estimates are AI-generated from your data and strategy. Treat them as a starting point.', { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontSize: 12, color: muted, fontFace: face, align });

  return new Uint8Array(await pptx.write({ outputType: 'uint8array' }));
}
