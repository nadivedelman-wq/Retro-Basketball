import type { CoachRole } from '../../core/types';
import { CAP_UPGRADE, COACH_ROLES, COACH_TIERS, TEAM_DINNER, UPGRADES, UPGRADE_MAX, type UpgradeKind } from '../../sim/config';
import { capUpgradeCost } from '../../sim/economy';
import { userTeam } from '../../sim/league';
import { coachCost, fireStaff, hireStaff, teamDinner, upgradeCap, upgradeFacility } from '../../sim/transactions';
import type { App } from '../app';
import { h } from '../dom';
import { coin, confirmPurchase, meter, screenTitle, shell } from '../widgets';

const tierLabel = (tier: number) => (tier ? COACH_TIERS[tier - 1].label : 'None');

function pips(level: number, max: number) {
  return h('span', { class: 'gold', 'aria-label': `Level ${level} of ${max}` }, '■'.repeat(level) + '□'.repeat(max - level), h('span', { class: 'tiny muted' }, ` L${level}/${max}`));
}

export function officeScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const buy = async (title: string, lines: string[], cost: number, run: () => void) => {
    if (await confirmPurchase(app, title, lines, cost, userTeam(app.league!).credits)) run();
  };

  const upgrades = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Upgrades', h('span', { class: 'chip' }, coin(), h('b', null, `${t.credits} CC`))),
    h(
      'div',
      { class: 'col' },
      (Object.keys(UPGRADES) as UpgradeKind[]).map((k) => {
        const u = UPGRADES[k];
        const lvl = t.facilities[k];
        const maxed = lvl >= UPGRADE_MAX;
        const cost = maxed ? 0 : u.costs[lvl];
        return h(
          'div',
          { class: 'panel dark' },
          h('div', { class: 'row' }, h('span', { class: 'gold' }, u.name), h('span', { class: 'spacer' }), pips(lvl, UPGRADE_MAX)),
          h('div', { class: 'tiny', style: 'margin:4px 0' }, `Now: ${lvl ? u.effects[lvl - 1] : 'No bonus yet'}`),
          maxed ? h('div', { class: 'tiny good' }, '★ Maximum level') : h('div', { class: 'tiny muted' }, `Level ${lvl + 1}: ${u.effects[lvl]}`),
          h(
            'button',
            {
              class: 'btn small primary',
              style: 'margin-top:6px',
              disabled: maxed || t.credits < cost,
              onclick: () => void buy(`${u.name} level ${lvl + 1}`, [u.effects[lvl], 'Upgrades are permanent and saved with your franchise.'], cost, () => app.commit(upgradeFacility(app.league!, k))),
            },
            maxed ? 'Maxed' : t.credits < cost ? `Need ${cost} CC` : `Buy L${lvl + 1} • ${cost} CC`,
          ),
        );
      }),
    ),
  );

  const fans = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Fans'),
    h('div', { class: 'row' }, h('span', null, 'Fan support'), h('span', { class: 'spacer' }), h('span', { class: 'gold' }, `${Math.round(t.fanSupport)} / 100`)),
    meter(t.fanSupport, 100, 'gold'),
    h('div', { class: 'tiny muted', style: 'margin-top:4px' }, `Wins raise fan support (more at home with Fan Engagement); losing streaks lower it. At 80+, wins pay a small +1 CC bonus.`),
  );

  const coaches = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Coaching Staff'),
    h(
      'div',
      { class: 'col' },
      (['offense', 'defense', 'development'] as CoachRole[]).map((role) => {
        const info = COACH_ROLES[role];
        const cur = t.staffMembers.find((m) => m.role === role);
        const tier = t.staff[role];
        const cands = l.staffPool.filter((s) => s.role === role).sort((a, b) => a.tier - b.tier);
        return h(
          'div',
          { class: 'panel dark' },
          h('div', { class: 'row' }, h('span', { class: 'gold' }, info.title), h('span', { class: 'spacer' }), pips(tier, 3), h('span', { class: 'tiny' }, ` ${tierLabel(tier)}`)),
          h('div', { class: 'tiny' }, cur ? `${cur.name} • ${cur.perk}` : 'Vacant'),
          h('div', { class: 'tiny muted' }, `Effect: ${info.effect(tier)}`),
          h(
            'div',
            { class: 'col', style: 'gap:4px;margin-top:6px' },
            cands.map((c) => {
              const cost = coachCost(c.tier);
              const better = c.tier > tier;
              return h(
                'div',
                { class: 'row', style: 'gap:6px' },
                h('span', { class: 'gold', style: 'width:84px' }, tierLabel(c.tier)),
                h('span', { style: 'flex:1;min-width:120px' }, c.name, h('div', { class: 'tiny muted' }, c.perk)),
                h(
                  'button',
                  {
                    class: 'btn small',
                    disabled: !better || t.credits < cost,
                    title: better ? '' : 'You already have this tier or better',
                    onclick: () =>
                      void buy(
                        `Hire ${tierLabel(c.tier)} ${info.title}?`,
                        [`${c.name} (${c.perk}).`, `Old: ${tierLabel(tier)} — ${info.effect(tier)}`, `New: ${tierLabel(c.tier)} — ${info.effect(c.tier)}`, cur ? `${cur.name} will leave.` : ''].filter(Boolean),
                        cost,
                        () => app.commit(hireStaff(app.league!, c.id)),
                      ),
                  },
                  better ? `${cost} CC` : 'Have it',
                ),
              );
            }),
          ),
          cur
            ? h(
                'button',
                {
                  class: 'btn small danger',
                  style: 'margin-top:6px',
                  onclick: async () => {
                    if (await app.confirm('Let coach go?', `Let ${cur.name} go? You lose the ${info.title} bonus and will need to pay to hire again.`, 'Let go')) app.commit(fireStaff(app.league!, role));
                  },
                },
                'Let go',
              )
            : null,
        );
      }),
    ),
  );

  const capCost = capUpgradeCost(t);
  const extras = h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Other spending'),
    h(
      'div',
      { class: 'col' },
      h(
        'div',
        { class: 'row' },
        h('div', { style: 'flex:1' }, h('div', null, 'Team dinner'), h('div', { class: 'tiny muted' }, `+${TEAM_DINNER.morale} morale for every player`)),
        h('button', { class: 'btn', disabled: t.credits < TEAM_DINNER.cost, onclick: () => void buy('Team dinner', [`+${TEAM_DINNER.morale} morale for the whole roster.`], TEAM_DINNER.cost, () => app.commit(teamDinner(app.league!))) }, `${TEAM_DINNER.cost} CC`),
      ),
      h(
        'div',
        { class: 'row' },
        h('div', { style: 'flex:1' }, h('div', null, `Cap expansion (now $${t.capMillions}M)`), h('div', { class: 'tiny muted' }, `Permanently raises your salary cap by $${CAP_UPGRADE.stepM}M. Each expansion costs ${Math.round((CAP_UPGRADE.growth - 1) * 100)}% more.`)),
        h(
          'button',
          { class: 'btn', disabled: t.credits < capCost, onclick: () => void buy('Cap expansion', [`Salary cap $${t.capMillions}M → $${t.capMillions + CAP_UPGRADE.stepM}M, permanently.`, `The next expansion will cost ${Math.round(capCost * CAP_UPGRADE.growth)} CC.`], capCost, () => app.commit(upgradeCap(app.league!))) },
          `${capCost} CC`,
        ),
      ),
      h('h3', { style: 'margin-top:10px' }, 'Coach'),
      h('div', null, `${l.coach.name} • ${l.coach.wins}-${l.coach.losses} career • ${l.coach.titles} title${l.coach.titles === 1 ? '' : 's'}`),
      h('div', { class: 'row' }, h('span', { style: 'width:150px' }, 'Reputation'), h('div', { class: 'spacer' }, meter(l.coach.reputation, 100, 'gold'))),
      h('div', { class: 'row' }, h('span', { style: 'width:150px' }, 'Confidence'), h('div', { class: 'spacer' }, meter(l.coach.confidence))),
      h('div', { class: 'tiny muted' }, 'Coach Coins: +3 per win, +1 per loss, +15 for a title, plus one-time milestones. They can never be bought with real money.'),
    ),
  );
  return shell(app, 'office', screenTitle('Front Office'), h('div', { class: 'grid two' }, h('div', { class: 'col', style: 'gap:14px' }, upgrades, fans, extras), coaches));
}
