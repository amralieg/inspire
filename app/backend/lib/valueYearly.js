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

// The date column that says how many days the data covers: the first DATE or TIMESTAMP column, one named like a date first.
function dateColumnOf(columns) {
  const dated = (columns || []).filter((c) => /^(date|timestamp)/i.test(String(c.data_type || '')));
  const named = dated.find((c) => /date|time|_at$|created/i.test(String(c.column_name)));
  return String((named || dated[0] || {}).column_name || '');
}

module.exports = { PERIOD, extrapolate, valueVerb, yearlyOf, dateColumnOf };
