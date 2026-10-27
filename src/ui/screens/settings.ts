import { sfx } from '../../audio/sfx';
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, type ControlAction } from '../../game/input';
import { exportJson } from '../../persist/save';
import type { App } from '../app';
import { h } from '../dom';
import { screenTitle, shell } from '../widgets';
import { leagueSettingsForm, seg } from './career';

export function settingsScreen(app: App) {
  const s = app.settings;
  const save = () => app.saveSettings();
  const bindRows = h('div', { class: 'col', style: 'gap:6px' });
  let listening: ControlAction | null = null;
  const drawBinds = () => {
    bindRows.replaceChildren(
      ...(Object.keys(ACTION_LABELS) as ControlAction[]).map((a) =>
        h(
          'div',
          { class: 'row', style: 'gap:6px' },
          h('span', { style: 'flex:1;min-width:200px' }, ACTION_LABELS[a]),
          s.bindings[a].map((c) => h('span', { class: 'key' }, keyLabel(c))),
          h(
            'button',
            {
              class: `btn small ${listening === a ? 'primary' : ''}`,
              onclick: () => {
                listening = a;
                drawBinds();
              },
            },
            listening === a ? 'Press a key...' : 'Rebind',
          ),
        ),
      ),
    );
  };
  const onKey = (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    if (e.code === 'Escape' && listening !== 'pause') {
      listening = null;
      drawBinds();
      return;
    }
    // A key belongs to one action only.
    for (const k of Object.keys(s.bindings) as ControlAction[]) s.bindings[k] = s.bindings[k].filter((c) => c !== e.code);
    const keepArrow = s.bindings[listening].filter((c) => c.startsWith('Arrow'));
    s.bindings[listening] = [e.code, ...keepArrow].slice(0, 2);
    listening = null;
    save();
    drawBinds();
  };
  window.addEventListener('keydown', onKey);
  app.onLeave(() => window.removeEventListener('keydown', onKey));
  drawBinds();

  const general = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Sound & Display'),
    h(
      'div',
      { class: 'col' },
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Sound'), seg([{ value: 'on', label: 'On' }, { value: 'off', label: 'Muted' }], s.muted ? 'off' : 'on', (v) => { s.muted = v === 'off'; save(); })),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Menu music'), seg([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.music ? 'on' : 'off', (v) => { s.music = v === 'on'; save(); if (!s.music) sfx.stopMusic(); })),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'muted' }, `Effects volume`),
        h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: String(s.sfxVolume), oninput: (e: Event) => { s.sfxVolume = Number((e.target as HTMLInputElement).value); save(); sfx.swish(); } }),
      ),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Touch controls'), seg([{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Always' }, { value: 'off', label: 'Never' }], s.touchControls, (v) => { s.touchControls = v as 'auto' | 'on' | 'off'; save(); })),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Screen shake on dunks'), seg([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.reduceShake ? 'off' : 'on', (v) => { s.reduceShake = v === 'off'; save(); })),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'On-screen control hints'), seg([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.showHints ? 'on' : 'off', (v) => { s.showHints = v === 'on'; save(); })),
    ),
  );
  const controls = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Keyboard', h('button', { class: 'btn small', onclick: () => { s.bindings = structuredClone(DEFAULT_BINDINGS); save(); drawBinds(); } }, 'Reset')),
    bindRows,
    h('div', { class: 'tiny muted', style: 'margin-top:8px' }, 'Gamepads work too: left stick moves, A shoot, B pass, X steal, Y screen, RB/RT sprint.'),
  );

  const parts: HTMLElement[] = [h('div', { class: 'grid two' }, general, controls)];
  if (app.league) {
    const l = app.league;
    const ls = { ...l.settings };
    parts.push(
      h(
        'section',
        { class: 'panel', style: 'margin-top:14px' },
        h('h2', null, 'Career settings'),
        leagueSettingsForm(ls, () => app.mutate((d) => { d.settings.difficulty = ls.difficulty; d.settings.quarterMinutes = ls.quarterMinutes; d.settings.autoSubs = ls.autoSubs; }, { render: false }), true),
        h(
          'div',
          { class: 'row', style: 'margin-top:12px' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                const blob = new Blob([exportJson(app.league!)], { type: 'application/json' });
                const a = h('a', { href: URL.createObjectURL(blob), download: `retro-basketball-S${l.season}.json` });
                document.body.appendChild(a);
                a.click();
                a.remove();
              },
            },
            'Export save (JSON)',
          ),
          h('span', { class: 'tiny muted' }, 'Import from Load Career on the title screen.'),
        ),
      ),
    );
    return shell(app, 'settings', screenTitle('Settings'), ...parts);
  }
  return h('div', { class: 'main', style: 'margin:0 auto' }, h('div', { class: 'screen-title' }, h('button', { class: 'btn', onclick: () => app.go('title') }, '◀ Back'), h('h1', null, 'Settings')), ...parts);
}
