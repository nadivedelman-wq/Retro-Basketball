/** Original pixel team badges: a shape chosen from the club's id, its colours and abbreviation. */
import type { Team } from '../core/types';
import { hashString } from '../core/rng';
import { textWidth } from './font';
import { PixelBuffer, drawText, hexToRgba, luminance, shade } from './pixels';
import { buildPortrait, type SpriteSpec } from './playerSprite';

const cache = new Map<string, string>();

export function teamBadge(team: Pick<Team, 'id' | 'abbr' | 'colors'>, size = 32): string {
  const key = `${team.id}:${team.colors.join()}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new PixelBuffer(size, size);
  const p = hexToRgba(team.colors[0]);
  const s = hexToRgba(team.colors[1]);
  const dark = hexToRgba(shade(team.colors[0], -0.45));
  const shape = hashString(team.id) % 4;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      let inside = false;
      let edge = false;
      if (shape === 0) {
        const r = Math.hypot(dx, dy);
        inside = r <= c;
        edge = r > c - 2.2;
      } else if (shape === 1) {
        const r = Math.abs(dx) + Math.abs(dy);
        inside = r <= c + 1;
        edge = r > c - 1.6;
      } else if (shape === 2) {
        // shield
        const top = y < size * 0.55;
        const w = top ? c : c * (1 - (y - size * 0.55) / (size * 0.47));
        inside = Math.abs(dx) <= w && y >= 1;
        edge = inside && (Math.abs(dx) > w - 2 || y < 3);
      } else {
        inside = Math.abs(dx) <= c && Math.abs(dy) <= c * 0.8;
        edge = inside && (Math.abs(dx) > c - 2 || Math.abs(dy) > c * 0.8 - 2);
      }
      if (!inside) continue;
      b.set(x, y, edge ? s : y > c + 2 ? dark : p);
    }
  }
  const label = team.abbr.toUpperCase();
  const scale = size >= 48 ? 2 : 1;
  const w = textWidth(label) * scale;
  const tx = Math.round(size / 2 - w / 2);
  const ty = Math.round(size / 2 - 3.5 * scale);
  const txt = luminance(team.colors[0]) > 0.6 ? hexToRgba(shade(team.colors[1], -0.3)) : hexToRgba('#ffffff');
  drawText(b, label, tx + scale, ty + scale, hexToRgba('#140f1c', 160), scale);
  drawText(b, label, tx, ty, txt, scale);
  b.outline(0, 0, size, size, hexToRgba('#140f1c'));
  const url = b.toCanvas().toDataURL();
  cache.set(key, url);
  return url;
}

const portraitCache = new Map<string, string>();

export function portraitUrl(spec: SpriteSpec, size = 16): string {
  const key = JSON.stringify(spec) + size;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  const url = buildPortrait(spec, size).toDataURL();
  portraitCache.set(key, url);
  return url;
}
