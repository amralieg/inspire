// C29 (REQ-571, REQ-574): the one definition of the per use case infographic pick, shared by the App route (POST /api/inspire/docs/infographic-pick,
// which validates the model's reply) and the browser (which validates again and draws). Pure ES module; no industry, customer or workspace names.
// The 12 concepts are the ones the product owner approved from the gallery; the model picks the one whose shape matches the story and fills its fields.

const pair = 'an object {"value": a short number from the use case, "label": up to 8 words}';
// id, name, when it fits, the concept's own fields (described for the model) and the ones a pick of this concept must carry.
export const SCENARIOS = [
  { id: 'journey', name: 'Journey road', when: 'the story is a path with a slow or broken step: an item moves through stages and the analysis finds where it waits or drops', fields: { pain: `the slowest step, ${pair}` }, required: ['steps'] },
  { id: 'cycle', name: 'Loop wheel', when: 'the work repeats in a loop that learns: pick, act, measure, learn again (for example next-best actions that are sent and measured each cycle)', fields: { hub: `the headline result in the middle of the wheel, ${pair}` }, required: ['steps'] },
  { id: 'isometric', name: 'Data to decision scene', when: 'data flows through a model or a simulation into a range of scenarios and one decision screen; best for what-if, simulation and optimisation', fields: {}, required: ['steps'] },
  { id: 'pictogram', name: 'Unit chart', when: 'the story is a share of a whole that people should picture (a part of a population, of the items or of the value); 100 units, some filled', fields: { share: '{"value": a percentage 1-100 stated in the use case, "label": up to 8 words}' }, required: ['share'] },
  { id: 'beforeafter', name: 'Before and after', when: 'a manual, late or leaking way of working is replaced by a checked one; contrasts today with the result', fields: { before: 'two or three short lines about today', after: 'two or three short lines about the new way' }, required: ['before', 'after'] },
  { id: 'timeline', name: 'Forecast band', when: 'the value unfolds over time: a forecast, a trend or a horizon with a range', fields: { trend: `the change over the horizon, ${pair}` }, required: ['steps'] },
  { id: 'funnel', name: 'Funnel', when: 'a wide set is scored, ranked or filtered down to the few to act on', fields: { stages: 'three or four stages, wide to narrow, each {"value": a number from the use case, "label": up to 6 words}' }, required: ['stages'] },
  { id: 'hub', name: 'Hub and spokes', when: 'one central assistant, agent or capability answers from or connects several sources around it', fields: { center: 'the central thing, up to 5 words', spokes: 'three to six sources or parts around it, up to 5 words each' }, required: ['spokes'] },
  { id: 'map', name: 'Map with pins', when: 'the story is about places: sites, regions, routes or locations chosen or compared', fields: { places: 'three to five short lines about the places, up to 10 words each' }, required: ['places'] },
  { id: 'network', name: 'Network clusters', when: 'the story is about links between entities: groups, rings or communities found in a network', fields: { groups: 'three to six short facts about the groups, up to 6 words each', count: 'the number of groups if stated' }, required: ['groups'] },
  { id: 'waterfall', name: 'Waterfall bridge', when: 'one change in a number is split into the drivers that explain it (a bridge from start to end)', fields: { bars: 'two to five drivers, each {"label": up to 3 words, "value": the signed amount from the use case such as -$0.2M}', total: `the total change, ${pair}` }, required: ['bars'] },
  { id: 'balance', name: 'Balance and decision', when: 'a measured lift against a baseline decides between options such as keep, change or stop', fields: { options: 'two or three options, each {"label": up to 3 words, "value": the amount or effect from the use case}' }, required: ['options'] },
];
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);
export const LIMITS = { steps: [2, 5], title: 120, value: 18, label: 90, line: 110, list: [2, 6] };

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const strings = (list, [min, max], len = LIMITS.line) => {
  if (!Array.isArray(list)) return null;
  const out = list.map((x) => clean(x && typeof x === 'object' ? x.title || x.label || x.text : x, len)).filter(Boolean);
  return out.length >= min ? out.slice(0, max) : null;
};
const vpair = (o, needValue = true) => {
  if (!o || typeof o !== 'object') return null;
  const value = clean(o.value, LIMITS.value); const label = clean(o.label, LIMITS.label);
  return (needValue ? value : value || label) ? { value, label } : null;
};
const pairs = (list, [min, max]) => { if (!Array.isArray(list)) return null; const out = list.map((x) => vpair(x, false)).filter(Boolean); return out.length >= min ? out.slice(0, max) : null; };

// Each concept field: how it is read from the reply.
const FIELD = {
  pain: (r) => vpair(r.pain), hub: (r) => vpair(r.hub), trend: (r) => vpair(r.trend), total: (r) => vpair(r.total),
  share: (r) => { const n = Number(String(r.share && r.share.value).replace('%', '')); return Number.isFinite(n) && n > 0 && n <= 100 ? { value: Math.round(n), label: clean(r.share.label, LIMITS.label) } : null; },
  before: (r) => strings(r.before, [1, 3]), after: (r) => strings(r.after, [1, 3]),
  stages: (r) => pairs(r.stages, [2, 4]), bars: (r) => pairs(r.bars, [2, 5]), options: (r) => pairs(r.options, [2, 3]),
  center: (r) => clean(r.center, 60) || null, spokes: (r) => strings(r.spokes, [3, 6], 60), places: (r) => strings(r.places, [2, 5]),
  groups: (r) => strings(r.groups, [2, 6], 60), count: (r) => clean(r.count, LIMITS.value) || null,
};

// The reply as a usable pick, or null when it is not one. `forced` (a concept the user chose) replaces the model's choice: user input wins.
// A pick needs a title and 2-5 steps; a pick of a concept also needs that concept's required fields (when the model filled another concept
// and the user forced this one, the missing fields come from the use case when it is drawn).
export function validatePick(raw, forced = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!SCENARIO_IDS.includes(raw.scenario) || (forced && !SCENARIO_IDS.includes(forced))) return null;
  const scenario = forced || raw.scenario;
  const title = clean(raw.title, LIMITS.title); const steps = strings(raw.steps, LIMITS.steps);
  if (!title || !steps) return null;
  const pick = { scenario, title, steps };
  const hero = vpair(raw.hero); if (hero) pick.hero = hero;
  for (const k of ['who', 'cadence', 'problem']) { const t = clean(raw[k], k === 'problem' ? 200 : 60); if (t) pick[k] = t; }
  const spec = SCENARIOS.find((s) => s.id === raw.scenario);
  for (const k of Object.keys(spec.fields).concat(spec.required)) { if (k === 'steps') continue; const v = FIELD[k](raw); if (v) pick[k] = v; else if (spec.required.includes(k)) return null; }
  return pick;
}

// The use case fields the story is told from (never tables, owners or scores).
export const STORY_FIELDS = ['Name', 'usecase', 'Business Domain', 'Subdomain', 'Analytics Technique', 'Statement', 'Solution', 'Business Value', 'Beneficiary', 'Decision Cadence', 'Return on Investment', 'Time to Value'];

export function buildMessages({ useCase, vibe = '', scenario = '', orientation = '' }) {
  const list = SCENARIOS.map((s) => `- ${s.id} (${s.name}): fits when ${s.when}.${Object.keys(s.fields).length ? ` Its fields: ${Object.entries(s.fields).map(([k, d]) => `"${k}": ${d}`).join('; ')}.` : ''} Required: ${s.required.join(', ')}.`).join('\n');
  const system = `You design a one-page infographic that tells the story of one data and AI use case to a business reader. Pick the concept whose shape matches this use case's story best, then fill its fields from the use case. Reply with one JSON object only:
{"scenario": one of the concept ids, "title": the use case headline (up to 8 words), "problem": one sentence, "hero": {"value": the headline number stated in the use case, "label": what it is, up to 8 words}, "steps": [2 to 5 short steps of how it works, up to 10 words each], "who": who uses it, "cadence": how often they act, plus the chosen concept's own fields}
Concepts:
${list}
Rules: business text only; never a table, column, SQL or technical name. Use only facts that are in the use case and never invent a number; leave a field out when the use case states none. Write in the language of the use case text. Keep every line short, because each sits in a small space on the page. User input wins: if a style note or a chosen concept is given, follow it.${scenario ? ` The user chose the concept "${scenario}": use it and fill its fields.` : ''}${orientation ? ` The page is ${orientation}.` : ''}`;
  const story = Object.fromEntries(STORY_FIELDS.filter((k) => useCase && useCase[k]).map((k) => [k, useCase[k]]));
  const user = `Use case:\n${JSON.stringify(story)}${vibe ? `\n\nStyle note from the user (tone, emphasis, audience): ${vibe}` : ''}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
