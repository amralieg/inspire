// REQ-482 (FX-77b): the sweep with NO allow-list over the files FX-77 had to skip (Calculate value dialog, value wizard, Results, Build next),
// plus the dialog's own loading state: a spinning element at once, the still-working line after 8 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeBrowser } from './uiSupport.mjs';
import { mountWizard, openCard, next } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// Same scan as busySweep.test.mjs (that file is FX-77's and stays untouched).
const WAIT_WORD = '(?:Loading|Reading|Calculating|Checking|Saving|Connecting|Opening|Starting|Finding|Searching|Fetching|Listing|Working out|Requesting|Waiting for|Rebuilding|Hydrating|Building the)';
const WAIT = new RegExp(`(?:>|['"\`]|\\{)\\s*${WAIT_WORD}\\b(?:[^<>{}'"\`]*?(?:\\.\\.\\.|…)|\\s+[^<>{}'"\`\\s]+)`);
const MOTION = /BusyNote|PageSpinner|SaveButton|animate-spin|Loader2/;
const MARK = /busy-ok:/;
const REACH = 4;

function waitStatesWithoutMotion(name, text) {
  const lines = text.split('\n');
  const found = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
    if (/^\s*(\*|\/\*)|aria-label=/.test(line) || !WAIT.test(code)) return;
    const near = lines.slice(Math.max(0, i - REACH), i + REACH + 1).join('\n');
    if (MOTION.test(near) || MARK.test(near)) return;
    found.push(`${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return found;
}

const files = () => [
  'components/CalculateValueDialog.jsx', 'pages/ResultsPage.jsx', 'components/BuildNext.jsx',
  ...fs.readdirSync(path.join(src, 'components', 'valueWizard')).filter((f) => f.endsWith('.jsx')).map((f) => `components/valueWizard/${f}`),
];

test('no allow-list: the dialog, the value wizard, Results and Build next show no wait state without motion', () => {
  const missing = files().flatMap((f) => waitStatesWithoutMotion(f, fs.readFileSync(path.join(src, f), 'utf8')));
  assert.deepEqual(missing, [], `wait states with no spinner:\n${missing.join('\n')}`);
});

// The plan request never answers, so the dialog stays in its loading state.
const hangingPlan = (app) => {
  app.post('/api/inspire/value/case-plan', () => {});
  mountWizard()(app);
};

test('the Calculate value dialog loading state spins in the body and the footer, and says still working after 8 s', async () => {
  const { ui, card, page } = await openCard(hangingPlan);
  try {
    await card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
    await card.locator('[data-value-calculate]').click();
    const dialog = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await dialog.waitFor();
    // REQ-544 (a691437c5, CalculateValueDialog.jsx:258-288): the dialog is five steps and opens on Data; the plan is asked after it, so click Next
    // (at most 5 times) until the plan's loading state shows. Each round waits for a step page or the loading state, whichever is on screen.
    const body = dialog.locator('[data-wizard-loading]', { hasText: /plan the value/ });
    for (let i = 0; i < 5 && !(await body.count()); i += 1) {
      await body.or(dialog.locator('[data-wizard-page]')).first().waitFor({ timeout: 15000 });
      if (await body.count()) break;
      await next(dialog);
    }
    await body.waitFor({ timeout: 5000 });
    assert.match(await body.innerText(), /Reading your data to plan the value\./);
    assert.equal(await body.locator('[class*="animate-spin"]').count(), 1, 'the body spins');
    const footer = dialog.locator('[data-preview-state]');
    assert.match(await footer.innerText(), /Calculating/);
    assert.equal(await footer.locator('[class*="animate-spin"]').count(), 1, 'the footer spins');
    assert.equal(await dialog.locator('[data-busy-still]').count(), 0, 'no still-working line at 0 s');
    await dialog.locator('[data-busy-still]').first().waitFor({ timeout: 12000 });
    assert.match(await dialog.innerText(), /Still working\. This can take up to a minute\./);
  } finally { await ui.close(); }
});
