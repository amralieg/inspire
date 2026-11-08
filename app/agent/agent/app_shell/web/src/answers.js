export const ANSWERS_KEY = 'inspire-app-answers';
export const ANSWERS_KEPT = 200;
export const QUESTION_CHARS = 300;
const RATED = ['POSITIVE', 'NEGATIVE'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const personKey = (person) => String(person || '').trim().toLowerCase() || 'anyone';

export function readAnswers(storage) {
  try {
    const all = JSON.parse(storage?.getItem(ANSWERS_KEY) || '{}');
    return isObject(all) ? all : {};
  } catch {
    return {};
  }
}

export function writeAnswers(storage, all) {
  try {
    storage?.setItem(ANSWERS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

const cleanEntry = (e) => isObject(e) && typeof e.id === 'string' && e.id && RATED.includes(e.rating) && Number.isFinite(e.at);

export function answersOf(all, person, pageId) {
  const list = all?.[personKey(person)]?.[pageId];
  return Array.isArray(list) ? list.filter(cleanEntry) : [];
}

export function withRatings(all, person, pageId, thread, now = Date.now()) {
  const held = answersOf(all, person, pageId);
  const byId = new Map(held.map((e) => [e.id, e]));
  let changed = false;
  for (const m of thread || []) {
    if (m.who !== 'genie' || !m.turn_id || !RATED.includes(m.rated)) continue;
    const before = byId.get(m.turn_id);
    if (before?.rating === m.rated) continue;
    const question = String((thread.find((q) => q.n === m.n - 1) || {}).text || '').slice(0, QUESTION_CHARS);
    byId.set(m.turn_id, { id: m.turn_id, rating: m.rated, question, at: before?.at ?? now });
    changed = true;
  }
  if (!changed) return null;
  const kept = [...byId.values()].sort((a, b) => a.at - b.at).slice(-ANSWERS_KEPT);
  const who = personKey(person);
  return { ...all, [who]: { ...(isObject(all?.[who]) ? all[who] : {}), [pageId]: kept } };
}

export function answerQuality(list) {
  const rated = list.length;
  const up = list.filter((e) => e.rating === 'POSITIVE').length;
  const wrong = list.filter((e) => e.rating === 'NEGATIVE').sort((a, b) => b.at - a.at);
  return { rated, up, share: rated ? up / rated : null, wrong };
}
