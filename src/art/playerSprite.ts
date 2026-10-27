/**
 * Procedural, original player sprite sheets. Every player gets a sheet built from their
 * appearance (skin, hair, build, accessories), height and team colours, so silhouettes
 * differ by player. Poses are defined as joint positions and rasterised as chunky pixels
 * with a dark outline, in a 90s handheld style.
 */
import type { Appearance } from '../core/types';
import { PixelBuffer, drawMiniNumber, hexToRgba, luminance, shade, type RGBA } from './pixels';

export const FW = 24;
export const FH = 40;

export const SKIN_TONES = ['#f4d0b0', '#e3b086', '#c68a5e', '#a16841', '#7a4a2b', '#52301d'];
export const HAIR_COLORS = ['#1a1214', '#3a2315', '#6a4322', '#c79a50', '#a3431f', '#a0a0a8'];
export const HAIR_STYLES = ['Buzz', 'Short', 'Flat-top', 'Afro', 'Bald', 'Locs', 'Mohawk', 'Ponytail'];
const OUTLINE: RGBA = [20, 16, 24, 255];

type V2 = [number, number];
type Limb = { a: V2; b: V2 };
export type Pose = {
  crouch?: number;
  lean?: number;
  legF: Limb;
  legB: Limb;
  armF: Limb;
  armB: Limb;
  headTilt?: number;
};

const P = (a: V2, b: V2): Limb => ({ a, b });

/** Joint positions: legs in units of leg length from the hip, arms in units of arm length from the shoulder. */
const SIDE_POSES: Record<string, Pose> = {
  idle0: { legF: P([0.08, 0.5], [0.16, 1]), legB: P([-0.06, 0.5], [-0.14, 1]), armF: P([0.08, 0.48], [0.14, 0.95]), armB: P([-0.06, 0.48], [-0.06, 0.95]) },
  idle1: { crouch: 1, legF: P([0.1, 0.5], [0.16, 1]), legB: P([-0.06, 0.5], [-0.14, 1]), armF: P([0.1, 0.46], [0.18, 0.92]), armB: P([-0.06, 0.46], [-0.04, 0.92]) },
  run0: { lean: 1, crouch: 1, legF: P([0.32, 0.42], [0.5, 0.93]), legB: P([-0.22, 0.5], [-0.5, 0.82]), armF: P([-0.25, 0.4], [-0.1, 0.78]), armB: P([0.3, 0.38], [0.55, 0.55]) },
  run1: { lean: 1, legF: P([0.16, 0.5], [0.02, 1]), legB: P([0.12, 0.34], [-0.2, 0.62]), armF: P([0.0, 0.48], [0.12, 0.9]), armB: P([0.05, 0.46], [0.1, 0.9]) },
  run2: { lean: 1, crouch: 1, legF: P([-0.22, 0.5], [-0.5, 0.82]), legB: P([0.32, 0.42], [0.5, 0.93]), armF: P([0.3, 0.38], [0.55, 0.55]), armB: P([-0.25, 0.4], [-0.1, 0.78]) },
  run3: { lean: 1, legF: P([0.12, 0.34], [-0.2, 0.62]), legB: P([0.16, 0.5], [0.02, 1]), armF: P([0.05, 0.46], [0.1, 0.9]), armB: P([0.0, 0.48], [0.12, 0.9]) },
  drib0: { crouch: 2, lean: 1, legF: P([0.25, 0.48], [0.3, 1]), legB: P([-0.2, 0.48], [-0.3, 1]), armF: P([0.25, 0.42], [0.55, 0.72]), armB: P([0.25, 0.35], [0.45, 0.4]) },
  drib1: { crouch: 2, lean: 1, legF: P([0.25, 0.48], [0.3, 1]), legB: P([-0.2, 0.48], [-0.3, 1]), armF: P([0.3, 0.35], [0.6, 0.5]), armB: P([0.25, 0.35], [0.45, 0.4]) },
  dribRun0: { lean: 2, crouch: 1, legF: P([0.32, 0.42], [0.5, 0.93]), legB: P([-0.22, 0.5], [-0.5, 0.82]), armF: P([0.3, 0.42], [0.62, 0.7]), armB: P([0.3, 0.38], [0.55, 0.5]) },
  dribRun1: { lean: 2, legF: P([0.16, 0.5], [0.02, 1]), legB: P([0.12, 0.34], [-0.2, 0.62]), armF: P([0.35, 0.36], [0.65, 0.5]), armB: P([0.05, 0.46], [0.1, 0.9]) },
  dribRun2: { lean: 2, crouch: 1, legF: P([-0.22, 0.5], [-0.5, 0.82]), legB: P([0.32, 0.42], [0.5, 0.93]), armF: P([0.3, 0.42], [0.62, 0.7]), armB: P([-0.25, 0.4], [-0.1, 0.78]) },
  dribRun3: { lean: 2, legF: P([0.12, 0.34], [-0.2, 0.62]), legB: P([0.16, 0.5], [0.02, 1]), armF: P([0.35, 0.36], [0.65, 0.5]), armB: P([0.0, 0.48], [0.12, 0.9]) },
  gather: { crouch: 3, legF: P([0.25, 0.45], [0.12, 1]), legB: P([0.05, 0.45], [-0.12, 1]), armF: P([0.35, 0.3], [0.45, 0.05]), armB: P([0.3, 0.32], [0.4, 0.08]) },
  shoot: { legF: P([0.04, 0.5], [0.08, 0.98]), legB: P([-0.04, 0.5], [-0.04, 0.98]), armF: P([0.3, -0.42], [0.3, -0.95]), armB: P([0.15, -0.38], [0.22, -0.88]) },
  jump: { legF: P([0.1, 0.5], [-0.05, 0.95]), legB: P([-0.08, 0.5], [-0.2, 0.92]), armF: P([0.12, -0.48], [0.18, -1]), armB: P([-0.02, -0.48], [-0.05, -1]) },
  layup: { lean: 1, legF: P([0.45, 0.25], [0.32, 0.62]), legB: P([-0.06, 0.5], [-0.14, 1]), armF: P([0.28, -0.45], [0.38, -0.95]), armB: P([-0.1, 0.45], [-0.15, 0.85]) },
  dunk: { lean: 2, legF: P([0.32, 0.38], [0.0, 0.72]), legB: P([0.18, 0.42], [-0.2, 0.75]), armF: P([0.42, -0.4], [0.7, -0.75]), armB: P([-0.2, 0.3], [-0.35, 0.6]) },
  pass: { lean: 2, legF: P([0.3, 0.48], [0.42, 1]), legB: P([-0.15, 0.5], [-0.3, 1]), armF: P([0.5, 0.22], [0.95, 0.18]), armB: P([0.45, 0.28], [0.88, 0.25]) },
  steal: { lean: 3, crouch: 3, legF: P([0.45, 0.45], [0.6, 1]), legB: P([-0.25, 0.5], [-0.5, 1]), armF: P([0.55, 0.45], [1, 0.62]), armB: P([-0.1, 0.4], [-0.25, 0.7]) },
  defend0: { crouch: 3, legF: P([0.35, 0.45], [0.5, 1]), legB: P([-0.35, 0.45], [-0.5, 1]), armF: P([0.42, 0.18], [0.75, 0.0]), armB: P([-0.32, 0.18], [-0.58, -0.02]) },
  defend1: { crouch: 2, legF: P([0.3, 0.45], [0.45, 1]), legB: P([-0.3, 0.45], [-0.45, 1]), armF: P([0.35, -0.2], [0.5, -0.65]), armB: P([-0.32, 0.22], [-0.6, 0.1]) },
  celebrate0: { legF: P([0.1, 0.5], [0.2, 1]), legB: P([-0.1, 0.5], [-0.2, 1]), armF: P([0.3, -0.45], [0.5, -0.9]), armB: P([-0.25, -0.45], [-0.45, -0.9]) },
  celebrate1: { crouch: 1, legF: P([0.15, 0.5], [0.25, 1]), legB: P([-0.1, 0.5], [-0.2, 1]), armF: P([0.35, -0.2], [0.3, -0.75]), armB: P([-0.05, 0.45], [0.0, 0.9]) },
  tired: { crouch: 5, lean: 4, legF: P([0.3, 0.45], [0.2, 1]), legB: P([0.1, 0.45], [-0.12, 1]), armF: P([0.25, 0.45], [0.42, 0.85]), armB: P([0.2, 0.45], [0.35, 0.85]) },
  screen: { crouch: 1, legF: P([0.25, 0.5], [0.35, 1]), legB: P([-0.25, 0.5], [-0.35, 1]), armF: P([0.28, 0.3], [0.05, 0.42]), armB: P([0.25, 0.3], [0.0, 0.45]) },
};

const FRONT_POSES: Record<string, Pose> = {
  idle: { legF: P([0.12, 0.5], [0.16, 1]), legB: P([-0.12, 0.5], [-0.16, 1]), armF: P([0.18, 0.5], [0.22, 0.95]), armB: P([-0.18, 0.5], [-0.22, 0.95]) },
  run0: { crouch: 1, legF: P([0.14, 0.32], [0.14, 0.7]), legB: P([-0.12, 0.5], [-0.14, 1]), armF: P([0.2, 0.4], [0.16, 0.7]), armB: P([-0.2, 0.5], [-0.24, 0.95]) },
  run1: { legF: P([0.12, 0.5], [0.14, 1]), legB: P([-0.12, 0.5], [-0.14, 1]), armF: P([0.18, 0.5], [0.22, 0.92]), armB: P([-0.18, 0.5], [-0.22, 0.92]) },
  run2: { crouch: 1, legF: P([0.12, 0.5], [0.14, 1]), legB: P([-0.14, 0.32], [-0.14, 0.7]), armF: P([0.2, 0.5], [0.24, 0.95]), armB: P([-0.2, 0.4], [-0.16, 0.7]) },
  run3: { legF: P([0.12, 0.5], [0.14, 1]), legB: P([-0.12, 0.5], [-0.14, 1]), armF: P([0.18, 0.5], [0.22, 0.92]), armB: P([-0.18, 0.5], [-0.22, 0.92]) },
};

export const SIDE_FRAMES = Object.keys(SIDE_POSES);
export const FRONT_FRAMES = Object.keys(FRONT_POSES);

/** Frame index lookup: side frames, then fallen, then front (toward camera), then back (away). */
export const FRAME: Record<string, number> = {};
SIDE_FRAMES.forEach((k, i) => (FRAME[k] = i));
FRAME.fallen = SIDE_FRAMES.length;
FRONT_FRAMES.forEach((k, i) => (FRAME['f_' + k] = SIDE_FRAMES.length + 1 + i));
FRONT_FRAMES.forEach((k, i) => (FRAME['b_' + k] = SIDE_FRAMES.length + 1 + FRONT_FRAMES.length + i));
export const FRAME_COUNT = SIDE_FRAMES.length + 1 + FRONT_FRAMES.length * 2;

export type SpriteSpec = {
  appearance: Appearance;
  heightCm: number;
  jersey: string;
  trim: string;
  number: number;
};

type Dims = { H: number; legLen: number; torso: number; armLen: number; tw: number };

function dims(spec: SpriteSpec): Dims {
  const H = Math.max(21, Math.min(30, Math.round(21 + (spec.heightCm - 178) / 5)));
  const torso = Math.round(H * 0.3);
  const legLen = H - 5 - torso;
  const armLen = Math.round(torso * 1.2) + 1;
  const tw = [4, 5, 6][spec.appearance.build] ?? 5;
  return { H, legLen, torso, armLen, tw };
}

type Colors = { skin: RGBA; skinDark: RGBA; hair: RGBA; jersey: RGBA; jerseyDark: RGBA; trim: RGBA; shoe: RGBA; sock: RGBA; num: RGBA };

function colors(spec: SpriteSpec): Colors {
  const skin = SKIN_TONES[spec.appearance.skin % SKIN_TONES.length];
  const hair = HAIR_COLORS[spec.appearance.hairColor % HAIR_COLORS.length];
  const numHex = luminance(spec.jersey) > 0.6 ? shade(spec.trim, -0.2) : luminance(spec.trim) > 0.5 ? spec.trim : '#ffffff';
  return {
    skin: hexToRgba(skin),
    skinDark: hexToRgba(shade(skin, -0.25)),
    hair: hexToRgba(hair),
    jersey: hexToRgba(spec.jersey),
    jerseyDark: hexToRgba(shade(spec.jersey, -0.3)),
    trim: hexToRgba(spec.trim),
    shoe: hexToRgba(spec.appearance.build === 2 ? '#2a2a32' : '#f2f2f2'),
    sock: hexToRgba('#f4f4f4'),
    num: hexToRgba(numHex),
  };
}

function drawHead(b: PixelBuffer, cx: number, top: number, view: 'side' | 'front' | 'back', a: Appearance, c: Colors) {
  // 5x5 head; cx is the centre column.
  const x0 = cx - 2;
  b.rect(x0, top, 5, 5, c.skin);
  if (view === 'side') {
    b.set(x0 + 5, top + 2, c.skin); // nose
    b.set(x0 + 3, top + 1, OUTLINE); // eye
    b.set(x0 + 1, top + 2, c.skinDark); // ear
    b.rect(x0, top + 4, 2, 1, c.skinDark);
  } else if (view === 'front') {
    b.set(x0 + 1, top + 2, OUTLINE);
    b.set(x0 + 3, top + 2, OUTLINE);
    b.set(x0 + 2, top + 4, c.skinDark);
  }
  if (a.beard && view !== 'back') {
    if (view === 'side') b.rect(x0 + 1, top + 4, 4, 1, c.hair);
    else b.rect(x0, top + 4, 5, 1, c.hair);
  }
  const style = a.hair % 8;
  const hair = c.hair;
  switch (style) {
    case 0: // buzz
      b.rect(x0, top, 5, 1, hair);
      if (view !== 'front') b.rect(view === 'side' ? x0 : x0, top, view === 'side' ? 2 : 5, 2, hair);
      break;
    case 1: // short
      b.rect(x0, top - 1, 5, 2, hair);
      if (view === 'side') b.rect(x0, top, 2, 3, hair);
      if (view === 'back') b.rect(x0, top, 5, 4, hair);
      break;
    case 2: // flat-top
      b.rect(x0, top - 3, 5, 4, hair);
      if (view === 'side') b.rect(x0, top, 2, 3, hair);
      if (view === 'back') b.rect(x0, top, 5, 3, hair);
      break;
    case 3: // afro
      b.rect(x0 - 1, top - 3, 7, 4, hair);
      b.rect(x0, top - 4, 5, 1, hair);
      if (view === 'side') b.rect(x0 - 1, top, 3, 3, hair);
      else b.rect(x0 - 1, top, 1, 3, hair), b.rect(x0 + 5, top, 1, 3, hair);
      if (view === 'back') b.rect(x0 - 1, top, 7, 4, hair);
      break;
    case 4: // bald
      b.set(x0 + (view === 'side' ? 2 : 1), top, hexToRgba('#ffffff', 90));
      break;
    case 5: // locs
      b.rect(x0, top - 1, 5, 2, hair);
      if (view === 'side') b.rect(x0 - 1, top, 2, 6, hair);
      else if (view === 'back') b.rect(x0, top, 5, 6, hair);
      else b.rect(x0 - 1, top + 1, 1, 5, hair), b.rect(x0 + 5, top + 1, 1, 5, hair);
      break;
    case 6: // mohawk
      if (view === 'side') b.rect(x0, top - 2, 4, 2, hair);
      else b.rect(x0 + 2, top - 2, 1, 3, hair);
      break;
    case 7: // ponytail
      b.rect(x0, top - 1, 5, 2, hair);
      if (view === 'side') b.rect(x0 - 2, top + 1, 2, 3, hair);
      if (view === 'back') b.rect(x0, top, 5, 3, hair), b.rect(x0 + 2, top + 3, 1, 3, hair);
      break;
  }
  if (a.accessory === 'headband') b.rect(x0, top + 1, 5, 1, c.trim);
  if (a.accessory === 'goggles' && view !== 'back') {
    if (view === 'side') b.rect(x0 + 2, top + 1, 3, 1, hexToRgba('#2a3440'));
    else b.rect(x0, top + 2, 5, 1, hexToRgba('#2a3440'));
  }
}

function limb(b: PixelBuffer, from: V2, mid: V2, to: V2, col: RGBA, t: number) {
  b.line(from[0], from[1], mid[0], mid[1], col, t);
  b.line(mid[0], mid[1], to[0], to[1], col, t);
}

function drawPose(b: PixelBuffer, ox: number, pose: Pose, view: 'side' | 'front' | 'back', spec: SpriteSpec, d: Dims, c: Colors) {
  const feetY = FH - 1;
  const cx = ox + Math.floor(FW / 2);
  const crouch = pose.crouch ?? 0;
  const lean = pose.lean ?? 0;
  const hipY = feetY - d.legLen + crouch;
  const hipX = cx;
  const shY = hipY - d.torso;
  const shX = hipX + lean;
  const ll = d.legLen;
  const al = d.armLen;
  const front = view !== 'side';
  const tw = front ? d.tw + 2 : d.tw;

  const legPts = (L: Limb, dx: number): [V2, V2, V2] => [
    [hipX + dx, hipY],
    [hipX + dx + L.a[0] * ll, hipY + L.a[1] * ll],
    [hipX + dx + L.b[0] * ll, Math.min(feetY - 1, hipY + L.b[1] * ll)],
  ];
  const armPts = (L: Limb, dx: number): [V2, V2, V2] => [
    [shX + dx, shY + 1],
    [shX + dx + L.a[0] * al, shY + 1 + L.a[1] * al],
    [shX + dx + L.b[0] * al, shY + 1 + L.b[1] * al],
  ];
  const legOff = front ? [1, -2] : [0, -1];
  const armOff = front ? [Math.ceil(tw / 2), -Math.ceil(tw / 2) - 1] : [0, -1];

  const drawLeg = (L: Limb, dx: number, back: boolean) => {
    const [h, k, f] = legPts(L, dx);
    limb(b, h, k, f, back ? c.skinDark : c.skin, 2);
    // sock + shoe
    b.rect(Math.round(f[0]), Math.round(f[1]) - 1, 2, 1, c.sock);
    const shoeW = front ? 2 : 3;
    const sx = Math.round(f[0]) - (front ? 0 : 0);
    b.rect(sx, Math.round(f[1]), shoeW, 2, c.shoe);
  };
  const drawArm = (L: Limb, dx: number, back: boolean, sleeve: boolean) => {
    const [s, e, h] = armPts(L, dx);
    limb(b, s, e, h, back ? c.skinDark : c.skin, 2);
    if (sleeve) limb(b, s, e, e, c.trim, 2);
    if (spec.appearance.accessory === 'wristbands') b.rect(Math.round(h[0]), Math.round(h[1]) - 1, 2, 1, hexToRgba('#ffffff'));
  };

  // Back limbs first.
  drawArm(pose.armB, armOff[1], true, false);
  drawLeg(pose.legB, legOff[1], true);
  drawLeg(pose.legF, legOff[0], false);

  // Shorts
  const shortsTop = hipY - 1;
  for (let r = 0; r < 5; r++) {
    const y = shortsTop + r;
    const w = tw + (r >= 2 ? 1 : 0);
    const x = Math.round(hipX - w / 2) + (front ? 0 : 0);
    b.rect(x, y, w, 1, r === 0 ? c.trim : r === 4 ? c.jerseyDark : c.jersey);
    if (r > 0) b.set(x + w - 1, y, c.jerseyDark);
    if (!front) b.set(x, y, c.trim);
  }
  // Torso with lean distributed over its rows.
  for (let r = 0; r <= d.torso; r++) {
    const y = shY + r;
    const k = 1 - r / d.torso;
    const x = Math.round(hipX + lean * k - tw / 2);
    b.rect(x, y, tw, 1, r >= d.torso - 1 ? c.jerseyDark : c.jersey);
    if (r === 0) b.rect(x + 1, y, tw - 2, 1, c.trim);
    if (front) {
      b.set(x, y, r < 3 ? c.skin : c.jersey);
      b.set(x + tw - 1, y, r < 3 ? c.skin : c.jersey);
    }
  }
  if (front && d.torso >= 7) drawMiniNumber(b, spec.number, hipX + lean * 0.5, shY + 2, c.num);
  else if (!front && d.torso >= 7) {
    // A sliver of the number visible on the chest in profile.
    const n = String(spec.number);
    drawMiniNumber(b, Number(n[n.length - 1]), hipX + lean * 0.5 + 1, shY + 2, c.num);
  }

  // Head
  const headTop = shY - 5;
  if (view === 'back') {
    drawHead(b, shX, headTop, 'back', spec.appearance, c);
  } else drawHead(b, shX + (view === 'side' ? 0 : 0), headTop, front ? 'front' : 'side', spec.appearance, c);

  drawArm(pose.armF, armOff[0], false, spec.appearance.accessory === 'armsleeve');
}

function drawFallen(b: PixelBuffer, ox: number, spec: SpriteSpec, d: Dims, c: Colors) {
  const y = FH - 4;
  const x = ox + 2;
  const len = d.legLen;
  b.rect(x, y, 5, 3, c.skin); // head
  drawHead(b, x + 2, y - 2, 'side', { ...spec.appearance, hair: 4 }, c);
  b.rect(x + 5, y, d.torso, 3, c.jersey);
  b.rect(x + 5 + d.torso, y, 4, 3, c.jersey);
  b.rect(x + 9 + d.torso, y + 1, len - 2, 2, c.skin);
  b.rect(x + 7 + d.torso + len, y, 2, 3, c.shoe);
  b.rect(x + 6, y - 2, 6, 2, c.skin);
}

/** Builds a full sprite sheet canvas (FRAME_COUNT frames laid out horizontally). */
export function buildPlayerSheet(spec: SpriteSpec): HTMLCanvasElement {
  const d = dims(spec);
  const c = colors(spec);
  const b = new PixelBuffer(FW * FRAME_COUNT, FH);
  SIDE_FRAMES.forEach((k, i) => drawPose(b, i * FW, SIDE_POSES[k], 'side', spec, d, c));
  drawFallen(b, FRAME.fallen * FW, spec, d, c);
  FRONT_FRAMES.forEach((k, i) => {
    drawPose(b, FRAME['f_' + k] * FW, FRONT_POSES[k], 'front', spec, d, c);
    drawPose(b, FRAME['b_' + k] * FW, FRONT_POSES[k], 'back', spec, d, c);
  });
  for (let i = 0; i < FRAME_COUNT; i++) b.outline(i * FW, 0, FW, FH, OUTLINE);
  return b.toCanvas();
}

/** Head-and-shoulders portrait used in menus (16x16). */
export function buildPortrait(spec: SpriteSpec, size = 16): HTMLCanvasElement {
  const c = colors(spec);
  const b = new PixelBuffer(size, size);
  const cx = Math.floor(size / 2);
  b.rect(cx - 5, size - 5, 11, 5, c.jersey);
  b.rect(cx - 3, size - 5, 7, 1, c.trim);
  b.rect(cx - 1, size - 7, 3, 2, c.skin);
  // Scale the 5x5 head x2 for the portrait.
  const head = new PixelBuffer(9, 10);
  drawHead(head, 3, 4, 'front', spec.appearance, c);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 9; x++) {
      const p = head.get(x, y);
      if (p[3]) b.rect(cx - 7 + x * 2 - 1, y * 2 - 8 + 1, 2, 2, p);
    }
  drawMiniNumber(b, spec.number, cx, size - 4, c.num);
  b.outline(0, 0, size, size, OUTLINE);
  return b.toCanvas();
}
