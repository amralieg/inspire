export const DEMO_GENERATED_TABLES = 5;
export const DEMO_KIND_SIGNAL_TABLES = 13;
const DEMO_SCHEMA_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function demoTablesPlanned(plantKindSignals = true) {
  return { generated: DEMO_GENERATED_TABLES, kind_signal: plantKindSignals ? DEMO_KIND_SIGNAL_TABLES : 0 };
}

export function demoTablesTotal(plantKindSignals = true) {
  const planned = demoTablesPlanned(plantKindSignals);
  return planned.generated + planned.kind_signal;
}

export function demoSchemaError(name) {
  const text = String(name ?? '').trim();
  if (!text) return '';
  if (text.toLowerCase() === 'information_schema') return 'information_schema is a system schema; choose another schema name';
  return DEMO_SCHEMA_RE.test(text) ? ''
    : 'The schema name takes letters, digits and underscores only, starts with a letter or an underscore, and is at most 128 characters';
}
