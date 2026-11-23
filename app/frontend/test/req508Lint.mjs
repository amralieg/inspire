// REQ-508 (Art Director pass, direction "A Calm Console"): shared reader for the design lint tests. It is a helper, not a test.
// It lists the source files of a lane, finds the class names and literals each file uses, and asks the real Tailwind compiler
// (the same one the Vite build uses) which colour classes produce no CSS because their token does not exist.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(FRONTEND, 'src');
export const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

export function sourceFiles(ext = /\.jsx$/) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (ext.test(e.name)) out.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  };
  walk(SRC);
  return out.sort();
}

export const ALLOW = JSON.parse(readFileSync(path.join(FRONTEND, 'test', 'req508DesignLint.allow.json'), 'utf8'));
const allowed = (rule, file) => (ALLOW[rule] || []).some((e) => e.file === file);

// Lane file groups. A file belongs to exactly one group; the orphans (F33, delete pending Amr) are skipped by every rule.
export const WORK_PAGES = ['pages/BareBuildPage.jsx', 'pages/ImplementPage.jsx', 'pages/ImplementWizard.jsx', 'pages/MonitorPage.jsx', 'pages/ResultsPage.jsx', 'pages/RunPage.jsx'];
export const START_PAGES = ['pages/ChoosePage.jsx', 'pages/ConfigPage.jsx', 'pages/GenerateDataPage.jsx', 'pages/LandingPage.jsx', 'pages/LaunchPage.jsx', 'pages/SetupWizard.jsx'];
export function groupFiles(group) {
  const all = sourceFiles().filter((f) => !allowed('orphan', f));
  if (group === 'work-pages') return all.filter((f) => WORK_PAGES.includes(f));
  if (group === 'start-pages') return all.filter((f) => START_PAGES.includes(f));
  return all.filter((f) => !WORK_PAGES.includes(f) && !START_PAGES.includes(f));
}

const at = (src, index) => src.slice(0, index).split('\n').length;
const hits = (file, src, re, keep = () => true) => [...src.matchAll(re)].filter(keep).map((m) => `${file}:${at(src, m.index)} ${m[0]}`);

const PX = (v, unit) => (unit === 'rem' || unit === 'em' ? Number(v) * 16 : Number(v));
const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PREFIX = 'bg|text|border|border-[trblxyse]|ring|ring-offset|from|to|via|fill|stroke|outline|divide|accent|decoration|placeholder|caret|shadow';
// A class string belongs to a button when its nearest opening tag is <button> / <a>, or it is assigned to a *BUTTON* / *BTN* constant.
function isButtonClass(src, index) {
  const before = src.slice(Math.max(0, index - 400), index);
  const tag = before.match(/<([A-Za-z][\w.]*)(?![\s\S]*<[A-Za-z])/)?.[1];
  if (tag === 'button' || tag === 'a') return true;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  return /\b\w*(?:BUTTON|BTN)\w*\s*=\s*$/.test(line) || /\b\w*(?:BUTTON|BTN)\w*\s*=\s*[`'"]?$/.test(line.trimEnd());
}
export const ICON_SIZES = new Set([14, 16, 20, 24]);

// Each rule returns the offending `file:line match` strings for one file.
export const RULES = {
  // F18: 12px is the smallest text (caption 12/16).
  'small-text': (f, s) => [
    ...hits(f, s, /\btext-\[(\d+(?:\.\d+)?)(px|rem|em)\]/g, (m) => PX(m[1], m[2]) < 12),
    ...hits(f, s, /\bfontSize:\s*['"]?(\d+(?:\.\d+)?)(px|rem|em)?['"]?/g, (m) => PX(m[1], m[2] || 'px') < 12),
  ],
  // F14: colours come from tokens, never hex or rgb()/hsl() literals in a component.
  'raw-colour': (f, s) => (allowed('raw-colour', f) ? [] : hits(f, s, /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![-\w])|\b(?:rgba?|hsla?)\(/g,
    (m) => !/^#\d{3,4}$/.test(m[0]) || /['"`]#\d{3,4}['"`]/.test(s.slice(m.index - 1, m.index + m[0].length + 1)))),
  // F14/F15: no arbitrary colour classes such as bg-[#fff], text-[rgb(...)] or accent-[var(--color-x,#c4161c)].
  'arbitrary-colour': (f, s) => (allowed('raw-colour', f) ? [] : hits(f, s, new RegExp(`\\b(?:${PREFIX})-\\[(?:#|rgb|hsl|var\\(--color|color:)[^\\]]*\\]`, 'g'))),
  // F14: no raw Tailwind palette classes (bg-red-500, text-slate-400): only the theme's named tokens.
  'raw-palette': (f, s) => (allowed('raw-colour', f) ? [] : hits(f, s, new RegExp(`(?<![\\w-])(?:${PREFIX})-(?:${PALETTE})-\\d{2,3}\\b`, 'g'))),
  // F23: radii are sm/md/lg/full; no arbitrary px radius.
  'arbitrary-radius': (f, s) => hits(f, s, /\brounded(?:-[trblse]{1,2})?-\[[^\]]+\]/g),
  // Transition rule 5: list the properties, never transition-all.
  'transition-all': (f, s) => hits(f, s, /\btransition-all\b/g),
  // F31: one gradient syntax (Tailwind v4 bg-linear-to-*).
  'gradient-v3': (f, s) => hits(f, s, /\bbg-gradient-to-[trbl]{1,2}\b/g),
  // F20: gradient headline text only on Landing.
  'gradient-text': (f, s) => (f === 'pages/LandingPage.jsx' ? [] : hits(f, s, /\bbg-clip-text\b/g)),
  // F17: lucide icons come in 14 / 16 / 20 / 24.
  'icon-size': (f, s) => hits(f, s, /<[A-Z]\w*\b[^<>]*?\bsize=\{(\d+(?:\.\d+)?)\}/g, (m) => !ICON_SIZES.has(Number(m[1]))),
  // F22 / L7: one primary button. A solid red fill with white text is the Button primary variant; only components/ui/ may spell it out.
  'hand-primary': (f, s) => (f.startsWith('components/ui/') ? [] : hits(f, s, /['"`][^'"`]*\bbg-(?:db-red-solid|db-red|primary)(?![-\w/])[^'"`]*['"`]/g,
    (m) => /\btext-(?:white|primary-fg)\b/.test(m[0]) && isButtonClass(s, m.index))),
};

let compiler = null;
async function tailwind() {
  if (compiler) return compiler;
  const { compile } = await import('@tailwindcss/node');
  compiler = await compile(readFileSync(path.join(SRC, 'index.css'), 'utf8'), { base: SRC, onDependency: () => {} });
  return compiler;
}
const COLOUR_CLASS = new RegExp(`^(?:${PREFIX})-(?:db|ok|danger|accent|primary|neutral|success|warning|error|info|surface|panel|bg|border|text)(?:-[a-z0-9-]+)*(?:\\/\\d+)?$`);
const escapeClass = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);

// F11/F12: a colour class whose token is not in @theme renders no colour at all (blank done circles, blank chips).
// Returns `file:line class` for every colour class in the file that the real compiler cannot build.
export async function undefinedColourClasses(file, src) {
  const tw = await tailwind();
  const re = new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*!?(?:${PREFIX})-[a-z][a-z0-9-]*(?:\\/\\d+)?)(?![\\w-])`, 'g');
  const found = [...src.matchAll(re)].map((m) => ({ cls: m[1], line: at(src, m.index) }));
  const css = tw.build(found.map((x) => x.cls));
  return found.filter(({ cls }) => {
    // Only names built on a theme colour root count; text-center, border-b, shadow-sm and the like are not colours.
    if (!COLOUR_CLASS.test(cls.split(':').pop().replace(/^!/, ''))) return false;
    return !css.includes(`.${escapeClass(cls)}`);
  }).map(({ cls, line }) => `${file}:${line} ${cls}`);
}

// One subtest per rule over the lane's files, plus a planted must-fail / must-keep pair so a broken rule cannot pass silently.
export function lintSuite(test, assert, group, lane) {
  const files = groupFiles(group);
  test(`${lane}: the ${group} group has files to check`, () => assert.ok(files.length > 0));
  test(`${lane}: the rules catch planted bad classes and leave the good ones alone (must-fail / must-keep)`, async () => {
    const bad = '<p className="text-[11px] bg-red-500 rounded-[3px] transition-all bg-gradient-to-r bg-clip-text accent-[#c4161c]" style={{ color: \'#FF3621\', fontSize: 10 }}><X size={11} /></p><b className="bg-ok-nope" /><button className="px-3 bg-db-red-solid text-white" />';
    const good = '<p className="text-xs bg-db-red rounded-md transition-colors bg-linear-to-r text-text-primary border-border"><X size={16} /></p>';
    for (const [name, rule] of Object.entries(RULES)) {
      assert.ok(rule('planted.jsx', bad).length > 0, `${name} catches the planted bad markup`);
      assert.deepEqual(rule('planted.jsx', good), [], `${name} leaves the good markup alone`);
    }
    assert.deepEqual(await undefinedColourClasses('planted.jsx', bad), ['planted.jsx:1 bg-ok-nope']);
    assert.deepEqual(await undefinedColourClasses('planted.jsx', good), []);
  });
  for (const [name, rule] of Object.entries(RULES)) {
    test(`${lane}: no ${name} in the ${group} files`, () => {
      const found = files.flatMap((f) => rule(f, read(f)));
      assert.deepEqual(found.slice(0, 40), [], `${found.length} ${name} hit(s) in ${group}; first 40 shown`);
    });
  }
  test(`${lane}: every colour class in the ${group} files compiles to CSS (its token exists)`, async () => {
    const found = [];
    for (const f of files) found.push(...await undefinedColourClasses(f, read(f)));
    assert.deepEqual(found, []);
  });
}
