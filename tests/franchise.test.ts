import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { payroll } from '../src/sim/economy';
import { stars } from '../src/sim/players';
import { advanceDay, nextUserGame, simToUserGame, applyGameResult, withRng } from '../src/sim/season';
import { simulateGame } from '../src/sim/gameSim';
import { advanceOffseason, finishResignings, runLottery, runCpuPicks, startNewSeason, currentPick, draftPlayer, finishDraft } from '../src/sim/offseason';
import { buyMarketPlayer, releasePlayer, setLineup } from '../src/sim/transactions';
import { validateLeague } from '../src/sim/transactions';

const make = (seed = 42, extra = {}) => createLeague({ seed, userTeamId: 'hcg', coachName: 'Coach Test', settings: { ...DEFAULT_SETTINGS, ...extra }, slot: 'test' });

describe('league creation', () => {
  it('creates 30 legal seven-man teams under the cap, with a weak user roster', () => {
    const l = make();
    expect(l.teams).toHaveLength(30);
    validateLeague(l);
    for (const t of l.teams) {
      expect(t.rosterIds.length).toBe(7);
      expect(payroll(l, t)).toBeLessThanOrEqual(t.capMillions);
      expect(t.starters).toHaveLength(5);
    }
    const u = userTeam(l);
    const us = u.rosterIds.map((id) => stars(l.players[id]));
    expect(Math.max(...us)).toBeLessThanOrEqual(3);
    const avg = us.reduce((a, b) => a + b, 0) / us.length;
    expect(avg).toBeGreaterThanOrEqual(1.5);
    expect(avg).toBeLessThanOrEqual(2);
    for (const id of u.rosterIds) expect(l.players[id].contract.salaryMillions).toBeLessThanOrEqual(9);
    expect(payroll(l, u)).toBeLessThan(45);
    expect(u.rosterIds.some((id) => l.players[id].potential >= 4)).toBe(true);
    const cpu = l.teams.filter((t) => t.id !== u.id).flatMap((t) => t.rosterIds.map((id) => stars(l.players[id])));
    console.log('user stars', us.join(' '), 'cpu avg', (cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2));
  });
  it('schedules a balanced season', () => {
    const l = make(1, { seasonGames: 41 });
    for (const t of l.teams) {
      const gs = l.schedule.filter((g) => g.homeId === t.id || g.awayId === t.id);
      expect(gs).toHaveLength(41);
      const home = gs.filter((g) => g.homeId === t.id).length;
      expect(Math.abs(home - 20.5)).toBeLessThanOrEqual(2.5);
    }
  });
});

describe('simulation', () => {
  it('box scores reconcile and a game applies exactly once', () => {
    const l = make();
    const g = l.schedule[0];
    const box = withRng(l, (rng) => simulateGame(l, g, rng));
    const pts = (ls: any[]) => ls.reduce((s, x) => s + x.points, 0);
    expect(pts(box.home)).toBe(box.homeScore);
    expect(pts(box.away)).toBe(box.awayScore);
    const before = l.teams.map((t) => t.wins + t.losses).reduce((a, b) => a + b);
    withRng(l, (rng) => applyGameResult(l, box, rng));
    const again = withRng(l, (rng) => applyGameResult(l, box, rng));
    expect(again).toBe(false);
    const after = l.teams.map((t) => t.wins + t.losses).reduce((a, b) => a + b);
    expect(after - before).toBe(2);
    const p = l.players[box.home.find((x) => x.seconds > 0)!.playerId];
    expect(p.seasonStats.games).toBe(1);
  });

  it('runs a full season, playoffs, offseason and the next season', () => {
    const l = make(7);
    let guard = 0;
    while (l.phase !== 'offseason' && guard++ < 500) advanceDay(l);
    expect(l.phase).toBe('offseason');
    const ut = userTeam(l);
    const totalW = l.teams.reduce((s, t) => s + t.wins, 0);
    const totalL = l.teams.reduce((s, t) => s + t.losses, 0);
    expect(totalW).toBe(totalL);
    expect(totalW).toBe((30 * 20) / 2);
    expect(l.history[0].champion).toBeTruthy();
    const scores = Object.values(l.boxScores).map((b) => b.homeScore + b.awayScore);
    console.log('avg combined score', scores.reduce((a, b) => a + b, 0) / scores.length, 'champion', l.history[0].champion, 'user', ut.wins, ut.losses);
    advanceOffseason(l);
    expect(l.offseasonStep).toBe('resign');
    withRng(l, (rng) => finishResignings(l, rng));
    withRng(l, (rng) => runLottery(l, rng));
    expect(l.draft!.order).toHaveLength(60);
    runCpuPicks(l);
    validateLeague(l); // CPU teams that drafted with a full roster keep a legal lineup
    const pick = currentPick(l);
    if (pick) {
      const best = l.draft!.prospectIds[0];
      draftPlayer(l, best);
      expect(userTeam(l).rosterIds).toContain(best);
      runCpuPicks(l);
    }
    finishDraft(l);
    startNewSeason(l);
    expect(l.season).toBe(2);
    expect(l.phase).toBe('regular');
    validateLeague(l);
    for (const t of l.teams) expect(t.rosterIds.length).toBeLessThanOrEqual(7);
    simToUserGame(l);
    expect(nextUserGame(l)).toBeTruthy();
  });
});

describe('transactions', () => {
  it('rejects an over-cap market signing with an explanation and accepts one with coins and cap room', () => {
    const l = make(3);
    const t = userTeam(l);
    const offer = l.market.offers[0];
    const p = l.players[offer.playerId];
    expect(stars(p)).toBeGreaterThanOrEqual(4);
    // Not enough coins
    t.credits = 0;
    let r = buyMarketPlayer(l, p.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/CC/);
    // Enough coins but no cap room
    t.credits = 200;
    l.players[t.rosterIds[0]].contract.salaryMillions = 99;
    r = buyMarketPlayer(l, p.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cap space/i);
    l.players[t.rosterIds[0]].contract.salaryMillions = 3;
    // Full roster (7) blocks too, until someone is released.
    r = buyMarketPlayer(l, p.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Release/);
    const rel = releasePlayer(l, t.rosterIds[6]);
    expect(rel.ok).toBe(true);
    if (!rel.ok) return;
    const ok = buyMarketPlayer(rel.league, p.id);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const ut = userTeam(ok.league);
      expect(ut.rosterIds).toContain(p.id);
      expect(ut.credits).toBe(200 - offer.coinPrice);
      expect(ok.league.market.offers.some((o) => o.playerId === p.id)).toBe(false);
    }
    // The original league is untouched (atomic).
    expect(t.rosterIds).not.toContain(p.id);
  });
  it('injured players cannot be given minutes or start', () => {
    const l = make(4);
    const t = userTeam(l);
    const p = l.players[t.starters[0]];
    p.injury = { type: 'Sprained Ankle', gamesRemaining: 3 };
    const r = setLineup(l, t.starters, t.rotation);
    expect(t.starters).toHaveLength(5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/injured/);
  });
  it('release creates dead money', () => {
    const l = make(5);
    const t = userTeam(l);
    const victim = t.rotation[t.rotation.length - 1];
    const r = releasePlayer(l, victim);
    expect(r.ok).toBe(true);
    if (r.ok) expect(userTeam(r.league).deadCap.length).toBe(1);
  });
});
