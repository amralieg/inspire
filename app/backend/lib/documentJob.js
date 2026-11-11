/** Document-only runs: rebuild the picked documents of a finished session from its saved English catalog. */

const DOCUMENT_KINDS = {
  'strategy-document': { formats: { PDF: 'PDF Catalog', PPTX: 'Presentation' } },
  'use-case-catalog': { fixed: 'PDF Catalog' },
  'excel-workbook': { fixed: 'Excel' },
};

const DOCUMENT_LANGUAGES = ['English', 'French', 'German', 'Spanish', 'Hindi', 'Chinese (Mandarin)', 'Japanese', 'Arabic', 'Portuguese', 'Russian',
  'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Italian', 'Polish', 'Romanian', 'Ukrainian', 'Dutch', 'Korean', 'Indonesian', 'Malay', 'Tamil'];

function languagesOf(value) {
  const named = [...new Set(String(value || '').split(',').map((part) => part.trim()).filter(Boolean))];
  const unknown = named.filter((lang) => !DOCUMENT_LANGUAGES.includes(lang));
  if (unknown.length) throw refuse(`output_language ${unknown.join(', ')} is not a language Inspire writes documents in`);
  if (!named.length) return ['English'];
  return named.includes('English') ? ['English', ...named.filter((lang) => lang !== 'English')] : named;
}
const NUMERIC_ID = /^\d{1,19}$/;

function refuse(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function businessFolder(businessName) {
  const folder = String(businessName || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return folder || '_';
}

function englishCatalogPath(sessionFolder, businessName) {
  return `${sessionFolder.replace(/\/+$/, '')}/${businessFolder(businessName)}/docs/${businessName}-dbx_inspire.json`;
}

function documentRunParams(body) {
  const kind = String(body.kind || '').trim();
  const spec = DOCUMENT_KINDS[kind];
  if (!spec) throw refuse(`kind must be one of ${Object.keys(DOCUMENT_KINDS).join(', ')}`);
  let option = spec.fixed;
  if (spec.formats) {
    const format = String(body.format || '').trim().toUpperCase();
    if (!spec.formats[format]) throw refuse(`format must be one of ${Object.keys(spec.formats).join(', ')} for a strategy document`);
    option = spec.formats[format];
  }
  const sessionId = String(body.session_id || '').trim();
  if (!NUMERIC_ID.test(sessionId)) throw refuse('session_id must be a numeric Inspire session id');
  const sessionFolder = String(body.generation_path || '').trim();
  if (!sessionFolder) throw refuse('generation_path is required: the documents are written beside the session');
  if (!sessionFolder.startsWith('/')) throw refuse('generation_path must be the absolute session folder that Discover wrote the use cases into');
  const inspireDatabase = String(body.inspire_database || '').trim();
  if (!inspireDatabase) throw refuse('inspire_database is required');
  const languages = languagesOf(body.output_language);
  const businessName = String(body.business_name || '').trim();
  if (!businessName) throw refuse('business_name is required');
  const catalog = englishCatalogPath(sessionFolder, businessName);
  const params = {
    '15_operation': 'Discover Use Cases',
    '00_business_name': businessName,
    '01_uc_metadata': catalog,
    '02_inspire_database': inspireDatabase,
    '09_generation_options': option,
    '11_generation_path': sessionFolder,
    '12_documents_languages': languages.join(','),
    '14_session_id': sessionId,
  };
  return { params, document: { kind, option, session_id: sessionId, languages } };
}

module.exports = { documentRunParams, englishCatalogPath, DOCUMENT_KINDS };
