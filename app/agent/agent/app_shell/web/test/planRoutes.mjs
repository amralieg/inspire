import { PERSON } from './harness.mjs';

export const PID = 'a'.repeat(32);
const LIMITS = [{ name: 'Oven hours', limit: 100, used: 100, slack: 0, shadow_price: 12 }, { name: 'Flour', limit: 100, used: 40, slack: 60, shadow_price: 0 },
  { name: 'Staff', limit: 90, used: 70, slack: 20, shadow_price: 0 }];

const MOVES = { submit: 'In review', approve: 'Approved', reopen: 'Draft', publish: 'Published' };

export function versionRoutes(contract, { approve = true, versions = [] } = {}) {
  const state = { versions: versions.map((v) => ({ ...v })), moves: [] };
  const view = () => ({ can_decide: true, can_approve: approve, why: '', approve_why: approve ? '' : 'Only the owners of this use case can approve, sign off or publish its plan',
    contract, states: ['Draft', 'In review', 'Approved', 'Published'], missing: '', constraints: contract === 'plan' ? LIMITS : [], constraints_error: '',
    versions: state.versions.map((v) => ({ ...v, editable: v.status === 'Draft' || v.status === 'In review' })) });
  const routes = {
    plans: ({ json }) => json(200, view()),
    'plans/version': ({ route, json }) => {
      const body = route.request().postDataJSON();
      state.moves.push(body);
      if (body.action === 'new') state.versions.unshift({ plan_id: PID, number: state.versions.length + 1, label: `Version ${state.versions.length + 1}`, status: 'Draft', overrides: [], changed_by: PERSON });
      else (state.versions.find((v) => v.plan_id === body.plan_id) || state.versions[0]).status = MOVES[body.action];
      return json(200, view());
    },
  };
  return { state, routes, view };
}

const SERIES = [{ series_id: 'S1', mase: 1.6, at_risk: true, next_period: '2026-12', forecast: 120, lower: 100, upper: 140, override: null },
  { series_id: 'S2', mase: 0.7, at_risk: false, next_period: '2026-12', forecast: 50, lower: 40, upper: 60, override: null }];

export function reviewRoutes(cycle, overrides) {
  const state = { cycle: cycle && { ...cycle }, series: SERIES.map((s) => ({ ...s })) };
  const view = () => ({ can_decide: true, can_approve: true, why: '', approve_why: '', cycle: state.cycle && { ...state.cycle, editable: ['Draft', 'In review'].includes(state.cycle.status) },
    cycles: state.cycle ? 1 : 0, series: state.series, at_risk: state.series.filter((s) => s.at_risk).length, missing: '', states: [] });
  return {
    'forecast/review': ({ json }) => json(200, view()),
    'forecast/override': ({ route, json }) => {
      const body = route.request().postDataJSON();
      overrides.push(body);
      Object.assign(state.series.find((s) => s.series_id === body.series_id), { override: { value: body.value, reason: body.reason, by: PERSON, at: 'now' } });
      return json(200, view());
    },
    'plans/version': ({ route, json }) => {
      const body = route.request().postDataJSON();
      overrides.push(body);
      state.cycle = body.action === 'new' ? { plan_id: PID, number: 1, label: 'Version 1', status: 'Draft', overrides: [] } : { ...state.cycle, status: MOVES[body.action] };
      return json(200, { versions: [state.cycle] });
    },
  };
}
