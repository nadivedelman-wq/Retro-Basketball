/**
 * Balancing defaults in one place: roster sizes, salary bands, Coach Coin (CC) rewards and
 * every coin price. Tweak numbers here; systems read them at runtime.
 */
import type { CoachRole } from '../core/types';

/** Contracted roster: five active players plus up to two bench players. */
export const ROSTER = { active: 5, bench: 2, max: 7 } as const;

export const DEFAULT_CAP_M = 100;

/** Annual salary band ($M) by star rating. */
export const SALARY_BANDS: { maxStars: number; min: number; max: number }[] = [
  { maxStars: 1.0, min: 1, max: 3 },
  { maxStars: 2.0, min: 3, max: 6 },
  { maxStars: 3.0, min: 6, max: 10 },
  { maxStars: 3.5, min: 10, max: 14 },
  { maxStars: 4.0, min: 14, max: 18 },
  { maxStars: 4.5, min: 18, max: 22 },
  { maxStars: 5.0, min: 22, max: 26 },
];

export const COINS = {
  win: 3,
  loss: 1,
  championship: 15,
  /** Small bonus on wins when fans are fired up (fan support >= threshold). */
  fanBonus: 1,
  fanBonusThreshold: 80,
  /** One-time milestone bonuses. */
  achievements: {
    firstWin: { label: 'First win as head coach', coins: 2 },
    streak5: { label: 'Five-game winning streak', coins: 3 },
    playoffs: { label: 'Clinched a playoff spot', coins: 3 },
    bigGame: { label: 'A player scored 30 in a game', coins: 1 },
    seriesWin: { label: 'Won a playoff series', coins: 2 },
  } as Record<string, { label: string; coins: number }>,
};

/** Three upgrade tracks, each bought level by level (0 = not bought). */
export const UPGRADES = {
  fans: { name: 'Fan Engagement', costs: [8, 16, 28], effects: ['+5 fan support; fewer negative morale events', '+10 fan support; larger boost per home win', 'Maximum fan support boost; morale recovers faster'] },
  training: { name: 'Training Facility', costs: [10, 20, 35], effects: ['+15% player XP', '+30% player XP; better off-season growth', '+45% player XP; strongest off-season growth'] },
  recovery: { name: 'Recovery Facility', costs: [10, 20, 35], effects: ['Faster condition recovery between games', 'Slower in-game fatigue; shorter injuries', 'Maximum recovery; much shorter injuries'] },
} as const;
export type UpgradeKind = keyof typeof UPGRADES;
export const UPGRADE_MAX = 3;

/** Coaches: one per role, hired at a tier. */
export const COACH_TIERS = [
  { tier: 1, label: 'Basic', cost: 12 },
  { tier: 2, label: 'Strong', cost: 25 },
  { tier: 3, label: 'Elite', cost: 45 },
] as const;
export const COACH_ROLES: Record<CoachRole, { title: string; effect: (tier: number) => string }> = {
  offense: { title: 'Offensive Coach', effect: (t) => (t ? `+${t * 2}% shot timing quality; sharper ball movement` : 'No bonus') },
  defense: { title: 'Defensive Coach', effect: (t) => (t ? `+${t * 4}% defensive pressure and contests` : 'No bonus') },
  development: { title: 'Development Coach', effect: (t) => (t ? `+${t * 12}% player XP; better draft scouting` : 'No bonus') },
};

/** Coin price to unlock a market player (a one-time fee; salary is separate). */
export const MARKET = {
  priceRange: { 4: [20, 30], 4.5: [30, 40], 5: [40, 55] } as Record<number, [number, number]>,
  minOffers: 3,
  maxOffers: 5,
  /** Offers refresh after this many of your games. */
  refreshEveryGames: 3,
};

/** Trades: CPU clubs give draft picks for your players. */
export const TRADES = {
  /** Chance after each of your regular-season games that a club makes an offer on its own. */
  offerChance: 0.2,
  /** Trade value (stars, plus upside for players 24 and under) that draws a first-round pick. */
  firstRoundValue: 2.5,
  /** Below this value no club offers a pick. */
  secondRoundValue: 1,
  /** Best player a first-round pick fetches (the #1 pick); the last first-rounder fetches a star less. */
  firstRoundPlayerMax: 3.5,
  /** Star range of the player a second-round pick fetches. */
  secondRoundPlayer: [1, 2] as [number, number],
};

/** Free agents: a paged board of 0.5 to 3.5-star players you sign with Coach Coins plus cap room. */
export const FREE_AGENTS = {
  /** Players generated on each refresh. */
  poolSize: 40,
  perPage: 10,
  /** The board turns over by itself after this many of your regular-season games. */
  refreshEveryGames: 5,
  /** Coach Coins to refresh the board right away. */
  refreshCost: 30,
  /** How often each star level appears in a fresh board. */
  starWeights: { 0.5: 4, 1: 6, 1.5: 7, 2: 7, 2.5: 6, 3: 5, 3.5: 3 } as Record<number, number>,
  /** Coach Coins to sign, by star rating (players above 3.5 stars cost the last entry). */
  signFee: { 0.5: 1, 1: 2, 1.5: 3, 2: 5, 2.5: 7, 3: 10, 3.5: 14, 4: 18 } as Record<number, number>,
};

/** Coach Coins for passing on a draft pick: first-round picks pay from pick 1 down to the last pick. */
export const DRAFT_PASS = { firstRoundMax: 20, firstRoundMin: 8, secondRound: 4 };

export const CAP_UPGRADE = { stepM: 5, baseCost: 60, growth: 1.5 };

/** Morale bands and their bounded rating modifier. */
export const MORALE_BANDS = [
  { min: 80, label: 'Excellent', mod: 0.04 },
  { min: 60, label: 'Good', mod: 0 },
  { min: 40, label: 'Frustrated', mod: -0.04 },
  { min: 20, label: 'Unhappy', mod: -0.08 },
  { min: 0, label: 'Disengaged', mod: -0.12 },
] as const;

/** Team dinner: a small coin sink for morale. */
export const TEAM_DINNER = { cost: 6, morale: 8 };

/** Starting stars for a new franchise's seven players. */
export const STARTING_USER_STARS = [3.0, 2.5, 2.0, 2.0, 1.5, 1.0, 0.5];
