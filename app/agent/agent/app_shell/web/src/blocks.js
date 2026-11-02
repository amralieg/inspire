import DOMPurify from 'dompurify';
import { fillRows } from './layout.js';
import { safeLink } from './markdown.js';

export const HTML_TAGS = ['a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd',
  'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'style', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr'];
export const HTML_ATTRS = ['align', 'alt', 'cite', 'class', 'colspan', 'datetime', 'dir', 'headers', 'height', 'href', 'id', 'lang',
  'open', 'rel', 'reversed', 'role', 'rowspan', 'scope', 'span', 'src', 'start', 'style', 'target', 'title', 'valign', 'width'];

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const CSS_BANNED = /@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|\\/i;
const CSS_URL = /url\s*\(\s*['"]?\s*([^'")\s]*)/gi;
const BLOCK_FILE = /^blocks\/[0-9a-f]{64}\.(?:png|jpg|gif|webp)$/;
const SIDES = ['before', 'after', 'left', 'right'];

export const safeCss = (css) => !CSS_BANNED.test(String(css || '')) && [...String(css || '').matchAll(CSS_URL)].every((m) => DATA_IMAGE.test(m[1]));
export const blockFile = (file) => (BLOCK_FILE.test(String(file || '')) ? file : '');

let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const value = String(data.attrValue || '');
    if (data.attrName === 'href' && !safeLink(value)) data.keepAttr = false;
    if (data.attrName === 'src' && !(node.nodeName === 'IMG' && DATA_IMAGE.test(value.trim()))) data.keepAttr = false;
    if (data.attrName === 'style' && !safeCss(value)) data.keepAttr = false;
  });
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && !safeCss(node.textContent)) node.textContent = '';
  });
}

export function cleanHtml(html) {
  if (!DOMPurify.isSupported) return '';
  hook();
  return DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: HTML_TAGS, ALLOWED_ATTR: HTML_ATTRS, ALLOW_DATA_ATTR: true, ALLOW_ARIA_ATTR: true, FORCE_BODY: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

const emptySlots = () => ({ before: [], after: [], left: [], right: [] });

export function blockPlan(blocks, drawn) {
  const list = (blocks || []).filter((b) => b && b.id);
  const ids = new Set(list.map((b) => b.id));
  const near = { before: new Map(), after: new Map() };
  const roots = {};
  const root = (anchor, side) => {
    const moved = !!drawn && anchor !== '@top' && anchor !== '@bottom' && !drawn.has(anchor);
    const at = moved ? '@bottom' : anchor;
    roots[at] ||= emptySlots();
    return roots[at][moved ? 'after' : side];
  };
  list.forEach((b) => {
    const { where, of } = b.place || {};
    if ((where === 'before' || where === 'after') && ids.has(of) && of !== b.id) near[where].set(of, [...(near[where].get(of) || []), b]);
    else if ((where === 'before' || where === 'after') && of) root(of, where).push(b);
    else if (where === 'beside' && of && !ids.has(of)) root(of, b.align === 'right' ? 'right' : 'left').push(b);
    else root(where === 'top' ? '@top' : '@bottom', 'after').push(b);
  });
  const seen = new Set();
  const expand = (items) => items.flatMap((b) => {
    if (seen.has(b.id)) return [];
    seen.add(b.id);
    return [...expand(near.before.get(b.id) || []), b, ...expand(near.after.get(b.id) || [])];
  });
  const plan = {};
  Object.entries(roots).forEach(([anchor, sides]) => {
    plan[anchor] = Object.fromEntries(SIDES.map((side) => [side, expand(sides[side])]));
  });
  const left = list.filter((b) => !seen.has(b.id));
  if (left.length) {
    plan['@bottom'] ||= emptySlots();
    plan['@bottom'].after.push(...left);
  }
  return plan;
}

export const slotsOf = (plan, anchor) => plan?.[anchor] || emptySlots();

const TITLE_CHARS = 90;
const MARKS = /[#*`>_[\]]|\(([^)\s]{1,2000})\)/g;

export function blockTitle(block) {
  const content = block?.content;
  const raw = block?.kind === 'image' ? String(content?.caption || content?.alt || 'Image')
    : block?.kind === 'html' ? String(content || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
      : String(content || '').split('\n').find((line) => line.replace(MARKS, '').trim()) || '';
  const text = raw.replace(MARKS, ' ').replace(/\s+/g, ' ').trim() || 'Note';
  return [...text].length > TITLE_CHARS ? `${[...text].slice(0, TITLE_CHARS - 1).join('').trimEnd()}…` : text;
}

export function withBlocks(items, plan, idOf = (item) => item.id) {
  return items.flatMap((item) => {
    const slots = slotsOf(plan, idOf(item));
    const beside = slots.left.length + slots.right.length > 0;
    const block = (b, side) => ({ key: `block:${b.id}`, block: b, beside: side });
    return [...slots.before.map((b) => block(b, false)), ...slots.left.map((b) => block(b, true)), { key: idOf(item), item, beside },
      ...slots.right.map((b) => block(b, true)), ...slots.after.map((b) => block(b, false))];
  });
}

export const entrySpan = (entry) => (entry.beside || entry.span === 1 ? 1 : entry.block ? (!entry.block.width || entry.block.width === 'full' ? 2 : 1)
  : entry.item.span === 2 ? 2 : 1);

export const gridSpans = (entries) => fillRows(entries.map((entry) => ({ span: entrySpan(entry), beside: entry.beside })));
