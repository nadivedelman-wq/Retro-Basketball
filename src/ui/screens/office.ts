import { FACILITY_INFO, capUpgradeCost, facilityCost } from '../../sim/economy';
import { userTeam } from '../../sim/league';
import { fireStaff, hireStaff, teamDinner, upgradeCap, upgradeFacility } from '../../sim/transactions';
import type { App } from '../app';
import { h } from '../dom';
import { meter, screenTitle, shell } from '../widgets';

const ROLE_LABEL = { offense: 'Offensive Coordinator', defense: 'Defensive Coordinator', scouting: 'Head Scout' } as const;
const ROLE_EFFECT = {
  offense: 'Better shot quality and execution for your team; faster development.',
  defense: 'Tighter defence in simulated games.',
  scouting: 'More accurate prospect potential reports; cheaper to read talent.',
} as const;

export function officeScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const facilities = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Facilities', h('span', { class: 'gold' }, `${t.credits} credits`)),
    h(
      'div',
      { class: 'col' },
      (Object.keys(FACILITY_INFO) as (keyof typeof FACILITY_INFO)[]).map((k) => {
        const lvl = t.facilities[k];
        const info = FACILITY_INFO[k];
        return h(
          'div',
          { class: 'panel dark' },
          h('div', { class: 'row' }, h('span', { class: 'gold' }, info.name), h('span', { class: 'spacer' }), h('span', null, `Level ${lvl}/5`)),
          meter(lvl, 5, 'gold'),
          h('div', { class: 'tiny muted', style: 'margin:4px 0' }, `Now: ${info.effect(lvl)}`),
          lvl < 5 ? h('div', { class: 'tiny', style: 'margin-bottom:6px' }, `Next: ${info.effect(lvl + 1)}`) : null,
          h('button', { class: 'btn small primary', disabled: lvl >= 5 || t.credits < facilityCost(lvl), onclick: () => app.commit(upgradeFacility(app.league!, k)) }, lvl >= 5 ? 'Maxed' : `Upgrade (${facilityCost(lvl)} cr)`),
        );
      }),
    ),
  );

  const staff = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Coaching Staff'),
    h(
      'div',
      { class: 'col' },
      (['offense', 'defense', 'scouting'] as const).map((role) => {
        const m = t.staffMembers.find((s) => s.role === role);
        const cands = l.staffPool.filter((s) => s.role === role).sort((a, b) => b.rating - a.rating);
        return h(
          'div',
          { class: 'panel dark' },
          h('div', { class: 'row' }, h('span', { class: 'gold' }, ROLE_LABEL[role]), h('span', { class: 'spacer' }), m ? h('span', null, `${'★'.repeat(m.rating)}`) : h('span', { class: 'bad' }, 'Vacant')),
          m ? h('div', null, `${m.name} • ${m.perk} • wage ${m.salaryCredits} cr/season`) : null,
          h('div', { class: 'tiny muted' }, ROLE_EFFECT[role]),
          m ? h('button', { class: 'btn small danger', style: 'margin:6px 0', onclick: () => app.commit(fireStaff(app.league!, role)) }, 'Fire') : null,
          cands.length
            ? h(
                'div',
                { class: 'col', style: 'gap:4px;margin-top:6px' },
                h('span', { class: 'tiny muted' }, 'Candidates (hiring bonus = 2x wage):'),
                cands.map((c) =>
                  h(
                    'div',
                    { class: 'row', style: 'gap:6px' },
                    h('span', { class: 'gold' }, '★'.repeat(c.rating)),
                    h('span', { style: 'flex:1' }, `${c.name} `, h('span', { class: 'tiny muted' }, c.perk)),
                    h('button', { class: 'btn small', disabled: t.credits < c.salaryCredits * 2, onclick: () => app.commit(hireStaff(app.league!, c.id)) }, `Hire ${c.salaryCredits * 2} cr`),
                  ),
                ),
              )
            : null,
        );
      }),
    ),
  );

  const extras = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Spend Credits'),
    h(
      'div',
      { class: 'col' },
      h('div', { class: 'row' }, h('div', { style: 'flex:1' }, h('div', null, 'Team dinner'), h('div', { class: 'tiny muted' }, '+8 morale for every player')), h('button', { class: 'btn', disabled: t.credits < 8, onclick: () => app.commit(teamDinner(app.league!)) }, '8 cr')),
      h(
        'div',
        { class: 'row' },
        h('div', { style: 'flex:1' }, h('div', null, `Cap expansion (now $${t.capMillions}M)`), h('div', { class: 'tiny muted' }, 'Permanently raises your team cap by $5M. Each expansion costs 50% more.')),
        h('button', { class: 'btn', disabled: t.credits < capUpgradeCost(t), onclick: () => app.commit(upgradeCap(app.league!)) }, `${capUpgradeCost(t)} cr`),
      ),
      h('h3', { style: 'margin-top:10px' }, 'Coach'),
      h('div', null, `${l.coach.name} • ${l.coach.wins}-${l.coach.losses} career • ${l.coach.titles} title${l.coach.titles === 1 ? '' : 's'} • ${l.coach.seasons} season${l.coach.seasons === 1 ? '' : 's'}`),
      h('div', { class: 'row' }, h('span', { style: 'width:150px' }, 'Reputation'), h('div', { class: 'spacer' }, meter(l.coach.reputation, 100, 'gold'))),
      h('div', { class: 'row' }, h('span', { style: 'width:150px' }, 'Confidence'), h('div', { class: 'spacer' }, meter(l.coach.confidence))),
      h('div', { class: 'tiny muted' }, 'Credits come from wins, home games (arena), playoff runs, objectives and fan support. They can never be bought with real money.'),
    ),
  );
  return shell(app, 'office', screenTitle('Front Office'), h('div', { class: 'grid two' }, h('div', { class: 'col', style: 'gap:14px' }, facilities, extras), staff));
}
