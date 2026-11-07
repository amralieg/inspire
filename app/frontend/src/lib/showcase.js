import { APP_TABS } from './tabs.js';

export const SHOWCASE_SETTING = 'showcase';
export const SHOWCASE_PAGES = APP_TABS.map((tab) => tab.id);
export const SHOWCASE_BUTTON = 'See Demo';
export const SHOWCASE_NOTE = 'Nothing in the demo changes. Choose Get Started to find use cases and build MVPs on your own data.';
export const SHOWCASE_OPEN_APP = 'Open the MVP App';
export const SHOWCASE_DASHBOARD_NOTE = 'In your workspace this opens the dashboard Inspire built. The demo shows the same numbers and charts in the MVP App.';
export const SHOWCASE_ALERT_NOTE = 'In your workspace this opens the alert Inspire built. The demo has no workspace, so it shows what the alert checks and whom it emails.';
export const SHOWCASE_GENIE_NOTE = 'In your workspace this opens the Genie Agent Inspire built. In the demo, ask its suggested questions in the MVP App.';
export const SHOWCASE_NO_MVP = 'The demo has no MVP for this use case. Choose Get Started to build one on your own data.';

export function readOnlyReason(readOnly) {
  return readOnly ? SHOWCASE_NOTE : '';
}

export function showcaseSettings(settings, showcase) {
  if (!showcase) return settings;
  return {
    ...settings,
    token: '',
    databricksHost: '',
    notebookPath: '',
    serverEnvHasPat: false,
    inspireDatabase: SHOWCASE_SETTING,
    warehouseId: SHOWCASE_SETTING,
    showcase: showcase.id,
  };
}

export function showcasesFrom(data) {
  const list = data && Array.isArray(data.showcases) ? data.showcases : [];
  return list.filter((s) => s && typeof s.id === 'string' && s.id && typeof s.session_id === 'string' && s.session_id);
}

export function staysInShowcase(page) {
  return SHOWCASE_PAGES.includes(page);
}
