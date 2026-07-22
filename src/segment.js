'use strict';
// Ink mask -> ordered glyph blobs (connected components, multi-part merge,
// reading order), glyph crops as PNGs, and a numbered contact sheet for labeling.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const PAD = 8; // white border around each crop, px

function connectedComponents(ink, width, height, minArea) {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const boxes = [];
  let next = 1;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || labels[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let x0 = width, y0 = height, x1 = 0, y1 = 0, area = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % width, y = (p / width) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const rowOff = ny * width;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const np = rowOff + nx;
          if (ink[np] && !labels[np]) {
            labels[np] = next;
            stack[sp++] = np;
          }
        }
      }
    }
    if (area >= minArea) boxes.push({ x0, y0, x1, y1, area });
    next++;
  }
  return boxes;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 1;
}

// Median glyph height, ignoring residual specks so they can't poison heuristics.
function medianHeight(boxes) {
  const hs = boxes.map((b) => b.y1 - b.y0 + 1);
  return median(hs.filter((h) => h >= 8).length ? hs.filter((h) => h >= 8) : hs);
}

// Merge blobs that belong to one glyph: the dot of i/j, colon/equals parts
// (vertical stacking), and tiny side-by-side marks like double quotes.
function mergeParts(boxes) {
  for (;;) {
    // recompute each round: speck swarms (shadow noise) drag the median down
    // until they consolidate; a stale low median blocks legitimate dot merges
    const medH = medianHeight(boxes);
    // find ALL eligible pairs, then merge only the closest one — a dot
    // between two rows must join its nearest stem, not whichever pair
    // the scan happens to visit first
    let best = null;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const hOvl = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        const minW = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
        const vGap = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1);
        const hGap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1);
        const bothTiny = a.y1 - a.y0 < 0.5 * medH && b.y1 - b.y0 < 0.5 * medH;
        const vOvl = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
        // stacked parts (i-dot, colon, ?, =) always include a small mark;
        // without this guard, letters on adjacent lines would fuse
        const oneSmall = Math.min(a.y1 - a.y0, b.y1 - b.y0) + 1 < 0.5 * medH;
        const stacked = oneSmall && hOvl > 0.5 * minW && vGap < 0.8 * medH;
        const sideBySideMarks = bothTiny && vOvl > 0 && hGap < 0.3 * medH;
        // letters drawn as disconnected strokes (M, N, K…): boxes intersect,
        // and the union stays letter-sized so neighbours don't fuse
        const unionW = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
        const splitStroke =
          hOvl > 0 &&
          vOvl >= 0.6 * Math.min(a.y1 - a.y0 + 1, b.y1 - b.y0 + 1) &&
          unionW <= 1.6 * medH;
        if (stacked || sideBySideMarks || splitStroke) {
          const dist = vGap + hGap;
          if (!best || dist < best.dist) best = { i, j, dist };
        }
      }
    }
    if (!best) return boxes;
    const a = boxes[best.i], b = boxes[best.j];
    boxes[best.i] = {
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1),
      area: a.area + b.area,
    };
    boxes.splice(best.j, 1);
  }
}

// Reading order: cluster into rows by vertical overlap (robust to descenders
// like g/y that would confuse center-distance clustering), then left-to-right.
function orderBlobs(boxes) {
  const rows = [];
  for (const b of [...boxes].sort((p, q) => p.y0 - q.y0)) {
    const h = b.y1 - b.y0 + 1;
    let best = null;
    let bestOvl = 0;
    for (const r of rows) {
      const ovl = Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0) + 1;
      if (ovl > bestOvl) {
        bestOvl = ovl;
        best = r;
      }
    }
    if (best && bestOvl >= 0.5 * Math.min(h, best.y1 - best.y0 + 1)) {
      best.items.push(b);
      best.y0 = Math.min(best.y0, b.y0);
      best.y1 = Math.max(best.y1, b.y1);
    } else {
      rows.push({ y0: b.y0, y1: b.y1, items: [b] });
    }
  }
  rows.sort((r1, r2) => r1.y0 + r1.y1 - (r2.y0 + r2.y1));
  rows.forEach((r) => r.items.sort((p, q) => p.x0 - q.x0));
  return rows.flatMap((r, ri) => r.items.map((b) => ({ ...b, row: ri })));
}

async function writeCrop(ink, width, blob, file) {
  const w = blob.x1 - blob.x0 + 1, h = blob.y1 - blob.y0 + 1;
  const cw = w + 2 * PAD, ch = h + 2 * PAD;
  const buf = Buffer.alloc(cw * ch, 255);
  for (let y = 0; y < h; y++) {
    const src = (blob.y0 + y) * width;
    const dst = (y + PAD) * cw + PAD;
    for (let x = 0; x < w; x++) {
      if (ink[src + blob.x0 + x]) buf[dst + x] = 0;
    }
  }
  await sharp(buf, { raw: { width: cw, height: ch, channels: 1 } }).png().toFile(file);
  return { width: cw, height: ch };
}

async function writeContactSheet(gray, width, height, blobs, file) {
  const outW = Math.min(1600, width);
  const sf = outW / width;
  const outH = Math.round(height * sf);
  const marks = blobs
    .map((b) => {
      const x = b.x0 * sf, y = b.y0 * sf;
      const w = (b.x1 - b.x0 + 1) * sf, h = (b.y1 - b.y0 + 1) * sf;
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"` +
        ` fill="none" stroke="#e11" stroke-width="2"/>` +
        `<text x="${(x + 2).toFixed(1)}" y="${Math.max(14, y - 4).toFixed(1)}"` +
        ` font-family="sans-serif" font-size="18" font-weight="bold" fill="#e11">${b.id}</text>`
      );
    })
    .join('');
  const overlay = Buffer.from(`<svg width="${outW}" height="${outH}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`);
  await sharp(gray, { raw: { width, height, channels: 1 } })
    .resize(outW, outH)
    .composite([{ input: overlay }])
    .png()
    .toFile(file);
}

/**
 * Segment photos into labeled-ready glyph crops.
 * @param {string[]} photos paths
 * @param {string} dir workdir (created if missing)
 * @returns blobs.json content
 */
async function segment(photos, dir, { delta, cap } = {}) {
  const { binarize } = require('./capture');
  fs.mkdirSync(path.join(dir, 'crops'), { recursive: true });
  const all = [];
  let id = 0;
  for (let p = 0; p < photos.length; p++) {
    const { ink, width, height, gray } = await binarize(photos[p], { delta, cap });
    const minArea = Math.max(30, Math.round(width * height * 3e-6));
    let boxes = connectedComponents(ink, width, height, minArea);
    // real pen strokes are never 3px thin at phone-photo resolution
    boxes = boxes.filter((b) => b.x1 - b.x0 + 1 >= 4 && b.y1 - b.y0 + 1 >= 4);
    boxes = mergeParts(boxes);
    const ordered = orderBlobs(boxes).map((b) => ({ ...b, id: id++, photo: photos[p] }));
    for (const b of ordered) {
      b.crop = path.join('crops', `${b.id}.png`);
      b.cropSize = await writeCrop(ink, width, b, path.join(dir, b.crop));
    }
    await writeContactSheet(gray, width, height, ordered, path.join(dir, `contact-${p + 1}.png`));
    all.push(...ordered.map(({ x0, y0, x1, y1, area, row, id: bid, photo, crop, cropSize }) => ({
      id: bid, photo, row, box: { x0, y0, x1, y1 }, area, crop, cropSize,
    })));
  }
  const manifest = { pad: PAD, photos, blobs: all };
  fs.writeFileSync(path.join(dir, 'blobs.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

module.exports = { segment, PAD };
