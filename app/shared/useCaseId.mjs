// REQ-569: the one place that knows the two use case id forms. New runs write AIx-UCx; sessions saved before wrote Nx-Ux and
// their tables are never rewritten, so every printer shows the new form (displayId) and every lookup accepts both (storedForms,
// sameUseCaseId, pickStoredId). Shared by the Inspire frontend and the backend (the backend requires it, esbuild bundles it).
// The Python agent keeps the same three rules in inspire_use_case_id / inspire_display_use_case_id / inspire_parse_use_case_id.
const OLD_FORM = /^N(\d+)-U(\d+)$/;
const NEW_FORM = /^AI(\d+)-UC(\d+)$/;
const OLD_IN_TEXT = /\bN(\d+)-U(\d+)\b/g;

const text = (value) => String(value ?? '').trim();

// Build the id of use case `index` in domain `domain`; width keeps the zero padding (default two digits).
export function buildUseCaseId(domain, index, width = 2) {
  const pad = (n) => String(n).padStart(width, '0');
  return `AI${pad(domain)}-UC${pad(index)}`;
}

// { domain, index } for either form; null for anything else.
export function parseUseCaseId(value) {
  const id = text(value);
  const m = OLD_FORM.exec(id) || NEW_FORM.exec(id);
  return m ? { domain: Number(m[1]), index: Number(m[2]) } : null;
}

// What a person reads: N01-U02 prints AI01-UC02 (padding kept); the new form and any other text pass through.
export function displayId(value) {
  const id = text(value);
  const m = OLD_FORM.exec(id);
  return m ? `AI${m[1]}-UC${m[2]}` : id;
}

// Every old id inside a sentence, rewritten.
export function displayText(value) {
  return String(value ?? '').replace(OLD_IN_TEXT, (_, d, u) => `AI${d}-UC${u}`);
}

function oldForm(value) {
  const m = NEW_FORM.exec(text(value));
  return m ? `N${m[1]}-U${m[2]}` : '';
}

// The forms a saved row may hold the id in: the asked form first, then the other one.
export function storedForms(value) {
  const id = text(value);
  const other = OLD_FORM.test(id) ? displayId(id) : oldForm(id);
  return other ? [id, other] : [id];
}

export function sameUseCaseId(a, b) {
  const x = text(a);
  const y = text(b);
  return x === y || displayId(x) === displayId(y);
}

// The id a table holds for the asked one (either form), or null when none matches.
export function pickStoredId(asked, stored) {
  const list = Array.isArray(stored) ? stored.map(text) : [];
  return list.find((id) => id === text(asked)) || list.find((id) => sameUseCaseId(id, asked)) || null;
}
