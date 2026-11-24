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

// REQ-507: the Data and Filter steps ask value/scope and value/filter before any case plan. The replies follow implementRoutes.js (facts from
// valueScope.factsFrom, scope + echo + unmatched + sql from the filter route; echo as valueScope.echoOf words it).
export const SCOPE_FACTS = { table: 'main.sales.orders', rows: 3412880, dated_rows: 3400840, first: '2019-01-01', last: '2026-09-30', date_column: 'created_at', noun: 'review case',
  date_candidates: [{ column: 'created_at', first: '2019-01-01', last: '2026-09-30' }, { column: 'shipped_at', first: '2019-01-03', last: '2026-10-02' }] };
export function mountScopeRoutes(app) {
  app.post('/api/inspire/value/scope', (req, res) => res.json({ facts: req.body?.date_column ? { ...SCOPE_FACTS, date_column: req.body.date_column } : SCOPE_FACTS }));
  app.post('/api/inspire/value/filter', (req, res) => {
    const filters = req.body?.filters || [{ column: 'status', op: 'not in', values: ['cancelled', 'test'] }];
    const window = req.body?.window || null;
    res.json({ scope: { phrase: req.body?.phrase || '', filters, window, rows_before: 3412880, rows_after: 1198406, first: '2019-01-01', last: '2026-09-30' },
      echo: 'I kept review cases where status is none of cancelled, test. That leaves 1,198,406 of 3,412,880 rows (35%).', unmatched: [],
      sql: 'SELECT COUNT(*) AS rows_before FROM `main`.`sales`.`orders`' });
  });
}

export function mountWizard({ plans = [], previews = [], puts = [], posts = [], saved = null, history = [], planReply = null, previewDelay = 0, putReply = null } = {}) {
  return (app) => {
    mountScopeRoutes(app);
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
  await list.locator('[data-use-case-row]').first().waitFor();
  const card = list.locator('[data-use-case-row]').filter({ hasText: 'Predict churn' });
  return { ui, card, page: ui.page };
}
export const openWizard = async (page, card) => {
  await card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
  await card.locator('[data-value-calculate]').click();
  const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
  await dialog.waitFor();
  return dialog;
};
export const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true }).click();
// Click Next until the wizard shows the page (scope:facts, scope:choice, filter, kinds, driver:<id>, economics:ramp, economics:cost, macro:offer, factors,
// story:draft, story:params, story:approve). The Save page has no Next: reach it with saveFrom.
export async function goTo(dialog, page) {
  // REQ-507: the Save page is reached through the approval (one PUT), so goTo 'save' walks to story:approve and approves.
  if (page === 'save') { await goTo(dialog, 'story:approve'); await saveFrom(dialog); return; }
  for (let i = 0; i < 24; i += 1) {
    // Settle first: while the case plan loads no page is shown, and a Next click then would skip the target. A plan error shows an alert instead of a page: stop there.
    await dialog.locator('[data-wizard-page], [role="alert"]').first().waitFor({ timeout: 15000 });
    if (await dialog.locator(`[data-wizard-page="${page}"]`).count()) return;
    if (!(await dialog.locator('[data-wizard-page]').count())) return;
    await next(dialog).catch(async (e) => {
      const at = await dialog.locator('[data-wizard-page]').evaluateAll((n) => n.map((x) => x.getAttribute('data-wizard-page')));
      throw new Error(`goTo ${page}: no Next button on page ${JSON.stringify(at)}: ${e.message.split('\n')[0]}`);
    });
  }
  throw new Error(`wizard never reached ${page}`);
}
// REQ-507: on story:approve tick the terms and click "Approve story and save" (the one PUT); resolves when the Save page shows.
export async function saveFrom(dialog) {
  await dialog.locator('[data-wizard-page="story:approve"]').waitFor({ timeout: 15000 });
  await dialog.getByLabel('I have read and accept these terms').check();
  await dialog.getByRole('button', { name: 'Approve story and save' }).click();
  await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
}
// Set a range input's value the way a drag does.
export const dragTo = (locator, value) => locator.evaluate((el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Record every value of [data-preview-state] from now on, so a test sees 'updating' even when the reply ends it between two polls (FX-43).
export async function watchPreviewStates(dialog) {
  await dialog.evaluate((root) => {
    const read = () => root.querySelector('[data-preview-state]')?.getAttribute('data-preview-state') || null;
    const seen = [read()];
    window.__previewSeen = seen;
    new MutationObserver(() => { const now = read(); if (now !== seen[seen.length - 1]) seen.push(now); })
      .observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-preview-state'] });
  });
  // Resolves once the recorded states hold 'updating' and then 'ready'; no deadline shorter than the reply.
  return (timeout = 15000) => dialog.page().waitForFunction(() => {
    const seen = window.__previewSeen || [];
    const at = seen.indexOf('updating');
    return at >= 0 && seen.indexOf('ready', at) > at;
  }, null, { timeout });
}
