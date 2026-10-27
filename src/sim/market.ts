/**
 * The player market: a small, saved selection of 4.0-5.0 star players. Unlocking one costs Coach
 * Coins once; his salary then counts against the cap every season like any contract. Offers refresh
 * after every few of the user's games, never on screen open, so they cannot be rerolled.
 */
import { Rng, clamp } from '../core/rng';
import type { LeagueSave, Position } from '../core/types';
import { MARKET } from './config';
import { newId } from './league';
import { generatePlayer, stars } from './players';

const MARKET_STARS = [4, 4.5, 5];

export function coinPrice(starsValue: number, age: number, potential: number, rng: Rng): number {
  const [lo, hi] = MARKET.priceRange[starsValue] ?? MARKET.priceRange[4];
  let t = rng.range(0.2, 0.8);
  if (age <= 24) t += 0.15;
  if (age >= 31) t -= 0.25;
  if (potential > starsValue) t += 0.1;
  return Math.round(lo + (hi - lo) * clamp(t, 0, 1));
}

/** Replace unsold offers with a fresh selection of 3-5 players at different positions. */
export function refreshMarket(league: LeagueSave, rng: Rng) {
  for (const o of league.market?.offers ?? []) {
    const p = league.players[o.playerId];
    const signed = league.teams.some((t) => t.rosterIds.includes(o.playerId));
    if (p && !signed) delete league.players[o.playerId];
  }
  const n = rng.int(MARKET.minOffers, MARKET.maxOffers);
  const positions = rng.shuffle(['PG', 'SG', 'SF', 'PF', 'C'] as Position[]);
  const offers: LeagueSave['market']['offers'] = [];
  for (let i = 0; i < n; i++) {
    const target = rng.weighted(MARKET_STARS, (s) => (s === 4 ? 5 : s === 4.5 ? 3 : 2));
    const age = rng.int(21, 32);
    const p = generatePlayer(rng, {
      id: newId(league, 'p'),
      position: positions[i % positions.length],
      target,
      exactStars: true,
      age,
      potential: Math.min(5, target + (age <= 25 ? rng.int(0, 2) * 0.5 : 0)),
    });
    p.morale = rng.int(55, 85);
    p.contract.yearsRemaining = rng.int(1, 4);
    league.players[p.id] = p;
    offers.push({ playerId: p.id, coinPrice: coinPrice(stars(p), p.age, p.potential, rng) });
  }
  league.market = { offers, gamesUntilRefresh: MARKET.refreshEveryGames };
}

/** Called after each user game; refreshes when the countdown reaches zero. */
export function tickMarket(league: LeagueSave, rng: Rng) {
  league.market.gamesUntilRefresh--;
  if (league.market.gamesUntilRefresh <= 0) refreshMarket(league, rng);
}
