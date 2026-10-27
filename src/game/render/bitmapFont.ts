import Phaser from 'phaser';
import { GLYPHS, GLYPH_H } from '../../art/font';
import { PixelBuffer, hexToRgba } from '../../art/pixels';
import { hex } from '../../ui/palette';

export const FONT = 'hardwood';

/** Registers the Hardwood glyph table as a Phaser bitmap font (white, so it can be tinted). */
export function registerBitmapFont(scene: Phaser.Scene) {
  if (scene.cache.bitmapFont.exists(FONT)) return;
  const entries = Object.entries(GLYPHS);
  const extra: [string, (typeof GLYPHS)[string]][] = [];
  for (const [ch, g] of entries) {
    const lower = ch.toLowerCase();
    if (lower !== ch) extra.push([lower, g]);
  }
  const all = [...entries, ...extra];
  let w = 0;
  for (const [, g] of all) w += g.w + 1;
  const buf = new PixelBuffer(w, GLYPH_H);
  const white = hexToRgba('#ffffff');
  const chars: Record<number, unknown> = {};
  let x = 0;
  for (const [ch, g] of all) {
    g.rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') buf.set(x + i, r, white);
    });
    chars[ch.codePointAt(0)!] = {
      x,
      y: 0,
      width: g.w,
      height: GLYPH_H,
      centerX: Math.floor(g.w / 2),
      centerY: Math.floor(GLYPH_H / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: g.w + 1,
      u0: x / w,
      v0: 0,
      u1: (x + g.w) / w,
      v1: 1,
      data: {},
      kerning: {},
    };
    x += g.w + 1;
  }
  scene.textures.addCanvas(FONT, buf.toCanvas());
  scene.cache.bitmapFont.add(FONT, {
    data: { font: FONT, size: GLYPH_H, lineHeight: GLYPH_H + 3, retroFont: true, chars },
    texture: FONT,
    frame: null,
  });
}

/** Text with a 1px drop shadow for legibility over the court. */
export class PixText {
  readonly main: Phaser.GameObjects.BitmapText;
  readonly shadow: Phaser.GameObjects.BitmapText;
  constructor(scene: Phaser.Scene, x: number, y: number, text: string, color = 0xffffff, scale = 1, shadowColor = hex('navyDeep')) {
    this.shadow = scene.add.bitmapText(x + scale, y + scale, FONT, text).setTint(shadowColor).setScale(scale);
    this.main = scene.add.bitmapText(x, y, FONT, text).setTint(color).setScale(scale);
  }
  setText(t: string) {
    if (this.main.text !== t) {
      this.main.setText(t);
      this.shadow.setText(t);
    }
    return this;
  }
  setPosition(x: number, y: number) {
    const s = this.main.scaleX;
    this.main.setPosition(Math.round(x), Math.round(y));
    this.shadow.setPosition(Math.round(x) + s, Math.round(y) + s);
    return this;
  }
  setOrigin(x: number, y = 0) {
    this.main.setOrigin(x, y);
    this.shadow.setOrigin(x, y);
    return this;
  }
  setTint(c: number) {
    this.main.setTint(c);
    return this;
  }
  setVisible(v: boolean) {
    this.main.setVisible(v);
    this.shadow.setVisible(v);
    return this;
  }
  setDepth(d: number) {
    this.shadow.setDepth(d);
    this.main.setDepth(d + 0.01);
    return this;
  }
  setScrollFactor(f: number) {
    this.main.setScrollFactor(f);
    this.shadow.setScrollFactor(f);
    return this;
  }
  setAlpha(a: number) {
    this.main.setAlpha(a);
    this.shadow.setAlpha(a);
    return this;
  }
  get width() {
    return this.main.width;
  }
  destroy() {
    this.main.destroy();
    this.shadow.destroy();
  }
}
