const profileRoute = await import('../frontend/src/lib/groupingProfile.js').then((m) => m.GROUPING_PROFILE_ROUTE || '', () => '');
export const SCOPE_WALK_READS = new Set(profileRoute ? [`POST ${profileRoute}`] : []);
const FIRST_RUN_LINE = 1000;
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
  if (!profile) return [{ check: 'the table profile', ok: null, detail: 'the wizard never read a Grouping profile, so nothing can be compared' }];
  const asked = steps.includes('Grouping');
  return [
    { check: 'the wizard asks Grouping whenever grouping applies to the technique', ok: asked === Boolean(profile.applies), detail: `applies ${Boolean(profile.applies)}, asked ${asked}` },
    { check: 'First run comes right after Grouping', ok: !asked || steps.indexOf('First run') === steps.indexOf('Grouping') + 1, detail: steps.join(' > ') },
    { check: 'the wizard asks First run', ok: steps.includes('First run'), detail: steps.join(' > ') },
  ];
}

export async function checkScope(root, profile, { part = 'both' } = {}) {
  const list = [];
  const grouping = root.getByRole('group', { name: 'Grouping', exact: true });
  const firstRun = root.getByRole('group', { name: 'First run', exact: true });
  if (!profile) {
    pending(list, 'the table profile', 'the page never read a Grouping profile, so nothing can be compared');
    return list;
  }
  if (part !== 'first_run') {
    await check(list, 'Grouping is shown whenever grouping applies to the technique', async () => {
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
    await check(list, 'Global (All) is always offered', async () => ({ ok: (await grouping.getByRole('radio', { name: 'Global (All)' }).count()) === 1 }));
    await check(list, 'Custom is offered', async () => ({ ok: (await grouping.getByRole('radio', { name: 'Custom' }).count()) === 1 }));
    pending(list, 'Custom editor: Run, refusal and Use this grouping', 'the custom SQL editor has not landed in app-scope or app-scope-api');
  }
  if (part !== 'grouping' && (await firstRun.count())) {
    const choices = await choicesOf(firstRun);
    await check(list, 'First run is the default above 1,000 records', async () => {
      const picked = choices.find((c) => c.checked);
      const over = Number(profile.records) > FIRST_RUN_LINE;
      const everything = Boolean(picked) && /^(Everything|The last \d+ days|A recent period)\b/.test(picked.text);
      return { ok: Boolean(picked) && (over ? !everything : true), detail: `${profile.records} records, picked ${picked ? picked.text.slice(0, 60) : 'none'}` };
    });
    await check(list, 'each First run choice states its record count', async () => {
      const missing = choices.filter((c) => !/^Custom SQL\b/.test(c.text) && !RECORDS_RE.test(c.text));
      return { ok: choices.length > 0 && missing.length === 0, detail: missing.length ? `no count on ${missing.map((m) => m.text.slice(0, 40)).join(', ')}` : `${choices.length} choices` };
    });
  }
  return list;
}

export async function checkRunScope(page) {
  const list = [];
  const region = page.getByRole('region', { name: 'Grouping and First run of this use case' });
  if (!(await region.count())) {
    pending(list, 'the Run tab Grouping and First run', 'this page has no scope settings');
    return list;
  }
  const firstRun = region.getByRole('group', { name: 'First run', exact: true });
  const picked = (await firstRun.count()) ? (await choicesOf(firstRun)).find((c) => c.checked) : null;
  const everythingChosen = Boolean(picked) && /^Everything\b/.test(picked.text);
  await check(list, 'Run on everything is offered while the first run scope holds', async () => {
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
