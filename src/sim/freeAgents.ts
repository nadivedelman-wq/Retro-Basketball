/**
 * Free agents: a paged board of 0.5 to 3.5-star players. The board turns over by itself every few
 * of your regular-season games, or right away for Coach Coins. Signing costs a coin fee that
 * rises with stars, plus cap room and an open roster spot.
 */
import { clamp, type Rng } from '../core/rng';
import type { LeagueSave, Player } from '../core/types';
import { FREE_AGENTS } from './config';
import { canSign } from './economy';
import { addNews, newId, placeNewPlayer, userTeam } from './league';
import { fullName, generatePlayer, stars } from './players';
import { TxError, askingContract, freeNumber, rngFor, transact, type TxResult } from './transactions';

export function freeAgentFee(p: Player) {
  const s = Math.min(4, stars(p));
  return FREE_AGENTS.signFee[s] ?? FREE_AGENTS.signFee[4];
}

/** Free agents on the board, best first. */
export function freeAgentBoard(league: LeagueSave): Player[] {
  return league.freeAgents
    .map((id) => league.players[id])
    .filter((p) => p && !p.retired)
    .sort((a, b) => stars(b) - stars(a) || a.age - b.age);
}

/** Replace the board: unsigned players leave and a fresh class arrives. */
export function refreshFreeAgents(league: LeagueSave, rng: Rng) {
  for (const id of league.freeAgents) {
    const p = league.players[id];
    // Players who never played a game leave no trace; anyone with a history retires at season's end.
    if (p && p.careerStats.games === 0 && !p.draft && !p.history.length) delete league.players[id];
  }
  league.freeAgents = [];
  const levels = Object.keys(FREE_AGENTS.starWeights).map(Number);
  for (let i = 0; i < FREE_AGENTS.poolSize; i++) {
    const target = rng.weighted(levels, (s) => FREE_AGENTS.starWeights[s]);
    const p = generatePlayer(rng, { id: newId(league, 'p'), target, exactStars: true });
    p.contract = { salaryMillions: p.contract.salaryMillions, yearsRemaining: 0 };
    const ask = askingContract(league, p);
    p.demand = { salaryMillions: ask.salary, yearsRemaining: ask.years };
    league.players[p.id] = p;
    league.freeAgents.push(p.id);
  }
  league.freeAgentRefreshIn = FREE_AGENTS.refreshEveryGames;
}

/** Count down after each of your regular-season games. */
export function tickFreeAgents(league: LeagueSave, rng: Rng) {
  league.freeAgentRefreshIn = (league.freeAgentRefreshIn ?? FREE_AGENTS.refreshEveryGames) - 1;
  if (league.freeAgentRefreshIn > 0) return;
  refreshFreeAgents(league, rng);
  addNews(league, 'New free agents are available.', 'info');
}

/** Why a free agent can or cannot be signed right now. */
export function freeAgentCheck(league: LeagueSave, playerId: string): { ok: boolean; reasons: string[] } {
  const p = league.players[playerId];
  if (!p || !league.freeAgents.includes(playerId)) return { ok: false, reasons: ['That player is no longer a free agent.'] };
  const team = userTeam(league);
  const reasons: string[] = [];
  const fee = freeAgentFee(p);
  if (team.credits < fee) reasons.push(`Needs ${fee} CC (you have ${team.credits} CC).`);
  const ask = askingContract(league, p);
  const cap = canSign(league, team, ask.salary, ask.years);
  if (!cap.ok) reasons.push(cap.reason);
  return { ok: reasons.length === 0, reasons };
}

export function signFreeAgentForCoins(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const check = freeAgentCheck(d, playerId);
    if (!check.ok) throw new TxError(check.reasons.join(' '));
    const team = userTeam(d);
    const p = d.players[playerId];
    const fee = freeAgentFee(p);
    const ask = askingContract(d, p);
    team.credits -= fee;
    d.freeAgents = d.freeAgents.filter((id) => id !== playerId);
    team.rosterIds.push(playerId);
    p.contract = { salaryMillions: ask.salary, yearsRemaining: ask.years };
    p.demand = undefined;
    p.jerseyNumber = freeNumber(d, team, p.jerseyNumber);
    p.morale = clamp(p.morale + 5, 0, 100);
    p.moraleNote = 'Morale +5: excited to join';
    placeNewPlayer(team, playerId);
    d.devBaseline[playerId] = stars(p);
    addNews(d, `Signed free agent ${fullName(p)} (${fee} CC; ${ask.years} yr at $${ask.salary.toFixed(1)}M).`, 'good');
    return `${fullName(p)} signed!`;
  });
}

export function buyFreeAgentRefresh(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const team = userTeam(d);
    if (team.credits < FREE_AGENTS.refreshCost) throw new TxError(`Refreshing costs ${FREE_AGENTS.refreshCost} CC (you have ${team.credits} CC).`);
    team.credits -= FREE_AGENTS.refreshCost;
    refreshFreeAgents(d, rngFor(d));
    return 'A new group of free agents is available.';
  });
}
