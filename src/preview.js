'use strict';
// Render preview PNGs straight from the placed glyph vectors (no font
// rasterizer needed) so Claude - or the user - can judge the result.
const sharp = require('sharp');
const { UPM } = require('./metrics');

const MARGIN = 40;
const WIDTH = 1280;

function layoutLine(glyphs, text, size, x0, y) {
  const k = size / UPM;
  let x = x0;
  const frags = [];
  for (const ch of text) {
    const g = glyphs[ch];
    if (!g) {
      x += (ch === ' ' ? 300 : 500) * k;
      continue;
    }
    if (g.d) {
      frags.push(
        `<path transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(4)},${(-k).toFixed(4)})" d="${g.d}" fill="#111" fill-rule="evenodd"/>`
      );
    }
    x += g.advance * k;
  }
  return { frags, endX: x };
}

// Greedy word wrap using real advances.
function wrap(glyphs, text, size, maxWidth) {
  const k = size / UPM;
  const spaceW = 300 * k;
  const lines = [];
  let line = '';
  let lineW = 0;
  for (const word of text.split(/\s+/)) {
    let w = 0;
    for (const ch of word) w += (glyphs[ch] ? glyphs[ch].advance : 500) * k;
    if (line && lineW + spaceW + w > maxWidth) {
      lines.push(line);
      line = word;
      lineW = w;
    } else {
      line = line ? line + ' ' + word : word;
      lineW += line === word ? w : spaceW + w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Waterfall preview: the text at several sizes.
 * @param {{name:string, glyphs:Object<string,{d:string,advance:number}>}} manifest
 */
async function renderPreview(manifest, file, { text, sizes = [64, 40, 28, 18] } = {}) {
  const glyphs = manifest.glyphs;
  const sample =
    text ||
    'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! 0123456789';
  const frags = [];
  let y = MARGIN;
  for (const size of sizes) {
    y += size * 1.1;
    for (const line of wrap(glyphs, sample, size, WIDTH - 2 * MARGIN)) {
      const out = layoutLine(glyphs, line, size, MARGIN, y);
      frags.push(...out.frags);
      y += size * 1.4;
    }
    y += size * 0.4;
  }
  const height = Math.ceil(y + MARGIN);
  const svg = `<svg width="${WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${frags.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

/**
 * Glyph sheet: every glyph large, labeled, with baseline - for per-glyph QC.
 */
async function renderGlyphSheet(manifest, file) {
  const glyphs = manifest.glyphs;
  const cell = 120;
  const cols = 10;
  const chars = Object.keys(glyphs).filter((c) => c !== ' ');
  const rows = Math.ceil(chars.length / cols);
  const k = 80 / UPM;
  const frags = [];
  chars.forEach((ch, i) => {
    const cx = (i % cols) * cell + 10;
    const cy = Math.floor(i / cols) * cell;
    const baseline = cy + 88;
    frags.push(
      `<line x1="${cx}" y1="${baseline}" x2="${cx + cell - 20}" y2="${baseline}" stroke="#bbe" stroke-width="1"/>`,
      `<text x="${cx}" y="${cy + 112}" font-family="sans-serif" font-size="12" fill="#888">${ch.replace('&', '&amp;').replace('<', '&lt;')}</text>`,
      `<path transform="translate(${cx + 8},${baseline}) scale(${k},${-k})" d="${glyphs[ch].d}" fill="#111" fill-rule="evenodd"/>`
    );
  });
  const svg = `<svg width="${cols * cell + 20}" height="${rows * cell + 20}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${frags.join('')}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

module.exports = { renderPreview, renderGlyphSheet };
