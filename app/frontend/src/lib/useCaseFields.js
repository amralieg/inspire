import { normalizeDatabricksFsPath } from './workspaceLinks.js';

export const PRIORITY_ORDER = [
  'Ultra High',
  'Very High',
  'High',
  'Medium',
  'Low',
  'Very Low',
  'Ultra Low',
];

export function priorityRank(priority) {
  const at = PRIORITY_ORDER.indexOf(String(priority || '').trim());
  return at === -1 ? PRIORITY_ORDER.length : at;
}

export function isNumericPriorityString(str) {
  if (str == null) return false;
  const x = String(str).trim();
  return x !== '' && /^\d+(\.\d+)?$/.test(x);
}

export const PRIORITY_BANDS = [
  [4.5, 'Ultra High'],
  [4, 'Very High'],
  [3.5, 'High'],
  [2.5, 'Medium'],
  [2, 'Low'],
  [1.5, 'Very Low'],
  [-Infinity, 'Ultra Low'],
];

export const INSPIRE_QUALITY_WEIGHT = 0.65;
export const INSPIRE_PRIORITY_WEIGHT = 0.35;
export const HIGH_PRIORITY_MIN_INSPIRE_SCORE = PRIORITY_BANDS.find(([, tier]) => tier === 'High')[0];

const toTen = (x) => Math.min(10, Math.max(0, x));

export function inspireScoreFromUc(uc) {
  if (!uc || typeof uc !== 'object') return null;
  const stored = scoreOf(uc, 'inspire_score', 'Inspire Score');
  if (stored != null) return stored;
  const quality = scoreOf(uc, 'quality_score', 'Quality Score');
  const priority = scoreOf(uc, 'priority_score', 'Priority Score', 'Priority');
  if (quality == null || priority == null) return null;
  return INSPIRE_QUALITY_WEIGHT * toTen(quality * 2) + INSPIRE_PRIORITY_WEIGHT * toTen(priority);
}

export function scoreOf(uc, ...fields) {
  for (const field of fields) {
    const raw = uc?.[field];
    if (raw == null || raw === '') continue;
    const x = Number(raw);
    if (Number.isFinite(x)) return x;
  }
  return null;
}

export function expandWorkspaceListCandidates(p) {
  const n = normalizeDatabricksFsPath(p);
  if (!n.startsWith('/')) return [];
  const out = [];
  const push = (x) => {
    const y = normalizeDatabricksFsPath(x);
    if (y && !out.includes(y)) out.push(y);
  };
  push(n);
  if (n.startsWith('/Volumes/')) return out;
  if (!n.startsWith('/Workspace')) push(`/Workspace${n}`);
  if (n.startsWith('/Workspace/')) {
    const stripped = n.slice('/Workspace'.length) || '/';
    push(stripped);
  }
  return out;
}

export function hasShippedGenieCode(uc) {
  if (!uc || typeof uc !== 'object') return false;
  if (uc.has_genie_code_flag === true) return true;
  const h = String(uc.has_genie_code ?? uc['Has Genie Code'] ?? '').trim().toUpperCase();
  if (h === 'Y' || h === 'YES') return true;
  const gi = String(uc.genie_instruction ?? '').trim();
  return gi.length > 120;
}

export function hasGenieInstruction(uc) {
  if (!uc || typeof uc !== 'object') return false;
  if (hasShippedGenieCode(uc)) return true;
  return String(uc.genie_instruction ?? uc.Genie_Instruction ?? '').trim().length > 0;
}

export function collectUseCaseNotebookFilenamePrefixes(uc) {
  if (!uc || typeof uc !== 'object') return [];
  const raw = [uc.id, uc.No, uc['No'], uc.catalog_no, uc.use_case_id, uc.use_caseId];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const s = String(v ?? '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function notebookBaseMatches(base, id) {
  const prefix = String(id).toLowerCase();
  return base === prefix || base.startsWith(`${prefix}-`) || base.startsWith(`${prefix}_`) || base.startsWith(`${prefix}.`);
}

export function findUcForNotebookFilename(fname, useCases) {
  if (!fname || !String(fname).toLowerCase().endsWith('.ipynb') || !useCases?.length) return null;
  const nameNorm = String(fname).trim().toLowerCase();
  const base = nameNorm.replace(/\.ipynb$/i, '');
  for (const uc of useCases) {
    const nb = String(uc.notebook_path || '').trim();
    if (nb) {
      const tail = (nb.split('/').pop() || '').trim().toLowerCase();
      if (tail && tail === nameNorm) return uc;
    }
    if (collectUseCaseNotebookFilenamePrefixes(uc).some((id) => notebookBaseMatches(base, id))) return uc;
  }
  return null;
}

export function notebookPathOf(uc, files) {
  const stored = String(uc?.notebook_path ?? '').trim();
  if (stored) return stored;
  if (!files?.length) return '';
  const prefixes = collectUseCaseNotebookFilenamePrefixes(uc);
  if (!prefixes.length) return '';
  return files.find((p) => {
    const name = (String(p).split('/').pop() || '').trim().toLowerCase();
    if (!name.endsWith('.ipynb')) return false;
    const base = name.replace(/\.ipynb$/i, '');
    return prefixes.some((prefix) => notebookBaseMatches(base, prefix));
  }) || '';
}

export function trackingIdOf(uc) {
  if (!uc || typeof uc !== 'object') return '';
  return String(uc.id ?? uc.No ?? uc['No'] ?? '').trim();
}

function selectionFlagsOf(uc) {
  let flags = uc.selection_flags ?? uc.selectionFlags;
  if (typeof flags === 'string') {
    try { flags = JSON.parse(flags); } catch { flags = null; }
  }
  return flags && typeof flags === 'object' ? flags : null;
}

export const BELOW_BAR_ELITE_STATUSES = ['FALLBACK_BELOW_BAR', 'DOMAIN_COVERAGE_PICK'];

const BELOW_BAR_STATUSES = new Set(BELOW_BAR_ELITE_STATUSES);

export function meetsQualityBarOf(uc) {
  if (!uc || typeof uc !== 'object') return null;
  const flag = String(uc.meets_quality_bar ?? uc.meetsQualityBar ?? '').trim().toUpperCase();
  if (flag === 'Y' || flag === 'YES' || flag === 'TRUE') return true;
  if (flag === 'N' || flag === 'NO' || flag === 'FALSE') return false;
  const status = String(uc.elite_status ?? uc.eliteStatus ?? '').trim().toUpperCase();
  if (BELOW_BAR_STATUSES.has(status)) return false;
  return null;
}

const CHECK_CODE_IN_PARENS = /\s*\((?:score:[a-z_]+|[A-Z]{1,2}\d{1,2}|[a-z]+(?:_[a-z]+)+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\)/g;
const RAW_CHECK_CODE = /:?\s*\bQ\d_[RT]\d+_[A-Z_]+(?::[^\s;,]*)?/g;

export function plainReason(text) {
  return String(text ?? '').replace(CHECK_CODE_IN_PARENS, '').replace(RAW_CHECK_CODE, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,;:])/g, '$1').replace(/(?:[,;:]\s*)+$/, '').replace(/\bby$/, 'by a quality check').trim();
}

export function belowBarReasonOf(uc) {
  if (!uc || typeof uc !== 'object') return '';
  const flags = selectionFlagsOf(uc) || {};
  for (const v of [uc.fallback_reason, uc.below_bar_reason, uc['Below Bar Reason'], flags.fallback_reason,
    uc.coverage_pick_reason, flags.coverage_pick_reason]) {
    if (v != null && typeof v !== 'object' && plainReason(v)) return plainReason(v);
  }
  return '';
}

export function qualityBarFilterMatches(filter, uc) {
  if (filter === 'meets') return meetsQualityBarOf(uc) !== false;
  if (filter === 'below') return meetsQualityBarOf(uc) === false;
  return true;
}

export function compareMeetsQualityBarFirst(a, b) {
  return (meetsQualityBarOf(a) === false ? 1 : 0) - (meetsQualityBarOf(b) === false ? 1 : 0);
}

export function compareUseCaseRank(a, b) {
  const meetsFirst = compareMeetsQualityBarFirst(a, b);
  if (meetsFirst !== 0) return meetsFirst;
  return (inspireScoreFromUc(b) ?? -Infinity) - (inspireScoreFromUc(a) ?? -Infinity);
}

export function qualityBarCountsOf(list) {
  const items = Array.isArray(list) ? list.filter((uc) => uc && typeof uc === 'object') : [];
  const below = items.filter((uc) => meetsQualityBarOf(uc) === false).length;
  return { found: items.length, meets: items.length - below, below };
}

export function belowBarLabelFromUseCase(uc) {
  if (!uc || typeof uc !== 'object') return '';
  const meets = meetsQualityBarOf(uc);
  if (meets === false) return belowBarReasonOf(uc) || 'Below your quality bar';
  if (meets === true) return '';
  const flags = selectionFlagsOf(uc);
  if (flags) {
    for (const key of ['elite_fallback_pick', 'elite_fallback_near_miss', 'elite_coverage_pick', 'label', 'reason']) {
      const v = flags[key];
      if (v != null && plainReason(v)) return plainReason(v);
    }
    for (const v of Object.values(flags)) {
      if (typeof v === 'string' && /below the /i.test(v)) return plainReason(v);
    }
  }
  const reason = uc.selection_drop_reason || uc.selectionDropReason;
  if (reason && /below the /i.test(String(reason))) return plainReason(reason);
  return '';
}

export const HIGH_PRIORITY_TIERS = ['Ultra High', 'Very High', 'High'];

export function priorityTierOf(uc) {
  const label = String(uc?.Priority ?? uc?.priority ?? '').trim();
  if (PRIORITY_ORDER.includes(label)) return label;
  const score = inspireScoreFromUc(uc);
  if (score == null) return '';
  return PRIORITY_BANDS.find(([floor]) => score / 2 >= floor)[1];
}

export function isHighPriority(uc) {
  return HIGH_PRIORITY_TIERS.includes(priorityTierOf(uc));
}

export function computeHighPriorityCount(list) {
  if (!Array.isArray(list)) return 0;
  return list.filter(isHighPriority).length;
}

export function displayCleanText(s) {
  if (s == null) return '';
  let t = String(s).replace(/<[^>]*>/g, ' ');
  try {
    t = t.replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu, '');
  } catch {
    t = t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  }
  return t.replace(/\uFE0F/g, '').replace(/\u200D/g, '').replace(/\u20E3/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function isBlankField(value) {
  return value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

export function fieldOf(uc, displayKey, trackingKey) {
  if (!uc || typeof uc !== 'object') return undefined;
  return isBlankField(uc[displayKey]) ? uc[trackingKey] : uc[displayKey];
}

export function beneficiaryFromUc(uc) {
  return String(fieldOf(uc, 'Beneficiary', 'beneficiary') ?? '').trim();
}

export function sponsorFromUc(uc) {
  return String(fieldOf(uc, 'Sponsor', 'sponsor') ?? '').trim();
}

export const FAVORITES_STORAGE_KEY = 'inspire_favorites_fp';

function normalizeFavoritePart(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function hashFavoriteFingerprint(segments) {
  const str = segments.join('\u0000');
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function favoriteKeyOf(uc) {
  if (!uc || typeof uc !== 'object') return '';
  const domain = normalizeFavoritePart(uc._domain || uc['Business Domain'] || '');
  const sub = normalizeFavoritePart(uc.Subdomain || '');
  const name = normalizeFavoritePart(uc.original_name || uc.Name || uc.use_case || uc.short_name || uc.name || '');
  const stmt = normalizeFavoritePart((uc.Statement || uc.description || '').slice(0, 220));
  const sql = normalizeFavoritePart((uc.SQL || uc.sql || uc.sql_query || '').slice(0, 120));
  const sig = name || stmt || sql;
  if (!sig) return '';
  const h = hashFavoriteFingerprint([domain, sub, name, stmt, sql]);
  return `fp:${h}`;
}

export function favoriteCount(map) {
  return Object.keys(map || {}).filter((k) => map[k]).length;
}

export function loadFavoritesMap(storage = globalThis.localStorage) {
  try {
    const rawFp = storage.getItem(FAVORITES_STORAGE_KEY);
    if (rawFp) {
      const o = JSON.parse(rawFp);
      return o && typeof o === 'object' ? o : {};
    }
    const rawLegacy = JSON.parse(storage.getItem('inspire_favorites') || '{}');
    const migrated = {};
    if (rawLegacy && typeof rawLegacy === 'object') {
      for (const [k, v] of Object.entries(rawLegacy)) {
        if (v && String(k).startsWith('fp:')) migrated[k] = true;
      }
    }
    return migrated;
  } catch {
    return {};
  }
}

export function priorityPillClass(priority) {
  const p = String(priority || '').toLowerCase();
  if (p.includes('ultra high') || p.includes('very high')) return 'text-db-red-fg bg-db-red-50 border-db-red/20';
  if (p.includes('high')) return 'text-error-fg bg-error-bg border-error/20';
  if (p.includes('medium')) return 'text-warning-fg bg-warning-bg border-warning/20';
  return 'text-text-secondary bg-bg border-border';
}

export function subtitleOfUseCase(uc, titlePlain) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const plain = (v) => displayCleanText(String(v ?? '').replace(/<[^>]*>/g, ' '));
  const title = plain(titlePlain).toLowerCase();
  return [u.subtitle, u.description, u.Description, u.usecase, u.use_case, u.short_name, u.shortName]
    .map(plain)
    .find((t) => t && t.toLowerCase() !== title) || '';
}

// The stored name: the user's rename, else the catalogue name. Generated text is never a name.
export function storedNameOfUseCase(uc) {
  const u = uc && typeof uc === 'object' ? uc : {};
  return [u.user_use_case_name, u.Name, u.original_name, u.use_case, u.use_case_name, u.name, u.title]
    .map((v) => displayCleanText(v)).find(Boolean) || '';
}

// name_with_technique is a generated label from discovery. After a rename it still holds the old name, and a stale copy can
// hold the name twice (REQ-155). It is shown only when it is the stored name plus the technique: it starts with the stored
// name and the name appears once. Otherwise the card shows the stored name.
export function nameOfUseCase(uc) {
  const u = uc && typeof uc === 'object' ? uc : {};
  const stored = storedNameOfUseCase(u);
  const label = displayCleanText(u.name_with_technique);
  return stored && label.startsWith(stored) && label.indexOf(stored, stored.length) === -1 ? label : stored;
}

export function cardTitlesOfUseCase(uc, index = 0) {
  const title = nameOfUseCase(uc) || `Use Case ${index + 1}`;
  return { title, subtitle: subtitleOfUseCase(uc, title) };
}
