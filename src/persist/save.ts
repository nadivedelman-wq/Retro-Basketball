/**
 * Local-first persistence. Franchise saves live in IndexedDB (falling back to localStorage
 * when IndexedDB is unavailable), one record per slot. Every save carries a version and
 * passes through ordered migrations on load. Saves can be exported/imported as JSON.
 */
import type { LeagueSave } from '../core/types';
import { DEFAULT_BINDINGS, type KeyBindings } from '../game/input';
import { SAVE_VERSION } from '../sim/league';
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
};

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
      out.push({ slot, coach: l.coach.name, team: `${t.city} ${t.name}`, season: l.season, record: `${t.wins}-${t.losses}`, updatedAt: l.updatedAt });
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
