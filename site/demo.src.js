// Browser demo: photo -> TTF, entirely client-side.
// Reuses the repo's own pure modules (blob-core, metrics, winding, assemble);
// only capture is re-implemented on Canvas because sharp is Node-only.
// Build: npm run build:demo
import { potrace, init as initPotrace } from 'esm-potrace-wasm';
import svgpathLib from 'svgpath';
const { connectedComponents, mergeParts, orderBlobs } = require('../src/blob-core');
const { placeGlyph } = require('../src/metrics');
const { buildTTF } = require('../src/assemble');

// assemble.js wraps its result in Buffer.from(); give the browser a minimal stand-in
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = { from: (u8) => new Uint8Array(u8) };
}

const MAX_SIDE = 2800;
const PAD = 8;

const $ = (id) => document.getElementById(id);

// ---------- capture (Canvas port of src/capture.js) ----------

function toGray(imgData) {
  const { data, width, height } = imgData;
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return g;
}

function normalise(g) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(((g[i] - lo) * 255) / range)));
  }
  return out;
}

function grayToCanvas(g, width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    img.data[p] = img.data[p + 1] = img.data[p + 2] = g[i];
    img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// local background estimate: heavy downscale then upscale (canvas bilinear)
function localBackground(grayCanvas, width, height) {
  const sw = Math.max(1, Math.round(width / 32));
  const sh = Math.max(1, Math.round(height / 32));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  small.getContext('2d').drawImage(grayCanvas, 0, 0, sw, sh);
  const big = document.createElement('canvas');
  big.width = width; big.height = height;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, width, height);
  return toGray(bctx.getImageData(0, 0, width, height));
}

function morph(ink, width, height, grow) {
  const out = new Uint8Array(ink);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const l = x > 0 && ink[p - 1], r = x < width - 1 && ink[p + 1];
      const u = y > 0 && ink[p - width], d = y < height - 1 && ink[p + width];
      if (grow && !ink[p] && (l || r || u || d)) out[p] = 1;
      if (!grow && ink[p] && !(l && r && u && d)) out[p] = 0;
    }
  }
  return out;
}

function binarize(imgData, { delta = 40, cap = 165 } = {}) {
  const { width, height } = imgData;
  const gray = normalise(toGray(imgData));
  const bg = localBackground(grayToCanvas(gray, width, height), width, height);
  let ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    if (gray[i] < cap && gray[i] < bg[i] - delta) ink[i] = 1;
  }
  ink = morph(morph(ink, width, height, true), width, height, false);
  return ink;
}

// ---------- segmentation (shared blob-core) ----------

function segmentImage(imgData, delta) {
  const { width, height } = imgData;
  const ink = binarize(imgData, { delta });
  const minArea = Math.max(30, Math.round(width * height * 3e-6));
  let boxes = connectedComponents(ink, width, height, minArea);
  boxes = boxes.filter((b) => b.x1 - b.x0 + 1 >= 4 && b.y1 - b.y0 + 1 >= 4);
  boxes = mergeParts(boxes);
  return { ink, blobs: orderBlobs(boxes), width };
}

function cropToImageData(ink, imgWidth, blob) {
  const w = blob.x1 - blob.x0 + 1, h = blob.y1 - blob.y0 + 1;
  const cw = w + 2 * PAD, ch = h + 2 * PAD;
  const img = new ImageData(cw, ch);
  img.data.fill(255);
  for (let y = 0; y < h; y++) {
    const src = (blob.y0 + y) * imgWidth + blob.x0;
    for (let x = 0; x < w; x++) {
      if (ink[src + x]) {
        const p = ((y + PAD) * cw + (x + PAD)) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 0;
      }
    }
  }
  return img;
}

// ---------- trace + build ----------

async function traceCrop(img) {
  const svg = await potrace(img, {
    turdsize: 6,
    alphamax: 1.05,
    opticurve: 1,
    opttolerance: 0.2,
    extractcolors: false,
  });
  const m = /d="([^"]+)"/.exec(svg);
  if (!m) return '';
  // potrace SVG uses <g transform="translate(0,H) scale(0.1,-0.1)">; undo it
  return svgpathLib(m[1]).scale(0.1, -0.1).translate(0, img.height).round(1).toString();
}

async function buildFont(imgData, chars, name, delta, onProgress) {
  const { ink, blobs, width } = segmentImage(imgData, delta);
  const wanted = [...chars.normalize('NFC').replace(/\s+/g, '')].filter((c) => [...c].length === 1);
  const n = Math.min(blobs.length, wanted.length);
  const glyphs = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const char = wanted[i];
    if (seen.has(char)) continue;
    onProgress(`tracing ${i + 1}/${n}…`);
    const crop = cropToImageData(ink, width, blobs[i]);
    const d = await traceCrop(crop);
    if (!d) continue;
    seen.add(char);
    glyphs.push({ char, ...placeGlyph(d, { width: crop.width, height: crop.height }, PAD, char) });
  }
  if (!glyphs.length) throw new Error('no glyphs traced');
  return { ttf: buildTTF(name, glyphs), glyphCount: glyphs.length, blobCount: blobs.length, wantedCount: wanted.length };
}

// ---------- UI ----------

let lastImage = null;
let busy = false;
let fontSeq = 0;

async function fileToImageData(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function run() {
  if (!lastImage || busy) return;
  busy = true;
  const status = $('demo-status');
  const result = $('demo-result');
  try {
    status.textContent = 'reading the page…';
    await initPotrace();
    const name = ($('demo-name').value.trim() || 'My Hand').slice(0, 40);
    const delta = Number($('demo-delta').value);
    const { ttf, glyphCount, blobCount, wantedCount } = await buildFont(
      lastImage, $('demo-chars').value, name, delta, (t) => { status.textContent = t; }
    );

    const face = new FontFace(`demo-font-${++fontSeq}`, ttf.buffer ? ttf.buffer : ttf);
    await face.load();
    document.fonts.add(face);
    $('demo-preview').style.fontFamily = `'demo-font-${fontSeq}', cursive`;

    const blob = new Blob([ttf], { type: 'font/ttf' });
    const link = $('demo-download');
    link.href = URL.createObjectURL(blob);
    link.download = `${name.replace(/\s+/g, '')}.ttf`;

    result.hidden = false;
    let note = `${glyphCount} letters traced from ${blobCount} marks.`;
    if (blobCount !== wantedCount) {
      note += ` You listed ${wantedCount} characters - if the mapping looks off, adjust ink sensitivity or edit the character list to match what is on the paper, in reading order.`;
    }
    status.textContent = note;
  } catch (e) {
    result.hidden = true;
    status.textContent = 'Could not build a font from that photo: ' + e.message +
      '. Try more light, a darker pen, or a tighter crop.';
  } finally {
    busy = false;
  }
}

function wire() {
  const zone = $('demo-drop');
  const input = $('demo-file');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) { lastImage = await fileToImageData(f); run(); }
  });
  input.addEventListener('change', async () => {
    if (input.files[0]) { lastImage = await fileToImageData(input.files[0]); run(); }
  });
  let t = null;
  const rerun = () => { clearTimeout(t); t = setTimeout(run, 350); };
  $('demo-delta').addEventListener('input', rerun);
  $('demo-chars').addEventListener('input', rerun);
  $('demo-name').addEventListener('input', rerun);
}

// ---------- self-test (headless verification, #selftest) ----------

async function selftest() {
  const LETTERS = {
    A: 'M15,130 L50,15 L85,130 M30,92 L70,88',
    b: 'M25,10 L26,130 M25,75 C55,60 75,80 73,100 C71,122 45,133 26,118',
    g: 'M78,68 C60,55 30,60 27,90 C25,115 45,125 60,120 C72,116 78,105 78,90 M78,65 L78,150 C76,175 45,180 35,165',
    o: 'M50,70 C25,70 20,95 25,112 C32,132 68,132 75,112 C80,95 75,70 50,70',
  };
  const c = document.createElement('canvas');
  c.width = 900; c.height = 340;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2eee6'; ctx.fillRect(0, 0, 900, 340);
  ctx.strokeStyle = '#1c1c22'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  Object.values(LETTERS).forEach((d, i) => {
    ctx.save();
    ctx.translate(60 + i * 210, 60);
    ctx.stroke(new Path2D(d));
    ctx.restore();
  });
  try {
    await initPotrace();
    const { ttf, glyphCount } = await buildFont(
      ctx.getImageData(0, 0, 900, 340), 'Abgo', 'Self Test', 40, () => {}
    );
    const u8 = new Uint8Array(ttf.buffer ? ttf.buffer : ttf);
    const magicOK = u8[0] === 0 && u8[1] === 1 && u8[2] === 0 && u8[3] === 0;
    $('demo-status').textContent = magicOK && glyphCount === 4
      ? 'SELFTEST-PASS 4 glyphs, valid ttf'
      : `SELFTEST-FAIL glyphs=${glyphCount} magic=${magicOK}`;
  } catch (e) {
    $('demo-status').textContent = 'SELFTEST-FAIL ' + e.message;
  }
}

wire();
if (location.hash === '#selftest') selftest();
