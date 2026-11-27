// C24 (RC7-B-11): the Word brief. The same content as the PDF brief (cover, executive summary, a section per use case) written as a .docx.
// A .docx is a zip of a few XML parts; JSZip (already installed under pptxgenjs, now a direct dependency) writes the zip, so there is no
// separate Word library. Text runs through the same labels as the other documents, so a second language prints translated.
import JSZip from 'jszip';
import { moneyText } from '../valueWizard.js';
import { LB, withLabels } from './docLabels.js';
import { extraParts, partLines } from './docModel.js';
import { DOC_COLORS as K, qualityColor, AGENT_EN } from './agentModel.js';
import { chartTypesFor, ucChartSvg, portfolioChartSvg } from './designs/ucCharts.js';
import { execSummaryParas, purposeParas, domainsListOf, storyPick } from './storyParts.js';

const has = (m, id) => m.blocks.includes(id);
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c, fallback) => (/^#?[0-9a-f]{6}$/i.test(String(c)) ? String(c).replace('#', '').toUpperCase() : fallback);

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const NS_DRAW = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const docRels = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${Array.from({ length: n }, (_, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart${i + 1}.png"/>`).join('')}</Relationships>`;

const W = 9638; // text width in twips on A4 with 2 cm margins
const GREY = '6B7280';
const stylesXml = (face, accent, ink) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>`
  + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(face)}" w:hAnsi="${esc(face)}" w:cs="${esc(face)}"/><w:color w:val="${ink}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>'
  + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="120" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="80"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="${GREY}"/><w:sz w:val="28"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="${accent}"/></w:pBdr><w:spacing w:before="0" w:after="160" w:line="240" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="40"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="26"/></w:rPr></w:style>`
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + `<w:style w:type="table" w:styleId="BriefTable"><w:name w:val="Brief Table"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/></w:tblBorders><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${accent}"/></w:tcPr></w:tblStylePr></w:style></w:styles>`;

const TEAL = K.teal; const DARK = K.teal_dark;
const DOMAIN_FILLS = [K.teal, K.coral, K.gold_dark, K.teal_mid, K.green, K.wine, '2E6F9E', '6B4E9B'];
const chartH = (u, i) => ((u.value ? UC_CHART_H : UC_CHART_H_NO_VALUE)[i] ?? 190);
const IN = 914400; const PAGE_IN = 6.5; const UC_CHART_IN = PAGE_IN; const UC_CHART_H = [495, 190]; const UC_CHART_H_NO_VALUE = [570, 390]; // C29: the second chart starts page 2 (a use case is two pages). Measured on the real LibreOffice render (c29PageFill2): page 1 is the head plus the tall first chart, page 2 the short second chart plus all the words; a use case with no value band or projection has a taller first chart and a shorter second one (its head is smaller, its words are the same).
const bytesOf = (r) => (r && r.bytes ? r.bytes : r);
const dims = (svg, w, h) => { const m = /<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/.exec(svg); return m ? { w: Number(m[1]), h: Number(m[2]) } : { w, h }; };
const fmt1 = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v).toFixed(1) : '');

// views: the agent use case views (buildAgentModel(...).ranked), which carry the scores the portfolio charts plot.
export async function buildDocx(m, theme = {}, { chartPng, views } = {}) {
  const accent = TEAL;
  const ink = '374151';
  const face = String(theme.font || 'Calibri').split(',')[0].replace(/['"]/g, '').trim() || 'Calibri';
  const rtl = !!m.rtl;

  // Pictures first (the rasterizer is async, the XML below is built in one synchronous pass).
  const images = []; // { name, bytes }
  const pics = new Map(); // key -> { rid, n, w, h } in inches
  const addChart = async (key, svg, fallback, inches = PAGE_IN) => {
    if (!chartPng || !svg) return;
    try {
      const bytes = bytesOf(await chartPng(svg));
      if (!bytes || !bytes.length) return;
      const d = dims(svg, fallback.w, fallback.h);
      images.push({ name: `chart${images.length + 1}.png`, bytes });
      pics.set(key, { rid: `rIdImg${images.length}`, n: images.length, w: inches, h: (inches * d.h) / d.w });
    } catch { /* a chart that cannot be drawn is left out; the text stays */ }
  };
  // C28 (REQ-572): the person's logo as a PNG (made from their file by generateDocs) on the cover.
  if (m.logo?.png?.bytes?.length) {
    let lw = Math.min(1.8, m.logo.png.w / 96 || 1.8); let lh = (lw * m.logo.png.h) / (m.logo.png.w || 1);
    if (lh > 1) { lw /= lh; lh = 1; }
    images.push({ name: `chart${images.length + 1}.png`, bytes: m.logo.png.bytes });
    pics.set('logo', { rid: `rIdImg${images.length}`, n: images.length, w: lw, h: lh });
  }
  const ucTypes = new Map();
  const portfolioTypes = ['domain-value', 'matrix'];
  for (const [i, t] of portfolioTypes.entries()) await addChart(`portfolio${i}`, portfolioChartSvg(t, views && views.length ? views : m.useCases, { w: 560, h: 290 }), { w: 560, h: 290 });
  for (const u of m.useCases) {
    const types = (chartTypesFor(u) || []).slice(0, 2); ucTypes.set(u.id, types);
    for (const [i, t] of types.entries()) await addChart(`${u.id}|${i}`, ucChartSvg(t, u, { w: 560, h: chartH(u, i) }), { w: 560, h: chartH(u, i) }, UC_CHART_IN);
  }

  const body = [];
  const run = (text, { bold = false, color = '', size = 0, italic = false } = {}) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${Math.max(22, size)}"/><w:szCs w:val="${Math.max(22, size)}"/>` : ''}${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const small = (text, o = {}) => run(text, { ...o, size: 0 }).replace('<w:rPr>', `<w:rPr><w:sz w:val="${o.sz || 18}"/><w:szCs w:val="${o.sz || 18}"/>`);
  const paraXml = (runs, { style, pageBreak = false, shade = '', edge = '', after = null, before = null, keepNext = false, keepLines = false, center = false, flat = false } = {}) => {
    const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}${keepLines ? '<w:keepLines/>' : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}`
      + `${flat ? '<w:pBdr><w:bottom w:val="nil"/></w:pBdr>' : ''}`
      + `${shade ? `${edge ? `<w:pBdr><w:left w:val="single" w:sz="36" w:space="8" w:color="${edge}"/></w:pBdr>` : ''}<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}`
      + `${after != null || before != null ? `<w:spacing${before != null ? ` w:before="${before}"` : ''}${after != null ? ` w:after="${after}"` : ''}/>` : ''}${center ? '<w:jc w:val="center"/>' : ''}${rtl ? '<w:bidi/>' : ''}`;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
  };
  const para = (text, o = {}) => body.push(paraXml(run(text, o), o));
  const picRun = (p, alt) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(p.w * IN)}" cy="${Math.round(p.h * IN)}"/><wp:docPr id="${p.n}" name="Chart ${p.n}" descr="${esc(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${p.n}" name="chart${p.n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${p.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(p.w * IN)}" cy="${Math.round(p.h * IN)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const picture = (key, alt, pageBreak = false) => { const p = pics.get(key); if (p) body.push(paraXml(picRun(p, alt), { after: 100, keepNext: false, center: true, pageBreak })); return !!p; };
  const gap = (after = 60) => body.push(paraXml('', { after }));
  const tblPr = (extra = '') => `<w:tblPr><w:tblW w:w="${W}" w:type="dxa"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblLayout w:type="fixed"/>${extra}</w:tblPr>`;
  const white = (n) => ['left', 'right'].map((s) => `<w:${s} w:val="single" w:sz="${n}" w:space="0" w:color="FFFFFF"/>`).join('');
  // A table: rows of cells (a cell is a string or an array of lines). head fills row 0; band shades every other body row; labelCol tints column 0.
  const table = (rows, widths, { head = true, labelCol = false, band = false, headFill = TEAL } = {}) => {
    const cellXml = (c, ri, ci) => {
      const isHead = head && ri === 0;
      const lines = (Array.isArray(c) ? c : [c]).map((t) => String(t ?? ''));
      const opts = isHead ? { bold: true, color: 'FFFFFF' } : labelCol && ci === 0 ? { bold: true, color: TEAL } : {};
      const fill = isHead ? headFill : labelCol && ci === 0 ? K.mint : band && (ri - (head ? 1 : 0)) % 2 === 1 ? K.sand3 : '';
      const ps = lines.map((t) => paraXml(run(t, opts), { after: 20 })).join('');
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="${isHead ? 'center' : 'top'}"/></w:tcPr>${ps}</w:tc>`;
    };
    const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="BriefTable"/><w:tblW w:w="${W}" w:type="dxa"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblLayout w:type="fixed"/><w:tblLook w:val="${head ? '0420' : '0400'}" w:firstRow="${head ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>${grid}${rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/>${head && ri === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${r.map((c, ci) => cellXml(c, ri, ci)).join('')}</w:tr>`).join('')}</w:tbl>`);
    gap(60);
  };
  // A row of coloured tiles: each [big, small, fill]. Used for the cover tiles and the score chips.
  const tiles = (items, { bigSize = 56, inkOn = 'FFFFFF', pad = 120 } = {}) => {
    const w = split(items.length);
    body.push(`<w:tbl>${tblPr()}<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid><w:tr>${items.map(([big, label, fill], i) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/><w:tcBorders>${white(48)}</w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${paraXml(run(big, { bold: true, color: inkOn, size: bigSize }), { before: pad, after: 0, center: true })}${paraXml(run(label, { color: inkOn, size: 22 }), { after: pad, center: true })}</w:tc>`).join('')}</w:tr></w:tbl>`);
    gap(80);
  };
  const split = (n) => Array.from({ length: n }, (_, i) => Math.floor(W / n) + (i === n - 1 ? W % n : 0));
  const story = (u) => has(m, 'value_story') && u.value?.story && u.value.story !== 'Story not approved yet' ? u.value.story : '';
  const band = (text, fill, { size = 40, pageBreak = false, style = 'Heading1', edge = K.gold, before = 0 } = {}) => body.push(paraXml(run(text, { bold: true, color: 'FFFFFF', size }), { style, pageBreak, shade: fill, edge, flat: true, before, after: 160, keepNext: true }));

  // Domains in the order they first appear, each with its use cases.
  const groups = [];
  m.useCases.forEach((u) => { const d = u.domain || 'Other'; let g = groups.find((x) => x.domain === d); if (!g) { g = { domain: d, ucs: [] }; groups.push(g); } g.ucs.push(u); });
  const dl = domainsListOf(m.useCases);
  groups.sort((a, b) => dl.findIndex((d) => d.domain === a.domain) - dl.findIndex((d) => d.domain === b.domain));
  const fillOf = (d) => DOMAIN_FILLS[Math.max(0, groups.findIndex((g) => g.domain === d)) % DOMAIN_FILLS.length];
  const top = m.useCases.map((u) => u.score).filter((s) => Number.isFinite(s));

  withLabels(m.labels, () => {
    // Cover: a full-width dark block with the title, the business name and the date, then three colour tiles.
    const dateText = new Date().toLocaleDateString(m.rtl ? 'ar' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    body.push(`<w:tbl>${tblPr()}<w:tblGrid><w:gridCol w:w="${W}"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="6600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${W}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${DARK}"/><w:vAlign w:val="center"/></w:tcPr>`
      + (pics.get('logo') ? paraXml(picRun(pics.get('logo'), 'Logo'), { before: 400, after: 100 }) : '')
      + paraXml(run('DATABRICKS INSPIRE AI', { bold: true, color: K.gold, size: 24 }), { before: pics.get('logo') ? 100 : 600, after: 200 })
      + paraXml(run('Strategic AI Use Cases Powered by Databricks AI', { bold: true, color: 'FFFFFF', size: 72 }), { style: 'Title', before: 0, after: 300 })
      + paraXml(run(m.businessName || 'Inspire', { bold: true, color: K.gold, size: 48 }), { after: 120 })
      + paraXml(run(LB('Where data and AI pay back first'), { color: K.mint2, size: 28 }), { after: 120 })
      + paraXml(run(dateText, { color: K.mint2, size: 24 }), { after: 600 })
      + '</w:tc></w:tr></w:tbl>');
    gap(200);
    const tl = [[String(m.total.n), LB('use cases'), K.coral], [String(groups.length), LB('domains'), K.gold_dark]];
    tl.unshift(m.total.nWithValue ? [m.total.text, LB('Value a year'), TEAL] : top.length ? [Math.max(...top).toFixed(1), LB('Top Inspire score'), TEAL] : [String(m.total.n), LB('use cases'), TEAL]);
    if (!m.total.nWithValue && !top.length) tl.shift();
    tiles(tl, { bigSize: 52 });

    // Contents
    const rows = [[LB('Executive summary'), 'Why it matters and where to start'], [LB('What this catalog is for'), 'How to read and use it'], [LB('Business domains'), `${groups.length} ${LB('domains')}`]]
      .concat(groups.map((g) => [g.domain, `${g.ucs.length} ${LB('use cases')}`]), [['Methodology', 'How the use cases were made']]);
    band(LB('Contents'), DARK, { pageBreak: true });
    table([['', 'Section', 'In it'], ...rows.map((r, i) => [String(i + 1), r[0], r[1]])], [800, 5200, W - 6000], { band: true });

    // Executive summary: its own page, a short story and the portfolio pictures.
    para(LB('Executive summary'), { style: 'Heading1', pageBreak: true });
    execSummaryParas(m).forEach((p, i) => para(storyPick(m.story, `exec|${i}`, p)));
    picture('portfolio0', 'Value or use cases by business domain');

    // Purpose and domains.
    para(LB('What this catalog is for'), { style: 'Heading1', pageBreak: true });
    purposeParas(m).forEach((p, i) => para(storyPick(m.story, `purpose|${i}`, p)));
    picture('portfolio1', 'Priority against feasibility');
    para(LB('Business domains'), { style: 'Heading1', pageBreak: true });
    const anyV = dl.some((d) => d.value);
    table([['Domain', LB('use cases'), ...(anyV ? [LB('Value a year')] : []), 'Best score', 'What it covers'], ...dl.map((d) => [d.domain, String(d.count), ...(anyV ? [d.value ? d.value.text : ''] : []), d.bestScore != null ? fmt1(d.bestScore) : '', d.description || ''])],
      anyV ? [1900, 800, 1300, 900, W - 4900] : [2100, 900, 1000, W - 4000], { band: true });

    // One banner per domain, then its use cases.
    let no = 0;
    groups.forEach((g) => {
      const fill = fillOf(g.domain);
      const dv = g.ucs.filter((u) => u.value);
      band(g.domain, fill, { pageBreak: true, size: 48 });
      para(`${g.ucs.length} ${LB('use cases')}${dv.length ? `  |  ${moneyText(dv[0].value.currency, dv.reduce((a, u) => a + u.value.amount, 0))} ${LB('a year, estimated')}` : ''}`, { color: fill, bold: true, after: 200 });
      g.ucs.forEach((u, k) => {
        no += 1;
        if (k > 0) body.push(paraXml('<w:r><w:br w:type="page"/></w:r>', { after: 0 }));
        band(`${String(no).padStart(2, '0')}  ${u.name}`, fill, { size: 32, style: 'Heading2', before: 60 });
        const sub = [u.subdomain, u.id, u.technique].filter(Boolean).join('  |  ');
        if (sub) para(sub, { color: GREY, after: 120 });
        const chips = [];
        if (has(m, 'inspire_score') && u.score != null) chips.push([fmt1(u.score), LB('Inspire score'), TEAL]);
        if (u.priorityScore != null) chips.push([fmt1(u.priorityScore), 'Priority', K.coral]);
        if (u.valueScore != null) chips.push([fmt1(u.valueScore), LB('Value'), K.gold_dark]);
        if (u.feasibility != null) chips.push([fmt1(u.feasibility), 'Feasibility', K.teal_mid]);
        if (u.quality) chips.push([u.quality, LB('Quality'), qualityColor(u.quality)]);
        if (chips.length) tiles(chips, { bigSize: u.quality && chips.length > 3 ? 36 : 40, pad: 70 });
        if (u.value) {
          const runs = run(LB('{0} a year').replace('{0}', u.value.text), { bold: true, color: DARK, size: 32 }) + (u.value.verb ? run(`   ${u.value.verb}`, { color: GREY }) : '');
          body.push(paraXml(runs, { shade: K.sand, edge: K.gold, after: story(u) ? 0 : 160, before: 60 }));
          if (story(u)) body.push(paraXml(run(story(u)), { shade: K.sand, edge: K.gold, after: 160 }));
        }
        // C29: the words follow the two charts on the same page (no forced page break), so a use case page is full, not half empty.
        picture(`${u.id}|0`, `${u.name}: ${(ucTypes.get(u.id) || [])[0] || 'chart'}`); picture(`${u.id}|1`, `${u.name}: ${(ucTypes.get(u.id) || [])[1] || 'chart'}`, true);
        const sec = (label, text) => { if (has(m, 'use_case_story') && text) { body.push(paraXml(run(LB(label), { bold: true, color: TEAL, size: 26 }), { style: 'Heading2' })); para(text, { keepLines: true }); } };
        sec('Statement', u.statement); sec('Solution', u.solution); sec('Business value', u.businessValue);
        if (has(m, 'use_case_story')) {
          const facts = [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].filter(([, v]) => v).map(([l, v]) => [LB(l), v])
            .concat(extraParts(u).map(([l, items]) => [LB(l), partLines(items)]));
          if (facts.length) table(facts, [2600, W - 2600], { head: false, labelCol: true });
        }
        if (has(m, 'value_projection') && u.value && u.value.yearly.length) {
          para(LB('Three-year projection'), { style: 'Heading2' });
          const mt = (v) => moneyText(u.value.currency, v);
          table([[LB('Year {0}').replace('{0}', '').trim(), LB('Low'), LB('Likely'), LB('High')], ...u.value.yearly.map((y) => [LB('Year {0}').replace('{0}', y.year), mt(y.low), mt(y.likely), mt(y.high)])], split(4), { band: true, headFill: fill });
        }
      });
    });

    // Methodology and disclaimer.
    band('Methodology', DARK, { pageBreak: true });
    ['doc_method_2', 'doc_method_3', 'doc_method_5'].forEach((k, i) => body.push(paraXml(run(`${i + 1}  `, { bold: true, color: K.coral, size: 28 }) + run(LB(AGENT_EN[k])), { shade: i % 2 ? 'FFFFFF' : K.ice, edge: K.teal_mid, after: 80 })));
    para(LB('Estimates are AI-generated from your data and strategy. Treat them as a starting point.'), { color: GREY, before: 240 });
    if (has(m, 'disclaimer')) para(LB(AGENT_EN.doc_disclaimer_ai), { color: GREY, size: 22 });
  });

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', docRels(images.length));
  zip.file('word/styles.xml', stylesXml(face, accent, ink));
  images.forEach((im) => zip.file(`word/media/${im.name}`, im.bytes));
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS} ${NS_DRAW}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
