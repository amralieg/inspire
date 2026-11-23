// FX-113 (REQ-503): the one plain model every document (SVG, PowerPoint, Excel) is drawn from.
import { fieldOf, inspireScoreFromUc, trackingIdOf } from '../useCaseFields.js';
import { moneyText } from '../valueWizard.js';

export const RTL_LANGUAGES = ['Arabic', 'Hebrew', 'Persian', 'Farsi', 'Urdu'];
export const isRtl = (language) => RTL_LANGUAGES.includes(language);

const clean = (v) => String(v ?? '').trim();
const tablesOf = (uc) => clean(fieldOf(uc, 'Tables Involved', 'tables_involved')).split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

export const STORY_NOT_APPROVED = 'Story not approved yet';
const storyText = (story) => {
  if (story && typeof story === 'object') return story.approved && story.include_in_docs && clean(story.text) ? clean(story.text) : STORY_NOT_APPROVED;
  return clean(story);
};

// A saved wizard entry ({answers, yearly}) as the doc model value, or null when there is no saved value.
export function valueFromSaved(saved) {
  const total = saved?.yearly?.total;
  if (!saved || !total || !Number.isFinite(Number(total.amount))) return null;
  const a = saved.answers || {};
  return {
    amount: Number(total.amount), currency: a.currency || total.unit || 'USD', status: a.calculated ? 'calculated' : 'estimated',
    story: a.story, yearly: saved.yearly.projection?.years || [],
  };
}

function valueOf(raw) {
  if (!raw || !Number.isFinite(Number(raw.amount))) return null;
  const amount = Number(raw.amount);
  const currency = raw.currency || 'USD';
  return {
    amount, currency, status: raw.status || 'estimated', story: storyText(raw.story), text: moneyText(currency, amount),
    yearly: Array.isArray(raw.yearly) ? raw.yearly : [], factors: Array.isArray(raw.factors) ? raw.factors : [],
  };
}

export function buildDocModel({ businessName, useCases, values, options }) {
  const opts = options || {};
  const language = (opts.languages && opts.languages[0]) || opts.language || 'English';
  const list = (useCases || []).map((uc) => {
    const id = trackingIdOf(uc);
    const score = inspireScoreFromUc(uc);
    return {
      id, name: clean(fieldOf(uc, 'Name', 'name')), statement: clean(fieldOf(uc, 'Statement', 'statement')), solution: clean(fieldOf(uc, 'Solution', 'solution')),
      businessValue: clean(fieldOf(uc, 'Business Value', 'business_value')), domain: clean(fieldOf(uc, 'domain', 'Domain') || fieldOf(uc, 'Subdomain', 'subdomain')),
      score, tables: tablesOf(uc), value: valueOf(values?.[id]),
    };
  });
  const withValue = list.filter((u) => u.value);
  const currency = withValue[0]?.value.currency || 'USD';
  const same = withValue.filter((u) => u.value.currency === currency);
  const amount = same.reduce((sum, u) => sum + u.value.amount, 0);
  return {
    businessName: clean(businessName), language, rtl: isRtl(language), blocks: [...(opts.blocks || [])], useCases: list,
    total: { amount, currency, n: list.length, nWithValue: withValue.length, text: moneyText(currency, amount) },
  };
}
