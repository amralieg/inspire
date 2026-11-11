const { parseExactJson } = require('./exactJson');
const { parseStrategicContext, validateStrategy } = require('../../frontend/src/lib/strategyContext.js');
const { scopesFromObject, serializeTableScopes, scopeKeyOf } = require('../../frontend/src/lib/tableScope.js');

const INSPIRE_AGENT_VERSION = 'v1.5.1';
const INSPIRE_ENVIRONMENT_KEY = 'Default';
const INSPIRE_ENVIRONMENT_VERSION = '4';

/** Notebook widget keys for dbx_inspire_ai_agent job base_parameters (v1.3.0). */
const INSPIRE_NOTEBOOK_WIDGET_KEYS = [
  '15_operation',
  '00_business_name',
  '01_uc_metadata',
  '02_inspire_database',
  '03_discovery_type',
  '04_table_election',
  '05_use_cases_quality',
  '06_business_domains',
  '07_business_priorities',
  '08_generation_instructions',
  '09_generation_options',
  '10_strategic_context',
  '11_generation_path',
  '12_documents_languages',
  '13_generate_genie_code_for',
  '14_session_id',
  '17_table_scope',
  '16_best_of_best_count',
  'inspire_implement_use_case',
  'inspire_implement_spec_version',
];

const IMPLEMENT_RUN_ID_PARAM = 'inspire_implement_run_id';
const IMPLEMENT_INSPIRE_CLIENT_PARAM = 'inspire_app_client_id';
const INSPIRE_JOB_ONLY_PARAM_KEYS = [IMPLEMENT_RUN_ID_PARAM, IMPLEMENT_INSPIRE_CLIENT_PARAM];
const INSPIRE_ASSETS_PARAM = 'inspire_assets_path';
const INSPIRE_TEST_TAG = 'dbx_inspire_ai_test';

const USE_CASES_QUALITY_VALID = ['Good', 'High', 'Ultra High'];
const USE_CASES_QUALITY_DEFAULT = 'Good';

const {
  DISCOVERY_TYPE_VALID,
  DISCOVERY_TYPE_DEFAULT,
  DISCOVERY_TYPE_ALIASES,
  discoveryTypeOf,
} = require('../../frontend/src/lib/discoveryType.js');

const GENIE_CODE_DEFAULT_COUNT = '0';

const STRATEGIC_CONTEXT_MAX_BYTES = 900000;

const BEST_OF_BEST_MAX_COUNT = 100;
const BEST_OF_BEST_DEFAULT_COUNT = 20;

/** Legacy widget labels → v1.2.0 canonical modes (matches notebook USE_CASES_QUALITY_ALIASES). */
const USE_CASES_QUALITY_ALIASES = {
  'Coverage Mode (All)': 'Good',
  Balanced: 'Good',
  'Good Quality': 'Good',
  'High Quality': 'Good',
  'Strict Quality': 'High',
  'Very High Quality': 'High',
  Good: 'Good',
  High: 'High',
  'Ultra High': 'Ultra High',
};

function paramError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeUseCasesQualityParams(params) {
  const uq = String(params['05_use_cases_quality'] || '').trim();
  if (!uq) {
    params['05_use_cases_quality'] = USE_CASES_QUALITY_DEFAULT;
    return params;
  }
  const folded = uq.toLowerCase();
  for (const mode of USE_CASES_QUALITY_VALID) {
    if (mode.toLowerCase() === folded) {
      params['05_use_cases_quality'] = mode;
      return params;
    }
  }
  for (const [legacy, mode] of Object.entries(USE_CASES_QUALITY_ALIASES)) {
    if (legacy.toLowerCase() === folded) {
      params['05_use_cases_quality'] = mode;
      return params;
    }
  }
  params['05_use_cases_quality'] = USE_CASES_QUALITY_DEFAULT;
  return params;
}

function normalizeDiscoveryTypeParams(params) {
  const raw = String(params['03_discovery_type'] ?? '').trim();
  if (!raw) {
    params['03_discovery_type'] = DISCOVERY_TYPE_DEFAULT;
    return params;
  }
  const mode = discoveryTypeOf(raw);
  if (!mode) {
    throw paramError(
      `Discovery Type "${raw}" is not supported. Valid options: ${DISCOVERY_TYPE_VALID.join(', ')}. ` +
        `Accepted legacy labels: ${Object.keys(DISCOVERY_TYPE_ALIASES).join(', ')}.`,
    );
  }
  params['03_discovery_type'] = mode;
  return params;
}

function validateStrategicContextParams(params) {
  const text = String(params['10_strategic_context'] ?? '').trim();
  const size = Buffer.byteLength(text, 'utf8');
  if (size > STRATEGIC_CONTEXT_MAX_BYTES) {
    throw paramError(
      `Strategic Context is ${size} bytes; the limit is ${STRATEGIC_CONTEXT_MAX_BYTES}. ` +
        'Store a larger strategy in a Workspace or Volumes file and pass its path instead.',
    );
  }
  const parsed = parseStrategicContext(text);
  if (parsed.error) {
    throw paramError('Strategic Context must be a strategy object or the path of a Workspace or Volumes file that holds one.');
  }
  const problems = parsed.mode === 'tree' ? validateStrategy(parsed.model) : [];
  if (problems.length) throw paramError(`Strategic Context: ${problems.join(' ')}`);
  params['10_strategic_context'] = text;
  return params;
}

function validateBestOfBestCountParams(params) {
  const text = String(params['16_best_of_best_count'] ?? '').trim();
  if (text && (!/^\d{1,3}$/.test(text) || Number(text) > BEST_OF_BEST_MAX_COUNT)) {
    throw paramError(
      `Best of Best Count "${text}" is not supported. Use a whole number from 0 to ${BEST_OF_BEST_MAX_COUNT}, ` +
        `or leave it empty for ${BEST_OF_BEST_DEFAULT_COUNT}.`,
    );
  }
  params['16_best_of_best_count'] = text;
  return params;
}

function parseTableScopeText(text) {
  const source = String(text ?? '').trim();
  if (!source) return { scopes: {}, problems: [] };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { scopes: {}, problems: ['The table scope is not valid JSON.'] };
  }
  return scopesFromObject(parsed);
}

function validateTableScopeParams(params) {
  const { scopes, problems } = parseTableScopeText(params['17_table_scope']);
  if (problems.length) throw paramError(`Table scope: ${problems.join(' ')}`);
  const uncovered = Object.keys(scopes).filter((table) => !tableIsPicked(table, params['01_uc_metadata']));
  if (uncovered.length) {
    throw paramError(`Table scope names ${uncovered.join(', ')}, which ${uncovered.length === 1 ? 'is' : 'are'} not picked under Unity Catalog Metadata.`);
  }
  const text = serializeTableScopes(scopes, Object.keys(scopes));
  if (text) params['17_table_scope'] = text;
  else delete params['17_table_scope'];
  return params;
}

function tableIsPicked(table, metadata) {
  const picked = new Set(String(metadata || '').split(',').map(scopeKeyOf).filter(Boolean));
  const parts = scopeKeyOf(table).split('.');
  return [parts.join('.'), parts.slice(0, 2).join('.'), parts[0]].some((name) => picked.has(name));
}

function normalizeGenerationOptionsParams(params) {
  const allowed = new Set(['PDF Catalog', 'Presentation']);
  const normalized = String(params['09_generation_options'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.has(value));
  params['09_generation_options'] = [...new Set(normalized)].join(',') || 'PDF Catalog';
  return params;
}

const DEFAULT_GENERATION_PATH = './../demos/';

function sanitizeInspireNotebookJobParams(params) {
  normalizeGenerationOptionsParams(params);
  normalizeUseCasesQualityParams(params);
  normalizeDiscoveryTypeParams(params);
  validateStrategicContextParams(params);
  validateBestOfBestCountParams(params);
  validateTableScopeParams(params);
  const out = {};
  for (const k of [...INSPIRE_NOTEBOOK_WIDGET_KEYS, ...INSPIRE_JOB_ONLY_PARAM_KEYS]) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    const v = params[k];
    if (v == null) continue;
    out[k] = String(v);
  }
  if (!out['13_generate_genie_code_for']) out['13_generate_genie_code_for'] = GENIE_CODE_DEFAULT_COUNT;
  delete out.discover_auto_genie_top_n;
  return withInspireInstallParams(out);
}

function inspireTestTag() {
  return inspireTagValue(String(process.env.INSPIRE_TEST_TAG || '').trim());
}

function withInspireInstallParams(params) {
  delete params[INSPIRE_ASSETS_PARAM];
  delete params[INSPIRE_TEST_TAG];
  const assets = String(process.env.INSPIRE_ASSETS_PATH || '').trim();
  if (assets) params[INSPIRE_ASSETS_PARAM] = assets;
  const test = inspireTestTag();
  if (test) params[INSPIRE_TEST_TAG] = test;
  return params;
}

/** Static + task-value parameters for demo pipeline task 2 (Inspire discovery). */
function buildDemoInspireDiscoveryParams({ inspireDatabase, sessionId, generateTaskKey = 'generate_demo_data', discoveryType = DISCOVERY_TYPE_DEFAULT, generationPath = '' }) {
  const tk = generateTaskKey;
  const raw = {
    '15_operation': 'Discover Use Cases',
    '00_business_name': `{{tasks.${tk}.values.display_name}}`,
    '01_uc_metadata': `{{tasks.${tk}.values.uc_metadata}}`,
    '02_inspire_database': inspireDatabase,
    '03_discovery_type': discoveryType || DISCOVERY_TYPE_DEFAULT,
    '04_table_election': 'All Tables',
    '05_use_cases_quality': USE_CASES_QUALITY_DEFAULT,
    '06_business_domains': '',
    '07_business_priorities': 'Increase Revenue',
    '08_generation_instructions': `{{tasks.${tk}.values.user_description}}`,
    '09_generation_options': 'PDF Catalog',
    '10_strategic_context': '',
    '11_generation_path': String(generationPath || '').trim() || DEFAULT_GENERATION_PATH,
    '12_documents_languages': 'English',
    '13_generate_genie_code_for': GENIE_CODE_DEFAULT_COUNT,
    '14_session_id': sessionId,
  };
  return sanitizeInspireNotebookJobParams(raw);
}

const INSPIRE_TAG_VALUE_MAX = 255;
const INSPIRE_GCP_TAG_VALUE_MAX = 63;

function inspireTagValueMax(host = process.env.DATABRICKS_HOST) {
  return /\.gcp\./i.test(String(host || '')) ? INSPIRE_GCP_TAG_VALUE_MAX : INSPIRE_TAG_VALUE_MAX;
}
const TAG_LIST_SEP = ' ';
const TAG_ITEM_BAD = /[^A-Za-z0-9+=.:/@_-]/g;
const RESOURCE_TAG_RULES = {
  job: { keyBad: /[^A-Za-z0-9._-]/g, keyMax: 127, value: /^[\d \w+\-=.:/@]*$/, valueBad: /[^A-Za-z0-9 +=.:/@_-]/g, get valueMax() { return inspireTagValueMax(); } },
  uc: { keyBad: /[^A-Za-z0-9_]/g, keyMax: 256, value: /^[\s\S]*$/, valueBad: null, valueMax: 256 },
};

function resourceTagRule(kind) {
  if (!Object.hasOwn(RESOURCE_TAG_RULES, kind)) throw new Error(`no tag rule for resource kind ${kind}`);
  return RESOURCE_TAG_RULES[kind];
}

function cleanTag(value, bad, max) {
  return String(value ?? '').replace(bad, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, max);
}

function resourceTagKey(kind, key) {
  const rule = resourceTagRule(kind);
  return cleanTag(key, rule.keyBad, rule.keyMax);
}

function resourceTagValue(kind, value) {
  const rule = resourceTagRule(kind);
  const text = String(value ?? '');
  if (text.length <= rule.valueMax && text === text.trim() && rule.value.test(text)) return text;
  const cleaned = rule.valueBad ? cleanTag(text, rule.valueBad, rule.valueMax) : text;
  return cleaned.trim().slice(0, rule.valueMax).trim();
}

function inspireTagList(items) {
  let joined = '';
  const max = inspireTagValueMax();
  for (const item of new Set(items.map((item) => cleanTag(item, TAG_ITEM_BAD, max)).filter(Boolean))) {
    const next = joined ? `${joined}${TAG_LIST_SEP}${item}` : item;
    if (next.length > max) break;
    joined = next;
  }
  return joined;
}

function inspireTagListItems(value, legacySep = '') {
  const items = String(value ?? '').split(/\s+/).filter(Boolean);
  return legacySep ? items.flatMap((item) => item.split(legacySep)).filter(Boolean) : items;
}

function inspireTagValue(value) {
  return cleanTag(value, /[^A-Za-z0-9._-]/g, inspireTagValueMax());
}

function inspireJobTags({ runType, params = {}, businessName = '', notebookFilename = '', useCaseIds = [] }) {
  const sessionId = inspireTagValue(params['14_session_id']);
  const ids = [...new Set(useCaseIds.map(inspireTagValue).filter(Boolean))];
  const specVersion = inspireTagValue(params.inspire_implement_spec_version);
  const tags = {
    inspire_version: INSPIRE_AGENT_VERSION,
    dbx_inspire_ai_version: INSPIRE_AGENT_VERSION,
    dbx_inspire_ai_business: inspireTagValue(businessName),
    dbx_inspire_ai_type: runType,
    dbx_inspire_ai_run_type: runType,
    dbx_inspire_ai_usecases: String(ids.length),
    dbx_inspire_ai_notebook: inspireTagValue(notebookFilename),
    dbx_inspire_ai_launcher_source: inspireTagValue('Inspire App'),
  };
  if (sessionId) {
    tags.dbx_inspire_ai_session = sessionId;
    tags.dbx_inspire_ai_session_id = sessionId;
  }
  if (ids.length) tags.dbx_inspire_ai_usecase_id = inspireTagList(ids);
  if (specVersion) tags.dbx_inspire_ai_spec_version = specVersion;
  const test = inspireTestTag();
  if (test) tags[INSPIRE_TEST_TAG] = test;
  return resourceTags('job', tags);
}

function resourceTags(kind, tags) {
  return Object.fromEntries(Object.entries(tags).map(([key, value]) => [resourceTagKey(kind, key), resourceTagValue(kind, value)]));
}

function inspireTaskCompute(clusterId) {
  return clusterId
    ? { existing_cluster_id: clusterId }
    : { environment_key: INSPIRE_ENVIRONMENT_KEY, disable_auto_optimization: true };
}

function inspireJobEnvironments(clusterId) {
  return clusterId
    ? {}
    : { environments: [{ environment_key: INSPIRE_ENVIRONMENT_KEY, spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION } }] };
}

function inspireJobEnvironmentChange(settings) {
  const current = Array.isArray(settings && settings.environments) ? settings.environments : [];
  const environments = current.map((environment) => {
    const spec = { ...(environment && environment.spec), environment_version: INSPIRE_ENVIRONMENT_VERSION };
    delete spec.client;
    return { ...environment, spec };
  });
  if (JSON.stringify(environments) === JSON.stringify(current)) return null;
  const versions = current.map((environment) => {
    const spec = (environment && environment.spec) || {};
    return String(spec.environment_version || spec.client || 'with no version');
  });
  return { environments, from: [...new Set(versions)].join(', ') };
}

function inspireJobEnvironmentWarning(jobId, { from = '', reason }) {
  const need = `In a workspace with no internet the run needs serverless environment ${INSPIRE_ENVIRONMENT_VERSION}, `
    + 'because the packages Inspire installs offline are built for it.';
  return from
    ? `Inspire could not move job ${jobId} from serverless environment ${from} to environment ${INSPIRE_ENVIRONMENT_VERSION} `
      + `(${reason}), so this run uses environment ${from}. ${need}`
    : `Inspire could not read job ${jobId} to check its serverless environment (${reason}), `
      + `so this run uses the environment the job already has. ${need}`;
}

function inspireJobTestTagChange(settings) {
  const current = settings && settings.tags && typeof settings.tags === 'object' ? settings.tags : {};
  const tags = { ...current };
  delete tags[INSPIRE_TEST_TAG];
  const test = resourceTagValue('job', inspireTestTag());
  if (test) tags[INSPIRE_TEST_TAG] = test;
  return current[INSPIRE_TEST_TAG] === tags[INSPIRE_TEST_TAG] ? null : { tags, from: current[INSPIRE_TEST_TAG] || '', to: test };
}

function inspireJobTestTagWarning(jobId, { from = '', to = '', reason }) {
  return to
    ? `Inspire could not tag job ${jobId} with ${INSPIRE_TEST_TAG}=${to} (${reason}), so usage reports may count this test run.`
    : `Inspire could not remove the tag ${INSPIRE_TEST_TAG}=${from} from job ${jobId} (${reason}), so usage reports may leave this run out.`;
}

function parseMaybeJson(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  try {
    return parseExactJson(t);
  } catch {
    return null;
  }
}

/** True when a use case shipped as a valid below-bar fallback (not an empty result). */
function belowBarLabelFromUseCase(uc) {
  if (!uc || typeof uc !== 'object') return '';
  const flags = parseMaybeJson(uc.selection_flags) || parseMaybeJson(uc.selectionFlags);
  if (flags && typeof flags === 'object') {
    for (const key of ['elite_fallback_pick', 'elite_fallback_near_miss', 'elite_coverage_pick', 'label', 'reason']) {
      const v = flags[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    for (const v of Object.values(flags)) {
      if (typeof v === 'string' && /below the /i.test(v)) return v.trim();
    }
  }
  const reason = uc.selection_drop_reason || uc.selectionDropReason;
  if (reason && /below the /i.test(String(reason))) return String(reason).trim();
  return '';
}

const V130_JSON_FIELDS = ['strategy_alignment', 'kpis', 'expected_key_results', 'data_evidence', 'value_estimate'];
const V130_LINE_FIELDS = ['measures_of_success', 'financial_benefits', 'non_financial_benefits'];
const KIND_TEXT_FIELDS = ['use_case_kind', 'kind_family', 'app_layout', 'serving_summary', 'method_summary', 'value_source',
  'selection_basis', 'selection_replaced', 'name_with_technique', 'suggested_group_by', 'record_level', 'value_estimate_text'];

function splitText(value, separator) {
  if (value == null || value === '') return [];
  return String(value)
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeV130UseCaseFields(row) {
  for (const field of V130_JSON_FIELDS) row[field] = parseMaybeJson(row[field]);
  for (const field of V130_LINE_FIELDS) row[field] = splitText(row[field], '\n');
  row.foundation_ids = splitText(row.foundation_ids, ',');
  row.strategy_path = row.strategy_path == null || row.strategy_path === '' ? null : String(row.strategy_path);
  row.use_case_key = row.use_case_key == null || row.use_case_key === '' ? null : String(row.use_case_key);
  const flag = String(row.best_of_best ?? '').trim().toUpperCase();
  row.best_of_best = flag === 'Y' || flag === 'N' ? flag : null;
  const rank = Number.parseInt(String(row.best_of_best_rank ?? ''), 10);
  row.best_of_best_rank = row.best_of_best === 'Y' && Number.isFinite(rank) ? rank : null;
  const score = Number.parseFloat(String(row.best_of_best_score ?? ''));
  row.best_of_best_score = Number.isFinite(score) ? score : null;
  row.best_of_best_reason = row.best_of_best_reason == null || row.best_of_best_reason === '' ? null : String(row.best_of_best_reason);
  for (const field of KIND_TEXT_FIELDS) row[field] = row[field] == null || String(row[field]).trim() === '' ? null : String(row[field]).trim();
  const gap = Number.parseFloat(String(row.selection_score_gap ?? ''));
  row.selection_score_gap = Number.isFinite(gap) ? gap : null;
  return row;
}

module.exports = {
  INSPIRE_AGENT_VERSION,
  parseTableScopeText,
  INSPIRE_ENVIRONMENT_VERSION,
  INSPIRE_NOTEBOOK_WIDGET_KEYS,
  IMPLEMENT_RUN_ID_PARAM,
  INSPIRE_JOB_ONLY_PARAM_KEYS,
  INSPIRE_ASSETS_PARAM,
  USE_CASES_QUALITY_VALID,
  USE_CASES_QUALITY_DEFAULT,
  USE_CASES_QUALITY_ALIASES,
  DISCOVERY_TYPE_VALID,
  DISCOVERY_TYPE_DEFAULT,
  DISCOVERY_TYPE_ALIASES,
  GENIE_CODE_DEFAULT_COUNT,
  STRATEGIC_CONTEXT_MAX_BYTES,
  BEST_OF_BEST_MAX_COUNT,
  BEST_OF_BEST_DEFAULT_COUNT,
  DEFAULT_GENERATION_PATH,
  buildDemoInspireDiscoveryParams,
  inspireTagValue,
  inspireTagValueMax,
  inspireTagList,
  inspireTagListItems,
  resourceTagKey,
  resourceTagValue,
  RESOURCE_TAG_RULES,
  TAG_LIST_SEP,
  inspireJobTags,
  withInspireInstallParams,
  INSPIRE_TEST_TAG,
  inspireJobEnvironmentChange,
  inspireJobEnvironmentWarning,
  inspireJobTestTagChange,
  inspireJobTestTagWarning,
  inspireJobEnvironments,
  inspireTaskCompute,
  sanitizeInspireNotebookJobParams,
  normalizeGenerationOptionsParams,
  normalizeUseCasesQualityParams,
  normalizeDiscoveryTypeParams,
  validateStrategicContextParams,
  validateBestOfBestCountParams,
  validateTableScopeParams,
  parseMaybeJson,
  belowBarLabelFromUseCase,
  V130_JSON_FIELDS,
  V130_LINE_FIELDS,
  normalizeV130UseCaseFields,
};
