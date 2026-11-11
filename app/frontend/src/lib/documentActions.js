import { generationFolder } from './workspaceLinks.js';

export const DOCUMENT_ACTIONS = {
  'strategy-document': { label: 'Create strategy document', formats: ['PDF', 'PPTX'] },
  'use-case-catalog': { label: 'Create use case catalog', formats: [] },
  'excel-workbook': { label: 'Create Excel workbook', formats: [] },
};

/** The session folder Discover wrote into, resolved but without the business folder: the document job adds that itself. */
export function documentBasePath({ generationPath, notebookPath }) {
  return generationFolder({ generationPath, notebookPath, businessName: '' });
}

export function documentRunBody({ kind, format = '', sessionId, inspireDatabase, businessName, generationPath, outputLanguage = '' }) {
  return {
    kind,
    ...(format ? { format } : {}),
    session_id: String(sessionId || ''),
    inspire_database: String(inspireDatabase || ''),
    business_name: String(businessName || ''),
    generation_path: String(generationPath || ''),
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
