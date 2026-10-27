/** Small pixel-drawing toolkit over a 2D canvas. Everything is integer-snapped. */
import { glyphFor, MINI_DIGITS } from './font';

export type RGBA = [number, number, number, number];

export function hexToRgba(hex: string, a = 255): RGBA {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

export function rgbaToHex(c: RGBA): string {
  return '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

export function shade(hex: string, f: number): string {
  const c = hexToRgba(hex);
  const out: RGBA = f >= 0
    ? [c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f, 255]
    : [c[0] * (1 + f), c[1] * (1 + f), c[2] * (1 + f), 255];
  return rgbaToHex(out);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgba(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Direct pixel buffer for fast per-pixel work, flushed back with put(). */
export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGBA) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (c[3] === 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
    } else if (c[3] > 0) {
      const a = c[3] / 255;
      this.data[i] = this.data[i] * (1 - a) + c[0] * a;
      this.data[i + 1] = this.data[i + 1] * (1 - a) + c[1] * a;
      this.data[i + 2] = this.data[i + 2] * (1 - a) + c[2] * a;
      this.data[i + 3] = Math.max(this.data[i + 3], c[3]);
    }
  }
  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c);
  }
  /** Bresenham line with a square brush of size `t`. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, t = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.rect(x0, y0, t, t, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** 1px dark outline around every opaque pixel inside the region. */
  outline(x0: number, y0: number, w: number, h: number, c: RGBA) {
    const mark: number[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (this.get(x, y)[3] !== 0) continue;
        const n =
          (x > x0 && this.get(x - 1, y)[3] > 200) ||
          (x < x0 + w - 1 && this.get(x + 1, y)[3] > 200) ||
          (y > y0 && this.get(x, y - 1)[3] > 200) ||
          (y < y0 + h - 1 && this.get(x, y + 1)[3] > 200);
        if (n) mark.push(x, y);
      }
    }
    for (let i = 0; i < mark.length; i += 2) this.set(mark[i], mark[i + 1], c);
  }
  toCanvas(): HTMLCanvasElement {
    const c = makeCanvas(this.w, this.h);
    const ctx = c.getContext('2d')!;
    ctx.putImageData(new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, this.w, this.h), 0, 0);
    return c;
  }
}

/** Draw a string in the Hardwood font into a buffer. */
export function drawText(buf: PixelBuffer, s: string, x: number, y: number, c: RGBA, scale = 1) {
  let cx = x;
  for (const ch of s) {
    const g = glyphFor(ch);
    g.rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') buf.rect(cx + i * scale, y + r * scale, scale, scale, c);
    });
    cx += (g.w + 1) * scale;
  }
}

export function drawMiniNumber(buf: PixelBuffer, n: number, cx: number, y: number, c: RGBA) {
  const s = String(n);
  const w = s.length * 4 - 1;
  let x = Math.round(cx - w / 2);
  for (const ch of s) {
    const rows = MINI_DIGITS[ch];
    rows.forEach((row, r) => {
      for (let i = 0; i < 3; i++) if (row[i] === '#') buf.set(x + i, y + r, c);
    });
    x += 4;
  }
}

/** Deterministic hash noise for textures. */
export function noise2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
