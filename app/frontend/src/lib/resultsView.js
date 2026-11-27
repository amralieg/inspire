// The 2 views of the run results (Use cases, Overview). The view lives in the URL query as `view=`, so Back, a reload and a shared link land on the same view.
export const RESULTS_VIEWS = [
  { id: 'usecases', label: 'Use cases' },
  { id: 'overview', label: 'Overview' },
];
export const DEFAULT_RESULTS_VIEW = 'usecases';
export const RESULTS_VIEW_QUERY = 'view';

// Links made before C28 (REQ-568) say view=business or view=assets: both land on Overview.
const RENAMED = { business: 'overview', assets: 'overview' };

export function viewOfSearch(search) {
  const asked = new URLSearchParams(search || '').get(RESULTS_VIEW_QUERY);
  const want = RENAMED[asked] || asked;
  return RESULTS_VIEWS.some((v) => v.id === want) ? want : DEFAULT_RESULTS_VIEW;
}

export function searchWithView(search, view) {
  const query = new URLSearchParams(search || '');
  if (view === DEFAULT_RESULTS_VIEW) query.delete(RESULTS_VIEW_QUERY);
  else query.set(RESULTS_VIEW_QUERY, view);
  const text = query.toString();
  return text ? `?${text}` : '';
}
