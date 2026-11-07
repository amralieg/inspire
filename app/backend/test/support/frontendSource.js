const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.resolve(__dirname, '..', '..', '..', 'frontend');
const SRC = path.join(FRONTEND, 'src');

function sourceFiles(dir, exts) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, exts);
    return entry.isFile() && exts.includes(path.extname(entry.name)) ? [full] : [];
  });
}

const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';']);

function regexEnd(text, start) {
  let inClass = false;
  for (let j = start + 1; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\n') return -1;
    if (c === '\\') { j += 1; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j;
  }
  return -1;
}

function withoutComments(text) {
  let out = '';
  let quote = null;
  let depth = 0;
  let prev = '';
  const templates = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 1; } else if (quote === '`' && c === '$' && text[i + 1] === '{') {
        out += '{';
        i += 1;
        templates.push(depth);
        depth = 0;
        quote = null;
        prev = '{';
      } else if (c === quote) { quote = null; prev = c; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '}' && depth === 0 && templates.length) { depth = templates.pop(); quote = '`'; out += c; continue; }
    const block = text.startsWith('{/*', i) ? ['*/}', 3] : text.startsWith('/*', i) ? ['*/', 2] : null;
    if (block) {
      const end = text.indexOf(block[0], i);
      const stop = end < 0 ? text.length : end + block[1];
      out += '\n'.repeat((text.slice(i, stop).match(/\n/g) || []).length);
      i = stop - 1;
      continue;
    }
    if (text.startsWith('//', i) && text[i - 1] !== ':') {
      const end = text.indexOf('\n', i);
      i = (end < 0 ? text.length : end) - 1;
      continue;
    }
    const end = c === '/' && REGEX_AFTER.has(prev) ? regexEnd(text, i) : -1;
    if (end > 0) { out += text.slice(i, end + 1); i = end; prev = '/'; continue; }
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    out += c;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

const relative = (file) => path.relative(FRONTEND, file);

module.exports = { FRONTEND, SRC, sourceFiles, withoutComments, relative };
