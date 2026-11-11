/** Document-only runs: rebuild a finished session's documents from its stored English catalog (docs-only mode). */

const DOCUMENT_KINDS = {
  'strategy-document': { formats: { PDF: 'PDF Catalog', PPTX: 'Presentation' } },
  'use-case-catalog': { fixed: 'PDF Catalog' },
  'excel-workbook': { fixed: 'Excel' },
};

const ENGLISH_CATALOG = /-dbx_inspire\.json$/;
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
  const catalog = String(body.catalog_json_path || '').trim();
  if (!catalog.startsWith('/')) throw refuse('catalog_json_path must be an absolute workspace path to the session catalog');
  if (!ENGLISH_CATALOG.test(catalog)) throw refuse('catalog_json_path must be the English catalog (…-dbx_inspire.json), the input every document is rebuilt from');
  const generationPath = String(body.generation_path || '').trim();
  if (!generationPath) throw refuse('generation_path is required: the documents are written beside the session');
  const inspireDatabase = String(body.inspire_database || '').trim();
  if (!inspireDatabase) throw refuse('inspire_database is required');
  const languages = languagesOf(body.output_language);
  const businessName = String(body.business_name || '').trim();
  if (!businessName) throw refuse('business_name is required');
  const params = {
    '15_operation': 'Discover Use Cases',
    '00_business_name': businessName,
    '01_uc_metadata': catalog,
    '02_inspire_database': inspireDatabase,
    '09_generation_options': option,
    '11_generation_path': generationPath,
    '12_documents_languages': languages.join(','),
    '14_session_id': sessionId,
  };
  return { params, document: { kind, option, session_id: sessionId, languages } };
}

module.exports = { documentRunParams, DOCUMENT_KINDS };
