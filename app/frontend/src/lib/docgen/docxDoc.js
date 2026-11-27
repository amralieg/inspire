// C24 (RC7-B-11): the Word brief. The same content as the PDF brief (cover, executive summary, a section per use case) written as a .docx.
// A .docx is a zip of a few XML parts; JSZip (already installed under pptxgenjs, now a direct dependency) writes the zip, so there is no
// separate Word library. Text runs through the same labels as the other documents, so a second language prints translated.
import JSZip from 'jszip';
import { moneyText } from '../valueWizard.js';
import { LB, withLabels } from './docLabels.js';
import { extraParts, partLines } from './docModel.js';

const has = (m, id) => m.blocks.includes(id);
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c, fallback) => (/^#?[0-9a-f]{6}$/i.test(String(c)) ? String(c).replace('#', '').toUpperCase() : fallback);

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

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

export async function buildDocx(m, theme = {}) {
  const accent = hex(theme.accents && theme.accents[0], 'D9322B');
  const ink = '374151';
  const face = String(theme.font || 'Calibri').split(',')[0].replace(/['"]/g, '').trim() || 'Calibri';
  const rtl = !!m.rtl;
  const body = [];
  const run = (text, { bold = false, color = '', size = 0 } = {}) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${Math.max(22, size)}"/>` : ''}${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const paraXml = (runs, { style, pageBreak = false, shade = '', after = null, before = null, keepNext = false } = {}) => {
    const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}`
      + `${shade ? `<w:pBdr><w:left w:val="single" w:sz="36" w:space="8" w:color="${accent}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}`
      + `${after != null || before != null ? `<w:spacing${before != null ? ` w:before="${before}"` : ''}${after != null ? ` w:after="${after}"` : ''}/>` : ''}${rtl ? '<w:bidi/>' : ''}`;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
  };
  const para = (text, o = {}) => body.push(paraXml(run(text, o), o));
  // One table: rows of cells; a cell is a string or an array of lines. headRow fills the first row with the accent colour.
  const table = (rows, widths, { head = true, labelCol = false, tint = '' } = {}) => {
    const cellXml = (c, ri, ci) => {
      const isHead = head && ri === 0;
      const lines = (Array.isArray(c) ? c : [c]).map((t) => String(t ?? ''));
      const opts = isHead ? { bold: true, color: 'FFFFFF' } : labelCol && ci === 0 ? { bold: true, color: GREY } : {};
      const fill = isHead ? accent : tint;
      const ps = lines.map((t) => paraXml(run(t, opts), { after: 20 })).join('');
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[ci]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="${tint ? 'center' : 'top'}"/></w:tcPr>${ps}</w:tc>`;
    };
    const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="BriefTable"/><w:tblW w:w="${W}" w:type="dxa"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblLayout w:type="fixed"/><w:tblLook w:val="${head ? '0420' : '0400'}" w:firstRow="${head ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>${grid}${rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/>${head && ri === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${r.map((c, ci) => cellXml(c, ri, ci)).join('')}</w:tr>`).join('')}</w:tbl>`);
    body.push(paraXml('', { after: 60 }));
  };
  const split = (n) => Array.from({ length: n }, (_, i) => Math.floor(W / n) + (i === n - 1 ? W % n : 0));
  const story = (u) => has(m, 'value_story') && u.value?.story && u.value.story !== 'Story not approved yet' ? u.value.story : '';

  withLabels(m.labels, () => {
    // Cover
    para(m.businessName || 'Inspire', { style: 'Title' });
    para(LB('Use case brief'), { style: 'Subtitle' });
    para(new Date().toLocaleDateString(m.rtl ? 'ar' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), { color: GREY, after: 480 });
    const domains = new Set(m.useCases.map((u) => u.domain).filter(Boolean)).size;
    const stat = (big, small) => [big, small];
    const cells = [stat(String(m.total.n), LB('use cases')), stat(String(domains), LB('domains'))];
    if (m.total.nWithValue) cells.push(stat(m.total.text, LB('Value a year')));
    // stat table: big number over a small label, one cell each
    {
      const w = split(cells.length);
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/>${rtl ? '<w:bidiVisual/>' : ''}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid><w:tr>${cells.map(([big, small], i) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="24" w:space="0" w:color="${accent}"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:tcPr>${paraXml(run(big, { bold: true, color: accent, size: 44 }), { before: 120, after: 0 })}${paraXml(run(small, { color: GREY }), { after: 120 })}</w:tc>`).join('')}</w:tr></w:tbl>`);
      body.push(paraXml('', { after: 0 }));
    }
    // Executive summary and ranked table
    para(LB('Executive summary'), { style: 'Heading1', pageBreak: true });
    (m.summary || []).forEach((p) => para(p));
    if (m.useCases.length) {
      const anyValue = m.useCases.some((u) => u.value);
      const heads = ['#', LB('Use case'), LB('Domain'), ...(anyValue ? [LB('Value a year')] : []), LB('Quality')];
      const widths = anyValue ? [600, 3900, 2000, 1738, 1400] : [600, 5438, 2200, 1400];
      table([heads, ...m.useCases.map((u, i) => [String(i + 1), u.name, u.domain || '', ...(anyValue ? [u.value ? u.value.text : ''] : []), u.quality || ''])], widths);
    }
    m.useCases.forEach((u) => {
      para(u.name, { style: 'Heading1', pageBreak: true });
      const sub = [u.domain, u.subdomain, has(m, 'inspire_score') && u.score != null ? `${LB('Score')} ${u.score.toFixed(1)}` : ''].filter(Boolean).join('  |  ');
      if (sub) para(sub, { color: GREY, after: 160 });
      if (u.value) {
        const runs = run(LB('{0} a year').replace('{0}', u.value.text), { bold: true, color: accent, size: 32 }) + (u.value.verb ? run(`   ${u.value.verb}`, { color: GREY }) : '');
        body.push(paraXml(runs, { shade: 'F3F4F6', after: story(u) ? 0 : 160, before: 60 }));
        if (story(u)) body.push(paraXml(run(story(u)), { shade: 'F3F4F6', after: 160 }));
      }
      const sec = (label, text) => { if (has(m, 'use_case_story') && text) { para(LB(label), { style: 'Heading2' }); para(text); } };
      sec('Statement', u.statement);
      sec('Solution', u.solution);
      sec('Business value', u.businessValue);
      if (has(m, 'use_case_story')) {
        const facts = [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].filter(([, v]) => v).map(([l, v]) => [LB(l), v])
          .concat(extraParts(u).map(([l, items]) => [LB(l), partLines(items)]));
        if (facts.length) { table(facts, [2600, W - 2600], { head: false, labelCol: true }); }
      }
      if (has(m, 'value_projection') && u.value && u.value.yearly.length) {
        para(LB('Three-year projection'), { style: 'Heading2' });
        const mt = (v) => moneyText(u.value.currency, v);
        table([[LB('Year {0}').replace('{0}', '').trim(), LB('Low'), LB('Likely'), LB('High')], ...u.value.yearly.map((y) => [LB('Year {0}').replace('{0}', y.year), mt(y.low), mt(y.likely), mt(y.high)])], split(4));
      }
    });
    if (has(m, 'disclaimer')) para(LB('Estimates are AI-generated from your data and strategy. Treat them as a starting point.'), { color: GREY, size: 22, before: 240 });
  });

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', stylesXml(face, accent, ink));
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
