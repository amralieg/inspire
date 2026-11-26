export const ONBOARD_PARAM = 'onboard';
export const ONE_BY_ONE_MAX = 20;

export const WORK_MODES = [['one', 'One by one'], ['all', 'All at once'], ['auto', 'Depends on how many']];
export const HELP_LEVELS = [['guide', 'Show me around'], ['visuals', 'Just the visuals'], ['expert', "I'm an expert"]];
export const MOTIONS = [['lively', 'Lively'], ['calm', 'Calm'], ['off', 'Off']];
export const ONBOARD_DEFAULTS = { workMode: 'auto', help: 'guide', motion: 'calm' };

export const QUESTIONS = [
  { id: 'work', key: 'workMode', title: 'How do you like to work?', options: WORK_MODES,
    why: { one: 'One item at a time, with a question on each.', all: 'The whole list, with bulk actions.', auto: `One by one when ${ONE_BY_ONE_MAX} or fewer items need you, the whole list when more.` } },
  { id: 'help', key: 'help', title: 'How much help do you want?', options: HELP_LEVELS,
    why: { guide: 'A short tour and the explainers open by themselves.', visuals: 'Pictures and chips, no tour unless you ask.', expert: 'No tour. Explainers only when you tap.' } },
  { id: 'motion', key: 'motion', title: 'How much motion?', options: MOTIONS,
    why: { lively: 'Movement shows what changed.', calm: 'Small, slow movement.', off: 'Nothing moves.' } },
];

const allowed = (list, value) => list.some(([id]) => id === value);

export const cleanWorkMode = (v) => (allowed(WORK_MODES, v) ? v : '');
export const cleanHelp = (v) => (allowed(HELP_LEVELS, v) ? v : '');
export const cleanMotion = (v) => (allowed(MOTIONS, v) ? v : '');

export function onboardAsked(search = window.location.search) {
  return new URLSearchParams(search).get(ONBOARD_PARAM) || '';
}

// Asked once per person: all three answers stored (Skip stores the defaults). Automation is not asked unless the URL asks.
export function onboardDue(prefs, asked = onboardAsked(), automated = !!navigator.webdriver) {
  if (prefs.workMode && prefs.help && prefs.motion) return false;
  if (asked === '1') return true;
  return !automated;
}

export function resolveWorkMode(prefs, count) {
  const mode = prefs.workMode || ONBOARD_DEFAULTS.workMode;
  if (mode !== 'auto') return mode;
  return count <= ONE_BY_ONE_MAX ? 'one' : 'all';
}

// prefers-reduced-motion always wins over the chosen motion.
export function motionOf(prefs, reduced) {
  return reduced ? 'off' : prefs.motion || ONBOARD_DEFAULTS.motion;
}

// Only a person who chose Just the visuals or I'm an expert is spared the tour; unanswered keeps the old first-visit rule.
export const helpAllowsTour = (prefs) => !['visuals', 'expert'].includes(prefs.help);
