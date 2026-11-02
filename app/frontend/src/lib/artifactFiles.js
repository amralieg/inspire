const HIDDEN_EXTENSIONS = ['.json', '.jsonl'];
const CATALOG_JSON_SUFFIX = '-dbx_inspire.json';

export function visibleArtifactFiles(files) {
  return (Array.isArray(files) ? files : []).filter((file) => {
    if (!file || file.is_directory) return Boolean(file);
    const name = String(file.name || file.path || '').toLowerCase();
    return name.endsWith(CATALOG_JSON_SUFFIX) || !HIDDEN_EXTENSIONS.some((ext) => name.endsWith(ext));
  });
}

const QUICK_ACCESS_EXTENSIONS = ['pdf', 'csv', 'xlsx', 'xls'];
const EXCEL_EXTENSIONS = ['xlsx', 'xls'];

export function fileExtension(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.includes('.') ? name.split('.').pop() : '';
}

export const SHEET_PREVIEW_ROWS = 50;
export const EXCEL_UNREADABLE = 'Inspire could not read this Excel file. Download it instead.';
export const EXCEL_OLD_FORMAT = 'Inspire previews .xlsx files only. Download this .xls file instead.';

function cellText(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? '' : cell.toISOString().slice(0, 10);
  return String(cell);
}

export function sheetPreview(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    headers: (list[0] || []).map(cellText),
    rows: list.slice(1, SHEET_PREVIEW_ROWS + 1).map((row) => (Array.isArray(row) ? row : []).map(cellText)),
    totalRows: Math.max(0, list.length - 1),
  };
}

export function quickAccessFiles(files) {
  const shown = (Array.isArray(files) ? files : [])
    .filter((file) => file && !file.is_directory && QUICK_ACCESS_EXTENSIONS.includes(fileExtension(file)));
  if (!shown.some((file) => EXCEL_EXTENSIONS.includes(fileExtension(file)))) return shown;
  return shown.filter((file) => fileExtension(file) !== 'csv');
}
