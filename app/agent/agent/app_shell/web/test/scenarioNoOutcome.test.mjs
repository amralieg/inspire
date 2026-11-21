// REQ-431 (F-085, F-093): a scenario answer without an outcome shows a plain note; it never crashes the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { scenarioRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const ANSWERS = {
  'an empty answer': {},
  'an answer with levers but no outcome': { levers: [], clamped: [], contributions: [], distribution: [] },
};

for (const [name, answer] of Object.entries(ANSWERS)) {
  test(`the scenario lab explains ${name} instead of crashing`, async () => {
    const info = appInfo({ options: { modify: true, replace_edits: false, decisions: false } }, 1, {}, 'examples/scenario_lab.json');
    const routes = { ...scenarioRoutes([], []), 'scenario/evaluate': ({ json }) => json(200, answer) };
    const errors = [];
    const { page, seen, context } = await openApp(browser, served.base, info, { routes, ready: '.scenario', watch: (p) => p.on('pageerror', (e) => errors.push(e.message)) })
      .catch((e) => assert.fail(`the page never showed the scenario; page errors: ${JSON.stringify(errors)} (${e.message.split('\n')[0]})`));
    await page.locator('.scenario .tile-err').waitFor({ timeout: 8000 })
      .catch(() => assert.fail(`no note shown; page errors: ${JSON.stringify(errors)}`));
    assert.match(await page.locator('.scenario .tile-err').innerText(), /scenario/i);
    assert.deepEqual(seen.errors, [], 'no page error');
    await context.close();
  });
}
