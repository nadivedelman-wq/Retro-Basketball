import { sfx } from '../../audio/sfx';
import { ROSTER } from '../../sim/config';
import { capSpace } from '../../sim/economy';
import { userTeam } from '../../sim/league';
import { ARCHETYPES, fullName, moraleBand, stars } from '../../sim/players';
import { buyMarketPlayer, marketCheck } from '../../sim/transactions';
import type { App } from '../app';
import { fmtMoney, h } from '../dom';
import { capStrip, coin, confirmPurchase, portrait, screenTitle, shell, starsEl } from '../widgets';
import { heightStr, openPlayer } from './roster';

export function marketScreen(app: App) {
  const l = app.league!;
  const t = userTeam(l);
  const space = capSpace(l, t);
  const left = l.market.gamesUntilRefresh;
  const cards = l.market.offers.map((o) => {
    const p = l.players[o.playerId];
    if (!p) return null;
    const check = marketCheck(l, p.id);
    const top = (Object.entries(p.ratings) as [string, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const after = space - p.contract.salaryMillions;
    const buy = async () => {
      const ok = await confirmPurchase(
        app,
        `Sign ${fullName(p)}?`,
        [
          `${stars(p).toFixed(1)}-star ${p.position}, age ${p.age}.`,
          `Contract: ${fmtMoney(p.contract.salaryMillions)} a year for ${p.contract.yearsRemaining} season${p.contract.yearsRemaining > 1 ? 's' : ''}. This counts against your $${t.capMillions}M cap every season.`,
          `Available cap after signing: ${fmtMoney(after)}.`,
          'Coach Coins are a one-time signing cost; salary is paid from cap space.',
        ],
        o.coinPrice,
        t.credits,
      );
      if (ok && app.commit(buyMarketPlayer(app.league!, p.id))) sfx.fanfare();
    };
    return h(
      'section',
      { class: 'panel mcard' },
      h('h2', null, h('span', null, `${p.position} • ${p.archetype}`), starsEl(stars(p))),
      h(
        'div',
        { class: 'row', style: 'align-items:flex-start' },
        portrait(l, p, 'portrait lg'),
        h(
          'div',
          { class: 'col', style: 'gap:2px;flex:1;min-width:180px' },
          h('div', { class: 'x3', style: 'cursor:pointer', onclick: () => openPlayer(app, p.id) }, fullName(p)),
          h('div', { class: 'muted' }, `${stars(p).toFixed(1)} stars • age ${p.age} • ${heightStr(p.heightCm)} • potential ${p.potential.toFixed(1)}`),
          h('div', { class: 'tiny muted' }, ARCHETYPES[p.archetype].blurb),
          h('div', null, `Top: ${top.map(([k, v]) => `${k} ${v}`).join(' • ')}`),
          h('div', null, `Morale baseline: ${Math.round(p.morale)} ${moraleBand(p.morale).label}`),
          p.traits.length ? h('div', { class: 'tiny gold' }, p.traits.join(' • ')) : null,
        ),
      ),
      h(
        'div',
        { class: 'price', style: 'margin-top:8px' },
        h('span', { class: 'cc' }, coin(), ` ${o.coinPrice} CC to sign`),
        h('span', null, `${fmtMoney(p.contract.salaryMillions)}/yr`),
        h('span', null, `${p.contract.yearsRemaining} season${p.contract.yearsRemaining > 1 ? 's' : ''}`),
        h('span', { class: after < 0 ? 'bad' : '' }, `Cap after: ${fmtMoney(after)}`),
      ),
      check.ok ? null : h('ul', { class: 'reasons', style: 'margin-top:6px' }, check.reasons.map((r) => h('li', null, `▼ ${r}`))),
      h(
        'div',
        { class: 'row', style: 'margin-top:8px;justify-content:flex-end' },
        h('button', { class: 'btn', onclick: () => openPlayer(app, p.id) }, 'Scout report'),
        h('button', { class: 'btn primary', disabled: !check.ok, onclick: () => void buy(), title: check.ok ? '' : check.reasons.join(' ') }, `Sign for ${o.coinPrice} CC`),
      ),
    );
  });
  return shell(
    app,
    'market',
    screenTitle('Player Market', h('span', { class: 'chip' }, coin(), h('b', null, `${t.credits} CC`)), h('span', { class: 'muted' }, `New offers in ${left} game${left === 1 ? '' : 's'}`)),
    capStrip(l, t),
    h(
      'div',
      { class: 'panel dark', style: 'margin-bottom:14px' },
      h('div', null, `Only 4.0 to 5.0-star players reach the market. Signing needs all three: enough Coach Coins, enough available cap for his salary, and an open roster spot (${t.rosterIds.length}/${ROSTER.max} used).`),
      t.rosterIds.length >= ROSTER.max ? h('div', { class: 'warn', style: 'margin-top:4px' }, '▲ Roster full: release a player from his profile on the Roster screen to open a spot.') : null,
    ),
    cards.length ? h('div', { class: 'grid two' }, cards) : h('div', { class: 'panel' }, 'The market is empty right now. New offers arrive soon.'),
  );
}
