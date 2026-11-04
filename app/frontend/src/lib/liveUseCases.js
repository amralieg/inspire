export const LIVE_STEP_STATUSES = ['ended_success', 'ended_warning'];
export const LIVE_COUNT_WORDS = 'drafted so far';

const FIELD_WORDS = new Set(['name', 'use case', 'use_case', 'usecase', 'use case name', 'title', 'type', 'id', 'domain', 'business domain']);
const PLACEHOLDER = /^(?:use[ _-]?case[ _-]*\d*|example|sample|placeholder|tbd|todo|n\/?a|none|null|undefined|untitled|\.{2,}|<[^>]*>|\{[^}]*\}|\[[^\]]*\])$/i;

export function isPlaceholderName(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 5) return true;
  return FIELD_WORDS.has(text.toLowerCase()) || PLACEHOLDER.test(text);
}

export function isPlaceholderUseCase(uc) {
  if (!uc || typeof uc !== 'object' || Array.isArray(uc)) return true;
  return isPlaceholderName(uc.Name);
}

const nameKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function liveUseCasesOf(steps) {
  const byKey = new Map();
  const keyOfId = new Map();
  const idToDomain = {};
  const put = (name, id, fields) => {
    const label = String(name ?? '').trim();
    const ident = String(id ?? '').trim();
    const key = label ? nameKey(label) : ident ? keyOfId.get(ident) || `#${ident}` : '';
    if (!key) return;
    const existing = byKey.get(key) || {};
    byKey.set(key, { ...existing, ...fields(existing), Name: existing.Name || label, No: existing.No || ident });
    if (ident && !keyOfId.has(ident)) keyOfId.set(ident, key);
  };
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step?.status && !LIVE_STEP_STATUSES.includes(String(step.status))) continue;
    const rj = step?.result_json;
    if (!rj || typeof rj !== 'object') continue;
    const prompt = rj.prompt_name || '';
    for (const uc of Array.isArray(rj.use_cases) ? rj.use_cases : []) {
      if (!uc || typeof uc !== 'object') continue;
      put(uc.name ?? uc.Name, uc.id ?? uc.No, (existing) => ({
        'Business Domain': uc.business_domain || uc['Business Domain'] || existing['Business Domain'] || '',
        Subdomain: uc.subdomain || uc.Subdomain || existing.Subdomain || '',
        type: uc.type || existing.type || '',
        Priority: uc.priority || uc.Priority || existing.Priority || '',
        ...(uc.name_with_technique ? { name_with_technique: uc.name_with_technique } : {}),
      }));
    }
    for (const sc of Array.isArray(rj.scored_use_cases) ? rj.scored_use_cases : []) {
      if (!sc || typeof sc !== 'object') continue;
      put(sc.name ?? sc.Name, sc.id ?? sc.No, (existing) => ({
        Priority: sc.priority || sc.Priority || existing.Priority || '',
        Quality: sc.quality || sc.Quality || existing.Quality || '',
        _value: sc.value || existing._value || '',
        _feasibility: sc.feasibility || existing._feasibility || '',
      }));
    }
    for (const row of Array.isArray(rj.rows) ? rj.rows : []) {
      if (row && typeof row === 'object') put(row.Name, row.No || row.id, () => ({ ...row }));
    }
    if (prompt === 'DOMAIN_FINDER_PROMPT' && Array.isArray(rj.domains)) {
      for (const d of rj.domains) for (const id of d?.use_case_ids || []) idToDomain[String(id)] = d?.domain_name || '';
    }
    if ((prompt === 'USE_CASE_GENIE_CODE_INSTRUCTION_GEN_PROMPT' || prompt === 'USE_CASE_SQL_GEN_PROMPT') && (rj.response_chars || rj.sql_preview)) {
      const match = String(rj.entity_id || '').match(/uc_(\d+)/);
      const key = match && keyOfId.get(match[1]);
      if (key) byKey.set(key, { ...byKey.get(key), _hasGenieCode: true });
    }
  }
  const useCases = [];
  for (const uc of byKey.values()) {
    if (isPlaceholderUseCase(uc)) continue;
    if (!uc['Business Domain'] && idToDomain[String(uc.No)]) uc['Business Domain'] = idToDomain[String(uc.No)];
    useCases.push(uc);
  }
  return useCases;
}

export function liveDomainsOf(useCases) {
  const domainMap = new Map();
  for (const uc of useCases) {
    const name = uc['Business Domain'] || 'Uncategorized';
    if (!domainMap.has(name)) domainMap.set(name, []);
    domainMap.get(name).push(uc);
  }
  return Array.from(domainMap.entries()).map(([domain_name, use_cases]) => ({ domain_name, use_cases }));
}

export function liveCountText(count) {
  const n = Number(count) || 0;
  return `${n} use case${n === 1 ? '' : 's'} ${LIVE_COUNT_WORDS}`;
}
