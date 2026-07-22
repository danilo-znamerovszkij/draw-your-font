'use strict';
// The craft step: place each traced glyph into a shared 1000-UPM em space.
// Every character has a vertical band (bottom..top in font units, baseline = 0);
// the glyph's ink is scaled uniformly to fill its band. This shared coordinate
// system — not per-glyph normalization — is what makes the result feel like a
// font instead of a ransom note.
const svgpath = require('svgpath');
const { fixWinding } = require('./winding');

const UPM = 1000;
const ASCENT = 800;
const DESCENT = -200;
const CAP = 700; // cap height
const XH = 480; // x-height
const DESC = -220; // descender depth
const ASC = 720; // ascender top (b, d, f, h, k, l)

const BANDS = new Map();
const set = (chars, band) => [...chars].forEach((c) => BANDS.set(c, band));

set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', [0, CAP]);
set('ÑÁÉÍÓÚÜ', [0, ASCENT]); // caps with accents reach above cap height
set('bdfhkl', [0, ASC]);
set('t', [0, 640]);
set('acemnorsuvwxz', [0, XH]);
set('ñáéíóúü', [0, ASC]); // lowercase with marks above x-height
set('i', [0, 660]);
set('j', [DESC, 660]);
set('gpqy', [DESC, XH]);
set('.', [0, 110]);
set(',', [-140, 110]);
set(':', [0, XH]);
set(';', [-140, XH]);
set('!?', [0, CAP]);
set("'’", [480, CAP]);
set('"“”', [480, CAP]);
set('-–—', [250, 350]);
set('_', [-120, -40]);
set('()[]{}', [-160, ASC]);
set('@', [-50, 650]);
set('#&%', [0, CAP]);
set('+', [110, 550]);
set('=', [180, 480]);
set('*', [420, CAP]);
set('$€£', [-40, 730]);
set('/\\|', [-100, ASC]);
set('<>', [110, 550]);
set('~', [220, 420]);
set('^', [450, CAP]);
set('¿¡', [DESC, XH]);

function band(char) {
  return BANDS.get(char) || [0, CAP];
}

/**
 * Transform a traced path from crop pixel coords into em space.
 * @param {string} d potrace path in crop coordinates (y down)
 * @param {{width:number,height:number}} cropSize full crop incl. padding
 * @param {number} pad padding used when cropping
 * @param {string} char the character this glyph represents
 * @param {{lsb?:number,rsb?:number}} opts sidebearings in font units
 * @returns {{d: string, advance: number}} path in font coords (y up, baseline 0)
 */
function placeGlyph(d, cropSize, pad, char, { lsb = 50, rsb = 50 } = {}) {
  const inkW = cropSize.width - 2 * pad;
  const inkH = cropSize.height - 2 * pad;
  const [bot, top] = band(char);
  const s = (top - bot) / inkH;
  const placed = svgpath(d)
    .translate(-pad, -pad)
    .scale(s, -s)
    .translate(lsb, top)
    .round(1)
    .toString();
  return { d: fixWinding(placed), advance: Math.round(lsb + inkW * s + rsb) };
}

module.exports = { UPM, ASCENT, DESCENT, XH, CAP, band, placeGlyph };
