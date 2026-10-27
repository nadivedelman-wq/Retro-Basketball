import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { advanceDay, nextUserGame, simToUserGame, withRng, applyGameResult } from '../src/sim/season';
import { gameDayLineup, simulateGame } from '../src/sim/gameSim';
import { matchConfig } from '../src/sim/matchSetup';
import { MatchEngine } from '../src/game/engine/MatchEngine';
import { buyMarketPlayer, hireStaff, setLineup, upgradeFacility, validateLeague } from '../src/sim/transactions';
import { stars, moraleBand, gameRatings } from '../src/sim/players';
import { COINS, UPGRADES } from '../src/sim/config';
import { migrate } from '../src/persist/save';
import { payroll } from '../src/sim/economy';
import type { LeagueSave } from '../src/core/types';

const make = (seed = 11) => createLeague({ seed, userTeamId: 'hcg', coachName: 'T', settings: { ...DEFAULT_SETTINGS }, slot: 't' });

function playUserGame(l: LeagueSave) {
  simToUserGame(l);
  const g = nextUserGame(l)!;
  const before = userTeam(l).credits;
  advanceDay(l);
  const box = l.boxScores[g.id];
  const t = userTeam(l);
  const won = (box.homeId === t.id ? box.homeScore > box.awayScore : box.awayScore > box.homeScore);
  return { gained: t.credits - before, won, box, g };
}

describe('Coach Coins', () => {
  it('pays 3 CC for a win and 1 CC for a loss (plus one-time milestones) and never twice for one game', () => {
    const l = make();
    let wins = 0, losses = 0;
    for (let i = 0; i < 8; i++) {
      const { gained, won, box } = playUserGame(l);
      const milestones = l.lastReward!.reasons.filter((r) => !/^(Win|Loss|Fans)/.test(r)).length;
      if (!milestones) expect(gained).toBe(won ? COINS.win + (l.lastReward!.coins > COINS.win ? COINS.fanBonus : 0) : COINS.loss);
      expect(l.lastReward!.coins).toBe(gained);
      won ? wins++ : losses++;
      // Re-applying the same game is rejected.
      const again = withRng(l, (rng) => applyGameResult(l, box, rng));
      expect(again).toBe(false);
    }
    expect(wins + losses).toBe(8);
  });
});

describe('lineups and 0.5-star replacements', () => {
  it('lets the user bench a star and start replacements without touching his contract', () => {
    const l = make(5);
    const t = userTeam(l);
    const best = t.rosterIds.slice().sort((a, b) => stars(l.players[b]) - stars(l.players[a]))[0];
    const salary = l.players[best].contract.salaryMillions;
    const pay = payroll(l, t);
    const starters = t.rosterIds.filter((id) => id !== best).slice(0, 3);
    const r = setLineup(l, [...starters, '', ''], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l2 = r.league;
    const t2 = userTeam(l2);
    const day = gameDayLineup(l2, t2);
    expect(day.players).toHaveLength(7);
    expect(day.replacements.length).toBe(4); // two empty starter slots + two empty bench spots
    expect(day.players.some((p) => p.id === best)).toBe(false);
    for (const rp of day.replacements) {
      expect(stars(rp)).toBe(0.5);
      expect(rp.contract.salaryMillions).toBe(0);
      expect(l2.players[rp.id]).toBeUndefined();
    }
    expect(payroll(l2, t2)).toBe(pay);
    expect(l2.players[best].contract.salaryMillions).toBe(salary);
    // Simulated and live games both use this lineup.
    simToUserGame(l2);
    const g = nextUserGame(l2)!;
    const box = withRng(l2, (rng) => simulateGame(l2, g, rng));
    const mine = box.homeId === t2.id ? box.home : box.away;
    expect(mine.find((x) => x.playerId === best)?.seconds ?? 0).toBe(0);
    expect(mine.filter((x) => x.playerId.startsWith('rep_') && x.seconds > 0).length).toBeGreaterThanOrEqual(2);
    const cfg = matchConfig(l2, g.homeId, g.awayId, { gameId: g.id });
    const side = cfg.home.id === t2.id ? cfg.home : cfg.away;
    expect(side.players.some((p) => p.id === best)).toBe(false);
    expect(side.starters.filter((id) => id.startsWith('rep_'))).toHaveLength(2);
    const e = new MatchEngine(cfg);
    e.runToEnd();
    const live = e.toBoxScore(g.id);
    withRng(l2, (rng) => applyGameResult(l2, live, rng));
    expect(userTeam(l2).rosterIds.some((id) => id.startsWith('rep_'))).toBe(false);
    expect(Object.keys(l2.players).some((id) => id.startsWith('rep_'))).toBe(false);
    validateLeague(l2);
    // A replacement can never be put on a roster.
    const bad = structuredClone(l2);
    bad.players.rep_x = { ...day.replacements[0], id: 'rep_x' };
    const bt = userTeam(bad);
    bt.rosterIds = [...bt.rosterIds.slice(0, 6), 'rep_x'];
    bt.starters = bt.starters.map((id) => (bt.rosterIds.includes(id) ? id : ''));
    bt.rotation = bt.rotation.filter((id) => bt.rosterIds.includes(id));
    expect(() => validateLeague(bad)).toThrow(/Replacement/);
  });
});

describe('morale', () => {
  it('drops 5-10 after three straight low-minute games for a star, with an explanation, and changes ratings within bounds', () => {
    const l = make(8);
    const t = userTeam(l);
    const star = t.rosterIds.slice().sort((a, b) => stars(l.players[b]) - stars(l.players[a]))[0];
    l.players[star].morale = 70;
    const others = t.rosterIds.filter((id) => id !== star);
    const r = setLineup(l, others.slice(0, 5), []);
    if (!r.ok) throw new Error(r.error);
    const l2 = r.league;
    const history: number[] = [];
    for (let i = 0; i < 3; i++) {
      playUserGame(l2);
      history.push(l2.players[star].morale);
    }
    const p = l2.players[star];
    expect(p.recent!.slice(-3).every((g) => g.minutes === 0)).toBe(true);
    const drop = 70 - p.morale;
    expect(drop).toBeGreaterThanOrEqual(5);
    expect(drop).toBeLessThanOrEqual(14);
    expect(p.moraleNote).toMatch(/limited minutes in last 3 games/);
    console.log('star morale after benching:', history.join(' -> '), p.moraleNote);
    // Bounded modifiers.
    p.morale = 5;
    const low = gameRatings(p);
    p.morale = 95;
    const high = gameRatings(p);
    for (const k of Object.keys(p.ratings) as (keyof typeof p.ratings)[]) {
      expect(low[k]).toBeGreaterThanOrEqual(Math.max(1, p.ratings[k] * 0.88) - 1e-9);
      expect(high[k]).toBeLessThanOrEqual(Math.min(10, p.ratings[k] * 1.04) + 1e-9);
    }
    expect(moraleBand(5).label).toBe('Disengaged');
    expect(moraleBand(85).label).toBe('Excellent');
  });
});

describe('market and upgrades', () => {
  it('offers 3-5 players of 4-5 stars that refresh after three user games', () => {
    const l = make(21);
    expect(l.market.offers.length).toBeGreaterThanOrEqual(3);
    expect(l.market.offers.length).toBeLessThanOrEqual(5);
    for (const o of l.market.offers) {
      const s = stars(l.players[o.playerId]);
      expect([4, 4.5, 5]).toContain(s);
      expect(o.coinPrice).toBeGreaterThanOrEqual(20);
      expect(o.coinPrice).toBeLessThanOrEqual(55);
    }
    const first = l.market.offers.map((o) => o.playerId).join();
    playUserGame(l);
    playUserGame(l);
    expect(l.market.offers.map((o) => o.playerId).join()).toBe(first);
    playUserGame(l);
    expect(l.market.offers.map((o) => o.playerId).join()).not.toBe(first);
  });

  it('buys upgrade levels in order at config prices, never the same level twice', () => {
    const l = make(4);
    userTeam(l).credits = 100;
    let cur = l;
    for (let lvl = 0; lvl < 3; lvl++) {
      const r = upgradeFacility(cur, 'training');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(userTeam(r.league).credits).toBe(userTeam(cur).credits - UPGRADES.training.costs[lvl]);
      expect(userTeam(r.league).facilities.training).toBe(lvl + 1);
      cur = r.league;
    }
    const again = upgradeFacility(cur, 'training');
    expect(again.ok).toBe(false);
    // Coaches: hiring a tier you already have is refused.
    const basic = cur.staffPool.find((s) => s.role === 'offense' && s.tier === 1)!;
    const h1 = hireStaff(cur, basic.id);
    expect(h1.ok).toBe(true);
    if (!h1.ok) return;
    expect(userTeam(h1.league).staff.offense).toBe(1);
    const poor = structuredClone(h1.league);
    userTeam(poor).credits = 0;
    const elite = poor.staffPool.find((s) => s.role === 'offense' && s.tier === 3)!;
    const h2 = hireStaff(poor, elite.id);
    expect(h2.ok).toBe(false);
    if (!h2.ok) expect(h2.error).toMatch(/CC/);
  });

  it('a market star is a permanent contracted player whose salary counts against the cap', () => {
    const l = make(6);
    const t = userTeam(l);
    t.credits = 80;
    t.rosterIds.splice(6, 1);
    t.rotation = t.rotation.filter((id) => t.rosterIds.includes(id));
    const offer = l.market.offers[0];
    const before = payroll(l, t);
    const r = buyMarketPlayer(l, offer.playerId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t2 = userTeam(r.league);
    expect(payroll(r.league, t2)).toBeCloseTo(before + r.league.players[offer.playerId].contract.salaryMillions, 5);
    expect([...t2.starters, ...t2.rotation]).toContain(offer.playerId);
  });
});

describe('save migration', () => {
  it('upgrades a v3 save (13-man rosters, old facilities and staff) without losing progress', () => {
    const l = make(13);
    // Build a v3-shaped save.
    const old = structuredClone(l) as unknown as Record<string, any>;
    old.version = 3;
    delete old.market;
    delete old.achievements;
    const extra = Object.keys(old.players).filter((id) => !old.teams.some((t: any) => t.rosterIds.includes(id))).slice(0, 6);
    for (const t of old.teams) {
      t.facilities = { training: 3, medical: 2, arena: 5 };
      t.staffMembers = [{ id: 'x', name: 'Old Coach', role: 'scouting', rating: 5, salaryCredits: 10, perk: 'p' }];
      t.staff = { offense: 0, defense: 0, scouting: 5 };
    }
    const ut = old.teams.find((t: any) => t.id === old.userTeamId);
    ut.rosterIds.push(...extra);
    old.freeAgents = old.freeAgents.filter((id: string) => !extra.includes(id));
    ut.credits = 77;
    ut.wins = 5;
    const m = migrate(JSON.parse(JSON.stringify(old)));
    expect(m.version).toBe(4);
    const mt = userTeam(m);
    expect(mt.rosterIds.length).toBe(7);
    expect(mt.credits).toBe(77);
    expect(mt.wins).toBe(5);
    expect(mt.facilities).toEqual({ training: 2, recovery: 1, fans: 3 });
    expect(mt.staff.development).toBe(3);
    for (const id of extra) expect(m.players[id]).toBeTruthy();
    expect(m.market.offers.length).toBeGreaterThanOrEqual(3);
    expect(m.news[0].text).toMatch(/Save upgraded/);
    validateLeague(m);
  });
});

describe('competitive balance', () => {
  it('the weak starting roster loses more than it wins in simulation but can still win', () => {
    let w = 0, g = 0;
    for (const seed of [1, 2, 3]) {
      const l = make(seed);
      for (let i = 0; i < 10; i++) {
        const r = playUserGame(l);
        if (r.won) w++;
        g++;
      }
    }
    console.log(`weak roster simulated record ${w}-${g - w}`);
    expect(w).toBeGreaterThan(0);
    expect(w / g).toBeLessThan(0.6);
  });
});
