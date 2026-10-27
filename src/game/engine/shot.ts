import { clamp } from '../../core/rng';
import type { Ratings } from '../../core/types';

export type ShotKind = 'jumper' | 'layup' | 'dunk' | 'hook' | 'freeThrow';

export type ShotContext = {
  kind: ShotKind;
  distance: number; // feet to rim
  ratings: Ratings;
  heightCm: number;
  traits: string[];
  /** Distance of the closest defender (ft) and whether that defender is between shooter and rim. */
  contestDist: number;
  contestInFront: boolean;
  contestJumping: boolean;
  energy: number; // 0..1
  form: number; // -1..1 hot/cold
  /** Release timing quality 0..1 (1 = perfect). */
  quality: number;
  clutch: boolean;
  fouled: boolean;
};

/** Base make rates by distance band before ratings, tuned to roughly NBA league averages. */
function baseRate(kind: ShotKind, d: number): number {
  if (kind === 'freeThrow') return 0.5;
  if (kind === 'dunk') return 0.9;
  if (kind === 'layup') return 0.64 - Math.max(0, d - 3) * 0.025;
  if (kind === 'hook') return 0.5 - Math.max(0, d - 5) * 0.025;
  if (d < 10) return 0.44;
  if (d < 16) return 0.42;
  if (d < 22) return 0.41;
  if (d < 26) return 0.38 - Math.max(0, d - 24.5) * 0.02;
  return Math.max(0.05, 0.3 - (d - 26) * 0.035);
}

/** Probability a shot goes in. Ratings, distance, defence, fatigue, form and timing all matter; nothing is forced. */
export function makeProbability(c: ShotContext): number {
  const r = c.ratings;
  let p = baseRate(c.kind, c.distance);
  if (c.kind === 'freeThrow') {
    p = 0.48 + r.shooting * 0.045;
  } else if (c.kind === 'jumper') {
    p += (r.shooting - 5.5) * 0.034;
  } else if (c.kind === 'hook') {
    p += (r.finishing - 5.5) * 0.025 + (r.shooting - 5.5) * 0.01 + (c.heightCm - 200) * 0.002;
  } else {
    p += (r.finishing - 5.5) * 0.035 + (r.athleticism - 5.5) * 0.01;
  }

  if (c.kind !== 'freeThrow') {
    const close = c.kind === 'jumper' ? [0.11, 0.06, 0.025] : [0.12, 0.065, 0.02];
    let contest = 0;
    if (c.contestDist < 2) contest = close[0];
    else if (c.contestDist < 3.5) contest = close[1];
    else if (c.contestDist < 5.5) contest = close[2];
    if (!c.contestInFront) contest *= 0.5;
    if (c.contestJumping) contest *= 1.1;
    if (c.kind === 'dunk') contest *= 0.5;
    p -= contest;
    if (c.fouled) p *= 0.6;
  }

  p -= Math.max(0, 0.72 - clamp(c.energy, 0, 1)) * 0.3;
  const streaky = c.traits.includes('Streaky') ? 2 : 1;
  p += c.form * 0.04 * streaky;
  if (c.clutch && c.traits.includes('Clutch')) p += 0.05;

  // Release timing: perfect timing gives a real but bounded edge, a bad release hurts a lot.
  const timingWeight = c.kind === 'dunk' ? 0.15 : c.kind === 'layup' ? 0.4 : 1;
  p *= 1 - timingWeight * (0.45 - 0.6 * clamp(c.quality, 0, 1));

  return clamp(p, 0.02, 0.98);
}

/** Size of the "perfect" window on the shot meter for a shooter (fraction of the bar). */
export function meterWindow(shooting: number, kind: ShotKind): number {
  const base = kind === 'freeThrow' ? 0.07 : 0.05;
  return base + shooting * 0.008;
}

/** Where the green window is centred on the meter (0..1). */
export const METER_TARGET = 0.78;

/** Timing quality for a release at meter value m. */
export function releaseQuality(m: number, shooting: number, kind: ShotKind): number {
  const w = meterWindow(shooting, kind);
  const off = Math.abs(m - METER_TARGET);
  if (off <= w) return 1;
  return clamp(1 - (off - w) / 0.32, 0, 1);
}
