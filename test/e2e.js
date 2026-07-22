'use strict';
// End-to-end self-check: synthetic handwriting photo -> segment -> trace ->
// metrics -> TTF, validated by parsing the font back. Run: npm test
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const opentype = require('opentype.js');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');
const WORK = path.join(TMP, 'work');

// Hand-drawn-looking letters as stroked paths (100x~180 boxes, y down).
const LETTERS = {
  A: 'M15,130 L50,15 L85,130 M30,92 L70,88',
  b: 'M25,10 L26,130 M25,75 C55,60 75,80 73,100 C71,122 45,133 26,118',
  g: 'M78,68 C60,55 30,60 27,90 C25,115 45,125 60,120 C72,116 78,105 78,90 M78,65 L78,150 C76,175 45,180 35,165',
  i: 'M50,42 L51,47 M50,70 L49,130',
  o: 'M50,70 C25,70 20,95 25,112 C32,132 68,132 75,112 C80,95 75,70 50,70',
  x: 'M25,70 L75,130 M75,72 L27,128',
};

async function makeSamplePhoto(file) {
  const place = (char, x, y, rot) =>
    `<g transform="translate(${x},${y}) rotate(${rot})"><path d="${LETTERS[char]}" fill="none" stroke="#1c1c22" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const svg = `<svg width="900" height="640" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f2eee6"/>
    <g transform="rotate(1.2, 450, 320)">
      ${place('A', 80, 30, -2)}${place('b', 300, 30, 1.5)}${place('g', 520, 30, -1)}
      ${place('i', 80, 300, 2)}${place('o', 300, 300, -1.5)}${place('x', 520, 300, 1)}
    </g></svg>`;
  await sharp(Buffer.from(svg), { density: 144 }).jpeg({ quality: 88 }).toFile(file);
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const photo = path.join(TMP, 'sample.jpg');
  await makeSamplePhoto(photo);

  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'src/cli.js'), 'make', photo, '--chars', 'Abgiox', '-d', WORK, '--name', 'Test Hand', '--formats', 'ttf,woff,woff2,css'],
    { encoding: 'utf8' }
  );
  console.log(out);
  assert.match(out, /Found 6 glyph candidates/, 'segmentation should find exactly 6 blobs (i-dot merged)');

  const ttfPath = path.join(WORK, 'TestHand.ttf');
  const raw = fs.readFileSync(ttfPath);
  const font = opentype.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.equal(font.unitsPerEm, 1000);

  for (const ch of 'Abgiox') {
    const glyph = font.charToGlyph(ch);
    assert.ok(glyph && glyph.name !== '.notdef', `glyph for "${ch}" exists`);
    assert.ok(glyph.advanceWidth > 50, `advance for "${ch}" is sane`);
  }
  // Band placement really happened: descender below baseline, ascender above x-height, cap tall.
  const bb = (ch) => font.charToGlyph(ch).getBoundingBox();
  assert.ok(Math.min(bb('g').y1, bb('g').y2) < -100, `g has a descender (yMin=${bb('g').y1})`);
  assert.ok(Math.max(bb('b').y1, bb('b').y2) > 650, 'b is ascender-tall');
  assert.ok(Math.max(bb('o').y1, bb('o').y2) <= 500, 'o stays at x-height');
  assert.ok(Math.max(bb('A').y1, bb('A').y2) > 650, 'A reaches cap height');
  assert.equal(font.charToGlyph(' ').advanceWidth, 300, 'space glyph present');

  // Winding: o must have an outer contour and an opposite-wound hole,
  // or its bowl renders filled in nonzero-winding rasterizers (i.e. everywhere).
  const contours = [];
  let poly = null;
  for (const c of font.charToGlyph('o').path.commands) {
    if (c.type === 'M') { poly = []; contours.push(poly); }
    if (c.type !== 'Z') poly.push([c.x, c.y]);
  }
  const shoelace = (p) => p.reduce((a, [x1, y1], i) => a + x1 * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y1, 0);
  assert.equal(contours.length, 2, 'o has outer + hole contours');
  assert.ok(shoelace(contours[0]) * shoelace(contours[1]) < 0, 'o hole is wound opposite to its outer contour');

  // Extra formats
  const woff2 = fs.readFileSync(path.join(WORK, 'TestHand.woff2'));
  assert.equal(woff2.toString('ascii', 0, 4), 'wOF2');
  assert.equal(fs.readFileSync(path.join(WORK, 'TestHand.woff')).toString('ascii', 0, 4), 'wOFF');
  assert.match(fs.readFileSync(path.join(WORK, 'TestHand.css'), 'utf8'), /@font-face/);
  for (const f of ['preview.png', 'glyphs.png', 'contact-1.png', 'blobs.json', 'manifest.json']) {
    assert.ok(fs.existsSync(path.join(WORK, f)), `${f} exists`);
  }

  console.log('e2e OK - synthetic photo became a valid TTF with correct metrics.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
