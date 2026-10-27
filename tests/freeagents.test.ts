import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { advanceDay, startAtSeasonFinale, withRng } from '../src/sim/season';
import { buyFreeAgentRefresh, freeAgentBoard, freeAgentFee, refreshFreeAgents, signFreeAgentForCoins } from '../src/sim/freeAgents';
import { acceptTrade, findPlayerForPick, pickStarRange, shopPick, userPicks } from '../src/sim/trades';
import { advanceOffseason, currentPick, finishResignings, runCpuPicks, runLottery } from '../src/sim/offseason';
import { validateLeague, type TxResult } from '../src/sim/transactions';
import { stars } from '../src/sim/players';
import { FREE_AGENTS } from '../src/sim/config';
import type { LeagueSave } from '../src/core/types';

const make = (seed = 21) => createLeague({ seed, userTeamId: 'nyc', coachName: 'T', settings: { ...DEFAULT_SETTINGS }, slot: 't' });
const unwrap = (r: TxResult): LeagueSave => {
  if (!r.ok) throw new Error(r.error);
  return r.league;
};

describe('free agents', () => {
  it('a new career starts with a full, paged board of 0.5 to 3.5-star players', () => {
    const l = make();
    startAtSeasonFinale(l);
    const board = freeAgentBoard(l);
    expect(board).toHaveLength(FREE_AGENTS.poolSize);
    expect(board.length).toBeGreaterThan(FREE_AGENTS.perPage * 2);
    for (const p of board) {
      expect(stars(p)).toBeGreaterThanOrEqual(0.5);
      expect(stars(p)).toBeLessThanOrEqual(3.5);
    }
    expect(board.some((p) => stars(p) >= 3)).toBe(true);
    validateLeague(l);
  });

  it('signs a 3-star free agent for coins and cap room, and refuses without enough coins', () => {
    let l = make();
    withRng(l, (rng) => refreshFreeAgents(l, rng));
    const target = freeAgentBoard(l).find((p) => stars(p) === 3)!;
    const fee = freeAgentFee(target);
    expect(fee).toBe(FREE_AGENTS.signFee[3]);
    // Make room and give coins.
    const drop = userTeam(l).rosterIds.at(-1)!;
    userTeam(l).rosterIds = userTeam(l).rosterIds.filter((id) => id !== drop);
    userTeam(l).starters = userTeam(l).starters.map((id) => (id === drop ? '' : id));
    userTeam(l).rotation = userTeam(l).rotation.filter((id) => id !== drop);
    l.freeAgents.push(drop);
    userTeam(l).credits = fee - 1;
    expect(signFreeAgentForCoins(l, target.id).ok).toBe(false);
    userTeam(l).credits = fee + 5;
    l = unwrap(signFreeAgentForCoins(l, target.id));
    expect(userTeam(l).rosterIds).toContain(target.id);
    expect(userTeam(l).credits).toBe(5);
    expect(l.freeAgents).not.toContain(target.id);
    validateLeague(l);
  });

  it('the board refreshes every few games by itself, or right away for coins', () => {
    let l = make(22);
    withRng(l, (rng) => refreshFreeAgents(l, rng));
    const first = l.freeAgents.slice();
    for (let i = 0; i < FREE_AGENTS.refreshEveryGames; i++) advanceDay(l);
    expect(l.freeAgents.some((id) => first.includes(id))).toBe(false);
    expect(l.freeAgents).toHaveLength(FREE_AGENTS.poolSize);
    for (const id of first) expect(l.players[id]?.careerStats.games ?? 0).toBe(0);

    userTeam(l).credits = FREE_AGENTS.refreshCost - 1;
    expect(buyFreeAgentRefresh(l).ok).toBe(false);
    userTeam(l).credits = FREE_AGENTS.refreshCost;
    const before = l.freeAgents.slice();
    l = unwrap(buyFreeAgentRefresh(l));
    expect(userTeam(l).credits).toBe(0);
    expect(l.freeAgents.some((id) => before.includes(id))).toBe(false);
  });
});

describe('trading picks for players', () => {
  it('a first-round pick fetches a player in its star range who joins the roster', () => {
    let l = make(23);
    const t = userTeam(l);
    // Open a roster spot.
    const drop = t.rosterIds.at(-1)!;
    t.rosterIds = t.rosterIds.filter((id) => id !== drop);
    t.starters = t.starters.map((id) => (id === drop ? '' : id));
    t.rotation = t.rotation.filter((id) => id !== drop);
    l.freeAgents.push(drop);
    const pick = userPicks(l).find((p) => p.round === 1 && p.season === 1)!;
    const [lo, hi] = pickStarRange(l, pick);
    expect(hi - lo).toBe(1);
    l = unwrap(shopPick(l, pick));
    expect(shopPick(l, pick).ok).toBe(false); // once per day
    const o = l.tradeOffer!;
    expect(o.userGives).toBe('pick');
    const p = l.players[o.playerId];
    expect(stars(p)).toBeGreaterThanOrEqual(lo);
    expect(stars(p)).toBeLessThanOrEqual(hi);
    l = unwrap(acceptTrade(l));
    expect(userTeam(l).rosterIds).toContain(p.id);
    expect(l.teams.find((x) => x.id === o.teamId)!.rosterIds).not.toContain(p.id);
    expect(l.draftPicks.find((x) => x.season === 1 && x.round === 1 && x.originalTeamId === 'nyc')!.ownerTeamId).toBe(o.teamId);
    expect(userPicks(l).some((x) => x.season === 1 && x.round === 1)).toBe(false);
    validateLeague(l);
  });

  it('refuses when the roster is full', () => {
    const l = make(24);
    expect(userTeam(l).rosterIds).toHaveLength(7);
    expect(shopPick(l, userPicks(l)[0]).ok).toBe(false);
  });

  it('trading the pick on the clock during the draft hands the turn to the club', () => {
    let l = make(25);
    let guard = 0;
    while (l.phase !== 'offseason' && guard++ < 500) advanceDay(l);
    advanceOffseason(l);
    withRng(l, (rng) => finishResignings(l, rng));
    withRng(l, (rng) => runLottery(l, rng));
    runCpuPicks(l);
    const slot = currentPick(l)!;
    expect(slot.teamId).toBe('nyc');
    const t = userTeam(l);
    while (t.rosterIds.length >= 7) {
      const drop = t.rosterIds.at(-1)!;
      t.rosterIds = t.rosterIds.filter((id) => id !== drop);
      t.starters = t.starters.map((id) => (id === drop ? '' : id));
      t.rotation = t.rotation.filter((id) => id !== drop);
      l.freeAgents.push(drop);
    }
    t.capMillions = 200;
    const pk = userPicks(l).find((p) => p.season === l.season && p.round === slot.round && p.originalTeamId === slot.originalTeamId)!;
    const o = withRng(l, (rng) => findPlayerForPick(l, pk, rng))!;
    expect(o).toBeTruthy();
    l.tradeOffer = o;
    l = unwrap(acceptTrade(l));
    expect(currentPick(l)!.teamId).toBe(o.teamId);
    runCpuPicks(l);
    expect(l.draft!.log.find((x) => x.round === slot.round && x.pick === slot.pick)!.teamId).toBe(o.teamId);
    validateLeague(l);
  });
});
