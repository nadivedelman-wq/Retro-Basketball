/**
 * Individual morale (0-100). Players compare their minutes and touches with what their role
 * promises: stars expect to be featured, reserves expect less, and defense/rebounding specialists
 * are not judged on touches. Single quiet games barely matter; three straight low-involvement games
 * cost 5-10 points. Wins, strong games and fan engagement bring morale back. Morale's on-court
 * effect is bounded (-12% to +4% of ratings, see config MORALE_BANDS).
 */
import { clamp } from '../core/rng';
import type { BoxLine, GameInvolvement, LeagueSave, Player, Team } from '../core/types';
import { basePossessions } from './gameSim';
import { stars } from './players';

const DEFENSIVE_ROLES = new Set(['Rim Protector', '3-and-D']);
const HISTORY = 6;

export function expectation(p: Player, quarterMinutes: number) {
  const s = stars(p);
  const minutes = s >= 4.5 ? 32 : s >= 4 ? 30 : s >= 3 ? 24 : s >= 2 ? 16 : 8;
  const scale = basePossessions(quarterMinutes) / 48;
  const touches = (s >= 4 ? 11 : s >= 3 ? 8 : s >= 2 ? 5 : 2) * scale;
  return { minutes, touches, judgedOnTouches: !DEFENSIVE_ROLES.has(p.archetype) && s >= 2 };
}

function lowMinutes(r: GameInvolvement, exp: ReturnType<typeof expectation>) {
  return r.minutes < exp.minutes * 0.5;
}

function lowTouches(r: GameInvolvement, exp: ReturnType<typeof expectation>) {
  return exp.judgedOnTouches && !lowMinutes(r, exp) && r.touches < exp.touches * 0.5;
}

/** Consecutive most-recent games matching `f`. */
function streak(recent: GameInvolvement[], f: (r: GameInvolvement) => boolean) {
  let n = 0;
  for (let i = recent.length - 1; i >= 0 && f(recent[i]); i--) n++;
  return n;
}

/** Update a team's morale after a game. `lines` holds every roster player (DNPs included). */
export function updateMorale(league: LeagueSave, team: Team, lines: BoxLine[], won: boolean) {
  const q = league.settings.quarterMinutes;
  const scale = basePossessions(q) / 48;
  for (const id of team.rosterIds) {
    const p = league.players[id];
    if (!p) continue;
    const l = lines.find((x) => x.playerId === id);
    const rec: GameInvolvement = {
      minutes: l ? l.seconds / 60 : 0,
      touches: l?.touches ?? 0,
      shots: l ? l.fga + l.fta / 2 : 0,
      started: !!l?.starter,
      dressed: !!l && l.seconds > 0,
    };
    p.recent = [...(p.recent ?? []), rec].slice(-HISTORY);
    if (p.injury) continue; // injured players are not upset about sitting
    const exp = expectation(p, q);
    const s = stars(p);
    let delta = 0;
    const reasons: string[] = [];
    if (rec.dressed) {
      delta += won ? 1.5 : -1;
      reasons.push(won ? 'team win' : 'team loss');
      const perf = l ? l.points + 1.2 * (l.offRebounds + l.defRebounds) + 1.5 * l.assists + 2 * (l.steals + l.blocks) : 0;
      if (perf >= 22 * scale) {
        delta += 2;
        reasons.push('big game');
      }
    } else if (s >= 3) {
      delta -= 1;
      reasons.push('sat out');
    }
    const minStreak = streak(p.recent, (r) => lowMinutes(r, exp));
    const touchStreak = streak(p.recent, (r) => lowTouches(r, exp));
    const hit = s >= 4 ? 9 : s >= 3 ? 7 : s >= 2 ? 5 : 2;
    if (minStreak >= 3 && minStreak % 3 === 0) {
      delta -= hit + (p.traits.includes('Selfish') ? 2 : 0);
      reasons.push(`limited minutes in last ${minStreak} games`);
    } else if (touchStreak >= 3 && touchStreak % 3 === 0) {
      delta -= hit - 1;
      reasons.push(`few touches in last ${touchStreak} games`);
    }
    // Fan engagement and a winning culture pull morale back toward a healthy level.
    const fans = team.facilities.fans ?? 0;
    if (p.morale < 65) delta += (65 - p.morale) * (0.02 + fans * 0.015);
    const before = p.morale;
    p.morale = clamp(p.morale + delta, 0, 100);
    const shown = Math.round(p.morale - before);
    if (shown !== 0 && reasons.length) p.moraleNote = `Morale ${shown > 0 ? '+' : ''}${shown}: ${reasons.join(', ')}`;
  }
}
