// REQ-507: HTTP mocks for the redesigned Value at Stake wizard (REQ-544: Data, Kinds, Each kind, Value story, Terms and accept).
// The scope, filter and macro routes are registered before mountWizard's, so they win; the preview adds yearly.projection the way L2 does.
import { PLAN, fakeYearly, goTo, mountWizard } from './valueWizardSupport.mjs';

export const FACTS = { table: 'main.sales.orders', rows: 3412880, dated_rows: 3400840, first: '2019-01-01', last: '2026-09-30', date_column: 'created_at', noun: 'review case',
  date_candidates: [{ column: 'created_at', first: '2019-01-01', last: '2026-09-30' }, { column: 'shipped_at', first: '2019-01-03', last: '2026-10-02' }] };
export const FILTER_OK = {
  scope: { phrase: 'Exclude cancelled and test records', filters: [{ column: 'status', op: 'not in', values: ['cancelled', 'test'] }, { column: 'channel', op: '!=', values: ['test'] }],
    window: null, rows_before: 3412880, rows_after: 1198406, first: '2019-01-01', last: '2026-09-30' },
  echo: 'I kept review cases where status is not cancelled or test and channel is not test: 1,198,406 of 3,412,880 rows (35%).',
  unmatched: [], sql: 'SELECT COUNT(*) AS rows_before, COUNT_IF(`status` NOT IN (:f0_0, :f0_1) AND `channel` != :f1_0) AS rows_after FROM `main`.`sales`.`orders`',
};
export const SOURCES = [
  { id: 'marketplace', name: 'Databricks Marketplace', licence: 'per listing', configured: false },
  { id: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0' },
  { id: 'imf', name: 'IMF', licence: 'IMF terms', terms: 'Inspire only computes with this data; it is never used to train a model' },
  { id: 'oecd', name: 'OECD', licence: 'OECD T&C' }, { id: 'eurostat', name: 'Eurostat', licence: 'EU reuse' }, { id: 'undata', name: 'UN Data', licence: 'UNdata terms' },
];
export const SERIES = { source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'USA', unit: '%', fetched_at: '2026-11-23T10:00:00.000Z',
  points: [...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y, i) => ({ period: String(y), value: i + 1, forecast: false })),
    { period: '2026', value: 3, forecast: true }, { period: '2027', value: 3.5, forecast: true }],
  citation: { name: 'World Bank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'USA', url: 'https://api.worldbank.org/v2/x', licence: 'CC BY 4.0', fetched_at: '2026-11-23T10:00:00.000Z' } };
export const FACTOR_PLAN = { ...PLAN, economic_factors: [{ id: 'consumer_demand', label: 'Consumer demand', why: 'Spending moves revenue', likely_pct: 2, min_pct: -3, max_pct: 6 }] };

// The L2 projection for a preview (default ramp 40/80/100; with no costs it is gross only).
export function projectionOf(total, economics = {}) {
  const ramp = economics.ramp_pct || [40, 80, 100];
  const years = ramp.map((r, i) => ({ year: i + 1, low: (total * 0.5 * r) / 100, likely: (total * r) / 100, high: (total * 1.5 * r) / 100 }));
  const gross = years.reduce((s, y) => s + y.likely, 0);
  const cost = Number(economics.build_cost || 0) + 3 * Number(economics.run_cost_per_year || 0);
  return { years, gross_3y: gross, cost_3y: cost, net_3y: gross - cost, roi_3y: cost ? Math.round(((gross - cost) / cost) * 100) / 100 : null,
    payback_months: cost ? 6 : null, gross_only: !cost };
}

export function mountReq507({ calls = [], facts = FACTS, filterReply = FILTER_OK, sources = SOURCES, series = SERIES, plan = PLAN, ...rest } = {}) {
  const wizard = mountWizard({ planReply: { plan }, ...rest });
  return (app) => {
    app.post('/api/inspire/value/scope', (req, res) => {
      calls.push({ route: 'scope', body: req.body });
      res.json({ facts: req.body?.date_column ? { ...facts, date_column: req.body.date_column } : facts });
    });
    app.post('/api/inspire/value/filter', (req, res) => {
      calls.push({ route: 'filter', body: req.body });
      if (typeof filterReply === 'function') return filterReply(req, res);
      return res.json(filterReply);
    });
    app.post('/api/inspire/value/case-plan', (req, res, nextRoute) => {
      calls.push({ route: 'case-plan', body: req.body });
      nextRoute();
    });
    app.get('/api/inspire/macro/sources', (_req, res) => {
      calls.push({ route: 'macro-sources' });
      res.json({ sources });
    });
    app.get('/api/inspire/macro/series', (req, res) => {
      calls.push({ route: 'macro-series', query: req.query });
      const e = Number(req.query.elasticity ?? 1);
      const factor = req.query.factor_id && !series.blocked ? { id: req.query.factor_id, label: req.query.factor_label || req.query.factor_id, why: 'From public data',
        likely_pct: 3.25 * e, min_pct: 1.9 * e, max_pct: 9.1 * e, elasticity: e,
        source: { name: series.citation.name, indicator: series.indicator, country: series.country, fetched_at: series.fetched_at, url: series.citation.url } } : undefined;
      res.json({ series, cached: false, ...(factor ? { factor } : {}) });
    });
    app.post('/api/inspire/value/preview', (req, res) => {
      calls.push({ route: 'preview', body: req.body });
      const yearly = fakeYearly(req.body);
      res.json({ yearly: { ...yearly, projection: projectionOf(yearly.total.amount, req.body.answers?.economics) } });
    });
    wizard(app);
  };
}
export const routesOf = (calls) => calls.map((c) => c.route);

// REQ-544: walk to the page holding the section (see goTo in valueWizardSupport.mjs). The macro offer is a fold now, so `macro` is kept only for old callers.
export async function goTo507(dialog, page) { await goTo(dialog, page); }
export const textOf = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
