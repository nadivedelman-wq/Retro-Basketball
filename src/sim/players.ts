import { Rng, clamp } from '../core/rng';
import {
  RATING_KEYS,
  emptyStats,
  type Appearance,
  type Archetype,
  type Personality,
  type Player,
  type Position,
  type Ratings,
} from '../core/types';
import { FIRST_NAMES, LAST_NAMES } from './data';

/** Archetype rating templates (1-10). Higher template values also weigh more in the overall. */
export const ARCHETYPES: Record<Archetype, { positions: Position[]; tpl: Ratings; blurb: string }> = {
  Playmaker: { positions: ['PG'], tpl: { shooting: 6, finishing: 5, passing: 8, dribbling: 8, defense: 5, rebounding: 3, athleticism: 6, stamina: 7 }, blurb: 'Runs the offence, creates for others.' },
  Sharpshooter: { positions: ['SG', 'SF', 'PG'], tpl: { shooting: 8.5, finishing: 4, passing: 5, dribbling: 6, defense: 5, rebounding: 3, athleticism: 5, stamina: 6 }, blurb: 'Lives behind the arc.' },
  Slasher: { positions: ['SG', 'SF'], tpl: { shooting: 4.5, finishing: 8, passing: 5, dribbling: 7, defense: 5, rebounding: 4, athleticism: 8, stamina: 6 }, blurb: 'Attacks the rim at every chance.' },
  '3-and-D': { positions: ['SG', 'SF'], tpl: { shooting: 7, finishing: 4, passing: 4, dribbling: 5, defense: 8, rebounding: 4, athleticism: 6, stamina: 6 }, blurb: 'Hits corner threes, locks down wings.' },
  'Rim Protector': { positions: ['C', 'PF'], tpl: { shooting: 2, finishing: 6, passing: 3, dribbling: 3, defense: 8, rebounding: 8, athleticism: 6, stamina: 5 }, blurb: 'Owns the paint on defence.' },
  'Stretch Big': { positions: ['PF', 'C'], tpl: { shooting: 7, finishing: 5, passing: 4, dribbling: 4, defense: 5, rebounding: 6, athleticism: 5, stamina: 5 }, blurb: 'Pulls bigs out to the arc.' },
  'Post Scorer': { positions: ['PF', 'C'], tpl: { shooting: 4, finishing: 8, passing: 5, dribbling: 4, defense: 5, rebounding: 7, athleticism: 5, stamina: 5 }, blurb: 'Scores with his back to the basket.' },
  'All-Rounder': { positions: ['SF', 'SG', 'PF'], tpl: { shooting: 6, finishing: 6, passing: 6, dribbling: 6, defense: 6, rebounding: 6, athleticism: 6, stamina: 6 }, blurb: 'Does a bit of everything.' },
};

export const TRAITS: Record<string, string> = {
  Clutch: '+5% shooting in the last 2 minutes of close games.',
  Streaky: 'Hot and cold streaks swing his shooting twice as hard.',
  'Floor General': 'Passes are harder to intercept; harder to strip; lifts team chemistry.',
  'Defensive Anchor': 'Better shot blocking; improves team defence in simulation.',
  'Injury Prone': 'More than twice as likely to get hurt.',
  Durable: 'Less than half as likely to get hurt.',
  'High Motor': 'Tires slower and crashes the glass harder.',
  'Locker-Room Leader': 'Raises teammates’ morale every week.',
  Selfish: 'Takes more shots; hurts chemistry and sulks without minutes.',
  'Quick Learner': '+25% development XP.',
};

const PERSONALITIES: Personality[] = ['Leader', 'Competitor', 'Easygoing', 'Mercenary', 'Hothead', 'Quiet'];

const HEIGHTS: Record<Position, [number, number]> = {
  PG: [183, 196],
  SG: [190, 201],
  SF: [198, 206],
  PF: [203, 211],
  C: [208, 221],
};

/** Overall rating 1-10 weighted toward what the archetype is supposed to be good at. */
export function overall(p: Pick<Player, 'ratings' | 'archetype'>): number {
  const tpl = ARCHETYPES[p.archetype].tpl;
  let s = 0;
  let w = 0;
  for (const k of RATING_KEYS) {
    const wk = Math.pow(tpl[k], 1.6);
    s += p.ratings[k] * wk;
    w += wk;
  }
  return s / w;
}

/** Star rating 0.5-5 in half steps. */
export function starsFromOverall(ovr: number): number {
  return clamp(Math.round(((ovr - 2.6) / 6.2) * 5 * 2) / 2, 0.5, 5);
}

export function stars(p: Pick<Player, 'ratings' | 'archetype'>): number {
  return starsFromOverall(overall(p));
}

/** Salary in $M a player would command, before market noise. */
export function marketSalary(p: Pick<Player, 'ratings' | 'archetype' | 'age' | 'morale'>): number {
  const s = stars(p);
  let base = 1 + 34 * Math.pow((s - 0.5) / 4.5, 2.1);
  if (p.age >= 32) base *= 0.85;
  if (p.age >= 35) base *= 0.75;
  if (p.age <= 23) base *= 0.95;
  return Math.round(clamp(base, 1, 35) * 10) / 10;
}

export function demandYears(p: Pick<Player, 'age'>, s: number, rng: Rng): number {
  if (p.age >= 33) return rng.int(1, 2);
  if (p.age <= 25 && s >= 3) return rng.int(3, 4);
  return rng.int(1, 3);
}

export function randomAppearance(rng: Rng): Appearance {
  const acc = rng.weighted(['none', 'headband', 'wristbands', 'goggles', 'armsleeve'] as const, (a) => (a === 'none' ? 6 : a === 'goggles' ? 0.5 : 1.2));
  return {
    skin: rng.int(0, 5),
    hair: rng.int(0, 7),
    hairColor: rng.weighted([0, 1, 2, 3, 4, 5], (c) => [6, 3, 2, 1, 0.6, 0.3][c]),
    build: rng.weighted([0, 1, 2], (b) => [3, 5, 2][b]),
    accessory: acc,
    beard: rng.chance(0.25),
  };
}

export type GenOptions = {
  position?: Position;
  archetype?: Archetype;
  /** Target star level 0.5-5. */
  target: number;
  age?: number;
  id: string;
  usedNumbers?: Set<number>;
  draftProspect?: boolean;
};

export function generatePlayer(rng: Rng, o: GenOptions): Player {
  const position = o.position ?? rng.pick(['PG', 'SG', 'SF', 'PF', 'C'] as Position[]);
  const archetypes = (Object.keys(ARCHETYPES) as Archetype[]).filter((a) => ARCHETYPES[a].positions.includes(position));
  const archetype = o.archetype ?? rng.pick(archetypes);
  const tpl = ARCHETYPES[archetype].tpl;
  const age = o.age ?? clamp(Math.round(rng.normal(26, 4)), 19, 37);
  const ratings = {} as Ratings;
  // Solve for the offset that lands near the target star level, then add noise.
  const shift = (o.target / 5) * 6.2 + 2.6 - 6.1;
  for (const k of RATING_KEYS) ratings[k] = clamp(Math.round(tpl[k] + shift + rng.normal(0, 0.9)), 1, 10);
  const [hmin, hmax] = HEIGHTS[position];
  const heightCm = rng.int(hmin, hmax);
  const weightKg = Math.round(heightCm * 0.48 + rng.normal(0, 6));
  const traits: string[] = [];
  const traitPool = Object.keys(TRAITS);
  const nTraits = rng.weighted([0, 1, 2], (n) => [4, 5, 2][n]);
  while (traits.length < nTraits) {
    const t = rng.pick(traitPool);
    if (traits.includes(t)) continue;
    if ((t === 'Durable' && traits.includes('Injury Prone')) || (t === 'Injury Prone' && traits.includes('Durable'))) continue;
    traits.push(t);
  }
  const personality = traits.includes('Locker-Room Leader') ? 'Leader' : traits.includes('Selfish') ? rng.pick(['Mercenary', 'Hothead'] as Personality[]) : rng.pick(PERSONALITIES);
  let jersey = rng.int(0, 55);
  if (o.usedNumbers) {
    let tries = 0;
    while (o.usedNumbers.has(jersey) && tries++ < 100) jersey = rng.int(0, 55);
    o.usedNumbers.add(jersey);
  }
  const p: Player = {
    id: o.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    age,
    position,
    secondaryPosition: secondaryFor(position, rng),
    archetype,
    heightCm,
    weightKg,
    hand: rng.chance(0.12) ? 'L' : 'R',
    jerseyNumber: jersey,
    appearance: randomAppearance(rng),
    personality,
    ratings,
    potential: 0,
    scoutedPotential: null,
    scoutLevel: 0,
    xp: 0,
    morale: rng.int(55, 80),
    condition: 100,
    traits,
    contract: { salaryMillions: 1, yearsRemaining: 1 },
    seasonStats: emptyStats(),
    careerStats: emptyStats(),
    history: [],
    form: 0,
    awards: [],
  };
  const s = stars(p);
  const youth = Math.max(0, 25 - age);
  p.potential = clamp(Math.round((s + rng.range(0, 0.35) * youth + rng.normal(0, 0.3)) * 2) / 2, s, 5);
  if (!o.draftProspect) p.scoutedPotential = p.potential;
  const salary = marketSalary(p) * rng.range(0.85, 1.15);
  p.contract = { salaryMillions: Math.round(clamp(salary, 1, 35) * 10) / 10, yearsRemaining: demandYears(p, s, rng) };
  return p;
}

function secondaryFor(p: Position, rng: Rng): Position | undefined {
  const map: Record<Position, Position[]> = { PG: ['SG'], SG: ['PG', 'SF'], SF: ['SG', 'PF'], PF: ['SF', 'C'], C: ['PF'] };
  return rng.chance(0.6) ? rng.pick(map[p]) : undefined;
}

export function fullName(p: Pick<Player, 'firstName' | 'lastName'>) {
  return `${p.firstName} ${p.lastName}`;
}

export function shortName(p: Pick<Player, 'firstName' | 'lastName'>) {
  return `${p.firstName[0]}. ${p.lastName}`;
}

/** Morale/condition-adjusted ratings used on game day. */
export function gameRatings(p: Player): Ratings {
  const r = { ...p.ratings };
  const moraleAdj = p.morale < 30 ? -0.6 : p.morale < 45 ? -0.3 : p.morale > 85 ? 0.2 : 0;
  if (moraleAdj) for (const k of RATING_KEYS) r[k] = clamp(r[k] + moraleAdj, 1, 10);
  return r;
}

/** XP needed for the next development step. */
export const XP_PER_LEVEL = 100;

/**
 * Spend accumulated XP on rating points, respecting potential. Returns the ratings raised.
 * Improvements weigh toward the archetype's key skills.
 */
export function applyDevelopment(p: Player, rng: Rng): string[] {
  const raised: string[] = [];
  const tpl = ARCHETYPES[p.archetype].tpl;
  while (p.xp >= XP_PER_LEVEL) {
    p.xp -= XP_PER_LEVEL;
    if (stars(p) >= p.potential) {
      p.xp = Math.min(p.xp, XP_PER_LEVEL - 1);
      break;
    }
    const k = rng.weighted(RATING_KEYS.filter((k2) => p.ratings[k2] < 10), (k2) => tpl[k2]);
    if (!k) break;
    p.ratings[k]++;
    raised.push(k);
  }
  return raised;
}

/** Off-season aging curve: young players grow toward potential, veterans decline. */
export function ageOneYear(p: Player, rng: Rng, trainingLevel: number): { up: string[]; down: string[] } {
  p.age++;
  const up: string[] = [];
  const down: string[] = [];
  const a = p.age;
  const growth = a <= 21 ? 2.2 : a <= 24 ? 1.4 : a <= 27 ? 0.6 : 0;
  const decline = a >= 34 ? 2.2 : a >= 31 ? 1.2 : a >= 29 ? 0.4 : 0;
  const steps = Math.round(rng.normal(growth * (0.9 + trainingLevel * 0.08), 0.7));
  for (let i = 0; i < steps; i++) {
    if (stars(p) >= p.potential) break;
    const k = rng.weighted(RATING_KEYS.filter((k2) => p.ratings[k2] < 10), (k2) => ARCHETYPES[p.archetype].tpl[k2]);
    if (!k) break;
    p.ratings[k]++;
    up.push(k);
  }
  const dsteps = Math.max(0, Math.round(rng.normal(decline, 0.6)));
  for (let i = 0; i < dsteps; i++) {
    // Athleticism and stamina go first.
    const k = rng.weighted(RATING_KEYS.filter((k2) => p.ratings[k2] > 1), (k2) => (k2 === 'athleticism' || k2 === 'stamina' ? 3 : 1));
    if (!k) break;
    p.ratings[k]--;
    down.push(k);
  }
  // Potential settles as players age.
  if (a >= 27) p.potential = Math.max(stars(p), Math.min(p.potential, stars(p) + 0.5));
  if (p.scoutedPotential !== null && a >= 24) p.scoutedPotential = p.potential;
  return { up, down };
}
