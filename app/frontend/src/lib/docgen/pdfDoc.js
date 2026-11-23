// FX-113 (REQ-503): one PDF page per image, page sized to the image aspect.
import { jsPDF } from 'jspdf';

export async function pdfFromImages(images) {
  let doc = null;
  for (const img of images) {
    const w = img.width; const h = img.height;
    const orientation = w > h ? 'l' : 'p';
    if (!doc) doc = new jsPDF({ unit: 'px', format: [w, h], orientation, compress: true, hotfixes: ['px_scaling'] });
    else doc.addPage([w, h], orientation);
    doc.addImage(img.dataUrl, 'PNG', 0, 0, w, h);
  }
  if (!doc) doc = new jsPDF();
  return new Uint8Array(doc.output('arraybuffer'));
}
