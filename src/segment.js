'use strict';
// Ink mask -> ordered glyph blobs (connected components, multi-part merge,
// reading order), glyph crops as PNGs, and a numbered contact sheet for labeling.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { connectedComponents, mergeParts, orderBlobs } = require('./blob-core');

const PAD = 8; // white border around each crop, px

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
