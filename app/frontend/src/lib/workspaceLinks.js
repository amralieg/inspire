/** Collapse `/./` and `/../` (e.g. `/Shared/../demos/x` → `/demos/x`). */
export function normalizeDatabricksFsPath(p) {
  if (p == null || typeof p !== 'string') return '';
  const t = p.trim().replace(/\/+/g, '/');
  if (!t) return '';
  if (!t.startsWith('/')) return t;
  const segments = t.split('/').filter(Boolean);
  const stack = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (stack.length) stack.pop();
    } else stack.push(seg);
  }
  return stack.length ? `/${stack.join('/')}` : '/';
}

/** The folder a session writes to: `generation_path` (a relative one resolved from the agent notebook's folder) plus the sanitized business name. */
export function generationFolder({ generationPath, notebookPath, businessName }) {
  const gp = String(generationPath || '').trim();
  if (!gp) return '';
  const nb = normalizeDatabricksFsPath(notebookPath || '');
  const nbJoin = nb && !nb.startsWith('/Volumes/') && nb.startsWith('/') && !nb.startsWith('/Workspace') ? `/Workspace${nb}` : nb;
  const notebookDir = nbJoin.includes('/') ? nbJoin.replace(/\/[^/]+$/, '') : '';
  const root = gp.startsWith('/') || !notebookDir
    ? normalizeDatabricksFsPath(gp)
    : normalizeDatabricksFsPath(`${notebookDir}/${gp.replace(/^\.\/+/, '')}`);
  const name = businessName
    ? String(businessName).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || '_'
    : '';
  return name && root ? normalizeDatabricksFsPath(`${root.replace(/\/+$/, '')}/${name}`) : root;
}

export function sharedFolderWarning(folder) {
  const path = workspaceWebUiHashPath(folder);
  if (!/^\/Workspace\/Shared(\/|$)/.test(path)) return '';
  return `Inspire saves this MVP in ${path.replace(/\/+$/, '')}_implemented, a shared folder: anyone in the workspace can change or delete it, `
    + 'and each person sees its data only with their own access. To keep it to yourself, run Discover again and save it under your own user folder.';
}

/** `#workspace` deep-link segment — UI expects `/Workspace/...` on current control planes. */
export function workspaceWebUiHashPath(fsPath) {
  const n = normalizeDatabricksFsPath(fsPath);
  if (!n || n.startsWith('/Volumes/')) return n;
  if (n.startsWith('/Workspace')) return n;
  return `/Workspace${n}`;
}

function workspaceOrigin(databricksHost) {
  const base = databricksHost.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  return base.startsWith('http') ? base : `https://${base}`;
}

export function workspaceNotebookUrl(databricksHost, notebookPath) {
  if (!notebookPath || !databricksHost) return '';
  const path = workspaceWebUiHashPath(notebookPath);
  const pathSeg = path.startsWith('/') ? path : `/${path}`;
  return `${workspaceOrigin(databricksHost)}/#workspace${pathSeg}`;
}

export function workspaceJobUrl(databricksHost, jobId) {
  const id = String(jobId ?? '').trim();
  if (!/^\d+$/.test(id) || !databricksHost) return '';
  return `${workspaceOrigin(databricksHost)}/#job/${id}`;
}
