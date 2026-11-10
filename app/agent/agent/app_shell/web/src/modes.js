export const DEFAULT_LAYOUT = 'decision_queue';
export const layoutOf = (page) => page?.layout?.id || DEFAULT_LAYOUT;
export const isLaidOut = (page) => layoutOf(page) !== DEFAULT_LAYOUT;
const WORK_QUEUE = 'queue';
const workOf = (page) => (page?.layout ? page.layout.work || '' : WORK_QUEUE);
export const isQueue = (page) => !!page?.records && workOf(page) === WORK_QUEUE;

export const SECTION_TITLES = { dashboard: 'Dashboard', inbox: 'Inbox', work: 'Work', performance: 'Performance', runs: 'Runs', alerts: 'Alerts', settings: 'Settings' };

export const MODES = Object.freeze({
  queue: Object.freeze({ id: 'queue', work: 'Work', performance: 'Performance', queue: true }),
  plan: Object.freeze({ id: 'plan', work: 'Plan', performance: 'Performance', queue: false }),
  forecast: Object.freeze({ id: 'forecast', work: 'Review', performance: 'Accuracy', queue: false }),
  scenarios: Object.freeze({ id: 'scenarios', work: 'Scenarios', performance: 'Performance', queue: false }),
  explore: Object.freeze({ id: 'explore', work: 'Explore', performance: 'Usage', queue: false }),
  ask: Object.freeze({ id: 'ask', work: 'Ask', performance: 'Answer quality', queue: false }),
});
export const DEFAULT_MODE = 'queue';
export const performanceOn = (app) => app?.screens?.performance !== false;

const LAYOUT_MODES = { dashboard: 'explore', agent_chat: 'ask' };
const CONTRACT_MODES = { plan: 'plan', forecast: 'forecast', scenario: 'scenarios' };

const own = (map, key) => (typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : '');

export function layoutMode(layout) {
  return own(LAYOUT_MODES, layout?.id) || own(CONTRACT_MODES, layout?.contract) || DEFAULT_MODE;
}

export const pageMode = (page) => MODES[layoutMode(page?.layout)];

export function hasWork(page) {
  const mode = pageMode(page);
  if (mode.queue) return isQueue(page);
  if (mode.id === 'scenarios') return !!page?.scenario;
  return true;
}

export function sectionTitle(page, section) {
  const mode = pageMode(page);
  if (section === 'work') return mode.work;
  if (section === 'performance') return mode.performance;
  return own(SECTION_TITLES, section) || section;
}

export const MODE_VIEWS = Object.freeze({
  plan: () => import('./PlanMode.jsx'),
  forecast: () => import('./ForecastMode.jsx'),
  scenarios: () => import('./ScenariosMode.jsx'),
  explore: () => import('./ExploreMode.jsx'),
  ask: () => import('./AskMode.jsx'),
});
