// C28 (REQ-571): the one definition of the per use case infographic pick, shared by the App route (POST /api/inspire/docs/infographic-pick,
// which validates the model's reply) and the browser (which validates again and renders). Pure ES module; no industry, customer or workspace names.

// id, name, and when the scenario tells the story best. The model picks from this list; the browser draws each id as a designed SVG layout.
export const SCENARIOS = [
  { id: 'process_flow', name: 'Process to outcomes', when: 'a sequence of steps that turns inputs into outcomes (the default when nothing else fits)' },
  { id: 'before_after', name: 'Before and after', when: 'a problem that is replaced by a better way of working; it contrasts today with the result' },
  { id: 'funnel', name: 'Funnel', when: 'a wide set that is narrowed, scored, ranked or filtered down to the few that matter' },
  { id: 'hub_spokes', name: 'Hub and spokes', when: 'one central idea or capability that feeds or connects several surrounding parts' },
  { id: 'timeline', name: 'Timeline roadmap', when: 'phases or forecasts that unfold over time, such as a rollout or a prediction horizon' },
  { id: 'kpi_hero', name: 'KPI hero with drivers', when: 'one headline number, stated in the use case, that a few drivers explain' },
];
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);
export const LIMITS = { steps: [2, 5], outcomes: [1, 4], title: 120, subtitle: 140, itemTitle: 60, itemText: 220, kpiValue: 16, kpiLabel: 70, label: 40 };

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function items(list, [min, max]) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const it of list) {
    const o = typeof it === 'string' ? { title: it } : it && typeof it === 'object' ? it : null;
    const title = clean(o && o.title, LIMITS.itemTitle);
    if (!title) continue;
    out.push({ title, text: clean(o.text, LIMITS.itemText) });
  }
  return out.length >= min ? out.slice(0, max) : null;
}

// The reply as a usable pick, or null when it is not one. `forced` (a scenario the user chose) replaces the model's choice: user input wins.
export function validatePick(raw, forced = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const scenario = forced || raw.scenario;
  if (!SCENARIO_IDS.includes(scenario)) return null;
  const title = clean(raw.title, LIMITS.title);
  const steps = items(raw.steps, LIMITS.steps);
  const outcomes = items(raw.outcomes, LIMITS.outcomes);
  if (!title || !steps || !outcomes) return null;
  const pick = { scenario, title, steps, outcomes };
  const subtitle = clean(raw.subtitle, LIMITS.subtitle);
  if (subtitle) pick.subtitle = subtitle;
  const value = clean(raw.kpi && raw.kpi.value, LIMITS.kpiValue);
  if (value) pick.kpi = { value, label: clean(raw.kpi.label, LIMITS.kpiLabel) };
  const labels = {};
  for (const k of ['steps', 'outcomes']) { const t = clean(raw.labels && raw.labels[k], LIMITS.label); if (t) labels[k] = t; }
  if (Object.keys(labels).length) pick.labels = labels;
  if (Array.isArray(raw.before)) { const b = items(raw.before, [1, 5]); if (b) pick.before = b; }
  return pick;
}

// The use case fields the story is told from (never tables, owners or scores).
export const STORY_FIELDS = ['Name', 'usecase', 'Business Domain', 'Subdomain', 'Analytics Technique', 'Statement', 'Solution', 'Business Value', 'Beneficiary', 'Return on Investment', 'Time to Value'];

export function buildMessages({ useCase, vibe = '', scenario = '', orientation = '' }) {
  const list = SCENARIOS.map((s) => `- ${s.id}: ${s.name}; use when ${s.when}`).join('\n');
  const system = `You design a one-page infographic that tells the story of one data and AI use case. Pick the scenario that tells this use case's story best, then write the text for its slots. Reply with one JSON object only:
{"scenario": one of the ids, "title": short headline, "subtitle": optional one line, "steps": [2 to 5 items], "outcomes": [1 to 4 items], "kpi": {"value": "short number", "label": "what it measures"}, "labels": {"steps": "heading above the steps", "outcomes": "heading above the outcomes"}}
Each item is {"title": up to 6 words, "text": one sentence of at most 20 words}. Scenarios:
${list}
Rules: use only facts that are in the use case; never invent a number, and leave kpi out when the use case states none (kpi_hero then does not fit). Write in the language of the use case text. Keep every title and sentence short, because each sits in a small panel. User input wins: if a style note or a chosen scenario is given, follow it.${scenario ? ` The user chose the scenario "${scenario}": use it.` : ''}${orientation ? ` The page is ${orientation}.` : ''}`;
  const story = Object.fromEntries(STORY_FIELDS.filter((k) => useCase && useCase[k]).map((k) => [k, useCase[k]]));
  const user = `Use case:\n${JSON.stringify(story)}${vibe ? `\n\nStyle note from the user (tone, emphasis, audience): ${vibe}` : ''}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
