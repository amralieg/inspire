const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s](?:[^*\n]*[^*\s])?\*)/g;
const LINK = /\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g;
const SAFE_LINK = /^(?:https?:|mailto:|#)/i;
const LINK_SPACE = /[\u0000-\u0020]+/g;

export const safeLink = (url) => String(url || '').length <= 2000 && SAFE_LINK.test(String(url || '').replace(LINK_SPACE, ''));

export function closeOpenMarks(text) {
  let out = String(text || '');
  if ((out.match(/\*\*/g) || []).length % 2) out += '**';
  if ((out.match(/`/g) || []).length % 2) out += '`';
  return out;
}

export function inlineParts(text) {
  return String(text || '').split(INLINE).filter((part) => part !== '').map((part) => {
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return { kind: 'strong', text: part.slice(2, -2) };
    if (/^`[^`\n]+`$/.test(part)) return { kind: 'code', text: part.slice(1, -1) };
    if (/^\*[^*\s](?:[^*\n]*[^*\s])?\*$/.test(part)) return { kind: 'em', text: part.slice(1, -1) };
    return { kind: 'text', text: part };
  });
}

export function linkParts(text) {
  const source = String(text || '');
  const out = [];
  let at = 0;
  for (const m of source.matchAll(LINK)) {
    if (m.index > at) out.push(...inlineParts(source.slice(at, m.index)));
    out.push(safeLink(m[2]) ? { kind: 'link', text: m[1], href: m[2] } : { kind: 'text', text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < source.length) out.push(...inlineParts(source.slice(at)));
  return out;
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

export function tableCells(line) {
  const cells = [''];
  const source = String(line || '').trim();
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\\' && source[i + 1] === '|') {
      cells[cells.length - 1] += '|';
      i += 1;
    } else if (source[i] === '|') {
      cells.push('');
    } else {
      cells[cells.length - 1] += source[i];
    }
  }
  if (source.startsWith('|')) cells.shift();
  if (cells.length > 1 && source.endsWith('|') && !source.endsWith('\\|')) cells.pop();
  return cells.map((cell) => cell.trim());
}

const isTableRule = (line) => line.includes('|') && TABLE_RULE.test(line);

function cellAlign(rule) {
  const left = rule.startsWith(':');
  const right = rule.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
}

const fitRow = (cells, n) => Array.from({ length: n }, (_, i) => cells[i] ?? '');

export function markdownBlocks(text) {
  const blocks = [];
  let open = null;
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    if (open && open.type === 'table' && line.includes('|') && line.trim()) {
      open.rows.push(fitRow(tableCells(line), open.head.length));
      continue;
    }
    if (line.includes('|') && at + 1 < lines.length && isTableRule(lines[at + 1]) && !isTableRule(line)) {
      const head = tableCells(line);
      const align = fitRow(tableCells(lines[at + 1]).map(cellAlign), head.length);
      open = { type: 'table', head, align, rows: [] };
      blocks.push(open);
      at += 1;
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const item = /^\s*(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (RULE.test(line)) {
      blocks.push({ type: 'hr' });
      open = null;
    } else if (heading) {
      blocks.push({ type: 'h', text: heading[1] });
      open = null;
    } else if (item) {
      const type = item[1] ? 'ul' : 'ol';
      if (!open || open.type !== type) {
        open = { type, items: [] };
        blocks.push(open);
      }
      open.items.push(item[3]);
    } else if (!line.trim()) {
      open = null;
    } else if (open && open.type === 'p') {
      open.text += `\n${line}`;
    } else {
      open = { type: 'p', text: line };
      blocks.push(open);
    }
  }
  return blocks;
}
