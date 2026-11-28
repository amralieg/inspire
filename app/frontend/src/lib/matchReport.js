// REQ-578: the use case lists of the Match path. Pasted text, CSV, XLSX and TXT files all become [{ name, description }];
// numbering from 1 and the MATCH_INPUT_MAX cut are done by numberUseCases. No dependency: an XLSX is a zip read with DecompressionStream.
import { MATCH_INPUT_MAX } from './startWizard';

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// One use case per line: "name: description", or only a name.
export function parseUseCaseText(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const at = line.indexOf(':');
    return at < 0 ? { name: clean(line), description: '' } : { name: clean(line.slice(0, at)), description: clean(line.slice(at + 1)) };
  }).filter((u) => u.name);
}

export const useCaseLines = (items) => items.map((u) => (u.description ? `${u.name}: ${u.description}` : u.name)).join('\n');

// Numbers from 1 and keeps the first MATCH_INPUT_MAX. total is how many there were before the cut.
export function numberUseCases(items) {
  const list = (items || []).map((u) => ({ name: clean(u.name), description: clean(u.description) })).filter((u) => u.name);
  return { total: list.length, useCases: list.slice(0, MATCH_INPUT_MAX).map((u, i) => ({ input_no: i + 1, name: u.name, description: u.description })) };
}

// RFC 4180 style: quoted cells keep commas, quotes and line breaks; "" is a quote.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => clean(c)));
}

const NAME_HEADS = ['name', 'use case', 'usecase', 'use_case', 'use case name', 'title'];
const DESCRIPTION_HEADS = ['description', 'statement', 'details', 'detail', 'summary'];

// Rows of cells (a header row is optional) to use cases: the name column, then the description column.
export function useCasesOfRows(rows) {
  const list = (rows || []).filter((r) => r.some((c) => clean(c)));
  if (!list.length) return [];
  const head = list[0].map((c) => clean(c).toLowerCase());
  const nameAt = head.findIndex((c) => NAME_HEADS.includes(c));
  const descriptionAt = head.findIndex((c) => DESCRIPTION_HEADS.includes(c));
  const hasHeader = nameAt >= 0 || descriptionAt >= 0;
  const nameCol = nameAt >= 0 ? nameAt : 0;
  const descriptionCol = descriptionAt >= 0 ? descriptionAt : (nameCol === 0 ? 1 : 0);
  return (hasHeader ? list.slice(1) : list).map((r) => ({ name: clean(r[nameCol]), description: descriptionCol === nameCol ? '' : clean(r[descriptionCol]) })).filter((u) => u.name);
}

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The named files of a zip, as text. Reads the central directory, so entry sizes come from there.
async function unzipText(buffer, wanted) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(view, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This file is not an XLSX workbook.');
  const count = u16(view, end + 10);
  let at = u32(view, end + 16);
  const out = {};
  for (let n = 0; n < count && u32(view, at) === 0x02014b50; n += 1) {
    const method = u16(view, at + 10);
    const packed = u32(view, at + 20);
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    const dataAt = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    const body = bytes.subarray(dataAt, dataAt + packed);
    if (method === 0) out[name] = new TextDecoder().decode(body);
    else if (method === 8) out[name] = new TextDecoder().decode(await inflateRaw(body));
    else throw new Error('This XLSX uses a compression Inspire cannot read.');
  }
  return out;
}

const colOf = (ref) => [...String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const textOf = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');

// xl/sharedStrings.xml plus xl/worksheets/sheet1.xml to rows of cell text.
export async function xlsxRows(buffer) {
  const files = await unzipText(buffer, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  if (!files['xl/worksheets/sheet1.xml']) throw new Error('This XLSX has no first sheet to read.');
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const strings = files['xl/sharedStrings.xml'] ? [...parse(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(textOf) : [];
  return [...parse(files['xl/worksheets/sheet1.xml']).getElementsByTagName('row')].map((row) => {
    const cells = [];
    [...row.getElementsByTagName('c')].forEach((c, i) => {
      const at = c.getAttribute('r') ? colOf(c.getAttribute('r')) : i;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0];
      if (type === 'inlineStr') cells[at] = textOf(c);
      else if (type === 's') cells[at] = v ? (strings[Number(v.textContent)] ?? '') : '';
      else cells[at] = v ? v.textContent : '';
    });
    return Array.from(cells, (c) => c ?? '');
  });
}

// A File (CSV, XLSX or TXT) to [{ name, description }].
export async function useCasesOfFile(file) {
  const name = String(file && file.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) return useCasesOfRows(await xlsxRows(await file.arrayBuffer()));
  const text = await file.text();
  if (name.endsWith('.csv')) return useCasesOfRows(parseCsv(text));
  return parseUseCaseText(text);
}
