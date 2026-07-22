'use strict';
// Printable A4 template PDF. Everything prints in light grey so the adaptive
// threshold in capture.js erases it — only the user's pen ink survives.
// Cell order = charset order, so a filled template needs no recognition at all.
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { CHARSETS } = require('./charsets');

const GREY = '#c8c8c8';
const A4 = { w: 595.28, h: 841.89 };
const M = 40; // page margin
const COLS = 6;
const ROWS = 7;

function drawCell(doc, x, y, w, h, char) {
  doc.rect(x, y, w, h).lineWidth(0.8).stroke(GREY);
  // guides: cap line, x-height (dashed), baseline, sized like metrics.js bands
  const baseline = y + h * 0.78;
  const capLine = y + h * 0.18;
  const xLine = baseline - (baseline - capLine) * (480 / 700);
  doc.moveTo(x, baseline).lineTo(x + w, baseline).lineWidth(0.8).stroke(GREY);
  doc.dash(2, { space: 3 });
  doc.moveTo(x, xLine).lineTo(x + w, xLine).lineWidth(0.5).stroke(GREY);
  doc.moveTo(x, capLine).lineTo(x + w, capLine).lineWidth(0.5).stroke(GREY);
  doc.undash();
  doc.fontSize(9).fillColor(GREY).text(char, x + 3, y + 3, { lineBreak: false });
}

function generateTemplate(out, { charset = 'minimal' } = {}) {
  const chars = CHARSETS[charset];
  if (!chars) throw new Error(`Unknown charset "${charset}". Available: ${Object.keys(CHARSETS).join(', ')}`);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const stream = fs.createWriteStream(out);
  doc.pipe(stream);

  const headerH = 70;
  const gridW = A4.w - 2 * M;
  const gridH = A4.h - M - (M + headerH);
  const cw = gridW / COLS;
  const ch = gridH / ROWS;
  const perPage = COLS * ROWS;

  for (let page = 0; page * perPage < chars.length; page++) {
    if (page > 0) doc.addPage();
    doc.fontSize(14).fillColor('#999').text(`draw-your-font — page ${page + 1}`, M, M, { lineBreak: false });
    doc.fontSize(8).fillColor('#aaa').text(
      'Use a dark pen (0.5 mm or thicker). Write each character large, inside its box, sitting on the solid line. ' +
      'Lowercase body between the dashed lines. Then photograph each page from above in good light.',
      M, M + 22, { width: gridW }
    );
    const slice = chars.slice(page * perPage, (page + 1) * perPage);
    slice.forEach((c, i) => {
      const x = M + (i % COLS) * cw;
      const y = M + headerH + Math.floor(i / COLS) * ch;
      drawCell(doc, x, y, cw - 4, ch - 4, c);
    });
  }
  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(out));
    stream.on('error', reject);
  });
}

module.exports = { generateTemplate };
