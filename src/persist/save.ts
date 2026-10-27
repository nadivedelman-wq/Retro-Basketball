/**
 * Local-first persistence. Franchise saves live in IndexedDB (falling back to localStorage
 * when IndexedDB is unavailable), one record per slot. Every save carries a version and
 * passes through ordered migrations on load. Saves can be exported/imported as JSON.
 */
import { teamName } from '../sim/data';
import type { LeagueSave } from '../core/types';
import { DEFAULT_BINDINGS, type KeyBindings } from '../game/input';
import { Rng } from '../core/rng';
import type { StaffMember } from '../core/types';
import { ROSTER } from '../sim/config';
import { SAVE_VERSION, repairRotation, sortRotation, staffCandidates } from '../sim/league';
import { refreshMarket } from '../sim/market';
import { marketSalary, stars } from '../sim/players';
import { validateLeague } from '../sim/transactions';

export const SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOTS)[number];

const DB_NAME = 'pixel-hardwood';
const STORE = 'saves';
const LS_PREFIX = 'pixel-hardwood:save:';

export type SlotMeta = { slot: SlotId; coach: string; team: string; season: number; record: string; updatedAt: number } | { slot: SlotId; empty: true };

type Migration = (s: Record<string, unknown>) => void;

/** migrations[n] upgrades a save from version n to n + 1. */
const migrations: Record<number, Migration> = {
  1: (s) => {
    if (!s.records) s.records = { singleGame: [], season: [] };
    if (!s.objectives) s.objectives = [];
  },
  2: (s) => {
    if (!s.devBaseline) s.devBaseline = {};
    if (!s.staffPool) s.staffPool = [];
  },
  3: (raw) => migrateToSevenManRosters(raw as unknown as LeagueSave),
};

/**
 * v3 -> v4: 7-man rosters, star-band salaries, Coach Coins, 3-level upgrades, coach tiers and the
 * player market. Nothing is deleted: players beyond the seven best on each team become free agents,
 * contracts are re-priced to the new salary bands, and the change is explained in the news feed.
 */
function migrateToSevenManRosters(l: LeagueSave) {
  const rng = new Rng((l.seed ^ 0x5eed) >>> 0);
  type OldTeam = { facilities: Record<string, number>; staffMembers: { role: string; rating?: number; tier?: number }[] };
  for (const t of l.teams) {
    const old = t as unknown as OldTeam;
    const f = old.facilities ?? {};
    const lvl = (v: number | undefined) => Math.max(0, Math.min(3, (v ?? 1) - 1));
    t.facilities = { training: lvl(f.training), recovery: lvl(f.medical ?? f.recovery), fans: lvl(f.arena ?? f.fans) };
    t.staffMembers = (old.staffMembers ?? []).map((m) => ({
      ...(m as unknown as StaffMember),
      role: (m.role === 'scouting' ? 'development' : m.role) as StaffMember['role'],
      tier: m.tier ?? Math.max(1, Math.min(3, Math.ceil((m.rating ?? 2) / 2))),
    }));
    t.staff = { offense: 0, defense: 0, development: 0 };
    for (const m of t.staffMembers) t.staff[m.role] = m.tier;
    const ranked = t.rosterIds.map((id) => l.players[id]).filter(Boolean).sort((a, b) => stars(b) - stars(a));
    const keep = ranked.slice(0, ROSTER.max).map((p) => p.id);
    for (const p of ranked.slice(ROSTER.max)) {
      p.contract = { salaryMillions: p.contract.salaryMillions, yearsRemaining: 0 };
      l.freeAgents.push(p.id);
    }
    t.rosterIds = keep;
    for (const id of keep) {
      const p = l.players[id];
      p.contract = { salaryMillions: marketSalary(p), yearsRemaining: Math.max(1, Math.min(4, p.contract.yearsRemaining || 1)) };
    }
    t.minutesPlan = {};
    if (t.id === l.userTeamId) {
      t.starters = Array.from({ length: ROSTER.active }, (_, i) => t.starters[i] ?? '');
      t.rotation = t.rotation.slice(0, ROSTER.bench);
      repairRotation(l, t);
    } else sortRotation(l, t);
  }
  l.staffPool = staffCandidates(l, rng);
  l.achievements = l.achievements ?? [];
  l.market = { offers: [], gamesUntilRefresh: 3 };
  refreshMarket(l, rng);
  l.news.unshift({
    day: l.day,
    season: l.season,
    kind: 'event',
    text: 'Save upgraded: rosters are now 7 players (extra players became free agents), contracts were re-priced to the new salary bands, credits are now Coach Coins, and the Player Market is open.',
  });
}

export function migrate(raw: unknown): LeagueSave {
  if (!raw || typeof raw !== 'object') throw new Error('Save file is not a league.');
  const s = raw as Record<string, unknown>;
  let v = typeof s.version === 'number' ? s.version : 1;
  if (v > SAVE_VERSION) throw new Error(`This save is from a newer version of the game (v${v}).`);
  for (const k of ['teams', 'players', 'schedule', 'userTeamId']) if (!(k in s)) throw new Error(`Save file is missing "${k}".`);
  while (v < SAVE_VERSION) {
    migrations[v]?.(s);
    v++;
  }
  s.version = SAVE_VERSION;
  const league = s as unknown as LeagueSave;
  validateLeague(league);
  return league;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idb<T>(mode: IDBTransactionMode, f: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) return reject(new Error('no idb'));
        const tx = db.transaction(STORE, mode);
        const req = f(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function saveLeague(league: LeagueSave): Promise<void> {
  const slot = league.slot;
  league.updatedAt = Date.now();
  const json = JSON.stringify(league);
  try {
    await idb('readwrite', (s) => s.put(json, slot));
  } catch {
    localStorage.setItem(LS_PREFIX + slot, json);
  }
}

export async function loadLeague(slot: string): Promise<LeagueSave | null> {
  let json: string | undefined | null;
  try {
    json = await idb<string>('readonly', (s) => s.get(slot) as IDBRequest<string>);
  } catch {
    json = undefined;
  }
  if (!json) json = localStorage.getItem(LS_PREFIX + slot);
  if (!json) return null;
  const league = migrate(JSON.parse(json));
  league.slot = slot;
  return league;
}

export async function deleteSlot(slot: string) {
  try {
    await idb('readwrite', (s) => s.delete(slot));
  } catch {
    /* fall through */
  }
  localStorage.removeItem(LS_PREFIX + slot);
}

export async function listSlots(): Promise<SlotMeta[]> {
  const out: SlotMeta[] = [];
  for (const slot of SLOTS) {
    try {
      const l = await loadLeague(slot);
      if (!l) {
        out.push({ slot, empty: true });
        continue;
      }
      const t = l.teams.find((x) => x.id === l.userTeamId)!;
      out.push({ slot, coach: l.coach.name, team: `${teamName(t)}`, season: l.season, record: `${t.wins}-${t.losses}`, updatedAt: l.updatedAt });
    } catch {
      out.push({ slot, empty: true });
    }
  }
  return out;
}

export function exportJson(league: LeagueSave): string {
  return JSON.stringify(league, null, 1);
}

export function importJson(text: string, slot: SlotId): LeagueSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const league = migrate(raw);
  league.slot = slot;
  return league;
}

// ---------------------------------------------------------------- app settings (per device)


export type AppSettings = {
  muted: boolean;
  music: boolean;
  sfxVolume: number;
  touchControls: 'auto' | 'on' | 'off';
  bindings: KeyBindings;
  showHints: boolean;
  reduceShake: boolean;
  lastSlot?: string;
};

const SETTINGS_KEY = 'pixel-hardwood:settings';

export function defaultAppSettings(): AppSettings {
  return { muted: false, music: true, sfxVolume: 0.8, touchControls: 'auto', bindings: structuredClone(DEFAULT_BINDINGS), showHints: true, reduceShake: false };
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultAppSettings();
    const s = { ...defaultAppSettings(), ...JSON.parse(raw) } as AppSettings;
    s.bindings = { ...structuredClone(DEFAULT_BINDINGS), ...s.bindings };
    return s;
  } catch {
    return defaultAppSettings();
  }
}

export function saveAppSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
