export const HOME_TAB = { id: 'landing', label: 'Home' };

export const APP_TABS = [
  { id: 'choose', label: 'Start', blurb: 'Point Inspire at your catalog, your business and your goals.' },
  { id: 'monitor', label: 'Monitor', blurb: 'Watch Inspire scan the metadata and write the use cases.' },
  { id: 'results', label: 'Review', blurb: 'Read the ranked use cases with their domains, strategy coverage and Best of Best picks.' },
  { id: 'implement', label: 'Build', blurb: 'Genie builds an MVP per use case: notebook, App, dashboard, Genie Agent and alert, with your vibes and a checklist.' },
  { id: 'run', label: 'Run', blurb: 'Open and use the MVPs, act on their lists and track the impact.' },
];

export const NAV_TABS = [HOME_TAB, ...APP_TABS];

export const REMOVED_TAB_LABELS = ['Get Started', 'Results'];
