const FS_DIRECTORIES = '/api/2.0/fs/directories';

function folderModel(overrides = {}) {
  return {
    folders: {}, volumes: {}, created: [], deleted: [], leftovers: [], leftoverFiles: [], grants: [],
    scopeless: false, deleteFails: false, notebookPresent: false, permissionsRefused: '', ...overrides,
  };
}

const parentOf = (path) => path.replace(/\/[^/]+$/, '');
const fsPathOf = (pathname) => decodeURIComponent(pathname.slice(FS_DIRECTORIES.length));
const DIRECTORY_PERMISSIONS = '/api/2.0/permissions/directories/';
const principalOf = (entry) => entry.service_principal_name || entry.user_name || (entry.group_name ? `group:${entry.group_name}` : '');

function permissionsAnswer(model, { method, pathname, body, token }, writable) {
  const id = decodeURIComponent(pathname.slice(DIRECTORY_PERMISSIONS.length));
  const path = Object.keys(model.folders).find((p) => String(model.folders[p].id) === id);
  if (model.scopeless) return [403, { error_code: 403, message: 'Provided OAuth token does not have required scopes: workspace' }];
  if (!path) return [404, { error_code: 'RESOURCE_DOES_NOT_EXIST', message: `directory ${id} does not exist` }];
  const folder = model.folders[path];
  const acl = () => [200, { object_id: `/directories/${id}`, object_type: 'directory',
    access_control_list: (Array.isArray(folder.writers) ? folder.writers : []).map((w) => ({ user_name: w, all_permissions: [{ permission_level: 'CAN_MANAGE' }] })) }];
  if (method === 'GET') return acl();
  if (method !== 'PATCH') return [405, { error_code: 'BAD_REQUEST', message: `${method} is not how this fake grants` }];
  if (model.permissionsRefused) return [403, { error_code: 'PERMISSION_DENIED', message: model.permissionsRefused }];
  if (!writable(path, token)) return [403, { error_code: 'PERMISSION_DENIED', message: `no CAN_MANAGE on ${path}` }];
  const entries = Array.isArray(body.access_control_list) ? body.access_control_list : [];
  model.grants.push({ path, token, entries });
  if (Array.isArray(folder.writers)) folder.writers = [...new Set([...folder.writers, ...entries.map(principalOf).filter(Boolean)])];
  return acl();
}

function folderAnswer(model, { method, pathname, searchParams, body, token }, writable) {
  const asked = body && typeof body === 'object' ? body : {};
  const fsDirectory = pathname.startsWith(`${FS_DIRECTORIES}/`);
  if (pathname.startsWith(DIRECTORY_PERMISSIONS)) return permissionsAnswer(model, { method, pathname, body: asked, token }, writable);
  if (pathname === '/api/2.0/workspace/get-status') {
    const p = searchParams.get('path');
    if (Object.hasOwn(model.folders, p)) {
      if (model.folders[p].hidden) return [403, { error_code: 'PERMISSION_DENIED', message: 'denied' }];
      return [200, { object_type: model.folders[p].type || 'DIRECTORY', object_id: model.folders[p].id, path: p }];
    }
    if (model.notebookPresent && p.includes('dbx_inspire_ai_agent')) return [200, { object_type: 'NOTEBOOK', path: p }];
    if (model.notebookPresent || Object.keys(model.folders).some((f) => p.startsWith(`${f}/`) || f.startsWith(`${p}/`) || p === '/')) {
      return p === '/' ? [200, { object_type: 'DIRECTORY', object_id: 0, path: '/' }] : [404, { error_code: 'RESOURCE_DOES_NOT_EXIST', message: `${p} does not exist` }];
    }
    return null;
  }
  if (pathname === '/api/2.0/workspace/mkdirs' || (fsDirectory && method === 'PUT')) {
    const p = fsDirectory ? fsPathOf(pathname) : String(asked.path || '');
    if (model.scopeless) return [403, { error_code: 403, message: 'Provided OAuth token does not have required scopes: workspace' }];
    if (!fsDirectory && Object.hasOwn(model.folders, p) && (model.folders[p].type || 'DIRECTORY') === 'DIRECTORY') return [200, {}];
    if (!writable(parentOf(p), token)) return [403, { error_code: 'PERMISSION_DENIED', message: `no permission to create ${p}` }];
    model.created.push(p);
    if (!fsDirectory) {
      const parent = model.folders[parentOf(p)];
      const ids = Object.values(model.folders).map((f) => Number(f.id) || 0);
      model.folders[p] = { id: Math.max(900, ...ids) + 1, writers: Array.isArray(parent.writers) ? [...parent.writers] : parent.writers };
    }
    return [fsDirectory ? 201 : 200, {}];
  }
  if (pathname === '/api/2.0/workspace/delete' || (fsDirectory && method === 'DELETE')) {
    const p = fsDirectory ? fsPathOf(pathname) : String(asked.path || '');
    if (model.deleteFails) return [500, { error_code: 'INTERNAL_ERROR', message: 'delete failed' }];
    model.deleted.push(p);
    if (!fsDirectory) delete model.folders[p];
    model.created = model.created.filter((c) => c !== p);
    model.leftovers = model.leftovers.filter((c) => c !== p);
    model.leftoverFiles = model.leftoverFiles.filter((c) => c !== p);
    return [200, {}];
  }
  if (pathname === '/api/2.0/workspace/list' && Object.hasOwn(model.folders, searchParams.get('path') || '')) {
    const at = searchParams.get('path');
    const inside = (c) => parentOf(c) === at;
    return [200, { objects: [...[...model.created, ...model.leftovers].filter(inside).map((path) => ({ path, object_type: 'DIRECTORY' })),
      ...model.leftoverFiles.filter(inside).map((path) => ({ path, object_type: 'FILE' }))] }];
  }
  if (fsDirectory) {
    const p = fsPathOf(pathname);
    const [, , catalog, schema, volume] = p.split('/');
    const known = model.volumes[`${catalog}.${schema}.${volume}`];
    const exists = known && (p.split('/').length === 5 || (known.dirs || []).includes(p));
    if (!exists) return [404, { error_code: 'NOT_FOUND', message: 'not found' }];
    if (method === 'HEAD') return [200, {}];
    const inside = (c) => parentOf(c) === p;
    return [200, { contents: [...[...model.created, ...model.leftovers].filter(inside).map((path) => ({ path, is_directory: true })),
      ...model.leftoverFiles.filter(inside).map((path) => ({ path, is_directory: false }))] }];
  }
  return null;
}

module.exports = { folderAnswer, folderModel };
