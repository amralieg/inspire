// REQ-436/437: shared fixtures for the Calculate value wizard tests. Mocks the case-plan, preview and answers routes at HTTP level (contract C1-C4).
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { openUi } from './uiSupport.mjs';

export const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };

const est = (id, label, kind, def, why = 'A common first estimate.') => ({ id, label, kind, source: 'estimate', default: def, why });
const dat = (id, label, kind, metric) => ({ id, label, kind, source: 'data', metric });
export const PLAN = {
  case_noun: 'review case', case_filter: null, table: 'main.sales.orders', date_column: 'created_at', days: 90,
  groupings: [{ column: 'region', label: 'By region' }, { column: 'channel', label: 'By channel' }],
  grouping: 'region',
  groups: [
    { g: 'North', records_per_year: 6000, metrics: { amt: 400 } },
    { g: 'South', records_per_year: 4000, metrics: { amt: 300 } },
    { g: 'East', records_per_year: 2000, metrics: { amt: 200 } },
  ],
  metrics: [{ id: 'amt', label: 'Amount', column: 'amount', agg: 'avg' }],
  drivers: [
    { id: 'risk_avoided', label: 'Losses avoided', verb: 'AVOID RISK', on: true, why: 'Every case that is stopped is a loss not paid.',
      asks: [dat('incidents_per_year', 'Cases a year', 'count', 'records'), dat('cost_per_incident', 'Money at risk in one case', 'money', 'amt'),
        est('reduction_pct', 'Out of 100 cases, how many will the use case stop?', 'pct', 60)] },
    { id: 'time_saved', label: 'Analyst time saved', verb: 'REDUCE COST', on: true, why: 'Fewer hours per case.',
      asks: [dat('events_per_year', 'Cases a year', 'count', 'records'), est('people', 'How many analysts look at one case?', 'count', 1),
        est('hours_before', 'Hours per case today', 'hours', 2.5), est('hours_after', 'Hours per case with the use case', 'hours', 0.5),
        est('cost_per_hour', 'What does one analyst hour cost?', 'money', 45)] },
    { id: 'revenue_uplift', label: 'Customers kept', verb: 'GROW REVENUE', on: true, why: 'Customers stay.',
      asks: [est('base_revenue_per_year', 'Yearly revenue touched', 'money', 100000), est('uplift_pct', 'Out of 100, how much does it grow?', 'pct', 5)] },
    { id: 'cost_cut', label: 'Fees avoided', verb: 'REDUCE COST', on: false, why: 'Fewer fees.',
      asks: [est('spend_per_year', 'Yearly spend', 'money', 50000), est('cut_pct', 'Out of 100, how much is cut?', 'pct', 10)] },
    { id: 'productivity', label: 'Team capacity freed', verb: 'REDUCE COST', on: false, why: 'Time back for other work.',
      asks: [est('headcount', 'People in the team', 'count', 12), est('cost_per_person_year', 'Cost of one person per year', 'money', 90000),
        est('gain_pct', 'Out of 100 hours, how many come back?', 'pct', 5)] },
  ],
  model: 'chat-endpoint', disclaimer: 'Not a validated business case.',
};
export const FALLBACK_PLAN = { ...PLAN, model: null };

// A fake of the server's preview: 100 per unit typed in an on driver, less 50 per excluded group, times the credit share.
export function fakeYearly(body, { calculated = false } = {}) {
  const { plan, answers } = body;
  const records = plan.groups.filter((g) => !(answers.excluded_groups || []).includes(g.g)).reduce((s, g) => s + g.records_per_year, 0);
  const parts = plan.drivers.filter((d) => answers.drivers?.[d.id]?.on).map((d) => {
    const typed = answers.drivers[d.id].inputs || {};
    const sum = Object.values(typed).reduce((s, v) => s + Number(v), 0);
    return { id: d.id, label: d.label, verb: d.verb, amount: (sum * 100 - 50 * (answers.excluded_groups || []).length) * (answers.attribution_pct ?? 100) * 0.01, per_group: true,
      inputs: d.asks.map((a) => ({ id: a.id, label: a.label, kind: a.kind, source: a.source, value: a.source === 'data' ? records : Number(typed[a.id]) })) };
  });
  return { verb: parts[0]?.verb || 'REDUCE COST', period: 'Per Year', estimated: !calculated, calculated, currency: 'USD',
    total: { unit: 'USD', amount: parts.reduce((s, p) => s + p.amount, 0) }, parts,
    groups: { grouping_label: 'By region', covered: plan.groups.length - (answers.excluded_groups || []).length, of: plan.groups.length },
    case_noun: plan.case_noun, attribution_pct: answers.attribution_pct ?? 100 };
}

export function mountWizard({ plans = [], previews = [], puts = [], posts = [], saved = null, history = [], planReply = null, previewDelay = 0, putReply = null } = {}) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: saved ? { 'N01-U01': saved } : {} }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history }));
    app.post('/api/inspire/value/case-plan', (req, res) => {
      plans.push(req.body);
      if (planReply?.status) return res.status(planReply.status).json(planReply.body);
      return res.json({ plan: planReply?.plan || PLAN });
    });
    app.post('/api/inspire/value/preview', (req, res) => {
      previews.push(req.body);
      setTimeout(() => res.json({ yearly: fakeYearly(req.body) }), previewDelay);
    });
    app.put('/api/inspire/value/answers', (req, res) => {
      puts.push(req.body);
      if (putReply?.status) return res.status(putReply.status).json(putReply.body);
      return res.json({ version: 3, yearly: fakeYearly({ plan: req.body.answers.plan, answers: req.body.answers }, { calculated: true }), disclaimer: 'x' });
    });
    app.post('/api/inspire/value/answers/undo', (req, res) => {
      posts.push(req.body);
      res.json({ version: 4, answers: saved?.answers, yearly: saved?.yearly });
    });
  };
}

export async function openCard(mount) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const list = ui.page.getByRole('region', { name: 'Use case list' });
  await list.locator('[aria-expanded]').first().waitFor();
  const card = list.locator('[aria-expanded]').filter({ hasText: 'Predict churn' });
  return { ui, card, page: ui.page };
}
export const openWizard = async (page, card) => {
  await card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
  await card.locator('[data-value-calculate]').click();
  const dialog = page.getByRole('dialog', { name: 'Calculate value at stake' });
  await dialog.waitFor();
  return dialog;
};
export const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true }).click();
// Click Next until the wizard shows the page (data, kinds, driver:<id>, groups, save).
export async function goTo(dialog, page) {
  for (let i = 0; i < 12; i += 1) {
    if (await dialog.locator(`[data-wizard-page="${page}"]`).count()) return;
    await next(dialog);
  }
  throw new Error(`wizard never reached ${page}`);
}
// Set a range input's value the way a drag does.
export const dragTo = (locator, value) => locator.evaluate((el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
