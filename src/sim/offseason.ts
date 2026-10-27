/**
 * Off-season pipeline: awards -> retirements -> progression -> re-signings -> draft
 * lottery -> two-round draft -> free agency -> next season. Each step is a separate call
 * so the UI can stop where the user has decisions to make.
 */
import { Rng, clamp } from '../core/rng';
import { emptyStats, type DraftState, type LeagueSave, type Player, type RecordEntry, type SeasonAwards, type Team } from '../core/types';
import { canSign, payroll, rookieSalary, round1, MIN_SALARY } from './economy';
import { ROSTER_MAX, addNews, buildSchedule, defaultObjectives, newId, placeNewPlayer, repairRotation, sortRotation, staffCandidates, standings, teamById, userTeam } from './league';
import { ageOneYear, fullName, generatePlayer, marketSalary, stars } from './players';
import { refreshMarket } from './market';
import { withRng } from './season';
import { askingContract, freeNumber } from './transactions';

const per = (v: number, g: number) => (g ? v / g : 0);

function winPct(t: Team) {
  return t.wins + t.losses ? t.wins / (t.wins + t.losses) : 0;
}

export function teamOfPlayer(league: LeagueSave, id: string) {
  return league.teams.find((t) => t.rosterIds.includes(id));
}

/** Awards, records, objectives, and season stats archived into player histories. */
export function runAwards(league: LeagueSave) {
  const minGames = Math.ceil(league.settings.seasonGames * 0.5);
  const all = Object.values(league.players).filter((p) => !p.retired && p.seasonStats.games >= minGames);
  const team = (p: Player) => teamOfPlayer(league, p.id);
  const val = (p: Player) => {
    const s = p.seasonStats;
    const g = s.games;
    return per(s.points, g) + 1.2 * per(s.rebounds, g) + 1.5 * per(s.assists, g) + 2 * per(s.steals + s.blocks, g) - per(s.turnovers, g);
  };
  const best = (list: Player[], f: (p: Player) => number) => list.slice().sort((a, b) => f(b) - f(a))[0];
  const entry: SeasonAwards = league.history.find((h) => h.season === league.season) ?? { season: league.season };
  const mvp = best(all, (p) => val(p) * (0.6 + 0.8 * winPct(team(p) ?? ({ wins: 0, losses: 1 } as Team))));
  const rookies = all.filter((p) => p.rookieSeason === league.season);
  const roy = rookies.length ? best(rookies, val) : undefined;
  const dpoy = best(all, (p) => (2 * per(p.seasonStats.steals, p.seasonStats.games) + 2 * per(p.seasonStats.blocks, p.seasonStats.games) + 0.3 * per(p.seasonStats.rebounds - p.seasonStats.offRebounds, p.seasonStats.games) + p.ratings.defense * 1.5) * (0.7 + 0.6 * winPct(team(p) ?? ({ wins: 0, losses: 1 } as Team))));
  const scorer = best(all, (p) => per(p.seasonStats.points, p.seasonStats.games));
  const give = (p: Player | undefined, label: string, key: keyof SeasonAwards) => {
    if (!p) return;
    (entry as Record<string, unknown>)[key] = p.id;
    p.awards.push(`${label} S${league.season}`);
  };
  give(mvp, 'MVP', 'mvp');
  give(roy, 'Rookie of the Year', 'roy');
  give(dpoy, 'Defensive Player', 'dpoy');
  give(scorer, 'Scoring Title', 'scoringLeader');
  // Finals MVP from the finals box scores.
  const finals = league.playoffs.find((s) => s.conference === 'Finals');
  if (finals?.winnerId) {
    const tally = new Map<string, number>();
    for (const g of league.schedule) {
      if (g.playoff?.seriesId !== finals.id) continue;
      const box = league.boxScores[g.id];
      if (!box) continue;
      const lines = box.homeId === finals.winnerId ? box.home : box.away;
      for (const l of lines) tally.set(l.playerId, (tally.get(l.playerId) ?? 0) + l.points + 1.2 * (l.offRebounds + l.defRebounds) + 1.5 * l.assists);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) give(league.players[top[0]], 'Finals MVP', 'finalsMvp');
  }
  const ut = userTeam(league);
  entry.userRecord = `${ut.wins}-${ut.losses}`;
  if (!league.history.includes(entry)) league.history.push(entry);

  // Season records (per-game averages).
  for (const p of all) {
    const g = p.seasonStats.games;
    const t = team(p);
    const cats: [string, number][] = [
      ['Points per game', per(p.seasonStats.points, g)],
      ['Rebounds per game', per(p.seasonStats.rebounds, g)],
      ['Assists per game', per(p.seasonStats.assists, g)],
      ['Threes made', p.seasonStats.threePm],
    ];
    for (const [label, value] of cats) {
      const cur = league.records.season.find((r) => r.label === label);
      if (!cur || value > cur.value) {
        const e: RecordEntry = { label, value: Math.round(value * 10) / 10, playerId: p.id, name: fullName(p), season: league.season, teamId: t?.id ?? '' };
        if (cur) Object.assign(cur, e);
        else league.records.season.push(e);
      }
    }
  }

  // Objectives
  for (const o of league.objectives) {
    if (o.done) continue;
    let done = false;
    if (o.kind === 'wins') done = ut.wins >= o.target;
    if (o.kind === 'finance') done = payroll(league, ut) <= ut.capMillions;
    if (o.kind === 'develop') done = ut.rosterIds.some((id) => league.devBaseline[id] !== undefined && stars(league.players[id]) >= league.devBaseline[id] + 0.5);
    if (done) {
      o.done = true;
      ut.credits += o.reward;
      addNews(league, `Objective complete: ${o.label} (+${o.reward} credits).`, 'good');
    }
  }
  const met = league.objectives.filter((o) => o.done).length;
  league.coach.confidence = clamp(league.coach.confidence + (met - 2) * 6 + (winPct(ut) - 0.5) * 30, 0, 100);
  league.coach.reputation = clamp(league.coach.reputation + (winPct(ut) - 0.5) * 20 + met * 2, 0, 100);
  league.coach.seasons++;
  if (league.coach.confidence < 20) addNews(league, 'The front office is losing patience. Win now.', 'bad');

  // Archive season stats.
  for (const t of league.teams) {
    for (const id of t.rosterIds) {
      const p = league.players[id];
      if (p.seasonStats.games > 0) p.history.push({ season: league.season, teamId: t.id, stats: { ...p.seasonStats } });
    }
  }
  league.offseasonStep = 'retirements';
}

export function runRetirements(league: LeagueSave, rng: Rng): Player[] {
  const retired: Player[] = [];
  const consider = [...league.teams.flatMap((t) => t.rosterIds), ...league.freeAgents];
  for (const id of consider) {
    const p = league.players[id];
    if (!p || p.age < 33) continue;
    let chance = (p.age - 32) * 0.16 + (stars(p) < 1.5 ? 0.25 : 0) - (stars(p) >= 3.5 ? 0.15 : 0);
    if (p.age >= 38) chance = 1;
    if (rng.chance(clamp(chance, 0, 1))) {
      p.retired = true;
      retired.push(p);
      const t = teamOfPlayer(league, id);
      if (t) {
        t.rosterIds = t.rosterIds.filter((x) => x !== id);
        t.starters = t.starters.filter((x) => x !== id);
        t.rotation = t.rotation.filter((x) => x !== id);
        delete t.minutesPlan[id];
      }
      league.freeAgents = league.freeAgents.filter((x) => x !== id);
      if (t?.id === league.userTeamId || stars(p) >= 3) addNews(league, `${fullName(p)} retires at ${p.age}.`, 'info');
    }
  }
  league.offseasonStep = 'progression';
  return retired;
}

export function runProgression(league: LeagueSave, rng: Rng) {
  const ut = userTeam(league);
  for (const t of league.teams) {
    for (const id of t.rosterIds) {
      const p = league.players[id];
      const before = stars(p);
      ageOneYear(p, rng, 1 + t.facilities.training * 1.3 + t.staff.development * 0.6);
      const after = stars(p);
      if (t.id === ut.id && after !== before) addNews(league, `${fullName(p)} ${after > before ? 'improved' : 'declined'} to ${after.toFixed(1)} stars.`, after > before ? 'good' : 'bad');
    }
  }
  for (const id of league.freeAgents) ageOneYear(league.players[id], rng, 1);
  // Contracts tick down; zero means expiring now.
  for (const t of league.teams) {
    for (const id of t.rosterIds) {
      const p = league.players[id];
      p.contract.yearsRemaining = Math.max(0, p.contract.yearsRemaining - 1);
      if (p.contract.yearsRemaining === 0) {
        const ask = askingContract(league, { ...p, demand: undefined });
        p.demand = { salaryMillions: round1(ask.salary * rng.range(0.95, 1.1)), yearsRemaining: ask.years };
      }
    }
  }
  league.offseasonStep = 'resign';
}

/** CPU teams decide on their expiring players; the user handles theirs in the UI before calling this. */
export function finishResignings(league: LeagueSave, rng: Rng) {
  for (const t of league.teams) {
    const expiring = t.rosterIds.map((id) => league.players[id]).filter((p) => p.contract.yearsRemaining === 0);
    for (const p of expiring) {
      const keep = t.id !== league.userTeamId && stars(p) >= 2 && p.age <= 33 && rng.chance(0.7);
      const demand = p.demand ?? { salaryMillions: marketSalary(p), yearsRemaining: 2 };
      const pay = payroll(league, t) - p.contract.salaryMillions + demand.salaryMillions;
      if (keep && pay <= t.capMillions) {
        p.contract = { ...demand };
        p.demand = undefined;
      } else {
        t.rosterIds = t.rosterIds.filter((x) => x !== p.id);
        t.starters = t.starters.filter((x) => x !== p.id);
        t.rotation = t.rotation.filter((x) => x !== p.id);
        delete t.minutesPlan[p.id];
        league.freeAgents.push(p.id);
        if (t.id === league.userTeamId) addNews(league, `${fullName(p)} enters free agency.`, 'info');
      }
    }
  }
  league.offseasonStep = 'lottery';
}

const LOTTERY_WEIGHTS = [14, 13.4, 12.7, 12, 10.5, 9, 7.5, 6, 4.5, 3, 2, 1.5, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

export function runLottery(league: LeagueSave, rng: Rng) {
  const playoffIds = new Set(league.playoffs.flatMap((s) => [s.highSeedId, s.lowSeedId]));
  const worstFirst = standings(league).reverse().map((r) => r.team.id);
  const lotteryTeams = worstFirst.filter((id) => !playoffIds.has(id));
  const rest = worstFirst.filter((id) => playoffIds.has(id));
  const pool = lotteryTeams.map((id, i) => ({ id, w: LOTTERY_WEIGHTS[i] ?? 0.5, seed: i + 1 }));
  const drawn: typeof pool = [];
  for (let k = 0; k < Math.min(4, pool.length); k++) {
    const left = pool.filter((x) => !drawn.includes(x));
    drawn.push(rng.weighted(left, (x) => x.w));
  }
  const firstRound = [...drawn, ...pool.filter((x) => !drawn.includes(x))].map((x) => x.id).concat(rest);
  const lottery = firstRound.slice(0, lotteryTeams.length).map((id, i) => ({ teamId: id, seed: lotteryTeams.indexOf(id) + 1, pick: i + 1 }));
  const order: DraftState['order'] = [];
  const owner = (orig: string, round: 1 | 2) => league.draftPicks.find((p) => p.season === league.season && p.originalTeamId === orig && p.round === round)?.ownerTeamId ?? orig;
  firstRound.forEach((id, i) => order.push({ pick: i + 1, round: 1, teamId: owner(id, 1), originalTeamId: id }));
  worstFirst.forEach((id, i) => order.push({ pick: i + 1, round: 2, teamId: owner(id, 2), originalTeamId: id }));

  // Draft class: varies in depth year to year.
  const depth = rng.range(-0.4, 0.4);
  const prospects: string[] = [];
  for (let i = 0; i < 72; i++) {
    const tier = i < 4 ? 2.3 : i < 14 ? 1.7 : i < 30 ? 1.2 : 0.8;
    const p = generatePlayer(rng, { id: newId(league, 'p'), target: clamp(tier + depth + rng.normal(0, 0.35), 0.5, 3.5), age: rng.int(19, 22), draftProspect: true });
    // Hidden potential: real upside for young prospects.
    p.potential = clamp(Math.round((stars(p) + rng.range(0.5, 2.5) + (i < 10 ? 0.5 : 0)) * 2) / 2, stars(p), 5);
    const ut = userTeam(league);
    const err = 1.3 - ut.staff.development * 0.25;
    p.scoutedPotential = clamp(Math.round((p.potential + rng.normal(0, err)) * 2) / 2, 0.5, 5);
    p.scoutLevel = 0;
    p.contract = { salaryMillions: 1, yearsRemaining: 0 };
    league.players[p.id] = p;
    prospects.push(p.id);
  }
  league.draft = { order, prospectIds: prospects, current: 0, log: [], lottery };
  league.offseasonStep = 'draft';
  const up = lottery.find((l) => l.teamId === league.userTeamId);
  if (up) addNews(league, `Draft lottery: you pick #${up.pick} (entered as #${up.seed} odds).`, up.pick < up.seed ? 'good' : 'info');
}

export function prospectValue(league: LeagueSave, p: Player, team: Team) {
  const need = team.rosterIds.filter((id) => league.players[id].position === p.position).length <= 2 ? 0.35 : 0;
  return (p.scoutedPotential ?? stars(p)) * 0.65 + stars(p) * 0.45 + need - (p.age - 19) * 0.05;
}

export function currentPick(league: LeagueSave) {
  const d = league.draft;
  return d && d.current < d.order.length ? d.order[d.current] : undefined;
}

export function draftPlayer(league: LeagueSave, playerId: string) {
  const d = league.draft!;
  const slot = d.order[d.current];
  const team = teamById(league, slot.teamId);
  if (!d.prospectIds.includes(playerId)) throw new Error('That player is not available.');
  if (team.rosterIds.length >= ROSTER_MAX) {
    if (team.id === league.userTeamId) throw new Error(`Your roster is full (${ROSTER_MAX}). Release a player before drafting, or pass on the pick.`);
    const worst = team.rosterIds.map((id) => league.players[id]).sort((a, b) => stars(a) - stars(b))[0];
    team.rosterIds = team.rosterIds.filter((id) => id !== worst.id);
    league.freeAgents.push(worst.id);
  }
  const p = league.players[playerId];
  const { salary, years } = rookieSalary(slot.pick, slot.round);
  p.contract = { salaryMillions: salary, yearsRemaining: years };
  p.draft = { season: league.season, round: slot.round, pick: slot.pick, teamId: team.id };
  p.rookieSeason = league.season + 1;
  p.jerseyNumber = freeNumber(league, team, p.jerseyNumber);
  team.rosterIds.push(playerId);
  d.prospectIds = d.prospectIds.filter((id) => id !== playerId);
  d.log.push({ pick: slot.pick, round: slot.round, teamId: team.id, playerId });
  d.current++;
  if (team.id === league.userTeamId) {
    addNews(league, `Drafted ${fullName(p)} (${p.position}) with pick ${slot.round}-${slot.pick}.`, 'good');
    placeNewPlayer(team, playerId);
    repairRotation(league, team);
  } else sortRotation(league, team);
}

export function skipPick(league: LeagueSave) {
  const d = league.draft!;
  d.log.push({ pick: d.order[d.current].pick, round: d.order[d.current].round, teamId: d.order[d.current].teamId, playerId: '' });
  d.current++;
}

/** CPU teams pick until it is the user's turn (or the draft ends). */
export function runCpuPicks(league: LeagueSave) {
  const d = league.draft!;
  while (d.current < d.order.length) {
    const slot = d.order[d.current];
    if (slot.teamId === league.userTeamId) return;
    const team = teamById(league, slot.teamId);
    const best = d.prospectIds.map((id) => league.players[id]).sort((a, b) => prospectValue(league, b, team) - prospectValue(league, a, team))[0];
    // With seven-man rosters a full CPU team only drafts a prospect clearly better than its weakest player.
    const worst = team.rosterIds.map((id) => league.players[id]).sort((a, b) => stars(a) - stars(b))[0];
    const full = team.rosterIds.length >= ROSTER_MAX;
    if (!best || (full && worst && (best.scoutedPotential ?? stars(best)) < stars(worst) + 1.5)) {
      skipPick(league);
      continue;
    }
    draftPlayer(league, best.id);
  }
  finishDraft(league);
}

export function finishDraft(league: LeagueSave) {
  const d = league.draft;
  if (!d || d.current < d.order.length) return;
  // Undrafted prospects become free agents.
  for (const id of d.prospectIds) {
    const p = league.players[id];
    p.scoutedPotential = p.scoutedPotential ?? stars(p);
    p.rookieSeason = league.season + 1;
    league.freeAgents.push(id);
  }
  d.prospectIds = [];
  league.offseasonStep = 'freeAgency';
  for (const id of league.freeAgents) {
    const p = league.players[id];
    if (!p.demand) {
      const ask = askingContract(league, p);
      p.demand = { salaryMillions: ask.salary, yearsRemaining: ask.years };
    }
  }
}

/** CPU free agency: fill rosters to seven with the best affordable players. */
export function cpuFreeAgency(league: LeagueSave, rng: Rng) {
  const fas = () => league.freeAgents.map((id) => league.players[id]).filter((p) => p && !p.retired).sort((a, b) => stars(b) - stars(a));
  const teams = rng.shuffle(league.teams.filter((t) => t.id !== league.userTeamId));
  for (let round = 0; round < 6; round++) {
    for (const t of teams) {
      if (t.rosterIds.length >= ROSTER_MAX) continue;
      for (const p of fas()) {
        const ask = p.demand ?? { salaryMillions: marketSalary(p), yearsRemaining: 2 };
        let salary = ask.salaryMillions;
        if (!canSign(league, t, salary, ask.yearsRemaining).ok) {
          continue;
        }
        p.contract = { salaryMillions: salary, yearsRemaining: ask.yearsRemaining };
        p.demand = undefined;
        p.jerseyNumber = freeNumber(league, t, p.jerseyNumber);
        t.rosterIds.push(p.id);
        league.freeAgents = league.freeAgents.filter((id) => id !== p.id);
        break;
      }
    }
  }
  // Teams with room chase the best players still on the market.
  for (const p of fas().filter((x) => stars(x) >= 2.5)) {
    const ask = p.demand ?? { salaryMillions: marketSalary(p), yearsRemaining: 2 };
    const t = teams.find((x) => x.rosterIds.length < ROSTER_MAX && canSign(league, x, ask.salaryMillions, ask.yearsRemaining).ok);
    if (!t) continue;
    p.contract = { salaryMillions: ask.salaryMillions, yearsRemaining: ask.yearsRemaining };
    p.demand = undefined;
    p.jerseyNumber = freeNumber(league, t, p.jerseyNumber);
    t.rosterIds.push(p.id);
    league.freeAgents = league.freeAgents.filter((id) => id !== p.id);
    addNews(league, `${t.city} sign free agent ${fullName(p)}.`, 'info');
  }
  // Whoever is left lowers his price.
  for (const id of league.freeAgents) {
    const p = league.players[id];
    if (p?.demand) p.demand.salaryMillions = round1(Math.max(MIN_SALARY, p.demand.salaryMillions * 0.75));
  }
  for (const t of teams) sortRotation(league, t);
}

export function startNewSeason(league: LeagueSave) {
  withRng(league, (rng) => {
    cpuFreeAgency(league, rng);
    const ut = userTeam(league);
    league.season++;
    league.day = 0;
    league.phase = 'regular';
    league.offseasonStep = undefined;
    league.playoffs = [];
    league.draft = undefined;
    league.schedule = buildSchedule(league.teams, league.settings.seasonGames, rng, league.season);
    league.boxScores = {};
    league.appliedGames = [];
    league.pendingEvent = undefined;
    for (const t of league.teams) {
      Object.assign(t, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, confWins: 0, confLosses: 0, streak: 0, homeWins: 0, homeLosses: 0 });
      t.deadCap = t.deadCap.filter((d) => d.season >= league.season);
      for (const id of t.rosterIds) {
        const p = league.players[id];
        p.seasonStats = emptyStats();
        p.condition = 100;
        p.form = 0;
        if (p.injury) {
          p.injury.gamesRemaining -= 20;
          if (p.injury.gamesRemaining <= 0) p.injury = undefined;
        }
      }
      if (t.id === ut.id) repairRotation(league, t);
      else sortRotation(league, t);
    }
    // Trim the free-agent pool to the most relevant players.
    league.freeAgents = league.freeAgents
      .filter((id) => !league.players[id].retired)
      .sort((a, b) => stars(league.players[b]) - stars(league.players[a]))
      .slice(0, 45);
    for (const id of Object.keys(league.players)) {
      const p = league.players[id];
      const onTeam = league.teams.some((t) => t.rosterIds.includes(id));
      if (!onTeam && !league.freeAgents.includes(id) && !p.retired) p.retired = true;
    }
    league.draftPicks = league.draftPicks.filter((p) => p.season >= league.season);
    for (const t of league.teams) for (const round of [1, 2] as const) league.draftPicks.push({ season: league.season + 1, round, originalTeamId: t.id, ownerTeamId: t.id });
    league.objectives = defaultObjectives(league);
    league.devBaseline = {};
    for (const id of ut.rosterIds) league.devBaseline[id] = stars(league.players[id]);
    league.staffPool = staffCandidates(league, rng);
    refreshMarket(league, rng);
    addNews(league, `Season ${league.season} tips off. Payroll $${payroll(league, ut).toFixed(1)}M.`, 'info');
  });
}

/** Run every remaining automatic off-season step up to the next user decision. */
export function advanceOffseason(league: LeagueSave) {
  withRng(league, (rng) => {
    for (let guard = 0; guard < 10; guard++) {
      const step = league.offseasonStep;
      if (step === 'awards') runAwards(league);
      else if (step === 'retirements') runRetirements(league, rng);
      else if (step === 'progression') runProgression(league, rng);
      else return; // 'resign', 'lottery', 'draft', 'freeAgency' wait for the user
    }
  });
}
