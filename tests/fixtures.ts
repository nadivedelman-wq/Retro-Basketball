import type { MatchConfig, MatchPlayerInfo, MatchTeamInfo } from '../src/game/engine/types';
import type { Position } from '../src/core/types';

export function fixturePlayer(id: string, pos: Position, n: number, rating = 6): MatchPlayerInfo {
  const h = { PG: 188, SG: 196, SF: 201, PF: 206, C: 213 }[pos];
  return {
    id, name: id, fullName: id, number: n, position: pos, heightCm: h,
    ratings: { shooting: rating, finishing: rating, passing: rating, dribbling: rating, defense: rating, rebounding: rating, athleticism: rating, stamina: rating },
    traits: [], appearance: { skin: 1, hair: 1, hairColor: 0, build: 1 }, startEnergy: 1, form: 0,
  };
}

export function fixtureTeam(id: string, rating = 6): MatchTeamInfo {
  const pos: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SF', 'PF'];
  const players = pos.map((p, i) => fixturePlayer(`${id}${i}`, p, i + 1, i < 5 ? rating : rating - 1));
  return {
    id, abbr: id.toUpperCase(), name: id, colors: ['#c33', '#fff'], players,
    starters: players.slice(0, 5).map((p) => p.id), rotation: players.slice(5).map((p) => p.id),
    tactics: { pace: 3, threeRate: 3, pickAndRoll: 3, postUps: 3, defAggression: 3, rebounding: 3 },
    staff: { offense: 3, defense: 3 },
  };
}

export function fixtureConfig(seed = 1, extra: Partial<MatchConfig> = {}): MatchConfig {
  return { home: fixtureTeam('hom'), away: fixtureTeam('awy'), quarterMinutes: 3, difficulty: 'pro', userSide: null, mode: 'game', seed, autoSubs: true, ...extra };
}
