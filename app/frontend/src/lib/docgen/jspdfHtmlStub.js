// FX-113: jspdf imports html2canvas and dompurify only for doc.html(), which Inspire never calls.
// vite.config.js aliases both here so the build ships neither chunk.
export default function jspdfHtmlStub() {
  throw new Error('jspdf html() is not bundled in Inspire; pdfDoc.js builds pages from images');
}
