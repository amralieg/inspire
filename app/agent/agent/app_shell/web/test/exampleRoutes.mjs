import { actBody, DECIDE } from './harness.mjs';

const WEEKS = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 6, 6 + i * 7)).toISOString().slice(0, 10));
export const fanRows = WEEKS.map((x, i) => (i < 12 ? { x, y0: 900 + i * 10, y1: null, y2: null, y3: null }
  : { x, y0: null, y1: 1000 + i * 5, y2: 900 + i * 4, y3: 1100 + i * 6 }));

function forecastData() {
  return {
    kpis: { next_forecast: { now: 8400 }, last_actual: { now: 11500 }, at_risk_n: { now: 3 }, orders_open: { now: 7 } },
    charts: {
      fan: { columns: [], rows: fanRows, truncated: false },
      vs_capacity: { columns: [], rows: WEEKS.slice(12).map((x, i) => ({ x, y0: 1000 + i * 5, y1: 1100 + i * 6, y2: 1120 })), truncated: false },
      accuracy: { columns: [], rows: ['Oat bar', 'Rye loaf', 'Tea tin'].map((x, i) => ({ x, y0: 1.4 - i * 0.4 })), truncated: false },
    },
    tables: { at_risk: { columns: [], rows: [{ series_label: 'Oat bar', category: 'Snacks', backtest_mase: 1.4, next_forecast: 900, upside: 220 }], truncated: false } },
    errors: {},
  };
}

const ROWS = ['Oat bar', 'Rye loaf', 'Tea tin', 'Fig jam', 'Soy milk', 'Rice cake'].map((label, i) => ({
  record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(500 + i), entity_id: `I${i + 1}`, entity_label: label, category: 'Snacks',
  priority_tier: 'Act now', rank: i + 1, value: 9000 - i * 1000, current_order: 100 + i * 10, recommended_order: 120 + i * 10,
  recommended_action: 'Raise the order', top_reasons: ['demand rising'], as_of_date: '2026-10-15',
}));

export function forecastRoutes(decided, { keep = false } = {}) {
  const lines = ROWS.map((r) => ({ ...r }));
  return {
    page: ({ json }) => json(200, forecastData()),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      const closed = lines.filter((r) => r._inspire_status === 'Done').length;
      return json(200, { rows: lines.slice(0, body.limit || 25), total: lines.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        summary: keep ? { open: lines.length - closed, done: closed, resolved: 0, left: lines.length - closed, owners: [] } : { open: 7, done: 3, resolved: 0, left: 7, owners: [] }, errors: {} });
    },
    'plan/decide': ({ route, json }) => {
      const body = route.request().postDataJSON();
      decided.push(body);
      const line = keep && lines.find((r) => r.record_key === body.record_key);
      if (line) Object.assign(line, { _inspire_status: 'Done', _inspire_closed_note: planNote(body), _inspire_version: String(Number(line._inspire_version) + 100) });
      return json(200, { written: [body.record_key], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b1', decision: body.decision, edited: false });
    },
  };
}

const LIMITS = [{ x: 'Oven hours', y0: 99, y1: 100 }, { x: 'Flour', y0: 40, y1: 100 }, { x: 'Staff', y0: 70, y1: 90 }];
const PLAN_ROWS = ROWS.map((r, i) => ({ ...r, current_value: 100 + i * 10, recommended_value: 90 + i * 20, delta: i * 20 - 10, objective_contribution: 4000 - i * 500 }));

const planNote = (body) => (body.decision === 'accept' ? `Accepted the recommended ${body.recommended}`
  : `Override to ${body.value} instead of ${body.recommended}: ${body.reason}`);

export function plannerRoutes(decided, solved, { keep = false, actions = true } = {}) {
  const lines = PLAN_ROWS.map((r) => ({ ...r }));
  return {
    page: ({ json }) => json(200, {
      kpis: { objective: { now: 11000 }, changed: { now: 3 }, binding: { now: 1 } },
      charts: {
        limits_used: { columns: [], rows: LIMITS, truncated: false },
        swing: { columns: [], rows: LIMITS.map((r, i) => ({ x: r.x, y0: -100 * (i + 1), y1: 100 * (i + 1) })), truncated: false },
        worth: { columns: [], rows: LIMITS.map((r, i) => ({ x: r.x, y0: 12 - i * 4 })), truncated: false },
      },
      tables: {}, errors: {},
    }),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      const closed = lines.filter((r) => r._inspire_status === 'Done').length;
      return json(200, { rows: lines.slice(0, body.limit || 25), total: lines.length, offset: 0, limit: body.limit || 25, actions, changes: false,
        summary: keep ? { open: lines.length - closed, done: closed, resolved: 0, left: lines.length - closed, owners: [] } : { open: 2, done: 1, resolved: 0, left: 2, owners: [] }, errors: {} });
    },
    'plan/decide': ({ route, json }) => {
      const body = route.request().postDataJSON();
      decided.push(body);
      const line = keep && lines.find((r) => r.record_key === body.record_key);
      if (line) Object.assign(line, { _inspire_status: 'Done', _inspire_closed_note: planNote(body), _inspire_version: String(Number(line._inspire_version) + 100) });
      return json(200, { written: [body.record_key], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b1', decision: body.decision, edited: false });
    },
    refresh: ({ route, json }) => {
      solved.push(route.request().postDataJSON());
      return json(200, { run_id: '77', state: 'pending' });
    },
  };
}

const SCENARIOS = [['base', 5000000, 4600000, 5400000, 0.31], ['upside', 5600000, 5100000, 6000000, 0.7], ['downside', 4400000, 4000000, 4800000, 0.05]]
  .map(([scenario_id, p50, p10, p90, prob_target]) => ({ scenario_id, p10, p50, p90, prob_target, chance_pct: prob_target * 100 }));

export function evaluated(values) {
  const levers = [['price', 12, 0.4e6], ['volume', 400000, 9], ['unit_cost', 7, -0.4e6]].map(([lever, base, k]) => ({ lever, base, low: base * 0.9, high: base * 1.1, value: values[lever] ?? base, k }));
  const p50 = 5000000 + levers.reduce((s, l) => s + l.k * (l.value - l.base), 0);
  return { levers: levers.map(({ k, ...l }) => l), clamped: [], contributions: levers.map((l) => ({ lever: l.lever, delta: l.k * (l.value - l.base) })),
    distribution: Array.from({ length: 41 }, (_, i) => [p50 - 400000 + i * 20000, Math.exp(-0.5 * ((i - 20) / 6) ** 2)]),
    outcome: { p10: p50 - 400000, p50, p90: p50 + 400000, prob_target: p50 >= 5200000 ? 0.6 : 0.3, target: 5200000 } };
}

export function scenarioRoutes(asked, saved) {
  return {
    page: ({ json }) => json(200, {
      kpis: { base_p50: { now: 5000000 }, base_chance: { now: 31 }, last_margin: { now: 4800000, before: 4700000 } },
      charts: { swing: { columns: [], rows: [{ x: 'price', y0: -480000, y1: 480000 }, { x: 'volume', y0: -360000, y1: 360000 }, { x: 'unit_cost', y0: -280000, y1: 280000 }], truncated: false } },
      tables: { scenarios: { columns: [], rows: SCENARIOS, truncated: false } }, errors: {},
    }),
    'scenario/evaluate': ({ route, json }) => {
      const body = route.request().postDataJSON();
      asked.push(body);
      return json(200, evaluated(body.values || {}));
    },
    'records/add': ({ route, json }) => {
      saved.push(route.request().postDataJSON());
      return json(200, { record_key: 'S1', versions: [], fields: [] });
    },
  };
}

export const AS_OF = String(Date.UTC(2026, 0, 1) * 1000);
const row = (i, extra) => ({ record_key: `K${i}`, _inspire_key: `K${i}`, _inspire_version: String(700 + i), entity_id: `E${i}`, priority_tier: 'Act now',
  rank: i, value: 5000 - i * 100, as_of_date: '2026-10-15', top_reasons: ['spend fell', 'visits fell'], ...extra });

const SEGMENTS = [['S1', 'Loyal regulars', 420, 1200, 'Loyalty upgrade'], ['S2', 'Lapsing families', 380, 640, 'Win-back offer'],
  ['S3', 'New and curious', 150, 300, 'Leave as is'], ['S4', 'Bargain hunters', 260, 410, 'Win-back offer']];
export const MEMBERS = Array.from({ length: 12 }, (_, i) => row(i + 1, { entity_label: `Customer ${i + 1}`, segment: SEGMENTS[i % 4][0], segment_label: SEGMENTS[i % 4][1],
  recommended_action: 'Keep them', region: 'North', channel: 'Online', ...(i === 5 ? { _inspire_status: 'Dismissed', _inspire_closed_reason: 'Moved away' } : {}) }));
const CUSTOMERS = ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'];
const OFFERS = ['Travel card', 'Savings plan', 'Phone upgrade'];
const RECS = CUSTOMERS.flatMap((name, c) => OFFERS.map((item, k) => row(c * 3 + k + 1, { entity_label: item, item, customer_name: name, customer_id: `C${c}`,
  rank: k + 1, score: 0.9 - k * 0.2, recommended_action: k < 2 ? 'Send this offer' : 'Skip it: low fit', top_reasons: [`bought ${item.split(' ')[0].toLowerCase()} before`] })));
const PROMOS = [['Spring bundle', 'Scale it: strong net lift'], ['Loyalty points', 'Keep it as it is'], ['Free delivery', 'Change the threshold'],
  ['Flash sale', 'Stop it: no real lift']].map(([label, action], i) => row(i + 1, { entity_label: label, entity_id: label, recommended_action: action,
  effect: 12 - i * 4, roi: 140 - i * 50, incremental_value: 90000 - i * 30000, channel: 'Online' }));

export const statusOf = (r) => r._inspire_status || 'New';

function listed(rows, body) {
  const statuses = body.column_filters?.action_status;
  const words = String(body.search || '').toLowerCase();
  return rows.filter((r) => Object.entries(body.filters || {}).every(([k, v]) => !Array.isArray(v) || !v.length || k === 'run_date' || v.includes(r[k])))
    .filter((r) => !statuses?.length || statuses.includes(statusOf(r)))
    .filter((r) => !words || [r.entity_label, r.customer_name, r.record_key].some((v) => String(v ?? '').toLowerCase().includes(words)));
}

const CARD_PICKS = { segment_cards: 'segment_id', effect_card: 'intervention' };

function scoped(spec, data, body) {
  const tables = Object.fromEntries(Object.entries(data.tables || {}).map(([id, result]) => {
    const table = (spec.tables || []).find((t) => t.id === id);
    const dataset = table?.dataset;
    const narrowed = (spec.filters || []).reduce((rows, f) => {
      const column = f.columns?.[dataset];
      if (column && column === CARD_PICKS[table?.section]) return rows;
      const wanted = Array.isArray(body.filters?.[f.id]) ? body.filters[f.id].map(String) : [];
      return column && wanted.length ? rows.filter((r) => wanted.includes(String(r[column]))) : rows;
    }, result.rows);
    return [id, { ...result, rows: narrowed }];
  }));
  return { ...data, tables };
}

function treatmentsOf(rows) {
  const counted = new Map();
  rows.filter((r) => r._treatment).forEach((r) => {
    const key = `${r.segment}\u0001${r._treatment}`;
    counted.set(key, { segment: r.segment, treatment: r._treatment, n: (counted.get(key)?.n || 0) + 1 });
  });
  return [...counted.values()].sort((a, b) => b.n - a.n || a.segment.localeCompare(b.segment));
}

export const unlinkedRecords = (routes) => ({ ...routes,
  records: (arg) => routes.records({ ...arg, json: (status, data) => arg.json(status, { ...data, actions: false }) }) });

export function kindRoutes(data, rows, acts, spec = {}, extra = {}, unread = false) {
  return {
    page: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.pages.push(body);
      return json(200, scoped(spec, data, body));
    },
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const found = listed(rows, body);
      return json(200, { rows: found.slice(0, body.limit || 25), total: found.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        as_of_us: AS_OF, summary: { open: found.length, done: 0, resolved: 0, left: found.length, owners: [] }, errors: {},
        ...(body.treatments ? { treatments: unread ? null : treatmentsOf(rows) } : {}),
        ...(body.treatments && unread ? { errors: { treatments: '[SQL_ERROR] the treatment count failed' } } : {}) });
    },
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      acts.push(body);
      const hit = body.match ? listed(rows, { ...body.match.view, filters: body.match.filters }) : [];
      hit.forEach((r) => Object.assign(r, { _inspire_status: body.values.action_status, ...(body.treatment ? { _treatment: body.treatment } : {}) }));
      return json(200, { written: hit.length ? hit.map((r) => r.record_key) : body.record_keys || ['K1', 'K5', 'K9'], conflicts: [], batch_id: `b${acts.length}` });
    },
    ...extra,
  };
}

const segmentData = () => ({
  kpis: { members: { now: 1210 }, segments: { now: 4 }, value: { now: 812000 } },
  charts: {
    profile: { columns: [], rows: ['Orders a year', 'Basket size', 'Months as a customer', 'Days since last order'].flatMap((x, f) => SEGMENTS.map(([, s], i) => ({ x, s, y0: 10 + f * 3 + i * 2 }))), truncated: false },
    map: { columns: [], rows: Array.from({ length: 30 }, (_, i) => ({ x_label: `E${i}`, x: (i % 5) - 2, y0: (i % 3) - 1 })), truncated: false },
    worth: { columns: [], rows: SEGMENTS.map(([, x, size, value]) => ({ x, y0: size, y1: value })), truncated: false },
    moves: { columns: [], rows: [{ x: 'Loyal regulars', s: 'Lapsing families', y0: 40 }, { x: 'Lapsing families', s: 'Bargain hunters', y0: 25 }, { x: 'New and curious', s: 'Loyal regulars', y0: 18 }], truncated: false },
  },
  tables: { cards: { columns: [], rows: SEGMENTS.map(([segment_id, label, size, value, suggested_treatment]) => ({ segment_id, label, size, value, profile: 'Shops weekly, big baskets', suggested_treatment })), truncated: false } },
  errors: {},
});

const recsData = () => ({
  kpis: { offers: { now: 24 }, customers: { now: 8 }, worth: { now: 54000 } },
  charts: {
    affinity: { columns: [], rows: OFFERS.flatMap((x, i) => ['Basic', 'Plus'].map((s, j) => ({ x, s, y0: 0.4 + i * 0.1 + j * 0.05 }))), truncated: false },
    lift: { columns: [], rows: OFFERS.map((x_label, i) => ({ x_label, x: 100 + i * 50, y0: 0.7 - i * 0.1 })), truncated: false },
    coverage: { columns: [], rows: OFFERS.map((x, i) => ({ x, y0: 8 - i * 2 })), truncated: false },
  },
  tables: {},
  errors: {},
});

const LIFT_WEEKS = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 7, 3 + i * 7)).toISOString().slice(0, 10));
const liftData = () => ({
  kpis: { incremental: { now: 180000 }, spend: { now: 60000 }, real: { now: 2 } },
  charts: {
    versus: { columns: [], rows: LIFT_WEEKS.map((x, i) => ({ x, y0: 1100 + i * 20, y1: 1000 + i * 10, y2: 950 + i * 10, y3: 1050 + i * 10 })), truncated: false },
    waterfall: { columns: [], rows: [{ x: 'Sales added', y0: 180000 }, { x: 'Promotion cost', y0: -60000 }, { x: 'Net added', y0: 120000 }], truncated: false },
    curves: { columns: [], rows: PROMOS.map((p, i) => ({ x_label: p.entity_label, x: 10000 + i * 5000, y0: 90000 - i * 30000 })), truncated: false },
  },
  tables: { effect: { columns: [], rows: [
    { intervention: 'Spring bundle', effect: 12, lower: 5, upper: 19, p_value: 0.004, roi: 140, incremental_value: 90000, cost: 20000 },
    { intervention: 'Flash sale', effect: 1, lower: -4, upper: 6, p_value: 0.41, roi: -20, incremental_value: 5000, cost: 25000 },
    { intervention: 'Free delivery', effect: -6, lower: -9, upper: -2, p_value: 0.01, roi: -60, incremental_value: -12000, cost: 18000 },
  ], truncated: false } },
  errors: {},
});

const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
const TRIAGE = Array.from({ length: 24 }, (_, i) => ({
  record_key: `E${i + 1}`, _inspire_key: `E${i + 1}`, _inspire_version: String(700 + i), entity_id: `A${i + 1}`, entity_label: `Account ${i + 1}`,
  exception_rule: ['Rate above contract', 'Weight mismatch', 'Duplicate line'][i % 3], age_days: 3 + i * 4, priority_tier: 'Act now', rank: i + 1,
  value: 24000 - i * 900, recommended_action: 'Credit the difference', top_reasons: ['billed above the range'], as_of_date: '2026-10-15',
}));

export function monitorRoutes() {
  return {
    page: ({ json }) => json(200, {
      kpis: { open_n: { now: 24 }, exposure: { now: 310000 }, anomalies: { now: 9 }, old_n: { now: 15 } },
      charts: {
        signal: { columns: [], rows: DAYS.map((x, i) => ({ x, y0: i % 9 === 4 ? 160 : 100 + (i % 5), y1: 100, y2: 90, y3: 110 })), truncated: false },
        by_rule: { columns: [], rows: [['Rate above contract', 11], ['Weight mismatch', 8], ['Duplicate line', 5]].map(([x, y0]) => ({ x, y0 })), truncated: false },
        by_age: { columns: [], rows: [['0-7 days', 4, 40000], ['8-30 days', 5, 70000], ['31-90 days', 9, 120000], ['Over 90 days', 6, 80000]].map(([x, y0, y1]) => ({ x, y0, y1 })), truncated: false },
      },
      tables: {}, errors: {},
    }),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      return json(200, { rows: TRIAGE.slice(0, body.limit || 25), total: TRIAGE.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        summary: { open: 24, done: 0, resolved: 0, left: 24, owners: [] }, errors: {} });
    },
  };
}

const UNITS = Array.from({ length: 12 }, (_, i) => ({
  record_key: `U${i + 1}`, _inspire_key: `U${i + 1}`, _inspire_version: String(800 + i), entity_id: `U${i + 1}`, entity_label: `Unit ${i + 1}`,
  segment: 'Retail', priority_tier: 'Act now', rank: i + 1, value: 50000 - i * 3000, actual: 1000000 - i * 40000, plan: 1050000 - i * 30000,
  variance: -50000 - i * 1000, tolerance: 31500, recommended_action: 'Name an owner', top_reasons: ['volume below plan'], as_of_date: '2026-10-15',
}));
const BRIDGE_STEPS = [['Plan', 1200000], ['Volume', -90000], ['Price', 40000], ['Mix', -20000], ['Actual', 1130000]];

export function explainerRoutes() {
  return {
    page: ({ json }) => json(200, {
      kpis: { actual: { now: 1130000 }, plan: { now: 1200000 }, variance: { now: -70000 }, outside_n: { now: 7 } },
      charts: {
        walk: { columns: [], rows: BRIDGE_STEPS.map(([x, y0]) => ({ x, y0 })), truncated: false },
        vs_peers: { columns: [], rows: UNITS.map((u, i) => ({ x_label: u.entity_label, x: 900 + i * 10, y0: 880 + i * 15 })), truncated: false },
        drivers: { columns: [], rows: BRIDGE_STEPS.slice(1, -1).map(([x, v]) => ({ x, y0: Math.min(v, 0), y1: Math.max(v, 0) })), truncated: false },
      },
      tables: {
        peer_gaps: { columns: [], rows: UNITS.slice(0, 4).map((u, i) => ({ unit_label: u.entity_label, peer_group: 'Large', metric: 'Sales', peer_median: 1000000, gap: -40000 + i * 5000 })), truncated: false },
        said: { columns: [], rows: [{ unit_label: 'Unit 1', reason: 'Late launch', remark: 'The new line shipped two weeks late.', author: 'Unit owner' }], truncated: false },
      },
      errors: {},
    }),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      return json(200, { rows: UNITS.slice(0, body.limit || 25), total: UNITS.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        summary: { open: 12, done: 0, resolved: 0, left: 12, owners: [] }, errors: {} });
    },
  };
}

export function dashboardRoutes(asked) {
  return {
    page: ({ json }) => json(200, {
      kpis: { revenue: { now: 4200000, before: 3900000 }, prior: { now: 3900000 }, growth: { now: 7.7 } },
      charts: {
        trend: { columns: [], rows: MONTHS6.map((x, i) => ({ x, y0: 600000 + i * 20000, y1: 580000 + i * 10000 })), truncated: false },
        movers: { columns: [], rows: [['Oat bar', 90000], ['Tea tin', -60000], ['Rye loaf', 40000]].map(([x, y0]) => ({ x, y0 })), truncated: false },
        by_region: { columns: [], rows: [['North', 2100000, 1900000], ['South', 2100000, 2000000]].map(([x, y0, y1]) => ({ x, y0, y1 })), truncated: false },
      },
      tables: { rows: { columns: [], rows: [{ entity_label: 'Oat bar', region: 'North', revenue: 900000, prior_value: 810000, change: 90000 }], truncated: false } },
      errors: {},
    }),
    records: ({ route, json }) => {
      asked.push(route.request().postDataJSON());
      return json(500, { error: 'a dashboard reads no decision list' });
    },
  };
}
const MONTHS6 = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 4 + i, 1)).toISOString().slice(0, 10));

export const STEPS = ['Received', 'Triage', 'Assess', 'Review', 'Paid'];
export const MOVES = [['Received', 'Triage', 400, 2, 6], ['Triage', 'Assess', 380, 20, 52], ['Assess', 'Review', 360, 30, 90], ['Review', 'Paid', 300, 8, 20],
  ['Review', 'Assess', 60, 26, 70], ['Triage', 'Paid', 20, 1, 3]];
const PROCESS_ACTIONS = ['Expedite: it breaches in 4 hours', 'Reassign to a free adjuster', 'Accept the delay: the customer agreed'];
const CASES_ROWS = Array.from({ length: 24 }, (_, i) => row(i + 1, { entity_label: `Claim ${i + 1}`, step: STEPS[1 + (i % 3)], age_hours: 40 + i,
  breach_risk: 90 - i * 2, recommended_action: PROCESS_ACTIONS[i % 3], variant: i % 2 ? 'Motor' : 'Home', region: 'North' }));
const processData = () => ({
  kpis: { open: { now: 412 }, at_risk: { now: 24 }, age: { now: 38 } },
  charts: {
    map: { columns: [], rows: MOVES.map(([x, s, y0, y1]) => ({ x, s, y0, y1 })), truncated: false },
    bottlenecks: { columns: [], rows: MOVES.map(([x, , , , y0]) => ({ x, y0 })), truncated: false },
    rework: { columns: [], rows: [{ x: 'Review', y0: 60 }, { x: 'Assess', y0: 12 }, { x: 'Triage', y0: 3 }], truncated: false },
    cycle: { columns: [], rows: [{ x: 'Home', y0: 10, y1: 30, y2: 50, y3: 80, y4: 140 }, { x: 'Motor', y0: 8, y1: 40, y2: 70, y3: 110, y4: 190 }], truncated: false },
  },
  tables: {},
  errors: {},
});

const SITES = [['Dubai Marina', 'AE', 25.08, 55.14, 92000, 'Shortlist it: strong unmet demand'], ['Riyadh North', 'SA', 24.8, 46.7, 81000, 'Shortlist it: no store within 10 km'],
  ['Doha West', 'QA', 25.3, 51.4, 40000, 'Reject it: already served nearby'], ['Muscat Bay', 'OM', 23.6, 58.5, 21000, 'Reject it: too far from demand']];
const SITE_ROWS = SITES.map(([name, code, , , metric, action], i) => row(i + 1, { entity_label: name, entity_id: name, city: name.split(' ')[0], region_code: code,
  metric, recommended_action: action, format: 'Large' }));
const locationData = () => ({
  kpis: { sites: { now: 4 }, demand: { now: 234000 }, strong: { now: 2 } },
  charts: {
    countries: { columns: [], rows: [...SITES.map(([, x, , , y0]) => ({ x, y0 })), { x: 'ZZ', y0: 500 }], truncated: false },
    points: { columns: [], rows: [...SITES.map(([x, , y1, y2, y0]) => ({ x, y0, y1, y2 })), { x: 'No coordinates', y0: 10, y1: null, y2: null }], truncated: false },
    density: { columns: [], rows: SITES.flatMap(([, x]) => ['Large', 'Small'].map((s, j) => ({ x, s, y0: 2 + j }))), truncated: false },
  },
  tables: { listed: { columns: [], rows: SITES.map(([entity, region_code, , , metric]) => ({ entity, city: entity.split(' ')[0], region_code, metric })), truncated: false } },
  errors: {},
});

const ACCOUNTS = Array.from({ length: 12 }, (_, i) => `A${100 + i}`);
const NETWORK_ACTIONS = ['Block the account: it shares a device with a blocked one', 'Investigate the transfers first', 'Not a ring: family accounts'];
const NODE_ROWS = ACCOUNTS.map((a, i) => row(i + 1, { entity_label: a, entity_id: a, community: i < 6 ? 'Ring 1' : 'Ring 2', centrality: 0.9 - i * 0.05,
  metric: 50000 - i * 2000, recommended_action: NETWORK_ACTIONS[i % 3] }));
const LINKS = ACCOUNTS.slice(0, 11).map((a, i) => ({ x: a, s: ACCOUNTS[i + 1], y0: 12 - i, y1: i < 6 ? 'Ring 1' : 'Ring 2', y2: i + 1 < 6 ? 'Ring 1' : 'Ring 2' }));
const networkData = () => ({
  kpis: { accounts: { now: 12 }, rings: { now: 2 }, central: { now: 0.9 } },
  charts: { graph: { columns: [], rows: LINKS, truncated: false } },
  tables: {
    neighbors: { columns: [], rows: LINKS.slice(0, 3).map((l) => ({ src: l.x, dst: l.s, weight: l.y0, dst_community: l.y2 })), truncated: false },
    pairs: { columns: [], rows: LINKS.slice(0, 5).map((l) => ({ src: l.x, dst: l.s, weight: l.y0 })), truncated: false },
  },
  errors: {},
});

const chatData = () => ({ kpis: { rows: { now: 18000 }, accounts: { now: 240 }, net: { now: 1200000 } }, charts: {}, tables: {}, errors: {} });

export const CASES = {
  segment_explorer: { data: segmentData, rows: MEMBERS, ready: '[data-segment]' },
  recommendation_desk: { data: recsData, rows: RECS, ready: '[data-choice-row]' },
  lift_readout: { data: liftData, rows: PROMOS, ready: '[data-verdict]' },
};

export const LAYOUT_B_CASES = {
  process_flow: { data: processData, rows: CASES_ROWS, ready: '[data-choice-row]', canvases: 4, lists: { breach_risk_cases: 20 } },
  location_view: { data: locationData, rows: SITE_ROWS, ready: '[data-choice-row]', canvases: 3, lists: { ranked_sites: 3 } },
  network_explorer: { data: networkData, rows: NODE_ROWS, ready: '[data-choice-row]', canvases: 1, lists: { centrality_list: 10 } },
  agent_chat: { data: chatData, rows: [], ready: '[data-question]', canvases: 0, lists: {} },
};

export const EXAMPLES = {
  'forecast_cockpit.json': { settings: DECIDE, routes: () => forecastRoutes([]),
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3 && document.querySelector('[data-plan-row="K1"]')) },
  'planner.json': { settings: DECIDE, routes: () => plannerRoutes([], []),
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3 && document.querySelector('[data-plan-row="K1"]')) },
  'scenario_lab.json': { settings: { options: { modify: true, replace_edits: false, decisions: false } }, routes: () => scenarioRoutes([], []),
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 4 && document.querySelector('[data-lever="price"]')) },
  'monitor_triage.json': { settings: DECIDE, routes: monitorRoutes,
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3 && document.querySelector('[data-section="triage_queue"] tbody tr')) },
  'performance_explainer.json': { settings: DECIDE, routes: explainerRoutes,
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3 && document.querySelector('[data-section="quote_cards"] tbody tr')) },
  'dashboard.json': { settings: DECIDE, routes: () => dashboardRoutes([]),
    ready: (page) => page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3 && document.querySelector('[data-section="tables"] tbody tr')) },
  ...Object.fromEntries(Object.entries({ ...CASES, ...LAYOUT_B_CASES }).map(([id, c]) => [`${id}.json`, { settings: DECIDE, routes: () => kindRoutes(c.data(), c.rows, []),
    ready: (page) => page.waitForFunction(([ready, canvases]) => document.querySelectorAll('[data-section] canvas').length >= canvases && document.querySelector(ready), [c.ready, c.canvases ?? 3]) }])),
};
