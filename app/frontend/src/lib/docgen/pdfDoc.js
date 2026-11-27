// FX-113 (REQ-503): one PDF page per image, page sized to the image aspect.
// C28 (REQ-566): the pages are 16-colour indexed PNGs or JPEGs (pngIndexed.rasterPage). jsPDF re-filters every PNG it embeds and made the pages 25%
// bigger, so those two kinds are written straight into the PDF (the PNG's own compressed rows, nothing re-encoded). Any other image goes through jsPDF.
import { jsPDF } from 'jspdf';

const enc = new TextEncoder();
const fromUrl = (u) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));
const hex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// An indexed PNG to its pieces, or null when it is not one.
function indexedParts(bytes) {
  if (bytes[0] !== 137 || bytes[25] !== 3) return null; // color type 3 sits at byte 25 of every PNG
  const idat = []; let plte = null;
  for (let o = 8; o < bytes.length;) {
    const len = u32(bytes, o); const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]); const d = o + 8;
    if (type === 'PLTE') plte = bytes.subarray(d, d + len);
    if (type === 'IDAT') idat.push(bytes.subarray(d, d + len));
    o = d + len + 4;
  }
  const data = new Uint8Array(idat.reduce((a, c) => a + c.length, 0)); let at = 0; for (const c of idat) { data.set(c, at); at += c.length; }
  return { bits: bytes[24], plte, data };
}

function directPdf(images) {
  const pt = (px) => +(px * 0.75).toFixed(2);
  const objs = []; // each: array of Uint8Array pieces
  const add = (...parts) => { objs.push(parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p))); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`);
  images.forEach((img, i) => {
    const { w, h, kind } = img; const base = 3 + 3 * i;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(w)} ${pt(h)}] /Resources << /XObject << /I ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
    const content = `q ${pt(w)} 0 0 ${pt(h)} 0 0 cm /I Do Q`; add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const px = `<< /Type /XObject /Subtype /Image /Width ${img.px} /Height ${img.py}`;
    if (kind.jpeg) add(`${px} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${kind.jpeg.length} >>\nstream\n`, kind.jpeg, '\nendstream');
    else add(`${px} /ColorSpace [/Indexed /DeviceRGB ${kind.plte.length / 3 - 1} <${hex(kind.plte)}>] /BitsPerComponent ${kind.bits} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent ${kind.bits} /Columns ${img.px} >> /Length ${kind.data.length} >>\nstream\n`, kind.data, '\nendstream');
  });
  const out = [enc.encode('%PDF-1.4\n')]; const offs = []; let len = out[0].length;
  objs.forEach((parts, i) => {
    offs.push(len); const head = enc.encode(`${i + 1} 0 obj\n`); const tail = enc.encode('\nendobj\n');
    for (const p of [head, ...parts, tail]) { out.push(p); len += p.length; }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  out.push(enc.encode(xref));
  const all = new Uint8Array(out.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of out) { all.set(p, o); o += p.length; }
  return all;
}

// scale: raster pixels per page px (the page is placed at its natural size, so a raster drawn at scale 2 prints at twice the resolution).
export async function pdfFromImages(images, scale = 1) {
  const kinds = images.map((img) => {
    if (!img.dataUrl) return null;
    if (img.type === 'image/jpeg') return { jpeg: fromUrl(img.dataUrl) };
    return indexedParts(fromUrl(img.dataUrl));
  });
  if (images.length && kinds.every(Boolean)) {
    return directPdf(images.map((img, i) => ({ w: img.width / scale, h: img.height / scale, px: img.width, py: img.height, kind: kinds[i] })));
  }
  let doc = null;
  for (const img of images) {
    const w = img.width / scale; const h = img.height / scale;
    const orientation = w > h ? 'l' : 'p';
    if (!doc) doc = new jsPDF({ unit: 'px', format: [w, h], orientation, compress: true, hotfixes: ['px_scaling'] });
    else doc.addPage([w, h], orientation);
    doc.addImage(img.dataUrl, img.type === 'image/jpeg' ? 'JPEG' : 'PNG', 0, 0, w, h);
  }
  if (!doc) doc = new jsPDF();
  return new Uint8Array(doc.output('arraybuffer'));
}
