// REQ-585 8: one warning per picked catalog or schema whose name looks dev. The pick is kept; the warning only advises production data.
import { devWarningText, looksDev } from '../../lib/devNames';

export default function DevWarnings({ picks }) {
  const dev = picks.filter((p) => looksDev(p.name));
  if (!dev.length) return null;
  return (
    <ul className="space-y-1">
      {dev.map((p) => (
        <li key={`${p.kind}:${p.name}`} data-wiz-dev-warning="" role="status" className="text-sm text-warning-fg">{devWarningText(p.kind, p.name)}</li>
      ))}
    </ul>
  );
}

// The catalogs and schemas named in a 01_uc_metadata value (comma separated catalog, catalog.schema or catalog.schema.table; a path names none).
export function scopePicks(scope) {
  const text = String(scope || '').trim();
  if (!text || text.startsWith('/')) return [];
  const picks = [];
  for (const piece of text.split(',')) {
    const name = piece.trim();
    const dots = name.split('.').length - 1;
    if (name && dots < 2) picks.push({ kind: dots === 0 ? 'catalog' : 'schema', name });
  }
  return picks;
}
