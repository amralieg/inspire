const DOT_SEGMENT = /^\.{1,2}$/;
const PATH_RULE = 'needs an absolute workspace or volume path, such as /Workspace/Users/<you>/inspire_output, with no . or .. folders.';

function workspacePathProblem(name, value) {
  if (typeof value !== 'string' || !value.trim()) return `${name} is required.`;
  const path = value.trim();
  if (!path.startsWith('/') || path.split('/').some((seg) => DOT_SEGMENT.test(seg))) return `${name} ${PATH_RULE}`;
  return '';
}

function rejectUnsafeQueryPath(req, res, next) {
  const problem = workspacePathProblem('path', req.query.path);
  if (problem) return res.status(400).json({ error: problem });
  return next();
}

function fsApiPath(kind, path) {
  return `/api/2.0/fs/${kind}${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

function attachmentHeader(fileName) {
  const name = String(fileName || '').trim() || 'file';
  const plain = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

module.exports = { PATH_RULE, workspacePathProblem, rejectUnsafeQueryPath, fsApiPath, attachmentHeader };
