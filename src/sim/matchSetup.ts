import { hashString } from '../core/rng';
import type { LeagueSave, Team } from '../core/types';
import type { MatchConfig, MatchMode, MatchTeamInfo } from '../game/engine/types';
import { rotationOrder } from './gameSim';
import { gameRatings, fullName } from './players';

/** Turns a franchise team into match-engine input. Injured players are never included. */
export function matchTeam(league: LeagueSave, team: Team): MatchTeamInfo {
  const players = rotationOrder(league, team);
  return {
    id: team.id,
    abbr: team.abbr,
    name: `${team.city} ${team.name}`,
    colors: team.colors,
    players: players.map((p) => ({
      id: p.id,
      name: p.lastName.toUpperCase(),
      fullName: fullName(p),
      number: p.jerseyNumber,
      position: p.position,
      heightCm: p.heightCm,
      ratings: gameRatings(p),
      traits: p.traits,
      appearance: p.appearance,
      startEnergy: 0.55 + 0.45 * (p.condition / 100),
      form: p.form,
    })),
    starters: team.starters.filter((id) => players.some((p) => p.id === id)),
    rotation: team.rotation.filter((id) => players.some((p) => p.id === id)),
    tactics: team.tactics,
    staff: { offense: team.staff.offense, defense: team.staff.defense },
  };
}

export function matchConfig(league: LeagueSave, homeId: string, awayId: string, opts: { gameId: string; mode?: MatchMode; userTeamId?: string | null }): MatchConfig {
  const home = league.teams.find((t) => t.id === homeId)!;
  const away = league.teams.find((t) => t.id === awayId)!;
  const user = opts.userTeamId === undefined ? league.userTeamId : opts.userTeamId;
  return {
    home: matchTeam(league, home),
    away: matchTeam(league, away),
    quarterMinutes: league.settings.quarterMinutes,
    difficulty: league.settings.difficulty,
    userSide: user === home.id ? 0 : user === away.id ? 1 : null,
    mode: opts.mode ?? 'game',
    seed: hashString(opts.gameId + league.seed),
    autoSubs: league.settings.autoSubs,
  };
}
