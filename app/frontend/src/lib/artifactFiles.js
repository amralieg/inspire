import { parseApiErrorMessage } from './ucPermissionErrors.js';

const HIDDEN_EXTENSIONS = ['.json', '.jsonl'];
const CATALOG_JSON_NAME = /-dbx_inspire(_[a-z]{2})?\.json$/;

export function visibleArtifactFiles(files) {
  return (Array.isArray(files) ? files : []).filter((file) => {
    if (!file || file.is_directory) return Boolean(file);
    const name = String(file.name || file.path || '').toLowerCase();
    return CATALOG_JSON_NAME.test(name) || !HIDDEN_EXTENSIONS.some((ext) => name.endsWith(ext));
  });
}

const QUICK_ACCESS_EXTENSIONS = ['pdf', 'csv', 'xlsx', 'xls'];
const EXCEL_EXTENSIONS = ['xlsx', 'xls'];

export function fileExtension(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.includes('.') ? name.split('.').pop() : '';
}

export function fileActions(file) {
  const ext = fileExtension(file);
  return { preview: QUICK_ACCESS_EXTENSIONS.includes(ext), open: ext === 'pdf' };
}

export function fileSizeText(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fileProblemText(action, name, resp) {
  let why = resp ? `the workspace answered ${resp.status}` : 'the App did not answer';
  if (resp) {
    const body = await resp.json().catch(() => null);
    const said = parseApiErrorMessage(String(body?.error || body?.message || '')).trim();
    if (said) why = said.length > 200 ? `${said.slice(0, 200)}…` : said;
  }
  return `Inspire could not ${action} ${name}: ${why}${/[.!?…]$/.test(why) ? '' : '.'}`;
}

export const PREVIEW_ROWS = 5000;
export const PREVIEW_PAGE_ROWS = 50;
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
    rows: list.slice(1, PREVIEW_ROWS + 1).map((row) => (Array.isArray(row) ? row : []).map(cellText)),
    totalRows: Math.max(0, list.length - 1),
  };
}

export function csvRows(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => { row.push(cell.trim()); cell = ''; };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (s[i + 1] !== '\n') endRow(); } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

export const csvPreview = (text) => sheetPreview(csvRows(text));

export function previewGrid(preview) {
  const taken = new Set();
  const headers = preview?.headers || [];
  const wide = Math.max(headers.length, ...(preview?.rows || []).map((cells) => cells.length));
  const columns = Array.from({ length: wide }, (_, i) => headers[i]).map((header, i) => {
    const name = String(header ?? '').trim() || `Column ${i + 1}`;
    let label = name;
    for (let n = 2; taken.has(label); n += 1) label = `${name} (${n})`;
    taken.add(label);
    return { key: `h:${label}`, label, at: i };
  });
  const rows = (preview?.rows || []).map((cells, r) => Object.fromEntries([['#', r + 1], ...columns.map((c) => [c.key, cells[c.at] ?? ''])]));
  return { columns, rows };
}

export function quickAccessFiles(files) {
  const shown = (Array.isArray(files) ? files : [])
    .filter((file) => file && !file.is_directory && QUICK_ACCESS_EXTENSIONS.includes(fileExtension(file)));
  if (!shown.some((file) => EXCEL_EXTENSIONS.includes(fileExtension(file)))) return shown;
  return shown.filter((file) => fileExtension(file) !== 'csv');
}
