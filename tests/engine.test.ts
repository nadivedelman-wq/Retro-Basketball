import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../src/game/engine/MatchEngine';
import { fixtureConfig } from './fixtures';

function sum(lines: { [k: string]: any }[], k: string) {
  return lines.reduce((s, l) => s + l[k], 0);
}

describe('MatchEngine CPU vs CPU', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`plays a full game to a final with a reconciled box score (seed ${seed})`, () => {
      const e = new MatchEngine(fixtureConfig(seed));
      e.runToEnd();
      expect(e.phase).toBe('final');
      const box = e.toBoxScore('g1');
      expect(box.homeScore).not.toBe(box.awayScore);
      for (const [lines, score] of [[box.home, box.homeScore], [box.away, box.awayScore]] as const) {
        const pts = sum(lines, 'points');
        expect(pts).toBe(score);
        expect(2 * sum(lines, 'fgm') + sum(lines, 'threePm') + sum(lines, 'ftm')).toBe(score);
        const secs = sum(lines, 'seconds');
        expect(Math.round(secs)).toBe(5 * (4 * 720 + box.overtimes * 300));
      }
      const qs = box.quarterScores.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
      expect(qs).toEqual([box.homeScore, box.awayScore]);
      console.log(seed, box.homeScore, box.awayScore, 'OT', box.overtimes,
        'FGA', sum(box.home, 'fga'), '3PA', sum(box.home, 'threePa'), 'FTA', sum(box.home, 'fta'), 'TO', sum(box.home, 'turnovers'),
        'REB', sum(box.home, 'offRebounds'), sum(box.home, 'defRebounds'), 'AST', sum(box.home, 'assists'), 'STL', sum(box.home,'steals'), 'BLK', sum(box.home,'blocks'), 'PF', sum(box.home,'fouls'));
    });
  }
});
