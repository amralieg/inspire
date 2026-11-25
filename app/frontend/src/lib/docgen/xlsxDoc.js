// FX-113 (REQ-503): the Excel summary. The universal entry works in Node (tests) and in the browser (Vite).
import writeXlsxFile from 'write-excel-file/universal';
import { EXCEL_COLUMNS } from './docOptions.js';

const text = (v) => ({ value: v == null ? '' : String(v), wrap: true, align: 'left', alignVertical: 'top' });
const num = (v) => (Number.isFinite(v) ? { value: v, type: Number } : text(''));

const projectionText = (u) => (u.value?.yearly || []).map((y) => `Y${y.year}: ${y.low}-${y.likely}-${y.high}`).join('; ');

const CELL = {
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
};
const WIDTH = { name: 40, statement: 60, use_case_story: 60, value_story: 50, projection: 40, tables: 40 };

// REQ-525: only the header fill follows the theme (dark: its page colour); the cells stay on the white sheet.
export async function buildXlsx(model, columnIds, theme = null) {
  const cols = (columnIds || []).filter((id) => CELL[id]);
  const label = (id) => EXCEL_COLUMNS.find((c) => c.id === id)?.label || id;
  const header = cols.map((id) => ({ value: label(id), fontWeight: 'bold', backgroundColor: theme?.headFill || '#1B3139', color: '#FFFFFF' }));
  const rows = model.useCases.map((u) => cols.map((id) => CELL[id](u)));
  return writeXlsxFile([header, ...rows], { columns: cols.map((id) => ({ width: WIDTH[id] || 16 })) }).toBlob();
}
