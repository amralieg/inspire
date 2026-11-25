// REQ-526 part B: the PowerPoint deck in the four chosen designs. Native and editable: text is text, charts are pptxgenjs charts,
// rings, bands, rules, cards and score meters are shapes. Numbers come from toDesignModel / the doc model; nothing is invented.
import { toDesignModel } from './model.js';
import { contrast, bestInk, DISCLAIMER } from './core.js';

const NOT_YET = 'not calculated yet';
const hex = (c) => String(c).replace('#', '').toUpperCase();
const has = (m, id) => m.blocks.includes(id);
const S = (n) => String(n ?? '');
const firstFont = (f, fallback = 'Arial') => (S(f).split(',')[0].replace(/['"]/g, '').trim() || fallback);

// Every text colour set on a background, so the build can prove 4.5:1 (same idea as core.js LOG).
export const DECK_LOG = [];

// One palette shape for the four designs: where each design keeps its page, card, text and accent tokens.
function paletteOf(id, th) {
  switch (id) {
    case 'original': return { coverBg: th.tealDark, coverInk: th.heroInk, coverMuted: th.heroMuted, coverAccent: th.goldText, page: th.page, card: th.sand, ink: th.ink, body: th.body, muted: th.muted, accent: th.teal, accentText: th.coralText, warm: th.gold, rule: th.line, track: th.barTrack, kicker: th.coralText, rings: true };
    case 'editorial_ink': return { coverBg: th.paper, coverInk: th.ink, coverMuted: th.grey, coverAccent: th.accentText, page: th.paper, card: th.quad, ink: th.ink, body: th.body, muted: th.grey, accent: th.accent, accentText: th.accentText, warm: th.tones[4], rule: th.rule, track: th.hair, kicker: th.accentText, masthead: true };
    case 'bold': return { coverBg: th.hero, coverInk: th.heroInk, coverMuted: th.heroMuted, coverAccent: th.heroAccent, page: th.canvas, card: th.card, ink: th.ink, body: th.ink, muted: th.muted, accent: '#2272B4', accentText: th.accentText, warm: th.heroAccent, rule: th.grid, track: th.track, kicker: th.accentText, chips: true };
    default: return { coverBg: th.page, coverInk: th.ink, coverMuted: th.slate, coverAccent: th.blueText, page: th.page, card: th.panel, ink: th.ink, body: th.ink, muted: th.slate, accent: th.blue, accentText: th.blueText, warm: th.green, rule: th.rule, track: th.pale, kicker: th.blueText, edge: th.navy };
  }
}

export function buildDesignDeck(pptx, m, theme) {
  DECK_LOG.length = 0;
  const id = theme.design; const th = theme.tokens;
  const P = paletteOf(id, th);
  const dm = toDesignModel(m);
  const face = firstFont(theme.fonts?.display); const bodyFace = firstFont(theme.fonts?.body || theme.fonts?.display);
  const align = m.rtl ? 'right' : 'left';
  const W = 13.33;
  const accent = hex(P.accent);

  // Text colour on a known background: the wanted colour when it reads at 4.5:1, else the best of ink and white.
  const tc = (fg, bg, text) => {
    let c = hex(fg); const b = hex(bg);
    if (contrast(`#${c}`, `#${b}`) < 4.5) c = hex(bestInk(`#${b}`, '#111111', '#FFFFFF'));
    DECK_LOG.push({ fg: c, bg: b, text: S(text).slice(0, 30) });
    return c;
  };
  const text = (s, str, o) => {
    const { bg, color, font, ...rest } = o;
    s.addText(S(str), { fontFace: font || bodyFace, align, valign: 'top', margin: 0, fit: 'shrink', color: tc(color, bg, str), ...rest });
  };
  const rich = (s, runs, o) => {
    const { bg, ...rest } = o;
    s.addText(runs.map((r) => ({ text: r.text, options: { ...r.options, color: tc(r.options.color, bg, r.text), fontFace: r.options.fontFace || bodyFace } })), { align, valign: 'top', margin: 0, fit: 'shrink', ...rest });
  };
  const box = (s, x, y, w, h, fill, o = {}) => s.addShape(o.round ? 'roundRect' : 'rect', { x, y, w, h, fill: { color: hex(fill) }, line: { type: 'none' }, ...(o.round ? { rectRadius: 0.12 } : {}) });
  const newSlide = (bg) => { const s = pptx.addSlide(); s.background = { color: hex(bg) }; return s; };

  // Page chrome: the design's own top band, rule or masthead.
  const chrome = (s, label) => {
    if (P.masthead) {
      box(s, 0.6, 0.3, W - 1.2, 0.04, P.rule);
      text(s, 'Databricks Inspire AI', { x: 0.6, y: 0.38, w: 6, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, bg: P.page, color: P.ink, font: bodyFace });
      text(s, label, { x: W - 6.6, y: 0.38, w: 6, h: 0.3, fontSize: 12, align: 'right', bg: P.page, color: P.ink, font: bodyFace });
    } else if (P.edge) {
      box(s, 0, 0, W, 0.1, P.edge);
      text(s, 'DATABRICKS INSPIRE AI', { x: 0.6, y: 0.25, w: 6, h: 0.3, fontSize: 12, bold: true, bg: P.page, color: P.kicker, font: bodyFace });
      text(s, label, { x: W - 6.6, y: 0.25, w: 6, h: 0.3, fontSize: 12, align: 'right', bg: P.page, color: P.muted, font: bodyFace });
    } else {
      box(s, 0, 0, W, 0.14, id === 'bold' ? P.warm : P.accent);
      text(s, label, { x: W - 6.6, y: 0.28, w: 6, h: 0.3, fontSize: 12, align: 'right', bg: P.page, color: P.muted, font: bodyFace });
    }
  };
  const kpi = (s, x, y, w, h, value, label, o = {}) => {
    box(s, x, y, w, h, P.card, { round: !P.masthead });
    text(s, value, { x: x + 0.2, y: y + 0.18, w: w - 0.4, h: h * 0.5, fontSize: o.size || 26, bold: true, bg: P.card, color: o.color || P.ink, font: face });
    text(s, label, { x: x + 0.2, y: y + h - 0.5, w: w - 0.4, h: 0.32, fontSize: 12, bg: P.card, color: P.muted });
  };
  const chartBase = (labelColorBg) => ({ catAxisLabelColor: tc(P.ink, labelColorBg, 'chart axis'), valAxisLabelColor: tc(P.ink, labelColorBg, 'chart axis'), catAxisLabelFontSize: 12, valAxisLabelFontSize: 12, catAxisLabelFontFace: bodyFace, valAxisLabelFontFace: bodyFace, valGridLine: { color: hex(P.rule), size: 0.5 }, catGridLine: { style: 'none' }, showTitle: false });
  const trunc = (str, n = 30) => (S(str).length > n ? `${S(str).slice(0, n - 1)}...` : S(str));
  const heading = (s, str, y = 0.75, size = 28, w = W - 1.2, x = 0.6) => text(s, str, { x, y, w, h: 0.8, fontSize: size, bold: true, bg: P.page, color: P.ink, font: face });

  // ---- cover ----
  const cover = newSlide(P.coverBg);
  if (P.rings) { [[8.6, 0.2, 4.2, 0.9], [10.4, 0.5, 2.6, 0.88], [8.2, 3.6, 2.3, 0.92]].forEach(([x, y, d, tr]) => cover.addShape('ellipse', { x, y, w: d, h: d, fill: { color: 'FFFFFF', transparency: Math.round(tr * 100) }, line: { color: 'FFFFFF', width: 1, transparency: 80 } })); box(cover, 11.1, 1.2, 0.6, 0.6, P.warm, { round: true }); }
  if (P.edge) box(cover, 0, 0, 0.25, 7.5, P.edge);
  if (P.masthead) { box(cover, 0.6, 0.3, W - 1.2, 0.04, P.rule); text(cover, 'DATABRICKS INSPIRE AI', { x: 0.6, y: 0.4, w: 6, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, bg: P.coverBg, color: P.coverInk }); }
  else text(cover, 'DATABRICKS INSPIRE AI', { x: 0.8, y: 0.6, w: 8, h: 0.4, fontSize: 14, bold: true, charSpacing: 3, bg: P.coverBg, color: P.coverAccent });
  const title = { original: 'Data and AI use cases, ranked by value', editorial_ink: 'Use case review', bold: 'Use case portfolio', consulting: 'Use case portfolio review' }[id];
  text(cover, title, { x: 0.8, y: 1.5, w: 9, h: 1.7, fontSize: id === 'bold' ? 54 : 44, bold: true, bg: P.coverBg, color: P.coverInk, font: face });
  text(cover, `Prepared for ${m.businessName || 'Inspire'}`, { x: 0.8, y: 3.3, w: 9, h: 0.6, fontSize: 24, bg: P.coverBg, color: P.coverMuted });
  if (P.edge || P.masthead) box(cover, 0.8, 4.05, 1.4, 0.05, P.accent);
  const nDom = domainsOf().length;
  [[m.total.nWithValue ? m.total.text : NOT_YET, 'estimated value a year'], [S(m.total.n), 'use cases'], [S(nDom), 'domains']].forEach(([v, l], i) => {
    const x = 0.8 + i * 3.4;
    if (P.masthead || P.edge) box(cover, x, 4.6, 2.9, 0.03, P.coverInk); else box(cover, x, 4.6, 3.1, 1.7, P.coverInk === '#FFFFFF' ? mixDark(P.coverBg) : P.card, { round: true });
    text(cover, v, { x: x + 0.15, y: 4.8, w: 2.8, h: 0.8, fontSize: 32, bold: true, bg: (P.masthead || P.edge) ? P.coverBg : (P.coverInk === '#FFFFFF' ? mixDark(P.coverBg) : P.card), color: i ? P.coverInk : P.coverAccent, font: face });
    text(cover, l, { x: x + 0.15, y: 5.65, w: 2.8, h: 0.4, fontSize: 14, bg: (P.masthead || P.edge) ? P.coverBg : (P.coverInk === '#FFFFFF' ? mixDark(P.coverBg) : P.card), color: P.coverMuted });
  });

  // ---- domains: every domain of the document, valued ones first by value ----
  function domainsOf() {
    const by = new Map();
    for (const u of m.useCases) { const n = u.domain || 'Other'; if (!by.has(n)) by.set(n, []); by.get(n).push(u); }
    const rank = new Map(dm.domains.map((d, i) => [d.name, i]));
    return [...by.entries()].map(([name, ucs]) => ({ name, ucs })).sort((a, b) => (rank.has(a.name) ? rank.get(a.name) : 1e9) - (rank.has(b.name) ? rank.get(b.name) : 1e9));
  }
  function mixDark(c) { const h = hex(c); const k = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.8)); return k.map((v) => v.toString(16).padStart(2, '0')).join(''); }
  const designUc = new Map(dm.useCases.map((u) => [u.id, u]));
  const domainOrder = domainsOf();
  const showScore = has(m, 'inspire_score');
  domainOrder.forEach((d, di) => {
    const s = newSlide(P.page); chrome(s, `Domain ${di + 1} of ${domainOrder.length}`);
    const info = dm.domains.find((x) => x.name === d.name);
    text(s, 'DOMAIN', { x: 0.6, y: 0.8, w: 6, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, bg: P.page, color: P.kicker });
    heading(s, d.name, 1.1, 30);
    kpi(s, 0.6, 1.95, 2.9, 1.2, info ? info.text : NOT_YET, 'estimated value a year', { color: P.accentText });
    kpi(s, 3.7, 1.95, 2.0, 1.2, S(d.ucs.length), 'use cases');
    const head = ['Use case', ...(showScore ? ['Score'] : []), 'Value'].map((t) => ({ text: t, options: { bold: true, color: tc(P.ink, P.card, t), fill: { color: hex(P.card) }, fontFace: bodyFace, fontSize: 12 } }));
    const rows = d.ucs.slice(0, 9).map((u) => [trunc(u.name, 46), ...(showScore ? [Number.isFinite(u.score) ? u.score.toFixed(1) : '-'] : []), u.value ? u.value.text : NOT_YET].map((t) => ({ text: S(t), options: { color: tc(P.ink, P.page, t), fontFace: bodyFace, fontSize: 12 } })));
    s.addTable([head, ...rows], { x: 0.6, y: 3.4, w: 5.1, colW: showScore ? [3.2, 0.7, 1.2] : [3.8, 1.3], border: { type: 'solid', color: hex(P.rule), pt: 0.5 }, fill: { color: hex(P.page) }, rowH: 0.3, autoPage: false });
    const valued = d.ucs.filter((u) => u.value && designUc.has(u.id));
    if (valued.length) {
      text(s, 'Yearly value by use case', { x: 6.1, y: 1.95, w: 6.6, h: 0.35, fontSize: 14, bold: true, bg: P.page, color: P.muted });
      const top = [...valued].sort((a, b) => b.value.amount - a.value.amount).slice(0, 10);
      s.addChart(pptx.charts.BAR, [{ name: 'Value', labels: top.map((u) => trunc(designUc.get(u.id).short || u.name, 28)), values: top.map((u) => u.value.amount) }], { x: 6.1, y: 2.35, w: 6.6, h: 4.6, barDir: 'bar', catAxisOrientation: 'maxMin', chartColors: [accent], showLegend: false, showValue: true, dataLabelColor: tc(P.ink, P.page, 'chart label'), dataLabelFontSize: 12, dataLabelFormatCode: '#,##0', valAxisHidden: true, valGridLine: { style: 'none' }, ...chartBase(P.page), valAxisLabelFormatCode: '#,##0' });
    } else {
      text(s, `Value ${NOT_YET}`, { x: 6.1, y: 2.4, w: 6.6, h: 0.5, fontSize: 16, bg: P.page, color: P.muted });
    }
  });

  // ---- one slide per use case ----
  const pairs = (u) => [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique], ...(has(m, 'data_used') && u.tables.length ? [['Data used', u.tables.join(', ')]] : [])].filter(([, v]) => S(v).trim());
  const ucList = domainOrder.flatMap((d) => d.ucs);
  ucList.forEach((u, i) => {
    const s = newSlide(P.page);
    chrome(s, S(u.domain || 'Other'));
    box(s, 0.6, 0.8, 0.8, 0.8, P.warm, { round: true });
    text(s, S(i + 1), { x: 0.6, y: 0.95, w: 0.8, h: 0.5, fontSize: 22, bold: true, align: 'center', bg: P.warm, color: P.ink, font: face });
    text(s, [u.id, u.domain, u.subdomain].filter(Boolean).join('  |  '), { x: 1.6, y: 0.8, w: W - 2.2, h: 0.3, fontSize: 12, bold: true, charSpacing: 1, bg: P.page, color: P.kicker });
    heading(s, u.name, 1.1, 24, W - 2.2, 1.6);
    box(s, 0.6, 1.85, W - 1.2, 0.04, id === 'consulting' ? P.edge : P.accent);
    const cards = [[u.value ? `${u.value.text} a year` : NOT_YET, u.value ? `Estimated yearly value (${u.value.status})` : 'Yearly value']];
    if (showScore) cards.push([Number.isFinite(u.score) ? `${u.score.toFixed(1)} / 10` : '-', 'Inspire score']);
    if (u.quality) cards.push([u.quality, 'Quality']);
    if (u.value?.verb) cards.push([u.value.verb, 'Value verb']);
    const cw = (W - 1.2 - (cards.length - 1) * 0.2) / cards.length;
    cards.forEach(([v, l], k) => {
      const x = 0.6 + k * (cw + 0.2);
      kpi(s, x, 2.05, cw, 1.2, v, l, { size: 22, color: k === 0 ? P.accentText : P.ink });
      if (showScore && l === 'Inspire score' && Number.isFinite(u.score)) { box(s, x + 0.2, 3.05, cw - 0.4, 0.08, P.track); box(s, x + 0.2, 3.05, (cw - 0.4) * Math.max(0, Math.min(1, u.score / 10)), 0.08, P.accent); }
    });
    const side = pairs(u); const proj = has(m, 'value_projection') && u.value?.yearly?.length;
    const bodyW = side.length || proj ? 7.4 : W - 1.2;
    const runs = [];
    const part = (label, body) => { if (S(body).trim()) runs.push({ text: `${label}\n`, options: { bold: true, color: P.accentText, fontSize: 12, charSpacing: 1 } }, { text: `${body}\n\n`, options: { color: P.body, fontSize: 14 } }); };
    if (has(m, 'use_case_story')) { part('STATEMENT', u.statement); part('SOLUTION', u.solution); part('BUSINESS VALUE', u.businessValue); }
    if (has(m, 'value_story') && u.value?.story) part('VALUE STORY', u.value.story);
    if (runs.length) rich(s, runs, { x: 0.6, y: 3.5, w: bodyW, h: 3.2, bg: P.page });
    if (side.length) {
      box(s, 8.4, 3.5, 4.3, proj ? 1.9 : 3.2, P.card, { round: !P.masthead });
      rich(s, side.flatMap(([k, v]) => [{ text: `${k}\n`, options: { bold: true, color: P.accentText, fontSize: 12 } }, { text: `${trunc(v, 90)}\n\n`, options: { color: P.ink, fontSize: 12 } }]), { x: 8.6, y: 3.6, w: 3.9, h: proj ? 1.7 : 3.0, bg: P.card });
    }
    if (proj) {
      const y = u.value.yearly; const lbl = y.map((r) => `Year ${r.year}`);
      s.addChart(pptx.charts.BAR, [{ name: 'Low', labels: lbl, values: y.map((r) => r.low) }, { name: 'Likely', labels: lbl, values: y.map((r) => r.likely) }, { name: 'High', labels: lbl, values: y.map((r) => r.high) }], { x: 8.4, y: side.length ? 5.45 : 3.5, w: 4.3, h: side.length ? 1.6 : 3.3, barDir: 'col', chartColors: [hex(P.rule), accent, hex(P.warm)], showLegend: true, legendPos: 'b', legendColor: tc(P.ink, P.page, 'legend'), legendFontSize: 12, ...chartBase(P.page) });
    }
    if (has(m, 'disclaimer')) text(s, 'Estimated value, not a promised value. Your business value team must validate it.', { x: 0.6, y: 6.95, w: 9, h: 0.3, fontSize: 12, italic: true, bg: P.page, color: P.muted });
  });

  // ---- portfolio ----
  const p = newSlide(P.page); chrome(p, 'Portfolio');
  text(p, 'PORTFOLIO', { x: 0.6, y: 0.8, w: 6, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, bg: P.page, color: P.kicker });
  heading(p, 'Where the value is', 1.1, 30);
  text(p, dm.total.nWithValue ? `${dm.total.text} a year` : NOT_YET, { x: 0.6, y: 1.9, w: 5.6, h: 0.8, fontSize: 36, bold: true, bg: P.page, color: P.accentText, font: face });
  text(p, `${m.total.nWithValue} of ${m.total.n} use cases have a calculated value.`, { x: 0.6, y: 2.7, w: 5.6, h: 0.4, fontSize: 14, bg: P.page, color: P.muted });
  if (dm.domains.length) {
    text(p, 'Yearly value by domain', { x: 0.6, y: 3.3, w: 5.6, h: 0.35, fontSize: 14, bold: true, bg: P.page, color: P.muted });
    p.addChart(pptx.charts.BAR, [{ name: 'Value', labels: dm.domains.slice(0, 8).map((d) => trunc(d.name, 24)), values: dm.domains.slice(0, 8).map((d) => d.value) }], { x: 0.6, y: 3.65, w: 5.8, h: 3.2, barDir: 'bar', catAxisOrientation: 'maxMin', chartColors: [accent], showLegend: false, showValue: true, dataLabelColor: tc(P.ink, P.page, 'chart label'), dataLabelFontSize: 12, dataLabelFormatCode: '#,##0', valAxisHidden: true, valGridLine: { style: 'none' }, ...chartBase(P.page) });
  }
  if (dm.useCases.length) {
    text(p, 'Inspire score against yearly value', { x: 6.9, y: 1.9, w: 5.8, h: 0.35, fontSize: 14, bold: true, bg: P.page, color: P.muted });
    p.addChart(pptx.charts.SCATTER, [{ name: 'Inspire score', values: dm.useCases.map((u) => u.score) }, { name: 'Yearly value', values: dm.useCases.map((u) => u.value.amount) }], { x: 6.9, y: 2.25, w: 5.8, h: 4.2, chartColors: [accent], lineSize: 0, lineDataSymbolSize: 9, showLegend: false, showCatAxisTitle: true, catAxisTitle: 'Inspire score', catAxisTitleColor: tc(P.ink, P.page, 'axis title'), catAxisTitleFontSize: 12, showValAxisTitle: true, valAxisTitle: 'Yearly value', valAxisTitleColor: tc(P.ink, P.page, 'axis title'), valAxisTitleFontSize: 12, valAxisLabelFormatCode: '#,##0', ...chartBase(P.page) });
  }
  if (has(m, 'disclaimer')) text(p, DISCLAIMER, { x: 0.6, y: 6.95, w: W - 1.2, h: 0.4, fontSize: 12, italic: true, bg: P.page, color: P.muted });
}
