// C25 (REQ-559 part 2): the agent's original presentation deck plus value, with pptxgenjs.
// A port of the agent's _build_presentation_deck and its _deck_* slides (6a7361a39, app/agent/agent/dbx_inspire_ai_agent.ipynb),
// reading the shared agent document model (agentModel.js). Same slides and order; each use case slide adds the value a year with
// its basis and estimate note, and one value slide sits after the last domain and before the index.
// Every slide's first shape is named slide:<kind>[:<key>] so the slide sequence can be read back from the file.
import PptxGenJS from 'pptxgenjs';
import { buildAgentModel, agentOutline, DOC_COLORS as C, DOC_INDEX_COLUMNS, DOC_QUALITY_ORDER, DOC_VALUE_LEFT, DOC_BRAND, qualityColor } from './agentModel.js';

const W = 13.333;
const S = { numeral: 60, hero: 44, display: 32, title: 28, card_title: 28, heading: 16, lead: 16, body: 14 }; // C26: titles 28-32, labels 14, body 14-16, hero 40-60; nothing below 14 pt
const INDEX_ROWS = 12; // _DOC_PPTX_INDEX_ROWS
const FOUNDATION_ROWS = 6; // _DOC_PPTX_FOUNDATION_ROWS
const DECK_ALL = 15; // _DOC_TOP_LIMIT["deck_all"]: up to this many use cases, every one gets its slides
const ACCENTS = [C.teal, C.coral, C.gold, C.teal_mid, C.green, C.amber];
const MODES = [['Good', 'value_mode_good', 'doc_mode_good_body'], ['High', 'value_mode_high', 'doc_mode_high_body'], ['Ultra High', 'value_mode_ultra_high', 'doc_mode_ultra_body']];
const chipW = (label) => Math.min(4.6, 0.45 + String(label).length * 0.11);
// Height in inches of text set at size pt in a box w inches wide (average glyph 0.52 em, line 1.2 em): lets a block get the box it needs instead of shrinking.
const LINE = (size) => (size * 1.22) / 72;
const linesOf = (text, w, size) => String(text ?? '').split('\n').reduce((n, part) => n + Math.max(1, Math.ceil((part.length * size * 0.007) / Math.max(0.5, w - 0.12))), 0);
const heightOf = (paras, w, size, gap = 0.06) => (Array.isArray(paras) ? paras : [paras]).reduce((h, p, i) => h + linesOf(Array.isArray(p) ? p.map((r) => r[0]).join('') : p, w, size) * LINE(size) + (i ? gap : 0), 0) + 0.08;

// The biggest size of the list at which the text fits the box (never below the last, 14 pt).
const pick = (paras, w, h, sizes = [20, 18, 16, 14]) => sizes.find((z) => heightOf(paras, w, z) <= h) || sizes[sizes.length - 1];

class Deck {
  constructor(m) {
    this.m = m; this.T = m.T; this.rtl = m.rtl;
    this.pptx = new PptxGenJS();
    this.pptx.layout = 'LAYOUT_WIDE';
    if (m.rtl) this.pptx.rtlMode = true;
    this.slides = [];
  }
  mx(x, w) { return this.rtl ? W - x - w : x; }
  kicker(v) { return this.m.latinDisplay ? String(v ?? '').toUpperCase() : String(v ?? ''); }
  ltr(v) { return this.rtl ? `‎${v}‎` : String(v); }
  align(a = 'start') { return a === 'center' ? 'center' : (a === 'start') !== this.rtl ? 'left' : 'right'; }
  new(kind, title, { key = '', background = C.white, dark = false } = {}) {
    const s = this.pptx.addSlide();
    s.background = { color: dark ? C.teal_dark : background };
    s.addShape('rect', { x: 0, y: 0, w: 0.01, h: 0.01, fill: { color: C.white, transparency: 100 }, line: { type: 'none' }, objectName: `slide:${kind}${key === '' ? '' : `:${key}`}` });
    if (dark) s.addShape('rect', { x: 0, y: 3.75, w: W, h: 3.75, fill: { color: C.teal_mid, transparency: 70 }, line: { type: 'none' } });
    this.slides.push({ kind, ...(key === '' ? {} : { key: String(key) }), title: String(title ?? '') });
    return s;
  }
  rect(s, x, y, w, h, fill, { radius = 0, line = null, alpha = null, oval = false, name } = {}) {
    s.addShape(oval ? 'ellipse' : radius ? 'roundRect' : 'rect', {
      x: this.mx(x, w), y, w, h, fill: { color: fill, transparency: alpha === null ? 0 : Math.round((1 - alpha) * 100) },
      line: line ? { color: line[0], width: line[1] } : { type: 'none' }, ...(radius ? { rectRadius: radius } : {}), ...(name ? { objectName: name } : {}),
    });
  }
  // paragraphs: a string, a list of strings, or a list of paragraphs, each a list of [text, options] runs.
  text(s, x, y, w, h, paragraphs, { size = S.body, color = C.body, bold = false, italic = false, align = 'start', anchor = 'top', spacing = 4, name } = {}) {
    const paras = (Array.isArray(paragraphs) ? paragraphs : [paragraphs]).map((p) => (Array.isArray(p) ? p : [[p, {}]]));
    const runs = [];
    paras.forEach((p, i) => p.forEach(([t, o = {}], j) => runs.push({
      text: String(t ?? ''), options: { bold: o.bold ?? bold, italic: o.italic ?? italic, color: o.color || color, ...(j === p.length - 1 && i < paras.length - 1 ? { breakLine: true } : {}) },
    })));
    s.addText(runs, { x: this.mx(x, w), y, w, h, fontSize: size, color, align: this.align(align), valign: anchor, margin: 0.04, paraSpaceAfter: paras.length > 1 ? spacing : 0,
      ...(this.rtl ? { rtlMode: true } : {}), ...(name ? { objectName: name } : {}) });
  }
  wordmark(s, x, y, h, light) {
    this.rect(s, x, y + h / 2 - 0.07, 0.14, 0.14, C.gold, { oval: true });
    this.text(s, x + 0.22, y, 4.0, h, [[[`${DOC_BRAND.maker} `, { color: light ? C.mint2 : C.muted }], [DOC_BRAND.product, { color: light ? C.white : C.teal, bold: true }]]], { size: S.heading, anchor: 'middle' });
  }
  header(s, kicker, title) {
    this.text(s, 0.6, 0.5, 9.0, 0.3, this.kicker(kicker), { color: C.coral, bold: true });
    this.text(s, 0.6, 0.8, 12.13, 0.66, title, { size: S.title, color: C.ink, bold: true });
    this.rect(s, 0.6, 1.5, 0.6, 0.06, C.gold);
  }
  lead(s, text, italic = false) {
    if (!text) return 1.75;
    this.text(s, 0.6, 1.62, 12.13, 0.4, text, { color: C.muted, italic });
    return 2.08;
  }
  tile(s, x, y, w, h, value, label, { fill = C.sand, valueSize = 24, name } = {}) {
    this.rect(s, x, y, w, h, fill, { radius: 0.12, name });
    this.text(s, x + 0.1, y + 0.04, w - 0.2, h * 0.56, String(value), { size: valueSize, color: C.teal, bold: true, align: 'center', anchor: 'middle' });
    this.text(s, x + 0.1, y + h * 0.58, w - 0.2, h * 0.4, label, { color: C.muted, align: 'center' });
  }
  chip(s, x, y, w, label, fill, color) {
    this.rect(s, x, y, w, 0.34, fill, { radius: 0.17 });
    this.text(s, x + 0.08, y, w - 0.16, 0.34, label, { color, bold: true, align: 'center', anchor: 'middle' });
  }
  // _deck_index_table: rank, ID, title, domain, quality pill, Inspire Score.
  indexTable(s, views, y, bottom = 6.98) {
    const T = this.T;
    let cols = DOC_INDEX_COLUMNS.map(([k, labelKey, w]) => [k, labelKey ? T(labelKey) : 'ID', w * 12.13]);
    if (this.rtl) cols = [...cols].reverse();
    const center = (k) => ['rank', 'quality', 'inspire_score'].includes(k);
    const head = cols.map(([k, l]) => ({ text: l, options: { bold: true, color: C.white, fill: { color: C.teal }, align: center(k) ? 'center' : this.align() } }));
    const rows = views.map((v, i) => cols.map(([k]) => {
      const flag = v.coverage ? `${v.coverage[0]} · ` : '';
      const base = { fill: { color: i % 2 ? C.sand3 : C.white }, align: center(k) ? 'center' : this.align() };
      if (k === 'quality') return { text: v.quality || T('doc_not_scored'), options: { ...base, bold: true, color: C.white, fill: { color: qualityColor(v.quality) } } };
      const val = { rank: String(v.rank), id: v.id, title: `${flag}${v.title}`, domain: v.domain, inspire_score: this.ltr(v.metrics[1][2]) }[k];
      const style = { rank: [C.teal, true], id: [C.coral, true], title: [C.ink, false], domain: [C.body, false], inspire_score: [C.teal, true] }[k];
      return { text: val, options: { ...base, color: style[0], bold: style[1] } };
    }));
    const rowH = Math.max(0.3, Math.min(0.5, (bottom - y - 0.42) / Math.max(1, rows.length)));
    const titleW = (cols.find((c) => c[0] === 'title') || [0, 0, 5])[2];
    const longest = Math.max(0, ...views.map((v) => String(v.title).length));
    const fontSize = rowH >= 0.38 && longest * 0.125 < titleW - 0.2 ? 16 : S.body;
    s.addTable([head, ...rows], { x: 0.6, y, w: 12.13, colW: cols.map((c) => c[2]), rowH: [0.42, ...rows.map(() => rowH)], fontSize, valign: 'middle',
      border: { type: 'none' }, margin: 0.05, ...(this.rtl ? { rtlMode: true } : {}) });
  }
}

function cover(d, m) {
  const T = m.T;
  const s = d.new('cover', T('pptx_main_title'), { dark: true });
  for (const [x, y, size, alpha] of [[8.9, 0.25, 4.2, 0.08], [10.3, 0.45, 2.7, 0.1], [8.2, 3.6, 2.3, 0.07], [10.7, 4.6, 2.5, 0.08]]) d.rect(s, x, y, size, size, C.white, { oval: true, alpha });
  d.rect(s, 11.05, 1.25, 0.62, 0.62, C.gold, { oval: true, alpha: 0.9 });
  d.wordmark(s, 0.75, 0.45, 0.42, true);
  d.text(s, 0.75, 1.12, 8.6, 0.32, d.kicker(`${T('doc_catalog_kicker')} · ${d.ltr(m.date)}`), { color: C.mint2, bold: true });
  d.text(s, 0.75, 1.5, 8.3, 1.75, T('pptx_main_title'), { size: S.hero, color: C.white, bold: true });
  d.text(s, 0.75, 3.35, 8.3, 0.34, T('doc_prepared_for'), { size: S.lead, color: C.mint2 });
  d.text(s, 0.75, 3.67, 8.3, 0.72, m.businessName, { size: S.display, color: C.gold, bold: true });
  if (m.mode) {
    const label = `${T('doc_quality_mode')}: ${m.modeLabel}`;
    const w = Math.min(5.5, chipW(label) + 0.3);
    d.rect(s, 0.75, 4.5, w, 0.42, C.gold, { radius: 0.21 });
    d.text(s, 0.85, 4.5, w - 0.2, 0.42, label, { color: C.gold_ink, bold: true, align: 'center', anchor: 'middle' });
  }
  m.headline.slice(0, 3).forEach(([value, label], i) => {
    const x = 0.75 + i * 2.85;
    d.rect(s, x, 5.15, 2.65, 1.3, C.white, { radius: 0.14, alpha: 0.12 });
    d.text(s, x + 0.2, 5.2, 2.25, 0.7, value, { size: S.display, color: C.white, bold: true, anchor: 'middle' });
    d.text(s, x + 0.2, 5.9, 2.25, 0.5, label, { color: C.mint2, bold: true });
  });
  d.text(s, 0.75, 6.75, 11.8, 0.32, m.generatedBy, { color: C.mint2 });
}

function contents(d, m) {
  const s = d.new('contents', m.T('doc_contents'));
  d.header(s, m.businessName, m.T('doc_contents'));
  const outline = agentOutline(m);
  const rows = Math.ceil(outline.length / 2);
  const h = Math.min(1.25, (5.2 - 0.16 * (rows - 1)) / Math.max(1, rows));
  outline.forEach(([, title, subtitle], i) => {
    const x = 0.6 + (i % 2) * 6.19; const y = 1.8 + Math.floor(i / 2) * (h + 0.16);
    d.rect(s, x, y, 5.94, h, C.sand, { radius: 0.14 });
    d.rect(s, x + 0.2, y + (h - 0.66) / 2, 0.66, 0.66, ACCENTS[i % ACCENTS.length], { radius: 0.14 });
    d.text(s, x + 0.2, y + (h - 0.66) / 2, 0.66, 0.66, String(i + 1).padStart(2, '0'), { size: S.heading, color: C.white, bold: true, align: 'center', anchor: 'middle' });
    d.text(s, x + 1.05, y + 0.06, 4.7, h * 0.44, title, { size: 20, color: C.ink, bold: true, anchor: 'middle' });
    d.text(s, x + 1.05, y + h * 0.5, 4.7, h * 0.46, subtitle, { color: C.muted });
  });
}

// _deck_summary + _deck_summary_more: what does not fit the first slide goes on a second.
function summary(d, m) {
  const T = m.T;
  const budget = 1300;
  const first = []; const rest = []; let used = 0;
  for (const p of m.executive) { if (!first.length || used + p.length <= budget) { first.push(p); used += p.length; } else rest.push(p); }
  const s = d.new('summary', T('pdf_exec_summary'));
  d.header(s, T('doc_exec_kicker'), T('pdf_exec_summary'));
  d.rect(s, 0.6, 1.8, 8.35, 4.95, C.sand, { radius: 0.14 });
  d.rect(s, 0.6, 1.8, 0.1, 4.95, C.teal);
  d.text(s, 0.95, 2.0, 7.75, 4.55, first, { size: pick(first, 7.75, 4.55, [22, 20, 18, 16, 14]), spacing: 10 });
  m.headline.forEach(([value, label], i) => d.tile(s, 9.2, 1.8 + i * 1.26, 3.53, 1.13, value, label, { valueSize: 32 }));
  if (!rest.length) return;
  const more = d.new('summary_more', `${T('pdf_exec_summary')} (${T('doc_continued')})`);
  d.header(more, T('doc_exec_kicker'), `${T('pdf_exec_summary')} (${T('doc_continued')})`);
  const half = Math.ceil(rest.length / 2);
  [rest.slice(0, half), rest.slice(half)].forEach((chunk, col) => {
    if (!chunk.length) return;
    const x = 0.6 + col * 6.19;
    d.rect(more, x, 1.8, 5.94, 4.95, C.white, { radius: 0.14, line: [C.line, 1] });
    d.rect(more, x, 1.8, 5.94, 0.09, col ? C.coral : C.teal);
    d.text(more, x + 0.3, 2.1, 5.34, 4.45, chunk, { size: pick(chunk, 5.34, 4.45, [20, 18, 16, 14]), spacing: 10 });
  });
}

function guide(d, m) {
  const T = m.T;
  const s = d.new('guide', T('doc_how_to_read'), { background: C.sand });
  d.header(s, T('doc_guide_kicker'), T('doc_how_to_read'));
  d.text(s, 0.6, 1.62, 12.13, 0.5, T(m.guideLeadKey), { size: pick(T(m.guideLeadKey), 12.13, 0.5, [16, 14]) });
  const top = 2.15; const cardH = 2.35;
  [[0.6, T('doc_inspire_score_title'), T('doc_inspire_score_body')], [6.79, T('doc_quality_tiers_title'), T('doc_quality_tiers_body')]].forEach(([x, title, body]) => {
    d.rect(s, x, top, 5.94, cardH, C.white, { radius: 0.14, line: [C.line, 1] });
    d.text(s, x + 0.25, top + 0.12, 5.44, 0.36, title, { size: S.heading, color: C.ink, bold: true });
    d.text(s, x + 0.25, top + 0.5, 5.44, cardH - 1.0, body, { size: pick(body, 5.44, cardH - 1.0, [18, 16, 14]) });
  });
  const marks = top + cardH - 0.4;
  [C.coral, C.amber, C.green, C.teal_dark].forEach((c, i) => d.rect(s, 0.85 + i * 1.36, marks, 1.36, 0.14, c));
  let x = 7.04;
  for (const label of DOC_QUALITY_ORDER) {
    const t = `${label} ${m.qualityCounts[label]}`; const w = chipW(t);
    if (x + w > 12.5) break;
    d.chip(s, x, marks - 0.08, w, t, qualityColor(label), C.white);
    x += w + 0.08;
  }
  const low = top + cardH + 0.15; const h = 6.8 - low;
  d.rect(s, 0.6, low, 5.94, h, C.sand2, { radius: 0.14 });
  d.text(s, 0.85, low + 0.1, 5.44, 0.34, T('doc_modes_title'), { size: S.heading, color: C.ink, bold: true });
  const modeParas = MODES.map(([mode, nameKey, bodyKey]) => [
    [`${T(nameKey)}${mode === m.mode ? ` · ${T('doc_this_catalog')}` : ''}: `, { bold: true, color: mode === m.mode ? C.gold_dark : C.teal }], [T(bodyKey), {}]]);
  d.text(s, 0.85, low + 0.5, 5.44, h - 0.6, modeParas, { size: pick(modeParas, 5.44, h - 0.6, [16, 14]) });
  d.rect(s, 6.79, low, 5.94, h, C.white, { radius: 0.14, line: [C.line, 1] });
  d.text(s, 7.04, low + 0.1, 5.44, 0.36, T('doc_elite_score_title'), { size: S.heading, color: C.ink, bold: true });
  const eliteParas = [[[T('doc_elite_score_body'), {}]], [[`${T('doc_coverage_title')}: `, { bold: true, color: C.coral }], [T('doc_coverage_body'), {}]]];
  d.text(s, 7.04, low + 0.5, 5.44, h - 0.6, eliteParas, { size: pick(eliteParas, 5.44, h - 0.6, [16, 14]) });
}

function portfolio(d, m) {
  const T = m.T;
  const s = d.new('portfolio', T('doc_portfolio_glance'));
  d.header(s, T('doc_portfolio_kicker'), T('doc_portfolio_glance'));
  d.rect(s, 0.6, 1.8, 7.0, 4.95, C.white, { radius: 0.14, line: [C.line, 1] });
  d.text(s, 0.85, 1.95, 6.5, 0.36, T('doc_per_domain'), { size: S.heading, color: C.ink, bold: true });
  const limit = 11;
  const shown = m.domains.slice(0, m.domains.length <= limit ? limit : limit - 1);
  const peak = Math.max(1, ...m.domains.map((x) => x.useCases.length));
  const step = Math.min(0.55, 4.2 / Math.max(1, shown.length + (m.domains.length > shown.length ? 1 : 0)));
  shown.forEach((dom, i) => {
    const y = 2.45 + i * step;
    d.text(s, 0.85, y, 2.5, step, dom.name, { size: 16, color: C.ink, anchor: 'middle' });
    d.rect(s, 3.4, y + step / 2 - 0.075, 3.25, 0.15, C.sand2, { radius: 0.07 });
    d.rect(s, 3.4, y + step / 2 - 0.075, Math.max(0.08, (3.25 * dom.useCases.length) / peak), 0.15, C.teal, { radius: 0.07 });
    d.text(s, 6.75, y, 0.7, step, String(dom.useCases.length), { size: 16, color: C.teal, bold: true, anchor: 'middle', align: 'end' });
  });
  if (m.domains.length > shown.length) d.text(s, 0.85, 2.45 + shown.length * step, 6.5, step, `+${m.domains.length - shown.length} ${T('doc_domains')}`, { size: 16, color: C.muted, anchor: 'middle' });
  d.rect(s, 7.85, 1.8, 4.88, 4.95, C.sand, { radius: 0.14 });
  d.text(s, 8.1, 1.95, 4.4, 0.36, T('doc_quality_distribution'), { size: S.heading, color: C.ink, bold: true });
  const total = Math.max(1, m.qualityRows.reduce((a, r) => a + r[1], 0));
  let x = 8.1;
  for (const [label, n] of m.qualityRows) { const w = (4.38 * n) / total; d.rect(s, x, 2.5, w, 0.4, qualityColor(label)); x += w; }
  const qrows = m.qualityRows.slice(0, 8); const qstep = Math.min(0.7, 3.6 / Math.max(1, qrows.length));
  qrows.forEach(([label, n, name], i) => {
    const y = 3.05 + i * qstep;
    d.rect(s, 8.12, y + qstep / 2 - 0.1, 0.2, 0.2, qualityColor(label), { oval: true });
    d.text(s, 8.45, y, 3.2, qstep, name, { size: 18, color: C.ink, anchor: 'middle' });
    d.text(s, 11.7, y, 0.8, qstep, String(n), { size: 24, color: C.teal, bold: true, anchor: 'middle', align: 'end' });
  });
}

function topIndex(d, m, deckCount) {
  const T = m.T;
  const s = d.new('top_index', T('doc_top_use_cases'));
  d.header(s, T('doc_portfolio_kicker'), T('doc_top_use_cases'));
  const note = m.total > deckCount ? T('doc_deck_scope', { count: deckCount, total: m.total }) : T('doc_deck_scope_all', { total: m.total });
  d.indexTable(s, m.top, d.lead(s, note, true));
}

function domainSlide(d, m, dom) {
  const T = m.T;
  const number = String(dom.index).padStart(2, '0');
  const s = d.new('domain', dom.name, { key: dom.index });
  d.rect(s, 0, 0, W, 2.6, C.teal);
  d.rect(s, 10.9, 0.15, 2.3, 2.3, C.white, { oval: true, alpha: 0.08 });
  d.text(s, 0.6, 0.35, 2.4, 1.0, number, { size: S.numeral, color: C.mint2, bold: true, anchor: 'middle' });
  d.text(s, 0.6, 1.4, 7.0, 0.3, d.kicker(`${T('doc_domain_label')} ${number}`), { color: C.coral_soft, bold: true });
  d.text(s, 0.6, 1.72, 6.8, 0.7, dom.name, { size: S.title, color: C.white, bold: true });
  dom.stats.slice(0, 4).forEach(([value, label], i) => d.tile(s, 7.6 + (i % 2) * 2.6, 0.5 + Math.floor(i / 2) * 1.04, 2.5, 0.96, value, label, { fill: C.white }));
  d.text(s, 0.6, 2.82, 7.3, 0.32, T('doc_domain_overview'), { size: S.heading, color: C.teal, bold: true });
  d.text(s, 0.6, 3.2, 7.3, 1.5, dom.overview, { size: pick(dom.overview, 7.3, 1.5, [18, 16, 14]) });
  d.text(s, 8.13, 2.82, 4.6, 0.32, T('doc_what_it_covers'), { size: S.heading, color: C.teal, bold: true });
  let x = 8.13; let y = 3.22;
  for (const [name, count] of dom.subdomains.slice(0, 12)) {
    const label = `${name} ${count}`; const w = chipW(label);
    if (x + w > 12.73) { x = 8.13; y += 0.42; }
    if (y > 4.3) break;
    d.chip(s, x, y, w, label, C.sand2, C.teal);
    x += w + 0.08;
  }
  d.text(s, 0.6, 4.78, 12.13, 0.32, T('doc_top_opportunities'), { size: S.heading, color: C.ink, bold: true });
  d.indexTable(s, dom.top.slice(0, 4), 5.16, 7.1);
}

const CM = 0.5; const CW = W - 2 * CM; // use case slides: 0.5 in margins

function cardHead(d, s, v, T) {
  const accent = { elite: C.gold, coverage: C.coral }[v.kind] || C.teal;
  d.rect(s, CM, 0.4, 0.9, 0.9, accent, { radius: 0.14 });
  d.text(s, CM, 0.4, 0.9, 0.9, String(v.rank), { size: S.title, color: v.kind === 'elite' ? C.gold_ink : C.white, bold: true, align: 'center', anchor: 'middle' });
  d.text(s, 1.65, 0.38, CW - 1.15, 0.34, d.kicker([v.id, v.domain, v.subdomain].filter(Boolean).join(' · ')), { color: C.coral, bold: true });
  const big = linesOf(v.title, CW - 1.15, S.card_title) <= 2;
  d.text(s, 1.65, 0.72, CW - 1.15, 0.95, v.title, { size: big ? S.card_title : 24, color: C.ink, bold: true });
  d.rect(s, CM, 1.7, CW, 0.05, C.teal);
}

// The value story slide's header: one small line (rank, id, title), not the card's big title again.
function storyHead(d, s, v, kicker) {
  d.text(s, CM, 0.4, CW, 0.34, d.kicker(`${kicker} · ${v.id}`), { color: C.coral, bold: true });
  d.text(s, CM, 0.74, CW, 0.5, v.title, { size: 24, color: C.ink, bold: true });
  d.rect(s, CM, 1.4, CW, 0.05, C.teal);
}

function noteBand(d, s, top, accent, paras) {
  const h = Math.max(0.46, heightOf(paras, CW - 0.5, S.body) + 0.1);
  d.rect(s, CM, top, CW, h, C.note, { radius: 0.08, line: [C.note_line, 0.75] });
  d.rect(s, CM, top, 0.07, h, accent);
  d.text(s, CM + 0.25, top, CW - 0.4, h, paras, { color: C.note_ink, anchor: 'middle' });
  return top + h + 0.1;
}

// One block of a card: a label and its items. A list of short items reads as one line of points; long ones stay paragraphs.
const blockParas = (items) => {
  const list = items.map(String);
  return list.length > 1 && list.every((x) => x.length <= 48) ? [list.join('  ·  ')] : list;
};
const blockH = (label, items, w, size) => 0.32 + heightOf(blockParas(items), w, size);

// Draws blocks (label then text) down a column; free height is shared out as space between them.
function column(d, s, x, top, bottom, w, blocks, size) {
  const need = blocks.reduce((h, b) => h + blockH(b[0], b[1], w, size), 0);
  const gap = blocks.length > 1 ? Math.min(0.32, Math.max(0.1, (bottom - top - need) / (blocks.length - 1))) : 0;
  const lift = blocks.length ? Math.min(0.6, Math.max(0, (bottom - top - need - gap * (blocks.length - 1)) / 2)) : 0;
  let y = top + lift;
  for (const [label, items] of blocks) {
    const h = blockH(label, items, w, size);
    d.text(s, x, y, w, 0.3, d.kicker(label), { color: C.teal, bold: true });
    d.text(s, x, y + 0.32, w, h - 0.32, blockParas(items), { size, color: C.ink, spacing: 4 });
    y += h + gap;
  }
}

function useCaseCard(d, m, v) {
  const T = m.T;
  const s = d.new('uc_card', v.title, { key: v.id });
  cardHead(d, s, v, m.T);
  // Score chips and the ribbons in one flowing row.
  let x = CM; let y = 1.9; const rowH = 0.42;
  const place = (label, value, fill, color, vcolor) => {
    const text = value === '' ? label : `${label}  ${value}`; const w = 0.28 + text.length * 0.093;
    if (x + w > CM + CW && x > CM) { x = CM; y += rowH + 0.08; }
    d.rect(s, x, y, w, rowH, fill, { radius: 0.21 });
    d.text(s, x + 0.08, y, w - 0.16, rowH, [[[label, { color }], ...(value === '' ? [] : [['  ', {}], [d.ltr(value), { bold: true, color: vcolor || color }]])]], { color, align: 'center', anchor: 'middle' });
    x += w + 0.08;
  };
  for (const [key, label, value] of v.metrics) {
    if (key === 'quality') place(label, value, qualityColor(value), C.white, C.white); else place(label, value, C.sand, C.muted, C.teal);
  }
  if (v.meetsBar) place(v.meetsBar, '', C.green, C.white);
  if (v.star) place(v.star, '', C.gold, C.gold_ink);
  let top = y + rowH + 0.14;
  if (v.coverage) top = noteBand(d, s, top, C.coral, [[[`${v.coverage[0]}. `, { bold: true, color: C.note_dark }], [`${v.coverage[1]}: ${v.coverage[2]}`, {}]]]);
  const bottom = 7.1; const GAP = 0.4; const CWD = (CW - GAP) / 2;
  const narrative = v.narrative.map(([, label, value]) => [label, [value]]);
  const extra = v.valueFacts.filter(([, , items]) => items.length).map(([, label, items]) => [label, items]);
  // The facts (sponsor, beneficiary ...) are one sand strip in two columns; every business block then flows over two text columns in order.
  const facts = v.facts.map(([, label, value]) => [[`${label}: `, { bold: true, color: C.teal }], [value, { color: C.ink }]]);
  if (facts.length) {
    const half = Math.ceil(facts.length / 2); const cols = [facts.slice(0, half), facts.slice(half)].filter((c) => c.length);
    const fh = Math.max(...cols.map((c) => heightOf(c, CWD - 0.1, S.body, 0.06))) + 0.2;
    d.rect(s, CM, top, CW, fh, C.sand, { radius: 0.1 });
    cols.forEach((c, i) => d.text(s, CM + 0.2 + i * (CWD + GAP), top + 0.1, CWD - 0.1, fh - 0.2, c, { spacing: 4 }));
    top += fh + 0.15;
  }
  const room = bottom - top;
  const hs = (blocks, sz) => blocks.reduce((h, b) => h + blockH(b[0], b[1], CWD, sz) + 0.1, 0);
  // The narrative is split over two columns in order at the biggest size that fits (16 pt, else 14 pt); each other block then goes
  // to the shorter column if it fits, else the other, else to the second slide.
  const split = (list, sz) => {
    let best = null;
    for (let k = 0; k <= list.length; k += 1) {
      const l = hs(list.slice(0, k), sz); const r = hs(list.slice(k), sz);
      if (l <= room && r <= room && (!best || Math.max(l, r) < best.m)) best = { k, m: Math.max(l, r) };
    }
    return best;
  };
  let sz = S.lead; let plan = split(narrative, sz);
  if (!plan) { sz = S.body; plan = split(narrative, sz); }
  const cols = [narrative.slice(0, plan ? plan.k : narrative.length), narrative.slice(plan ? plan.k : narrative.length)];
  const rest = [];
  for (const b of extra) {
    const order = hs(cols[0], sz) <= hs(cols[1], sz) ? [0, 1] : [1, 0];
    const at = order.find((i) => hs([...cols[i], b], sz) <= room);
    if (at === undefined) rest.push(b); else cols[at].push(b);
  }
  column(d, s, CM, top, bottom, CWD, cols[0], sz);
  column(d, s, CM + CWD + GAP, top, bottom, CWD, cols[1], sz);
  return rest;
}

// Blocks that did not fit the card, one sand box each, full width and as big as the text allows (the second slide of a use case without a value).
function useCaseValue(d, m, v, blocks) {
  const s = d.new('uc_value', v.title, { key: v.id });
  storyHead(d, s, v, v.domain);
  const top = 1.7; const bottom = 7.1; const w = CW - 0.5; const gap = 0.2;
  const size = [32, 28, 24, 22, 20, 18, 16, 14].find((z) => blocks.reduce((h, b) => h + blockH(b[0], b[1], w, z) + 0.3 + gap, 0) <= bottom - top + gap) || 14;
  const boxes = blocks.map((b) => blockH(b[0], b[1], w, size) + 0.3);
  const spare = Math.max(0, bottom - top - boxes.reduce((a, h) => a + h, 0) - gap * (blocks.length - 1));
  let y = top;
  blocks.forEach((b, i) => {
    const h = boxes[i] + spare / blocks.length;
    d.rect(s, CM, y, CW, h, C.sand, { radius: 0.14 });
    column(d, s, CM + 0.25, y + 0.12, y + h - 0.12, w, [b], size);
    y += h + gap;
  });
}

const parseMoney = (t) => {
  const m = /([\d,]*\.?\d+)\s*([KMB])?/i.exec(String(t));
  return m ? Number(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1) : 0;
};

// REQ-561 / C26: the value story slide: the amount as a hero with its basis, the story, the 3-year projection as a bar chart and a small
// table, and the drivers as bars with their formula. Blocks that did not fit the card follow the story.
function useCaseStory(d, m, v, spill = []) {
  const T = m.T; const val = v.value;
  const s = d.new('uc_story', v.title, { key: v.id });
  storyHead(d, s, v, T('value_story'));
  const bottom = 7.1; const top = 1.7; const LW = 6.0; const RX = CM + LW + 0.33; const RW = W - CM - RX;
  const proj = val.projection; const hasF = val.factors.length > 0;
  // Left: the hero number with its basis, then the blocks that did not fit the card, or else the projection chart.
  const heroParas = [[[`${T('value_basis')}: `, { bold: true, color: C.teal_dark }], [val.basis, {}]]];
  if (val.note) heroParas.push([[`${T('value_note')}: `, { bold: true, color: C.teal_dark }], [val.note, {}]]);
  const heroH = 1.2 + heightOf(heroParas, LW - 0.5, S.body, 0.06);
  d.rect(s, CM, top, LW, heroH, C.ice, { radius: 0.14, line: [C.mint2, 0.75] });
  d.rect(s, CM, top, 0.09, heroH, C.teal);
  d.text(s, CM + 0.3, top + 0.08, LW - 0.5, 0.3, d.kicker(T('value_at_stake')), { color: C.teal_dark, bold: true });
  d.text(s, CM + 0.3, top + 0.36, LW - 0.5, 0.8, val.text, { size: 54, color: C.teal, bold: true, anchor: 'middle', name: `story-hero:${val.amount}` });
  d.text(s, CM + 0.3, top + 1.18, LW - 0.5, heroH - 1.2, heroParas, { spacing: 4 });
  const lTop = top + heroH + 0.2;
  const chart = (x, y, w, h) => {
    const nums = proj.map((q) => parseMoney(q.likely));
    const peak = Math.max(1, ...nums);
    const [div, suffix] = peak >= 1e9 ? [1e9, 'B'] : peak >= 1e6 ? [1e6, 'M'] : peak >= 1e3 ? [1e3, 'K'] : [1, ''];
    const prefix = (/^[^\d]*/.exec(String(proj[0].likely)) || [''])[0].trim();
    const labels = proj.map((q) => T('value_year_n', { n: q.year }));
    const values = nums.map((n) => Math.round((n / div) * 100) / 100);
    d.text(s, x, y, w, 0.3, d.kicker(`${T('value_projection')} · ${T('value_likely')} (${prefix}${suffix})`), { color: C.teal, bold: true });
    s.addChart(d.pptx.charts.BAR, [{ name: T('value_likely'), labels: d.rtl ? [...labels].reverse() : labels, values: d.rtl ? [...values].reverse() : values }], {
      x: d.mx(x, w), y: y + 0.32, w, h: Math.max(1.2, h - 0.32), barDir: 'col', barGapWidthPct: 25, chartColors: [C.teal], showLegend: false,
      catAxisLabelFontSize: S.body, catAxisLabelColor: C.body, valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      showValue: true, dataLabelFontSize: S.body, dataLabelFontBold: true, dataLabelColor: C.ink, dataLabelFormatCode: '0.0', dataLabelPosition: 'outEnd',
    });
  };
  const table = (x, y, w, h) => {
    const rowH = Math.min(0.4, h / (proj.length + 1));
    let cols = [[T('value_year'), 1.5], [T('value_low'), 0.9], [T('value_likely'), 0.9], [T('value_high'), 0.9]];
    const sum = cols.reduce((a, c) => a + c[1], 0);
    const cells = (row) => row.map(([text, o]) => ({ text, options: o }));
    const head = cells(cols.map(([l]) => [l, { bold: true, color: C.white, fill: { color: C.teal } }]));
    const body = proj.map((p, i) => cells([[T('value_year_n', { n: p.year }), {}], [d.ltr(p.low), {}], [d.ltr(p.likely), { bold: true, color: C.teal }], [d.ltr(p.high), {}]]
      .map(([t, o]) => [t, { fill: { color: i % 2 ? C.sand3 : C.sand }, ...o }])));
    if (d.rtl) { cols = [...cols].reverse(); head.reverse(); body.forEach((r) => r.reverse()); }
    s.addTable([head, ...body], { x: d.mx(x, w), y, w, colW: cols.map((c) => (c[1] * w) / sum), rowH, fontSize: S.body, valign: 'middle', border: { type: 'none' }, margin: 0.04,
      align: d.align(), ...(d.rtl ? { rtlMode: true } : {}) });
    return rowH * (proj.length + 1);
  };
  const drivers = (x, y, w, h) => {
    const label = 0.34; const shown = val.factors.slice(0, 6); const rowH = Math.min(1.0, (h - label) / shown.length);
    d.text(s, x, y, w, label, d.kicker(T('value_how')), { color: C.teal, bold: true });
    shown.forEach((f, i) => {
      const fy = y + label + i * rowH; const nameW = Math.max(1.4, w * 0.4); const barW = Math.max(0.6, w - nameW - 0.85);
      d.text(s, x, fy, nameW, 0.34, f.name, { color: C.ink, bold: true, anchor: 'middle' });
      d.rect(s, x + nameW, fy + 0.08, barW, 0.18, C.sand2, { radius: 0.09 });
      d.rect(s, x + nameW, fy + 0.08, Math.max(0.06, (barW * f.share) / 100), 0.18, C.teal, { radius: 0.09 });
      d.text(s, x + w - 0.8, fy, 0.8, 0.34, d.ltr(`${f.share}%`), { color: C.teal, bold: true, anchor: 'middle', align: 'end' });
      if (f.formula) d.text(s, x, fy + 0.34, w, rowH - 0.36, f.formula, { color: C.muted });
    });
  };
  if (spill.length) {
    d.rect(s, CM, lTop, LW, bottom - lTop, C.sand, { radius: 0.14 });
    column(d, s, CM + 0.22, lTop + 0.1, bottom - 0.1, LW - 0.44, spill, S.body);
  } else if (proj.length) chart(CM, lTop, LW, bottom - lTop);
  // Right: the story, then the projection (chart and table beside each other when the left column is full), then the drivers.
  let y = top;
  if (val.story) {
    const h = blockH(T('value_story'), [val.story], RW - 0.44, S.lead) + 0.2;
    d.rect(s, RX, y, RW, h, C.sand, { radius: 0.14 });
    column(d, s, RX + 0.22, y + 0.08, y + h - 0.08, RW - 0.44, [[T('value_story'), [val.story]]], S.lead);
    y += h + 0.2;
  }
  if (proj.length) {
    const room = bottom - y; const th = (proj.length + 1) * 0.4;
    if (spill.length) {
      const ch = Math.min(2.2, Math.max(1.7, room - (hasF ? 1.6 : 0)));
      chart(RX, y, 2.3, ch); table(RX + 2.45, y + 0.36, RW - 2.45, ch - 0.36);
      y += ch + 0.15;
    } else {
      d.text(s, RX, y, RW, 0.3, d.kicker(T('value_projection')), { color: C.teal, bold: true });
      y += 0.36 + table(RX, y + 0.36, RW, th) + 0.2 - 0.0;
      y -= 0.0;
    }
  }
  if (hasF) drivers(RX, y, RW, bottom - y);
}

// New: the value slide, after the last domain and before the index: the total, the value per domain and the top use cases.
function valueSlide(d, m) {
  const T = m.T; const v = m.value;
  const s = d.new('value', T('value_title'));
  d.header(s, T('value_kicker'), T('value_title'));
  const top = d.lead(s, T('value_lead', { with: v.nWith, total: m.total }));
  const tiles = [[v.total.text, T('value_total'), `value-total:${v.total.amount}`], [`${v.nWith} / ${m.total}`, T('value_with')],
    [String(v.byDomain.filter((x) => x.n).length), T('value_domains')]];
  tiles.forEach(([value, label, name], i) => d.tile(s, 0.6 + i * 4.09, top, 3.95, 1.0, value, label, { valueSize: 32, name }));
  const y0 = top + 1.15; const bottom = 6.7;
  d.rect(s, 0.6, y0, 4.5, bottom - y0, C.white, { radius: 0.14, line: [C.line, 1] });
  d.text(s, 0.8, y0 + 0.1, 4.5, 0.34, T('value_per_domain'), { size: S.heading, color: C.ink, bold: true });
  const shown = v.byDomain.slice(0, 9);
  const peak = Math.max(1, ...shown.map((x) => x.amount));
  const step = Math.min(0.5, (bottom - y0 - 0.6) / Math.max(1, shown.length));
  shown.forEach((dom, i) => {
    const y = y0 + 0.55 + i * step;
    d.text(s, 0.8, y, 1.75, step, dom.name, { size: 14, color: C.ink, anchor: 'middle', name: `value-domain:${dom.amount}` });
    d.rect(s, 2.6, y + step / 2 - 0.075, 1.2, 0.15, C.sand2, { radius: 0.07 });
    if (dom.amount) d.rect(s, 2.6, y + step / 2 - 0.075, Math.max(0.06, (1.2 * dom.amount) / peak), 0.15, C.teal, { radius: 0.07 });
    d.text(s, 3.85, y, 1.15, step, dom.text, { size: 16, color: C.teal, bold: true, anchor: 'middle', align: 'end' });
  });
  let cols = [['rank', T('doc_rank'), 0.6], ['id', 'ID', 0.95], ['title', T('usecase'), 3.3], ['amount', T('value_year'), 1.3], ['status', T('value_status'), 1.38]];
  if (d.rtl) cols = [...cols].reverse();
  const head = (label) => cols.map(([k, l]) => ({ text: k === 'title' ? label : l, options: { bold: true, color: C.white, fill: { color: C.teal } } }));
  const row = (u, valued, i) => cols.map(([k]) => ({
    text: { rank: String(u.rank), id: u.id, title: u.title, domain: u.domain, amount: valued ? u.value.text : '',
      status: valued ? T(u.value.status === 'calculated' ? 'value_calculated_short' : 'value_estimated_short') : u.value.text }[k],
    options: { color: k === 'amount' ? C.teal : k === 'id' ? C.coral : C.body, bold: k === 'amount' || k === 'id', fill: { color: i % 2 ? C.sand3 : C.white } },
  }));
  const maxRows = 6;
  const topRows = v.top.slice(0, maxRows).map((u, i) => row(u, true, i));
  const rows = [head(T('value_top')), ...topRows];
  const room = maxRows - topRows.length;
  if (v.without.length && room > 1) {
    rows.push(head(T('value_without')));
    const shownWithout = v.without.slice(0, room - 1);
    shownWithout.forEach((u, i) => rows.push(row(u, false, i)));
    if (v.without.length > shownWithout.length) rows.push(cols.map(([k]) => ({ text: k === 'title' ? `+${v.without.length - shownWithout.length}` : '', options: { color: C.muted } })));
  }
  s.addTable(rows, { x: d.mx(5.3, 7.53), y: y0, w: 7.53, colW: cols.map((c) => c[2]), rowH: Math.min(0.46, (bottom - y0) / rows.length), fontSize: S.body,
    valign: 'middle', border: { type: 'none' }, margin: 0.04, align: d.align(), ...(d.rtl ? { rtlMode: true } : {}) });
  const notes = [...(v.otherCurrency.length ? [T('value_other_currency', { list: v.otherCurrency.join(', ') })] : []), T('value_note_body')];
  d.text(s, 0.6, 6.82, 12.13, 0.55, notes.join(' '), { color: C.muted, italic: true });
}

function indexSlide(d, m, chunk, page, pages) {
  const T = m.T;
  const title = T('doc_use_case_index') + (pages > 1 ? ` (${page}/${pages})` : '');
  const s = d.new('index', title, pages > 1 ? { key: page } : {});
  d.header(s, T('doc_appendix'), title);
  d.indexTable(s, chunk, d.lead(s, T('doc_index_lead', { count: m.total })));
}

function methodology(d, m) {
  const T = m.T;
  const s = d.new('methodology', T('doc_methodology'), { background: C.sand });
  d.header(s, T('doc_appendix'), T('doc_methodology'));
  d.rect(s, 0.6, 1.8, 12.13, 5.05, C.white, { radius: 0.14, line: [C.line, 1] });
  const per = 4.75 / m.methodSteps.length;
  const msize = Math.min(...m.methodSteps.map((t) => pick(t, 11.1, per - 0.06, [20, 18, 16])));
  m.methodSteps.forEach((text, i) => {
    const y = 2.0 + i * per;
    d.rect(s, 0.8, y + 0.02, 0.44, 0.44, C.teal, { oval: true });
    d.text(s, 0.8, y + 0.02, 0.44, 0.44, String(i + 1), { color: C.white, bold: true, align: 'center', anchor: 'middle' });
    d.text(s, 1.45, y, 11.1, per - 0.06, text, { size: msize, anchor: 'middle' });
  });
}

function glossary(d, m) {
  const T = m.T;
  const s = d.new('glossary', T('doc_glossary'));
  d.header(s, T('doc_appendix'), T('doc_glossary'));
  const half = Math.ceil(m.glossary.length / 2);
  [m.glossary.slice(0, half), m.glossary.slice(half)].forEach((part, col) => {
    const x = 0.6 + col * 6.16;
    d.rect(s, x, 1.8, 5.97, 5.05, C.sand, { radius: 0.14 });
    const gp = part.map(([term, body]) => [[`${term}: `, { bold: true, color: C.teal }], [body, {}]]);
    d.text(s, x + 0.24, 2.0, 5.49, 4.7, gp, { size: pick(gp, 5.49, 4.7, [18, 16, 14]), spacing: 8 });
  });
}

function foundationsSlide(d, m) {
  const T = m.T;
  const s = d.new('foundations', T('doc_foundations_title'));
  d.header(s, T('doc_next_steps'), T('doc_foundations_title'));
  const top = d.lead(s, T('doc_foundations_lead')) + 0.1;
  const rows = m.foundations.slice(0, FOUNDATION_ROWS);
  const h = Math.min(1.1, (6.9 - top - 0.1 * (rows.length - 1)) / Math.max(1, rows.length));
  rows.forEach((r, i) => {
    const y = top + i * (h + 0.1); const accent = ACCENTS[i % ACCENTS.length];
    d.rect(s, 0.6, y, 12.13, h, C.sand, { radius: 0.12 });
    d.rect(s, 0.6, y, 0.09, h, accent);
    d.text(s, 0.85, y, 0.75, h, r.id, { size: 18, color: accent, bold: true, anchor: 'middle' });
    d.text(s, 1.65, y + 0.06, 6.3, h - 0.12, [[[r.tables, { bold: true, color: C.ink }]], ...(r.joins ? [[[r.joins, { color: C.muted }]]] : [])], { anchor: 'middle' });
    const ids = r.useCaseIds.join(', ') + (r.more ? ` (+${r.more})` : '');
    d.text(s, 8.2, y + 0.06, 4.4, h - 0.12, [[[`${r.count} `, { bold: true, color: C.teal }], [T('doc_foundation_unlocks'), { color: C.muted }]], [[ids, {}]]], { anchor: 'middle' });
  });
}

function roadmap(d, m) {
  const T = m.T;
  const s = d.new('roadmap', T('doc_roadmap'));
  d.header(s, T('doc_next_steps'), T('doc_roadmap'));
  const w = 2.12;
  m.roadmap.forEach(([title, body], i) => {
    const accent = ACCENTS[i % 5]; const x = 0.6 + i * (w + 0.383);
    d.rect(s, x, 1.85, w, 3.6, C.sand, { radius: 0.14 });
    d.rect(s, x, 1.85, w, 0.09, accent);
    d.rect(s, x + 0.2, 2.1, 0.5, 0.5, accent, { oval: true });
    d.text(s, x + 0.2, 2.1, 0.5, 0.5, String(i + 1), { size: S.heading, color: C.white, bold: true, align: 'center', anchor: 'middle' });
    d.text(s, x + 0.2, 2.74, w - 0.4, 0.62, title, { size: 16, color: C.ink, bold: true });
    d.text(s, x + 0.2, 3.4, w - 0.4, 1.95, body, { size: pick(body, w - 0.4, 1.95, [16, 14]) });
    if (i < m.roadmap.length - 1) s.addShape(d.rtl ? 'leftArrow' : 'rightArrow', { x: d.mx(x + w + 0.06, 0.26), y: 3.5, w: 0.26, h: 0.3, fill: { color: C.muted }, line: { type: 'none' } });
  });
  d.rect(s, 0.6, 5.6, 12.13, 1.15, C.ice, { radius: 0.12 });
  d.rect(s, 0.6, 5.6, 0.1, 1.15, C.teal);
  d.text(s, 0.95, 5.68, 11.55, 1.0, T('doc_closing_body'), { size: pick(T('doc_closing_body'), 11.55, 1.0, [20, 18, 16]), color: C.ink, anchor: 'middle' });
}

function disclaimerSlide(d, m) {
  const s = d.new('disclaimer', m.disclaimerTitle, { background: C.sand });
  d.header(s, DOC_BRAND.wordmark, m.disclaimerTitle);
  d.rect(s, 0.6, 1.8, 12.13, 4.95, C.white, { radius: 0.14, line: [C.line, 1] });
  const per = 4.75 / m.disclaimer.length;
  const dsize = Math.min(...m.disclaimer.map((t) => pick(t, 10.9, per - 0.06, [20, 18, 16, 14])));
  m.disclaimer.forEach((text, i) => {
    const y = 1.9 + i * per;
    d.rect(s, 0.85, y + (per - 0.5) / 2, 0.5, 0.5, C.teal, { radius: 0.1 });
    d.text(s, 0.85, y + (per - 0.5) / 2, 0.5, 0.5, String(i + 1), { size: S.lead, color: C.white, bold: true, align: 'center', anchor: 'middle' });
    d.text(s, 1.6, y, 10.9, per - 0.06, text, { size: dsize, color: C.body2, anchor: 'middle' });
  });
}

function closing(d, m) {
  const T = m.T;
  const s = d.new('closing', T('doc_closing_title'), { dark: true });
  for (const [x, y, size, alpha] of [[0.15, 3.9, 3.4, 0.08], [0.9, 4.75, 2.6, 0.08], [10.0, 0.15, 3.1, 0.07]]) d.rect(s, x, y, size, size, C.white, { oval: true, alpha });
  d.text(s, 1.5, 1.6, 10.33, 0.34, d.kicker(T('doc_next_steps')), { color: C.mint2, bold: true, align: 'center' });
  d.text(s, 1.5, 2.05, 10.33, 1.2, T('doc_closing_title'), { size: S.hero, color: C.white, bold: true, align: 'center' });
  d.text(s, 1.5, 3.3, 10.33, 0.7, m.businessName, { size: S.title, color: C.gold, bold: true, align: 'center' });
  d.text(s, 1.5, 4.15, 10.33, 0.4, m.closingSummary, { size: S.lead, color: C.mint, align: 'center' });
  d.wordmark(s, 5.3, 4.95, 0.42, true);
}

// _build_presentation_deck: the slide order of the agent deck, plus the value slide after the domains.
export function buildAgentDeck(m) {
  const d = new Deck(m);
  const chosen = new Set(m.top.map((v) => v.uc));
  const inDeck = (v) => m.total <= DECK_ALL || chosen.has(v.uc) || String(v.uc?.elite_status ?? '').toUpperCase() === 'DOMAIN_COVERAGE_PICK'
    || String(v.uc?.best_of_best ?? '').trim().toUpperCase() === 'Y';
  const deckCount = m.ranked.filter(inDeck).length;
  cover(d, m); contents(d, m); summary(d, m); guide(d, m); portfolio(d, m); topIndex(d, m, deckCount);
  for (const dom of m.domains) {
    domainSlide(d, m, dom);
    for (const v of dom.useCases.filter(inDeck)) {
      const spill = useCaseCard(d, m, v);
      if (v.value.amount !== null) useCaseStory(d, m, v, spill); else if (spill.length) useCaseValue(d, m, v, spill);
    }
  }
  valueSlide(d, m);
  const pages = Math.max(1, Math.ceil(m.ranked.length / INDEX_ROWS));
  const per = Math.max(1, Math.ceil(m.ranked.length / pages));
  for (let p = 0; p < pages; p += 1) indexSlide(d, m, m.ranked.slice(p * per, (p + 1) * per), p + 1, pages);
  methodology(d, m); glossary(d, m);
  if (m.foundations.length) foundationsSlide(d, m);
  roadmap(d, m); disclaimerSlide(d, m); closing(d, m);
  return d;
}

// The slides of the deck with a title each, for the in-App View.
export const agentPptxSlides = (args) => buildAgentDeck(args.model || buildAgentModel(args)).slides;

// The PPTX file. In the browser a blob is the one output pptxgenjs compresses; Node has no zip blob.
export async function buildAgentPptx(args) {
  const { pptx } = buildAgentDeck(args.model || buildAgentModel(args));
  if (typeof window !== 'undefined') return new Uint8Array(await (await pptx.exportPresentation({ compression: true })).arrayBuffer());
  return new Uint8Array(await pptx.write({ outputType: 'uint8array' }));
}
