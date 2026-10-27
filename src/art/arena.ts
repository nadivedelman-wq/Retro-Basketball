/**
 * Original arena art generated at load time: hardwood floor with perspective-correct
 * markings, painted key and centre logo in the home team's colours, bleachers full of
 * animated fans, sponsor-free scorer's rail, hoops and nets.
 */
import { DZ, MARGIN, VIEW_H, WORLD_W, Y0, hsAt, projX, projY, sAt } from '../game/render/projection';
import { PixelBuffer, drawText, hexToRgba, noise2, shade, type RGBA } from './pixels';
import { textWidth } from './font';
import { SKIN_TONES } from './playerSprite';

export type ArenaSpec = { primary: string; secondary: string; abbr: string; city: string; awayPrimary: string; leagueName: string; seed: number };

const RIM_X = [5.25, 88.75];

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];
}

/** Pixel distance from court point (x,z) to the circle (cx,cz,R), given local scale. */
function circleErr(x: number, z: number, cx: number, cz: number, R: number, sx: number) {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / d;
  const uz = dz / d;
  return { err: Math.abs(d - R) * Math.hypot(ux * sx, uz * DZ), dx, dz, d };
}

function isLine(x: number, z: number): boolean {
  const sx = sAt(z);
  const H = 0.5;
  const V = 0.62;
  const inX = x >= -0.1 && x <= 94.1;
  const inZ = z >= -0.1 && z <= 50.1;
  // Boundary
  if (inX && (Math.abs(z) * DZ < H || Math.abs(z - 50) * DZ < H)) return true;
  if (inZ && (Math.abs(x) * sx < V || Math.abs(x - 94) * sx < V)) return true;
  if (inZ && Math.abs(x - 47) * sx < V) return true;
  // Centre circle
  if (circleErr(x, z, 47, 25, 6, sx).err < 0.55) return true;
  for (const side of [0, 1]) {
    const bx = side === 0 ? 0 : 94;
    const toward = side === 0 ? 1 : -1;
    const fromBase = (x - bx) * toward; // ft from this baseline into the court
    const rx = RIM_X[side];
    // Key
    if (fromBase >= 0 && fromBase <= 19 && (Math.abs(z - 17) * DZ < H || Math.abs(z - 33) * DZ < H)) return true;
    if (z >= 17 && z <= 33 && Math.abs(fromBase - 19) * sx < V) return true;
    // Free-throw circle (top half solid)
    const ft = circleErr(x, z, bx + toward * 19, 25, 6, sx);
    if (ft.err < 0.55 && ft.dx * toward > 0) return true;
    // Three-point line
    if (fromBase >= 0 && fromBase <= 14 && (Math.abs(z - 3) * DZ < H || Math.abs(z - 47) * DZ < H)) return true;
    const arc = circleErr(x, z, rx, 25, 23.75, sx);
    if (arc.err < 0.6 && fromBase >= 14 && z > 2.5 && z < 47.5) return true;
    // Restricted area
    const ra = circleErr(x, z, rx, 25, 4, sx);
    if (ra.err < 0.5 && ra.dx * toward > 0) return true;
    // Lane hash marks
    if (fromBase >= 7 && fromBase <= 7.4 && ((z > 15.6 && z < 17) || (z > 33 && z < 34.4))) return true;
    if (fromBase >= 11 && fromBase <= 11.4 && ((z > 15.6 && z < 17) || (z > 33 && z < 34.4))) return true;
  }
  return false;
}

function inKey(x: number, z: number) {
  return z > 17 && z < 33 && (x < 19 || x > 75) && x > 0 && x < 94;
}

export function buildFloor(spec: ArenaSpec): HTMLCanvasElement {
  const b = new PixelBuffer(WORLD_W, VIEW_H);
  const woodA = hexToRgba('#c98f52');
  const woodB = hexToRgba('#bf8447');
  const woodC = hexToRgba('#d39a5c');
  const seam = hexToRgba('#9c6a37');
  const paint = hexToRgba(spec.primary);
  const line = hexToRgba('#f7f1e3');
  const apron = hexToRgba(shade(spec.primary, -0.35));
  const apronEdge = hexToRgba(shade(spec.primary, -0.5));
  const outer = hexToRgba('#2b2230');
  const centre = hexToRgba(spec.secondary);
  const top = Y0 - 9;
  for (let py = top; py < VIEW_H; py++) {
    const z = (py + 0.5 - Y0) / DZ;
    const sx = sAt(z);
    for (let px = 0; px < WORLD_W; px++) {
      const x = 47 + (px + 0.5 - WORLD_W / 2) / sx;
      let c: RGBA;
      const onCourt = x >= 0 && x <= 94 && z >= 0 && z <= 50;
      if (onCourt) {
        const stripe = Math.floor(py / 2);
        const offset = noise2(stripe, 7, spec.seed) * 60;
        const plank = Math.floor((px + offset) / 46);
        const n = noise2(plank, stripe, spec.seed);
        c = n < 0.33 ? woodA : n < 0.66 ? woodB : woodC;
        if ((px + Math.floor(offset)) % 46 === 0) c = seam;
        if (noise2(px, py, spec.seed + 1) < 0.06) c = mix(c, seam, 0.4);
        if (inKey(x, z)) c = mix(c, paint, 0.62);
        const cd = Math.hypot(x - 47, z - 25);
        if (cd < 6) c = mix(c, centre, cd < 5.3 ? 0.35 : 0.15);
      } else if (x > -7 && x < 101 && z > -3.2 && z < 54) {
        c = apron;
        if (z < -2.6 || z > 53.3) c = apronEdge;
      } else {
        c = outer;
      }
      if (isLine(x, z)) c = line;
      b.set(px, py, c);
    }
  }
  // Centre-court logo: the home abbreviation over a stripe.
  const cy = Math.round(projY(25)) - 3;
  const label = spec.abbr.toUpperCase();
  const tw = textWidth(label) * 2;
  drawText(b, label, Math.round(WORLD_W / 2 - tw / 2) + 1, cy - 6, hexToRgba(shade(spec.primary, -0.5)), 2);
  drawText(b, label, Math.round(WORLD_W / 2 - tw / 2), cy - 7, hexToRgba(spec.primary), 2);
  // City name on the near apron and league name on the far apron.
  const city = spec.city.toUpperCase();
  drawText(b, city, Math.round(WORLD_W / 2 - textWidth(city) / 2), Math.round(projY(51.4)), hexToRgba(shade(spec.secondary, 0.1)));

  drawWall(b, spec);
  for (const side of [0, 1]) drawHoopBack(b, side);
  drawForeground(b, spec);
  return b.toCanvas();
}

function drawWall(b: PixelBuffer, spec: ArenaSpec) {
  const railTop = Y0 - 17;
  // Back wall gradient
  for (let y = 0; y < railTop; y++) {
    const t = y / railTop;
    const c = mix(hexToRgba('#120e18'), hexToRgba('#2a2236'), t);
    b.rect(0, y, WORLD_W, 1, c);
  }
  // Bleacher steps (fans are drawn on separate animated layers).
  for (let row = 0; row < 9; row++) {
    const y = 14 + row * 7;
    b.rect(0, y + 5, WORLD_W, 1, hexToRgba(row % 2 ? '#3a3046' : '#342a40'));
  }
  // Scorer's rail / LED board with original text.
  b.rect(0, railTop, WORLD_W, 8, hexToRgba('#15111c'));
  b.rect(0, railTop, WORLD_W, 1, hexToRgba('#4a3f5c'));
  b.rect(0, railTop + 7, WORLD_W, 1, hexToRgba('#0b0910'));
  const msgs = [spec.city.toUpperCase(), 'DEFENSE!', spec.leagueName.toUpperCase(), 'MAKE SOME NOISE', `GO ${spec.abbr}`];
  let x = 10;
  let i = 0;
  while (x < WORLD_W) {
    const m = msgs[i % msgs.length];
    const col = i % 2 ? hexToRgba(spec.secondary) : hexToRgba('#ffcf4a');
    drawText(b, m, x, railTop + 1, col);
    x += textWidth(m) + 24;
    b.rect(x - 13, railTop + 3, 2, 2, hexToRgba(spec.primary));
    i++;
  }
  // Floor between rail and court
  b.rect(0, railTop + 8, WORLD_W, 1, hexToRgba('#1c1724'));
}

/** Stanchion, backboard and the back half of the rim, baked into the floor layer. */
function drawHoopBack(b: PixelBuffer, side: number) {
  const toward = side === 0 ? 1 : -1;
  const baseX = side === 0 ? -4.2 : 98.2;
  const boardX = side === 0 ? 4 : 90;
  const pad = hexToRgba('#2c2f3a');
  const padHi = hexToRgba('#4b5163');
  const pole = hexToRgba('#9aa3b5');
  // Base block on the floor behind the baseline.
  const bx = Math.round(projX(baseX, 25));
  const by = Math.round(projY(25));
  b.rect(bx - 7, by - 9, 14, 10, pad);
  b.rect(bx - 7, by - 9, 14, 2, padHi);
  // Pole up and arm out to the board.
  const topH = 13.6;
  const px0 = bx;
  const py0 = by - 9;
  const py1 = Math.round(projY(25, topH));
  b.line(px0 - 1, py0, px0 - 1, py1, pole, 3);
  const armEndX = Math.round(projX(boardX - toward * 0.3, 25));
  const armY = Math.round(projY(25, 11.2));
  b.line(px0, py1, armEndX, armY, pole, 2);
  b.line(px0, py1 + 3, armEndX, armY + 2, pole, 1);
  // Backboard: plane x = boardX, z 22..28, h 9.6..13.2
  const corners = [
    [projX(boardX, 22), projY(22, 13.2)],
    [projX(boardX, 28), projY(28, 13.2)],
    [projX(boardX, 28), projY(28, 9.6)],
    [projX(boardX, 22), projY(22, 9.6)],
  ];
  const glass = hexToRgba('#dfe9f2', 210);
  const frame = hexToRgba('#f4f4f4');
  // Fill by scanning the parallelogram.
  for (let z = 22; z <= 28; z += 0.05) {
    const x = Math.round(projX(boardX, z));
    const y0 = Math.round(projY(z, 13.2));
    const y1 = Math.round(projY(z, 9.6));
    b.line(x, y0, x, y1, glass, 2);
  }
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [cx, cy] = corners[(i + 1) % 4];
    b.line(ax, ay, cx, cy, frame, 1);
  }
  // Shooter's square
  const sq = [
    [projX(boardX, 24), projY(24, 11.4)],
    [projX(boardX, 26), projY(26, 11.4)],
    [projX(boardX, 26), projY(26, 10)],
    [projX(boardX, 24), projY(24, 10)],
  ];
  for (let i = 0; i < 4; i++) b.line(sq[i][0], sq[i][1], sq[(i + 1) % 4][0], sq[(i + 1) % 4][1], hexToRgba('#d23c2c'), 1);
  // Back half of the rim
  const rx = RIM_X[side];
  const rimCol = hexToRgba('#e0571f');
  for (let a = Math.PI; a <= Math.PI * 2; a += 0.05) {
    const x = projX(rx + Math.cos(a) * 0.75, 25 + Math.sin(a) * 0.75);
    const y = projY(25 + Math.sin(a) * 0.75, 10);
    b.set(Math.round(x), Math.round(y), rimCol);
  }
}

function drawForeground(b: PixelBuffer, spec: ArenaSpec) {
  // Courtside fans' heads along the bottom edge for depth.
  const ny = VIEW_H - 7;
  for (let x = 0; x < WORLD_W; x += 9) {
    const j = noise2(x, 3, spec.seed);
    if (j < 0.25) continue;
    const hx = x + Math.round(j * 4);
    const col = hexToRgba(j > 0.6 ? '#1b1622' : '#241d2c');
    b.rect(hx, ny + 2, 7, 6, col);
    b.rect(hx + 1, ny - 2, 5, 5, col);
  }
}

/** Animated fan layers: 0 idle, 1 bob, 2 cheering. */
export function buildCrowd(spec: ArenaSpec, frame: 0 | 1 | 2): HTMLCanvasElement {
  const h = Y0 - 17;
  const b = new PixelBuffer(WORLD_W, h);
  const shirts = [spec.primary, spec.primary, spec.secondary, '#e8e8e8', '#3b6fb6', '#d9d0c0', '#555a66', spec.awayPrimary, '#7a3b8f', '#2f8f5b'];
  for (let row = 0; row < 9; row++) {
    const y = 14 + row * 7;
    const dim = 0.55 + row * 0.05;
    for (let x = 2; x < WORLD_W - 4; x += 6) {
      const n = noise2(x, row, spec.seed + 11);
      if (n < 0.08) continue;
      const fx = x + Math.round(noise2(x, row, spec.seed + 12) * 2);
      const bob = (frame === 1 && n > 0.55) || (frame === 2 && n > 0.25) ? -1 : 0;
      const shirt = hexToRgba(shade(shirts[Math.floor(noise2(x, row, spec.seed + 13) * shirts.length)], -(1 - dim)));
      const skin = hexToRgba(shade(SKIN_TONES[Math.floor(noise2(x, row, spec.seed + 14) * SKIN_TONES.length)], -(1 - dim) * 0.8));
      b.rect(fx, y + 2 + bob, 5, 3, shirt);
      b.rect(fx + 1, y - 1 + bob, 3, 3, skin);
      if (frame === 2 && n > 0.45) {
        b.set(fx - 1, y - 1 + bob, skin);
        b.set(fx + 5, y - 1 + bob, skin);
        b.set(fx - 1, y + bob, shirt);
        b.set(fx + 5, y + bob, shirt);
      }
    }
  }
  return b.toCanvas();
}

/** Front half of the rim plus the net. Frames: 0 rest, 1 swish, 2 swish settle, 3 rattle. */
export function buildRimFront(): { canvas: HTMLCanvasElement; fw: number; fh: number; ax: number; ay: number } {
  const fw = 16;
  const fh = 16;
  const b = new PixelBuffer(fw * 4, fh);
  const rim = hexToRgba('#f0661f');
  const rimDark = hexToRgba('#a8400f');
  const net = hexToRgba('#f4f4f4');
  const netShade = hexToRgba('#c9c9d2');
  for (let f = 0; f < 4; f++) {
    const ox = f * fw + (f === 3 ? 1 : 0);
    const cx = ox + 8;
    // Rim front arc (ellipse lower half)
    for (let a = 0; a <= Math.PI; a += 0.05) {
      b.set(Math.round(cx + Math.cos(a) * 5.6), Math.round(3 + Math.sin(a) * 2), rim);
    }
    b.set(cx - 6, 3, rimDark);
    b.set(cx + 6, 3, rimDark);
    // Net
    const len = f === 1 ? 10 : f === 2 ? 8 : 7;
    const sway = f === 2 ? 1 : 0;
    for (let r = 0; r < len; r++) {
      const t = r / len;
      const half = 5 - t * 2.5;
      const y = 5 + r;
      for (let k = -2; k <= 2; k++) {
        const x = Math.round(cx + sway * t + (k / 2) * half);
        b.set(x, y, (r + k) % 2 ? net : netShade);
      }
      if (r % 2 === 0) b.line(cx - half + sway * t, y, cx + half + sway * t, y, netShade, 1);
    }
  }
  // Anchor: the rim centre sits at (8, 3) of each frame.
  return { canvas: b.toCanvas(), fw, fh, ax: 8, ay: 3 };
}

export function buildBall(): HTMLCanvasElement {
  const b = new PixelBuffer(6, 6);
  const o = hexToRgba('#e7731c');
  const d = hexToRgba('#a8480e');
  const hi = hexToRgba('#ffb36b');
  const rows = ['.oooo.', 'ohoodo', 'ooodoo', 'oddooo', 'ooodoo', '.oooo.'];
  rows.forEach((r, y) => {
    for (let x = 0; x < 6; x++) {
      if (r[x] === 'o') b.set(x, y, o);
      if (r[x] === 'd') b.set(x, y, d);
      if (r[x] === 'h') b.set(x, y, hi);
    }
  });
  return b.toCanvas();
}

export function buildShadow(w = 12, h = 4): HTMLCanvasElement {
  const b = new PixelBuffer(w, h);
  const c = hexToRgba('#1a0f08', 110);
  for (let y = 0; y < h; y++) {
    const t = (y + 0.5) / h - 0.5;
    const half = Math.round((w / 2) * Math.sqrt(1 - 4 * t * t));
    b.rect(Math.round(w / 2 - half), y, half * 2, 1, c);
  }
  return b.toCanvas();
}

export const RIM_HEIGHT_PX = (z: number) => 10 * hsAt(z);
export { MARGIN };
