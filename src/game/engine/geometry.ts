/**
 * Court geometry in feet. x runs baseline to baseline (0..94), z runs from the far
 * sideline (0) to the near sideline (50). h is height above the floor.
 * Every rule check (threes, bounds, rim) uses these numbers, and the renderer
 * projects the same numbers, so visuals and rules always agree.
 */
export const COURT_LENGTH = 94;
export const COURT_WIDTH = 50;
export const HALF = COURT_LENGTH / 2;
export const RIM_OFFSET = 5.25; // basket centre from baseline
export const RIM_HEIGHT = 10;
export const RIM_RADIUS = 0.75;
export const THREE_RADIUS = 23.75;
export const CORNER_THREE_Z = 3; // corner lines 22 ft from the basket
export const CORNER_THREE_LEN = 14; // corner straight runs 14 ft from baseline
export const KEY_HALF_WIDTH = 8;
export const FT_LINE = 19; // from baseline
export const RESTRICTED_RADIUS = 4;

export type Vec = { x: number; z: number };

/** dir = +1 attacks the right basket (x = 94), -1 attacks the left basket. */
export function basketFor(dir: 1 | -1): Vec {
  return { x: dir === 1 ? COURT_LENGTH - RIM_OFFSET : RIM_OFFSET, z: COURT_WIDTH / 2 };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** True when a shot from (x, z) toward the basket attacked in direction dir is worth 3. */
export function isThree(p: Vec, dir: 1 | -1): boolean {
  const fromBaseline = dir === 1 ? COURT_LENGTH - p.x : p.x;
  if (fromBaseline <= CORNER_THREE_LEN) {
    return p.z < CORNER_THREE_Z || p.z > COURT_WIDTH - CORNER_THREE_Z;
  }
  return dist(p, basketFor(dir)) > THREE_RADIUS;
}

export function inBounds(p: Vec, margin = 0): boolean {
  return p.x >= -margin && p.x <= COURT_LENGTH + margin && p.z >= -margin && p.z <= COURT_WIDTH + margin;
}

/** Is p in the half of the court that a team attacking in dir is trying to score on? */
export function inFrontcourt(p: Vec, dir: 1 | -1): boolean {
  return dir === 1 ? p.x > HALF : p.x < HALF;
}

/** Point on the three-point line (or corner) for a given angle around the basket, used to place spacing spots. */
export function spot(dir: 1 | -1, distance: number, angleDeg: number): Vec {
  const b = basketFor(dir);
  const a = (angleDeg * Math.PI) / 180;
  // angle 0 = straight out toward half court, +90 = toward z=50 (near sideline).
  return { x: b.x - dir * Math.cos(a) * distance, z: b.z + Math.sin(a) * distance };
}

export function clampToCourt(p: Vec, margin = 0.5): Vec {
  return {
    x: Math.min(COURT_LENGTH - margin, Math.max(margin, p.x)),
    z: Math.min(COURT_WIDTH - margin, Math.max(margin, p.z)),
  };
}

/** Distance from point p to the segment a-b, and the projection parameter t in [0,1]. */
export function segDist(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1e-6;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)), t };
}
