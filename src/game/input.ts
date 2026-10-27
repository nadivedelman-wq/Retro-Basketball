import type { InputState } from './engine/types';

export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'shoot' | 'pass' | 'sprint' | 'screen' | 'action' | 'timeout' | 'pause';

export const ACTION_LABELS: Record<ControlAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  shoot: 'Shoot (hold/release) / Jump',
  pass: 'Pass / Switch player',
  sprint: 'Sprint (hold)',
  screen: 'Call screen',
  action: 'Steal / Block / Jump',
  timeout: 'Timeout',
  pause: 'Pause',
};

export type KeyBindings = Record<ControlAction, string[]>;

export const DEFAULT_BINDINGS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  shoot: ['Space', 'KeyJ'],
  pass: ['KeyE', 'KeyK'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  screen: ['KeyQ'],
  action: ['KeyF', 'KeyL'],
  timeout: ['KeyT'],
  pause: ['Escape', 'KeyP'],
};

export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Arrow', '')
    .replace('Left', ' L')
    .replace('Right', ' R')
    .replace('ShiftL', 'Shift')
    .toUpperCase();
}

/** Virtual controls from the touch overlay, written by the UI layer. */
export type TouchState = { mx: number; mz: number; shoot: boolean; sprint: boolean; pressed: Set<ControlAction> };

/**
 * Merges keyboard, touch and gamepad into one InputState per frame.
 * Edge-triggered buttons fire once per press.
 */
export class InputController {
  private held = new Set<string>();
  private pressedCodes = new Set<string>();
  bindings: KeyBindings;
  touch: TouchState = { mx: 0, mz: 0, shoot: false, sprint: false, pressed: new Set() };
  pointerPassTarget: string | undefined;
  pointerShoot = false;
  private padPrev: boolean[] = [];
  private onDown = (e: KeyboardEvent) => {
    if (this.isBound(e.code)) e.preventDefault();
    if (!this.held.has(e.code)) this.pressedCodes.add(e.code);
    this.held.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };
  private onBlur = () => this.held.clear();

  constructor(bindings: KeyBindings) {
    this.bindings = bindings;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private isBound(code: string) {
    return Object.values(this.bindings).some((codes) => codes.includes(code));
  }

  private down(a: ControlAction) {
    return this.bindings[a].some((c) => this.held.has(c));
  }

  private pressed(a: ControlAction) {
    return this.bindings[a].some((c) => this.pressedCodes.has(c)) || this.touch.pressed.has(a);
  }

  read(): InputState {
    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let mz = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
    if (Math.abs(this.touch.mx) > 0.1 || Math.abs(this.touch.mz) > 0.1) {
      mx = this.touch.mx;
      mz = this.touch.mz;
    }
    let shoot = this.down('shoot') || this.touch.shoot || this.pointerShoot;
    let sprint = this.down('sprint') || this.touch.sprint;
    let pass = this.pressed('pass');
    let action = this.pressed('action');
    let screen = this.pressed('screen');
    const timeout = this.pressed('timeout');

    // Gamepad (optional): left stick, A shoot, B pass, X steal, Y screen, RT sprint.
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p);
    if (pad) {
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      if (Math.hypot(ax, ay) > 0.2) {
        mx = ax;
        mz = ay;
      }
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      shoot = shoot || btn(0);
      pass = pass || edge(1);
      action = action || edge(2);
      screen = screen || edge(3);
      sprint = sprint || btn(7) || btn(5);
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    const input: InputState = {
      mx,
      mz,
      sprint,
      shoot,
      pass,
      switchPlayer: pass,
      screen,
      action,
      timeout,
      passTarget: this.pointerPassTarget,
    };
    this.pressedCodes.clear();
    this.touch.pressed.clear();
    this.pointerPassTarget = undefined;
    return input;
  }

  pauseRequested(): boolean {
    return this.bindings.pause.some((c) => this.pressedCodes.has(c)) || this.touch.pressed.has('pause');
  }
}
