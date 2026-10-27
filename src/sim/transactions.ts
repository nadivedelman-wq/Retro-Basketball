/**
 * Every user-initiated change to the league goes through `transact`: it works on a deep
 * copy, validates league-wide invariants, and only then hands back the new state. A failed
 * transaction leaves the saved league untouched and returns a readable reason.
 */
import { Rng, clamp } from '../core/rng';
import type { CoachRole, LeagueSave, Player, Position, Tactics, Team } from '../core/types';
import { COACH_ROLES, COACH_TIERS, ROSTER, TEAM_DINNER, UPGRADES, UPGRADE_MAX, type UpgradeKind } from './config';
import { canRelease, canSign, capSpace, capUpgradeCost, payroll, releaseCost, round1, MIN_SALARY } from './economy';
import { ROSTER_MAX, ROSTER_MIN, addNews, placeNewPlayer, repairRotation, teamById, userTeam } from './league';
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
    if (t.rosterIds.length > ROSTER_MAX) throw new TxError(`${t.name} would have ${t.rosterIds.length} contracted players (max ${ROSTER_MAX}).`);
    if (t.rosterIds.length < ROSTER_MIN) throw new TxError(`${t.name} would have too few players.`);
    for (const id of t.rosterIds) {
      if (!league.players[id]) throw new TxError(`Missing player ${id}.`);
      if (league.players[id].replacement) throw new TxError('Replacement players can never hold a roster spot.');
      if (owner.has(id)) throw new TxError(`${fullName(league.players[id])} is on two rosters.`);
      owner.set(id, t.id);
    }
    if (t.starters.length > ROSTER.active) throw new TxError('Only five starters.');
    if (t.rotation.length > ROSTER.bench) throw new TxError(`Only ${ROSTER.bench} bench players can dress.`);
    for (const id of [...t.starters, ...t.rotation]) {
      if (!id) continue;
      if (!t.rosterIds.includes(id)) throw new TxError('A player in the lineup is not on the roster.');
      if (league.players[id].injury) throw new TxError(`${fullName(league.players[id])} is injured and cannot play until he recovers.`);
    }
    const lineup = [...t.starters, ...t.rotation].filter(Boolean);
    if (new Set(lineup).size !== lineup.length) throw new TxError('A player is listed twice in the lineup.');
    if (t.credits < 0) throw new TxError('Not enough Coach Coins.');
  }
  for (const id of league.freeAgents) if (owner.has(id)) throw new TxError('A free agent is also on a roster.');
}

const rngFor = (league: LeagueSave) => new Rng((league.rngState ^ league.nextId * 2654435761) >>> 0);

export const SCOUT_COST = 2;

/** What a player will ask for right now. */
export function askingContract(league: LeagueSave, p: Player): { salary: number; years: number } {
  if (p.demand) return { salary: p.demand.salaryMillions, years: p.demand.yearsRemaining };
  const s = stars(p);
  const years = p.age >= 33 ? 1 : p.age <= 25 && s >= 3 ? 4 : s >= 2.5 ? 3 : 2;
  return { salary: round1(Math.max(MIN_SALARY, marketSalary(p))), years };
}

/** Internal signing used by CPU free agency and tests; users sign through the market. */
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
    p.jerseyNumber = freeNumber(d, team, p.jerseyNumber);
    placeNewPlayer(team, playerId);
    addNews(d, `Signed ${fullName(p)} (${y} yr, $${ask.salary.toFixed(1)}M).`, 'good');
    return `${fullName(p)} signed for ${y} year${y > 1 ? 's' : ''} at $${ask.salary.toFixed(1)}M.`;
  });
}

/** Why a market player can or cannot be signed right now (coins, cap and roster space all required). */
export function marketCheck(league: LeagueSave, playerId: string): { ok: boolean; reasons: string[] } {
  const team = userTeam(league);
  const offer = league.market.offers.find((o) => o.playerId === playerId);
  const p = league.players[playerId];
  if (!offer || !p) return { ok: false, reasons: ['This player is no longer on the market.'] };
  const reasons: string[] = [];
  if (team.credits < offer.coinPrice) reasons.push(`Needs ${offer.coinPrice} CC (you have ${team.credits} CC).`);
  const space = capSpace(league, team);
  if (p.contract.salaryMillions > space + 1e-9) reasons.push(`Needs $${p.contract.salaryMillions.toFixed(1)}M of cap space (you have $${Math.max(0, space).toFixed(1)}M).`);
  if (team.rosterIds.length >= ROSTER.max) reasons.push(`Roster full (${ROSTER.max}/${ROSTER.max}). Release a player from the Roster screen first.`);
  return { ok: reasons.length === 0, reasons };
}

export function buyMarketPlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const check = marketCheck(d, playerId);
    if (!check.ok) throw new TxError(check.reasons.join(' '));
    const offer = d.market.offers.find((o) => o.playerId === playerId)!;
    const p = d.players[playerId];
    const cap = canSign(d, team, p.contract.salaryMillions, p.contract.yearsRemaining);
    if (!cap.ok) throw new TxError(cap.reason);
    team.credits -= offer.coinPrice;
    d.market.offers = d.market.offers.filter((o) => o.playerId !== playerId);
    team.rosterIds.push(playerId);
    p.jerseyNumber = freeNumber(d, team, p.jerseyNumber);
    p.morale = clamp(p.morale + 5, 0, 100);
    p.moraleNote = 'Morale +5: excited to join';
    placeNewPlayer(team, playerId);
    d.devBaseline[playerId] = stars(p);
    addNews(d, `Signed ${fullName(p)} from the market (${offer.coinPrice} CC; ${p.contract.yearsRemaining} yr at $${p.contract.salaryMillions.toFixed(1)}M).`, 'good');
    return `${fullName(p)} joins the team!`;
  });
}

export function freeNumber(league: LeagueSave, team: Team, want: number) {
  const used = new Set(team.rosterIds.map((id) => league.players[id]?.jerseyNumber));
  if (!used.has(want)) return want;
  for (let n = 0; n < 100; n++) if (!used.has(n)) return n;
  return want;
}

function removeFromTeam(d: LeagueSave, team: Team, playerId: string) {
  team.rosterIds = team.rosterIds.filter((id) => id !== playerId);
  delete team.minutesPlan[playerId];
  repairRotation(d, team);
}

export function releasePlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p) throw new TxError('Unknown player.');
    const check = canRelease(d, team, p);
    if (!check.ok) throw new TxError(check.reason);
    const dead = releaseCost(p);
    removeFromTeam(d, team, playerId);
    if (dead > 0) team.deadCap.push({ amount: dead, season: d.season });
    p.contract = { salaryMillions: p.contract.salaryMillions, yearsRemaining: 0 };
    p.demand = undefined;
    d.freeAgents.push(playerId);
    addNews(d, `Released ${fullName(p)}. $${dead.toFixed(1)}M dead money this season.`, 'info');
    return `${fullName(p)} released. $${dead.toFixed(1)}M stays on this season's cap.`;
  });
}

export function resignPlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !team.rosterIds.includes(playerId) || p.contract.yearsRemaining > 0) throw new TxError('Only expiring players can be re-signed.');
    if (p.morale < 20) throw new TxError(`${fullName(p)} (morale ${Math.round(p.morale)}, Disengaged) refuses to negotiate. Raise his morale first.`);
    const ask = askingContract(d, p);
    const pay = payroll(d, team) - p.contract.salaryMillions + ask.salary;
    if (pay > team.capMillions + 1e-9) {
      throw new TxError(`Re-signing at $${ask.salary.toFixed(1)}M puts payroll at $${pay.toFixed(1)}M, over the $${team.capMillions.toFixed(0)}M cap. Clear room first.`);
    }
    p.contract = { salaryMillions: ask.salary, yearsRemaining: ask.years };
    p.demand = undefined;
    p.morale = clamp(p.morale + 8, 0, 100);
    p.moraleNote = 'Morale +8: new contract';
    addNews(d, `Re-signed ${fullName(p)} (${ask.years} yr, $${ask.salary.toFixed(1)}M).`, 'good');
    return `${fullName(p)} re-signed.`;
  });
}

export function letWalk(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const p = d.players[playerId];
    if (!p || !team.rosterIds.includes(playerId) || p.contract.yearsRemaining > 0) throw new TxError('Only expiring players can be let go.');
    removeFromTeam(d, team, playerId);
    d.freeAgents.push(playerId);
    return `${fullName(p)} will test free agency.`;
  });
}

export function upgradeFacility(league: LeagueSave, kind: UpgradeKind): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const lvl = team.facilities[kind];
    if (lvl >= UPGRADE_MAX) throw new TxError(`${UPGRADES[kind].name} is already at the maximum level.`);
    const cost = UPGRADES[kind].costs[lvl];
    if (team.credits < cost) throw new TxError(`Level ${lvl + 1} costs ${cost} CC; you have ${team.credits} CC.`);
    team.credits -= cost;
    team.facilities[kind] = lvl + 1;
    if (kind === 'fans') team.fanSupport = clamp(team.fanSupport + 5 * (lvl + 1), 0, 100);
    return `${UPGRADES[kind].name} level ${lvl + 1}: ${UPGRADES[kind].effects[lvl]}.`;
  });
}

export function upgradeCap(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const cost = capUpgradeCost(team);
    if (team.credits < cost) throw new TxError(`Cap expansion costs ${cost} CC; you have ${team.credits} CC.`);
    team.credits -= cost;
    team.capMillions += 5;
    return `Team cap raised to $${team.capMillions}M.`;
  });
}

export function teamDinner(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    if (team.credits < TEAM_DINNER.cost) throw new TxError(`A team dinner costs ${TEAM_DINNER.cost} CC; you have ${team.credits} CC.`);
    team.credits -= TEAM_DINNER.cost;
    for (const id of team.rosterIds) {
      const p = d.players[id];
      p.morale = clamp(p.morale + TEAM_DINNER.morale, 0, 100);
      p.moraleNote = `Morale +${TEAM_DINNER.morale}: team dinner`;
    }
    return `Morale +${TEAM_DINNER.morale} for the whole roster.`;
  });
}

export function coachCost(tier: number) {
  return COACH_TIERS.find((t) => t.tier === tier)?.cost ?? 0;
}

export function hireStaff(league: LeagueSave, staffId: string): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const s = d.staffPool.find((x) => x.id === staffId);
    if (!s) throw new TxError('That coach is no longer available.');
    const current = team.staff[s.role];
    if (s.tier <= current) throw new TxError(`You already have a ${COACH_TIERS[current - 1].label} ${COACH_ROLES[s.role].title}. Hire a higher tier to improve.`);
    const cost = coachCost(s.tier);
    if (team.credits < cost) throw new TxError(`Hiring costs ${cost} CC; you have ${team.credits} CC.`);
    team.credits -= cost;
    team.staffMembers = team.staffMembers.filter((m) => m.role !== s.role);
    team.staffMembers.push(s);
    team.staff[s.role] = s.tier;
    d.staffPool = d.staffPool.filter((x) => x.id !== staffId);
    return `${s.name} hired as ${COACH_TIERS[s.tier - 1].label} ${COACH_ROLES[s.role].title}.`;
  });
}

export function fireStaff(league: LeagueSave, role: CoachRole): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    const old = team.staffMembers.find((m) => m.role === role);
    if (!old) throw new TxError('No one in that role.');
    team.staffMembers = team.staffMembers.filter((m) => m.role !== role);
    team.staff[role] = 0;
    return `${old.name} let go.`;
  });
}

/**
 * Save the lineup: five starter slots ('' = empty, filled by a 0.5-star replacement on game day)
 * and up to two reserves. Everyone else on the roster sits. Stars may be benched freely.
 */
export function setLineup(league: LeagueSave, starters: string[], reserves: string[]): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    if (starters.length !== ROSTER.active) throw new TxError('The lineup has exactly five starter slots.');
    if (reserves.length > ROSTER.bench) throw new TxError(`Only ${ROSTER.bench} reserves can dress.`);
    for (const id of [...starters, ...reserves]) {
      if (!id) continue;
      if (!team.rosterIds.includes(id)) throw new TxError('That player is not on your roster.');
      if (d.players[id].injury) throw new TxError(`${fullName(d.players[id])} is injured and cannot be assigned minutes.`);
    }
    team.starters = starters.slice();
    team.rotation = reserves.filter(Boolean);
    team.minutesPlan = {};
    const empty = starters.filter((x) => !x).length;
    return empty ? `Lineup saved. ${empty} 0.5-star replacement${empty > 1 ? 's' : ''} will start.` : 'Lineup saved.';
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
    const cost = SCOUT_COST;
    if (team.credits < cost) throw new TxError(`Scouting costs ${cost} CC; you have ${team.credits} CC.`);
    team.credits -= cost;
    p.scoutLevel++;
    const rng = rngFor(d);
    const err = Math.max(0, 1.1 - team.staff.development * 0.2 - p.scoutLevel * 0.35);
    p.scoutedPotential = clamp(Math.round((p.potential + rng.normal(0, err)) * 2) / 2, 0.5, 5);
    return `New report on ${fullName(p)}: potential ${p.scoutedPotential.toFixed(1)} stars.`;
  });
}

export function teamOf(league: LeagueSave, playerId: string): Team | undefined {
  return league.teams.find((t) => t.rosterIds.includes(playerId));
}

export { teamById };
