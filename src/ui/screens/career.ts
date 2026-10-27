import { teamBadge } from '../../art/logo';
import { sfx } from '../../audio/sfx';
import { hashString } from '../../core/rng';
import type { Difficulty, LeagueSettings } from '../../core/types';
import { SLOTS, deleteSlot, exportJson, importJson, listSlots, loadLeague, saveLeague, type SlotId, type SlotMeta } from '../../persist/save';
import { TEAM_SEEDS } from '../../sim/data';
import { DEFAULT_SETTINGS, createLeague } from '../../sim/league';
import { startAtSeasonFinale } from '../../sim/season';
import type { App } from '../app';
import { h } from '../dom';

export function seg<T extends string | number>(options: { value: T; label: string }[], current: T, onPick: (v: T) => void) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const draw = (cur: T) => {
    wrap.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            class: `btn ${o.value === cur ? 'on' : ''}`,
            role: 'radio',
            'aria-checked': String(o.value === cur),
            onclick: () => {
              sfx.select();
              onPick(o.value);
              draw(o.value);
            },
          },
          o.label,
        ),
      ),
    );
  };
  draw(current);
  return wrap;
}

export function leagueSettingsForm(s: LeagueSettings, onChange: () => void, lockStructure = false) {
  const field = (label: string, el: HTMLElement, note?: string) => h('label', { class: 'field' }, h('span', { class: 'muted' }, label), el, note ? h('span', { class: 'tiny dim' }, note) : null);
  return h(
    'div',
    { class: 'col' },
    lockStructure
      ? null
      : field('Season length', seg([{ value: 20, label: '20 games' }, { value: 41, label: '41' }, { value: 82, label: '82' }], s.seasonGames, (v) => ((s.seasonGames = v as 20 | 41 | 82), onChange()))),
    lockStructure ? null : field('Playoff teams', seg([{ value: 8, label: '8' }, { value: 16, label: '16' }], s.playoffTeams, (v) => ((s.playoffTeams = v as 8 | 16), onChange()))),
    lockStructure ? null : field('Series length', seg([1, 3, 5, 7].map((n) => ({ value: n, label: `Best of ${n}` })), s.seriesLength, (v) => ((s.seriesLength = v as 1 | 3 | 5 | 7), onChange()))),
    field(
      'Quarter length (real time)',
      seg([1, 2, 3, 5].map((n) => ({ value: n, label: `${n} min` })), s.quarterMinutes, (v) => ((s.quarterMinutes = v as 1 | 2 | 3 | 5), onChange())),
      'The 12:00 game clock runs faster to fit. Longer quarters mean more possessions and higher scores, league-wide.',
    ),
    field(
      'Difficulty',
      seg(
        (['rookie', 'pro', 'allstar', 'legend'] as Difficulty[]).map((d) => ({ value: d, label: d === 'allstar' ? 'All-Star' : d })),
        s.difficulty,
        (v) => ((s.difficulty = v), onChange()),
      ),
      'Changes CPU decisions, reactions and shot timing. Never adds points.',
    ),
    field('Auto substitutions in live games', seg([{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], s.autoSubs ? 'on' : 'off', (v) => ((s.autoSubs = v === 'on'), onChange()))),
  );
}

export function newCareerScreen(app: App) {
  const settings: LeagueSettings = { ...DEFAULT_SETTINGS };
  let teamId = TEAM_SEEDS[0].abbr.toLowerCase();
  let slot: SlotId = 'slot1';
  let slotInfo: SlotMeta[] = [];
  const nameInput = h('input', { type: 'text', value: 'Pixel', maxlength: 16, 'aria-label': 'Coach name' });
  const leagueInput = h('input', { type: 'text', value: settings.leagueName, maxlength: 28, 'aria-label': 'League name' });
  const teamGrid = h('div', { class: 'grid three', style: 'gap:8px' });
  const slotRow = h('div', { class: 'seg' });

  const drawTeams = () => {
    teamGrid.replaceChildren(
      ...TEAM_SEEDS.map((s) => {
        const id = s.abbr.toLowerCase();
        return h(
          'button',
          {
            class: `teamcard ${id === teamId ? 'sel' : ''}`,
            onclick: () => {
              sfx.select();
              teamId = id;
              drawTeams();
            },
          },
          h('img', { src: teamBadge({ id, abbr: s.abbr, colors: s.colors }, 48), alt: '' }),
          h(
            'div',
            null,
            h('div', null, s.city),
            s.name ? h('div', { class: 'gold' }, s.name) : null,
            h('div', { class: 'tiny muted' }, `${s.conference} • ${s.strength} • ${s.budget === 'large' ? 'Big market' : s.budget === 'small' ? 'Small market' : 'Mid market'}`),
          ),
        );
      }),
    );
  };
  const drawSlots = () => {
    slotRow.replaceChildren(
      ...SLOTS.map((sl, i) => {
        const info = slotInfo.find((x) => x.slot === sl);
        const used = info && !('empty' in info);
        return h(
          'button',
          {
            class: `btn ${sl === slot ? 'on' : ''}`,
            onclick: () => {
              slot = sl;
              drawSlots();
            },
          },
          `Slot ${i + 1}${used ? ' (used)' : ''}`,
        );
      }),
    );
  };
  drawTeams();
  drawSlots();
  void listSlots().then((s) => {
    slotInfo = s;
    const free = s.find((x) => 'empty' in x);
    if (free) slot = free.slot;
    drawSlots();
  });

  const start = async () => {
    const info = slotInfo.find((x) => x.slot === slot);
    if (info && !('empty' in info)) {
      const ok = await app.confirm('Overwrite save?', `Slot ${SLOTS.indexOf(slot) + 1} holds ${info.coach}'s ${info.team} career (season ${info.season}). Start over in that slot?`, 'Overwrite');
      if (!ok) return;
    }
    const coach = (nameInput.value || 'Coach').replace(/[^A-Za-z0-9 .'-]/g, '').slice(0, 16) || 'Coach';
    settings.leagueName = (leagueInput.value || DEFAULT_SETTINGS.leagueName).replace(/[^A-Za-z0-9 .'-]/g, '').slice(0, 28) || DEFAULT_SETTINGS.leagueName;
    const seed = hashString(coach + teamId + Date.now());
    app.league = createLeague({ seed, userTeamId: teamId, coachName: coach, settings, slot });
    startAtSeasonFinale(app.league);
    await app.save();
    sfx.fanfare();
    app.go('home');
  };

  return h(
    'div',
    { class: 'main', style: 'margin:0 auto' },
    h('div', { class: 'screen-title' }, h('button', { class: 'btn', onclick: () => app.go('title') }, '◀ Back'), h('h1', null, 'New Career')),
    h(
      'div',
      { class: 'grid two' },
      h('section', { class: 'panel' }, h('h2', null, 'Coach'), h('div', { class: 'col' }, h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Your name'), nameInput), h('label', { class: 'field' }, h('span', { class: 'muted' }, 'League name'), leagueInput), h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Save slot'), slotRow))),
      h('section', { class: 'panel' }, h('h2', null, 'League Settings'), leagueSettingsForm(settings, () => {})),
    ),
    h('section', { class: 'panel', style: 'margin-top:14px' }, h('h2', null, 'Choose your franchise'), teamGrid),
    h('div', { class: 'row', style: 'margin:16px 0 40px;justify-content:flex-end' }, h('button', { class: 'btn big primary', onclick: () => void start() }, 'Start Career ▶')),
  );
}

export function loadScreen(app: App) {
  const list = h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Reading saves...'));
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  let importSlot: SlotId = 'slot1';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const league = importJson(await f.text(), importSlot);
      await saveLeague(league);
      app.toast(`Imported into slot ${SLOTS.indexOf(importSlot) + 1}.`);
      app.refresh();
    } catch (e) {
      app.toast(`Import failed: ${(e as Error).message}`, true);
    }
    fileInput.value = '';
  });
  const draw = async () => {
    const slots = await listSlots();
    list.replaceChildren(
      ...slots.map((s, i) => {
        const empty = 'empty' in s;
        return h(
          'div',
          { class: 'panel dark row' },
          h('div', { class: 'x3 gold', style: 'width:40px' }, String(i + 1)),
          empty
            ? h('div', { class: 'muted spacer' }, 'Empty slot')
            : h('div', { class: 'spacer' }, h('div', null, `${s.coach} • ${s.team}`), h('div', { class: 'muted' }, `Season ${s.season} • ${s.record} • saved ${new Date(s.updatedAt).toLocaleString()}`)),
          empty
            ? null
            : h(
                'button',
                {
                  class: 'btn primary',
                  onclick: async () => {
                    try {
                      app.league = await loadLeague(s.slot);
                      app.go(app.league?.phase === 'offseason' ? 'offseason' : 'home');
                    } catch (e) {
                      app.toast(`Could not load: ${(e as Error).message}`, true);
                    }
                  },
                },
                'Load',
              ),
          empty
            ? null
            : h(
                'button',
                {
                  class: 'btn',
                  onclick: async () => {
                    const l = await loadLeague(s.slot);
                    if (!l) return;
                    const blob = new Blob([exportJson(l)], { type: 'application/json' });
                    const a = h('a', { href: URL.createObjectURL(blob), download: `retro-basketball-${l.coach.name.replace(/\s+/g, '_')}-S${l.season}.json` });
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  },
                },
                'Export',
              ),
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                importSlot = s.slot;
                fileInput.click();
              },
            },
            'Import',
          ),
          empty
            ? null
            : h(
                'button',
                {
                  class: 'btn danger',
                  onclick: async () => {
                    if (await app.confirm('Delete save?', `Delete ${s.coach}'s career in slot ${i + 1}? This cannot be undone.`, 'Delete')) {
                      await deleteSlot(s.slot);
                      void draw();
                    }
                  },
                },
                'Delete',
              ),
        );
      }),
    );
  };
  void draw();
  return h('div', { class: 'main', style: 'margin:0 auto;max-width:980px' }, h('div', { class: 'screen-title' }, h('button', { class: 'btn', onclick: () => app.go('title') }, '◀ Back'), h('h1', null, 'Load Career')), list, fileInput);
}
