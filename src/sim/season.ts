/**
 * Season flow: applying results (exactly once per game), advancing the calendar,
 * playoffs and the hand-off to the off-season. Live games and simulated games both
 * end up in applyGameResult, so standings, stats, injuries and XP update the same way.
 */
import { Rng, clamp } from '../core/rng';
import { emptyStats, type BoxLine, type BoxScore, type LeagueSave, type Player, type PlayerStats, type PlayoffSeries, type ScheduledGame, type Team } from '../core/types';
import { COINS } from './config';
import { tickMarket } from './market';
import { updateMorale } from './morale';
import { maybeTriggerEvent } from './events';
import { simulateGame } from './gameSim';
import { addNews, repairRotation, sortRotation, standings, teamById } from './league';
import { applyDevelopment, fullName } from './players';

export function withRng<T>(league: LeagueSave, f: (rng: Rng) => T): T {
  const rng = new Rng(league.rngState || league.seed);
  const out = f(rng);
  league.rngState = rng.state;
  return out;
}

export function addLineToStats(s: PlayerStats, l: BoxLine) {
  s.games++;
  if (l.starter) s.starts++;
  s.minutes += l.seconds / 60;
  s.points += l.points;
  s.rebounds += l.offRebounds + l.defRebounds;
  s.offRebounds += l.offRebounds;
  s.assists += l.assists;
  s.steals += l.steals;
  s.blocks += l.blocks;
  s.turnovers += l.turnovers;
  s.fouls += l.fouls;
  s.fgm += l.fgm;
  s.fga += l.fga;
  s.threePm += l.threePm;
  s.threePa += l.threePa;
  s.ftm += l.ftm;
  s.fta += l.fta;
}

export function gameById(league: LeagueSave, id: string) {
  return league.schedule.find((g) => g.id === id);
}

/** Next scheduled game for the user's team (regular season or playoffs). */
export function nextUserGame(league: LeagueSave): ScheduledGame | undefined {
  return league.schedule
    .filter((g) => !g.played && (g.homeId === league.userTeamId || g.awayId === league.userTeamId))
    .sort((a, b) => a.day - b.day)[0];
}

export function validateBox(box: BoxScore) {
  for (const [lines, score] of [
    [box.home, box.homeScore],
    [box.away, box.awayScore],
  ] as const) {
    const pts = lines.reduce((s, l) => s + l.points, 0);
    const calc = lines.reduce((s, l) => s + 2 * l.fgm + l.threePm + l.ftm, 0);
    if (pts !== score || calc !== score) throw new Error(`Box score for ${box.gameId} does not reconcile (${pts}/${calc} vs ${score}).`);
  }
  if (box.homeScore === box.awayScore) throw new Error(`Game ${box.gameId} ended tied.`);
}

/**
 * Applies a finished game to the league. Idempotent: a game id is only ever applied once.
 * Returns false when the game had already been applied.
 */
export function applyGameResult(league: LeagueSave, box: BoxScore, rng: Rng): boolean {
  if (league.appliedGames.includes(box.gameId)) return false;
  const game = gameById(league, box.gameId);
  if (!game) throw new Error(`Unknown game ${box.gameId}`);
  validateBox(box);
  league.appliedGames.push(box.gameId);
  game.played = true;
  game.homeScore = box.homeScore;
  game.awayScore = box.awayScore;
  league.boxScores[box.gameId] = box;

  const home = teamById(league, box.homeId);
  const away = teamById(league, box.awayId);
  const homeWon = box.homeScore > box.awayScore;
  const playoff = !!game.playoff;
  const user = league.userTeamId;
  let reward: LeagueSave['lastReward'] | undefined;

  for (const [team, won, isHome, pf, pa] of [
    [home, homeWon, true, box.homeScore, box.awayScore],
    [away, !homeWon, false, box.awayScore, box.homeScore],
  ] as const) {
    const opp = isHome ? away : home;
    if (!playoff) {
      if (won) team.wins++;
      else team.losses++;
      if (team.conference === opp.conference) {
        if (won) team.confWins++;
        else team.confLosses++;
      }
      if (isHome) {
        if (won) team.homeWins++;
        else team.homeLosses++;
      }
      team.pointsFor += pf;
      team.pointsAgainst += pa;
    }
    team.streak = won ? Math.max(1, team.streak + 1) : Math.min(-1, team.streak - 1);
    const coins = gameCoins(team, won);
    team.credits += coins;
    if (team.id === user) {
      reward = { gameId: box.gameId, coins, reasons: [won ? `Win +${COINS.win} CC` : `Loss +${COINS.loss} CC`] };
      if (coins > (won ? COINS.win : COINS.loss)) reward.reasons.push(`Fans fired up +${COINS.fanBonus} CC`);
    }
    // Fan support: wins (more at home with fan engagement) raise it, losing streaks drain it.
    if (won) team.fanSupport = clamp(team.fanSupport + 2 + (isHome ? team.facilities.fans : 0), 0, 100);
    else team.fanSupport = clamp(team.fanSupport - 2 - (team.streak <= -3 ? 1 : 0), 0, 100);
    if (team.id === user) {
      if (won) league.coach.wins++;
      else league.coach.losses++;
      league.coach.confidence = clamp(league.coach.confidence + (won ? 1 : -1), 0, 100);
    }
  }

  // Player stats, XP, morale, condition.
  for (const [lines, team, won] of [
    [box.home, home, homeWon],
    [box.away, away, !homeWon],
  ] as const) {
    for (const l of lines) {
      const p = league.players[l.playerId];
      if (!p) continue;
      if (l.seconds > 0) {
        if (!playoff) addLineToStats(p.seasonStats, l);
        addLineToStats(p.careerStats, l);
        const mins = l.seconds / 60;
        p.condition = clamp(p.condition - mins * 0.32 * (1.3 - p.ratings.stamina * 0.05), 30, 100);
        const perf = l.points + 1.2 * (l.offRebounds + l.defRebounds) + 1.5 * l.assists + 2 * (l.steals + l.blocks) - l.turnovers - (l.fga - l.fgm) * 0.5;
        const train = 1 + team.facilities.training * 0.15 + team.staff.development * 0.12;
        const learner = p.traits.includes('Quick Learner') ? 1.25 : 1;
        const youth = p.age <= 24 ? 1.3 : p.age >= 31 ? 0.6 : 1;
        p.xp += Math.max(1, (mins * 0.35 + Math.max(0, perf) * 0.25) * train * learner * youth);
        recordSingleGame(league, p, l, team);
        if (team.id === user && l.points >= 30) earnAchievement(league, team, 'bigGame', reward);
      }
      const raised = applyDevelopment(p, rng);
      if (raised.length && team.id === user) addNews(league, `${fullName(p)} improved ${raised.join(', ')} (+${raised.length}).`, 'good');
    }
    updateMorale(league, team, lines, won);
  }

  // Injury countdown for players whose team just played, then new injuries.
  for (const team of [home, away]) {
    for (const id of team.rosterIds) {
      const p = league.players[id];
      if (p?.injury) {
        p.injury.gamesRemaining--;
        if (p.injury.gamesRemaining <= 0) {
          if (team.id === user) addNews(league, `${fullName(p)} is back from injury.`, 'good');
          p.injury = undefined;
        }
      }
    }
  }
  for (const inj of box.injuries) {
    const p = league.players[inj.playerId];
    if (!p || p.injury) continue;
    const team = home.rosterIds.includes(p.id) ? home : away;
    const med = 1 - team.facilities.recovery * 0.12;
    p.injury = { type: inj.injury.type, gamesRemaining: Math.max(1, Math.round(inj.injury.gamesRemaining * med)) };
    if (team.id === user || p.injury.gamesRemaining >= 10) {
      addNews(league, `${team.abbr} ${fullName(p)} out ${p.injury.gamesRemaining} game${p.injury.gamesRemaining > 1 ? 's' : ''} (${p.injury.type}).`, 'bad');
    }
  }
  for (const team of [home, away]) {
    if (team.id === user) repairRotation(league, team);
    else sortRotation(league, team);
  }

  if (game.playoff) applyPlayoffGame(league, game, homeWon ? home.id : away.id, reward);
  if (home.id === user || away.id === user) {
    const ut = home.id === user ? home : away;
    if ((home.id === user) === homeWon) {
      earnAchievement(league, ut, 'firstWin', reward);
      if (ut.streak >= 5) earnAchievement(league, ut, 'streak5', reward);
    }
    if (reward) league.lastReward = reward;
    if (league.market) tickMarket(league, rng);
    const userWon = (home.id === user) === homeWon;
    const opp = home.id === user ? away : home;
    addNews(
      league,
      `${userWon ? 'W' : 'L'} ${Math.max(box.homeScore, box.awayScore)}-${Math.min(box.homeScore, box.awayScore)} ${home.id === user ? 'vs' : 'at'} ${opp.city} ${opp.name}.`,
      userWon ? 'good' : 'bad',
    );
  }
  return true;
}

/** Coach Coins for a result: flat win/loss amounts, plus a small bonus on wins when fans are fired up. */
export function gameCoins(team: Team, won: boolean) {
  let c = won ? COINS.win : COINS.loss;
  if (won && team.fanSupport >= COINS.fanBonusThreshold) c += COINS.fanBonus;
  return c;
}

/** Pay a one-time milestone bonus to the user's team. */
export function earnAchievement(league: LeagueSave, team: Team, key: string, reward?: LeagueSave['lastReward']) {
  const a = COINS.achievements[key];
  if (!a || league.achievements.includes(key) || team.id !== league.userTeamId) return;
  league.achievements.push(key);
  team.credits += a.coins;
  if (reward) {
    reward.coins += a.coins;
    reward.reasons.push(`${a.label} +${a.coins} CC`);
  }
  addNews(league, `Milestone: ${a.label} (+${a.coins} CC).`, 'good');
}

function recordSingleGame(league: LeagueSave, p: Player, l: BoxLine, team: Team) {
  const cats: [string, number][] = [
    ['Points', l.points],
    ['Rebounds', l.offRebounds + l.defRebounds],
    ['Assists', l.assists],
    ['Steals', l.steals],
    ['Blocks', l.blocks],
    ['Threes', l.threePm],
  ];
  for (const [label, value] of cats) {
    const cur = league.records.singleGame.find((r) => r.label === label);
    if (!cur || value > cur.value) {
      const entry = { label, value, playerId: p.id, name: fullName(p), season: league.season, teamId: team.id };
      if (cur) Object.assign(cur, entry);
      else league.records.singleGame.push(entry);
    }
  }
}

/** Daily recovery: condition returns, faster with a better medical center. */
function dailyRecovery(league: LeagueSave) {
  for (const t of league.teams) {
    const rec = 9 + t.facilities.recovery * 4;
    for (const id of t.rosterIds) {
      const p = league.players[id];
      if (p) p.condition = clamp(p.condition + rec, 0, 100);
    }
  }
}

function weeklyMorale(league: LeagueSave) {
  for (const t of league.teams) {
    const ps = t.rosterIds.map((id) => league.players[id]).filter(Boolean);
    const leaders = ps.filter((p) => p.traits.includes('Locker-Room Leader')).length;
    const selfish = ps.filter((p) => p.traits.includes('Selfish')).length;
    for (const p of ps) {
      p.morale = clamp(p.morale + leaders * 1.5 - selfish * 0.5 + (60 - p.morale) * 0.05, 0, 100);
    }
    const avgMorale = ps.reduce((s, p) => s + p.morale, 0) / Math.max(1, ps.length);
    const generals = ps.filter((p) => p.traits.includes('Floor General')).length;
    const streakBonus = clamp(t.streak, -5, 5);
    t.chemistry = Math.round(clamp(avgMorale * 0.7 + leaders * 4 + generals * 2 - selfish * 4 + streakBonus * 1.5 + 15, 0, 100));
  }
}

/**
 * Advance one day. The user's game for the day is applied from `userBox` when they played it,
 * otherwise simulated. Returns the ids of games resolved.
 */
export function advanceDay(league: LeagueSave, userBox?: BoxScore): string[] {
  const done: string[] = [];
  withRng(league, (rng) => {
    const today = league.schedule.filter((g) => g.day === league.day && !g.played);
    if (userBox) {
      const g = today.find((x) => x.id === userBox.gameId);
      if (!g) throw new Error('That game is not scheduled today.');
    }
    for (const g of today) {
      const box = userBox && userBox.gameId === g.id ? userBox : simulateGame(league, g, rng);
      if (applyGameResult(league, box, rng)) done.push(g.id);
    }
    dailyRecovery(league);
    if (league.day % 3 === 2) weeklyMorale(league);
    league.day++;
    if (league.phase === 'regular') {
      maybeTriggerEvent(league, rng);
      if (league.schedule.every((g) => g.played)) startPlayoffs(league);
    } else if (league.phase === 'playoffs') {
      schedulePlayoffGames(league);
    }
  });
  league.updatedAt = Date.now();
  return done;
}

/** Day the next unplayed game happens (skips days without games). */
export function currentGameDay(league: LeagueSave): number | null {
  const open = league.schedule.filter((g) => !g.played);
  if (!open.length) return null;
  return Math.min(...open.map((g) => g.day));
}

/** Simulate days until the user's next game is today (or the phase ends). */
export function simToUserGame(league: LeagueSave) {
  for (let guard = 0; guard < 400; guard++) {
    const day = currentGameDay(league);
    if (day === null) return;
    league.day = day;
    const userToday = league.schedule.some((g) => g.day === day && !g.played && (g.homeId === league.userTeamId || g.awayId === league.userTeamId));
    if (userToday) return;
    advanceDay(league);
    if (league.phase === 'offseason') return;
  }
}

// ------------------------------------------------------------------------- playoffs

export function winsNeeded(league: LeagueSave) {
  return Math.ceil(league.settings.seriesLength / 2);
}

export function startPlayoffs(league: LeagueSave) {
  league.phase = 'playoffs';
  league.playoffs = [];
  const perConf = league.settings.playoffTeams / 2;
  for (const conf of ['East', 'West'] as const) {
    const seeds = standings(league, conf).slice(0, perConf).map((r) => r.team.id);
    const pairs = perConf === 8 ? [[0, 7], [3, 4], [2, 5], [1, 6]] : [[0, 3], [1, 2]];
    pairs.forEach(([a, b], i) => {
      league.playoffs.push({ id: `${conf}-1-${i}`, round: 1, conference: conf, highSeedId: seeds[a], lowSeedId: seeds[b], highSeed: a + 1, lowSeed: b + 1, highWins: 0, lowWins: 0 });
    });
  }
  const user = league.userTeamId;
  const inIt = league.playoffs.some((s) => s.highSeedId === user || s.lowSeedId === user);
  addNews(league, inIt ? 'Playoffs! Your team clinched a spot.' : 'The regular season is over. Your team missed the playoffs.', inIt ? 'good' : 'bad');
  if (inIt) {
    const o = league.objectives.find((x) => x.kind === 'playoffs');
    if (o && !o.done) {
      o.done = true;
      teamById(league, user).credits += o.reward;
      addNews(league, `Objective complete: ${o.label} (+${o.reward} CC).`, 'good');
    }
    earnAchievement(league, teamById(league, user), 'playoffs');
  }
  schedulePlayoffGames(league);
}

export function totalRounds(league: LeagueSave) {
  return Math.log2(league.settings.playoffTeams);
}

function seriesDone(league: LeagueSave, s: PlayoffSeries) {
  const need = winsNeeded(league);
  return s.highWins >= need || s.lowWins >= need;
}

/** Ensure every live series has its next game on the calendar; build later rounds as rounds finish. */
export function schedulePlayoffGames(league: LeagueSave) {
  if (league.phase !== 'playoffs') return;
  const maxRound = Math.max(...league.playoffs.map((s) => s.round));
  const current = league.playoffs.filter((s) => s.round === maxRound);
  if (current.every((s) => seriesDone(league, s))) {
    if (maxRound >= totalRounds(league)) {
      finishPlayoffs(league, current[0]);
      return;
    }
    // Next round pairings.
    const next = maxRound + 1;
    const finals = next === totalRounds(league);
    if (finals) {
      const [e, w] = [current.find((s) => s.conference === 'East')!, current.find((s) => s.conference === 'West')!];
      const ew = e.winnerId!;
      const ww = w.winnerId!;
      const et = teamById(league, ew);
      const wt = teamById(league, ww);
      const eHigh = et.wins >= wt.wins;
      league.playoffs.push({
        id: `F-${next}`,
        round: next,
        conference: 'Finals',
        highSeedId: eHigh ? ew : ww,
        lowSeedId: eHigh ? ww : ew,
        highSeed: 1,
        lowSeed: 2,
        highWins: 0,
        lowWins: 0,
      });
    } else {
      for (const conf of ['East', 'West'] as const) {
        const cs = current.filter((s) => s.conference === conf);
        for (let i = 0; i < cs.length; i += 2) {
          const a = cs[i];
          const b = cs[i + 1];
          const wa = { id: a.winnerId!, seed: a.winnerId === a.highSeedId ? a.highSeed : a.lowSeed };
          const wb = { id: b.winnerId!, seed: b.winnerId === b.highSeedId ? b.highSeed : b.lowSeed };
          const [hi, lo] = wa.seed <= wb.seed ? [wa, wb] : [wb, wa];
          league.playoffs.push({ id: `${conf}-${next}-${i / 2}`, round: next, conference: conf, highSeedId: hi.id, lowSeedId: lo.id, highSeed: hi.seed, lowSeed: lo.seed, highWins: 0, lowWins: 0 });
        }
      }
    }
    schedulePlayoffGames(league);
    return;
  }
  for (const s of current) {
    if (seriesDone(league, s)) continue;
    const pending = league.schedule.some((g) => g.playoff?.seriesId === s.id && !g.played);
    if (pending) continue;
    const n = s.highWins + s.lowWins + 1;
    // 2-2-1-1-1 home pattern.
    const highHome = [1, 2, 5, 7].includes(n) || league.settings.seriesLength === 1;
    league.schedule.push({
      id: `po${league.season}_${s.id}_${n}`,
      day: league.day,
      homeId: highHome ? s.highSeedId : s.lowSeedId,
      awayId: highHome ? s.lowSeedId : s.highSeedId,
      played: false,
      playoff: { round: s.round, seriesId: s.id, gameNumber: n },
    });
  }
}

function applyPlayoffGame(league: LeagueSave, game: ScheduledGame, winnerId: string, reward?: LeagueSave['lastReward']) {
  const s = league.playoffs.find((x) => x.id === game.playoff!.seriesId);
  if (!s) return;
  if (winnerId === s.highSeedId) s.highWins++;
  else s.lowWins++;
  if (seriesDone(league, s)) {
    s.winnerId = s.highWins > s.lowWins ? s.highSeedId : s.lowSeedId;
    const w = teamById(league, s.winnerId);
    const l = teamById(league, s.winnerId === s.highSeedId ? s.lowSeedId : s.highSeedId);
    const user = league.userTeamId;
    if (w.id === user) earnAchievement(league, w, 'seriesWin', reward);
    if (w.id === user || l.id === user || s.conference === 'Finals') {
      addNews(league, `${w.city} ${w.name} win the series ${Math.max(s.highWins, s.lowWins)}-${Math.min(s.highWins, s.lowWins)} over ${l.city}.`, w.id === user ? 'good' : l.id === user ? 'bad' : 'info');
    }
  }
}

function finishPlayoffs(league: LeagueSave, finals: PlayoffSeries) {
  const champ = finals.winnerId!;
  const runner = champ === finals.highSeedId ? finals.lowSeedId : finals.highSeedId;
  const t = teamById(league, champ);
  t.banners.push(league.season);
  const entry = league.history.find((h) => h.season === league.season) ?? { season: league.season };
  entry.champion = champ;
  entry.runnerUp = runner;
  if (!league.history.includes(entry)) league.history.push(entry);
  if (champ === league.userTeamId) {
    league.coach.titles++;
    league.coach.reputation = clamp(league.coach.reputation + 15, 0, 100);
    t.credits += COINS.championship;
    if (league.lastReward) {
      league.lastReward.coins += COINS.championship;
      league.lastReward.reasons.push(`Championship +${COINS.championship} CC`);
    }
    t.fanSupport = clamp(t.fanSupport + 15, 0, 100);
  }
  addNews(league, `${t.city} ${t.name} are ${league.settings.leagueName} champions!`, champ === league.userTeamId ? 'good' : 'info');
  league.phase = 'offseason';
  league.offseasonStep = 'awards';
}

export function userSeries(league: LeagueSave): PlayoffSeries | undefined {
  const u = league.userTeamId;
  return league.playoffs
    .filter((s) => s.highSeedId === u || s.lowSeedId === u)
    .sort((a, b) => b.round - a.round)[0];
}

export function resetSeasonStats(p: Player) {
  p.seasonStats = emptyStats();
}
