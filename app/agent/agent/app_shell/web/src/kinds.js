import REGISTRY from '../../kinds.json' with { type: 'json' };

export const KINDS = REGISTRY;

const byId = (list, id) => list.find((item) => item.id === id) || null;
const techniqueKey = (technique) => String(technique ?? '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export const kindOf = (id) => byId(REGISTRY.kinds, id);
export const layoutOf = (id) => byId(REGISTRY.layouts, id);
export const familyOf = (id) => byId(REGISTRY.families, id);

export function kindForTechnique(technique) {
  const label = techniqueKey(technique);
  const key = Object.keys(REGISTRY.technique_kind).find((name) => name.toLowerCase() === label);
  return key ? kindOf(REGISTRY.technique_kind[key]) : null;
}
