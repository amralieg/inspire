const fs = require('node:fs');
const path = require('node:path');
const { sourceFiles, withoutComments } = require('./frontendSource');
const { appShellFiles, appShellPayload, bundledAppShellText } = require('../../lib/appShell');

const APP = path.resolve(__dirname, '..', '..', '..');
const LISTS = path.join(APP, 'scripts', 'showcaseRoutes.mjs');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WORKSPACE_API = /^\/api\/2\.\d+\//;
const PATH_CHAR = /[A-Za-z0-9_.\-/]/;

function skipQuoted(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === quote) return i;
    else if (quote === '`' && text.startsWith('${', i)) i = skipExpression(text, i + 2) - 1;
  }
  return text.length;
}

function skipExpression(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (c === "'" || c === '"' || c === '`') i = skipQuoted(text, i);
  }
  return text.length;
}

function apiPathAt(text, at) {
  let out = '';
  let i = at;
  while (i < text.length) {
    if (text.startsWith('${', i)) {
      if (!out.endsWith('/')) break;
      out += ':p';
      i = skipExpression(text, i + 2);
    } else if (PATH_CHAR.test(text[i])) {
      out += text[i];
      i += 1;
    } else break;
  }
  return out.replace(/[/.]+$/, '');
}

function prefixCheckAt(text, at) {
  return /\.startsWith\(\s*['"`]$/.test(text.slice(Math.max(0, at - 24), at));
}

function frontendPaths(app = APP) {
  const files = [...sourceFiles(path.join(app, 'frontend', 'src'), ['.js', '.jsx']), ...sourceFiles(path.join(app, 'scripts'), ['.js', '.mjs'])]
    .filter((file) => path.basename(file) !== path.basename(LISTS));
  const found = new Map();
  for (const file of files) {
    const text = withoutComments(fs.readFileSync(file, 'utf8'));
    for (let at = text.indexOf('/api/'); at >= 0; at = text.indexOf('/api/', at + 1)) {
      const p = apiPathAt(text, at);
      if (!/^\/api\/[^/]/.test(p) || WORKSPACE_API.test(p) || prefixCheckAt(text, at)) continue;
      if (!found.has(p)) found.set(p, new Set());
      found.get(p).add(path.relative(app, file));
    }
  }
  return found;
}

function backendRoutes(app = APP) {
  const files = [path.join(app, 'backend', 'server.js'), path.join(app, 'backend', 'implementRoutes.js'), ...sourceFiles(path.join(app, 'backend', 'lib'), ['.js'])];
  const found = new Set();
  for (const file of files) {
    const text = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/api\/[^'"`]*)\2/g)) {
      const pattern = m[3].replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z_]\w*/g, ':p');
      for (const method of m[1] === 'all' ? METHODS : [m[1].toUpperCase()]) found.add(`${method} ${pattern}`);
    }
  }
  return found;
}

function mvpRoutes() {
  const files = appShellFiles(appShellPayload(bundledAppShellText()));
  const js = Object.entries(files).filter(([name]) => name.startsWith('static/') && name.endsWith('.js')).map(([, body]) => String(body)).join('\n');
  const found = new Set();
  for (const m of js.matchAll(/\("(GET|POST|PUT|PATCH|DELETE)",\s*(["`])([a-z][^"`]*)\2/g)) found.add(`${m[1]} ${apiPathAt(`/api/${m[3]}`, 0)}`);
  return found;
}

const split = (route) => route.split(' ');
const matches = (called, pattern) => {
  const a = called.split('/');
  const b = pattern.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || b[i] === ':p');
};

function routeGaps({ backend, frontend, mvp, reads, readsWhen, notInDemo, canRead }) {
  const problems = [];
  const reachable = new Set();
  const mvpPaths = new Set([...mvp].map((route) => split(route)[1]));
  for (const [called, files] of frontend) {
    const hit = [...backend].filter((route) => matches(called, split(route)[1]));
    if (!hit.length && !mvpPaths.has(called)) problems.push(`${called} is called from ${[...files].sort().join(', ')}, but no route of the App or of an MVP App serves it`);
    hit.forEach((route) => reachable.add(route));
  }
  const seen = new Map();
  for (const [name, list] of [['walk', reads], ['walk when the run has it', readsWhen], ['not in the demo', notInDemo]]) {
    for (const [route, why] of Object.entries(list)) {
      if (seen.has(route)) problems.push(`${route} is on two lists: ${seen.get(route)} and ${name}`);
      seen.set(route, name);
      if (typeof why !== 'string' || why.trim().split(/\s+/).length < 4) problems.push(`${route} on the ${name} list gives no reason`);
      if (!reachable.has(route)) problems.push(`${route} is on the ${name} list, but no page of the App calls it`);
      else if (!canRead(...split(route))) problems.push(`${route} is on the ${name} list, but it is a change the demo refuses`);
    }
  }
  for (const route of [...reachable].sort()) {
    if (canRead(...split(route)) && !seen.has(route)) {
      problems.push(`${route} is a read a page can send, but the demo walk never records it and the not-in-demo list does not explain why`);
    }
  }
  return problems;
}

module.exports = { APP, LISTS, WORKSPACE_API, apiPathAt, backendRoutes, frontendPaths, matches, mvpRoutes, prefixCheckAt, routeGaps, split };
