import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WALK_PROFILE = 'INSPIRE_WALK_PROFILE';
export const WALK_INSPIRE = 'INSPIRE_WALK_INSPIRE_APPS';
export const BUILT_APP = /^Inspire use case (\S+) \(session (\d+)\)/;
export const DEFAULT_QUESTION = 'Which of these needs attention first, and why?';
export const SUGGESTED = 4;
const MIN_CHARS = 40;
const ANSWER_MS = 300000;
const PAGE_MS = 180000;

const FAILED_TO_ANSWER = /could not answer|couldn'?t answer|unable to answer/i;
const REFUSAL = /doesn'?t match|does not match|available schema|(?:don'?t|do not|doesn'?t|does not) (?:have|contain|include|hold) (?:the |any |that |this |enough )?(?:data|tables?|information|columns?|records?|rows?)\b|\bno (?:such |relevant )?(?:tables?|columns?) (?:for|about|on|named|called|that)\b|not (?:available|present|found|included) in (?:this|the) (?:space|schema|data|tables?)|isn'?t (?:available|included) in|(?:cannot|can'?t|unable to) (?:find|answer|locate)|outside (?:of )?(?:the|this) (?:scope|data|space)/i;
const NO_DATA = /\bno (?:data|results?|rows?|records?|matching (?:data|rows?|records?|results?))\b|\b(?:returned|returns|found|gave|produced) (?:no|zero|0) (?:rows?|results?|records?|data|matches)\b|\b(?:0|zero) (?:rows?|results?|records?) (?:were |was )?(?:returned|found)\b|\bthe (?:query|result|results|table) (?:is|was|are|were|came back) empty\b|\bempty (?:result|results|table|data ?set)\b|\bnothing (?:was |is )?(?:found|returned)\b|\bthere (?:is|are|were|was) no (?:data|rows?|records?|results?|information|matching)\b|\b(?:not enough|insufficient) data\b|\bno information (?:is )?available\b/i;
const HEDGE = /\bas an ai\b|\blanguage model\b|\bit seems\b|\bit appears that\b/i;

export function answerProblem({ text = '', failed = false, error = '', rows = 0 } = {}) {
  const answer = String(text || '').replace(/\s+/g, ' ').trim();
  if (failed) return `Genie returned an error: ${String(error || answer).slice(0, 200)}`;
  if (FAILED_TO_ANSWER.test(answer)) return `Genie says it could not answer: ${answer.slice(0, 200)}`;
  for (const [pattern, says] of [[NO_DATA, 'there is no data'], [REFUSAL, 'the data is not there']]) {
    const hit = answer.match(pattern);
    if (hit) return `Genie says ${says} ("${hit[0]}"): ${answer.slice(0, 240)}`;
  }
  if (answer.length <= MIN_CHARS && !rows) return `the answer is only ${answer.length} characters and has no result table`;
  if (!/\d/.test(answer) && !rows) return 'the answer carries no number and no result table';
  const hedge = answer.match(HEDGE);
  if (hedge) return `the answer hedges ("${hedge[0]}")`;
  return '';
}

export function walkScope(env = process.env) {
  const inspire = String(env[WALK_INSPIRE] || '').split(',').map((name) => name.trim()).filter(Boolean);
  return { profile: String(env[WALK_PROFILE] || '').trim(), inspire };
}

export function scopeProblem(scope, profile, inspireName) {
  if (!scope?.profile || !scope.inspire?.length) {
    return `set ${WALK_PROFILE} to the one workspace profile and ${WALK_INSPIRE} to the test Inspire Apps the live Genie walk may use; without both it walks nothing`;
  }
  if (profile !== scope.profile) return `the live Genie walk runs on ${scope.profile} only, not ${profile || 'no profile'}`;
  if (!inspireName || !scope.inspire.includes(inspireName)) {
    return `${inspireName || 'no Inspire App'} is not a test Inspire App the walk may use, only ${scope.inspire.join(', ')}`;
  }
  return '';
}

export function targetProblem({ scope, profile, inspire, app }) {
  const outside = scopeProblem(scope, profile, inspire?.name);
  if (outside) return outside;
  if (!inspire.service_principal_client_id) return `${inspire.name} has no service principal, so the walk cannot tell which Apps it built`;
  if (!app?.name) return 'no such App';
  if (app.name === inspire.name || !BUILT_APP.test(String(app.description || ''))) {
    return `${app.name} is not an App that Inspire built: its description does not start with "Inspire use case"`;
  }
  if (app.creator !== inspire.service_principal_client_id) return `${app.name} was not built by ${inspire.name}, so the walk never touches it`;
  const state = app.compute_status?.state || '';
  if (state !== 'ACTIVE') return `${app.name} is not running (compute ${state || 'unknown'}); start the test App first`;
  if (!/^https:\/\//.test(String(app.url || ''))) return `${app.name} has no https URL`;
  return '';
}

async function settled(page, ms) {
  const last = page.getByRole('log', { name: 'Genie conversation' }).locator('.msg--genie').last();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(500);
    if (await last.locator('.g-err').count()) break;
    if (await last.locator('.msg-b').count() && !(await last.locator('.g-step, .cursor').count())) break;
  }
  const failed = (await last.locator('p.g-err').count()) > 0;
  const tableError = await last.locator('.g-foot.g-err').count();
  const text = await last.locator('.msg-b').first().evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.msg-t, .msg-sql, .msg-f, .g-foot').forEach((n) => n.remove());
    return copy.textContent;
  }).catch(() => '');
  return {
    text: String(text || '').replace(/\s+/g, ' ').trim(), failed: failed || tableError > 0,
    error: failed || tableError ? await last.locator('.g-err').first().innerText().catch(() => '') : '',
    rows: await last.locator('.msg-t tbody tr').count(), seconds: Math.round((Date.now() - t0) / 1000), timedOut: Date.now() - t0 >= ms,
  };
}

async function openPanel(page) {
  const panel = page.locator('aside.genie');
  if (!(await panel.count())) await page.getByRole('button', { name: 'Ask Genie', exact: true }).first().click();
  await panel.waitFor({ timeout: 30000 });
  return panel;
}

export async function walkGenie(page, base, info, { answerMs = ANSWER_MS, pageMs = PAGE_MS, log = () => {} } = {}) {
  const asked = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/genie/ask')) asked.push(r.postDataJSON?.()?.page ?? null);
  });
  const results = [];
  const pages = info.pages || [];
  if (!pages.length) results.push({ page: '', question: '', ok: false, problem: 'the App lists no use case page' });
  for (const p of pages) {
    await page.goto(`${base.replace(/\/?$/, '/')}#/${encodeURIComponent(p.id)}`);
    await page.locator('.ph h1').filter({ hasText: p.title }).first().waitFor({ timeout: pageMs });
    const panel = await openPanel(page);
    if (!p.genie?.enabled) {
      const why = ((await panel.locator('.g-off').innerText().catch(() => '')) || p.genie?.note || '').replace(/\s+/g, ' ').trim();
      results.push({ page: p.id, question: '', ok: false, problem: `Ask Genie is off on this page: ${why || 'no reason given'}` });
      log(results.at(-1));
      continue;
    }
    const questions = (p.questions || []).slice(0, SUGGESTED);
    for (const question of questions.length ? questions : [DEFAULT_QUESTION]) {
      const newChat = panel.getByRole('button', { name: 'New chat' });
      if (await newChat.count()) await newChat.click();
      const before = asked.length;
      const suggestion = panel.locator('.g-sugg .sugg').filter({ hasText: question });
      if (questions.length && await suggestion.count()) await suggestion.first().click();
      else {
        await panel.getByLabel('Your question').fill(question);
        await panel.getByRole('button', { name: 'Send' }).click();
      }
      const got = await settled(page, answerMs);
      const sent = asked.slice(before);
      const problem = got.timedOut ? `Genie gave no answer in ${Math.round(answerMs / 1000)} s`
        : sent.length !== 1 || sent[0] !== p.id ? `the question went to ${JSON.stringify(sent)}, not to this page's Genie Agent`
          : answerProblem(got);
      results.push({ page: p.id, question, ok: !problem, problem, seconds: got.seconds, rows: got.rows, answer: got.text.slice(0, 600) });
      log(results.at(-1));
    }
  }
  return results;
}

function cli(args) {
  const opt = (name, fallback = '') => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  return { app: opt('app'), inspire: opt('inspire'), profile: opt('profile'), out: opt('out'), checkOnly: args.includes('--check-target') };
}

async function main() {
  const { app: name, inspire: inspireName, profile, out, checkOnly } = cli(process.argv.slice(2));
  const fail = (why) => { console.error(`FAIL ${why}`); process.exit(2); };
  if (!name || !inspireName || !profile) fail('usage: genieWalk.mjs --app <built App> --inspire <test Inspire App> --profile <profile> [--out results.json] [--check-target]');
  const scope = walkScope();
  const outside = scopeProblem(scope, profile, inspireName);
  if (outside) fail(outside);
  const read = (app) => {
    try {
      return JSON.parse(execFileSync('databricks', ['apps', 'get', app, '--profile', profile, '-o', 'json'], { encoding: 'utf8' }));
    } catch (e) {
      return fail(`could not read App ${app} on ${profile}: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    }
  };
  const inspire = read(inspireName);
  const app = read(name);
  const refused = targetProblem({ scope, profile, inspire, app });
  if (refused) fail(refused);
  console.log(`OK   ${app.name} is a running use case App that ${inspire.name} built on ${profile}: ${app.url}`);
  if (checkOnly) return;
  const token = JSON.parse(execFileSync('databricks', ['auth', 'token', '--profile', profile, '-o', 'json'], { encoding: 'utf8' })).access_token;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  let results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    const page = await context.newPage();
    const base = `${app.url.replace(/\/$/, '')}/`;
    await page.goto(base);
    const info = await page.evaluate(async () => { const r = await fetch('./api/app', { credentials: 'same-origin' }); return r.ok ? r.json() : { error: `HTTP ${r.status}` }; });
    if (info.error) fail(`${app.name} /api/app: ${info.error}`);
    results = await walkGenie(page, base, info, { log: (r) => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.page}: ${r.question || '(no question)'}${r.ok ? ` (${r.seconds} s, ${r.rows} rows)` : ` :: ${r.problem}`}`) });
  } finally {
    await browser.close();
  }
  const bad = results.filter((r) => !r.ok);
  if (out) writeFileSync(out, JSON.stringify({ app: app.name, url: app.url, profile, results }, null, 1));
  console.log(`SUMMARY ${results.length - bad.length}/${results.length} Genie answers carry data on ${app.name}`);
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
