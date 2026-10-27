import type { Rng } from './rng';
import type { Injury } from './types';

/** Injury table shared by live games and simulation: [type, min games, max games]. */
export const INJURY_TYPES: [string, number, number][] = [
  ['Sprained Ankle', 1, 6],
  ['Jammed Finger', 1, 3],
  ['Bruised Knee', 1, 4],
  ['Hamstring Strain', 3, 10],
  ['Back Spasms', 2, 6],
  ['Broken Wrist', 10, 25],
  ['Torn Meniscus', 15, 40],
];

export function rollInjury(rng: Rng): Injury {
  const t = rng.weighted(INJURY_TYPES, (x) => 30 / (x[1] + x[2]));
  return { type: t[0], gamesRemaining: rng.int(t[1], t[2]) };
}

/** Per-minute injury multiplier from traits. */
export function injuryTraitFactor(traits: string[]) {
  if (traits.includes('Injury Prone')) return 2.2;
  if (traits.includes('Durable')) return 0.45;
  return 1;
}
