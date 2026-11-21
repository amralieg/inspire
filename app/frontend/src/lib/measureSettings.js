import { HOLDOUT_SHARE_DEFAULT, impactPartSummary, withMoneyRule } from './implementWizard.js';
import { moneyPartsOf } from './moneyParts.js';
import { moneySummaryOf } from './moneyDefaults.js';
import { kpiTargetOf, withKpiTarget } from './targetKpi.js';

// REQ-457: the MVP's measure settings (money, target KPI, hold back) live in the value wizard. These helpers move them between the build spec
// and the saved answers (PUT /api/inspire/value/answers), and list them as the read-only rows of "How the MVP measures it".
export const MEASURE_FIELDS = ['money', 'kpi', 'holdout'];

const LABELS = { method: 'How the value is measured', direction: 'Which movement counts', sign: 'Which records are gains', currency: 'Currency',
  window: 'Periods and statuses', off: 'Turn it off', kpi: 'Target KPI', holdout: 'Hold back' };
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The untouched default hold back (every new spec carries it) is no answer yet: with no money and no KPI picked it stays out of the saved answers,
// and the default seeds it again on the next opening.
const untouchedHoldout = (spec) => !isMap(spec?.money) && !kpiTargetOf(spec) && spec?.holdout?.enabled === true && spec.holdout.share === HOLDOUT_SHARE_DEFAULT;

// The spec's measure fields as saved answers; a field the spec does not have is left out.
export function measureAnswersOf(spec) {
  const kpi = kpiTargetOf(spec);
  return { ...(isMap(spec?.money) ? { money: spec.money } : {}), ...(kpi ? { kpi: { name: kpi } } : {}), ...(isMap(spec?.holdout) && !untouchedHoldout(spec) ? { holdout: spec.holdout } : {}) };
}

// The inverse: answers write their fields into the spec; a field the answers do not have leaves the spec field as it is.
export function specWithMeasure(spec, answers) {
  let next = spec;
  if (isMap(answers?.money)) next = withMoneyRule(next, answers.money);
  if (isMap(answers?.kpi)) next = withKpiTarget(next, answers.kpi.name);
  if (isMap(answers?.holdout)) next = { ...next, holdout: answers.holdout };
  return next;
}

const signSummary = (money) => (money?.sign?.column ? `Gains are the records marked by ${money.sign.column}` : 'Not set yet');

// One read-only row per setting, in the order of the Measure decisions; the sign row only exists for the Gains movement.
export function measureRows(spec) {
  const parts = [...moneyPartsOf(spec?.money?.rule), 'kpi', 'holdout'];
  const summaryOf = (id) => (id === 'kpi' || id === 'holdout' ? impactPartSummary(spec || {}, id) : id === 'sign' ? signSummary(spec?.money) : moneySummaryOf(spec?.money, id));
  return parts.map((id) => ({ id, label: LABELS[id], summary: String(summaryOf(id) ?? '') }));
}

// The measure fields a saved answers object carries, so a Save from a place that does not edit them keeps them.
export function measureOfSaved(saved) {
  return isMap(saved) ? Object.fromEntries(MEASURE_FIELDS.filter((k) => saved[k] !== undefined && saved[k] !== null).map((k) => [k, saved[k]])) : {};
}
