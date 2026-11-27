// C28, C29 (REQ-571): the concept picker. The App's model picks the best scenario for a use case and writes the story text and numbers into its
// slots (POST /api/inspire/docs/infographic-pick); when the model is unavailable or returns junk, a deterministic pick is made from the use case fields.
import { validatePick, SCENARIO_IDS, STORY_FIELDS } from '../../../../../backend/lib/infographicPick.mjs';
import { baseContent, contentFor } from './infog/content.js';

export { validatePick, SCENARIO_IDS };
const ROUTE = '/api/inspire/docs/infographic-pick';

// The "when it fits" rules (backend SCENARIOS) read on the analytics technique, the use case kind and the name, and on the shape of the stated
// facts; never on an industry word. The first rule that fits wins; the data to decision scene fits every use case.
const RULES = [
  ['map', /\b(geo\w*|spatial|sites?|locations?|territor\w*)\b/i],
  ['network', /\b(network|graph|rings?|communit\w*)\b/i],
  ['hub', /\b(agent|assistant|questions?|chat|search|knowledge)\b/i],
  ['journey', /\b(process mining|journey|path|workflow)\b/i],
  ['waterfall', /\b(decompos\w*|bridge|variance|breakdown)\b/i, (c) => c.facts.filter((f) => f.unit === '$').length >= 2],
  ['balance', /\b(causal|uplift|lift|experiment\w*|impact|benchmark\w*|peers?|compar\w*)\b/i],
  ['timeline', /\b(forecast\w*|time series)\b/i],
  ['cycle', /\b(recommend\w*|next best|personali\w*|offers?)\b/i],
  ['funnel', /\b(classif\w*|propensity|churn|rank\w*|scor\w*|prioriti\w*)\b/i],
  ['beforeafter', /\b(controls?|anomal\w*|detect\w*|leak\w*|reconcil\w*|audit\w*)\b/i],
  ['pictogram', /\b(segment\w*|cluster\w*|survival|cohorts?)\b/i, (c) => c.facts.some((f) => f.unit === '%')],
];
const pair = (o) => (o && (o.value || o.label) ? { value: String(o.value ?? ''), label: String(o.label ?? '') } : undefined);
// A concept's drawn content as the pick the model would have written (so the browser validates both the same way).
function asPick(id, c) {
  const p = { scenario: id, title: c.title, steps: c.steps.map((s) => s.label), ...(c.hero ? { hero: pair(c.hero) } : {}), who: c.who, cadence: c.cadence, problem: c.problem };
  const add = { pain: pair(c.pain), hub: pair(c.hub), trend: pair(c.trend), share: c.share ? { value: c.share.value, label: c.share.label } : undefined, before: c.before, after: c.after,
    stages: c.stages && c.stages.map(pair), center: c.center, spokes: c.spokes, places: c.places, groups: c.groups, count: c.count || undefined,
    bars: c.bars && c.bars.map((b) => ({ label: b.label, value: b.value })), total: pair(c.total), options: c.options && c.options.map((o) => ({ label: o.label, value: o.value })) };
  for (const [k, v] of Object.entries(add)) if (v !== undefined && v !== null) p[k] = v;
  return p;
}

// The pick the use case gives when no model answers: { scenario, title, steps, hero, who, cadence, problem, ...the concept's fields }.
export function fallbackPick(uc = {}) {
  const row = uc && typeof uc === 'object' ? uc : {};
  const text = ['Analytics Technique', 'kind_label', 'Name'].map((k) => String(row[k] ?? '')).join(' | ');
  const base = baseContent(row);
  const rule = RULES.find(([, re, ok]) => re.test(text) && (!ok || ok(base)));
  for (const id of [rule ? rule[0] : 'isometric', 'isometric']) { const p = validatePick(asPick(id, contentFor(row, id))); if (p) return p; }
  // A use case too thin for any concept's fields still keeps the concept its kind fits when that concept needs only steps.
  const id = rule && validatePick({ scenario: rule[0], title: 't', steps: ['a', 'b'] }) ? rule[0] : 'isometric';
  return { scenario: id, title: base.title || 'Use case', steps: ['Read the data', 'Show the decision'], ...(base.hero ? { hero: { value: base.hero.value, label: base.hero.label || '' } } : {}) };
}

// One use case's pick: { pick, source: 'ai' | 'fallback' }. `post(route, body)` is the App's API helper; `where` names the database, the SQL compute and the session.
export async function pickInfographic(useCase, { post, vibe = '', scenario = '', orientation = '', where = {} } = {}) {
  const fallback = () => ({ pick: fallbackPick(useCase), source: 'fallback' });
  if (typeof post !== 'function') return fallback();
  const story = Object.fromEntries(STORY_FIELDS.filter((k) => useCase && typeof useCase[k] === 'string' && useCase[k]).map((k) => [k, useCase[k]]));
  try {
    const res = await post(ROUTE, { ...where, use_case: story, ...(vibe ? { vibe } : {}), ...(scenario ? { scenario } : {}), ...(orientation ? { orientation } : {}) });
    const pick = validatePick(res && res.pick, scenario);
    return pick ? { pick, source: 'ai' } : fallback();
  } catch (_) { return fallback(); }
}
