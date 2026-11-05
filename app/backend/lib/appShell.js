const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseExactJson } = require('./exactJson');
const { APP_DIR, BACKEND_DIR } = require('./appPaths');

const NOTEBOOK_FILE = 'dbx_inspire_ai_agent.ipynb';
const NOTEBOOK_CANDIDATES = [
  path.join(APP_DIR, NOTEBOOK_FILE),
  path.join(BACKEND_DIR, NOTEBOOK_FILE),
];
const NOTEBOOK_BUNDLE_FILE = path.join(BACKEND_DIR, 'notebook_bundle.js');
const APP_SHELL_CELL = 1;
const ASSET_PINS_NAME = 'INSPIRE_NOTEBOOK_ASSETS';
const ASSET_PINS_CONSTANT = `${ASSET_PINS_NAME} = `;
const APP_SHELL_ASSET = 'app_shell';
const AGENT_VERSION_CONSTANT = '__AGENT_VERSION__ = ';
const APP_SHELL_FILE = path.join(APP_DIR, 'agent', 'agent', 'app_shell', 'app_shell.b64');
const APP_SHELL_VERSION = 1;
const APP_SHELL_LISTS = { styles: 'STYLES', layouts: 'LAYOUTS', auths: 'AUTHS', themes: 'THEMES', palettes: 'PALETTES', options: 'OPTIONS' };
const APP_SHELL_BUNDLE = 'static/assets/app.js';
const APP_SHELL_PG = 'shell_pg.py';
const APP_SHELL_SQL = 'shell_sql.py';
const APP_SHELL_DELTA = 'delta';
const UPDATE_HINT = 'update the Inspire App so it carries an agent notebook with the App shell';

function bundledNotebookText() {
  const found = NOTEBOOK_CANDIDATES.find((p) => fs.existsSync(p));
  if (found) return fs.readFileSync(found, 'utf8');
  return Buffer.from(require(NOTEBOOK_BUNDLE_FILE), 'base64').toString('utf8');
}

function notebookCodeLines(notebookText) {
  let cells;
  try {
    cells = parseExactJson(notebookText).cells;
  } catch (e) {
    throw new Error(`the bundled agent notebook is not valid JSON: ${e.message}`);
  }
  const source = cells && cells[APP_SHELL_CELL] && cells[APP_SHELL_CELL].source;
  return Array.isArray(source) ? source : String(source || '').split('\n');
}

function notebookAssetPins(notebookText) {
  const hits = notebookCodeLines(notebookText).filter((line) => line.startsWith(ASSET_PINS_CONSTANT));
  if (hits.length !== 1) throw new Error(`the bundled agent notebook pins no assets (${hits.length} ${ASSET_PINS_NAME} lines); ${UPDATE_HINT}`);
  try {
    return parseExactJson(hits[0].slice(ASSET_PINS_CONSTANT.length).trim());
  } catch (e) {
    throw new Error(`the bundled agent notebook's ${ASSET_PINS_NAME} is not JSON: ${e.message}; ${UPDATE_HINT}`);
  }
}

function notebookBuildStamp(notebookText) {
  const hits = notebookCodeLines(notebookText).filter((line) => line.startsWith(AGENT_VERSION_CONSTANT));
  if (hits.length !== 1) throw new Error(`the bundled agent notebook names no version (${hits.length} __AGENT_VERSION__ lines); ${UPDATE_HINT}`);
  const version = parseExactJson(hits[0].slice(AGENT_VERSION_CONSTANT.length).trim());
  const pin = notebookAssetPins(notebookText)[APP_SHELL_ASSET];
  return { version: String(version), shell: String((pin && pin.sha256) || '') };
}

let stamp = null;

function bundledBuildStamp() {
  if (!stamp) {
    try {
      stamp = notebookBuildStamp(bundledNotebookText());
    } catch (e) {
      stamp = { version: '', shell: '', error: e.message || String(e) };
    }
  }
  return stamp;
}

function pinnedAssetText(notebookText, name, file) {
  const pin = notebookAssetPins(notebookText)[name];
  if (!pin || typeof pin.sha256 !== 'string' || !Number.isInteger(pin.size)) throw new Error(`the bundled agent notebook pins no ${name}; ${UPDATE_HINT}`);
  const shown = path.relative(APP_DIR, file);
  let data;
  try {
    data = fs.readFileSync(file);
  } catch (e) {
    throw new Error(`the Inspire App carries no ${shown} (${e.code || e.message}); ${UPDATE_HINT}`);
  }
  if (data.length !== pin.size || crypto.createHash('sha256').update(data).digest('hex') !== pin.sha256) {
    throw new Error(`${shown} is not the build the bundled agent notebook pins; ${UPDATE_HINT}`);
  }
  return data.toString('utf8');
}

function bundledAppShellText(notebookText = bundledNotebookText(), file = APP_SHELL_FILE) {
  return pinnedAssetText(notebookText, APP_SHELL_ASSET, file);
}

function appShellPayload(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error(`the bundled App shell is empty; ${UPDATE_HINT}`);
  let payload;
  try {
    payload = parseExactJson(zlib.inflateSync(Buffer.from(value, 'base64')).toString('utf8'));
  } catch (e) {
    throw new Error(`the bundled App shell does not decode: ${e.message}`);
  }
  if (!payload || payload.version !== APP_SHELL_VERSION || !payload.files || typeof payload.files !== 'object') {
    throw new Error(`the bundled App shell is not version ${APP_SHELL_VERSION}; ${UPDATE_HINT}`);
  }
  const binary = payload.binary === undefined ? {} : payload.binary;
  if (!binary || typeof binary !== 'object' || Array.isArray(binary) || Object.values(binary).some((value) => typeof value !== 'string')) {
    throw new Error(`the bundled App shell carries binary files Inspire cannot read; ${UPDATE_HINT}`);
  }
  return payload;
}

function appShellFiles(payload) {
  const binary = Object.entries(payload.binary || {}).map(([name, text]) => [name, Buffer.from(text, 'base64')]);
  return { ...payload.files, ...Object.fromEntries(binary) };
}

function pythonTuple(source, name) {
  const match = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(String(source || ''));
  if (!match) throw new Error(`the App shell defines no ${name}`);
  const values = [...match[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  if (!values.length) throw new Error(`the App shell's ${name} is empty`);
  return values;
}

function literalAt(text, start) {
  let depth = 0;
  let quote = '';
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function literalJson(literal) {
  return JSON.parse(literal.replace(/([{,])([A-Za-z_$][\w$]*):/g, '$1"$2":'));
}

function topLevelEntries(literal) {
  const entries = [];
  let depth = 0;
  let quote = '';
  let from = 1;
  for (let i = 1; i < literal.length; i += 1) {
    const ch = literal[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    else if ((ch === ',' && depth === 0) || i === literal.length - 1) {
      const part = literal.slice(from, i);
      const colon = part.indexOf(':');
      if (colon > 0) entries.push([part.slice(0, colon).replace(/^["']|["']$/g, ''), part.slice(colon + 1)]);
      from = i + 1;
    }
  }
  return entries;
}

function isPalette(value) {
  return ['light', 'dark'].every((theme) => value && value[theme] && value[theme].base && typeof value[theme].base === 'object'
    && value[theme].hues && typeof value[theme].hues === 'object');
}

function palettesFromBundle(js, ids) {
  const text = String(js || '');
  const resolve = (value) => {
    if (value.startsWith('{')) return literalJson(value);
    if (!/^[A-Za-z_$][\w$]*$/.test(value)) return null;
    const defined = new RegExp(`(?:^|[^\\w$.])${value.replace(/\$/g, '\\$')}=\\{`).exec(text);
    return defined ? literalJson(literalAt(text, defined.index + defined[0].length - 1)) : null;
  };
  for (const found of text.matchAll(/\{default:/g)) {
    const entries = topLevelEntries(literalAt(text, found.index));
    if (!ids.every((id) => entries.some(([key]) => key === id))) continue;
    const palettes = {};
    for (const [key, value] of entries) {
      if (!ids.includes(key)) continue;
      const palette = resolve(value.trim());
      if (!isPalette(palette)) break;
      palettes[key] = palette;
    }
    if (ids.every((id) => palettes[id])) return palettes;
  }
  throw new Error(`the App shell bundle holds no colours for the palettes ${ids.join(', ')}`);
}

function appShellLook(payload) {
  const core = payload.files['shell_core.py'];
  if (typeof core !== 'string') throw new Error(`the App shell has no shell_core.py; ${UPDATE_HINT}`);
  const lists = Object.fromEntries(Object.entries(APP_SHELL_LISTS).map(([key, name]) => [key, pythonTuple(core, name)]));
  if (/^USER_OFF = \(/m.test(core)) lists.user_off = pythonTuple(core, 'USER_OFF');
  if (/^SCREENS = \(/m.test(core)) lists.screens = pythonTuple(core, 'SCREENS');
  const sql = payload.files[APP_SHELL_SQL];
  if (typeof sql === 'string' && /^CHART_KINDS = \(/m.test(sql)) {
    lists.chart_kinds = pythonTuple(sql, 'CHART_KINDS');
    lists.chart_pick = pythonTuple(sql, 'CHART_PICK');
    const stray = lists.chart_pick.filter((k) => !lists.chart_kinds.includes(k));
    if (stray.length) throw new Error(`the App shell's CHART_PICK names ${stray.join(', ')}, which CHART_KINDS does not have; ${UPDATE_HINT}`);
  }
  const pg = payload.files[APP_SHELL_PG];
  lists.backends = typeof pg === 'string' ? pythonTuple(pg, 'KINDS') : [APP_SHELL_DELTA];
  if (!lists.backends.includes(APP_SHELL_DELTA)) throw new Error(`the App shell's KINDS has no ${APP_SHELL_DELTA}; ${UPDATE_HINT}`);
  const colors = payload.palettes && typeof payload.palettes === 'object'
    ? payload.palettes
    : palettesFromBundle(payload.files[APP_SHELL_BUNDLE], lists.palettes);
  const missing = lists.palettes.filter((id) => !isPalette(colors[id]));
  if (missing.length) throw new Error(`the App shell has no colours for ${missing.join(', ')}`);
  return {
    ok: true,
    ...lists,
    palette_colors: lists.palettes.map((id) => ({ id, light: colors[id].light, dark: colors[id].dark })),
    palette_source: payload.palettes ? 'payload' : 'bundle',
  };
}

let cached = null;

function appShellCatalog() {
  if (!cached) {
    try {
      cached = appShellLook(appShellPayload(bundledAppShellText()));
    } catch (e) {
      cached = { ok: false, error: e.message || String(e) };
    }
  }
  return cached;
}

module.exports = {
  NOTEBOOK_BUNDLE_FILE,
  NOTEBOOK_CANDIDATES,
  ASSET_PINS_CONSTANT,
  APP_SHELL_FILE,
  bundledNotebookText,
  notebookAssetPins,
  notebookBuildStamp,
  bundledBuildStamp,
  pinnedAssetText,
  bundledAppShellText,
  appShellPayload,
  appShellFiles,
  pythonTuple,
  palettesFromBundle,
  appShellLook,
  appShellCatalog,
};
