export const SAMPLE_CATALOG = 'samples';
export const SAMPLES_DESCRIPTIONS_SENTENCE = 'Value cannot be measured on samples, so this run reads only the table descriptions.';

const unique = (names) => [...new Set(names)];

export const isSampleEntry = (name) => String(name || '').trim().split('.')[0] === SAMPLE_CATALOG;

export const samplesTarget = (inspireDatabase, typed) => {
  if (typed != null && String(typed).trim() !== '') return String(typed).trim();
  const db = String(inspireDatabase || '').trim();
  return db && !isSampleEntry(db) ? db : '';
};

export const validCopyTarget = (text) => /^[^\s.`]+\.[^\s.`]+$/.test(String(text || '').trim()) && !isSampleEntry(text);

export function applySampleCopies(picks, { destination, copies, failed }) {
  const keep = (names) => names.filter((name) => !isSampleEntry(name));
  const catalogs = keep(picks.catalogs);
  const schemas = keep(picks.schemas);
  for (const { source } of failed) {
    const [catalog, schema] = source.split('.');
    catalogs.push(catalog);
    schemas.push(`${catalog}.${schema}`);
  }
  if (copies.length) {
    catalogs.push(destination.split('.')[0]);
    schemas.push(destination);
  }
  return {
    catalogs: unique(catalogs),
    schemas: unique(schemas),
    tables: unique([...keep(picks.tables), ...failed.map((f) => f.source), ...copies.map((c) => c.copy)]),
  };
}
