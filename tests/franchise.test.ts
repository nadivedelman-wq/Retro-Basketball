import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { payroll } from '../src/sim/economy';
import { stars } from '../src/sim/players';
import { advanceDay, nextUserGame, simToUserGame, applyGameResult, withRng } from '../src/sim/season';
import { simulateGame } from '../src/sim/gameSim';
import { advanceOffseason, finishResignings, runLottery, runCpuPicks, startNewSeason, currentPick, draftPlayer, finishDraft } from '../src/sim/offseason';
import { signFreeAgent, releasePlayer, setLineup, askingContract } from '../src/sim/transactions';
import { validateLeague } from '../src/sim/transactions';

const make = (seed = 42, extra = {}) => createLeague({ seed, userTeamId: 'hcg', coachName: 'Coach Test', settings: { ...DEFAULT_SETTINGS, ...extra }, slot: 'test' });

describe('league creation', () => {
  it('creates 30 legal teams under the cap', () => {
    const l = make();
    expect(l.teams).toHaveLength(30);
    validateLeague(l);
    for (const t of l.teams) {
      expect(t.rosterIds.length).toBeGreaterThanOrEqual(12);
      expect(payroll(l, t)).toBeLessThanOrEqual(t.capMillions);
      expect(t.starters).toHaveLength(5);
    }
    const all = l.teams.flatMap((t) => t.rosterIds.map((id) => stars(l.players[id])));
    const hist: Record<string, number> = {};
    for (const s of all) hist[s] = (hist[s] || 0) + 1;
    console.log('star histogram', hist);
    console.log('payrolls', l.teams.map((t) => payroll(l, t)).join(' '));
    // Both conferences balanced
    expect(l.teams.filter((t) => t.conference === 'East')).toHaveLength(15);
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
    const pick = currentPick(l);
    if (pick) {
      const best = l.draft!.prospectIds[0];
      draftPlayer(l, best);
      expect(userTeam(l).rosterIds).toContain(best);
      runCpuPicks(l);
    }
    finishDraft(l);
    // Fill the user roster if needed via signings.
    let tries = 0;
    while (userTeam(l).rosterIds.length < 13 && tries++ < 40) {
      const cheap = l.freeAgents.map((id) => l.players[id]).sort((a, b) => askingContract(l, a).salary - askingContract(l, b).salary)[0];
      const r = signFreeAgent(l, cheap.id);
      if (r.ok) Object.assign(l, r.league);
      else l.freeAgents = l.freeAgents.filter((id) => id !== cheap.id);
    }
    startNewSeason(l);
    expect(l.season).toBe(2);
    expect(l.phase).toBe('regular');
    validateLeague(l);
    for (const t of l.teams) expect(t.rosterIds.length).toBeGreaterThanOrEqual(12);
    simToUserGame(l);
    expect(nextUserGame(l)).toBeTruthy();
  });
});

describe('transactions', () => {
  it('rejects an over-cap signing with an explanation and accepts one under the cap', () => {
    const l = make(3);
    const t = userTeam(l);
    const star = l.freeAgents.map((id) => l.players[id]).sort((a, b) => stars(b) - stars(a))[0];
    star.demand = { salaryMillions: 30, yearsRemaining: 3 };
    // Release to make a roster spot so the cap is the binding constraint.
    const res = signFreeAgent(l, star.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cap/i);
    const cheap = l.freeAgents.map((id) => l.players[id]).find((p) => p.id !== star.id)!;
    cheap.demand = { salaryMillions: 1, yearsRemaining: 1 };
    const ok = signFreeAgent(l, cheap.id);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(userTeam(ok.league).rosterIds).toContain(cheap.id);
    // The original league is untouched (atomic).
    expect(t.rosterIds).not.toContain(cheap.id);
  });
  it('injured players cannot be given minutes or start', () => {
    const l = make(4);
    const t = userTeam(l);
    const p = l.players[t.starters[0]];
    p.injury = { type: 'Sprained Ankle', gamesRemaining: 3 };
    const r = setLineup(l, t.starters, t.rotation);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/injured/);
  });
  it('release creates dead money', () => {
    const l = make(5);
    const t = userTeam(l);
    // need > 12 players
    const victim = t.rotation[t.rotation.length - 1];
    const r = releasePlayer(l, victim);
    expect(r.ok).toBe(true);
    if (r.ok) expect(userTeam(r.league).deadCap.length).toBe(1);
  });
});
