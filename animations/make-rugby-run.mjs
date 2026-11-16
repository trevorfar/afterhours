#!/usr/bin/env node
// Draws "Rugby run": a one-minute, 64×64 night match. Last play, two points down: a pop pass under pressure, the view
// from behind her as three defenders close in, a sidestep, a fend, a spin, and the dive for the line.
//
//   node --experimental-strip-types animations/make-rugby-run.mjs [sheet.png [frame …]]
//
// Writes animations/rugby-run.ahanim; with a path, also a contact sheet of the given frames (or sixteen evenly spaced).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { encodeAnimation, fileSize } from '../app/animation.ts';

const S = 64, FPS = 12, { PI, sin, cos, abs, max, min, floor, round } = Math;
const palette = [], C = hex => (palette.indexOf(hex) + 1) || palette.push(hex);
const clamp = (v, a = 0, b = 1) => max(a, min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const ramp = (f, a, b) => ease((f - a) / (b - a));
const hash = (x, y = 0) => { let h = (x | 0) * 374761393 + (y | 0) * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x, y, v) => v > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const grade = (list, t, x, y) => { const v = clamp(t) * (list.length - 1), i = floor(v); return list[min(list.length - 1, i + (dither(x, y, v - i) ? 1 : 0))]; };

// --- Colors -------------------------------------------------------------------------------------------------------------
const INK = C('#07070f'), WHITE = C('#ffffff'), DARK = C('#080a1c');
const NIGHT = ['#080a1c', '#0e1230', '#181c4c', '#2a2266'].map(C), STARLIGHT = C('#cfd8ff');
const STAND = C('#141432'), STAND_L = C('#1e1e46'), ROOF = C('#0b0b1e'), LAMP = C('#fff7c8'), HALO = C('#4a4a96');
const CROWD = ['#4a3270', '#2f4a82', '#6e3558', '#2f6470', '#74583a', '#4c4c86'].map(C);
const BOARD = ['#ff2e63', '#08d9d6', '#ffd23f', '#7b2ff7'].map(C);
const GRASS = [C('#1e9c50'), C('#28b25c')], GRASS_D = C('#157a3e'), GRASS_L = C('#6fe08c'), LINE = C('#eafff0');
const CREAM = C('#fff1d0'), CREAM_D = C('#d2ae7c');
const GOLD = C('#ffc933'), GOLD_D = C('#c98a12'), RED = C('#ef3340'), RED_D = C('#a81f33');
const CYAN = C('#5fe3ff'), MAGENTA = C('#ff4fa3'), YELLOW = C('#fff06a'), MOUTH = C('#7a1626'), BLUSH = C('#ff9d8a');

const HERO = { skin: C('#ffd0a8'), skinD: C('#d99a72'), hoops: [RED, WHITE], hoopsD: [RED_D, C('#c4c8dc')], shorts: WHITE, shortsD: C('#c4c8dc'), sock: RED, sockD: RED_D, boot: GOLD, bootD: GOLD_D, hair: C('#8a5429'), hairD: C('#5e3516'), cap: C('#2f6df6'), capD: C('#1d3fae') };
const MATE = { ...HERO, skin: C('#c58a5e'), skinD: C('#9a6540'), hair: C('#2a1c34'), hairD: INK, cap: 0, tail: true };
const AMBER = C('#ffb703'), AMBER_D = C('#c47f00'), COAL = C('#2b2b44'), COAL_D = C('#1b1b2e');
const FOE = { skin: C('#f0b890'), skinD: C('#c48a64'), hoops: [COAL, AMBER], hoopsD: [COAL_D, AMBER_D], shorts: COAL, shortsD: COAL_D, sock: AMBER, sockD: AMBER_D, boot: WHITE, bootD: C('#c4c8dc'), hair: C('#f2d16b'), hairD: C('#b99a4e'), cap: 0 };
const FOES = [FOE, { ...FOE, skin: C('#8f5d3f'), skinD: C('#6f4630'), hair: C('#241a2e') }, { ...FOE, hair: C('#d0562b') }];

// --- Drawing ------------------------------------------------------------------------------------------------------------
let target = new Uint8Array(S * S), F = 0;
const scratch = new Uint8Array(S * S);
let box = null;
function span(y, x0, x1, c) {
  y = round(y); x0 = max(0, round(x0)); x1 = min(S - 1, round(x1));
  if (y < 0 || y >= S || x1 < x0) return;
  target.fill(c, y * S + x0, y * S + x1 + 1);
  if (box) { box[0] = min(box[0], x0); box[1] = min(box[1], y); box[2] = max(box[2], x1); box[3] = max(box[3], y); }
}
const px = (x, y, c) => span(y, x, x, c);
const rect = (x, y, w, h, c) => { for (let j = round(y); j < round(y + h); j++) span(j, x, round(x + w) - 1, c); };
/** Ellipse, optionally rotated; `c` may be a function of the pixel's position within it (u, v from -1 to 1). */
function oval(cx, cy, rx, ry, c, angle = 0) {
  const ca = cos(angle), sa = sin(angle), reach = max(rx, ry) + 1, pick = typeof c === 'function';
  for (let y = floor(cy - reach); y <= cy + reach; y++) for (let x = floor(cx - reach); x <= cx + reach; x++) {
    const dx = x - cx, dy = y - cy, u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
    if (u * u + v * v <= 1) { const color = pick ? c(u, v) : c; if (color) px(x, y, color); }
  }
}
const disc = (cx, cy, r, c) => oval(cx, cy, r, r, c);
/** A limb from a to b whose radius goes from r1 to r2. `c` may be a function of t (0 at a, 1 at b). */
function limb(a, b, r1, r2, c) {
  const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy || 1, reach = max(r1, r2) + 1, pick = typeof c === 'function';
  for (let y = floor(min(ay, by) - reach); y <= max(ay, by) + reach; y++) for (let x = floor(min(ax, bx) - reach); x <= max(ax, bx) + reach; x++) {
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / len), r = max(0.55, lerp(r1, r2, t)), ex = x - ax - dx * t, ey = y - ay - dy * t;
    if (ex * ex + ey * ey <= r * r) { const color = pick ? c(t) : c; if (color) px(x, y, color); }
  }
}
const line = (x0, y0, x1, y1, c) => limb([x0, y0], [x1, y1], 0.5, 0.5, c);
function poly(points, c) {
  const ys = points.map(p => p[1]);
  for (let y = floor(min(...ys)); y <= max(...ys); y++) {
    const xs = [];
    points.forEach(([x0, y0], i) => { const [x1, y1] = points[(i + 1) % points.length]; if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + (y - y0) / (y1 - y0) * (x1 - x0)); });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) span(y, xs[i], xs[i + 1], typeof c === 'function' ? c(y) : c);
  }
}
/** Draws a group of shapes with a one-pixel outline around the whole group. Groups cannot be nested. */
function part(draw, outline = INK) {
  const real = target;
  target = scratch; box = [S, S, -1, -1];
  const result = draw();
  target = real;
  const [x0, y0, x1, y1] = box; box = null;
  if (x1 < 0) return result;
  for (let y = max(0, y0 - 1); y <= min(S - 1, y1 + 1); y++) for (let x = max(0, x0 - 1); x <= min(S - 1, x1 + 1); x++) {
    const i = y * S + x;
    if (scratch[i]) target[i] = scratch[i];
    else if (outline && ((x > 0 && scratch[i - 1]) || (x < S - 1 && scratch[i + 1]) || (y > 0 && scratch[i - S]) || (y < S - 1 && scratch[i + S]))) target[i] = outline;
  }
  for (let y = y0; y <= y1; y++) scratch.fill(0, y * S + x0, y * S + x1 + 1);
  return result;
}
/** Draws into a spare layer, for afterimages and silhouettes. */
function capture(draw) { const real = target; target = new Uint8Array(S * S); draw(); const layer = target; target = real; return layer; }
function stamp(layer, dx = 0, dy = 0, c = 0, checker = -1) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = layer[y * S + x], X = x + round(dx), Y = y + round(dy);
    if (!v || X < 0 || Y < 0 || X >= S || Y >= S || (checker >= 0 && ((X + Y + checker) & 1))) continue;
    target[Y * S + X] = c || v;
  }
}
/** Moves the whole picture, repeating its edges: screen shake and tilts. */
function shift(dx, dy) {
  const copy = target.slice();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) target[y * S + x] = copy[clamp(y - dy, 0, S - 1) * S + clamp(x - dx, 0, S - 1)];
}
const shake = (f, from, length = 5, power = 2) => { const a = f - from; if (a >= 0 && a < length) shift(round((hash(F, 1) - 0.5) * 2 * power), round((hash(F, 2) - 0.5) * 2 * power)); };

const FONT = {
  A: '010101111101101', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', H: '101101111101101', I: '111010010010111',
  L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', R: '110101110101101', S: '011100010001110',
  T: '111010010010010', U: '101101101101111', W: '101101111111101', Y: '101101010010010', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '!': '010010010000010', '-': '000000111000000', ':': '000010000010000',
};
const textWidth = (string, scale = 1) => string.length * 4 * scale - scale;
function text(string, x, y, scale, c) {
  [...string].forEach((ch, n) => { const bits = FONT[ch]; if (bits) for (let i = 0; i < 15; i++) if (bits[i] === '1') rect(x + (n * 4 + i % 3) * scale, y + floor(i / 3) * scale, scale, scale, c); });
}
const centered = (string, y, scale, c) => text(string, round((S - textWidth(string, scale)) / 2), y, scale, c);
/** An arcade call-out that slams in and flashes. */
function shout(word, f, from, y = 51) {
  const a = f - from;
  if (a < 0 || a > 15) return;
  part(() => text(word, round((S - textWidth(word, 2)) / 2) + (a === 0 ? -3 : a === 1 ? 2 : 0), y + (a < 2 ? 2 - a : 0), 2, a % 4 < 2 ? YELLOW : WHITE));
}
function star(cx, cy, r, c, spin = 0, points = 6) {
  poly(Array.from({ length: points * 2 }, (_, i) => { const a = spin + i * PI / points, d = i % 2 ? r * 0.4 : r; return [cx + cos(a) * d, cy + sin(a) * d]; }), c);
}
const ballShape = (x, y, r, angle = 0) => oval(x, y, r, r * 0.64, (u, v) => v > 0.3 || abs(u) < 0.13 ? CREAM_D : CREAM, angle);
const ball = (x, y, r, angle = 0) => part(() => ballShape(x, y, r, angle));
const letterbox = h => { rect(0, 0, S, h, INK); rect(0, S - h, S, h, INK); };
/** Streaks that flicker past: the faster the shot, the more and the longer. */
function streaks(count, y0, y1, length, c, seed = 0) {
  for (let i = 0; i < count; i++) { const y = y0 + hash(i, F * 13 + seed) * (y1 - y0), x = hash(i, F * 7 + seed + 1) * (S + length) - length; span(y, x, x + length * (0.5 + hash(i, F + seed)), c); }
}
function spray(x, y, age, dir, c = GRASS_L, count = 7, seed = 0) {
  if (age < 0 || age > 9) return;
  for (let i = 0; i < count; i++) { const vx = dir * (0.6 + hash(i, seed) * 1.8), vy = -(1 + hash(i, seed + 5) * 2.2); px(x + vx * age, y + vy * age + 0.22 * age * age, i % 3 ? c : GRASS_D); }
}
function firework(cx, cy, age, colors) {
  if (age < 0 || age > 16) return;
  const r = 12 * (1 - (1 - age / 16) ** 2);
  for (let i = 0; i < 14; i++) for (const q of [1, 0.62]) {
    if (age > 8 && hash(i, age + q * 10 + cx) > (17 - age) / 9) continue;
    const a = i * PI / 7 + cx + (q < 1 ? 0.2 : 0);
    px(cx + cos(a) * r * q, cy + sin(a) * r * q + age * age * 0.025, colors[(i + (q < 1 ? 1 : 0)) % colors.length]);
  }
  if (age < 2) disc(cx, cy, 2 - age, WHITE);
}

// --- The side-on figure -------------------------------------------------------------------------------------------------
// Angles are measured from straight down; positive swings toward the way the figure faces.
const BODY = { head: 3.4, neck: 0.5, torso: 8.5, upper: 4, fore: 3.6, thigh: 5.6, shin: 5.8, foot: 2.3 };
const legPose = (p, amp = 1) => ({ th: 0.15 + 0.9 * amp * sin(p), kn: 0.3 + 1.4 * amp * max(0, cos(p)) });
const armPose = (p, amp = 1) => ({ sh: -0.95 * amp * sin(p), el: 1.45 });
const runPose = (ph, { amp = 1, lean = 0.26 } = {}) => ({ lean, legs: [legPose(ph, amp), legPose(ph + PI, amp)], arms: [armPose(ph, amp), armPose(ph + PI, amp)], hop: 1.2 * abs(sin(ph)) });
const TUCK = { sh: 0.25, el: 1.75 }, REACH = { sh: 1.25, el: 0.3 };
const DIVE = { lean: 1.38, legs: [{ th: -1.3, kn: 0.15 }, { th: -0.85, kn: 1.1 }], arms: [{ sh: 1.75, el: 0.05 }, { sh: 1.55, el: 0.05 }] };
const DOWN = { lean: -1.35, legs: [{ th: 1.25, kn: 0.3 }, { th: 0.7, kn: 1.0 }], arms: [{ sh: -2.5, el: 0.3 }, { sh: -1.9, el: 0.6 }] };

function head(cx, cy, r, dir, k, tail = 0) {
  if (k.tail) limb([cx - dir * r * 0.7, cy - r * 0.3], [cx - dir * r * 2.3, cy + r * 0.2 + tail], r * 0.42, r * 0.2, k.hair);
  if (k.cap) disc(cx - dir * r * 0.72, cy + r * 0.62, r * 0.42, k.hair);
  oval(cx, cy, r, r, (u, v) => {
    const f = u * dir;
    if (k.cap) return f > 0.35 && v > -0.42 && v < -0.08 ? k.hair : v < -0.08 || f < -0.3 ? (v < -0.6 ? k.cap : f < -0.55 ? k.capD : k.cap) : f < 0 && v > 0.45 ? k.skinD : k.skin;
    return v < -0.3 || f < -0.35 ? k.hair : v > 0.5 && f < 0.1 ? k.skinD : k.skin;
  });
  if (r >= 4.5) { rect(cx + dir * r * 0.42 - 0.5, cy - r * 0.12, 2, 2, WHITE); px(cx + dir * r * 0.42 + (dir > 0 ? 1 : 0) - 0.5, cy - r * 0.12 + 1, INK); span(cy + r * 0.52, min(cx + dir * r * 0.35, cx + dir * r * 0.35 + dir * 2), max(cx + dir * r * 0.35, cx + dir * r * 0.35 + dir * 2), MOUTH); }
  else px(cx + dir * r * 0.5, cy, INK);
}

function figure({ x, ground = 55, hipY, s = 1, dir = 1, kit: k, pose, carry, tail = 0 }) {
  const B = part => BODY[part] * s, { lean = 0.2, legs, arms, hop = 0 } = pose;
  const at = (o, len, a) => [o[0] + sin(a) * len * dir, o[1] + cos(a) * len];
  const reach = legs.map(l => { const knee = at([0, 0], B('thigh'), l.th), ankle = at(knee, B('shin'), l.th - l.kn), toe = at(ankle, B('foot'), l.th - l.kn + PI / 2); return max(ankle[1], toe[1]); });
  const hip = [x, hipY ?? ground - max(...reach) - s - hop * s];
  const leg = legs.map(l => { const knee = at(hip, B('thigh'), l.th), ankle = at(knee, B('shin'), l.th - l.kn), toe = at(ankle, B('foot'), l.th - l.kn + PI / 2); return { knee, ankle, toe }; });
  const sh = [hip[0] + sin(lean) * B('torso') * dir, hip[1] - cos(lean) * B('torso')];
  const hd = [sh[0] + sin(lean) * (B('neck') + B('head')) * dir, sh[1] - cos(lean) * (B('neck') + B('head'))];
  const arm = arms.map(a => { const elbow = at(sh, B('upper'), a.sh), hand = at(elbow, B('fore'), a.sh + a.el); return { elbow, hand }; });
  const drawLeg = (l, far) => {
    limb(hip, l.knee, 1.9 * s, 1.45 * s, t => t < 0.5 ? (far ? k.shortsD : k.shorts) : far ? k.skinD : k.skin);
    limb(l.knee, l.ankle, 1.3 * s, 1.0 * s, t => t < 0.3 ? (far ? k.skinD : k.skin) : far ? k.sockD : k.sock);
    limb(l.ankle, l.toe, 1.0 * s, 0.9 * s, far ? k.bootD : k.boot);
  };
  const drawArm = (a, far) => {
    limb(sh, a.elbow, 1.35 * s, 1.05 * s, t => t < 0.55 ? (far ? k.hoopsD[0] : k.hoops[0]) : far ? k.skinD : k.skin);
    limb(a.elbow, a.hand, 1.0 * s, 0.95 * s, far ? k.skinD : k.skin);
  };
  const mid = (p, q, t = 0.5) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
  let ballAt = null;
  part(() => {
    drawArm(arm[0], true);
    if (carry === 'far') { ballAt = mid(arm[0].elbow, arm[0].hand, 0.8); ballShape(ballAt[0], ballAt[1], 2.7 * s, 0.5 * dir); }
    drawLeg(leg[0], true);
    limb(hip, sh, 2.5 * s, 3.0 * s, t => k.hoops[floor(t * 4.6) & 1]);
    disc(hip[0], hip[1], 2.5 * s, k.shorts);
    drawLeg(leg[1], false);
    head(hd[0], hd[1], B('head'), dir, k, tail);
    if (carry === 'tuck') { ballAt = mid(arm[1].elbow, arm[1].hand, 0.6); ballShape(ballAt[0] - dir * s, ballAt[1], 2.7 * s, 0.5 * dir); }
    drawArm(arm[1], false);
    if (carry === 'two') { ballAt = mid(arm[0].hand, arm[1].hand); ballAt = [ballAt[0] + dir * 1.5 * s, ballAt[1]]; ballShape(ballAt[0], ballAt[1], 2.7 * s, lean > 1 ? 0 : -0.5 * dir); }
  });
  return { hip, shoulder: sh, head: hd, hands: arm.map(a => a.hand), feet: leg.map(l => l.toe), ball: ballAt };
}
const shadow = (x, y, w) => oval(x, y, w, max(1, w * 0.22), GRASS_D);

// --- Places -------------------------------------------------------------------------------------------------------------
function floodlight(x, y, big = false) {
  for (let j = -6; j <= 6; j++) for (let i = -8; i <= 8; i++) { const d = (i * i) / 64 + (j * j) / 36; if (d < 1 && dither(round(x + i), round(y + j), (1 - d) * 0.8)) px(x + i, y + j, HALO); }
  rect(x - 2, y - 1, 5, 3, LAMP); rect(x - 1, y, 3, 1, WHITE);
  const flare = 5 + (hash(F >> 1, x) > 0.5 ? 2 : 0) + (big ? 4 : 0);
  span(y, x - flare, x + flare, LAMP); line(x, y - 3, x, y + 3, LAMP);
}
/** The stadium from the touchline. `cam` is the world x at the left edge. */
function sideField(cam, { tryLine, frenzy = 0 } = {}) {
  for (let y = 0; y < 12; y++) for (let x = 0; x < S; x++) px(x, y, grade(NIGHT, y / 13, x, y));
  for (let i = 0; i < 9; i++) { const x = ((hash(i, 7) * 96 - cam * 0.03) % 96 + 96) % 96, y = hash(i, 8) * 7; if (x < S && hash(i, F >> 2) > 0.25) px(x, y, STARLIGHT); }
  for (let y = 10; y < 30; y++) for (let x = 0; x < S; x++) {
    const wx = floor(x + cam * 0.5), row = y - 10;
    let c = row < 2 ? ROOF : (row & 1) ? STAND : STAND_L;
    if (row >= 2 && ((wx + row) & 1) === 0 && hash(wx, row) > 0.25) c = CROWD[floor(hash(wx, row + 40) * CROWD.length)];
    if (row >= 2 && hash(wx * 3 + row, floor(F / 2) + row * 17) > 0.994 - frenzy * 0.03) c = WHITE;
    px(x, y, c);
  }
  for (let k = -1; k < 3; k++) { const x = ((k * 88 + 30 - cam * 0.25) % 176 + 176) % 176 - 40; if (x > -12 && x < S + 12) { rect(x, 5, 1, 6, STAND_L); floodlight(x, 4); } }
  for (let y = 30; y < 35; y++) for (let x = 0; x < S; x++) {
    const wx = floor(x + cam * 0.85), m = ((wx % 26) + 26) % 26, block = floor(wx / 26);
    px(x, y, m < 1 ? INK : y > 30 && y < 34 && m > 3 && m < 23 && hash(floor(wx / 2) * 2 + block, y) > 0.55 ? WHITE : BOARD[((block % 4) + 4) % 4]);
  }
  for (let y = 35; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = floor(x + cam);
    px(x, y, y === 35 ? GRASS_D : y === 37 ? LINE : hash(wx, y) > 0.94 ? GRASS_D : GRASS[floor(wx / 22) & 1]);
  }
  if (tryLine !== undefined) {
    const x = tryLine - cam;
    for (let y = 37; y < S; y++) span(y, x + (y - 37) * -0.12, x + (y - 37) * -0.12 + 1, LINE);
    part(() => { rect(x + 3, 6, 1, 30, WHITE); rect(x - 1, 2, 2, 40, WHITE); line(x, 22, x + 3, 21, WHITE); rect(x - 2, 36, 4, 7, RED); });
  }
}
/** The pitch from above; it scrolls down the screen, or right to left when `sideways`. */
function topField(scroll, sideways = false) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const along = floor((sideways ? x + scroll : y - scroll)), across = sideways ? y : x, m = ((along % 96) + 96) % 96;
    px(x, y, m < 2 ? LINE : hash(along, across) > 0.95 ? GRASS_D : GRASS[floor(along / 14) & 1]);
  }
}
/** The pitch from behind the runner: stripes rush toward the camera from a vanishing point at `vx`. */
const HORIZON = 22, NEAR = 160;
function chaseField(travel, vx, progress) {
  for (let y = 0; y <= HORIZON - 9; y++) for (let x = 0; x < S; x++) px(x, y, grade(NIGHT, y / 14, x, y));
  for (let i = 0; i < 10; i++) if (hash(i, F >> 2) > 0.3) px(hash(i, 3) * S, hash(i, 4) * 10, STARLIGHT);
  for (let y = HORIZON - 8; y <= HORIZON; y++) for (let x = 0; x < S; x++) {
    const wx = floor(x - vx * 0.6), row = y - HORIZON + 8;
    let c = row < 1 ? ROOF : (row & 1) ? STAND : STAND_L;
    if (row >= 1 && ((wx + row) & 1) === 0 && hash(wx, row) > 0.25) c = CROWD[floor(hash(wx, row + 40) * CROWD.length)];
    if (row >= 1 && hash(wx * 3 + row, floor(F / 2) + row * 17) > 0.985) c = WHITE;
    if (row >= 7) c = BOARD[(floor((wx + 400) / 9) % 4)];
    px(x, y, c);
  }
  floodlight(6 - vx * 0.6 + 19, 8, true); floodlight(57 - vx * 0.6 + 19, 8, true);
  for (let y = HORIZON + 1; y < S; y++) for (let x = 0; x < S; x++) {
    const n = y - HORIZON, d = NEAR / n, lat = abs(x - vx) / n, m = (d + travel) % 60;
    px(x, y, abs(abs(x - vx) - 1.45 * n) < 0.8 ? LINE : lat > 1.45 ? GRASS_D : m < 0.4 + d * 0.05 ? LINE : GRASS[floor((d + travel) / 12) & 1]);
  }
  const h = 7 + 9 * progress, w = h * 0.36;
  rect(vx - w, HORIZON - h, 1, h + 1, WHITE); rect(vx + w, HORIZON - h, 1, h + 1, WHITE); rect(vx - w, HORIZON - h * 0.45, w * 2, 1, WHITE);
}
function rush(count, strength = 1) {
  for (let i = 0; i < count; i++) {
    const a = hash(i, F * 3) * PI * 2, r0 = 24 + hash(i, F * 5) * 10, r1 = r0 + (5 + hash(i, F * 9) * 9) * strength;
    const y0 = 30 + sin(a) * r0 * 0.9, y1 = 30 + sin(a) * r1 * 0.9;
    line(32 + cos(a) * r0 * 1.2, y0, 32 + cos(a) * r1 * 1.2, y1, y0 > HORIZON ? GRASS_L : HALO);
  }
}

// --- Other views of a player --------------------------------------------------------------------------------------------
/** The heroine from behind: scrum cap, shoulders, number 7, and boots kicking up toward the camera. */
function backRunner(cx, ph) {
  const bob = abs(sin(ph)) * 1.6, x = cx + sin(ph) * 1.2, k = HERO;
  ball(x - 11.5, 38 - bob, 3.6, 1.2);
  part(() => {
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const lift = max(0, sin(ph + i * PI)), knee = [x + side * 4, 51 - bob - lift * 2], ankleY = 58.5 - lift * 9;
      limb([x + side * 3.2, 45 - bob], knee, 2.9, 2.4, k.skin);
      if (lift > 0.15) {
        limb(knee, [x + side * 4.2, ankleY], 2.1, 1.9, k.sockD);
        oval(x + side * 4.3, ankleY - 1, 2.5, 1.6 + lift * 2.2, (u, v) => (abs(u) < 0.5 && (abs(v - 0.45) < 0.2 || abs(v + 0.45) < 0.2)) ? WHITE : k.bootD);
      } else {
        limb(knee, [x + side * 4.2, 58], 2.2, 1.8, k.sock);
        oval(x + side * 4.4, 60.5, 2.6, 1.9, k.boot);
      }
    }
    poly([[x - 7, 40 - bob], [x + 7, 40 - bob], [x + 7.5, 47 - bob], [x - 7.5, 47 - bob]], y => y > 45 - bob ? k.shortsD : k.shorts);
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const swing = sin(ph + i * PI), elbow = [x + side * 13, 37 - bob + swing * 1.5];
      limb([x + side * 9.5, 31.5 - bob], elbow, 2.6, 2.1, t => t < 0.6 ? k.hoops[0] : k.skin);
      if (side > 0) limb(elbow, [x + side * 11.5, 36 - bob - swing * 4], 1.9, 1.7, k.skin);
    }
    poly([[x - 10.5, 29 - bob], [x + 10.5, 29 - bob], [x + 7, 41 - bob], [x - 7, 41 - bob]], y => (floor(y - 29 + bob) % 4) === 3 ? k.hoops[1] : k.hoops[0]);
    rect(x - 2, 26 - bob, 5, 4, k.skinD);
  });
  part(() => text('7', x - 2.5, 31 - bob, 2, WHITE), RED_D);
  const hy = 21.5 - bob * 1.2;
  part(() => {
    rect(x - 4, hy + 4, 9, 3, k.hair); px(x - 5, hy + 5, k.hair); px(x + 5, hy + 5, k.hair); px(x - 3, hy + 7, k.hairD); px(x + 1, hy + 7, k.hairD); px(x + 3, hy + 7, k.hair);
    px(x - 7, hy + 1, k.skin); px(x + 7, hy + 1, k.skin);
    oval(x, hy, 6.4, 6, (u, v) => v > 0.72 ? k.capD : (abs(u * 6.4 % 3) < 1 && abs((v * 6 + 6) % 3.2) < 1.1) ? k.capD : v < -0.5 && u < 0 ? CYAN : k.cap);
  });
}
/** A player seen face-on, `h` pixels tall. `arms` is one pose or a [left, right] pair. Returns where the hands are. */
function frontFigure(x, footY, h, k, { arms = 'ready', ph = 0, capOff = false, smile = false } = {}) {
  const u = h / 28, hipY = footY - 11.5 * u, shY = hipY - 8.5 * u, r = 3.5 * u, hy = shY - r - 0.3 * u, sw = 4.4 * u, hands = [];
  part(() => {
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const lift = arms === 'run' ? max(0, sin(ph + i * PI)) * 3 * u : 0, foot = [x + side * 2.5 * u, footY - u - lift];
      limb([x + side * 1.8 * u, hipY], foot, 2.0 * u, 1.25 * u, t => t < 0.35 ? k.shorts : t < 0.6 ? k.skin : k.sock);
      oval(foot[0] + side * 0.3 * u, foot[1] + 0.4 * u, 1.6 * u, 1.05 * u, k.boot);
    }
    poly([[x - sw, shY], [x + sw, shY], [x + 3 * u, hipY + u], [x - 3 * u, hipY + u]], y => y > hipY - 1.2 * u ? k.shorts : k.hoops[floor((y - shY) / max(1, 1.9 * u)) & 1]);
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const mode = Array.isArray(arms) ? arms[i] : arms, sx = x + side * sw, swing = sin(ph + i * PI);
      const [e, hand] = mode === 'up' ? [[sx + side * 2.6 * u, shY - 2.2 * u], [sx + side * 2.2 * u, shY - 7.4 * u]]
        : mode === 'wide' ? [[sx + side * 3.6 * u, shY + 0.6 * u], [sx + side * 7.2 * u, shY - 1.2 * u]]
        : mode === 'run' ? [[sx + side * 1.6 * u, shY + 3.6 * u], [sx + side * 0.6 * u, shY + 3.4 * u - swing * 3 * u]]
        : [[sx + side * 2.4 * u, shY + 3 * u], [sx + side * 4.6 * u, shY + 5.6 * u]];
      limb([sx - side * 0.6 * u, shY + 0.9 * u], e, 1.4 * u, 1.1 * u, t => t < 0.6 ? k.hoops[0] : k.skin);
      limb(e, hand, 1.05 * u, 1.0 * u, k.skin);
      hands.push(hand);
    }
    if (capOff) { oval(x, hy - r * 0.3, r * 1.16, r * 0.9, k.hair); px(x - r * 0.6, hy - r * 1.25 - (ph ? abs(sin(ph)) : 0), k.hair); px(x + r * 0.3, hy - r * 1.3, k.hair); }
    if (k.tail) oval(x, hy + r * 0.3, r * 1.25, r * 1.2, k.hair);
    oval(x, hy, r, r * 1.06, (a, v) => {
      if (capOff) return v < -0.35 + a * 0.25 || (abs(a) > 0.74 && v < 0.3) ? (a < -0.2 && v < -0.5 ? k.hairD : k.hair) : k.skin;
      if (k.cap) return v < -0.22 || (abs(a) > 0.76 && v < 0.55) ? (v < -0.7 ? CYAN : k.cap) : v < -0.05 && abs(a) < 0.55 ? k.hair : k.skin;
      return v < -0.38 ? k.hair : k.skin;
    });
    if (r >= 4.5) {
      for (const side of [-1, 1]) { rect(x + side * r * 0.42 - 0.5, hy - r * 0.05, 1, 2, INK); px(x + side * r * 0.72, hy + r * 0.42, BLUSH); }
      if (smile) { rect(x - 2, hy + r * 0.42, 4, 2, MOUTH); span(hy + r * 0.42, x - 1, x, WHITE); } else span(hy + r * 0.5, x - 1, x, MOUTH);
    } else if (r >= 1.8) { px(x - r * 0.42, hy + r * 0.1, INK); px(x + r * 0.42, hy + r * 0.1, INK); }
  });
  return hands;
}
/** A runner seen from above. `angle` 0 faces up the screen; `dive` stretches them out flat. */
function topFigure(x, y, ph, k, { angle = 0, dive = 0, carry = false, s = 1, wide = 0 } = {}) {
  const fx = sin(angle), fy = -cos(angle), rx = cos(angle), ry = sin(angle);
  const P = (f, r) => [x + (fx * f + rx * r) * s, y + (fy * f + ry * r) * s];
  part(() => {
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const stride = lerp(sin(ph + i * PI), -1, dive), foot = P(-1 + stride * 4.2 - dive * 4, side * 2.2);
      limb(P(-1, side * 2), foot, 1.6 * s, 1.2 * s, t => t < 0.4 ? k.shorts : t < 0.6 ? k.skin : k.sock);
      disc(foot[0], foot[1], 1.25 * s, k.boot);
    }
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const swing = lerp(-sin(ph + i * PI), 1, max(dive, wide)), tucked = carry && side > 0 && !dive;
      const hand = tucked ? P(2.2, 3.4) : P(0.6 + swing * 3.4 + dive * 4, side * (5.2 + wide * 3.5 - dive * 2));
      limb(P(0.4, side * 4.4), hand, 1.4 * s, 1.1 * s, t => t < 0.5 ? k.hoops[0] : k.skin);
    }
    const middle = P(dive * 1.5, 0);
    oval(middle[0], middle[1], 5.4 * s, (2.9 + dive * 2) * s, u => k.hoops[floor((u + 1) * 2.6) & 1], angle);
    if (carry) { const b = P(dive ? 6.5 : 2.6, dive ? 0 : 3.6); ballShape(b[0], b[1], 2.7 * s, angle - PI / 2); }
    const face = P(3 + dive * 3, 0), top = P(1.5 + dive * 3, 0);
    disc(face[0], face[1], 1.5 * s, k.skin);
    disc(top[0], top[1], 2.7 * s, k.cap || k.hair);
    if (k.cap) { const nape = P(-1.2 + dive * 3, 0); px(nape[0], nape[1], k.hair); px(top[0], top[1], CYAN); }
  });
}

// --- The film -----------------------------------------------------------------------------------------------------------
const frames = [];
const shot = (count, draw) => { for (let f = 0; f < count; f++, F++) { target = new Uint8Array(S * S); draw(f, f / (count - 1)); frames.push(target); } };
/** The broadcast strip: score, and a clock that runs out at 80:00 while play goes on. */
function hud(score = '17-19') {
  const seconds = min(4800, 4782 + floor(F / FPS)), time = `${floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, over = seconds >= 4800;
  rect(0, 0, 24, 7, INK); rect(1, 1, 1, 5, RED); text(score, 3, 1, 1, WHITE); rect(22, 1, 1, 5, AMBER);
  rect(43, 0, 21, 7, INK); text(time, 44, 1, 1, over ? ((F >> 2) & 1 ? RED : WHITE) : WHITE);
}

// 0 · The stadium at night. Two points down, time almost up.
shot(36, f => {
  sideField(30 + f * 0.6);
  shift(0, round(34 * (1 - ease(f / 12))));
  if (f < 12) for (let i = 0; i < 14; i++) { const y = hash(i, 91) * 34 * (1 - ease(f / 12)); if (hash(i, F >> 1) > 0.3) px(hash(i, 90) * S, y, STARLIGHT); }
  if (f === 14) target.fill(WHITE);
  if (f > 14) {
    const drop = f < 17 ? (17 - f) * 3 : 0;
    part(() => rect(7, 21 - drop, 50, 26, DARK), GOLD);
    rect(10, 25 - drop, 2, 10, RED); rect(52, 25 - drop, 2, 10, AMBER);
    text('17-19', 13, 25 - drop, 2, WHITE);
    if (f > 19 && f % 6 < 4) centered('LAST PLAY', 39, 1, f % 12 < 6 ? YELLOW : RED);
  }
});

// 1a · Our centre is about to be hit. She pops the ball back.
shot(40, f => {
  const cam = f * 3, ph = f * 0.95, hit = 30, ground = 55;
  sideField(cam);
  const mateX = f < hit ? 38 : 38 - (f - hit) * 2.6, heroX = lerp(-10, 17, ease(f / 26)) + max(0, f - 30) * 0.4, foeX = f < hit ? 78 - f * 34 / hit : mateX + 7;
  for (const x of [mateX, heroX, foeX]) shadow(x, ground + 1, 6);
  const passing = f >= 22;
  const hero = figure({ x: heroX, ground, kit: HERO, pose: { ...runPose(ph + 1.3), arms: f >= 26 ? [REACH, REACH] : runPose(ph + 1.3).arms } });
  figure({ x: mateX, ground, kit: MATE, tail: sin(ph) * 1.5, carry: passing ? null : 'two',
    pose: f >= hit ? { lean: -0.55, legs: [{ th: 0.9, kn: 0.2 }, { th: 0.3, kn: 0.9 }], arms: [{ sh: -1.2, el: 0.4 }, { sh: 1.9, el: 0.3 }] } : { ...runPose(ph), arms: passing ? [{ sh: -1.1, el: 0.3 }, { sh: -0.8, el: 0.3 }] : [{ sh: 0.5, el: 1.3 }, { sh: 0.7, el: 1.3 }] } });
  figure({ x: foeX, ground, dir: -1, kit: FOES[0], pose: f >= hit - 5 ? { lean: 0.95, legs: [{ th: -0.7, kn: 0.3 }, { th: 0.5, kn: 0.9 }], arms: [{ sh: 1.4, el: 0.2 }, { sh: 1.2, el: 0.2 }] } : runPose(ph + 2, { lean: 0.34 }) });
  if (passing) { const t = (f - 22) / 20; ball(lerp(34, hero.hands[1][0] + 3, t), lerp(40, 41, t) - sin(t * PI) * 5, 2.7, f * 0.7); }
  if (f >= hit && f < hit + 4) part(() => star(mateX + 4, 42, 7 - (f - hit), f % 2 ? YELLOW : WHITE, f));
  streaks(5, 36, 62, 8, GRASS_L);
  hud();
  shake(f, hit, 5, 2);
});

// 1b · Slow motion: the ball arrives in her hands.
shot(30, (f, t) => {
  target.fill(NIGHT[1]);
  for (let i = 0; i < 30; i++) { const a = i * PI / 15 + (F >> 1) * 0.37, r0 = 17 + hash(i, F >> 1) * 9; line(32 + cos(a) * r0, 32 + sin(a) * r0, 32 + cos(a) * 50, 32 + sin(a) * 50, i % 3 ? NIGHT[2] : NIGHT[3]); }
  const caught = t > 0.74, bx = lerp(17, 35, ease(t * 1.3)), by = 31 - sin(min(1, t * 1.3) * PI) * 3;
  part(() => {
    const hx = bx - 12 - t * 16;
    limb([-6, 47], [hx, 37], 5, 4.2, t2 => t2 < 0.35 ? HERO.hoops[0] : MATE.skin);
    disc(hx + 2, 35.5, 4.4, MATE.skin);
    for (let i = 0; i < 4; i++) limb([hx + 3, 33 + i * 2], [hx + 8.5, 30 + i * 2.6], 1.3, 1.1, i === 3 ? MATE.skinD : MATE.skin);
  });
  part(() => {
    const hx = lerp(62, bx + 10, ease(t * 1.35));
    limb([70, 49], [hx + 2, 35], 5.2, 4.2, t2 => t2 < 0.3 ? (floor(t2 * 20) & 1 ? WHITE : RED) : HERO.skin);
    limb([56, 70], [bx + 5, by + 12], 5, 4, t2 => t2 < 0.3 ? RED : HERO.skin);
  });
  ball(bx, by, 11, -0.25 + t * 0.5);
  part(() => {
    const hx = lerp(62, bx + 10, ease(t * 1.35)), curl = caught ? 1 : 0;
    disc(hx, 33, 4.6, HERO.skin);
    for (let i = 0; i < 4; i++) limb([hx - 2, 29.5 + i * 2.2], [hx - 8 + curl * 1.5, 26.5 + i * 3 + curl * (i - 1.5)], 1.4, 1.15, HERO.skin);
    disc(bx + 4, by + 9, 4.2, HERO.skin);
    for (let i = 0; i < 3; i++) limb([bx + 2 - i * 2.4, by + 8], [bx - 1 - i * 3, by + 4.5 - curl], 1.4, 1.15, i ? HERO.skin : HERO.skinD);
  });
  if (caught) { const a = f - round(0.74 * 29); if (a < 2) target.fill(a ? YELLOW : WHITE); else for (let i = 0; i < 6; i++) part(() => star(bx + cos(i + a * 0.3) * (9 + a * 2.2), by + sin(i + a * 0.3) * (7 + a * 1.6), max(1, 3.5 - a * 0.4), i % 2 ? YELLOW : WHITE, a), 0); }
  letterbox(6);
});

// 1c · Eyes up.
shot(18, f => {
  const k = HERO, set = ramp(f, 4, 9), IRIS = C('#39c27a'), IRIS_D = C('#1f7a4d');
  target.fill(k.skin);
  for (let y = 14; y < 50; y++) for (let x = 0; x < S; x++) if ((x < 5 || x > 58) && dither(x, y, 0.6)) px(x, y, k.skinD);
  rect(0, 14, S, 8, k.cap); rect(0, 21, S, 2, k.capD);
  for (let x = 2; x < S; x += 6) rect(x, 16, 3, 3, k.capD);
  for (const [x, w, h] of [[6, 7, 5], [15, 5, 3], [41, 6, 4], [50, 8, 6], [27, 4, 2]]) poly([[x, 23], [x + w, 23], [x + w * 0.3, 23 + h]], k.hair);
  rect(30, 34, 4, 16, k.skinD); rect(31, 34, 2, 16, k.skin);
  for (const [cx, side] of [[18, -1], [46, 1]]) {
    const open = 4.4 - set * 1.3, look = lerp(-2.5, 1, set);
    limb([cx + side * 9, 28], [cx - side * 8, 28.5 + set * 3], 1.5, 1.1, k.hairD);
    part(() => oval(cx, 38, 7.5, open, WHITE));
    oval(cx + look, 38, 3.4, min(open, 3.4), (u, v) => u * u + v * v > 0.55 ? IRIS_D : IRIS);
    disc(cx + look, 38, 1.5, INK); px(cx + look - 1, 37, WHITE); px(cx + look + 2, 36 + (f & 1), LAMP);
    span(38 - open - 1, cx - 7, cx + 7, INK);
    for (const [fx, fy] of [[-5, 45], [-2, 47], [3, 46], [6, 44]]) px(cx + fx, fy, k.skinD);
  }
  if (f >= 9 && f < 12) part(() => star(50, 35, 6 - (f - 9) * 1.5, WHITE, f * 0.6, 4), 0);
  letterbox(14);
  if (f >= 9) { streaks(4, 2, 12, 22, f % 2 ? CYAN : WHITE, 3); streaks(4, 52, 62, 22, f % 2 ? MAGENTA : WHITE, 9); }
  if (f === 17) target.fill(WHITE);
});

// 1d · Gone.
shot(30, f => {
  const speed = 2.5 + f * 0.12, cam = 400 + f * 2.5 + f * f * 0.06, ph = f * 1.15, ground = 55;
  sideField(cam);
  const pile = 30 - (cam - 400);
  if (pile > -24) { shadow(pile + 4, ground + 1, 10); figure({ x: pile, hipY: ground - 3, kit: MATE, pose: DOWN }); figure({ x: pile + 13, hipY: ground - 5, dir: -1, kit: FOES[0], pose: { ...DIVE, lean: 1.2 } }); }
  const heroX = lerp(12, 30, ease(f / 24));
  shadow(heroX, ground + 1, 6);
  const layer = capture(() => figure({ x: heroX, ground, kit: HERO, carry: 'tuck', pose: { ...runPose(ph, { lean: 0.42 }), arms: [armPose(ph), TUCK] } }));
  stamp(layer, -speed * 3, 0, MAGENTA, 0); stamp(layer, -speed * 1.6, 0, CYAN, 1); stamp(layer);
  for (let i = 0; i < 3; i++) spray(heroX - 4 - i * 6, ground, (f + i * 3) % 6, -1, GRASS_L, 3, i + (f / 6 | 0));
  streaks(4 + f / 4, 12, 34, 14, HALO, 2); streaks(5 + f / 3, 37, 63, 12, GRASS_L);
  hud();
  if (f < 2) target.fill(f ? CYAN : WHITE);
});

// 2 · From behind her: three defenders ahead, and the posts beyond them.
shot(140, (f, t) => {
  const vx = 32 + sin(f * 0.07) * 4 - 6 * ramp(f, 112, 140), ph = f * 1.1;
  chaseField(f * 3.4, vx, t);
  rush(7 + t * 6, 1 + t);
  const threats = [[200, 30, -2.9, 2], [170, 13, 1.45, 1], [140, 6.6, -1.05, 0]].map(([from, to, side, kit]) => ({ d: lerp(from, to, t ** 1.6), side, kit }));
  for (const { d, side, kit } of threats) {
    const h = NEAR / d * 1.05, x = vx + side * h, footY = HORIZON + NEAR / d;
    if (h > 5) oval(x, footY, h * 0.3, max(1, h * 0.06), GRASS_D);
    frontFigure(x, footY, h, FOES[kit], { arms: f > 122 && kit === 0 ? 'wide' : 'run', ph: f * 1.2 + kit * 2 });
  }
  oval(32, 62, 11, 2, GRASS_D);
  backRunner(32, ph);
  for (let i = 0; i < 2; i++) spray(28 + i * 8, 62, (f + i * 3) % 6, i ? 1 : -1, GRASS_L, 3, i + (f / 6 | 0));
  hud();
  if (f < 2) target.fill(f ? CYAN : WHITE);
  if (f > 128) shake(f, 129, 12, 1);
  if (f === 139) target.fill(WHITE);
});

// 3a · Defender one: the sidestep.
shot(60, f => {
  const heroX = g => 22 + 26 * ramp(g, 19, 26) - 14 * ramp(g, 40, 56), ph = f * 1.2;
  topField(f * 3.2);
  for (let i = 0; i < 6; i++) { const x = hash(i, F * 5) * S, y = hash(i, F * 11) * S; line(x, y, x, y + 7, GRASS_L); }
  const foeY = -34 + f * 3.2, dive = ramp(f, 17, 23), foeX = 22 + 3 * ramp(f, 14, 22);
  oval(foeX + 2, foeY + 2, 6, 5, GRASS_D);
  if (f > 22) for (let i = 0; i < 2; i++) spray(foeX + (i ? 5 : -5), foeY - 4, f - 23 - i, i ? 1 : -1, GRASS_L, 6, i);
  topFigure(foeX, foeY, ph, FOES[0], { angle: PI, dive, s: 1.4 });
  const y = 42, lean = (heroX(f + 1) - heroX(f - 1)) * 0.09;
  oval(heroX(f) + 2, y + 3, 8, 6, GRASS_D);
  if (f >= 19 && f < 34) for (const [n, c] of [[4, MAGENTA], [2, CYAN]]) stamp(capture(() => topFigure(heroX(f - n), y, ph - n, HERO, { carry: true, s: 1.4 })), 0, n * 1.5, c, n >> 1);
  topFigure(heroX(f), y, ph, HERO, { carry: true, angle: lean, s: 1.4 });
  if (f >= 19 && f < 27) for (let i = 0; i < 4; i++) span(y - 4 + i * 3, heroX(f) - 14 - i * 2, heroX(f) - 8, WHITE);
  hud();
  shout('STEP!', f, 25, 8);
  if (f < 2) target.fill(f ? WHITE : INK);
});

// 3b · Defender two: the fend.
shot(60, f => {
  const cam = 900 + f * 4, ph = f * 1.15, ground = 61, s = 1.5, hit = 18, heroX = 21;
  sideField(cam);
  streaks(7, 12, 34, 16, HALO, 2); streaks(7, 37, 63, 14, GRASS_L);
  const foeX = f < hit ? 80 - f * 37 / hit : 43 - (f - hit) * 3.6, fallen = ramp(f, hit, hit + 5);
  const fend = ramp(f, 11, 17) * (1 - ramp(f, 26, 34)), base = runPose(ph, { lean: 0.34 });
  const actors = () => {
    figure({ x: foeX, ground: ground - 2, hipY: f >= hit ? lerp(ground - 22, ground - 6, fallen) : undefined, s, dir: -1, kit: FOES[1],
      pose: f >= hit ? { lean: lerp(0.3, -1.3, fallen), legs: [{ th: 1.3 * fallen + 0.2, kn: 0.3 }, { th: 0.8 * fallen, kn: 0.9 }], arms: [{ sh: 2.2, el: 0.4 }, { sh: 1.4 + fallen, el: 0.5 }] } : { ...runPose(ph + 2, { lean: 0.4 }), arms: f > 10 ? [REACH, REACH] : runPose(ph + 2).arms } });
    return figure({ x: heroX, ground, s, kit: HERO, carry: 'far', pose: { ...base, arms: [TUCK, { sh: lerp(base.arms[1].sh, 1.5, fend), el: lerp(1.45, 0.05, fend) }] } });
  };
  shadow(heroX, ground + 1, 9); if (f < hit) shadow(foeX, ground, 9);
  if (f === hit || f === hit + 1) {
    const layer = capture(actors);
    target.fill(f === hit ? WHITE : INK);
    for (let i = 0; i < 16; i++) { const a = i * PI / 8; line(38 + cos(a) * 9, 30 + sin(a) * 9, 38 + cos(a) * 60, 30 + sin(a) * 60, f === hit ? INK : YELLOW); }
    stamp(layer, 0, 0, f === hit ? INK : WHITE);
    part(() => star(38, 30, 8, f === hit ? RED : YELLOW, 0.3, 7));
  } else {
    const hero = actors();
    if (f > hit + 1 && f < hit + 7) part(() => star(hero.hands[1][0] + 3, hero.hands[1][1], 8 - (f - hit), f % 2 ? YELLOW : WHITE, f * 0.5, 7));
    if (f > hit) spray(foeX, ground, f - hit - 3, -1, GRASS_L, 8, 4);
    hud();
  }
  shout('FEND!', f, hit + 3);
  shake(f, hit + 2, 7, 2);
});

// 3c · Defender three: the spin.
shot(60, f => {
  const s = 1.45, turn = g => ramp(g, 13, 31), heroAt = g => [24 + 5 * turn(g), 34 - 13 * sin(turn(g) * PI)], angle = g => PI / 2 + turn(g) * PI * 2, ph = f * 1.2;
  topField(f * 3.4, true);
  for (let i = 0; i < 6; i++) { const x = hash(i, F * 5) * S, y = hash(i, F * 11) * S; span(y, x, x + 8, GRASS_L); }
  if (f > 40) { const x = 64 + (46 - f) * 3.4 + 40; rect(x, 0, 2, S, LINE); for (let y = 0; y < S; y++) for (let i = max(0, round(x + 2)); i < S; i++) if ((i + y) & 1) px(i, y, GRASS_D); }
  const foeX = 86 - f * 3.1, dive = ramp(f, 14, 20);
  oval(foeX + 2, 36, 8, 6, GRASS_D);
  if (f > 20) for (let i = 0; i < 2; i++) spray(foeX + 8, 34 + (i ? 6 : -6), f - 21 - i, 1, GRASS_L, 6, i + 7);
  topFigure(foeX, 34, ph, FOES[2], { angle: -PI / 2, dive, wide: 1 - dive, s });
  const [x, y] = heroAt(f), spinning = f >= 13 && f < 33;
  oval(x + 2, y + 3, 8, 6, GRASS_D);
  if (spinning) {
    for (const [n, c] of [[3, MAGENTA], [1.5, CYAN]]) { const [gx, gy] = heroAt(f - n); stamp(capture(() => topFigure(gx, gy, ph, HERO, { carry: true, angle: angle(f - n), s })), 0, 0, c, n > 2 ? 0 : 1); }
    for (let i = 0; i < 10; i++) { const a = angle(f) - 1 - i * 0.28, r = 13 + (i & 1); px(x + sin(a) * r, y - cos(a) * r, WHITE); px(x + sin(a + PI) * (r - 2), y - cos(a + PI) * (r - 2), CYAN); }
  }
  topFigure(x, y, ph, HERO, { carry: true, angle: angle(f), s });
  hud();
  shout('SPIN!', f, 28);
  if (f < 2) target.fill(f ? WHITE : INK);
});

// 4a · Nothing but grass, and one last chaser at her heels.
shot(36, f => {
  const cam = 1500 + f * 5, ph = f * 1.25, ground = 55, heroX = 27 + f * 0.15;
  sideField(cam, { tryLine: 1500 + 36 * 5 + 62, frenzy: 0.5 });
  streaks(9, 12, 34, 18, HALO, 2); streaks(9, 37, 63, 16, GRASS_L);
  const lunge = ramp(f, 12, 19), down = ramp(f, 19, 25), foeX = lerp(2, 13, ramp(f, 0, 16)) - max(0, f - 20) * 3.4;
  shadow(foeX, ground + 1, 7); shadow(heroX, ground + 1, 6);
  figure({ x: foeX, ground, hipY: f >= 12 ? lerp(ground - 13, ground - 3, down) : undefined, kit: FOES[2], pose: f >= 12 ? { lean: lerp(0.4, 1.4, lunge), legs: DIVE.legs, arms: DIVE.arms } : runPose(ph + 1, { lean: 0.42 }) });
  if (f > 22) spray(foeX + 8, ground, f - 23, 1, GRASS_L, 7, 3);
  const leap = ramp(f, 30, 35), base = runPose(ph, { lean: 0.44 });
  const layer = capture(() => figure({ x: heroX, ground: ground - leap * 5, kit: HERO, carry: leap > 0.4 ? 'two' : 'tuck', pose: leap > 0.4 ? { ...DIVE, lean: lerp(0.5, 1.1, leap) } : { ...base, arms: [armPose(ph), TUCK] } }));
  stamp(layer, -8, 0, MAGENTA, 0); stamp(layer, -4, 0, CYAN, 1); stamp(layer);
  spray(heroX - 5, ground, f % 5, -1, GRASS_L, 4, f / 5 | 0);
  hud();
  if (f < 2) target.fill(f ? WHITE : INK);
});

// 4b · Slow motion: the dive.
shot(54, f => {
  const cam = 1716 + f * 0.7, ground = 58, s = 1.5, land = 30, air = clamp(f / land), slide = ramp(f, land, land + 12);
  sideField(cam, { tryLine: 1716 + 54, frenzy: 0.6 + f / 54 });
  if (f < land) { streaks(10, 11, 34, 30, HALO, 2); streaks(8, 37, 63, 26, GRASS_L); }
  const x = lerp(-2, 28, air) + slide * 7, hipY = f < land ? lerp(35, ground - 5, air * air) - sin(air * PI) * 7 : ground - 5;
  oval(x + 12, ground + 2, 14 - (ground - hipY) * 0.2, 2, GRASS_D);
  const pose = { ...DIVE, lean: f < land ? lerp(1.15, 1.45, air) : 1.5, legs: f < land ? DIVE.legs : [{ th: -1.45, kn: 0.1 }, { th: -1.3, kn: 0.6 - slide * 0.4 }] };
  const layer = capture(() => figure({ x, hipY, s, kit: HERO, carry: 'two', pose }));
  if (f < land) { stamp(layer, -9, -2, MAGENTA, 0); stamp(layer, -5, -1, CYAN, 1); }
  stamp(layer);
  if (f >= land) { for (let i = 0; i < 3; i++) spray(x + 6 + i * 8, ground, f - land - i, i === 1 ? -1 : 1, i === 1 ? LINE : GRASS_L, 9, i + 20); if (f < land + 12) streaks(3, ground - 1, ground + 3, 10, GRASS_L, 5); }
  if (f === land) part(() => star(x + 26, ground - 3, 9, WHITE, 0.2, 8), 0);
  letterbox(5);
  shake(f, land, 8, 2);
  if (f > 46) for (let y = 0; y < S; y++) for (let i = 0; i < S; i++) if (dither(i, y, (f - 46) / 7)) px(i, y, WHITE);
});

// 4c · The scoreboard.
shot(36, f => {
  const PANEL = C('#0a0a18'), DOT = C('#17172e');
  target.fill(PANEL);
  for (let y = 1; y < S; y += 2) for (let x = 1; x < S; x += 2) px(x, y, DOT);
  for (let i = 0; i < 31; i++) for (const [x, y] of [[i * 2 + 1, 1], [i * 2 + 1, 62], [1, i * 2 + 1], [62, i * 2 + 1]]) px(x, y, ((i + (F >> 1)) % 3) ? GOLD_D : YELLOW);
  const scored = f >= 12;
  text('HOME', 6, 27, 1, RED); text('AWAY', 43, 27, 1, AMBER);
  text(scored ? '22' : '17', 7, 35, 2, scored && f % 4 < 2 ? YELLOW : WHITE); text('-', 29, 35, 2, GOLD_D); text('19', 44, 35, 2, WHITE);
  centered('80:00', 52, 1, f % 6 < 3 ? RED : RED_D);
  if (!scored) { if (f % 6 < 4) centered('LAST PLAY', 11, 1, YELLOW); }
  else {
    const pop = f < 15 ? 15 - f : 0;
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + f * 0.25; part(() => star(32 + cos(a) * 26, 13 + sin(a) * 9, 2 + (i + f) % 3, i % 2 ? YELLOW : WHITE, f * 0.3, 4), 0); }
    part(() => text('TRY!', 10 + (pop & 1 ? 1 : 0), 5 - pop, 3, f % 4 < 2 ? YELLOW : WHITE), RED);
  }
  if (f === 12 || f === 13) target.fill(f === 12 ? WHITE : YELLOW);
  if (f < 3) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (dither(x, y, 1 - f / 3)) px(x, y, WHITE);
});

// 5 · Full time. The cap comes off.
const BLONDE = { ...MATE, skin: HERO.skin, skinD: HERO.skinD, hair: C('#f2d16b'), tail: false };
shot(120, f => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < S; x++) px(x, y, grade(NIGHT, y / 17, x, y));
  for (const [x, y, at, colors] of [[14, 9, 4, [RED, YELLOW]], [50, 7, 16, [CYAN, WHITE]], [31, 5, 30, [GOLD, MAGENTA]], [9, 6, 46, [CYAN, YELLOW]], [54, 10, 58, [RED, WHITE]], [28, 8, 72, [MAGENTA, YELLOW]], [45, 5, 86, [GOLD, WHITE]], [16, 8, 98, [RED, CYAN]], [38, 7, 108, [YELLOW, WHITE]]]) firework(x, y, f - at, colors);
  for (let y = 14; y < 40; y++) for (let x = 0; x < S; x++) {
    const row = y - 14, jump = hash(x >> 1, row >> 1) > 0.5 && ((F + x) >> 2) & 1 ? 1 : 0, r = row + jump;
    let c = (r & 1) ? STAND : STAND_L;
    if (((x + r) & 1) === 0 && hash(x, r) > 0.2) c = CROWD[floor(hash(x, r + 40) * CROWD.length)];
    if (hash(x * 3 + row, floor(F / 2) + row * 17) > 0.975) c = WHITE;
    px(x, y, c);
  }
  floodlight(4, 13, true); floodlight(59, 13, true);
  for (let y = 40; y < 44; y++) for (let x = 0; x < S; x++) px(x, y, (x % 16) === 0 ? INK : BOARD[(x >> 4) % 4]);
  for (let y = 44; y < S; y++) for (let x = 0; x < S; x++) px(x, y, y === 45 ? LINE : hash(x, y) > 0.95 ? GRASS_D : GRASS[floor((x - 32) / (5 + (y - 44) * 0.45) + 20) & 1]);
  const off = ramp(f, 26, 36), hop = abs(sin(f * 0.5)) * (f > 36 ? 4 : 2), run = ramp(f, 46, 66);
  for (const [side, kit, lag] of [[-1, MATE, 0], [1, BLONDE, 2]]) {
    const x = 32 + side * lerp(48, 19, run), jump = run >= 1 ? abs(sin((f + lag) * 0.55)) * 4 : 0;
    oval(x, 60, 6, 1.5, GRASS_D);
    frontFigure(x, 59 - jump, 33, kit, { arms: run >= 1 ? 'up' : 'run', ph: f * 1.2 + lag, smile: true });
  }
  oval(32, 63, 9, 2, GRASS_D);
  const hands = frontFigure(32, 63 - hop, 40, HERO, { arms: f < 22 ? 'up' : ['up', f < 26 ? 'ready' : 'up'], capOff: off > 0.5, smile: true, ph: f * 0.5 });
  if (f < 22) ball((hands[0][0] + hands[1][0]) / 2, hands[0][1] - 3, 6, 0.1);
  else {
    ball(hands[0][0] - 1, hands[0][1] - 4, 5.5, -0.4);
    if (off > 0.5) part(() => { const [x, y] = hands[1]; oval(x + 1, y - 3, 4.5, 3.2, (u, v) => v > 0.5 ? HERO.capD : v < -0.4 && u < 0 ? CYAN : HERO.cap, 0.3 + sin(f * 0.5) * 0.3); });
  }
  if (f >= 34 && f < 38) part(() => star(32, 22, 9 - (f - 34) * 2, WHITE, f, 6), 0);
  for (let i = 0; i < 46; i++) { const x = hash(i, 1) * S + sin(F * 0.25 + i) * 2.5, y = ((hash(i, 2) * 80 + F * (0.7 + hash(i, 3))) % 80) - 8; if (f > 8) px(x, y, [RED, WHITE, GOLD, CYAN][i % 4]); }
  if (f >= 60) {
    const a = f - 60, drop = a < 4 ? (4 - a) * 4 : 0;
    if (f < 112 || f % 4 < 3) part(() => text('FULL TIME', round((S - textWidth('FULL TIME')) / 2), 2 - drop, 1, a % 8 < 4 ? YELLOW : WHITE));
    if (f >= 74) part(() => text('22-19', round((S - textWidth('22-19')) / 2), 9, 1, WHITE), RED_D);
  }
  if (f < 3) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (dither(x, y, 1 - f / 3)) px(x, y, WHITE);
});

// --- Output -------------------------------------------------------------------------------------------------------------
function png(width, height, rgb) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out; };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A contact sheet, each frame enlarged four times. */
function sheet(indexes) {
  const Z = 4, cell = S * Z, columns = min(indexes.length, 4), rows = Math.ceil(indexes.length / columns), gap = 4, width = gap + columns * (cell + gap), height = gap + rows * (cell + gap), out = Buffer.alloc(width * height * 3, 40);
  const colors = [[8, 10, 28], ...palette.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)))];
  indexes.forEach((index, n) => {
    const left = gap + (n % columns) * (cell + gap), top = gap + floor(n / columns) * (cell + gap), frame = frames[index];
    if (frame) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) out.set(colors[frame[floor(y / Z) * S + floor(x / Z)]], ((top + y) * width + left + x) * 3);
  });
  return png(width, height, out);
}

const [preview, ...wanted] = process.argv.slice(2);
if (preview) await writeFile(preview, sheet(wanted.length ? wanted.map(Number) : Array.from({ length: 16 }, (_, i) => round(i * (frames.length - 1) / 15))));
const animation = { version: 2, name: 'Rugby run', size: S, fps: FPS, trigger: 50, background: '#080a1c', palette, frames };
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rugby-run.ahanim'), bytes = await encodeAnimation(animation);
await writeFile(file, bytes);
console.log(`${frames.length} frames · ${(frames.length / FPS).toFixed(1)}s · ${palette.length} colors · ${fileSize(bytes.length)} → ${file}`);
