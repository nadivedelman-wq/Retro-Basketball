/**
 * The game's design tokens. CSS reads them as custom properties (applied in applyPalette) and the
 * canvas/Phaser HUD reads them as numbers, so the blue-and-yellow theme lives in exactly one place.
 * Team jersey and court colours are game content and intentionally not themed.
 */
export const PALETTE = {
  navy: '#102A54', // background
  royal: '#2357A5', // panels and buttons
  yellow: '#FFD43B', // primary actions, selection
  gold: '#F5B700', // rewards, stars
  sky: '#8CCBFF', // secondary highlights
  ink: '#F7F8FC', // primary text
  inkOnYellow: '#0B1C36', // text on yellow; also deep shadows and borders
  // Derived tints of the brand colours
  navyDeep: '#0B1C36',
  navyMid: '#163868',
  royalHi: '#3A72C4',
  royalLo: '#1B4787',
  skySoft: '#CFE7FF',
  // Semantic states (always paired with text or symbols, never colour alone)
  good: '#8EF0B0',
  warn: '#FFD43B',
  bad: '#FF8A80',
} as const;

export type PaletteKey = keyof typeof PALETTE;

export const hex = (k: PaletteKey) => parseInt(PALETTE[k].slice(1), 16);

const CSS_VARS: Record<string, PaletteKey> = {
  '--bg': 'navy',
  '--bg2': 'navyMid',
  '--panel': 'royal',
  '--panel2': 'royalHi',
  '--panel-lo': 'royalLo',
  '--ink': 'ink',
  '--muted': 'skySoft',
  '--dim': 'sky',
  '--line': 'navyDeep',
  '--hi': 'royalHi',
  '--yellow': 'yellow',
  '--gold': 'gold',
  '--sky': 'sky',
  '--on-yellow': 'inkOnYellow',
  '--good': 'good',
  '--warn': 'warn',
  '--bad': 'bad',
};

export function applyPalette(root: HTMLElement = document.documentElement) {
  for (const [v, k] of Object.entries(CSS_VARS)) root.style.setProperty(v, PALETTE[k]);
}
