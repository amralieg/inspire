import { KINDS, familyOf, kindForTechnique, kindOf } from './kinds.js';
import { fieldOf } from './useCaseFields.js';
import { placeholderWords } from './placeholderWords.js';

export const KIND_INFORMATIONAL_LABEL = 'Informational';
export const KIND_INFORMATIONAL_TITLE = 'Informs a decision rather than making one: it explains or shows what happened, so no single action or measurable outcome follows from it alone.';
export const KIND_FILTER_FAMILY = 'family:';
export const KIND_FILTER_KIND = 'kind:';
export const KIND_LINE_FIELDS = [
  { key: 'serving', field: 'serving_summary', label: 'What we serve' },
  { key: 'method', field: 'method_summary', label: 'How it works' },
  { key: 'value', field: 'value_source', label: 'Where the value comes from' },
];

const text = (value) => String(value ?? '').trim();
export function useCaseKindView(uc) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const technique = text(fieldOf(u, 'Analytics Technique', 'analytics_technique'));
  const kind = kindOf(text(u.use_case_kind)) || kindForTechnique(technique);
  if (!kind) return null;
  const family = familyOf(kind.family) || { id: kind.family, label: kind.family };
  const lines = KIND_LINE_FIELDS
    .map(({ key, field, label }) => ({ key, label, text: placeholderWords(text(u[field])) }))
    .filter((line) => line.text);
  return {
    id: kind.id,
    label: text(u.kind_label) || kind.label,
    family: family.id,
    familyLabel: text(u.kind_family_label) || family.label,
    color: text(family.color),
    question: kind.question,
    informational: Boolean(kind.informational),
    technique,
    lines,
  };
}

export function matchesKindFilter(view, filter) {
  if (!filter || filter === 'all') return true;
  if (!view) return false;
  if (filter.startsWith(KIND_FILTER_FAMILY)) return view.family === filter.slice(KIND_FILTER_FAMILY.length);
  if (filter.startsWith(KIND_FILTER_KIND)) return view.id === filter.slice(KIND_FILTER_KIND.length);
  return false;
}

export function kindFilterOptions(views) {
  const families = new Map();
  for (const view of views || []) {
    if (!view) continue;
    const family = families.get(view.family) || { value: `${KIND_FILTER_FAMILY}${view.family}`, label: view.familyLabel, count: 0, kinds: new Map() };
    family.count += 1;
    const kind = family.kinds.get(view.id) || { value: `${KIND_FILTER_KIND}${view.id}`, label: view.label, count: 0 };
    kind.count += 1;
    family.kinds.set(view.id, kind);
    families.set(view.family, family);
  }
  const familyOrder = KINDS.families.map((family) => family.id);
  const kindOrder = KINDS.kinds.map((kind) => kind.id);
  const rank = (order, id) => (order.indexOf(id) < 0 ? order.length : order.indexOf(id));
  return [...families.entries()]
    .sort(([a], [b]) => rank(familyOrder, a) - rank(familyOrder, b))
    .map(([, family]) => ({
      ...family,
      kinds: [...family.kinds.entries()].sort(([a], [b]) => rank(kindOrder, a) - rank(kindOrder, b)).map(([, kind]) => kind),
    }));
}

export function kindFilterLabel(filter, options) {
  for (const family of options || []) {
    if (family.value === filter) return family.label;
    const kind = family.kinds.find((k) => k.value === filter);
    if (kind) return kind.label;
  }
  return filter;
}

export function kindChipStyle(color) {
  return color ? { borderColor: color, backgroundColor: `${color}1f` } : undefined;
}
