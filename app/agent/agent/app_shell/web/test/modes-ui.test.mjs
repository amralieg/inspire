import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, PERSON, appInfo, openApp, serveDist, toastSays } from './harness.mjs';
import { dashboardRoutes, evaluated, scenarioRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const railOf = (page) => page.locator('[data-rail]').evaluateAll((items) => items.map((i) => [i.dataset.rail, i.textContent.trim()]));
const go = async (page, id, section) => {
  await page.evaluate(([p, s]) => { window.location.hash = `#/${p}/${s}`; }, [id, section]);
  await page.waitForFunction((s) => window.location.hash.includes(`/${s}`), section);
};
const noQueue = async (page) => {
  assert.equal(await page.locator('[data-work]').count(), 0, 'no decision queue');
  assert.equal(await page.locator('[data-tab]').count(), 0, 'no queue tabs');
};

test('a queue keeps Work and Performance', async () => {
  const info = appInfo(DECIDE);
  const { page, seen, context } = await openApp(browser, served.base, info);
  const id = info.pages[0].id;
  await page.locator('[data-rail]').first().waitFor();
  const rail = Object.fromEntries(await railOf(page));
  assert.equal(rail.work, 'Work');
  assert.equal(rail.performance, 'Performance');
  await go(page, id, 'work');
  await page.locator('[data-work]').waitFor();
  assert.equal(await page.locator('[data-mode-work]').count(), 0);
  assert.equal(await page.locator('[data-section-title]').textContent(), 'Work');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Explore shows the tables with saved views and Notify me, no queue, and Usage under Performance', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const asked = [];
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: dashboardRoutes(asked) });
  const id = info.pages[0].id;
  await page.locator('[data-rail]').first().waitFor();
  const rail = Object.fromEntries(await railOf(page));
  assert.equal(rail.work, 'Explore');
  assert.equal(rail.performance, 'Usage');
  await go(page, id, 'work');
  await page.locator('[data-mode-work="explore"]').waitFor();
  await page.locator('[data-mode-work="explore"] tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-explore-tools]').count(), 1);
  assert.equal(await page.locator('[data-section-title]').textContent(), 'Explore');
  await noQueue(page);
  assert.deepEqual(asked, [], 'Explore never asks for a decision list');
  await go(page, id, 'performance');
  await page.locator('[data-mode-performance="explore"]').waitFor();
  assert.match(await page.locator('[data-mode-performance="explore"]').textContent(), /saved view/i);
  assert.equal(await page.locator('[data-mode-performance="explore"] h2').textContent(), 'Usage');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Ask is one full-page chat, no queue, and Answer quality under Performance', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/agent_chat.json');
  const { page, seen, context } = await openApp(browser, served.base, info);
  const id = info.pages[0].id;
  await page.locator('[data-rail]').first().waitFor();
  const rail = Object.fromEntries(await railOf(page));
  assert.equal(rail.work, 'Ask');
  assert.equal(rail.performance, 'Answer quality');
  await go(page, id, 'work');
  await page.locator('[data-mode-work="ask"] [data-genie-full]').waitFor();
  await noQueue(page);
  await page.getByRole('button', { name: 'Ask Genie' }).click();
  assert.equal(await page.locator('aside.genie').count(), 1, 'the top-bar button reuses the page chat');
  await page.waitForFunction(() => document.activeElement?.matches('[data-genie-full] .g-in input'));
  await page.waitForFunction(() => document.activeElement?.matches('[data-genie-full] .g-in input'));
  assert.equal(await page.locator('[data-genie-full] [aria-label="Close"]').count(), 0);
  await go(page, id, 'performance');
  await page.locator('[data-mode-performance="ask"]').waitFor();
  assert.equal(await page.locator('[data-mode-performance="ask"] h2').textContent(), 'Answer quality');
  assert.match(await page.locator('[data-mode-performance="ask"]').textContent(), /Rate Genie/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Scenarios saves, compares, shares and records the choice in the decision log', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/scenario_lab.json');
  const id = info.pages[0].id;
  const library = { scenarios: [], decisions: [], mine: 0, note: '' };
  const posted = [];
  const asked = [];
  let n = 0;
  const routes = {
    ...scenarioRoutes(asked, []),
    'scenario/saved': ({ json }) => json(200, library),
    'scenario/save': ({ route, json }) => {
      const body = route.request().postDataJSON();
      posted.push(['save', body]);
      n += 1;
      library.scenarios.unshift({ id: String(n).repeat(32).slice(0, 32), name: body.name, note: body.note, levers: body.values, by: PERSON,
        at: '2026-11-08T10:00:00', shared: false, mine: true, outcome: { p50: evaluated(body.values).outcome.p50 } });
      library.mine = n;
      return json(200, library);
    },
    'scenario/share': ({ route, json }) => {
      const body = route.request().postDataJSON();
      posted.push(['share', body]);
      library.scenarios.find((s) => s.id === body.scenario_id).shared = body.shared;
      return json(200, library);
    },
    'scenario/choose': ({ route, json }) => {
      const body = route.request().postDataJSON();
      posted.push(['choose', body]);
      const s = library.scenarios.find((x) => x.id === body.scenario_id);
      library.decisions.unshift({ scenario_id: s.id, name: s.name, note: body.note, by: PERSON, at: '2026-11-08T11:00:00' });
      return json(200, library);
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes });
  await page.locator('[data-rail]').first().waitFor();
  const rail = Object.fromEntries(await railOf(page));
  assert.equal(rail.work, 'Scenarios');
  assert.equal(rail.performance, 'Performance');
  await go(page, id, 'work');
  const work = page.locator('[data-mode-work="scenarios"]');
  await work.locator('[data-lever="price"]').waitFor();
  await work.locator('[data-scenario-save]').waitFor();
  assert.match(await work.locator('[data-saved-scenarios]').textContent(), /No saved scenario yet/);
  for (const name of ['Base plan', 'Price up']) {
    await work.locator('[data-scenario-save] input').first().fill(name);
    await work.getByRole('button', { name: 'Save the scenario' }).click();
    await toastSays(page, `Saved the scenario ${name}`);
  }
  assert.deepEqual(posted.map(([kind, b]) => [kind, b.page, b.name]), [['save', id, 'Base plan'], ['save', id, 'Price up']]);
  assert.ok(Object.keys(posted[0][1].values).length >= 3, 'the save sends every lever value');
  assert.equal(await work.locator('[data-scenario]').count(), 2);
  assert.equal(await work.locator('[data-scenario-compare]').count(), 0);
  await work.getByLabel('Compare Base plan').check();
  await work.getByLabel('Compare Price up').check();
  await work.locator('[data-scenario-compare] [data-compare-row="p50"]').waitFor();
  assert.ok(await work.locator('[data-compare-row="lever:price"]').count() === 1);
  assert.equal(await work.locator('[data-scenario-compare] thead th').count(), 3);
  await work.locator('[data-scenario]').first().locator('[data-share]').click();
  await toastSays(page, 'Shared Price up with everyone in this App');
  assert.deepEqual(posted.at(-1)[1].shared, true);
  await work.locator('[data-scenario]').first().locator('[data-choose]').click();
  await work.locator('[data-scenario-choose] input').fill('Board agreed');
  await work.getByRole('button', { name: 'Record the choice of Price up' }).click();
  await work.locator('[data-decision-log] li').first().waitFor();
  assert.match(await work.locator('[data-decision-log]').textContent(), /Price up: Board agreed/);
  await noQueue(page);
  await go(page, id, 'performance');
  await page.locator('[data-mode-performance="scenarios"]').waitFor();
  assert.equal(await page.locator('[data-stat="yours"] b').textContent(), '2');
  assert.equal(await page.locator('[data-stat="decisions"] b').textContent(), '1');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('switching use case in a hub re-labels the rail by the mode of the open use case', async () => {
  const explore = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const ask = appInfo(DECIDE, 1, {}, 'examples/agent_chat.json');
  const info = { ...explore, pages: [explore.pages[0], ask.pages[0]] };
  const { page, context } = await openApp(browser, served.base, info, { routes: dashboardRoutes([]) });
  await page.locator('[data-rail]').first().waitFor();
  assert.equal(Object.fromEntries(await railOf(page)).work, 'Explore');
  await go(page, ask.pages[0].id, 'dashboard');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-rail="work"]')].some((i) => i.textContent.trim() === 'Ask'));
  assert.equal(Object.fromEntries(await railOf(page)).performance, 'Answer quality');
  await go(page, explore.pages[0].id, 'dashboard');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-rail="work"]')].some((i) => i.textContent.trim() === 'Explore'));
  await context.close();
});
