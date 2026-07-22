'use strict';
// Placed glyphs -> font binaries. We author the SVG-font XML ourselves so
// glyph placement and metrics are exactly what metrics.js computed -
// no icon-font "normalize" scaling anywhere in the chain.
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');
const { UPM, ASCENT, DESCENT, XH, CAP } = require('./metrics');

const esc = (ch) => '&#x' + ch.codePointAt(0).toString(16).toUpperCase() + ';';
const escAttr = (s) => s.replace(/[&<>"']/g, (c) => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`);

/**
 * @param {string} name font family name
 * @param {Array<{char:string,d:string,advance:number}>} glyphs
 * @param {{wordSpace?:number}} opts
 * @returns {Buffer} TTF
 */
function buildTTF(name, glyphs, { wordSpace = 300 } = {}) {
  const id = name.replace(/[^A-Za-z0-9_-]+/g, '') || 'DrawYourFont';
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><defs>`,
    `<font id="${id}" horiz-adv-x="${wordSpace}">`,
    `<font-face font-family="${escAttr(name)}" units-per-em="${UPM}" ascent="${ASCENT}" descent="${DESCENT}" x-height="${XH}" cap-height="${CAP}"/>`,
    `<missing-glyph horiz-adv-x="${Math.round(UPM / 2)}"/>`,
    `<glyph glyph-name="space" unicode="${esc(' ')}" horiz-adv-x="${wordSpace}" d=""/>`,
  ];
  for (const g of glyphs) {
    if (g.char === ' ') continue;
    const gname = 'uni' + g.char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    parts.push(`<glyph glyph-name="${gname}" unicode="${esc(g.char)}" horiz-adv-x="${g.advance}" d="${g.d}"/>`);
  }
  parts.push(`</font></defs></svg>`);
  const ttf = svg2ttf(parts.join('\n'), { description: 'Made with draw-your-font', url: 'https://github.com/danilo-znamerovszkij/draw-your-font' });
  return Buffer.from(ttf.buffer);
}

function toWoff(ttf) {
  const out = ttf2woff(new Uint8Array(ttf));
  return Buffer.from(out.buffer || out);
}

async function toWoff2(ttf) {
  const wawoff2 = require('wawoff2');
  return Buffer.from(await wawoff2.compress(ttf));
}

function fontFaceCSS(name, base) {
  return [
    `@font-face {`,
    `  font-family: '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';`,
    `  src: url('${base}.woff2') format('woff2'),`,
    `       url('${base}.woff') format('woff'),`,
    `       url('${base}.ttf') format('truetype');`,
    `  font-weight: normal;`,
    `  font-style: normal;`,
    `  font-display: swap;`,
    `}`,
  ].join('\n');
}

module.exports = { buildTTF, toWoff, toWoff2, fontFaceCSS };
