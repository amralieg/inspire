// REQ-432: a value measured on some records, as a value per year for every eligible record. The one extrapolation both the measured
// path (GET /api/inspire/value/yearly) and the Calculate path (POST /api/inspire/value/estimate) use.
const PERIOD = 'Per Year';
const DAYS_IN_YEAR = 365;

const numberOf = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));

// amount measured on `sampled` records, scaled to `eligible` records, then from the `days` the data covers to a year. Null when any of
// the four is missing or not positive, so "not measured" is never shown as 0.
function extrapolate({ amount, sampled, eligible, days }) {
  const [a, s, e, d] = [amount, sampled, eligible, days].map(numberOf);
  if (![a, s, e, d].every(Number.isFinite) || s <= 0 || e <= 0 || d <= 0) return null;
  return (a / s) * e * (DAYS_IN_YEAR / d);
}

const VERBS = { increase: 'INCREASE', decrease: 'REDUCE', maintain: 'PROTECT' };
const RULE_VERBS = { losses: 'REDUCE LOSS', gains: 'INCREASE GAIN', net: 'NET VALUE' };

// The small-caps verb phrase: the KPI's direction and name (INCREASE REVENUE), the unit for time (SAVE HOURS), else the money rule.
function valueVerb({ kind, unit, direction, name, rule } = {}) {
  const upper = (text) => String(text || '').replace(/[_\s]+/g, ' ').trim().toUpperCase();
  if (kind === 'time' && unit) return `SAVE ${upper(unit)}`;
  const verb = VERBS[String(direction || '').toLowerCase()] || '';
  if (upper(name)) return verb ? `${verb} ${upper(name)}` : upper(name);
  if (RULE_VERBS[rule]) return RULE_VERBS[rule];
  return kind === 'count' && unit ? `${verb || 'REDUCE'} ${upper(unit)}` : 'VALUE AT STAKE';
}

// entries: [{kind, unit, amount}] measured on `sampled` records. Each entry scales on its own, so money stays per currency and unit.
function yearlyOf({ entries, sampled, eligible, days, kpi = null, rule }) {
  const scaled = (Array.isArray(entries) ? entries : []).map((e) => {
    const amount = e ? extrapolate({ amount: e.amount, sampled, eligible, days }) : null;
    return amount === null ? null : { kind: e.kind, unit: e.unit, amount };
  }).filter(Boolean);
  if (!scaled.length) return null;
  const first = scaled[0];
  return {
    verb: valueVerb({ kind: first.kind, unit: first.unit, direction: kpi && kpi.direction, name: kpi && kpi.name, rule }),
    period: PERIOD,
    estimated: true,
    entries: scaled,
    basis: { sampled_records: Number(sampled), eligible_records: Number(eligible), days: Number(days) },
  };
}

// The date columns of a table, the one detector for the single-case dialog and the bulk run: DATE and TIMESTAMP columns first, then a STRING
// column named like a date (a date kept as text).
const NAMED_DATE = /date|time|_at$|created/i;
function dateColumnsOf(columns) {
  const all = columns || [];
  const typed = all.filter((c) => /^(date|timestamp)/i.test(String(c.data_type || '')));
  const text = all.filter((c) => /^string/i.test(String(c.data_type || '')) && /date|timestamp|_at$/i.test(String(c.column_name)));
  return [...typed, ...text];
}

// The column that says how many days the data covers: the first one named like a date, else the first.
function dateColumnOf(columns) {
  const typed = dateColumnsOf(columns).filter((c) => !/^string/i.test(String(c.data_type || '')));
  const text = dateColumnsOf(columns).filter((c) => /^string/i.test(String(c.data_type || '')));
  const named = typed.find((c) => NAMED_DATE.test(String(c.column_name)));
  return String((named || typed[0] || text[0] || {}).column_name || '');
}

// The reason a table is skipped for a year-scaled value: its name and the columns that were checked.
function noDateReason(table, columns, doing) {
  const names = (columns || []).map((c) => String(c.column_name)).slice(0, 12);
  return `${table || 'The table'} has no date column to ${doing} to a year (columns checked: ${names.length ? names.join(', ') : 'none'}), so Inspire cannot work out a value per year.`;
}

module.exports = { PERIOD, extrapolate, valueVerb, yearlyOf, dateColumnOf, dateColumnsOf, noDateReason };
