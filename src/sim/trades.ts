/**
 * Trades: CPU clubs give draft picks for the user's players. Offers arrive on their own after
 * regular-season games, or on request from a player's profile (one ask per player per day).
 */
import type { Rng } from '../core/rng';
import type { LeagueSave, Player, Team, TradeOffer } from '../core/types';
import { ROSTER, TRADES } from './config';
import { teamName } from './data';
import { payroll } from './economy';
import { addNews, newId, repairRotation, sortRotation, teamById, userTeam } from './league';
import { fullName, stars } from './players';
import { TxError, freeNumber, rngFor, transact, type TxResult } from './transactions';

/** Picks traded now belong to the next draft: this season's until it is held, then next season's. */
export function tradePickSeason(league: LeagueSave) {
  const step = league.offseasonStep;
  return league.phase === 'offseason' && (step === 'freeAgency' || step === 'done') ? league.season + 1 : league.season;
}

/** Trades are closed while the draft is being held. */
export function tradesOpen(league: LeagueSave) {
  return !(league.phase === 'offseason' && league.offseasonStep === 'draft');
}

/** What a club thinks a player is worth: his stars, with upside for players 24 and under. */
export function tradeValue(p: Player) {
  const s = stars(p);
  return p.age <= 24 ? Math.max(s, (s + p.potential) / 2) : s;
}

/** The best round a club would give for this player, or null when nobody will give a pick. */
export function tradeRound(p: Player): 1 | 2 | null {
  if (p.injury || p.contract.yearsRemaining < 1) return null;
  const v = tradeValue(p);
  return v >= TRADES.firstRoundValue ? 1 : v >= TRADES.secondRoundValue ? 2 : null;
}

function weakest(league: LeagueSave, team: Team) {
  return team.rosterIds.map((id) => league.players[id]).sort((a, b) => stars(a) - stars(b))[0];
}

/** A club can take the player if he fits under its cap; a full roster drops its weakest player. */
function canTake(league: LeagueSave, team: Team, p: Player) {
  const full = team.rosterIds.length >= ROSTER.max;
  const drop = full ? weakest(league, team) : undefined;
  if (full && (!drop || stars(drop) >= stars(p))) return false;
  return payroll(league, team) - (drop?.contract.salaryMillions ?? 0) + p.contract.salaryMillions <= team.capMillions + 1e-9;
}

export function findTradeOffer(league: LeagueSave, playerId: string, rng: Rng): TradeOffer | null {
  const user = userTeam(league);
  const p = league.players[playerId];
  if (!p || !user.rosterIds.includes(playerId) || !tradesOpen(league)) return null;
  const best = tradeRound(p);
  if (!best) return null;
  const season = tradePickSeason(league);
  for (const round of best === 1 ? ([1, 2] as const) : ([2] as const)) {
    const options = league.teams
      .filter((t) => t.id !== user.id && canTake(league, t, p))
      .flatMap((t) => league.draftPicks.filter((d) => d.season === season && d.round === round && d.ownerTeamId === t.id).map((pick) => ({ t, pick })));
    if (!options.length) continue;
    const o = rng.pick(options);
    return { id: newId(league, 'tr'), teamId: o.t.id, playerId, pick: { season, round, originalTeamId: o.pick.originalTeamId } };
  }
  return null;
}

export function pickLabel(league: LeagueSave, o: TradeOffer) {
  const own = o.pick.originalTeamId === o.teamId ? 'their' : `${teamName(teamById(league, o.pick.originalTeamId))}'s`;
  return `${own} ${o.pick.round === 1 ? 'first' : 'second'}-round pick in the Season ${o.pick.season} draft`;
}

export function offerText(league: LeagueSave, o: TradeOffer) {
  return `${teamName(teamById(league, o.teamId))} is offering ${pickLabel(league, o)} for ${fullName(league.players[o.playerId])}. Do you accept?`;
}

/** After a regular-season game, a club may make an offer on its own. */
export function maybeCpuTradeOffer(league: LeagueSave, rng: Rng) {
  if (league.tradeOffer || league.phase !== 'regular' || !rng.chance(TRADES.offerChance)) return;
  for (const id of rng.shuffle(userTeam(league).rosterIds.slice())) {
    const o = findTradeOffer(league, id, rng);
    if (!o) continue;
    league.tradeOffer = o;
    addNews(league, `Trade offer: ${offerText(league, o).replace(' Do you accept?', '')}`, 'event');
    return;
  }
}

/** Ask the league what a player would fetch. Sets `tradeOffer` when a club bites. */
export function shopPlayer(league: LeagueSave, playerId: string): TxResult {
  return transact(league, (d) => {
    const p = d.players[playerId];
    if (!p || !userTeam(d).rosterIds.includes(playerId)) throw new TxError('Only your own players can be traded.');
    if (!tradesOpen(d)) throw new TxError('Trades are closed during the draft.');
    const key = `${d.season}:${d.phase}:${d.offseasonStep ?? ''}:${d.day}`;
    if (d.tradeAsked?.[playerId] === key) throw new TxError(`You already shopped ${fullName(p)} today. Clubs will listen again after your next game.`);
    d.tradeAsked = Object.fromEntries(Object.entries(d.tradeAsked ?? {}).filter(([, v]) => v === key));
    d.tradeAsked[playerId] = key;
    const o = findTradeOffer(d, playerId, rngFor(d));
    if (!o) return `No club will give up a draft pick for ${fullName(p)} right now.`;
    d.tradeOffer = o;
  });
}

export function acceptTrade(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const o = d.tradeOffer;
    if (!o) throw new TxError('There is no trade offer to accept.');
    const user = userTeam(d);
    const club = teamById(d, o.teamId);
    const p = d.players[o.playerId];
    const pick = d.draftPicks.find((x) => x.season === o.pick.season && x.round === o.pick.round && x.originalTeamId === o.pick.originalTeamId);
    d.tradeOffer = undefined;
    if (!p || !user.rosterIds.includes(p.id)) throw new TxError('That player is no longer on your roster.');
    if (!pick || pick.ownerTeamId !== club.id) throw new TxError(`${teamName(club)} no longer owns that pick.`);
    if (!tradesOpen(d)) throw new TxError('Trades are closed during the draft.');
    if (!canTake(d, club, p)) throw new TxError(`${teamName(club)} can no longer fit ${fullName(p)} under its cap.`);
    const label = pickLabel(d, o).replace(/^their /, `${teamName(club)}'s `);
    if (club.rosterIds.length >= ROSTER.max) {
      const drop = weakest(d, club);
      club.rosterIds = club.rosterIds.filter((id) => id !== drop.id);
      delete club.minutesPlan[drop.id];
      drop.contract = { salaryMillions: drop.contract.salaryMillions, yearsRemaining: 0 };
      drop.demand = undefined;
      d.freeAgents.push(drop.id);
    }
    user.rosterIds = user.rosterIds.filter((id) => id !== p.id);
    delete user.minutesPlan[p.id];
    repairRotation(d, user);
    club.rosterIds.push(p.id);
    p.jerseyNumber = freeNumber(d, club, p.jerseyNumber);
    sortRotation(d, club);
    pick.ownerTeamId = user.id;
    addNews(d, `Traded ${fullName(p)} to ${teamName(club)} for ${label}.`, 'good');
    return `Trade done: ${fullName(p)} for ${label}.`;
  });
}

export function declineTrade(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const o = d.tradeOffer;
    if (o) addNews(d, `Turned down ${teamName(teamById(d, o.teamId))}'s offer for ${fullName(d.players[o.playerId])}.`, 'info');
    d.tradeOffer = undefined;
  });
}
