import { sfx } from '../audio/sfx';
import type { LeagueSave } from '../core/types';
import { loadAppSettings, saveAppSettings, saveLeague, type AppSettings } from '../persist/save';
import { transact, type TxResult } from '../sim/transactions';
import { clear, h } from './dom';

export type Screen =
  | 'title'
  | 'newCareer'
  | 'load'
  | 'settings'
  | 'home'
  | 'roster'
  | 'lineup'
  | 'cap'
  | 'office'
  | 'league'
  | 'history'
  | 'pregame'
  | 'game'
  | 'postgame'
  | 'offseason'
  | 'quick';

export type ScreenFn = (app: App, params: Record<string, unknown>) => HTMLElement;

export class App {
  readonly root: HTMLElement;
  league: LeagueSave | null = null;
  settings: AppSettings;
  screen: Screen = 'title';
  params: Record<string, unknown> = {};
  private screens: Partial<Record<Screen, ScreenFn>> = {};
  private cleanup: (() => void) | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadAppSettings();
    sfx.setMuted(this.settings.muted);
    sfx.sfxVolume = this.settings.sfxVolume;
  }

  register(name: Screen, fn: ScreenFn) {
    this.screens[name] = fn;
  }

  /** Screens that mount long-lived things (the Phaser game) register a cleanup. */
  onLeave(fn: () => void) {
    this.cleanup = fn;
  }

  go(screen: Screen, params: Record<string, unknown> = {}) {
    this.cleanup?.();
    this.cleanup = null;
    this.screen = screen;
    this.params = params;
    this.render();
    window.scrollTo(0, 0);
    const inFranchise = !['title', 'newCareer', 'load', 'game', 'quick'].includes(screen);
    if (this.settings.music && (screen === 'title' || screen === 'newCareer' || screen === 'load')) sfx.startMusic();
    else if (inFranchise || screen === 'game') sfx.stopMusic();
  }

  render() {
    const fn = this.screens[this.screen];
    if (!fn) throw new Error(`No screen ${this.screen}`);
    const keepScroll = window.scrollY;
    clear(this.root);
    this.applyTeamTheme();
    this.root.appendChild(fn(this, this.params));
    if (this.params.keepScroll) window.scrollTo(0, keepScroll);
  }

  /** Re-render the current screen without losing the scroll position. */
  refresh() {
    this.params = { ...this.params, keepScroll: true };
    this.render();
  }

  applyTeamTheme() {
    const l = this.league;
    const root = document.documentElement;
    if (!l) {
      root.style.setProperty('--team', '#c8102e');
      root.style.setProperty('--team2', '#f2f2f2');
      return;
    }
    const t = l.teams.find((x) => x.id === l.userTeamId)!;
    root.style.setProperty('--team', t.colors[0]);
    root.style.setProperty('--team2', t.colors[1]);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.colors[0].slice(i, i + 2), 16));
    root.style.setProperty('--team-ink', (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#140f1c' : '#ffffff');
  }

  async save() {
    if (!this.league) return;
    try {
      await saveLeague(this.league);
      this.settings.lastSlot = this.league.slot;
      saveAppSettings(this.settings);
    } catch (e) {
      this.toast(`Could not save: ${(e as Error).message}`, true);
    }
  }

  saveSettings() {
    saveAppSettings(this.settings);
    sfx.setMuted(this.settings.muted);
    sfx.sfxVolume = this.settings.sfxVolume;
  }

  /** Apply a transaction result: commit + save on success, explain on failure. */
  commit(r: TxResult, okMessage?: string): boolean {
    if (!r.ok) {
      sfx.error();
      this.toast(r.error, true);
      return false;
    }
    this.league = r.league;
    void this.save();
    sfx.confirm();
    const msg = okMessage ?? r.message;
    if (msg) this.toast(msg);
    this.refresh();
    return true;
  }

  /** Run a league mutation atomically (deep copy, validate, commit). */
  mutate(fn: (draft: LeagueSave) => string | void, opts: { render?: boolean } = {}): boolean {
    if (!this.league) return false;
    const r = transact(this.league, fn);
    if (!r.ok) {
      sfx.error();
      this.toast(r.error, true);
      return false;
    }
    this.league = r.league;
    void this.save();
    if (r.message) this.toast(r.message);
    if (opts.render !== false) this.refresh();
    return true;
  }

  toast(text: string, err = false) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = h('div', { class: `toast${err ? ' err' : ''}`, role: 'status' }, text);
    document.body.appendChild(el);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), err ? 4800 : 2600);
  }

  modal(title: string, body: HTMLElement | HTMLElement[], opts: { wide?: boolean; actions?: HTMLElement[]; onClose?: () => void } = {}): () => void {
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      opts.onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const back = h(
      'div',
      {
        class: 'modal-back',
        onclick: (e: Event) => {
          if (e.target === back) close();
        },
      },
      h(
        'div',
        { class: `panel modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', null, h('span', null, title), h('button', { class: 'btn small', onclick: close, 'aria-label': 'Close' }, 'X')),
        body,
        opts.actions ? h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, opts.actions) : null,
      ),
    );
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    (back.querySelector('.btn:not([aria-label="Close"])') as HTMLElement | null)?.focus();
    return close;
  }

  confirm(title: string, text: string, okLabel = 'Confirm'): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        close();
        resolve(v);
      };
      const close = this.modal(title, h('p', null, text), {
        actions: [h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => finish(true) }, okLabel)],
        onClose: () => finish(false),
      });
    });
  }
}
