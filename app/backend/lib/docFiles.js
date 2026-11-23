// FX-115 (REQ-503): the pure checks behind POST /api/inspire/docs/save. A document the Generate docs wizard made in the browser is saved only
// into the run's own generation path (or a folder under it), under a plain file name of a type the wizard makes, with the bytes of that type.
const DOC_MAX_BYTES = 8 * 1024 * 1024; // under the 10 MB the workspace import accepts
const MAGIC = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  pdf: Buffer.from('%PDF'),
  pptx: Buffer.from([0x50, 0x4b]),
  xlsx: Buffer.from([0x50, 0x4b]),
};

const problem = (status, error) => ({ status, error });

// '/a//b/./c/' -> '/a/b/c'; null when the path climbs with '..' or is not absolute.
function normalised(p) {
  const text = String(p == null ? '' : p).trim();
  if (!text.startsWith('/')) return null;
  const parts = [];
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function docFileProblem({ generationPath, folder, name, bytes }) {
  const gen = normalised(generationPath);
  if (!gen || gen === '/') return problem(400, 'This run has no generation path, so there is no Assets folder to save into.');
  const dir = normalised(folder);
  if (!dir) return problem(400, 'The folder must be an absolute path without "..".');
  if (dir !== gen && !dir.startsWith(`${gen}/`)) return problem(403, 'The folder is outside this run’s Assets folder.');
  const file = String(name == null ? '' : name);
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..') || file.startsWith('.')) return problem(400, 'The file name must be a plain name without folders.');
  const ext = (/\.([A-Za-z0-9]+)$/.exec(file) || [])[1];
  const kind = ext && ext.toLowerCase();
  if (!kind || !MAGIC[kind]) return problem(415, 'Only png, pdf, pptx and xlsx files can be saved.');
  if (!bytes || !bytes.length) return problem(400, 'The file is empty.');
  if (bytes.length > DOC_MAX_BYTES) return problem(413, `The file is over ${Math.floor(DOC_MAX_BYTES / (1024 * 1024))} MB, the most that can be saved.`);
  if (!bytes.subarray(0, MAGIC[kind].length).equals(MAGIC[kind])) return problem(415, `The bytes are not a ${kind} file.`);
  return null;
}

module.exports = { docFileProblem, DOC_MAX_BYTES, normalisedDocPath: normalised };
