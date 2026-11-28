'use strict';
// REQ-586: the one App path that publishes the split agent (two notebooks and inspire_lib.py) into one workspace folder.
// The lib must be the one both notebooks pin (INSPIRE_LIB_SHA256); a mismatch is refused before any import.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./appPaths');
const { AGENT_NOTEBOOKS } = require('./inspireJobParams');

const AGENT_LIB = 'inspire_lib.py';
const NOTEBOOK_NAMES = [AGENT_NOTEBOOKS.discover, AGENT_NOTEBOOKS.generate];
const AGENT_FILES = [...NOTEBOOK_NAMES.map((n) => `${n}.ipynb`), AGENT_LIB];
const PIN_RE = /^INSPIRE_LIB_SHA256 = "([0-9a-f]{64})"$/gm;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function pinsOf(notebookBuf) {
  const code = (JSON.parse(notebookBuf.toString('utf8')).cells || [])
    .filter((c) => c.cell_type === 'code').map((c) => [].concat(c.source || []).join('')).join('\n');
  return [...code.matchAll(PIN_RE)].map((m) => m[1]);
}

function readAgent(dir = APP_DIR) {
  const files = {};
  for (const f of AGENT_FILES) files[f] = fs.readFileSync(path.join(dir, f));
  return files;
}

/** sha256 over the three agent files, so a changed notebook or lib re-publishes. */
function agentFingerprint(dir = APP_DIR) {
  const h = crypto.createHash('sha256');
  const files = readAgent(dir);
  for (const f of AGENT_FILES) h.update(f).update(files[f]);
  return h.digest('hex');
}

function checkPins(files) {
  const lib = sha256(files[AGENT_LIB]);
  const bad = NOTEBOOK_NAMES.map((n) => [n, pinsOf(files[`${n}.ipynb`])])
    .filter(([, pins]) => pins.length !== 1 || pins[0] !== lib)
    .map(([n, pins]) => `${n} pins ${pins.join(', ') || 'no INSPIRE_LIB_SHA256'}`);
  if (bad.length) throw new Error(`${AGENT_LIB} (sha256 ${lib}) does not match INSPIRE_LIB_SHA256: ${bad.join('; ')}. Nothing was published.`);
}

async function importOne(dbFetch, host, token, body) {
  const resp = await dbFetch(host, token, '/api/2.0/workspace/import', { method: 'POST', body: JSON.stringify({ ...body, overwrite: true }) });
  if (!resp.ok) throw new Error(`Publish failed for ${body.path}: ${await resp.text()}`);
}

async function publishAgent({ dbFetch, host, token, folder, dir = APP_DIR }) {
  const files = readAgent(dir);
  checkPins(files);
  const mk = await dbFetch(host, token, '/api/2.0/workspace/mkdirs', { method: 'POST', body: JSON.stringify({ path: folder }) });
  if (!mk.ok) throw new Error(`Publish failed creating ${folder}: ${await mk.text()}`);
  for (const n of NOTEBOOK_NAMES) {
    await importOne(dbFetch, host, token, { path: `${folder}/${n}`, format: 'JUPYTER', language: 'PYTHON', content: files[`${n}.ipynb`].toString('base64') });
  }
  await importOne(dbFetch, host, token, { path: `${folder}/${AGENT_LIB}`, format: 'AUTO', content: files[AGENT_LIB].toString('base64') });
  return { path: `${folder}/${AGENT_NOTEBOOKS.discover}` };
}

/** destination_path may be the notebook path (…/inspire_discover) or its folder; return the folder. */
function agentFolderOf(p) {
  const t = String(p).replace(/\/+$/, '');
  const base = path.posix.basename(t);
  return base === AGENT_NOTEBOOKS.discover || base === AGENT_NOTEBOOKS.generate ? path.posix.dirname(t) : t;
}

module.exports = { agentFolderOf, publishAgent, agentFingerprint, AGENT_FILES, AGENT_LIB };
