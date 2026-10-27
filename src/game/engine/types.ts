import type { Appearance, Difficulty, Position, Ratings, Tactics } from '../../core/types';

export type MatchPlayerInfo = {
  id: string;
  name: string; // display (last name)
  fullName: string;
  number: number;
  position: Position;
  heightCm: number;
  ratings: Ratings;
  traits: string[];
  appearance: Appearance;
  /** Energy cap at tip-off, from franchise condition (0..1). */
  startEnergy: number;
  /** Hot/cold form carried in from previous games (-1..1). */
  form: number;
};

export type MatchTeamInfo = {
  id: string;
  abbr: string;
  name: string;
  colors: [string, string];
  players: MatchPlayerInfo[];
  starters: string[];
  rotation: string[];
  tactics: Tactics;
  /** Coaching quality 1-5 for offense/defense execution. */
  staff: { offense: number; defense: number };
};

export type MatchMode = 'game' | 'practice';

export type MatchConfig = {
  home: MatchTeamInfo;
  away: MatchTeamInfo;
  quarterMinutes: number;
  difficulty: Difficulty;
  /** 0 = user controls home, 1 = away, null = CPU vs CPU. */
  userSide: 0 | 1 | null;
  mode: MatchMode;
  seed: number;
  autoSubs: boolean;
};

export type InputState = {
  mx: number;
  mz: number;
  sprint: boolean;
  /** Level: shoot button currently held. */
  shoot: boolean;
  /** Edges: true only on the frame the button went down. */
  pass: boolean;
  switchPlayer: boolean;
  screen: boolean;
  action: boolean;
  timeout: boolean;
  /** Optional explicit pass target (mouse/touch tap on a teammate). */
  passTarget?: string;
};

export const emptyInput = (): InputState => ({
  mx: 0,
  mz: 0,
  sprint: false,
  shoot: false,
  pass: false,
  switchPlayer: false,
  screen: false,
  action: false,
  timeout: false,
});

export type EngineEvent =
  | { type: 'dribble' }
  | { type: 'pass' }
  | { type: 'catch' }
  | { type: 'shot'; three: boolean }
  | { type: 'swish' }
  | { type: 'rim' }
  | { type: 'backboard' }
  | { type: 'score'; side: 0 | 1; points: number; x: number; z: number; label: string }
  | { type: 'dunk'; x: number; z: number }
  | { type: 'block' }
  | { type: 'steal' }
  | { type: 'whistle' }
  | { type: 'buzzer' }
  | { type: 'crowd'; level: number }
  | { type: 'message'; text: string; sub?: string };
