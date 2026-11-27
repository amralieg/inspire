// REQ-569 part 2: a session saved before REQ-569 holds its use case ids as Nx-Ux, a new one as AIx-UCx, and saved tables are never
// rewritten. A single-use-case read runs with the asked id first, unchanged; only when that finds nothing does it run once more with
// the other form. Writes name the row by the id the found rows hold (savedIdOf), so they land on the saved row.
const { storedForms, sameUseCaseId } = require('../../shared/useCaseId.mjs');

// null (a table that does not exist yet) or a non-empty list is an answer; only an empty list tries the other form.
const hasRows = (rows) => !Array.isArray(rows) || rows.length > 0;

// { rows, id }: the rows of read(id) and the id form that found them (the asked id when neither form finds a row).
async function eitherIdFound(useCaseId, read, found = hasRows) {
  const [asked, other] = storedForms(useCaseId);
  const rows = await read(asked);
  if (!other || found(rows)) return { rows, id: asked };
  const again = await read(other);
  return found(again) ? { rows: again, id: other } : { rows, id: asked };
}

async function eitherIdRows(useCaseId, read, found = hasRows) {
  return (await eitherIdFound(useCaseId, read, found)).rows;
}

// The id the saved rows hold for the asked use case (either form), else the asked id.
function savedIdOf(rows, asked) {
  const held = (Array.isArray(rows) ? rows : []).map((r) => String((r && r.use_case_id) ?? '').trim()).find((id) => id && sameUseCaseId(id, asked));
  return held || asked;
}

module.exports = { eitherIdFound, eitherIdRows, savedIdOf };
