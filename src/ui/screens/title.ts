import { buildBall } from '../../art/arena';
import { textWidth } from '../../art/font';
import { PixelBuffer, drawText, hexToRgba } from '../../art/pixels';
import { sfx } from '../../audio/sfx';
import { listSlots, loadLeague } from '../../persist/save';
import type { App } from '../app';
import { h } from '../dom';

/** The game's wordmark, drawn from the Hardwood font with stripes and a hard shadow. */
function wordmark(): HTMLCanvasElement {
  const W = 240;
  const H = 92;
  const b = new PixelBuffer(W, H);
  const draw = (text: string, y: number, scale: number, top: string, bottom: string) => {
    const w = textWidth(text) * scale;
    const x = Math.round(W / 2 - w / 2);
    // shadow + outline
    for (const [dx, dy] of [
      [3, 3],
      [2, 3],
      [3, 2],
    ])
      drawText(b, text, x + dx, y + dy, hexToRgba('#0b0910'), scale);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      drawText(b, text, x + dx, y + dy, hexToRgba('#2a0f1a'), scale);
    // stripes: top colour then bottom colour
    const tmp = new PixelBuffer(W, H);
    drawText(tmp, text, x, y, hexToRgba('#ffffff'), scale);
    for (let yy = y; yy < y + 7 * scale; yy++) {
      const t = (yy - y) / (7 * scale);
      const col = hexToRgba(t < 0.5 ? top : bottom);
      for (let xx = 0; xx < W; xx++) if (tmp.get(xx, yy)[3]) b.set(xx, yy, (yy - y) % scale === 0 && t > 0.45 && t < 0.56 ? hexToRgba('#ffffff') : col);
    }
  };
  draw('PIXEL', 4, 5, '#ffd34a', '#ff8c2a');
  draw('HARDWOOD', 46, 4, '#ff8c2a', '#e0431e');
  // Court stripe under the logo
  b.rect(20, 82, 200, 2, hexToRgba('#c98f52'));
  b.rect(20, 84, 200, 1, hexToRgba('#7a4f28'));
  return b.toCanvas();
}

export function titleScreen(app: App) {
  const logoBase = wordmark();
  const canvas = h('canvas', { class: 'logo', width: logoBase.width, height: logoBase.height + 30 });
  const ctx = canvas.getContext('2d')!;
  const ball = buildBall();
  let t = 0;
  let raf = 0;
  const loop = () => {
    t += 1 / 60;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(logoBase, 0, 0);
    // A ball dribbling along under the wordmark
    const floor = logoBase.height + 22;
    const x = 22 + ((t * 40) % 196);
    const y = floor - 6 - Math.abs(Math.sin(t * 5)) * 18;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(Math.round(x) + 1, floor, 4, 1);
    ctx.drawImage(ball, Math.round(x), Math.round(y));
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  app.onLeave(() => cancelAnimationFrame(raf));

  const menu = h('div', { class: 'title-menu' });
  const press = (fn: () => void) => () => {
    sfx.unlock();
    sfx.select();
    fn();
  };
  const cont = h('button', { class: 'btn big primary', disabled: true }, 'Continue');
  menu.append(
    cont,
    h('button', { class: 'btn big', onclick: press(() => app.go('newCareer')) }, 'New Career'),
    h('button', { class: 'btn big', onclick: press(() => app.go('load')) }, 'Load Career'),
    h('div', { class: 'row', style: 'gap:10px' }, h('button', { class: 'btn', style: 'flex:1', onclick: press(() => app.go('quick', { mode: 'game' })) }, 'Quick Game'), h('button', { class: 'btn', style: 'flex:1', onclick: press(() => app.go('quick', { mode: 'practice' })) }, 'Practice')),
    h('button', { class: 'btn', onclick: press(() => app.go('settings')) }, 'Settings'),
  );
  void (async () => {
    const slots = await listSlots();
    const last = app.settings.lastSlot;
    const target = slots.find((s) => s.slot === last && !('empty' in s)) ?? slots.find((s) => !('empty' in s));
    if (target && !('empty' in target)) {
      cont.disabled = false;
      cont.textContent = `Continue • S${target.season}`;
      cont.onclick = press(async () => {
        try {
          app.league = await loadLeague(target.slot);
          app.go(app.league?.phase === 'offseason' ? 'offseason' : 'home');
        } catch (e) {
          app.toast(`Could not load: ${(e as Error).message}`, true);
        }
      });
    } else {
      cont.textContent = 'Continue';
    }
  })();

  return h(
    'div',
    { class: 'title-screen' },
    canvas,
    h('div', { class: 'muted' }, 'Arcade basketball • franchise mode'),
    menu,
    h('div', { class: 'gold blink' }, 'Press a button to tip off'),
    h('div', { class: 'tiny dim' }, 'v0.1 • all art, sound and names are original • saves stay on this device'),
  );
}
