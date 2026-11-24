// REQ-508 L4 (Art Director pass, "A Calm Console"): every overlay goes through ModalDialog or DrawerShell, with one scrim (black/40),
// the z-index tokens (nav 30, drawer 40, overlay 50, dialog 51, toast 60) and an enter animation. Audit scratch/req508_art_director.md F26,
// sections 2.2 and 4 (L4). Fail-pre (15eb146b9): BuildStarting.jsx:24 and ImplementWizard.jsx:3695,3751 draw their own fixed overlays,
// five arbitrary z-indexes (45/60/70/80/90) and three scrim opacities (/20, /30, /40) are in use, and ModalDialog has no enter animation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW, read, sourceFiles } from './req508Lint.mjs';

const SHELLS = new Set(['components/ModalDialog.jsx', 'components/DrawerShell.jsx']);
// Landing keeps its decorative layers (Amr: decorative effects on Landing only); orphans are listed for deletion (F33).
const SKIP = new Set(['pages/LandingPage.jsx', ...(ALLOW.orphan || []).map((o) => o.file)]);
const files = () => sourceFiles().filter((f) => !SKIP.has(f));
const lines = (f) => read(f).split('\n').map((text, i) => ({ f, line: i + 1, text }));
const hits = (re, keep = () => true) => files().flatMap(lines).filter((l) => re.test(l.text) && keep(l)).map((l) => `${l.f}:${l.line}`);

// The Run page's full-window frame is a page mode, not an overlay: it may cover the window, but only with the z tokens.
const RUN_PAGE_MODE = /data-run-(full|opening)=/;

function overlayOffenders(src, f) {
  return src.split('\n').flatMap((text, i) => (/\bfixed inset-0\b/.test(text) && !SHELLS.has(f) && !RUN_PAGE_MODE.test(text) ? [`${f}:${i + 1}`] : []));
}

test('self-check: the overlay scan flags a planted hand-made overlay and passes the shells and the Run page mode (must-fail / must-keep)', () => {
  assert.deepEqual(overlayOffenders('<div className="fixed inset-0 z-50 bg-black/40" />', 'components/Planted.jsx'), ['components/Planted.jsx:1']);
  assert.deepEqual(overlayOffenders('<div className="fixed inset-0 z-overlay" />', 'components/ModalDialog.jsx'), []);
  assert.deepEqual(overlayOffenders('<div data-run-full="x" className="fixed inset-0 z-overlay" />', 'pages/RunPage.jsx'), []);
  assert.ok(files().length > 40, 'the jsx tree was read');
});

test('F26: no fixed full-window overlay outside ModalDialog and DrawerShell (BuildStarting and the ImplementWizard overlays move onto them)', () => {
  assert.deepEqual(files().flatMap((f) => overlayOffenders(read(f), f)), []);
});

test('F26: no arbitrary z-index anywhere outside Landing; layers use z-nav / z-drawer / z-overlay / z-dialog / z-toast', () => {
  assert.deepEqual(hits(/(?<![\w-])z-\[\d+\]/), []);
  assert.deepEqual(hits(/zIndex\s*:\s*\d{2,}/), [], 'no inline zIndex of 10 or more');
});

test('F26: one scrim: every overlay backdrop is black/40, and no caller passes its own overlay class to ModalDialog', () => {
  assert.deepEqual(hits(/\bbg-black\/(?!40\b)\d+/), [], 'no other scrim opacity');
  assert.deepEqual(hits(/overlayClass=/), [], 'callers do not override the scrim or its layer');
});

test('ModalDialog renders the scrim on z-overlay, the panel as lg radius with e3 elevation, and an enter animation class', () => {
  const src = read('components/ModalDialog.jsx');
  assert.match(src, /\bz-overlay\b/);
  assert.match(src, /\bbg-black\/40\b/);
  assert.match(src, /\brounded-lg\b/);
  assert.match(src, /\bshadow-e3\b/);
  assert.match(src, /\bdialog-enter\b/, 'the panel has the dialog-enter class (scale .98 to 1 plus fade, --dur-base)');
  assert.doesNotMatch(src, /\bz-50\b|\bbg-black\/30\b/);
});

test('index.css defines the dialog and drawer motion: dialog-enter 200 ms (--dur-base) and drawer-enter 220 ms, both with --ease-out', () => {
  const css = read('index.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (cls) => css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1] || '';
  assert.match(rule('dialog-enter'), /animation\s*:[^;]*var\(--dur-base\)[^;]*var\(--ease-out\)/);
  assert.match(rule('drawer-enter'), /animation\s*:[^;]*220ms[^;]*var\(--ease-out\)/);
});
