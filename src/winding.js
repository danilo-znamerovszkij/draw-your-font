'use strict';
// TrueType fills with the NONZERO winding rule: outer contours must wind
// clockwise (in y-up font coordinates) and holes counter-clockwise.
// potrace emits every contour in the same direction (it assumes even-odd),
// which makes counters - the bowls of b, g, o, a - fill solid in real
// renderers. We re-orient each subpath by its nesting depth.
// Only M/L/C/Q/Z segments are handled: that is all potrace produces.
const svgpath = require('svgpath');

function parseSubpaths(d) {
  const subs = [];
  let cur = null;
  svgpath(d).abs().unshort().unarc().iterate((seg) => {
    const cmd = seg[0];
    if (cmd === 'M') {
      cur = { start: [seg[1], seg[2]], segs: [], poly: [[seg[1], seg[2]]] };
      subs.push(cur);
    } else if (cmd === 'L') {
      cur.segs.push({ c: 'L', to: [seg[1], seg[2]] });
      cur.poly.push([seg[1], seg[2]]);
    } else if (cmd === 'C') {
      const c1 = [seg[1], seg[2]], c2 = [seg[3], seg[4]], to = [seg[5], seg[6]];
      const from = cur.segs.length ? cur.segs[cur.segs.length - 1].to : cur.start;
      // curve midpoint improves the polygon approximation for area/containment
      cur.poly.push([
        0.125 * from[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * to[0],
        0.125 * from[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * to[1],
      ], to);
      cur.segs.push({ c: 'C', c1, c2, to });
    } else if (cmd === 'Q') {
      const c1 = [seg[1], seg[2]], to = [seg[3], seg[4]];
      cur.poly.push(to);
      cur.segs.push({ c: 'Q', c1, to });
    } else if (cmd === 'Z' || cmd === 'z') {
      cur.closed = true;
    } else {
      throw new Error(`fixWinding: unsupported path command "${cmd}"`);
    }
  });
  return subs;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function reverseSubpath(sub) {
  const points = [sub.start, ...sub.segs.map((s) => s.to)];
  let out = `M${fmt(points[points.length - 1])}`;
  for (let i = sub.segs.length - 1; i >= 0; i--) {
    const s = sub.segs[i];
    const from = points[i]; // segment i went points[i] -> points[i+1]
    if (s.c === 'L') out += `L${fmt(from)}`;
    else if (s.c === 'C') out += `C${fmt(s.c2)} ${fmt(s.c1)} ${fmt(from)}`;
    else out += `Q${fmt(s.c1)} ${fmt(from)}`;
  }
  return out + 'Z';
}

function serializeSubpath(sub) {
  let out = `M${fmt(sub.start)}`;
  for (const s of sub.segs) {
    if (s.c === 'L') out += `L${fmt(s.to)}`;
    else if (s.c === 'C') out += `C${fmt(s.c1)} ${fmt(s.c2)} ${fmt(s.to)}`;
    else out += `Q${fmt(s.c1)} ${fmt(s.to)}`;
  }
  return out + (sub.closed ? 'Z' : '');
}

const fmt = ([x, y]) => `${round(x)} ${round(y)}`;
const round = (n) => Math.round(n * 10) / 10;

/**
 * Re-orient subpaths so nonzero-winding renderers show counters correctly.
 * Even nesting depth -> clockwise (negative signed area, y-up), odd -> CCW.
 */
function fixWinding(d) {
  const subs = parseSubpaths(d);
  if (subs.length === 0) return d;
  for (const sub of subs) {
    let depth = 0;
    for (const other of subs) {
      if (other !== sub && pointInPolygon(sub.poly[0], other.poly)) depth++;
    }
    const ccw = signedArea(sub.poly) > 0;
    const wantCCW = depth % 2 === 1;
    sub.out = ccw === wantCCW ? serializeSubpath(sub) : reverseSubpath(sub);
  }
  return subs.map((s) => s.out).join('');
}

module.exports = { fixWinding };
