import type { Tactics } from '../../core/types';
import { sfx } from '../../audio/sfx';
import { ROSTER } from '../../sim/config';
import { sortRotation, userTeam } from '../../sim/league';
import { fullName, moraleBand, stars } from '../../sim/players';
import { setLineup, setTactics } from '../../sim/transactions';
import type { App } from '../app';
import { h } from '../dom';
import { portrait, screenTitle, shell, starsEl } from '../widgets';
import { seg } from './career';

export const TACTIC_INFO: Record<keyof Tactics, { label: string; low: string; high: string; ai: string }> = {
  pace: { label: 'Pace', low: 'Grind it out', high: 'Run and gun', ai: 'Higher pace: CPU pushes in transition, shoots earlier in the clock, more possessions per game.' },
  threeRate: { label: 'Three-point rate', low: 'Paint first', high: 'Let it fly', ai: 'Raises how much the AI values threes and moves shooting bigs out to the arc.' },
  pickAndRoll: { label: 'Pick-and-roll', low: 'Iso / motion', high: 'Screen heavy', ai: 'How often ball handlers call a screen from a big and the big rolls to the rim.' },
  postUps: { label: 'Post-ups', low: 'Perimeter', high: 'Feed the post', ai: 'Bigs set up on the block and back down; the AI looks for entry passes.' },
  defAggression: { label: 'Defensive pressure', low: 'Conservative', high: 'Gamble', ai: 'Tighter on-ball defence and more steal attempts, but more fouls.' },
  rebounding: { label: 'Crash the glass', low: 'Get back', high: 'Crash', ai: 'More players chase offensive rebounds; fewer get back on defence.' },
};

type SlotRef = { kind: 'starter' | 'reserve' | 'sit'; index: number; id: string };

export function lineupScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const starters = Array.from({ length: ROSTER.active }, (_, i) => t.starters[i] ?? '');
  const reserves = Array.from({ length: ROSTER.bench }, (_, i) => t.rotation[i] ?? '');
  let selected: SlotRef | null = null;
  const box = h('div', { class: 'col', style: 'gap:12px' });
  const summary = h('div', { class: 'muted' });

  const sitting = () => t.rosterIds.filter((id) => !starters.includes(id) && !reserves.includes(id));
  const get = (r: SlotRef) => (r.kind === 'starter' ? starters[r.index] : r.kind === 'reserve' ? reserves[r.index] : r.id);
  const set = (r: SlotRef, id: string) => {
    if (r.kind === 'starter') starters[r.index] = id;
    else if (r.kind === 'reserve') reserves[r.index] = id;
  };
  const same = (a: SlotRef | null, b: SlotRef) => !!a && a.kind === b.kind && (a.kind === 'sit' ? a.id === b.id : a.index === b.index);

  const tap = (r: SlotRef) => {
    const id = get(r);
    if (id && l.players[id]?.injury && r.kind === 'sit') {
      app.toast(`${fullName(l.players[id])} is injured and cannot play until he recovers.`, true);
      return;
    }
    if (!selected) {
      if (!id) return; // nothing to pick up from an empty slot
      selected = r;
    } else if (same(selected, r)) {
      selected = null;
    } else {
      const a = get(selected);
      const b = get(r);
      if (selected.kind === 'sit' && r.kind === 'sit') selected = r;
      else if (selected.kind === 'sit') {
        set(r, a); // whoever was in the slot goes back to sitting
        selected = null;
      } else if (r.kind === 'sit') {
        if (l.players[b]?.injury) {
          app.toast(`${fullName(l.players[b])} is injured and cannot play until he recovers.`, true);
          return;
        }
        set(selected, b);
        selected = null;
      } else {
        set(selected, b);
        set(r, a);
        selected = null;
      }
    }
    sfx.select();
    draw();
  };

  const slotEl = (r: SlotRef, label: string) => {
    const id = get(r);
    const p = id ? l.players[id] : null;
    return h(
      'button',
      {
        class: `slot ${p ? 'filled' : 'rep'} ${same(selected, r) ? 'sel' : ''}`,
        onclick: () => tap(r),
        'aria-label': p ? `${label}: ${fullName(p)}` : `${label}: empty, a 0.5-star replacement will play`,
        'aria-pressed': String(same(selected, r)),
      },
      h('span', { class: 'pos' }, label),
      p
        ? [portrait(l, p), h('span', null, `${p.firstName[0]}. ${p.lastName}`), h('span', null, starsEl(stars(p)), h('span', { class: 'tiny muted' }, ` ${p.position}`)), h('span', { class: 'tiny' }, moraleBand(p.morale).label)]
        : [h('span', { class: 'x3' }, '?'), h('span', { class: 'tiny' }, 'Replacement'), h('span', null, starsEl(0.5), h('span', { class: 'tiny' }, ' 0.5'))],
    );
  };

  const draw = () => {
    const sit = sitting();
    const empties = starters.filter((x) => !x).length;
    summary.textContent = selected
      ? 'Now tap where he should go (another slot to swap, or the sitting list to bench him).'
      : empties
        ? `${empties} empty starter slot${empties > 1 ? 's' : ''}: a 0.5-star replacement will start there.`
        : 'Tap a player, then tap a slot to move or swap him.';
    box.replaceChildren(
      h('h3', null, 'Starting five'),
      h('div', { class: 'lineup' }, ['PG', 'SG', 'SF', 'PF', 'C'].map((pos, i) => slotEl({ kind: 'starter', index: i, id: '' }, pos))),
      h('h3', null, 'Bench (dresses, subs in)'),
      h('div', { class: 'lineup bench' }, reserves.map((_, i) => slotEl({ kind: 'reserve', index: i, id: '' }, `Bench ${i + 1}`))),
      h('h3', null, `Sitting (${sit.length})`),
      h(
        'button',
        {
          class: `slot ${selected && selected.kind !== 'sit' ? 'sel' : ''}`,
          style: 'min-height:56px;width:100%',
          onclick: () => {
            if (selected && selected.kind !== 'sit') {
              set(selected, '');
              selected = null;
              sfx.select();
              draw();
            }
          },
        },
        h('span', { class: 'tiny muted' }, selected && selected.kind !== 'sit' ? 'Tap here to sit him (contract unchanged)' : 'Players here do not dress. Their contracts are unchanged.'),
      ),
      h(
        'div',
        { class: 'chiprow' },
        sit.map((id) => {
          const p = l.players[id];
          const r: SlotRef = { kind: 'sit', index: -1, id };
          return h(
            'button',
            { class: `pick ${same(selected, r) ? 'sel' : ''}`, onclick: () => tap(r), 'aria-pressed': String(same(selected, r)) },
            portrait(l, p),
            h('span', null, `${p.firstName[0]}. ${p.lastName} `, starsEl(stars(p)), p.injury ? h('span', { class: 'bad tiny' }, ` INJ ${p.injury.gamesRemaining}g`) : h('span', { class: 'tiny muted' }, ` ${moraleBand(p.morale).label}`)),
          );
        }),
      ),
    );
  };
  draw();

  const tactics: Tactics = { ...t.tactics };
  const tacticsBox = h(
    'div',
    { class: 'col' },
    (Object.keys(TACTIC_INFO) as (keyof Tactics)[]).map((k) => {
      const info = TACTIC_INFO[k];
      return h(
        'div',
        { class: 'col', style: 'gap:2px' },
        h('div', { class: 'row' }, h('span', { class: 'gold' }, info.label), h('span', { class: 'spacer' }), h('span', { class: 'tiny muted' }, `${info.low} ◀ ▶ ${info.high}`)),
        seg([1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })), tactics[k], (v) => (tactics[k] = v)),
        h('div', { class: 'tiny muted' }, info.ai),
      );
    }),
  );

  return shell(
    app,
    'lineup',
    screenTitle('Lineup & Playbook'),
    h(
      'div',
      { class: 'grid two' },
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Lineup', h('button', { class: 'btn small', onclick: () => { const copy = structuredClone(t); sortRotation(l, copy); starters.splice(0, ROSTER.active, ...copy.starters); reserves.splice(0, ROSTER.bench, ...Array.from({ length: ROSTER.bench }, (_, i) => copy.rotation[i] ?? '')); selected = null; draw(); } }, 'Best available')),
        summary,
        box,
        h('div', { class: 'tiny muted', style: 'margin-top:8px' }, 'Stars are never forced in: bench or sit anyone. Sitting a star for one game barely matters, but stars who keep losing minutes or touches lose morale. Injured players cannot be selected.'),
        h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: () => app.commit(setLineup(app.league!, starters, reserves.filter(Boolean))) }, 'Save lineup')),
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Playbook'),
        tacticsBox,
        h('div', { class: 'row', style: 'margin-top:12px;justify-content:flex-end' }, h('button', { class: 'btn primary', onclick: () => app.commit(setTactics(app.league!, tactics), 'Playbook saved.') }, 'Save playbook')),
      ),
    ),
  );
}
