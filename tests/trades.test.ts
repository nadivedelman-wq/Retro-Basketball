import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { advanceDay, withRng } from '../src/sim/season';
import { advanceOffseason, currentPick, finishResignings, passPickCoins, passPickForCoins, runCpuPicks, runLottery } from '../src/sim/offseason';
import { acceptTrade, declineTrade, shopPlayer, tradeRound } from '../src/sim/trades';
import { validateLeague } from '../src/sim/transactions';
import { stars } from '../src/sim/players';
import { DRAFT_PASS } from '../src/sim/config';
import type { LeagueSave } from '../src/core/types';

const make = (seed = 5) => createLeague({ seed, userTeamId: 'nyc', coachName: 'T', settings: { ...DEFAULT_SETTINGS }, slot: 't' });
const unwrap = (r: ReturnType<typeof shopPlayer>): LeagueSave => {
  if (!r.ok) throw new Error(r.error);
  return r.league;
};

describe('trades', () => {
  it('shops a player for a draft pick, once per day, and completes the trade', () => {
    let l = make();
    const best = userTeam(l).rosterIds.map((id) => l.players[id]).sort((a, b) => stars(b) - stars(a))[0];
    expect(tradeRound(best)).toBe(1);
    l = unwrap(shopPlayer(l, best.id));
    const o = l.tradeOffer!;
    expect(o.playerId).toBe(best.id);
    expect(o.pick.round).toBe(1);
    expect(o.pick.season).toBe(1);
    const again = shopPlayer(l, best.id);
    expect(again.ok).toBe(false);

    l = unwrap(acceptTrade(l));
    expect(l.tradeOffer).toBeUndefined();
    expect(userTeam(l).rosterIds).not.toContain(best.id);
    expect(l.teams.find((t) => t.id === o.teamId)!.rosterIds).toContain(best.id);
    const pick = l.draftPicks.find((p) => p.season === 1 && p.round === 1 && p.originalTeamId === o.pick.originalTeamId)!;
    expect(pick.ownerTeamId).toBe('nyc');
    validateLeague(l);

    // The traded pick is used in the draft.
    let guard = 0;
    while (l.phase !== 'offseason' && guard++ < 500) advanceDay(l);
    advanceOffseason(l);
    withRng(l, (rng) => finishResignings(l, rng));
    withRng(l, (rng) => runLottery(l, rng));
    const mine = l.draft!.order.filter((s) => s.teamId === 'nyc' && s.round === 1);
    expect(mine.map((s) => s.originalTeamId)).toContain(o.pick.originalTeamId);
    expect(mine).toHaveLength(2);
  });

  it('nobody offers a pick for a 0.5-star player', () => {
    const l = make();
    const worst = userTeam(l).rosterIds.map((id) => l.players[id]).find((p) => tradeRound(p) === null);
    if (!worst) return;
    const r = unwrap(shopPlayer(l, worst.id));
    expect(r.tradeOffer).toBeUndefined();
  });

  it('clubs make offers on their own during the season, and declining clears them', () => {
    let l = make(9);
    let offers = 0;
    let guard = 0;
    while (l.phase === 'regular' && guard++ < 100) {
      advanceDay(l);
      if (l.tradeOffer) {
        offers++;
        expect(l.tradeOffer.pick.season).toBe(1);
        l = unwrap(declineTrade(l));
      }
    }
    console.log('unsolicited offers in 20 games:', offers);
    expect(offers).toBeGreaterThan(0);
  });

  it('passing on a draft pick pays Coach Coins', () => {
    const l = make(3);
    let guard = 0;
    while (l.phase !== 'offseason' && guard++ < 500) advanceDay(l);
    advanceOffseason(l);
    withRng(l, (rng) => finishResignings(l, rng));
    withRng(l, (rng) => runLottery(l, rng));
    runCpuPicks(l);
    const slot = currentPick(l)!;
    expect(slot.teamId).toBe('nyc');
    const coins = passPickCoins(l, slot);
    expect(coins).toBeLessThanOrEqual(DRAFT_PASS.firstRoundMax);
    expect(coins).toBeGreaterThanOrEqual(slot.round === 1 ? DRAFT_PASS.firstRoundMin : DRAFT_PASS.secondRound);
    const before = userTeam(l).credits;
    passPickForCoins(l);
    expect(userTeam(l).credits).toBe(before + coins);
    expect(l.draft!.log.at(-1)!.playerId).toBe('');
    expect(passPickCoins(l, { round: 1, pick: 1 })).toBe(DRAFT_PASS.firstRoundMax);
    expect(passPickCoins(l, { round: 1, pick: 30 })).toBe(DRAFT_PASS.firstRoundMin);
  });
});
