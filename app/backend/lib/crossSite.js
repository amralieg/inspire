const { pageOrigin } = require('./hostedRun');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const OWN_SITES = new Set(['same-origin', 'none']);
const CROSS_SITE_REFUSAL = 'Inspire takes changes only from its own pages, and this request came from another site, so nothing changed. Open Inspire and try again there.';

function crossSiteProblem(req) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return '';
  const headers = req.headers || {};
  const site = String(headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (site) return OWN_SITES.has(site) ? '' : CROSS_SITE_REFUSAL;
  const origin = String(headers.origin || '').trim().toLowerCase();
  if (!origin) return '';
  return origin === pageOrigin(req) ? '' : CROSS_SITE_REFUSAL;
}

function crossSiteGuard(req, res, next) {
  const problem = crossSiteProblem(req);
  if (!problem) return next();
  return res.status(403).json({ error: problem, cross_site: true });
}

module.exports = { CROSS_SITE_REFUSAL, crossSiteProblem, crossSiteGuard };
