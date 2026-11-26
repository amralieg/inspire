import { moneyText } from './valueWizard.js';
import { plural } from './plural.js';

// REQ-507 L6 (pure): the value story. A deterministic template writes the headline and 5 lines from the numbers, an AI polish is kept only
// when it returns every number unchanged, every parameter is listed with its source tag and an owner, and the approval holds only while the
// approved parameters are unchanged. The browser never stamps who approved or when; the server does.

export const STORY_LABELS = ['Today', 'Data', 'Change', 'Return', 'Ask'];
export const SOURCE_TAGS = { data: 'DATA', you: 'YOU', ai: 'AI', public: 'PUBLIC' };
export const DEFAULT_RAMP = [40, 80, 100];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
};
const months = (n) => plural(Number(n), 'month');

function dataLine(scope, noun) {
  if (!scope || !Number.isFinite(Number(scope.rows_after))) return 'The data scope has not been set yet.';
  const word = noun || 'record';
  const first = dayText(scope.first || scope.window?.start);
  const last = dayText(scope.last || scope.window?.end);
  // RC7-B-04: one day is "on 3 Jun 2024", never "from 3 Jun 2024 to 3 Jun 2024".
  const span = first && last ? (first === last ? ` on ${first}` : `, from ${first} to ${last}`) : '';
  const total = Number(scope.rows_before);
  const of = Number.isFinite(total) && total !== Number(scope.rows_after) ? ` of ${total.toLocaleString('en-US')}` : '';
  return `Inspire read ${Number(scope.rows_after).toLocaleString('en-US')}${of} ${word}s${span}.`;
}

// The headline and the 5 lines, the same every time for the same numbers. text is what a document can quote.
export function storyOf({ useCase, noun, currency, scope, drivers = [], projection, economics = {}, tuned = false } = {}) {
  const money = (n) => moneyText(currency, n);
  const years = projection?.years || [];
  const full = years.length ? years[years.length - 1].likely : null;
  const name = String(useCase || 'This use case');
  const headline = full == null ? `${name} could create value once the numbers are set.` : `${name} could be worth about ${money(full)} a year at full ramp.`;
  const labels = drivers.map((d) => d.label).filter(Boolean);
  let ret = 'The return is not calculated yet.';
  if (projection && Number.isFinite(Number(projection.net_3y))) {
    ret = projection.gross_only
      ? `About ${money(projection.gross_3y)} gross over 3 years, before any cost.`
      : `About ${money(projection.net_3y)} net over 3 years after cost${Number.isFinite(Number(projection.payback_months)) && projection.payback_months != null ? `, paying back in ${months(projection.payback_months)}` : ''}.`;
  }
  const build = Number(economics.build_cost || 0);
  const run = Number(economics.run_cost_per_year || 0);
  const ask = build || run
    ? `${money(build)} to build and ${money(run)} a year to run.`
    : 'No cost has been entered, so the value above is gross.';
  const lines = [
    { label: 'Today', text: `${name} is not in place yet, so its value is not captured.` },
    { label: 'Data', text: `${dataLine(scope, noun)}${tuned && scope && Number.isFinite(Number(scope.rows_after)) ? ' Tuned from data.' : ''}` },
    { label: 'Change', text: labels.length ? `It changes ${labels.join(', ')}.` : 'No value driver is turned on yet.' },
    { label: 'Return', text: ret },
    { label: 'Ask', text: ask },
  ];
  return { headline, lines, text: [headline, ...lines.map((l) => `${l.label}: ${l.text}`)].join('\n') };
}

// Every number in a text, as written without its sign, currency symbol, unit letter or percent: "$1.2M" is "1.2", "1,198,406" stays.
export function numbersIn(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,+$/, ''));
}
// A polish is kept only when it holds exactly the numbers of the draft (any order). Otherwise the draft stays.
export function polishOk(draft, polish) {
  if (typeof polish !== 'string' || !polish.trim()) return false;
  const a = numbersIn(draft).sort();
  const b = numbersIn(polish).sort();
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

// Each parameter once: Data from the rows, You when typed, AI when the default is kept, Public for a market series.
export function paramsOf(plan, answers = {}, yearly, owners = answers?.story?.owners || {}) {
  const out = [];
  const add = (p) => out.push({ ...p, owner: owners[p.id] ?? '' });
  const seen = new Set();
  for (const d of plan?.drivers || []) {
    if (!answers.drivers?.[d.id]?.on) continue;
    const measured = (yearly?.parts || []).find((p) => p.id === d.id)?.inputs || [];
    for (const a of d.asks || []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const typed = answers.drivers[d.id].inputs?.[a.id];
      const base = { id: a.id, label: a.label, kind: a.kind, driver: d.id };
      if (a.source === 'data') add({ ...base, source: 'data', value: measured.find((i) => i.id === a.id)?.value ?? null });
      else {
        const kept = typed == null || Number(typed) === Number(a.default);
        add({ ...base, source: kept ? 'ai' : 'you', value: typed ?? a.default ?? null });
      }
    }
  }
  for (const f of plan?.economic_factors || []) {
    const s = f.source;
    add({ id: f.id, label: f.label, kind: 'pct', source: s ? 'public' : 'ai', value: f.likely_pct ?? null,
      ...(s ? { note: [s.name, s.indicator, s.country].filter(Boolean).join(', ') } : {}) });
  }
  const e = answers.economics || {};
  add({ id: 'ramp_pct', label: 'Share captured each year (%)', kind: 'pct', source: 'you', value: e.ramp_pct || DEFAULT_RAMP });
  add({ id: 'build_cost', label: 'Build cost (one-off)', kind: 'money', source: 'you', value: Number(e.build_cost || 0) });
  add({ id: 'run_cost_per_year', label: 'Run cost per year', kind: 'money', source: 'you', value: Number(e.run_cost_per_year || 0) });
  return out;
}

// A short stable hash of the parameter ids and values; an owner or a note is not a parameter.
export function paramsHash(params) {
  const body = JSON.stringify([...(params || [])].map((p) => [p.id, p.value]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
  let h = 5381;
  for (let i = 0; i < body.length; i += 1) h = ((h * 33) ^ body.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// What the browser sends. No who and no when: the server stamps the approval.
export const storyAnswers = ({ text, params, include_in_docs = true }) => ({ approved: true, include_in_docs: include_in_docs !== false, text: String(text || ''), params_hash: paramsHash(params) });
export const approvalHolds = (story, params) => Boolean(story?.approved && story.params_hash && story.params_hash === paramsHash(params));
