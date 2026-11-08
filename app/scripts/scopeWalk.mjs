import { FIRST_RUN_LABEL as RUN_LABEL } from '../frontend/src/lib/runScope.js';
const profileRoute = await import('../frontend/src/lib/groupingProfile.js').then((m) => m.GROUPING_PROFILE_ROUTE || '', () => '');
export const SCOPE_WALK_READS = new Set(profileRoute ? [`POST ${profileRoute}`] : []);
const RECORDS_RE = /· [\d,]+ records?\b/;
const SCOPE_WORDS_RE = /\b(All records|records?|groups?|days?)\b/;

export function profileWatch(page) {
  const seen = { profile: null };
  page.on('response', async (resp) => {
    if (!profileRoute || resp.request().method() !== 'POST' || new URL(resp.url()).pathname !== profileRoute || resp.status() >= 300) return;
    seen.profile = await resp.json().catch(() => null);
  });
  return seen;
}

async function check(list, name, run) {
  try {
    const got = await run();
    list.push({ check: name, ok: got.ok, detail: got.detail || '' });
  } catch (err) {
    list.push({ check: name, ok: false, detail: String(err.message).split('\n')[0].slice(0, 200) });
  }
}

const pending = (list, name, why) => list.push({ check: name, ok: null, detail: why });

async function choicesOf(group) {
  const labels = group.locator('label:has(input[type="radio"])');
  const texts = (await labels.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const checked = await labels.evaluateAll((els) => els.map((el) => el.querySelector('input[type="radio"]').checked));
  return texts.map((text, i) => ({ text, checked: checked[i] }));
}

export function checkWizardSteps(steps, profile) {
  if (!profile) return [{ check: 'the table profile', ok: null, detail: 'the wizard never read a Data groups profile, so nothing can be compared' }];
  const asked = steps.includes('Data groups');
  return [
    { check: 'the wizard asks Data groups whenever the technique works in groups', ok: asked === Boolean(profile.applies), detail: `applies ${Boolean(profile.applies)}, asked ${asked}` },
    { check: 'MVP Test Run comes right after Data groups', ok: !asked || steps.indexOf(RUN_LABEL) === steps.indexOf('Data groups') + 1, detail: steps.join(' > ') },
    { check: 'the wizard asks MVP Test Run', ok: steps.includes(RUN_LABEL), detail: steps.join(' > ') },
  ];
}

export async function checkScope(root, profile, { part = 'both' } = {}) {
  const list = [];
  const grouping = root.getByRole('group', { name: 'Data groups', exact: true });
  const firstRun = root.getByRole('group', { name: RUN_LABEL, exact: true });
  if (!profile) {
    pending(list, 'the table profile', 'the page never read a Data groups profile, so nothing can be compared');
    return list;
  }
  if (part !== 'first_run') {
    await check(list, 'Data groups is shown whenever the technique works in groups', async () => {
      const shown = (await grouping.count()) > 0;
      return { ok: shown === Boolean(profile.applies), detail: `applies ${Boolean(profile.applies)}, shown ${shown}` };
    });
  }
  if (part !== 'first_run' && profile.applies && (await grouping.count())) {
    await check(list, 'Inspire recommends grouping columns', async () => {
      const marked = await grouping.getByText('Recommended').count();
      const expected = Array.isArray(profile.recommended) ? profile.recommended.length > 0 : Boolean(profile.recommended);
      return { ok: marked > 0 === expected, detail: `${marked} marked, profile recommends ${expected}` };
    });
    await check(list, 'a group too small moves up a level', async () => {
      const said = await grouping.getByText(/moves up a level/).count();
      const expected = Boolean(profile.example && Array.isArray(profile.example.small_groups) && profile.example.small_groups.length);
      return { ok: said > 0 === expected, detail: `said ${said > 0}, the profile names a small group ${expected}` };
    });
  }
  if (part !== 'first_run' && profile.applies && (await grouping.count())) {
    await check(list, 'the whole data as one group is always offered', async () => ({ ok: (await grouping.getByRole('radio', { name: 'Whole data as one group' }).count()) === 1 }));
    await check(list, 'no custom SQL is offered', async () => ({ ok: (await grouping.getByRole('radio', { name: /custom|sql/i }).count()) === 0 && (await grouping.locator('textarea').count()) === 0 }));
  }
  if (part !== 'grouping' && (await firstRun.count())) {
    const choices = await choicesOf(firstRun);
    await check(list, 'Everything is never the default MVP Test Run', async () => {
      const picked = choices.find((c) => c.checked);
      const everything = Boolean(picked) && /^(Everything|The last \d+ days|A recent period)\b/.test(picked.text);
      return { ok: Boolean(picked) && !everything, detail: `${profile.records} records, picked ${picked ? picked.text.slice(0, 60) : 'none'}` };
    });
    await check(list, 'each MVP Test Run choice states its record count', async () => {
      const missing = choices.filter((c) => !RECORDS_RE.test(c.text));
      return { ok: choices.length > 0 && missing.length === 0, detail: missing.length ? `no count on ${missing.map((m) => m.text.slice(0, 40)).join(', ')}` : `${choices.length} choices` };
    });
  }
  return list;
}

export async function checkRunScope(page) {
  const list = [];
  const region = page.getByRole('region', { name: `Data groups and ${RUN_LABEL} of this use case` });
  if (!(await region.count())) {
    pending(list, 'the Run tab Data groups and MVP Test Run', 'this page has no scope settings');
    return list;
  }
  const firstRun = region.getByRole('group', { name: RUN_LABEL, exact: true });
  const picked = (await firstRun.count()) ? (await choicesOf(firstRun)).find((c) => c.checked) : null;
  const everythingChosen = Boolean(picked) && /^Everything\b/.test(picked.text);
  await check(list, 'Run on everything is offered while the MVP Test Run scope holds', async () => {
    const offered = (await region.getByRole('button', { name: 'Run on everything' }).count()) > 0;
    return { ok: offered === !everythingChosen, detail: `offered ${offered}, scope is everything ${everythingChosen}` };
  });
  await check(list, 'the last run states its scope', async () => {
    const last = region.getByText(/^Last run:/);
    if (!(await last.count())) return { ok: true, detail: 'no run yet' };
    const text = await last.first().innerText();
    return { ok: SCOPE_WORDS_RE.test(text), detail: text.slice(0, 120) };
  });
  return list;
}
