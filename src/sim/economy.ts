/**
 * Simplified, fictional arcade salary cap (not a real league's rules). Shown in the Contracts screen:
 *  - Hard cap: payroll (contracted salaries + dead money) may never exceed the team cap (default $100M).
 *  - Rosters hold at most 7 contracted players (5 active + 2 bench). Empty lineup spots are filled on
 *    game day by 0.5-star replacements, who have no contract and no cap hit.
 *  - Releasing a player leaves 50% of his current-season salary as dead money for this season only.
 *  - Contracts run 1-4 seasons. Salaries follow star bands, nudged by age, potential, morale and form.
 *  - Coach Coins (CC) are a separate currency: they buy upgrades, coaches and market access, never salary.
 */
import { clamp } from '../core/rng';
import type { LeagueSave, Player, Team } from '../core/types';
import { CAP_UPGRADE, DEFAULT_CAP_M, ROSTER, SALARY_BANDS } from './config';

export const DEFAULT_CAP = DEFAULT_CAP_M;
export const MIN_SALARY = 1.0;
export const RELEASE_DEAD_FRACTION = 0.5;

export function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function salaryBand(stars: number) {
  return SALARY_BANDS.find((b) => stars <= b.maxStars + 1e-9) ?? SALARY_BANDS[SALARY_BANDS.length - 1];
}

/**
 * Asking salary: position inside the star band from 0 (cheap) to 1 (top of band).
 * Young high-potential players, happy players and players in form ask for more; veterans for less.
 */
export function salaryFor(stars: number, f: { age: number; potential: number; morale: number; form?: number }): number {
  const band = salaryBand(stars);
  let t = 0.45;
  t += clamp((f.potential - stars) * 0.12, 0, 0.3);
  if (f.age >= 31) t -= 0.2;
  if (f.age <= 23) t += 0.05;
  t += (f.form ?? 0) * 0.1;
  if (f.morale < 40) t += 0.1; // unhappy players want to be paid to stay
  return round1(band.min + (band.max - band.min) * clamp(t, 0, 1));
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
  if (team.rosterIds.length >= ROSTER.max) {
    return { ok: false, reason: `Your roster is full (${ROSTER.max} contracted players: 5 active + 2 bench). Release a player first to open a slot.` };
  }
  if (years < 1 || years > 4) return { ok: false, reason: 'Contracts must be 1 to 4 seasons.' };
  if (salary < MIN_SALARY) return { ok: false, reason: `The minimum salary is $${MIN_SALARY.toFixed(1)}M.` };
  const space = capSpace(league, team);
  if (salary <= space + 1e-9) return { ok: true };
  return {
    ok: false,
    reason: `Over the cap: this contract is $${salary.toFixed(1)}M a year but you only have $${Math.max(0, space).toFixed(1)}M available (payroll $${payroll(league, team).toFixed(1)}M of $${team.capMillions.toFixed(0)}M). Release or let a contract expire to clear room.`,
  };
}

export function canRelease(_league: LeagueSave, team: Team, p: Player): Check {
  if (!team.rosterIds.includes(p.id)) return { ok: false, reason: `${p.lastName} is not on your roster.` };
  return { ok: true };
}

export function releaseCost(p: Player) {
  return round1(p.contract.salaryMillions * RELEASE_DEAD_FRACTION);
}

export function capUpgradeCost(team: Team) {
  const steps = Math.round((team.capMillions - DEFAULT_CAP) / CAP_UPGRADE.stepM);
  return Math.round(CAP_UPGRADE.baseCost * Math.pow(CAP_UPGRADE.growth, Math.max(0, steps)));
}

/** Rookie scale: cheap and short. */
export function rookieSalary(pick: number, round: 1 | 2): { salary: number; years: number } {
  if (round === 2) return { salary: 1, years: 2 };
  return { salary: round1(Math.max(1.2, 4 - (pick - 1) * 0.1)), years: 3 };
}
