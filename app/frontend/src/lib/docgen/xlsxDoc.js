// FX-113 (REQ-503): the Excel summary. The universal entry works in Node (tests) and in the browser (Vite).
import writeXlsxFile from 'write-excel-file/universal';
import { EXCEL_COLUMNS } from './docOptions.js';

const text = (v) => ({ value: v == null ? '' : String(v), wrap: true, align: 'left', alignVertical: 'top' });
const num = (v) => (Number.isFinite(v) ? { value: v, type: Number } : text(''));

const projectionText = (u) => (u.value?.yearly || []).map((y) => `Y${y.year}: ${y.low}-${y.likely}-${y.high}`).join('; ');

const lines = (items) => text((items || []).join('\n'));

// C24 (REQ-465): where the App opens one use case (#/review/<run>/<id>, as hashLink reads it); empty when the App address or the run is unknown.
const useCaseLink = (m, u) => (m.appUrl && m.sessionId && u.id ? `${String(m.appUrl).replace(/\/+$/, '')}/#/review/${encodeURIComponent(m.sessionId)}/${encodeURIComponent(u.id)}` : '');
const quote = (v) => String(v).replace(/"/g, '""');
// The ID is a HYPERLINK formula: the sheet writer has no link cell, the cell XML takes the formula without its leading equals sign, and Excel and Sheets draw the formula as a link.
const idCell = (m, u) => {
  const link = useCaseLink(m, u);
  return link ? { value: `HYPERLINK("${quote(link)}","${quote(u.id)}")`, type: 'Formula', color: '#0B57D0', align: 'left', alignVertical: 'top' } : text(u.id);
};

const CELL = {
  id: (u) => text(u.id), // replaced by idCell in buildXlsx, which knows the model
  name: (u) => text(u.name),
  inspire_score: (u) => num(u.score),
  value: (u) => num(u.value ? u.value.amount : null),
  value_status: (u) => text(u.value ? u.value.status : 'not calculated yet'),
  domain: (u) => text(u.domain),
  statement: (u) => text(u.statement),
  use_case_story: (u) => text(u.solution),
  value_story: (u) => text(u.value?.story),
  projection: (u) => text(projectionText(u)),
  tables: (u) => text((u.tables || []).join(', ')),
  business_value: (u) => text(u.businessValue), sponsor: (u) => text(u.sponsor), beneficiary: (u) => text(u.beneficiary), technique: (u) => text(u.technique),
  design: (u) => text(u.design), type: (u) => text(u.type), priority_alignment: (u) => text(u.priorityAlignment), strategic_alignment: (u) => text(u.strategicAlignment),
  kpis: (u) => lines(u.kpis), key_results: (u) => lines(u.keyResults), measures: (u) => lines(u.measures), financial: (u) => lines(u.financial),
  non_financial: (u) => lines(u.nonFinancial), foundations: (u) => lines(u.foundations),
};
const WIDTH = { name: 40, statement: 60, use_case_story: 60, value_story: 50, projection: 40, tables: 40, business_value: 50, design: 60, kpis: 40, key_results: 50, measures: 50, financial: 40, non_financial: 40, strategic_alignment: 40 };

// REQ-525: only the header fill follows the theme (dark: its page colour); the cells stay on the white sheet.
export async function buildXlsx(model, columnIds, theme = null) {
  const cols = (columnIds || []).filter((id) => CELL[id]);
  const label = (id) => EXCEL_COLUMNS.find((c) => c.id === id)?.label || id;
  const header = cols.map((id) => ({ value: label(id), fontWeight: 'bold', backgroundColor: theme?.headFill || '#1B3139', color: '#FFFFFF' }));
  const rows = model.useCases.map((u) => cols.map((id) => (id === 'id' ? idCell(model, u) : CELL[id](u))));
  return writeXlsxFile([header, ...rows], { columns: cols.map((id) => ({ width: WIDTH[id] || 16 })) }).toBlob();
}
