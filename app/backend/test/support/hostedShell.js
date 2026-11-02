const http = require('node:http');
const { appShellFiles, appShellPayload, bundledNotebookText } = require('../../lib/appShell');

const HOSTED_OWNER = ['owner', 'example.com'].join('@');

function shellFolder(root, { title = 'Hosted test' } = {}) {
  const payload = appShellPayload(bundledNotebookText());
  const page = { ...payload.example };
  const settings = {
    version: 2, title, style: 'a', layout: 'sidebar', auth: 'user', theme: 'light', palette: 'default',
    options: { modify: false, replace_edits: false, decisions: false }, pages: [page.id], admin: HOSTED_OWNER, jobs: {}, genie: null,
    genie_note: 'Ask Genie is off in this test',
  };
  const files = { ...appShellFiles(payload), 'inspire_app.json': JSON.stringify(settings), [`pages/${page.id}.json`]: JSON.stringify(page) };
  return { page, files: Object.fromEntries(Object.entries(files).map(([rel, body]) => [`${root}/${rel}`, Buffer.isBuffer(body) ? body : Buffer.from(String(body))])) };
}

function workspaceOf(files) {
  return {
    async list(folder) {
      const prefix = `${folder}/`;
      const seen = new Map();
      for (const full of Object.keys(files)) {
        if (!full.startsWith(prefix)) continue;
        const [first, ...rest] = full.slice(prefix.length).split('/');
        seen.set(`${prefix}${first}`, rest.length ? 'DIRECTORY' : 'FILE');
      }
      return [...seen].map(([p, objectType]) => ({ path: p, object_type: objectType }));
    },
    async read(file) {
      return files[file];
    },
  };
}

async function fakeWarehouse() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization || '', body });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/2.0/sql/statements') {
        res.end(JSON.stringify({ statement_id: `s${calls.length}`, status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] }, total_row_count: 0 },
          result: { data_array: [] } }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: `the fake workspace has no ${req.method} ${req.url}` }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { HOSTED_OWNER, shellFolder, workspaceOf, fakeWarehouse };
