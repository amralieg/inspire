export const DOCUMENT_ACTIONS = {
  'strategy-document': { label: 'Create strategy document', formats: ['PDF', 'PPTX'] },
  'use-case-catalog': { label: 'Create use case catalog', formats: [] },
};

const ENGLISH_CATALOG = /-dbx_inspire\.json$/;

/** The English catalog JSON among the artifact files loaded so far, folders included; null when none is loaded. */
export function englishCatalogPath(files, tree = {}) {
  const queue = [...(Array.isArray(files) ? files : [])];
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (!file || seen.has(file.path)) continue;
    seen.add(file.path);
    if (file.is_directory) queue.push(...(tree?.[file.path]?.files || []));
    else if (ENGLISH_CATALOG.test(String(file.name || file.path || ''))) return file.path;
  }
  return null;
}

export function documentRunBody({ kind, format = '', sessionId, inspireDatabase, businessName, generationPath, catalogPath, outputLanguage = '' }) {
  return {
    kind,
    ...(format ? { format } : {}),
    session_id: String(sessionId || ''),
    inspire_database: String(inspireDatabase || ''),
    business_name: String(businessName || ''),
    generation_path: String(generationPath || ''),
    catalog_json_path: String(catalogPath || ''),
    output_language: String(outputLanguage || ''),
  };
}

/** `running` until the run ends, then `done` when it succeeded and `failed` when it did not. */
export function documentJobState(runState) {
  const life = runState?.life_cycle_state;
  if (life === 'TERMINATED') return runState?.result_state === 'SUCCESS' ? 'done' : 'failed';
  if (life === 'INTERNAL_ERROR' || life === 'SKIPPED') return 'failed';
  return 'running';
}
