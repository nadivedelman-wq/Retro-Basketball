import { Rng } from '../core/rng';
import {
  POSITIONS,
  type DraftPick,
  type LeagueSave,
  type LeagueSettings,
  type Objective,
  type Player,
  type Position,
  type ScheduledGame,
  type StaffMember,
  type CoachRole,
  type Team,
} from '../core/types';
import { FIRST_NAMES, LAST_NAMES, LEAGUE_NAME, TEAM_SEEDS, teamName } from './data';
import { MARKET, ROSTER, STARTING_USER_STARS } from './config';
import { refreshMarket } from './market';
import { DEFAULT_CAP, payroll } from './economy';
import { generatePlayer, stars } from './players';

export const SAVE_VERSION = 4;
export const ROSTER_MIN = 0;
export const ROSTER_MAX = ROSTER.max;

export const DEFAULT_SETTINGS: LeagueSettings = {
  leagueName: LEAGUE_NAME,
  seasonGames: 20,
  playoffTeams: 8,
  seriesLength: 3,
  quarterMinutes: 3,
  difficulty: 'pro',
  autoSubs: true,
};

export function newId(league: Pick<LeagueSave, 'nextId'>, prefix: string) {
  return `${prefix}${league.nextId++}`;
}

const ROSTER_TEMPLATE: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'SG', 'PF'];

/** Star targets for a CPU team's seven players (rounded to half stars, capped at 4 at league start). */
function rosterTargets(rng: Rng, quality: number): number[] {
  const base = [3.5, 3, 2.5, 2, 2, 1.5, 1];
  return base.map((b) => Math.max(0.5, Math.min(4, Math.round((b + quality + rng.range(-0.5, 0.5)) * 2) / 2)));
}

const COACH_PERKS: Record<CoachRole, string[]> = {
  offense: ['Spacing guru', 'Pick-and-roll architect', 'Shooting coach', 'Transition specialist'],
  defense: ['Rim-protection schemes', 'Perimeter lockdown', 'Rebounding drills', 'Switch-everything'],
  development: ['Skills trainer', 'Film-room teacher', 'Strength coach', 'Youth whisperer'],
};

export function makeStaff(league: LeagueSave, rng: Rng, role: CoachRole, tier: number): StaffMember {
  return { id: newId(league, 's'), name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`, role, tier, perk: rng.pick(COACH_PERKS[role]) };
}

/** One Basic, one Strong and one Elite candidate for each coaching role. */
export function staffCandidates(league: LeagueSave, rng: Rng): StaffMember[] {
  const out: StaffMember[] = [];
  for (const role of ['offense', 'defense', 'development'] as const) {
    for (const tier of [1, 2, 3]) out.push(makeStaff(league, rng, role, tier));
  }
  return out;
}

/** A new franchise's roster: seven cheap players, nobody above 3 stars, a few with real upside. */
export function weakStartingRoster(league: LeagueSave, rng: Rng, team: Team) {
  const used = new Set<number>();
  const highPotential = new Set([rng.int(0, 2), rng.int(2, 4)]);
  STARTING_USER_STARS.forEach((target, i) => {
    const young = highPotential.has(i);
    const p = generatePlayer(rng, {
      id: newId(league, 'p'),
      position: ROSTER_TEMPLATE[i],
      target,
      exactStars: true,
      usedNumbers: used,
      age: young ? rng.int(19, 22) : rng.int(22, 31),
      potential: young ? Math.min(5, target + rng.int(4, 6) * 0.5) : Math.min(5, target + rng.int(0, 3) * 0.5),
    });
    p.contract = { salaryMillions: Math.min(9, p.contract.salaryMillions), yearsRemaining: rng.int(1, 3) };
    league.players[p.id] = p;
    team.rosterIds.push(p.id);
  });
  sortRotation(league, team);
}

/** Best healthy five by position (empty slots if fewer than five), then the next two as reserves. Used for CPU teams. */
export function sortRotation(league: LeagueSave, team: Team) {
  const healthy = team.rosterIds.map((id) => league.players[id]).filter((p) => p && !p.injury);
  const starters: string[] = [];
  for (const pos of POSITIONS) {
    const best = healthy
      .filter((p) => !starters.includes(p.id) && (p.position === pos || p.secondaryPosition === pos))
      .sort((a, b) => stars(b) - stars(a) + (b.position === pos ? 0.3 : 0) - (a.position === pos ? 0.3 : 0))[0];
    if (best) starters.push(best.id);
  }
  for (const p of healthy.slice().sort((a, b) => stars(b) - stars(a))) if (starters.length < ROSTER.active && !starters.includes(p.id)) starters.push(p.id);
  team.rotation = healthy
    .filter((p) => !starters.includes(p.id))
    .sort((a, b) => stars(b) - stars(a))
    .slice(0, ROSTER.bench)
    .map((p) => p.id);
  while (starters.length < ROSTER.active) starters.push('');
  team.starters = starters;
}

/**
 * Keep the user's lineup, dropping players who left or got hurt. A starter slot that loses its player
 * is handed to the first healthy reserve; slots the user left empty on purpose stay empty
 * (a 0.5-star replacement fills them on game day).
 */
export function repairRotation(league: LeagueSave, team: Team) {
  const ok = (id: string) => !!id && team.rosterIds.includes(id) && !league.players[id]?.injury;
  const starters = Array.from({ length: ROSTER.active }, (_, i) => team.starters[i] ?? '');
  let reserves = team.rotation.filter((id, i, a) => ok(id) && a.indexOf(id) === i && !starters.includes(id));
  for (let i = 0; i < starters.length; i++) {
    if (!starters[i] || ok(starters[i])) continue;
    starters[i] = reserves.shift() ?? '';
  }
  team.starters = starters;
  team.rotation = reserves.slice(0, ROSTER.bench);
}

/** Where a newly added player goes: an empty starter slot, then a reserve slot, otherwise he sits. */
export function placeNewPlayer(team: Team, playerId: string) {
  const slots = Array.from({ length: ROSTER.active }, (_, i) => team.starters[i] ?? '');
  const empty = slots.indexOf('');
  if (empty >= 0) slots[empty] = playerId;
  else if (team.rotation.length < ROSTER.bench) team.rotation = [...team.rotation, playerId];
  team.starters = slots;
}

export function buildSchedule(teams: Team[], games: number, rng: Rng, season: number): ScheduledGame[] {
  const ids = rng.shuffle(teams.map((t) => t.id));
  const n = ids.length;
  const rounds: [string, string][][] = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!);
  }
  const days: [string, string][][] = [];
  const homeCount = new Map<string, number>(ids.map((id) => [id, 0]));
  const met = new Map<string, number>();
  while (days.length < games) {
    const order = rng.shuffle(rounds.slice());
    for (const round of order) {
      if (days.length >= games) break;
      // Give home court to whichever side has had fewer home games (alternating in repeat meetings).
      days.push(
        round.map(([a, b]) => {
          const key = a < b ? a + b : b + a;
          const n = met.get(key) ?? 0;
          met.set(key, n + 1);
          const ha = homeCount.get(a)!;
          const hb = homeCount.get(b)!;
          const home = ha !== hb ? (ha < hb ? a : b) : n % 2 === 0 ? a : b;
          const away = home === a ? b : a;
          homeCount.set(home, homeCount.get(home)! + 1);
          return [home, away];
        }),
      );
    }
  }
  const out: ScheduledGame[] = [];
  days.forEach((round, day) => {
    round.forEach(([homeId, awayId], i) => out.push({ id: `g${season}_${day}_${i}`, day, homeId, awayId, played: false }));
  });
  return out;
}

export function defaultObjectives(league: LeagueSave): Objective[] {
  const g = league.settings.seasonGames;
  return [
    { id: 'wins', kind: 'wins', label: `Win ${Math.ceil(g * 0.5)} games`, target: Math.ceil(g * 0.5), reward: 3 },
    { id: 'playoffs', kind: 'playoffs', label: 'Make the playoffs', target: 1, reward: 3 },
    { id: 'develop', kind: 'develop', label: 'Raise a player 1/2 star', target: 1, reward: 2 },
    { id: 'finance', kind: 'finance', label: 'Finish under the cap', target: 1, reward: 2 },
  ];
}

export function createLeague(opts: { seed: number; userTeamId: string; coachName: string; settings: LeagueSettings; slot: string }): LeagueSave {
  const rng = new Rng(opts.seed);
  const league: LeagueSave = {
    version: SAVE_VERSION,
    slot: opts.slot,
    seed: opts.seed,
    rngState: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    season: 1,
    day: 0,
    phase: 'regular',
    coach: { name: opts.coachName, reputation: 50, confidence: 60, wins: 0, losses: 0, titles: 0, seasons: 0 },
    userTeamId: opts.userTeamId,
    teams: [],
    players: {},
    freeAgents: [],
    schedule: [],
    boxScores: {},
    playoffs: [],
    draftPicks: [],
    history: [],
    records: { singleGame: [], season: [] },
    news: [],
    objectives: [],
    settings: { ...opts.settings },
    nextId: 1,
    appliedGames: [],
    devBaseline: {},
    staffPool: [],
    market: { offers: [], gamesUntilRefresh: MARKET.refreshEveryGames },
    achievements: [],
  };

  for (const seed of TEAM_SEEDS) {
    const quality = seed.budget === 'large' ? 0.2 : seed.budget === 'small' ? -0.25 : 0;
    const team: Team = {
      id: seed.abbr.toLowerCase(),
      city: seed.city,
      name: seed.name,
      abbr: seed.abbr,
      colors: seed.colors,
      conference: seed.conference,
      division: seed.division,
      rosterIds: [],
      starters: [],
      rotation: [],
      minutesPlan: {},
      wins: 0,
      losses: 0,
      credits: 0,
      capMillions: DEFAULT_CAP,
      facilities: { training: seed.budget === 'large' ? 2 : 1, recovery: seed.budget === 'small' ? 0 : 1, fans: seed.budget === 'large' ? 2 : 1 },
      staff: { offense: 0, defense: 0, development: 0 },
      staffMembers: [],
      tactics: tacticsFor(seed.strength, rng),
      strength: seed.strength,
      budget: seed.budget,
      rivals: [],
      fanSupport: seed.budget === 'large' ? 65 : seed.budget === 'small' ? 45 : 55,
      chemistry: 60,
      deadCap: [],
      pointsFor: 0,
      pointsAgainst: 0,
      confWins: 0,
      confLosses: 0,
      streak: 0,
      homeWins: 0,
      homeLosses: 0,
      banners: [],
    };
    if (team.id === opts.userTeamId) {
      // The user's franchise starts from the bottom: no facilities, no coaches, a weak roster.
      team.facilities = { training: 0, recovery: 0, fans: 0 };
      team.fanSupport = 45;
      weakStartingRoster(league, rng, team);
      league.teams.push(team);
      continue;
    }
    for (const role of ['offense', 'defense', 'development'] as const) {
      const tier = rng.int(0, seed.budget === 'large' ? 2 : 1);
      if (!tier) continue;
      team.staffMembers.push(makeStaff(league, rng, role, tier));
      team.staff[role] = tier;
    }
    const used = new Set<number>();
    const targets = rosterTargets(rng, quality);
    ROSTER_TEMPLATE.forEach((pos, i) => {
      const p = generatePlayer(rng, { id: newId(league, 'p'), position: pos, target: targets[i], exactStars: true, usedNumbers: used, age: i < 2 ? rng.int(23, 31) : undefined });
      league.players[p.id] = p;
      team.rosterIds.push(p.id);
    });
    fitUnderCap(league, team);
    sortRotation(league, team);
    league.teams.push(team);
  }
  // Rivals: same division neighbours.
  for (const t of league.teams) {
    t.rivals = league.teams.filter((o) => o.division === t.division && o.id !== t.id).slice(0, 2).map((o) => o.id);
  }
  for (let i = 0; i < 30; i++) {
    const p = generatePlayer(rng, { id: newId(league, 'p'), target: Math.round(rng.range(0.5, 2.5) * 2) / 2, exactStars: true });
    p.contract = { salaryMillions: p.contract.salaryMillions, yearsRemaining: 0 };
    league.players[p.id] = p;
    league.freeAgents.push(p.id);
  }
  league.draftPicks = initialPicks(league);
  league.schedule = buildSchedule(league.teams, league.settings.seasonGames, rng, league.season);
  league.objectives = defaultObjectives(league);
  league.staffPool = staffCandidates(league, rng);
  refreshMarket(league, rng);
  const user = league.teams.find((t) => t.id === opts.userTeamId)!;
  user.credits = 10;
  for (const id of user.rosterIds) league.devBaseline[id] = stars(league.players[id]);
  league.news.push({ day: 0, season: 1, kind: 'good', text: `${opts.coachName} named head coach of the ${teamName(user)}.` });
  league.rngState = rng.state;
  return league;
}

export function initialPicks(league: LeagueSave): DraftPick[] {
  const picks: DraftPick[] = [];
  for (const s of [league.season, league.season + 1]) {
    for (const t of league.teams) {
      for (const round of [1, 2] as const) picks.push({ season: s, round, originalTeamId: t.id, ownerTeamId: t.id });
    }
  }
  return picks;
}

function tacticsFor(strength: string, rng: Rng) {
  const t = { pace: 3, threeRate: 3, pickAndRoll: 3, postUps: 3, defAggression: 3, rebounding: 3 };
  if (strength === 'Pace') t.pace = 5;
  if (strength === 'Shooting') t.threeRate = 5;
  if (strength === 'Guards') t.pickAndRoll = 4;
  if (strength === 'Size') t.postUps = 4;
  if (strength === 'Defense') t.defAggression = 4;
  if (strength === 'Rebounding') t.rebounding = 5;
  if (strength === 'Athletes') t.pace = 4;
  if (rng.chance(0.3)) t.threeRate = Math.min(5, t.threeRate + 1);
  return t;
}

/** Scale salaries down so a generated roster starts legal under the cap. */
export function fitUnderCap(league: LeagueSave, team: Team) {
  const pay = payroll(league, team);
  const limit = team.capMillions * 0.96;
  if (pay <= limit) return;
  const f = limit / pay;
  for (const id of team.rosterIds) {
    const p = league.players[id];
    p.contract.salaryMillions = Math.max(1, Math.floor(p.contract.salaryMillions * f * 10) / 10);
  }
}

export function teamById(league: LeagueSave, id: string): Team {
  const t = league.teams.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

export function userTeam(league: LeagueSave): Team {
  return teamById(league, league.userTeamId);
}

export function rosterPlayers(league: LeagueSave, team: Team): Player[] {
  return team.rosterIds.map((id) => league.players[id]).filter(Boolean);
}

export function teamRating(league: LeagueSave, team: Team): number {
  const ps = rosterPlayers(league, team)
    .filter((p) => !p.injury)
    .map((p) => stars(p))
    .sort((a, b) => b - a);
  const w = [1, 1, 1, 0.9, 0.9, 0.6, 0.5, 0.4, 0.3, 0.2];
  let s = 0;
  let ws = 0;
  ps.slice(0, 10).forEach((v, i) => {
    s += v * w[i];
    ws += w[i];
  });
  return ws ? s / ws : 0;
}

export type StandingRow = { team: Team; wins: number; losses: number; pct: number; gb: number; diff: number; confRank: number; streak: number };

/** Standings with tiebreakers: win %, head-to-head, point differential, then a seeded coin flip. */
export function standings(league: LeagueSave, conference?: 'East' | 'West'): StandingRow[] {
  const teams = league.teams.filter((t) => !conference || t.conference === conference);
  const h2h = (a: Team, b: Team) => {
    let aw = 0;
    let bw = 0;
    for (const g of league.schedule) {
      if (!g.played || g.playoff) continue;
      const pair = (g.homeId === a.id && g.awayId === b.id) || (g.homeId === b.id && g.awayId === a.id);
      if (!pair) continue;
      const homeWon = (g.homeScore ?? 0) > (g.awayScore ?? 0);
      const winner = homeWon ? g.homeId : g.awayId;
      if (winner === a.id) aw++;
      else bw++;
    }
    return aw - bw;
  };
  const pct = (t: Team) => (t.wins + t.losses ? t.wins / (t.wins + t.losses) : 0);
  const sorted = teams.slice().sort((a, b) => {
    const d = pct(b) - pct(a);
    if (Math.abs(d) > 1e-9) return d;
    const h = h2h(b, a);
    if (h) return h;
    const pd = b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst);
    if (pd) return pd;
    return (hashId(a.id + league.season) % 97) - (hashId(b.id + league.season) % 97);
  });
  const lead = sorted[0];
  return sorted.map((t, i) => ({
    team: t,
    wins: t.wins,
    losses: t.losses,
    pct: pct(t),
    gb: lead ? (lead.wins - t.wins + (t.losses - lead.losses)) / 2 : 0,
    diff: t.pointsFor - t.pointsAgainst,
    confRank: i + 1,
    streak: t.streak,
  }));
}

function hashId(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function addNews(league: LeagueSave, text: string, kind: 'info' | 'good' | 'bad' | 'event' = 'info') {
  league.news.unshift({ day: league.day, season: league.season, text, kind });
  if (league.news.length > 80) league.news.length = 80;
}
