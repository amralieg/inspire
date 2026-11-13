import { displayCleanText } from './useCaseFields.js';
import { qualityBarCountText } from './qualityBarWording.js';

export const LATEST_RUN_LABEL = 'Latest Run';

const PARAGRAPH_BREAK = /<\/p>|<br\s*\/?>/i;

export function paragraphsOf(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const parts = PARAGRAPH_BREAK.test(text) ? text.split(new RegExp(PARAGRAPH_BREAK.source, 'gi')) : text.split(/\n\s*\n/);
  return parts.map((part) => displayCleanText(part).replace(/\s+/g, ' ')).filter(Boolean);
}

export function executiveSummaryOf(results) {
  return paragraphsOf(results?.executive_summary);
}

export const PORTFOLIO_GROUPS = [
  { id: 'found', label: 'Use cases found', cards: [
    { key: 'businesses', label: 'Businesses', one: 'business', many: 'businesses', opens: 'runs', none: 'No run names a business yet.' },
    { key: 'runs', label: 'Runs', one: 'run', many: 'runs', opens: 'runs', none: 'No run yet.' },
    { key: 'use_cases', label: 'Use cases', one: 'use case', many: 'use cases', opens: 'runs', none: 'No run has found a use case yet.' },
    { key: 'domains', label: 'Domains', one: 'domain', many: 'domains', opens: 'runs', none: 'No run has found a domain yet.' },
    { key: 'best_of_best', label: 'Best of Best', one: 'Best of Best use case', many: 'Best of Best use cases', opens: 'runs',
      none: 'No run has picked a Best of Best use case yet.' },
  ] },
  { id: 'built', label: 'MVPs built', cards: [
    { key: 'mvps_started', label: 'MVPs started', one: 'MVP started', many: 'MVPs started', opens: 'build', mvp: 'has',
      shows: 'use cases with an MVP', none: 'No MVP has been started yet.' },
    { key: 'mvps_live', label: 'MVPs live', one: 'live MVP', many: 'live MVPs', opens: 'build', mvp: 'live',
      shows: 'use cases with a live MVP', none: 'No MVP is live yet.' },
    { key: 'apps', label: 'Apps', one: 'App', many: 'Apps', opens: 'build', asset: 'app', shows: 'use cases with an App', none: 'No MVP has an App yet.' },
    { key: 'dashboards', label: 'Dashboards', one: 'dashboard', many: 'dashboards', opens: 'build', asset: 'dashboard',
      shows: 'use cases with a dashboard', none: 'No MVP has a dashboard yet.' },
    { key: 'genie_spaces', label: 'Genie Agents', one: 'Genie Agent', many: 'Genie Agents', opens: 'build', asset: 'genie_space',
      shows: 'use cases with a Genie Agent', none: 'No MVP has a Genie Agent yet.' },
    { key: 'alerts', label: 'Alerts', one: 'alert', many: 'alerts', opens: 'build', asset: 'alert', shows: 'use cases with an alert',
      none: 'No MVP has an alert yet.' },
  ] },
];

const PORTFOLIO_CARDS = Object.fromEntries(PORTFOLIO_GROUPS.flatMap((group) => group.cards).map((card) => [card.key, card]));

export function portfolioCard(key) {
  return PORTFOLIO_CARDS[key] || null;
}

export function runBusiness(session) {
  return typeof session?.business_name === 'string' ? session.business_name.trim() : '';
}

export function runLabel(session) {
  return runBusiness(session) || `Run ${session?.session_id ?? ''}`.trim();
}

const counted = (n, card) => `${n.toLocaleString('en-US')} ${n === 1 ? card.one : card.many}`;
const figureOf = (portfolio, session, key) => Number(portfolio?.sessions?.[String(session?.session_id ?? '')]?.[key]) || 0;

const RUN_FILTERS = {
  businesses: (session) => Boolean(runBusiness(session)) && Number(session?.business_rank) === 1,
  runs: () => true,
  use_cases: (session, portfolio) => figureOf(portfolio, session, 'use_cases') > 0,
  domains: (session, portfolio) => figureOf(portfolio, session, 'domains') > 0,
  best_of_best: (session, portfolio) => figureOf(portfolio, session, 'best_of_best') > 0,
};

export function runsOfCard(key, sessions, portfolio) {
  const keep = RUN_FILTERS[key];
  return keep ? (Array.isArray(sessions) ? sessions : []).filter((session) => keep(session, portfolio)) : [];
}

const countOf = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Math.floor(Number(value))));
const UNREAD_LABELS = { quality: 'Quality', high: 'High priority', domains: 'Domains' };

const qualityItem = (total, meetsValue, mode) => {
  const meets = countOf(meetsValue);
  return meets == null ? { key: 'quality_bar', n: null, label: 'quality bar' } : { key: 'quality_bar', n: meets, label: '', text: qualityBarCountText(total, meets, mode) };
};

export function runCounts(overview, portfolio, session, { running = false, mvpError = '' } = {}) {
  const item = (key, n, one, many = one) => ({ key, n, label: n === 1 ? one : many });
  const items = [];
  const why = [];
  let note = '';
  if (overview?.error) {
    why.push(`Use cases are not counted: ${overview.error}`);
  } else if (overview) {
    const total = countOf(overview.total) || 0;
    if (!total && running) return { items: [], note: 'No use cases yet', why: [] };
    if (!total) {
      items.push(item('use_cases', 0, 'use case', 'use cases'));
    } else {
      items.push(
        item('use_cases', total, running ? 'use case so far' : 'use case', running ? 'use cases so far' : 'use cases'),
        qualityItem(total, overview.meets, session?.results_json?.quality_bar?.mode || ''),
        item('high_priority', countOf(overview.high), 'high priority'),
        item('domains', countOf(overview.domains), 'domain', 'domains'),
      );
      why.push(...Object.entries(overview.unread || {}).filter(([key, text]) => UNREAD_LABELS[key] && text).map(([key, text]) => `${UNREAD_LABELS[key]} is not counted: ${text}.`));
    }
  }
  if (mvpError) {
    items.push(item('mvps_built', null, 'MVPs built'));
    why.push(`MVPs are not counted: ${mvpError}`);
  } else if (portfolio?.sessions) {
    items.push(item('mvps_built', figureOf(portfolio, session, 'mvps_live'), 'MVP built', 'MVPs built'),
      item('mvps_building', figureOf(portfolio, session, 'mvps_building'), 'building'),
      item('mvps_failed', figureOf(portfolio, session, 'mvps_failed'), 'failed'));
    const held = figureOf(portfolio, session, 'mvps_held');
    if (held) items.push(item('mvps_held', held, 'vibes not met'));
  }
  return { items, note, why };
}

export function buildRunsOfCard(key, sessions, portfolio) {
  if (portfolioCard(key)?.opens !== 'build') return [];
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => ({ session_id: String(session.session_id), name: runLabel(session), count: figureOf(portfolio, session, key) }))
    .filter((run) => run.count > 0);
}

export function portfolioCardAction(key, portfolio, sessions) {
  const card = portfolioCard(key);
  const n = Number(portfolio?.totals?.[key]) || 0;
  if (!card || !portfolio?.totals) return { live: false, label: '', why: '' };
  if (n === 0) return { live: false, label: '', why: card.none };
  if (card.opens === 'build') {
    if (!buildRunsOfCard(key, sessions, portfolio).length) {
      return { live: false, label: '', why: `The run list holds none of the runs these ${card.many} belong to.` };
    }
    return { live: true, label: `Show the ${counted(n, card)} in Build`, why: '' };
  }
  if (key === 'businesses') return { live: true, label: `Show the ${counted(n, card)}`, why: '' };
  if (key === 'runs') return { live: true, label: `Show the ${counted(n, card)}`, why: '' };
  if (key === 'best_of_best') return { live: true, label: `Show the runs with the ${counted(n, card)}`, why: '' };
  return { live: true, label: `Show the runs that found the ${counted(n, card)}`, why: '' };
}

export function runFilterText(key, shown, truncated = false) {
  const n = Number(shown) || 0;
  const runs = `${n.toLocaleString('en-US')} ${n === 1 ? 'run' : 'runs'}`;
  const text = {
    businesses: `the latest run of each of ${n.toLocaleString('en-US')} ${n === 1 ? 'business' : 'businesses'}`,
    runs: n === 1 ? 'the 1 run' : `all ${runs}`,
    use_cases: `the ${runs} that found use cases`,
    domains: `the ${runs} that found domains`,
    best_of_best: `the ${runs} with Best of Best use cases`,
  }[key];
  if (!text) return '';
  return `Showing: ${text}${truncated ? ', from the newest 1,000 runs' : ''}`;
}

export function buildFilterOf(key, sessions, portfolio) {
  const card = portfolioCard(key);
  const runs = buildRunsOfCard(key, sessions, portfolio);
  if (!card || !runs.length) return null;
  return { key, asset: card.asset || '', mvp: card.mvp || '', shows: card.shows, many: card.many, runs };
}

export function buildFilterText(filter, sessionId) {
  if (!filter) return '';
  const here = filter.runs.find((run) => run.session_id === String(sessionId));
  const where = here ? ` in ${here.name}` : '';
  return `Showing: ${filter.shows}${where}`;
}

export function isLatestRun(session) {
  return Boolean(runBusiness(session)) && Number(session?.business_runs) >= 2 && Number(session?.business_rank) === 1;
}

export function runDate(session) {
  return session?.last_updated || session?.completed_on || session?.create_at || '';
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function runFiguresOf(session, portfolio) {
  const figures = portfolio?.sessions?.[String(session?.session_id ?? '')];
  if (figures) return figures;
  const overview = session?.usecase_overview;
  if (overview && Number.isFinite(Number(overview.total))) return { use_cases: Number(overview.total) || 0, domains: Number(overview.domains) || 0 };
  return null;
}

export function runFigureParts(figures) {
  if (!figures) return [];
  const parts = [plural(figures.use_cases ?? 0, 'use case'), plural(figures.domains ?? 0, 'domain')];
  if (figures.subdomains != null) parts.push(plural(figures.subdomains, 'subdomain'));
  if (figures.best_of_best != null) parts.push(`${figures.best_of_best} Best of Best`);
  if (figures.mvps_started != null) parts.push(`${plural(figures.mvps_started, 'MVP')}, ${figures.mvps_live ?? 0} live`);
  if (figures.live_assets != null) parts.push(plural(figures.live_assets, 'live asset'));
  return parts;
}

export function scoreText(score) {
  return score != null && Number.isFinite(Number(score)) ? Number(score).toFixed(1) : '';
}
