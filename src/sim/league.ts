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
  type Team,
} from '../core/types';
import { FIRST_NAMES, LAST_NAMES, LEAGUE_NAME, TEAM_SEEDS } from './data';
import { DEFAULT_CAP, payroll } from './economy';
import { generatePlayer, stars } from './players';

export const SAVE_VERSION = 3;
export const ROSTER_MIN = 12;
export const ROSTER_MAX = 15;

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

const ROSTER_TEMPLATE: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF'];

/** Star targets for a 13-man roster: two core players, three solid starters, a bench. */
function rosterTargets(rng: Rng, quality: number): number[] {
  const t = [4 + rng.range(-0.5, 0.75), 3.5 + rng.range(-0.5, 0.5), 3 + rng.range(-0.5, 0.5), 2.75 + rng.range(-0.5, 0.5), 2.5 + rng.range(-0.5, 0.5)];
  const bench = [2.25, 2, 2, 1.75, 1.5, 1.5, 1, 1];
  return [...t, ...bench.map((b) => b + rng.range(-0.25, 0.25))].map((x) => Math.max(0.5, Math.min(5, x + quality)));
}

function makeStaff(league: LeagueSave, rng: Rng, role: StaffMember['role'], rating: number): StaffMember {
  const perks: Record<StaffMember['role'], string[]> = {
    offense: ['Spacing guru', 'Pick-and-roll architect', 'Shooting coach', 'Transition specialist'],
    defense: ['Rim-protection schemes', 'Perimeter lockdown', 'Rebounding drills', 'Switch-everything'],
    scouting: ['International network', 'College circuit', 'Analytics department', 'Old-school eye test'],
  };
  return {
    id: newId(league, 's'),
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    role,
    rating,
    salaryCredits: rating * 2,
    perk: rng.pick(perks[role]),
  };
}

export function staffCandidates(league: LeagueSave, rng: Rng): StaffMember[] {
  const out: StaffMember[] = [];
  for (const role of ['offense', 'defense', 'scouting'] as const) {
    for (let i = 0; i < 3; i++) out.push(makeStaff(league, rng, role, rng.int(1, 5)));
  }
  return out;
}

export function sortRotation(league: LeagueSave, team: Team) {
  const players = team.rosterIds.map((id) => league.players[id]).filter(Boolean);
  const healthy = players.filter((p) => !p.injury);
  const starters: string[] = [];
  for (const pos of POSITIONS) {
    const best = healthy
      .filter((p) => !starters.includes(p.id) && (p.position === pos || p.secondaryPosition === pos))
      .sort((a, b) => stars(b) - stars(a) + (b.position === pos ? 0.3 : 0) - (a.position === pos ? 0.3 : 0))[0];
    if (best) starters.push(best.id);
  }
  for (const p of healthy.sort((a, b) => stars(b) - stars(a))) if (starters.length < 5 && !starters.includes(p.id)) starters.push(p.id);
  team.starters = starters;
  team.rotation = players
    .filter((p) => !starters.includes(p.id))
    .sort((a, b) => (a.injury ? 1 : 0) - (b.injury ? 1 : 0) || stars(b) - stars(a))
    .map((p) => p.id);
}

/** Keep the user's chosen starters where possible, only replacing injured or departed players. */
export function repairRotation(league: LeagueSave, team: Team) {
  const ok = (id: string) => team.rosterIds.includes(id) && !league.players[id]?.injury;
  const starters = team.starters.filter(ok);
  const rest = [...team.rotation, ...team.rosterIds].filter((id, i, arr) => arr.indexOf(id) === i && !starters.includes(id) && team.rosterIds.includes(id));
  while (starters.length < 5) {
    const next = rest.find((id) => ok(id) && !starters.includes(id));
    if (!next) break;
    starters.push(next);
  }
  team.starters = starters;
  team.rotation = rest.filter((id) => !starters.includes(id)).sort((a, b) => (league.players[a].injury ? 1 : 0) - (league.players[b].injury ? 1 : 0));
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
    { id: 'wins', kind: 'wins', label: `Win ${Math.ceil(g * 0.5)} games`, target: Math.ceil(g * 0.5), reward: 15 },
    { id: 'playoffs', kind: 'playoffs', label: 'Make the playoffs', target: 1, reward: 20 },
    { id: 'develop', kind: 'develop', label: 'Raise a player 1/2 star', target: 1, reward: 10 },
    { id: 'finance', kind: 'finance', label: 'Finish under the cap', target: 1, reward: 8 },
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
      credits: 25,
      capMillions: DEFAULT_CAP,
      facilities: { training: seed.budget === 'large' ? 2 : 1, medical: seed.budget === 'small' ? 1 : 2, arena: seed.budget === 'large' ? 2 : 1 },
      staff: { offense: 0, defense: 0, scouting: 0 },
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
    for (const role of ['offense', 'defense', 'scouting'] as const) {
      const m = makeStaff(league, rng, role, rng.int(1, 3) + (seed.budget === 'large' ? 1 : 0));
      team.staffMembers.push(m);
      team.staff[role] = m.rating;
    }
    const used = new Set<number>();
    const targets = rosterTargets(rng, quality);
    ROSTER_TEMPLATE.forEach((pos, i) => {
      const p = generatePlayer(rng, { id: newId(league, 'p'), position: pos, target: targets[i], usedNumbers: used, age: i < 2 ? rng.int(23, 31) : undefined });
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
    const p = generatePlayer(rng, { id: newId(league, 'p'), target: rng.range(0.5, 2.5) });
    p.contract = { salaryMillions: Math.max(1, Math.round(p.contract.salaryMillions * 0.8 * 10) / 10), yearsRemaining: 0 };
    league.players[p.id] = p;
    league.freeAgents.push(p.id);
  }
  league.draftPicks = initialPicks(league);
  league.schedule = buildSchedule(league.teams, league.settings.seasonGames, rng, league.season);
  league.objectives = defaultObjectives(league);
  league.staffPool = staffCandidates(league, rng);
  const user = league.teams.find((t) => t.id === opts.userTeamId)!;
  user.credits = 30;
  for (const id of user.rosterIds) league.devBaseline[id] = stars(league.players[id]);
  league.news.push({ day: 0, season: 1, kind: 'good', text: `${opts.coachName} named head coach of the ${user.city} ${user.name}.` });
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
