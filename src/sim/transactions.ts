/**
 * Every user-initiated change to the league goes through `transact`: it works on a deep
 * copy, validates league-wide invariants, and only then hands back the new state. A failed
 * transaction leaves the saved league untouched and returns a readable reason.
 */
import { Rng, clamp } from '../core/rng';
import type { LeagueSave, Player, Position, Tactics, Team } from '../core/types';
import { canRelease, canSign, capUpgradeCost, facilityCost, payroll, releaseCost, round1, MIN_SALARY } from './economy';
import { ROSTER_MAX, ROSTER_MIN, addNews, repairRotation, teamById, userTeam } from './league';
import { fullName, marketSalary, stars } from './players';

export class TxError extends Error {}

export type TxResult = { ok: true; league: LeagueSave; message?: string } | { ok: false; error: string };

export function transact(league: LeagueSave, fn: (draft: LeagueSave) => string | void): TxResult {
  const draft = structuredClone(league);
  try {
    const message = fn(draft) ?? undefined;
    validateLeague(draft);
    draft.updatedAt = Date.now();
    return { ok: true, league: draft, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** League-wide invariants checked after every transaction. */
export function validateLeague(league: LeagueSave) {
  const owner = new Map<string, string>();
  for (const t of league.teams) {
    if (t.rosterIds.length > ROSTER_MAX) throw new TxError(`${t.name} would have ${t.rosterIds.length} players (max ${ROSTER_MAX}).`);
    if (league.phase !== 'offseason' && t.rosterIds.length < ROSTER_MIN) throw new TxError(`${t.name} would have ${t.rosterIds.length} players (min ${ROSTER_MIN}).`);
    for (const id of t.rosterIds) {
      if (!league.players[id]) throw new TxError(`Missing player ${id}.`);
      if (owner.has(id)) throw new TxError(`${fullName(league.players[id])} is on two rosters.`);
      owner.set(id, t.id);
    }
    for (const id of t.starters) if (!t.rosterIds.includes(id)) throw new TxError('A starter is not on the roster.');
    for (const id of t.starters) if (league.players[id].injury) throw new TxError(`${fullName(league.players[id])} is injured and cannot start.`);
    if (t.credits < 0) throw new TxError('Not enough credits.');
  }
  for (const id of league.freeAgents) if (owner.has(id)) throw new TxError('A free agent is also on a roster.');
}

const rngFor = (league: LeagueSave) => new Rng((league.rngState ^ league.nextId * 2654435761) >>> 0);

/** What a player will ask for right now. */
export function askingContract(league: LeagueSave, p: Player): { salary: number; years: number } {
  if (p.demand) return { salary: p.demand.salaryMillions, years: p.demand.yearsRemaining };
  let salary = marketSalary(p);
  if (p.morale < 40) salary *= 1.15;
  const s = stars(p);
  const years = p.age >= 33 ? 1 : p.age <= 25 && s >= 3 ? 4 : s >= 2.5 ? 3 : 2;
  return { salary: round1(Math.max(MIN_SALARY, salary)), years };
}

export function signFreeAgent(league: LeagueSave, playerId: string, years?: number): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !d.freeAgents.includes(playerId)) throw new TxError('That player is not a free agent.');
    const ask = askingContract(d, p);
    const y = years ?? ask.years;
    const check = canSign(d, team, ask.salary, y);
    if (!check.ok) throw new TxError(check.reason);
    d.freeAgents = d.freeAgents.filter((id) => id !== playerId);
    team.rosterIds.push(playerId);
    p.contract = { salaryMillions: ask.salary, yearsRemaining: y };
    p.demand = undefined;
    p.morale = clamp(p.morale + 10, 0, 100);
    p.jerseyNumber = freeNumber(d, team, p.jerseyNumber);
    repairRotation(d, team);
    addNews(d, `Signed ${fullName(p)} (${y} yr, $${ask.salary.toFixed(1)}M).`, 'good');
    return `${fullName(p)} signed for ${y} year${y > 1 ? 's' : ''} at $${ask.salary.toFixed(1)}M.`;
  });
}

export function freeNumber(league: LeagueSave, team: Team, want: number) {
  const used = new Set(team.rosterIds.map((id) => league.players[id]?.jerseyNumber));
  if (!used.has(want)) return want;
  for (let n = 0; n < 100; n++) if (!used.has(n)) return n;
  return want;
}

export function releasePlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p) throw new TxError('Unknown player.');
    const check = canRelease(d, team, p);
    if (!check.ok) throw new TxError(check.reason);
    const dead = releaseCost(p);
    team.rosterIds = team.rosterIds.filter((id) => id !== playerId);
    team.starters = team.starters.filter((id) => id !== playerId);
    team.rotation = team.rotation.filter((id) => id !== playerId);
    delete team.minutesPlan[playerId];
    if (dead > 0) team.deadCap.push({ amount: dead, season: d.season });
    p.contract = { salaryMillions: p.contract.salaryMillions, yearsRemaining: 0 };
    p.demand = undefined;
    d.freeAgents.push(playerId);
    repairRotation(d, team);
    addNews(d, `Released ${fullName(p)}. $${dead.toFixed(1)}M dead money this season.`, 'info');
    return `${fullName(p)} released. $${dead.toFixed(1)}M stays on this season's cap.`;
  });
}

/** Re-signing your own expiring players may go up to 115% of the cap (simplified veteran rights). */
export const RESIGN_LIMIT = 1.15;

export function resignPlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !team.rosterIds.includes(playerId) || p.contract.yearsRemaining > 0) throw new TxError('Only expiring players can be re-signed.');
    if (p.morale < 25) throw new TxError(`${fullName(p)} (morale ${Math.round(p.morale)}) refuses to negotiate. Raise his morale first.`);
    const ask = askingContract(d, p);
    const pay = payroll(d, team) - p.contract.salaryMillions + ask.salary;
    if (pay > team.capMillions * RESIGN_LIMIT) {
      throw new TxError(`Re-signing at $${ask.salary.toFixed(1)}M puts payroll at $${pay.toFixed(1)}M, above the $${(team.capMillions * RESIGN_LIMIT).toFixed(1)}M re-sign limit (115% of cap).`);
    }
    p.contract = { salaryMillions: ask.salary, yearsRemaining: ask.years };
    p.demand = undefined;
    p.morale = clamp(p.morale + 8, 0, 100);
    addNews(d, `Re-signed ${fullName(p)} (${ask.years} yr, $${ask.salary.toFixed(1)}M).`, 'good');
    return `${fullName(p)} re-signed.`;
  });
}

export function letWalk(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !team.rosterIds.includes(playerId) || p.contract.yearsRemaining > 0) throw new TxError('Only expiring players can be let go.');
    team.rosterIds = team.rosterIds.filter((id) => id !== playerId);
    team.starters = team.starters.filter((id) => id !== playerId);
    team.rotation = team.rotation.filter((id) => id !== playerId);
    d.freeAgents.push(playerId);
    repairRotation(d, team);
    return `${fullName(p)} will test free agency.`;
  });
}

export function upgradeFacility(league: LeagueSave, kind: 'training' | 'medical' | 'arena'): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const lvl = team.facilities[kind];
    if (lvl >= 5) throw new TxError('Already at the maximum level.');
    const cost = facilityCost(lvl);
    if (team.credits < cost) throw new TxError(`Upgrade costs ${cost} credits; you have ${team.credits}.`);
    team.credits -= cost;
    team.facilities[kind] = lvl + 1;
    return `Upgraded to level ${lvl + 1}.`;
  });
}

export function upgradeCap(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const cost = capUpgradeCost(team);
    if (team.credits < cost) throw new TxError(`Cap expansion costs ${cost} credits; you have ${team.credits}.`);
    team.credits -= cost;
    team.capMillions += 5;
    return `Team cap raised to $${team.capMillions}M.`;
  });
}

export function teamDinner(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    if (team.credits < 8) throw new TxError('A team dinner costs 8 credits.');
    team.credits -= 8;
    for (const id of team.rosterIds) d.players[id].morale = clamp(d.players[id].morale + 8, 0, 100);
    return 'Morale +8 for the whole roster.';
  });
}

export function hireStaff(league: LeagueSave, staffId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const s = d.staffPool.find((x) => x.id === staffId);
    if (!s) throw new TxError('That coach is no longer available.');
    const cost = s.salaryCredits * 2;
    if (team.credits < cost) throw new TxError(`Hiring costs ${cost} credits (signing bonus); you have ${team.credits}.`);
    team.credits -= cost;
    const old = team.staffMembers.find((m) => m.role === s.role);
    team.staffMembers = team.staffMembers.filter((m) => m.role !== s.role);
    team.staffMembers.push(s);
    team.staff[s.role] = s.rating;
    d.staffPool = d.staffPool.filter((x) => x.id !== staffId);
    if (old) d.staffPool.push(old);
    return `${s.name} hired.`;
  });
}

export function fireStaff(league: LeagueSave, role: 'offense' | 'defense' | 'scouting'): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const old = team.staffMembers.find((m) => m.role === role);
    if (!old) throw new TxError('No one in that role.');
    team.staffMembers = team.staffMembers.filter((m) => m.role !== role);
    team.staff[role] = 0;
    d.staffPool.push(old);
    return `${old.name} let go.`;
  });
}

export function setLineup(league: LeagueSave, starters: string[], rotation: string[], minutesPlan?: Record<string, number>): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    if (starters.length !== 5) throw new TxError('Pick exactly five starters.');
    for (const id of starters) {
      if (!team.rosterIds.includes(id)) throw new TxError('Starter not on roster.');
      if (d.players[id].injury) throw new TxError(`${fullName(d.players[id])} is injured and cannot be assigned minutes.`);
    }
    team.starters = starters.slice();
    team.rotation = rotation.filter((id) => team.rosterIds.includes(id) && !starters.includes(id));
    for (const id of team.rosterIds) if (!starters.includes(id) && !team.rotation.includes(id)) team.rotation.push(id);
    if (minutesPlan) {
      const plan: Record<string, number> = {};
      let total = 0;
      for (const [id, m] of Object.entries(minutesPlan)) {
        if (!team.rosterIds.includes(id)) continue;
        if (m > 0 && d.players[id].injury) throw new TxError(`${fullName(d.players[id])} is injured and cannot be assigned minutes.`);
        plan[id] = clamp(Math.round(m), 0, 44);
        total += plan[id];
      }
      if (total > 0 && Math.abs(total - 240) > 24) throw new TxError(`Minutes add up to ${total}; a game has 240 (5 x 48). Get within 24 of that.`);
      team.minutesPlan = plan;
    }
    return 'Rotation saved.';
  });
}

export function setTactics(league: LeagueSave, tactics: Tactics): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    for (const v of Object.values(tactics)) if (v < 1 || v > 5) throw new TxError('Tactics range from 1 to 5.');
    team.tactics = { ...tactics };
  });
}

export function editPlayer(league: LeagueSave, playerId: string, edits: { firstName?: string; lastName?: string; jerseyNumber?: number; appearance?: Partial<Player['appearance']>; position?: Position }): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !team.rosterIds.includes(playerId)) throw new TxError('You can only edit your own players.');
    const clean = (s: string) => s.replace(/[^A-Za-z' .-]/g, '').trim().slice(0, 14);
    if (edits.firstName !== undefined) {
      const v = clean(edits.firstName);
      if (!v) throw new TxError('First name cannot be empty.');
      p.firstName = v;
    }
    if (edits.lastName !== undefined) {
      const v = clean(edits.lastName);
      if (!v) throw new TxError('Last name cannot be empty.');
      p.lastName = v;
    }
    if (edits.jerseyNumber !== undefined) {
      const n = Math.round(edits.jerseyNumber);
      if (n < 0 || n > 99) throw new TxError('Numbers run 0-99.');
      const clash = team.rosterIds.find((id) => id !== playerId && d.players[id].jerseyNumber === n);
      if (clash) throw new TxError(`#${n} is worn by ${fullName(d.players[clash])}.`);
      p.jerseyNumber = n;
    }
    if (edits.appearance) p.appearance = { ...p.appearance, ...edits.appearance };
    return 'Player updated.';
  });
}

export function scoutProspect(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !d.draft?.prospectIds.includes(playerId)) throw new TxError('Not a draft prospect.');
    if (p.scoutLevel >= 3) throw new TxError('Fully scouted already.');
    const cost = 3;
    if (team.credits < cost) throw new TxError('Scouting costs 3 credits.');
    team.credits -= cost;
    p.scoutLevel++;
    const rng = rngFor(d);
    const err = Math.max(0, 1.1 - team.staff.scouting * 0.15 - p.scoutLevel * 0.35);
    p.scoutedPotential = clamp(Math.round((p.potential + rng.normal(0, err)) * 2) / 2, 0.5, 5);
    return `New report on ${fullName(p)}: potential ${p.scoutedPotential.toFixed(1)} stars.`;
  });
}

export function teamOf(league: LeagueSave, playerId: string): Team | undefined {
  return league.teams.find((t) => t.rosterIds.includes(playerId));
}

export { teamById };
