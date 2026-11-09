export const VIBE_WRITES_SOURCE = 'Inspire never changes or deletes your source data: an MVP only reads it and writes its own result table, so Inspire does not build this ask. To leave rows out, ask to filter them out of a chart or table instead';
export const VIBE_OUTSIDE_CALL = 'Inspire MVPs run inside your Databricks workspace and never call outside websites or services, so Inspire does not build this ask. Load that data into a Unity Catalog table first, then ask for it by table name';
export const VIBE_VAGUE = 'Say what to change, for example which chart, table, filter or page, and how it should look or behave. Inspire still sends this ask as you wrote it, and Genie may not know what to change';

const WRITE_VERB = String.raw`(?:delete|drop|truncate|purge|wipe|erase|overwrite|update|insert|alter)`;
const REMOVE_VERB_WRITE = String.raw`(?:delete|drop|truncate|purge|wipe|erase|remove)`;
const SOURCE = String.raw`(?:source|raw|original|underlying)\s+(?:data\s+)?(?:rows?|records?|tables?|data)\b(?![\w-]*\s+(?:labels?|names?|columns?|fields?|charts?|graphs?|plots?|tiles?|values?|notes?|counts?|sections?|tabs?|views?|links?|filters?|widgets?|panels?|cards?|kpis?|titles?|legends?|axis|axes|captions?|summar(?:y|ies)|previews?|samples?|pages?|lists?|explorers?|quality|profiles?|dictionar(?:y|ies)|tables?|text|fonts?|colou?rs?|format(?:ting)?|layout|styles?|tooltips?|headers?|headings?)\b)`;
const OBJECT_WORD = String.raw`(?:\s+(?:all\s+of|(?!(?:from|on|in|into|to|with|for|using|by|about|of|so|based|via|like)\b)[\w-]+)){0,3}?`;
const SQL_WRITE = /\b(?:delete\s+from|drop\s+(?:table|schema|catalog|view)|truncate\s+table|insert\s+(?:into|overwrite)|update\s+\S+\s+set|merge\s+into|alter\s+table)\b/i;
const SOURCE_WRITE = new RegExp(String.raw`\b${WRITE_VERB}\w*${OBJECT_WORD}\s+${SOURCE}`, 'i');
const SOURCE_REMOVE = new RegExp(String.raw`\b${REMOVE_VERB_WRITE}\w*\b[^.;!?]{0,40}\b(?:from|in)\s+(?:the\s+|our\s+|my\s+)?${SOURCE}`, 'i');
const TABLE_WRITE = new RegExp(String.raw`\b(?:delete|drop|truncate|purge|wipe|erase|overwrite|insert|write)\w*\b(?:[^.;!?]{0,40}\b(?:from|in|into|to))?\s+\x60?[a-z_][\w-]*\x60?\.\x60?[a-z_][\w-]*\x60?\.\x60?[a-z_][\w-]*`, 'i');
const CALL_VERB = String.raw`(?:call|calls|calling|fetch|fetches|pull|pulls|query|queries|hit|post|request|scrape|download|look\s+up|load|read|get|grab|import|stream|use|connect\s+to)`;
const OUTSIDE = String.raw`(?:https?:\/\/\S+|www\.\S+|\bapi\.[\w-]+(?:\.[\w-]+)+|\b[\w-]+\.(?:com|io|net|org|host|ai|dev|co)\b|\b(?:outside|external|third[- ]party|public)\s+(?:web\s?sites?|api|apis|services?|endpoints?)|\bthe\s+internet\b)`;
const OUTSIDE_CALL = new RegExp(String.raw`\b${CALL_VERB}\b[^.;!?]{0,50}${OUTSIDE}`, 'i');
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const VAGUE = [
  /^(?:please\s+)?(?:make|do)\s+(?:it|this|that|everything|all\s+of\s+it|the\s+(?:mvp|app|dashboard|page|use\s+case))\s+(?:a\s+lot\s+|much\s+|way\s+)?(?:better|nicer|good|great|prettier|cooler|more\s+useful|look\s+better|pop|shine|awesome)$/i,
  /^(?:please\s+)?(?:improve|enhance|polish|fix|optimi[sz]e|upgrade)\s+(?:it|this|that|everything|all\s+of\s+it|the\s+(?:mvp|app|dashboard|page|use\s+case))(?:\s+(?:please|more|a\s+bit))?$/i,
  /^(?:please\s+)?(?:better|improve(?:ments?)?|make\s+better|something\s+better|more)$/i,
];
const ADD_VERB = /^(?:please\s+)?(?:show|add|include|keep|put|display|give\s+me|i\s+want)\b/i;
const REMOVE_VERB = /^(?:please\s+)?(?:remove|delete|hide|drop|take\s+out|get\s+rid\s+of|do\s+not\s+show|don't\s+show|no)\b/i;
const FILLER = new Set(['a', 'an', 'the', 'of', 'as', 'to', 'on', 'in', 'for', 'please', 'me', 'it', 'and', 'with', 'from', 'by', 'that', 'this', 'out', 'rid']);

const clean = (text) => ' '.concat(String(text ?? ''), ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (text) => clean(text).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/)
  .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).filter((w) => w && !FILLER.has(w));

const NEGATED = /\b(?:never|not|don't|dont|no|without|avoid|stop|nor)\s+(?:\S+\s+){0,2}$/i;

function asked(re, text) {
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...text.matchAll(all)].some((m) => !NEGATED.test(text.slice(0, m.index)));
}

export function vibeAskLimit(ask) {
  const text = clean(ask);
  if (!text) return null;
  if ([SQL_WRITE, SOURCE_WRITE, SOURCE_REMOVE, TABLE_WRITE].some((re) => asked(re, text))) return { kind: 'refused', reason: VIBE_WRITES_SOURCE };
  if (asked(OUTSIDE_CALL, text.replace(EMAIL, ' '))) return { kind: 'refused', reason: VIBE_OUTSIDE_CALL };
  if (VAGUE.some((re) => re.test(text.replace(/[.!?\s]+$/, '')))) return { kind: 'vague', reason: VIBE_VAGUE };
  return null;
}

function objectOf(ask, verb) {
  const m = verb.exec(clean(ask));
  return m ? wordsOf(clean(ask).slice(m[0].length)) : null;
}

function sameThing(a, b) {
  if (!a?.length || !b?.length) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = new Set(a.length <= b.length ? b : a);
  return shorter.filter((w) => longer.has(w)).length / shorter.length >= 0.7;
}

const RULED_OUT = /[,;]?\s*(?:but\s+)?(?:never|not|no)\s+([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+)?)\s*[.!]?$/iu;
const NEGATED_WORD = (text, word) => new RegExp(String.raw`\b(?:never|not|no)\s+(?:\S+\s+){0,2}${word}`, 'i').test(clean(text));

export function vibeConflicts(asks) {
  const list = (asks || []).map(clean).filter(Boolean);
  const out = [];
  list.forEach((ask, i) => {
    const added = objectOf(ask, ADD_VERB);
    if (!added) return;
    list.forEach((other, j) => {
      if (i === j) return;
      const removed = objectOf(other, REMOVE_VERB);
      if (removed && sameThing(added, removed)) {
        out.push({ asks: i < j ? [ask, other] : [other, ask],
          note: `“${ask}” and “${other}” ask for opposite things, so Genie cannot do both. Take out the one you do not want before you rebuild` });
      }
    });
  });
  list.forEach((ask, i) => {
    const ruled = RULED_OUT.exec(ask);
    if (!ruled) return;
    const banned = wordsOf(ruled[1]);
    const rest = wordsOf(ask.slice(0, ruled.index));
    list.forEach((other, j) => {
      if (i === j || out.some((c) => c.asks.includes(ask) && c.asks.includes(other))) return;
      const words = wordsOf(other);
      if (!banned.length || !banned.every((w) => words.includes(w)) || NEGATED_WORD(other, banned[0])) return;
      if (!sameThing(words.filter((w) => !banned.includes(w)), rest)) return;
      out.push({ asks: i < j ? [ask, other] : [other, ask],
        note: `“${other}” and “${ask}” ask for opposite things, so Genie cannot do both. Take out the one you do not want before you rebuild` });
    });
  });
  return out;
}

export function vibeLimitNotes(asks) {
  const list = (asks || []).map(clean).filter(Boolean);
  const notes = list.map((ask) => ({ ask, ...vibeAskLimit(ask) })).filter((n) => n.kind);
  return [...notes, ...vibeConflicts(list).map((c) => ({ ask: c.asks[1], kind: 'conflict', reason: c.note, asks: c.asks }))];
}

export function vibeRefusals(asks) {
  return vibeLimitNotes(asks).filter((n) => n.kind === 'refused');
}

export function vibeRefusalText(refused) {
  return (refused || []).map((n) => `“${n.ask}”: ${n.reason}`).join('; ');
}

const asksOf = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export function specVibeAsks(spec) {
  const outputs = spec?.outputs && typeof spec.outputs === 'object' ? spec.outputs : {};
  const all = [...asksOf(spec?.vibes), ...asksOf(spec?.data?.notes),
    ...Object.keys(outputs).filter((key) => key.endsWith('_vibes')).sort().flatMap((key) => asksOf(outputs[key]))];
  const seen = new Set();
  return all.filter((ask) => {
    const key = clean(ask).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
