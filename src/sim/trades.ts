/**
 * Trades: CPU clubs give draft picks for the user's players, and players for the user's picks.
 * Offers arrive on their own after regular-season games, or on request from a player's profile
 * or a pick on the Roster screen (one ask per player or pick per day).
 */
import type { Rng } from '../core/rng';
import type { LeagueSave, Player, Team, TradeOffer } from '../core/types';
import { ROSTER, TRADES } from './config';
import { teamName } from './data';
import { canSign, capSpace, payroll } from './economy';
import { addNews, newId, placeNewPlayer, repairRotation, sortRotation, standings, teamById, userTeam } from './league';
import { fullName, stars } from './players';
import { TxError, freeNumber, rngFor, transact, type TxResult } from './transactions';

/** Picks traded now belong to the next draft: this season's until it is held, then next season's. */
export function tradePickSeason(league: LeagueSave) {
  const step = league.offseasonStep;
  return league.phase === 'offseason' && (step === 'freeAgency' || step === 'done') ? league.season + 1 : league.season;
}

/** During the draft, the slot in this draft's order that a pick still holds (undefined once it has been used). */
function openDraftSlot(league: LeagueSave, pick: { season: number; round: 1 | 2; originalTeamId: string }) {
  const d = league.draft;
  if (league.offseasonStep !== 'draft' || !d || pick.season !== league.season) return undefined;
  return d.order.find((s, i) => i >= d.current && s.round === pick.round && s.originalTeamId === pick.originalTeamId);
}

/** A pick can still be traded: during the draft, this draft's picks only until they are used. */
function pickTradeable(league: LeagueSave, pick: { season: number; round: 1 | 2; originalTeamId: string }) {
  return league.offseasonStep !== 'draft' || pick.season !== league.season || !!openDraftSlot(league, pick);
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
  if (!p || !user.rosterIds.includes(playerId)) return null;
  const best = tradeRound(p);
  if (!best) return null;
  // During the draft, clubs offer picks still to be made in it, or next season's when those are gone.
  const seasons = league.offseasonStep === 'draft' ? [league.season, league.season + 1] : [tradePickSeason(league)];
  for (const round of best === 1 ? ([1, 2] as const) : ([2] as const)) {
    for (const season of seasons) {
      const options = league.teams
        .filter((t) => t.id !== user.id && canTake(league, t, p))
        .flatMap((t) => league.draftPicks.filter((d) => d.season === season && d.round === round && d.ownerTeamId === t.id && pickTradeable(league, d)).map((pick) => ({ t, pick })));
      if (!options.length) continue;
      const o = rng.pick(options);
      return { id: newId(league, 'tr'), teamId: o.t.id, playerId, pick: { season, round, originalTeamId: o.pick.originalTeamId } };
    }
  }
  return null;
}

type PickRef = { season: number; round: 1 | 2; originalTeamId: string };

export function pickLabel(league: LeagueSave, o: TradeOffer) {
  if (o.userGives === 'pick') return userPickLabel(league, o.pick);
  const own = o.pick.originalTeamId === o.teamId ? 'their' : `${teamName(teamById(league, o.pick.originalTeamId))}'s`;
  return `${own} ${o.pick.round === 1 ? 'first' : 'second'}-round pick in the Season ${o.pick.season} draft`;
}

/** "your first-round pick in the Season 2 draft", noting where an acquired pick came from. */
export function userPickLabel(league: LeagueSave, pick: PickRef) {
  const from = pick.originalTeamId === league.userTeamId ? '' : ` (from ${teamName(teamById(league, pick.originalTeamId))})`;
  const slot = openDraftSlot(league, pick);
  return `your ${pick.round === 1 ? 'first' : 'second'}-round pick${from} in the Season ${pick.season} draft${slot ? ` (#${slot.pick})` : ''}`;
}

export function offerText(league: LeagueSave, o: TradeOffer) {
  const club = teamName(teamById(league, o.teamId));
  const p = league.players[o.playerId];
  if (o.userGives === 'pick') return `${club} is offering ${fullName(p)} (${stars(p).toFixed(1)}-star ${p.position}) for ${pickLabel(league, o)}. Do you accept?`;
  return `${club} is offering ${pickLabel(league, o)} for ${fullName(p)}. Do you accept?`;
}

/** The user's picks that can still be traded. */
export function userPicks(league: LeagueSave) {
  const from = tradePickSeason(league);
  return league.draftPicks
    .filter((p) => p.ownerTeamId === league.userTeamId && p.season >= from && pickTradeable(league, p))
    .sort((a, b) => a.season - b.season || a.round - b.round);
}

/** Star range of the player a club gives for a pick: earlier picks fetch better players. */
export function pickStarRange(league: LeagueSave, pick: PickRef): [number, number] {
  if (pick.round === 2) return [TRADES.secondRoundPlayer[0], TRADES.secondRoundPlayer[1]];
  const n = Math.max(2, league.teams.length);
  const slot = openDraftSlot(league, pick);
  // Before the lottery the pick's value follows the original team's place in the standings.
  const worstFirst = standings(league).map((r) => r.team.id).reverse();
  const r = slot ? (slot.pick - 1) / (n - 1) : Math.max(0, worstFirst.indexOf(pick.originalTeamId)) / (n - 1);
  const max = Math.round((TRADES.firstRoundPlayerMax - r) * 2) / 2;
  return [max - 1, max];
}

export function findPlayerForPick(league: LeagueSave, pick: PickRef, rng: Rng): TradeOffer | null {
  const user = userTeam(league);
  const owned = league.draftPicks.find((x) => x.season === pick.season && x.round === pick.round && x.originalTeamId === pick.originalTeamId);
  if (!owned || owned.ownerTeamId !== user.id || !pickTradeable(league, owned)) return null;
  const [lo, hi] = pickStarRange(league, pick);
  const room = capSpace(league, user);
  const options = league.teams
    .filter((t) => t.id !== user.id)
    .flatMap((t) => {
      const best = t.rosterIds.map((id) => league.players[id]).sort((a, b) => stars(b) - stars(a))[0];
      return t.rosterIds
        .map((id) => league.players[id])
        .filter((p) => p !== best && !p.injury && p.contract.yearsRemaining >= 1 && stars(p) >= lo && stars(p) <= hi && p.contract.salaryMillions <= room + 1e-9)
        .map((p) => ({ t, p }));
    });
  if (!options.length || user.rosterIds.length >= ROSTER.max) return null;
  const o = rng.pick(options);
  return { id: newId(league, 'tr'), teamId: o.t.id, playerId: o.p.id, pick: { ...pick }, userGives: 'pick' };
}

/** Ask clubs what a pick would fetch. Sets `tradeOffer` when a club bites. */
export function shopPick(league: LeagueSave, pick: PickRef): TxResult {
  return transact(league, (d) => {
    const owned = d.draftPicks.find((x) => x.season === pick.season && x.round === pick.round && x.originalTeamId === pick.originalTeamId);
    if (!owned || owned.ownerTeamId !== d.userTeamId || !pickTradeable(d, owned)) throw new TxError('That pick is not yours to trade.');
    const user = userTeam(d);
    if (user.rosterIds.length >= ROSTER.max) throw new TxError(`Your roster is full (${ROSTER.max}). Release or trade a player to make room for the player you get back.`);
    const id = `pick:${pick.season}:${pick.round}:${pick.originalTeamId}`;
    const key = `${d.season}:${d.phase}:${d.offseasonStep ?? ''}:${d.day}`;
    if (d.tradeAsked?.[id] === key) throw new TxError('You already shopped that pick today. Clubs will listen again after your next game.');
    d.tradeAsked = Object.fromEntries(Object.entries(d.tradeAsked ?? {}).filter(([, v]) => v === key));
    d.tradeAsked[id] = key;
    const o = findPlayerForPick(d, pick, rngFor(d));
    if (!o) return 'No club will give up a player you can fit under your cap for that pick right now.';
    d.tradeOffer = o;
  });
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
    if (o.userGives === 'pick') {
      if (!p || !club.rosterIds.includes(p.id)) throw new TxError(`That player is no longer with ${teamName(club)}.`);
      if (!pick || pick.ownerTeamId !== user.id || !pickTradeable(d, pick)) throw new TxError('That pick is no longer yours to trade.');
      const cap = canSign(d, user, p.contract.salaryMillions, Math.max(1, p.contract.yearsRemaining));
      if (!cap.ok) throw new TxError(cap.reason);
      const label = userPickLabel(d, pick);
      club.rosterIds = club.rosterIds.filter((id) => id !== p.id);
      delete club.minutesPlan[p.id];
      sortRotation(d, club);
      user.rosterIds.push(p.id);
      p.jerseyNumber = freeNumber(d, user, p.jerseyNumber);
      placeNewPlayer(user, p.id);
      d.devBaseline[p.id] = stars(p);
      const slot = openDraftSlot(d, pick);
      pick.ownerTeamId = club.id;
      if (slot) slot.teamId = club.id;
      addNews(d, `Traded ${label.replace(/^your /, 'our ')} to ${teamName(club)} for ${fullName(p)}.`, 'good');
      return `Trade done: ${fullName(p)} joins for ${label}.`;
    }
    if (!p || !user.rosterIds.includes(p.id)) throw new TxError('That player is no longer on your roster.');
    if (!pick || pick.ownerTeamId !== club.id) throw new TxError(`${teamName(club)} no longer owns that pick.`);
    if (!pickTradeable(d, pick)) throw new TxError('That pick has already been used in the draft.');
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
    const slot = openDraftSlot(d, pick);
    if (slot) slot.teamId = user.id;
    addNews(d, `Traded ${fullName(p)} to ${teamName(club)} for ${label}.`, 'good');
    return `Trade done: ${fullName(p)} for ${label}.`;
  });
}

export function declineTrade(league: LeagueSave): TxResult {
  return transact(league, (d) => {
    const o = d.tradeOffer;
    if (o) addNews(d, `Turned down ${teamName(teamById(d, o.teamId))}'s offer ${o.userGives === 'pick' ? 'of' : 'for'} ${fullName(d.players[o.playerId])}.`, 'info');
    d.tradeOffer = undefined;
  });
}
