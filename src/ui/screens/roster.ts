import { teamName } from '../../sim/data';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from '../../art/playerSprite';
import type { Appearance, LeagueSave, Player, PlayerStats } from '../../core/types';
import { releaseCost } from '../../sim/economy';
import { teamById, userTeam } from '../../sim/league';
import { ARCHETYPES, TRAITS, fullName, overall, stars } from '../../sim/players';
import { editPlayer, releasePlayer } from '../../sim/transactions';
import { shopPlayer } from '../../sim/trades';
import { showTradeOffer } from '../trade';
import type { App } from '../app';
import { fmtMoney, h, pct, perGame } from '../dom';
import { ROSTER } from '../../sim/config';
import { badge, capStrip, meter, moraleEl, playerStatus, portrait, ratingBars, roleOf, roleTag, screenTitle, shell, starsEl, teamOfPlayer } from '../widgets';

export const heightStr = (cm: number) => {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

function statLine(s: PlayerStats) {
  const g = s.games;
  return [String(g), perGame(s.minutes, g), perGame(s.points, g), perGame(s.rebounds, g), perGame(s.assists, g), perGame(s.steals, g), perGame(s.blocks, g), pct(s.fgm, s.fga), pct(s.threePm, s.threePa), pct(s.ftm, s.fta)];
}

const STAT_HEAD = ['G', 'Min', 'Pts', 'Reb', 'Ast', 'Stl', 'Blk', 'FG%', '3P%', 'FT%'];

export function openPlayer(app: App, playerId: string) {
  const l = app.league!;
  const p = l.players[playerId];
  if (!p) return;
  const team = teamOfPlayer(l, p.id);
  const mine = team?.id === l.userTeamId;
  const pot = p.scoutedPotential;
  const body = h(
    'div',
    { class: 'col' },
    h(
      'div',
      { class: 'row', style: 'gap:16px;align-items:flex-start' },
      portrait(l, p, 'portrait lg'),
      h(
        'div',
        { class: 'col', style: 'gap:2px;flex:1;min-width:220px' },
        h('div', { class: 'x3' }, `#${p.jerseyNumber} ${fullName(p)}`),
        h('div', { class: 'muted' }, `${p.position}${p.secondaryPosition ? '/' + p.secondaryPosition : ''} • ${p.archetype} • ${heightStr(p.heightCm)} • ${p.weightKg} kg • ${p.hand === 'L' ? 'Lefty' : 'Righty'} • Age ${p.age}`),
        h('div', null, 'Current ', starsEl(stars(p)), h('span', { class: 'muted' }, ` (${overall(p).toFixed(1)} ovr) `), ' Potential ', pot === null ? h('span', { class: 'muted' }, '?') : starsEl(pot)),
        h('div', { class: 'muted' }, team ? h('span', null, badge(team, 20), ` ${teamName(team)}`) : 'Free agent', ` • ${p.personality}`),
        h('div', null, `Contract ${fmtMoney(p.contract.salaryMillions)} • ${p.contract.yearsRemaining} yr${p.contract.yearsRemaining === 1 ? '' : 's'} left`, p.demand ? h('span', { class: 'warn' }, ` • asking ${fmtMoney(p.demand.salaryMillions)} x${p.demand.yearsRemaining}`) : null),
        p.injury ? h('div', { class: 'bad' }, `Injured: ${p.injury.type} (${p.injury.gamesRemaining} games)`) : null,
        p.draft ? h('div', { class: 'tiny muted' }, `Drafted S${p.draft.season} round ${p.draft.round} pick ${p.draft.pick} by ${teamById(l, p.draft.teamId).abbr}`) : null,
      ),
    ),
    h(
      'div',
      { class: 'grid two' },
      h('div', { class: 'col' }, h('h3', null, 'Ratings'), ratingBars(p), h('div', { class: 'tiny muted' }, ARCHETYPES[p.archetype].blurb)),
      h(
        'div',
        { class: 'col' },
        h('h3', null, 'Condition & Morale'),
        h('div', null, h('span', { class: 'muted' }, 'Morale'), moraleEl(p)),
        p.recent?.length
          ? h('div', { class: 'tiny muted' }, `Last ${p.recent.length} games: ${p.recent.map((r) => (r.dressed ? `${Math.round(r.minutes)}m/${r.touches}t` : 'DNP')).join(' \u2022 ')}`)
          : null,
        h('div', { class: 'row' }, h('span', { style: 'width:110px' }, 'Condition'), h('div', { class: 'spacer' }, meter(p.condition, 100, 'gold')), h('span', null, String(Math.round(p.condition)))),
        h('div', { class: 'row' }, h('span', { style: 'width:110px' }, 'Dev XP'), h('div', { class: 'spacer' }, meter(p.xp, 100, 'team')), h('span', null, `${Math.floor(p.xp)}/100`)),
        h('h3', { style: 'margin-top:8px' }, 'Traits'),
        p.traits.length ? p.traits.map((t) => h('div', null, h('span', { class: 'gold' }, t), h('span', { class: 'tiny muted' }, ` — ${TRAITS[t] ?? ''}`))) : h('div', { class: 'muted' }, 'None'),
        p.awards.length ? h('div', null, h('h3', { style: 'margin-top:8px' }, 'Awards'), h('div', { class: 'gold' }, p.awards.join(' • '))) : null,
      ),
    ),
    h('h3', null, 'Statistics'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 't' },
        h('thead', null, h('tr', null, h('th', null, 'Season'), h('th', null, 'Team'), STAT_HEAD.map((c) => h('th', { class: 'num' }, c)))),
        h(
          'tbody',
          null,
          p.history.map((hs) => h('tr', null, h('td', null, `S${hs.season}`), h('td', null, teamById(l, hs.teamId)?.abbr ?? ''), statLine(hs.stats).map((v) => h('td', { class: 'num' }, v)))),
          h('tr', null, h('td', { class: 'gold' }, `S${l.season}`), h('td', null, team?.abbr ?? 'FA'), statLine(p.seasonStats).map((v) => h('td', { class: 'num' }, v))),
          h('tr', null, h('td', { class: 'gold' }, 'Career'), h('td', null, ''), statLine(p.careerStats).map((v) => h('td', { class: 'num gold' }, v))),
        ),
      ),
    ),
  );
  const actions: HTMLElement[] = [];
  if (mine) {
    actions.push(
      h('button', { class: 'btn', onclick: () => { close(); editDialog(app, p); } }, 'Edit'),
      h(
        'button',
        {
          class: 'btn',
          title: 'See if a club will give a draft pick for him',
          onclick: () => {
            close();
            if (app.commit(shopPlayer(app.league!, p.id)) && app.league?.tradeOffer?.playerId === p.id) showTradeOffer(app);
          },
        },
        'Trade',
      ),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: async () => {
            close();
            if (await app.confirm('Release player?', `Release ${fullName(p)}? ${fmtMoney(releaseCost(p))} stays on this season's cap as dead money (50% of his salary); his other contract years are wiped.`, 'Release')) {
              app.commit(releasePlayer(app.league!, p.id));
            }
          },
        },
        'Release',
      ),
    );
  }
  const close = app.modal(fullName(p), body, { wide: true, actions });
}

function editDialog(app: App, p: Player) {
  const first = h('input', { type: 'text', value: p.firstName, maxlength: 14 });
  const last = h('input', { type: 'text', value: p.lastName, maxlength: 14 });
  const num = h('input', { type: 'number', value: String(p.jerseyNumber), min: 0, max: 99 });
  const ap: Appearance = { ...p.appearance };
  const preview = h('div');
  const drawPreview = () => {
    const l = app.league!;
    preview.replaceChildren(portrait(l, { ...p, appearance: ap, jerseyNumber: Number(num.value) || 0 }, 'portrait lg'));
  };
  const select = (label: string, options: string[], value: number, set: (v: number) => void) =>
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'muted' }, label),
      h(
        'select',
        { onchange: (e: Event) => { set(Number((e.target as HTMLSelectElement).value)); drawPreview(); } },
        options.map((o, i) => h('option', { value: String(i), selected: i === value }, o)),
      ),
    );
  drawPreview();
  num.addEventListener('input', drawPreview);
  const body = h(
    'div',
    { class: 'row', style: 'align-items:flex-start;gap:20px' },
    preview,
    h(
      'div',
      { class: 'col', style: 'flex:1' },
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'First name'), first),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Last name'), last),
      h('label', { class: 'field' }, h('span', { class: 'muted' }, 'Jersey number'), num),
      select('Skin tone', SKIN_TONES.map((_, i) => `Tone ${i + 1}`), ap.skin, (v) => (ap.skin = v)),
      select('Hair', HAIR_STYLES, ap.hair, (v) => (ap.hair = v)),
      select('Hair colour', HAIR_COLORS.map((_, i) => ['Black', 'Dark brown', 'Brown', 'Blond', 'Red', 'Grey'][i]), ap.hairColor, (v) => (ap.hairColor = v)),
      select('Build', ['Slim', 'Regular', 'Heavy'], ap.build, (v) => (ap.build = v)),
      select('Accessory', ['None', 'Headband', 'Wristbands', 'Goggles', 'Arm sleeve'], ['none', 'headband', 'wristbands', 'goggles', 'armsleeve'].indexOf(ap.accessory ?? 'none'), (v) => (ap.accessory = (['none', 'headband', 'wristbands', 'goggles', 'armsleeve'] as const)[v])),
      select('Beard', ['No', 'Yes'], ap.beard ? 1 : 0, (v) => (ap.beard = v === 1)),
    ),
  );
  const close = app.modal(`Edit ${fullName(p)}`, body, {
    actions: [
      h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            if (app.commit(editPlayer(app.league!, p.id, { firstName: first.value, lastName: last.value, jerseyNumber: Number(num.value), appearance: ap }))) close();
          },
        },
        'Save',
      ),
    ],
  });
}

export function rosterTable(app: App, l: LeagueSave, players: Player[], opts: { showTeam?: boolean } = {}) {
  const t = userTeam(l);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 't' },
      h(
        'thead',
        null,
        h('tr', null, ['#', 'Player', opts.showTeam ? 'Team' : null, 'Pos', 'Age', 'Ht', 'Now', 'Pot', 'Mor', 'Cond', 'Salary', 'Yrs', 'PPG', 'Status'].filter(Boolean).map((c) => h('th', { class: c === 'Salary' || c === 'PPG' ? 'num' : '' }, c!))),
      ),
      h(
        'tbody',
        null,
        players.map((p) =>
          h(
            'tr',
            { class: 'click', onclick: () => openPlayer(app, p.id), tabindex: 0, onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && openPlayer(app, p.id) },
            h('td', { class: 'muted' }, String(p.jerseyNumber)),
            h('td', null, h('span', { class: t.starters.includes(p.id) ? 'gold' : '' }, `${p.firstName[0]}. ${p.lastName}`), p.traits.length ? h('span', { class: 'tiny muted' }, `  ${p.traits.slice(0, 2).join(', ')}`) : null),
            opts.showTeam ? h('td', null, teamOfPlayer(l, p.id)?.abbr ?? 'FA') : null,
            h('td', null, p.position),
            h('td', null, String(p.age)),
            h('td', null, heightStr(p.heightCm)),
            h('td', null, starsEl(stars(p))),
            h('td', null, p.scoutedPotential === null ? h('span', { class: 'muted' }, '?') : starsEl(p.scoutedPotential)),
            h('td', { class: p.morale < 35 ? 'bad' : p.morale > 75 ? 'good' : '' }, String(Math.round(p.morale))),
            h('td', { class: p.condition < 60 ? 'warn' : '' }, String(Math.round(p.condition))),
            h('td', { class: 'num' }, fmtMoney(p.contract.salaryMillions)),
            h('td', null, String(p.contract.yearsRemaining)),
            h('td', { class: 'num' }, perGame(p.seasonStats.points, p.seasonStats.games)),
            h('td', null, playerStatus(p)),
          ),
        ),
      ),
    ),
  );
}

export function playerCard(app: App, l: LeagueSave, p: Player) {
  const t = userTeam(l);
  const top = (Object.entries(p.ratings) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return h(
    'button',
    { class: 'pcard', onclick: () => openPlayer(app, p.id), 'aria-label': `${fullName(p)} profile` },
    h(
      'div',
      { class: 'top' },
      portrait(l, p),
      h(
        'div',
        { style: 'flex:1;min-width:0' },
        h('div', { class: 'name' }, `#${p.jerseyNumber} ${p.firstName[0]}. ${p.lastName}`),
        h('div', { class: 'tiny muted' }, `${p.position} \u2022 ${p.archetype} \u2022 age ${p.age}`),
        h('div', null, starsEl(stars(p)), h('span', { class: 'tiny muted' }, ` ${stars(p).toFixed(1)}`), h('span', { class: 'tiny muted' }, ` \u2022 pot ${p.scoutedPotential === null ? '?' : p.scoutedPotential.toFixed(1)}`)),
      ),
      roleTag(roleOf(t, p)),
    ),
    h('div', { class: 'tiny muted' }, `Top: ${top.map(([k, v]) => `${k} ${v}`).join(' \u2022 ')}`),
    moraleEl(p),
    h('div', { class: 'row tiny', style: 'gap:6px' }, h('span', null, `${fmtMoney(p.contract.salaryMillions)}/yr x ${p.contract.yearsRemaining}`), h('span', { class: 'spacer' }), playerStatus(p)),
  );
}

export function rosterScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const order = (p: Player) => ({ starter: 0, reserve: 1, sitting: 2, injured: 3 })[roleOf(t, p)];
  const players = t.rosterIds.map((id) => l.players[id]).sort((a, b) => order(a) - order(b) || stars(b) - stars(a));
  const open = ROSTER.max - players.length;
  return shell(
    app,
    'roster',
    screenTitle('Roster', h('span', { class: 'muted' }, `${players.length}/${ROSTER.max} contracted \u2022 5 active + 2 bench`)),
    capStrip(l, t),
    h(
      'div',
      { class: 'cards' },
      players.map((p) => playerCard(app, l, p)),
      Array.from({ length: open }, () =>
        h(
          'button',
          { class: 'pcard', style: 'align-items:center;justify-content:center;border-style:dashed', onclick: () => app.go('market') },
          h('div', { class: 'muted' }, 'Open roster slot'),
          h('div', { class: 'tiny muted' }, 'A 0.5-star replacement fills empty lineup spots. Sign a star in the Market.'),
        ),
      ),
    ),
    h('section', { class: 'panel', style: 'margin-top:14px' }, h('h2', null, 'Details'), rosterTable(app, l, players)),
  );
}
