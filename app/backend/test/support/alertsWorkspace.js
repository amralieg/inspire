const fs = require('fs');
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { appShellPayload, bundledNotebookText } = require('../../lib/appShell');
const { ALERT_RULE_FILES, createAlertRules, createUseCaseAlerts } = require('../../lib/useCaseAlerts');

function alertRuleFiles() {
  const dir = String(process.env.INSPIRE_TEST_SHELL_DIR || '').trim();
  if (dir) return Object.fromEntries(ALERT_RULE_FILES.map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
  return appShellPayload(bundledNotebookText()).files;
}

const RULE_FILES = alertRuleFiles();
const RULES_MISSING = /^def cli\(/m.test(RULE_FILES['shell_alerts.py'] || '') ? ''
  : 'the bundled agent notebook predates the alert steps; set INSPIRE_TEST_SHELL_DIR to the agent/app_shell/server folder of an agent checkout';

function realAlerts() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-alert-rules-'));
  process.once('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  return createUseCaseAlerts({ rules: createAlertRules({ files: () => RULE_FILES, tmpRoot }) });
}

function rulesRun(op, args) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-alert-rules-'));
  return createAlertRules({ files: () => RULE_FILES, tmpRoot }).run(op, args).finally(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
}

function shellCompareWords() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-shell-words-'));
  try {
    for (const name of ALERT_RULE_FILES) fs.writeFileSync(path.join(dir, name), RULE_FILES[name]);
    const run = spawnSync('python3', ['-B', '-E', '-s', '-c', 'import json, shell_sql; print(json.dumps(shell_sql.compare_words()))'], { cwd: dir, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    return JSON.parse(run.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

class AlertsWorkspace {
  constructor({ folders = [], files = {}, apps = {}, users = [], tokens = {}, fail = {} } = {}) {
    this.folders = new Set(folders);
    this.files = { ...files };
    this.apps = { ...apps };
    this.users = users.map((u) => u.toLowerCase());
    this.tokens = { ...tokens };
    this.fail = { ...fail };
    this.alerts = {};
    this.calls = [];
    this.nextId = 9000;
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/api/2.0/alerts'));
  }

  add(alert) {
    this.nextId += 1;
    const made = { ...JSON.parse(JSON.stringify(alert)), id: String(this.nextId), lifecycle_state: 'ACTIVE' };
    this.alerts[made.id] = made;
    return made;
  }

  handle({ token, path: full, method, body }) {
    const [route, query = ''] = full.split('?');
    const params = new URLSearchParams(query);
    if (!route.startsWith('/api/2.0/alerts') && !route.startsWith('/api/2.0/workspace/') && !route.startsWith('/api/2.0/apps/')) return undefined;
    if (route.startsWith('/api/2.0/apps/') && !this.apps[decodeURIComponent(route.split('/').pop())]) return undefined;
    if (route.startsWith('/api/2.0/alerts/') && method === 'GET' && !this.alerts[route.split('/').pop()]) return undefined;
    if (route === '/api/2.0/alerts' && method === 'GET') return undefined;
    this.calls.push({ method, path: route, params: Object.fromEntries(params), token, body });
    for (const [key, answer] of Object.entries(this.fail)) {
      const [m, prefix] = key.split(' ');
      if (m === method && route.startsWith(prefix)) return answer;
    }
    if (route === '/api/2.0/workspace/list') {
      const folder = params.get('path');
      if (!this.folders.has(folder)) return [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: `Path (${folder}) doesn't exist.` }, 404];
      return [{ objects: Object.values(this.alerts).filter((a) => a.parent_path === folder && a.lifecycle_state === 'ACTIVE')
        .map((a) => ({ object_type: 'ALERT', object_id: Number(a.id), path: `${folder}/${a.display_name}.dbalert.json` })) }];
    }
    if (route === '/api/2.0/workspace/mkdirs' && method === 'POST') {
      this.folders.add(body.path);
      return [{}];
    }
    if (route === '/api/2.0/workspace/export') {
      const file = this.files[params.get('path')];
      return file ? [file] : [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: `Path (${params.get('path')}) doesn't exist.` }, 404];
    }
    if (route.startsWith('/api/2.0/apps/')) return [this.apps[decodeURIComponent(route.split('/').pop())]];
    if (route === '/api/2.0/alerts' && method === 'POST') {
      if (!this.folders.has(body.parent_path)) return [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: `Parent folder ${body.parent_path} does not exist` }, 404];
      for (const s of body.evaluation.notification.subscriptions || []) {
        if (s.user_email && !this.users.includes(s.user_email.toLowerCase())) {
          return [{ error_code: 'INVALID_PARAMETER_VALUE', message: `Failed to get user id for email: ${s.user_email}` }, 400];
        }
      }
      return [this.add({ ...body, owner_user_name: this.tokens[token] || 'unknown' })];
    }
    const id = route.split('/').pop();
    const alert = this.alerts[id];
    if (!alert) return [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'Node not found' }, 404];
    if (method === 'GET') return [JSON.parse(JSON.stringify(alert))];
    if (method === 'PATCH') {
      for (const key of String(params.get('update_mask') || '').split(',')) alert[key] = JSON.parse(JSON.stringify(body[key]));
      return [JSON.parse(JSON.stringify(alert))];
    }
    if (method === 'DELETE') {
      alert.lifecycle_state = 'DELETED';
      return [{}];
    }
    return [{ message: `unexpected ${method} ${route}` }, 500];
  }
}

module.exports = { AlertsWorkspace, RULES_MISSING, RULE_FILES, realAlerts, rulesRun, shellCompareWords };
