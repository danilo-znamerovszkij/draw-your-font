'use strict';
// Pure blob geometry shared by the Node pipeline (segment.js) and the
// browser demo bundle: connected components, multi-part glyph merging,
// reading-order clustering. No sharp, no fs - typed arrays only.

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
    // find ALL eligible pairs, then merge only the closest one - a dot
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

module.exports = { connectedComponents, mergeParts, orderBlobs, medianHeight };
