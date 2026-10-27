import type { Tactics } from '../../core/types';
import { planMinutes } from '../../sim/gameSim';
import { sortRotation, userTeam } from '../../sim/league';
import { fullName, stars } from '../../sim/players';
import { setLineup, setTactics } from '../../sim/transactions';
import type { App } from '../app';
import { h } from '../dom';
import { playerStatus, screenTitle, shell, starsEl } from '../widgets';
import { seg } from './career';

export const TACTIC_INFO: Record<keyof Tactics, { label: string; low: string; high: string; ai: string }> = {
  pace: { label: 'Pace', low: 'Grind it out', high: 'Run and gun', ai: 'Higher pace: CPU pushes in transition, shoots earlier in the clock, more possessions per game.' },
  threeRate: { label: 'Three-point rate', low: 'Paint first', high: 'Let it fly', ai: 'Raises how much the AI values threes and moves shooting bigs out to the arc.' },
  pickAndRoll: { label: 'Pick-and-roll', low: 'Iso / motion', high: 'Screen heavy', ai: 'How often ball handlers call a screen from a big and the big rolls to the rim.' },
  postUps: { label: 'Post-ups', low: 'Perimeter', high: 'Feed the post', ai: 'Bigs set up on the block and back down; the AI looks for entry passes.' },
  defAggression: { label: 'Defensive pressure', low: 'Conservative', high: 'Gamble', ai: 'Tighter on-ball defence and more steal attempts, but more fouls.' },
  rebounding: { label: 'Crash the glass', low: 'Get back', high: 'Crash', ai: 'More players chase offensive rebounds; fewer get back on defence.' },
};

export function lineupScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const roster = t.rosterIds.map((id) => l.players[id]);
  const starters = t.starters.slice();
  let bench = t.rotation.filter((id) => !starters.includes(id));
  const plan: Record<string, number> = { ...t.minutesPlan };
  let useCustom = Object.keys(t.minutesPlan).length > 0;
  const auto = planMinutes(l, t);

  const startersBox = h('div', { class: 'col' });
  const benchBox = h('div', { class: 'col', style: 'gap:6px' });
  const totalEl = h('span');

  const minutesInput = (id: string) => {
    const p = l.players[id];
    const input = h('input', {
      type: 'number',
      min: 0,
      max: 44,
      value: String(Math.round(plan[id] ?? auto.get(id) ?? 0)),
      disabled: !useCustom || !!p.injury,
      style: 'width:80px',
      'aria-label': `Minutes for ${fullName(p)}`,
    });
    input.addEventListener('input', () => {
      plan[id] = Number(input.value) || 0;
      drawTotal();
    });
    return input;
  };
  const drawTotal = () => {
    if (!useCustom) {
      totalEl.textContent = 'Auto minutes (by rotation order, stamina and condition)';
      totalEl.className = 'muted';
      return;
    }
    const tot = t.rosterIds.reduce((s, id) => s + (plan[id] ?? Math.round(auto.get(id) ?? 0)), 0);
    totalEl.textContent = `Planned minutes: ${tot} / 240`;
    totalEl.className = Math.abs(tot - 240) > 24 ? 'bad' : 'good';
  };

  const draw = () => {
    startersBox.replaceChildren(
      ...['PG', 'SG', 'SF', 'PF', 'C'].map((slotPos, i) =>
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'gold', style: 'width:36px' }, slotPos),
          h(
            'select',
            {
              style: 'flex:1;min-width:180px',
              'aria-label': `Starter ${slotPos}`,
              onchange: (e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                const prev = starters[i];
                const j = starters.indexOf(id);
                if (j >= 0) starters[j] = prev;
                else bench = [prev, ...bench.filter((b) => b !== id)];
                starters[i] = id;
                bench = bench.filter((b) => !starters.includes(b));
                draw();
              },
            },
            roster.map((p) => h('option', { value: p.id, selected: p.id === starters[i], disabled: !!p.injury }, `${p.lastName} (${p.position}) ${'★'.repeat(Math.floor(stars(p)))}${p.injury ? ' INJ' : ''}`)),
          ),
          minutesInput(starters[i]),
        ),
      ),
    );
    benchBox.replaceChildren(
      ...bench.map((id, i) => {
        const p = l.players[id];
        return h(
          'div',
          { class: 'row', style: 'gap:6px' },
          h('span', { class: 'muted', style: 'width:28px' }, String(i + 6)),
          h('button', { class: 'btn small', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { [bench[i - 1], bench[i]] = [bench[i], bench[i - 1]]; draw(); } }, '▲'),
          h('button', { class: 'btn small', disabled: i === bench.length - 1, 'aria-label': 'Move down', onclick: () => { [bench[i + 1], bench[i]] = [bench[i], bench[i + 1]]; draw(); } }, '▼'),
          h('span', { style: 'flex:1;min-width:150px' }, `${p.lastName} `, h('span', { class: 'muted' }, p.position), ' ', starsEl(stars(p))),
          playerStatus(p),
          minutesInput(id),
        );
      }),
    );
    drawTotal();
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
    screenTitle('Rotation & Tactics'),
    h(
      'div',
      { class: 'grid two' },
      h(
        'section',
        { class: 'panel' },
        h('h2', null, 'Rotation', h('span', { class: 'row', style: 'gap:6px' }, h('button', { class: 'btn small', onclick: () => { const copy = structuredClone(t); sortRotation(l, copy); starters.splice(0, 5, ...copy.starters); bench = copy.rotation; draw(); } }, 'Auto-pick'))),
        h('h3', null, 'Starting five'),
        startersBox,
        h('h3', { style: 'margin-top:12px' }, 'Bench priority'),
        h('div', { class: 'tiny muted', style: 'margin-bottom:6px' }, 'Higher players come in first. Injured players cannot be given minutes; the AI fills in for them automatically.'),
        benchBox,
        h('div', { class: 'row', style: 'margin-top:12px' }, h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: useCustom, onchange: (e: Event) => { useCustom = (e.target as HTMLInputElement).checked; draw(); } }), 'Custom minutes plan'), h('span', { class: 'spacer' }), totalEl),
        h(
          'div',
          { class: 'row', style: 'margin-top:12px;justify-content:flex-end' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                const mp: Record<string, number> = {};
                if (useCustom) for (const id of t.rosterIds) mp[id] = plan[id] ?? Math.round(auto.get(id) ?? 0);
                app.commit(setLineup(app.league!, starters, bench, useCustom ? mp : {}));
              },
            },
            'Save rotation',
          ),
        ),
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
