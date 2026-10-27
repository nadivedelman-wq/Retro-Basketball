/**
 * Simplified, fictional salary-cap economy.
 *
 * Rules (also shown in the Contracts screen):
 *  - Hard cap: payroll (salaries + dead money) may not exceed the team cap (default $100M).
 *  - Minimum exception: a team below 13 players may sign a player at the $1.0M-$1.2M minimum even when over the cap.
 *  - Rosters hold 12-15 players.
 *  - Releasing a player leaves 50% of his current-season salary as dead money for the rest of this season only;
 *    the remaining contract years are wiped.
 *  - Contracts run 1-4 years. Expiring players can be re-signed in the off-season or go to free agency.
 */
import type { LeagueSave, Player, Team } from '../core/types';

export const DEFAULT_CAP = 100;
export const MIN_SALARY = 1.0;
export const MIN_EXCEPTION_MAX = 1.2;
export const RELEASE_DEAD_FRACTION = 0.5;

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function deadMoney(league: LeagueSave, team: Team) {
  return round1(team.deadCap.filter((d) => d.season === league.season).reduce((s, d) => s + d.amount, 0));
}

export function payroll(league: LeagueSave, team: Team): number {
  let s = 0;
  for (const id of team.rosterIds) s += league.players[id]?.contract.salaryMillions ?? 0;
  return round1(s + (team.deadCap ? deadMoney(league, team) : 0));
}

export function capSpace(league: LeagueSave, team: Team) {
  return round1(team.capMillions - payroll(league, team));
}

/** Salary already committed for next season (players with 2+ years left). */
export function nextSeasonCommitments(league: LeagueSave, team: Team) {
  let s = 0;
  for (const id of team.rosterIds) {
    const p = league.players[id];
    if (p && p.contract.yearsRemaining >= 2) s += p.contract.salaryMillions;
  }
  return round1(s);
}

export type Check = { ok: true } | { ok: false; reason: string };

export function canSign(league: LeagueSave, team: Team, salary: number, years: number): Check {
  if (team.rosterIds.length >= 15) return { ok: false, reason: `${team.name} already have 15 players, the roster maximum. Release someone first.` };
  if (years < 1 || years > 4) return { ok: false, reason: 'Contracts must be 1 to 4 years.' };
  if (salary < MIN_SALARY) return { ok: false, reason: `The league minimum salary is $${MIN_SALARY.toFixed(1)}M.` };
  const space = capSpace(league, team);
  if (salary <= space + 1e-9) return { ok: true };
  if (salary <= MIN_EXCEPTION_MAX && team.rosterIds.length < 13) return { ok: true };
  return {
    ok: false,
    reason: `Over the cap: this deal is $${salary.toFixed(1)}M but you only have $${Math.max(0, space).toFixed(1)}M of cap space (payroll $${payroll(league, team).toFixed(1)}M of $${team.capMillions.toFixed(0)}M). Clear salary or offer less.`,
  };
}

export function canRelease(league: LeagueSave, team: Team, p: Player): Check {
  if (!team.rosterIds.includes(p.id)) return { ok: false, reason: `${p.lastName} is not on your roster.` };
  if (team.rosterIds.length <= 12) return { ok: false, reason: 'Rosters must keep at least 12 players. Sign someone before releasing.' };
  return { ok: true };
}

export function releaseCost(p: Player) {
  return round1(p.contract.salaryMillions * RELEASE_DEAD_FRACTION);
}

/** Credits to upgrade a facility from its current level (max 5). */
export function facilityCost(level: number) {
  return Math.round(15 * Math.pow(level, 1.5));
}

export const FACILITY_INFO = {
  training: { name: 'Training Center', effect: (l: number) => `+${(l - 1) * 12}% player XP; better off-season growth` },
  medical: { name: 'Medical Center', effect: (l: number) => `-${(l - 1) * 10}% injury length; +${l * 2} daily condition recovery` },
  arena: { name: 'Arena', effect: (l: number) => `+${l} fan support per home win; +${(l * 0.5).toFixed(1)} credits per home game` },
} as const;

export function capUpgradeCost(team: Team) {
  const steps = Math.round((team.capMillions - DEFAULT_CAP) / 5);
  return Math.round(60 * Math.pow(1.5, steps));
}

/** Credits for a game result. */
export function gameCredits(team: Team, won: boolean, home: boolean, playoff: boolean): number {
  let c = won ? 3 : 1;
  if (playoff) c += won ? 3 : 1;
  if (home) c += team.facilities.arena * 0.5;
  if (team.fanSupport > 75) c += 1;
  return Math.round(c);
}

export function rookieSalary(pick: number, round: 1 | 2): { salary: number; years: number } {
  if (round === 2) return { salary: 1, years: 2 };
  const salary = round1(Math.max(1.2, 9 - (pick - 1) * 0.27));
  return { salary, years: 3 };
}
