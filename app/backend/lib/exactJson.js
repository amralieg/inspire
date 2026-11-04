const LONG_INTEGER = /^-?[1-9]\d{15,}$/;

function keepLongInteger(key, value, context) {
  return typeof value === 'number' && context && typeof context.source === 'string' && LONG_INTEGER.test(context.source) ? context.source : value;
}

const READS_SOURCE = (() => {
  try {
    const digits = '9'.repeat(17);
    return JSON.parse(`[${digits}]`, keepLongInteger)[0] === digits;
  } catch {
    return false;
  }
})();

function quoteLongIntegers(text) {
  const parts = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      i += 1;
      while (i < text.length && /[0-9.eE+-]/.test(text[i])) i += 1;
      const token = text.slice(start, i);
      if (LONG_INTEGER.test(token)) {
        parts.push(text.slice(last, start), `"${token}"`);
        last = i;
      }
    } else {
      i += 1;
    }
  }
  return last ? parts.join('') + text.slice(last) : text;
}

function parseExactJsonBySource(text) {
  return JSON.parse(text, keepLongInteger);
}

function parseExactJsonByTokens(text) {
  return JSON.parse(quoteLongIntegers(String(text)));
}

function parseExactJson(text) {
  return READS_SOURCE ? parseExactJsonBySource(text) : parseExactJsonByTokens(text);
}

module.exports = { READS_SOURCE, keepLongInteger, parseExactJson, parseExactJsonBySource, parseExactJsonByTokens, quoteLongIntegers };
