import { counted } from './plural.js';
import { firstRunDefault, groupingBest, groupingCount, profileRecords } from './runScope.js';
import { APP_OWN_PLACEMENTS, IMPLEMENT_OUTPUTS, appPagesOf, newAppPlacementBlock, placementTarget } from './implementWizard.js';

export const HIGHLY_RECOMMENDED = 'Highly Recommended';

const OUTPUT_ORDER = ['app', 'genie_space', 'dashboard', 'alert'];
const OUTPUT_REASONS = {
  app: 'People act on each flagged record in one place.',
  genie_space: 'Apps are off here, so people ask about the results in plain words.',
  dashboard: 'Apps and Genie Agents are off here, so a dashboard shows the results.',
  alert: 'Only alerts are on here, so people get an email when records need action.',
};
const POLICY_REASONS = {
  domain: (scope) => `Use cases of ${scope.domain || 'the same domain'} share one App.`,
  use_case: () => 'This use case needs an App of its own.',
  business: (scope) => `Every use case of ${scope.business || 'this business'} shares one App.`,
};

function pick(id, reason) {
  return { id, reason };
}

export function isBest(best, id) {
  return Boolean(best) && best.id === id;
}

export function bestMode({ genieOff = null } = {}) {
  return genieOff ? pick('notebook', 'Genie Code is off in this workspace, so Inspire writes the notebook only.')
    : pick('mvp', 'You see it run end to end.');
}

export function bestOutput(unavailable = []) {
  const off = new Set(unavailable || []);
  const id = OUTPUT_ORDER.find((o) => !off.has(o) && IMPLEMENT_OUTPUTS.some((x) => x.id === o));
  return id ? pick(id, OUTPUT_REASONS[id]) : null;
}

export function bestGrouping(profile, choices) {
  const best = groupingBest(profile, choices);
  if (!best) return null;
  if (best.deep) return pick(best.value, 'Discovery picked it for this use case.');
  if (best.columns.length) {
    const count = groupingCount(best, profile);
    return pick(best.value, count == null ? 'It splits the data into fair groups.' : `It splits the data into ${counted(count, 'fair group')}.`);
  }
  return pick(best.value, profile?.applies === true ? 'No column splits the data into fair groups.' : 'Groups do not apply to this technique.');
}

export function bestFirstRun(profile, choices = []) {
  const open = (choices || []).filter((c) => c.available !== false);
  const want = firstRunDefault(profile) || 'records';
  const found = open.find((c) => c.id === want) || open.find((c) => c.scope === want) || open[0];
  if (!found) return null;
  const records = profileRecords(profile);
  const reasons = {
    one: 'One group shows results soonest.',
    groups: 'A few groups show results sooner.',
    records: records == null ? 'A sample shows results sooner.' : `A sample shows results sooner than all ${counted(records, 'record')}.`,
    recent: 'Recent records show results sooner.',
    all: 'It covers every record.',
  };
  return pick(found.id, reasons[found.id] || '');
}

export function bestResultTable(defaultTable) {
  return defaultTable ? pick(defaultTable, 'It sits in the Inspire Database, where the App and the dashboard read it.') : null;
}

export function bestFreshness(spec) {
  return spec?.outputs?.alert ? pick('daily', 'The alert checks fresh records each day.')
    : pick('weekly', 'Fresh each Monday at a low cost.');
}

export function bestHoldout() {
  return pick(true, 'It shows what the MVP changed, against records nobody acted on.');
}

export function bestKpi(options = [], tracked = null) {
  const name = tracked?.record?.name || '';
  if (name && (options || []).some((o) => String(o.name).toLowerCase() === String(name).toLowerCase())) return pick(name, 'It is the KPI this use case already tracks.');
  return pick('', 'Inspire picks your strategy\u2019s KPI, else the first it can compute.');
}

export function bestAppPlace(spec, targets, scope) {
  if (!targets) return null;
  const target = placementTarget(spec, targets, { ...scope, placement: 'domain' });
  return target ? pick('join', `${target.name} already holds ${scope.domain || 'this domain'} use cases.`)
    : pick('new', (targets.app || []).length ? `No App Inspire built fits ${scope.domain || 'this use case'} yet.` : 'Inspire has built no App yet.');
}

export function bestHeldApp(name) {
  return name ? pick('held', `People already open ${name}.`) : null;
}

export function bestAppPolicy(spec, targets, scope) {
  const open = APP_OWN_PLACEMENTS.find((p) => !newAppPlacementBlock(spec, targets, scope, p.id));
  return open ? pick(open.id, POLICY_REASONS[open.id](scope)) : null;
}

export function bestAppAccess({ inside = false, personal = '' } = {}) {
  if (inside) return pick('user', 'Inside Inspire, each viewer signs in as themselves.');
  return personal ? pick('user', `${personal} looks personal, so each person sees only their own rows.`)
    : pick('sp', 'No column looks personal, so everyone can see the same rows.');
}

export function bestAppBackend(lakebase, block = '') {
  if (block || lakebase?.state === 'absent') return pick('delta', 'Lakebase is not open to this App, so it reads Delta tables.');
  return pick('lakebase', 'Pages open at once.');
}

export function bestAppOption() {
  return pick('decisions', 'Owners track each flagged record to the end.');
}

export function bestReplaceEdits() {
  return pick(false, 'What people changed stays.');
}

export const LAYOUT_TABS_MAX = 3;

export function bestLook(kind, spec) {
  if (kind === 'style') return pick('a', 'It matches the Lakeview dashboards people know.');
  if (kind === 'layout') {
    const pages = appPagesOf(spec).filter((p) => p.on).length;
    return pages <= LAYOUT_TABS_MAX ? pick('tabs', `${counted(pages, 'page')} fit as tabs on top.`) : pick('sidebar', `${counted(pages, 'page')} fit in one menu.`);
  }
  if (kind === 'theme') return pick('light', 'It matches the Databricks workspace.');
  if (kind === 'palette') return pick('default', 'The Databricks colors.');
  return null;
}
