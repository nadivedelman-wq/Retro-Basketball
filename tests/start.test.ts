import { describe, expect, it } from 'vitest';
import { createLeague, DEFAULT_SETTINGS, standings, userTeam } from '../src/sim/league';
import { advanceDay, nextUserGame, startAtSeasonFinale } from '../src/sim/season';
import { validateLeague } from '../src/sim/transactions';

describe('career start', () => {
  for (const games of [20, 41, 82] as const) {
    it(`starts on the last day of a ${games}-game season with the worst record, then misses the playoffs`, () => {
      const l = createLeague({ seed: 7 + games, userTeamId: 'nyc', coachName: 'T', settings: { ...DEFAULT_SETTINGS, seasonGames: games }, slot: 't' });
      const credits = userTeam(l).credits;
      const t0 = Date.now();
      startAtSeasonFinale(l);
      console.log(`${games} games: set up in ${Date.now() - t0}ms`);
      const t = userTeam(l);
      expect(l.phase).toBe('regular');
      expect(t.wins + t.losses).toBe(games - 1);
      expect(l.teams.filter((o) => o.id !== t.id).every((o) => o.wins > t.wins)).toBe(true);
      expect(l.schedule.filter((g) => !g.played).every((g) => g.day === l.day)).toBe(true);
      expect(nextUserGame(l)!.day).toBe(l.day);
      expect(t.credits).toBe(credits);
      expect(l.coach.wins + l.coach.losses).toBe(0);
      expect(l.pendingEvent).toBeUndefined();
      validateLeague(l);

      advanceDay(l); // the finale
      expect(l.phase).toBe('playoffs');
      expect(standings(l).at(-1)!.team.id).toBe(t.id);
      expect(l.playoffs.some((s) => s.highSeedId === t.id || s.lowSeedId === t.id)).toBe(false);
      let guard = 0;
      while (l.phase !== 'offseason' && guard++ < 500) advanceDay(l);
      expect(l.phase).toBe('offseason');
      validateLeague(l);
    });
  }
});
