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

export function markdownBlocks(text) {
  const blocks = [];
  let open = null;
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    const item = /^\s*(?:([-*•])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (heading) {
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
