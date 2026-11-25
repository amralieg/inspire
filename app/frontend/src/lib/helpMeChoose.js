import { fieldOf, sponsorFromUc } from './useCaseFields.js';

// REQ-538 "Help me choose": six business questions whose options and counts all come from the loaded use cases.
// answers is { [questionId]: [optionKey, ...] }; a missing or empty entry means the question was not answered (or skipped).

const text = (v) => (Array.isArray(v) ? v.join(', ') : v == null || typeof v === 'object' ? '' : String(v)).trim();
const numberOf = (v) => {
  const s = text(v);
  const n = s === '' ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};
const listOf = (v) => text(v).split(',').map((s) => s.trim()).filter(Boolean);
const keyOf = (label) => label.toLowerCase();
const isRow = (uc) => Boolean(uc) && typeof uc === 'object';

// Every use case holds a list of labels for a "pick from what exists" question; the key is the lower-cased label.
const labelsOf = {
  goals: (uc) => {
    const goals = listOf(fieldOf(uc, 'Strategic Goals Alignment', 'strategic_goals_alignment'));
    return goals.length ? goals : listOf(fieldOf(uc, 'Business Priority Alignment', 'business_priority_alignment'));
  },
  domain: (uc) => listOf(uc._domain || fieldOf(uc, 'Business Domain', 'business_domain')),
  sponsor: (uc) => listOf(sponsorFromUc(uc)),
};

const GROW = ['opportunity', 'improvement'];
const PROTECT = ['risk', 'problem'];
const typeOf = (uc) => text(fieldOf(uc, 'Type', 'type'));

const scoreOf = (uc, display, tracking) => numberOf(fieldOf(uc, display, tracking));
const readinessOf = (uc) => {
  const parts = [scoreOf(uc, 'Data Availability', 'data_availability'), scoreOf(uc, 'Team Skills', 'team_skills')].filter((n) => n != null);
  return parts.length ? Math.min(...parts) : null;
};

// Fixed-choice questions: each option is { key, label, test(uc) }.
const TIME_OPTIONS = [
  { key: 'quarter', label: 'This quarter', test: (uc) => (scoreOf(uc, 'Time to Value', 'time_to_value') ?? -1) >= 4 },
  { key: 'half', label: 'Within 6 months', test: (uc) => (scoreOf(uc, 'Time to Value', 'time_to_value') ?? -1) >= 3.5 },
  { key: 'any', label: 'Bigger bets are fine', test: () => true },
];
const READY_OPTIONS = [
  { key: 'today', label: 'Use what we have today', test: (uc) => (readinessOf(uc) ?? -1) >= 4 },
  { key: 'any', label: 'We can invest in data and skills', test: () => true },
];

const QUESTIONS = [
  { id: 'goals', title: 'What does the business need most right now?', multi: true },
  { id: 'domain', title: 'Which part of the business should move first?', multi: true },
  { id: 'sponsor', title: 'Who will sponsor it?', multi: true },
  { id: 'type', title: 'Grow, or protect?', multi: false },
  { id: 'time', title: 'How soon do you need results?', multi: false },
  { id: 'ready', title: 'How ready are your data and team?', multi: false },
];

// The options of one question, built from the rows of the whole list: { key, label, test(uc) }.
function optionsOf(id, rows) {
  if (labelsOf[id]) {
    const seen = new Map();
    for (const uc of rows) for (const label of labelsOf[id](uc)) if (!seen.has(keyOf(label))) seen.set(keyOf(label), label);
    return [...seen].map(([key, label]) => ({ key, label, test: (uc) => labelsOf[id](uc).some((l) => keyOf(l) === key) }));
  }
  if (id === 'type') {
    const known = (uc) => [...GROW, ...PROTECT].includes(typeOf(uc).toLowerCase());
    const others = new Map();
    for (const uc of rows) if (typeOf(uc) && !known(uc) && !others.has(keyOf(typeOf(uc)))) others.set(keyOf(typeOf(uc)), typeOf(uc));
    return [
      { key: 'grow', label: 'Grow', test: (uc) => GROW.includes(typeOf(uc).toLowerCase()) },
      { key: 'protect', label: 'Protect', test: (uc) => PROTECT.includes(typeOf(uc).toLowerCase()) },
      { key: 'both', label: 'Both', test: () => true },
      ...[...others].map(([key, label]) => ({ key: `other:${key}`, label, test: (uc) => keyOf(typeOf(uc)) === key })),
    ];
  }
  return id === 'time' ? TIME_OPTIONS : READY_OPTIONS;
}

// Does any row carry the field this question reads? When none does, the question is dropped.
const hasField = {
  goals: (uc) => labelsOf.goals(uc).length > 0,
  domain: (uc) => labelsOf.domain(uc).length > 0,
  sponsor: (uc) => labelsOf.sponsor(uc).length > 0,
  type: (uc) => typeOf(uc) !== '',
  time: (uc) => scoreOf(uc, 'Time to Value', 'time_to_value') != null,
  ready: (uc) => readinessOf(uc) != null,
};

const chosen = (answers, id) => (Array.isArray(answers?.[id]) ? answers[id] : []);
const matchesAny = (options, keys, uc) => options.some((o) => keys.includes(o.key) && o.test(uc));

// The six questions in order, each with its options and the count left if that option alone is picked (given the earlier answers).
// `skipped` is true when the question would not narrow anything (every option leaves the whole current list, or nothing has the field).
export function wizardSteps(useCases, answers = {}) {
  const rows = (Array.isArray(useCases) ? useCases : []).filter(isRow);
  let current = rows;
  return QUESTIONS.map((q) => {
    const all = optionsOf(q.id, rows);
    const options = all.map((o) => ({ key: o.key, label: o.label, count: current.filter((uc) => o.test(uc)).length }))
      .map((o) => ({ ...o, disabled: o.count === 0 }));
    if (labelsOf[q.id]) options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const present = rows.some(hasField[q.id]);
    const skipped = !present || options.length === 0 || options.every((o) => o.count === current.length);
    const base = current.length;
    const keys = chosen(answers, q.id);
    if (!skipped && keys.length) current = current.filter((uc) => matchesAny(all, keys, uc));
    return { ...q, options, base, skipped, after: current.length, picked: !skipped && keys.length > 0 };
  });
}

// The use cases left once every answer is applied (a skipped question never narrows).
export function pickedAfter(useCases, answers = {}) {
  const rows = (Array.isArray(useCases) ? useCases : []).filter(isRow);
  const steps = wizardSteps(rows, answers);
  return QUESTIONS.reduce((current, q, i) => {
    const keys = chosen(answers, q.id);
    if (steps[i].skipped || !keys.length) return current;
    const all = optionsOf(q.id, rows);
    return current.filter((uc) => matchesAny(all, keys, uc));
  }, rows);
}

// The answers given so far, each with the count it left: [{ id, label, count }].
export function trailOf(steps, answers = {}) {
  return steps.filter((s) => s.picked).map((s) => ({
    id: s.id,
    label: s.options.filter((o) => chosen(answers, s.id).includes(o.key)).map((o) => o.label).join(', '),
    count: s.after,
  }));
}
