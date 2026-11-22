// REQ-435: value that is not in the data. Validates the typed driver answers, prices each driver per year and adds them to the data part.
// The driver list, labels and inputs live in valueDrivers.json (shared with the Calculate dialog); only the arithmetic is here.
const DEF = require('./valueDrivers.json');

const DRIVERS = new Map(DEF.drivers.map((d) => [d.id, d]));
// REQ-476: one input, hours_saved. Saved answers with hours_before / hours_after still compute (before - after; a negative result is 0).
const hoursSaved = (i) => (i.hours_saved !== undefined && i.hours_saved !== null ? i.hours_saved : Math.max(0, i.hours_before - i.hours_after));
const AMOUNTS = {
  time_saved: (i) => i.events_per_year * i.people * hoursSaved(i) * i.cost_per_hour,
  productivity: (i) => (i.headcount * i.cost_per_person_year * i.gain_pct) / 100,
  revenue_uplift: (i) => (i.base_revenue_per_year * i.uplift_pct) / 100,
  cost_cut: (i) => (i.spend_per_year * i.cut_pct) / 100,
  risk_avoided: (i) => (i.incidents_per_year * i.cost_per_incident * i.reduction_pct) / 100,
};

const filled = (v) => v !== null && v !== undefined;
const numberOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const round2 = (n) => Math.round(n * 100) / 100;

function amountOf(id, inputs) {
  return AMOUNTS[id](inputs);
}

// Null when no driver is filled. Otherwise { drivers, currency, attribution_pct } with every number checked, or a 400 with one plain line.
function validate(answers, badRequest) {
  const raw = answers && typeof answers.drivers === 'object' && answers.drivers && !Array.isArray(answers.drivers) ? answers.drivers : {};
  const ids = Object.keys(raw).filter((id) => filled(raw[id]));
  if (!ids.length) return null;
  const drivers = {};
  for (const id of ids) {
    const def = DRIVERS.get(id);
    if (!def) throw badRequest(`"${id}" is not a value driver Inspire knows.`);
    const given = raw[id] && typeof raw[id] === 'object' ? raw[id] : {};
    drivers[id] = {};
    const legacy = id === 'time_saved' && !filled(given.hours_saved) && filled(given.hours_before) && filled(given.hours_after);
    for (const input of def.inputs) {
      if (legacy && input.id === 'hours_saved') continue;
      const n = numberOf(given[input.id]);
      const where = `${def.label}: "${input.label}"`;
      if (!filled(given[input.id]) || given[input.id] === '') throw badRequest(`${where} needs a number.`);
      if (!Number.isFinite(n) || n < 0) throw badRequest(`${where} must be a number of 0 or more.`);
      if (input.kind === 'pct' && n > 100) throw badRequest(`${where} must be between 0 and 100.`);
      drivers[id][input.id] = n;
    }
    if (legacy) {
      const b = numberOf(given.hours_before);
      const a = numberOf(given.hours_after);
      if (!Number.isFinite(b) || !Number.isFinite(a) || b < 0 || a < 0) throw badRequest(`${def.label}: hours today and hours with the use case must be numbers of 0 or more.`);
      drivers[id].hours_before = b;
      drivers[id].hours_after = a;
    }
  }
  const currency = String(answers.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('Choose the currency of the value as a three-letter code such as USD; the value drivers need one.');
  return { drivers, currency, attribution_pct: attributionOf(answers, badRequest) };
}

// The share of the whole total the use case earns, 0-100; 100 when the answer has none.
function attributionOf(answers, badRequest) {
  const a = DEF.attribution;
  const attribution = answers && filled(answers.attribution_pct) ? numberOf(answers.attribution_pct) : a.default;
  if (!Number.isFinite(attribution) || attribution < a.min || attribution > a.max) throw badRequest(`"${a.label}" must be a number between ${a.min} and ${a.max}.`);
  return attribution;
}

// data: { amount, unit? } is the from-data yearly amount in the answer currency. Returns the parts, the attribution and the total.
function combine({ drivers = {}, attribution_pct: attribution = DEF.attribution.default, currency, data = null }) {
  const parts = [];
  if (data && Number.isFinite(data.amount)) parts.push({ source: 'data', id: 'data', label: 'From the data', amount: round2(data.amount), unit: currency });
  for (const def of DEF.drivers) {
    if (drivers[def.id]) parts.push({ source: 'assumption', id: def.id, label: def.label, amount: round2(amountOf(def.id, drivers[def.id])), unit: currency });
  }
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  return { parts, attribution_pct: attribution, total: { unit: currency, amount: round2((sum * attribution) / 100) } };
}

// REQ-436: a driver priced per group. `fixed` are the typed (estimate) inputs; `dataAsks` are [{id, metric}] read from each group
// (metric "records" is the group's records_per_year). The amount is the sum over `groups`; a driver with no data ask is priced once.
function groupValue(group, metric) {
  const v = metric === 'records' ? group.records_per_year : group.metrics && group.metrics[metric];
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function amountOverGroups(id, fixed, dataAsks, groups) {
  if (!dataAsks.length) return amountOf(id, fixed);
  return groups.reduce((sum, g) => sum + amountOf(id, { ...fixed, ...Object.fromEntries(dataAsks.map((a) => [a.id, groupValue(g, a.metric)])) }), 0);
}

// The one figure a data ask shows for the included groups: the records or a sum-per-year metric summed, else a metric averaged with the records as weights.
function dataFigure(ask, groups, agg) {
  if (ask.metric === 'records' || agg === 'sum_per_year') return groups.reduce((s, g) => s + groupValue(g, ask.metric), 0);
  const total = groups.reduce((s, g) => s + groupValue(g, 'records'), 0);
  if (!total) return 0;
  return groups.reduce((s, g) => s + groupValue(g, ask.metric) * groupValue(g, 'records'), 0) / total;
}

module.exports = { amountOf, validate, attributionOf, combine, amountOverGroups, dataFigure, DEFINITION: DEF };
