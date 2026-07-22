'use strict';
// Glyph crop PNG -> SVG path data (potrace), with smoothing and weight controls.
const sharp = require('sharp');
const { Potrace } = require('potrace');

/**
 * @param {Buffer} png binarized crop (black ink on white)
 * @param {{smooth?: number}} opts smooth 0..2 (1 = default handwriting feel)
 * @returns {Promise<string>} SVG path `d` in crop pixel coordinates
 */
function trace(png, { smooth = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const t = new Potrace({
      threshold: 128,
      blackOnWhite: true,
      turdSize: 6, // crops are already despeckled by segmentation's minArea
      alphaMax: 0.8 + 0.25 * smooth,
      optCurve: true,
      optTolerance: 0.2 + 0.2 * Math.max(0, smooth - 1),
      turnPolicy: Potrace.TURNPOLICY_MINORITY,
    });
    t.loadImage(png, function (err) {
      if (err) return reject(err);
      const m = /d="([^"]*)"/.exec(this.getPathTag());
      resolve(m ? m[1] : '');
    });
  });
}

// weight: integer, +n dilates (thicker) / -n erodes (thinner) by n pixels.
async function adjustWeight(png, weight) {
  if (!weight) return png;
  const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i] < 128 ? 1 : 0;
  const grow = weight > 0;
  for (let it = 0; it < Math.abs(weight); it++) {
    const next = new Uint8Array(ink);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const n4 =
          (x > 0 && ink[p - 1]) || (x < width - 1 && ink[p + 1]) ||
          (y > 0 && ink[p - width]) || (y < height - 1 && ink[p + width]);
        if (grow && !ink[p] && n4) next[p] = 1;
        if (!grow && ink[p] && !((x > 0 && ink[p - 1]) && (x < width - 1 && ink[p + 1]) && (y > 0 && ink[p - width]) && (y < height - 1 && ink[p + width]))) next[p] = 0;
      }
    }
    ink = next;
  }
  const out = Buffer.alloc(width * height, 255);
  for (let i = 0; i < ink.length; i++) if (ink[i]) out[i] = 0;
  return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

module.exports = { trace, adjustWeight };
