/**
 * Broadcast-style side view: the far sideline is narrower than the near one (a fixed,
 * gentle perspective centred on half court), depth is squashed, height rises up the screen.
 * The renderer, the court texture and the input mapping all use these same functions.
 */
export const VIEW_W = 480;
export const VIEW_H = 270;
export const Y0 = 98; // far sideline
export const DZ = 2.9; // px per foot of depth
export const S_FAR = 6;
export const S_NEAR = 8;
export const MARGIN = 74;
export const WORLD_W = Math.round(94 * S_NEAR + MARGIN * 2);
export const W0 = WORLD_W / 2;

export function sAt(z: number) {
  return S_FAR + ((S_NEAR - S_FAR) * z) / 50;
}

export function hsAt(z: number) {
  return sAt(z) * 0.62;
}

export function projX(x: number, z: number) {
  return W0 + (x - 47) * sAt(z);
}

export function projY(z: number, h = 0) {
  return Y0 + z * DZ - h * hsAt(z);
}

/** Inverse projection for a floor point (h = 0). */
export function unproject(px: number, py: number): { x: number; z: number } {
  const z = (py - Y0) / DZ;
  return { x: 47 + (px - W0) / sAt(z), z };
}
