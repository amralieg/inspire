// C24 (RC7-B-11): the Word brief. The same content as the PDF brief (cover, executive summary, a section per use case) written as a .docx.
// A .docx is a zip of a few XML parts; JSZip (already installed under pptxgenjs, now a direct dependency) writes the zip, so there is no
// separate Word library. Text runs through the same labels as the other documents, so a second language prints translated.
import JSZip from 'jszip';
import { moneyText } from '../valueWizard.js';
import { LB, NOT_YET, withLabels } from './docLabels.js';
import { extraParts, partLines } from './docModel.js';

const has = (m, id) => m.blocks.includes(id);
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c, fallback) => (/^#?[0-9a-f]{6}$/i.test(String(c)) ? String(c).replace('#', '').toUpperCase() : fallback);

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

const stylesXml = (face, accent, ink) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>`
  + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(face)}" w:hAnsi="${esc(face)}" w:cs="${esc(face)}"/><w:color w:val="${ink}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="72"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="${accent}"/><w:sz w:val="36"/></w:rPr></w:style>`
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>';

export async function buildDocx(m, theme = {}) {
  const accent = hex(theme.accents && theme.accents[0], 'D9322B');
  const ink = '1F2933';
  const face = String(theme.font || 'Calibri').split(',')[0].replace(/['"]/g, '').trim() || 'Calibri';
  const rtl = !!m.rtl;
  const body = [];
  const para = (text, { style, bold = false, color = '', size = 0, pageBreak = false } = {}) => {
    const rpr = `${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}${rtl ? '<w:rtl/>' : ''}`;
    const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${pageBreak ? '<w:pageBreakBefore/>' : ''}${rtl ? '<w:bidi/>' : ''}`;
    body.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`);
  };
  // A labelled part: the label in bold, then each line of its text as a paragraph.
  const part = (id, label, lines) => {
    const rows = lines.filter(Boolean);
    if (!has(m, id) || !rows.length) return;
    para(LB(label), { bold: true, color: '6B7280', size: 20 });
    rows.forEach((l) => para(LB(l)));
  };
  const cell = (text, head) => `<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr><w:p>${rtl ? '<w:pPr><w:bidi/></w:pPr>' : ''}<w:r><w:rPr>${head ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
  const projection = (u) => {
    const rows = [[LB('Year {0}').replace('{0}', ''), LB('Low'), LB('Likely'), LB('High')].map((t) => t.trim())];
    u.value.yearly.forEach((y) => rows.push([LB('Year {0}').replace('{0}', y.year), moneyText(u.value.currency, y.low), moneyText(u.value.currency, y.likely), moneyText(u.value.currency, y.high)]));
    const border = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>`).join('') + '</w:tblBorders>';
    body.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${border}${rtl ? '<w:bidiVisual/>' : ''}</w:tblPr>${rows.map((r, i) => `<w:tr>${r.map((t) => cell(t, i === 0)).join('')}</w:tr>`).join('')}</w:tbl>`);
    para('');
  };

  withLabels(m.labels, () => {
    para(m.businessName || 'Inspire', { style: 'Title' });
    para(LB('Use case brief'), { bold: true, color: accent, size: 44 });
    para(`${LB(`${m.total.n} use cases`)} | ${m.total.nWithValue ? m.total.text : LB(NOT_YET)}`, { color: '6B7280', size: 32 });
    if (m.summary && m.summary.length) {
      para(LB('Executive summary'), { style: 'Heading1', pageBreak: true });
      m.summary.forEach((p) => para(p));
    }
    m.useCases.forEach((u) => {
      para(u.name, { style: 'Heading1', pageBreak: true });
      const tail = [];
      if (has(m, 'inspire_score') && u.score != null) tail.push(`${LB('Score')} ${u.score.toFixed(1)}`);
      tail.push(u.value ? u.value.text : LB(NOT_YET));
      para(tail.join('  |  '), { bold: true, color: accent });
      part('use_case_story', 'The use case', [u.statement]);
      part('use_case_story', 'The solution', [u.solution]);
      part('use_case_story', 'Business value', [u.businessValue]);
      [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].forEach(([l, v]) => part('use_case_story', l, v ? [v] : []));
      extraParts(u).forEach(([l, items]) => part('use_case_story', l, partLines(items)));
      part('value_story', 'Value story', u.value?.story ? [u.value.story] : []);
      part('data_used', 'Data used', u.tables.length ? [u.tables.join(', ')] : []);
      if (has(m, 'value_projection') && u.value && u.value.yearly.length) { para(LB('Three-year projection'), { bold: true, color: '6B7280', size: 20 }); projection(u); }
    });
    if (has(m, 'disclaimer')) para(LB('Estimates are AI-generated from your data and strategy. Treat them as a starting point.'), { color: '6B7280', size: 20 });
  });

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', stylesXml(face, accent, ink));
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
