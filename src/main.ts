import './ui/style.css';
import { sfx } from './audio/sfx';
import { App } from './ui/app';
import { capScreen } from './ui/screens/cap';
import { loadScreen, newCareerScreen } from './ui/screens/career';
import { liveGameScreen, postgameScreen, pregameScreen, quickScreen } from './ui/screens/game';
import { homeScreen } from './ui/screens/home';
import { historyScreen, leagueScreen } from './ui/screens/league';
import { lineupScreen } from './ui/screens/lineup';
import { offseasonScreen } from './ui/screens/offseason';
import { officeScreen } from './ui/screens/office';
import { rosterScreen } from './ui/screens/roster';
import { settingsScreen } from './ui/screens/settings';
import { titleScreen } from './ui/screens/title';

async function loadFont() {
  try {
    const face = new FontFace('Hardwood', `url(${new URL('./fonts/hardwood.otf', document.baseURI).href})`);
    await face.load();
    document.fonts.add(face);
  } catch {
    /* falls back to monospace */
  }
}

async function boot() {
  await loadFont();
  const app = new App(document.getElementById('app')!);
  app.register('title', titleScreen);
  app.register('newCareer', newCareerScreen);
  app.register('load', loadScreen);
  app.register('settings', settingsScreen);
  app.register('home', homeScreen);
  app.register('roster', rosterScreen);
  app.register('lineup', lineupScreen);
  app.register('cap', capScreen);
  app.register('office', officeScreen);
  app.register('league', leagueScreen);
  app.register('history', historyScreen);
  app.register('pregame', pregameScreen);
  app.register('game', liveGameScreen);
  app.register('postgame', postgameScreen);
  app.register('offseason', offseasonScreen);
  app.register('quick', quickScreen);
  (window as unknown as { app: App }).app = app;
  const unlock = () => sfx.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  app.go('title');
}

void boot();
