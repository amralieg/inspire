// REQ-512 full width (Amr: "w-full px-6, no cap, on all pages") for the Monitor and Review page frames, same shape as req512FullWidth.ui.test.mjs.
// From the page content up to <body>, no ancestor has a max-width, and the page frame spans the viewport less 48px (px-6 both sides).
// Fail-pre (lane/spec511 88f881009): App.jsx:614 Monitor wrapper `max-w-7xl mx-auto`; Review: lib/layout.js:1 RESULTS_FRAME `max-w-6xl mx-auto`
// (used at App.jsx:634) and ResultsPage.jsx:1175-1176 `max-w-7xl mx-auto`. Owners: M fixes App.jsx:614; R1 fixes layout.js and ResultsPage.jsx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

// Monitor backend (copied from req511Monitor.ui.test.mjs)
const MINUTE = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let n = 0;
const step = (stage, status, extra = {}) => ({ step_id: String(++n), session_id: '42', stage_name: stage, step_name: `${stage} step`, sub_step_name: '',
  status, message: `${stage} message`, progress_increment: 5, last_updated: ago((60 - n) * MINUTE), result_json: {}, ...extra });
const LIVE = { life_cycle_state: 'RUNNING', start_time: Date.now() - 30 * MINUTE, tasks: [] };
const ENDED = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', start_time: Date.now() - 60 * MINUTE, end_time: Date.now() - MINUTE, tasks: [] };
const FAILED = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', state_message: 'Workload failed', start_time: Date.now() - 60 * MINUTE,
  end_time: Date.now() - MINUTE, tasks: [] };

const USE_CASES = [
  { id: 'N01-U01', name: 'Predict customer churn', business_domain: 'Customer', priority: 'High' },
  { id: 'N01-U02', name: 'Score upsell offers', business_domain: 'Customer', priority: 'Medium' },
  { id: 'N01-U03', name: 'Segment shoppers', business_domain: 'Customer', priority: 'Medium' },
  { id: 'N02-U01', name: 'Forecast store stock', business_domain: 'Supply chain', priority: 'High' },
  { id: 'N02-U02', name: 'Spot late suppliers', business_domain: 'Supply chain', priority: 'Low' },
];
const liveSteps = () => [step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'ended_success'),
  step('Use Case Generation', 'started', { result_json: { use_cases: USE_CASES } })];
const doneSteps = () => [step('Setup', 'ended_success'), step('Business Understanding', 'ended_success'), step('Data Preparation', 'ended_success'),
  step('Use Case Generation', 'ended_success', { result_json: { use_cases: USE_CASES } }), step('Domain Clustering', 'ended_success'),
  step('Prioritization', 'ended_success'), step('Implementation', 'ended_success'), step('Executive Readout', 'ended_success')];

function monitorBackend(steps, run, { runStatus = 200 } = {}) {
  return (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(60 * MINUTE),
      completed_percent: run === LIVE ? 50 : 100, completed_on: run === LIVE ? null : ago(MINUTE), last_updated: ago(MINUTE),
      processing_status: run === LIVE ? 'processing' : 'done' } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
    app.get('/api/run/777/cancel', (_req, res) => res.json({ allowed: true }));
    app.get('/api/run/777', (_req, res) => (runStatus === 200
      ? res.json({ run_id: 777, run_name: 'Inspire Discover', run_page_url: 'https://workspace.example.com/#job/1/run/777', ...run })
      : res.status(runStatus).json({ error: 'TEMPORARILY_UNAVAILABLE: The service is temporarily unavailable' })));
  };
}


// Review backend (copied from req511Review.ui.test.mjs)
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const SCORES = { 'N01-U01': '7.4', 'N01-U02': '8.1', 'N01-U03': '5.2', 'N01-U04': '6.0', 'N02-U01': '9.0', 'N02-U02': '4.5' };
const SCORED = { ...REVIEW_RESULTS, domains: REVIEW_RESULTS.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => ({ ...u, inspire_score: SCORES[u.No] })) })) };
const entry = (status, verb, amount) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb, amount, currency: 'USD' });
const TOTALS = {
  run: { totals: [{ currency: 'USD', amount: 6700000, calculated: 3200000, estimated: 3500000 }], n: 6, n_calculated: 1, n_estimated: 2, n_none: 3,
    by_verb: [{ currency: 'USD', verb: 'AVOID RISK', amount: 3200000 }, { currency: 'USD', verb: 'GROW REVENUE', amount: 2400000 }, { currency: 'USD', verb: 'REDUCE COST', amount: 1100000 }] },
  use_cases: { 'N01-U01': entry('calculated', 'AVOID RISK', 3200000), 'N01-U02': entry('estimated', 'GROW REVENUE', 2400000),
    'N01-U03': entry('estimated', 'REDUCE COST', 1100000), 'N01-U04': entry('none'), 'N02-U01': entry('none'), 'N02-U02': entry('none') },
};

function mount(app) {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
  app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
  app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
  app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
}
const frameFacts = (anchor) => anchor.evaluate((el) => {
  const caps = [];
  let widest = 0;
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.maxWidth !== 'none') caps.push(`${p.tagName.toLowerCase()}.${String(p.className).slice(0, 60)} max-width ${cs.maxWidth}`);
    widest = Math.max(widest, p.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  }
  return { caps, widest, own: el.getBoundingClientRect().width };
});

const PAGES = [
  ['Monitor (brief M)', async () => {
    const ui = await openUi('monitor', {}, '', { mount: monitorBackend(liveSteps(), LIVE) });
    return { ui, anchor: ui.page.getByRole('heading', { level: 1, name: 'Monitor' }) };
  }],
  ['Review (brief R1)', async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, results: SCORED }, '', { mount });
    return { ui, anchor: ui.page.getByRole('region', { name: 'Use case list' }) };
  }],
];

for (const width of [1440, 1920]) {
  for (const [name, open] of PAGES) {
    test(`${name}: the page frame is ${name.startsWith('Review') ? 'the REQ-520 FRAME column' : 'full width with no max-width'} at ${width}px`, async () => {
      const { ui, anchor } = await open();
      try {
        await ui.page.setViewportSize({ width, height: 900 });
        await anchor.first().waitFor({ timeout: 25000 });
        const facts = await frameFacts(anchor.first());
        if (name.startsWith('Review')) {
          // REQ-520 (Caps everywhere): Review sits in the FRAME column (max-w-[1488px], 1440px of content), nothing narrower.
          assert.deepEqual(facts.caps.map((c) => c.replace(/^.*max-width /, '')), ['1488px'], `${name}: only the FRAME cap`);
          assert.ok(facts.own >= Math.min(width, 1488) - 48 - 280, `${name}: content is ${facts.own}px, needs at least ${Math.min(width, 1488) - 48 - 280}`);
        } else {
          assert.deepEqual(facts.caps, [], `${name}: no ancestor caps the width`);
          assert.ok(facts.own >= width - 48 - 280, `${name}: content is ${facts.own}px, needs at least ${width - 48 - 280} (viewport less px-6 and a 280px rail)`);
        }
        assert.deepEqual(ui.pageErrors, []);
      } finally {
        await ui.close();
      }
    });
  }
}
