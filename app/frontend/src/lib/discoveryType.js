export const DISCOVERY_STANDARD = 'Standard Discovery';
export const DISCOVERY_AI_ENHANCED = 'AI Enhanced Discovery';
export const DISCOVERY_TYPE_VALID = [DISCOVERY_STANDARD, DISCOVERY_AI_ENHANCED];
export const DISCOVERY_TYPE_DEFAULT = DISCOVERY_STANDARD;
export const DISCOVERY_TYPE_ALIASES = {
  Standard: DISCOVERY_STANDARD,
  Deep: DISCOVERY_AI_ENHANCED,
  'Deep Discovery': DISCOVERY_AI_ENHANCED,
  'AI Enhanced': DISCOVERY_AI_ENHANCED,
};

export const DISCOVERY_RECOMMENDED = DISCOVERY_AI_ENHANCED;
export const DISCOVERY_BADGE = 'Recommended';
export const DISCOVERY_MODE_TEXT = {
  [DISCOVERY_STANDARD]: 'Counts your data to decide each use case, for example rows, dates, group sizes and past outcomes. None of these numbers is sent to the AI, which sees metadata only.',
  [DISCOVERY_AI_ENHANCED]: 'Runs the same counts and also shows them to the AI, so it can sharpen each use case. No data row is ever sent to the AI.',
};
export const DISCOVERY_PRIVACY = 'Only counts are read, never a data row, and the values of personal columns are never read. Standard Discovery keeps every count away from the AI. AI Enhanced Discovery shows the counts to the AI. The AI runs on Databricks model serving, so your data never leaves Databricks.';
export const DISCOVERY_PROMISE = {
  title: `${DISCOVERY_RECOMMENDED} is recommended: it gives the best results`,
  lines: [
    'It groups your data and counts each group, so every use case fits the data you really have.',
    'No row of your data is ever shared with the AI. The AI sees only metadata, such as table and column names, and those counts.',
  ],
};

export function discoveryTypeOf(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const folded = text.toLowerCase();
  const mode = DISCOVERY_TYPE_VALID.find((m) => m.toLowerCase() === folded);
  if (mode) return mode;
  const legacy = Object.keys(DISCOVERY_TYPE_ALIASES).find((k) => k.toLowerCase() === folded);
  return legacy ? DISCOVERY_TYPE_ALIASES[legacy] : null;
}

export function canonicalDiscoveryType(value) {
  return discoveryTypeOf(value) || DISCOVERY_TYPE_DEFAULT;
}

export function aiSeesAggregates(value) {
  return discoveryTypeOf(value) === DISCOVERY_AI_ENHANCED;
}
