// C25 (REQ-559 part 2): the agent's original presentation deck plus value, with pptxgenjs.
// A port of the agent's _build_presentation_deck and its _deck_* slides (6a7361a39, app/agent/agent/dbx_inspire_ai_agent.ipynb),
// reading the shared agent document model (agentModel.js). Same slides and order; each use case slide adds the value a year with
// its basis and estimate note, and one value slide sits after the last domain and before the index.
// Every slide's first shape is named slide:<kind>[:<key>] so the slide sequence can be read back from the file.
import PptxGenJS from 'pptxgenjs';
import { buildAgentModel, agentOutline, DOC_COLORS as C, DOC_INDEX_COLUMNS, DOC_QUALITY_ORDER, DOC_VALUE_LEFT, DOC_BRAND, qualityColor } from './agentModel.js';

const W = 13.333;
const S = { numeral: 60, hero: 40, display: 32, title: 28, card_title: 22, heading: 16, lead: 14, body: 12 }; // _DOC_TYPE_SCALE, 12 pt floor
const INDEX_ROWS = 12; // _DOC_PPTX_INDEX_ROWS
const FOUNDATION_ROWS = 6; // _DOC_PPTX_FOUNDATION_ROWS
const DECK_ALL = 15; // _DOC_TOP_LIMIT["deck_all"]: up to this many use cases, every one gets its slides
const ACCENTS = [C.teal, C.coral, C.gold, C.teal_mid, C.green, C.amber];
const MODES = [['Good', 'value_mode_good', 'doc_mode_good_body'], ['High', 'value_mode_high', 'doc_mode_high_body'], ['Ultra High', 'value_mode_ultra_high', 'doc_mode_ultra_body']];
const chipW = (label) => Math.min(4.2, 0.4 + String(label).length * 0.095);

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
  text(s, x, y, w, h, paragraphs, { size = S.body, color = C.body, bold = false, italic = false, align = 'start', anchor = 'top', fit = true, spacing = 4, name } = {}) {
    const paras = (Array.isArray(paragraphs) ? paragraphs : [paragraphs]).map((p) => (Array.isArray(p) ? p : [[p, {}]]));
    const runs = [];
    paras.forEach((p, i) => p.forEach(([t, o = {}], j) => runs.push({
      text: String(t ?? ''), options: { bold: o.bold ?? bold, italic: o.italic ?? italic, color: o.color || color, ...(j === p.length - 1 && i < paras.length - 1 ? { breakLine: true } : {}) },
    })));
    s.addText(runs, { x: this.mx(x, w), y, w, h, fontSize: size, color, align: this.align(align), valign: anchor, margin: 0.04, paraSpaceAfter: paras.length > 1 ? spacing : 0,
      ...(fit ? { fit: 'shrink' } : {}), ...(this.rtl ? { rtlMode: true } : {}), ...(name ? { objectName: name } : {}) });
  }
  wordmark(s, x, y, h, light) {
    this.rect(s, x, y + h / 2 - 0.07, 0.14, 0.14, C.gold, { oval: true });
    this.text(s, x + 0.22, y, 4.0, h, [[[`${DOC_BRAND.maker} `, { color: light ? C.mint2 : C.muted }], [DOC_BRAND.product, { color: light ? C.white : C.teal, bold: true }]]], { size: S.heading, anchor: 'middle', fit: false });
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
  tile(s, x, y, w, h, value, label, { fill = C.sand, valueSize = S.heading, name } = {}) {
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
    const rowH = Math.max(0.3, Math.min(0.4, (bottom - y - 0.42) / Math.max(1, rows.length)));
    s.addTable([head, ...rows], { x: 0.6, y, w: 12.13, colW: cols.map((c) => c[2]), rowH: [0.42, ...rows.map(() => rowH)], fontSize: S.body, valign: 'middle',
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
  const h = Math.min(1.2, (5.1 - 0.16 * (rows - 1)) / Math.max(1, rows));
  outline.forEach(([, title, subtitle], i) => {
    const x = 0.6 + (i % 2) * 6.19; const y = 1.8 + Math.floor(i / 2) * (h + 0.16);
    d.rect(s, x, y, 5.94, h, C.sand, { radius: 0.14 });
    d.rect(s, x + 0.2, y + (h - 0.66) / 2, 0.66, 0.66, ACCENTS[i % ACCENTS.length], { radius: 0.14 });
    d.text(s, x + 0.2, y + (h - 0.66) / 2, 0.66, 0.66, String(i + 1).padStart(2, '0'), { size: S.heading, color: C.white, bold: true, align: 'center', anchor: 'middle' });
    d.text(s, x + 1.05, y + 0.08, 4.7, h * 0.5, title, { size: S.heading, color: C.ink, bold: true, anchor: 'middle' });
    d.text(s, x + 1.05, y + h * 0.52, 4.7, h * 0.44, subtitle, { color: C.muted });
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
  d.text(s, 0.95, 2.0, 7.75, 4.55, first, { size: 15 });
  m.headline.forEach(([value, label], i) => d.tile(s, 9.2, 1.8 + i * 1.26, 3.53, 1.13, value, label, { valueSize: S.title }));
  if (!rest.length) return;
  const more = d.new('summary_more', `${T('pdf_exec_summary')} (${T('doc_continued')})`);
  d.header(more, T('doc_exec_kicker'), `${T('pdf_exec_summary')} (${T('doc_continued')})`);
  const half = Math.ceil(rest.length / 2);
  [rest.slice(0, half), rest.slice(half)].forEach((chunk, col) => {
    if (!chunk.length) return;
    const x = 0.6 + col * 6.19;
    d.rect(more, x, 1.8, 5.94, 4.95, C.white, { radius: 0.14, line: [C.line, 1] });
    d.rect(more, x, 1.8, 5.94, 0.09, col ? C.coral : C.teal);
    d.text(more, x + 0.3, 2.1, 5.34, 4.45, chunk, { size: S.lead });
  });
}

function guide(d, m) {
  const T = m.T;
  const s = d.new('guide', T('doc_how_to_read'), { background: C.sand });
  d.header(s, T('doc_guide_kicker'), T('doc_how_to_read'));
  d.text(s, 0.6, 1.62, 12.13, 0.5, T(m.guideLeadKey), {});
  const top = 2.15; const cardH = 2.35;
  [[0.6, T('doc_inspire_score_title'), T('doc_inspire_score_body')], [6.79, T('doc_quality_tiers_title'), T('doc_quality_tiers_body')]].forEach(([x, title, body]) => {
    d.rect(s, x, top, 5.94, cardH, C.white, { radius: 0.14, line: [C.line, 1] });
    d.text(s, x + 0.25, top + 0.12, 5.44, 0.36, title, { size: S.heading, color: C.ink, bold: true });
    d.text(s, x + 0.25, top + 0.5, 5.44, cardH - 1.0, body, {});
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
  d.text(s, 0.85, low + 0.5, 5.44, h - 0.6, MODES.map(([mode, nameKey, bodyKey]) => [
    [`${T(nameKey)}${mode === m.mode ? ` · ${T('doc_this_catalog')}` : ''}: `, { bold: true, color: mode === m.mode ? C.gold_dark : C.teal }], [T(bodyKey), {}]]), {});
  d.rect(s, 6.79, low, 5.94, h, C.white, { radius: 0.14, line: [C.line, 1] });
  d.text(s, 7.04, low + 0.1, 5.44, 0.36, T('doc_elite_score_title'), { size: S.heading, color: C.ink, bold: true });
  d.text(s, 7.04, low + 0.5, 5.44, h - 0.6, [[[T('doc_elite_score_body'), {}]], [[`${T('doc_coverage_title')}: `, { bold: true, color: C.coral }], [T('doc_coverage_body'), {}]]], {});
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
  const step = Math.min(0.4, 4.1 / Math.max(1, shown.length + (m.domains.length > shown.length ? 1 : 0)));
  shown.forEach((dom, i) => {
    const y = 2.45 + i * step;
    d.text(s, 0.85, y, 2.45, step, dom.name, { color: C.ink, anchor: 'middle' });
    d.rect(s, 3.4, y + step / 2 - 0.075, 3.25, 0.15, C.sand2, { radius: 0.07 });
    d.rect(s, 3.4, y + step / 2 - 0.075, Math.max(0.08, (3.25 * dom.useCases.length) / peak), 0.15, C.teal, { radius: 0.07 });
    d.text(s, 6.75, y, 0.7, step, String(dom.useCases.length), { color: C.teal, bold: true, anchor: 'middle', align: 'end' });
  });
  if (m.domains.length > shown.length) d.text(s, 0.85, 2.45 + shown.length * step, 6.5, step, `+${m.domains.length - shown.length} ${T('doc_domains')}`, { color: C.muted, anchor: 'middle' });
  d.rect(s, 7.85, 1.8, 4.88, 4.95, C.sand, { radius: 0.14 });
  d.text(s, 8.1, 1.95, 4.4, 0.36, T('doc_quality_distribution'), { size: S.heading, color: C.ink, bold: true });
  const total = Math.max(1, m.qualityRows.reduce((a, r) => a + r[1], 0));
  let x = 8.1;
  for (const [label, n] of m.qualityRows) { const w = (4.38 * n) / total; d.rect(s, x, 2.5, w, 0.3, qualityColor(label)); x += w; }
  m.qualityRows.slice(0, 8).forEach(([label, n, name], i) => {
    const y = 3.0 + i * 0.4;
    d.rect(s, 8.12, y + 0.11, 0.16, 0.16, qualityColor(label), { oval: true });
    d.text(s, 8.4, y, 3.3, 0.38, name, { color: C.ink, anchor: 'middle' });
    d.text(s, 11.75, y, 0.75, 0.38, String(n), { color: C.teal, bold: true, anchor: 'middle', align: 'end' });
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
  d.text(s, 0.6, 3.2, 7.3, 1.45, dom.overview, {});
  d.text(s, 8.13, 2.82, 4.6, 0.32, T('doc_what_it_covers'), { size: S.heading, color: C.teal, bold: true });
  let x = 8.13; let y = 3.22;
  for (const [name, count] of dom.subdomains.slice(0, 12)) {
    const label = `${name} ${count}`; const w = chipW(label);
    if (x + w > 12.73) { x = 8.13; y += 0.42; }
    if (y > 4.4) break;
    d.chip(s, x, y, w, label, C.sand2, C.teal);
    x += w + 0.08;
  }
  d.text(s, 0.6, 4.78, 12.13, 0.32, T('doc_top_opportunities'), { size: S.heading, color: C.ink, bold: true });
  d.indexTable(s, dom.top, 5.16);
}

function cardHead(d, s, v, T) {
  const accent = { elite: C.gold, coverage: C.coral }[v.kind] || C.teal;
  d.rect(s, 0.6, 0.5, 0.82, 0.82, accent, { radius: 0.14 });
  d.text(s, 0.6, 0.5, 0.82, 0.82, String(v.rank), { size: S.heading, color: v.kind === 'elite' ? C.gold_ink : C.white, bold: true, align: 'center', anchor: 'middle' });
  d.text(s, 1.6, 0.45, 8.0, 0.3, d.kicker([v.id, v.domain, v.subdomain].filter(Boolean).join(' · ')), { color: C.coral, bold: true });
  const tw = v.notebook ? 8.4 : 11.13; // the notebook button sits at the end of the head, as a link-style button
  d.text(s, 1.6, 0.75, tw, 0.6, v.title, { size: S.card_title, color: C.ink, bold: true });
  if (v.notebook) {
    d.rect(s, 10.13, 0.78, 2.6, 0.42, C.night, { radius: 0.1 });
    d.text(s, 10.18, 0.78, 2.5, 0.42, `${T('doc_open_notebook')} \u2197`, { color: C.mint, bold: true, align: 'center', anchor: 'middle' });
  }
  if (v.subtitle) d.text(s, 1.6, 1.33, tw, 0.32, v.subtitle, { color: C.muted });
  d.rect(s, 0.6, 1.7, 12.13, 0.05, C.teal);
}

// New: the value of the use case a year, its basis and, for an estimate, the estimate note (on both use case slides).
function valueBand(d, s, m, v, top) {
  const T = m.T; const val = v.value;
  const paras = [[[`${T('value_at_stake')}: `, { bold: true, color: C.teal_dark }], [val.text, { bold: true, color: val.amount === null ? C.muted : C.teal }]]];
  if (val.amount !== null) {
    paras.push([[`${T('value_basis')}: `, { bold: true, color: C.teal_dark }], [val.basis, {}]]);
    if (val.note) paras.push([[`${T('value_note')}: `, { bold: true, color: C.teal_dark }], [val.note, {}]]);
    if (val.story) paras.push([[`${T('value_story')}: `, { bold: true, color: C.teal_dark }], [val.story, {}]]);
  }
  const h = 0.16 + 0.24 * paras.length + (val.story ? 0.2 : 0);
  d.rect(s, 0.6, top, 12.13, h, C.ice, { radius: 0.08, line: [C.mint2, 0.75] });
  d.rect(s, 0.6, top, 0.07, h, C.teal);
  d.text(s, 0.8, top + 0.04, 11.8, h - 0.08, paras, { anchor: 'middle', spacing: 0 });
  return top + h + 0.1;
}

function noteBand(d, s, top, accent, paras) {
  d.rect(s, 0.6, top, 12.13, 0.4, C.note, { radius: 0.08, line: [C.note_line, 0.75] });
  d.rect(s, 0.6, top, 0.07, 0.4, accent);
  d.text(s, 0.8, top, 11.8, 0.4, paras, { color: C.note_ink, anchor: 'middle' });
  return top + 0.48;
}

function useCaseCard(d, m, v) {
  const T = m.T;
  const s = d.new('uc_card', v.title, { key: v.id });
  cardHead(d, s, v, T);
  const w = (12.13 - 0.1 * (v.metrics.length - 1)) / Math.max(1, v.metrics.length);
  v.metrics.forEach(([, label, value], i) => d.tile(s, 0.6 + i * (w + 0.1), 1.84, w, 1.0, d.ltr(value), label));
  let top = 2.94;
  if (v.meetsBar) top = noteBand(d, s, top, C.green, [[[v.meetsBar, { bold: true, color: C.teal_dark }]]]);
  if (v.star) top = noteBand(d, s, top, C.gold, [[[v.star, { bold: true, color: C.note_dark }]]]);
  if (v.coverage) top = noteBand(d, s, top, C.coral, [[[`${v.coverage[0]}. `, { bold: true, color: C.note_dark }], [`${v.coverage[1]}: ${v.coverage[2]}`, {}]]]);
  top = valueBand(d, s, m, v, top);
  const bottom = 6.95; const room = bottom - top;
  const per = room / v.narrative.length;
  v.narrative.forEach(([, label, value], i) => {
    const y = top + i * per;
    d.text(s, 0.6, y, 6.6, 0.26, d.kicker(label), { color: C.teal, bold: true, fit: false });
    d.text(s, 0.6, y + 0.27, 6.6, per - 0.31, value, {});
  });
  d.rect(s, 7.4, top, 5.33, room, C.sand, { radius: 0.14 });
  d.text(s, 7.55, top + 0.08, 5.03, room - 0.16, v.facts.map(([, label, value]) => [[`${label}: `, { bold: true, color: C.teal }], [value, { color: C.ink }]]), { spacing: 0 });
}

function useCaseValue(d, m, v) {
  const s = d.new('uc_value', v.title, { key: v.id });
  cardHead(d, s, v, m.T);
  const top = valueBand(d, s, m, v, 1.86);
  const left = v.valueFacts.filter((f) => DOC_VALUE_LEFT.includes(f[0]));
  const right = v.valueFacts.filter((f) => !DOC_VALUE_LEFT.includes(f[0]));
  for (const [x, entries] of [[0.6, left], [6.75, right]]) {
    if (!entries.length) continue;
    const weights = entries.map(([, , items]) => 1 + items.length * 0.6);
    const total = weights.reduce((a, b) => a + b, 0);
    const room = 6.95 - top - 0.12 * (entries.length - 1);
    let y = top;
    entries.forEach(([, label, items], i) => {
      const h = (room * weights[i]) / total;
      d.rect(s, x, y, 5.98, h, C.sand, { radius: 0.12 });
      d.text(s, x + 0.18, y + 0.06, 5.6, 0.28, d.kicker(label), { color: C.teal, bold: true, fit: false });
      d.text(s, x + 0.18, y + 0.36, 5.6, Math.max(0.25, h - 0.42), items.map((item) => `• ${item}`), {});
      y += h + 0.12;
    });
  }
}

// REQ-561: the value story slide that follows a valued use case: the amount with its basis and note, the story, where the value comes from
// (factors with their share), the formula of each factor in plain words and the projection.
function useCaseStory(d, m, v) {
  const T = m.T; const val = v.value;
  const s = d.new('uc_story', v.title, { key: v.id });
  cardHead(d, s, v, T);
  const paras = [[[`${T('value_at_stake')}: `, { bold: true, color: C.teal_dark }], [val.text, { bold: true, color: C.teal }]], [[`${T('value_basis')}: `, { bold: true, color: C.teal_dark }], [val.basis, {}]]];
  if (val.note) paras.push([[`${T('value_note')}: `, { bold: true, color: C.teal_dark }], [val.note, {}]]);
  const bandH = 0.16 + 0.24 * paras.length;
  d.rect(s, 0.6, 1.86, 12.13, bandH, C.ice, { radius: 0.08, line: [C.mint2, 0.75] });
  d.rect(s, 0.6, 1.86, 0.07, bandH, C.teal);
  d.text(s, 0.8, 1.9, 11.8, bandH - 0.08, paras, { anchor: 'middle', spacing: 0 });
  const top = 1.86 + bandH + 0.12; const bottom = 6.95; const room = bottom - top; const COLW = 5.98;
  const box = (x, y, h, label, body) => {
    d.rect(s, x, y, COLW, h, C.sand, { radius: 0.12 });
    d.text(s, x + 0.18, y + 0.06, COLW - 0.36, 0.28, d.kicker(label), { color: C.teal, bold: true, fit: false });
    if (body) d.text(s, x + 0.18, y + 0.36, COLW - 0.36, Math.max(0.25, h - 0.42), body, {});
  };
  // Left: the story, then where the value comes from.
  const storyH = val.story ? Math.min(room * 0.45, 0.6 + 0.2 * Math.ceil(val.story.length / 70)) : 0;
  if (val.story) box(0.6, top, storyH, T('value_story'), val.story);
  if (val.factors.length) {
    const y = top + (storyH ? storyH + 0.12 : 0); const h = bottom - y;
    box(0.6, y, h, T('value_source'));
    const shown = val.factors.slice(0, 8); const step = Math.min(0.5, (h - 0.5) / shown.length);
    shown.forEach((f, i) => {
      const fy = y + 0.42 + i * step;
      d.text(s, 0.78, fy, 2.3, step, f.name, { color: C.ink, anchor: 'middle' });
      d.rect(s, 3.15, fy + step / 2 - 0.075, 1.9, 0.15, C.sand2, { radius: 0.07 });
      d.rect(s, 3.15, fy + step / 2 - 0.075, Math.max(0.06, (1.9 * f.share) / 100), 0.15, C.teal, { radius: 0.07 });
      d.text(s, 5.1, fy, 1.3, step, d.ltr(`${f.share}%`), { color: C.teal, bold: true, anchor: 'middle', align: 'end' });
    });
  }
  // Right: the projection, then the formula of each factor.
  const lines = val.factors.filter((f) => f.formula);
  const projH = val.projection.length ? 0.55 + 0.3 * (val.projection.length + 1) : 0;
  if (projH) {
    box(6.75, top, projH, T('value_projection'));
    let cols = [[T('value_year'), 1.3], [T('value_low'), 1.5], [T('value_likely'), 1.6], [T('value_high'), 1.3]];
    const cells = (row) => row.map(([text, o]) => ({ text, options: o }));
    const head = cells(cols.map(([l]) => [l, { bold: true, color: C.white, fill: { color: C.teal } }]));
    const body = val.projection.map((y, i) => cells([[T('value_year_n', { n: y.year }), {}], [d.ltr(y.low), {}], [d.ltr(y.likely), { bold: true, color: C.teal }], [d.ltr(y.high), {}]]
      .map(([t, o]) => [t, { fill: { color: i % 2 ? C.sand3 : C.white }, ...o }])));
    if (d.rtl) { cols = [...cols].reverse(); head.reverse(); body.forEach((r) => r.reverse()); }
    s.addTable([head, ...body], { x: d.mx(6.93, 5.6), y: top + 0.4, w: 5.6, colW: cols.map((c) => c[1] * (5.6 / 5.7)), rowH: 0.3, fontSize: S.body, valign: 'middle', border: { type: 'none' }, margin: 0.04,
      align: d.align(), ...(d.rtl ? { rtlMode: true } : {}) });
  }
  if (lines.length) {
    const y = top + (projH ? projH + 0.12 : 0);
    box(6.75, y, bottom - y, T('value_how'), lines.map((f) => [[`${f.name}: `, { bold: true, color: C.teal }], [f.formula, {}]]));
  }
}

// New: the value slide, after the last domain and before the index: the total, the value per domain and the top use cases.
function valueSlide(d, m) {
  const T = m.T; const v = m.value;
  const s = d.new('value', T('value_title'));
  d.header(s, T('value_kicker'), T('value_title'));
  const top = d.lead(s, T('value_lead', { with: v.nWith, total: m.total }));
  const tiles = [[v.total.text, T('value_total'), `value-total:${v.total.amount}`], [`${v.nWith} / ${m.total}`, T('value_with')],
    [String(v.byDomain.filter((x) => x.n).length), T('value_domains')]];
  tiles.forEach(([value, label, name], i) => d.tile(s, 0.6 + i * 4.09, top, 3.95, 1.0, value, label, { valueSize: S.title, name }));
  const y0 = top + 1.15; const bottom = 6.7;
  d.rect(s, 0.6, y0, 4.9, bottom - y0, C.white, { radius: 0.14, line: [C.line, 1] });
  d.text(s, 0.8, y0 + 0.1, 4.5, 0.34, T('value_per_domain'), { size: S.heading, color: C.ink, bold: true });
  const shown = v.byDomain.slice(0, 9);
  const peak = Math.max(1, ...shown.map((x) => x.amount));
  const step = Math.min(0.55, (bottom - y0 - 0.6) / Math.max(1, shown.length));
  shown.forEach((dom, i) => {
    const y = y0 + 0.55 + i * step;
    d.text(s, 0.8, y, 1.9, step, dom.name, { color: C.ink, anchor: 'middle', name: `value-domain:${dom.amount}` });
    d.rect(s, 2.75, y + step / 2 - 0.075, 1.5, 0.15, C.sand2, { radius: 0.07 });
    if (dom.amount) d.rect(s, 2.75, y + step / 2 - 0.075, Math.max(0.06, (1.5 * dom.amount) / peak), 0.15, C.teal, { radius: 0.07 });
    d.text(s, 4.3, y, 1.1, step, dom.text, { color: C.teal, bold: true, anchor: 'middle', align: 'end' });
  });
  let cols = [['rank', T('doc_rank'), 0.5], ['id', 'ID', 0.9], ['title', T('usecase'), 2.2], ['domain', T('domain'), 1.15], ['amount', T('value_year'), 1.0], ['status', T('value_status'), 1.33]];
  if (d.rtl) cols = [...cols].reverse();
  const head = (label) => cols.map(([k, l]) => ({ text: k === 'title' ? label : l, options: { bold: true, color: C.white, fill: { color: C.teal } } }));
  const row = (u, valued, i) => cols.map(([k]) => ({
    text: { rank: String(u.rank), id: u.id, title: u.title, domain: u.domain, amount: valued ? u.value.text : '',
      status: valued ? T(u.value.status === 'calculated' ? 'value_calculated_short' : 'value_estimated_short') : u.value.text }[k],
    options: { color: k === 'amount' ? C.teal : k === 'id' ? C.coral : C.body, bold: k === 'amount' || k === 'id', fill: { color: i % 2 ? C.sand3 : C.white } },
  }));
  const maxRows = 11;
  const topRows = v.top.slice(0, maxRows).map((u, i) => row(u, true, i));
  const rows = [head(T('value_top')), ...topRows];
  const room = maxRows - topRows.length;
  if (v.without.length && room > 1) {
    rows.push(head(T('value_without')));
    const shownWithout = v.without.slice(0, room - 1);
    shownWithout.forEach((u, i) => rows.push(row(u, false, i)));
    if (v.without.length > shownWithout.length) rows.push(cols.map(([k]) => ({ text: k === 'title' ? `+${v.without.length - shownWithout.length}` : '', options: { color: C.muted } })));
  }
  s.addTable(rows, { x: d.mx(5.65, 7.08), y: y0, w: 7.08, colW: cols.map((c) => c[2]), rowH: Math.min(0.4, (bottom - y0) / rows.length), fontSize: S.body,
    valign: 'middle', border: { type: 'none' }, margin: 0.04, align: d.align(), ...(d.rtl ? { rtlMode: true } : {}) });
  const notes = [...(v.otherCurrency.length ? [T('value_other_currency', { list: v.otherCurrency.join(', ') })] : []), T('value_note_body')];
  d.text(s, 0.6, 6.78, 12.13, 0.5, notes.join(' '), { color: C.muted, italic: true });
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
  m.methodSteps.forEach((text, i) => {
    const y = 2.0 + i * per;
    d.rect(s, 0.8, y + 0.02, 0.44, 0.44, C.teal, { oval: true });
    d.text(s, 0.8, y + 0.02, 0.44, 0.44, String(i + 1), { color: C.white, bold: true, align: 'center', anchor: 'middle', fit: false });
    d.text(s, 1.45, y, 11.1, per - 0.06, text, { size: S.lead });
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
    d.text(s, x + 0.24, 2.0, 5.49, 4.7, part.map(([term, body]) => [[`${term}: `, { bold: true, color: C.teal }], [body, {}]]), { size: S.lead });
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
    d.text(s, 0.85, y, 0.75, h, r.id, { size: S.heading, color: accent, bold: true, anchor: 'middle' });
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
    d.text(s, x + 0.2, 2.1, 0.5, 0.5, String(i + 1), { size: S.heading, color: C.white, bold: true, align: 'center', anchor: 'middle', fit: false });
    d.text(s, x + 0.2, 2.74, w - 0.4, 0.62, title, { size: S.lead, color: C.ink, bold: true });
    d.text(s, x + 0.2, 3.4, w - 0.4, 1.95, body, {});
    if (i < m.roadmap.length - 1) s.addShape(d.rtl ? 'leftArrow' : 'rightArrow', { x: d.mx(x + w + 0.06, 0.26), y: 3.5, w: 0.26, h: 0.3, fill: { color: C.muted }, line: { type: 'none' } });
  });
  d.rect(s, 0.6, 5.6, 12.13, 1.15, C.ice, { radius: 0.12 });
  d.rect(s, 0.6, 5.6, 0.1, 1.15, C.teal);
  d.text(s, 0.95, 5.68, 11.55, 1.0, T('doc_closing_body'), { size: S.lead, color: C.ink, anchor: 'middle' });
}

function disclaimerSlide(d, m) {
  const s = d.new('disclaimer', m.disclaimerTitle, { background: C.sand });
  d.header(s, DOC_BRAND.wordmark, m.disclaimerTitle);
  d.rect(s, 0.6, 1.8, 12.13, 4.95, C.white, { radius: 0.14, line: [C.line, 1] });
  const per = 4.75 / m.disclaimer.length;
  m.disclaimer.forEach((text, i) => {
    const y = 1.9 + i * per;
    d.rect(s, 0.85, y + (per - 0.5) / 2, 0.5, 0.5, C.teal, { radius: 0.1 });
    d.text(s, 0.85, y + (per - 0.5) / 2, 0.5, 0.5, String(i + 1), { size: S.lead, color: C.white, bold: true, align: 'center', anchor: 'middle', fit: false });
    d.text(s, 1.6, y, 10.9, per - 0.06, text, { color: C.body2, anchor: 'middle' });
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
    for (const v of dom.useCases.filter(inDeck)) { useCaseCard(d, m, v); if (v.valueFacts.length) useCaseValue(d, m, v); if (v.value.amount !== null) useCaseStory(d, m, v); }
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
