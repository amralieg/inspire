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

// The file from its objects (each an array of strings or bytes): header, objects, cross-reference table, trailer. Object 1 is the catalog.
function assemble(objs) {
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
  return assemble(objs);
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

// ---- C33 (REQ-560, D5): a PDF page held as vectors, from the operations pdfLayout.domLayout reads: shapes as paths, text as real text ----
const FONTS = [['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'], ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic']];
const CP1252 = { '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84, '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88, '\u2030': 0x89, '\u0160': 0x8A, '\u2039': 0x8B, '\u0152': 0x8C, '\u017D': 0x8E, '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93, '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97, '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9A, '\u203A': 0x9B, '\u0153': 0x9C, '\u017E': 0x9E, '\u0178': 0x9F };
const SUBSTITUTES = { '\u2192': '->', '\u2190': '<-', '\u2265': '>=', '\u2264': '<=', '\u2212': '-', '\u2009': ' ', '\u202F': ' ', '\u2007': ' ', '\u2002': ' ', '\u2003': ' ', '\u2713': 'v', '\u2714': 'v', '\u25CF': '\u2022', '\u00B7': '\u00B7' };
// A text as a PDF string in WinAnsi (the encoding of the 14 standard fonts). A letter it has no code for is written "?" and counted in lost.
export function winAnsi(text) {
  let out = ''; let lost = 0;
  for (const ch of String(text).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')) {
    const sub = SUBSTITUTES[ch] ?? ch;
    for (const c of sub) {
      const code = CP1252[c] ?? c.codePointAt(0);
      const ok = code >= 0x20 && code <= 0xFF && !(code >= 0x7F && code <= 0x9F && !Object.values(CP1252).includes(code));
      const b = ok ? code : 0x3F;
      if (!ok) lost += 1;
      out += b === 0x28 || b === 0x29 || b === 0x5C ? `\\${String.fromCharCode(b)}` : (b < 0x7F ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`);
    }
  }
  return { text: out, lost };
}

const num = (n) => +Number(n).toFixed(2);
const col = (c) => `${num(c.r / 255)} ${num(c.g / 255)} ${num(c.b / 255)}`;
function pathOf({ x, y, w, h, r }) {
  if (!(r > 0.5)) return `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`;
  const k = r * 0.5523;
  const [x2, y2] = [x + w, y + h];
  return `${num(x + r)} ${num(y)} m ${num(x2 - r)} ${num(y)} l ${num(x2 - r + k)} ${num(y)} ${num(x2)} ${num(y + r - k)} ${num(x2)} ${num(y + r)} c ${num(x2)} ${num(y2 - r)} l `
    + `${num(x2)} ${num(y2 - r + k)} ${num(x2 - r + k)} ${num(y2)} ${num(x2 - r)} ${num(y2)} c ${num(x + r)} ${num(y2)} l ${num(x + r - k)} ${num(y2)} ${num(x)} ${num(y2 - r + k)} ${num(x)} ${num(y2 - r)} c `
    + `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`;
}
const deflate = async (text) => {
  const stream = new Blob([enc.encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

// pages: [{ w, h, ops }] in CSS px, y down; an image op carries `image: { dataUrl, type, width, height }` (a JPEG or an indexed PNG, as rasterPage makes them).
// A text op's `natural` is the width in px the PDF's standard font gives it (the browser measured it), used to set the horizontal scale so the line is as wide as the browser laid it.
// Returns { bytes, lost } where lost is the number of letters the standard fonts have no code for.
export async function pdfFromVectorPages(pages) {
  const pt = (px) => +(px * 0.75).toFixed(2);
  const objs = [];
  const add = (...parts) => { objs.push(parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p))); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const fontIds = FONTS.map((fam) => fam.map((name) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)));
  const fontRes = fontIds.flat().map((id, i) => `/F${i} ${id} 0 R`).join(' ');
  const kids = []; let lost = 0;
  for (const page of pages) {
    const alphas = new Map(); const xobjs = [];
    const gs = (a) => { if (a >= 0.999) return ''; const k = num(a); if (!alphas.has(k)) alphas.set(k, alphas.size); return `/G${alphas.get(k)} gs `; };
    let c = `0.75 0 0 -0.75 0 ${pt(page.h)} cm\n`;
    for (const op of page.ops) {
      if (op.t === 'rect') {
        if (op.fill) c += `q ${gs(op.fill.a)}${col(op.fill)} rg ${pathOf(op)} f Q\n`;
        if (op.stroke) {
          const sw = op.stroke.w; const inset = { x: op.x + sw / 2, y: op.y + sw / 2, w: op.w - sw, h: op.h - sw, r: Math.max(0, op.r - sw / 2) };
          c += `q ${gs(op.stroke.color.a)}${col(op.stroke.color)} RG ${num(sw)} w ${pathOf(inset)} S Q\n`;
        }
      } else if (op.t === 'image' && op.image) {
        const img = op.image;
        const name = `I${xobjs.length}`;
        const jpeg = img.type === 'image/jpeg' ? fromUrl(img.dataUrl) : null;
        const png = jpeg ? null : indexedParts(fromUrl(img.dataUrl));
        if (!jpeg && !png) continue;
        const head = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height}`;
        const id = jpeg
          ? add(`${head} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream')
          : add(`${head} /ColorSpace [/Indexed /DeviceRGB ${png.plte.length / 3 - 1} <${hex(png.plte)}>] /BitsPerComponent ${png.bits} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent ${png.bits} /Columns ${img.width} >> /Length ${png.data.length} >>\nstream\n`, png.data, '\nendstream');
        xobjs.push(`/${name} ${id} 0 R`);
        c += `q ${num(op.w)} 0 0 ${num(-op.h)} ${num(op.x)} ${num(op.y + op.h)} cm /${name} Do Q\n`;
      } else if (op.t === 'text') {
        const s = winAnsi(op.text); lost += s.lost;
        if (!s.text.trim()) continue;
        const font = (op.serif ? 4 : 0) + (op.bold ? 1 : 0) + (op.italic ? 2 : 0);
        const tz = op.natural > 0 ? Math.min(200, Math.max(40, (op.width / op.natural) * 100)) : 100;
        c += `q ${gs(op.color.a)}${col(op.color)} rg BT /F${font} ${num(op.size)} Tf ${num(tz)} Tz ${num(op.spacing || 0)} Tc 1 0 0 -1 ${num(op.x)} ${num(op.y)} Tm (${s.text}) Tj ET Q\n`;
      }
    }
    const body = await deflate(c);
    const content = add(`<< /Filter /FlateDecode /Length ${body.length} >>\nstream\n`, body, '\nendstream');
    const states = [...alphas].map(([a, i]) => `/G${i} << /ca ${a} /CA ${a} >>`).join(' ');
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(page.w)} ${pt(page.h)}] /Contents ${content} 0 R /Resources << /Font << ${fontRes} >> /XObject << ${xobjs.join(' ')} >> /ExtGState << ${states} >> >> >>`));
  }
  objs[1] = [enc.encode(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`)];
  return { bytes: assemble(objs), lost };
}
