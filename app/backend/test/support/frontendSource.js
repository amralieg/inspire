const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = path.resolve(__dirname, '..', '..', '..', 'frontend');
const SRC = path.join(FRONTEND, 'src');

function sourceFiles(dir, exts) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, exts);
    return exts.includes(path.extname(entry.name)) ? [full] : [];
  });
}

function withoutComments(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < text.length) { out += text[i + 1]; i += 1; } else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
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
    out += c;
  }
  return out;
}

const relative = (file) => path.relative(FRONTEND, file);

module.exports = { FRONTEND, SRC, sourceFiles, withoutComments, relative };
