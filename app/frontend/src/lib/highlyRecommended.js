import { counted } from './plural.js';
import { firstRunDefault, groupingBest, groupingCount, profileRecords } from './runScope.js';
import {
  APP_OWN_PLACEMENTS, IMPLEMENT_OUTPUTS, NONE_WORKS, affordable, blockOf, REMOVED_OUTPUT_DEFAULT, VIBE_PREVIOUS_DEFAULT, appBackendDefault, appPagesOf, insideInspire, newAppPlacementBlock, placementTarget,
} from './implementWizard.js';

export const HIGHLY_RECOMMENDED = 'Highly Recommended';
export { NONE_WORKS, affordable };

const OUTPUT_ORDER = ['app', 'genie_space', 'dashboard', 'alert'];
const OUTPUT_REASONS = {
  app: 'People act on each flagged record in one place.',
  genie_space: 'The App cannot be built here, so people ask about the results in plain words.',
  dashboard: 'The App and the Genie Agent cannot be built here, so a dashboard shows the results.',
  alert: 'Only alerts can be built here, so people get an email when records need action.',
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

function blocksOf(given) {
  return Array.isArray(given) ? Object.fromEntries(given.map((id) => [id, { why: 'off' }])) : given || {};
}

export function bestOutput(unavailable = []) {
  const order = OUTPUT_ORDER.filter((o) => IMPLEMENT_OUTPUTS.some((x) => x.id === o));
  return affordable(order, blocksOf(unavailable), (id) => OUTPUT_REASONS[id]).best;
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

export const RESULT_PLACE_ORDER = ['own', 'inspire', 'pick'];

export function resultPlaceBlocks(ownSchema, ownTable, inspireTable, catalog = '') {
  const blocks = {};
  if (!ownTable || ownSchema?.place === 'inspire') {
    blocks.own = blockOf(ownTable ? 'Inspire cannot create a schema of its own here.' : 'There is no schema of its own to name here.',
      ownSchema?.note || (catalog ? `GRANT CREATE SCHEMA ON CATALOG \`${catalog}\` TO <you>` : ''));
  }
  if (!inspireTable) blocks.inspire = blockOf('There is no Inspire database to hold it.');
  return blocks;
}

export function bestResultPlace(blocks, catalog = '') {
  return affordable(RESULT_PLACE_ORDER, blocks, (id) => (id === 'own' ? bestResultTable('own').reason : bestResultTable(id, catalog)?.reason || '')).best;
}

export function bestResultTable(place, catalog = '') {
  if (place === 'own') return pick('own', 'A schema of its own keeps this use case\'s tables apart from every other use case.');
  return place ? pick(place, `It is where you can write today${catalog ? `; a schema of its own needs CREATE SCHEMA on ${catalog}` : ''}.`) : null;
}

export function bestFreshness(spec) {
  return spec?.outputs?.alert ? pick('daily', 'The alert checks fresh records each day.')
    : pick('daily', 'Fresh results every morning, so people act on today\u2019s records.');
}

export function bestHoldout() {
  return pick(true, 'It shows what the MVP changed, against records nobody acted on.');
}

export function bestKpi(options = [], tracked = null) {
  const name = tracked?.record?.name || '';
  if (name && (options || []).some((o) => String(o.name).toLowerCase() === String(name).toLowerCase())) return pick(name, 'It is the KPI this use case already tracks.');
  return pick('', 'Inspire picks your strategy\u2019s KPI, else the first it can compute.');
}

export function bestAppTarget(spec, targets, scope) {
  const target = targets ? placementTarget(spec, targets, { ...scope, placement: 'domain' }) : null;
  return target ? pick(target.id, `It already holds ${scope.domain || 'this domain'} use cases.`) : null;
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

export function appPolicyBlocks(spec, targets, scope) {
  return Object.fromEntries(APP_OWN_PLACEMENTS.map((p) => [p.id, newAppPlacementBlock(spec, targets, scope, p.id)])
    .filter(([, why]) => why).map(([id, why]) => [id, blockOf(why)]));
}

export function bestAppPolicy(spec, targets, scope) {
  return affordable(APP_OWN_PLACEMENTS.map((p) => p.id), appPolicyBlocks(spec, targets, scope), (id) => POLICY_REASONS[id](scope)).best;
}

export function bestAppAccess({ inside = false, personal = '' } = {}) {
  if (inside) return pick('user', 'Inside Inspire, each viewer signs in as themselves.');
  return personal ? pick('user', `${personal} looks personal, so each person sees only their own rows.`)
    : pick('sp', 'No column looks personal, so everyone can see the same rows.');
}

export function bestAppBackend(spec, lakebase) {
  if (!spec?.outputs?.app) return null;
  if (appBackendDefault(spec, lakebase) === 'lakebase') return pick('lakebase', 'Pages open at once.');
  if (insideInspire(spec) || spec.outputs.app_access === 'user') return pick('delta', 'Lakebase does not apply here, so it reads Delta tables.');
  if (spec.outputs.merge?.app) return pick('delta', 'The App it joins reads Delta tables.');
  return lakebase?.state === 'absent' ? pick('delta', 'Lakebase is not open to this App, so it reads Delta tables.')
    : pick('delta', 'Inspire could not check Lakebase, so it reads Delta tables.');
}

export function bestAppOption() {
  return pick('decisions', 'Owners track each flagged record to the end.');
}

export function bestMerge(label, list = []) {
  return pick('', (list || []).length ? `A new ${label} holds only this use case.` : 'Inspire has built none yet.');
}

export function bestRemoved() {
  return pick(REMOVED_OUTPUT_DEFAULT, 'Nothing is deleted.');
}

export function bestVibePrevious(live) {
  return pick(VIBE_PREVIOUS_DEFAULT, `You can compare v${live} with the new version.`);
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
