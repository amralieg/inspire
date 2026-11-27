import JSZip from 'jszip';
import { EXCEL_OLD_FORMAT, EXCEL_UNREADABLE, fileExtension, sheetPreview } from './artifactFiles';

// C25 (REQ-559): what "View" shows for a file, read in the browser from the bytes the App already fetches.
// PDF: a blob URL for an iframe. PPTX: one entry per slide (its text lines, and its picture when the slide carries one).
// XLSX: the first sheet as a table. DOCX: its paragraphs. Anything else: not viewable here (Download stays).
export const VIEWABLE = ['pdf', 'pptx', 'xlsx', 'docx'];
export const isViewable = (file) => VIEWABLE.includes(fileExtension(file));

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => entities[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const textsOf = (xml) => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
const number = (path) => Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

export async function slidesOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => number(a) - number(b));
  const slides = [];
  for (const path of paths) {
    const lines = textsOf(await zip.file(path).async('string')).map((t) => t.trim()).filter(Boolean);
    let image = null;
    const rels = zip.file(path.replace('slides/', 'slides/_rels/') + '.rels');
    const target = rels ? (await rels.async('string')).match(/Target="([^"]*\.(?:png|jpe?g|gif|svg))"/i)?.[1] : null;
    const media = target ? zip.file(`ppt/${target.replace(/^(\.\.\/)+/, '')}`) : null;
    if (media) image = URL.createObjectURL(new Blob([await media.async('uint8array')], { type: MIME[target.split('.').pop().toLowerCase()] || 'image/png' }));
    slides.push({ title: lines[0] || `Slide ${slides.length + 1}`, lines: lines.slice(1), image });
  }
  return slides;
}

export async function paragraphsOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return xml.split(/<\/w:p>/).map((p) => unescapeXml([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).trim()).filter(Boolean);
}

/** The view of one file, as data the DocViewer draws: { type: 'pdf'|'slides'|'text'|'csv'|'error', ... }. */
export async function viewOf(name, blob) {
  const ext = fileExtension({ name });
  try {
    if (ext === 'pdf') return { type: 'pdf', url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })) };
    const buffer = await blob.arrayBuffer();
    if (ext === 'pptx') return { type: 'slides', slides: await slidesOf(buffer) };
    if (ext === 'docx') return { type: 'text', paragraphs: await paragraphsOf(buffer) };
    if (ext === 'xlsx') {
      const { readSheet } = await import('read-excel-file/browser');
      return { type: 'csv', ...sheetPreview(await readSheet(buffer)) };
    }
    if (ext === 'xls') return { type: 'error', message: EXCEL_OLD_FORMAT };
  } catch {
    return { type: 'error', message: ext === 'xlsx' ? EXCEL_UNREADABLE : `Inspire could not read ${name}. Download it instead.` };
  }
  return { type: 'error', message: `Inspire cannot show ${name} here. Download it instead.` };
}
