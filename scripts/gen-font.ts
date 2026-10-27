/**
 * Builds public/fonts/hardwood.otf from the glyph table in src/art/font.ts so the DOM menus
 * use exactly the same original pixel typeface as the game canvas.
 * Each font pixel is 100 units; with unitsPerEm 1000, a CSS font-size of 10px = 1 screen pixel per font pixel.
 */
import opentype from 'opentype.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPHS, GLYPH_H } from '../src/art/font';

const U = 100;
const glyphs: opentype.Glyph[] = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: new opentype.Path() })];

function glyphPath(rows: string[]): opentype.Path {
  const path = new opentype.Path();
  rows.forEach((row, r) => {
    const yTop = (GLYPH_H - r) * U;
    const yBot = yTop - U - (r < GLYPH_H - 1 ? 2 : 0); // tiny overlap avoids seams between rows
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') {
        c++;
        continue;
      }
      let e = c;
      while (e < row.length && row[e] === '#') e++;
      // Counter-clockwise outer contour (CFF convention).
      path.moveTo(c * U, yBot);
      path.lineTo(e * U, yBot);
      path.lineTo(e * U, yTop);
      path.lineTo(c * U, yTop);
      path.close();
      c = e;
    }
  });
  return path;
}

const seen = new Set<number>();
for (const [ch, g] of Object.entries(GLYPHS)) {
  const codes = [ch.codePointAt(0)!];
  const lower = ch.toLowerCase();
  if (lower !== ch) codes.push(lower.codePointAt(0)!);
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    glyphs.push(new opentype.Glyph({ name: `u${code.toString(16)}`, unicode: code, advanceWidth: (g.w + 1) * U, path: glyphPath(g.rows) }));
  }
}

const font = new opentype.Font({ familyName: 'Hardwood', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/fonts/hardwood.otf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(font.toArrayBuffer()));
console.log(`wrote ${out} (${glyphs.length} glyphs)`);
