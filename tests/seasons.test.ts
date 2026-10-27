import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, userTeam } from '../src/sim/league';
import { advanceDay, withRng } from '../src/sim/season';
import { advanceOffseason, finishResignings, runLottery, runCpuPicks, currentPick, draftPlayer, startNewSeason } from '../src/sim/offseason';
import { askingContract, signFreeAgent, validateLeague } from '../src/sim/transactions';
import { payroll } from '../src/sim/economy';
import { stars } from '../src/sim/players';

describe('long-term franchise loop', () => {
  it('plays four seasons with aging, retirements, drafts and free agency while staying legal', () => {
    let l = createLeague({ seed: 2024, userTeamId: 'bay', coachName: 'T', settings: { ...DEFAULT_SETTINGS }, slot: 't' });
    const avgStars: number[] = [];
    for (let season = 1; season <= 4; season++) {
      let guard = 0;
      while (l.phase !== 'offseason' && guard++ < 600) advanceDay(l);
      expect(l.history.at(-1)?.champion).toBeTruthy();
      advanceOffseason(l);
      withRng(l, (rng) => finishResignings(l, rng));
      withRng(l, (rng) => runLottery(l, rng));
      while (currentPick(l)) {
        runCpuPicks(l);
        if (currentPick(l)) draftPlayer(l, l.draft!.prospectIds[0]);
      }
      let tries = 0;
      while (userTeam(l).rosterIds.length < 13 && tries++ < 60) {
        const cheap = l.freeAgents.map((id) => l.players[id]).sort((a, b) => askingContract(l, a).salary - askingContract(l, b).salary)[0];
        const r = signFreeAgent(l, cheap.id);
        if (r.ok) l = r.league;
        else l.freeAgents = l.freeAgents.filter((id) => id !== cheap.id);
      }
      startNewSeason(l);
      validateLeague(l);
      for (const t of l.teams) {
        expect(t.rosterIds.length).toBeGreaterThanOrEqual(12);
        expect(t.rosterIds.length).toBeLessThanOrEqual(15);
        if (t.id !== l.userTeamId) expect(payroll(l, t)).toBeLessThanOrEqual(t.capMillions * 1.15 + 0.01);
      }
      const all = l.teams.flatMap((t) => t.rosterIds.map((id) => stars(l.players[id])));
      avgStars.push(all.reduce((a, b) => a + b, 0) / all.length);
    }
    console.log('average stars by season', avgStars.map((x) => x.toFixed(2)).join(' '), 'retired', Object.values(l.players).filter((p) => p.retired).length);
    expect(l.season).toBe(5);
    expect(Math.max(...avgStars) - Math.min(...avgStars)).toBeLessThan(0.6);
  });
});
