import { createRequire } from 'node:module';
import { RESULTS, built } from './implementFixtures.js';

const entry = (id, path, useCases, level = '') => ({ id, path, level, use_cases: useCases });

export const RUN_SUMMARY = createRequire(import.meta.url)('./runSummary.json');

export const REVIEW_RESULTS = {
  ...RESULTS,
  ...RUN_SUMMARY.results_json,
  data_access: { tables_read: ['main.s.orders', 'main.s.stock'], tables_read_count: 2, statements: 3, pii_columns_excluded: 0, rows_sent_to_ai: 0 },
  strategy_coverage: {
    source: 'customer', use_cases: 6, aligned: 4, not_aligned: 1,
    entries: [
      entry('S0', 'Grow', 3, 'goal'), entry('S1', 'Grow > Keep customers', 1), entry('S2', 'Grow > Sell more', 2), entry('S3', 'Run lean', 2, 'goal'),
      entry('S4', 'Run lean > Stock right', 1), entry('S5', 'Run lean > Pay suppliers on time', 1), entry('S6', 'Comply', 0, 'goal'),
      entry('S7', 'Comply > Audit trail', 0), entry('S8', 'Comply > Data retention', 0), entry('S9', 'Comply > Supplier contracts', 0),
    ],
    gaps: [{ id: 'S9', reason: 'No table holds the supplier contracts' }],
    priorities: [{ priority: 'Cut churn', use_cases: 1 }, { priority: 'Grow basket size', use_cases: 2 }],
    priority_gaps: [],
  },
  foundations: [
    { id: 'F1', name: 'Orders and customers', tables: ['main.s.orders', 'main.s.customers'], use_case_count: 7,
      joins: [{ left: 'main.s.orders.customer_id', right: 'main.s.customers.id', source: 'foreign key' }],
      use_cases: ['N01-U01', 'N01-U02', 'N01-U03', 'N01-U04', 'N02-U01', 'N02-U02', 'N09-U09'] },
    { id: 'F2', name: 'Stock', tables: ['main.s.stock'], use_case_count: 2, joins: [], use_cases: ['N02-U01', 'N02-U02'] },
  ],
  delivery_order: ['N01-U01', 'N02-U01', 'N01-U02', 'N02-U02', 'N01-U03', 'N01-U04'],
};

const run = (sid, business, lastUpdated, [runs, rank], extra = {}) => ({
  session_id: sid, completed_percent: 100, business_name: business, widget_values: { business }, create_at: '2026-10-28T09:00:00Z',
  last_updated: lastUpdated, completed_on: lastUpdated, business_runs: runs, business_rank: rank, ...extra,
});

export const REVIEW_SESSIONS = [
  run('42', 'Acme', '2026-10-31T10:00:00Z', [2, 1]),
  run('41', 'Acme', '2026-10-29T10:00:00Z', [2, 2]),
  run('50', 'Beta Foods', '2026-10-30T08:00:00Z', [1, 1]),
  run('51', 'Gamma', '2026-10-30T07:00:00Z', [1, 1], { completed_percent: 40, usecase_overview: { total: 3, high: 1, domains: 1, preview_use_cases: [] } }),
  run('60', '', '2026-10-30T06:00:00Z', [1, 1]),
  run('61', '', '2026-10-30T05:00:00Z', [1, 1]),
];

export const REVIEW_PORTFOLIO = {
  portfolioRuns: [{ runs: '6', businesses: '3' }],
  portfolioUseCases: [
    { sid: null, is_total: '1', use_cases: '18', domains: '3', subdomains: '8', best_of_best: '3' },
    { sid: '42', is_total: '0', use_cases: '6', domains: '2', subdomains: '5', best_of_best: '2' },
    { sid: '41', is_total: '0', use_cases: '5', domains: '2', subdomains: '4', best_of_best: '1' },
    { sid: '50', is_total: '0', use_cases: '4', domains: '1', subdomains: '2', best_of_best: '0' },
  ],
  portfolioMvps: [
    { sid: null, is_total: '1', mvps_started: '3', mvps_live: '2', apps: '1', dashboards: '2', genie_spaces: '2', alerts: '1' },
    { sid: '42', is_total: '0', mvps_started: '1', mvps_live: '1', apps: '1', dashboards: '1', genie_spaces: '1', alerts: '1' },
  ],
};

export const REVIEW_STATE = { results: REVIEW_RESULTS, useCases: [], sessions: REVIEW_SESSIONS, history: [built()], ...REVIEW_PORTFOLIO };
