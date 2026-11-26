// C24 (RC7-B-12): text stored with a use case can carry machine markers: "[ESTIMATE: depends on `col`]" tags and `backticks` around names.
// A document is read by business people, so the markers become plain words: the tag turns into "(estimate: depends on col)" and backticks go.
const TAG_WORDS = { ESTIMATE: 'estimate', BASELINE: 'baseline', TARGET: 'target', WINDOW: 'window', ASSUMPTION: 'assumption', MISSING_DATA: 'missing data' };
const TAG_RE = /\[\s*([A-Z_]+)\s*(?::\s*([^\[\]]*?))?\s*\]/g;

export function plainDocText(value) {
  return String(value ?? '')
    .replace(TAG_RE, (all, tag, body) => {
      const word = TAG_WORDS[tag];
      if (!word) return all;
      const said = String(body || '').replace(/`/g, '').trim();
      return said ? `(${word}: ${said})` : `(${word})`;
    })
    .replace(/`/g, '');
}

// A foundation code ("F1") as its name; a code with no known name is left out rather than printed as a code. Other text is plain text.
export function foundationLabel(item, namesById) {
  const text = plainDocText(item).trim();
  if (!/^F\d+$/i.test(text)) return text;
  return String((namesById && namesById.get(text.toUpperCase())) || '').trim();
}
