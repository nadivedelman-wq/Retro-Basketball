import { buildPlayerSheet, buildPortrait, FW, FH, FRAME_COUNT } from '../src/art/playerSprite';
const specs = [
  { appearance: { skin: 0, hair: 1, hairColor: 3, build: 0, accessory: 'headband' as const }, heightCm: 185, jersey: '#c8102e', trim: '#ffffff', number: 3 },
  { appearance: { skin: 4, hair: 3, hairColor: 0, build: 1, accessory: 'wristbands' as const, beard: true }, heightCm: 201, jersey: '#1d428a', trim: '#ffc72c', number: 23 },
  { appearance: { skin: 2, hair: 2, hairColor: 0, build: 2, accessory: 'goggles' as const }, heightCm: 216, jersey: '#f2f2f2', trim: '#006bb6', number: 50 },
  { appearance: { skin: 5, hair: 5, hairColor: 0, build: 1, accessory: 'armsleeve' as const }, heightCm: 196, jersey: '#0b6e4f', trim: '#f2c14e', number: 11 },
  { appearance: { skin: 1, hair: 7, hairColor: 4, build: 0 }, heightCm: 190, jersey: '#5a2d82', trim: '#e8e8e8', number: 8 },
];
const S = 4;
for (const sp of specs) {
  const sheet = buildPlayerSheet(sp as any);
  const c = document.createElement('canvas');
  c.width = FW * FRAME_COUNT * S; c.height = FH * S;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#b07a45'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(sheet, 0, 0, c.width, c.height);
  document.body.appendChild(c);
}
const row = document.createElement('div');
for (const sp of specs) { const p = buildPortrait(sp as any, 16); p.style.width = '64px'; p.style.height = '64px'; p.style.display = 'inline-block'; p.style.margin = '4px'; row.appendChild(p); }
document.body.appendChild(row);
