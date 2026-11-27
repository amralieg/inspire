// C24 (RC7-B-09): the pure parts of POST /api/inspire/docs/translate. A long set of texts is split into chunks the model can answer in one reply,
// and a reply is read the way models really write it: inside a code fence, with prose (and braces) around the JSON, or cut off mid-way.
const { parseExactJson } = require('./exactJson');

const CHUNK_CHARS = 5000;

// Keys in their order, grouped so each group's texts add up to about `limit` characters (a single longer text is a group of its own).
function chunkTexts(texts, limit = CHUNK_CHARS) {
  const chunks = [];
  let current = {};
  let size = 0;
  for (const key of Object.keys(texts)) {
    const cost = key.length + String(texts[key]).length + 8;
    if (size && size + cost > limit) { chunks.push(current); current = {}; size = 0; }
    current[key] = texts[key];
    size += cost;
  }
  if (size) chunks.push(current);
  return chunks;
}

// Every top-level {...} in the text, braces inside JSON strings ignored; a candidate that is not JSON is skipped.
function objectsIn(raw) {
  const found = [];
  for (let start = raw.indexOf('{'); start !== -1; start = raw.indexOf('{', start + 1)) {
    let depth = 0; let inString = false; let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = parseExactJson(raw.slice(start, i + 1));
            if (value && typeof value === 'object' && !Array.isArray(value)) found.push(value);
          } catch (_) { /* prose in braces, not JSON */ }
          break;
        }
      }
    }
  }
  return found;
}

// The "key": "value" pairs that are complete in a reply that was cut off; the unfinished last value is not among them.
function completePairs(raw) {
  const out = {};
  const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    try { out[JSON.parse(`"${m[1]}"`)] = JSON.parse(`"${m[2]}"`); } catch (_) { /* a broken escape: that pair is skipped */ }
  }
  return out;
}

// The translations a reply holds for `keys`: { key: text } with only non-empty strings. An empty object means nothing usable.
function readTranslations(raw, keys) {
  const text = String(raw || '');
  const want = new Set(keys);
  const usable = (obj) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => want.has(k) && typeof v === 'string' && v.trim()));
  let best = {};
  for (const obj of objectsIn(text)) {
    const u = usable(obj);
    if (Object.keys(u).length > Object.keys(best).length) best = u;
  }
  const salvaged = usable(completePairs(text));
  return Object.keys(salvaged).length > Object.keys(best).length ? salvaged : best;
}

// C28 (REQ-572): the person's "Vibe your docs" text as one prompt line: wording guidance only, never a change of keys, names or numbers. Cut at 1000 characters.
const VIBE_MAX = 1000;
function vibeLine(vibe) {
  const text = String(vibe ?? '').replace(/\s+/g, ' ').trim().slice(0, VIBE_MAX);
  return text ? ` The person asked for this tone and style in the wording (it guides word choice only; it never changes the keys, names or numbers): "${text}".` : '';
}

module.exports = { vibeLine, chunkTexts, readTranslations, CHUNK_CHARS };
