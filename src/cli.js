#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');

const USAGE = `draw-your-font - turn a photo of your handwriting into a real font

Usage:
  draw-your-font template [-o template.pdf] [--charset minimal|spanish]
  draw-your-font segment <photo...> [-d workdir] [--delta N] [--cap N]
  draw-your-font build   [-d workdir] (--labels labels.json | --chars "ABC…" | --charset name)
                         [--name "My Handwriting"] [-o font.ttf] [--smooth 0..2]
                         [--weight=-2..2] [--formats ttf,woff,woff2,css]
                         (negative weight needs the = form: --weight=-1)
  draw-your-font make    <photo...> (--chars "ABC…" | --charset name) [build options]
  draw-your-font preview [-d workdir] [--text "…"] [-o preview.png]

Typical flows:
  1. Freeform photo, you know the order you wrote in:
       draw-your-font make photo.jpg --chars "ABCabc" --name "My Hand"
  2. Printed template (order is the charset):
       draw-your-font template -o template.pdf --charset minimal
       # print, write, photograph, then:
       draw-your-font make page1.jpg page2.jpg --charset minimal
  3. Agent-assisted (Claude labels the blobs):
       draw-your-font segment photo.jpg -d work
       # inspect work/contact-1.png, write work/labels.json {"0":"A", …}
       draw-your-font build -d work --labels work/labels.json
`;

const OPTS = {
  dir: { type: 'string', short: 'd', default: 'work' },
  out: { type: 'string', short: 'o' },
  name: { type: 'string', default: 'My Handwriting' },
  labels: { type: 'string' },
  chars: { type: 'string' },
  charset: { type: 'string' },
  smooth: { type: 'string', default: '1' },
  weight: { type: 'string', default: '0' },
  formats: { type: 'string', default: 'ttf' },
  text: { type: 'string' },
  delta: { type: 'string' },
  cap: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }
  const { values: opt, positionals } = parseArgs({ args: rest, options: OPTS, allowPositionals: true });
  if (opt.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const dir = opt.dir;

  if (cmd === 'template') {
    const { generateTemplate } = require('./template');
    const out = opt.out || 'template.pdf';
    await generateTemplate(out, { charset: opt.charset || 'minimal' });
    console.log(`Template written to ${out}. Print it, write with a dark pen, photograph each page.`);
    return;
  }

  if (cmd === 'segment' || cmd === 'make') {
    if (!positionals.length) fail('No photos given.');
    const { segment } = require('./segment');
    const manifest = await segment(positionals, dir, {
      delta: opt.delta ? Number(opt.delta) : undefined,
      cap: opt.cap ? Number(opt.cap) : undefined,
    });
    console.log(`Found ${manifest.blobs.length} glyph candidates across ${positionals.length} photo(s).`);
    console.log(`Crops: ${dir}/crops/  Contact sheet(s): ${dir}/contact-*.png  Data: ${dir}/blobs.json`);
    if (cmd === 'segment') return;
  }

  if (cmd === 'build' || cmd === 'make') {
    await build(dir, opt);
    return;
  }

  if (cmd === 'preview') {
    const { renderPreview } = require('./preview');
    const manifest = readJSON(path.join(dir, 'manifest.json'), 'Run build first.');
    const out = opt.out || path.join(dir, 'preview.png');
    await renderPreview(manifest, out, { text: opt.text });
    console.log(`Preview: ${out}`);
    return;
  }

  fail(`Unknown command "${cmd}".\n\n${USAGE}`);
}

async function build(dir, opt) {
  const { trace, adjustWeight } = require('./trace');
  const { placeGlyph } = require('./metrics');
  const { buildTTF, toWoff, toWoff2, fontFaceCSS } = require('./assemble');
  const { renderPreview, renderGlyphSheet } = require('./preview');
  const { CHARSETS } = require('./charsets');

  const blobs = readJSON(path.join(dir, 'blobs.json'), 'Run segment (or make) first.');
  const labels = resolveLabels(blobs, opt, CHARSETS);

  const smooth = Number(opt.smooth);
  const weight = Math.max(-2, Math.min(2, Number(opt.weight)));
  const glyphs = [];
  const seen = new Set();
  for (const blob of blobs.blobs) {
    let char = labels[blob.id];
    if (!char) continue;
    char = char.normalize('NFC');
    if ([...char].length > 1) {
      console.warn(`  ! "${char}" (blob ${blob.id}) is a multi-character sequence - not supported yet, skipped`);
      continue;
    }
    if (seen.has(char)) {
      console.warn(`  ! duplicate "${char}" (blob ${blob.id}) - keeping the first one`);
      continue;
    }
    seen.add(char);
    let png = fs.readFileSync(path.join(dir, blob.crop));
    png = await adjustWeight(png, weight);
    const d = await trace(png, { smooth });
    if (!d) {
      console.warn(`  ! blob ${blob.id} ("${char}") traced to nothing - skipped`);
      continue;
    }
    const placed = placeGlyph(d, blob.cropSize, blobs.pad, char);
    glyphs.push({ char, ...placed, source: blob.crop });
  }
  if (!glyphs.length) fail('No glyphs to build. Check your labels.');

  const name = opt.name;
  const base = (opt.out ? opt.out.replace(/\.\w+$/, '') : path.join(dir, name.replace(/\s+/g, '')));
  fs.mkdirSync(path.dirname(path.resolve(base)), { recursive: true });
  const ttf = buildTTF(name, glyphs);
  const formats = opt.formats.split(',').map((s) => s.trim().toLowerCase());
  const written = [];
  if (formats.includes('ttf') || opt.out) {
    fs.writeFileSync(`${base}.ttf`, ttf);
    written.push(`${base}.ttf`);
  }
  if (formats.includes('woff')) {
    fs.writeFileSync(`${base}.woff`, toWoff(ttf));
    written.push(`${base}.woff`);
  }
  if (formats.includes('woff2')) {
    fs.writeFileSync(`${base}.woff2`, await toWoff2(ttf));
    written.push(`${base}.woff2`);
  }
  if (formats.includes('css')) {
    fs.writeFileSync(`${base}.css`, fontFaceCSS(name, path.basename(base)));
    written.push(`${base}.css`);
  }

  const manifest = {
    name,
    unitsPerEm: 1000,
    smooth,
    weight,
    glyphs: Object.fromEntries(glyphs.map((g) => [g.char, { d: g.d, advance: g.advance, source: g.source }])),
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  await renderPreview(manifest, path.join(dir, 'preview.png'));
  await renderGlyphSheet(manifest, path.join(dir, 'glyphs.png'));

  console.log(`Built ${glyphs.length} glyphs → ${written.join(', ')}`);
  console.log(`Preview: ${path.join(dir, 'preview.png')}  Glyph sheet: ${path.join(dir, 'glyphs.png')}`);
  const missing = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !seen.has(c));
  if (missing.length) console.log(`Letters not in this font yet: ${missing.join(' ')}`);
}

function resolveLabels(blobs, opt, CHARSETS) {
  if (opt.labels) {
    const map = readJSON(opt.labels, '');
    return Object.fromEntries(Object.entries(map).filter(([, v]) => v));
  }
  let chars;
  if (opt.chars) chars = [...opt.chars.normalize('NFC').replace(/\s+/g, '')];
  else if (opt.charset) {
    chars = CHARSETS[opt.charset];
    if (!chars) fail(`Unknown charset "${opt.charset}". Available: ${Object.keys(CHARSETS).join(', ')}`);
  } else {
    fail('Provide --labels labels.json, --chars "…", or --charset <name>.');
  }
  const ids = blobs.blobs.map((b) => b.id);
  if (chars.length !== ids.length) {
    console.warn(
      `  ! ${ids.length} blobs found but ${chars.length} characters given - mapping in order, extras ignored.\n` +
      `    If this is unexpected, inspect the contact sheet and use --labels for exact control.`
    );
  }
  return Object.fromEntries(ids.slice(0, chars.length).map((id, i) => [id, chars[i]]));
}

function readJSON(file, hint) {
  if (!fs.existsSync(file)) fail(`${file} not found. ${hint}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => fail(err.stack || String(err)));
