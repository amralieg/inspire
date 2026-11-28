// c33 (REQ-577, REQ-578, REQ-579) shared fixtures for the wizard acceptance tests: a Plan answer, Match reports (full, partial, none),
// Match step rows in the agent's shape, and a tiny XLSX builder. Industry-neutral names only. Written by the c33 planner; no lane edits it.
import zlib from 'node:zlib';

const tables = (schema, n, start = 1) => Array.from({ length: n }, (_, i) => ({ table: `main.${schema}.t${String(start + i).padStart(2, '0')}`, why: `Part of ${schema}` }));

// A three-run plan: 25 + 15 + 6 = 46 tables, 12 tables left out in two groups.
export const PLAN = {
  catalogs: ['main'], read_tables: 58,
  runs: [
    { run_no: 1, name: 'Sales and orders', why: 'Orders, items and prices join on order id', tables: tables('sales', 25) },
    { run_no: 2, name: 'Stock and stores', why: 'Stock levels per store and day', tables: tables('stock', 15) },
    { run_no: 3, name: 'People and shifts', why: 'Shifts and rosters per site', tables: tables('people', 6) },
  ],
  left_out: [
    { reason: 'copy', label: 'Copies of other tables', count: 8, example: 'main.sales.t01_backup', tables: Array.from({ length: 8 }, (_, i) => `main.sales.copy${i}`) },
    { reason: 'technical', label: 'Technical tables', count: 4, example: 'main.ops.job_log', tables: ['main.ops.job_log', 'main.ops.audit', 'main.ops.tmp1', 'main.ops.tmp2'] },
  ],
};
export const PLAN_FOOTER = '3 runs, 46 tables. Run 1 starts first.';

// Match inputs and reports for session 42 (the harness session).
export const MATCH_INPUTS = [
  { input_no: 1, name: 'Forecast weekly demand', description: 'Predict units per store and week' },
  { input_no: 2, name: 'Reduce customer churn', description: 'Find customers likely to leave' },
  { input_no: 3, name: 'Optimise drone routes', description: 'Plan delivery drone paths' },
];
const piece = (piece_no, requirement, status, confidence, evidence, gap = '', known = null) => ({ piece_no, requirement, status, confidence, evidence, gap, known_data_option: known });
export const REPORT_FULL = { input_no: 1, name: 'Forecast weekly demand', verdict: 'full', confidence: 92, pieces: [
  piece(1, 'Units sold per store and week', 'matched', 94, [{ table: 'main.sales.order_items', columns: ['store_id', 'qty', 'order_date'], why: 'Item lines carry store, quantity and date' }]),
  piece(2, 'Store list', 'matched', 90, [{ table: 'main.stock.stores', columns: ['store_id', 'region'], why: 'One row per store' }]),
] };
export const REPORT_PARTIAL = { input_no: 2, name: 'Reduce customer churn', verdict: 'partial', confidence: 61, pieces: [
  piece(1, 'Customer purchase history', 'matched', 88, [{ table: 'main.sales.orders', columns: ['customer_id', 'order_date', 'total'], why: 'Orders per customer over time' }]),
  piece(2, 'Cancellation events', 'partial', 45, [{ table: 'main.sales.returns', columns: ['customer_id', 'return_date'], why: 'Returns hint at leaving, but are not cancellations' }],
    'No table records when a customer stops buying', { table: 'main.crm.contact_status', columns: ['customer_id', 'status'], why: 'A status column that may mark closed accounts' }),
] };
export const REPORT_NONE = { input_no: 3, name: 'Optimise drone routes', verdict: 'none', confidence: 8, pieces: [
  piece(1, 'Drone flight paths', 'missing', 5, [], 'No table holds drone or flight data'),
] };
export const MATCH_DONE = {
  state: 'done', inputs: MATCH_INPUTS, reports: [REPORT_FULL, REPORT_PARTIAL, REPORT_NONE],
  // Latest wins per piece: input 2 piece 2 was dropped, then kept.
  decisions: [
    { input_no: 2, piece_no: 2, decision: 'drop', event_at: '2026-11-28T10:00:00Z' },
    { input_no: 2, piece_no: 2, decision: 'keep', event_at: '2026-11-28T10:05:00Z' },
  ],
};

// The agent's step rows (__inspire_step) for a Match run: five inputs, one in each progress state.
export const MATCH_PROGRESS_INPUTS = [
  ...MATCH_INPUTS,
  { input_no: 4, name: 'Score supplier risk', description: 'Rate suppliers by late deliveries' },
  { input_no: 5, name: 'Plan staff rosters', description: 'Match staff to expected visits' },
];
let stepId = 0;
const row = (input_no, sub, status, result, minute) => {
  stepId += 1;
  const at = `2026-11-28T09:${String(minute).padStart(2, '0')}:00Z`;
  return { step_id: String(stepId), session_id: '42', stage_name: 'Match Use Cases', step_name: `Match ${input_no}`, sub_step_name: sub, status, last_updated: at,
    message: `${sub} ${input_no}`, progress_increment: 0, result_json: { input_no, name: MATCH_PROGRESS_INPUTS[input_no - 1].name, event_at: at, ...result } };
};
export const MATCH_STEP_ROWS = [
  row(1, 'Started', 'started', { status: 'matching' }, 1),
  row(1, 'Complete', 'ended_success', { status: 'matched', verdict: 'full', confidence: 92 }, 2),
  row(2, 'Started', 'started', { status: 'matching' }, 3),
  row(2, 'Complete', 'ended_success', { status: 'partly matched', verdict: 'partial', confidence: 61 }, 4),
  row(3, 'Started', 'started', { status: 'matching' }, 5),
  row(3, 'Error', 'ended_error', { status: 'not matched', error: 'The model did not answer' }, 6),
  row(4, 'Started', 'started', { status: 'matching' }, 7),
];
export const MATCH_EXPECTED_STATUS = ['Matched', 'Partly matched', 'Not matched', 'Matching', 'Waiting'];

// A minimal XLSX (shared strings, one sheet), deflated like a real workbook. rows: string[][]; row 1 is the header.
export function xlsxOf(rows) {
  const strings = [...new Set(rows.flat())];
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="s"><v>${strings.indexOf(v)}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Use cases" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`,
  };
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8'); const packed = zlib.deflateRawSync(raw); const crc = zlib.crc32(raw); const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
