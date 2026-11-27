// C23: the use case text parts a slide prints, and how they flow over as many slides as the text needs (a slide never cuts a text with "...").
import { extraParts, partLines } from './docModel.js';

const has = (m, id) => m.blocks.includes(id);

// [{ label, text }] in the order the agent documents printed them; several items in one part are separate lines.
export function ucParts(m, u) {
  const out = [];
  if (has(m, 'use_case_story')) {
    [['The use case', u.statement], ['The solution', u.solution], ['Business value', u.businessValue], ['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]]
      .forEach(([label, text]) => text && out.push({ label, text }));
    extraParts(u).forEach(([label, items]) => out.push({ label, text: partLines(items).join('\n') }));
  }
  if (has(m, 'value_story') && u.value?.story) out.push({ label: 'Value story', text: u.value.story });
  return out;
}

const linesOf = (text, cpl) => String(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cpl)), 0);

// Splits the parts into pages of at most `maxLines` text lines (a label is one line, a part is followed by one blank line).
// A part longer than what is left is split on a word boundary and goes on, so every word lands on some page.
export function paginate(parts, cpl, maxLines, firstMax = maxLines) {
  const pages = [[]]; let used = 0; let cap = firstMax;
  const next = () => { pages.push([]); used = 0; cap = maxLines; };
  for (const part of parts) {
    let { text } = part; let label = part.label;
    for (;;) {
      const need = 2 + linesOf(text, cpl);
      if (used + need <= cap) { pages[pages.length - 1].push({ label, text }); used += need; break; }
      const room = cap - used - 2;
      if (room < 2 && used > 0) { next(); continue; }
      const words = text.split(/(\s+)/); let head = '';
      while (words.length && linesOf(head + words[0], cpl) <= Math.max(room, 1)) head += words.shift();
      if (!head) head = words.shift() || '';
      pages[pages.length - 1].push({ label, text: head.trim() });
      text = words.join('').trim(); label = `${part.label} (cont.)`; next();
      if (!text) break;
    }
  }
  return pages;
}
