/** Shared data models. Field names follow the build spec's minimum models, extended where systems need more. */

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export type Archetype =
  | 'Playmaker'
  | 'Sharpshooter'
  | 'Slasher'
  | '3-and-D'
  | 'Rim Protector'
  | 'Stretch Big'
  | 'Post Scorer'
  | 'All-Rounder';

export type RatingKey =
  | 'shooting'
  | 'finishing'
  | 'passing'
  | 'dribbling'
  | 'defense'
  | 'rebounding'
  | 'athleticism'
  | 'stamina';
export const RATING_KEYS: RatingKey[] = [
  'shooting',
  'finishing',
  'passing',
  'dribbling',
  'defense',
  'rebounding',
  'athleticism',
  'stamina',
];
export type Ratings = Record<RatingKey, number>;

export type Personality = 'Leader' | 'Competitor' | 'Easygoing' | 'Mercenary' | 'Hothead' | 'Quiet';

export type PlayerStats = {
  games: number;
  starts: number;
  minutes: number;
  points: number;
  rebounds: number;
  offRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
};

export type Appearance = {
  skin: number; // index into SKIN_TONES
  hair: number; // index into HAIR_STYLES
  hairColor: number;
  build: number; // 0 slim, 1 regular, 2 heavy
  accessory?: 'headband' | 'wristbands' | 'goggles' | 'armsleeve' | 'none';
  beard?: boolean;
};

export type Contract = { salaryMillions: number; yearsRemaining: number };

export type Injury = { type: string; gamesRemaining: number };

export type CareerSeason = {
  season: number;
  teamId: string;
  stats: PlayerStats;
};

export type Player = {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  position: Position;
  secondaryPosition?: Position;
  archetype: Archetype;
  heightCm: number;
  weightKg: number;
  hand: 'L' | 'R';
  jerseyNumber: number;
  appearance: Appearance;
  personality: Personality;
  ratings: Ratings;
  /** Hidden true potential star rating 0.5-5. Revealed through scouting. */
  potential: number;
  /** Scouted potential estimate shown to the user (null = unknown). */
  scoutedPotential: number | null;
  scoutLevel: number;
  xp: number;
  morale: number;
  condition: number;
  traits: string[];
  contract: Contract;
  injury?: Injury;
  seasonStats: PlayerStats;
  careerStats: PlayerStats;
  history: CareerSeason[];
  draft?: { season: number; round: number; pick: number; teamId: string };
  retired?: boolean;
  /** Streak value -1..1 updated during games (hot/cold). */
  form: number;
  awards: string[];
  rookieSeason?: number;
  /** Asking contract while the player is negotiating (expiring or free agent). */
  demand?: Contract;
  /** Last few games of involvement, newest last (drives morale). */
  recent?: GameInvolvement[];
  /** Plain-language reason for the latest morale change. */
  moraleNote?: string;
  /** Temporary 0.5-star fill-in: no contract, no cap hit, never saved on a roster. */
  replacement?: boolean;
};

export type GameInvolvement = { minutes: number; touches: number; shots: number; started: boolean; dressed: boolean };

/** Upgrade levels 0-3 for each track (see sim/config UPGRADES). */
export type Facilities = { training: number; recovery: number; fans: number };

export type CoachRole = 'offense' | 'defense' | 'development';

export type StaffMember = {
  id: string;
  name: string;
  role: CoachRole;
  /** 1 Basic, 2 Strong, 3 Elite. */
  tier: number;
  perk: string;
};

export type Tactics = {
  pace: number; // 1-5
  threeRate: number;
  pickAndRoll: number;
  postUps: number;
  defAggression: number;
  rebounding: number;
};

export type DraftPick = {
  season: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerTeamId: string;
};

export type Team = {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: [string, string];
  conference: 'East' | 'West';
  division: string;
  rosterIds: string[];
  /** Five starter slots; '' marks an empty slot that a 0.5-star replacement fills on game day. */
  starters: string[];
  /** Up to two bench players who dress for games. Anyone else on the roster sits. */
  rotation: string[];
  /** Planned minutes per player id (0-48). Missing = auto. */
  minutesPlan: Record<string, number>;
  wins: number;
  losses: number;
  /** Coach Coins (CC): earned from games, spent on upgrades, coaches and market signings. */
  credits: number;
  capMillions: number;
  facilities: Facilities;
  /** Coach tier per role (0 = none). */
  staff: Record<CoachRole, number>;
  staffMembers: StaffMember[];
  tactics: Tactics;
  strength: string;
  budget: 'small' | 'mid' | 'large';
  rivals: string[];
  fanSupport: number; // 0-100
  chemistry: number; // 0-100
  deadCap: { amount: number; season: number }[];
  pointsFor: number;
  pointsAgainst: number;
  confWins: number;
  confLosses: number;
  streak: number; // positive = win streak
  homeWins: number;
  homeLosses: number;
  banners: number[];
};

export type BoxLine = {
  playerId: string;
  name: string;
  starter: boolean;
  seconds: number;
  points: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
  offRebounds: number;
  defRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  plusMinus: number;
  /** Times the player got the ball (catches, rebounds, steals). */
  touches?: number;
};

export type BoxScore = {
  gameId: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  quarterScores: [number, number][];
  overtimes: number;
  home: BoxLine[];
  away: BoxLine[];
  injuries: { playerId: string; injury: Injury }[];
  played: boolean; // true if user played live
};

export type ScheduledGame = {
  id: string;
  day: number;
  homeId: string;
  awayId: string;
  played: boolean;
  homeScore?: number;
  awayScore?: number;
  playoff?: { round: number; seriesId: string; gameNumber: number };
};

export type PlayoffSeries = {
  id: string;
  round: number;
  conference: 'East' | 'West' | 'Finals';
  highSeedId: string;
  lowSeedId: string;
  highSeed: number;
  lowSeed: number;
  highWins: number;
  lowWins: number;
  winnerId?: string;
};

export type NewsItem = { day: number; season: number; text: string; kind: 'info' | 'good' | 'bad' | 'event' };

export type PendingEvent = {
  id: string;
  templateId: string;
  title: string;
  text: string;
  playerId?: string;
  options: { label: string; effect: string }[];
};

export type SeasonAwards = {
  season: number;
  champion?: string;
  runnerUp?: string;
  mvp?: string;
  roy?: string;
  dpoy?: string;
  scoringLeader?: string;
  finalsMvp?: string;
  userRecord?: string;
};

export type RecordEntry = { label: string; value: number; playerId?: string; name: string; season: number; teamId: string };

export type LeagueSettings = {
  leagueName: string;
  seasonGames: 20 | 41 | 82;
  playoffTeams: 8 | 16;
  seriesLength: 1 | 3 | 5 | 7;
  quarterMinutes: 1 | 2 | 3 | 5;
  difficulty: Difficulty;
  autoSubs: boolean;
};

export type Difficulty = 'rookie' | 'pro' | 'allstar' | 'legend';

export type SeasonPhase = 'regular' | 'playoffs' | 'offseason' ;

export type OffseasonStep =
  | 'awards'
  | 'retirements'
  | 'progression'
  | 'resign'
  | 'lottery'
  | 'draft'
  | 'freeAgency'
  | 'done';

export type DraftState = {
  order: { pick: number; round: 1 | 2; teamId: string; originalTeamId: string }[];
  prospectIds: string[];
  current: number;
  log: { pick: number; round: number; teamId: string; playerId: string }[];
  lottery: { teamId: string; seed: number; pick: number }[];
};

export type LeagueSave = {
  version: number;
  slot: string;
  seed: number;
  rngState: number;
  createdAt: number;
  updatedAt: number;
  season: number;
  day: number;
  phase: SeasonPhase;
  offseasonStep?: OffseasonStep;
  coach: { name: string; reputation: number; confidence: number; wins: number; losses: number; titles: number; seasons: number };
  userTeamId: string;
  teams: Team[];
  players: Record<string, Player>;
  freeAgents: string[];
  schedule: ScheduledGame[];
  boxScores: Record<string, BoxScore>;
  playoffs: PlayoffSeries[];
  draftPicks: DraftPick[];
  draft?: DraftState;
  history: SeasonAwards[];
  records: { singleGame: RecordEntry[]; season: RecordEntry[] };
  news: NewsItem[];
  pendingEvent?: PendingEvent;
  objectives: Objective[];
  settings: LeagueSettings;
  nextId: number;
  appliedGames: string[];
  /** Star ratings at the start of the season, for the development objective. */
  devBaseline: Record<string, number>;
  /** Staff candidates available to hire this season. */
  staffPool: StaffMember[];
  /** Player market: 4-5 star players unlocked with Coach Coins. */
  market: { offers: { playerId: string; coinPrice: number }[]; gamesUntilRefresh: number };
  /** One-time milestone bonuses already paid. */
  achievements: string[];
  /** Coins from the last applied user game, for the postgame reward animation. */
  lastReward?: { gameId: string; coins: number; reasons: string[] };
};

export type Objective = {
  id: string;
  kind: 'wins' | 'playoffs' | 'develop' | 'finance';
  label: string;
  target: number;
  reward: number;
  done?: boolean;
};

export const emptyStats = (): PlayerStats => ({
  games: 0,
  starts: 0,
  minutes: 0,
  points: 0,
  rebounds: 0,
  offRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
  fgm: 0,
  fga: 0,
  threePm: 0,
  threePa: 0,
  ftm: 0,
  fta: 0,
});
