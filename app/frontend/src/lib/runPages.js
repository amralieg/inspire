import { APP_INSIDE, APP_INSIDE_PLACEMENT, OPEN_ALL_SETTINGS, VIBE_FEATURES_LABEL } from './implementWizard.js';
import { SHOWCASE_BUTTON } from './showcase.js';
import { HOME_TAB } from './tabs.js';

export const RUN_TAB = 'run';
export const RUN_BANNER = 'Inside Inspire, only for testing. Give it its own App for real use.';
export const RUN_EMPTY = `No use case is deployed yet. To try a page Inside Inspire, open the use case in Build, press ${VIBE_FEATURES_LABEL}, then ${OPEN_ALL_SETTINGS}, `
  + `and on App placement pick ${APP_INSIDE_PLACEMENT.label}. Use cases with an App of their own show up here too.`;
export const RUN_NO_DOMAIN = 'No domain';
export const RUN_OPEN_APP = 'Open App';
export const RUN_REBUILD = 'Open its Build page to rebuild';
export const RUN_POLL_MS = 3000;
export const RUN_STATE_LABELS = { starting: 'Starting', ready: 'Ready', stopped: 'Stopped', failed: 'Failed' };
export const RUN_STOPPED_FIRST = 'Opening it starts it';
export const RUN_OPEN = 'Open full window';
export const RUN_BACK = 'Back to Inspire';
export const RUN_NEW_TAB = 'Open in a new tab';
export const RUN_SWITCH = 'Switch use case';
export const RUN_CONTROL = 'Inspire menu: back to Inspire, switch use case, or open in a new tab';
export const RUN_FULL_STATE = 'inspireRunFull';
export const INSPIRE_ENTRY = 'inspirePage';
export const RUN_OPENING = 'Opening the page';
const RUN_PATH_RE = /^\/run\/[a-z0-9-]{1,63}\/#\/[A-Za-z0-9_%-]{1,192}$/;

export const RUN_DEMO_KIND = 'demo';
export const RUN_DEMO_NOTE = 'In the demo, each MVP App answers from its recording, so it shows the numbers and charts Inspire built.';
const RUN_DEMO_PATH_RE = /^\/showcase\/[a-z0-9][a-z0-9-]{0,39}\/mvp\/[A-Za-z0-9-]{1,20}\/$/;

export function demoRunPages(showcase) {
  const mvps = Array.isArray(showcase?.mvps) ? showcase.mvps : [];
  return mvps
    .filter((m) => m && typeof m.id === 'string' && RUN_DEMO_PATH_RE.test(String(m.url || '')))
    .map((m) => ({ kind: RUN_DEMO_KIND, id: m.id, use_case_id: m.id, name: String(m.title || m.id), domain: String(showcase.business || ''), path: m.url }));
}

const RUN_HASH_RE = /^#\/run\/([^/?#]*)$/;
const RUN_ID_RE = /^[a-z0-9-]{1,63}$/;
const REVIEW_HASH_RE = /^#\/review\/([^/?#]*)(?:\/([^/?#]*))?$/;
const REVIEW_SESSION_RE = /^\d{1,19}$/;
export const REVIEW_TAB = 'results';
export const BUILD_TAB = 'implement';
export const MONITOR_TAB = 'monitor';
export const HOME_PAGE = HOME_TAB.id;
export const START_PAGE = 'choose';

const PAGE_HASHES = { [HOME_PAGE]: 'home', [START_PAGE]: 'start', launch: 'launch', 'generate-data': 'generate-data' };
const PAGE_OF_HASH = Object.fromEntries(Object.entries(PAGE_HASHES).map(([page, word]) => [word, page]));
const DEMO_HASHES = { [START_PAGE]: 'start', [MONITOR_TAB]: 'monitor', [REVIEW_TAB]: 'review', [BUILD_TAB]: 'build', [RUN_TAB]: 'run' };
const DEMO_PAGE_OF_HASH = Object.fromEntries(Object.entries(DEMO_HASHES).map(([page, word]) => [word, page]));
const DEMO_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RUN_JOB_RE = /^\d{1,19}$/;

function decoded(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function hashLink(hash) {
  const text = String(hash || '');
  if (text === '#/run') return { page: RUN_TAB, id: '', bare: true };
  const run = RUN_HASH_RE.exec(text);
  if (run) {
    const id = decoded(run[1]);
    return { page: RUN_TAB, id: id !== null && RUN_ID_RE.test(id) ? id : '' };
  }
  if (text === '#/review') return { page: REVIEW_TAB, bare: true };
  const review = REVIEW_HASH_RE.exec(text);
  if (review) {
    const sessionId = decoded(review[1]);
    const useCaseId = decoded(review[2] ?? '');
    if (sessionId === null || useCaseId === null) return { page: REVIEW_TAB, sessionId: '', useCaseId: '', valid: false };
    const session = sessionId.trim();
    return { page: REVIEW_TAB, sessionId: session, useCaseId: useCaseId.trim(), valid: REVIEW_SESSION_RE.test(session) };
  }
  return pageLink(text);
}

function pageLink(text) {
  const path = /^#\/([^?#]+)$/.exec(text);
  if (!path) return null;
  const words = path[1].split('/').map(decoded);
  if (words.some((word) => word === null)) return null;
  const [word, ...rest] = words;
  if (PAGE_OF_HASH[word]) return rest.length ? null : { page: PAGE_OF_HASH[word] };
  if ((word === 'monitor' || word === 'build') && !rest.length) return { page: word === 'monitor' ? MONITOR_TAB : BUILD_TAB, bare: true };
  const sessionOk = rest.length >= 1 && rest.length <= 2 && REVIEW_SESSION_RE.test(rest[0]);
  if (word === 'monitor' && sessionOk && (rest.length === 1 || RUN_JOB_RE.test(rest[1]))) return { page: MONITOR_TAB, sessionId: rest[0], runId: rest[1] || '' };
  if (word === 'build' && sessionOk && rest[1] !== '') return { page: BUILD_TAB, sessionId: rest[0], useCaseId: rest[1] || '' };
  if (word !== 'demo' || !DEMO_ID_RE.test(rest[0] || '') || !DEMO_PAGE_OF_HASH[rest[1]]) return null;
  const page = DEMO_PAGE_OF_HASH[rest[1]];
  const extra = rest.slice(2);
  if (extra.length > (page === BUILD_TAB ? 1 : 0) || extra[0] === '') return null;
  return { page, demo: rest[0], useCaseId: extra[0] || '' };
}

const part = (value) => encodeURIComponent(String(value));

export function pageHash(route) {
  const page = route?.page;
  if (route?.demo && DEMO_HASHES[page]) {
    return `#/demo/${part(route.demo)}/${DEMO_HASHES[page]}${page === BUILD_TAB && route.useCaseId ? `/${part(route.useCaseId)}` : ''}`;
  }
  if (PAGE_HASHES[page]) return `#/${PAGE_HASHES[page]}`;
  if (page === MONITOR_TAB) return route.sessionId ? `#/monitor/${part(route.sessionId)}${route.runId ? `/${part(route.runId)}` : ''}` : '#/monitor';
  if (page === REVIEW_TAB) return route.sessionId ? `#/review/${part(route.sessionId)}` : '#/review';
  if (page === BUILD_TAB) return route.sessionId ? `#/build/${part(route.sessionId)}${route.useCaseId ? `/${part(route.useCaseId)}` : ''}` : '#/build';
  if (page === RUN_TAB) return route.id ? `#/run/${part(route.id)}` : '#/run';
  return '';
}

export const RUN_QUERY = 'run';
export const REVIEW_QUERY = 'review';
export const REVIEW_USE_CASE_QUERY = 'uc';
export const RUN_LEFT_DEMO = `You left the demo to open this link, because it names a page in your workspace and the demo runs only its own recorded MVP Apps. To see the demo again, choose ${SHOWCASE_BUTTON} on the Start page.`;
export const REVIEW_LEFT_DEMO = `You left the demo to open this link, because it names a run in your workspace and the demo shows only its own recorded run. To see the demo again, choose ${SHOWCASE_BUTTON} on the Start page.`;

export function queryLink({ pathname = '', search = '' } = {}) {
  const query = new URLSearchParams(search);
  let hash = '';
  if (query.has(RUN_QUERY)) hash = `#/run/${encodeURIComponent(query.get(RUN_QUERY))}`;
  else if (query.has(REVIEW_QUERY)) {
    hash = `#/review/${encodeURIComponent(query.get(REVIEW_QUERY))}/${encodeURIComponent(query.get(REVIEW_USE_CASE_QUERY) ?? '')}`;
  }
  if (!hash) return '';
  query.delete(RUN_QUERY);
  if (query.has(REVIEW_QUERY)) {
    query.delete(REVIEW_QUERY);
    query.delete(REVIEW_USE_CASE_QUERY);
  }
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

export function reviewLinkText(link, inspireDatabase, outcome) {
  const db = String(inspireDatabase || '').trim();
  const where = db ? `the Inspire Database ${db}` : 'this Inspire Database';
  const shown = String(link?.sessionId ?? '').slice(0, 80);
  if (!link?.valid) {
    return shown ? `That link names no run Inspire can open: ${shown} is not a run id. Here is every run.` : 'That link names no run. Here is every run.';
  }
  if (outcome === 'missing') return `Inspire has no run ${link.sessionId} in ${where}. Here is every run.`;
  if (outcome === 'denied') return `You cannot read run ${link.sessionId}: your sign-in has no read access to ${where}. Ask its owner for SELECT on it.`;
  if (outcome === 'no_use_case') return `Run ${link.sessionId} has no use case ${String(link.useCaseId).slice(0, 80)}, so Review shows every use case of the run.`;
  return '';
}

export function runUnknownText(id) {
  return id
    ? `Inspire has no page ${id} Inside Inspire that you can open: it may be uninstalled, moved to an App of its own, or not shared with you. Here is every deployed use case.`
    : 'That link names no page Inside Inspire. Here is every deployed use case.';
}

export function runKey(page) {
  if (page?.kind === RUN_DEMO_KIND) return `demo:${page.id}`;
  return page?.kind === APP_INSIDE ? `inspire:${page.id}` : `app:${page?.session_id}:${page?.use_case_id}`;
}

export function runGroups(pages) {
  const groups = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    const domain = String(page?.domain || '').trim() || RUN_NO_DOMAIN;
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(page);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === RUN_NO_DOMAIN) - (b === RUN_NO_DOMAIN) || a.localeCompare(b))
    .map(([domain, list]) => ({ domain, pages: list }));
}

export function runStateText(page) {
  const label = RUN_STATE_LABELS[page?.state] || RUN_STATE_LABELS.stopped;
  if (page?.state === 'failed') return `${label}: ${page.error || 'the page stopped'}`;
  if (page?.state === 'stopped' || !RUN_STATE_LABELS[page?.state]) return `${label}. ${page?.reason ? `${capital(page.reason)}.` : `${RUN_STOPPED_FIRST}.`}`;
  return label;
}

export function runFrameSrc(page) {
  const path = String(page?.path || '');
  if (page?.kind === RUN_DEMO_KIND) return RUN_DEMO_PATH_RE.test(path) ? path : '';
  return page?.kind === APP_INSIDE && RUN_PATH_RE.test(path) ? path : '';
}

export function runFullPage(pages, key) {
  if (!key) return null;
  return (Array.isArray(pages) ? pages : []).find((p) => runKey(p) === key && runFrameSrc(p)) || null;
}

export function runFramedPages(pages) {
  return runGroups(pages).flatMap((g) => g.pages).filter((p) => runFrameSrc(p));
}

export function runAppUrl(page) {
  const url = String(page?.app_url || '').trim();
  return /^https:\/\//i.test(url) ? url : '';
}

export function runPolling(pages, picked) {
  return (Array.isArray(pages) ? pages : []).some((p) => p.kind === APP_INSIDE && (p.state === 'starting' || (runKey(p) === picked && p.state === 'stopped')));
}

export function runPicked(pages, picked) {
  const list = Array.isArray(pages) ? pages : [];
  return list.find((p) => runKey(p) === picked) || list.find((p) => p.kind === APP_INSIDE || p.kind === RUN_DEMO_KIND) || list[0] || null;
}

function capital(text) {
  const value = String(text || '').trim();
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}
