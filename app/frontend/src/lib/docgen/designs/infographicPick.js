// C28 (REQ-571): the scenario picker. The App's model picks the best scenario for a use case and writes the story text and numbers into its
// slots (POST /api/inspire/docs/infographic-pick); when the model is unavailable or returns junk, a deterministic pick is made from the use case fields.
import { validatePick, SCENARIO_IDS, STORY_FIELDS } from '../../../../../backend/lib/infographicPick.mjs';

export { validatePick, SCENARIO_IDS };
const ROUTE = '/api/inspire/docs/infographic-pick';

const firstSentence = (text, max) => {
  const s = String(text ?? '').replace(/`/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s); const one = m ? m[1] : s;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};
const MONEY = /[$€£]\s?\d[\d.,]*\s?[KMB]?\+?|\b\d[\d.,]*\s?(?:%|[KMB]\b)\+?/;

// The pick the fields give when no model answers. Rules read the analytics technique and the stated value, never an industry.
export function fallbackPick(uc = {}) {
  const f = (k) => String(uc[k] ?? '').trim();
  const tech = `${f('Analytics Technique')} ${f('Name')} ${f('usecase')}`;
  const kpiHit = MONEY.exec(f('Business Value')) || MONEY.exec(f('Return on Investment'));
  let scenario = 'process_flow';
  if (/forecast|time.?series|predict|project|roadmap/i.test(tech)) scenario = 'timeline';
  else if (/recommend|network|graph|knowledge|relationship|link/i.test(tech)) scenario = 'hub_spokes';
  else if (/classif|segment|cluster|rank|scor|prioriti|filter/i.test(tech)) scenario = 'funnel';
  else if (/anomal|detect|monitor|optimi|automat|replace/i.test(tech)) scenario = 'before_after';
  else if (kpiHit) scenario = 'kpi_hero';
  const steps = [['The challenge', 'Statement'], ['The approach', 'Solution'], ['The technique', 'Analytics Technique']]
    .map(([title, k]) => ({ title, text: firstSentence(f(k), 160) })).filter((s, i) => s.text || i < 2);
  while (steps.length < 2) steps.push({ title: steps.length ? 'The approach' : 'The challenge', text: '' });
  const outcomes = [['Business value', 'Business Value'], ['Who benefits', 'Beneficiary']].map(([title, k]) => ({ title, text: firstSentence(f(k), 160) })).filter((o, i) => o.text || i === 0);
  const kpi = kpiHit ? { value: kpiHit[0].trim().slice(0, 16), label: 'stated value' } : null;
  return { scenario, title: f('Name') || f('usecase') || 'Use case', subtitle: f('Business Domain'), steps: steps.slice(0, 3), outcomes, ...(kpi ? { kpi } : {}) };
}

// One use case's pick: { pick, source: 'ai' | 'fallback' }. `post(route, body)` is the App's API helper; `where` is { inspire_database, warehouse_id, session_id }.
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
